/**
 * Sensitive Data Redactor
 * 
 * Prevents tokens, passwords, credentials, and other sensitive data from being
 * persisted in history files, result files, and shared-history files.
 * 
 * Uses pattern-based auto-detection on:
 * - HTTP header names (Authorization, Cookie, Set-Cookie, etc.)
 * - URL query parameter names (token, key, secret, etc.)
 * - JSON/form body field names (password, client_secret, api_key, etc.)
 */

import { FullResponse, HistoryEntry } from '../history/history-interfaces';
import { FullResultDetails } from '../test-suite/result-storage';
import { getSecretValues } from './secret-values';

const REDACTED = '***';

/**
 * Minimum length for substring redaction. Replacing very short values globally
 * would corrupt unrelated data (e.g. the secret "1" replacing every digit).
 * Name-based redaction still applies to the containing field.
 */
const MIN_SECRET_VALUE_LENGTH = 4;

/**
 * Header names that always contain sensitive data (case-insensitive).
 * Matches exact well-known headers OR any header containing sensitive keywords.
 */
const SENSITIVE_HEADERS: RegExp = /^(authorization|proxy-authorization|www-authenticate)$|(token|cookie|secret|credential|api[_\-]?key|bearer|session[_\-]?id)/i;

/**
 * Field/variable/param names that indicate sensitive values (case-insensitive).
 * Matches any field name containing these keywords anywhere in the name.
 */
const SENSITIVE_FIELD_PATTERN: RegExp = /(password|passwd|pwd|token|cookie|secret|credential|api[_\-]?key|apikey|access[_\-]?token|refresh[_\-]?token|client[_\-]?secret|private[_\-]?key|auth[_\-]?code|bearer|session[_\-]?id|jwt)/i;

/**
 * Redact values from a headers object.
 * Returns a shallow copy with sensitive header values replaced.
 */
export function redactHeaders(headers: Record<string, string | string[]>): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (SENSITIVE_HEADERS.test(key)) {
            result[key] = Array.isArray(value) ? value.map(() => REDACTED) : REDACTED;
        } else {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Redact sensitive values from a cookie array.
 * Cookies with sensitive names have their values replaced.
 */
export function redactCookies(cookies: Array<{ name?: string; value?: string }> = []): Array<{ name?: string; value?: string }> {
    return cookies.map(cookie => {
        if (cookie && typeof cookie === 'object' && cookie.name && SENSITIVE_FIELD_PATTERN.test(cookie.name)) {
            return { ...cookie, value: REDACTED };
        }
        return cookie;
    });
}

/**
 * Redact sensitive query parameters from a URL string.
 * E.g. `?token=abc&name=foo` → `?token=[REDACTED]&name=foo`
 */
export function redactUrl(url: string): string {
    try {
        const parsed = new URL(url);
        let changed = false;
        for (const [key] of parsed.searchParams) {
            if (SENSITIVE_FIELD_PATTERN.test(key)) {
                parsed.searchParams.set(key, REDACTED);
                changed = true;
            }
        }
        return changed ? parsed.toString() : url;
    } catch {
        // Not a valid URL — return as-is
        return url;
    }
}

/**
 * Redact sensitive fields from a JSON body (object or parsed JSON).
 * Recursively walks the object and redacts values whose keys match sensitive patterns.
 */
function redactJsonObject(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map(item => redactJsonObject(item));
    if (typeof obj !== 'object') return obj;

    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
        const keySensitive = SENSITIVE_FIELD_PATTERN.test(key);
        if (value === null || typeof value !== 'object') {
            // Primitive leaf: redact only when its own key is sensitive.
            result[key] = keySensitive ? REDACTED : value;
        } else if (keySensitive && Array.isArray(value)) {
            // Sensitive key holding an array: redact primitive elements, but
            // recurse into object elements so nested non-secret fields survive.
            result[key] = value.map(item =>
                (item === null || typeof item !== 'object') ? REDACTED : redactJsonObject(item)
            );
        } else {
            // Nested object (even under a sensitive key like "credentials"):
            // recurse so only the genuinely sensitive leaves (e.g. "secret")
            // are redacted, instead of nuking the whole subtree.
            result[key] = redactJsonObject(value);
        }
    }
    return result;
}

