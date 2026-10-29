/**
 * Environment Configuration Service
 *
 * Platform-agnostic — uses IKeyValueStore for persistence instead of
 * VS Code's workspaceState/globalState.
 */

import * as fs from 'fs';
import * as path from 'path';

import type {
    IEnvironmentConfigService,
    ImportedEnvironment,
    LocalConfig,
    ResolvedEnvironment,
    SharedConfig
} from '../../types/environment-config';
import { IFileWatcher, IFileWatcherFactory, IKeyValueStore, ISecretStore } from '../../types/platform';
import { mergeHeadersCaseInsensitive, sanitizeName } from '../../utils/helpers';
import { IConfigService } from '../config';
import { parsePostmanEnvironment } from '../import-export/import-postman-environment';
import { writeEnvFile } from '../import-export/rest-client-export';
import { isSystemEnvironmentFile, loadEnvironmentsFromFolder } from './environment-file-loader';
import { VariableResolver } from './variable-interpolator';

/**
 * Default state keys for persistence
 */
const STATE_KEYS = {
    SELECTED_ENVIRONMENT: 'httpForge.selectedEnvironment',
    ENV_OVERRIDES_PREFIX: 'httpForge.envOverrides.'
};

export class EnvironmentConfigService implements IEnvironmentConfigService {
    private environmentsPath: string;
    private sharedConfigPath: string;
    private localConfigPath: string;
    private historiesPath: string;
    private sharedConfig: SharedConfig | null = null;
    private localConfig: LocalConfig | null = null;
    private selectedEnvironment: string = 'dev';
    private fileWatcher?: IFileWatcher;

    /**
     * Cache of fully resolved HttpForgeConfig per environment name.
     * Built from file-based variables only (NOT runtime pm.* values).
     * Invalidated when config file or env files change.
     */
    private resolvedConfigCache = new Map<string, import('../config/config.interface').HttpForgeConfig>();

    /**
     * In-memory Local Values for variables (not persisted)
     * These are set via forge.*.set() in scripts and override file values
     * Cleared when the process exits
     */
    private localGlobalValues: Record<string, string> = {};
    private localEnvironmentValues: Map<string, Record<string, string>> = new Map();
    /** In-memory cache of secret values fetched from SecretStorage — keyed by envName */
    private secretValuesCache: Map<string, Record<string, string>> = new Map();

    /**
     * Callback invoked when environment files change on disk.
     * Set by the extension host to refresh tree views and panels.
     */
    public onEnvironmentsChanged?: () => void;

    constructor(
        private workspaceFolder: string,
        private workspaceStore: IKeyValueStore | undefined,
        private configService: IConfigService,
        private fileWatcherFactory?: IFileWatcherFactory,
        private secretStore?: ISecretStore,
        private persistOverrides: boolean = true
    ) {
        const environmentsPath = configService.getEnvironmentsPath();
        this.environmentsPath = environmentsPath;
        this.sharedConfigPath = path.join(environmentsPath, '_global.json');
        this.localConfigPath = path.join(environmentsPath, '_global.local.json');
        this.historiesPath = configService.getHistoryPath();

        // Restore selected environment from workspace state
        this.selectedEnvironment = workspaceStore?.get<string>(STATE_KEYS.SELECTED_ENVIRONMENT, 'dev') ?? 'dev';

        // Restore persisted environment variable overrides from workspace state
        // These are "Current Values" set by pm.environment.set() — survive restarts
        // Skipped in CLI/Node mode (persistOverrides=false) — runs are stateless
        this.localGlobalValues = {};
        this.localEnvironmentValues = new Map();
        if (this.persistOverrides) {
            this.loadPersistedEnvironmentOverrides();
        }

        // Pre-load secret variables for the initially selected environment into cache
        // so that the synchronous getResolvedEnvironment() sees them immediately.
        // Fire-and-forget: resolution is still synchronous after the first await completes.
        this.loadSecretVariables(this.selectedEnvironment).catch(() => { /* no SecretStorage in CLI */ });

        this.setupFileWatcher();

        // Register with ConfigService to invalidate resolved config cache when
        // http-forge.config.json changes.
        this.configService.onConfigReloaded = () => this.invalidateResolvedConfigCache();
    }

