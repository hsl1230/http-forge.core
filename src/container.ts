/**
 * Forge Container - Dependency Injection Container
 * 
 * ⚠️ @deprecated 此类用于向后兼容
 * 新代码应使用 infrastructure/di/complete-bootstrap 中的 bootstrapComplete() 函数
 * 
 * 向后兼容层:
 * 此文件继续提供原有的 ForgeContainer 接口
 * 内部实现现已迁移至三层架构 (Domain/Application/Infrastructure)
 * 
 * 迁移指南:
 * 旧代码:
 *   const container = new ForgeContainer(config);
 * 
 * 新代码:
 *   import { ServiceContainer } from '@http-forge/core/di';
 *   import { bootstrapComplete } from '@http-forge/core/infrastructure/di';
 *   
 *   const container = new ServiceContainer();
 *   bootstrapComplete(container, { useFileSystem: true });
 * 
 * Single Responsibility: Wire up all components with proper dependencies
 * Factory Pattern: Creates configured instances of services
 */

import { CollectionLoader } from './infrastructure/collection/collection-loader';
import { FolderCollectionLoader } from './infrastructure/collection/folder-collection-loader';
import { ParserRegistry } from './infrastructure/collection/parser-registry';
import {
    CookieJar
} from './infrastructure/cookie/cookie-jar';
import { ICookieService } from './infrastructure/cookie/interfaces';
import { loadEnvironmentsFromFolder } from './infrastructure/environment/environment-file-loader';
import { EnvironmentResolver, EnvironmentStoreConfig } from './infrastructure/environment/environment-resolver';
import { ForgeEnv } from './infrastructure/environment/forge-env';
import { VariableInterpolator } from './infrastructure/environment/variable-interpolator';
import { RequestExecutor } from './infrastructure/execution/request-executor';
import { IRequestHistory } from './infrastructure/history/history-interfaces';
import { RequestHistoryStore } from './infrastructure/history/request-history';
import {
    FetchHttpClient
} from './infrastructure/http/fetch-http-client';
import { HttpRequestService } from './infrastructure/http/http-request-service';
import {
    IErrorInterceptor,
    IInterceptorChain,
    InterceptorChain,
    IRequestInterceptor,
    IResponseInterceptor
} from './infrastructure/http/interceptor-chain';
import { IHttpRequestService } from './infrastructure/http/interfaces';
import { NodeHttpClient } from './infrastructure/http/native-http-client';
import { IRequestPreprocessor, RequestPreprocessor } from './infrastructure/http/request-preprocessor';
import { UrlBuilder } from './infrastructure/http/url-builder';
import { HttpForgeParser } from './infrastructure/parsers/http-forge-parser';
import {
    DataFileParser, IDataFileParser
} from './infrastructure/platform/data-file-parser';
import { NodeFileSystem } from './infrastructure/platform/node-file-system';
import { IScriptExecutor } from './infrastructure/script/interfaces';
import { ScriptExecutor } from './infrastructure/script/script-executor';
import { IVariableInterpolator } from './types/environment-config';
import { IFileSystem, IHttpClient } from './types/platform';
import { HttpRequest, HttpResponse, RequestSettings, UnifiedCollection, UnifiedRequest } from './types/types';

/**
 * Container configuration options
 */
/**
 * Storage format for collections
 */
export type StorageFormat = 'file' | 'folder';

export interface ForgeContainerOptions {
    /** Path to http-forge folder (enables custom modules from modules/ folder) */
    forgeRoot?: string;
    
    /** Storage format: 'file' for single JSON files, 'folder' for directory structure (default: 'folder') */
    storageFormat?: StorageFormat;
    
    // === HTTP Settings ===
    /** Use native http/https instead of fetch (recommended for full control) */
    useNativeHttp?: boolean;
    /** Custom HTTP client implementation (overrides useNativeHttp) */
    httpClient?: IHttpClient;
    /** Default HTTP request settings */
    httpSettings?: Partial<RequestSettings>;
    /** HTTP request timeout (ms) - shorthand for httpSettings.timeout */
    requestTimeout?: number;
    
