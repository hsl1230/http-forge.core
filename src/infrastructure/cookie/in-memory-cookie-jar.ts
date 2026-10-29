/**
 * In-Memory Cookie Jar
 * 
 * Lightweight ICookieJar implementation for isolated script execution contexts
 * (e.g., test suite runs). All cookies are stored in-memory and lost when the
 * instance is discarded.
 * 
 * For persistent cookie handling (across requests in a session), use
 * PersistentCookieJar which wraps an ICookieService backend.
 */

import type { ICookieJar } from '../script/interfaces';
import { CookieUtils } from './cookie-utils';
import type { Cookie } from './interfaces';

export class InMemoryCookieJar implements ICookieJar {
    private cookies: Map<string, Cookie> = new Map();

    /**
     * Generate a unique key for a cookie (based on CookieService pattern)
     */
    private getCookieKey(name: string, domain?: string, path?: string): string {
        return CookieUtils.cookieKey(name, domain, path);
    }

    /**
     * Get cookies for a specific domain
     */
    getCookiesForDomain(domain: string): Cookie[] {
        const result: Cookie[] = [];

        for (const cookie of this.cookies.values()) {
            if (CookieUtils.isExpired(cookie)) {
                continue;
            }
            if (!cookie.domain || CookieUtils.domainMatches(domain, cookie.domain)) {
                result.push(cookie);
            }
        }

        return result;
    }

    has(name: string, domain?: string): boolean {
        return this.get(name, domain) !== undefined;
    }

    get(name: string, domain?: string): Cookie | undefined {
        const key = this.getCookieKey(name, domain);
        const cookie = this.cookies.get(key);

        if (cookie && !CookieUtils.isExpired(cookie)) {
            return cookie;
        }

        return undefined;
    }

    set(cookie: Cookie): void {
        const key = this.getCookieKey(cookie.name, cookie.domain, cookie.path);
        this.cookies.set(key, cookie);
    }

    delete(name: string, domain?: string, path?: string): boolean {
        const key = this.getCookieKey(name, domain, path);
        return this.cookies.delete(key);
    }

    /**
     * Get all cookies, optionally filtered by domain
     */
    getAll(domain?: string): Cookie[] {
        if (domain) {
            return this.getCookiesForDomain(domain);
        }

        const result: Cookie[] = [];
        for (const cookie of this.cookies.values()) {
            if (!CookieUtils.isExpired(cookie)) {
                result.push(cookie);
            }
        }
        return result;
    }

    /**
     * Add cookies from Set-Cookie headers
     */
    setCookiesFromResponse(url: string, headers: Record<string, string | string[]>): void {
        const domain = CookieUtils.extractDomain(url);
        const cookies = CookieUtils.parseCookieHeaders(headers, domain);

        for (const cookie of cookies) {
            const key = this.getCookieKey(cookie.name, cookie.domain, cookie.path);
            this.cookies.set(key, cookie);
        }
    }

    /**
     * Get Cookie header value for a request URL
     * Filters by domain and path matching
     */
    getCookieHeader(url: string): string | undefined {
        const domain = CookieUtils.extractDomain(url);
        const pathStr = CookieUtils.extractPath(url);
        const cookies = this.getCookiesForDomain(domain);

        const matchingCookies = cookies.filter(cookie => {
            if (!cookie.path) return true;
            return pathStr.startsWith(cookie.path);
        });

        if (matchingCookies.length === 0) {
            return undefined;
        }

        return CookieUtils.formatCookieHeader(matchingCookies);
    }

    /**
     * Clear all cookies
     */
    clear(): void {
        this.cookies.clear();
    }
}
