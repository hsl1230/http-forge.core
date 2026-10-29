/**
 * Module Loader Implementation
 * 
 * Single Responsibility: Load custom modules from workspace for script execution
 * 
 * Provides consistent module loading behavior across all packages:
 * - VS Code Extension
 * - @http-forge/standalone  
 * - @http-forge/playwright
 * 
 * All packages provide module paths, resulting in identical behavior.
 * 
 * SECURITY NOTE: This loader is designed to work within Node.js vm sandbox.
 * The returned require function should ONLY be exposed within the vm context.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * Module loader configuration options
 */
export interface ModuleLoaderOptions {
    /** Whether to allow loading custom modules (default: true) */
    allowCustomModules?: boolean;
    /** Maximum module resolution depth (prevents circular dependencies) */
    maxResolveDepth?: number;
    /** Output channel for logging (VS Code environment) */
    outputChannel?: {
        appendLine: (message: string) => void;
    };
}

/**
 * Module resolution result
 */
interface ModuleResolution {
    /** Resolved module */
    module: any;
    /** Module source type */
    source: 'builtin' | 'relative' | 'workspace';
    /** Resolution time (ms) */
    resolveTime?: number;
}

/**
 * Create a lightweight moment.js replacement (when not available)
 */
export function createMomentShim(): any {
    return {
        format: (input?: any, format?: string) => {
            const date = input ? new Date(input) : new Date();
            if (format === 'YYYY-MM-DD') {
                return date.toISOString().split('T')[0];
            }
            return date.toISOString();
        },
        unix: () => Math.floor(Date.now() / 1000),
        utc: () => {
            const now = new Date();
            return {
                format: () => now.toISOString(),
                toISOString: () => now.toISOString()
            };
        },
        __isShim: true,
        __warning: 'This is a lightweight shim. For full features, install moment.js via modules/package.json'
    };
}

/**
 * Create a lightweight lodash replacement (when not available)
 */
export function createLodashShim(): any {
    return {
        get: (obj: any, path: string, defaultValue?: any) => {
            const keys = path.split('.');
            let result = obj;
            for (const key of keys) {
                result = result?.[key];
                if (result === undefined) return defaultValue;
            }
            return result;
        },
        set: (obj: any, path: string, value: any) => {
            const keys = path.split('.');
            let current = obj;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!current[keys[i]]) current[keys[i]] = {};
                current = current[keys[i]];
            }
            current[keys[keys.length - 1]] = value;
            return obj;
        },
        cloneDeep: (obj: any) => JSON.parse(JSON.stringify(obj)),
        keys: (obj: any) => Object.keys(obj ?? {}),
        values: (obj: any) => Object.values(obj ?? {}),
        entries: (obj: any) => Object.entries(obj ?? {}),
        each(collection: any, fn: Function) {
            if (Array.isArray(collection)) {
                collection.forEach((v: any, i: number) => fn(v, i, collection));
            } else if (collection && typeof collection === 'object') {
                Object.entries(collection).forEach(([k, v]) => fn(v, k, collection));
            }
        },
        forEach(collection: any, fn: Function) {
            if (Array.isArray(collection)) {
                collection.forEach((v: any, i: number) => fn(v, i, collection));
            } else if (collection && typeof collection === 'object') {
                Object.entries(collection).forEach(([k, v]) => fn(v, k, collection));
            }
        },
        map: (collection: any, fn: Function) =>
            (Array.isArray(collection) ? collection : Object.values(collection ?? {})).map((v: any) => fn(v)),
        filter: (collection: any, fn: Function) =>
            (Array.isArray(collection) ? collection : Object.values(collection ?? {})).filter((v: any) => fn(v)),
        find: (collection: any, fn: Function) =>
            (Array.isArray(collection) ? collection : Object.values(collection ?? {})).find((v: any) => fn(v)),
        reduce: (collection: any, fn: Function, initial: any) =>
            (Array.isArray(collection) ? collection : Object.values(collection ?? {})).reduce((a: any, v: any) => fn(a, v), initial),
        includes: (collection: any, value: any) =>
            Array.isArray(collection) ? collection.includes(value) : Object.values(collection ?? {}).includes(value),
        isObject: (val: any) => val !== null && typeof val === 'object' && !Array.isArray(val),
        isArray: (val: any) => Array.isArray(val),
        isString: (val: any) => typeof val === 'string',
        isNumber: (val: any) => typeof val === 'number',
        isFunction: (val: any) => typeof val === 'function',
        isNil: (val: any) => val === null || val === undefined,
        isEmpty: (val: any) => {
            if (val === null || val === undefined) return true;
            if (Array.isArray(val) || typeof val === 'string') return val.length === 0;
            if (typeof val === 'object') return Object.keys(val).length === 0;
            return false;
        },
        assign: (target: any, ...sources: any[]) => Object.assign(target, ...sources),
        merge: (target: any, ...sources: any[]) => {
            const out = { ...target };
            for (const src of sources) {
                for (const [k, v] of Object.entries(src ?? {})) {
                    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? { ...(out[k] ?? {}), ...v } : v;
                }
            }
            return out;
        },
        omit: (obj: any, keys: string[]) => {
            const out = { ...obj };
            for (const k of keys) delete out[k];
            return out;
        },
        pick: (obj: any, keys: string[]) => {
            const out: Record<string, any> = {};
            for (const k of keys) if (k in (obj ?? {})) out[k] = obj[k];
            return out;
        }
    } as any;
}

