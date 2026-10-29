/**
 * Platform Abstraction Interfaces
 *
 * These interfaces decouple core business logic from platform-specific APIs
 * (VS Code, Node.js CLI, browser, etc.), enabling the same logic to run
 * in any environment by providing different implementations.
 *
 * Pattern:
 *   - Extension: implements via vscode.* APIs
 *   - CLI/Standalone: implements via chokidar, node-keytar, open, etc.
 *   - Browser/Web: implements via browser APIs or server-side proxies
 */

// ============================================================
// Disposable
// ============================================================

/**
 * Represents a resource that can be disposed/cleaned up.
 */
export interface IDisposable {
    dispose(): void;
}

// ============================================================
// File Watcher
// ============================================================

/**
 * Callback type for file watcher events.
 */
export type FileWatcherCallback = (uri: string) => void;

/**
 * Watches a set of files for changes.
 *
 * VS Code impl: wraps `vscode.FileSystemWatcher`
 * Node impl: wraps `chokidar` or `fs.watch`
 */
export interface IFileWatcher extends IDisposable {
    onDidChange(callback: FileWatcherCallback): IDisposable;
    onDidCreate(callback: FileWatcherCallback): IDisposable;
    onDidDelete(callback: FileWatcherCallback): IDisposable;
}

/**
 * Factory for creating file watchers.
 *
 * VS Code impl: `vscode.workspace.createFileSystemWatcher(new RelativePattern(base, glob))`
 * Node impl: `chokidar.watch(path.join(base, glob))`
 */
export interface IFileWatcherFactory {
    /**
     * Create a watcher for files matching the glob pattern under the base directory.
     * @param base - Base directory path
     * @param glob - Glob pattern relative to base (e.g. `'**\/*.json'`)
     */
    createFileWatcher(base: string, glob: string): IFileWatcher;
}

// ============================================================
// Key-Value Store (State Persistence)
// ============================================================

/**
 * Simple key-value store for persisting state.
 *
 * VS Code impl: wraps `ExtensionContext.globalState` or `.workspaceState`
 * Node/CLI impl: wraps a JSON file or SQLite
 * Browser impl: wraps localStorage or IndexedDB
 */
export interface IKeyValueStore {
    /**
     * Get a value by key. Returns `defaultValue` (or undefined) if not found.
     */
    get<T>(key: string, defaultValue?: T): T | undefined;

    /**
     * Set a value for a key. Pass `undefined` to delete.
     */
    update(key: string, value: any): Promise<void>;
}

// ============================================================
// Secret Storage
// ============================================================

/**
 * Secure storage for sensitive data (tokens, passwords).
 *
 * VS Code impl: wraps `ExtensionContext.secrets`
 * Node/CLI impl: wraps `keytar` or encrypted file store
 * Browser impl: wraps server-side encrypted store via API
 */
export interface ISecretStore {
    get(key: string): Promise<string | undefined>;
    store(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
}

// ============================================================
// Notification Service
// ============================================================

/**
 * Shows user-facing notifications/messages.
 *
 * VS Code impl: wraps `vscode.window.show{Information,Warning,Error}Message`
 * CLI impl: console.log / chalk
 * Browser impl: toast / alert
 */
export interface INotificationService {
    showInformation(message: string): Promise<string | undefined>;
    showWarning(message: string): Promise<string | undefined>;
    showError(message: string): Promise<string | undefined>;
}

// ============================================================
// Output Channel (Structured Logging UI)
// ============================================================

/**
 * A named output channel for structured logging with UI controls.
 * Extends ILogger with show/clear/dispose capabilities.
 *
 * VS Code impl: wraps `vscode.LogOutputChannel`
 * CLI impl: writes to a log file or stdout with prefixed channel name
 * Browser impl: writes to a panel or developer console
 */
export interface IOutputChannel extends IDisposable {
    readonly name: string;
    trace(message: string): void;
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    /** Show/focus the output channel */
    show(preserveFocus?: boolean): void;
    /** Clear all output */
    clear(): void;
}

/**
 * Factory for creating named output channels.
 *
 * VS Code impl: wraps `vscode.window.createOutputChannel(name, { log: true })`
 * Node/CLI impl: creates file-backed or console-backed loggers
 */
export interface IOutputChannelFactory {
    createOutputChannel(name: string): IOutputChannel;
}

// ============================================================
// External Browser Service
// ============================================================

/**
 * Service for interacting with the system browser.
 * Used primarily for OAuth2 authorization flows.
 *
 * VS Code impl: wraps `vscode.env.openExternal`, `.uriScheme`, `.asExternalUri`
 * Node/CLI impl: wraps `open` package + local HTTP callback server
 * Browser impl: `window.open()` + `postMessage` callback
 */
export interface IExternalBrowserService {
    /**
     * The URI scheme for this platform (e.g. 'vscode', 'http-forge', 'http').
     */
    readonly uriScheme: string;

    /**
     * Open a URL in the system's default browser.
     */
    openExternal(url: string): Promise<boolean>;

