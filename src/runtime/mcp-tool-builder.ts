/**
 * MCP Tool List Builder
 *
 * Single implementation of the tools/list response builder shared by both the
 * embedded core runtime and the VS Code extension's McpToolRegistry.
 *
 * Also exports cursor pagination helpers used by both HTTP servers.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { McpConfig } from '../infrastructure/config';
import type { TestSuite } from '../infrastructure/test-suite/interfaces';
import type { Collection } from '../types/collection';
import { enumerateFolders, flattenRequests } from './mcp-collection-utils';
import {
  buildCollectionToolDescription,
  buildCollectionToolName,
  buildFolderToolDescription,
  buildFolderToolName,
  buildRequestToolDescription,
  buildRequestToolName,
  buildSuiteToolDescription,
  buildSuiteToolName,
} from './mcp-tool-name';
import {
  buildGenericTools,
  COLLECTION_INPUT_SCHEMA,
  FOLDER_INPUT_SCHEMA,
  REQUEST_INPUT_SCHEMA,
  SUITE_INPUT_SCHEMA,
} from './mcp-tool-schemas';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

/** Remove tools that share an identical name, keeping the first occurrence. */
export function dedupeToolsByName(tools: McpTool[]): McpTool[] {
  const seen = new Set<string>();
  const result: McpTool[] = [];
  for (const t of tools) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    result.push(t);
  }
  return result;
}

// ── Cursor pagination ────────────────────────────────────────────────────────

/** Encode a numeric offset as an opaque base64url cursor string. */
export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64url');
}

