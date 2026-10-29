/**
 * HTTP Forge Configuration Interfaces
 * 
 * Defines the structure of http-forge.config.json
 */

/**
 * Storage configuration
 */
export interface StorageConfig {
    /** Storage format: 'folder' for directory structure, 'json' for single files */
    format: 'folder' | 'json';
    /** Root directory for HTTP Forge data (relative to workspace) */
    root: string;
    /** Directory for request history (relative to workspace, typically gitignored) */
    history: string;
    /** Directory for test results (relative to workspace, typically gitignored) */
    results: string;
}

/**
 * Request configuration
 */
export interface RequestConfig {
    /** Request timeout in milliseconds */
    timeout: number;
    /** Whether to automatically follow redirects */
    followRedirects: boolean;
    /** Maximum number of redirects to follow */
    maxRedirects: number;
    /** Whether to verify SSL certificates */
    strictSSL: boolean;
    /** Per-request TLS defaults (paths resolved relative to workspace root) */
    tls?: {
        caPath?: string;
        certPath?: string;
        keyPath?: string;
        pfxPath?: string;
        passphrase?: string;
        servername?: string;
    };
    /** Host-based certificate mappings (Postman-style global certificates) */
    certificates?: Array<{
        host: string;
        port?: number;
        enabled?: boolean;
        caPath?: string;
        certPath?: string;
        keyPath?: string;
        pfxPath?: string;
        passphrase?: string;
        servername?: string;
    }>;
}

/**
 * Script configuration
 */
export interface ScriptsConfig {
    /** Paths to search for importable modules (relative to workspace) */
    modulePaths: string[];
    /**
     * Script scope mode.
     * - 'shared'   (default): all script levels run in one shared scope; var/function
     *   declarations leak across levels and across pre-request/post-response phases.
     *   Lowest overhead; preserves existing behavior.
     * - 'isolated': each script level runs in its own scope (Postman-compatible). State
     *   must pass through pm.variables / pm.environment / pm.globals.
     */
    scope?: 'shared' | 'isolated';
    /**
     * Per-script timeout in milliseconds (default 5000). Bounds both the synchronous
     * script CPU guard and the async event-loop drain budget (pending setTimeout /
     * un-awaited Promises) that the runner waits on before advancing to the next request.
     */
    timeout?: number;
}

/**
 * HTML report generation options.
 */
export interface ReportConfig {
    /**
     * Maximum characters of a single request/response body embedded in the HTML
     * report. Larger bodies are truncated (the full body stays in the on-disk
     * result file). Guards against multi-GB reports on big collections.
     */
    maxBodyChars: number;
    /**
     * Which requests get their request/response bodies embedded in the report:
     * - 'all'    — every request (largest reports)
     * - 'failed' — only failed requests (default; passed requests show a note)
     * - 'none'   — no bodies embedded
     */
    embedBodies: 'all' | 'failed' | 'none';
}

/**
 * Runner configuration
 */
export interface RunnerConfig {
    /** Number of days to retain test results */
    resultsRetentionDays: number;
    /** Number of result summaries per index page file */
    indexPageSize: number;
    /** Maximum number of recent errors to track */
    recentErrorsLimit: number;
    /** HTML report generation options */
    report: ReportConfig;
}

/**
 * Environments configuration
 */
export interface EnvironmentsConfig {
    /** Default environment to use */
    default: string;
}

/**
 * REST-Client export configuration
 */
export interface RestClientExportConfig {
    /** Output path for exported REST-Client files */
    path?: string;
    /** When exporting environments, merge global variables into each environment file */
    mergeGlobals?: boolean;
}

/**
 * Discovery configuration
 */
export interface DiscoveryConfig {
    /** Absolute or workspace-relative path to a custom seed loader module. */
    customSeedLoaderModulePath?: string;
    /** Custom framework hints for discovery. Defaults to ['auto']. */
    frameworks?: string[];
    /** Custom request/response context properties to search for during component analysis. */
    contextProperties?: string[];
    /** When true, skip component dependency analysis during discovery. */
    skipComponentAnalysis?: boolean;
}

