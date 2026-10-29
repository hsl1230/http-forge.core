/**
 * MCP Generic Tool Handler Contracts
 *
 * Each generic ("argument-selected") MCP tool is implemented by one
 * `McpToolHandler`. A registry maps tool names to handlers, so adding a
 * new tool means adding a handler — never editing a shared dispatcher.
 */

import type { Collection } from '../../types/collection';
import type { McpRunStore } from '../mcp-run-store';
import type { GenericToolName } from '../mcp-tool-schemas';

/** Services injected into every tool handler. */
export interface McpDispatchServices {
  collection: import('../../types/collection').ICollectionService;
  testSuite: import('../../infrastructure/test-suite/interfaces').ITestSuiteService;
  environmentConfig: import('../../types/environment-config').IEnvironmentConfigService;
  /** Absolute path to the workspace folder — used by AI-native tools. */
  workspaceFolder?: string;
  /**
   * Optional AI provider. When supplied, AI-flavoured tools (e.g. assertion
   * suggestion, failure explanation) call a real LLM and fall back to their
   * built-in heuristics when absent or on provider errors.
   */
  aiProvider?: import('../../infrastructure/ai/ai-provider').IAiProvider;
}

/**
 * Callbacks for the four execution tools that differ between server
 * implementations. The extension uses CollectionRequestExecutor + executeSuite;
 * the core runtime uses the direct-execution functions.
 */
export interface McpRunCallbacks {
  runRequest: (
    col: Collection,
    requestId: string,
    args: Record<string, unknown>
  ) => Promise<unknown>;
  runFolder: (
    col: Collection,
    folderPath: string,
    args: Record<string, unknown>
  ) => Promise<unknown>;
  runCollection: (col: Collection, args: Record<string, unknown>) => Promise<unknown>;
  runSuite: (
    suiteId: string,
    suiteName: string,
    args: Record<string, unknown>
  ) => Promise<unknown>;
}

/** Everything a tool handler needs to do its job. */
export interface McpToolContext {
  /** The tool name constant from GENERIC_TOOL_NAMES. */
  tool: GenericToolName;
  /** Raw arguments object from the MCP tools/call payload. */
  args: Record<string, unknown>;
  /** Live service instances from either server's DI container. */
  services: McpDispatchServices;
  /** The caller's McpRunStore instance (each server owns one). */
  runStore: McpRunStore;
  /** Implementation-specific run-* execution callbacks. */
  callbacks: McpRunCallbacks;
  /** Snapshot of all collections (resolved once per dispatch). */
  collections: Collection[];
}

/**
 * A single tool handler. `toolNames` is the set of tool names this handler
 * implements (a handler may implement more than one, e.g. analyze_coverage
 * and ai_analyze_coverage share behaviour).
 */
export interface McpToolHandler {
  readonly toolNames: GenericToolName[];
  handle(ctx: McpToolContext): Promise<unknown> | unknown;
}
