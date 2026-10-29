/**
 * Cookie Utilities
 * 
 * Extracted 100% from VS Code plugin: src/services/cookie-utils.ts
 * DO NOT modify the core logic - it has been tested and is reliable.
 * 
 * Single Responsibility: Cookie parsing, formatting, and validation
 */

import { Cookie } from './interfaces';

export class CookieUtils {
    /**
     * Parse a single Set-Cookie header value
     * 
     * Implementation extracted 100% from plugin's CookieUtils.parseSetCookie
     * 
     * @param cookieStr - Set-Cookie header value
     * @param defaultDomain - Domain to use if not specified in cookie
     * @returns Parsed cookie or null if invalid
     */
    static parseSetCookie(cookieStr: string, defaultDomain?: string): Cookie | null {
        const parts = cookieStr.split(';').map(p => p.trim());
        if (parts.length === 0) return null;
        
        const [nameValue, ...attributes] = parts;
        const eqIndex = nameValue.indexOf('=');
        if (eqIndex === -1) return null;
        
        const name = nameValue.substring(0, eqIndex).trim();
        const value = nameValue.substring(eqIndex + 1).trim();
        
        const cookie: Cookie = {
            name,
            value,
            domain: defaultDomain
        };
        
        for (const attr of attributes) {
            const attrEqIndex = attr.indexOf('=');
            const attrName = (attrEqIndex === -1 ? attr : attr.substring(0, attrEqIndex)).toLowerCase();
            const attrValue = attrEqIndex === -1 ? '' : attr.substring(attrEqIndex + 1);
            
            switch (attrName) {
                case 'domain':
                    cookie.domain = attrValue.startsWith('.') ? attrValue.substring(1) : attrValue;
                    break;
                case 'path':
                    cookie.path = attrValue;
                    break;
                case 'expires':
                    cookie.expires = attrValue;
                    break;
                case 'max-age':
                    cookie.maxAge = parseInt(attrValue, 10);
                    break;
                case 'httponly':
                    cookie.httpOnly = true;
                    break;
                case 'secure':
                    cookie.secure = true;
                    break;
                case 'samesite':
                    cookie.sameSite = attrValue as 'Strict' | 'Lax' | 'None';
                    break;
            }
        }
        
        return cookie;
    }

    /**
     * Parse Set-Cookie headers from response
     * 
     * Implementation extracted 100% from plugin's CookieUtils.parseCookieHeaders
     * 
     * @param headers - Response headers
     * @param defaultDomain - Domain to use for cookies without domain attribute
     * @returns Array of parsed cookies
     */
    static parseCookieHeaders(headers: Record<string, string | string[]>, defaultDomain?: string): Cookie[] {
        const cookies: Cookie[] = [];
        const setCookieHeaders = headers['set-cookie'] || headers['Set-Cookie'];
        
        if (!setCookieHeaders) {
            return cookies;
        }
        
        const cookieStrings = Array.isArray(setCookieHeaders) 
            ? setCookieHeaders 
            : [setCookieHeaders];
        
        for (const cookieStr of cookieStrings) {
            const cookie = this.parseSetCookie(cookieStr, defaultDomain);
            if (cookie) {
                cookies.push(cookie);
            }
        }
        
        return cookies;
    }

    /**
     * Format cookies as HTTP Cookie header value
     * 
     * Implementation extracted 100% from plugin's CookieUtils.formatCookieHeader
     * 
     * @param cookies - Cookies to format
     * @returns Cookie header value (e.g., "name1=value1; name2=value2")
     */
    static formatCookieHeader(cookies: Cookie[]): string {
        return cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }

    /**
     * Generate the unique storage key for a cookie
     * (domain|path|name, with wildcard defaults)
     */
    static cookieKey(name: string, domain?: string, path?: string): string {
        return `${domain || '*'}|${path || '/'}|${name}`;
    }

    /**
     * Check if a cookie is expired
     * 
     * Implementation extracted 100% from plugin's CookieUtils.isExpired
     * 
     * @param cookie - Cookie to check
     * @returns true if expired, false otherwise
     */
    static isExpired(cookie: Cookie): boolean {
        if (cookie.expires) {
            const expiresDate = new Date(cookie.expires);
            if (expiresDate.getTime() < Date.now()) {
                return true;
            }
        }
        
        if (cookie.maxAge !== undefined && cookie.maxAge <= 0) {
            return true;
        }
        
        return false;
    }

    /**
     * Check if a request domain matches a cookie domain
     * 
     * Implementation extracted 100% from plugin's CookieUtils.domainMatches
     * 
     * @param requestDomain - Domain of the request (e.g., "api.example.com")
     * @param cookieDomain - Domain of the cookie (e.g., "example.com" or "*")
     * @returns true if the cookie should be sent with the request
     */
    static domainMatches(requestDomain: string, cookieDomain: string): boolean {
        if (cookieDomain === '*') return true;
        
        const reqParts = requestDomain.toLowerCase().split('.').reverse();
        const cookieParts = cookieDomain.toLowerCase().split('.').reverse();
        
        if (cookieParts.length > reqParts.length) return false;
        
        for (let i = 0; i < cookieParts.length; i++) {
            if (cookieParts[i] !== reqParts[i]) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * Extract domain from URL
     * 
     * Implementation extracted 100% from plugin's CookieUtils.extractDomain
     * 
     * @param url - URL to extract domain from
     * @returns Domain (hostname) or empty string if invalid URL
     */
    static extractDomain(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            return '';
        }
    }

    /**
     * Extract path from URL
     * 
     * Implementation extracted 100% from plugin's CookieUtils.extractPath
     * 
     * @param url - URL to extract path from
     * @returns Path or '/' if invalid URL
     */
    static extractPath(url: string): string {
        try {
            return new URL(url).pathname;
        } catch {
            return '/';
        }
    }
}
