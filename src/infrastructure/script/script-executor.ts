/**
 * Script Executor
 * 
 * Single Responsibility: Orchestrate script execution and VM configuration
 * Open/Closed: Uses composition to delegate to specialized modules
 * Dependency Inversion: Depends on abstractions (IRequestScriptSession, IScriptExecutor)
 * 
 * This is the main entry point for script execution.
 * It configures the VM sandbox and delegates session management to RequestScriptSession.
 * 
 * CryptoJS compatibility lives in ./crypto-js-compat
 * Variable scopes live in ./variable-scopes
 */

import * as crypto from 'crypto';
import * as querystring from 'querystring';
import * as vm from 'vm';
import { IHttpRequestService } from '../http/interfaces';
import { SecretResolverRegistry } from '../secrets/secret-resolver-registry';
import { SandboxTimers } from './async-drain';
import { createCryptoJS } from './crypto-js-compat';
import {
    CommonScriptContext,
    IRequestScriptSession,
    IScriptExecutor,
    PreRequestScriptContext
} from './interfaces';
import { createModuleLoader, createMomentShim, ModuleLoader } from './module-loader';
import { RequestScriptSession } from './request-script-session';
import { createExpectChain } from './script-factories';
import { VariableScopeFactory } from './variable-scopes';

/**
 * Script Executor Implementation
 * 
 * Orchestrates script execution by:
 * - Configuring VM sandbox with built-in libraries
 * - Creating common context for variable scopes
 * - Delegating session management to RequestScriptSession
 */
export class ScriptExecutor implements IScriptExecutor {
    private readonly moduleLoader: ModuleLoader;
    private readonly variableScopes = new VariableScopeFactory();

    constructor(
        private readonly httpService?: IHttpRequestService,
        modulePaths: string[] = [],
        private readonly secretRegistry?: SecretResolverRegistry,
        private readonly scopeMode: 'shared' | 'isolated' = 'shared',
        private readonly scriptTimeoutMs: number = 5000
    ) {
        this.moduleLoader = createModuleLoader(modulePaths);
    }

    /**
     * Create a request execution session
     * Factory method implementing IScriptExecutor
     */
    createRequestSession(context: PreRequestScriptContext): IRequestScriptSession {
        return new RequestScriptSession(
            {
                createVM: this.createVM.bind(this),
                createCommonContext: this.createCommonContext.bind(this),
                isolateScripts: this.scopeMode === 'isolated',
                scriptTimeoutMs: this.scriptTimeoutMs
            },
            context
        );
    }

