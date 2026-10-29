import { BaseJavaCstVisitorWithDefaults } from 'java-parser';
import { ApiResponseInfo, Controller, Endpoint, FormPart, ParameterMeta } from './model';
import { isMultipartFileType, resolveMediaTypes, unwrapBodyType } from './spring-types';

// utility shared by parser and visitor
export function extractPathParams(path: string): string[] {
    // Support both express-style ":param" and brace-style "{param}" paths.
    // The older regex required a trailing '}' even for ":param" which was
    // incorrect and confusing.  Use alternation to capture the name from
    // either form, then push whichever group matched.
    const results: string[] = [];
    const re = /:(\w+)|\{(\w+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(path)) !== null) {
        results.push(m[1] || m[2]);
    }
    return results;
}

// -----------------------------------------------------------------------------
// Context and helper types used by the visitor
// -----------------------------------------------------------------------------
export interface AnnotationInfo {
    name: string;
    attributes: Map<string, string | string[]>;
}

export interface ClassContext {
    type: 'class';
    name: string;
    line: number;
    annotations: AnnotationInfo[];
    endpoints: Endpoint[];
    basePath?: string; // will be set after processing
}

export interface MethodContext {
    type: 'method';
    name: string;
    line: number;
    annotations: AnnotationInfo[];
}

// -----------------------------------------------------------------------------
// Visitor implementation separated from EndpointParser for single responsibility
// -----------------------------------------------------------------------------
export class ControllerVisitor extends BaseJavaCstVisitorWithDefaults {
    controllers: Controller[] = [];
    private contextStack: (ClassContext | MethodContext)[] = [];

    constructor() {
        super();
        this.validateVisitor();
    }

    // ------------------------------------------------------------
    // Annotation visitor – the proven working method
    // ------------------------------------------------------------
    annotation(ctx: any) {
        if (this.contextStack.length === 0) return;

        const typeName = ctx.typeName[0].children.Identifier[0].image;
        const attributes = new Map<string, string | string[]>();

        if (ctx.elementValuePairList) {
            const pairs = ctx.elementValuePairList[0].children.elementValuePair;
            for (const pair of pairs) {
                const key = pair.children.Identifier[0].image;
                const value = this.extractElementValue(pair.children.elementValue[0]);
                if (value !== undefined) {
                    attributes.set(key, value);
                }
            }
        } else if (ctx.elementValue) {
            const value = this.extractElementValue(ctx.elementValue[0]);
            if (value !== undefined) {
                attributes.set('value', value);
            }
        }

        const current = this.contextStack[this.contextStack.length - 1];
        current.annotations.push({ name: typeName, attributes });

        // Recurse into container annotations like @ApiResponses({@ApiResponse(...)})
        // The java-parser CST visitor doesn't automatically traverse children of
        // overridden visitor methods, so nested annotations inside element values
        // (e.g. the @ApiResponse entries inside @ApiResponses) are never visited.
        // We explicitly visit them here to flatten them into the current context.
        this.visitNestedAnnotations(ctx);
    }

    /**
     * Visit nested annotation nodes found in element values of a container
     * annotation (e.g. @ApiResponses containing @ApiResponse entries).
     */
    private visitNestedAnnotations(annotationCtx: any): void {
        const elementValues: any[] = [];

        // Single value: @Foo(@Bar(...))
        if (annotationCtx.elementValue) {
            elementValues.push(annotationCtx.elementValue[0]);
        }

        // Key-value pairs: @Foo(value = @Bar(...))
        if (annotationCtx.elementValuePairList) {
            const pairs = annotationCtx.elementValuePairList[0].children.elementValuePair || [];
            for (const pair of pairs) {
                if (pair.children.elementValue) {
                    elementValues.push(pair.children.elementValue[0]);
                }
            }
        }

        for (const ev of elementValues) {
            // Direct annotation: @Foo(@Bar(...))
            if (ev.children?.annotation) {
                for (const ann of ev.children.annotation) {
                    this.annotation(ann.children);
                }
            }

            // Array of annotations: @Foo({@Bar(...), @Baz(...)})
            const arrayInit = ev.children?.elementValueArrayInitializer?.[0];
            if (arrayInit) {
                const items = arrayInit.children?.elementValueList?.[0]?.children?.elementValue || [];
                for (const item of items) {
                    if (item.children?.annotation) {
                        for (const ann of item.children.annotation) {
                            this.annotation(ann.children);
                        }
                    }
                }
            }
        }
    }

    typeIdentifier(ctx: any) {
        if (this.contextStack.length === 0) return;

        const className = ctx.Identifier[0].image;
        const line = ctx.Identifier[0].startLine;

        const current = this.contextStack[this.contextStack.length - 1];
        current.name = className;
        current.line = line;
        return;
    }

