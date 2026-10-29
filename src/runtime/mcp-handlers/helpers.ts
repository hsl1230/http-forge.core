/**
 * Shared helpers for MCP generic tool handlers.
 *
 * These were lifted out of the original monolithic dispatcher so that every
 * tool handler can reuse them without duplicating logic.
 */

import type { Collection, CollectionFolderItem, CollectionItem, CollectionRequestItem } from '../../types/collection';
import { decodeFolderPath, enumerateFolders, flattenRequests, normalizeFolderInput } from '../mcp-collection-utils';
import type { McpDispatchServices } from './types';

export { decodeFolderPath, enumerateFolders, flattenRequests, normalizeFolderInput } from '../mcp-collection-utils';

/** Build a "Bad request" error used across all tool handlers. */
export function badRequest(msg: string): Error {
  return new Error(`Bad request: ${msg}`);
}

/** Resolve a collection by id, exact name, case-insensitive name, or substring. */
export function resolveCollectionByLabel(
  label: unknown,
  collections: Collection[]
): Collection {
  if (typeof label !== 'string' || !label.trim()) {
    throw badRequest('the "collection" argument is required');
  }
  const q = label.toLowerCase();
  const col =
    collections.find((c) => c.id === label || c.name === label) ??
    collections.find((c) => c.name.toLowerCase() === q) ??
    collections.find((c) => c.name.toLowerCase().includes(q)) ??
    collections.find((c) => c.id.toLowerCase().includes(q));
  if (!col) {
    const names = collections.map((c) => `"${c.name}"`).join(', ');
    throw badRequest(
      `collection not found: "${label}". Available collections: ${names || '(none)'}. ` +
      `Call list_collections to see all.`
    );
  }
  return col;
}

/**
 * Resolve a request inside a collection by id, exact name, or case-insensitive
 * name/substring.
 */
export function resolveRequestByLabel(
  label: unknown,
  col: Collection
): CollectionRequestItem {
  if (typeof label !== 'string' || !label.trim()) {
    throw badRequest('the "request" argument is required');
  }
  const flat = flattenRequests(col);
  const q = label.toLowerCase();
  const found =
    flat.find((r) => r.request.id === label || r.request.name === label) ??
    flat.find((r) => r.request.name.toLowerCase() === q) ??
    flat.find((r) => r.request.name.toLowerCase().includes(q));
  if (!found) {
    const names = flat.slice(0, 10).map((r) => `"${r.request.name}"`).join(', ');
    throw badRequest(
      `request "${label}" not found in collection "${col.name}". ` +
      `First ${Math.min(flat.length, 10)} requests: ${names || '(none)'}. ` +
      `Call list_requests or search_requests to find the exact name.`
    );
  }
  return found.request;
}

/**
 * Hydrate a tree-resolved request with heavy fields (body/scripts/schemas/doc).
 * Collections load light (metadata only); single-request readers must call this
 * before touching heavy fields. Falls back to the passed item on stores
 * without lazy support. List/match paths keep using light refs untouched.
 */
export function hydrateRequest(
  services: McpDispatchServices,
  collectionId: string,
  req: CollectionRequestItem
): CollectionRequestItem {
  return services.collection.getRequestDetail(collectionId, req.id) ?? req;
}

/**
 * Find a folder item in a collection tree by its ID.
 *
 * Uses the folder ID (from enumerateFolders) rather than splitting the
 * slash-separated path string — this correctly handles folder names that
 * contain '/' characters, which would otherwise be indistinguishable from
 * path separators.
 */
export function findFolderById(
  items: CollectionItem[],
  folderId: string
): CollectionFolderItem | undefined {
  for (const item of items) {
    if (item.type !== 'folder') continue;
    const folder = item as CollectionFolderItem;
    if (folder.id === folderId) return folder;
    const found = findFolderById(folder.items ?? [], folderId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Resolve a test suite by id or by exact / case-insensitive name.
 */
export async function resolveSuiteByLabel(
  label: unknown,
  services: McpDispatchServices
): Promise<import('../../infrastructure/test-suite/interfaces').TestSuite> {
  if (typeof label !== 'string' || !label.trim()) {
    throw badRequest('the "suite" argument is required');
  }
  const suites = await services.testSuite.getAllSuites();
  const q = label.toLowerCase();
  const suite =
    suites.find((s) => s.id === label || s.name === label) ??
    suites.find((s) => s.name.toLowerCase() === q);
  if (!suite) {
    const names = suites.map((s) => `"${s.name}"`).join(', ');
    throw badRequest(
      `suite "${label}" not found. Available suites: ${names || '(none)'}. ` +
      `Call list_suites to see all.`
    );
  }
  return suite;
}

/**
 * Flatten a collection tree into request items, re-exported from the
 * collection utils so handlers can rely on one import site.
 */

// ── MCP-layer body truncation ─────────────────────────────────────────────────
// Applied ONLY at this layer so CLI / SDK consumers always receive full bodies.

export const MCP_MAX_BODY_CHARS = 4096;

function truncateMcpBodyField(raw: unknown, include: string[]): unknown {
  if (include.includes('fullBody') || raw == null) return raw;
  const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (str.length <= MCP_MAX_BODY_CHARS) return raw;
  let excerpt: unknown;
  try { excerpt = JSON.parse(str.slice(0, MCP_MAX_BODY_CHARS)); } catch { excerpt = str.slice(0, MCP_MAX_BODY_CHARS); }
  return {
    _truncated: true,
    excerpt,
    totalLength: str.length,
    hint: 'Body truncated. Pass include:["fullBody"] to get the complete body, or include:["report"] (collection/suite runs only) to generate an HTML report with full details.',
  };
}

/**
 * Post-process a run result before returning it to the AI:
 *  - truncates `result.body`            (run_request)
 *  - truncates `result.failedRequests[N].body`  (run_collection / run_folder / run_suite / get_run_summary)
 * No-op when `include` contains `'fullBody'` or when the result has no body fields.
 */
export function applyMcpBodyTruncation(result: unknown, include: string[]): unknown {
  if (include.includes('fullBody') || result == null || typeof result !== 'object') return result;
  const r = result as Record<string, unknown>;
  let changed = false;
  const out: Record<string, unknown> = { ...r };

  if ('body' in out) {
    const truncated = truncateMcpBodyField(out.body, include);
    if (truncated !== out.body) { out.body = truncated; changed = true; }
  }

  if (Array.isArray(out.failedRequests)) {
    const truncatedList = (out.failedRequests as unknown[]).map((req) => {
      if (req == null || typeof req !== 'object') return req;
      const r2 = req as Record<string, unknown>;
      if (!('body' in r2)) return r2;
      const tb = truncateMcpBodyField(r2.body, include);
      return tb !== r2.body ? { ...r2, body: tb } : r2;
    });
    out.failedRequests = truncatedList;
    changed = true;
  }

  return changed ? out : result;
}