    /**
     * Convert a local URI to an externally accessible URI.
     * Used for OAuth2 callback URLs.
     */
    asExternalUri(uri: string): Promise<string>;
}

// ============================================================
// Extension / Application Info
// ============================================================

/**
 * Metadata about the running application/extension.
 * Used for User-Agent headers, telemetry, etc.
 *
 * VS Code impl: reads from `vscode.extensions.getExtension(id)?.packageJSON`
 * CLI impl: reads from package.json
 */
export interface IApplicationInfo {
    readonly name: string;
    readonly version: string;
    readonly displayName?: string;
}

// ============================================================
// Platform Context (Aggregate)
// ============================================================

/**
 * Aggregate interface providing all platform-specific services.
 * Consumers that need multiple platform services can depend on this
 * instead of injecting each service individually.
 *
 * All properties are optional — consumers should only use what they need.
 */
export interface IPlatformContext {
    /** Factory for creating file watchers */
    readonly fileWatcherFactory?: IFileWatcherFactory;
    /** Workspace-scoped key-value store (per-workspace state) */
    readonly workspaceStore?: IKeyValueStore;
    /** Global key-value store (cross-workspace state) */
    readonly globalStore?: IKeyValueStore;
    /** Secure storage for tokens and credentials */
    readonly secretStore?: ISecretStore;
    /** User-facing notifications */
    readonly notifications?: INotificationService;
    /** Output channel factory for structured logging */
    readonly outputChannelFactory?: IOutputChannelFactory;
    /** External browser interaction (OAuth2, etc.) */
    readonly browser?: IExternalBrowserService;
    /** Application metadata */
    readonly appInfo?: IApplicationInfo;
}

// ============================================================
// File System Interface (Abstraction for testing)
// ============================================================

/**
 * Interface for file system operations.
 * Allows mocking in tests and platform-agnostic code.
 */
export interface IFileSystem {
    readFile(filePath: string): Promise<string>;
    writeFile(filePath: string, content: string): Promise<void>;
    exists(filePath: string): Promise<boolean>;
    mkdir(dirPath: string): Promise<void>;
    glob(patterns: string[], cwd?: string): Promise<string[]>;
    readDir(dirPath: string): Promise<string[]>;
    isDirectory(filePath: string): Promise<boolean>;
}

// ============================================================
// HTTP Client Interface
// ============================================================

import { HttpRequestOptions, HttpResponse, RequestSettings } from './types';

/**
 * Interface for executing HTTP requests.
 */
export interface IHttpClient {
    send(options: HttpRequestOptions): Promise<HttpResponse>;
}

// ============================================================
// WebSocket Client Interface
// ============================================================

/**
 * Options for opening a WebSocket connection.
 */
export interface WebSocketConnectOptions {
    url: string;
    headers?: Record<string, string>;
    protocols?: string[];
    settings?: RequestSettings;
    /** Maximum accepted message size in bytes. 0 or undefined means unlimited. */
    maxPayloadBytes?: number;
    signal?: AbortSignal;
}

/**
 * A single WebSocket message frame.
 *
 * Binary data is exposed as a Uint8Array so the port stays platform-neutral.
 */
export interface WebSocketFrame {
    data: string | Uint8Array;
    isBinary: boolean;
}

/**
 * Close details for a WebSocket connection.
 */
export interface WebSocketCloseInfo {
    code: number;
    reason: string;
    wasClean: boolean;
}

export type WebSocketConnectionState = 'connecting' | 'open' | 'closing' | 'closed';

/**
 * An open WebSocket connection.
 */
export interface IWebSocketConnection extends IDisposable {
    readonly state: WebSocketConnectionState;
    readonly negotiatedProtocol: string;
    readonly handshakeHeaders?: Record<string, string>;

    send(data: string | Uint8Array): Promise<void>;
    close(code?: number, reason?: string): Promise<void>;

    onFrame(listener: (frame: WebSocketFrame) => void): IDisposable;
    onClose(listener: (info: WebSocketCloseInfo) => void): IDisposable;
    onError(listener: (error: Error) => void): IDisposable;
}

/**
 * Platform abstraction for opening WebSocket connections.
 */
export interface IWebSocketClient {
    connect(options: WebSocketConnectOptions): Promise<IWebSocketConnection>;
}

// ============================================================
// Socket.IO Client
// ============================================================

export interface SocketIoConnectOptions {
    url: string;
    headers?: Record<string, string>;
    path?: string;
    clientVersion?: string;
    namespace?: string;
    auth?: unknown;
    transports?: Array<'websocket' | 'polling'>;
    timeout?: number;
    reconnectionAttempts?: number;
    reconnectionDelay?: number;
    listeners?: string[];
}

export interface SocketIoEvent {
    event: string;
    args: unknown[];
}

export interface ISocketIoConnection extends IDisposable {
    readonly connected: boolean;
    readonly id?: string;

    send(event: string, args: unknown[], expectAck?: boolean): Promise<unknown[] | undefined>;
    close(): void;

    onEvent(listener: (event: SocketIoEvent) => void): IDisposable;
    onConnect(listener: () => void): IDisposable;
    onDisconnect(listener: (reason: string) => void): IDisposable;
    onReconnectFailed(listener: () => void): IDisposable;
    onError(listener: (error: Error) => void): IDisposable;
}

export interface ISocketIoClient {
    connect(options: SocketIoConnectOptions): Promise<ISocketIoConnection>;
}

// ============================================================
// Logger Interface
// ============================================================

/**
 * Interface for logging.
 */
export interface ILogger {
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
}