/**
 * Redact sensitive fields from URL-encoded form body.
 * E.g. `username=admin&password=secret` → `username=admin&password=[REDACTED]`
 */
function redactFormBody(body: string): string {
    try {
        const params = new URLSearchParams(body);
        let changed = false;
        for (const [key] of params) {
            if (SENSITIVE_FIELD_PATTERN.test(key)) {
                params.set(key, REDACTED);
                changed = true;
            }
        }
        return changed ? params.toString() : body;
    } catch {
        return body;
    }
}

/**
 * Redact sensitive data from a request body.
 * Handles JSON objects, JSON strings, and URL-encoded form strings.
 */
export function redactBody(body: any): any {
    if (body === null || body === undefined) return body;

    // Object (parsed JSON)
    if (typeof body === 'object' && !Buffer.isBuffer(body)) {
        return redactJsonObject(body);
    }

    // String body — try JSON first, then form-encoded
    if (typeof body === 'string') {
        const trimmed = body.trim();

        // Try JSON
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                const redacted = redactJsonObject(parsed);
                return JSON.stringify(redacted);
            } catch {
                // Not valid JSON — fall through
            }
        }

        // Try URL-encoded form
        if (trimmed.includes('=') && !trimmed.includes('\n')) {
            return redactFormBody(trimmed);
        }
    }

    return body;
}

/**
 * Replace exact occurrences of resolved secret values in a string.
 */
function redactExactValues(value: string, secretValues: readonly string[]): string {
    let result = value;
    for (const secret of secretValues) {
        if (secret.length < MIN_SECRET_VALUE_LENGTH) continue;
        // URL normalization may percent-encode a secret embedded in a path.
        const variants = new Set([secret]);
        for (const encode of [encodeURI, encodeURIComponent]) {
            try {
                variants.add(encode(secret));
            } catch {
                // A lone surrogate cannot be URI-encoded; the raw variant still applies.
            }
        }
        for (const variant of variants) {
            if (variant.length < MIN_SECRET_VALUE_LENGTH || !result.includes(variant)) continue;
            result = result.split(variant).join(REDACTED);
        }
    }
    return result;
}

/**
 * Recursively replace exact resolved secret values in plain data. This catches
 * secrets used in URL path segments, innocuous header/field names, response
 * echo bodies, assertion messages, and console output — cases that name-based
 * redaction cannot detect.
 */
export function redactSecretValuesDeep<T>(value: T, secretValues: readonly string[]): T {
    if (secretValues.length === 0) return value;
    if (typeof value === 'string') {
        return redactExactValues(value, secretValues) as T;
    }
    if (Array.isArray(value)) {
        return value.map(item => redactSecretValuesDeep(item, secretValues)) as T;
    }
    if (value !== null && typeof value === 'object') {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            return value;
        }
        const result: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            result[key] = redactSecretValuesDeep(item, secretValues);
        }
        return result as T;
    }
    return value;
}

/**
 * Redact sensitive data from a HistoryEntry's sentRequest.
 * Returns a deep copy with sensitive values replaced.
 * The originalConfig (unresolved templates) is left untouched.
 */
export function redactHistoryEntry(entry: HistoryEntry, secretValues?: readonly string[]): HistoryEntry {
    const values = secretValues ?? getSecretValues(entry.sentRequest);
    const redacted: HistoryEntry = {
        ...entry,
        sentRequest: {
            ...entry.sentRequest,
            url: redactUrl(entry.sentRequest.url),
            headers: redactHeaders(entry.sentRequest.headers) as Record<string, string>,
            body: entry.sentRequest.body != null ? redactBody(entry.sentRequest.body) : entry.sentRequest.body
        }
    };
    return redactSecretValuesDeep(redacted, values);
}

