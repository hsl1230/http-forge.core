/**
 * Collection Request Executor
 *
 * Executes a single collection request with full Postman parity:
 * - Script execution order: Collection → Folder(s) → Request (pre-request)
 * - Script execution order: Request → Folder(s) → Collection (post-response)
 * - Supports nested folder scripts (multiple levels)
 * - JavaScript variables declared in pre-request are accessible in post-response (shared VM session)
 *
 * Extracted from extension's request-execution/collection-request-executor.ts.
 * Platform-independent — no vscode dependency.
 */

import { IEnvironmentConfigService } from '../../types/environment-config';
import { IWebSocketClient, ISocketIoClient } from '../../types/platform';
import {
    ExecutionRequest,
    ExecutionResult,
    HttpResponse,
    PreparedRequest,
    RequestAuth,
    RequestScripts,
    ResolvedBody,
    TestAssertion,
} from '../../types/types';
import { IHttpRequestService } from '../http/interfaces';
import { ICookieJar, IScriptExecutor, PreRequestScriptContext, ResponseContext } from '../script/interfaces';
import { normalizeHeaders, parseResponseCookieDetails } from '../script/script-utils';
import { copySecretValues } from '../security/secret-values';
import { runWebSocketRequest } from '../websocket/websocket-request-runner';
import { runSocketIoRequest } from '../websocket/socketio-request-runner';
import { ConsoleOutputCallback, ICollectionRequestExecutor } from './collection-request-executor-interfaces';
import { IRequestPreparer } from './request-preparer-interfaces';

/**
 * Enhanced implementation with Postman parity.
 * Supports: pre-request scripts, post-response scripts, cookies, settings,
 * collection/folder scripts.
 */
export class CollectionRequestExecutor implements ICollectionRequestExecutor {
    constructor(
        private readonly httpService: IHttpRequestService,
        private readonly scriptExecutor: IScriptExecutor,
        private readonly envConfigService: IEnvironmentConfigService,
        private readonly requestPreparer: IRequestPreparer,
        private readonly environment: string,
        private readonly cookieJar?: ICookieJar,
        private readonly collectionScripts?: RequestScripts,
        private readonly folderScriptsChain?: RequestScripts | RequestScripts[],
        private readonly onConsoleOutput?: ConsoleOutputCallback,
        private readonly collectionName?: string,
        private readonly collectionAuth?: RequestAuth,
        private readonly iteration?: number,
        private readonly iterationCount?: number,
        private readonly webSocketClient?: IWebSocketClient,
        private readonly socketIoClient?: ISocketIoClient
    ) {}

    /**
     * Execute a request with full Postman parity.
     */
    public async execute(
        request: ExecutionRequest,
        variables: Record<string, string>,
        signal?: AbortSignal
    ): Promise<ExecutionResult> {
        if (request.requestType === 'websocket' && request.websocket?.protocol !== 'socketio' && !this.webSocketClient) {
            throw new Error('WebSocket execution is not configured for this runner');
        }
        if (request.requestType === 'websocket' && request.websocket?.protocol === 'socketio' && !this.socketIoClient) {
            throw new Error('Socket.IO execution is not configured for this runner');
        }
        const startTime = Date.now();
        return this.executeWithSession(request, variables, signal, startTime);
    }

