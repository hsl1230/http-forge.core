/**
 * Request/Response Interceptors
 * 
 * Extracted 100% from VS Code plugin: src/services/interceptors.ts
 * 
 * Open/Closed Principle: New interceptors can be added without modifying existing code
 * 
 * DO NOT modify the core logic - it has been tested and is reliable.
 * 
 * This module provides extension points for:
 * - Pre-request processing (modify request before sending)
 * - Post-response processing (modify response after receiving)
 * - Error handling
 */

import { HttpRequest, HttpResponse } from '../../types/types';

/**
 * Context passed to interceptors
 * Same as plugin's InterceptorContext
 */
export interface InterceptorContext {
    /**
     * Current environment name
     */
    environment?: string;

    /**
     * Collection ID if request is from a collection
     */
    collectionId?: string;

    /**
     * Request ID if request is from a collection
     */
    requestId?: string;

    /**
     * Additional metadata
     */
    metadata?: Record<string, any>;
}

/**
 * Request interceptor interface
 * Same as plugin's IRequestInterceptor
 * Implement this to modify requests before they are sent
 */
export interface IRequestInterceptor {
    /**
     * Unique name for this interceptor
     */
    readonly name: string;

    /**
     * Priority (lower = runs first)
     */
    readonly priority?: number;

    /**
     * Intercept and optionally modify the request
     * Return the modified options or the original options
     * Throw an error to abort the request
     */
    intercept(
        request: HttpRequest,
        context: InterceptorContext
    ): Promise<HttpRequest> | HttpRequest;
}

/**
 * Response interceptor interface
 * Same as plugin's IResponseInterceptor
 * Implement this to modify responses after they are received
 */
export interface IResponseInterceptor {
    /**
     * Unique name for this interceptor
     */
    readonly name: string;

    /**
     * Priority (lower = runs first)
     */
    readonly priority?: number;

    /**
     * Intercept and optionally modify the response
     * Return the modified response or the original response
     * Throw an error to indicate response processing failure
     */
    intercept(
        response: HttpResponse,
        request: HttpRequest,
        context: InterceptorContext
    ): Promise<HttpResponse> | HttpResponse;
}

/**
 * Error interceptor interface
 * Same as plugin's IErrorInterceptor
 * Implement this to handle errors during request/response processing
 */
export interface IErrorInterceptor {
    /**
     * Unique name for this interceptor
     */
    readonly name: string;

    /**
     * Priority (lower = runs first)
     */
    readonly priority?: number;

    /**
     * Handle an error
     * Can return a response to recover, or re-throw to propagate
     */
    handle(
        error: Error,
        request: HttpRequest,
        context: InterceptorContext
    ): Promise<HttpResponse | void> | HttpResponse | void;
}

/**
 * Interceptor registry interface
 * Defines the contract for managing registered interceptors.
 * Consumers that only register/interrogate interceptors depend on this
 * narrow interface instead of the full chain.
 */
export interface IInterceptorRegistry {
    /**
     * Register a request interceptor
     */
    addRequestInterceptor(interceptor: IRequestInterceptor): this;

    /**
     * Register a response interceptor
     */
    addResponseInterceptor(interceptor: IResponseInterceptor): this;

    /**
     * Register an error interceptor
     */
    addErrorInterceptor(interceptor: IErrorInterceptor): this;

    /**
     * Remove a request interceptor by name
     */
    removeRequestInterceptor(name: string): boolean;

    /**
     * Remove a response interceptor by name
     */
    removeResponseInterceptor(name: string): boolean;

    /**
     * Remove an error interceptor by name
     */
    removeErrorInterceptor(name: string): boolean;

    /**
     * Clear all interceptors
     */
    clear(): void;

    /**
     * Get registered interceptor names
     */
    getRegisteredInterceptors(): {
        request: string[];
        response: string[];
        error: string[];
    };
}

/**
 * Interceptor executor interface
 * Defines the contract for running the interceptor pipeline.
 * Consumers that only execute interceptors depend on this narrow interface
 * instead of the full chain.
 */
export interface IInterceptorExecutor {
    /**
     * Execute request interceptors
     */
    executeRequestInterceptors(
        request: HttpRequest,
        context: InterceptorContext
    ): Promise<HttpRequest>;

    /**
     * Execute response interceptors
     */
    executeResponseInterceptors(
        response: HttpResponse,
        request: HttpRequest,
        context: InterceptorContext
    ): Promise<HttpResponse>;

    /**
     * Execute error interceptors
     */
    executeErrorInterceptors(
        error: Error,
        request: HttpRequest,
        context: InterceptorContext
    ): Promise<HttpResponse | undefined>;
}

/**
 * Interceptor chain interface
 * Same as plugin's IInterceptorChain
 * Defines the full contract for managing and executing interceptors.
 * Segregated into IInterceptorRegistry (management) and
 * IInterceptorExecutor (execution); this type composes both so existing
 * consumers keep a single, complete dependency.
 */
export interface IInterceptorChain extends IInterceptorRegistry, IInterceptorExecutor {}

/**
 * Interceptor chain manager
 * Same implementation as plugin's InterceptorChain class
 * 
 * Manages registration and execution of interceptors
 * Open/Closed: New interceptors can be registered without modifying this class
 */
export class InterceptorChain implements IInterceptorChain {
    private requestInterceptors: IRequestInterceptor[] = [];
    private responseInterceptors: IResponseInterceptor[] = [];
    private errorInterceptors: IErrorInterceptor[] = [];

    /**
     * Register a request interceptor
     * Same implementation as plugin
     */
    public addRequestInterceptor(interceptor: IRequestInterceptor): this {
        this.requestInterceptors.push(interceptor);
        this.sortByPriority(this.requestInterceptors);
        return this;
    }

