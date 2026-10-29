import { parse as javaParser } from 'java-parser';
import { Controller, Endpoint, FormPart } from './model';
import { baseName, collectJavaFiles, normalizePath, readFileText } from './file-utils';
import { isMultipartFileType, resolveMediaTypes, unwrapBodyType } from './spring-types';
import { ControllerVisitor, extractPathParams } from './controller-visitor';

export class EndpointParser {
    // Per-file cache: maps fsPath → controllers found in that file.
    // This allows incremental updates — only the changed file is re-parsed.
    private fileCache = new Map<string, Controller[]>();
    private generatedRe = /_[0-9a-zA-Z]+\.java$/;

    /** Clear the per-file cache so the next scan re-parses everything. */
    clearCache() {
        this.fileCache.clear();
    }

    /**
     * Evict all cached files whose path starts with any of the given
     * directory prefixes.
     */
    evictPaths(dirs: string[]): void {
        const normDirs = dirs.map(d => normalizePath(d.trim()));
        for (const cachedPath of [...this.fileCache.keys()]) {
            const norm = normalizePath(cachedPath);
            if (normDirs.some(dir => norm.startsWith(dir + '/'))) {
                this.fileCache.delete(cachedPath);
            }
        }
    }

    /**
     * Scan the project root for Java files, parse the controllers, populate
     * the cache and return every controller found.
     */
    async parseControllers(projectRoot: string): Promise<Controller[]> {
        const files = collectJavaFiles(projectRoot);

        const controllers: Controller[] = [];
        const seenFiles = new Set<string>();

        // Separate files into cached (instant) and uncached (need parsing)
        const toParse: string[] = [];

        for (const filePath of files) {
            if (this.generatedRe.test(baseName(filePath))) continue;
            if (seenFiles.has(filePath)) continue;
            seenFiles.add(filePath);

            // Use cached result if available
            if (this.fileCache.has(filePath)) {
                controllers.push(...this.fileCache.get(filePath)!);
                continue;
            }

            toParse.push(filePath);
        }

        // Parse uncached files in parallel batches for significantly faster scanning
        const BATCH_SIZE = 30;
        for (let i = 0; i < toParse.length; i += BATCH_SIZE) {
            const batch = toParse.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(
                batch.map(filePath =>
                    this.parseFile(filePath)
                        .then(ctrls => ({ filePath, ctrls }))
                        .catch(() => ({ filePath, ctrls: [] as Controller[] }))
                )
            );
            for (const { filePath, ctrls } of results) {
                this.fileCache.set(filePath, ctrls);
                controllers.push(...ctrls);
            }
        }

        // Remove stale cache entries for files that no longer exist
        for (const cachedPath of this.fileCache.keys()) {
            if (!seenFiles.has(cachedPath)) {
                this.fileCache.delete(cachedPath);
            }
        }

        return controllers;
    }

    /** Remove a file from the cache (e.g. on delete). */
    removeFile(fsPath: string): void {
        this.fileCache.delete(fsPath);
    }

    /**
     * Lightweight regex pre-check: returns true if the file text likely
     * contains a Spring controller.  This avoids the expensive AST parse
     * for the vast majority of Java files (DTOs, services, utils, etc.).
     *
     * Checks for:
     *  - @RestController or @Controller class-level annotations
     *  - @RequestMapping / @GetMapping / @PostMapping / etc.
     */
    private static readonly CONTROLLER_HINT_RE =
        /@(?:RestController|Controller)\b|@(?:Request|Get|Post|Put|Delete|Patch)Mapping\b/;

    private looksLikeController(text: string): boolean {
        return EndpointParser.CONTROLLER_HINT_RE.test(text);
    }

    /** Parse a single file and return the controllers found in it. */
    private async parseFile(filePath: string): Promise<Controller[]> {
        const raw = await readFileText(filePath);

        // Fast pre-check: skip expensive AST parsing for non-controller files
        if (!this.looksLikeController(raw)) {
            return [];
        }

        const parsed = this.parseWithAst(raw);
        if (parsed) {
            for (const ctrl of parsed) {
                ctrl.file = filePath;
                for (const ep of ctrl.endpoints) {
                    ep.file = filePath;
                }
            }
            return parsed;
        }

        return this.parseWithRegex(raw, filePath);
    }