    protected async executeWithSession(
        request: ExecutionRequest,
        variables: Record<string, string>,
        signal: AbortSignal | undefined,
        startTime: number
    ): Promise<ExecutionResult> {
        // Collect all pre-request scripts
        const preRequestScripts = this.collectPreRequestScripts(request);
        const postResponseScripts = this.collectPostResponseScripts(request);

        // Get environment and session data for script context
        // Secret variables are already mixed into getResolvedEnvironment() via secretValuesCache
        const resolvedEnv = this.envConfigService.getResolvedEnvironment(this.environment);
        if (!resolvedEnv) {
            throw new Error(`Environment "${this.environment}" not found or not configured`);
        }

        // Seed the Postman-compatible globals scope from the persisted global store
        // (_global.json values + any globals set by earlier requests in this session).
        const initialGlobals = this.envConfigService.getGlobalVariables();

        // Create session context with full Postman parity
        const sessionContext: PreRequestScriptContext = {
            request,
            variables: { ...variables },
            environmentVariables: resolvedEnv.variables || {},
            globals: { ...initialGlobals },
            environmentName: this.environment,
            cookieJar: this.cookieJar,
            info: {
                eventName: 'prerequest',
                requestName: request.name,
                requestId: request.id,
                collectionName: this.collectionName,
                iteration: this.iteration,
                iterationCount: this.iterationCount
            },
            onEnvironmentChange: async (action: 'set' | 'unset' | 'clear', key?: string, value?: string) => {
                if (action === 'set' && key && value !== undefined) {
                    this.envConfigService.setEnvironmentVariable(key, value, this.environment);
                } else if (action === 'unset' && key) {
                    this.envConfigService.deleteEnvironmentVariable(key, this.environment);
                } else if (action === 'clear') {
                    this.envConfigService.clearEnvironmentVariables(this.environment);
                }
            },
            onGlobalsChange: (action: 'set' | 'unset' | 'clear', key?: string, value?: string) => {
                if (action === 'set' && key && value !== undefined) {
                    this.envConfigService.setGlobalVariable(key, value);
                } else if (action === 'unset' && key) {
                    this.envConfigService.deleteGlobalVariable(key);
                } else if (action === 'clear') {
                    this.envConfigService.clearGlobalVariables();
                }
            }
        };

        // Create session for shared JavaScript context
        const session = this.scriptExecutor.createRequestSession(sessionContext);

        let prepared: PreparedRequest | null = null;

        try {
            // Phase 1: Run pre-request scripts in shared session
            let currentVariables = { ...variables };
            let requestToExecute = { ...request };
            let nextRequest: string | null | undefined = undefined;

            if (!requestToExecute.auth || requestToExecute.auth.type === 'inherit') {
                requestToExecute.auth = this.collectionAuth && this.collectionAuth.type !== 'inherit'
                    ? this.collectionAuth
                    : undefined;
            }

            if (preRequestScripts.length > 0) {
                const preResult = await session.executePreRequest(preRequestScripts);

                // Stream console output
                if (preResult.consoleOutput && preResult.consoleOutput.length > 0) {
                    this.onConsoleOutput?.(preResult.consoleOutput, { requestName: request.name || '', phase: 'pre-request' });
                }

                // Capture flow control signals from pre-request
                if (preResult.nextRequest !== undefined) {
                    nextRequest = preResult.nextRequest;
                }

                // pm.execution.skipRequest() — skip HTTP call, return immediately
                if (preResult.skipRequest) {
                    const emptyBody: ResolvedBody = { type: 'none', content: null };
                    return {
                        requestId: request.id!,
                        name: request.name!,
                        executedRequest: {
                            url: request.url || '',
                            method: request.method || 'GET',
                            headers: {},
                            body: emptyBody,
                            params: {},
                            query: {}
                        },
                        response: {
                            status: 0, statusText: 'Skipped',
                            headers: {}, body: null, time: 0, cookies: []
                        },
                        duration: Date.now() - startTime,
                        timestamp: Date.now(),
                        passed: true,
                        assertions: [],
                        modifiedVariables: currentVariables,
                        nextRequest
                    };
                }

                if (preResult.success) {
                    if (preResult.modifiedRequest) {
                        if (preResult.modifiedRequest.url) requestToExecute.url = preResult.modifiedRequest.url;
                        if (preResult.modifiedRequest.headers) requestToExecute.headers = preResult.modifiedRequest.headers;
                        if (preResult.modifiedRequest.params) requestToExecute.params = preResult.modifiedRequest.params;
                        if (preResult.modifiedRequest.query) requestToExecute.query = preResult.modifiedRequest.query;
                        if (preResult.modifiedRequest.body !== undefined) {
                            requestToExecute.body = preResult.modifiedRequest.body;
                        }
                    }
                    if (preResult.localVariables ?? preResult.modifiedVariables) {
                        currentVariables = preResult.localVariables ?? preResult.modifiedVariables!;
                    }
                }
            }

            // Phase 2: Prepare request (resolve variables, auth, body encoding)
            prepared = await this.requestPreparer.prepareRequest(
                requestToExecute,
                this.environment,
                resolvedEnv,
                currentVariables
            );

            const { url, headers, body, method } = prepared;

            // Normalize headers to uppercase for cookie matching
            const normalizedHeaders: Record<string, string> = {};
            for (const key in headers) {
                if (Object.prototype.hasOwnProperty.call(headers, key)) {
                    normalizedHeaders[key.toUpperCase()] = headers[key];
                }
            }

            // Phase 3: Add cookies
            if (!normalizedHeaders['COOKIE']) {
                const includeCookies = requestToExecute.settings?.includeCookies !== false;
                if (includeCookies && this.cookieJar) {
                    const cookieHeader = this.cookieJar.getCookieHeader(url);
                    if (cookieHeader) {
                        normalizedHeaders['COOKIE'] = cookieHeader;
                    }
                }
            }

            // Phase 4: Execute the transport. WebSocket requests reuse the
            // prepared URL/headers/auth but own their socket lifecycle; the
            // synthetic transcript response then flows through the same
            // post-response script/test pipeline as HTTP.
            let response: HttpResponse;
            if (requestToExecute.requestType === 'websocket') {
                prepared = {
                    ...prepared,
                    headers: normalizedHeaders,
                    body: { type: 'none', content: null }
                };

                if (requestToExecute.websocket?.protocol === 'socketio') {
                    if (!this.socketIoClient) {
                        throw new Error('Socket.IO execution is not configured for this runner');
                    }
                    response = await runSocketIoRequest(
                        this.socketIoClient,
                        requestToExecute,
                        prepared,
                        signal
                    );
                } else {
                    if (!this.webSocketClient) {
                        throw new Error('WebSocket execution is not configured for this runner');
                    }
                    response = await runWebSocketRequest(
                        this.webSocketClient,
                        requestToExecute,
                        prepared,
                        signal
                    );
                }
            } else {
                const requestOptions: any = {
                    method,
                    url,
                    headers: normalizedHeaders,
                    body: body.content,
                    signal,
                    settings: requestToExecute.settings ? { ...requestToExecute.settings } : undefined
                };

                response = await this.httpService.execute(requestOptions);
            }

            // Phase 5: Store cookies from response (HTTP and raw WebSocket handshakes)
            if (this.cookieJar && response.headers) {
                await this.cookieJar.setCookiesFromResponse(url, response.headers);
            }

            const duration = Date.now() - startTime;

            // Phase 6: Run post-response scripts
            let assertions: TestAssertion[] = [];
            let modifiedEnvironmentVariables: Record<string, string> = {};
            let visualizerData: { template: string; data?: any } | undefined;

            if (postResponseScripts.length > 0) {
                let responseSize = 0;
                if (response.body) {
                    if (typeof response.body === 'string') {
                        responseSize = Buffer.byteLength(response.body, 'utf8');
                    } else if (Buffer.isBuffer(response.body)) {
                        responseSize = response.body.length;
                    } else {
                        try {
                            responseSize = Buffer.byteLength(JSON.stringify(response.body), 'utf8');
                        } catch {
                            responseSize = 0;
                        }
                    }
                }

                // Parse full cookie metadata (maxAge, sameSite, secure, ...) from
                // the raw Set-Cookie headers for the Postman-compatible CookieList.
                const cookies = parseResponseCookieDetails(
                    response.headers,
                    response.cookies,
                    prepared.url
                );

                const responseContext: ResponseContext = {
                    executedRequest: prepared,
                    status: response.status,
                    statusText: response.statusText,
                    headers: normalizeHeaders(response.headers || {}),
                    body: response.body,
                    cookies,
                    responseTime: response.time,
                    responseSize
                };

                const postResult = await session.executePostResponse(postResponseScripts, responseContext);
                assertions = postResult.testResults;
                modifiedEnvironmentVariables = postResult.modifiedEnvironmentVariables || {};
                visualizerData = postResult.visualizerData;

                if (postResult.localVariables ?? postResult.modifiedVariables) {
                    currentVariables = postResult.localVariables ?? postResult.modifiedVariables!;
                }

                // Capture flow control signals from post-response (overrides pre-request)
                if (postResult.nextRequest !== undefined) {
                    nextRequest = postResult.nextRequest;
                }

                if (postResult.consoleOutput && postResult.consoleOutput.length > 0) {
                    this.onConsoleOutput?.(postResult.consoleOutput, { requestName: request.name || '', phase: 'post-response' });
                }
            }

            // Phase 7: Determine pass/fail
            const assertionsPassed = assertions.length === 0 || assertions.every(a => a.passed);
            const passed = assertions.length > 0
                ? assertionsPassed
                : requestToExecute.requestType === 'websocket'
                    ? response.status === 101
                    : (response.status >= 200 && response.status <= 302);

            return {
                requestId: request.id!,
                name: request.name!,
                executedRequest: copySecretValues(prepared, { ...prepared, headers: normalizedHeaders }),
                response: {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers || {},
                    body: response.body,
                    time: response.time || duration,
                    cookies: response.cookies || []
                },
                duration,
                timestamp: Date.now(),
                passed,
                assertions,
                modifiedVariables: currentVariables,
                modifiedEnvironmentVariables,
                nextRequest,
                visualizerData
            };
        } catch (error: any) {
            return this.handleError(request, prepared, error, startTime);
        } finally {
            session.dispose?.();
        }
    }