    /**
     * Register a response interceptor
     * Same implementation as plugin
     */
    public addResponseInterceptor(interceptor: IResponseInterceptor): this {
        this.responseInterceptors.push(interceptor);
        this.sortByPriority(this.responseInterceptors);
        return this;
    }

    /**
     * Register an error interceptor
     * Same implementation as plugin
     */
    public addErrorInterceptor(interceptor: IErrorInterceptor): this {
        this.errorInterceptors.push(interceptor);
        this.sortByPriority(this.errorInterceptors);
        return this;
    }

    /**
     * Remove a request interceptor by name
     * Same implementation as plugin
     */
    public removeRequestInterceptor(name: string): boolean {
        const index = this.requestInterceptors.findIndex(i => i.name === name);
        if (index >= 0) {
            this.requestInterceptors.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Remove a response interceptor by name
     * Same implementation as plugin
     */
    public removeResponseInterceptor(name: string): boolean {
        const index = this.responseInterceptors.findIndex(i => i.name === name);
        if (index >= 0) {
            this.responseInterceptors.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Remove an error interceptor by name
     * Same implementation as plugin
     */
    public removeErrorInterceptor(name: string): boolean {
        const index = this.errorInterceptors.findIndex(i => i.name === name);
        if (index >= 0) {
            this.errorInterceptors.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Execute request interceptors
     * Same implementation as plugin
     */
    public async executeRequestInterceptors(
        request: HttpRequest,
        context: InterceptorContext
    ): Promise<HttpRequest> {
        let result = request;
        
        for (const interceptor of this.requestInterceptors) {
            try {
                result = await interceptor.intercept(result, context);
            } catch (error) {
                console.error(`[InterceptorChain] Request interceptor '${interceptor.name}' failed:`, error);
                throw error;
            }
        }
        
        return result;
    }

    /**
     * Execute response interceptors
     * Same implementation as plugin
     */
    public async executeResponseInterceptors(
        response: HttpResponse,
        request: HttpRequest,
        context: InterceptorContext
    ): Promise<HttpResponse> {
        let result = response;
        
        for (const interceptor of this.responseInterceptors) {
            try {
                result = await interceptor.intercept(result, request, context);
            } catch (error) {
                console.error(`[InterceptorChain] Response interceptor '${interceptor.name}' failed:`, error);
                throw error;
            }
        }
        
        return result;
    }

    /**
     * Execute error interceptors
     * Same implementation as plugin
     * Returns a response if any interceptor recovers, undefined otherwise
     */
    public async executeErrorInterceptors(
        error: Error,
        request: HttpRequest,
        context: InterceptorContext
    ): Promise<HttpResponse | undefined> {
        for (const interceptor of this.errorInterceptors) {
            try {
                const result = await interceptor.handle(error, request, context);
                if (result) {
                    return result; // Interceptor recovered with a response
                }
            } catch (e) {
                console.error(`[InterceptorChain] Error interceptor '${interceptor.name}' failed:`, e);
                // Continue to next interceptor
            }
        }
        
        return undefined;
    }

    /**
     * Clear all interceptors
     * Same implementation as plugin
     */
    public clear(): void {
        this.requestInterceptors = [];
        this.responseInterceptors = [];
        this.errorInterceptors = [];
    }

    /**
     * Get registered interceptor names (for debugging)
     * Same implementation as plugin
     */
    public getRegisteredInterceptors(): {
        request: string[];
        response: string[];
        error: string[];
    } {
        return {
            request: this.requestInterceptors.map(i => i.name),
            response: this.responseInterceptors.map(i => i.name),
            error: this.errorInterceptors.map(i => i.name)
        };
    }

    /**
     * Sort interceptors by priority
     * Same implementation as plugin
     */
    private sortByPriority<T extends { priority?: number }>(interceptors: T[]): void {
        interceptors.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    }
}

// ========================================
// Built-in interceptors (examples)
// Same as plugin's built-in interceptors
// ========================================

/**
 * Logging request interceptor
 * Logs all outgoing requests
 */
export class LoggingRequestInterceptor implements IRequestInterceptor {
    readonly name = 'logging';
    readonly priority = 1000; // Run last

    intercept(request: HttpRequest, _context: InterceptorContext): HttpRequest {
        // Logging disabled by default - consumers can override
        return request;
    }
}

/**
 * Timing response interceptor
 * Adds timing information to response metadata
 */
export class TimingResponseInterceptor implements IResponseInterceptor {
    readonly name = 'timing';
    readonly priority = 1;

    intercept(response: HttpResponse, _request: HttpRequest, _context: InterceptorContext): HttpResponse {
        return response;
    }
}

/**
 * Retry error interceptor
 * Can retry failed requests (example implementation)
 */
export class RetryErrorInterceptor implements IErrorInterceptor {
    readonly name = 'retry';
    readonly priority = 1;

    private maxRetries: number;
    private retryableErrors: string[];

    constructor(maxRetries = 3, retryableErrors = ['ECONNRESET', 'ETIMEDOUT']) {
        this.maxRetries = maxRetries;
        this.retryableErrors = retryableErrors;
    }

    handle(error: Error, _request: HttpRequest, _context: InterceptorContext): void {
        // This is an example - actual retry logic would need access to the HTTP executor
        const isRetryable = this.retryableErrors.some(e => error.message.includes(e));
        
        if (isRetryable) {
            // In a real implementation, you'd track retry count in context.metadata
            // and re-execute the request
        }
        
        // Don't recover - let the error propagate
        return;
    }
}