    private setupFileWatcher(): void {
        if (!this.fileWatcherFactory || !fs.existsSync(this.environmentsPath)) {
            return;
        }
        this.fileWatcher = this.fileWatcherFactory.createFileWatcher(this.environmentsPath, '**/*.json');
        const reloadAndNotify = () => {
            this.reload();
            this.onEnvironmentsChanged?.();
        };
        this.fileWatcher.onDidChange(reloadAndNotify);
        this.fileWatcher.onDidCreate(reloadAndNotify);
        this.fileWatcher.onDidDelete(reloadAndNotify);
    }

    public dispose(): void {
        this.fileWatcher?.dispose();
    }

    public getWorkspaceFolder(): string {
        return this.workspaceFolder;
    }

    public getRootPath(): string {
        return this.configService.getRootPath();
    }

    public loadConfigs(): void {
        if (!fs.existsSync(this.environmentsPath)) {
            this.sharedConfig = {
                environments: {},
                globalVariables: {},
                defaultHeaders: {}
            };
            this.localConfig = {
                credentials: {},
                variables: {}
            };
            return;
        }
        this.loadFolderConfigs();
    }

    public getSharedConfig(): SharedConfig | null {
        if (!this.sharedConfig) {
            this.loadConfigs();
        }
        return this.sharedConfig;
    }

    public getLocalConfig(): LocalConfig | null {
        if (!this.localConfig) {
            this.loadConfigs();
        }
        return this.localConfig;
    }

    public getEnvironmentNames(): string[] {
        const config = this.getSharedConfig();
        if (!config?.environments) {
            return [];
        }
        return Object.keys(config.environments);
    }

    public getSelectedEnvironment(): string {
        return this.selectedEnvironment;
    }

    public async setSelectedEnvironment(envName: string): Promise<void> {
        this.selectedEnvironment = envName;
        await this.workspaceStore?.update(STATE_KEYS.SELECTED_ENVIRONMENT, envName);
        // Load persisted overrides for the newly selected environment
        if (!this.localEnvironmentValues.has(envName)) {
            const stateKey = this.getEnvOverridesStateKey(envName);
            const persisted = this.workspaceStore?.get<Record<string, string>>(stateKey, {});
            if (persisted && Object.keys(persisted).length > 0) {
                this.localEnvironmentValues.set(envName, { ...persisted });
            }
        }
        // Pre-load secret variables for the newly selected environment
        await this.loadSecretVariables(envName);
        // Resolved config for this env may not be cached yet — drop it so it rebuilds lazily
        this.resolvedConfigCache.delete(envName);
    }

    // ========================================
    // Environment Variables (pm.environment.set)
    // Persisted to workspace state — survive restarts (Postman "Current Values")
    // ========================================

    private getEnvOverridesStateKey(envName?: string): string {
        return `${STATE_KEYS.ENV_OVERRIDES_PREFIX}${envName || this.selectedEnvironment}`;
    }

    /**
     * Load persisted environment overrides from workspace state into the in-memory map.
     * Called once at construction time.
     */
    private loadPersistedEnvironmentOverrides(): void {
        // Load overrides for the currently selected environment
        const stateKey = this.getEnvOverridesStateKey();
        const persisted = this.workspaceStore?.get<Record<string, string>>(stateKey, {});
        if (persisted && Object.keys(persisted).length > 0) {
            this.localEnvironmentValues.set(this.selectedEnvironment, { ...persisted });
        }
    }

    /**
     * Persist current environment overrides to workspace state (fire-and-forget).
     */
    private persistEnvironmentOverrides(envName: string): void {
        if (!this.persistOverrides) { return; }
        const stateKey = this.getEnvOverridesStateKey(envName);
        const values = this.localEnvironmentValues.get(envName) || {};
        // Fire-and-forget — the in-memory map is the source of truth during the run
        void this.workspaceStore?.update(stateKey, values);
    }

    public setEnvironmentVariable(key: string, value: unknown, envName?: string): void {
        const targetEnv = envName ?? this.selectedEnvironment;
        if (!this.localEnvironmentValues.has(targetEnv)) {
            this.localEnvironmentValues.set(targetEnv, {});
        }
        this.localEnvironmentValues.get(targetEnv)![key] = String(value);
        this.persistEnvironmentOverrides(targetEnv);
    }

