/**
 * Request Script Session
 * 
 * Single Responsibility: Manage shared VM context between pre-request and post-response scripts
 * 
 * This class creates a single VM sandbox that persists across both script phases,
 * allowing JavaScript variables declared in pre-request to be accessible in post-response.
 * This matches Postman's behavior for per-request script execution.
 */

import * as vm from 'vm';
import { RequestBody, TestAssertion } from '../../types/types';
import { createTimerRegistry, SandboxTimers, TimerRegistry } from './async-drain';
import {
    CommonScriptContext,
    IRequestScriptSession,
    PostResponseScriptResult,
    PreRequestScriptContext,
    PreRequestScriptResult,
    ResponseContext
} from './interfaces';
import { createRequestObject } from './request-object-factory';
import { createExpectChain, createResponseObject } from './script-factories';
import {
    concatenateScripts,
    ConsoleMessage,
    createTestFunction,
    formatConsoleOutput,
    hasChanged
} from './script-utils';

/**
 * Dependencies injected from ScriptExecutor
 * Interface Segregation: Only the methods needed by the session
 */
export interface SessionDependencies {
    createVM: (ctx: any, scriptConsole: any, timers?: SandboxTimers) => vm.Context;
    createCommonContext: (context: CommonScriptContext, eventName: 'prerequest' | 'test') => any;
    /** When true, each script level runs in its own scope (Postman-compatible). */
    isolateScripts?: boolean;
    /**
     * Per-script timeout in milliseconds. Bounds BOTH the synchronous VM CPU guard and
     * the async event-loop drain budget (pending timers / un-awaited Promises).
     */
    scriptTimeoutMs?: number;
}

/**
 * Request Script Session Implementation
 * 
 * Manages a shared VM context for executing pre-request and post-response scripts.
 * Variables declared in pre-request are accessible in post-response.
 */
export class RequestScriptSession implements IRequestScriptSession {
    private vmContext: vm.Context | null = null;
    private ctx: any = null;
    private modifiedRequest: any = null;
    private assertions: TestAssertion[] = [];
    
    // Console messages - stored locally, not on ctx
    private consoleMessages: Array<ConsoleMessage> = [];
    
    // Variable state storage
    private _variables: Record<string, string> = {};
    private _collectionVariables: Record<string, string> = {};
    private _globals: Record<string, string> = {};
    private _environmentVariables: Record<string, string> = {};
    // Live scope references from createCommonContext (mutated by pm.environment.set() etc.)
    private _liveEnvironmentScope: any = null;
    private _liveGlobalsScope: any = null;
    private _liveCollectionScope: any = null;

    // Postman execution flow control
    private _nextRequest: string | null | undefined = undefined; // undefined = not called
    private _skipRequest = false;

    // Postman visualizer data
    private _visualizerData: { template: string; data?: any } | undefined = undefined;

    // Instrumented timers so pending setTimeout/setInterval work can be drained
    // (Postman-compatible) before variable scopes are committed.
    private readonly timerRegistry: TimerRegistry;
    
    constructor(
        private readonly deps: SessionDependencies,
        private readonly initialContext: PreRequestScriptContext
    ) {
        this.timerRegistry = createTimerRegistry((error: unknown) => {
            // A throw inside a deferred timer callback is non-fatal in Postman — it runs
            // on a later tick outside the script's try/catch. Capture as a console error
            // and continue rather than rejecting the request.
            const message = error instanceof Error ? error.message : String(error);
            this.consoleMessages.push({ level: 'error', args: [`Uncaught error in async callback: ${message}`] });
        });
        this.initializeSession();
    }

