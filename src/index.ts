/**
 * @http-forge/core
 * 
 * Lightweight, VS Code-independent HTTP API testing engine.
 * This package is the single source of truth for HTTP Forge execution logic.
 * 
 * @example
 * ```typescript
 * import { ForgeContainer } from '@http-forge/core';
 * 
 * const forge = new ForgeContainer();
 * const collection = await forge.loadCollection('./api.forge.json');
 * const result = await forge.execute(collection.items[0], collection);
 * 
 * console.log(result.response.status);
 * console.log(result.postResponseResult?.assertions);
 * ```
 */

// ============================================================
// Main container (recommended entry point)
// ============================================================
export { ForgeContainer } from './container';
export type { ForgeContainerOptions, StorageFormat } from './container';

// ============================================================
// Dependency Injection
// ============================================================
export {
    getServiceContainer, registerCoreServices, ServiceContainer, ServiceIdentifiers
} from './di';
export type { PlatformAdapters, ServiceIdentifier } from './di';

// ============================================================
// Runtime - Embeddable MCP and Direct Execution APIs
// ============================================================
export { countRequests, decodeFolderPath, encodeFolderName, enumerateFolders, flattenRequests, normalizeFolderInput } from './runtime/mcp-collection-utils';
export type { FlatRequest } from './runtime/mcp-collection-utils';
export { applyMcpBodyTruncation, CACHE_BUSTING_TOOLS, dispatchGenericTool } from './runtime/mcp-dispatcher';
export type { McpDispatchServices, McpRunCallbacks } from './runtime/mcp-dispatcher';
export { buildPromptResult, MCP_PROMPTS } from './runtime/mcp-prompts';
export type { McpPromptArg, McpPromptDef, PromptResult } from './runtime/mcp-prompts';
export { McpRunStore } from './runtime/mcp-run-store';
export type { McpRunRecord } from './runtime/mcp-run-store';
export { buildMcpToolList, decodeCursor, encodeCursor } from './runtime/mcp-tool-builder';
export type { McpTool } from './runtime/mcp-tool-builder';
export {
    buildCollectionToolDescription,
    buildCollectionToolName,
    buildFolderToolDescription,
    buildFolderToolName,
    buildRequestToolDescription,
    buildRequestToolName,
    buildSuiteToolDescription,
    buildSuiteToolName,
    parseMcpToolName,
    resolveFolderToken,
    resolveToken
} from './runtime/mcp-tool-name';
export type { McpToolKind, ParsedMcpToolName } from './runtime/mcp-tool-name';
export {
    buildGenericTools, COLLECTION_INPUT_SCHEMA,
    FOLDER_INPUT_SCHEMA,
    GENERIC_TOOL_NAMES,
    REQUEST_INPUT_SCHEMA,
    SUITE_INPUT_SCHEMA
} from './runtime/mcp-tool-schemas';
export type { GenericToolName } from './runtime/mcp-tool-schemas';
export { resolveResultGrouping } from './runtime/result-grouping';
export {
    createMcpRuntime, runCollection, runFolder, runRequest, runSuite
} from './runtime/runtime-contracts';
export type { McpRuntimeHandle, McpRuntimeOptions, RunCollectionOptions, RunRequestOptions, RunSuiteOptions } from './runtime/runtime-contracts';

// ============================================================
// Runtime - Node.js Bootstrap and Adapters
// ============================================================
export {
    createNodeContainer
} from './runtime/node-bootstrap';

// ============================================================
// Types - Core data types and platform abstractions
// ============================================================
export * from './types/console-service';
export * from './types/platform';
export * from './types/types';

// ============================================================
// Cookie - Cookie management
// ============================================================
export { CookieJar } from './infrastructure/cookie/cookie-jar';
export { CookieService } from './infrastructure/cookie/cookie-service';
export { CookieUtils } from './infrastructure/cookie/cookie-utils';
export { InMemoryCookieJar } from './infrastructure/cookie/in-memory-cookie-jar';
export * from './infrastructure/cookie/interfaces';
export { PersistentCookieJar } from './infrastructure/cookie/persistent-cookie-jar';