    public deleteEnvironmentVariable(key: string, envName?: string): void {
        const targetEnv = envName ?? this.selectedEnvironment;
        const envVars = this.localEnvironmentValues.get(targetEnv);
        if (envVars) {
            delete envVars[key];
            this.persistEnvironmentOverrides(targetEnv);
        }
    }

    public clearEnvironmentVariables(envName?: string): void {
        const targetEnv = envName ?? this.selectedEnvironment;
        this.localEnvironmentValues.set(targetEnv, {});
        this.persistEnvironmentOverrides(targetEnv);
    }

    /**
     * Reset all runtime environment overrides for the current environment.
     * Equivalent to Postman's "Reset All" — reverts Current Values to Initial Values.
     */
    public async resetEnvironmentOverrides(envName?: string): Promise<void> {
        const name = envName || this.selectedEnvironment;
        this.localEnvironmentValues.delete(name);
        await this.workspaceStore?.update(this.getEnvOverridesStateKey(name), undefined);
    }

    public getEnvironmentVariableLocal(key: string): string | undefined {
        return this.localEnvironmentValues.get(this.selectedEnvironment)?.[key];
    }

    public getEnvironmentVariableLocals(): Record<string, string> {
        return { ...(this.localEnvironmentValues.get(this.selectedEnvironment) || {}) };
    }

    public getAllEnvironmentVariableLocals(): Record<string, Record<string, string>> {
        const out: Record<string, Record<string, string>> = {};
        for (const [envName, vars] of this.localEnvironmentValues) {
            out[envName] = { ...vars };
        }
        return out;
    }

    // ========================================
    // Global Variables (forge.globals.set)
    // Memory-only Local Values - NOT persisted to file
    // ========================================

    public setGlobalVariable(key: string, value: unknown): void {
        this.localGlobalValues[key] = String(value);
    }

    public getGlobalVariable(key: string): string | undefined {
        return this.getSharedConfig()?.globalVariables?.[key];
    }

    public getGlobalVariableLocal(key: string): string | undefined {
        return this.localGlobalValues[key];
    }

    public getGlobalVariables(): Record<string, string> {
        return {
            ...(this.getSharedConfig()?.globalVariables || {}),  // _global.json — initial values
            ...(this.getLocalConfig()?.variables || {}),          // _global.local.json — current values
            ...this.localGlobalValues                             // pm.globals.set() runtime — always wins
        };
    }

    public getGlobalVariableLocals(): Record<string, string> {
        return { ...this.localGlobalValues };
    }

    public deleteGlobalVariable(key: string): void {
        delete this.localGlobalValues[key];
    }

    public clearGlobalVariables(): void {
        this.localGlobalValues = {};
    }

    public getResolvedEnvironment(envName?: string): ResolvedEnvironment | null {
        const name = envName || this.selectedEnvironment;
        const shared = this.getSharedConfig();
        const local = this.getLocalConfig();

        if (!shared?.environments?.[name]) {
            return null;
        }

        const envConfig = shared.environments[name];
        const localCredentials = local?.credentials?.[name];
        const globalLocalVars = local?.variables || {};
        const envLocalVars = localCredentials?.variables || {};

        const envLocalHeaders = (localCredentials && (localCredentials as any).headers) || {};
        const headers = mergeHeadersCaseInsensitive(
            shared.defaultHeaders || {},
            envLocalHeaders
        );

        const localEnvValues = this.localEnvironmentValues.get(name) || {};
        // Secret values fetched from SecretStorage (pre-loaded via loadSecretVariables)
        const secretValues = this.secretValuesCache.get(name) || {};

        const variables: Record<string, string> = {
            // All globals tiers (_global.json, _global.local.json, pm.globals.set())
            // are handled in the 'globals' tier of createResolver via getGlobalVariables().
            // They must NOT appear here so environment variables always win over globals
            // (Postman precedence: globals < collection < environment).
            ...(envConfig.variables || {}),   // dev.json            — env initial values
            ...envLocalVars,                  // dev.local.json      — env local overrides
            ...localEnvValues,                // runtime pm.environment.set()
            ...secretValues                   // highest priority — OS keychain values win
        };

        return {
            name,
            description: envConfig.description,
            requiresConfirmation: envConfig.requiresConfirmation,
            headers,
            variables
        };
    }

    // ========================================
    // SecretStorage integration
    // Key format: "${envName}:${varName}"
    // ========================================

