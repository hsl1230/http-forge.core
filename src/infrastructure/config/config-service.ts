/**
 * HTTP Forge Configuration Service
 *
 * Single Responsibility: Manages loading and accessing configuration
 * from http-forge.config.json
 *
 * Platform-agnostic — uses IFileWatcherFactory and INotificationService
 * instead of VS Code APIs.
 */

import * as fs from 'fs';
import * as path from 'path';

import { IFileWatcher, IFileWatcherFactory, INotificationService } from '../../types/platform';
import type {
    DiscoveryConfig,
    EnvironmentsConfig,
    HttpForgeConfig,
    IConfigService,
    McpConfig,
    ProxyConfig,
    RequestConfig,
    RunnerConfig,
    ScriptsConfig,
    StorageConfig
} from './config.interface';
import { CONFIG_FILES, DEFAULT_CONFIG, ROOT_DIRECTORIES } from './default-config';

/**
 * Configuration Service Implementation
 *
 * Loads configuration from http-forge.config.json in workspace root.
 * Falls back to default values for missing fields.
 */
export class ConfigService implements IConfigService {
    private config: HttpForgeConfig;
    private configPath: string;
    private configDir: string;
    private fileWatchers: IFileWatcher[] = [];
    private _standaloneProbeCache?: { key: string; value: boolean; ts: number };
    private _cachedWorkspaceNormalization?: { input: string; result: string };

    constructor(
        private workspacePath: string,
        private fileWatcherFactory?: IFileWatcherFactory,
        private notifications?: INotificationService
    ) {
        this.workspacePath = this.normalizeWorkspacePath(workspacePath);
        this.configPath = this.resolveConfigPath();
        this.configDir = path.dirname(this.configPath);
        this.config = this.loadConfig();
        this.setupFileWatcher();
    }

    private isStandaloneLayoutCached(): boolean {
        const now = Date.now();
        if (this._standaloneProbeCache && now - this._standaloneProbeCache.ts < 5000) {
            return this._standaloneProbeCache.value;
        }
        const hasStandaloneAssets = fs.existsSync(path.join(this.workspacePath, 'assets'));
        const hasIntegratedForge = fs.existsSync(path.join(this.workspacePath, '.http-forge'));
        const value = hasStandaloneAssets && !hasIntegratedForge;
        this._standaloneProbeCache = { key: this.workspacePath, value, ts: now };
        return value;
    }

    private normalizeWorkspacePath(workspacePath: string): string {
        if (this._cachedWorkspaceNormalization && this._cachedWorkspaceNormalization.input === workspacePath) {
            return this._cachedWorkspaceNormalization.result;
        }
        const resolved = path.resolve(workspacePath);
        const baseName = path.basename(resolved);

        // Detect whether a candidate directory looks like a forge root
        // (standalone roots contain assets/collections or a config file directly).
        const isStandaloneForgeRoot = (candidate: string): boolean => {
            if (fs.existsSync(path.join(candidate, 'assets', 'collections'))) return true;
            if (fs.existsSync(path.join(candidate, 'collections'))) return true;
            if (fs.existsSync(path.join(candidate, 'environments'))) return true;
            if (fs.existsSync(path.join(candidate, 'http-forge.config.json'))) return true;
            if (fs.existsSync(path.join(candidate, '.http-forge', 'http-forge.config.json'))) return false;
            return fs.existsSync(path.join(candidate, 'assets'));
        };

        const isAssetsRoot = (candidate: string): boolean => {
            // An assets folder is a forge assets root if it contains collections/environments/suites
            if (fs.existsSync(path.join(candidate, 'collections'))) return true;
            if (fs.existsSync(path.join(candidate, 'environments'))) return true;
            if (fs.existsSync(path.join(candidate, 'suites'))) return true;
            return false;
        };

        let result: string;
        if (baseName === '.http-forge') {
            result = !isStandaloneForgeRoot(resolved) ? path.dirname(resolved) : resolved;
        } else if (baseName === 'assets') {
            if (!isAssetsRoot(resolved)) {
                result = resolved;
            } else {
                const parent = path.dirname(resolved);
                // Integrated: my-project/.http-forge/assets -> workspace is my-project
                if (path.basename(parent) === '.http-forge') {
                    result = path.dirname(parent);
                } else {
                    // Generic standalone: my-standalone/assets -> workspace is my-standalone (any name)
                    result = parent;
                }
            }
        } else {
            result = resolved;
        }
        this._cachedWorkspaceNormalization = { input: workspacePath, result };
        return result;
    }

