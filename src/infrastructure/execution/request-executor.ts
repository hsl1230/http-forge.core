/**
 * Request Executor Service (Facade Pattern)
 * 
 * Single Responsibility: Orchestrate the complete request execution flow
 * Facade Pattern: Provides simplified interface to complex subsystem
 */

import { IHttpClient } from '../../types/platform';
import {
    HttpRequest,
    HttpResponse,
    RequestOverrides,
    ScriptResult,
    UnifiedCollection,
    UnifiedFolder,
    UnifiedRequest
} from '../../types/types';
import { ForgeEnv, IForgeEnv } from '../environment/forge-env';
import { HttpRequestService } from '../http/http-request-service';
import { InterceptorChain } from '../http/interceptor-chain';
import { IHttpRequestService } from '../http/interfaces';
import { IRequestPreprocessor } from '../http/request-preprocessor';
import { UrlBuilder } from '../http/url-builder';
import { IScriptExecutor, PreRequestScriptContext } from '../script/interfaces';
import { ScriptExecutor } from '../script/script-executor';
import { parseResponseCookieDetails } from '../script/script-utils';

/**
 * Options for request execution
 */
export interface ExecuteOptions {
    /** Environment to use (defaults to active) */
    environment?: string;
    /** Override request properties */
    overrides?: RequestOverrides;
    /** Skip pre-request scripts */
    skipPreRequest?: boolean;
    /** Skip post-response scripts */
    skipPostResponse?: boolean;
    /** Additional variables to merge */
    additionalVariables?: Record<string, string>;
    /** Timeout override */
    timeout?: number;
    /** Callback when scripts modify environment variables */
    onEnvironmentChange?: (action: 'set' | 'unset' | 'clear', key?: string, value?: string) => void;
}

/**
 * Complete execution result
 */
export interface ExecuteResult {
    /** The HTTP response */
    response: HttpResponse;
    /** Pre-request script result */
    preRequestResult?: ScriptResult;
    /** Post-response script result (tests) */
    postResponseResult?: ScriptResult;
    /** Total execution time (ms) */
    totalTime: number;
    /** The final request after interpolation and script modifications */
    finalRequest: HttpRequest;
    /** Variables after execution */
    variables: {
        environment: Record<string, string>;
        local: Record<string, string>;
    };
}

/**
 * Request Executor - Main execution engine
 */
export class RequestExecutor {
    private scriptExecutor: IScriptExecutor;
    
    constructor(
        private readonly httpClient: IHttpClient,
        private readonly forgeEnv: IForgeEnv,
        private readonly cookieJar?: any,  // ICookieJar - optional for cookie support in scripts
        private readonly preprocessor?: IRequestPreprocessor,
        options?: { forgeRoot?: string; scriptExecutor?: IScriptExecutor; scriptScope?: 'shared' | 'isolated'; scriptTimeout?: number }
    ) {
        if (options?.scriptExecutor) {
            this.scriptExecutor = options.scriptExecutor;
        } else {
            const modulePaths = options?.forgeRoot
                ? [require('path').join(options.forgeRoot, 'modules')]
                : [];
            // Wrap httpClient in HttpRequestService for script execution
            const httpRequestService: IHttpRequestService = new HttpRequestService(
                new UrlBuilder(),
                new InterceptorChain(),
                httpClient
            );
            this.scriptExecutor = new ScriptExecutor(httpRequestService, modulePaths, undefined, options?.scriptScope ?? 'shared', options?.scriptTimeout ?? 5000);
        }
    }
    
