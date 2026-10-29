/**
 * ForgeEnv - Unified Environment Service
 * 
 * Combines environment variable storage with template resolution.
 * This is the main interface for generated API clients to use.
 * 
 * Features:
 * - Variable storage (get/set)
 * - Template resolution: {{variable}}
 * - Path parameter resolution: :param, :param(regex), :param?
 * - Object deep resolution
 * 
 * @example
 * ```typescript
 * import { ForgeEnv } from '@http-forge/core';
 * 
 * const env = ForgeEnv.create({
 *     baseUrl: 'https://api.example.com',
 *     apiKey: 'secret123',
 * });
 * 
 * // Template resolution
 * env.resolve('{{baseUrl}}/users');  // 'https://api.example.com/users'
 * 
 * // Path parameter resolution
 * env.resolvePath('{{baseUrl}}/users/:id', { id: '123' });  // 'https://api.example.com/users/123'
 * 
 * // Set/get variables
 * env.set('token', 'abc');
 * env.get('token');  // 'abc'
 * ```
 */

import type { IEnvironmentStore, IVariableInterpolator } from '../../types/environment-config';
import { IUrlBuilder, UrlBuilder } from '../http/url-builder';
import { EnvironmentResolver } from './environment-resolver';
import { VariableInterpolator } from './variable-interpolator';

/**
 * ForgeEnv interface - the public API for environment management
 */
export interface IForgeEnv {
    /**
     * Get a variable value
     */
    get(key: string): string | undefined;

    /**
     * Set a variable value
     */
    set(key: string, value: string): void;

    /**
     * Check if a variable exists
     */
    has(key: string): boolean;

    /**
     * Delete a variable
     */
    delete(key: string): void;

    /**
     * Get all variables
     */
    getAll(): Record<string, string>;

    /**
     * Get the active environment name (e.g., 'dev', 'sit', 'prod')
     */
    getActiveEnvironment(): string | undefined;

    /**
     * Set the active environment by name
     * @param name - Environment name (e.g., 'dev', 'sit', 'prod')
     */
    setActiveEnvironment(name: string): void;

    /**
     * Get list of available environment names
     */
    getEnvironments(): string[];

    /**
     * Get all global variables (environment-agnostic variable layer)
     */
    getGlobals(): Record<string, string>;

    /**
     * Set a global variable value
     */
    setGlobal(key: string, value: string): void;

    /**
     * Remove a global variable
     */
    unsetGlobal(key: string): void;

    /**
     * Clear all (session) global variables
     */
    clearGlobals(): void;

    /**
     * Resolve {{variable}} placeholders in a string
     */
    resolve(template: string): string;

    /**
     * Resolve {{variable}} and :pathParam placeholders in a URL
     */
    resolvePath(urlPattern: string, params?: Record<string, string>): string;

    /**
     * Build a complete URL with variables, path params, and query params
     */
    buildUrl(
        urlPattern: string,
        options?: {
            params?: Record<string, string>;
            query?: Record<string, string>;
        }
    ): string;

    /**
     * Resolve variables in an object recursively (deep)
     */
    resolveObject<T>(obj: T): T;

    /**
     * Extract variable names from a template string
     */
    extractVariables(template: string): string[];

    /**
     * Extract path parameter names from a URL pattern
     */
    extractPathParams(urlPattern: string): string[];
}

/**
 * ForgeEnv implementation
 */
export class ForgeEnv implements IForgeEnv {
    private readonly envStore: IEnvironmentStore;
    private readonly interpolator: IVariableInterpolator;
    private readonly urlBuilder: IUrlBuilder;

    constructor(
        envStore: IEnvironmentStore,
        interpolator?: IVariableInterpolator
    ) {
        this.envStore = envStore;
        this.interpolator = interpolator || new VariableInterpolator();
        this.urlBuilder = new UrlBuilder();
    }

    // ============================================================
    // Variable Management
    // ============================================================

    get(key: string): string | undefined {
        return this.envStore.get(key);
    }

    set(key: string, value: string): void {
        this.envStore.set(key, value);
    }

    has(key: string): boolean {
        return this.envStore.get(key) !== undefined;
    }