/**
 * ModuleLoader handles loading custom modules from the workspace's modules/ folder.
 * 
 * Directory structure:
 * ```
 * .http-forge/assets/modules/           ← modulePath
 * ├── package.json                      ← Declares dependencies
 * ├── global-setup.js                   ← Global exports injected into sandbox
 * └── auth-helpers.js                   ← User's custom code
 * ```
 * 
 * SECURITY IMPORTANT:
 * 1. The require function returned by createRequireFunction() should ONLY be used inside vm sandbox
 * 2. Built-in modules are carefully whitelisted - review before adding new ones
 * 3. Relative paths are restricted to modules/ directory subtree
 */
export class ModuleLoader {
    private availableModules: Set<string> = new Set();
    private customModulesRequire?: NodeRequire;
    private globalSetupExports?: Record<string, any>;
    private options: Required<ModuleLoaderOptions>;
    private modulesPath: string | null = null;

    // Module cache (avoid duplicate loading)
    private moduleCache: Map<string, ModuleResolution> = new Map();

    // Resolution depth tracking (prevent circular dependencies)
    private resolveStack: Set<string> = new Set();

    /**
     * Built-in modules with fallback loading support
     */
    private readonly builtinModules: Record<string, () => any> = {
        'uuid': () => ({ v4: uuidv4 }),
        'crypto': () => crypto,
        'path': () => path,
        'querystring': () => require('querystring'),
        'lodash': () => this.loadOptionalModule('lodash', () => require('lodash'), createLodashShim),
        'moment': () => this.loadOptionalModule('moment', () => require('moment'), createMomentShim),
        'tv4': () => this.loadOptionalModule('tv4', () => require('tv4')),
        'ajv': () => this.loadOptionalModule('ajv', () => require('ajv')),
        'crypto-js': () => this.loadOptionalModule('crypto-js', () => {
            // Dynamic require to prevent bundler from resolving at build time
            const mod = 'crypto-js';
            return require(mod);
        }, () => {
            // Fallback: tell user to use the global CryptoJS (already available in sandbox)
            throw new Error(
                'crypto-js npm module is not installed. The built-in CryptoJS global is already available in scripts ' +
                'with AES/DES/TripleDES/hash/HMAC/PBKDF2 support. If you need the exact npm package, ' +
                'add "crypto-js" to your modules/package.json and run npm install.'
            );
        }),
    };

    /**
     * Create a new ModuleLoader
     * 
     * @param modulePaths - Array of paths to modules directories. First valid path is used.
     * @param options - Configuration options
     */
    constructor(modulePaths: string[] = [], options: ModuleLoaderOptions = {}) {
        this.options = {
            allowCustomModules: true,
            maxResolveDepth: 10,
            ...options,
            outputChannel: options.outputChannel || {
                appendLine: (message: string) => {
                    // stderr keeps CLI stdout machine-readable (--output json).
                    console.error(`[ModuleLoader] ${message}`);
                }
            }
        };

        // Try each module path until we find one with package.json
        for (const modulePath of modulePaths) {
            const resolvedModulePath = path.resolve(modulePath);
            if (this.initializeModules(resolvedModulePath)) {
                this.modulesPath = resolvedModulePath;
                break;
            }
        }
    }

    /**
     * Unified fallback module loader
     */
    private loadOptionalModule(
        moduleName: string,
        coreLoader: () => any,
        fallbackShim?: () => any
    ): any {
        try {
            return coreLoader();
        } catch (coreError) {
            if (this.customModulesRequire) {
                try {
                    console.debug(`[ModuleLoader] ${moduleName} not in core, trying user modules`);
                    return this.customModulesRequire(moduleName);
                } catch (userError) {
                    this.logModuleWarning(moduleName, 'user');
                }
            } else {
                this.logModuleWarning(moduleName, 'core');
            }

            if (fallbackShim) {
                console.warn(`[ModuleLoader] Using shim for ${moduleName}. Some features may be limited.`);
                return fallbackShim();
            }

            throw new Error(this.getModuleInstallInstructions(moduleName));
        }
    }