    /**
     * Retrieve a secret variable value from SecretStorage.
     * Returns undefined when no SecretStorage is available (e.g. CLI context).
     */
    public async getSecretVariable(envName: string, key: string): Promise<string | undefined> {
        return this.secretStore?.get(`${envName}:${key}`);
    }

    /**
     * Store a secret variable value in SecretStorage.
     * No-op when no SecretStorage is available (e.g. CLI context).
     */
    public async setSecretVariable(envName: string, key: string, value: string): Promise<void> {
        await this.secretStore?.store(`${envName}:${key}`, value);
        // Update in-memory cache so getResolvedEnvironment() sees it immediately
        if (!this.secretValuesCache.has(envName)) {
            this.secretValuesCache.set(envName, {});
        }
        this.secretValuesCache.get(envName)![key] = value;
    }

    /**
     * Delete a secret variable from SecretStorage.
     * No-op when no SecretStorage is available (e.g. CLI context).
     */
    public async deleteSecretVariable(envName: string, key: string): Promise<void> {
        await this.secretStore?.delete(`${envName}:${key}`);
        // Remove from cache
        this.secretValuesCache.get(envName) && delete this.secretValuesCache.get(envName)![key];
    }

    /**
     * Pre-load all secret values for an environment into the in-memory cache.
     * Call this when switching environments or on extension activation so that
     * the synchronous getResolvedEnvironment() always has secret values available.
     */
    public async loadSecretVariables(envName?: string): Promise<void> {
        if (!this.secretStore) { return; }
        const name = envName || this.selectedEnvironment;
        const secretVarNames: string[] = this.getSharedConfig()?.environments?.[name]?.secretVariables ?? [];
        if (secretVarNames.length === 0) { return; }
        const cache: Record<string, string> = {};
        await Promise.all(
            secretVarNames.map(async (varName) => {
                const val = await this.secretStore!.get(`${name}:${varName}`);
                if (val !== undefined) { cache[varName] = val; }
            })
        );
        this.secretValuesCache.set(name, cache);
    }

    public resolveVariables(input: string, envName?: string): string {
        return this.createResolver(envName).resolveString(input, true);
    }

    public exportEnvironmentsToFolder(outDir: string, mergeGlobals: boolean = true): void {
        const names = this.getEnvironmentNames();
        const shared = this.getSharedConfig();
        const sharedGlobals: Record<string, string> = (shared?.globalVariables) ? { ...shared.globalVariables } : {};

        if (!mergeGlobals && Object.keys(sharedGlobals).length) {
            const globalFile = path.join(outDir, 'globals.env');
            writeEnvFile(globalFile, sharedGlobals);
        }

        names.forEach(name => {
            const envConfig = shared?.environments?.[name];
            if (!envConfig) return;

            let vars: Record<string, string> = { ...(envConfig.variables || {}) };
            if (mergeGlobals) {
                vars = { ...sharedGlobals, ...vars };
            }

            const file = path.join(outDir, `${sanitizeName(name)}.env`);
            writeEnvFile(file, vars);
        });
    }

    public resolveVariablesWithExtra(input: string, extraVariables: Record<string, string>, envName?: string): string {
        return this.createResolver(envName, extraVariables).resolveString(input, true);
    }

    public resolveVariablesInObject<T>(obj: T, envName?: string): T {
        return this.createResolver(envName).resolveObject(obj, true);
    }

    public resolveVariablesInObjectWithExtra<T>(
        obj: T,
        extraVariables: Record<string, string>,
        envName?: string
    ): T {
        return this.createResolver(envName, extraVariables).resolveObject(obj, true);
    }

    public getHistoriesPath(): string {
        return this.historiesPath;
    }

    public getSharedConfigPath(): string {
        return this.sharedConfigPath;
    }

    public getLocalConfigPath(): string {
        return this.localConfigPath;
    }

    public getEnvironmentConfigPath(envName: string): string {
        return path.join(this.environmentsPath, `${envName}.json`);
    }

    public localConfigExists(): boolean {
        return fs.existsSync(this.localConfigPath);
    }

    public saveSharedConfig(config: SharedConfig): void {
        this.saveFolderSharedConfig(config);
        this.sharedConfig = config;
    }

