/**
 * @http-forge/core - Type Definitions
 * 
 * Core data types used throughout the framework.
 * Simplified design for maximum compatibility.
 */

import { ParsedCookie } from '../infrastructure/cookie/interfaces';
export type { ParsedCookie };

// ============================================================
// Collection Types (Unified format for all parsers)
// ============================================================

/**
 * Unified Collection - the common format all parsers produce
 */
export interface UnifiedCollection {
    id: string;
    name: string;
    description?: string;
    variables?: Record<string, string>;
    auth?: CollectionAuth;
    scripts?: CollectionScripts;
    /** Items can be requests or folders */
    items: (UnifiedFolder | UnifiedRequest)[];
    /** Source information */
    source?: {
        format: string;
        filePath: string;
        version?: string;
    };
    /** Metadata (parser info, load timestamps, etc.) */
    meta?: Record<string, any>;
}

/**
 * Unified Folder within a collection
 */
export interface UnifiedFolder {
    type: 'folder';
    id: string;
    name: string;
    description?: string;
    auth?: CollectionAuth;
    scripts?: CollectionScripts;
    items: (UnifiedFolder | UnifiedRequest)[];
}

/**
 * Operation example (for OpenAPI generation)
 */
export interface OperationExample {
    name: string;
    description?: string;
    value: any;
}

/**
 * Operation response definition (for OpenAPI generation)
 */
export interface OperationResponse {
    description: string;
    contentType?: string;
    schema?: JSONSchema7;
    examples?: Record<string, any>;
    headers?: Record<string, KeyValueEntry>;
}

/**
 * Request transport. HTTP requests use `method` as the HTTP verb; WebSocket
 * requests use `method: 'GET'` for the handshake and keep their socket-specific
 * configuration in `websocket`.
 */
export type RequestType = 'http' | 'websocket';

/**
 * Unified Request - normalized request format
 * Supports full feature set from CollectionRequest with metadata preservation
 */
export interface UnifiedRequest {
    type: 'request';
    id: string;
    name: string;
    description?: string;
    doc?: string;
    requestType?: RequestType;
    method: string;
    url: string;
    /** Headers with per-header enabled/disabled flag and OpenAPI metadata */
    headers: KeyValueEntry[];
    /** Query parameters with per-item enabled/disabled flag and OpenAPI metadata */
    query: KeyValueEntry[];
    /** Path parameters with OpenAPI metadata */
    params?: Record<string, string | PathParamEntry>;
    body?: RequestBody;
    /** Content-Type override for request body */
    bodyContentType?: string;
    auth?: CollectionAuth;
    settings?: RequestSettings;
    scripts?: CollectionScripts;
    /** WebSocket-specific configuration when requestType is 'websocket'. */
    websocket?: WebSocketRequestConfig;
    /** Mark request as disabled (not editable via UI) */
    disabled?: boolean;
    /** Mark request as deprecated */
    deprecated?: boolean;
    /** Response schema for validation */
    responseSchema?: ResponseSchemaDefinition;
    /** Body schema for validation */
    bodySchema?: BodySchemaDefinition;
    
    // ===== OpenAPI Metadata (optional, for tools like spring-api-tester) =====
    /** Explicit OpenAPI operationId (e.g., from @Operation, @RequestMapping) */
    operationId?: string;
    /** Explicit OpenAPI summary, separate from name */
    summary?: string;
    /** Explicit OpenAPI tags (e.g., from @Tag, controller class) */
    tags?: string[];
    /** Request/response examples for OpenAPI */
    examples?: OperationExample[];
    /** Per-status-code response definitions */
    responses?: Record<string, OperationResponse>;
    /** Operation-level security requirements */
    security?: Record<string, string[]>[];
}

/**
 * Collection-level scripts
 */
export interface CollectionScripts {
    preRequest?: string;
    postResponse?: string;
}

/**
 * Collection authentication configuration
 */
export interface CollectionAuth {
    type: 'none' | 'inherit' | 'basic' | 'bearer' | 'apikey';
    basic?: { username: string; password: string };
    bearer?: { token: string };
    apikey?: { key: string; value: string; in: 'header' | 'query' };
}

// ============================================================
// Request/Response Types
// ============================================================

/**
 * Body type for requests
 * Same as plugin's BodyType from shared/utils.ts
 */
export type BodyType = 'none' | 'raw' | 'form-data' | 'x-www-form-urlencoded' | 'binary' | 'graphql';