// ============================================================
// HTTP - HTTP clients, interceptors, URL building
// ============================================================
export { FetchHttpClient } from './infrastructure/http/fetch-http-client';
export { HttpRequestService } from './infrastructure/http/http-request-service';
export { InterceptorChain } from './infrastructure/http/interceptor-chain';
export type {
    IErrorInterceptor,
    IInterceptorChain, IInterceptorExecutor, IInterceptorRegistry,
    InterceptorContext, IRequestInterceptor,
    IResponseInterceptor
} from './infrastructure/http/interceptor-chain';
export type { IHttpRequestService } from './infrastructure/http/interfaces';
export { DEFAULT_REQUEST_SETTINGS, NodeHttpClient } from './infrastructure/http/native-http-client';
export { RequestPreprocessor } from './infrastructure/http/request-preprocessor';
export type { IRequestPreprocessor } from './infrastructure/http/request-preprocessor';
export { UrlBuilder } from './infrastructure/http/url-builder';
export type { IUrlBuilder } from './infrastructure/http/url-builder';

// ============================================================
// Script - VM-based script execution
// ============================================================
export * from './infrastructure/script/interfaces';
export { createModuleLoader, createMomentShim, ModuleLoader } from './infrastructure/script/module-loader';
export type { ModuleLoaderOptions } from './infrastructure/script/module-loader';
export { RequestScriptSession } from './infrastructure/script/request-script-session';
export type { SessionDependencies } from './infrastructure/script/request-script-session';
export { ScriptExecutor } from './infrastructure/script/script-executor';
export { createExpectChain, createResponseObject } from './infrastructure/script/script-factories';
export type { ExpectChain, ResponseAssertions, ScriptResponse } from './infrastructure/script/script-factories';
export {
    concatenateScripts, createTestFunction,
    formatConsoleOutput, hasChanged, normalizeHeaders
} from './infrastructure/script/script-utils';
export type { ConsoleMessage } from './infrastructure/script/script-utils';
export { applyExtractionPlan, buildExtractionPlan, redactFullResponse, redactFullResultDetails, redactHeaders, redactHistoryEntry } from './infrastructure/security/sensitive-data-redactor';
export type { SensitiveExtraction } from './infrastructure/security/sensitive-data-redactor';
export { getSecretValues } from './infrastructure/security/secret-values';

// ============================================================
// Collection - CRUD, loading, storage, parsing
// ============================================================
export { CollectionLoader } from './infrastructure/collection/collection-loader';
export type { LoadOptions } from './infrastructure/collection/collection-loader';
export { CollectionLoaderFactory } from './infrastructure/collection/collection-loader-factory';
export { CollectionService } from './infrastructure/collection/collection-service';
export { FolderCollectionLoader } from './infrastructure/collection/folder-collection-loader';
export { FolderCollectionStore } from './infrastructure/collection/folder-collection-store';
export {
    AGENTS_MD_BACKUP_FILENAME,
    AGENTS_MD_FILENAME,
    AGENTS_MD_VERSION,
    buildAgentsMdContent,
    ensureAgentsMdFile,
    getAgentsMdPath,
    getAgentsMdStatus,
    readAgentsMdVersion,
    refreshAgentsMd,
} from './infrastructure/collection/agents-md';
export type { AgentsMdRefreshResult, AgentsMdStatus } from './infrastructure/collection/agents-md';
export * from './infrastructure/collection/folder-io';
export { ParserRegistry } from './infrastructure/collection/parser-registry';
// Collection interfaces now in src/types/collection.ts
export { JsonCollectionLoader } from './infrastructure/collection/json-collection-loader';
export type { Collection, CollectionFolderItem, CollectionItem, CollectionRequestItem, ICollectionService } from './types/collection';

// ============================================================
// Parsers - Format parsers (curl, HTTP Forge, …)
// ============================================================
export { parseCurlCommand } from './infrastructure/parsers/curl-parser';
export type { ParsedCurlRequest } from './infrastructure/parsers/curl-parser';

// ============================================================
// AI - Provider interface and collection enhancement
// ============================================================
export {
    assembleBusinessContext,
    buildCollectionBusinessContext,
    buildRequestBusinessContext,
    buildRunResultsContext,
    clearRegisteredKnowledgeSources,
    collectionKnowledgeSource,
    createDefaultKnowledgeSources,
    gatherWorkspaceKnowledge,
    getRegisteredKnowledgeSources,
    registerKnowledgeSource,
    requestKnowledgeSource,
    runResultsKnowledgeSource,
    workspaceKnowledgeSource
} from './infrastructure/ai/ai-context';
export type {
    ApiKnowledgeKind,
    ApiKnowledgeSnapshot,
    ApiKnowledgeSource,
    AssembleContextOptions
} from './infrastructure/ai/ai-context';
export type { IAiProvider } from './infrastructure/ai/ai-provider';
export { extractJsonFromLlm, withAiRetry } from './infrastructure/ai/ai-utils';
export type { AiRetryOptions } from './infrastructure/ai/ai-utils';
export { AnthropicProvider, createEnvAiProvider, OpenAiProvider } from './infrastructure/ai/http-providers';
export { enhanceCollection } from './infrastructure/analysis/collection-enhancer';
export type { EnhanceProgressCallback } from './infrastructure/analysis/collection-enhancer';