    public saveLocalConfig(config: LocalConfig): void {
        const globalLocalConfig = {
            variables: config.variables || {}
        };
        this.saveJsonFile(this.localConfigPath, globalLocalConfig);

        for (const [envName, envCredentials] of Object.entries(config.credentials || {})) {
            const envLocalPath = this.getEnvLocalConfigPath(envName);
            const envLocalConfig = {
                variables: envCredentials.variables || {}
            };
            this.saveJsonFile(envLocalPath, envLocalConfig);
        }

        this.localConfig = config;
    }

    public importPostmanEnvironmentFile(filePath: string): ImportedEnvironment {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const imported = parsePostmanEnvironment(content);
            if (!imported) {
                throw new Error('Failed to parse Postman environment file');
            }

            if (!this.sharedConfig) this.loadConfigs();
            if (!this.sharedConfig) {
                this.sharedConfig = { environments: {}, globalVariables: {}, defaultHeaders: {} };
            }

            const envName = imported.name || `imported-${Date.now()}`;
            this.sharedConfig.environments = this.sharedConfig.environments || {};
            this.sharedConfig.environments[envName] = this.sharedConfig.environments[envName] || {};
            this.sharedConfig.environments[envName].variables = imported.variables;
            if (imported.description) {
                this.sharedConfig.environments[envName].description = imported.description;
            }

            this.saveSharedConfig(this.sharedConfig);

            return imported;
        } catch (error) {
            console.error('[EnvironmentConfigService] importPostmanEnvironmentFile failed:', error);
            throw error;
        }
    }

    public saveEnvLocalConfig(envName: string, variables: Record<string, string>): void {
        const envLocalPath = this.getEnvLocalConfigPath(envName);
        const envLocalConfig = { variables };
        this.saveJsonFile(envLocalPath, envLocalConfig);

        if (!this.localConfig) {
            this.localConfig = { credentials: {}, variables: {} };
        }
        if (!this.localConfig.credentials) {
            this.localConfig.credentials = {};
        }
        this.localConfig.credentials[envName] = { variables };
    }

    public getEnvLocalPath(envName: string): string {
        return this.getEnvLocalConfigPath(envName);
    }

    private getEnvLocalConfigPath(envName: string): string {
        return path.join(this.environmentsPath, `${envName}.local.json`);
    }

    private loadFolderConfigs(): void {
        const data = loadEnvironmentsFromFolder(this.environmentsPath);

        this.sharedConfig = {
            environments: data.environments,
            globalVariables: data.globalVariables,
            defaultHeaders: data.defaultHeaders,
        };
        this.localConfig = {
            credentials: data.localCredentials,
            variables: data.localVariables,
        };
    }

    /**
     * Create a VariableResolver pre-loaded with environment variables.
     */
    private createResolver(envName?: string, extraVariables?: Record<string, string>): VariableResolver {
        const env = this.getResolvedEnvironment(envName);
        const envVars = env?.variables || {};
        // NOTE: getResolvedEnvironment(envName) already merges the requested
        // environment's runtime locals (pm.environment.set values).
        // Keep globals at the globals tier, but lift runtime pm.globals.set()
        // writes into the highest-precedence variables tier so stale env-file
        // values with the same key cannot shadow fresh runtime globals.
        const runtimeGlobals = this.getGlobalVariables();
        const runtimeGlobalLocals = this.getGlobalVariableLocals();
        return new VariableResolver({
            globals: runtimeGlobals,
            collectionVariables: {},
            environmentVariables: envVars,
            variables: {
                ...runtimeGlobalLocals,
                ...(extraVariables || {})
            },
        });
    }

    private saveFolderSharedConfig(config: SharedConfig): void {
        if (!fs.existsSync(this.environmentsPath)) {
            fs.mkdirSync(this.environmentsPath, { recursive: true });
        }

        const globalPayload = {
            $schema: 'https://raw.githubusercontent.com/hsl1230/http-forge/main/resources/global-environment.schema.json',
            variables: config.globalVariables || {},
            defaultHeaders: config.defaultHeaders || {}
        };
        this.saveJsonFile(this.sharedConfigPath, globalPayload);

        const existingEnvFiles = fs.readdirSync(this.environmentsPath)
            .filter((name) => name.endsWith('.json'))
            .filter((name) => !isSystemEnvironmentFile(name));

        const currentEnvNames = new Set(Object.keys(config.environments || {}));

        for (const file of existingEnvFiles) {
            const envName = path.basename(file, '.json');
            if (!currentEnvNames.has(envName)) {
                try { fs.unlinkSync(path.join(this.environmentsPath, file)); } catch { /* ignore */ }
            }
        }

        for (const [envName, envConfig] of Object.entries(config.environments || {})) {
            const payload = {
                $schema: 'https://raw.githubusercontent.com/hsl1230/http-forge/main/resources/environment.schema.json',
                name: envName,
                description: envConfig.description,
                requiresConfirmation: envConfig.requiresConfirmation,
                variables: envConfig.variables || {}
            };
            this.saveJsonFile(path.join(this.environmentsPath, `${envName}.json`), payload);
        }
    }

    public reload(): void {
        this.sharedConfig = null;
        this.localConfig = null;
        this.loadConfigs();
        this.invalidateResolvedConfigCache();
    }

    /**
     * Invalidate the entire resolved config cache (called when config file or env files change).
     */
    private invalidateResolvedConfigCache(): void {
        this.resolvedConfigCache.clear();
    }

    /**
     * Build the set of file-only variables for an environment.
     * Excludes runtime pm.environment.set / pm.globals.set values so the resolved
     * config reflects only what is committed in env files.
     */
    private getFileOnlyVariables(envName: string): Record<string, string> {
        this.loadConfigs();
        const shared = this.sharedConfig;
        const local = this.localConfig;
        const envConfig = shared?.environments?.[envName];
        return {
            ...(shared?.globalVariables || {}),       // _global.json
            ...(local?.variables || {}),               // _global.local.json
            ...(envConfig?.variables || {}),           // {env}.json
            ...(local?.credentials?.[envName]?.variables || {})  // {env}.local.json
        };
    }

    /**
     * Recursively resolve {{variable}} tokens in all string fields of any value.
     * - Whole-value templates: {{ expr }} → evaluated, returned as native type (bool/number/string).
     * - Partial templates: "prefix-{{ var }}-suffix" → string substitution.
     * - Numbers/booleans/null → passed through unchanged.
     */
    private resolveConfigValues<T>(value: T, variables: Record<string, string>): T {
        if (value === null || value === undefined) return value;
        if (typeof value === 'string') {
            const resolver = new VariableResolver({
                globals: {},
                collectionVariables: {},
                environmentVariables: variables,
                variables: {}
            });
            if (/^\s*\{\{.*\}\}\s*$/.test(value)) {
                const resolved = resolver.resolveString(value);
                if (resolved === 'true')  return true  as unknown as T;
                if (resolved === 'false') return false as unknown as T;
                const num = Number(resolved);
                if (resolved !== '' && !isNaN(num)) return num as unknown as T;
                return resolved as unknown as T;
            }
            return resolver.resolveString(value) as unknown as T;
        }
        if (Array.isArray(value)) {
            return value.map(v => this.resolveConfigValues(v, variables)) as unknown as T;
        }
        if (typeof value === 'object') {
            const result: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                result[k] = this.resolveConfigValues(v, variables);
            }
            return result as T;
        }
        return value;
    }

    /**
     * Return the fully resolved HttpForgeConfig for the given environment.
     * Result is cached; cache is invalidated on config/env file changes and env switch.
     * Uses file-only variables — NOT runtime pm.* writes.
     */
    public getResolvedConfig(envName?: string): import('../config/config.interface').HttpForgeConfig {
        const env = envName ?? this.selectedEnvironment;
        if (!this.resolvedConfigCache.has(env)) {
            const raw = this.configService.getConfig();
            const vars = this.getFileOnlyVariables(env);
            const resolved = this.resolveConfigValues(raw, vars);
            this.resolvedConfigCache.set(env, resolved);
        }
        return this.resolvedConfigCache.get(env)!;
    }

    public getAllEnvironments(): Array<{ id: string; name: string; active: boolean; variables: Record<string, string> }> {
        this.loadConfigs();
        if (!this.sharedConfig) {
            return [];
        }
        return Object.entries(this.sharedConfig.environments).map(([name, config]) => ({
            id: name,
            name,
            active: name === this.selectedEnvironment,
            variables: config.variables || {}
        }));
    }

    public async setActiveEnvironment(environmentId: string): Promise<void> {
        await this.setSelectedEnvironment(environmentId);
    }

    public async createEnvironment(name: string): Promise<void> {
        this.loadConfigs();
        if (!this.sharedConfig) {
            this.sharedConfig = { environments: {}, globalVariables: {} };
        }
        if (this.sharedConfig.environments[name]) {
            throw new Error(`Environment "${name}" already exists`);
        }
        this.sharedConfig.environments[name] = {
            description: `Created ${new Date().toISOString()}`,
            variables: {}
        };
        this.saveSharedConfig(this.sharedConfig);
    }

    public async deleteEnvironment(environmentId: string): Promise<void> {
        this.loadConfigs();
        this.validateConfigLoaded();
        this.validateEnvironmentExists(environmentId);
        delete this.sharedConfig!.environments[environmentId];
        if (this.selectedEnvironment === environmentId) {
            const remainingEnvs = Object.keys(this.sharedConfig!.environments);
            this.selectedEnvironment = remainingEnvs.length > 0 ? remainingEnvs[0] : 'dev';
            await this.workspaceStore?.update(STATE_KEYS.SELECTED_ENVIRONMENT, this.selectedEnvironment);
        }
        this.saveSharedConfig(this.sharedConfig!);
    }

    public async duplicateEnvironment(environmentId: string, newName: string): Promise<void> {
        this.loadConfigs();
        this.validateConfigLoaded();
        this.validateEnvironmentName(newName);
        this.validateEnvironmentExists(environmentId);
        this.validateEnvironmentNameNotTaken(newName);
        const sourceEnv = this.sharedConfig!.environments[environmentId];
        this.sharedConfig!.environments[newName] = JSON.parse(JSON.stringify(sourceEnv));
        this.sharedConfig!.environments[newName].description = `Copied from ${environmentId}`;
        this.saveSharedConfig(this.sharedConfig!);
    }

    public async renameEnvironment(environmentId: string, newName: string): Promise<void> {
        this.loadConfigs();
        this.validateConfigLoaded();
        this.validateEnvironmentName(newName);
        this.validateEnvironmentExists(environmentId);
        if (newName === environmentId) {
            return;
        }
        this.validateEnvironmentNameNotTaken(newName);
        this.sharedConfig!.environments[newName] = this.sharedConfig!.environments[environmentId];
        delete this.sharedConfig!.environments[environmentId];
        if (this.selectedEnvironment === environmentId) {
            this.selectedEnvironment = newName;
            await this.workspaceStore?.update(STATE_KEYS.SELECTED_ENVIRONMENT, newName);
        }
        this.saveSharedConfig(this.sharedConfig!);
    }

    private validateEnvironmentName(name: string): void {
        if (!name || name.trim().length === 0) {
            throw new Error('Environment name cannot be empty');
        }
        if (name.length > 128) {
            throw new Error('Environment name cannot exceed 128 characters');
        }
        if (!/^[a-zA-Z0-9_\-\.]+$/.test(name)) {
            throw new Error(
                'Environment name can only contain letters, numbers, hyphens, underscores, and dots'
            );
        }
    }

    private validateEnvironmentExists(environmentId: string): void {
        if (!this.sharedConfig?.environments?.[environmentId]) {
            throw new Error(`Environment "${environmentId}" not found`);
        }
    }

    private validateEnvironmentNameNotTaken(newName: string): void {
        if (this.sharedConfig?.environments?.[newName]) {
            throw new Error(`Environment "${newName}" already exists`);
        }
    }

    private validateConfigLoaded(): void {
        if (!this.sharedConfig) {
            throw new Error('No environment configuration loaded');
        }
    }

    public async updateEnvironmentVariables(environmentId: string, variables: Record<string, string>): Promise<void> {
        this.loadConfigs();
        if (!this.sharedConfig) {
            throw new Error('No configuration loaded');
        }
        const env = this.sharedConfig.environments[environmentId];
        if (!env) {
            throw new Error(`Environment "${environmentId}" not found`);
        }
        env.variables = variables;
        this.saveSharedConfig(this.sharedConfig);
    }

    private saveJsonFile(filePath: string, data: any): void {
        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (error) {
            console.error(`Failed to save JSON to ${filePath}:`, error);
            throw error;
        }
    }
}
