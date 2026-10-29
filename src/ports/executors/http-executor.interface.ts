/**
 * HTTP Executor Port - Abstract HTTP execution
 * Hides HTTP client details and interceptors
 * 
 * Implementations: NodeHttpExecutor, FetchHttpExecutor
 */

import { HttpRequest, HttpResponse } from '../../types/types';

/**
 * Execution plan that describes how to prepare and execute an HTTP request
 */
export interface IExecutionPlan {
    request: HttpRequest;
    preScripts?: string[];
    postScripts?: string[];
}

/**
 * HTTP Executor - Handles HTTP request execution with interceptors and middleware
 */
export interface IHttpExecutor {
    /**
     * Prepare request for execution
     * - Apply interceptors
     * - Add cookies
     * - Resolve variables
     */
    prepare(plan: IExecutionPlan): Promise<HttpRequest>;

    /**
     * Execute prepared HTTP request
     * - Send over network
     * - Apply response interceptors
     * - Save cookies
     */
    execute(prepared: HttpRequest): Promise<HttpResponse>;
}