    /**
     * Initialize the shared VM context
     */
    private initializeSession(): void {
        // Create modifiable request object - body uses RequestBody format
        this.modifiedRequest = {
            url: this.initialContext.request.url,
            method: this.initialContext.request.method,
            headers: { ...this.initialContext.request.headers },
            body: this.initialContext.request.body ? { ...this.initialContext.request.body } : null,
            params: this.initialContext.request.params ? { ...this.initialContext.request.params } : {},
            query: this.initialContext.request.query ? { ...this.initialContext.request.query } : {}
        };

        this.assertions = [];

        // Create shared context (this will be reused across script executions)
        this.ctx = this.createSharedContext();
        
        // Reset console messages for each session
        this.consoleMessages = [];
        
        // Create script console using closure over instance property
        const session = this;
        const scriptConsole = {
            log: (...args: any[]) => { 
                session.consoleMessages.push({ level: 'log', args }); 
            },
            info: (...args: any[]) => { 
                session.consoleMessages.push({ level: 'info', args }); 
            },
            warn: (...args: any[]) => { 
                session.consoleMessages.push({ level: 'warn', args }); 
            },
            error: (...args: any[]) => { 
                session.consoleMessages.push({ level: 'error', args }); 
            }
        };
        
        // Create shared VM context
        this.vmContext = this.deps.createVM(this.ctx, scriptConsole, this.timerRegistry.timers);
    }

