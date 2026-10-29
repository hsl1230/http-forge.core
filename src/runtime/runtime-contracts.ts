/**
 * HTTP Forge Runtime Contracts
 * 
 * Public API surface for embeddable MCP runtime and direct execution.
 * Used by CLI, third-party Node apps, and external integrations.
 * 
 * Three consumption modes:
 * 1. Embeddable MCP: createMcpRuntime() + lifecycle handle
 * 2. Direct execution: runRequest/runCollection/runSuite without MCP
 * 3. CLI: subcommands that use modes 1 and 2
 */

import type { ResolutionInfo } from './ref-resolver';

// ============================================================
// Embeddable MCP Runtime
// ============================================================

/**
 * Configuration for creating an embeddable MCP runtime instance.
 */
export interface McpRuntimeOptions {
  /** Workspace root folder path */
  workspaceFolder: string;

  /** Port to listen on (default: 3100) */
  port?: number;

  /** Host to bind to (default: 127.0.0.1) */
  host?: string;

  /** Config field overrides (e.g. { 'mcp.port': 3200 }) */
  configOverrides?: Record<string, unknown>;
}

/**
 * Handle for controlling an embeddable MCP runtime instance.
 */
export interface McpRuntimeHandle {
  /** Start the MCP server */
  start(): Promise<void>;

  /** Stop the MCP server */
  stop(): Promise<void>;

  /** Check if server is running */
  isRunning(): boolean;

  /** Get the port the server is listening on */
  getPort(): number;

  /** Execute a tool in-process (no protocol overhead) */
  executeTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Factory to create and manage embeddable MCP runtime instances.
 */
export async function createMcpRuntime(options: McpRuntimeOptions): Promise<McpRuntimeHandle> {
  const { createMcpRuntime: impl } = await import('./mcp-runtime');
  return impl(options);
}

// ============================================================
// Direct Execution APIs (No MCP Server Required)
// ============================================================

/**
 * Options for directly executing a single request without MCP.
 */
export interface RunRequestOptions {
  /** Workspace root folder path */
  workspaceFolder: string;

  /** Collection ID containing the request (exact id). */
  collectionId?: string;

  /** Request ID to execute (exact id). */
  requestId?: string;

  /**
   * Collection reference resolved by tier id -> slug -> name. Used when an
   * exact `collectionId` is not provided.
   */
  collectionRef?: string;

  /**
   * Request reference resolved by tier id -> slug -> name. Used when an exact
   * `requestId` is not provided. Scoped to `folderRef` when that is provided.
   */
  requestRef?: string;

  /**
   * Optional folder reference (slash-separated id/slug/name segments) that
   * scopes request resolution to that folder's subtree.
   */
  folderRef?: string;

  /** Called for each reference resolved, for transparency/logging. */
  onResolve?: (info: ResolutionInfo) => void;

  /** Environment name (defaults to currently selected) */
  environment?: string;

  /** Extra variables to inject into execution */
  variables?: Record<string, unknown>;

  /** Override or add request headers */
  headers?: Record<string, string>;

  /** Override query parameters */
  query?: Record<string, string>;

  /** Replace request body (JSON string) */
  body?: string;

  /** Extra response fields to include: headers, cookies, tests, consoleOutput, report */
  include?: string[];

  /** Additional machine-readable reports to generate, e.g. ['junit'] */
  reporters?: string[];
}

/**
 * Options for directly executing all requests in a collection without MCP.
 */
export interface RunCollectionOptions {
  /** Workspace root folder path */
  workspaceFolder: string;

  /** Collection ID to execute (exact id). */
  collectionId?: string;

  /**
   * Collection reference resolved by tier id -> slug -> name. Used when an
   * exact `collectionId` is not provided.
   */
  collectionRef?: string;

  /**
   * Folder reference (slash-separated id/slug/name segments) resolved to a
   * folder path. Used when an exact `folderPath` is not provided.
   */
  folderRef?: string;

