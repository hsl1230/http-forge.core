/**
 * OpenAPI export — pure mapping helpers.
 *
 * Stateless functions shared by the operation builder (URL normalization,
 * type/example coercion, request body parsing, key-value params, cookie
 * parsing, operation-id casing). Kept free of class state so they are trivial
 * to unit-test and reuse.
 */

import type { CollectionRequestItem } from '../../types/collection';
import type { JSONSchema7, KeyValueEntry, PathParamEntry } from '../../types/types';

export interface OpenApiExportOptions {
    format: 'json' | 'yaml';
    /** Environment name(s) to use for server URL resolution */
    environments?: string[];
    /** Include inferred response schemas from history */
    inferFromHistory?: boolean;
    /** OpenAPI info metadata overrides */
    info?: { title?: string; version?: string; description?: string };
}

/** Headers excluded from 'in: header' parameters on export */
export const EXCLUDED_HEADERS = new Set([
    'content-type', 'authorization', 'accept', 'cookie',
    'host', 'content-length'
]);

/** Normalize a collection request URL into an OpenAPI path + optional host var. */
export function normalizeUrl(url: string): { path: string; hostVar: string | null } {
    let normalized = url;
    let hostVar: string | null = null;

    // Strip any leading host variable: {{varName}} that forms the entire host prefix
    // (covers {{baseUrl}}, {{dcqHost}}, {{BASE_URL}}, etc.)
    const hostVarMatch = normalized.match(/^\{\{(\w+)\}\}/);
    if (hostVarMatch) {
        hostVar = hostVarMatch[1];
        normalized = normalized.slice(hostVarMatch[0].length);
    }

    // Convert :param to {param}
    normalized = normalized.replace(/:([a-zA-Z_]\w*)/g, '{$1}');

    // Convert remaining inline {{variable}} to {variable} (path-level vars)
    normalized = normalized.replace(/\{\{(\w+)\}\}/g, '{$1}');

    // Ensure starts with /
    if (!normalized.startsWith('/')) {
        normalized = '/' + normalized;
    }

    // Remove trailing slash (unless it's just "/")
    if (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }

    // Remove any double slashes
    normalized = normalized.replace(/\/\//g, '/');

    return { path: normalized, hostVar };
}

/** Infer a JSON schema type from a primitive string value. */
export function inferTypeFromValue(value: string): string {
    if (/^-?\d+$/.test(value)) { return 'integer'; }
    if (/^-?\d+\.\d+$/.test(value)) { return 'number'; }
    if (value === 'true' || value === 'false') { return 'boolean'; }
    return 'string';
}

/** Widen the numeric type pair 'integer'/'number' to 'number'. Returns 'number' or undefined. */
export function widenNumericType(a: string | undefined, b: string | undefined): string | undefined {
    if ((a === 'integer' && b === 'number') || (a === 'number' && b === 'integer')) {
        return 'number';
    }
    return undefined;
}

/** Replace {{varName}} placeholders with <varName> so they don't appear raw in examples. */
export function sanitizeEnvVar(value: string): string {
    return value.replace(/\{\{(\w+)\}\}/g, '<$1>');
}

/**
 * Coerce a string value to the appropriate JS type for the 'example' field.
 * Sanitizes {{varName}} placeholders to <varName> before coercion.
 */
export function coerceExample(value: string, type: string): any {
    const sanitized = sanitizeEnvVar(value);
    switch (type) {
        case 'integer': return parseInt(sanitized, 10) || sanitized;
        case 'number': return parseFloat(sanitized) || sanitized;
        case 'boolean': return sanitized === 'true';
        default: return sanitized;
    }
}

/** Recursively sanitize {{varName}} placeholders in string values of a parsed example object. */
export function sanitizeObjectExamples(value: any): any {
    if (typeof value === 'string') {
        return sanitizeEnvVar(value);
    }
    if (Array.isArray(value)) {
        return value.map(item => sanitizeObjectExamples(item));
    }
    if (value !== null && typeof value === 'object') {
        const result: any = {};
        for (const [k, v] of Object.entries(value)) {
            result[k] = sanitizeObjectExamples(v);
        }
        return result;
    }
    return value;
}

/** Try to parse a request body's content into structured data (sanitized). */
export function tryParseBodyContent(body: any): any {
    if (!body || !body.content) { return undefined; }
    let parsed: any;
    if (typeof body.content === 'string') {
        try { parsed = JSON.parse(body.content); } catch { parsed = body.content; }
    } else {
        parsed = body.content;
    }
    return sanitizeObjectExamples(parsed);
}

/** Map a request body's type/format to an OpenAPI content type. */
export function getContentType(body: any): string {
    if (!body) { return 'application/json'; }

    switch (body.type) {
        case 'raw':
            switch (body.format) {
                case 'json': return 'application/json';
                case 'xml': return 'application/xml';
                case 'html': return 'text/html';
                case 'text': return 'text/plain';
                default: return 'text/plain';
            }
        case 'form-data': return 'multipart/form-data';
        case 'x-www-form-urlencoded': return 'application/x-www-form-urlencoded';
        case 'binary': return 'application/octet-stream';
        case 'graphql': return 'application/json';
        default: return 'application/json';
    }
}

/** Build an object schema from form-data / urlencoded entries. */
export function buildFormDataSchemaFromBody(body: any): JSONSchema7 {
    const schema: JSONSchema7 = { type: 'object', properties: {} };
    const entries = body.formData || body.urlencoded || [];

    for (const entry of entries) {
        if (entry.enabled === false) { continue; }
        if (entry.type === 'file') {
            schema.properties[entry.key] = { type: 'string', format: 'binary' };
        } else {
            schema.properties[entry.key] = { type: 'string' };
        }
    }

    return schema;
}

/** Build a query/header parameter object from a key-value entry. */
export function buildKeyValueParam(entry: KeyValueEntry, location: 'query' | 'header'): any {
    const param: any = {
        name: entry.key,
        in: location,
        schema: {} as any
    };

    if (entry.oneOf) {
        // Preserve oneOf from merged imports
        param.schema.oneOf = entry.oneOf;
        if (entry.type) { param.schema.type = entry.type; }
    } else {
        param.schema.type = entry.type || 'string';
        if (entry.format) { param.schema.format = entry.format; }
        if (entry.enum) { param.schema.enum = entry.enum; }
        if (entry.pattern) { param.schema.pattern = entry.pattern; }
        if (entry.minimum !== undefined) { param.schema.minimum = entry.minimum; }
        if (entry.maximum !== undefined) { param.schema.maximum = entry.maximum; }
        if (entry.exclusiveMinimum !== undefined) { param.schema.exclusiveMinimum = entry.exclusiveMinimum; }
        if (entry.exclusiveMaximum !== undefined) { param.schema.exclusiveMaximum = entry.exclusiveMaximum; }
        if (entry.multipleOf !== undefined) { param.schema.multipleOf = entry.multipleOf; }
        if (entry.minLength !== undefined) { param.schema.minLength = entry.minLength; }
        if (entry.maxLength !== undefined) { param.schema.maxLength = entry.maxLength; }
        if (entry.minItems !== undefined) { param.schema.minItems = entry.minItems; }
        if (entry.maxItems !== undefined) { param.schema.maxItems = entry.maxItems; }
        if (entry.uniqueItems) { param.schema.uniqueItems = true; }
        if (entry.nullable) { param.schema.nullable = true; }
    }

    if (entry.required) { param.required = true; }
    if (entry.description) { param.description = entry.description; }
    if (entry.deprecated) { param.deprecated = true; }

    // Add example from value
    if (entry.value) {
        param.example = coerceExample(entry.value, param.schema.type || 'string');
    }

    return param;
}

/** Parse a Cookie header value into individual in:cookie parameters. */
export function parseCookieHeader(value: string): any[] {
    const params: any[] = [];
    const pairs = value.split(';').map(s => s.trim()).filter(Boolean);

    for (const pair of pairs) {
        const eqIndex = pair.indexOf('=');
        if (eqIndex > 0) {
            const name = pair.substring(0, eqIndex).trim();
            const val = pair.substring(eqIndex + 1).trim();
            params.push({
                name,
                in: 'cookie',
                schema: { type: 'string' },
                example: val
            });
        }
    }

    return params;
}

/** Build an OpenAPI path/query/header/cookie parameter list from a request. */
export function buildParameters(request: CollectionRequestItem): any[] {
    const parameters: any[] = [];

    // Path parameters
    if (request.params) {
        for (const [name, value] of Object.entries(request.params)) {
            const param: any = {
                name,
                in: 'path',
                required: true // Path params are always required
            };

            if (typeof value === 'string') {
                // Simple string param — infer type from value
                param.schema = { type: inferTypeFromValue(value) };
                param.example = coerceExample(value, param.schema.type);
            } else {
                // PathParamEntry with metadata
                const entry = value as PathParamEntry;
                if (entry.oneOf) {
                    // Preserve oneOf from merged imports
                    param.schema = { oneOf: entry.oneOf };
                    if (entry.type) { param.schema.type = entry.type; }
                } else {
                    param.schema = { type: entry.type || inferTypeFromValue(entry.value) };
                    if (entry.format) { param.schema.format = entry.format; }
                    if (entry.enum) { param.schema.enum = entry.enum; }
                    if (entry.pattern) { param.schema.pattern = entry.pattern; }
                    if (entry.minimum !== undefined) { param.schema.minimum = entry.minimum; }
                    if (entry.maximum !== undefined) { param.schema.maximum = entry.maximum; }
                    if (entry.exclusiveMinimum !== undefined) { param.schema.exclusiveMinimum = entry.exclusiveMinimum; }
                    if (entry.exclusiveMaximum !== undefined) { param.schema.exclusiveMaximum = entry.exclusiveMaximum; }
                    if (entry.multipleOf !== undefined) { param.schema.multipleOf = entry.multipleOf; }
                    if (entry.minLength !== undefined) { param.schema.minLength = entry.minLength; }
                    if (entry.maxLength !== undefined) { param.schema.maxLength = entry.maxLength; }
                    if (entry.minItems !== undefined) { param.schema.minItems = entry.minItems; }
                    if (entry.maxItems !== undefined) { param.schema.maxItems = entry.maxItems; }
                    if (entry.uniqueItems) { param.schema.uniqueItems = true; }
                    if (entry.nullable) { param.schema.nullable = true; }
                }
                if (entry.description) { param.description = entry.description; }
                if (entry.deprecated) { param.deprecated = true; }
                param.example = coerceExample(entry.value, param.schema.type || 'string');
            }

            parameters.push(param);
        }
    }

    // Query parameters (include all — enabled is a UI concern, not a schema concern)
    if (request.query) {
        for (const entry of request.query) {
            if (!entry.key) { continue; }
            const param = buildKeyValueParam(entry, 'query');
            parameters.push(param);
        }
    }

    // Header parameters (with exclusion list)
    if (request.headers) {
        // First check for Cookie header → extract cookie params
        const cookieHeader = request.headers.find(
            h => h.key.toLowerCase() === 'cookie'
        );
        if (cookieHeader) {
            const cookieParams = parseCookieHeader(cookieHeader.value);
            parameters.push(...cookieParams);
        }

        for (const entry of request.headers) {
            if (!entry.key) { continue; }
            if (EXCLUDED_HEADERS.has(entry.key.toLowerCase())) { continue; }
            const param = buildKeyValueParam(entry, 'header');
            parameters.push(param);
        }
    }

    return parameters;
}

/** camelCase a request name for use as an OpenAPI operationId. */
export function toCamelCase(str: string): string {
    return str
        .replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase())
        .replace(/^[A-Z]/, c => c.toLowerCase())
        .replace(/[^a-zA-Z0-9]/g, '');
}

/** Strip a [DEPRECATED] prefix from a request name. */
export function cleanSummary(name: string): string {
    return name.replace(/^\[DEPRECATED\]\s*/i, '');
}

export function hasDeprecatedPrefix(name: string): boolean {
    return /^\[DEPRECATED\]/i.test(name);
}

/** Parse a whitespace-separated OAuth2 scope string into a scope map. */
export function parseScopes(scopeStr: string): Record<string, string> {
    const scopes: Record<string, string> = {};
    for (const scope of scopeStr.split(/\s+/)) {
        if (scope) { scopes[scope] = ''; }
    }
    return scopes;
}
