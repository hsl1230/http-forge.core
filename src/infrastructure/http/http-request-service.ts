/**
 * HTTP Request Service
 *
 * High-level facade that orchestrates HTTP request execution through:
 * - Request interceptors (pre-processing)
 * - HTTP client (actual network call)
 * - Response interceptors (post-processing)
 * - Error interceptors (error recovery)
 * - URL building (path param + query param substitution)
 *
 * Extracted from extension's http-request-service.ts.
 *
 * SOLID:
 * - Single Responsibility: Orchestrates HTTP requests via interceptors
 * - Open/Closed: Extended through interceptor chain
 * - Dependency Inversion: Depends on IHttpClient, IUrlBuilder, IInterceptorExecutor, IRequestPreprocessor
 */

import type { IHttpClient } from '../../types/platform';
import { HttpRequestOptions, HttpResponse } from '../../types/types';
import { IInterceptorExecutor, InterceptorContext } from './interceptor-chain';
import { IHttpRequestService } from './interfaces';
import { IUrlBuilder } from './url-builder';

export class HttpRequestService implements IHttpRequestService {
    constructor(
        private readonly urlBuilder: IUrlBuilder,
        private readonly interceptors: IInterceptorExecutor,
        private readonly httpClient: IHttpClient
    ) {}

    /**
     * Execute an HTTP request with interceptor support.
     */
    public async execute(options: HttpRequestOptions): Promise<HttpResponse> {
        if (/^wss?:\/\//i.test(options.url)) {
            throw new Error('WebSocket requests must be executed through the WebSocket client');
        }

        // Execute request interceptors
        const context: InterceptorContext = {};
        let processedOptions: HttpRequestOptions;

        try {
            processedOptions = await this.interceptors.executeRequestInterceptors(options, context);
        } catch (error) {
            const recovered = await this.interceptors.executeErrorInterceptors(error as Error, options, context);
            if (recovered) {
                return recovered;
            }
            throw error;
        }

        try {
            // Delegate to HTTP client
            const response = await this.httpClient.send(processedOptions);

            // Execute response interceptors
            return await this.interceptors.executeResponseInterceptors(response, processedOptions, context);
        } catch (error) {
            const recovered = await this.interceptors.executeErrorInterceptors(error as Error, processedOptions, context);
            if (recovered) {
                return recovered;
            }
            throw error;
        }
    }

    /**
     * Build full URL from URL pattern, params, and query.
     */
    public buildUrl(
        urlPattern: string,
        params: Record<string, string> = {},
        query: Record<string, string> = {}
    ): string {
        return this.urlBuilder.buildUrl(urlPattern, params, query);
    }
}
