/**
 * Cookie Service
 *
 * Manages cookies across HTTP Forge sessions.
 * Platform-agnostic — uses IKeyValueStore for persistence
 * instead of VS Code globalState.
 */

import { IKeyValueStore } from '../../types/platform';
import { CookieUtils } from './cookie-utils';
import { Cookie, IAsyncCookieService } from './interfaces';

/**
 * Default store key for cookies
 */
const DEFAULT_COOKIE_KEY = 'httpForge.cookies';

/**
 * Service for managing cookies across HTTP Forge sessions.
 * Provides persistent cookie storage via IKeyValueStore.
 */
export class CookieService implements IAsyncCookieService {
    private cookies: Map<string, Cookie> = new Map();

    constructor(
        private store: IKeyValueStore,
        private storeKey: string = DEFAULT_COOKIE_KEY
    ) {
        this.loadCookies();
    }

    /**
     * Load cookies from persistent storage
     */
    private loadCookies(): void {
        try {
            const stored = this.store.get<Record<string, Cookie>>(this.storeKey);
            if (stored) {
                this.cookies = new Map(Object.entries(stored));
                this.cleanExpiredCookies();
            }
        } catch (error) {
            console.error('[CookieService] Failed to load cookies:', error);
        }
    }

    /**
     * Save cookies to persistent storage
     */
    private async saveCookies(): Promise<void> {
        try {
            const obj: Record<string, Cookie> = {};
            this.cookies.forEach((cookie, key) => {
                obj[key] = cookie;
            });
            await this.store.update(this.storeKey, obj);
        } catch (error) {
            console.error('[CookieService] Failed to save cookies:', error);
        }
    }

    /**
     * Generate a unique key for a cookie
     */
    private getCookieKey(name: string, domain?: string, path?: string): string {
        return CookieUtils.cookieKey(name, domain, path);
    }

    /**
     * Get a cookie by name
     */
    public get(name: string, domain?: string): Cookie | undefined {
        // First try exact domain match
        if (domain) {
            const key = this.getCookieKey(name, domain);
            const cookie = this.cookies.get(key);
            if (cookie && !this.isExpired(cookie)) {
                return cookie;
            }
        }

        // Then try wildcard domain
        const wildcardKey = this.getCookieKey(name, '*');
        const wildcardCookie = this.cookies.get(wildcardKey);
        if (wildcardCookie && !this.isExpired(wildcardCookie)) {
            return wildcardCookie;
        }

        // Search all cookies with matching name
        for (const cookie of this.cookies.values()) {
            if (cookie.name === name && !this.isExpired(cookie)) {
                if (domain && cookie.domain) {
                    if (this.domainMatches(domain, cookie.domain)) {
                        return cookie;
                    }
                } else {
                    return cookie;
                }
            }
        }

        return undefined;
    }

    /**
     * Set a cookie
     */
    public async set(cookie: Cookie): Promise<void> {
        const key = this.getCookieKey(cookie.name, cookie.domain, cookie.path);
        this.cookies.set(key, cookie);
        await this.saveCookies();
    }

    /**
     * Set multiple cookies from a response
     */
    public async setFromResponse(cookies: Cookie[]): Promise<void> {
        for (const cookie of cookies) {
            const key = this.getCookieKey(cookie.name, cookie.domain, cookie.path);
            this.cookies.set(key, cookie);
        }
        await this.saveCookies();
    }

    /**
     * Check if a cookie exists
     */
    public has(name: string, domain?: string): boolean {
        return this.get(name, domain) !== undefined;
    }

    /**
     * Delete a cookie
     */
    public async delete(name: string, domain?: string, path?: string): Promise<boolean> {
        const key = this.getCookieKey(name, domain, path);
        const existed = this.cookies.delete(key);

        if (existed) {
            await this.saveCookies();
        }

        return existed;
    }

    /**
     * Get all cookies, optionally filtered by domain
     */
    public getAll(domain?: string): Cookie[] {
        const result: Cookie[] = [];

        for (const cookie of this.cookies.values()) {
            if (this.isExpired(cookie)) {
                continue;
            }

            if (domain) {
                if (!cookie.domain || this.domainMatches(domain, cookie.domain)) {
                    result.push(cookie);
                }
            } else {
                result.push(cookie);
            }
        }

        return result;
    }

    /**
     * Get cookies formatted for HTTP Cookie header
     */
    public getCookieHeader(domain?: string): string {
        const cookies = this.getAll(domain);
        return CookieUtils.formatCookieHeader(cookies);
    }

    /**
     * Clear all cookies
     */
    public async clear(): Promise<void> {
        this.cookies.clear();
        await this.saveCookies();
    }

    /**
     * Clear cookies for a specific domain
     */
    public async clearDomain(domain: string): Promise<void> {
        const keysToDelete: string[] = [];

        for (const [key, cookie] of this.cookies.entries()) {
            if (cookie.domain && this.domainMatches(domain, cookie.domain)) {
                keysToDelete.push(key);
            }
        }

        for (const key of keysToDelete) {
            this.cookies.delete(key);
        }

        await this.saveCookies();
    }

    /**
     * Parse Set-Cookie headers from response
     */
    public parseCookieHeaders(headers: Record<string, string | string[]>, domain?: string): Cookie[] {
        return CookieUtils.parseCookieHeaders(headers, domain);
    }

    /**
     * Check if a cookie is expired
     */
    private isExpired(cookie: Cookie): boolean {
        return CookieUtils.isExpired(cookie);
    }

    /**
     * Clean expired cookies
     */
    private cleanExpiredCookies(): void {
        const keysToDelete: string[] = [];

        for (const [key, cookie] of this.cookies.entries()) {
            if (this.isExpired(cookie)) {
                keysToDelete.push(key);
            }
        }

        for (const key of keysToDelete) {
            this.cookies.delete(key);
        }

        if (keysToDelete.length > 0) {
            this.saveCookies();
        }
    }

    /**
     * Check if a domain matches a cookie domain
     */
    private domainMatches(requestDomain: string, cookieDomain: string): boolean {
        return CookieUtils.domainMatches(requestDomain, cookieDomain);
    }

    /**
     * Get cookie count
     */
    public get count(): number {
        return this.cookies.size;
    }
}
