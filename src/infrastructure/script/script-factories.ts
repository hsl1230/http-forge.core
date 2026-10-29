/**
 * Script Factories
 *
 * Single Responsibility: Create objects used in script execution contexts.
 *
 * `validateJsonSchema` lives in ./json-schema-validator
 * `ExpectChain` / `createExpectChain` live in ./expect-chain
 * Both are re-exported here for backward compatibility.
 */

import { Cookie } from '../cookie/interfaces';
import { ResponseContext } from './interfaces';
import { validateJsonSchema } from './json-schema-validator';

export { createExpectChain } from './expect-chain';
export type { ExpectChain } from './expect-chain';
export { validateJsonSchema } from './json-schema-validator';

// ---------------------------------------------------------------------------
// Response object
// ---------------------------------------------------------------------------

/**
 * Response object interface for script context
 */
export interface ScriptResponse {
    /** Reason phrase string (Postman parity, e.g. "OK"). Use `code` for the numeric status. */
    status: string;
    code: number;
    statusText: string;
    headers: Record<string, string>;
    /** Raw response body string (Postman-compatible). Use json() to parse, text() for the string. */
    body: any;
    /**
     * Postman-compatible CookieList. Use `cookies.get(name)` for the value string,
     * `cookies.one(name)` for the full cookie object (domain, path, expires, maxAge,
     * httpOnly, secure, sameSite), `cookies.has(name)`, `cookies.toObject()`, or iterate.
     */
    cookies: CookieList;
    responseTime?: number;
    responseSize?: number;
    reason(): string;
    json(): any;
    text(): string;
    to: ResponseAssertions;
}

/**
 * Response assertion helpers (Postman-style)
 * Note: be.ok/error/etc. are getters that execute assertions on property access
 */
export interface ResponseAssertions {
    have: {
        status(expectedStatus: number): void;
        header(headerName: string, expectedValue?: string): void;
        body(expectedBody?: string): void;
        jsonBody(expectedJson?: any): void;
        jsonSchema(schema: any): void;
    };
    be: {
        readonly ok: any;
        readonly success: any;
        readonly error: any;
        readonly clientError: any;
        readonly serverError: any;
    };
}

// ---------------------------------------------------------------------------
// Cookie types
// ---------------------------------------------------------------------------

/**
 * Postman-compatible Cookie object (a single entry of a CookieList).
 *
 * Coerces to its value string via valueOf()/toString() so `cookie == 'abc'`
 * and template literals work, while still exposing the full metadata.
 */
export interface PostmanCookie {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: string;
    maxAge?: number;
    httpOnly: boolean;
    secure: boolean;
    /** True when the cookie has neither Expires nor Max-Age (cleared at session end). */
    session: boolean;
    hostOnly: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
    valueOf(): string;
    toString(): string;
}

/**
 * Postman-compatible CookieList (a PropertyList of cookies).
 *
 * Mirrors the Postman SDK API:
 *   - `cookies.get(name)`  → the cookie VALUE string (or undefined)
 *   - `cookies.one(name)`  → the full cookie OBJECT (or undefined)
 *   - `cookies.has(name)`  → boolean
 *   - `cookies.toObject()` → plain `{ name: value }` map
 * It is also a real array, so `forEach`, `map`, `filter`, `find`, numeric
 * indexing and `for...of` iteration all work over the cookie objects.
 */
export interface CookieList extends Array<PostmanCookie> {
    get(name: string): string | undefined;
    one(name: string): PostmanCookie | undefined;
    has(name: string): boolean;
    toObject(): Record<string, string>;
    all(): PostmanCookie[];
    each(cb: (cookie: PostmanCookie) => void): void;
    count(): number;
    idx(index: number): PostmanCookie | undefined;
}

// ---------------------------------------------------------------------------
// URL helper
// ---------------------------------------------------------------------------

/**
 * Create a Postman-compatible Url object that wraps a plain URL string.
 *
 * Behaves like a string (via toString/valueOf/Symbol.toPrimitive) so that:
 *   - `pm.request.url + '/path'` works
 *   - `pm.request.url.toString()` works
 *   - Template literals `${pm.request.url}` work
 *
 * Also exposes Postman SDK Url methods:
 *   - getHost(), getPath(), getPathWithQuery(), getQueryString()
 *   - query (URLSearchParams-like with toObject())
 */
