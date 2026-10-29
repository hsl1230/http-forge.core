/**
 * Cookie Jar - In-Memory Cookie Storage
 * 
 * Extracted and adapted from VS Code plugin: src/services/cookie-service.ts
 * Core package version - no VS Code dependency, no persistence (memory only)
 * 
 * The logic is 100% equivalent to the plugin's CookieService, but:
 * - Removed vscode.ExtensionContext dependency
 * - Removed persistence (saveCookies/loadCookies)
 * - Made all operations synchronous (no VS Code globalState)
 * 
 * DO NOT modify the core logic - it has been tested and is reliable.
 */

import { CookieUtils } from './cookie-utils';
import { Cookie, ICookieService } from './interfaces';

/**
 * In-memory cookie storage
 * Equivalent to plugin's CookieService but without VS Code persistence
 */
export class CookieJar implements ICookieService {
    private cookies: Map<string, Cookie> = new Map();

    /**
     * Generate a unique key for a cookie
     * Same implementation as plugin's CookieService.getCookieKey
     */
    private getCookieKey(name: string, domain?: string, path?: string): string {
        return CookieUtils.cookieKey(name, domain, path);
    }

    /**
     * Get a cookie by name
     * Same implementation as plugin's CookieService.get
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
     * Same implementation as plugin's CookieService.set (minus persistence)
     */
    public set(cookie: Cookie): void {
        const key = this.getCookieKey(cookie.name, cookie.domain, cookie.path);
        this.cookies.set(key, cookie);
    }

    /**
     * Set multiple cookies from a response
     * Same implementation as plugin's CookieService.setFromResponse (minus persistence)
     */
    public setFromResponse(cookies: Cookie[]): void {
        for (const cookie of cookies) {
            const key = this.getCookieKey(cookie.name, cookie.domain, cookie.path);
            this.cookies.set(key, cookie);
        }
    }

    /**
     * Check if a cookie exists
     * Same implementation as plugin's CookieService.has
     */
    public has(name: string, domain?: string): boolean {
        return this.get(name, domain) !== undefined;
    }

    /**
     * Delete a cookie
     * Same implementation as plugin's CookieService.delete (minus persistence)
     */
    public delete(name: string, domain?: string, path?: string): boolean {
        const key = this.getCookieKey(name, domain, path);
        return this.cookies.delete(key);
    }

    /**
     * Get all cookies, optionally filtered by domain
     * Same implementation as plugin's CookieService.getAll
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
     * Same implementation as plugin's CookieService.getCookieHeader
     */
    public getCookieHeader(domain?: string): string {
        const cookies = this.getAll(domain);
        return CookieUtils.formatCookieHeader(cookies);
    }

    /**
     * Clear all cookies
     * Same implementation as plugin's CookieService.clear (minus persistence)
     */
    public clear(): void {
        this.cookies.clear();
    }

    /**
     * Clear cookies for a specific domain
     * Same implementation as plugin's CookieService.clearDomain (minus persistence)
     */
    public clearDomain(domain: string): void {
        const keysToDelete: string[] = [];
        
        for (const [key, cookie] of this.cookies.entries()) {
            if (cookie.domain && this.domainMatches(domain, cookie.domain)) {
                keysToDelete.push(key);
            }
        }
        
        for (const key of keysToDelete) {
            this.cookies.delete(key);
        }
    }

    /**
     * Parse Set-Cookie headers from response
     * Same implementation as plugin's CookieService.parseCookieHeaders
     */
    public parseCookieHeaders(headers: Record<string, string | string[]>, domain?: string): Cookie[] {
        return CookieUtils.parseCookieHeaders(headers, domain);
    }

    /**
     * Check if a cookie is expired
     * Delegates to CookieUtils (same as plugin)
     */
    private isExpired(cookie: Cookie): boolean {
        return CookieUtils.isExpired(cookie);
    }

    /**
     * Check if a domain matches a cookie domain
     * Delegates to CookieUtils (same as plugin)
     */
    private domainMatches(requestDomain: string, cookieDomain: string): boolean {
        return CookieUtils.domainMatches(requestDomain, cookieDomain);
    }

    /**
     * Get cookie count
     * Same as plugin's CookieService.count
     */
    public get count(): number {
        return this.cookies.size;
    }

    /**
     * Clean expired cookies
     * Same implementation as plugin's CookieService.cleanExpiredCookies
     */
    public cleanExpiredCookies(): void {
        const keysToDelete: string[] = [];
        
        for (const [key, cookie] of this.cookies.entries()) {
            if (this.isExpired(cookie)) {
                keysToDelete.push(key);
            }
        }
        
        for (const key of keysToDelete) {
            this.cookies.delete(key);
        }
    }
}