/**
 * Raw format for body content
 * Same as plugin's RawFormat from shared/utils.ts
 */
export type RawFormat = 'json' | 'text' | 'xml' | 'html' | 'javascript';

/**
 * Request body with type information
 * Same as plugin's RequestBody from shared/utils.ts
 * 
 * Examples:
 * - { type: 'raw', format: 'json', content: '{"key": "value"}' }
 * - { type: 'x-www-form-urlencoded', content: [{ key: 'name', value: 'test', enabled: true }] }
 * - { type: 'form-data', content: [{ key: 'file', value: 'data', type: 'text', enabled: true }] }
 * - { type: 'binary', content: 'base64encodeddata' }
 * - { type: 'graphql', content: { query: '...', variables: {} } }
 * - { type: 'none', content: null }
 */
export interface RequestBody {
    type: BodyType;
    format?: RawFormat;
    content?: any;
}

/**
 * Form data entry for multipart form-data bodies
 */
export interface FormDataEntry {
    key: string;
    value: string;
    type?: 'text' | 'file';
    enabled?: boolean;
}

/**
 * URL-encoded form entry
 */
export interface UrlEncodedEntry {
    key: string;
    value: string;
    enabled?: boolean;
}

/**
 * GraphQL request content
 */
export interface GraphQLContent {
    query: string;
    variables?: Record<string, unknown>;
    operationName?: string;
}

/**
 * WebSocket request flavor. Raw WebSocket and Socket.IO share the WebSocket
 * transport but expose different composer/listener UI.
 */
export type WebSocketProtocol = 'websocket' | 'socketio';

/** Presentation/validation format for a WebSocket message. */
export type WebSocketMessageFormat = 'text' | 'json' | 'xml' | 'html' | 'binary';

/** Encoding used when a WebSocket message is binary. */
export type WebSocketBinaryEncoding = 'base64' | 'hex';

/**
 * Saved WebSocket composer message.
 *
 * Text frames store their payload directly. Binary frames store the encoded
 * bytes so the request can round-trip through JSON without losing data.
 */
export interface WebSocketMessageDraft {
    id: string;
    name?: string;
    type: 'text' | 'binary';
    format?: WebSocketMessageFormat;
    /** Binary encoding used by `data`; ignored for text messages. */
    encoding?: WebSocketBinaryEncoding;
    data: string;
    enabled?: boolean;
    /** Socket.IO event name. Defaults to `message`. */
    event?: string;
    /** Additional Socket.IO arguments, stored as text. */
    args?: string[];
    /** Request an acknowledgement from the Socket.IO server. */
    ack?: boolean;
}

/**
 * A frame captured while a WebSocket request runs headlessly (collection
 * runner / suite executor). Binary payloads are encoded so the transcript can
 * round-trip through JSON and be asserted on from scripts.
 */
export interface WebSocketRunFrame {
    direction: 'in' | 'out' | 'system';
    type: 'text' | 'binary';
    /** Text payload, or the encoded binary payload. */
    data: string;
    /** Encoding used by `data` for binary frames. */
    encoding?: WebSocketBinaryEncoding;
    /** Socket.IO event name, when applicable. */
    event?: string;
    /** Socket.IO arguments, when applicable. */
    args?: string[];
    /** Whether this frame is an acknowledgement. */
    ack?: boolean;
    /** Frame size in bytes. */
    size: number;
    time: number;
}

/**
 * Response body exposed to post-response scripts for headless WebSocket runs.
 *
 * Scripts can assert on the frames, for example:
 * `pm.test('greeting', () => pm.expect(pm.response.json().frames.some(f => f.direction === 'in')).to.be.true)`
 */
export interface WebSocketRunTranscript {
    protocol: WebSocketProtocol;
    frames: WebSocketRunFrame[];
    close?: {
        code: number;
        reason: string;
        wasClean: boolean;
    };
}

/**
 * Socket.IO event listener saved with a request.
 */
export interface SocketIoEventListener {
    id: string;
    name: string;
    description?: string;
    enabled?: boolean;
}

/**
 * Socket.IO-specific request configuration.
 */
export interface SocketIoConfig {
    /** Socket.IO client version selected in the UI. */
    clientVersion?: string;
    /** Handshake path (defaults to `/socket.io`). */
    handshakePath?: string;
    /** Socket.IO namespace (defaults to `/`). */
    namespace?: string;
    /** Auth payload sent during the Socket.IO handshake (stored as JSON text). */
    auth?: string;
    /** Transports to use (defaults to `websocket`). */
    transports?: Array<'websocket' | 'polling'>;
    /** Events the response pane should listen to. */
    listeners?: SocketIoEventListener[];
}