    /**
     * Collect pre-request scripts in order: Collection → Folder(s) → Request
     */
    private collectPreRequestScripts(request: ExecutionRequest): string[] {
        const scripts: string[] = [];

        if (this.collectionScripts?.preRequest) {
            scripts.push(this.collectionScripts.preRequest);
        }

        if (this.folderScriptsChain) {
            if (Array.isArray(this.folderScriptsChain)) {
                for (const folderScripts of this.folderScriptsChain) {
                    if (folderScripts?.preRequest) {
                        scripts.push(folderScripts.preRequest);
                    }
                }
            } else if (this.folderScriptsChain.preRequest) {
                scripts.push(this.folderScriptsChain.preRequest);
            }
        }

        if (request.scripts?.preRequest) {
            scripts.push(request.scripts.preRequest);
        }

        return scripts;
    }

    /**
     * Collect post-response scripts in order: Request → Folder(s) → Collection
     */
    private collectPostResponseScripts(request: ExecutionRequest): string[] {
        const scripts: string[] = [];

        if (request.scripts?.postResponse) {
            scripts.push(request.scripts.postResponse);
        }

        if (this.folderScriptsChain) {
            if (Array.isArray(this.folderScriptsChain)) {
                const reversedChain = [...this.folderScriptsChain].reverse();
                for (const folderScripts of reversedChain) {
                    if (folderScripts?.postResponse) {
                        scripts.push(folderScripts.postResponse);
                    }
                }
            } else if (this.folderScriptsChain.postResponse) {
                scripts.push(this.folderScriptsChain.postResponse);
            }
        }

        if (this.collectionScripts?.postResponse) {
            scripts.push(this.collectionScripts.postResponse);
        }

        return scripts;
    }

