/**
 * Platform Adapters
 * 
 * Interface for platform-specific implementations that must be
 * provided by the host environment (VS Code, CLI, etc.).
 * 
 * The core bootstrap uses these adapters to wire up services
 * without depending on any specific platform.
 */

import type { IHttpExecutor } from '../ports/executors/http-executor.interface';
import type { IScriptExecutor } from '../ports/executors/script-executor.interface';
import type { ILogger } from '../ports/external/logger.interface';
import type { IConsoleService } from '../types/console-service';
import type {
    IApplicationInfo,
    IExternalBrowserService,
    IFileSystem,
    IFileWatcherFactory,
    IHttpClient,
    IKeyValueStore,
    INotificationService,
    ISecretStore
} from '../types/platform';

/**
 * Platform adapters required by core service bootstrap.
 * 
 * The host environment (VS Code extension, CLI tool, etc.) creates
 * concrete implementations and passes them to `registerCoreServices()`.
 * 
 * @example VS Code extension:
 * ```typescript
 * const adapters: PlatformAdapters = {
 *   workspaceFolder: '/path/to/workspace',
 *   fileWatcherFactory: new VscodeFileWatcherFactory(),
 *   notificationService: new VscodeNotificationService(),
 *   workspaceStore: new VscodeKeyValueStore(context.workspaceState),
 *   globalStore: new VscodeKeyValueStore(context.globalState),
 *   secretStore: vscodeSecretStoreAdapter,
 *   browserService: vscodeBrowserAdapter,
 *   applicationInfo: { name: 'HttpForge', version: '1.0.0' },
 *   consoleService: new ConsoleService('HTTP Forge'),
 * };
 * registerCoreServices(container, adapters);
 * ```
 */
export interface PlatformAdapters {
    /** Workspace root folder path */
    workspaceFolder: string;

    /** File watcher factory — watches for file changes (ConfigService, CollectionService) */
    fileWatcherFactory: IFileWatcherFactory;

    /** Notification service — shows info/warning/error messages (ConfigService) */
    notificationService: INotificationService;

    /** Per-workspace key-value store (EnvironmentConfigService). Optional — CLI/Node runs without it. */
    workspaceStore?: IKeyValueStore;

    /** Global key-value store (CookieService) */
    globalStore: IKeyValueStore;

    /** Secret storage for tokens (OAuth2TokenManager). Optional — OAuth2 disabled if absent. */
    secretStore?: ISecretStore;

    /** External browser service for OAuth2 flows. Optional — OAuth2 disabled if absent. */
    browserService?: IExternalBrowserService;

    /** Application name/version for User-Agent header (RequestPreparer) */
    applicationInfo?: IApplicationInfo;

    /** Structured logging service. Optional — a no-op console is used if absent. */
    consoleService?: IConsoleService;

    /**
     * Whether script-written environment overrides (pm.environment.set) should be
     * persisted to the workspace store between runs.
     * - `true`  (default) — VS Code extension: Current Values survive restarts.
     * - `false` — CLI/Node: overrides are in-memory only, runs are stateless.
     */
    persistOverrides?: boolean;

    // === Infrastructure adapters (used by complete-bootstrap / infrastructure-di-config) ===

    /** File system adapter */
    fileSystem?: IFileSystem;

    /** Logger adapter */
    logger?: ILogger;

    /** HTTP client adapter */
    httpClient?: IHttpClient;

    /** HTTP executor adapter */
    httpExecutor?: IHttpExecutor;

    /** Script executor adapter */
    scriptExecutor?: IScriptExecutor;
}