/**
 * WebSocket-specific connection settings. TLS verification and HTTP timeout
 * stay in the shared `RequestSettings` bag; these settings only apply to the
 * socket connection/reconnect loop.
 */
export interface WebSocketConnectionSettings {
    /** Handshake timeout in milliseconds. Overrides `RequestSettings.timeout`. */
    handshakeTimeout?: number;
    /** Maximum automatic reconnect attempts after an unexpected close. */
    reconnectionAttempts?: number;
    /** Delay between reconnect attempts in milliseconds. */
    reconnectionInterval?: number;
    /** Maximum accepted message size in megabytes. 0 means unlimited. */
    maxMessageSizeMb?: number;
    /**
     * Time in milliseconds to collect inbound frames after sending saved
     * messages during a headless run. Defaults to 1000; 0 closes immediately.
     */
    responseTimeout?: number;
}

/**
 * WebSocket-specific request configuration.
 *
 * WebSocket requests set `requestType: 'websocket'`; URL, headers, query,
 * params, auth, and settings are shared with HTTP requests. The HTTP handshake
 * method is `GET`, but the method selector is not shown for WebSocket requests.
 */
export interface WebSocketRequestConfig {
    /** Raw WebSocket or Socket.IO. Defaults to raw WebSocket. */
    protocol?: WebSocketProtocol;
    /** Sec-WebSocket-Protocol values, in preference order. */
    subprotocols?: string[];
    /** Saved composer drafts. The live frame log is runtime-only. */
    messages?: WebSocketMessageDraft[];
    /** Socket connection and reconnection settings. */
    settings?: WebSocketConnectionSettings;
    /** Socket.IO-specific configuration. */
    socketio?: SocketIoConfig;
    /** Persisted frame log from previous runs. */
    frameHistory?: WebSocketRunFrame[];
}

/**
 * Request settings
 */
export interface RequestSettings {
    timeout?: number;
    followRedirects?: boolean;
    followOriginalMethod?: boolean;
    followAuthHeader?: boolean;
    maxRedirects?: number;
    strictSSL?: boolean;
    decompress?: boolean;
    includeCookies?: boolean;
    tls?: TlsSettings;
    certificates?: TlsCertificateMapping[];
}

/**
 * TLS options for HTTPS requests
 */
export interface TlsSettings {
    /** Path to CA certificate bundle (PEM) */
    caPath?: string;
    /** Path to client certificate (PEM) */
    certPath?: string;
    /** Path to client private key (PEM) */
    keyPath?: string;
    /** Path to client certificate/key bundle (PFX/P12) */
    pfxPath?: string;
    /** Passphrase for key/pfx if required */
    passphrase?: string;
    /** Optional TLS servername (SNI override) */
    servername?: string;
}

/**
 * Host-based TLS certificate mapping (Postman-style global certificate settings)
 */
export interface TlsCertificateMapping extends TlsSettings {
    /** Host matcher: exact host (api.example.com), wildcard (*.example.com), or '*' */
    host: string;
    /** Optional port filter */
    port?: number;
    /** Enable/disable mapping */
    enabled?: boolean;
}

/**
 * HTTP request ready for execution
 */
export interface HttpRequest {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: any;
    timeout?: number;
    signal?: AbortSignal;
    settings?: RequestSettings;
}

/**
 * HTTP request options (alias for HttpRequest)
 * Matches extension's HttpRequestOptions interface
 */
export type HttpRequestOptions = HttpRequest;

/**
 * HTTP response from execution
 */
export interface HttpResponse {
    status: number;
    statusText: string;
    headers: Record<string, string | string[]>;
    cookies: ParsedCookie[];
    body: any;
    time: number;
    size?: number;
}

// ============================================================
// Execution Types
// ============================================================

/**
 * Normalized request ready for execution pipeline.
 * Contains unresolved variables — the executor resolves them before sending.
 * Matches extension's ExecutionRequest.
 */
export interface ExecutionRequest {
    id: string;
    name: string;
    requestType?: RequestType;
    method: string;
    url: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body?: RequestBody | null;
    bodyContentType?: string;
    params?: Record<string, string>;
    settings?: RequestSettings;
    scripts?: RequestScripts;
    auth?: RequestAuth;
    websocket?: WebSocketRequestConfig;
}