/** Decode a cursor produced by encodeCursor; returns 0 for any invalid/absent value. */
export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const n = parseInt(Buffer.from(cursor, 'base64url').toString(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

// ── Tool list building ───────────────────────────────────────────────────────

/**
 * Tool name suffixes excluded in `execution-only` mode.
 * These are discovery and collection/suite management tools that AI agents
 * with file-system access can replace by reading/writing the plain-JSON
 * collection files directly — no MCP round-trip needed.
 */
const DISCOVERY_AND_MANAGEMENT_TOOL_SUFFIXES: string[] = [
  // Discovery
  'list_collections', 'list_folders', 'list_requests', 'search_requests',
  'get_request', 'get_request_script',
  'list_environments', 'get_environment', 'get_environment_variables',
  'list_suites', 'get_suite', 'get_suite_node', 'list_suite_node_paths',
  // Collection / folder / request management (file-editable)
  'create_collection', 'rename_collection', 'delete_collection', 'duplicate_collection',
  'create_folder', 'delete_folder',
  'create_request', 'update_request', 'delete_request', 'set_request_script',
  'reorder_collection_items',
  // Suite structure management (file-editable)
  'create_suite', 'update_suite_config',
  'add_suite_node', 'update_suite_node', 'remove_suite_node', 'move_suite_node',
  'add_suite_requests', 'remove_suite_request', 'reorder_suite_requests',
  'duplicate_suite', 'delete_suite',
  // Environment management (file-editable)
  'create_environment', 'delete_environment',
  // Source-code discovery (Phase 1/2a) — scans the project; not runtime
  // execution and not file-editable, so excluded from execution-only mode.
  'create_request_from_endpoint', 'generate_test_suite',
  'suggest_workflow', 'generate_workflow',
  'check_drift', 'propose_update',
  // QA gate — discovers, generates, and executes; not runtime execution.
  'qa_api',
  // API Architect (Phase 4/L8) — designs new collections from intent; not runtime execution.
  'design_api_from_intent',
  // Review gate (Phase 3) — reads run results; not runtime execution.
  'review_suite',
];

/**
 * Build the full tools/list payload from pre-filtered collections and suites.
 *
 * The caller is responsible for applying exclusion filters before passing the
 * arrays here.  This function is pure — it reads no disk state.
 *
 * @param workspaceFolder - Optional path to the workspace root. When supplied
 *   and `toolMode` is `auto`, the function checks whether `.http-forge/AGENTS.md`
 *   exists. If it does, the workspace has been prepared for AI file-based editing
 *   and `execution-only` is used instead of `drilldown`, saving ~60 % of tool-list
 *   tokens without any manual configuration.
 */
export function buildMcpToolList(
  collections: Collection[],
  suites: TestSuite[],
  config: McpConfig,
  workspaceFolder?: string
): McpTool[] {
  const prefix = config.toolPrefix ?? '';
  let mode = config.toolMode ?? 'auto';
  const threshold = config.drilldownThreshold ?? 100;

  // execution-only: drilldown tool set minus discovery and collection/suite management tools.
  // AI agents with file-system access can read/write collection JSON files directly;
  // only the runtime execution and results tools genuinely require MCP.
  if (mode === 'execution-only') {
    const all = buildGenericTools(
      prefix,
      collections.map((c) => c.name),
      suites.map((s) => s.name)
    );
    return dedupeToolsByName(
      all
        .filter((t) => !DISCOVERY_AND_MANAGEMENT_TOOL_SUFFIXES.some((s) => t.name.endsWith(s)))
        .map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          ...(t.annotations && { annotations: t.annotations }),
        }))
    );
  }

  // Count request tools that flat mode would emit
  let requestToolCount = 0;
  for (const col of collections) {
    requestToolCount += flattenRequests(col).length;
  }

  const useDrilldown =
    mode === 'drilldown' || (mode === 'auto' && requestToolCount > threshold);

  // auto + local workspace with AGENTS.md → execution-only instead of drilldown.
  // AGENTS.md is written by FolderCollectionStore.ensureDirectory() on first init,
  // so its presence means this workspace was prepared for AI file-based editing.
  if (useDrilldown && mode === 'auto' && workspaceFolder) {
    const agentsMd = path.join(workspaceFolder, '.http-forge', 'AGENTS.md');
    if (fs.existsSync(agentsMd)) {
      mode = 'execution-only';
    }
  }

  if (mode === 'flat' && requestToolCount > 500) {
    console.warn(
      `[http-forge MCP] WARNING: toolMode is "flat" but ${requestToolCount} requests would produce ` +
      `${requestToolCount}+ tools. This will likely degrade AI tool-selection quality and bloat ` +
      `the context window. Consider setting toolMode to "auto" or "drilldown" in http-forge.config.json.`
    );
  }

  if (useDrilldown) {
    return dedupeToolsByName(
      buildGenericTools(
        prefix,
        collections.map((c) => c.name),
        suites.map((s) => s.name)
      ).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.annotations && { annotations: t.annotations }),
      }))
    );
  }

  // Flat mode: one tool per request / folder / collection / suite
  const tools: McpTool[] = [];

  for (const col of collections) {
    const flat = flattenRequests(col);

    for (const { request, folderPath } of flat) {
      tools.push({
        name: buildRequestToolName(prefix, col.id, request.id),
        description: buildRequestToolDescription(request.method, request.name, col.name, folderPath),
        inputSchema: REQUEST_INPUT_SCHEMA,
      });
    }

    tools.push({
      name: buildCollectionToolName(prefix, col.id),
      description: buildCollectionToolDescription(col.name, flat.length),
      inputSchema: COLLECTION_INPUT_SCHEMA,
    });

    for (const { folderPath, requestCount } of enumerateFolders(col)) {
      if (requestCount === 0) continue;
      tools.push({
        name: buildFolderToolName(prefix, col.id, folderPath),
        description: buildFolderToolDescription(folderPath, col.name, requestCount),
        inputSchema: FOLDER_INPUT_SCHEMA,
      });
    }
  }

  for (const suite of suites) {
    tools.push({
      name: buildSuiteToolName(prefix, suite.id),
      description: buildSuiteToolDescription(
        suite.name,
        (suite.nodes.filter(n => (n as any).type === 'request').length),
        suite.config.iterations
      ),
      inputSchema: SUITE_INPUT_SCHEMA,
    });
  }

  return dedupeToolsByName(tools);
}
