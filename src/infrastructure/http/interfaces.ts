/**
 * HTTP Request Service Interface
 *
 * Combines HTTP execution (IHttpClient) with URL building (IUrlBuilder).
 * Adds interceptor support for pre/post processing of requests and responses.
 *
 * This is the high-level service interface that consumers use.
 * It delegates to IHttpClient for actual network calls and IUrlBuilder for URL construction.
 */

import { HttpRequestOptions, HttpResponse } from '../../types/types';

/**
 * Full HTTP request service interface.
 * Combines execution + URL building in a single facade.
 */
export interface IHttpRequestService {
    /**
     * Execute an HTTP request with interceptor support.
     */
    execute(options: HttpRequestOptions): Promise<HttpResponse>;

    /**
     * Build a full URL from path with parameter and query substitution.
     * Path is expected to have {{variables}} pre-resolved by caller.
     */
    buildUrl(
        path: string,
        params?: Record<string, string>,
        query?: Record<string, string>
    ): string;
}