// ============================================================
// Analysis - Collection analysis tools (env suggestion, …)
// ============================================================
export { scanCollectionForEnvVarsWithAi } from './infrastructure/analysis/ai-env-suggester';
export { applyEnvSuggestionsToItems, detectEnvSuggestions } from './infrastructure/analysis/env-suggester';
export type { EnvSuggestion } from './infrastructure/analysis/env-suggester';

// ============================================================
// QA - One-shot discover → generate → run → report quality gate
// ============================================================
export { runQaCheck, qaEndpointKey } from './infrastructure/qa/qa-service';
export type {
    QaCheckOptions,
    QaCheckReport,
    QaCheckServices,
    QaCheckStatus,
    QaEndpointResult,
} from './infrastructure/qa/qa-service';
export { renderQaReportTable } from './infrastructure/qa/qa-report';

// Reference resolution (id/slug/name) for run APIs
export { resolveCollectionRef, resolveFolderRef, resolveRequestRef } from './runtime/ref-resolver';
export type { RefCandidate, RefKind, RefTier, ResolutionInfo } from './runtime/ref-resolver';

// ============================================================
// Environment - Variables, resolution, interpolation
// ============================================================
export { EnvironmentConfigService } from './infrastructure/environment/environment-config-service';
export { isSystemEnvironmentFile, loadEnvironmentsFromFolder } from './infrastructure/environment/environment-file-loader';
export type { EnvironmentEntry, EnvironmentFolderData } from './infrastructure/environment/environment-file-loader';
export { EnvironmentResolver } from './infrastructure/environment/environment-resolver';
export type { Environment, EnvironmentStoreConfig } from './infrastructure/environment/environment-resolver';
export { ForgeEnv } from './infrastructure/environment/forge-env';
export type { IForgeEnv } from './infrastructure/environment/forge-env';
// Environment interfaces now in src/types/environment-config.ts
export { VariableInterpolator, VariableResolver } from './infrastructure/environment/variable-interpolator';
export type { VariableResolverConfig } from './infrastructure/environment/variable-interpolator';
export type { IEnvironmentConfigService, LocalConfig, ResolvedEnvironment, SharedConfig } from './types/environment-config';

// ============================================================
// Execution - Request execution pipeline
// ============================================================
export { CollectionRequestExecutor } from './infrastructure/execution/collection-request-executor';
export * from './infrastructure/execution/collection-request-executor-interfaces';
export { RequestExecutor } from './infrastructure/execution/request-executor';
export type { ExecuteOptions, ExecuteResult } from './infrastructure/execution/request-executor';
export { RequestPreparer } from './infrastructure/execution/request-preparer';
export * from './infrastructure/execution/request-preparer-interfaces';

// ============================================================
// WebSocket - Connection transport
// ============================================================
export { NodeWebSocketClient } from './infrastructure/websocket/node-websocket-client';
export type { NodeWebSocketClientOptions } from './infrastructure/websocket/node-websocket-client';
export { NodeSocketIoClient, SocketIoClientAdapter } from './infrastructure/websocket/node-socketio-client';
export type { SocketIoConnectOptions, SocketIoEvent, ISocketIoConnection, ISocketIoClient } from './types/platform';

// ============================================================
// History - Request history (in-memory + file-based)
// ============================================================
export * from './infrastructure/history/history-interfaces';
export { RequestHistoryStore } from './infrastructure/history/request-history';
export { RequestHistoryService } from './infrastructure/history/request-history-service';
export type { IRequestHistoryService, IResponseStorage } from './infrastructure/history/request-history-service-interfaces';

// ============================================================
// Auth - OAuth2 token management
// ============================================================
export * from './infrastructure/auth/interfaces';
export { OAuth2TokenManager } from './infrastructure/auth/oauth2-token-manager';

// ============================================================
// GraphQL - Schema introspection & completion
// ============================================================
export { getCompletions, parseQueryContext } from './infrastructure/graphql/graphql-completion-provider';
export type { CompletionItem, ContextType, QueryContext } from './infrastructure/graphql/graphql-completion-provider';
export { GraphQLSchemaService } from './infrastructure/graphql/graphql-schema-service';
export type {
    GraphQLDirective, GraphQLField, GraphQLOperation, GraphQLSchema,
    GraphQLType, IGraphQLSchemaService
} from './infrastructure/graphql/graphql-schema-service';