    private resolveConfigPath(): string {
        const rootConfig = path.join(this.workspacePath, CONFIG_FILES.legacy);
        const nestedConfig = path.join(this.workspacePath, CONFIG_FILES.preferred);
        if (fs.existsSync(rootConfig)) {
            return rootConfig;
        }
        if (fs.existsSync(nestedConfig)) {
            return nestedConfig;
        }
        // No config on disk — choose default creation location based on existing layout
        if (fs.existsSync(path.join(this.workspacePath, '.http-forge'))) {
            return nestedConfig;
        }
        if (
            this.hasFolderCollectionsAtRoot(path.join(this.workspacePath, 'assets')) ||
            fs.existsSync(path.join(this.workspacePath, 'assets')) ||
            this.hasFolderCollectionsAtRoot(this.workspacePath)
        ) {
            return rootConfig;
        }
        return nestedConfig;
    }

    /**
     * Load configuration from file, merging with defaults
     */
    private loadConfig(): HttpForgeConfig {
        this.configPath = this.resolveConfigPath();
        this.configDir = path.dirname(this.configPath);

        if (!fs.existsSync(this.configPath)) {
            return { ...DEFAULT_CONFIG };
        }

        try {
            const content = fs.readFileSync(this.configPath, 'utf-8');
            const userConfig = JSON.parse(content) as Partial<HttpForgeConfig>;
            return this.mergeWithDefaults(userConfig);
        } catch (error) {
            console.error('[ConfigService] Failed to load config:', error);
            this.notifications?.showWarning(
                `Failed to parse ${path.relative(this.workspacePath, this.configPath)}. Using default configuration.`
            );
            return { ...DEFAULT_CONFIG };
        }
    }

    /**
     * Merge user configuration with defaults
     */
    private mergeWithDefaults(userConfig: Partial<HttpForgeConfig>): HttpForgeConfig {
        return {
            version: userConfig.version ?? DEFAULT_CONFIG.version,
            storage: {
                ...DEFAULT_CONFIG.storage,
                ...userConfig.storage
            },
            request: {
                ...DEFAULT_CONFIG.request,
                ...userConfig.request
            },
            scripts: {
                ...DEFAULT_CONFIG.scripts,
                ...userConfig.scripts
            },
            runner: {
                ...DEFAULT_CONFIG.runner,
                ...userConfig.runner,
                report: {
                    ...DEFAULT_CONFIG.runner.report,
                    ...userConfig.runner?.report
                }
            },
            environments: {
                ...DEFAULT_CONFIG.environments,
                ...userConfig.environments
            },
            restClientExport: {
                ...DEFAULT_CONFIG.restClientExport,
                ...userConfig.restClientExport
            },
            proxy: userConfig.proxy !== undefined ? userConfig.proxy : DEFAULT_CONFIG.proxy,
            discovery: {
                ...DEFAULT_CONFIG.discovery!,
                ...userConfig.discovery,
            },
            mcp: {
                ...DEFAULT_CONFIG.mcp!,
                ...userConfig.mcp,
                cors: {
                    ...DEFAULT_CONFIG.mcp!.cors,
                    ...userConfig.mcp?.cors
                }
            },
            secrets: {
                ...DEFAULT_CONFIG.secrets,
                ...userConfig.secrets,
                providers: {
                    ...DEFAULT_CONFIG.secrets?.providers,
                    ...userConfig.secrets?.providers
                }
            }
        };
    }

    /**
     * Setup file watcher for configuration changes
     */
    private setupFileWatcher(): void {
        if (!this.fileWatcherFactory) {
            return;
        }

        const reloadHandler = () => {
            this.reload();
        };

        for (const configGlob of [CONFIG_FILES.preferred, CONFIG_FILES.legacy]) {
            const watcher = this.fileWatcherFactory.createFileWatcher(
                this.workspacePath,
                configGlob
            );

            watcher.onDidChange(reloadHandler);
            watcher.onDidCreate(reloadHandler);
            watcher.onDidDelete(reloadHandler);
            this.fileWatchers.push(watcher);
        }
    }

    // ==================== IConfigService Implementation ====================

    getConfig(): HttpForgeConfig {
        return this.config;
    }

    getStorageConfig(): StorageConfig {
        return this.config.storage;
    }

    getRequestConfig(): RequestConfig {
        return this.config.request;
    }

    getScriptsConfig(): ScriptsConfig {
        return this.config.scripts;
    }