/**
 * Redact sensitive data from a FullResponse (headers, cookies, and exact
 * resolved secret values echoed in the response body).
 */
export function redactFullResponse(response: FullResponse, secretValues: readonly string[] = []): FullResponse {
    const redacted: FullResponse = {
        ...response,
        headers: redactHeaders(response.headers),
        cookies: response.cookies.map((cookie: any) => {
            if (cookie && typeof cookie === 'object' && cookie.name && SENSITIVE_FIELD_PATTERN.test(cookie.name)) {
                return { ...cookie, value: REDACTED };
            }
            return cookie;
        })
    };
    return redactSecretValuesDeep(redacted, secretValues);
}

/**
 * Redact sensitive data from a FullResultDetails (suite test result), including
 * exact resolved secret values in request/response data, console output and
 * assertion messages.
 */
export function redactFullResultDetails(
    result: FullResultDetails,
    secretValues: readonly string[] = []
): FullResultDetails {
    const redacted: FullResultDetails = {
        ...result,
        url: redactUrl(result.url),
        request: {
            ...result.request,
            url: redactUrl(result.request.url),
            headers: redactHeaders(result.request.headers) as Record<string, string>,
            query: redactHeaders(result.request.query as Record<string, string>) as Record<string, string>,
            params: redactHeaders(result.request.params as Record<string, string>) as Record<string, string>,
            body: result.request.body != null ? redactBody(result.request.body) : result.request.body
        },
        response: {
            headers: redactHeaders(result.response.headers),
            body: result.response.body,
            time: result.response.time,
            size: result.response.size,
            cookies: result.response.cookies ? redactCookies(result.response.cookies) : result.response.cookies
        }
    };
    return redactSecretValuesDeep(redacted, secretValues);
}

// ── Pre-save validation ─────────────────────────────────────

/** A single warning about a hardcoded sensitive value. */
export interface SensitiveDataWarning {
    /** Where the issue was found (e.g. "header", "auth", "body", "query", "url") */
    location: string;
    /** The field name that matched (e.g. "Authorization", "password") */
    field: string;
    /** Human-readable guidance */
    message: string;
}

/** Regex that matches a {{variable}} template reference. */
const TEMPLATE_VAR = /\{\{[^}]+\}\}/;

/** Returns true if the value is (or contains) a template variable reference. */
function isTemplateRef(value: unknown): boolean {
    return typeof value === 'string' && TEMPLATE_VAR.test(value);
}

/**
 * Check a request for hardcoded sensitive data that should use environment
 * variables instead. Returns an array of warnings. An empty array means the
 * request is safe to save.
 *
 * Only values that are NOT `{{variable}}` template references are flagged.
 */