    async findEndpoints(projectRoot: string): Promise<Endpoint[]> {
        const ctrls = await this.parseControllers(projectRoot);
        return ctrls.flatMap(c => c.endpoints);
    }

    // ------------------------------------------------------------------------
    // AST-based parsing using visitor with context stack
    // ------------------------------------------------------------------------
    private parseWithAst(source: string): Controller[] | null {
        try {
            const cst = javaParser(source);

            const visitor = new ControllerVisitor();
            visitor.visit(cst);

            if (visitor.controllers.length > 0) {
                // Deduplicate endpoints in each controller
                for (const controller of visitor.controllers) {
                    const seen = new Set<string>();
                    controller.endpoints = controller.endpoints.filter((e: Endpoint) => {
                        const key = `${e.method}:${e.path}:${e.line}`;
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    });
                }
                return visitor.controllers;
            }
            return null;
        } catch {
            return null;
        }
    }

    // ------------------------------------------------------------------------
    // Fallback regex parser – aims for parity with AST-based parsing
    // ------------------------------------------------------------------------

    private parseWithRegex(text: string, filePath: string): Controller[] {
        const controllers: Controller[] = [];
        const lines = text.split(/\r?\n/);

        // Accumulate annotations seen before a class or method declaration so
        // we can check them when we encounter the declaration line itself.
        let pendingAnnotations: string[] = [];
        let pendingAnnotationArgs = new Map<string, string>(); // annotation name → raw args

        let currentCtrl: Controller | null = null;
        let classBraceDepth = 0;
        let inClass = false;

        for (let i = 0; i < lines.length; i++) {
            const ln = lines[i];
            const trimmed = ln.trim();

            // ---- collect annotations that precede a class or method --------
            const annoMatch = /^@(\w+)\s*(?:\(([^)]*)\))?/.exec(trimmed);
            if (annoMatch && !/\b(class|interface|enum)\b/.test(trimmed)) {
                pendingAnnotations.push(annoMatch[1]);
                if (annoMatch[2] !== undefined) {
                    pendingAnnotationArgs.set(annoMatch[1], annoMatch[2]);
                }
                // An annotation-only line — don't fall through to other matchers
                if (!/(private|public|protected|static|final|void|class)\b/.test(trimmed)) {
                    continue;
                }
            }

            // ---- class declaration -----------------------------------------
            const classMatch = /\bclass\s+(\w+)/.exec(trimmed);
            if (classMatch) {
                // finish previous controller if any
                if (currentCtrl) {
                    this.deduplicateEndpoints(currentCtrl);
                    controllers.push(currentCtrl);
                    currentCtrl = null;
                }

                const isController = pendingAnnotations.some(a =>
                    a === 'RestController' || a === 'Controller'
                );

                if (isController) {
                    let basePath = '';
                    const rmArgs = pendingAnnotationArgs.get('RequestMapping');
                    if (rmArgs !== undefined) {
                        basePath = this.extractPathFromArgs(rmArgs);
                    }
                    currentCtrl = {
                        name: classMatch[1],
                        basePath,
                        file: filePath,
                        line: i + 1,
                        endpoints: []
                    };
                }

                inClass = true;
                classBraceDepth = 0;
                // count braces on this line
                classBraceDepth += (ln.match(/\{/g) || []).length;
                classBraceDepth -= (ln.match(/\}/g) || []).length;
                pendingAnnotations = [];
                pendingAnnotationArgs = new Map();
                continue;
            }

            // ---- brace tracking inside a class ----------------------------
            if (inClass) {
                classBraceDepth += (ln.match(/\{/g) || []).length;
                classBraceDepth -= (ln.match(/\}/g) || []).length;
                if (classBraceDepth <= 0) {
                    inClass = false;
                    if (currentCtrl) {
                        this.deduplicateEndpoints(currentCtrl);
                        controllers.push(currentCtrl);
                        currentCtrl = null;
                    }
                    pendingAnnotations = [];
                    pendingAnnotationArgs = new Map();
                    continue;
                }
            }

            // ---- method-level mapping annotations -------------------------
            if (!currentCtrl) {
                // Not inside a controller class — reset and skip
                if (!annoMatch) {
                    pendingAnnotations = [];
                    pendingAnnotationArgs = new Map();
                }
                continue;
            }

            // Check if any pending annotation is a mapping annotation
            const mappingAnno = pendingAnnotations.find(a => /Mapping$/.test(a));
            // Also check inline on this line (when annotation + method on same line)
            const inlineMapping = /^@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*(?:\(([^)]*)\))?/.exec(trimmed);