    // === Cookie Settings ===
    /** Enable cookie jar for automatic cookie management */
    enableCookies?: boolean;
    /** Custom cookie jar implementation */
    cookieJar?: ICookieService;
    
    // === Interceptor Settings ===
    /** Request interceptors to register */
    requestInterceptors?: IRequestInterceptor[];
    /** Response interceptors to register */
    responseInterceptors?: IResponseInterceptor[];
    /** Error interceptors to register */
    errorInterceptors?: IErrorInterceptor[];
    /** Custom interceptor chain (overrides individual interceptors) */
    interceptorChain?: IInterceptorChain;
    
    // === Script Settings ===
    /** Custom script executor implementation (vm-based, session architecture) */
    scriptExecutor?: IScriptExecutor;
    /** Script execution timeout (ms) */
    scriptTimeout?: number;
    /**
     * Script scope mode. 'shared' (default) runs all script levels in one scope;
     * 'isolated' runs each level in its own scope for Postman compatibility.
     */
    scriptScope?: 'shared' | 'isolated';
    
    // === Other Settings ===
    /** Custom file system implementation */
    fileSystem?: IFileSystem;
    /** Custom variable interpolator implementation */
    interpolator?: IVariableInterpolator;
    /** Custom request preprocessor implementation */
    preprocessor?: IRequestPreprocessor;
    /** Custom data file parser implementation */
    dataFileParser?: IDataFileParser;
    
    // === History Settings ===
    /** Enable request history recording */
    enableHistory?: boolean;
    /** Maximum history entries per request (default: 100) */
    maxHistoryEntries?: number;
    /** Custom request history implementation */
    requestHistory?: IRequestHistory;
    
    /** Environment configuration */
    environmentConfig?: EnvironmentStoreConfig;
}

/**
 * Forge Container - Main entry point for HTTP Forge Core
 * 
 * Usage:
 * ```typescript
 * const forge = new ForgeContainer();
 * const collection = await forge.loadCollection('./api.forge.json');
 * const result = await forge.execute(collection.items[0], collection);
 * ```
 */
export class ForgeContainer {
    // Core implementations
    readonly httpClient: IHttpClient;
    readonly fileSystem: IFileSystem;
    readonly scriptExecutor: IScriptExecutor;
    readonly interpolator: IVariableInterpolator;
    
    // New implementations from plugin
    readonly cookieJar: ICookieService;
    readonly interceptorChain: IInterceptorChain;
    readonly preprocessor: IRequestPreprocessor;
    readonly dataFileParser: IDataFileParser;
    readonly requestHistory: IRequestHistory | null;
    
    // Services
    readonly parserRegistry: ParserRegistry;
    readonly collectionLoader: import('./types/collection').ICollectionLoader;
    readonly environmentStore: EnvironmentResolver;
    readonly forgeEnv: ForgeEnv;
    readonly requestExecutor: RequestExecutor;
    
    // Configuration
    private readonly options: ForgeContainerOptions;
    
