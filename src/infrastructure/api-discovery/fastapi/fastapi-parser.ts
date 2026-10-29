/**
 * FastAPI source parser — line-oriented, pure JS, no runtime deps.
 *
 * FastAPI's decorator syntax is extremely regular, so we parse it with a
 * balance-aware line walker instead of a heavyweight Python parser:
 *
 *  - `app = FastAPI(...)` / `router = APIRouter(prefix=...)` object detection
 *  - `@<obj>.<method>(...)` decorators (get/post/put/patch/delete/options/head,
 *    plus `api_route` with explicit methods)
 *  - path params from `{name}` braces, function-signature param locations via
 *    `Path/Query/Header/Cookie/Body/File/Form(...)` wrappers
 *  - Pydantic `class X(BaseModel)` → JSON Schema
 *  - `include_router(router, prefix=...)` prefix resolution (project-wide)
 *
 * Determinism: endpoints are emitted in file-scan order; the provider sorts.
 * Trust floor: paths built from f-strings/expressions or with an unresolvable
 * router prefix are marked `confidence: 'low'` by the provider.
 */

import * as fs from 'fs';
import * as path from 'path';
import { JsonSchema } from '../types';

export type ParamLocation = 'path' | 'query' | 'header' | 'cookie' | 'body' | 'form';

export interface FastApiModelField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface FastApiModel {
  name: string;
  fields: FastApiModelField[];
}

export interface FastApiParam {
  name: string;
  location: ParamLocation;
  type: string;
  required: boolean;
}

export interface FastApiEndpoint {
  methods: string[];
  path: string;
  file: string;
  line: number;
  functionName: string;
  statusCode?: number;
  responseModel?: string;
  tags?: string[];
  deprecated?: boolean;
  summary?: string;
  params: FastApiParam[];
  security: string[];
  /** True when the decorator path is an f-string / expression that cannot be trusted. */
  pathUnresolved: boolean;
}export interface FastApiParseResult {
  endpoints: FastApiEndpoint[];
  models: Map<string, FastApiModel>;
  warnings: string[];
}

const PYTHON_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  'site-packages',
  '.mypy_cache',
  '.pytest_cache',
  '.tox',
  'dist',
  'build',
  'out',
]);

const HTTP_METHODS: Record<string, string> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
  options: 'OPTIONS',
  head: 'HEAD',
};

const SKIP_INJECTION_TYPES = new Set([
  'Request',
  'Response',
  'WebSocket',
  'BackgroundTasks',
  'Depends',
  'Header',
  'Cookie',
]);