    /**
     * Create shared context object that will be augmented with response data later
     */
    private createSharedContext(): any {
        const context = this.initialContext;
        const modifiedRequest = this.modifiedRequest;

        // Get common context from executor
        const commonCtx = this.deps.createCommonContext(context, 'prerequest');

        // Store variable references for extraction
        // IMPORTANT: Use the live scope references from commonCtx so that mutations
        // from pm.environment.set() / pm.globals.set() etc. are visible at extraction time
        this._variables = { ...context.variables };
        this._collectionVariables = { ...(context.collectionVariables || {}) };
        this._globals = { ...(context.globals || {}) };
        this._environmentVariables = { ...(context.environmentVariables || {}) };
        // Keep a reference to the live scopes for accurate extraction
        this._liveEnvironmentScope = commonCtx.environment;
        this._liveGlobalsScope = commonCtx.globals;
        this._liveCollectionScope = commonCtx.collectionVariables;

        // Extract domain from request URL for domain-aware cookie operations
        let requestDomain: string | undefined;
        try {
            requestDomain = new URL(context.request.url).hostname;
        } catch (error) {
            // Invalid URL, proceed without domain
        }

        // Create cookies object that delegates to cookieJar for domain-aware operations
        const cookiesObject = {
            get: (cookieName: string) => {
                if (!context.cookieJar) return undefined;
                const cookie = context.cookieJar.get(cookieName, requestDomain);
                return cookie?.value;
            },
            set: (cookieName: string, cookieValue: string) => {
                if (!context.cookieJar) return;
                context.cookieJar.set({ name: cookieName, value: cookieValue, domain: requestDomain });
            },
            has: (cookieName: string) => {
                if (!context.cookieJar) return false;
                return context.cookieJar.has(cookieName, requestDomain);
            },
            list: () => {
                if (!context.cookieJar) return [];
                return context.cookieJar.getAll(requestDomain).map((c: any) => ({ name: c.name, value: c.value }));
            },
            toObject: () => {
                if (!context.cookieJar) return {};
                const cookies = context.cookieJar.getAll(requestDomain);
                const obj: Record<string, string> = {};
                for (const c of cookies) {
                    obj[(c as any).name] = (c as any).value;
                }
                return obj;
            },
            jar: () => {
                // Return a Postman-compatible CookieJar object with async callback methods
                // Postman API: jar.getAll(domain, cb), jar.get(domain, name, cb),
                //              jar.set(domain, name, value, cb), jar.unset(domain, name, cb),
                //              jar.clear(cb)
                const jar = context.cookieJar;

                const normalizeDomainInput = (value: unknown): string | undefined => {
                    if (value == null) return undefined;

                    const rawValue = typeof value === 'string'
                        ? value
                        : (typeof value === 'object' || typeof value === 'number' || typeof value === 'boolean')
                            ? String(value)
                            : undefined;

                    if (!rawValue) return undefined;

                    const trimmed = rawValue.trim();
                    if (!trimmed) return undefined;

                    // Postman jar methods commonly receive a URL; normalize to hostname.
                    try {
                        return new URL(trimmed).hostname;
                    } catch {
                        return trimmed;
                    }
                };

                return {
                    getAll(domain: unknown, callback: (error: any, cookies: any[]) => void) {
                        try {
                            if (!jar) { callback(null, []); return; }
                            const normalizedDomain = normalizeDomainInput(domain);
                            const cookies = jar.getAll(normalizedDomain).map((c: any) => ({
                                name: c.name, value: c.value, domain: c.domain,
                                path: c.path, httpOnly: c.httpOnly, secure: c.secure
                            }));
                            callback(null, cookies);
                        } catch (e) { callback(e, []); }
                    },
                    get(domain: unknown, name: string, callback: (error: any, cookie: any) => void) {
                        try {
                            if (!jar) { callback(null, undefined); return; }
                            const normalizedDomain = normalizeDomainInput(domain);
                            const cookie = jar.get(name, normalizedDomain);
                            callback(null, cookie ? { name: cookie.name, value: cookie.value, domain: cookie.domain } : undefined);
                        } catch (e) { callback(e, undefined); }
                    },
                    set(domain: unknown, nameOrCookie: string | any, valueOrCb?: string | ((error: any) => void), callback?: (error: any) => void) {
                        try {
                            if (!jar) { (callback || valueOrCb as any)?.(null); return; }
                            const normalizedDomain = normalizeDomainInput(domain);
                            if (typeof nameOrCookie === 'string' && typeof valueOrCb === 'string') {
                                // jar.set(domain, name, value, cb)
                                jar.set({ name: nameOrCookie, value: valueOrCb, domain: normalizedDomain });
                                callback?.(null);
                            } else if (typeof nameOrCookie === 'object') {
                                // jar.set(domain, cookieObj, cb)
                                jar.set({ ...nameOrCookie, domain: normalizedDomain });
                                (valueOrCb as any)?.(null);
                            }
                        } catch (e) { (callback || valueOrCb as any)?.(e); }
                    },
                    unset(domain: unknown, name: string, callback?: (error: any) => void) {
                        try {
                            if (!jar) { callback?.(null); return; }
                            const normalizedDomain = normalizeDomainInput(domain);
                            jar.delete(name, normalizedDomain);
                            callback?.(null);
                        } catch (e) { callback?.(e); }
                    },
                    clear(domainOrCallback?: unknown, callback?: (error: any) => void) {
                        try {
                            const cb = typeof domainOrCallback === 'function' ? domainOrCallback : callback;
                            if (!jar) { cb?.(null); return; }

                            const maybeDomain = typeof domainOrCallback === 'function'
                                ? undefined
                                : normalizeDomainInput(domainOrCallback);

                            if (maybeDomain && typeof jar.clearDomain === 'function') {
                                jar.clearDomain(maybeDomain);
                            } else {
                                jar.clear();
                            }

                            cb?.(null);
                        } catch (e) {
                            const cb = typeof domainOrCallback === 'function' ? domainOrCallback : callback;
                            cb?.(e);
                        }
                    }
                };
            },
            remove: (cookieName: string) => {
                if (!context.cookieJar) return;
                context.cookieJar.delete(cookieName, requestDomain);
            },
            unset: (cookieName: string) => {
                if (!context.cookieJar) return;
                context.cookieJar.delete(cookieName, requestDomain);
            },
            clear: () => {
                if (!context.cookieJar) return;
                context.cookieJar.clear();
            }
        };

        // Capture reference for closures
        const session = this;

        return {
            // Request object (modifiable in pre-request)
            request: createRequestObject(modifiedRequest, context),

            // Response object (will be set before post-response scripts run)
            response: null as any,

            // Test function using utility
            test: createTestFunction(this.assertions),

            // Expect for assertions using factory
            expect: createExpectChain,

            // Cookies management
            cookies: cookiesObject,

            // Postman-compatible pm.execution namespace
            execution: {
                setNextRequest(requestName: string | null) {
                    session._nextRequest = requestName;
                },
                skipRequest() {
                    session._skipRequest = true;
                },
                // Run an arbitrary request and receive a pm.response-compatible object.
                // Mirrors pm.sendRequest semantics: accepts a URL string or a request
                // definition object ({ url, method, headers, body }), and supports both
                // promise and callback styles. This performs a bare HTTP call and does
                // not execute the target's scripts, so it cannot recurse.
                runRequest(target: string | Record<string, unknown>, callback?: (err: Error | null, res?: any) => void) {
                    const run = async () => {
                        if (typeof commonCtx.sendRequest !== 'function') {
                            throw new Error('pm.execution.runRequest is not available — HTTP service not configured.');
                        }
                        const definition = typeof target === 'string' ? { url: target, method: 'GET' } : target;
                        const raw: any = await commonCtx.sendRequest(definition);
                        const cookies = Array.isArray(raw?.cookies)
                            ? raw.cookies.filter((c: any) => c?.name)
                            : [];
                        const body = raw?.body;
                        let responseSize = 0;
                        if (typeof body === 'string') {
                            responseSize = Buffer.byteLength(body, 'utf8');
                        } else if (Buffer.isBuffer(body)) {
                            responseSize = body.length;
                        } else if (body != null) {
                            try { responseSize = Buffer.byteLength(JSON.stringify(body), 'utf8'); } catch { /* non-serializable */ }
                        }
                        return createResponseObject({
                            executedRequest: null as any,
                            status: raw?.status ?? 0,
                            statusText: raw?.statusText ?? '',
                            headers: raw?.headers ?? {},
                            body,
                            cookies,
                            responseTime: raw?.time,
                            responseSize
                        });
                    };

                    const promise = run();
                    if (typeof callback === 'function') {
                        promise.then(res => callback(null, res), err => callback(err));
                        return undefined;
                    }
                    return promise;
                },
                // Postman execution location metadata
                location: {
                    current: commonCtx.info?.requestName || '',
                    currentRequestName: commonCtx.info?.requestName || '',
                    eventName: 'prerequest',
                    toString() { return commonCtx.info?.requestName || ''; }
                }
            },

            // Alias at top level: pm.setNextRequest(name)
            setNextRequest(requestName: string | null) {
                session._nextRequest = requestName;
            },

            // Postman-compatible pm.visualizer namespace
            visualizer: {
                set(template: string, data?: any) {
                    session._visualizerData = { template, data };
                },
                clear() {
                    session._visualizerData = undefined;
                }
            },

            // Spread common context (globals, variables, environment, session, etc.)
            ...commonCtx,

            // Override info with complete metadata including iteration info
            info: {
                ...(commonCtx.info || {}),
                eventName: 'prerequest',
                requestName: commonCtx.info?.requestName || undefined,
                requestId: commonCtx.info?.requestId || undefined,
                iteration: context.iteration || 0,
                iterationCount: context.iterationCount || 1
            }
        };
    }