/**
 * Variable scopes for script/request execution.
 * Matches extension's ExecutionVariables.
 */
export interface ExecutionVariables {
    variables: Record<string, string>;
    collectionVariables?: Record<string, string>;
    globals?: Record<string, string>;
    environmentVariables?: Record<string, string>;
}

// ============================================================
// Script Execution Types
// ============================================================

/**
 * Context available to scripts during execution
 */
export interface ScriptContext {
    /** The current request (may be modified by pre-request scripts) */
    request: HttpRequest;
    /** The response (only available in post-response scripts) */
    response?: HttpResponse;
    /** Global variables (workspace-wide, persistent) */
    globals?: Record<string, string>;
    /** Collection-level variables */
    collectionVariables?: Record<string, string>;
    /** Environment variables (persistent) */
    environment: Record<string, string>;
    /** Environment name */
    environmentName?: string;
    /** Flow-scoped variables (temporary) */
    variables: Record<string, string>;
    /** Information about the current execution */
    info?: ScriptInfo;
    /** Cookie jar for accessing/modifying cookies in scripts */
    cookieJar?: any; // ICookieJar from core/interfaces/cookie
}

/**
 * Script execution metadata
 */
export interface ScriptInfo {
    eventName: 'prerequest' | 'test';
    iteration?: number;
    iterationCount?: number;
    requestName?: string;
    requestId?: string;
    collectionName?: string;
}

/**
 * Result of script execution
 */
export interface ScriptResult {
    success: boolean;
    error?: string;
    /** Modified request (from pre-request scripts) */
    modifiedRequest?: Partial<HttpRequest>;
    /** Modified global variables */
    modifiedGlobals?: Record<string, string>;
    /** Modified collection variables */
    modifiedCollectionVariables?: Record<string, string>;
    /** Modified environment variables */
    modifiedEnvironment?: Record<string, string>;
    /** Modified flow-scoped variables */
    modifiedVariables?: Record<string, string>;
    /** Console output from scripts */
    consoleOutput?: string[];
    /** Test assertions (from post-response scripts) */
    assertions?: TestAssertion[];
}

/**
 * Test assertion result
 */
export interface TestAssertion {
    name: string;
    passed: boolean;
    message?: string;
    /** True when the test was explicitly skipped via pm.test.skip(...) */
    skipped?: boolean;
}

// ============================================================
// Execution Types
// ============================================================

/**
 * Request overrides that can be applied at runtime
 */
export interface RequestOverrides {
    /** Override URL path parameters */
    params?: Record<string, string>;
    /** Override query parameters */
    query?: Record<string, string>;
    /** Override headers */
    headers?: Record<string, string>;
    /** Override body */
    body?: any;
    /** Override entire URL */
    url?: string;
    /** Override method */
    method?: string;
    /** Timeout override */
    timeout?: number;
    /** Settings override (e.g., strictSSL, followRedirects) */
    settings?: Partial<RequestSettings>;
    /** Skip all scripts */
    skipScripts?: boolean | ScriptLevel[];
    /** Skip only pre-request scripts */
    skipPreScripts?: boolean;
    /** Skip only post-response scripts */
    skipPostScripts?: boolean;
}

/**
 * Script levels that can be skipped
 */
export type ScriptLevel = 'collection' | 'folder' | 'request';

/**
 * Resolved request with collection/folder context
 */
export interface ResolvedRequest extends UnifiedRequest {
    /** Parent collection */
    collection?: UnifiedCollection;
    /** Parent folder (if any) */
    folder?: UnifiedFolder;
    /** Full path: collection/folder/request */
    path: string;
}

/**
 * Final response returned to users
 */
export interface ForgeResponse {
    /** HTTP status code */
    status: number;
    /** HTTP status text */
    statusText: string;
    /** Response headers */
    headers: Record<string, string>;
    /** Parsed response body */
    body: any;
    /** Response time in milliseconds */
    time: number;
    /** Response size in bytes */
    size?: number;
    /** The request that was sent */
    request: HttpRequest;
    /** Test assertions (if post-response scripts ran) */
    assertions?: TestAssertion[];
    /** Console output from scripts */
    consoleOutput?: string[];
}

// ============================================================
// Configuration Types
// ============================================================

/**
 * Forge configuration options
 */