export function createPostmanUrl(rawUrl: string): any {
    let parsed: URL | null = null;
    try { parsed = new URL(rawUrl); } catch { /* invalid URL, methods return fallbacks */ }

    const urlObj: any = {
        // String coercion — makes the object behave like a string
        toString() { return rawUrl; },
        valueOf() { return rawUrl; },
        [Symbol.toPrimitive](hint: string) {
            return hint === 'number' ? NaN : rawUrl;
        },

        // Postman Url methods
        getHost() {
            return parsed ? parsed.hostname : '';
        },
        getPath() {
            return parsed ? parsed.pathname : rawUrl;
        },
        getPathWithQuery() {
            if (!parsed) return rawUrl;
            return parsed.pathname + parsed.search;
        },
        getQueryString() {
            if (!parsed) return '';
            return parsed.search.startsWith('?') ? parsed.search.slice(1) : parsed.search;
        },
        getRemote() {
            if (!parsed) return '';
            const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
            return `${parsed.hostname}:${port}`;
        },
        getOAuth1BaseUrl() {
            if (!parsed) return rawUrl;
            return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
        },

        // Postman Url properties
        get protocol() { return parsed?.protocol?.replace(':', '') || ''; },
        get host() {
            if (!parsed) return [];
            return parsed.hostname.split('.');
        },
        get port() { return parsed?.port || ''; },
        get path() {
            if (!parsed) return [];
            return parsed.pathname.split('/').filter(Boolean);
        },
        get hash() { return parsed?.hash?.replace('#', '') || ''; },

        // query member — Postman SDK returns a PropertyList of QueryParam
        query: {
            toObject() {
                if (!parsed) return {};
                const obj: Record<string, string> = {};
                parsed.searchParams.forEach((v, k) => { obj[k] = v; });
                return obj;
            },
            has(key: string) { return parsed ? parsed.searchParams.has(key) : false; },
            get(key: string) { return parsed ? parsed.searchParams.get(key) : undefined; },
            each(cb: (param: { key: string; value: string }) => void) {
                if (parsed) {
                    parsed.searchParams.forEach((v, k) => cb({ key: k, value: v }));
                }
            }
        }
    };

    return urlObj;
}

// ---------------------------------------------------------------------------
// Cookie factory helpers
// ---------------------------------------------------------------------------

function createPostmanCookie(c: Cookie): PostmanCookie {
    const httpOnly = c.httpOnly ?? false;
    const secure = c.secure ?? false;
    const session = c.expires == null && c.maxAge == null;
    return {
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        maxAge: c.maxAge,
        httpOnly,
        secure,
        session,
        hostOnly: false,
        sameSite: c.sameSite,
        valueOf() { return c.value; },
        toString() {
            const parts = [`${c.name}=${c.value}`];
            if (c.expires) { parts.push(`Expires=${c.expires}`); }
            if (c.maxAge != null) { parts.push(`Max-Age=${c.maxAge}`); }
            if (c.domain) { parts.push(`Domain=${c.domain}`); }
            if (c.path) { parts.push(`Path=${c.path}`); }
            if (secure) { parts.push('Secure'); }
            if (httpOnly) { parts.push('HttpOnly'); }
            if (c.sameSite) { parts.push(`SameSite=${c.sameSite}`); }
            return parts.join('; ');
        }
    };
}

export function createCookieList(cookies: Cookie[]): CookieList {
    const list = cookies.map(createPostmanCookie) as PostmanCookie[] & Partial<CookieList>;
    const find = (name: string): PostmanCookie | undefined => list.find(c => c.name === name);
    list.get = (name: string) => find(name)?.value;
    list.one = (name: string) => find(name);
    list.has = (name: string) => list.some(c => c.name === name);
    list.toObject = () => {
        const obj: Record<string, string> = {};
        for (const c of list) { obj[c.name] = c.value; }
        return obj;
    };
    list.all = () => [...list];
    list.each = (cb: (cookie: PostmanCookie) => void) => { for (const c of list) { cb(c); } };
    list.count = () => list.length;
    list.idx = (index: number) => list[index];
    return list as CookieList;
}

// ---------------------------------------------------------------------------
// Header helper
// ---------------------------------------------------------------------------