    /**
     * Inject the legacy (pre-`pm.*`) Postman/Newman sandbox globals into the VM context.
     *
     * Older Postman scripts (and many Newman-exported collections) rely on bare globals
     * that the modern `pm.*` sandbox no longer injects. Evaluating them (e.g. `request.name`,
     * `responseCode.code`, `tv4.validate(...)`) otherwise throws `ReferenceError`.
     *
     * Available in BOTH phases: `request`, `environment`, `globals`, `data`, `iteration`.
     * Available in the TEST phase only: `responseBody`, `responseCode`, `responseHeaders`,
     * `responseTime`, `responseCookies`, `tests`, plus `postman.getResponseHeader()` /
     * `postman.getResponseCookie()`.
     */
    private injectLegacyGlobals(phase: 'prerequest' | 'test', responseContext?: ResponseContext): void {
        const vmCtx = this.vmContext as any;
        if (!vmCtx) {
            return;
        }
        const context = this.initialContext;

        // `request` — legacy bare global (a plain snapshot, distinct from the rich pm.request)
        const reqSource = phase === 'test' && responseContext?.executedRequest
            ? responseContext.executedRequest
            : this.modifiedRequest;
        const headersObj: Record<string, string> = {};
        for (const [key, value] of Object.entries(reqSource?.headers || {})) {
            if (typeof value === 'string') {
                headersObj[key] = value;
            }
        }
        const rawBody = (reqSource as any)?.body;
        const requestData = rawBody == null
            ? null
            : (typeof rawBody === 'object' && 'content' in rawBody ? rawBody.content : rawBody);
        const requestMeta = context.request as any;
        vmCtx.request = {
            id: requestMeta?.id ?? '',
            name: requestMeta?.name ?? '',
            description: requestMeta?.description ?? '',
            url: typeof reqSource?.url === 'string' ? reqSource.url : String(reqSource?.url ?? ''),
            method: reqSource?.method ?? 'GET',
            headers: headersObj,
            data: requestData
        };

        // Variable snapshots — legacy reads only (mutations must go through postman.set*)
        vmCtx.environment = this._liveEnvironmentScope?.toObject?.() ?? { ...this._environmentVariables };
        vmCtx.globals = this._liveGlobalsScope?.toObject?.() ?? { ...this._globals };
        vmCtx.data = { ...(context.iterationData || {}) };
        if (typeof vmCtx.iteration !== 'number') {
            vmCtx.iteration = 0;
        }

        if (phase !== 'test' || !responseContext) {
            return;
        }

        // `responseBody` — Postman keeps the raw response string even in the legacy sandbox.
        const legacyBody = responseContext.body;
        vmCtx.responseBody = legacyBody == null
            ? ''
            : (typeof legacyBody === 'string' ? legacyBody : JSON.stringify(legacyBody));

        const statusText = responseContext.statusText || '';
        vmCtx.responseCode = {
            code: responseContext.status,
            name: statusText,
            detail: statusText
        };
        vmCtx.responseHeaders = { ...(responseContext.headers || {}) };
        vmCtx.responseTime = responseContext.responseTime ?? 0;
        // Full cookie metadata (domain, path, expires, maxAge, httpOnly, secure, sameSite).
        vmCtx.responseCookies = (responseContext.cookies || []).map(c => ({ ...c }));

        // `tests` — legacy assertion bag: `tests['name'] = boolean`
        const session = this;
        vmCtx.tests = new Proxy({} as Record<PropertyKey, any>, {
            set(_t: Record<PropertyKey, any>, prop: PropertyKey, value: any) {
                session.assertions.push({
                    name: String(prop),
                    passed: Boolean(value),
                    message: Boolean(value) ? undefined : `"${String(prop)}" was false`
                });
                return true;
            }
        });

        // Note: the legacy postman.getResponseHeader() / getResponseCookie() helpers
        // are defined once in createVM's static `postman` namespace — they read from
        // the live ctx.response, so no per-phase re-attachment is needed here.
    }