  /** Called for each reference resolved, for transparency/logging. */
  onResolve?: (info: ResolutionInfo) => void;

  /** Environment name (defaults to currently selected) */
  environment?: string;

  /** Extra variables injected into every request */
  variables?: Record<string, unknown>;

  /** Number of iterations (default: 1) */
  iterations?: number;

  /** Stop on first failure (default: false) */
  stopOnError?: boolean;

  /** Delay between requests in milliseconds (default: 0) */
  delay?: number;

  /** Extra response fields to include: perRequest, failedOnly, consoleOutput */
  include?: string[];

  /** Additional machine-readable reports to generate, e.g. ['junit'] */
  reporters?: string[];

  /**
   * Maximum number of iterations to execute in parallel (default: 1 = sequential).
   * Each iteration runs the full request sequence in order so that inter-request
   * dependencies (e.g. login → use token → call protected endpoint) are always
   * preserved within an iteration. Concurrency means N independent virtual users
   * running the same flow simultaneously, not requests within one flow running in
   * parallel. Max: 50.
   */
  concurrency?: number;

  /**
   * Restrict execution to requests under this folder path (slash-separated
   * folder names, e.g. "Auth/Login"). When omitted, the whole collection runs.
   */
  folderPath?: string;

  /**
   * When a `folderPath` is provided, include requests in nested subfolders
   * (default: true). When false, only requests directly in that folder run.
   */
  recursive?: boolean;
}

/**
 * Options for directly executing a test suite without MCP.
 */
export interface RunSuiteOptions {
  /** Workspace root folder path */
  workspaceFolder: string;

  /** Suite ID to execute */
  suiteId: string;

  /** Environment name (defaults to currently selected) */
  environment?: string;

  /** Extra variables injected into every request */
  variables?: Record<string, unknown>;

  /** Number of iterations (overrides suite default) */
  iterations?: number;

  /** Stop on first failure (overrides suite default) */
  stopOnError?: boolean;

  /** Delay between requests in ms (overrides suite default) */
  delay?: number;

  /** Run only requests whose names match one of these strings (case-insensitive) */
  requestFilter?: string[];

  /** Extra response fields to include: perRequest, failedOnly, consoleOutput */
  include?: string[];

  /** Additional machine-readable reports to generate, e.g. ['junit'] */
  reporters?: string[];

  /**
   * Maximum number of iterations to execute in parallel (default: 1 = sequential).
   * Each iteration runs the full request sequence in order. Max: 50.
   */
  concurrency?: number;
}

/**
 * Execute a single request directly without MCP server.
 * Returns typed result object; never calls process.exit.
 */
export async function runRequest(options: RunRequestOptions): Promise<unknown> {
  const { runRequest: impl } = await import('./direct-execution');
  return impl(options);
}

/**
 * Execute a collection directly without MCP server.
 * Returns typed result object; never calls process.exit.
 */
export async function runCollection(options: RunCollectionOptions): Promise<unknown> {
  const { runCollection: impl } = await import('./direct-execution');
  return impl(options);
}

/**
 * Execute the requests under a specific folder of a collection without MCP
 * server. Thin wrapper over {@link runCollection} scoped to a folder
 * (recursively by default). The folder may be given as `folderPath` (folder
 * names joined by '/') or `folderRef` (slash-separated id/slug/name segments).
 * Returns the same result shape as a collection run.
 */
export async function runFolder(
  options: RunCollectionOptions & ({ folderPath: string } | { folderRef: string })
): Promise<unknown> {
  const { runFolder: impl } = await import('./direct-execution');
  return impl(options);
}

/**
 * Execute a test suite directly without MCP server.
 * Returns typed result object; never calls process.exit.
 */
export async function runSuite(options: RunSuiteOptions): Promise<unknown> {
  const { runSuite: impl } = await import('./direct-execution');
  return impl(options);
}