export function collectPythonFiles(projectRoot: string): string[] {
  const files: string[] = [];
  const queue = [projectRoot];

  while (queue.length > 0) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!PYTHON_SKIP_DIRS.has(entry.name)) {
          queue.push(fullPath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (fullPath.endsWith('.py')) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

interface RawDecorator {
  object: string;
  method: string;
  args: string;
  line: number;
  unresolved: boolean;
}

interface RawRoute {
  decorators: RawDecorator[];
  functionName: string;
  signature: string;
  line: number;
}

interface RouterDef {
  name: string;
  constructorPrefix: string;
}

interface IncludeCall {
  object: string;
  routerName: string;
  prefix: string;
  tags?: string[];
  line: number;
}

interface ImportAlias {
  alias: string;
  target: string;
}

interface FileParse {
  routes: RawRoute[];
  appNames: Set<string>;
  routers: RouterDef[];
  includes: IncludeCall[];
  imports: ImportAlias[];
}

export function parseFastApiProject(projectRoot: string): FastApiParseResult {
  const files = collectPythonFiles(projectRoot);
  const models = new Map<string, FastApiModel>();
  const fileParses = new Map<string, FileParse>();
  const routerDefs = new Map<string, RouterDef>();
  const warnings: string[] = [];

  for (const file of files) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const parsed = parseFile(text, file, models);
    fileParses.set(file, parsed);
    for (const router of parsed.routers) {
      if (!routerDefs.has(router.name)) {
        routerDefs.set(router.name, router);
      }
    }
  }

  // Each router can be included multiple times (under different prefixes) —
  // each inclusion mounts the router's full route set, so every route yields
  // one endpoint PER include, each with its own composed path.
  const mountPrefixes = new Map<string, string[]>();
  for (const def of routerDefs.values()) {
    mountPrefixes.set(def.name, [def.constructorPrefix]);
  }
  const routerTags = new Map<string, string[]>();
  const routerHasPrefixedInclude = new Set<string>();
  for (const parsed of fileParses.values()) {
    for (const inc of parsed.includes) {
      const resolved = resolveAlias(parsed.imports, inc.routerName);
      if (!routerDefs.has(resolved)) {
        warnings.push(`include_router references unknown router '${inc.routerName}' at ${inc.line}`);
        continue;
      }
      const def = routerDefs.get(resolved)!;
      // include prefix is OUTER (mounts the router), router prefix is INNER.
      // A router with N prefixed includes gets N composed mount paths; those
      // REPLACE the bare constructor-only mount (which is not addressable once
      // the router is only mounted under a prefix).
      if (inc.prefix) {
        routerHasPrefixedInclude.add(resolved);
        const existing = mountPrefixes.get(resolved)!;
        const composed = `${inc.prefix.replace(/\/+$/, '')}/${def.constructorPrefix.replace(/^\/+/, '')}`;
        if (!existing.includes(composed)) {
          existing.push(composed);
        }
      }
      if (inc.tags && inc.tags.length > 0) {
        routerTags.set(resolved, [...(routerTags.get(resolved) ?? []), ...inc.tags]);
      }
    }
  }

  const endpoints: FastApiEndpoint[] = [];
  for (const [file, parsed] of fileParses.entries()) {
    for (const route of parsed.routes) {
      for (const decorator of route.decorators) {
        const resolvedObject = resolveAlias(parsed.imports, decorator.object);
        const isApp = parsed.appNames.has(decorator.object) || parsed.appNames.has(resolvedObject);
        const router = routerDefs.get(resolvedObject);
        if (!isApp && !router) {
          continue;
        }

        const methods = extractMethods(decorator.method, decorator.args);
        if (methods.length === 0) {
          continue;
        }

        const basePathExpr = extractPath(decorator.args);
        const unresolved = decorator.unresolved || basePathExpr.startsWith('f');

        // Compose one endpoint per mount path (router includes × constructor prefix).
        const mounts = router ? mountPrefixes.get(resolvedObject) ?? [router.constructorPrefix] : [''];

        for (const mountPrefix of mounts) {
          // When a router is only mounted under a non-empty include prefix, the
          // bare constructor-only mount is NOT addressable — the composed
          // include paths fully replace it. Skip the stale entry.
          if (router && routerHasPrefixedInclude.has(resolvedObject) && mountPrefix === router.constructorPrefix) {
            continue;
          }
          const pathExpr = router ? joinPaths(mountPrefix, basePathExpr) : basePathExpr;

          const paramInfo = extractParams(route.signature, extractPathParams(pathExpr));
          const includeTags = router ? routerTags.get(resolvedObject) : undefined;
          const routeTags = extractTags(decorator.args);
          const tags = routeTags ?? includeTags;

          endpoints.push({
            methods,
            path: pathExpr,
            file,
            line: decorator.line,
            functionName: route.functionName,
            statusCode: extractStatusCode(decorator.args),
            responseModel: extractResponseModel(decorator.args) ?? extractReturnType(route.signature),
            tags,
            deprecated: extractDeprecated(decorator.args),
            summary: extractSummary(decorator.args),
            params: paramInfo.params,
            security: extractSecurity(decorator.args, route.signature),
            pathUnresolved: unresolved,
          });
        }
      }
    }
  }

  return { endpoints, models, warnings };
}

function resolveAlias(imports: ImportAlias[], name: string): string {
  const match = imports.find((imp) => imp.alias === name);
  return match ? match.target : name;
}

export function buildJsonSchema(typeText: string, models: Map<string, FastApiModel>): JsonSchema | undefined {
  const t = typeText.trim();
  if (!t || t === 'None') {
    return undefined;
  }

  const optionalMatch = /^(?:Optional|Union)\[([^\]]*)\](?:\s*\|\s*None)?$/.exec(t)
    || /^(.+?)(?:\s*\|\s*None)+$/.exec(t);
  if (optionalMatch) {
    return buildJsonSchema(optionalMatch[1], models);
  }

  const unionMatch = /^Union\[(.+)\]$/.exec(t);
  if (unionMatch) {
    const inner = unionMatch[1].split(',').map((s) => s.trim())[0];
    return buildJsonSchema(inner, models);
  }

  const listMatch = /^(?:List|list|Sequence)\[(.+)\]$/.exec(t);
  if (listMatch) {
    const items = buildJsonSchema(listMatch[1], models) ?? { type: 'object' };
    return { type: 'array', items };
  }

  const dictMatch = /^(?:Dict|dict)\[([^,]+),\s*(.+)\]$/.exec(t);
  if (dictMatch) {
    return { type: 'object', additionalProperties: buildJsonSchema(dictMatch[2], models) ?? {} };
  }

  const scalar: Record<string, JsonSchema> = {
    int: { type: 'integer' },
    float: { type: 'number' },
    Decimal: { type: 'number' },
    bool: { type: 'boolean' },
    str: { type: 'string' },
    datetime: { type: 'string', format: 'date-time' },
    date: { type: 'string', format: 'date' },
    time: { type: 'string', format: 'time' },
    UUID: { type: 'string', format: 'uuid' },
    bytes: { type: 'string', format: 'binary' },
    UploadFile: { type: 'string', format: 'binary' },
  };
  if (t in scalar) {
    return { ...scalar[t] };
  }

  const model = models.get(t);
  if (model) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const field of model.fields) {
      const schema = buildJsonSchema(field.type, models) ?? { type: 'string' };
      properties[field.name] = field.description ? { ...schema, description: field.description } : schema;
      if (field.required) {
        required.push(field.name);
      }
    }
    const result: JsonSchema = { type: 'object', properties };
    if (required.length > 0) {
      result.required = required;
    }
    return result;
  }

  return { type: 'object' };
}