/**
 * MCP Server CORS configuration
 */
export interface McpCorsConfig {
    /** Origins allowed to access the MCP server (defaults to localhost variants) */
    allowedOrigins: string[];
}

/**
 * How the MCP server shapes its `tools/list` response.
 *
 * - `auto` (**recommended default**): uses `flat` below `drilldownThreshold`,
 *   then switches to `drilldown`. Adapts automatically as the workspace grows.
 * - `drilldown`: always uses the small fixed generic tool set regardless of
 *   collection size. Best for large workspaces or context-budget-constrained clients.
 * - `flat`: always emits one tool per request/folder/collection/suite. Only
 *   useful for tiny, stable collections or external automation that relies on
 *   exact generated tool names. **Avoid for workspaces with >100 requests** —
 *   the tool list will bloat the AI context window and degrade tool-selection accuracy.
 * - `execution-only`: exposes only tools that require the HTTP Forge runtime
 *   (run, poll results, AI analysis). Discovery and collection-management tools
 *   are omitted because AI agents with file-system access can read/write the
 *   plain-JSON collection files directly. Best token-budget option for local
 *   VS Code / CLI setups where the agent also has workspace file access.
 */
export type McpToolMode = 'flat' | 'drilldown' | 'auto' | 'execution-only';

/**
 * MCP Server project-level configuration (stored in http-forge.config.json)
 */
export interface McpConfig {
    /**
     * Port for the embedded MCP HTTP server. Defaults to 3100.
     * Runtime callers can still override this via `createMcpRuntime({ port })`.
     */
    port: number;
    /**
     * Collection IDs or names to hide from MCP tools.
     * Empty array (default) = expose all collections.
     */
    excludedCollections: string[];
    /**
     * Suite IDs or names to hide from MCP tools.
     * Empty array (default) = expose all suites.
     */
    excludedSuites: string[];
    /**
     * Optional prefix added to every tool name, e.g. "acme_" → "acme_request__colId__reqId".
     * Useful when multiple projects share the same AI agent.
     */
    toolPrefix: string;
    /**
     * Maximum number of requests the MCP server will execute in a single
     * collection or suite call. Prevents accidental runaway executions.
     */
    maxRequestsPerCall: number;
    /**
     * Tool-list shape. Defaults to `auto`. Use `drilldown` to always use generic
     * tools, or `flat` to always emit one tool per request.
     */
    toolMode: McpToolMode;
    /**
     * When `toolMode` is `auto`, switch to drilldown once the number of request
     * tools would exceed this count. Ignored for `flat` and `drilldown`.
     */
    drilldownThreshold: number;
    /**
     * Maximum number of tools returned per `tools/list` page in flat mode.
     * The client passes the returned `nextCursor` to fetch the next page.
     * Set to `0` to disable pagination and return all tools in one response.
     * Defaults to `150`. Ignored in drilldown / auto-drilldown mode.
     */
    toolPageSize: number;
    /** CORS configuration */
    cors: McpCorsConfig;
}

/**
 * Proxy configuration
 */
export interface ProxyConfig {
    /** Enable or disable the proxy without removing the config (default: true) */
    enabled?: boolean;
    /** HTTP proxy URL */
    http?: string;
    /** HTTPS proxy URL */
    https?: string;
    /** List of hosts to bypass proxy */
    bypass?: string[];
}

/**
 * Cloud secret provider configuration (used in SecretsConfig.providers)
 */
