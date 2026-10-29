/**
 * Service Container
 * 
 * Generic dependency injection container.
 * Platform-agnostic — no VS Code dependencies.
 * 
 * Principles:
 * - Dependency Inversion: Services accessed through interfaces
 * - Single Responsibility: Container only manages service lifecycle
 * - Open/Closed: New services registered without modifying existing code
 */

import type { IAsyncCookieService } from '../infrastructure/cookie/interfaces';
import type { IRequestPreparer } from '../infrastructure/execution/request-preparer-interfaces';
import type { IRequestHistoryService } from '../infrastructure/history/request-history-service-interfaces';
import type { IHttpRequestService } from '../infrastructure/http/interfaces';
import type { IScriptExecutor } from '../infrastructure/script/interfaces';
import type { IConsoleService } from '../types/console-service';
import type {
    IHttpClient,
    IWebSocketClient,
    ISocketIoClient
} from '../types/platform';
import { ServiceIdentifiers } from './service-identifiers';
import type { ServiceIdentifier } from './service-identifiers';

// Re-import interface types used by typed accessors
import type { IOAuth2TokenManager } from '../infrastructure/auth/interfaces';
import type { IConfigService } from '../infrastructure/config';
import type { IGraphQLSchemaService } from '../infrastructure/graphql/graphql-schema-service';
import type { IDataFileParser } from '../infrastructure/platform/data-file-parser';
import type { ICookieJar } from '../infrastructure/script/interfaces';
import type { ITestSuiteService } from '../infrastructure/test-suite/interfaces';
import type { ICollectionService } from '../types/collection';
import type { IEnvironmentConfigService } from '../types/environment-config';

/**
 * Factory function type for creating services
 */
type ServiceFactory<T> = (container: ServiceContainer) => T;

/**
 * Service registration
 */
interface ServiceRegistration<T> {
    factory: ServiceFactory<T>;
    singleton: boolean;
    instance?: T;
}

/**
 * Service Container implementation
 * Provides dependency injection capabilities
 */
export class ServiceContainer {
    private static _instance: ServiceContainer | undefined;
    private services: Map<ServiceIdentifier, ServiceRegistration<any>> = new Map();
    private primitives: Map<ServiceIdentifier, any> = new Map();

    private constructor() {}

    /**
     * Get the singleton instance
     */
    public static get instance(): ServiceContainer {
        if (!ServiceContainer._instance) {
            ServiceContainer._instance = new ServiceContainer();
        }
        return ServiceContainer._instance;
    }

    /**
     * Create a fresh isolated container instance that is NOT the global singleton.
     * Use this for short-lived, per-operation containers (e.g. MCP tool execution)
     * to avoid touching the singleton registered by the host application (VS Code extension).
     */
    public static createFresh(): ServiceContainer {
        return new ServiceContainer();
    }

    /**
     * Reset the container (useful for testing)
     */
    public static reset(): void {
        if (ServiceContainer._instance) {
            ServiceContainer._instance.clear();
        }
        ServiceContainer._instance = undefined;
    }

    /**
     * Register a primitive value (like workspace folder path)
     */
    public registerValue<T>(identifier: ServiceIdentifier, value: T): this {
        this.primitives.set(identifier, value);
        return this;
    }

    /**
     * Register a service factory as a singleton
     * The service will be created on first resolution and reused
     */
    public registerSingleton<T>(
        identifier: ServiceIdentifier,
        factory: ServiceFactory<T>
    ): this {
        this.services.set(identifier, { factory, singleton: true });
        return this;
    }

    /**
     * Register a service factory as transient
     * A new instance will be created on each resolution
     */
    public registerTransient<T>(
        identifier: ServiceIdentifier,
        factory: ServiceFactory<T>
    ): this {
        this.services.set(identifier, { factory, singleton: false });
        return this;
    }

    /**
     * Register an already instantiated service
     */
    public registerInstance<T>(identifier: ServiceIdentifier, instance: T): this {
        this.services.set(identifier, {
            factory: () => instance,
            singleton: true,
            instance
        });
        return this;
    }