// ─── Per-file parsing ─────────────────────────────────────────────────────────

function parseFile(text: string, file: string, models: Map<string, FastApiModel>): FileParse {
  const result: FileParse = {
    routes: [],
    appNames: new Set(),
    routers: [],
    includes: [],
    imports: [],
  };

  const stripped = stripComments(text);
  const lines = stripped.split(/\r?\n/);
  let pendingDecorators: RawDecorator[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const lineNo = i + 1;
    const trimmed = rawLine.trim();
    i += 1;

    if (trimmed === '') {
      continue;
    }

    const importMatch = /^from\s+[\w.]+(?:\s+import\s+(.+))?$/.exec(trimmed)
      || /^import\s+([\w.,\s]+)$/.exec(trimmed);
    if (importMatch) {
      const targets = importMatch[1] ?? '';
      for (const item of targets.split(',')) {
        const part = item.trim();
        if (!part) continue;
        const asMatch = /^([\w.]+)\s+as\s+(\w+)$/.exec(part);
        if (asMatch) {
          result.imports.push({ alias: asMatch[2], target: asMatch[1].split('.').pop()! });
        } else if (/^[\w.]+$/.test(part)) {
          const name = part.split('.').pop()!;
          result.imports.push({ alias: name, target: name });
        }
      }
      pendingDecorators = [];
      continue;
    }

    if (trimmed.startsWith('@')) {
      const { joined, nextIndex } = consumeBalanced(lines, i - 1);
      const decorator = parseDecorator(joined, lineNo);
      if (decorator) {
        pendingDecorators.push(decorator);
      }
      i = nextIndex + 1;
      continue;
    }

    const defMatch = /^(?:async\s+)?def\s+(\w+)\s*\(/.exec(trimmed);
    if (defMatch) {
      const { joined, nextIndex } = consumeBalanced(lines, i - 1);
      const sig = joined.slice(joined.indexOf('('));
      const signature = consumeBalancedSignature(lines, i - 1, sig);
      if (pendingDecorators.length > 0) {
        result.routes.push({
          decorators: pendingDecorators,
          functionName: defMatch[1],
          signature,
          line: lineNo,
        });
      }
      pendingDecorators = [];
      i = nextIndex + 1;
      continue;
    }

    const classMatch = /^class\s+(\w+)\s*\(\s*(\w+)\s*\)\s*:/.exec(trimmed);
    if (classMatch && (classMatch[2] === 'BaseModel' || classMatch[2].endsWith('BaseModel'))) {
      const { nextIndex, fields } = parseModelFields(lines, i);
      models.set(classMatch[1], { name: classMatch[1], fields });
      i = nextIndex;
      pendingDecorators = [];
      continue;
    }

    const appMatch = /^(\w+)\s*=\s*(?:fastapi\.)?FastAPI\(/.exec(trimmed);
    if (appMatch) {
      result.appNames.add(appMatch[1]);
      pendingDecorators = [];
      continue;
    }

    const routerMatch = /^(\w+)\s*=\s*(?:fastapi\.)?APIRouter\((.*)$/.exec(trimmed);
    if (routerMatch) {
      const { joined } = consumeBalanced(lines, i - 1);
      const args = joined.slice(joined.indexOf('('));
      result.routers.push({
        name: routerMatch[1],
        constructorPrefix: extractPrefix(args),
      });
      pendingDecorators = [];
      continue;
    }

    const includeMatch = /^(\w+)\.include_router\(\s*(\w+)(.*)$/.exec(trimmed);
    if (includeMatch) {
      const { joined } = consumeBalanced(lines, i - 1);
      const args = joined.slice(joined.indexOf('('));
      result.includes.push({
        object: includeMatch[1],
        routerName: includeMatch[2],
        prefix: extractPrefix(args),
        tags: extractTags(args),
        line: lineNo,
      });
      pendingDecorators = [];
      continue;
    }

    pendingDecorators = [];
  }

  return result;
}

function parseModelFields(lines: string[], startIdx: number): { nextIndex: number; fields: FastApiModelField[] } {
  const fields: FastApiModelField[] = [];
  let i = startIdx;
  const classIndent = (lines[startIdx - 1] || '').match(/^(\s*)/)![1].length;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const indent = line.match(/^(\s*)/)![1].length;
    if (indent <= classIndent) {
      break;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      i += 1;
      continue;
    }

    const fieldMatch = /^([A-Za-z_]\w*)\s*:\s*(.+?)\s*(?:=\s*(.*))?$/.exec(trimmed);
    if (fieldMatch && !trimmed.startsWith('def ') && !trimmed.startsWith('class ')) {
      const rawType = fieldMatch[2].replace(/,\s*$/, '');
      const defaultVal = (fieldMatch[3] ?? '').trim();
      const optional = /^Optional\[/.test(rawType) || /None\s*\|/.test(rawType)
        || defaultVal === 'None' || defaultVal.startsWith('None')
        || (defaultVal !== '' && !defaultVal.startsWith('Field('));
      let description: string | undefined;
      const fieldMatch2 = /Field\(([^)]*)\)/.exec(trimmed);
      if (fieldMatch2) {
        const descMatch = /description\s*=\s*["']([^"']+)["']/.exec(fieldMatch2[1]);
        if (descMatch) description = descMatch[1];
      }
      fields.push({
        name: fieldMatch[1],
        type: rawType,
        required: !optional,
        description,
      });
    }
    i += 1;
  }

  return { nextIndex: i, fields };
}

function consumeBalanced(lines: string[], startIdx: number): { joined: string; nextIndex: number } {
  let depth = 0;
  let joined = lines[startIdx] ?? '';
  let idx = startIdx;
  let inString: string | null = null;

  const scan = (text: string): void => {
    for (const ch of text) {
      if (inString) {
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '"' || ch === "'") inString = ch;
      else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    }
  };

  scan(joined);
  while (depth > 0 && idx + 1 < lines.length) {
    idx += 1;
    const line = lines[idx];
    scan(line);
    joined += '\n' + line;
  }

  return { joined, nextIndex: idx };
}

function consumeBalancedSignature(lines: string[], startIdx: number, initial: string): string {
  let depth = 0;
  let inString: string | null = null;
  let signature = initial;
  let idx = startIdx;

  const scan = (text: string): void => {
    for (const ch of text) {
      if (inString) {
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '"' || ch === "'") inString = ch;
      else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    }
  };

  scan(initial);
  while (depth > 0 && idx + 1 < lines.length) {
    idx += 1;
    const line = lines[idx];
    scan(line);
    signature += '\n' + line;
  }

  // The header may end on the same line as the closing paren (single-line def).
  const ownColon = findTopLevelColon(signature);
  if (ownColon !== -1) {
    return signature.slice(0, ownColon);
  }

  // Otherwise scan forward to the header colon so the `-> ReturnType`
  // annotation is captured (it precedes the final ':').
  while (idx + 1 < lines.length) {
    idx += 1;
    const line = lines[idx];
    const colon = findTopLevelColon(line);
    if (colon !== -1) {
      signature += '\n' + line.slice(0, colon);
      break;
    }
    signature += '\n' + line;
  }

  return signature;
}

/** Find the index of the first colon that is not inside brackets/quotes. */
function findTopLevelColon(text: string): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      continue;
    }
    if (ch === ':' && depth === 0) {
      return i;
    }
  }
  return -1;
}

