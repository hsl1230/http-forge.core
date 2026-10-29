/**
 * MCP Generic Tool Dispatcher
 *
 * Entry point for all argument-based ("generic") tool handlers, shared
 * between the embedded core runtime and the VS Code extension's McpExecutor.
 *
 * The actual implementation of each tool lives in `mcp-handlers/*`, one
 * handler per tool (or per related group), assembled in a registry. This
 * module is deliberately thin: it resolves the collection snapshot once,
 * looks up the handler, and delegates.
 *
 * The four run-* tools (run_request, run_folder, run_collection, run_suite)
 * use different execution back-ends in each server and are therefore delegated
 * to `McpRunCallbacks` supplied by the caller rather than implemented here.
 */

import type { Collection } from '../types/collection';
import { McpDispatchServices, McpRunCallbacks, McpToolContext } from './mcp-handlers/types';
import { GENERIC_TOOL_REGISTRY } from './mcp-handlers/registry';
import type { McpRunStore } from './mcp-run-store';
import { GENERIC_TOOL_NAMES, type GenericToolName } from './mcp-tool-schemas';

export type { McpDispatchServices, McpRunCallbacks } from './mcp-handlers/types';

export { applyMcpBodyTruncation, MCP_MAX_BODY_CHARS } from './mcp-handlers/helpers';

/** Tools that write to disk and should bust the MCP tool-list cache after execution. */
export const CACHE_BUSTING_TOOLS = new Set<string>([
  GENERIC_TOOL_NAMES.createCollection,
  GENERIC_TOOL_NAMES.renameCollection,
  GENERIC_TOOL_NAMES.deleteCollection,
  GENERIC_TOOL_NAMES.duplicateCollection,
  GENERIC_TOOL_NAMES.createFolder,
  GENERIC_TOOL_NAMES.deleteFolder,
  GENERIC_TOOL_NAMES.createRequest,
  GENERIC_TOOL_NAMES.updateRequest,
  GENERIC_TOOL_NAMES.deleteRequest,
  GENERIC_TOOL_NAMES.reorderCollectionItems,
  GENERIC_TOOL_NAMES.createSuite,
  GENERIC_TOOL_NAMES.updateSuiteConfig,
  GENERIC_TOOL_NAMES.addSuiteNode,
  GENERIC_TOOL_NAMES.updateSuiteNode,
  GENERIC_TOOL_NAMES.removeSuiteNode,
  GENERIC_TOOL_NAMES.moveSuiteNode,
  GENERIC_TOOL_NAMES.duplicateSuite,
  GENERIC_TOOL_NAMES.deleteSuite,
  // API Architect — creates a collection + suite from intent; bust the tool-list cache.
  GENERIC_TOOL_NAMES.designApiFromIntent,
]);

function badRequest(msg: string): Error {
  return new Error(`Bad request: ${msg}`);
}

/**
 * Dispatch one generic (argument-selected) MCP tool.
 *
 * @param tool       The tool name constant from GENERIC_TOOL_NAMES.
 * @param args       Raw arguments object from the MCP tools/call payload.
 * @param services   Live service instances from either server's DI container.
 * @param runStore   The caller's McpRunStore instance (each server owns one).
 * @param callbacks  Implementation-specific run-* execution callbacks.
 */
export async function dispatchGenericTool(
  tool: GenericToolName,
  args: Record<string, unknown>,
  services: McpDispatchServices,
  runStore: McpRunStore,
  callbacks: McpRunCallbacks
): Promise<unknown> {
  const handler = GENERIC_TOOL_REGISTRY.get(tool);
  if (!handler) {
    throw badRequest(`unknown tool: "${tool}"`);
  }
  const collections: Collection[] = services.collection.getAllCollections();
  const ctx: McpToolContext = { tool, args, services, runStore, callbacks, collections };
  return handler.handle(ctx);
}
