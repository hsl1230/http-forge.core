/**
 * Core Service Bootstrap
 * 
 * Registers all platform-agnostic services in the ServiceContainer.
 * The host environment (VS Code, CLI, etc.) only needs to provide
 * PlatformAdapters — the actual service wiring lives here.
 * 
 * This is the single source of truth for service dependencies.
 */

import * as path from 'path';

// Service implementations
import { OAuth2TokenManager } from '../infrastructure/auth/oauth2-token-manager';
import { CollectionService } from '../infrastructure/collection/collection-service';
import { ConfigService } from '../infrastructure/config/config-service';
import { CookieService } from '../infrastructure/cookie/cookie-service';
import { PersistentCookieJar } from '../infrastructure/cookie/persistent-cookie-jar';
import { EnvironmentConfigService } from '../infrastructure/environment/environment-config-service';
import { CollectionRequestExecutor } from '../infrastructure/execution/collection-request-executor';
import { RequestPreparer } from '../infrastructure/execution/request-preparer';
import { GraphQLSchemaService } from '../infrastructure/graphql/graphql-schema-service';
import { RequestHistoryService } from '../infrastructure/history/request-history-service';
import { HttpRequestService } from '../infrastructure/http/http-request-service';
import { InterceptorChain } from '../infrastructure/http/interceptor-chain';
import { NodeHttpClient } from '../infrastructure/http/native-http-client';
import { RequestPreprocessor } from '../infrastructure/http/request-preprocessor';
import { UrlBuilder } from '../infrastructure/http/url-builder';
import { HistoryAnalyzer } from '../infrastructure/openapi/history-analyzer';
import { OpenApiExporter } from '../infrastructure/openapi/openapi-exporter';
import { OpenApiImporter } from '../infrastructure/openapi/openapi-importer';
import { SchemaInferenceService } from '../infrastructure/openapi/schema-inference-service';
import { SchemaInferrer } from '../infrastructure/openapi/schema-inferrer';
import { ScriptAnalyzer } from '../infrastructure/openapi/script-analyzer';
import { DataFileParser } from '../infrastructure/platform/data-file-parser';
import { ScriptExecutor } from '../infrastructure/script/script-executor';
import { SecretResolverRegistry } from '../infrastructure/secrets/secret-resolver-registry';
import { TestSuiteService } from '../infrastructure/test-suite/test-suite-service';
import { NodeWebSocketClient } from '../infrastructure/websocket/node-websocket-client';
import { NodeSocketIoClient } from '../infrastructure/websocket/node-socketio-client';

// Type imports for factory signatures
import type { IOAuth2TokenManager } from '../infrastructure/auth/interfaces';
import type { IConfigService } from '../infrastructure/config';
import type { IAsyncCookieService } from '../infrastructure/cookie/interfaces';
import type { ICollectionRequestExecutor } from '../infrastructure/execution/collection-request-executor-interfaces';
import type { IRequestPreparer } from '../infrastructure/execution/request-preparer-interfaces';
import type { IGraphQLSchemaService } from '../infrastructure/graphql/graphql-schema-service';
import type { IRequestHistoryService } from '../infrastructure/history/request-history-service-interfaces';
import type { IInterceptorChain } from '../infrastructure/http/interceptor-chain';
import type { IHttpRequestService } from '../infrastructure/http/interfaces';
import type { IRequestPreprocessor } from '../infrastructure/http/request-preprocessor';
import type { IUrlBuilder } from '../infrastructure/http/url-builder';
import type { IOpenApiExporter, IOpenApiImporter, ISchemaInferenceService, ISchemaInferrer } from '../infrastructure/openapi/interfaces';
import type { IDataFileParser } from '../infrastructure/platform/data-file-parser';
import type { ICookieJar, IScriptExecutor } from '../infrastructure/script/interfaces';
import type { ITestSuiteService } from '../infrastructure/test-suite/interfaces';
import type { ICollectionService } from '../types/collection';
import type { IConsoleService } from '../types/console-service';
import type { IEnvironmentConfigService } from '../types/environment-config';
import type {
    IApplicationInfo,
    IExternalBrowserService,
    IHttpClient,
    ISecretStore,
    IWebSocketClient,
    ISocketIoClient
} from '../types/platform';

