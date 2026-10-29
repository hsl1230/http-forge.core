/**
 * Shared MCP tool-name encoding / decoding.
 *
 * MCP tool names must stay under Anthropic's 128-character limit. HTTP Forge
 * IDs embed the human-readable entity name (up to ~100 chars each), so a raw
 * tool name like `request__<collectionId>__<requestId>` can exceed 240 chars
 * and be rejected by the model provider.
 *
 * To balance discoverability and the length limit we embed the raw ID verbatim
 * when it is a safe, short segment (so names stay human-readable), and otherwise
 * substitute a deterministic short hash token. A whole-name length guard re-hashes
 * every segment when the assembled name would still be too long. A call resolves
 * back to the real entity by matching the segment against the current
 * collections / requests / folders / suites (raw equality OR hash), so both raw
 * and hashed names — including previously-listed long names — keep working.
 *
 * IDs are NOT changed — they remain the stable external references used by
 * suites, result filenames, and history. Only the tool *name* is shortened.
 *
 * The model selects a tool by its *description* (which still contains the
 * human-readable names), so the exact tool name does not affect tool choice.
 */

import { createHash } from 'crypto';

/** Length of the hex token embedded in tool names (48 bits of entropy). */
const TOKEN_LENGTH = 12;

/** Readable slug prefix length for hashed segments. */
const TOKEN_SLUG_LENGTH = 16;

/**
 * Max length of a raw (un-hashed) id segment embedded verbatim in a tool name.
 * HTTP Forge ids start with a human-readable slug, so when an id is short enough
 * we keep it as-is for discoverability instead of replacing it with a hash.
 */
const MAX_RAW_SEGMENT = 60;

/**
 * Assembled tool names are kept under this length so they stay comfortably below
 * the provider hard limit of 128 chars (margin left for the configurable prefix).
 * If a name would exceed this, every id segment falls back to a short hash token.
 */
const SAFE_MAX_NAME_LENGTH = 126;

function mcpToolHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, TOKEN_LENGTH);
}

function tokenSlug(value: string): string {
  const slug = value
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  if (!slug) return 'id';
  return slug.slice(0, TOKEN_SLUG_LENGTH);
}

/**
 * Deterministic readable token for an ID or folder path.
 *
 * Shape: `<slug>_<hash12>`
 */
export function mcpToolToken(value: string): string {
  return `${tokenSlug(value)}_${mcpToolHash(value)}`;
}

/**
 * A segment may be embedded verbatim only when it is non-empty, uses the MCP-safe
 * charset, contains no `__` delimiter (which would corrupt parsing), and is short
 * enough. Otherwise it must be hashed.
 */
function isSafeRawSegment(value: string, maxLen: number): boolean {
  return (
    value.length > 0 &&
    value.length <= maxLen &&
    /^[a-zA-Z0-9_-]+$/.test(value) &&
    !value.includes('__')
  );
}

/**
 * Return `value` verbatim when it is a safe, short raw segment (discoverable),
 * otherwise its deterministic hash token. Either way the result never contains
 * `__`, so tool-name parsing by `split('__')` stays unambiguous.
 * 
 * @param value The value to be used as a tool segment.
 * @param maxLen The maximum length of the raw segment before falling back to a hash token.
 * @returns A string representing the tool segment, either raw or hashed.
 */
export function mcpToolSegment(value: string, maxLen: number = MAX_RAW_SEGMENT): string {
  return isSafeRawSegment(value, maxLen) ? value : mcpToolToken(value);
}

export type McpToolKind = 'request' | 'collection' | 'folder' | 'suite';

// ── Name builders ──────────────────────────────────────────────────────────
// Each builder prefers raw ids for readability, but re-hashes ALL segments if the
// assembled name would exceed SAFE_MAX_NAME_LENGTH so the 128-char limit always holds.

export function buildRequestToolName(prefix: string, collectionId: string, requestId: string): string {
  const name = `${prefix}request__${mcpToolSegment(collectionId)}__${mcpToolSegment(requestId)}`;
  if (name.length <= SAFE_MAX_NAME_LENGTH) return name;
  return `${prefix}request__${mcpToolToken(collectionId)}__${mcpToolToken(requestId)}`;
}