export function detectSensitiveData(request: {
    url?: string;
    headers?: Record<string, string> | Array<{ key: string; value: string; enabled?: boolean }>;
    query?: Record<string, string> | Array<{ key: string; value: string; enabled?: boolean }>;
    body?: any;
    auth?: any;
}): SensitiveDataWarning[] {
    const warnings: SensitiveDataWarning[] = [];

    // ── URL query params ────────────────────────────────────
    if (request.url) {
        try {
            const parsed = new URL(request.url.includes('://') ? request.url : `http://placeholder${request.url.startsWith('/') ? '' : '/'}${request.url}`);
            for (const [key, value] of parsed.searchParams) {
                if (SENSITIVE_FIELD_PATTERN.test(key) && value && !isTemplateRef(value)) {
                    warnings.push({
                        location: 'url',
                        field: key,
                        message: `URL query parameter "${key}" contains a hardcoded value. Use a {{variable}} instead.`
                    });
                }
            }
        } catch { /* not a parseable URL */ }
    }

    // ── Headers ─────────────────────────────────────────────
    if (request.headers) {
        const entries = Array.isArray(request.headers)
            ? request.headers.filter((h: any) => h.enabled !== false).map((h: any) => [h.key, h.value] as [string, string])
            : Object.entries(request.headers);

        for (const [key, value] of entries) {
            if (SENSITIVE_HEADERS.test(key) && value && !isTemplateRef(value)) {
                warnings.push({
                    location: 'header',
                    field: key,
                    message: `Header "${key}" contains a hardcoded value. Use a {{variable}} instead (e.g. {{${key.toLowerCase().replace(/[^a-z0-9]/g, '_')}}})`
                });
            }
        }
    }

    // ── Query params (explicit, separate from URL) ──────────
    if (request.query) {
        const entries = Array.isArray(request.query)
            ? request.query.filter((q: any) => q.enabled !== false).map((q: any) => [q.key, q.value] as [string, string])
            : Object.entries(request.query);

        for (const [key, value] of entries) {
            if (SENSITIVE_FIELD_PATTERN.test(key) && value && !isTemplateRef(value)) {
                warnings.push({
                    location: 'query',
                    field: key,
                    message: `Query parameter "${key}" contains a hardcoded value. Use a {{variable}} instead.`
                });
            }
        }
    }

    // ── Auth ────────────────────────────────────────────────
    if (request.auth) {
        const auth = request.auth;

        if (auth.bearerToken && !isTemplateRef(auth.bearerToken)) {
            warnings.push({
                location: 'auth',
                field: 'bearerToken',
                message: 'Bearer token contains a hardcoded value. Store it in a {{variable}} in your .local.json environment file.'
            });
        }

        if (auth.basicAuth) {
            if (auth.basicAuth.password && !isTemplateRef(auth.basicAuth.password)) {
                warnings.push({
                    location: 'auth',
                    field: 'basicAuth.password',
                    message: 'Basic auth password contains a hardcoded value. Use a {{variable}} instead.'
                });
            }
        }

        if (auth.apikey || auth.apiKey) {
            const apikey = auth.apikey || auth.apiKey;
            if (apikey.value && !isTemplateRef(apikey.value)) {
                warnings.push({
                    location: 'auth',
                    field: 'apiKey.value',
                    message: 'API key contains a hardcoded value. Use a {{variable}} instead.'
                });
            }
        }
    }

    // ── Body (JSON fields) ──────────────────────────────────
    if (request.body) {
        const bodyContent = typeof request.body === 'object' && 'content' in request.body
            ? request.body.content
            : request.body;

        if (bodyContent) {
            checkBodyForSecrets(bodyContent, warnings);
        }
    }

    return warnings;
}

/** Recursively check a body value for hardcoded sensitive field values. */
function checkBodyForSecrets(body: any, warnings: SensitiveDataWarning[]): void {
    if (body === null || body === undefined) return;

    // Parse string bodies
    if (typeof body === 'string') {
        const trimmed = body.trim();

        // JSON string
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                checkBodyForSecrets(JSON.parse(trimmed), warnings);
            } catch { /* not valid JSON */ }
            return;
        }

        // URL-encoded form
        if (trimmed.includes('=') && !trimmed.includes('\n')) {
            try {
                const params = new URLSearchParams(trimmed);
                for (const [key, value] of params) {
                    if (SENSITIVE_FIELD_PATTERN.test(key) && value && !isTemplateRef(value)) {
                        warnings.push({
                            location: 'body',
                            field: key,
                            message: `Form field "${key}" contains a hardcoded value. Use a {{variable}} instead.`
                        });
                    }
                }
            } catch { /* not form data */ }
            return;
        }
        return;
    }

    // Array
    if (Array.isArray(body)) {
        body.forEach(item => checkBodyForSecrets(item, warnings));
        return;
    }

    // Object
    if (typeof body === 'object') {
        for (const [key, value] of Object.entries(body)) {
            if (SENSITIVE_FIELD_PATTERN.test(key) && value && typeof value === 'string' && !isTemplateRef(value)) {
                warnings.push({
                    location: 'body',
                    field: key,
                    message: `Body field "${key}" contains a hardcoded value. Use a {{variable}} instead.`
                });
            } else if (typeof value === 'object' && value !== null) {
                checkBodyForSecrets(value, warnings);
            }
        }
    }
}