export interface SecretProviderEntry {
    /** Provider type */
    provider: 'aws' | 'azure' | 'gcp' | 'vault' | '1password' | 'doppler' | 'custom';
    /** AWS region (aws only) */
    region?: string;
    /** AWS shared-config profile (aws only; falls back to AWS_PROFILE) */
    profile?: string;
    /** Azure Key Vault URL (azure only) */
    vaultUrl?: string;
    /** GCP project ID (gcp only) */
    projectId?: string;
    /** Vault server address (vault only) */
    address?: string;
    /** Vault mount path (vault only, default "secret") */
    mountPath?: string;
    /** Vault namespace (vault only, Enterprise/HCP) */
    namespace?: string;
    /** 1Password vault name (1password only) */
    vault?: string;
    /** 1Password desktop-app account name or UUID (1password only; used when no service-account token is set) */
    account?: string;
    /** Doppler service token (doppler only; falls back to DOPPLER_TOKEN env var) */
    serviceToken?: string;
    /** Custom resolver module path or package name (custom only) */
    module?: string;
    /** Non-sensitive options passed to the custom resolver factory (custom only) */
    options?: Record<string, unknown>;
}

/**
 * Top-level secrets block in http-forge.config.json
 * Configures named cloud secret providers for {{secret:alias/path}} tokens.
 */
export interface SecretsConfig {
    providers: Record<string, SecretProviderEntry>;
}

/**
 * Main HTTP Forge configuration (http-forge.config.json)
 */
export interface HttpForgeConfig {
    /** Configuration version */
    version: string;
    /** Storage configuration */
    storage: StorageConfig;
    /** Request defaults */
    request: RequestConfig;
    /** Script configuration */
    scripts: ScriptsConfig;
    /** Test runner configuration */
    runner: RunnerConfig;
    /** Environment configuration */
    environments: EnvironmentsConfig;
    /** REST-Client export preferences */
    restClientExport?: RestClientExportConfig;
    /** MCP server project-level configuration */
    mcp?: McpConfig;
    /** Proxy configuration (optional) */
    proxy?: ProxyConfig | null;
    /** Cloud secret provider configuration (optional) */
    secrets?: SecretsConfig;
    /** Discovery configuration (optional) */
    discovery?: DiscoveryConfig;
}

/**
 * Configuration service interface
 */
export interface IConfigService {
    /** Get the full configuration */
    getConfig(): HttpForgeConfig;
    /** Get storage configuration */
    getStorageConfig(): StorageConfig;
    /** Get request configuration */
    getRequestConfig(): RequestConfig;
    /** Get scripts configuration */
    getScriptsConfig(): ScriptsConfig;
    /** Get runner configuration */
    getRunnerConfig(): RunnerConfig;
    /** Get environments configuration */
    getEnvironmentsConfig(): EnvironmentsConfig;
    /** Get discovery configuration */
    getDiscoveryConfig(): DiscoveryConfig;
    /** Get proxy configuration */
    getProxyConfig(): ProxyConfig | null;
    /** Get MCP server project-level configuration (always returns resolved defaults) */
    getMcpConfig(): McpConfig;
    /** Get the resolved root path for HTTP Forge data */
    getRootPath(): string;
    /**
     * Optional callback invoked after the config file is reloaded.
     * Set by consumers (e.g. EnvironmentConfigService) that cache resolved configs
     * derived from this config — they use this hook to invalidate their cache.
     */
    onConfigReloaded?: () => void;
    /** Get the resolved collections path */
    getCollectionsPath(): string;
    /** Get the resolved environments path */
    getEnvironmentsPath(): string;
    /** Get the resolved flows path */
    getFlowsPath(): string;
    /** Get the resolved history path */
    getHistoryPath(): string;
    /** Get the resolved results path */
    getResultsPath(): string;
    /** Get the resolved suites path */
    getSuitesPath(): string;
    /** Get resolved module paths for script imports */
    getModulePaths(): string[];
    /** Get the script scope mode ('shared' default, or 'isolated' for Postman parity) */
    getScriptScope(): 'shared' | 'isolated';
    /** Get the per-script timeout in milliseconds (default 5000) */
    getScriptTimeout(): number;
    /** Get the workspace root path */
    getWorkspacePath(): string;
    /** Reload configuration from disk */
    reload(): void;
    /** Check if configuration file exists */
    configExists(): boolean;
    /** Create default configuration file */
    createDefaultConfig(): Promise<void>;
}