    /**
     * Execute a request with full pipeline
     * Uses RequestScriptSession for shared VM context between pre-request and post-response scripts
     */
    async execute(
        request: UnifiedRequest,
        collection: UnifiedCollection,
        options: ExecuteOptions = {}
    ): Promise<ExecuteResult> {
        if (request.requestType === 'websocket') {
            throw new Error('WebSocket requests are not supported by the HTTP request executor');
        }
        const startTime = Date.now();
        
        // 1. Get current environment variables
        const environmentVariables = { ...this.forgeEnv.getAll() };

        // Seed the Postman-compatible globals scope from the environment-agnostic
        // global store so pm.globals.get() sees values set by earlier requests.
        const initialGlobals = { ...this.forgeEnv.getGlobals() };
        
        // Track variable modifications
        let localVariables: Record<string, string> = { ...(options.additionalVariables || {}) };
        let currentEnvVars = { ...environmentVariables };
        
        // 2. Build initial HTTP request
        let httpRequest = this.buildHttpRequest(request, options.overrides);
        const scriptRequestBody = options.overrides?.body || request.body;
        
        // 3. Get script chains
        const folderPath = this.findFolderPath(collection, request.id);
        const scriptChain = this.buildScriptChain(request, collection, folderPath);
        
        // 4. Create script execution session using new ScriptExecutor (vm-based)
        const preRequestContext: PreRequestScriptContext = {
            request: {
                url: httpRequest.url,
                method: httpRequest.method,
                headers: { ...httpRequest.headers },
                body: scriptRequestBody ? (typeof scriptRequestBody === 'string'
                    ? { type: 'raw' as const, content: scriptRequestBody }
                    : scriptRequestBody) : undefined
            },
            variables: localVariables,
            collectionVariables: collection.variables || {},
            globals: { ...initialGlobals },
            environmentVariables: currentEnvVars,
            environmentName: this.forgeEnv.getActiveEnvironment?.() || undefined,
            cookieJar: this.cookieJar,
            info: {
                eventName: 'prerequest',
                requestName: request.name,
                requestId: request.id,
                collectionName: collection?.name
            },
            onEnvironmentChange: options.onEnvironmentChange,
            onGlobalsChange: (action: 'set' | 'unset' | 'clear', key?: string, value?: string) => {
                if (action === 'set' && key && value !== undefined) {
                    this.forgeEnv.setGlobal(key, value);
                } else if (action === 'unset' && key) {
                    this.forgeEnv.unsetGlobal(key);
                } else if (action === 'clear') {
                    this.forgeEnv.clearGlobals();
                }
            }
        };
        
        const session = this.scriptExecutor.createRequestSession(preRequestContext);
        
        let preRequestResult: ScriptResult | undefined;
        let postResponseResult: ScriptResult | undefined;
        
        try {
            // 5. Execute pre-request scripts
            if (!options.skipPreRequest && scriptChain.preRequest.length > 0) {
                const preResult = await session.executePreRequest(scriptChain.preRequest);
                
                // Convert to ScriptResult format for backward compatibility
                preRequestResult = {
                    success: preResult.success,
                    error: preResult.error,
                    modifiedVariables: preResult.modifiedVariables,
                    modifiedEnvironment: preResult.modifiedEnvironmentVariables,
                    modifiedGlobals: preResult.modifiedGlobals,
                    modifiedCollectionVariables: preResult.modifiedCollectionVariables,
                    consoleOutput: preResult.consoleOutput,
                    modifiedRequest: preResult.modifiedRequest ? {
                        url: preResult.modifiedRequest.url,
                        method: preResult.modifiedRequest.method,
                        headers: preResult.modifiedRequest.headers,
                        body: preResult.modifiedRequest.body?.content
                    } : undefined
                };
                
                // Apply script modifications
                if (preResult.modifiedVariables) {
                    localVariables = { ...localVariables, ...(preResult.localVariables ?? preResult.modifiedVariables) };
                }
                if (preResult.modifiedEnvironmentVariables) {
                    currentEnvVars = { ...currentEnvVars, ...preResult.modifiedEnvironmentVariables };
                }
                
                // Apply request modifications from pre-request scripts
                if (preResult.modifiedRequest) {
                    const mr = preResult.modifiedRequest;
                    if (mr.url) httpRequest.url = mr.url;
                    if (mr.method) httpRequest.method = mr.method;
                    if (mr.headers) httpRequest.headers = { ...httpRequest.headers, ...mr.headers };
                    if (mr.body !== undefined) {
                        httpRequest.body = mr.body?.content || mr.body;
                    }
                }
                
                // Check for script errors
                if (!preResult.success) {
                    throw new Error(`Pre-request script failed: ${preResult.error}`);
                }
            }
            
            // 6. Interpolate variables
            const allVariables = {
                ...currentEnvVars,
                ...localVariables
            };
            
            httpRequest = this.interpolateRequest(httpRequest, allVariables);

            // GraphQL body encoding is deferred in buildHttpRequest so {{var}}
            // placeholders are resolved on raw text first. Normalize GraphQL
            // payload now (notably variables: "{...}" -> variables: {...}).
            const effectiveBody = options.overrides?.body || request.body;
            if (
                this.preprocessor &&
                effectiveBody &&
                typeof effectiveBody !== 'string' &&
                effectiveBody.type === 'graphql' &&
                httpRequest.body !== undefined
            ) {
                const encoded = this.preprocessor.encodeBody({
                    type: 'graphql',
                    content: httpRequest.body
                } as any);

                if (encoded !== null && encoded !== undefined) {
                    httpRequest.body = typeof encoded === 'string' ? encoded : JSON.stringify(encoded);
                }
            }
            
            // 7. Execute HTTP request
            if (scriptRequestBody && typeof scriptRequestBody === 'object' && scriptRequestBody.type === 'form-data' && Array.isArray(httpRequest.body)) {
                const multipartBody = this.buildMultipartFormData({
                    type: 'form-data',
                    content: httpRequest.body
                } as any);

                if (multipartBody) {
                    httpRequest.body = multipartBody;
                }
            }

            const response = await this.httpClient.send(httpRequest);
            
            // 8. Execute post-response scripts (using same session for shared context)
            if (!options.skipPostResponse && scriptChain.postResponse.length > 0) {
                const postResult = await session.executePostResponse(scriptChain.postResponse, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers as Record<string, string>,
                    body: response.body,
                    cookies: parseResponseCookieDetails(
                        response.headers,
                        response.cookies,
                        httpRequest.url
                    ),
                    responseTime: response.time,
                    responseSize: response.size,
                    executedRequest: {
                        url: httpRequest.url,
                        method: httpRequest.method,
                        headers: httpRequest.headers || {},
                        body: httpRequest.body
                            ? (typeof httpRequest.body === 'string'
                                ? { type: 'raw' as const, content: httpRequest.body }
                                : httpRequest.body)
                            : { type: 'none' as const, content: '' },
                        params: {},
                        query: {}
                    }
                });
                
                // Convert to ScriptResult format for backward compatibility
                postResponseResult = {
                    success: true,
                    assertions: postResult.testResults,
                    consoleOutput: postResult.consoleOutput,
                    modifiedEnvironment: postResult.modifiedEnvironmentVariables
                };
                
                // Apply script modifications
                if (postResult.modifiedEnvironmentVariables) {
                    currentEnvVars = { ...currentEnvVars, ...postResult.modifiedEnvironmentVariables };
                }
            }
            
            return {
                response,
                preRequestResult,
                postResponseResult,
                totalTime: Date.now() - startTime,
                finalRequest: httpRequest,
                variables: {
                    environment: currentEnvVars,
                    local: localVariables
                }
            };
        } finally {
            // Clean up session
            session.dispose?.();
        }
    }
    
    /**
     * Execute a simple request without collection context
     */
    async executeSimple(
        request: HttpRequest,
        options: { 
            variables?: Record<string, string>;
            timeout?: number;
        } = {}
    ): Promise<HttpResponse> {
        let finalRequest = request;
        // Use forgeEnv variables merged with any provided variables
        const variables = { ...this.forgeEnv.getAll(), ...(options.variables || {}) };
        finalRequest = this.interpolateRequest(request, variables);
        
        if (options.timeout) {
            finalRequest = { ...finalRequest, timeout: options.timeout };
        }
        return this.httpClient.send(finalRequest);
    }
    
    /**
     * Build HttpRequest from UnifiedRequest
     */
    private buildHttpRequest(
        request: UnifiedRequest,
        overrides?: RequestOverrides
    ): HttpRequest {
        // Build URL with query params
        let url = request.url;
        
        if (request.query && request.query.length > 0) {
            const params = new URLSearchParams();
            for (const param of request.query) {
                if (param.enabled !== false) {
                    params.append(param.key, param.value);
                }
            }
            url += (url.includes('?') ? '&' : '?') + params.toString();
        }
        
        // Apply overrides
        const finalUrl = overrides?.url || url;
        const finalMethod = overrides?.method || request.method;
        // Convert headers array to Record
        const headerRecord: Record<string, string> = {};
        if (request.headers && Array.isArray(request.headers)) {
            for (const header of request.headers) {
                if (header.enabled !== false) {
                    headerRecord[header.key] = header.value;
                }
            }
        }
        const finalHeaders = { ...headerRecord, ...(overrides?.headers || {}) };
        
        // Convert body
        let body: any;
        const requestBody = overrides?.body || request.body;
        
        if (requestBody) {
            if (typeof requestBody === 'string') {
                body = requestBody;
            } else if (this.preprocessor && requestBody.type) {
                if (requestBody.type === 'graphql') {
                    // Defer GraphQL encoding to AFTER interpolation so that
                    // {{var}} placeholders are substituted as bare text before
                    // JSON.parse runs on the query/variables. This matches
                    // Postman's behaviour where raw-text substitution precedes
                    // parsing, allowing numeric vars (Int!, Float!) to arrive
                    // as unquoted literals in the variables object.
                    body = typeof requestBody.content === 'string'
                        ? requestBody.content
                        : JSON.stringify(requestBody.content);
                } else if (requestBody.type === 'form-data') {
                    body = this.buildMultipartFormData(requestBody);
                } else {
                    // All other types (urlencoded, raw, binary):
                    // encode immediately — no variable placeholders in their
                    // structural fields that need raw-text substitution.
                    const encoded = this.preprocessor.encodeBody(requestBody);
                    body = encoded != null ? String(encoded) : undefined;
                }
            } else if (requestBody.content) {
                body = typeof requestBody.content === 'string' 
                    ? requestBody.content 
                    : JSON.stringify(requestBody.content);
            }
        }
        
        // Auto-set Content-Type header based on body type (same as VS Code plugin)
        if (this.preprocessor && requestBody && requestBody.type !== 'form-data') {
            this.preprocessor.setContentTypeHeader(finalHeaders, requestBody);
        }
        
        return {
            url: finalUrl,
            method: finalMethod,
            headers: finalHeaders,
            body,
            timeout: overrides?.timeout || request.settings?.timeout,
            settings: {
                ...request.settings,
                ...overrides?.settings
            }
        };
    }
    
    /**
     * Interpolate variables in request using ForgeEnv
     * Handles both {{variable}} and :pathParam patterns in URL
     */
    private interpolateRequest(
        request: HttpRequest,
        variables: Record<string, string>
    ): HttpRequest {
        // Create a temporary ForgeEnv with merged variables for interpolation
        const env = ForgeEnv.create(variables);
        const requestBody = request.body;

        let resolvedBody: any = requestBody;
        if (typeof requestBody === 'string') {
            resolvedBody = env.resolve(requestBody);
        } else if (requestBody instanceof FormData || requestBody instanceof URLSearchParams) {
            resolvedBody = requestBody;
        } else if (requestBody && typeof requestBody === 'object') {
            resolvedBody = env.resolve(requestBody);
        }
        
        return {
            ...request,
            // Use resolvePath for URL to handle both {{var}} and :param patterns
            url: env.resolvePath(request.url),
            headers: env.resolveObject(request.headers),
            body: resolvedBody
        };
    }

    /**
     * Convert Postman form-data entries into a native FormData body so fetch can
     * send a real multipart request with an auto-generated boundary.
     */
    private buildMultipartFormData(requestBody: UnifiedRequest['body']): FormData | undefined {
        if (!requestBody || requestBody.type !== 'form-data' || !Array.isArray(requestBody.content)) {
            return undefined;
        }

        const formData = new FormData();
        for (const entry of requestBody.content as Array<{ key?: string; value?: any; enabled?: boolean }>) {
            if (!entry?.key || entry.enabled === false) {
                continue;
            }

            formData.append(entry.key, entry.value == null ? '' : String(entry.value));
        }

        return formData;
    }

    /**
     * Build script chain for a request
     * Returns scripts in execution order: collection → folders → request
     */
    private buildScriptChain(
        request: UnifiedRequest,
        collection: UnifiedCollection,
        folderPath: UnifiedFolder[] = []
    ): { preRequest: string[]; postResponse: string[] } {
        const preRequest: string[] = [];
        const postResponse: string[] = [];
        
        // 1. Collection-level scripts
        if (collection.scripts?.preRequest) {
            preRequest.push(collection.scripts.preRequest);
        }
        if (collection.scripts?.postResponse) {
            postResponse.push(collection.scripts.postResponse);
        }
        
        // 2. Folder-level scripts (in order from root to leaf)
        for (const folder of folderPath) {
            if (folder.scripts?.preRequest) {
                preRequest.push(folder.scripts.preRequest);
            }
            if (folder.scripts?.postResponse) {
                postResponse.push(folder.scripts.postResponse);
            }
        }
        
        // 3. Request-level scripts
        if (request.scripts?.preRequest) {
            preRequest.push(request.scripts.preRequest);
        }
        if (request.scripts?.postResponse) {
            postResponse.push(request.scripts.postResponse);
        }
        
        return { preRequest, postResponse };
    }
    
    /**
     * Find the folder path from collection root to a request
     * Returns array of folders in order from root to parent
     */
    private findFolderPath(
        collection: UnifiedCollection,
        requestId: string
    ): UnifiedFolder[] {
        const path: UnifiedFolder[] = [];
        
        const search = (items: (UnifiedFolder | UnifiedRequest)[], currentPath: UnifiedFolder[]): boolean => {
            for (const item of items) {
                if (item.type === 'request' && item.id === requestId) {
                    path.push(...currentPath);
                    return true;
                }
                
                if (item.type === 'folder') {
                    const newPath = [...currentPath, item];
                    if (search(item.items, newPath)) {
                        return true;
                    }
                }
            }
            return false;
        };
        
        search(collection.items, []);
        return path;
    }
}