// ── Sensitive data extraction plan ──────────────────────────

/**
 * A single sensitive value that can be extracted to a .local.json variable.
 */
export interface SensitiveExtraction {
    /** Where the value was found */
    location: 'header' | 'query' | 'body' | 'auth' | 'url';
    /** The field name / key (e.g. "Authorization", "password") */
    field: string;
    /** Dot-path for nested body fields (e.g. "credentials.secret") */
    path?: string;
    /** The hardcoded value to extract */
    value: string;
    /** Suggested variable name for the .local.json file */
    variableName: string;
}

/**
 * Generate a variable name from a field name.
 * E.g. "Authorization" → "authorization", "client_secret" → "client_secret",
 *      "X-API-Key" → "x_api_key", "basicAuth.password" → "basic_auth_password"
 */
function toVariableName(field: string): string {
    return field
        .replace(/\./g, '_')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .toLowerCase();
}

/**
 * Scan a request and build an extraction plan: a list of all hardcoded sensitive
 * values with their locations and suggested variable names.
 *
 * The caller can use this plan to:
 * 1. Write the values to a .local.json environment file
 * 2. Replace each value with {{variableName}} in the request before saving
 */
export function buildExtractionPlan(request: {
    url?: string;
    headers?: Record<string, string> | Array<{ key: string; value: string; enabled?: boolean }>;
    query?: Record<string, string> | Array<{ key: string; value: string; enabled?: boolean }>;
    body?: any;
    auth?: any;
}): SensitiveExtraction[] {
    const extractions: SensitiveExtraction[] = [];
    const usedNames = new Set<string>();

    /** Get a unique variable name (append _2, _3, etc. if needed) */
    function uniqueName(base: string): string {
        let name = base;
        let counter = 2;
        while (usedNames.has(name)) {
            name = `${base}_${counter++}`;
        }
        usedNames.add(name);
        return name;
    }

    // ── URL query params ────────────────────────────────────
    if (request.url) {
        try {
            const parsed = new URL(request.url.includes('://') ? request.url : `http://placeholder${request.url.startsWith('/') ? '' : '/'}${request.url}`);
            for (const [key, value] of parsed.searchParams) {
                if (SENSITIVE_FIELD_PATTERN.test(key) && value && !isTemplateRef(value)) {
                    extractions.push({
                        location: 'url',
                        field: key,
                        value,
                        variableName: uniqueName(toVariableName(key))
                    });
                }
            }
        } catch { /* not a parseable URL */ }
    }

    // ── Headers ─────────────────────────────────────────────
    if (request.headers) {
        const entries = Array.isArray(request.headers)
            ? request.headers.filter((h: any) => h.enabled !== false).map((h: any) => [h.key, h.value] as [string, string])
            : Object.entries(request.headers);

        for (const [key, value] of entries) {
            if (SENSITIVE_HEADERS.test(key) && value && !isTemplateRef(value)) {
                extractions.push({
                    location: 'header',
                    field: key,
                    value,
                    variableName: uniqueName(toVariableName(key))
                });
            }
        }
    }

    // ── Query params (explicit) ─────────────────────────────
    if (request.query) {
        const entries = Array.isArray(request.query)
            ? request.query.filter((q: any) => q.enabled !== false).map((q: any) => [q.key, q.value] as [string, string])
            : Object.entries(request.query);

        for (const [key, value] of entries) {
            if (SENSITIVE_FIELD_PATTERN.test(key) && value && !isTemplateRef(value)) {
                extractions.push({
                    location: 'query',
                    field: key,
                    value,
                    variableName: uniqueName(toVariableName(key))
                });
            }
        }
    }

    // ── Auth ────────────────────────────────────────────────
    if (request.auth) {
        const auth = request.auth;

        if (auth.bearerToken && !isTemplateRef(auth.bearerToken)) {
            extractions.push({
                location: 'auth',
                field: 'bearerToken',
                value: auth.bearerToken,
                variableName: uniqueName('bearer_token')
            });
        }

        if (auth.basicAuth) {
            if (auth.basicAuth.password && !isTemplateRef(auth.basicAuth.password)) {
                extractions.push({
                    location: 'auth',
                    field: 'basicAuth.password',
                    value: auth.basicAuth.password,
                    variableName: uniqueName('basic_auth_password')
                });
            }
        }

        if (auth.apikey || auth.apiKey) {
            const apikey = auth.apikey || auth.apiKey;
            if (apikey.value && !isTemplateRef(apikey.value)) {
                extractions.push({
                    location: 'auth',
                    field: 'apiKey.value',
                    value: apikey.value,
                    variableName: uniqueName('api_key')
                });
            }
        }
    }

    // ── Body (JSON / form) ──────────────────────────────────
    if (request.body) {
        const bodyContent = typeof request.body === 'object' && 'content' in request.body
            ? request.body.content
            : request.body;

        if (bodyContent) {
            extractBodySecrets(bodyContent, extractions, usedNames, '');
        }
    }

    return extractions;
}