    /**
     * Create VM context with sandbox configuration
     * Returns a context object that can be used with vm.runInContext()
     *
     * @param timers Optional instrumented timer set. When provided, the sandbox uses
     *               these instead of the Node globals so the session can track and
     *               drain pending timers (Postman-compatible async behavior).
     */
    private createVM(ctx: any, scriptConsole: any, timers?: SandboxTimers): vm.Context {
        const globalSetup = this.moduleLoader.getGlobalSetupExports();
        const requireFn = this.moduleLoader.createRequireFunction();

        // Expose Postman-compatible namespaces on the pm/ctx object
        ctx.require = requireFn;          // pm.require(...) → sandbox module loader
        ctx.vault = this.createVault();   // pm.vault.get(...) → secret provider system

        const sandbox = {
            // Context aliases
            ctx,
            hf: ctx,
            pm: ctx,
            console: scriptConsole,

            // Global setup exports
            ...(globalSetup || {}),
            global: globalSetup,

            // Timers — instrumented when provided so pending timers can be drained,
            // falling back to the Node globals otherwise.
            setTimeout: timers?.setTimeout ?? setTimeout,
            setInterval: timers?.setInterval ?? setInterval,
            clearTimeout: timers?.clearTimeout ?? clearTimeout,
            clearInterval: timers?.clearInterval ?? clearInterval,

            // Node.js built-ins
            URL,
            URLSearchParams,
            Buffer,
            atob: (str: string) => Buffer.from(str, 'base64').toString('binary'),
            btoa: (str: string) => Buffer.from(str, 'binary').toString('base64'),
            TextEncoder,
            TextDecoder,
            crypto,

            // Utility libraries
            _: requireFn('lodash'),
            require: requireFn,
            moment: createMomentShim(),
            querystring,
            CryptoJS: createCryptoJS(),

            // Legacy Postman bare global for JSON Schema validation (tv4.validate(...)).
            // Optional dependency — omitted silently when not installed so VM creation
            // never fails; scripts can still `pm.require('tv4')` for an explicit error.
            tv4: (() => {
                try {
                    return requireFn('tv4');
                } catch {
                    return undefined;
                }
            })(),

            // Legacy Postman namespace — provides backward-compatible postman.* API
            postman: {
                setNextRequest:           (name: string | null) => ctx.setNextRequest?.(name),
                setGlobalVariable:        (key: string, val: any) => ctx.globals?.set(key, val),
                getGlobalVariable:        (key: string) => ctx.globals?.get(key),
                clearGlobalVariable:      (key: string) => ctx.globals?.unset(key),
                setEnvironmentVariable:   (key: string, val: any) => ctx.environment?.set(key, val),
                getEnvironmentVariable:   (key: string) => ctx.environment?.get(key),
                clearEnvironmentVariable: (key: string) => ctx.environment?.unset(key),
                // Response accessors read from the live ctx.response (set before the
                // test phase). They no-op to null during the pre-request phase when
                // no response exists yet, matching legacy Postman behavior.
                getResponseHeader: (name: string): string | null => {
                    const value = ctx.response?.headers?.get?.(name);
                    return value === undefined ? null : value;
                },
                getResponseCookie: (name: string): Record<string, any> | null => {
                    // Read from the live ctx.response CookieList (set before the test
                    // phase). Case-insensitive lookup, returns the full cookie object.
                    const cookies = ctx.response?.cookies;
                    if (cookies && typeof cookies[Symbol.iterator] === 'function') {
                        for (const cookie of cookies) {
                            if (cookie?.name && cookie.name.toLowerCase() === name.toLowerCase()) {
                                return { ...cookie };
                            }
                        }
                    }
                    return null;
                },
            },

            // Postman-compatible global utility functions
            jsonStringify: (value: any, replacer?: any, space?: any) => JSON.stringify(value, replacer, space),
            jsonParse: (text: string) => JSON.parse(text),
            xml2Json: (xmlStr: string) => {
                try {
                    const xml2js = this.moduleLoader.createRequireFunction()('xml2js');
                    let result: any;
                    xml2js.parseString(xmlStr, { explicitArray: false }, (err: any, parsed: any) => {
                        if (err) { throw err; }
                        result = parsed;
                    });
                    return result;
                } catch {
                    throw new Error(
                        'xml2Json() requires the xml2js module. ' +
                        'Add it to your modules/package.json and run npm install.'
                    );
                }
            }
        };

        return vm.createContext(sandbox);
    }

    /**
     * Create common context object for variable scopes
     * Used by RequestScriptSession for pre-request and test scripts
     */
    private createCommonContext(context: CommonScriptContext, eventName: 'prerequest' | 'test') {
        const variables = { ...context.variables };
        const collectionVariables = { ...(context.collectionVariables || {}) };
        const globals = { ...(context.globals || {}) };
        const environmentVariables = { ...(context.environmentVariables || {}) };
        const iterationData = context.iterationData || {};

        // Create merged scope (has replaceIn logic) — Postman 5-scope cascade:
        // variables > iterationData > environmentVariables > collectionVariables > globals
        const mergedScope = this.variableScopes.createMergedVariableScope(
            variables, environmentVariables, collectionVariables, globals, iterationData
        );

        // Create individual scopes
        const rawGlobalsScope: any = this.variableScopes.createGlobalsScope(globals, context.onGlobalsChange);
        const collectionScope: any = this.variableScopes.createVariableScope(collectionVariables);
        const rawEnvironmentScope: any = this.variableScopes.createEnvironmentScope(
            environmentVariables, context.environmentName, context.onEnvironmentChange, true
        );

        // Wrap environment set() to also update the merged `variables` map.
        // Without this, pm.environment.set(key, val) updates `environmentVariables` but
        // the stale copy in `variables` (higher priority) shadows it for {{}} resolution.
        const environmentScope: any = {
            ...rawEnvironmentScope,
            set: (key: string, value: any) => {
                const serialized = this.variableScopes.serializeValue(value);
                rawEnvironmentScope.set(key, serialized);
                variables[key] = serialized;
            },
            unset(key: string) {
                rawEnvironmentScope.unset(key);
                delete variables[key];
            },
            clear() {
                const keysToRemove = Object.keys(environmentVariables);
                rawEnvironmentScope.clear();
                for (const k of keysToRemove) { delete variables[k]; }
            }
        };

        // Wrap globals set() to also update the merged `variables` map.
        // Without this, pm.globals.set(key, val) updates `globals` but a stale
        // copy in `variables` (higher priority) can shadow it for {{}} resolution.
        const globalsScope: any = {
            ...rawGlobalsScope,
            set: (key: string, value: any) => {
                const serialized = this.variableScopes.serializeValue(value);
                rawGlobalsScope.set(key, serialized);
                variables[key] = serialized;
            },
            unset(key: string) {
                rawGlobalsScope.unset(key);
                delete variables[key];
            },
            clear() {
                const keysToRemove = Object.keys(globals);
                rawGlobalsScope.clear();
                for (const k of keysToRemove) { delete variables[k]; }
            }
        };

        // Add replaceIn to all scopes (Postman-compatible — delegates to merged variable resolution)
        globalsScope.replaceIn = mergedScope.replaceIn;
        collectionScope.replaceIn = mergedScope.replaceIn;
        environmentScope.replaceIn = mergedScope.replaceIn;

        // Create iterationData scope (Postman-compatible read-only data row)
        const iterationDataScope = {
            get: (key: string) => iterationData[key],
            has: (key: string) => key in iterationData,
            toObject: () => ({ ...iterationData }),
            toJSON: () => JSON.stringify(iterationData),
        };

        return {
            globals: globalsScope,
            collectionVariables: collectionScope,
            variables: mergedScope,
            environment: environmentScope,
            iterationData: iterationDataScope,
            sendRequest: this.createSendRequest(
                variables,
                environmentVariables,
                collectionVariables,
                globals,
                iterationData
            ),
            expect: createExpectChain,
            info: context.info || {
                eventName,
                requestName: undefined,
                requestId: undefined
            }
        };
    }