    delete(key: string): void {
        // Set to empty to "delete" (IEnvironmentStore doesn't have delete)
        this.envStore.set(key, '');
    }

    getAll(): Record<string, string> {
        return this.envStore.getAll();
    }

    // ============================================================
    // Environment Selection
    // ============================================================

    /**
     * Get the active environment name (e.g., 'dev', 'sit', 'prod')
     */
    getActiveEnvironment(): string | undefined {
        return this.envStore.getActive();
    }

    /**
     * Set the active environment by name
     * @example
     * ```typescript
     * env.setActiveEnvironment('sit');  // Switch to SIT environment
     * env.get('baseUrl');  // Now returns SIT's baseUrl
     * ```
     */
    setActiveEnvironment(name: string): void {
        this.envStore.setActive(name);
    }

    /**
     * Get list of available environment names
     */
    getEnvironments(): string[] {
        // Check if envStore supports getEnvironments (EnvironmentResolver does)
        const store = this.envStore as any;
        if (typeof store.getEnvironments === 'function') {
            return store.getEnvironments();
        }
        return [];
    }

    // ============================================================
    // Global Variables (environment-agnostic layer)
    // ============================================================

    /**
     * Get all global variables. Globals are the lowest-priority, environment-agnostic
     * variable layer — treated like environment variables with no environment scope.
     */
    getGlobals(): Record<string, string> {
        const store = this.envStore as any;
        return typeof store.getGlobals === 'function' ? store.getGlobals() : {};
    }

    /**
     * Set a global variable value.
     */
    setGlobal(key: string, value: string): void {
        const store = this.envStore as any;
        if (typeof store.setGlobal === 'function') {
            store.setGlobal(key, value);
        }
    }

    /**
     * Remove a (session) global variable.
     */
    unsetGlobal(key: string): void {
        const store = this.envStore as any;
        if (typeof store.unsetGlobal === 'function') {
            store.unsetGlobal(key);
        }
    }

    /**
     * Clear all (session) global variables.
     */
    clearGlobals(): void {
        const store = this.envStore as any;
        if (typeof store.clearGlobals === 'function') {
            store.clearGlobals();
        }
    }

    // ============================================================
    // Template Resolution
    // ============================================================

    /**
     * Resolve {{variable}} placeholders
     */
    resolve(template: string): string {
        return this.interpolator.interpolate(template, this.getAll());
    }

    /**
     * Resolve {{variable}} and :pathParam placeholders in a URL
     */
    resolvePath(urlPattern: string, params: Record<string, string> = {}): string {
        const resolved = this.interpolator.interpolate(urlPattern, this.getAll());
        return this.urlBuilder.buildUrl(resolved, params);
    }

    /**
     * Build a complete URL with all substitutions
     */
    buildUrl(
        urlPattern: string,
        options: {
            params?: Record<string, string>;
            query?: Record<string, string>;
        } = {}
    ): string {
        const resolved = this.interpolator.interpolate(urlPattern, this.getAll());
        return this.urlBuilder.buildUrl(
            resolved,
            options.params || {},
            options.query || {}
        );
    }

    /**
     * Resolve variables in an object recursively
     */
    resolveObject<T>(obj: T): T {
        return this.interpolator.interpolateObject(obj, this.getAll());
    }

    /**
     * Extract variable names from a template
     */
    extractVariables(template: string): string[] {
        return this.interpolator.extractVariables(template);
    }

    /**
     * Extract path parameter names from a URL pattern
     */
    extractPathParams(urlPattern: string): string[] {
        return this.urlBuilder.extractPathParams(urlPattern);
    }

    // ============================================================
    // Factory Methods
    // ============================================================

    /**
     * Create ForgeEnv from a simple variables object
     */
    static create(variables: Record<string, string> = {}): ForgeEnv {
        const envStore = EnvironmentResolver.fromVariables(variables);
        return new ForgeEnv(envStore);
    }

    /**
     * Create ForgeEnv from an existing EnvironmentResolver
     */
    static fromResolver(resolver: EnvironmentResolver): ForgeEnv {
        return new ForgeEnv(resolver);
    }
}