export interface ForgeConfig {
    /** Root directory for .forge folder */
    forgeRoot: string;
    /** Default environment name */
    defaultEnvironment?: string;
    /** Default timeout in milliseconds */
    timeout?: number;
    /** Whether to follow redirects */
    followRedirects?: boolean;
    /** Maximum redirects to follow */
    maxRedirects?: number;
    /** Whether to verify SSL certificates */
    strictSSL?: boolean;
}

// ============================================================
// OpenAPI / Schema Types
// ============================================================

/**
 * JSON Schema compatible type (OAS 3.0 subset)
 */
export type JSONSchema7 = Record<string, any>;

/**
 * JSON-compatible value types (for response body)
 */
export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

/**
 * Header/Query entry with enabled flag (for CollectionRequest Array format)
 */
export interface KeyValueEntry {
    key: string;
    value: string;
    enabled?: boolean;
    // OpenAPI generation fields (all optional, backward-compatible)
    type?: 'string' | 'integer' | 'number' | 'boolean' | 'array';
    required?: boolean;
    description?: string;
    format?: string;
    enum?: string[];
    deprecated?: boolean;
    // Extended constraint fields for full OpenAPI 3.0 round-trip
    // String constraints
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    // Numeric constraints (integer / number)
    minimum?: number;
    maximum?: number;
    /** OpenAPI 3.0: boolean modifier on minimum (value must be > minimum) */
    exclusiveMinimum?: boolean;
    /** OpenAPI 3.0: boolean modifier on maximum (value must be < maximum) */
    exclusiveMaximum?: boolean;
    multipleOf?: number;
    // Array constraints
    minItems?: number;
    maxItems?: number;
    uniqueItems?: boolean;
    // Common
    nullable?: boolean;
    /** When multiple incompatible constraint sets exist (e.g. from merged endpoints) */
    oneOf?: Array<Record<string, any>>;
}
export interface PathParamEntry {
    value: string;
    type?: 'string' | 'integer' | 'number' | 'boolean';
    description?: string;
    format?: string;
    enum?: string[];
    deprecated?: boolean;
    // Extended constraint fields for full OpenAPI 3.0 round-trip
    // String constraints
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    // Numeric constraints (integer / number)
    minimum?: number;
    maximum?: number;
    /** OpenAPI 3.0: boolean modifier on minimum (value must be > minimum) */
    exclusiveMinimum?: boolean;
    /** OpenAPI 3.0: boolean modifier on maximum (value must be < maximum) */
    exclusiveMaximum?: boolean;
    multipleOf?: number;
    // Array constraints
    minItems?: number;
    maxItems?: number;
    uniqueItems?: boolean;
    // Common
    nullable?: boolean;
    /** When multiple incompatible constraint sets exist (e.g. from merged endpoints) */
    oneOf?: Array<Record<string, any>>;
}

/**
 * Per-property encoding metadata for multipart/form-data request bodies.
 * Mirrors the OpenAPI 3.0 Encoding Object.
 */
export interface EncodingDefinition {
    contentType?: string;
    style?: 'form' | 'spaceDelimited' | 'pipeDelimited' | 'deepObject';
    explode?: boolean;
    allowReserved?: boolean;
    headers?: Record<string, { description?: string; schema: JSONSchema7 }>;
}

/**
 * Content definition for a single media type.
 */
export interface ContentDefinition {
    schema?: JSONSchema7;
    examples?: Record<string, { summary?: string; value: any }>;
    encoding?: Record<string, EncodingDefinition>;
}

/**
 * Response definition for a specific HTTP status code.
 */
export interface ResponseDefinition {
    description?: string;
    contentType?: string;
    schema?: JSONSchema7;
    examples?: Record<string, { summary?: string; value: any }>;
    content?: Record<string, ContentDefinition>;
    headers?: Record<string, { description?: string; schema: JSONSchema7 }>;
}

/**
 * Response schema definition with per-status response schemas.
 */
export interface ResponseSchemaDefinition {
    responses: Record<string, ResponseDefinition>;
    components?: Record<string, JSONSchema7>;
}

/**
 * Body schema definition for request bodies.
 */
export interface BodySchemaDefinition {
    contentType?: string;
    schema: JSONSchema7;
    components?: Record<string, JSONSchema7>;
    content?: Record<string, ContentDefinition>;
    encoding?: Record<string, EncodingDefinition>;
}