    /**
     * Resolve a service by its identifier
     */
    public resolve<T>(identifier: ServiceIdentifier): T {
        // Check primitives first
        if (this.primitives.has(identifier)) {
            return this.primitives.get(identifier) as T;
        }

        const registration = this.services.get(identifier);
        if (!registration) {
            throw new Error(`Service not registered: ${identifier.toString()}`);
        }

        if (registration.singleton) {
            if (!registration.instance) {
                registration.instance = registration.factory(this);
            }
            return registration.instance as T;
        }

        return registration.factory(this) as T;
    }

    /**
     * Check if a service is registered
     */
    public has(identifier: ServiceIdentifier): boolean {
        return this.services.has(identifier) || this.primitives.has(identifier);
    }

    /**
     * Dispose all singleton instances that implement a dispose() method,
     * then clear all registrations. Call this when the container is no longer
     * needed (e.g. at the end of a CLI command) so that file watchers and other
     * I/O handles are closed and the Node.js event loop can exit naturally.
     */
    public dispose(): void {
        for (const registration of this.services.values()) {
            if (registration.singleton && registration.instance) {
                const inst = registration.instance as any;
                if (typeof inst.dispose === 'function') {
                    try { inst.dispose(); } catch { /* best-effort */ }
                }
            }
        }
        this.clear();
    }

    /**
     * Clear all registrations
     */
    public clear(): void {
        this.services.clear();
        this.primitives.clear();
    }

    // ========================================
    // Typed accessor methods
    // ========================================

    public get config(): IConfigService {
        return this.resolve<IConfigService>(ServiceIdentifiers.Config);
    }

    public get console(): IConsoleService {
        return this.resolve<IConsoleService>(ServiceIdentifiers.Console);
    }

    public get environmentConfig(): IEnvironmentConfigService {
        return this.resolve<IEnvironmentConfigService>(ServiceIdentifiers.EnvironmentConfig);
    }

    public get collection(): ICollectionService {
        return this.resolve<ICollectionService>(ServiceIdentifiers.Collection);
    }

    public get httpRequest(): IHttpRequestService {
        return this.resolve<IHttpRequestService>(ServiceIdentifiers.HttpRequest);
    }

    public get httpClient(): IHttpClient {
        return this.resolve<IHttpClient>(ServiceIdentifiers.HttpClient);
    }

    public get webSocketClient(): IWebSocketClient {
        return this.resolve<IWebSocketClient>(ServiceIdentifiers.WebSocketClient);
    }

    public get socketIoClient(): ISocketIoClient {
        return this.resolve<ISocketIoClient>(ServiceIdentifiers.SocketIoClient);
    }

    public get cookie(): IAsyncCookieService {
        return this.resolve<IAsyncCookieService>(ServiceIdentifiers.Cookie);
    }

    public get requestHistory(): IRequestHistoryService {
        return this.resolve<IRequestHistoryService>(ServiceIdentifiers.RequestHistory);
    }

    public get dataFileParser(): IDataFileParser {
        return this.resolve<IDataFileParser>(ServiceIdentifiers.DataFileParser);
    }

    public get scriptExecutor(): IScriptExecutor {
        return this.resolve<IScriptExecutor>(ServiceIdentifiers.ScriptExecutor);
    }

    public get requestPreparer(): IRequestPreparer {
        return this.resolve<IRequestPreparer>(ServiceIdentifiers.RequestPreparer);
    }

    public get persistentCookieJar(): ICookieJar {
        return this.resolve<ICookieJar>(ServiceIdentifiers.PersistentCookieJar);
    }

    public get oauth2TokenManager(): IOAuth2TokenManager | undefined {
        return this.has(ServiceIdentifiers.OAuth2TokenManager)
            ? this.resolve<IOAuth2TokenManager>(ServiceIdentifiers.OAuth2TokenManager)
            : undefined;
    }

    public get graphqlSchemaService(): IGraphQLSchemaService {
        return this.resolve<IGraphQLSchemaService>(ServiceIdentifiers.GraphQLSchemaService);
    }

    public get testSuite(): ITestSuiteService {
        return this.resolve<ITestSuiteService>(ServiceIdentifiers.TestSuite);
    }
}

/**
 * Convenience function to get the service container instance
 */
export function getServiceContainer(): ServiceContainer {
    return ServiceContainer.instance;
}