            if (mappingAnno || inlineMapping) {
                // Collect the full method signature from this line forward
                const sigStartIdx = inlineMapping ? i : i;
                const sig = this.collectMethodSignature(lines, sigStartIdx);

                // Determine which mapping annotation(s) to process
                const mappingsToProcess: Array<{ name: string; args: string }> = [];

                if (inlineMapping) {
                    mappingsToProcess.push({
                        name: inlineMapping[1],
                        args: inlineMapping[2] || ''
                    });
                }
                // Also process any pending mapping annotations (from preceding lines)
                for (const pa of pendingAnnotations) {
                    if (/Mapping$/.test(pa) && (!inlineMapping || pa !== inlineMapping[1])) {
                        mappingsToProcess.push({
                            name: pa,
                            args: pendingAnnotationArgs.get(pa) || ''
                        });
                    }
                }

                for (const mapping of mappingsToProcess) {
                    let method = mapping.name.replace('Mapping', '').toUpperCase();
                    if (method === 'REQUEST') method = '';

                    let path = '';
                    let consumes: string[] = [];
                    const args = mapping.args;

                    if (args) {
                        path = this.extractPathFromArgs(args);

                        // consumes: collect all quoted strings from consumes = ...
                        const consumesMatch = /consumes\s*=\s*\{?\s*([^}]*)\}?/.exec(args);
                        if (consumesMatch) {
                            const raw = consumesMatch[1];
                            // Capture both quoted strings and MediaType.* constants
                            const quoted = [...raw.matchAll(/["']([^"']+)["']/g)].map(m => m[1]);
                            const constants = [...raw.matchAll(/MediaType\.([A-Z_]+)/g)].map(m => `MediaType.${m[1]}`);
                            consumes = resolveMediaTypes([...quoted, ...constants]);
                        }

                        // method attribute for @RequestMapping
                        if (mapping.name === 'RequestMapping') {
                            const methodAttr = /method\s*=\s*(?:\{?\s*)?RequestMethod\.([A-Z]+)/.exec(args);
                            if (methodAttr) method = methodAttr[1];
                        }
                    }

                    if (!method && mapping.name === 'RequestMapping') {
                        method = 'GET';
                    }

                    // Compose full path with basePath
                    let fullPath = path;
                    if (currentCtrl.basePath) {
                        if (fullPath && !fullPath.startsWith('/')) {
                            fullPath = currentCtrl.basePath + '/' + fullPath;
                        } else {
                            fullPath = currentCtrl.basePath + fullPath;
                        }
                    }
                    if (fullPath && !fullPath.startsWith('/')) {
                        fullPath = '/' + fullPath;
                    }

                    // Extract parameter info from full method signature
                    const metadata = this.extractParameterMetadataFromSig(sig);

                    currentCtrl.endpoints.push({
                        method,
                        path: fullPath,
                        file: filePath,
                        line: i + 1,
                        pathParams: extractPathParams(fullPath),
                        consumes,
                        bodyType: metadata.bodyType,
                        headers: metadata.headers,
                        queryParams: metadata.queryParams,
                        hasBody: metadata.hasBody,
                        formParts: metadata.formParts.length > 0 ? metadata.formParts : undefined,
                        modelAttributeType: metadata.modelAttributeType
                    });
                }

                pendingAnnotations = [];
                pendingAnnotationArgs = new Map();
                continue;
            }

