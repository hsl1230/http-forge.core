/**
 * Environment Resolver Service
 * 
 * Single Responsibility: Resolve environment variables for request execution
 * Dependency Inversion: Implements IEnvironmentStore interface
 */

import type { IEnvironmentStore } from '../../types/environment-config';

/**
 * Environment definition
 */
export interface Environment {
    name: string;
    variables: Record<string, string>;
    /** Base environment to inherit from */
    inherits?: string;
}

/**
 * Environment store configuration (for EnvironmentResolver)
 * Note: Named EnvironmentStoreConfig to avoid conflict with
 * interfaces/environment-config-service.ts EnvironmentConfig
 */
export interface EnvironmentStoreConfig {
    /** Global variables (available in all environments) */
    globalVariables?: Record<string, string>;
    /** Environment definitions */
    environments: Record<string, Environment>;
    /** Currently selected environment */
    selectedEnvironment?: string;
}

/**
 * In-memory environment store implementation
 */
export class EnvironmentResolver implements IEnvironmentStore {
    private config: EnvironmentStoreConfig;
    private selectedEnvironment: string;
    
    /** In-memory values */
    private sessionGlobals: Record<string, string> = {};
    private sessionEnvironmentValues: Map<string, Record<string, string>> = new Map();
    
    constructor(config: EnvironmentStoreConfig) {
        this.config = config;
        this.selectedEnvironment = config.selectedEnvironment || 
            Object.keys(config.environments)[0] || 
            'default';
    }
    
    /**
     * Get a single variable value
     */
    get(key: string): string | undefined {
        const merged = this.getVariables();
        return merged[key];
    }
    
    /**
     * Set a variable value (in session)
     */
    set(key: string, value: string): void {
        let sessionValues = this.sessionEnvironmentValues.get(this.selectedEnvironment);
        if (!sessionValues) {
            sessionValues = {};
            this.sessionEnvironmentValues.set(this.selectedEnvironment, sessionValues);
        }
        sessionValues[key] = value;
    }
    
    /**
     * Get all variables as a record
     */
    getAll(): Record<string, string> {
        return this.getVariables();
    }
    
    /**
     * Get list of available environment names
     */
    getEnvironments(): string[] {
        return Object.keys(this.config.environments);
    }
    
    /**
     * Get the currently active environment name
     */
    getActive(): string | undefined {
        return this.selectedEnvironment;
    }
    
    /**
     * Set the active environment
     */
    setActive(name: string): void {
        if (!this.config.environments[name]) {
            throw new Error(`Environment not found: ${name}`);
        }
        this.selectedEnvironment = name;
    }
    
    /**
     * Get merged variables for an environment (includes globals)
     */
    getVariables(environment?: string): Record<string, string> {
        const envName = environment || this.selectedEnvironment;
        const env = this.config.environments[envName];
        
        // Start with globals
        let variables: Record<string, string> = {
            ...(this.config.globalVariables || {}),
            ...this.sessionGlobals
        };
        
        if (env) {
            // Handle inheritance
            if (env.inherits && this.config.environments[env.inherits]) {
                const parentVars = this.getEnvironmentVariables(env.inherits);
                variables = { ...variables, ...parentVars };
            }
            
            // Merge in environment's own variables
            variables = { ...variables, ...env.variables };
            
            // Merge in session values (override file values)
            const sessionValues = this.sessionEnvironmentValues.get(envName);
            if (sessionValues) {
                variables = { ...variables, ...sessionValues };
            }
        }
        
        return variables;
    }
    
    /**
     * Get environment variables only (without globals)
     */
    private getEnvironmentVariables(envName: string): Record<string, string> {
        const env = this.config.environments[envName];
        if (!env) return {};
        
        let variables: Record<string, string> = {};
        
        if (env.inherits && this.config.environments[env.inherits]) {
            variables = { ...this.getEnvironmentVariables(env.inherits) };
        }
        
        return { ...variables, ...env.variables };
    }
    
    /**
     * Get global variables
     */
    getGlobals(): Record<string, string> {
        return {
            ...(this.config.globalVariables || {}),
            ...this.sessionGlobals
        };
    }
    
    /**
     * Set a global variable
     */
    setGlobal(key: string, value: string): void {
        this.sessionGlobals[key] = value;
    }

    /**
     * Remove a session global variable. File-defined globals (globalVariables)
     * are defaults and cannot be deleted here — only session overrides are removed.
     */
    unsetGlobal(key: string): void {
        delete this.sessionGlobals[key];
    }

    /**
     * Clear all session global variables. File-defined globals are left intact.
     */
    clearGlobals(): void {
        this.sessionGlobals = {};
    }
    
    /**
     * Resolve environment for execution
     */
    resolve(environment?: string): { 
        name: string; 
        merged: Record<string, string>; 
        globals: Record<string, string>;
    } {
        const envName = environment || this.selectedEnvironment;
        return {
            name: envName,
            merged: this.getVariables(envName),
            globals: this.getGlobals()
        };
    }
    
    /**
     * Create from simple variables object
     */
    static fromVariables(variables: Record<string, string>, name = 'default'): EnvironmentResolver {
        return new EnvironmentResolver({
            environments: {
                [name]: { name, variables }
            },
            selectedEnvironment: name
        });
    }
}