    private logModuleWarning(moduleName: string, failureType: 'core' | 'user'): void {
        const messages: Record<string, string> = {
            'moment': 'Date/time manipulation',
            'lodash': 'Utility functions',
            'tv4': 'JSON Schema validation (v4)',
            'ajv': 'JSON Schema validation'
        };
        const description = messages[moduleName] || moduleName;
        console.warn(
            `[ModuleLoader] ${description} functionality (${moduleName}) is not available.\n` +
            `${this.getModuleInstallInstructions(moduleName)}`
        );
    }

    private getModuleInstallInstructions(moduleName: string): string {
        const versionMap: Record<string, string> = {
            'moment': '^2.30.1',
            'lodash': '^4.17.21',
            'tv4': '^1.3.0',
            'ajv': '^8.17.1'
        };
        const version = versionMap[moduleName] || 'latest';
        return (
            `To use ${moduleName}, add it to http-forge/modules/package.json:\n` +
            `{\n  "dependencies": {\n    "${moduleName}": "${version}"\n  }\n}\n` +
            `Then run: cd http-forge/modules && npm install`
        );
    }

    /**
     * Initialize modules from the resolved path
     * @returns true if successfully initialized
     */
    private initializeModules(modulesPath: string): boolean {
        this.logDebug('Initializing module loader...');

        if (!this.options.allowCustomModules) {
            this.logDebug('Custom modules disabled by configuration');
            return true;
        }

        try {
            const packageJsonPath = path.resolve(modulesPath, 'package.json');
            if (!fs.existsSync(packageJsonPath)) {
                this.logDebug(`No modules/package.json found at ${modulesPath}`);
                return false;
            }

            // createRequire requires an absolute path or file URL. Normalize explicitly
            // to avoid runtime errors when callers provide relative workspace/module paths.
            const normalizedPackageJsonPath = fs.realpathSync(packageJsonPath);
            this.customModulesRequire = createRequire(normalizedPackageJsonPath);
            this.loadAvailableModules(modulesPath);
            this.loadGlobalSetup(modulesPath);
            this.logDebug(`Module loader initialized with ${this.availableModules.size} workspace modules`);
            return true;
        } catch (error) {
            console.error('Failed to initialize modules:', error);
            return false;
        }
    }

    private loadAvailableModules(modulesPath: string): void {
        try {
            const packageJsonPath = path.join(modulesPath, 'package.json');
            const content = fs.readFileSync(packageJsonPath, 'utf-8');
            const packageJson = JSON.parse(content);

            if (typeof packageJson !== 'object' || packageJson === null) {
                throw new Error('Invalid package.json: must be an object');
            }

            const dependencies = packageJson.dependencies || {};
            const devDependencies = packageJson.devDependencies || {};

            if (typeof dependencies !== 'object' || typeof devDependencies !== 'object') {
                throw new Error('Invalid dependencies in package.json');
            }

            Object.keys(dependencies).forEach(name => {
                if (typeof name === 'string' && name.trim()) {
                    this.availableModules.add(name.trim());
                }
            });
            Object.keys(devDependencies).forEach(name => {
                if (typeof name === 'string' && name.trim()) {
                    this.availableModules.add(name.trim());
                }
            });

            this.logDebug(`Loaded ${this.availableModules.size} modules from package.json`);
        } catch (error) {
            const errorMessage = `Failed to load workspace modules from package.json: ${error instanceof Error ? error.message : error}`;
            this.logError(errorMessage);
        }
    }

    private loadGlobalSetup(modulesPath: string): void {
        const globalSetupPath = path.join(modulesPath, 'global-setup.js');
        if (!fs.existsSync(globalSetupPath)) return;

        try {
            if (this.customModulesRequire) {
                this.globalSetupExports = this.customModulesRequire('./global-setup.js');
            }
        } catch (error) {
            console.error('Failed to load global-setup.js:', error);
            this.globalSetupExports = undefined;
        }
    }