    constructor(options: ForgeContainerOptions = {}) {
        this.options = options;
        
        // Create or use provided implementations
        this.interpolator = options.interpolator || new VariableInterpolator();
        this.fileSystem = options.fileSystem || new NodeFileSystem();
        this.preprocessor = options.preprocessor || new RequestPreprocessor();
        this.dataFileParser = options.dataFileParser || new DataFileParser();
        
        // Cookie jar (memory-based, no persistence in core)
        this.cookieJar = options.cookieJar || new CookieJar();
        
        // Request history (optional, disabled by default)
        if (options.enableHistory) {
            this.requestHistory = options.requestHistory || new RequestHistoryStore({
                maxEntriesPerRequest: options.maxHistoryEntries ?? 100
            });
        } else {
            this.requestHistory = null;
        }
        
        // Interceptor chain
        this.interceptorChain = options.interceptorChain || this.createInterceptorChain(options);
        
        // HTTP client - prefer native http/https for full control
        if (options.httpClient) {
            this.httpClient = options.httpClient;
        } else if (options.useNativeHttp !== false) {
            // Default to native HTTP client (same as plugin)
            const httpSettings = {
                ...options.httpSettings,
                timeout: options.requestTimeout ?? options.httpSettings?.timeout
            };
            this.httpClient = new NodeHttpClient(httpSettings);
        } else {
            // Use fetch-based client if explicitly disabled
            this.httpClient = new FetchHttpClient();
        }
        
        // Script executor (vm-based, session architecture)
        const modulePaths = options.forgeRoot 
            ? [require('path').join(options.forgeRoot, 'modules')]
            : [];
        const httpRequestService: IHttpRequestService = new HttpRequestService(
            new UrlBuilder(),
            this.interceptorChain,
            this.httpClient
        );
        this.scriptExecutor = options.scriptExecutor || new ScriptExecutor(
            httpRequestService,
            modulePaths,
            undefined,
            options.scriptScope ?? 'shared',
            options.scriptTimeout ?? 5000
        );
        
        // Create parser registry and register default parsers
        this.parserRegistry = new ParserRegistry();
        this.parserRegistry.register('http-forge', new HttpForgeParser());
        
        // Create collection loader based on storage format
        const storageFormat = options.storageFormat ?? 'folder';  // default to folder format
        if (storageFormat === 'folder' && options.forgeRoot) {
            // Folder format: collections are directories under {forgeRoot}/collections/
            const collectionsDir = require('path').join(options.forgeRoot, 'collections');
            this.collectionLoader = new FolderCollectionLoader(collectionsDir);
        } else {
            // File format: collections are single JSON files
            this.collectionLoader = new CollectionLoader(this.fileSystem, this.parserRegistry);
        };
        
        // Create environment store
        this.environmentStore = options.environmentConfig
            ? new EnvironmentResolver(options.environmentConfig)
            : EnvironmentResolver.fromVariables({});
        
        // Create ForgeEnv (unified environment service)
        this.forgeEnv = ForgeEnv.fromResolver(this.environmentStore);
        
        // Create request executor (facade)
        this.requestExecutor = new RequestExecutor(
            this.httpClient,
            this.forgeEnv,
            this.cookieJar,  // Pass cookieJar for cookie support in scripts
            this.preprocessor,  // Pass preprocessor for auto Content-Type handling
            { forgeRoot: options.forgeRoot, scriptExecutor: this.scriptExecutor }
        );
    }
    
    /**
     * Create interceptor chain from options
     */
    private createInterceptorChain(options: ForgeContainerOptions): IInterceptorChain {
        const chain = new InterceptorChain();
        
        // Register provided interceptors
        if (options.requestInterceptors) {
            for (const interceptor of options.requestInterceptors) {
                chain.addRequestInterceptor(interceptor);
            }
        }
        
        if (options.responseInterceptors) {
            for (const interceptor of options.responseInterceptors) {
                chain.addResponseInterceptor(interceptor);
            }
        }
        
        if (options.errorInterceptors) {
            for (const interceptor of options.errorInterceptors) {
                chain.addErrorInterceptor(interceptor);
            }
        }
        
        return chain;
    }
    
    /**
     * Load a collection from file (only works with file storage format)
     * @deprecated Use loadAllCollections() for folder format
     */
    async loadCollection(filePath: string): Promise<UnifiedCollection> {
        if (this.collectionLoader instanceof CollectionLoader) {
            return this.collectionLoader.load(filePath);
        }
        throw new Error('loadCollection(filePath) is not supported with folder storage format. Use loadAllCollections() instead.');
    }
    
    /**
     * Load all collections from the configured storage
     * Works with both file and folder storage formats
     */
    async loadAllCollections(): Promise<UnifiedCollection[]> {
        return this.collectionLoader.loadAll();
    }
    
    /**
     * Execute a request with full pipeline
     */
    async execute(request: UnifiedRequest, collection: UnifiedCollection, options?: any) {
        return this.requestExecutor.execute(request, collection, options);
    }
    
