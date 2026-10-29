/**
 * MCP generic tool registry.
 *
 * Assembles every tool handler into a name→handler map. This is the
 * Open/Closed extension point: adding a new tool means registering a new
 * handler here — never editing the dispatcher or existing handlers.
 */

import { GenericToolName } from '../mcp-tool-schemas';
import { aiHandlers } from './ai';
import { collectionHandlers } from './collection';
import { discoveryHandlers } from './discovery';
import { environmentHandlers } from './environment';
import { environmentManagementHandlers } from './environment-management';
import { executionHandlers } from './execution';
import { inspectionHandlers } from './inspection';
import { requestHandlers } from './request';
import { reviewHandlers } from './review';
import { runStatusHandlers } from './run-status';
import { suiteHandlers } from './suite';
import { McpToolHandler } from './types';
import { qaHandlers } from './qa';

const ALL_HANDLERS: McpToolHandler[] = [
  ...inspectionHandlers,
  ...environmentHandlers,
  ...runStatusHandlers,
  ...executionHandlers,
  ...collectionHandlers,
  ...requestHandlers,
  ...reviewHandlers,
  ...discoveryHandlers,
  ...qaHandlers,
  ...suiteHandlers,
  ...environmentManagementHandlers,
  ...aiHandlers,
];

function buildRegistry(): Map<GenericToolName, McpToolHandler> {
  const registry = new Map<GenericToolName, McpToolHandler>();
  for (const handler of ALL_HANDLERS) {
    for (const name of handler.toolNames) {
      registry.set(name, handler);
    }
  }
  return registry;
}

export const GENERIC_TOOL_REGISTRY: ReadonlyMap<GenericToolName, McpToolHandler> = buildRegistry();

/** Every tool name this registry knows how to dispatch. */
export const REGISTERED_TOOL_NAMES: ReadonlySet<string> = new Set(
  [...GENERIC_TOOL_REGISTRY.keys()].map((n) => n as string)
);
