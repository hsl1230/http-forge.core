/**
 * Cookie Utils Tests
 * 
 * Tests for CookieUtils static methods
 * Validates that the logic matches the VS Code plugin implementation
 */

import { describe, expect, it } from 'vitest';
import { CookieUtils } from '../infrastructure/cookie/cookie-utils';

describe('CookieUtils', () => {
    describe('parseSetCookie', () => {
        it('should parse simple cookie', () => {
            const cookie = CookieUtils.parseSetCookie('session=abc123');
            expect(cookie).toEqual({
                name: 'session',
                value: 'abc123',
                domain: undefined
            });
        });

        it('should parse cookie with domain', () => {
            const cookie = CookieUtils.parseSetCookie('session=abc123; Domain=example.com');
            expect(cookie).toEqual({
                name: 'session',
                value: 'abc123',
                domain: 'example.com'
            });
        });

        it('should strip leading dot from domain', () => {
            const cookie = CookieUtils.parseSetCookie('session=abc123; Domain=.example.com');
            expect(cookie?.domain).toBe('example.com');
        });

        it('should parse cookie with all attributes', () => {
            const cookie = CookieUtils.parseSetCookie(
                'session=abc123; Domain=example.com; Path=/api; Expires=Thu, 01 Jan 2030 00:00:00 GMT; Max-Age=3600; HttpOnly; Secure; SameSite=Strict'
            );
            expect(cookie).toEqual({
                name: 'session',
                value: 'abc123',
                domain: 'example.com',
                path: '/api',
                expires: 'Thu, 01 Jan 2030 00:00:00 GMT',
                maxAge: 3600,
                httpOnly: true,
                secure: true,
                sameSite: 'Strict'
            });
        });

        it('should use default domain when provided', () => {
            const cookie = CookieUtils.parseSetCookie('session=abc123', 'api.example.com');
            expect(cookie?.domain).toBe('api.example.com');
        });

        it('should return null for invalid cookie', () => {
            const cookie = CookieUtils.parseSetCookie('invalid');
            expect(cookie).toBeNull();
        });
    });

    describe('parseCookieHeaders', () => {
        it('should parse single cookie header', () => {
            const cookies = CookieUtils.parseCookieHeaders({
                'set-cookie': 'session=abc123'
            });
            expect(cookies).toHaveLength(1);
            expect(cookies[0].name).toBe('session');
        });

        it('should parse multiple cookie headers', () => {
            const cookies = CookieUtils.parseCookieHeaders({
                'set-cookie': ['session=abc123', 'token=xyz789']
            });
            expect(cookies).toHaveLength(2);
            expect(cookies[0].name).toBe('session');
            expect(cookies[1].name).toBe('token');
        });

        it('should handle case-insensitive header name', () => {
            const cookies = CookieUtils.parseCookieHeaders({
                'Set-Cookie': 'session=abc123'
            });
            expect(cookies).toHaveLength(1);
        });

        it('should return empty array when no cookies', () => {
            const cookies = CookieUtils.parseCookieHeaders({});
            expect(cookies).toHaveLength(0);
        });
    });

    describe('formatCookieHeader', () => {
        it('should format single cookie', () => {
            const header = CookieUtils.formatCookieHeader([
                { name: 'session', value: 'abc123' }
            ]);
            expect(header).toBe('session=abc123');
        });

        it('should format multiple cookies', () => {
            const header = CookieUtils.formatCookieHeader([
                { name: 'session', value: 'abc123' },
                { name: 'token', value: 'xyz789' }
            ]);
            expect(header).toBe('session=abc123; token=xyz789');
        });

        it('should return empty string for no cookies', () => {
            const header = CookieUtils.formatCookieHeader([]);
            expect(header).toBe('');
        });
    });

    describe('isExpired', () => {
        it('should return false for non-expired cookie', () => {
            const cookie = {
                name: 'session',
                value: 'abc',
                expires: new Date(Date.now() + 3600000).toUTCString()
            };
            expect(CookieUtils.isExpired(cookie)).toBe(false);
        });

        it('should return true for expired cookie', () => {
            const cookie = {
                name: 'session',
                value: 'abc',
                expires: new Date(Date.now() - 3600000).toUTCString()
            };
            expect(CookieUtils.isExpired(cookie)).toBe(true);
        });

        it('should return true for maxAge <= 0', () => {
            const cookie = { name: 'session', value: 'abc', maxAge: 0 };
            expect(CookieUtils.isExpired(cookie)).toBe(true);
        });

        it('should return false for cookie without expiry', () => {
            const cookie = { name: 'session', value: 'abc' };
            expect(CookieUtils.isExpired(cookie)).toBe(false);
        });
    });

    describe('domainMatches', () => {
        it('should match exact domain', () => {
            expect(CookieUtils.domainMatches('example.com', 'example.com')).toBe(true);
        });

        it('should match wildcard domain', () => {
            expect(CookieUtils.domainMatches('example.com', '*')).toBe(true);
        });

        it('should match subdomain', () => {
            expect(CookieUtils.domainMatches('api.example.com', 'example.com')).toBe(true);
        });

        it('should match deep subdomain', () => {
            expect(CookieUtils.domainMatches('api.v1.example.com', 'example.com')).toBe(true);
        });

        it('should not match different domain', () => {
            expect(CookieUtils.domainMatches('other.com', 'example.com')).toBe(false);
        });

        it('should not match when cookie domain is more specific', () => {
            expect(CookieUtils.domainMatches('example.com', 'api.example.com')).toBe(false);
        });

        it('should be case insensitive', () => {
            expect(CookieUtils.domainMatches('API.Example.COM', 'example.com')).toBe(true);
        });
    });

    describe('extractDomain', () => {
        it('should extract domain from URL', () => {
            expect(CookieUtils.extractDomain('https://api.example.com/path')).toBe('api.example.com');
        });

        it('should return empty string for invalid URL', () => {
            expect(CookieUtils.extractDomain('not-a-url')).toBe('');
        });
    });

    describe('extractPath', () => {
        it('should extract path from URL', () => {
            expect(CookieUtils.extractPath('https://example.com/api/users')).toBe('/api/users');
        });

        it('should return / for invalid URL', () => {
            expect(CookieUtils.extractPath('not-a-url')).toBe('/');
        });
    });
});
