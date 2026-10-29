/**
 * Persistent Cookie Jar
 * 
 * Adapts an ICookieService to the ICookieJar interface with write-through caching.
 * 
 * - Maintains a local in-memory cache reflecting immediate changes (set/delete).
 * - Allows scripts to read their own cookie modifications within the same execution.
 * - Batches and persists all changes to the underlying ICookieService after execution.
 * 
 * Extracted from extension's request-execution/PersistentCookieJar.ts.
 */

import { ICookieJar } from '../script/interfaces';
import { CookieUtils } from './cookie-utils';
import { Cookie, IAsyncCookieService, ICookieService } from './interfaces';

export class PersistentCookieJar implements ICookieJar {
    /** Local cache that reflects script modifications */
    private localCache: Cookie[] = [];

    /** Track pending operations to batch them after script execution */
    private pendingOperations: Array<{
        type: 'set' | 'delete' | 'clear';
        cookie?: Cookie;
        name?: string;
        domain?: string;
        path?: string;
    }> = [];

    constructor(private cookieService: ICookieService | IAsyncCookieService) {
        // Initialize local cache from the service
        this.localCache = [...cookieService.getAll()];
    }

    get(name: string, domain?: string): Cookie | undefined {
        if (!domain) {
            return this.localCache.find(c => c.name === name);
        }
        return this.localCache.find(c =>
            c.name === name && (!c.domain || c.domain === domain || domain.endsWith(c.domain))
        );
    }

    has(name: string, domain?: string): boolean {
        return this.get(name, domain) !== undefined;
    }

    set(cookie: Cookie): void {
        // Update local cache immediately
        const existingIdx = this.localCache.findIndex(c =>
            c.name === cookie.name && (!cookie.domain || c.domain === cookie.domain)
        );
        if (existingIdx >= 0) {
            this.localCache[existingIdx] = cookie;
        } else {
            this.localCache.push(cookie);
        }

        // Queue for persistence to service
        this.pendingOperations.push({ type: 'set', cookie });
    }

    delete(name: string, domain?: string, path?: string): boolean {
        // Update local cache immediately
        const idx = this.localCache.findIndex(c =>
            c.name === name && (!domain || c.domain === domain || (c.domain && domain.endsWith(c.domain)))
        );
        if (idx >= 0) {
            this.localCache.splice(idx, 1);
        }

        // Queue for persistence to service
        this.pendingOperations.push({ type: 'delete', name, domain, path });
        return true;
    }

    getAll(domain?: string): Cookie[] {
        if (!domain) {
            return [...this.localCache];
        }
        return this.localCache.filter(c => {
            const cookieDomain = c.domain || '';
            return cookieDomain === domain || domain.endsWith(cookieDomain);
        });
    }

    getCookiesForDomain(domain: string): Cookie[] {
        return this.localCache.filter(c => {
            const cookieDomain = c.domain || '';
            return cookieDomain === domain || domain.endsWith(cookieDomain);
        });
    }

    async setCookiesFromResponse(url: string, headers: Record<string, string | string[]>): Promise<void> {
        const domain = new URL(url).hostname;
        const cookies = this.cookieService.parseCookieHeaders(headers, domain);
        if (cookies.length > 0) {
            cookies.forEach(cookie => {
                const existingIdx = this.localCache.findIndex(c =>
                    c.name === cookie.name && c.domain === (cookie.domain || domain)
                );
                if (existingIdx >= 0) {
                    this.localCache[existingIdx] = cookie;
                } else {
                    this.localCache.push(cookie);
                }
            });

            // Persist via service immediately (response cookies bypass batching)
            await this.cookieService.setFromResponse(cookies);
        }
    }

    getCookieHeader(url: string): string | undefined {
        const domain = new URL(url).hostname;
        const path = new URL(url).pathname;
        const matching = this.localCache.filter(c => {
            if (CookieUtils.isExpired(c)) return false;
            if (c.domain && !CookieUtils.domainMatches(domain, c.domain)) return false;
            if (!c.domain) return false;
            if (c.path && !path.startsWith(c.path)) return false;
            return true;
        });
        if (matching.length === 0) return undefined;
        return CookieUtils.formatCookieHeader(matching);
    }

    clear(): void {
        this.localCache = [];
        this.pendingOperations.push({ type: 'clear' });
    }

    /**
     * Flush all pending cookie operations to the underlying service.
     * Should be called after script execution completes.
     */
    async flush(): Promise<void> {
        for (const op of this.pendingOperations) {
            switch (op.type) {
                case 'set':
                    if (op.cookie) {
                        await this.cookieService.set(op.cookie);
                    }
                    break;
                case 'delete':
                    if (op.name) {
                        await this.cookieService.delete(op.name, op.domain, op.path);
                    }
                    break;
                case 'clear':
                    await this.cookieService.clear();
                    break;
            }
        }
        this.pendingOperations = [];
    }
}
