/**
 * Cookie Interface Definitions
 * 
 * Extracted 100% from VS Code plugin: src/services/interfaces/cookie.interface.ts
 * DO NOT modify the core logic - it has been tested and is reliable.
 */

/**
 * Cookie data structure
 * Matches plugin's Cookie interface exactly
 */
export interface Cookie {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: string;
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Parsed cookie from response (simplified version)
 * Used by HttpResponse for immediate access
 */
export interface ParsedCookie {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: string;
    httpOnly?: boolean;
    secure?: boolean;
}

/**
 * Cookie read operations
 * Interface Segregation: Separate read-only operations
 */
export interface ICookieReader {
    /**
     * Get a cookie by name
     */
    get(name: string, domain?: string): Cookie | undefined;

    /**
     * Check if a cookie exists
     */
    has(name: string, domain?: string): boolean;

    /**
     * Get all cookies, optionally filtered by domain
     */
    getAll(domain?: string): Cookie[];

    /**
     * Get cookies formatted for HTTP Cookie header
     */
    getCookieHeader(domain?: string): string;
}

/**
 * Cookie parsing operations
 */
export interface ICookieParser {
    /**
     * Parse Set-Cookie headers from response
     */
    parseCookieHeaders(headers: Record<string, string | string[]>, domain?: string): Cookie[];
}

/**
 * Cookie write operations
 */
export interface ICookieWriter {
    /**
     * Set a cookie
     */
    set(cookie: Cookie): void;

    /**
     * Set multiple cookies from a response
     */
    setFromResponse(cookies: Cookie[]): void;

    /**
     * Delete a cookie
     */
    delete(name: string, domain?: string, path?: string): boolean;

    /**
     * Clear all cookies
     */
    clear(): void;

    /**
     * Clear cookies for a specific domain
     */
    clearDomain(domain: string): void;
}

/**
 * Full cookie service interface
 * Core package version - no VS Code dependency
 */
export interface ICookieService extends ICookieReader, ICookieWriter, ICookieParser {
    /**
     * Get cookie count
     */
    readonly count: number;
}

/**
 * Async cookie service interface for platform integrations that require
 * asynchronous persistence (e.g., VS Code globalState, IndexedDB, etc.)
 * 
 * Read operations remain synchronous (from in-memory cache).
 * Write operations return Promises to allow async persistence after mutation.
 */
export interface IAsyncCookieService extends ICookieReader, ICookieParser {
    readonly count: number;

    /** Set a cookie (persists asynchronously) */
    set(cookie: Cookie): Promise<void>;

    /** Set multiple cookies from response headers (persists asynchronously) */
    setFromResponse(cookies: Cookie[]): Promise<void>;

    /** Delete a cookie (persists asynchronously) */
    delete(name: string, domain?: string, path?: string): Promise<boolean>;

    /** Clear all cookies (persists asynchronously) */
    clear(): Promise<void>;

    /** Clear cookies for a specific domain (persists asynchronously) */
    clearDomain(domain: string): Promise<void>;
}