/** Recursively extract sensitive values from body content. */
function extractBodySecrets(
    body: any,
    extractions: SensitiveExtraction[],
    usedNames: Set<string>,
    pathPrefix: string
): void {
    if (body === null || body === undefined) return;

    if (typeof body === 'string') {
        const trimmed = body.trim();

        // JSON string
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try { extractBodySecrets(JSON.parse(trimmed), extractions, usedNames, pathPrefix); } catch {}
            return;
        }

        // URL-encoded form
        if (trimmed.includes('=') && !trimmed.includes('\n')) {
            try {
                const params = new URLSearchParams(trimmed);
                for (const [key, value] of params) {
                    if (SENSITIVE_FIELD_PATTERN.test(key) && value && !isTemplateRef(value)) {
                        let name = toVariableName(key);
                        let counter = 2;
                        while (usedNames.has(name)) { name = `${toVariableName(key)}_${counter++}`; }
                        usedNames.add(name);
                        extractions.push({ location: 'body', field: key, path: pathPrefix ? `${pathPrefix}.${key}` : key, value, variableName: name });
                    }
                }
            } catch {}
            return;
        }
        return;
    }

    if (Array.isArray(body)) {
        body.forEach((item, i) => extractBodySecrets(item, extractions, usedNames, `${pathPrefix}[${i}]`));
        return;
    }

    if (typeof body === 'object') {
        for (const [key, value] of Object.entries(body)) {
            const currentPath = pathPrefix ? `${pathPrefix}.${key}` : key;
            if (SENSITIVE_FIELD_PATTERN.test(key) && value && typeof value === 'string' && !isTemplateRef(value)) {
                let name = toVariableName(key);
                let counter = 2;
                while (usedNames.has(name)) { name = `${toVariableName(key)}_${counter++}`; }
                usedNames.add(name);
                extractions.push({ location: 'body', field: key, path: currentPath, value, variableName: name });
            } else if (typeof value === 'object' && value !== null) {
                extractBodySecrets(value, extractions, usedNames, currentPath);
            }
        }
    }
}

/**
 * Apply an extraction plan to a request: replace hardcoded values with {{variableName}}.
 * Returns a deep copy of the request with all sensitive values replaced.
 */