    /**
     * Execute a simple HTTP request
     */
    async executeSimple(request: HttpRequest, options?: any): Promise<HttpResponse> {
        return this.requestExecutor.executeSimple(request, options);
    }
    
    /**
     * Register a custom collection parser
     */
    registerParser(format: string, parser: any) {
        this.parserRegistry.register(format, parser);
    }
    
    /**
     * Set environment configuration
     */
    setEnvironmentConfig(config: EnvironmentStoreConfig) {
        // Replace environment store
        (this as any).environmentStore = new EnvironmentResolver(config);
        // Recreate ForgeEnv with new store
        (this as any).forgeEnv = ForgeEnv.fromResolver(this.environmentStore);
        // Recreate request executor with new ForgeEnv
        (this as any).requestExecutor = new RequestExecutor(
            this.httpClient,
            this.forgeEnv,
            this.cookieJar,  // Pass cookieJar for cookie support in scripts
            this.preprocessor,  // Pass preprocessor for auto Content-Type handling
            { forgeRoot: this.options.forgeRoot, scriptExecutor: this.scriptExecutor }
        );
    }
    
    /**
     * Create a new container with custom options
     */
    static create(options?: ForgeContainerOptions): ForgeContainer {
        return new ForgeContainer(options);
    }

    /**
     * Create a container by auto-loading environments from forgeRoot
     * 
     * Reads the multi-file environment folder format under
     * `{forgeRoot}/environments/` (same format used by the VS Code extension).
     * Falls back to the legacy single-file `environments.json` when the
     * multi-file format is not detected.
     * 
     * @param forgeRoot - Path to http-forge folder (default: './http-forge')
     * @param options - Additional container options
     * 
     * @example
     * ```typescript
     * const forge = ForgeContainer.fromForgeRoot('./http-forge');
     * forge.forgeEnv.setActiveEnvironment('sit');
     * ```
     */
    static fromForgeRoot(
        forgeRoot: string = './http-forge',
        options: Omit<ForgeContainerOptions, 'forgeRoot' | 'environmentConfig'> = {}
    ): ForgeContainer {
        const path = require('path');
        const envDir = path.join(forgeRoot, 'environments');

        let environmentConfig: EnvironmentStoreConfig | undefined;

        // Try multi-file folder format first (canonical)
        const data = loadEnvironmentsFromFolder(envDir);
        const hasMultiFile = Object.keys(data.environments).length > 0
            || Object.keys(data.globalVariables).length > 0;

        if (hasMultiFile) {
            environmentConfig = {
                globalVariables: { ...data.globalVariables, ...data.localVariables },
                environments: {},
                selectedEnvironment: undefined,
            };
            for (const [name, entry] of Object.entries(data.environments)) {
                const localVars = data.localCredentials[name]?.variables || {};
                environmentConfig.environments[name] = {
                    name,
                    variables: { ...entry.variables, ...localVars },
                };
            }
        } else {
            // Fallback: legacy single-file environments.json
            const fs = require('fs');
            const environmentsFile = path.join(envDir, 'environments.json');
            if (fs.existsSync(environmentsFile)) {
                try {
                    const content = fs.readFileSync(environmentsFile, 'utf-8');
                    const config = JSON.parse(content);
                    environmentConfig = {
                        globalVariables: config.globalVariables || {},
                        environments: {},
                        selectedEnvironment: config.selectedEnvironment,
                    };
                    if (config.environments) {
                        for (const [name, env] of Object.entries(config.environments)) {
                            const envData = env as any;
                            environmentConfig.environments[name] = {
                                name: envData.name || name,
                                variables: envData.variables || {},
                            };
                        }
                    }
                } catch (e) {
                    console.warn(`[ForgeContainer] Failed to load environments from ${environmentsFile}:`, e);
                }
            }
        }

        return new ForgeContainer({
            ...options,
            forgeRoot,
            storageFormat: options.storageFormat ?? 'folder',
            environmentConfig,
        });
    }
}