    /**
     * Execute pre-request scripts in the shared session
     */
    async executePreRequest(script: string | string[]): Promise<PreRequestScriptResult> {
        const combinedScript = concatenateScripts(script, this.deps.isolateScripts);
        
        if (!combinedScript || !combinedScript.trim()) {
            return { success: true };
        }

        try {
            // Clear console messages for this execution phase
            this.consoleMessages.length = 0;

            // Inject the legacy (pre-pm.*) Postman sandbox globals available to
            // pre-request scripts (request, environment, globals, data, iteration).
            this.injectLegacyGlobals('prerequest');

            // Pre-resolve {{}} templates in script source (Postman-compatible)
            const resolvedScript = this.ctx.variables.replaceIn(combinedScript);

            const scriptTimeoutMs = this.deps.scriptTimeoutMs ?? 5000;

            // Run pre-request scripts in the shared VM context
            const runResult = vm.runInContext(resolvedScript, this.vmContext!, { timeout: scriptTimeoutMs });
            // In isolated mode the program is an async IIFE — await its completion.
            if (this.deps.isolateScripts && runResult && typeof (runResult as any).then === 'function') {
                await runResult;
            }

            // Keep the sandbox alive until pending timers / un-awaited Promises settle
            // (Postman-compatible), bounded by the script timeout. Late variable writes
            // made by those callbacks are committed below.
            const drainResult = await this.timerRegistry.drain(scriptTimeoutMs);
            if (drainResult.timedOut) {
                this.consoleMessages.push({
                    level: 'warn',
                    args: [`Script timed out after ${scriptTimeoutMs}ms; pending async work was cancelled.`]
                });
            }
            
            // Format console output
            const consoleOutput = formatConsoleOutput(this.consoleMessages);

            // Check if body was modified
            const initialBody = this.initialContext.request.body;
            const bodyModified = !this.bodiesEqual(this.modifiedRequest.body, initialBody);

            return {
                success: true,
                modifiedRequest: {
                    url: this.modifiedRequest.url !== this.initialContext.request.url ? this.modifiedRequest.url : undefined,
                    headers: hasChanged(this.modifiedRequest.headers, this.initialContext.request.headers) ? this.modifiedRequest.headers : undefined,
                    body: bodyModified ? this.modifiedRequest.body : undefined,
                    params: hasChanged(this.modifiedRequest.params, this.initialContext.request.params || {}) ? this.modifiedRequest.params : undefined,
                    query: hasChanged(this.modifiedRequest.query, this.initialContext.request.query || {}) ? this.modifiedRequest.query : undefined
                },
                modifiedVariables: this.ctx.variables.toObject(),
                localVariables: this.ctx.variables.toLocalObject?.() ?? {},
                modifiedCollectionVariables: this._liveCollectionScope?.toObject() || this._collectionVariables,
                modifiedGlobals: this._liveGlobalsScope?.toObject() || this._globals,
                modifiedEnvironmentVariables: this._liveEnvironmentScope?.toObject() || this._environmentVariables,
                consoleOutput: consoleOutput.length > 0 ? consoleOutput : undefined,
                nextRequest: this._nextRequest,
                skipRequest: this._skipRequest || undefined
            };
        } catch (error: any) {
            // Preserve any console output captured before the error was thrown,
            // then append the failure line so users still see their logs.
            const consoleOutput = [
                ...formatConsoleOutput(this.consoleMessages),
                `[error] Script execution failed: ${error.message}`
            ];
            return {
                success: false,
                error: error.message || 'Pre-request script execution failed',
                consoleOutput,
                // Preserve any variable mutations made before the error
                modifiedVariables: this.ctx?.variables?.toObject(),
                localVariables: this.ctx?.variables?.toLocalObject?.() ?? {},
                modifiedEnvironmentVariables: this._liveEnvironmentScope?.toObject() || this._environmentVariables,
                nextRequest: this._nextRequest,
                skipRequest: this._skipRequest || undefined
            };
        }
    }