    /**
     * Create require function for use in VM sandbox
     * 
     * Resolution order:
     * 1. Built-in modules (lodash, moment, crypto, etc.)
     * 2. Relative paths (./helpers, ../utils) - restricted to modules/ directory
     * 3. Workspace dependencies from modules/package.json
     */
    createRequireFunction(): (moduleName: string) => any {
        return (moduleName: string): any => {
            const startTime = Date.now();

            try {
                if (this.resolveStack.has(moduleName)) {
                    throw new Error(`Circular dependency detected: ${Array.from(this.resolveStack).join(' -> ')} -> ${moduleName}`);
                }

                if (this.resolveStack.size >= this.options.maxResolveDepth) {
                    throw new Error(`Maximum module resolve depth (${this.options.maxResolveDepth}) exceeded`);
                }

                this.resolveStack.add(moduleName);

                // 1. Check cache
                const cached = this.moduleCache.get(moduleName);
                if (cached) {
                    this.logDebug(`Module cache hit: ${moduleName}`);
                    return cached.module;
                }

                // 2. Built-in modules — always available, no modulesPath required
                if (this.builtinModules[moduleName]) {
                    this.logDebug(`Loading built-in module: ${moduleName}`);
                    const module = this.builtinModules[moduleName]();
                    this.cacheModule(moduleName, module, 'builtin', Date.now() - startTime);
                    return module;
                }

                // Relative paths and workspace modules require an initialized modulesPath
                if (!this.modulesPath) {
                    throw new Error(
                        `Module loading is not initialized. No valid modules/ directory found. ` +
                        `Create .http-forge/assets/modules/package.json first.`
                    );
                }

                // 3. Relative paths (./, ../)
                if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
                    if (!this.customModulesRequire) {
                        throw new Error(
                            `Cannot load local module '${moduleName}': ` +
                            `No modules/ folder found. Create .http-forge/assets/modules/package.json first.`
                        );
                    }

                    const resolvedPath = path.resolve(this.modulesPath, moduleName);
                    const normalizedResolved = path.normalize(resolvedPath);
                    const normalizedModules = path.normalize(this.modulesPath);

                    if (!normalizedResolved.startsWith(normalizedModules)) {
                        throw new Error(`Security violation: Attempt to load module outside modules directory: ${moduleName}`);
                    }

                    try {
                        this.logDebug(`Loading relative module: ${moduleName}`);
                        const module = this.customModulesRequire(moduleName);
                        this.cacheModule(moduleName, module, 'relative', Date.now() - startTime);
                        return module;
                    } catch (error: any) {
                        throw new Error(`Failed to load local module '${moduleName}': ${error.message}`);
                    }
                }

                // 4. Workspace dependencies
                if (this.availableModules.has(moduleName) && this.customModulesRequire) {
                    try {
                        this.logDebug(`Loading workspace module: ${moduleName}`);
                        const module = this.customModulesRequire(moduleName);
                        this.cacheModule(moduleName, module, 'workspace', Date.now() - startTime);
                        return module;
                    } catch (error: any) {
                        throw new Error(
                            `Module '${moduleName}' is in package.json but failed to load: ${error.message}`
                        );
                    }
                }

                // 5. Module not found
                const suggestions = this.getModuleSuggestions(moduleName);
                let errorMessage = `Module '${moduleName}' is not available.`;
                if (suggestions.length > 0) {
                    errorMessage += ` Did you mean: ${suggestions.join(', ')}?`;
                }
                errorMessage += `\nAdd it to http-forge/modules/package.json and run npm install.`;
                throw new Error(errorMessage);

            } finally {
                this.resolveStack.delete(moduleName);
            }
        };
    }

    private getModuleSuggestions(moduleName: string): string[] {
        const allModules = this.getAvailableModules();
        const suggestions: string[] = [];
        for (const available of allModules) {
            if (available.startsWith(moduleName.substring(0, 3))) {
                suggestions.push(available);
                if (suggestions.length >= 3) break;
            }
        }
        return suggestions;
    }

    private cacheModule(moduleName: string, module: any, source: ModuleResolution['source'], resolveTime: number): void {
        this.moduleCache.set(moduleName, { module, source, resolveTime });
        if (resolveTime > 100) {
            this.logDebug(`Slow module load: ${moduleName} took ${resolveTime}ms`);
        }
    }

    /** Get global setup exports for sandbox injection */
    getGlobalSetupExports(): Record<string, any> | undefined {
        return this.globalSetupExports;
    }

    /** Check if custom modules are available */
    hasCustomModules(): boolean {
        return this.customModulesRequire !== undefined;
    }

    /** Get list of available module names (built-ins + workspace) */
    getAvailableModules(): string[] {
        return [
            ...Object.keys(this.builtinModules),
            ...Array.from(this.availableModules)
        ].sort();
    }

    /** Clear module cache */
    clearCache(): void {
        this.moduleCache.clear();
        this.logDebug('Module cache cleared');
    }

    /** Get cache statistics */
    getCacheStats(): { size: number; hits: number } {
        return { size: this.moduleCache.size, hits: 0 };
    }

    private logDebug(message: string): void {
        if (this.options.outputChannel) {
            this.options.outputChannel.appendLine(`[ModuleLoader] ${message}`);
        }
    }

    private logError(message: string): void {
        if (this.options.outputChannel) {
            this.options.outputChannel.appendLine(`[ModuleLoader ERROR] ${message}`);
        }
        console.error(`[ModuleLoader ERROR] ${message}`);
    }
}

/**
 * Factory function: create a pre-configured ModuleLoader instance
 */
export function createModuleLoader(modulePaths: string[], options?: ModuleLoaderOptions): ModuleLoader {
    return new ModuleLoader(modulePaths, options);
}