    classDeclaration(ctx: any) {
        const classCtx: ClassContext = {
            type: 'class',
            name: '',
            line: 0,
            annotations: [],
            endpoints: []
        };

        this.contextStack.push(classCtx);
        
        // Visit class modifiers first — this collects all class-level
        // annotations (including @RestController, @RequestMapping, etc.)
        for (const classModifier of ctx.classModifier || []) {
            this.visit(classModifier);
        }

        // Compute basePath NOW, before visiting the class body, so that
        // methodDeclaration → buildEndpoint can prepend it to endpoint paths.
        const requestMapping = classCtx.annotations.find(a => a.name === 'RequestMapping');
        if (requestMapping) {
            const pathAttr = requestMapping.attributes.get('value') || requestMapping.attributes.get('path');
            if (pathAttr && typeof pathAttr === 'string') {
                classCtx.basePath = pathAttr.replace(/^['\"]|['\"]$/g, '');
            }
        }

        // Now visit the class body (normalClassDeclaration contains classBody
        // with method declarations).  basePath is already available on classCtx.
        for (const normalClassDeclaration of ctx.normalClassDeclaration || []) {
            this.visit(normalClassDeclaration);
        }

        this.contextStack.pop();

        const isController = classCtx.annotations.some(a =>
            a.name === 'RestController' || a.name === 'Controller'
        );
        if (isController) {
            const controller: Controller = {
                name: classCtx.name,
                basePath: classCtx.basePath || '',
                file: '',
                line: classCtx.line,
                endpoints: classCtx.endpoints
            };
            this.controllers.push(controller);
        }
    }

    methodDeclarator(ctx: any) {
        if (this.contextStack.length === 0) return;

        const methodName = ctx.Identifier[0].image;
        const line = ctx.Identifier[0].startLine;

        const current = this.contextStack[this.contextStack.length - 1];
        current.name = methodName;
        current.line = line;
        return;
    }

    methodDeclaration(ctx: any) {
        if (this.contextStack.length === 0 || this.contextStack[this.contextStack.length - 1].type !== 'class') {
            return;
        }

        const classCtx = this.contextStack[this.contextStack.length - 1] as ClassContext;
        const methodCtx: MethodContext = {
            type: 'method',
            name: '',
            line: 0,
            annotations: []
        };

        this.contextStack.push(methodCtx);

        for (const methodHeader of ctx.methodHeader || []) {
            this.visit(methodHeader);
        }

        for (const methodModifier of ctx.methodModifier || []) {
            this.visit(methodModifier);
        }

        this.contextStack.pop();

        const mappingAnnotations = methodCtx.annotations.filter(a => /Mapping$/.test(a.name));
        if (mappingAnnotations.length === 0) return;

        for (const mapping of mappingAnnotations) {
            const endpoint = this.buildEndpoint(mapping, methodCtx, ctx, classCtx);
            if (endpoint) {
                classCtx.endpoints.push(endpoint);
            }
        }
    }

    /**
     * Recursively collect all tokens from a CST subtree, sorted by position.
     * This is the most robust way to extract text from deeply nested expression trees.
     */
    private collectTokens(node: any): any[] {
        if (!node) return [];
        // If it's a token (has .image), return it directly
        if (node.image !== undefined) return [node];
        const tokens: any[] = [];
        if (node.children) {
            for (const key of Object.keys(node.children)) {
                for (const child of node.children[key]) {
                    tokens.push(...this.collectTokens(child));
                }
            }
        }
        tokens.sort((a: any, b: any) => a.startOffset - b.startOffset);
        return tokens;
    }

    /**
     * Extract the value from an `elementValue` CST node.
     *
     * The java-parser CST structure for elementValue is:
     *   elementValue
     *     └─ conditionalExpression  (for single values: strings, identifiers, enums)
     *     └─ elementValueArrayInitializer  (for array values like {"a","b"})
     *
     * String literals are deeply nested:
     *   conditionalExpression → binaryExpression → unaryExpression →
     *   primary → primaryPrefix → literal → StringLiteral
     *
     * Enum references (e.g. RequestMethod.GET) are similarly nested:
     *   ... → primaryPrefix → fqnOrRefType → (tokens: RequestMethod . GET)
     */
    private extractElementValue(elmCtx: any): string | string[] | undefined {
        if (!elmCtx) return undefined;
        const children = elmCtx.children;
        if (!children) return undefined;

        // Direct annotation value: content = @Content(...)
        if (children.annotation) {
            const tokens = this.collectTokens(children.annotation[0]);
            if (tokens.length > 0) {
                return tokens.map((t: any) => t.image).join('');
            }
        }

        // Array values: elementValueArrayInitializer → elementValueList → elementValue[]
        if (children.elementValueArrayInitializer) {
            const arrayInit = children.elementValueArrayInitializer[0];
            const elementValues = arrayInit.children?.elementValueList?.[0]?.children?.elementValue;
            if (elementValues) {
                const values = elementValues
                    .map((ev: any) => {
                        const value = this.extractElementValue(ev);
                        if (Array.isArray(value)) {
                            return value.join(',');
                        }
                        return value;
                    })
                    .filter((v: any): v is string => typeof v === 'string' && v.length > 0);
                return values;
            }
            return [];
        }

        // Single value: conditionalExpression → deeply nested expression tree
        if (children.conditionalExpression) {
            const tokens = this.collectTokens(children.conditionalExpression[0]);
            if (tokens.length === 0) return undefined;
            return tokens.map((t: any) => t.image).join('');
        }

        return undefined;
    }

    private buildEndpoint(
        mapping: AnnotationInfo,
        methodCtx: MethodContext,
        methodDeclCtx: any,
        classCtx: ClassContext
    ): Endpoint | null {
        let method = mapping.name.replace('Mapping', '').toUpperCase();
        if (method === 'REQUEST') method = '';

        let path = '';
        let consumes: string[] = [];
        let produces: string[] = [];

        for (const [key, value] of mapping.attributes.entries()) {
            if (key === 'value' || key === 'path') {
                if (typeof value === 'string') {
                    path = value.replace(/^['\"]|['\"]$/g, '');
                }
            } else if (key === 'consumes') {
                if (Array.isArray(value)) {
                    consumes = resolveMediaTypes(value.map(v => v.replace(/^['\"]|['\"]$/g, '')));
                } else if (typeof value === 'string') {
                    consumes = resolveMediaTypes([value.replace(/^['\"]|['\"]$/g, '')]);
                }
            } else if (key === 'produces') {
                if (Array.isArray(value)) {
                    produces = value.map(v => v.replace(/^['\"]|['\"]$/g, ''));
                } else if (typeof value === 'string') {
                    produces = [value.replace(/^['\"]|['\"]$/g, '')];
                }
            } else if (key === 'method' && mapping.name === 'RequestMapping') {
                if (typeof value === 'string') {
                    const methodMatch = value.match(/RequestMethod\.([A-Z]+)/);
                    if (methodMatch) method = methodMatch[1];
                }
            }
        }

        if (!method && mapping.name === 'RequestMapping') {
            method = 'GET';
        }

        let fullPath = path;
        if (classCtx.basePath) {
            if (fullPath && !fullPath.startsWith('/')) {
                fullPath = classCtx.basePath + '/' + fullPath;
            } else {
                fullPath = classCtx.basePath + fullPath;
            }
        }
        if (fullPath && !fullPath.startsWith('/')) {
            fullPath = '/' + fullPath;
        }

        const params = this.extractParameters(methodDeclCtx);

        // Extract return type from methodHeader → result (the return type declaration)
        const returnType = this.extractReturnType(methodDeclCtx);

        // Extract OpenAPI annotations from the method
        const openApiMeta = this.extractOpenApiAnnotations(methodCtx.annotations, classCtx.annotations);

        return {
            method,
            path: fullPath,
            file: '',
            line: methodCtx.line,
            pathParams: extractPathParams(fullPath),
            consumes,
            produces: produces.length > 0 ? produces : undefined,
            headers: params.headers,
            queryParams: params.queryParams,
            hasBody: params.hasBody,
            bodyType: params.bodyType,
            formParts: params.formParts.length > 0 ? params.formParts : undefined,
            modelAttributeType: params.modelAttributeType,
            returnType: returnType || undefined,
            // OpenAPI metadata
            summary: openApiMeta.summary,
            description: openApiMeta.description,
            operationId: openApiMeta.operationId,
            tags: openApiMeta.tags.length > 0 ? openApiMeta.tags : undefined,
            deprecated: openApiMeta.deprecated || undefined,
            responses: openApiMeta.responses.length > 0 ? openApiMeta.responses : undefined,
            parameterMeta: params.parameterMeta.length > 0 ? params.parameterMeta : undefined,
            security: openApiMeta.security.length > 0 ? openApiMeta.security : undefined,
        };
    }

    /**
     * Extract OpenAPI/Swagger annotations from method and class annotations.
     */
    private extractOpenApiAnnotations(
        methodAnnotations: AnnotationInfo[],
        classAnnotations: AnnotationInfo[]
    ): {
        summary?: string;
        description?: string;
        operationId?: string;
        tags: string[];
        deprecated: boolean;
        responses: ApiResponseInfo[];
        security: string[];
    } {
        let summary: string | undefined;
        let description: string | undefined;
        let operationId: string | undefined;
        const tags: string[] = [];
        let deprecated = false;
        const responses: ApiResponseInfo[] = [];
        const security: string[] = [];

        // Collect class-level @Tag annotations
        for (const ann of classAnnotations) {
            if (ann.name === 'Tag') {
                const name = this.getAnnotationAttrString(ann, 'name');
                if (name) tags.push(name);
            }
        }

        for (const ann of methodAnnotations) {
            switch (ann.name) {
                case 'Operation': {
                    // @Operation(summary = "...", description = "...", operationId = "...", deprecated = true/false)
                    summary = this.getAnnotationAttrString(ann, 'summary') || summary;
                    description = this.getAnnotationAttrString(ann, 'description') || description;
                    operationId = this.getAnnotationAttrString(ann, 'operationId') || operationId;
                    const depVal = ann.attributes.get('deprecated');
                    if (typeof depVal === 'string' && depVal === 'true') deprecated = true;
                    // tags inside @Operation
                    const opTags = ann.attributes.get('tags');
                    if (Array.isArray(opTags)) {
                        opTags.forEach(t => { const v = t.replace(/^['"]|['"]$/g, ''); if (v) tags.push(v); });
                    } else if (typeof opTags === 'string') {
                        const v = opTags.replace(/^['"]|['"]$/g, '');
                        if (v) tags.push(v);
                    }
                    break;
                }
                case 'ApiOperation': {
                    // Swagger 2: @ApiOperation(value = "...", notes = "...", tags = {...})
                    summary = this.getAnnotationAttrString(ann, 'value') || summary;
                    description = this.getAnnotationAttrString(ann, 'notes') || description;
                    const apiOpTags = ann.attributes.get('tags');
                    if (Array.isArray(apiOpTags)) {
                        apiOpTags.forEach(t => { const v = t.replace(/^['"]|['"]$/g, ''); if (v) tags.push(v); });
                    }
                    break;
                }
                case 'Tag': {
                    const name = this.getAnnotationAttrString(ann, 'name');
                    if (name) tags.push(name);
                    break;
                }
                case 'Deprecated': {
                    deprecated = true;
                    break;
                }
                case 'ApiResponse': {
                    const resp = this.parseApiResponse(ann);
                    if (resp) responses.push(resp);
                    break;
                }
                case 'ApiResponses': {
                    // @ApiResponses contains multiple @ApiResponse — these are extracted
                    // as nested annotations in the CST. The java-parser exposes them as
                    // an array in the 'value' attribute.
                    // In practice, they appear as separate annotation nodes in the CST
                    // when they're written as repeatable annotations, or they're already
                    // collected individually. We handle the container just in case.
                    break;
                }
                case 'SecurityRequirement': {
                    const name = this.getAnnotationAttrString(ann, 'name');
                    if (name) security.push(name);
                    break;
                }
            }
        }

        return { summary, description, operationId, tags: [...new Set(tags)], deprecated, responses, security };
    }

    /**
     * Parse a single @ApiResponse annotation into ApiResponseInfo.
     */
    private parseApiResponse(ann: AnnotationInfo): ApiResponseInfo | null {
        const statusCode = this.getAnnotationAttrString(ann, 'responseCode')
            || this.getAnnotationAttrString(ann, 'code')
            || '200';
        const description = this.getAnnotationAttrString(ann, 'description');

        const contentRaw = this.getAnnotationAttrRaw(ann, 'content');
        const mediaType = contentRaw ? this.extractAttrFromRaw(contentRaw, 'mediaType') : undefined;
        const schemaType = contentRaw
            ? this.extractImplementationType(contentRaw)
            : this.extractImplementationType(this.getAnnotationAttrRaw(ann, 'schema'));
        const examples = contentRaw ? this.extractExampleObjects(contentRaw) : undefined;

        const headersRaw = this.getAnnotationAttrRaw(ann, 'headers');
        const headers = headersRaw ? this.extractHeaderObjects(headersRaw) : undefined;

        return {
            statusCode,
            description,
            ...(mediaType && { contentType: mediaType }),
            ...(schemaType && { schemaType }),
            ...(examples && Object.keys(examples).length > 0 && { examples }),
            ...(headers && Object.keys(headers).length > 0 && { headers }),
        };
    }

    /**
     * Get a raw attribute value from an annotation without quote stripping.
     */
    private getAnnotationAttrRaw(ann: AnnotationInfo, attrName: string): string | undefined {
        const val = ann.attributes.get(attrName);
        if (typeof val === 'string') {
            return val;
        }
        if (Array.isArray(val)) {
            return val.join(',');
        }
        return undefined;
    }

    /**
     * Extract a string attribute from a raw annotation expression.
     * Example: mediaType="application/json" -> application/json
     */
    private extractAttrFromRaw(raw: string, attrName: string): string | undefined {
        const re = new RegExp(`${attrName}\\s*=\\s*([\"'])(.*?)\\1`);
        const m = raw.match(re);
        return m?.[2];
    }

    /**
     * Extract implementation type from @Schema(implementation=Foo.class).
     */
    private extractImplementationType(raw?: string): string | undefined {
        if (!raw) return undefined;
        const m = raw.match(/implementation\s*=\s*([A-Za-z0-9_$.<>?]+)\.class/);
        if (!m?.[1]) return undefined;

        let type = m[1];
        // Strip package prefix and keep class name (+ generic suffix if present)
        type = type.split('.').pop() || type;
        return unwrapBodyType(type);
    }

    /**
     * Extract @ExampleObject(name=..., value=...) blocks from @Content(...).
     */
    private extractExampleObjects(raw: string): Record<string, any> | undefined {
        const result: Record<string, any> = {};
        const blocks = raw.match(/@ExampleObject\(([^)]*)\)/g) || [];

        let index = 1;
        for (const block of blocks) {
            const nameMatch = block.match(/name\s*=\s*"((?:\\.|[^"\\])*)"/);
            const name = (nameMatch?.[1] || this.extractAttrFromRaw(block, 'name') || `example${index++}`)
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');

            const valueMatch = block.match(/value\s*=\s*"((?:\\.|[^"\\])*)"/);
            const valueRaw = valueMatch?.[1]
                ? valueMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
                : this.extractAttrFromRaw(block, 'value');
            if (!valueRaw) continue;

            const value = this.parseExampleValue(valueRaw);
            result[name] = value;
        }

        return Object.keys(result).length > 0 ? result : undefined;
    }

    /**
     * Extract @Header(name=..., description=..., schema=@Schema(...)) blocks.
     */
    private extractHeaderObjects(raw: string): Record<string, any> | undefined {
        const result: Record<string, any> = {};
        const blocks = raw.match(/@Header\(([^)]*)\)/g) || [];

        for (const block of blocks) {
            const name = this.extractAttrFromRaw(block, 'name') || this.extractAttrFromRaw(block, 'value');
            if (!name) continue;

            const header: any = {};
            const description = this.extractAttrFromRaw(block, 'description');
            if (description) header.description = description;

            const format = this.extractAttrFromRaw(block, 'format');
            if (format) header.format = format;

            const requiredRaw = block.match(/required\s*=\s*(true|false)/)?.[1];
            if (requiredRaw) header.required = requiredRaw === 'true';

            const deprecatedRaw = block.match(/deprecated\s*=\s*(true|false)/)?.[1];
            if (deprecatedRaw) header.deprecated = deprecatedRaw === 'true';

            const schemaType = this.extractAttrFromRaw(block, 'type') || this.extractImplementationType(block);
            if (schemaType) header.schemaType = schemaType;

            result[name] = header;
        }

        return Object.keys(result).length > 0 ? result : undefined;
    }

    /**
     * Parse an @ExampleObject value payload and coerce JSON strings when possible.
     */
    private parseExampleValue(rawValue: string): any {
        const trimmed = rawValue.trim();
        if (!trimmed) return '';

        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try {
                return JSON.parse(trimmed);
            } catch {
                return trimmed;
            }
        }

        return trimmed;
    }

    /**
     * Get a string attribute from an annotation, stripping quotes.
     */
    private getAnnotationAttrString(ann: AnnotationInfo, attrName: string): string | undefined {
        const val = ann.attributes.get(attrName);
        if (typeof val === 'string') {
            const stripped = val.replace(/^['"]|['"]$/g, '');
            return stripped || undefined;
        }
        return undefined;
    }

    /**
     * Extract the return type from a methodDeclaration CST node.
     * CST path: methodHeader → result → unannType
     */
    private extractReturnType(methodDeclCtx: any): string {
        const result = methodDeclCtx.methodHeader?.[0]?.children?.result?.[0];
        if (!result) return '';
        // 'void' keyword
        if (result.children?.Void) return 'void';
        // unannType
        const unannType = result.children?.unannType?.[0];
        if (!unannType) return '';
        const raw = this.extractUnannTypeName(unannType);
        // Unwrap wrapper types (ResponseEntity<T> → T, Mono<T> → T, etc.)
        return unwrapBodyType(raw);
    }

    /**
     * Extract parameter metadata from a methodDeclaration CST node's children.
     *
     * CST path to parameters:
     *   methodDeclaration.children (= methodDeclCtx)
     *     → methodHeader[0].children
     *       → methodDeclarator[0].children
     *         → formalParameterList[0].children
     *           → formalParameter[]
     *
     * Each formalParameter has:
     *   formalParameter.children
     *     → variableParaRegularParameter[0].children
     *       → variableModifier[] (contains annotations)
     *       → unannType[0] (the type)
     *       → variableDeclaratorId[0].children.Identifier[0].image (the name)
     */
    private extractParameters(methodDeclCtx: any): {
        headers: string[];
        queryParams: string[];
        hasBody: boolean;
        bodyType?: string;
        formParts: FormPart[];
        modelAttributeType?: string;
        parameterMeta: ParameterMeta[];
    } {
        const headers: string[] = [];
        const queryParams: string[] = [];
        const formParts: FormPart[] = [];
        const parameterMeta: ParameterMeta[] = [];
        let hasBody = false;
        let bodyType: string | undefined;
        let modelAttributeType: string | undefined;

        // Navigate: methodHeader → methodDeclarator → formalParameterList → formalParameter[]
        const formalParams = methodDeclCtx.methodHeader?.[0]?.children
            ?.methodDeclarator?.[0]?.children
            ?.formalParameterList?.[0]?.children
            ?.formalParameter;
        if (!formalParams) return { headers, queryParams, hasBody, bodyType, formParts, modelAttributeType, parameterMeta };

        for (const param of formalParams) {
            // Each formalParameter wraps variableParaRegularParameter
            const regularParam = param.children?.variableParaRegularParameter?.[0]?.children;
            if (!regularParam) continue;

            // Extract parameter name from variableDeclaratorId
            const paramName = regularParam.variableDeclaratorId?.[0]?.children?.Identifier?.[0]?.image || '';

            // Extract annotations from variableModifier[]
            const variableModifiers = regularParam.variableModifier || [];
            const paramAnnotations = this.collectAnnotationsFromModifiers(variableModifiers);

            // Extract type name from unannType
            const unannType = regularParam.unannType?.[0];
            const typeName = unannType ? this.extractUnannTypeName(unannType) : '';

            // Check for @Parameter annotation (OpenAPI 3.0 metadata)
            const parameterAnn = paramAnnotations.find(a => a.name === 'Parameter');
            let paramMeta: ParameterMeta | undefined;

            for (const ann of paramAnnotations) {
                if (ann.name === 'RequestHeader') {
                    // Use annotation value attribute if present, otherwise use param name
                    const headerName = this.getAnnotationStringValue(ann) || paramName;
                    headers.push(headerName);

                    // Build parameter metadata from @Parameter if present
                    paramMeta = this.buildParameterMeta(headerName, 'header', typeName, parameterAnn, paramAnnotations);
                    const headerRequired = ann.attributes.get('required');
                    if (paramMeta && typeof headerRequired === 'string'
                        && (headerRequired === 'true' || headerRequired === 'false')) {
                        paramMeta.required = headerRequired === 'true';
                    }
                } else if (ann.name === 'RequestParam') {
                    if (isMultipartFileType(typeName)) {
                        // @RequestParam("file") MultipartFile → treat as form-data file part
                        hasBody = true;
                        const partName = this.getAnnotationStringValue(ann) || paramName;
                        formParts.push({ name: partName, type: typeName, isFile: true });
                    } else {
                        const queryName = this.getAnnotationStringValue(ann) || paramName;
                        queryParams.push(queryName);

                        // Build query parameter metadata
                        const required = ann.attributes.get('required');
                        paramMeta = this.buildParameterMeta(queryName, 'query', typeName, parameterAnn, paramAnnotations);
                        if (paramMeta && typeof required === 'string'
                            && (required === 'true' || required === 'false')) {
                            paramMeta.required = required === 'true';
                        }
                    }
                } else if (ann.name === 'RequestBody') {
                    hasBody = true;
                    if (typeName) {
                        // Unwrap wrapper types: HttpEntity<Foo> → Foo
                        bodyType = unwrapBodyType(typeName);
                    }
                } else if (ann.name === 'RequestPart') {
                    hasBody = true;
                    const partName = this.getAnnotationStringValue(ann) || paramName;
                    const isFile = isMultipartFileType(typeName);
                    formParts.push({ name: partName, type: typeName, isFile });
                } else if (ann.name === 'ModelAttribute') {
                    // @ModelAttribute binds form data to a POJO
                    hasBody = true;
                    if (typeName) {
                        modelAttributeType = typeName;
                    }
                }
            }

            // If no Spring binding annotation but there's a @PathVariable
            const pathVarAnn = paramAnnotations.find(a => a.name === 'PathVariable');
            if (pathVarAnn) {
                const pvName = this.getAnnotationStringValue(pathVarAnn) || paramName;
                paramMeta = this.buildParameterMeta(pvName, 'path', typeName, parameterAnn, paramAnnotations);
            }

            if (paramMeta) {
                parameterMeta.push(paramMeta);
            }
        }

        return { headers, queryParams, hasBody, bodyType, formParts, modelAttributeType, parameterMeta };
    }

    /**
     * Build a ParameterMeta from @Parameter annotation, Java type info, and validation annotations.
     */
    private buildParameterMeta(
        name: string,
        location: 'path' | 'query' | 'header',
        javaType: string,
        parameterAnn?: AnnotationInfo,
        allAnnotations?: AnnotationInfo[]
    ): ParameterMeta {
        const meta: ParameterMeta = { name, in: location };

        if (parameterAnn) {
            const desc = this.getAnnotationAttrString(parameterAnn, 'description');
            if (desc) meta.description = desc;
            const example = this.getAnnotationAttrString(parameterAnn, 'example');
            if (example) meta.example = example;
            const required = parameterAnn.attributes.get('required');
            if (typeof required === 'string' && (required === 'true' || required === 'false')) {
                meta.required = required === 'true';
            }
            const deprecated = parameterAnn.attributes.get('deprecated');
            if (typeof deprecated === 'string' && deprecated === 'true') meta.deprecated = true;
        }

        if (javaType) meta.schemaType = javaType;

        // Extract constraint metadata from validation/schema annotations
        if (allAnnotations) {
            this.extractConstraintAnnotations(meta, allAnnotations);
        }

        return meta;
    }

    /**
     * Extract constraint metadata from Java validation annotations on a parameter.
     * Handles @Schema, @Pattern, @Size, @Min, @Max, @DecimalMin, @DecimalMax,
     * @Email, @Positive, @PositiveOrZero, @Negative, @NegativeOrZero, @NotNull, @NotBlank, @NotEmpty.
     */
    private extractConstraintAnnotations(meta: ParameterMeta, annotations: AnnotationInfo[]): void {
        for (const ann of annotations) {
            switch (ann.name) {
                case 'Schema': {
                    // @Schema(pattern=..., format=..., minimum=..., maximum=..., minLength=..., maxLength=..., allowableValues=...)
                    const pattern = this.getAnnotationAttrString(ann, 'pattern');
                    if (pattern && !meta.pattern) meta.pattern = pattern;
                    const format = this.getAnnotationAttrString(ann, 'format');
                    if (format && !meta.format) meta.format = format;
                    const minimum = this.getAnnotationAttrString(ann, 'minimum');
                    if (minimum && meta.minimum === undefined) meta.minimum = Number(minimum);
                    const maximum = this.getAnnotationAttrString(ann, 'maximum');
                    if (maximum && meta.maximum === undefined) meta.maximum = Number(maximum);
                    const minLength = this.getAnnotationAttrString(ann, 'minLength');
                    if (minLength && meta.minLength === undefined) meta.minLength = Number(minLength);
                    const maxLength = this.getAnnotationAttrString(ann, 'maxLength');
                    if (maxLength && meta.maxLength === undefined) meta.maxLength = Number(maxLength);
                    // allowableValues = { "A", "B", "C" }
                    const enumVals = ann.attributes.get('allowableValues');
                    if (Array.isArray(enumVals) && !meta.enum) {
                        meta.enum = enumVals.map(v => v.replace(/^['"]|['"]$/g, '')).filter(Boolean);
                    }
                    break;
                }
                case 'Pattern': {
                    // @Pattern(regexp="...")
                    const regexp = this.getAnnotationAttrString(ann, 'regexp');
                    if (regexp && !meta.pattern) meta.pattern = regexp;
                    break;
                }
                case 'Size': {
                    // @Size(min=..., max=...)
                    const sizeMin = this.getAnnotationAttrString(ann, 'min');
                    if (sizeMin && meta.minLength === undefined) meta.minLength = Number(sizeMin);
                    const sizeMax = this.getAnnotationAttrString(ann, 'max');
                    if (sizeMax && meta.maxLength === undefined) meta.maxLength = Number(sizeMax);
                    break;
                }
                case 'Min': {
                    // @Min(value) or @Min(123)
                    const val = this.getAnnotationAttrString(ann, 'value') || this.getAnnotationStringValue(ann);
                    if (val && meta.minimum === undefined) meta.minimum = Number(val);
                    break;
                }
                case 'Max': {
                    // @Max(value) or @Max(999)
                    const val = this.getAnnotationAttrString(ann, 'value') || this.getAnnotationStringValue(ann);
                    if (val && meta.maximum === undefined) meta.maximum = Number(val);
                    break;
                }
                case 'DecimalMin': {
                    const val = this.getAnnotationAttrString(ann, 'value') || this.getAnnotationStringValue(ann);
                    const inclusive = this.getAnnotationAttrString(ann, 'inclusive');
                    if (val) {
                        if (inclusive === 'false') {
                            if (meta.exclusiveMinimum === undefined) meta.exclusiveMinimum = Number(val);
                        } else {
                            if (meta.minimum === undefined) meta.minimum = Number(val);
                        }
                    }
                    break;
                }
                case 'DecimalMax': {
                    const val = this.getAnnotationAttrString(ann, 'value') || this.getAnnotationStringValue(ann);
                    const inclusive = this.getAnnotationAttrString(ann, 'inclusive');
                    if (val) {
                        if (inclusive === 'false') {
                            if (meta.exclusiveMaximum === undefined) meta.exclusiveMaximum = Number(val);
                        } else {
                            if (meta.maximum === undefined) meta.maximum = Number(val);
                        }
                    }
                    break;
                }
                case 'Email': {
                    if (!meta.format) meta.format = 'email';
                    break;
                }
                case 'Positive': {
                    if (meta.exclusiveMinimum === undefined) meta.exclusiveMinimum = 0;
                    break;
                }
                case 'PositiveOrZero': {
                    if (meta.minimum === undefined) meta.minimum = 0;
                    break;
                }
                case 'Negative': {
                    if (meta.exclusiveMaximum === undefined) meta.exclusiveMaximum = 0;
                    break;
                }
                case 'NegativeOrZero': {
                    if (meta.maximum === undefined) meta.maximum = 0;
                    break;
                }
                case 'NotNull':
                case 'NotBlank':
                case 'NotEmpty': {
                    if (meta.required === undefined) meta.required = true;
                    break;
                }
            }
        }
    }

    /**
     * Get the string value from an annotation's "value" attribute, stripping quotes.
     */
    private getAnnotationStringValue(ann: AnnotationInfo): string {
        const val = ann.attributes.get('value');
        if (typeof val === 'string') {
            return val.replace(/^['"]|['"]$/g, '');
        }
        return '';
    }

    /**
     * Extract a type name from an unannType CST node.
     *
     * unannType → unannReferenceType → unannClassOrInterfaceType → unannClassType → Identifier
     * unannType → unannPrimitiveTypeWithOptionalDimsSuffix → ...
     */
    private extractUnannTypeName(unannType: any): string {
        const tokens = this.collectTokens(unannType);
        // Filter out dimension brackets for cleaner output
        return tokens.map((t: any) => t.image).join('');
    }

    private collectAnnotationsFromModifiers(modifiers: any[]): AnnotationInfo[] {
        const result: AnnotationInfo[] = [];
        for (const mod of modifiers) {
            const ann = mod.children?.annotation;
            if (!ann) continue;
            const ctx = ann[0].children;
            const typeName = ctx.typeName[0].children.Identifier[0].image;
            const attributes = new Map<string, string | string[]>();

            if (ctx.elementValuePairList) {
                const pairs = ctx.elementValuePairList[0].children.elementValuePair;
                for (const pair of pairs) {
                    const key = pair.children.Identifier[0].image;
                    const value = this.extractElementValue(pair.children.elementValue[0]);
                    if (value !== undefined) attributes.set(key, value);
                }
            } else if (ctx.elementValue) {
                const value = this.extractElementValue(ctx.elementValue[0]);
                if (value !== undefined) attributes.set('value', value);
            }

            result.push({ name: typeName, attributes });
        }
        return result;
    }

    private extractTypeName(typeType: any): string {
        if (!typeType) return '';
        if (typeType.primitiveType) {
            return typeType.primitiveType[0].children?.literal?.[0]?.image || '';
        }
        if (typeType.classOrInterfaceType) {
            const classType = typeType.classOrInterfaceType[0];
            let name = '';
            const identifiers = classType.Identifier || [];
            for (let i = 0; i < identifiers.length; i++) {
                if (i > 0) name += '.';
                name += identifiers[i].image;
            }
            const typeArgs = classType.typeArguments?.[0]?.typeArgument;
            if (typeArgs) {
                name += '<';
                name += typeArgs.map((ta: any) => {
                    if (ta.typeType) return this.extractTypeName(ta.typeType[0]);
                    return '?';
                }).join(',');
                name += '>';
            }
            return name;
        }
        if (typeType.typeType && typeType.dims) {
            const base = this.extractTypeName(typeType.typeType[0]);
            const dimCount = typeType.dims.length;
            return base + '[]'.repeat(dimCount);
        }
        return '';
    }
}