    /**
     * Execute post-response scripts in the shared session
     * The response data is injected into the existing VM context
     */
    async executePostResponse(script: string | string[], responseContext: ResponseContext): Promise<PostResponseScriptResult> {
        const combinedScript = concatenateScripts(script, this.deps.isolateScripts);
        
        if (!combinedScript || !combinedScript.trim()) {
            return { testResults: [], consoleOutput: [] };
        }

        try {
            // Clear console messages and assertions for this execution phase
            this.consoleMessages.length = 0;
            this.assertions.length = 0;

            // Update info.eventName to 'test'
            this.ctx.info.eventName = 'test';

            // Inject response into ctx using factory
            this.ctx.response = createResponseObject(responseContext);

            // Update request object with executed request data
            this.ctx.request = createRequestObject(responseContext.executedRequest, this.initialContext);

            // Inject the legacy (pre-pm.*) Postman sandbox globals for the test phase
            // (request, responseBody, responseCode, responseHeaders, responseTime,
            // responseCookies, tests, environment, globals, data, iteration) plus the
            // postman.getResponseHeader()/getResponseCookie() helpers.
            this.injectLegacyGlobals('test', responseContext);

            // Pre-resolve {{}} templates in script source (Postman-compatible)
            const resolvedScript = this.ctx.variables.replaceIn(combinedScript);

            const scriptTimeoutMs = this.deps.scriptTimeoutMs ?? 5000;

            // Run post-response scripts in the shared VM context
            const runResult = vm.runInContext(resolvedScript, this.vmContext!, { timeout: scriptTimeoutMs });
            // In isolated mode the program is an async IIFE — await its completion.
            if (this.deps.isolateScripts && runResult && typeof (runResult as any).then === 'function') {
                await runResult;
            }

            // Wait for any async test functions to complete
            if (this.ctx.test._pendingTests?.length > 0) {
                await Promise.all(this.ctx.test._pendingTests);
                this.ctx.test._pendingTests.length = 0;
            }

            // Keep the sandbox alive until pending timers / un-awaited Promises settle
            // (Postman-compatible), bounded by the script timeout. Late variable writes
            // made by those callbacks are committed below so the next request sees them.
            const drainResult = await this.timerRegistry.drain(scriptTimeoutMs);
            if (drainResult.timedOut) {
                this.consoleMessages.push({
                    level: 'warn',
                    args: [`Script timed out after ${scriptTimeoutMs}ms; pending async work was cancelled.`]
                });
            }

            // Format console output
            const consoleOutput = formatConsoleOutput(this.consoleMessages);

            return {
                testResults: [...this.assertions],
                consoleOutput: consoleOutput.length > 0 ? consoleOutput : undefined,
                modifiedVariables: this.ctx?.variables?.toObject?.(),
                localVariables: this.ctx?.variables?.toLocalObject?.() ?? {},
                modifiedEnvironmentVariables: this._liveEnvironmentScope?.toObject() || this._environmentVariables,
                modifiedGlobals: this._liveGlobalsScope?.toObject() || this._globals,
                modifiedCollectionVariables: this._liveCollectionScope?.toObject() || this._collectionVariables,
                nextRequest: this._nextRequest,
                visualizerData: this._visualizerData
            };
        } catch (error: any) {
            this.assertions.push({
                name: 'Script Execution',
                passed: false,
                message: error.message || 'Script execution failed'
            });
            // Preserve any console output captured before the error was thrown,
            // then append the failure line so users still see their logs.
            const consoleOutput = [
                ...formatConsoleOutput(this.consoleMessages),
                `[error] Script execution failed: ${error.message}`
            ];
            return {
                testResults: [...this.assertions],
                consoleOutput,
                modifiedVariables: this.ctx?.variables?.toObject?.(),
                localVariables: this.ctx?.variables?.toLocalObject?.() ?? {},
                // Preserve any environment mutations made before the error
                modifiedEnvironmentVariables: this._liveEnvironmentScope?.toObject() || this._environmentVariables,
                modifiedGlobals: this._liveGlobalsScope?.toObject() || this._globals,
                modifiedCollectionVariables: this._liveCollectionScope?.toObject() || this._collectionVariables,
                nextRequest: this._nextRequest,
                visualizerData: this._visualizerData
            };
        }
    }

    /**
     * Compare two RequestBody objects for equality
     */
    private bodiesEqual(a: RequestBody | null | undefined, b: RequestBody | null | undefined): boolean {
        if (a === b) return true;
        if (!a && !b) return true;
        if (!a || !b) return false;
        return a.type === b.type && 
               a.format === b.format && 
               JSON.stringify(a.content) === JSON.stringify(b.content);
    }

    /**
     * Clean up the session resources
     */
    dispose(): void {
        this.timerRegistry.clearAll();
        this.vmContext = null;
        this.ctx = null;
        this.assertions = [];
    }
}
