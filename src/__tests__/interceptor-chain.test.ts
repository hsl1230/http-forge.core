/**
 * Interceptor Chain Tests
 * 
 * Tests for InterceptorChain implementation
 * Validates that the logic matches the VS Code plugin's InterceptorChain
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    IErrorInterceptor,
    InterceptorChain,
    IRequestInterceptor,
    IResponseInterceptor
} from '../infrastructure/http/interceptor-chain';
import { HttpRequest, HttpResponse } from '../types/types';

describe('InterceptorChain', () => {
    let chain: InterceptorChain;

    beforeEach(() => {
        chain = new InterceptorChain();
    });

    describe('addRequestInterceptor', () => {
        it('should add request interceptor', () => {
            const interceptor: IRequestInterceptor = {
                name: 'test',
                intercept: (req) => req
            };
            chain.addRequestInterceptor(interceptor);
            
            const registered = chain.getRegisteredInterceptors();
            expect(registered.request).toContain('test');
        });

        it('should sort by priority', () => {
            chain.addRequestInterceptor({ name: 'low', priority: 100, intercept: (req) => req });
            chain.addRequestInterceptor({ name: 'high', priority: 1, intercept: (req) => req });
            chain.addRequestInterceptor({ name: 'mid', priority: 50, intercept: (req) => req });
            
            const registered = chain.getRegisteredInterceptors();
            expect(registered.request).toEqual(['high', 'mid', 'low']);
        });
    });

    describe('addResponseInterceptor', () => {
        it('should add response interceptor', () => {
            const interceptor: IResponseInterceptor = {
                name: 'test',
                intercept: (res) => res
            };
            chain.addResponseInterceptor(interceptor);
            
            const registered = chain.getRegisteredInterceptors();
            expect(registered.response).toContain('test');
        });
    });

    describe('addErrorInterceptor', () => {
        it('should add error interceptor', () => {
            const interceptor: IErrorInterceptor = {
                name: 'test',
                handle: () => {}
            };
            chain.addErrorInterceptor(interceptor);
            
            const registered = chain.getRegisteredInterceptors();
            expect(registered.error).toContain('test');
        });
    });

    describe('removeRequestInterceptor', () => {
        it('should remove interceptor by name', () => {
            chain.addRequestInterceptor({ name: 'test', intercept: (req) => req });
            expect(chain.removeRequestInterceptor('test')).toBe(true);
            
            const registered = chain.getRegisteredInterceptors();
            expect(registered.request).not.toContain('test');
        });

        it('should return false for non-existent interceptor', () => {
            expect(chain.removeRequestInterceptor('nonexistent')).toBe(false);
        });
    });

    describe('executeRequestInterceptors', () => {
        it('should execute interceptors in order', async () => {
            const order: string[] = [];
            
            chain.addRequestInterceptor({
                name: 'first',
                priority: 1,
                intercept: (req) => {
                    order.push('first');
                    return req;
                }
            });
            chain.addRequestInterceptor({
                name: 'second',
                priority: 2,
                intercept: (req) => {
                    order.push('second');
                    return req;
                }
            });
            
            const request: HttpRequest = { method: 'GET', url: 'http://example.com', headers: {} };
            await chain.executeRequestInterceptors(request, {});
            
            expect(order).toEqual(['first', 'second']);
        });

        it('should pass modified request to next interceptor', async () => {
            chain.addRequestInterceptor({
                name: 'modifier',
                intercept: (req) => ({
                    ...req,
                    headers: { ...req.headers, 'X-Custom': 'value' }
                })
            });
            
            const request: HttpRequest = { method: 'GET', url: 'http://example.com', headers: {} };
            const result = await chain.executeRequestInterceptors(request, {});
            
            expect(result.headers!['X-Custom']).toBe('value');
        });

        it('should handle async interceptors', async () => {
            chain.addRequestInterceptor({
                name: 'async',
                intercept: async (req) => {
                    await new Promise(resolve => setTimeout(resolve, 10));
                    return { ...req, headers: { ...req.headers, 'X-Async': 'true' } };
                }
            });
            
            const request: HttpRequest = { method: 'GET', url: 'http://example.com', headers: {} };
            const result = await chain.executeRequestInterceptors(request, {});
            
            expect(result.headers!['X-Async']).toBe('true');
        });

        it('should propagate errors', async () => {
            chain.addRequestInterceptor({
                name: 'error',
                intercept: () => {
                    throw new Error('Test error');
                }
            });
            
            const request: HttpRequest = { method: 'GET', url: 'http://example.com', headers: {} };
            
            await expect(chain.executeRequestInterceptors(request, {})).rejects.toThrow('Test error');
        });
    });

    describe('executeResponseInterceptors', () => {
        it('should execute interceptors in order', async () => {
            const order: string[] = [];
            
            chain.addResponseInterceptor({
                name: 'first',
                priority: 1,
                intercept: (res) => {
                    order.push('first');
                    return res;
                }
            });
            chain.addResponseInterceptor({
                name: 'second',
                priority: 2,
                intercept: (res) => {
                    order.push('second');
                    return res;
                }
            });
            
            const response: HttpResponse = { status: 200, statusText: 'OK', headers: {}, body: null, time: 100, cookies: [] };
            const request: HttpRequest = { method: 'GET', url: 'http://example.com', headers: {} };
            await chain.executeResponseInterceptors(response, request, {});
            
            expect(order).toEqual(['first', 'second']);
        });

        it('should pass modified response to next interceptor', async () => {
            chain.addResponseInterceptor({
                name: 'modifier',
                intercept: (res) => ({
                    ...res,
                    body: { modified: true }
                })
            });
            
            const response: HttpResponse = { status: 200, statusText: 'OK', headers: {}, body: null, time: 100, cookies: [] };
            const request: HttpRequest = { method: 'GET', url: 'http://example.com', headers: {} };
            const result = await chain.executeResponseInterceptors(response, request, {});
            
            expect(result.body).toEqual({ modified: true });
        });
    });

    describe('executeErrorInterceptors', () => {
        it('should execute error interceptors', async () => {
            const handled = vi.fn();
            
            chain.addErrorInterceptor({
                name: 'handler',
                handle: (error) => {
                    handled(error.message);
                }
            });
            
            const error = new Error('Test error');
            const request: HttpRequest = { method: 'GET', url: 'http://example.com', headers: {} };
            await chain.executeErrorInterceptors(error, request, {});
            
            expect(handled).toHaveBeenCalledWith('Test error');
        });

        it('should return response from recovering interceptor', async () => {
            chain.addErrorInterceptor({
                name: 'recoverer',
                handle: () => ({
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    body: { recovered: true },
                    time: 0,
                    cookies: []
                })
            });
            
            const error = new Error('Test error');
            const request: HttpRequest = { method: 'GET', url: 'http://example.com', headers: {} };
            const result = await chain.executeErrorInterceptors(error, request, {});
            
            expect(result?.body).toEqual({ recovered: true });
        });

        it('should return undefined if no interceptor recovers', async () => {
            chain.addErrorInterceptor({
                name: 'non-recoverer',
                handle: () => {}
            });
            
            const error = new Error('Test error');
            const request: HttpRequest = { method: 'GET', url: 'http://example.com', headers: {} };
            const result = await chain.executeErrorInterceptors(error, request, {});
            
            expect(result).toBeUndefined();
        });
    });

    describe('clear', () => {
        it('should clear all interceptors', () => {
            chain.addRequestInterceptor({ name: 'req', intercept: (req) => req });
            chain.addResponseInterceptor({ name: 'res', intercept: (res) => res });
            chain.addErrorInterceptor({ name: 'err', handle: () => {} });
            
            chain.clear();
            
            const registered = chain.getRegisteredInterceptors();
            expect(registered.request).toHaveLength(0);
            expect(registered.response).toHaveLength(0);
            expect(registered.error).toHaveLength(0);
        });
    });
});