    /**
     * Create the Postman-compatible pm.vault namespace.
     * Reads are backed by HTTP Forge's secret provider system using the same
     * {{secret:provider/path}} resolution. Writes are not supported (read-only),
     * and resolved values are never persisted to console/report output here.
     */
    private createVault() {
        const registry = this.secretRegistry;
        const readOnly = () => {
            throw new Error(
                'pm.vault is read-only in HTTP Forge. Use environment variables or ' +
                '{{secret:provider/path}} tokens to manage secrets.'
            );
        };
        return {
            async get(key: string): Promise<string | undefined> {
                if (!registry) {
                    throw new Error(
                        'pm.vault is not available — no secret providers are configured. ' +
                        'Configure a provider under "secrets.providers" to use pm.vault.get().'
                    );
                }
                const token = `secret:${key}`;
                const resolved = await registry.resolveSecretTokens(`{{${token}}}`);
                return resolved[token];
            },
            set: readOnly,
            unset: readOnly,
        };
    }

    /**
     * Create sendRequest function using httpService.
     *
     * Postman resolves variables (including `{{secret:...}}` tokens) in
     * pm.sendRequest definitions. The normal request pipeline does this in
     * RequestPreparer, but pm.sendRequest calls the HTTP service directly, so
     * resolve the script scopes here first. Secrets are resolved asynchronously
     * and injected into the merged scope, where the existing `replaceIn`
     * pipeline handles filters and nested references.
     */
    private createSendRequest(
        variables: Record<string, string>,
        environmentVariables: Record<string, string>,
        collectionVariables: Record<string, string>,
        globals: Record<string, string>,
        iterationData: Record<string, any>
    ) {
        if (!this.httpService) {
            return (options: any, callback?: Function) => {
                const error = new Error('sendRequest not available - HTTP service not configured');
                if (callback) {
                    callback(error, null);
                    return;
                }
                return Promise.reject(error);
            };
        }

        const prepare = async (options: any): Promise<any> => {
            const secretValues = (await this.secretRegistry?.resolveSecretTokens([
                options,
                variables,
                environmentVariables,
                collectionVariables,
                globals,
                iterationData,
            ])) ?? {};

            const scope = this.variableScopes.createMergedVariableScope(
                { ...variables, ...secretValues },
                environmentVariables,
                collectionVariables,
                globals,
                iterationData
            );

            return this.replaceInObject(options, value => scope.replaceIn(value));
        };

        return (urlOrOptions: string | any, callback?: Function) => {
            const options = typeof urlOrOptions === 'string'
                ? { url: urlOrOptions, method: 'GET' }
                : urlOrOptions;

            const promise = prepare(options).then(resolved => this.httpService!.execute({
                url: resolved.url,
                method: resolved.method || 'GET',
                headers: resolved.headers || {},
                body: resolved.body,
                ...resolved
            }));

            if (callback) {
                promise
                    .then(response => callback(null, response))
                    .catch(error => callback(error, null));
                return;
            }

            return promise;
        };
    }

    /** Recursively apply `replaceIn` to string values, preserving object shape. */
    private replaceInObject(value: any, replaceIn: (input: string) => string): any {
        if (typeof value === 'string') return replaceIn(value);
        if (Array.isArray(value)) return value.map(item => this.replaceInObject(item, replaceIn));
        if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
            const out: Record<string, unknown> = {};
            for (const key in value) out[key] = this.replaceInObject(value[key], replaceIn);
            return out;
        }
        return value;
    }
}