            // Reset pending annotations when we hit a non-annotation, non-mapping line
            if (!annoMatch) {
                pendingAnnotations = [];
                pendingAnnotationArgs = new Map();
            }
        }

        // Handle file ending without closing brace
        if (currentCtrl) {
            this.deduplicateEndpoints(currentCtrl);
            controllers.push(currentCtrl);
        }

        return controllers;
    }

    /**
     * Extract a path value from annotation arguments string.
     * Handles: "path", value = "path", path = "path"
     */
    private extractPathFromArgs(args: string): string {
        // Try named attributes first
        const named = /(?:value|path)\s*=\s*["']([^"']+)["']/.exec(args);
        if (named) return named[1];
        // Fall back to bare string
        const bare = /^\s*["']([^"']+)["']/.exec(args);
        if (bare) return bare[1];
        return '';
    }

    /**
     * Collect the full method signature starting from a line, spanning
     * across continuation lines until we hit the opening `{`.
     */
    private collectMethodSignature(lines: string[], startIdx: number): string {
        let sig = '';
        for (let j = startIdx; j < lines.length; j++) {
            sig += lines[j] + ' ';
            if (lines[j].includes('{')) break;
        }
        return sig;
    }

    /**
     * Extract @RequestHeader, @RequestParam, @RequestBody, @RequestPart,
     * @ModelAttribute and body type from a full method signature string.
     */
    private extractParameterMetadataFromSig(sig: string): {
        headers: string[];
        queryParams: string[];
        hasBody: boolean;
        bodyType?: string;
        formParts: FormPart[];
        modelAttributeType?: string;
    } {
        const headers: string[] = [];
        const queryParams: string[] = [];
        const formParts: FormPart[] = [];
        let hasBody = false;
        let bodyType: string | undefined;
        let modelAttributeType: string | undefined;

        // Match @RequestHeader with optional value/name attribute, then the param name
        const headerRe = /@RequestHeader\s*(?:\(\s*(?:(?:value|name)\s*=\s*)?["']([^"']+)["']\s*\))?\s+(?:[A-Za-z0-9_<>\[\]]+)\s+(\w+)/g;
        let m: RegExpExecArray | null;
        while ((m = headerRe.exec(sig)) !== null) {
            headers.push(m[1] || m[2]); // annotation value or param variable name
        }

        // Match @RequestParam — distinguish MultipartFile (file upload) from query params
        const queryRe = /@RequestParam\s*(?:\(\s*(?:(?:value|name)\s*=\s*)?["']([^"']+)["']\s*\))?\s+([A-Za-z0-9_<>\[\]]+)\s+(\w+)/g;
        while ((m = queryRe.exec(sig)) !== null) {
            const paramType = m[2];
            if (isMultipartFileType(paramType)) {
                // @RequestParam("file") MultipartFile → file upload part
                hasBody = true;
                const partName = m[1] || m[3];
                formParts.push({ name: partName, type: paramType, isFile: true });
            } else {
                queryParams.push(m[1] || m[3]);
            }
        }

        // Match @RequestBody followed by type and param name
        const bodyRe = /@RequestBody\s+([A-Za-z0-9_<>\[\]]+)\s+\w+/;
        const bodyMatch = bodyRe.exec(sig);
        if (bodyMatch) {
            hasBody = true;
            // Unwrap wrapper types: HttpEntity<Foo> → Foo
            bodyType = unwrapBodyType(bodyMatch[1]);
        } else if (/@RequestBody/.test(sig)) {
            hasBody = true;
        }

        // Match @RequestPart with optional value/name attribute, then type and param name
        const partRe = /@RequestPart\s*(?:\(\s*(?:(?:value|name)\s*=\s*)?["']([^"']+)["']\s*\))?\s+([A-Za-z0-9_<>\[\]]+)\s+(\w+)/g;
        while ((m = partRe.exec(sig)) !== null) {
            hasBody = true;
            const partName = m[1] || m[3]; // annotation value or param variable name
            const partType = m[2];
            const isFile = isMultipartFileType(partType);
            formParts.push({ name: partName, type: partType, isFile });
        }

        // Match @ModelAttribute followed by type and param name
        const modelAttrRe = /@ModelAttribute\s+([A-Za-z0-9_<>\[\]]+)\s+\w+/;
        const modelAttrMatch = modelAttrRe.exec(sig);
        if (modelAttrMatch) {
            hasBody = true;
            modelAttributeType = modelAttrMatch[1];
        } else if (/@ModelAttribute/.test(sig)) {
            hasBody = true;
        }

        return { headers, queryParams, hasBody, bodyType, formParts, modelAttributeType };
    }

    private deduplicateEndpoints(ctrl: Controller) {
        const seen = new Set<string>();
        ctrl.endpoints = ctrl.endpoints.filter((e: Endpoint) => {
            const key = `${e.method}:${e.path}:${e.line}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
}