export function buildCollectionToolName(prefix: string, collectionId: string): string {
  const name = `${prefix}collection__${mcpToolSegment(collectionId, 100)}`;
  if (name.length <= SAFE_MAX_NAME_LENGTH) return name;
  return `${prefix}collection__${mcpToolToken(collectionId)}`;
}

export function buildFolderToolName(prefix: string, collectionId: string, folderPath: string): string {
  const name = `${prefix}folder__${mcpToolSegment(collectionId)}__${mcpToolSegment(folderPath)}`;
  if (name.length <= SAFE_MAX_NAME_LENGTH) return name;
  return `${prefix}folder__${mcpToolToken(collectionId)}__${mcpToolToken(folderPath)}`;
}

export function buildSuiteToolName(prefix: string, suiteId: string): string {
  const name = `${prefix}suite__${mcpToolSegment(suiteId, 100)}`;
  if (name.length <= SAFE_MAX_NAME_LENGTH) return name;
  return `${prefix}suite__${mcpToolToken(suiteId)}`;
}

// ── Parsing ────────────────────────────────────────────────────────────────

export interface ParsedMcpToolName {
  kind: McpToolKind;
  tokens: string[];
}

/** Parse a tool name (prefix already stripped) into its kind + token segments. */
export function parseMcpToolName(name: string): ParsedMcpToolName {
  for (const kind of ['request', 'collection', 'folder', 'suite'] as const) {
    const head = `${kind}__`;
    if (name.startsWith(head)) {
      return { kind, tokens: name.slice(head.length).split('__') };
    }
  }
  throw new Error(`Unknown MCP tool name: ${name}`);
}

// ── Resolution ─────────────────────────────────────────────────────────────

/**
 * Resolve a token back to one of `candidates` by matching its hash token, or
 * (legacy fallback) the raw candidate value itself.
 */
export function resolveToken(token: string, candidates: readonly string[]): string | undefined {
  const hashPart = token.includes('_') ? token.slice(token.lastIndexOf('_') + 1) : token;

  // Preferred match: compare by hash suffix so token format can evolve while
  // keeping deterministic reverse lookup.
  for (const candidate of candidates) {
    if (mcpToolHash(candidate) === hashPart) return candidate;
  }

  // Full-token exact match (current format)
  for (const candidate of candidates) {
    if (mcpToolToken(candidate) === token) return candidate;
  }

  // Legacy fallback: tool names emitted before hashing embedded the raw ID.
  for (const candidate of candidates) {
    if (candidate === token) return candidate;
  }
  return undefined;
}

/**
 * Resolve a folder token to a folder path. Adds a base64url legacy fallback for
 * folder tool names emitted before hashing (which embedded base64url(path)).
 */
export function resolveFolderToken(token: string, folderPaths: readonly string[]): string | undefined {
  const direct = resolveToken(token, folderPaths);
  if (direct !== undefined) return direct;
  // Legacy fallback: old folder tokens were base64url(folderPath).
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    if (folderPaths.includes(decoded)) return decoded;
  } catch {
    /* not valid base64url — ignore */
  }
  return undefined;
}

// ── Description builders (shared for consistent fuzzy matching) ─────────────
// Descriptions carry the human-readable names so the model can map inexact
// user phrasing (e.g. "run login in my api") to the right tool.

export function buildRequestToolDescription(
  method: string,
  requestName: string,
  collectionName: string,
  folderPath: string
): string {
  const where = folderPath ? ` in folder "${folderPath}"` : '';
  return `Run the "${requestName}" request [${method}]${where} of the "${collectionName}" collection.`;
}

export function buildCollectionToolDescription(collectionName: string, requestCount: number): string {
  return `Run all ${requestCount} requests in the "${collectionName}" collection.`;
}

export function buildFolderToolDescription(
  folderPath: string,
  collectionName: string,
  requestCount: number
): string {
  return `Run all ${requestCount} requests in folder "${folderPath}" of the "${collectionName}" collection.`;
}

export function buildSuiteToolDescription(
  suiteName: string,
  requestCount: number,
  iterations: number
): string {
  return `Run the "${suiteName}" test suite (${requestCount} requests, ${iterations} iteration(s) by default).`;
}