// ============================================================
// OpenAPI - Import/export/inference
// ============================================================
export {
    ExampleGenerator, HistoryAnalyzer, OpenApiExporter,
    OpenApiImporter, RefResolver, SchemaInferenceService, SchemaInferrer, ScriptAnalyzer
} from './infrastructure/openapi';
export type { OpenApiExportOptions, OpenApiImportOptions, ScriptAnalysisResult } from './infrastructure/openapi';
export * from './infrastructure/openapi/interfaces';

// ============================================================
// API Architect - Intent-driven API design (plan Phase 4 / Layer 8)
// ============================================================
export * from './infrastructure/architect';

// ============================================================
// API Discovery - Source-code discovery (plan Phase 1)
// ============================================================
export * from './infrastructure/api-discovery/analyzer';
export {
    buildDescription,
    endpointToCreateRequestOptions,
    endpointToName,
    endpointToRequestParts,
    schemaToExample,
} from './infrastructure/api-discovery/endpoint-to-request';
export {
    ApiDiscoveryService
} from './infrastructure/api-discovery/api-discovery-service';
export type {
    ApiDiscoveryServiceOptions, IApiDiscoveryService
} from './infrastructure/api-discovery/api-discovery-service';
export {
    applyRegenerated,
    computeProjectFreshness,
    detectIndexDrift,
    detectProjectDrift,
    diffLines,
    proposeSuiteUpdates,
    resolveRegenerated,
    threeWayDiff
} from './infrastructure/api-discovery/drift-engine';
export type {
    DiffHunk,
    DiffLineType,
    DriftReport,
    DriftStatus,
    GeneratedSuite,
    ProjectDrift,
    ProjectFreshness,
    SuiteUpdateProposal,
    ThreeWayDiff
} from './infrastructure/api-discovery/drift-engine';
export { FastApiDiscoveryProvider } from './infrastructure/api-discovery/fastapi/fastapi-discovery-provider';
export { FrameworkDetector } from './infrastructure/api-discovery/framework-detector';
export { resolveProjectName } from './infrastructure/api-discovery/project-name';
export type { ApiDiscoveryProvider, ProviderSupport } from './infrastructure/api-discovery/provider';
export { ExpressDiscoveryProvider } from './infrastructure/api-discovery/providers/express-discovery-provider';
export { FastifyDiscoveryProvider } from './infrastructure/api-discovery/providers/fastify-discovery-provider';
export { LambdaDiscoveryProvider } from './infrastructure/api-discovery/providers/lambda-discovery-provider';
export { NestDiscoveryProvider } from './infrastructure/api-discovery/providers/nest-discovery-provider';
export { loadHybridSeedEndpoints } from './infrastructure/api-discovery/seed-loader';
export { collectSourceFiles } from './infrastructure/api-discovery/source-files';
export { SpringDiscoveryProvider } from './infrastructure/api-discovery/spring/spring-discovery-provider';
export {
    generateFlowFromEndpoints, generateSuiteFromEndpoints,
    suiteIdFromName
} from './infrastructure/api-discovery/test-generator';
export type {
    GenerateFlowOptions, GenerateSuiteOptions,
    GenerateSuiteResult
} from './infrastructure/api-discovery/test-generator';
export * from './infrastructure/api-discovery/types';
export {
    discoverWorkflows
} from './infrastructure/api-discovery/workflow-discovery';
export type {
    WorkflowChain, WorkflowDependent, WorkflowDiscoveryOptions, WorkflowProducer
} from './infrastructure/api-discovery/workflow-discovery';

// ============================================================
// Review - deterministic review gate (Phase 3, Layer 7)
// ============================================================
export { reviewSuiteRun, toReviewRequestResults } from './infrastructure/review';
export type {
    ReviewFinding,
    ReviewOptions,
    ReviewReport,
    ReviewRequestResult,
    ReviewSeverity
} from './infrastructure/review';

// ============================================================
// Docs - release notes as a byproduct of drift (Phase 3, Layer 6)
// ============================================================
export { generateReleaseNotes, renderReleaseNotesMarkdown } from './infrastructure/docs';
export type {
    ReleaseNoteEntry,
    ReleaseNotes,
    ReleaseNotesOptions,
    ReleaseNoteType
} from './infrastructure/docs';

