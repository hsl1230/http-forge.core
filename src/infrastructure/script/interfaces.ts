/**
 * Script Execution Interfaces
 * 
 * Defines abstractions for the session-based script execution architecture.
 * Matches the VS Code extension's interfaces for consistency.
 * 
 * Dependency Inversion: Define abstractions for request execution components
 * Interface Segregation: Each interface has a focused purpose
 */

import { PreparedRequest, RequestAuth, RequestBody, RequestScripts, RequestSettings, ScriptInfo, TestAssertion } from '../../types/types';
import { Cookie } from '../cookie/interfaces';

export type { Cookie, ScriptInfo };

/**
 * Cookie Jar Interface
 * Single Responsibility: Manage cookies for HTTP requests
 */
export interface ICookieJar {
    get(name: string, domain?: string): Cookie | undefined;
    getCookiesForDomain(domain: string): Cookie[];
    getAll(domain?: string): Cookie[];
    has(name: string, domain?: string): boolean;
    set(cookie: Cookie): void;
    delete(name: string, domain?: string, path?: string): boolean;
    setCookiesFromResponse(url: string, headers: Record<string, string | string[]>): void;
    getCookieHeader(url: string): string | undefined;
    clear(): void;
    clearDomain?(domain: string): void;
    flush?(): Promise<void>;
}

/**
 * Request context for test scripts
 */
export interface RequestContext {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: RequestBody | null;
    bodyContentType?: string;
    params?: Record<string, string>;
    query?: Record<string, string>;
    settings?: RequestSettings;
    scripts?: RequestScripts;
    auth?: RequestAuth;
}

/**
 * Response context for test scripts
 */
export interface ResponseContext {
    executedRequest: PreparedRequest;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    /** Raw response body string (Postman-compatible). Parse on demand via response.json(). */
    body: any;
    /**
     * Response cookies parsed from Set-Cookie headers, including metadata such as
     * domain, path, expires, maxAge, httpOnly, secure and sameSite. Exposed to
     * scripts as the Postman-compatible `pm.response.cookies` CookieList.
     */
    cookies?: Cookie[];
    responseTime?: number;
    responseSize?: number;
}

/**
 * Common script execution context (shared between pre-request and test scripts)
 */
export interface CommonScriptContext {
    variables: Record<string, string>;
    collectionVariables?: Record<string, string>;
    globals?: Record<string, string>;
    environmentVariables?: Record<string, string>;
    environmentName?: string;
    sendRequest?: (options: any) => Promise<any>;
    info?: ScriptInfo;
    iteration?: number;
    iterationCount?: number;
    iterationData?: Record<string, any>;
    onEnvironmentChange?: (action: 'set' | 'unset' | 'clear', key?: string, value?: string) => void;
    onGlobalsChange?: (action: 'set' | 'unset' | 'clear', key?: string, value?: string) => void;
}

/**
 * Script execution context for pre-request scripts
 */
export interface PreRequestScriptContext extends CommonScriptContext {
    request: RequestContext;
    cookieJar?: ICookieJar;
}

/**
 * Script execution result for pre-request scripts
 */
export interface PreRequestScriptResult {
    success: boolean;
    error?: string;
    modifiedRequest?: {
        url?: string;
        method?: string;
        headers?: Record<string, string>;
        body?: RequestBody | null;
        params?: Record<string, string>;
        query?: Record<string, string>;
    };
    modifiedVariables?: Record<string, string>;
    /**
     * All scopes EXCEPT globals — safe to pass as extraVariables for body resolution.
     * = collectionVariables + environmentVariables + iterationData + local pm.variables.set() writes.
     * Globals are excluded because they are tracked separately via runtimeGlobals in createResolver,
     * and including the session snapshot would risk shadowing a fresh value from a previous request.
     */
    localVariables?: Record<string, string>;
    modifiedCollectionVariables?: Record<string, string>;
    modifiedGlobals?: Record<string, string>;
    modifiedEnvironmentVariables?: Record<string, string>;
    consoleOutput?: string[];
    /** Postman-compatible: pm.execution.setNextRequest() value. null = stop runner. */
    nextRequest?: string | null;
    /** Postman-compatible: pm.execution.skipRequest() was called */
    skipRequest?: boolean;
}

/**
 * Script execution result for post-response scripts
 */
export interface PostResponseScriptResult {
    testResults: TestAssertion[];
    consoleOutput?: string[];
    modifiedVariables?: Record<string, string>;
    localVariables?: Record<string, string>;
    modifiedEnvironmentVariables?: Record<string, string>;
    modifiedGlobals?: Record<string, string>;
    modifiedCollectionVariables?: Record<string, string>;
    /** Postman-compatible: pm.execution.setNextRequest() value. null = stop runner. */
    nextRequest?: string | null;
    /** Postman-compatible: pm.visualizer.set(template, data) output */
    visualizerData?: { template: string; data?: any };
}

/**
 * Test script execution context
 */
export interface TestScriptContext extends CommonScriptContext {
    request: RequestContext;
    response: ResponseContext;
}

/**
 * Script Executor Interface
 * Single Responsibility: Create request execution sessions
 * Open/Closed: Can be extended with new execution strategies
 */
export interface IScriptExecutor {
    /**
     * Create a request execution session that shares VM context between pre-request and post-response
     * This enables JavaScript variables declared in pre-request to be accessible in post-response
     * (Postman-compatible behavior)
     */
    createRequestSession(context: PreRequestScriptContext): IRequestScriptSession;
}

/**
 * Request Script Session Interface
 * Represents a shared VM context for a single request's pre-request and post-response scripts
 * JavaScript variables declared in pre-request will be accessible in post-response
 */
export interface IRequestScriptSession {
    /**
     * Execute pre-request scripts in the shared session
     */
    executePreRequest(script: string | string[]): Promise<PreRequestScriptResult>;

    /**
     * Update the session with response data and execute post-response scripts
     */
    executePostResponse(script: string | string[], responseContext: ResponseContext): Promise<PostResponseScriptResult>;

    /**
     * Clean up the session (optional - for resource management)
     */
    dispose?(): void;
}