function extractReturnType(signature: string): string | undefined {
  const match = /->\s*([^:\n]+?)\s*$/.exec(signature.trim());
  return match ? match[1].trim() : undefined;
}

function parseDecorator(text: string, line: number): RawDecorator | null {
  const match = /^@([\w.]+)\.(\w+)\((.*)\)$/s.exec(text.trim());
  if (!match) {
    return null;
  }
  const object = match[1].split('.')[0];
  const method = match[2];
  return { object, method, args: match[3] ?? '', line, unresolved: match[1].includes('.') && match[1].split('.').length > 2 };
}

// ─── Arg / value extraction ───────────────────────────────────────────────────

function extractMethods(method: string, args: string): string[] {
  if (method === 'api_route') {
    const methodsMatch = /methods\s*=\s*\[([^\]]*)\]/.exec(args);
    if (methodsMatch) {
      const quoted = [...methodsMatch[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1].toUpperCase());
      return quoted.length > 0 ? quoted : ['GET'];
    }
    return ['GET'];
  }
  if (method === 'route') {
    return [];
  }
  const upper = HTTP_METHODS[method.toLowerCase()];
  return upper ? [upper] : [];
}

function extractPath(args: string): string {
  // Match an optional string prefix (f/r/b) + quote, then the literal body.
  // f-strings keep a leading 'f' marker so callers can flag them unresolved.
  const matchPath = (re: RegExp): string | undefined => {
    const m = re.exec(args);
    if (!m) return undefined;
    const prefix = m[1].length > 1 ? m[1][0] : '';
    const isF = prefix === 'f' || prefix === 'F';
    return isF ? `f${m[2]}` : m[2];
  };

  const named = matchPath(/(?:path|url)\s*=\s*([fFrRbB]?["'])([^"']+)["']/);
  if (named !== undefined) return named;
  const bare = matchPath(/^\s*([fFrRbB]?["'])([^"']+)["']/);
  if (bare !== undefined) return bare;
  const quoted = /["']([^"']+)["']/.exec(args);
  return quoted ? quoted[1] : '';
}

function extractStatusCode(args: string): number | undefined {
  const match = /status_code\s*=\s*(\d+)/.exec(args);
  return match ? parseInt(match[1], 10) : undefined;
}

function extractResponseModel(args: string): string | undefined {
  const match = /response_model\s*=\s*([^\s,]+)/.exec(args);
  return match ? match[1] : undefined;
}

function extractTags(args: string): string[] | undefined {
  const match = /tags\s*=\s*\[([^\]]*)\]/.exec(args);
  if (!match) {
    return undefined;
  }
  const quoted = [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  return quoted.length > 0 ? quoted : undefined;
}

function extractDeprecated(args: string): boolean | undefined {
  return /deprecated\s*=\s*True/.test(args) ? true : undefined;
}

function extractSummary(args: string): string | undefined {
  const match = /summary\s*=\s*["']([^"']+)["']/.exec(args);
  return match ? match[1] : undefined;
}

function extractSecurity(args: string, signature: string): string[] {
  const security: string[] = [];
  const depMatch = /dependencies\s*=\s*\[([^\]]*)\]/.exec(args);
  if (depMatch) {
    for (const dep of depMatch[1].split(',')) {
      const name = /Depends\(([^)]+)\)/.exec(dep);
      if (name) security.push(name[1].trim());
    }
  }
  const securityParam = /:\s*Security\(([^)]+)\)/.exec(signature);
  if (securityParam) security.push(securityParam[1].trim());
  return security;
}