    getRunnerConfig(): RunnerConfig {
        const runner = this.config.runner;
        const report = runner.report ?? DEFAULT_CONFIG.runner.report;
        const VALID_EMBED = ['all', 'failed', 'none'] as const;
        return {
            ...runner,
            report: {
                // Clamp to a sane floor so a body always shows at least a snippet.
                maxBodyChars: Math.max(1000, Math.floor(report.maxBodyChars ?? DEFAULT_CONFIG.runner.report.maxBodyChars)),
                embedBodies: VALID_EMBED.includes(report.embedBodies as any)
                    ? report.embedBodies
                    : DEFAULT_CONFIG.runner.report.embedBodies,
            }
        };
    }

    getEnvironmentsConfig(): EnvironmentsConfig {
        return this.config.environments;
    }

    /**
     * Path where REST-Client export files should be saved. The returned
     * string is an absolute path, resolved against the workspace when a
     * relative value is configured.
     */
    getRestClientExportPath(): string {
        const p = this.config.restClientExport?.path || 'collections-rest-client';
        if (path.isAbsolute(p)) {
            return p;
        }
        return this.resolvePath(p);
    }

    /**
     * Whether to merge global variables into each environment export.
     */
    getRestClientMergeGlobals(): boolean {
        return this.config.restClientExport?.mergeGlobals ?? true;
    }

    getProxyConfig(): ProxyConfig | null {
        return this.config.proxy ?? null;
    }

    getDiscoveryConfig(): DiscoveryConfig {
        const cfg = this.config.discovery ?? DEFAULT_CONFIG.discovery!;
        return {
            customSeedLoaderModulePath: cfg.customSeedLoaderModulePath,
            frameworks: cfg.frameworks ?? DEFAULT_CONFIG.discovery!.frameworks,
            contextProperties: cfg.contextProperties ?? DEFAULT_CONFIG.discovery!.contextProperties,
            skipComponentAnalysis: cfg.skipComponentAnalysis ?? DEFAULT_CONFIG.discovery!.skipComponentAnalysis,
        };
    }

    getMcpConfig(): McpConfig {
        const cfg = this.config.mcp ?? DEFAULT_CONFIG.mcp!;
        const VALID_MODES = ['flat', 'drilldown', 'auto', 'execution-only'] as const;
        return {
            ...cfg,
            // port: valid TCP port range
            port: Math.min(65535, Math.max(1, Math.floor(cfg.port ?? 3100))),
            // toolMode: reject anything that isn't a known mode
            toolMode: VALID_MODES.includes(cfg.toolMode as any) ? cfg.toolMode : 'auto',
            // drilldownThreshold: min 10, max 500
            drilldownThreshold: Math.min(500, Math.max(10, cfg.drilldownThreshold ?? 100)),
            // toolPageSize: min 10, max 1000 (0 = no pagination, kept as-is)
            toolPageSize: cfg.toolPageSize === 0 ? 0 : Math.min(1000, Math.max(10, cfg.toolPageSize ?? 200)),
            // maxRequestsPerCall: min 1, max 10000
            maxRequestsPerCall: Math.min(10000, Math.max(1, cfg.maxRequestsPerCall ?? 500)),
        };
    }

    /**
     * Resolve a path relative to the config file location.
     * When a config file exists, paths are resolved against its directory.
     * When no config exists, fallback to workspace root.
     * Handles backward compatibility for configs inside .http-forge that used
     * workspace-relative defaults like "./.http-forge/assets".
     */
    private resolvePath(relativePath: string): string {
        if (path.isAbsolute(relativePath)) {
            return relativePath;
        }
        const normalized = relativePath.startsWith('./')
            ? relativePath.slice(2)
            : relativePath;
        // Use configDir when a config file exists, otherwise workspacePath
        const baseDir = this.configExists() ? this.configDir : this.workspacePath;
        let effective = normalized;
        // Strip redundant .http-forge prefix when config is inside .http-forge
        // e.g. config at .http-forge/http-forge.config.json with root "./.http-forge/assets"
        // should not become .http-forge/.http-forge/assets
        if (path.basename(baseDir) === '.http-forge') {
            if (effective === '.http-forge' || effective.startsWith('.http-forge/')) {
                effective = effective.slice('.http-forge/'.length);
            }
        } else if (baseDir === this.workspacePath && effective.startsWith('.http-forge/')) {
            // Standalone workspace with config at root using integrated default
            // "./.http-forge/assets" should resolve to "./assets" when no .http-forge folder exists
            if (this.isStandaloneLayoutCached()) {
                effective = effective.slice('.http-forge/'.length);
            }
        }
        if (!effective) {
            return baseDir;
        }
        return path.join(baseDir, ...effective.split('/').filter(p => p !== '' && p !== '.'));
    }

