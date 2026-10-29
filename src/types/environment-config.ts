/**
 * Environment Configuration Types
 * 
 * Migrated from src/environment/ for better organization
 * These types define the contracts for environment management
 */

/**
 * Environment configuration structure
 */
export interface EnvironmentConfig {
    description?: string;
    requiresConfirmation?: boolean;
    variables?: Record<string, string>;
    /**
     * Names of variables whose values are stored in SecretStorage rather than the JSON file.
     * The JSON file stores the variable name only; the value is fetched at resolution time.
     */
    secretVariables?: string[];
}

/**
 * Shared configuration file structure
 */
export interface SharedConfig {
    environments: Record<string, EnvironmentConfig>;
    globalVariables?: Record<string, string>;
    defaultHeaders?: Record<string, string>;
}

/**
 * Local configuration file structure
 */
export interface LocalConfig {
    credentials?: Record<string, { variables?: Record<string, string> }>;
    variables?: Record<string, string>;
}

/**
 * Resolved environment with all inherited values
 */
export interface ResolvedEnvironment {
    name: string;
    description?: string;
    requiresConfirmation?: boolean;
    headers: Record<string, string>;
    variables: Record<string, string>;
}

/**
 * Representation of an imported environment (from Postman)
 */
export interface ImportedEnvironment {
    name: string;
    variables: Record<string, string>;
    description?: string;
}

/**
 * Import operations for environments
 */
export interface IEnvironmentImporter {
    importPostmanEnvironmentFile(filePath: string): ImportedEnvironment | null;
}

/**
 * Read operations for environment configuration
 */
export interface IEnvironmentConfigReader {
    getWorkspaceFolder(): string;
    getRootPath(): string;
    getEnvironmentNames(): string[];
    getSelectedEnvironment(): string;
    getSharedConfig(): SharedConfig | null;
    getSharedConfigPath(): string;
    getLocalConfig(): LocalConfig | null;
    getLocalConfigPath(): string;
    getEnvironmentConfigPath(envName: string): string;
    getEnvLocalPath(envName: string): string;
    getResolvedEnvironment(envName: string): ResolvedEnvironment | null;
}

/**
 * Write operations for environment configuration
 */
export interface IEnvironmentConfigWriter {
    saveSharedConfig(config: SharedConfig): void;
    saveLocalConfig(config: LocalConfig): void;
}

/**
 * Environment selection operations
 */
export interface IEnvironmentSelector {
    setSelectedEnvironment(envName: string): Promise<void>;
}

/**
 * Variable resolution operations
 */
export interface IVariableResolver {
    resolveVariables(text: string, envName?: string): string;
    resolveVariablesWithExtra(text: string, extraVariables: Record<string, string>, envName?: string): string;
    resolveVariablesInObject<T extends Record<string, any>>(obj: T, envName?: string): T;
    resolveVariablesInObjectWithExtra<T extends Record<string, any>>(obj: T, extraVariables: Record<string, string>, envName?: string): T;
}

/**
 * Variable management operations (for scripts)
 */
export interface IVariableManager {
    setEnvironmentVariable(key: string, value: unknown, envName?: string): void;
    deleteEnvironmentVariable(key: string, envName?: string): void;
    clearEnvironmentVariables(envName?: string): void;
    getEnvironmentVariableLocals(): Record<string, string>;
    /** Session overrides for every environment (keyed by env name). Empty when no script wrote any. */
    getAllEnvironmentVariableLocals(): Record<string, Record<string, string>>;
    /**
     * Drop all session overrides for one environment (Postman's "Reset All").
     * File values shine through again; persisted override state is removed.
     */
    resetEnvironmentOverrides(envName?: string): Promise<void>;
    setGlobalVariable(key: string, value: unknown): void;
    getGlobalVariable(key: string): string | undefined;
    deleteGlobalVariable(key: string): void;
    clearGlobalVariables(): void;
    getGlobalVariables(): Record<string, string>;
}

/**
 * Full environment configuration service interface
 */
export interface IEnvironmentConfigService
    extends IEnvironmentConfigReader,
            IEnvironmentConfigWriter,
            IEnvironmentSelector,
            IVariableResolver,
            IVariableManager {
    loadConfigs(): void;
    exportEnvironmentsToFolder(outDir: string, mergeGlobals?: boolean): void;
    /** List all environments with their variables (values included). */
    getAllEnvironments(): Array<{ id: string; name: string; active: boolean; variables: Record<string, string> }>;
    /** Create a new environment file. */
    createEnvironment(name: string): Promise<void>;
    /** Delete an environment file permanently. */
    deleteEnvironment(id: string): Promise<void>;
    /** Read a single secret variable from SecretStorage. */
    getSecretVariable(envName: string, key: string): Promise<string | undefined>;
    /** Store a secret variable value in SecretStorage. */
    setSecretVariable(envName: string, key: string, value: string): Promise<void>;
    /** Delete a secret variable from SecretStorage. */
    deleteSecretVariable(envName: string, key: string): Promise<void>;
    /** Load all secrets for an environment (or current) into cache. */
    loadSecretVariables(envName?: string): Promise<void>;
    /**
     * Return the fully resolved HttpForgeConfig for the given environment.
     * {{variable}} tokens are substituted using file-only env variables
     * (env.json, global.json, *.local.json) — NOT runtime pm.* values.
     * Result is cached and invalidated on config/env file changes or env switch.
     */
    getResolvedConfig(envName?: string): import('../infrastructure/config/config.interface').HttpForgeConfig;
}

/**
 * Interface for storing and retrieving environment variables
 */
export interface IEnvironmentStore {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    getAll(): Record<string, string>;
    getActive(): string | undefined;
    setActive(name: string): void;
    getVariables(environmentName?: string): Record<string, string>;
}

/**
 * Interface for interpolating variables in strings
 * Handles {{variable}} syntax replacement
 */
export interface IVariableInterpolator {
    interpolate(input: string, variables: Record<string, string>): string;
    extractVariables(input: string): string[];
    interpolateObject<T>(obj: T, variables: Record<string, string>): T;
}

/**
 * ForgeEnv type for environment representation
 * @see src/infrastructure/environment/forge-env.ts for the canonical definition
 */
export type { IForgeEnv } from '../infrastructure/environment/forge-env';