export function applyExtractionPlan(request: any, plan: SensitiveExtraction[]): any {
    const result = JSON.parse(JSON.stringify(request));

    for (const extraction of plan) {
        const varRef = `{{${extraction.variableName}}}`;

        switch (extraction.location) {
            case 'url':
                if (result.url) {
                    result.url = result.url.replace(
                        new RegExp(`([?&])${escapeRegex(extraction.field)}=[^&]*`),
                        `$1${extraction.field}=${varRef}`
                    );
                }
                break;

            case 'header':
                if (Array.isArray(result.headers)) {
                    const header = result.headers.find((h: any) => h.key === extraction.field && h.value === extraction.value);
                    if (header) header.value = varRef;
                } else if (result.headers && result.headers[extraction.field] === extraction.value) {
                    result.headers[extraction.field] = varRef;
                }
                break;

            case 'query':
                if (Array.isArray(result.query)) {
                    const param = result.query.find((q: any) => q.key === extraction.field && q.value === extraction.value);
                    if (param) param.value = varRef;
                } else if (result.query && result.query[extraction.field] === extraction.value) {
                    result.query[extraction.field] = varRef;
                }
                break;

            case 'auth':
                if (result.auth) {
                    if (extraction.field === 'bearerToken') {
                        result.auth.bearerToken = varRef;
                    } else if (extraction.field === 'basicAuth.password' && result.auth.basicAuth) {
                        result.auth.basicAuth.password = varRef;
                    } else if (extraction.field === 'apiKey.value') {
                        const apikey = result.auth.apikey || result.auth.apiKey;
                        if (apikey) apikey.value = varRef;
                    }
                }
                break;

            case 'body':
                replaceBodyValue(result, extraction.field, extraction.path, extraction.value, varRef);
                break;
        }
    }

    return result;
}

/** Replace a sensitive value in the request body (handles nested objects and form-encoded). */
function replaceBodyValue(request: any, field: string, fieldPath: string | undefined, oldValue: string, newValue: string): void {
    const bodyObj = typeof request.body === 'object' && request.body !== null && 'content' in request.body
        ? request.body
        : null;

    const bodyContent = bodyObj ? bodyObj.content : request.body;
    if (!bodyContent) return;

    // String body (JSON or form-encoded)
    if (typeof bodyContent === 'string') {
        const trimmed = bodyContent.trim();

        // JSON string — parse, replace, re-serialize
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                replaceInObject(parsed, field, fieldPath || field, oldValue, newValue);
                const updated = JSON.stringify(parsed, null, 2);
                if (bodyObj) { bodyObj.content = updated; } else { request.body = updated; }
            } catch { /* not valid JSON */ }
            return;
        }

        // URL-encoded form
        if (trimmed.includes('=') && !trimmed.includes('\n')) {
            const params = new URLSearchParams(trimmed);
            if (params.get(field) === oldValue) {
                params.set(field, newValue);
                const updated = params.toString();
                if (bodyObj) { bodyObj.content = updated; } else { request.body = updated; }
            }
            return;
        }
        return;
    }

    // Object body (parsed JSON)
    if (typeof bodyContent === 'object' && bodyContent !== null) {
        replaceInObject(bodyContent, field, fieldPath || field, oldValue, newValue);
    }
}

/** Walk an object by dot-path and replace the leaf value. */
function replaceInObject(obj: any, field: string, dotPath: string, oldValue: string, newValue: string): void {
    const parts = dotPath.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        // Handle array notation [n]
        const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
        if (arrayMatch) {
            current = current?.[arrayMatch[1]]?.[parseInt(arrayMatch[2])];
        } else {
            current = current?.[part];
        }
        if (current === null || current === undefined) return;
    }

    const lastKey = parts[parts.length - 1];
    if (current && current[lastKey] === oldValue) {
        current[lastKey] = newValue;
    }
}

/** Escape special regex characters in a string. */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