function createHeaderList(headers: Record<string, string>): any {
    const list: any = { ...headers };
    list.get = (name: string): string | undefined => {
        const lowerName = name.toLowerCase();
        for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase() === lowerName) return value;
        }
        return undefined;
    };
    list.has = (name: string): boolean => {
        const lowerName = name.toLowerCase();
        return Object.keys(headers).some(k => k.toLowerCase() === lowerName);
    };
    list.toObject = (): Record<string, string> => ({ ...headers });
    list.each = (cb: (header: { key: string; value: string }) => void): void => {
        for (const [key, value] of Object.entries(headers)) {
            cb({ key, value });
        }
    };
    return list;
}

// ---------------------------------------------------------------------------
// createResponseObject
// ---------------------------------------------------------------------------

/**
 * Create response object with helper methods for script context.
 * Provides Postman-compatible response API.
 */
export function createResponseObject(response: ResponseContext): ScriptResponse {
    const headerList = createHeaderList(response.headers);
    const cookieList = createCookieList(response.cookies || []);
    return {
        // Postman parity: `status` is the reason phrase string, `code` is numeric.
        status: response.statusText,
        code: response.status,
        statusText: response.statusText,
        headers: headerList,
        body: response.body,
        cookies: cookieList,
        responseTime: response.responseTime,
        responseSize: response.responseSize,

        reason() { return this.statusText; },

        json() {
            if (typeof this.body === 'object') { return this.body; }
            try { return JSON.parse(this.body); } catch { return null; }
        },

        text() {
            if (typeof this.body === 'string') { return this.body; }
            return JSON.stringify(this.body);
        },

        to: {
            have: {
                status(expectedStatus: number) {
                    if (response.status !== expectedStatus) {
                        throw new Error(`Expected status ${expectedStatus} but got ${response.status}`);
                    }
                },
                header(headerName: string, expectedValue?: string) {
                    const headerValue = response.headers[headerName] ||
                        response.headers[headerName.toLowerCase()];
                    if (!headerValue) {
                        throw new Error(`Expected header "${headerName}" to exist`);
                    }
                    if (expectedValue !== undefined && headerValue !== expectedValue) {
                        throw new Error(`Expected header "${headerName}" to be "${expectedValue}" but got "${headerValue}"`);
                    }
                },
                body(expectedBody?: string) {
                    const bodyStr = typeof response.body === 'string'
                        ? response.body
                        : JSON.stringify(response.body);
                    if (expectedBody !== undefined && bodyStr !== expectedBody) {
                        throw new Error(`Expected body to be "${expectedBody}" but got "${bodyStr}"`);
                    }
                },
                jsonBody(expectedJson?: any) {
                    const json = typeof response.body === 'object'
                        ? response.body
                        : JSON.parse(response.body);
                    if (expectedJson !== undefined && JSON.stringify(json) !== JSON.stringify(expectedJson)) {
                        throw new Error(`Expected JSON body to match`);
                    }
                },
                jsonSchema(schema: any) {
                    const json = typeof response.body === 'object'
                        ? response.body
                        : JSON.parse(response.body);
                    const schemaErrors = validateJsonSchema(json, schema);
                    if (schemaErrors.length > 0) {
                        throw new Error(`Expected response body to match JSON schema:\n  - ${schemaErrors.join('\n  - ')}`);
                    }
                }
            },
            be: {
                get ok() {
                    if (response.status < 200 || response.status >= 300) {
                        throw new Error(`Expected response to be OK (2xx) but got ${response.status}`);
                    }
                    return (() => {}) as any;
                },
                get success() {
                    if (response.status < 200 || response.status >= 300) {
                        throw new Error(`Expected response to be successful (2xx) but got ${response.status}`);
                    }
                    return (() => {}) as any;
                },
                get error() {
                    if (response.status < 400) {
                        throw new Error(`Expected response to be error (4xx/5xx) but got ${response.status}`);
                    }
                    return (() => {}) as any;
                },
                get clientError() {
                    if (response.status < 400 || response.status >= 500) {
                        throw new Error(`Expected response to be client error (4xx) but got ${response.status}`);
                    }
                    return (() => {}) as any;
                },
                get serverError() {
                    if (response.status < 500 || response.status >= 600) {
                        throw new Error(`Expected response to be server error (5xx) but got ${response.status}`);
                    }
                    return (() => {}) as any;
                }
            }
        }
    };
}