    /**
     * Detect whether a root path contains folder-format collections.
     * We require at least one collection folder with a collection.json file
     * to avoid false positives on unrelated empty directories.
     */
    private hasFolderCollectionsAtRoot(rootPath: string): boolean {
        const collectionsPath = path.join(rootPath, ROOT_DIRECTORIES.collections);
        if (!fs.existsSync(collectionsPath)) {
            return false;
        }

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(collectionsPath, { withFileTypes: true });
        } catch {
            return false;
        }

        return entries.some(entry => {
            if (!entry.isDirectory()) {
                return false;
            }
            const metadataPath = path.join(collectionsPath, entry.name, 'collection.json');
            return fs.existsSync(metadataPath);
        });
    }

    /**
     * Returns true when a directory exists and contains at least one entry.
     */
    private hasAnyEntries(dirPath: string): boolean {
        if (!fs.existsSync(dirPath)) {
            return false;
        }

        try {
            return fs.readdirSync(dirPath).length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Resolve storage root with backward compatibility for config-less workspaces.
     *
     * Supports both integrated mode (workspace/.http-forge/assets) and standalone mode
     * (workspace/assets) where .http-forge is opened as the workspace root.
     */
    private resolveStorageRootPath(): string {
        const configuredRoot = this.resolvePath(this.config.storage.root);

        // Explicit config must always win.
        if (this.configExists()) {
            return configuredRoot;
        }

        // If the current default already contains collections, keep using it.
        if (this.hasFolderCollectionsAtRoot(configuredRoot)) {
            return configuredRoot;
        }

        const candidates = [
            path.join(this.workspacePath, '.http-forge', 'assets'),
            path.join(this.workspacePath, 'assets'),
            path.join(this.workspacePath, 'http-forge-assets'),
            // Bare workspace as root (when collections are directly at workspace/collections)
            this.workspacePath,
        ];

        const found = candidates.find(candidate => this.hasFolderCollectionsAtRoot(candidate));
        if (found) {
            return found;
        }

        // Also check configuredRoot's alternative when configDir fallback was nested but workspace is standalone
        // e.g. configuredRoot = workspace/.http-forge/assets but actual is workspace/assets
        const standaloneRoot = path.join(this.workspacePath, 'assets');
        if (this.hasFolderCollectionsAtRoot(standaloneRoot)) {
            return standaloneRoot;
        }

        return configuredRoot;
    }

    getRootPath(): string {
        return this.resolveStorageRootPath();
    }

    getCollectionsPath(): string {
        return path.join(this.getRootPath(), ROOT_DIRECTORIES.collections);
    }

    getEnvironmentsPath(): string {
        return path.join(this.getRootPath(), ROOT_DIRECTORIES.environments);
    }

    getFlowsPath(): string {
        return path.join(this.getRootPath(), ROOT_DIRECTORIES.flows);
    }

    getHistoryPath(): string {
        const configuredHistory = this.resolvePath(this.config.storage.history);

        if (this.configExists()) {
            return configuredHistory;
        }

        if (this.hasAnyEntries(configuredHistory)) {
            return configuredHistory;
        }

        const candidates = [
            path.join(this.workspacePath, '.http-forge', '.cache', 'histories'),
            path.join(this.workspacePath, '.cache', 'histories'),
            path.join(this.workspacePath, '.http-forge-cache', 'histories'),
            path.join(this.getRootPath(), '.cache', 'histories'),
        ];
        const found = candidates.find(c => this.hasAnyEntries(c));
        return found || configuredHistory;
    }

    getResultsPath(): string {
        const configuredResults = this.resolvePath(this.config.storage.results);

        if (this.configExists()) {
            return configuredResults;
        }

        if (this.hasAnyEntries(configuredResults)) {
            return configuredResults;
        }

        const candidates = [
            path.join(this.workspacePath, '.http-forge', '.cache', 'results'),
            path.join(this.workspacePath, '.cache', 'results'),
            path.join(this.workspacePath, '.http-forge-cache', 'results'),
            path.join(this.getRootPath(), '.cache', 'results'),
        ];
        const found = candidates.find(c => this.hasAnyEntries(c));
        return found || configuredResults;
    }

    getSuitesPath(): string {
        return path.join(this.getRootPath(), ROOT_DIRECTORIES.suites);
    }

    getModulePaths(): string[] {
        return this.config.scripts.modulePaths.map(p => this.resolvePath(p));
    }

    getScriptScope(): 'shared' | 'isolated' {
        return this.config.scripts.scope ?? 'shared';
    }

    getScriptTimeout(): number {
        return this.config.scripts.timeout ?? 5000;
    }

    getWorkspacePath(): string {
        return this.workspacePath;
    }

    onConfigReloaded?: () => void;

    reload(): void {
        this.configPath = this.resolveConfigPath();
        this.configDir = path.dirname(this.configPath);
        this.config = this.loadConfig();
        this.onConfigReloaded?.();
    }

    configExists(): boolean {
        return fs.existsSync(this.configPath) || fs.existsSync(this.resolveConfigPath());
    }

    private getDefaultConfigForCurrentLocation(): HttpForgeConfig {
        // When config will be created inside .http-forge, roots should be "./assets" etc.
        if (path.basename(this.configDir) === '.http-forge') {
            return {
                ...DEFAULT_CONFIG,
                storage: {
                    ...DEFAULT_CONFIG.storage,
                    root: './assets',
                    history: './.cache/histories',
                    results: './.cache/results',
                },
                scripts: {
                    ...DEFAULT_CONFIG.scripts,
                    modulePaths: ['./assets/src', './assets/lib'],
                },
            };
        }
        // Standalone workspace (assets at root, no .http-forge folder) -> root is ./assets
        const hasStandaloneAssets = fs.existsSync(path.join(this.workspacePath, 'assets'));
        const hasIntegratedForge = fs.existsSync(path.join(this.workspacePath, '.http-forge'));
        if (hasStandaloneAssets && !hasIntegratedForge) {
            return {
                ...DEFAULT_CONFIG,
                storage: {
                    ...DEFAULT_CONFIG.storage,
                    root: './assets',
                    history: './.cache/histories',
                    results: './.cache/results',
                },
                scripts: {
                    ...DEFAULT_CONFIG.scripts,
                    modulePaths: ['./assets/src', './assets/lib'],
                },
            };
        }
        return { ...DEFAULT_CONFIG };
    }

    async createDefaultConfig(): Promise<void> {
        // Ensure configDir is up to date
        this.configPath = this.resolveConfigPath();
        this.configDir = path.dirname(this.configPath);
        await fs.promises.mkdir(path.dirname(this.configPath), { recursive: true });
        const defaultConfig = this.getDefaultConfigForCurrentLocation();
        const content = JSON.stringify(defaultConfig, null, 2);
        await fs.promises.writeFile(this.configPath, content, 'utf-8');

        // Create the root directory structure
        const dirs = [
            this.getCollectionsPath(),
            this.getEnvironmentsPath(),
            this.getFlowsPath(),
            this.getSuitesPath()
        ];

        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                await fs.promises.mkdir(dir, { recursive: true });
            }
        }

        // Create cache directories
        const cacheDirs = [
            this.getHistoryPath(),
            this.getResultsPath()
        ];

        for (const dir of cacheDirs) {
            if (!fs.existsSync(dir)) {
                await fs.promises.mkdir(dir, { recursive: true });
            }
        }

        // Create sample environments
        await this.createSampleEnvironments();
    }

    /**
     * Create sample environment files
     */
    private async createSampleEnvironments(): Promise<void> {
        const envsPath = this.getEnvironmentsPath();

        // Create globals.json
        const globals = {
            id: 'globals',
            name: 'Global Variables',
            variables: {
                appName: 'HTTP Forge'
            }
        };
        await fs.promises.writeFile(
            path.join(envsPath, 'globals.json'),
            JSON.stringify(globals, null, 2),
            'utf-8'
        );

        // Create dev.json
        const dev = {
            id: 'env_dev',
            name: 'Development',
            variables: {
                baseUrl: 'http://localhost:3000',
                apiVersion: 'v1'
            }
        };
        await fs.promises.writeFile(
            path.join(envsPath, 'dev.json'),
            JSON.stringify(dev, null, 2),
            'utf-8'
        );

        // Create default-headers.json
        const headers = {
            id: 'default_headers',
            name: 'Default Headers',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        };
        await fs.promises.writeFile(
            path.join(envsPath, 'default-headers.json'),
            JSON.stringify(headers, null, 2),
            'utf-8'
        );
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        for (const watcher of this.fileWatchers) {
            watcher.dispose();
        }
        this.fileWatchers = [];
    }
}
