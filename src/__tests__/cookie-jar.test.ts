/**
 * Cookie Jar Tests
 * 
 * Tests for CookieJar in-memory cookie storage
 * Validates that the logic matches the VS Code plugin's CookieService
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { CookieJar } from '../infrastructure/cookie/cookie-jar';
import { Cookie } from '../infrastructure/cookie/interfaces';
import type { PreRequestScriptContext, ResponseContext } from '../infrastructure/script/interfaces';
import { ScriptExecutor } from '../infrastructure/script/script-executor';

describe('CookieJar', () => {
    let jar: CookieJar;

    beforeEach(() => {
        jar = new CookieJar();
    });

    describe('set and get', () => {
        it('should store and retrieve a cookie', () => {
            const cookie: Cookie = { name: 'session', value: 'abc123' };
            jar.set(cookie);
            
            const retrieved = jar.get('session');
            expect(retrieved).toEqual(cookie);
        });

        it('should store cookie with domain', () => {
            const cookie: Cookie = { name: 'session', value: 'abc123', domain: 'example.com' };
            jar.set(cookie);
            
            const retrieved = jar.get('session', 'example.com');
            expect(retrieved).toEqual(cookie);
        });

        it('should return undefined for non-existent cookie', () => {
            expect(jar.get('nonexistent')).toBeUndefined();
        });

        it('should match cookie by subdomain', () => {
            const cookie: Cookie = { name: 'session', value: 'abc123', domain: 'example.com' };
            jar.set(cookie);
            
            const retrieved = jar.get('session', 'api.example.com');
            expect(retrieved).toEqual(cookie);
        });

        it('should not return expired cookies', () => {
            const cookie: Cookie = {
                name: 'session',
                value: 'abc123',
                expires: new Date(Date.now() - 3600000).toUTCString()
            };
            jar.set(cookie);
            
            expect(jar.get('session')).toBeUndefined();
        });
    });

    describe('has', () => {
        it('should return true for existing cookie', () => {
            jar.set({ name: 'session', value: 'abc123' });
            expect(jar.has('session')).toBe(true);
        });

        it('should return false for non-existent cookie', () => {
            expect(jar.has('session')).toBe(false);
        });
    });

    describe('delete', () => {
        it('should delete a cookie', () => {
            jar.set({ name: 'session', value: 'abc123' });
            expect(jar.delete('session')).toBe(true);
            expect(jar.has('session')).toBe(false);
        });

        it('should return false when deleting non-existent cookie', () => {
            expect(jar.delete('nonexistent')).toBe(false);
        });
    });

    describe('getAll', () => {
        it('should return all cookies', () => {
            jar.set({ name: 'session', value: 'abc123' });
            jar.set({ name: 'token', value: 'xyz789' });
            
            const all = jar.getAll();
            expect(all).toHaveLength(2);
        });

        it('should filter by domain', () => {
            jar.set({ name: 'session', value: 'abc123', domain: 'example.com' });
            jar.set({ name: 'token', value: 'xyz789', domain: 'other.com' });
            
            const filtered = jar.getAll('example.com');
            expect(filtered).toHaveLength(1);
            expect(filtered[0].name).toBe('session');
        });

        it('should not return expired cookies', () => {
            jar.set({ name: 'valid', value: 'abc' });
            jar.set({
                name: 'expired',
                value: 'xyz',
                expires: new Date(Date.now() - 3600000).toUTCString()
            });
            
            const all = jar.getAll();
            expect(all).toHaveLength(1);
            expect(all[0].name).toBe('valid');
        });
    });

    describe('getCookieHeader', () => {
        it('should format cookies as header', () => {
            jar.set({ name: 'session', value: 'abc123' });
            jar.set({ name: 'token', value: 'xyz789' });
            
            const header = jar.getCookieHeader();
            expect(header).toBe('session=abc123; token=xyz789');
        });

        it('should filter by domain', () => {
            jar.set({ name: 'session', value: 'abc123', domain: 'example.com' });
            jar.set({ name: 'token', value: 'xyz789', domain: 'other.com' });
            
            const header = jar.getCookieHeader('example.com');
            expect(header).toBe('session=abc123');
        });
    });

    describe('setFromResponse', () => {
        it('should set multiple cookies', () => {
            jar.setFromResponse([
                { name: 'session', value: 'abc123' },
                { name: 'token', value: 'xyz789' }
            ]);
            
            expect(jar.count).toBe(2);
            expect(jar.has('session')).toBe(true);
            expect(jar.has('token')).toBe(true);
        });
    });

    describe('clear', () => {
        it('should clear all cookies', () => {
            jar.set({ name: 'session', value: 'abc123' });
            jar.set({ name: 'token', value: 'xyz789' });
            jar.clear();
            
            expect(jar.count).toBe(0);
        });
    });

    describe('clearDomain', () => {
        it('should clear cookies for specific domain', () => {
            jar.set({ name: 'session', value: 'abc123', domain: 'example.com' });
            jar.set({ name: 'token', value: 'xyz789', domain: 'other.com' });
            jar.clearDomain('example.com');
            
            expect(jar.count).toBe(1);
            expect(jar.has('token', 'other.com')).toBe(true);
        });
    });

    describe('parseCookieHeaders', () => {
        it('should parse Set-Cookie headers', () => {
            const cookies = jar.parseCookieHeaders({
                'set-cookie': ['session=abc123; Domain=example.com', 'token=xyz789']
            });
            
            expect(cookies).toHaveLength(2);
            expect(cookies[0].name).toBe('session');
            expect(cookies[0].domain).toBe('example.com');
            expect(cookies[1].name).toBe('token');
        });
    });

    describe('cleanExpiredCookies', () => {
        it('should remove expired cookies', () => {
            jar.set({ name: 'valid', value: 'abc' });
            jar.set({
                name: 'expired',
                value: 'xyz',
                expires: new Date(Date.now() - 3600000).toUTCString()
            });
            
            jar.cleanExpiredCookies();
            
            expect(jar.count).toBe(1);
            expect(jar.has('valid')).toBe(true);
        });
    });

    describe('count', () => {
        it('should return correct count', () => {
            expect(jar.count).toBe(0);
            
            jar.set({ name: 'session', value: 'abc123' });
            expect(jar.count).toBe(1);
            
            jar.set({ name: 'token', value: 'xyz789' });
            expect(jar.count).toBe(2);
        });
    });

        describe('Postman script compatibility', () => {
                function makeScriptContext(cookieJar: CookieJar): PreRequestScriptContext {
                        return {
                                request: { url: 'https://example.com/api/test', method: 'GET', headers: {}, name: 'test', id: 'req1' },
                                variables: {},
                                environmentVariables: {},
                                globals: {},
                                environmentName: 'dev',
                                cookieJar,
                        } as unknown as PreRequestScriptContext;
                }

                function makeResponseContext(): ResponseContext {
                        return {
                                executedRequest: {
                                        url: 'https://example.com/api/test',
                                        method: 'GET',
                                        headers: {},
                                        body: { type: 'none', content: null },
                                        params: {},
                                        query: {},
                                },
                                status: 200,
                                statusText: 'OK',
                                headers: { 'content-type': 'application/json' },
                                body: '{}',
                                responseTime: 5,
                        };
                }

                it('supports jar.clear(url, callback)', async () => {
                        jar.set({ name: 'session', value: 'abc123', domain: 'example.com' });
                        jar.set({ name: 'other', value: 'xyz789', domain: 'other.com' });

                        const executor = new ScriptExecutor();
                        const session = executor.createRequestSession(makeScriptContext(jar));

                        await session.executePreRequest('// no-op');
                        const result = await session.executePostResponse(`
                                const jar = pm.cookies.jar();
                                jar.clear(pm.request.url, function (error) {
                                    if (error) {
                                        pm.test('clear callback has no error', function () { throw error; });
                                    }
                                });
                        `, makeResponseContext());

                        expect(result.testResults.every((test) => test.passed)).toBe(true);
                        expect(jar.has('session', 'example.com')).toBe(false);
                        expect(jar.has('other', 'other.com')).toBe(true);
                });

                it('supports jar.set/get/unset with URL input', async () => {
                        const executor = new ScriptExecutor();
                        const session = executor.createRequestSession(makeScriptContext(jar));

                        await session.executePreRequest('// no-op');
                        const result = await session.executePostResponse(`
                                const jar = pm.cookies.jar();
                                jar.set(pm.request.url, 'session', 'abc123', function (error) {
                                    if (error) {
                                        pm.test('set callback has no error', function () { throw error; });
                                    }
                                });

                                jar.get(pm.request.url, 'session', function (error, cookie) {
                                    pm.test('get returns cookie', function () {
                                        if (error) throw error;
                                        pm.expect(cookie.value).to.equal('abc123');
                                        pm.expect(cookie.domain).to.equal('example.com');
                                    });
                                });

                                jar.unset(pm.request.url, 'session', function (error) {
                                    if (error) {
                                        pm.test('unset callback has no error', function () { throw error; });
                                    }
                                });
                        `, makeResponseContext());

                        expect(result.testResults.every((test) => test.passed)).toBe(true);
                        expect(jar.has('session', 'example.com')).toBe(false);
                });
        });
});