import type { PlatformAdapters } from './platform-adapters';
import type { ServiceContainer } from './service-container';
import { ServiceIdentifiers } from './service-identifiers';

/**
 * No-op console service used when PlatformAdapters.consoleService is not provided
 */
const noopConsoleService: IConsoleService = {
    log: () => {},
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    logBatch: () => {},
    logRawLines: () => {},
    show: () => {},
    clear: () => {},
    dispose: () => {},
};

/**
 * Register all platform-agnostic core services in the container.
 * 
 * @param container - The service container to register into
 * @param adapters - Platform-specific adapters provided by the host
 * 
 * @example
 * ```typescript
 * const container = ServiceContainer.instance;
 * container.clear();
 * registerCoreServices(container, adapters);
 * ```
 */
export function registerCoreServices(
    container: ServiceContainer,
    adapters: PlatformAdapters
): void {
    const {
        workspaceFolder,
        fileWatcherFactory,
        notificationService,
        workspaceStore,
        globalStore,
        secretStore,
        browserService,
        applicationInfo,
        consoleService,
    } = adapters;

    // ========================================
    // Primitives
    // ========================================

    container.registerValue(ServiceIdentifiers.WorkspaceFolder, workspaceFolder);

    // ========================================
    // Config Service (depends on: workspace folder, file watcher factory, notifications)
    // Should be registered early as many services depend on it
    // ========================================

    container.registerSingleton<IConfigService>(
        ServiceIdentifiers.Config,
        () => new ConfigService(workspaceFolder, fileWatcherFactory, notificationService)
    );

    // ========================================
    // Console Service
    // ========================================

    container.registerSingleton<IConsoleService>(
        ServiceIdentifiers.Console,
        () => consoleService ?? noopConsoleService
    );

    // ========================================
    // Environment Config Service (depends on: workspace folder, workspace store, config service)
    // ========================================

    container.registerSingleton<IEnvironmentConfigService>(
        ServiceIdentifiers.EnvironmentConfig,
        (c) => new EnvironmentConfigService(
            workspaceFolder,
            workspaceStore,
            c.resolve<IConfigService>(ServiceIdentifiers.Config),
            fileWatcherFactory,
            secretStore,
            adapters.persistOverrides ?? true
        )
    );

    // ========================================
    // Cookie Service (depends on: global store)
    // ========================================

    container.registerSingleton<IAsyncCookieService>(
        ServiceIdentifiers.Cookie,
        () => new CookieService(globalStore) as unknown as IAsyncCookieService
    );

    // ========================================
    // Collection Service (depends on: workspace folder, config service, file watcher factory)
    // ========================================

    container.registerSingleton<ICollectionService>(
        ServiceIdentifiers.Collection,
        (c) => new CollectionService(
            c.resolve<IConfigService>(ServiceIdentifiers.Config),
            fileWatcherFactory
        )
    );

    // ========================================
    // Test Suite Service (depends on: collection service, config service)
    // ========================================

    container.registerSingleton<ITestSuiteService>(
        ServiceIdentifiers.TestSuite,
        (c) => new TestSuiteService(
            c.resolve<ICollectionService>(ServiceIdentifiers.Collection),
            c.resolve<IConfigService>(ServiceIdentifiers.Config)
        )
    );

    // ========================================
    // HTTP Client & Service
    // ========================================

    container.registerSingleton<IHttpClient>(
        ServiceIdentifiers.HttpClient,
        (c) => {
            const configService = c.resolve<IConfigService>(ServiceIdentifiers.Config);
            const envConfigService = c.resolve<IEnvironmentConfigService>(ServiceIdentifiers.EnvironmentConfig);
            // Request settings resolved fresh per request (for live TLS cert changes).
            // Proxy resolved from the env-specific resolved config cache, which uses
            // file-only variables — rebuilds on config/env file change or env switch.
            return new NodeHttpClient(
                () => envConfigService.getResolvedConfig().request,
                workspaceFolder,
                () => envConfigService.getResolvedConfig()?.proxy ?? null
            );
        }
    );

    container.registerSingleton<IWebSocketClient>(
        ServiceIdentifiers.WebSocketClient,
        () => new NodeWebSocketClient({ basePath: workspaceFolder })
    );

    container.registerSingleton<ISocketIoClient>(
        ServiceIdentifiers.SocketIoClient,
        () => new NodeSocketIoClient()
    );

    container.registerSingleton<IUrlBuilder>(
        ServiceIdentifiers.UrlBuilder,
        () => new UrlBuilder()
    );

    container.registerSingleton<IInterceptorChain>(
        ServiceIdentifiers.InterceptorChain,
        () => new InterceptorChain()
    );

    container.registerSingleton<IHttpRequestService>(
        ServiceIdentifiers.HttpRequest,
        (c) => new HttpRequestService(
            c.resolve<IUrlBuilder>(ServiceIdentifiers.UrlBuilder),
            c.resolve<IInterceptorChain>(ServiceIdentifiers.InterceptorChain),
            c.resolve<IHttpClient>(ServiceIdentifiers.HttpClient)
        )
    );

    // ========================================
    // Request Preprocessor
    // ========================================

    container.registerSingleton<IRequestPreprocessor>(
        ServiceIdentifiers.RequestPreprocessor,
        () => new RequestPreprocessor()
    );

    // ========================================
    // Request History Service
    // ========================================

    container.registerSingleton<IRequestHistoryService>(
        ServiceIdentifiers.RequestHistory,
        (c) => {
            const envConfig = c.resolve<EnvironmentConfigService>(ServiceIdentifiers.EnvironmentConfig);
            return new RequestHistoryService(
                envConfig.getHistoriesPath(),
                path.join(envConfig.getRootPath(), 'shared-histories')
            );
        }
    );

    // ========================================
    // OAuth2 Token Manager (requires secretStore + browserService)
    // ========================================

    if (secretStore && browserService) {
        container.registerSingleton<IOAuth2TokenManager>(
            ServiceIdentifiers.OAuth2TokenManager,
            (c) => new OAuth2TokenManager(
                secretStore as ISecretStore,
                browserService as IExternalBrowserService,
                c.resolve<IEnvironmentConfigService>(ServiceIdentifiers.EnvironmentConfig),
                c.resolve<IHttpRequestService>(ServiceIdentifiers.HttpRequest)
            )
        );
    }

    // ========================================
    // GraphQL Schema Service
    // ========================================

    container.registerSingleton<IGraphQLSchemaService>(
        ServiceIdentifiers.GraphQLSchemaService,
        (c) => new GraphQLSchemaService(
            c.resolve<IHttpClient>(ServiceIdentifiers.HttpClient)
        )
    );

    // ========================================
    // Secret Resolver Registry (Phase 3 — cloud secret providers)
    // ========================================

    container.registerSingleton<SecretResolverRegistry>(
        ServiceIdentifiers.SecretResolverRegistry,
        (c) => new SecretResolverRegistry(c.resolve<IConfigService>(ServiceIdentifiers.Config))
    );

    // ========================================
    // Request Preparer (shared by Request Tester and Collection Runner)
    // ========================================

    const appInfo: IApplicationInfo = applicationInfo ?? { name: 'HttpForge', version: '0.0.0' };

    container.registerSingleton<IRequestPreparer>(
        ServiceIdentifiers.RequestPreparer,
        (c) => new RequestPreparer(
            c.resolve<IEnvironmentConfigService>(ServiceIdentifiers.EnvironmentConfig),
            c.resolve<IHttpRequestService>(ServiceIdentifiers.HttpRequest),
            c.resolve<IRequestPreprocessor>(ServiceIdentifiers.RequestPreprocessor),
            c.has(ServiceIdentifiers.OAuth2TokenManager) 
                ? c.resolve<IOAuth2TokenManager>(ServiceIdentifiers.OAuth2TokenManager) 
                : undefined,
            appInfo,
            c.resolve<SecretResolverRegistry>(ServiceIdentifiers.SecretResolverRegistry)
        )
    );

    // ========================================
    // Script Executor
    // ========================================

    container.registerSingleton<IScriptExecutor>(
        ServiceIdentifiers.ScriptExecutor,
        (c) => {
            const configService = c.resolve<IConfigService>(ServiceIdentifiers.Config);
            return new ScriptExecutor(
                c.resolve<IHttpRequestService>(ServiceIdentifiers.HttpRequest),
                configService.getModulePaths(),
                c.resolve<SecretResolverRegistry>(ServiceIdentifiers.SecretResolverRegistry),
                configService.getScriptScope(),
                configService.getScriptTimeout()
            );
        }
    );

    // ========================================
    // Data File Parser
    // ========================================

    container.registerSingleton<IDataFileParser>(
        ServiceIdentifiers.DataFileParser,
        () => new DataFileParser()
    );

    // ========================================
    // Collection Request Executor
    // ========================================

    container.registerSingleton<ICollectionRequestExecutor>(
        ServiceIdentifiers.CollectionRequestExecutor,
        (c) => new CollectionRequestExecutor(
            c.resolve<IHttpRequestService>(ServiceIdentifiers.HttpRequest),
            c.resolve<IScriptExecutor>(ServiceIdentifiers.ScriptExecutor),
            c.resolve<IEnvironmentConfigService>(ServiceIdentifiers.EnvironmentConfig),
            c.resolve<IRequestPreparer>(ServiceIdentifiers.RequestPreparer),
            '', // environment will be set per-run
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            c.resolve<IWebSocketClient>(ServiceIdentifiers.WebSocketClient),
            c.resolve<ISocketIoClient>(ServiceIdentifiers.SocketIoClient)
        )
    );

    // ========================================
    // Persistent Cookie Jar
    // ========================================

    container.registerSingleton<ICookieJar>(
        ServiceIdentifiers.PersistentCookieJar,
        (c) => new PersistentCookieJar(c.resolve<IAsyncCookieService>(ServiceIdentifiers.Cookie))
    );

    // ========================================
    // OpenAPI Services
    // ========================================

    container.registerSingleton<ISchemaInferrer>(
        ServiceIdentifiers.SchemaInferrer,
        () => new SchemaInferrer()
    );

    container.registerSingleton<HistoryAnalyzer>(
        ServiceIdentifiers.HistoryAnalyzer,
        (c) => new HistoryAnalyzer(
            c.resolve<IRequestHistoryService>(ServiceIdentifiers.RequestHistory),
            c.resolve<SchemaInferrer>(ServiceIdentifiers.SchemaInferrer)
        )
    );

    container.registerSingleton<ScriptAnalyzer>(
        ServiceIdentifiers.ScriptAnalyzer,
        () => new ScriptAnalyzer()
    );

    container.registerSingleton<ISchemaInferenceService>(
        ServiceIdentifiers.SchemaInferenceService,
        (c) => new SchemaInferenceService(
            c.resolve<HistoryAnalyzer>(ServiceIdentifiers.HistoryAnalyzer),
            c.resolve<ScriptAnalyzer>(ServiceIdentifiers.ScriptAnalyzer),
            c.resolve<SchemaInferrer>(ServiceIdentifiers.SchemaInferrer)
        )
    );

    container.registerSingleton<IOpenApiExporter>(
        ServiceIdentifiers.OpenApiExporter,
        (c) => new OpenApiExporter(
            c.resolve<ICollectionService>(ServiceIdentifiers.Collection),
            c.resolve<IEnvironmentConfigService>(ServiceIdentifiers.EnvironmentConfig),
            c.resolve<SchemaInferenceService>(ServiceIdentifiers.SchemaInferenceService)
        )
    );

    container.registerSingleton<IOpenApiImporter>(
        ServiceIdentifiers.OpenApiImporter,
        (c) => new OpenApiImporter(
            c.resolve<ICollectionService>(ServiceIdentifiers.Collection),
            c.resolve<IEnvironmentConfigService>(ServiceIdentifiers.EnvironmentConfig)
        )
    );
}
