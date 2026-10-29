/**
 * Service Identifiers
 * 
 * Symbol-based identifiers for type-safe service resolution.
 * Used by ServiceContainer for dependency injection.
 */

export const ServiceIdentifiers = {
    // Core services
    Config: Symbol.for('IConfigService'),
    Console: Symbol.for('IConsoleService'),
    EnvironmentConfig: Symbol.for('IEnvironmentConfigService'),
    Collection: Symbol.for('ICollectionService'),
    HttpRequest: Symbol.for('IHttpRequestService'),
    HttpClient: Symbol.for('IHttpClient'),
    WebSocketClient: Symbol.for('IWebSocketClient'),
    SocketIoClient: Symbol.for('ISocketIoClient'),
    Cookie: Symbol.for('ICookieService'),
    RequestHistory: Symbol.for('IRequestHistoryService'),
    TestSuite: Symbol.for('ITestSuiteService'),

    // Utility services
    UrlBuilder: Symbol.for('IUrlBuilder'),
    RequestPreprocessor: Symbol.for('IRequestPreprocessor'),
    RequestPreparer: Symbol.for('IRequestPreparer'),
    InterceptorChain: Symbol.for('IInterceptorChain'),

    // Collection Runner services
    ScriptExecutor: Symbol.for('IScriptExecutor'),
    DataFileParser: Symbol.for('IDataFileParser'),
    CollectionRequestExecutor: Symbol.for('ICollectionRequestExecutor'),

    // Primitives
    WorkspaceFolder: Symbol.for('WorkspaceFolder'),

    // Cookie jar
    PersistentCookieJar: Symbol.for('PersistentCookieJar'),

    // Auth services
    OAuth2TokenManager: Symbol.for('IOAuth2TokenManager'),

    // GraphQL services
    GraphQLSchemaService: Symbol.for('IGraphQLSchemaService'),

    // OpenAPI services
    SchemaInferrer: Symbol.for('SchemaInferrer'),
    HistoryAnalyzer: Symbol.for('HistoryAnalyzer'),
    ScriptAnalyzer: Symbol.for('ScriptAnalyzer'),
    SchemaInferenceService: Symbol.for('SchemaInferenceService'),
    OpenApiExporter: Symbol.for('OpenApiExporter'),
    OpenApiImporter: Symbol.for('OpenApiImporter'),

    // Phase 3 — Cloud secret resolvers
    SecretResolverRegistry: Symbol.for('SecretResolverRegistry'),
} as const;

export type ServiceIdentifier = typeof ServiceIdentifiers[keyof typeof ServiceIdentifiers] | string;