function extractPrefix(args: string): string {
  const match = /prefix\s*=\s*["']([^"']+)["']/.exec(args);
  return match ? match[1] : '';
}

function extractPathParams(pathExpr: string): string[] {
  const names: string[] = [];
  const re = /\{([^}:]+)(?::[^}]+)?\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pathExpr)) !== null) {
    names.push(m[1]);
  }
  return names;
}

function joinPaths(prefix: string, routePath: string): string {
  if (!routePath) {
    return prefix || '/';
  }
  if (!prefix) {
    return routePath.startsWith('/') ? routePath : '/' + routePath;
  }
  return `${prefix.replace(/\/+$/, '')}/${routePath.replace(/^\/+/, '')}`;
}

// ─── Function signature → params ──────────────────────────────────────────────

interface ParamExtract {
  params: FastApiParam[];
}

function extractParams(signature: string, pathParamNames: string[]): ParamExtract {
  const params: FastApiParam[] = [];
  const pathParamSet = new Set(pathParamNames);

  const openParen = signature.indexOf('(');
  const closeParen = signature.lastIndexOf(')');
  if (openParen === -1 || closeParen === -1) {
    return { params };
  }
  const inner = signature.slice(openParen + 1, closeParen);
  const parts = splitTopLevel(inner, ',');

  for (const partRaw of parts) {
    const part = partRaw.trim();
    if (!part) continue;

    const defaultMatch = /^([A-Za-z_]\w*)\s*(?::\s*([^=\n]+))?(?:\s*=\s*(.*))?$/s.exec(part);
    if (!defaultMatch) continue;
    const name = defaultMatch[1];
    const typeText = (defaultMatch[2] ?? '').trim();
    const defaultVal = (defaultMatch[3] ?? '').trim();

    if (SKIP_INJECTION_TYPES.has(name)) continue;
    const baseType = /^([A-Za-z_]\w*)/.exec(typeText)?.[1] ?? '';
    if (SKIP_INJECTION_TYPES.has(baseType)) continue;
    if (/Depends\(|Security\(/.test(defaultVal)) continue;

    const wrapper = /^(Path|Query|Header|Cookie|Body|File|Form)\b/.exec(defaultVal)?.[1];

    let location: ParamLocation;
    if (wrapper === 'Path' || pathParamSet.has(name)) location = 'path';
    else if (wrapper === 'Header') location = 'header';
    else if (wrapper === 'Cookie') location = 'cookie';
    else if (wrapper === 'Body') location = 'body';
    else if (wrapper === 'File' || wrapper === 'Form' || baseType === 'UploadFile') location = 'form';
    else location = 'query';

    if (location === 'query' && pathParamSet.has(name)) {
      location = 'path';
    }

    const optional = isOptional(typeText, defaultVal);

    params.push({
      name,
      location,
      type: baseType || 'str',
      required: !optional,
    });
  }

  for (const pathName of pathParamSet) {
    if (!params.some((p) => p.name === pathName && p.location === 'path')) {
      params.push({ name: pathName, location: 'path', type: 'str', required: true });
    }
  }

  return { params };
}

// ─── Low-level text helpers ───────────────────────────────────────────────────

/** FastAPI default-wrapping semantics: required unless a real default value exists. */
function isOptional(typeText: string, defaultVal: string): boolean {
  if (/^Optional\[/.test(typeText) || /None\s*\|/.test(typeText)) {
    return true;
  }

  if (defaultVal === '') {
    return false;
  }
  if (defaultVal === 'None') {
    return true;
  }

  const wrapper = /^(Path|Query|Header|Cookie|Body|File|Form)\((.*)\)$/s.exec(defaultVal);
  if (wrapper) {
    const inner = wrapper[2].trim();
    if (inner === '' || inner.startsWith('...')) {
      return false;
    }
    if (inner.startsWith('None') || /default\s*=\s*None\b/.test(inner)) {
      return true;
    }
    return true;
  }

  return true;
}

function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString: string | null = null;
  let current = '';
  for (const ch of text) {
    if (inString) {
      current += ch;
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      current += ch;
      continue;
    }
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') {
    parts.push(current);
  }
  return parts;
}

function stripComments(text: string): string {
  const lines = text.split(/\r?\n/);
  return lines.map((line) => {
    let inString: string | null = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inString) {
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '"' || ch === "'") inString = ch;
      else if (ch === '#' && (i === 0 || line[i - 1] !== '\\')) {
        return line.slice(0, i);
      }
    }
    return line;
  }).join('\n');
}