// ============================================================
// Config - Configuration service
// ============================================================
export { CONFIG_FILES, ConfigService, DEFAULT_CONFIG, ROOT_DIRECTORIES } from './infrastructure/config';
export type {
    DiscoveryConfig, EnvironmentsConfig, HttpForgeConfig, IConfigService,
    McpConfig, McpCorsConfig, McpToolMode,
    ProxyConfig, RequestConfig, RestClientExportConfig,
    RunnerConfig, ScriptsConfig, StorageConfig
} from './infrastructure/config';

// ============================================================
// Test Suite - Test suite management
// ============================================================
export { HtmlReportGenerator } from './infrastructure/test-suite/html-report-generator';
export type {
    ErrorSummary, IStatisticsService, ITestSuiteService,
    RequestStatistics, RunStatistics, RunSummary, SuiteBlockNode, SuiteConfig, SuiteElseIfBranch, SuiteFlowNode, SuiteFlowNodeBase, SuiteForNode, SuiteIfNode, SuiteRequest, SuiteRequestNode, SuiteScriptNode, SuiteSwitchCase, SuiteSwitchNode, SuiteWhileNode,
    TestSuite
} from './infrastructure/test-suite/interfaces';
export { JUnitReportGenerator } from './infrastructure/test-suite/junit-report-generator';
export { buildResultFileName, HTTP_METHOD_MAP, HTTP_METHOD_REVERSE } from './infrastructure/test-suite/result-storage';
export type {
    FullResultDetails, IndexPage, IResultStorageService, RecentError,
    RequestStats, ResultSummary, RunConfig, RunManifest, RunStats
} from './infrastructure/test-suite/result-storage';
export { ResultStorageService } from './infrastructure/test-suite/result-storage-service';
export { StatisticsService } from './infrastructure/test-suite/statistics-service';
export { TestSuiteService } from './infrastructure/test-suite/test-suite-service';
export type { SuitesChangedCallback } from './infrastructure/test-suite/test-suite-service';
export { TestSuiteStore } from './infrastructure/test-suite/test-suite-store';
export type { ITestSuiteStore, SuiteRequestEntry } from './infrastructure/test-suite/test-suite-store';

// ============================================================
// Parsers - Collection format parsers
// ============================================================
export { harToCollection, HttpForgeParser, parseHar } from './infrastructure/parsers';
export type { HarImportOptions, HarJsonBody, ParsedHarRequest } from './infrastructure/parsers';

// ============================================================
// Import/Export - Format conversion utilities
// ============================================================
export { parsePostmanEnvironment } from './infrastructure/import-export/import-postman-environment';
export type { ImportedEnvironment } from './infrastructure/import-export/import-postman-environment';
export {
    exportCollectionToRestClient,
    writeEnvFile, writeFolderItems, writeScriptFile
} from './infrastructure/import-export/rest-client-export';

// ============================================================
// Platform - Node.js implementations
// ============================================================
export { DataFileParser } from './infrastructure/platform/data-file-parser';
export type { IDataFileParser } from './infrastructure/platform/data-file-parser';
export { NodeFileSystem } from './infrastructure/platform/node-file-system';

// ============================================================
// Secrets - Phase 3 cloud secret resolver providers
// ============================================================
export { AwsSecretResolver } from './infrastructure/secrets/aws-secret-resolver';
export { AzureKeyVaultResolver } from './infrastructure/secrets/azure-keyvault-resolver';
export { DopplerResolver } from './infrastructure/secrets/doppler-resolver';
export { GcpSecretResolver } from './infrastructure/secrets/gcp-secret-resolver';
export { HashiCorpVaultResolver } from './infrastructure/secrets/hashicorp-vault-resolver';
export { OnePasswordResolver } from './infrastructure/secrets/onepassword-resolver';
export { SecretResolverRegistry } from './infrastructure/secrets/secret-resolver-registry';
export type {
    CustomSecretProviderConfig,
    CustomSecretProviderContext,
    CustomSecretResolver,
    CustomSecretResolverFactory,
    DopplerConfig,
    GcpSecretsConfig,
    ISecretResolver,
    SecretProviderConfig,
    SecretsConfig,
} from './types/secret-resolver';

// ============================================================
// Utils - Pure utility functions
// ============================================================
export { evaluateExpression, isExpression } from './utils/expression-evaluator';
export { applyFilterChain, parseFilterChain } from './utils/filter-engine';
export {
    generateId
} from './utils/helpers';
export { deserializeTypedRecord, deserializeTypedValue, serializeTypedValue } from './utils/typed-value';