    /**
     * Handle execution errors — returns a failed ExecutionResult.
     *
     * The response body is set according to `errorBodyFormat`:
     * - `'text'`  → plain-text error message (default, safe for CLI / headless)
     * - `'html'`  → styled HTML suitable for a webview Response tab
     * - `'both'`  → HTML body **and** `error` field with plain-text message
     *
     * Protected so subclasses can override error formatting entirely.
     */
    protected handleError(
        request: ExecutionRequest,
        prepared: PreparedRequest | null,
        error: any,
        startTime: number
    ): ExecutionResult {
        const duration = Date.now() - startTime;
        const method = prepared?.method || request.method;
        const url = prepared?.url || request.url;

        this.onConsoleOutput?.([`${error.message || error}`], { requestName: request.name || '', phase: 'error' });

        const errorMessage = String(error.name === 'AbortError' ? 'Request was aborted' : error.message || error);
        const errorStack = error?.stack ? String(error.stack) : '';

        // Determine body content & headers based on format preference
        const format = this.errorBodyFormat;
        let body: string;
        let headers: Record<string, string>;

        if (format === 'html' || format === 'both') {
            body = CollectionRequestExecutor.formatErrorAsHtml(errorMessage, errorStack);
            headers = { 'content-type': 'text/html; charset=utf-8' };
        } else {
            body = errorMessage;
            headers = {};
        }

        const emptyBody: ResolvedBody = { type: 'none', content: null };

        return {
            requestId: request.id!,
            name: request.name!,
            executedRequest: copySecretValues(prepared, {
                url: url || '',
                method: method || 'GET',
                headers: prepared?.headers || {},
                body: prepared?.body || emptyBody,
                params: prepared?.params || {},
                query: prepared?.query || {}
            }),
            response: {
                status: 0,
                statusText: error.name === 'AbortError' ? 'Aborted' : error.code || error.message || 'Request Error',
                headers,
                cookies: [],
                body,
                time: 0
            },
            duration,
            timestamp: Date.now(),
            passed: false,
            assertions: [],
            error: errorMessage
        };
    }

    // ── Error formatting helpers ────────────────────────────────

    /**
     * The format used for error response bodies.
     *
     * Override in a subclass (or set via constructor option) to switch formats:
     * - `'text'`  — plain text (default)
     * - `'html'`  — HTML for webview display
     * - `'both'`  — HTML body + plain `error` field
     */
    protected get errorBodyFormat(): 'text' | 'html' | 'both' {
        return 'text';
    }

    /**
     * Build a styled HTML string from an error message and optional stack trace.
     * Useful for rendering errors in a webview Response tab.
     *
     * Static so callers can use it independently of an executor instance.
     */
    static formatErrorAsHtml(message: string, stack?: string): string {
        const esc = (s: string) =>
            s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
             .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

        return `<!doctype html>
<html>
    <body style="font-family:system-ui,Segoe UI,Roboto,-apple-system,Helvetica,Arial,sans-serif;padding:12px;color:#c7254e;">
        <h2 style="margin-top:0;color:#a94442">Request Error</h2>
        <p><strong>${esc(message)}</strong></p>
        ${stack ? `<pre style="white-space:pre-wrap;padding:10px;border:1px solid #eee;border-radius:4px;">\n${esc(stack)}\n        </pre>` : ''}
    </body>
</html>`;
    }
}