// ============================================================
// Auth Types (Extended)
// ============================================================

/**
 * Basic authentication configuration
 */
export interface BasicAuthConfig {
    username: string;
    password: string;
}

/**
 * API Key authentication configuration
 */
export interface ApiKeyConfig {
    key: string;
    value: string;
    in?: 'header' | 'query';
}

/**
 * OAuth2 authentication configuration
 */
export interface OAuth2Config {
    grantType: 'authorization_code' | 'client_credentials' | 'password' | 'implicit';
    tokenUrl?: string;
    authUrl?: string;
    clientId?: string;
    clientSecret?: string;
    scope?: string;
    username?: string;
    password?: string;
    accessToken?: string;
    refreshToken?: string;
    tokenPrefix?: string;
    tokenField?: string;
    callbackUrl?: string;
    usePkce?: boolean;
    pkceMethod?: 'S256' | 'plain';
    audience?: string;
    resource?: string;
    extraParams?: Record<string, string>;
    clientAuthentication?: 'header' | 'body';
    state?: string;
}

/**
 * Full request authentication configuration (matches extension's RequestAuth)
 */
export interface RequestAuth {
    type?: 'none' | 'inherit' | 'basic' | 'bearer' | 'apikey' | 'oauth2';
    bearerToken?: string;
    basicAuth?: BasicAuthConfig;
    apikey?: ApiKeyConfig;
    oauth2?: OAuth2Config;
}

// ============================================================
// Collection Request Types (Storage format)
// ============================================================

/**
 * Request scripts configuration
 */
export interface RequestScripts {
    preRequest?: string;
    postResponse?: string;
}

/**
 * Collection request - the on-disk/storage format
 */
export interface CollectionRequest {
    id: string;
    name: string;
    requestType?: RequestType;
    method: string;
    url: string;
    headers?: KeyValueEntry[];
    query?: KeyValueEntry[];
    body?: RequestBody | null;
    bodyContentType?: string;
    params?: Record<string, string | PathParamEntry>;
    settings?: RequestSettings;
    scripts?: RequestScripts;
    auth?: RequestAuth;
    websocket?: WebSocketRequestConfig;
    description?: string;
    doc?: string;
    disabled?: boolean;
    deprecated?: boolean;
    responseSchema?: ResponseSchemaDefinition;
    bodySchema?: BodySchemaDefinition;

    // ===== OpenAPI Metadata (optional, preserved for export) =====
    operationId?: string;
    summary?: string;
    tags?: string[];
    examples?: OperationExample[];
    responses?: Record<string, OperationResponse>;
    security?: Record<string, string[]>[];
}

// ============================================================
// Execution Result Types
// ============================================================

/**
 * Encoded request body ready for HTTP transmission
 */
export type RequestBodyEncoded =
    | string           // Raw text, JSON string
    | Buffer           // Binary data
    | FormData         // Native multipart/form-data payload
    | URLSearchParams  // URL-encoded payload
    | null;            // No body

/**
 * Resolved body ready for HTTP transmission
 */
export interface ResolvedBody {
    type: BodyType;
    format?: RawFormat;
    content: RequestBodyEncoded;
}

/**
 * Fully prepared request ready for execution (all variables resolved)
 */
export interface PreparedRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: ResolvedBody;
    params: Record<string, string>;
    query: Record<string, string>;
}

/**
 * Complete execution result from running a request
 */
export interface ExecutionResult {
    requestId: string;
    name: string;
    executedRequest: PreparedRequest;
    response: HttpResponse;
    duration: number;
    timestamp: number;
    passed: boolean;
    assertions: TestAssertion[];
    consoleOutput?: string[];
    modifiedVariables?: Record<string, string>;
    modifiedEnvironmentVariables?: Record<string, string>;
    modifiedCollectionVariables?: Record<string, string>;
    error?: string;
    /** Folder path of the request within its collection (slash-separated; empty for root) */
    folderPath?: string;
    /** Display grouping path used by suite results (block label or folder path) */
    groupPath?: string;
    /** Display grouping source used by suite results */
    groupType?: 'folder' | 'block';
    /** Name of the collection this request belongs to (for multi-collection suite reports) */
    collectionName?: string;
    /** Postman-compatible: pm.execution.setNextRequest() value. null = stop runner. */
    nextRequest?: string | null;
    /** Postman-compatible: pm.visualizer.set(template, data) output */
    visualizerData?: { template: string; data?: any };
}
