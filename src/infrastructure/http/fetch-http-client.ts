/**
 * Fetch HTTP Client Implementation
 * 
 * Single Responsibility: Execute HTTP requests using fetch API
 * Dependency Inversion: Implements IHttpClient interface
 */

import { IHttpClient } from '../../types/platform';
import { HttpRequest, HttpResponse } from '../../types/types';

/**
 * HTTP client implementation using Node.js native fetch.
 * Requires Node.js 18+.
 */
export class FetchHttpClient implements IHttpClient {
    /**
     * Send an HTTP request
     */
    async send(request: HttpRequest): Promise<HttpResponse> {
        const startTime = Date.now();
        
        const controller = new AbortController();
        const timeout = request.timeout ?? 30000;
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const fetchOptions: RequestInit = {
                method: request.method,
                headers: request.headers,
                signal: controller.signal,
            };

            // Add body if present (all methods allowed per RFC 9110)
            if (request.body !== undefined) {
                if (typeof request.body === 'string') {
                    fetchOptions.body = request.body;
                } else if (request.body instanceof FormData) {
                    fetchOptions.body = request.body;
                } else if (request.body instanceof URLSearchParams) {
                    fetchOptions.body = request.body;
                } else if (typeof request.body === 'object') {
                    fetchOptions.body = JSON.stringify(request.body);
                    // Ensure Content-Type is set for JSON
                    if (!request.headers?.['Content-Type'] && !request.headers?.['content-type']) {
                        (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
                    }
                }
            }

            // Handle redirects based on settings
            if (request.settings?.followRedirects === false) {
                fetchOptions.redirect = 'manual';
            }

            const response = await fetch(request.url, fetchOptions);
            const endTime = Date.now();

            // Keep the raw response body as a string (Postman-compatible).
            // Scripts parse on demand via response.json(); eager parsing is
            // intentionally avoided so `response.body` matches Postman.
            let body: any;
            try {
                body = await response.text();
            } catch {
                body = null;
            }

            // Convert headers to plain object
            const headers: Record<string, string | string[]> = {};
            response.headers.forEach((value, key) => {
                const existing = headers[key];
                if (existing !== undefined) {
                    headers[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
                } else {
                    headers[key] = value;
                }
            });

            return {
                status: response.status,
                statusText: response.statusText,
                headers,
                cookies: [],
                body,
                time: endTime - startTime,
            };
        } catch (error: any) {
            // Handle abort/timeout
            if (error.name === 'AbortError') {
                throw new Error(`Request timeout after ${timeout}ms`);
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
