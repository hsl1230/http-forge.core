/**
 * Environment Variable Suggester (rule-based)
 *
 * Scans an HTTP Forge collection for hardcoded values (auth tokens, API keys,
 * shared base URLs, …) and suggests replacing them with environment variable
 * placeholders (`{{VAR_NAME}}`).
 *
 * No AI dependency — detection is entirely heuristic:
 *   1. `Authorization` header values (Bearer / Basic / Token / Digest)
 *   2. Common sensitive header names (X-API-Key, X-Auth-Token, …)
 *   3. Common sensitive query-param keys (api_key, access_token, …)
 *   4. Shared base URL across ≥ 2 requests  → BASE_URL
 *   5. Long opaque strings (≥ 20 chars) in any header value
 *
 * Platform-independent (no Node.js or VS Code dependency).
 */

import { flattenRequests } from '../../runtime/mcp-collection-utils';
import type { Collection, CollectionItem, CollectionRequestItem } from '../../types/collection';
import { isForgeVar, looksLikeSecret, SENSITIVE_HEADER_NAMES, SENSITIVE_QUERY_KEYS, toVarName } from '../../utils/env-hints';

// ─── Public types ─────────────────────────────────────────────────────────────

/** A single detected hardcoded-value candidate. */
export interface EnvSuggestion {
  /** Suggested variable name (e.g. `BEARER_TOKEN`). */
  varName: string;
  /** The hardcoded value found in the collection. */
  value: string;
  /** Human-readable explanation of why this was flagged. */
  reason: string;
  /** Every location where this value appears. */
  occurrences: Array<{ requestId: string; requestName: string; field: string }>;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface CandidateEntry {
  varName: string;
  reason: string;
  occurrences: Array<{ requestId: string; requestName: string; field: string }>;
  /** Lower = displayed first. */
  priority: number;
}

function addCandidate(
  map: Map<string, CandidateEntry>,
  value: string,
  varName: string,
  reason: string,
  occurrence: { requestId: string; requestName: string; field: string },
  priority = 10
): void {
  let entry = map.get(value);
  if (!entry) {
    entry = { varName, reason, occurrences: [], priority };
    map.set(value, entry);
  }
  const dedupeKey = `${occurrence.requestId}::${occurrence.field}`;
  if (!entry.occurrences.some((o) => `${o.requestId}::${o.field}` === dedupeKey)) {
    entry.occurrences.push(occurrence);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scan a collection and return suggestions for replacing hardcoded values with
 * environment variables.
 *
 * @param collection      The collection to analyse.
 * @param minOccurrences  Only return suggestions seen in at least this many
 *                        request locations (default: 1).
 */
export function detectEnvSuggestions(
  collection: Collection,
  minOccurrences = 1
): EnvSuggestion[] {
  const flat = flattenRequests(collection);
  const map = new Map<string, CandidateEntry>();

  // ── Per-request field analysis ────────────────────────────────────────────
  for (const { request } of flat) {
    const occ = (field: string) => ({
      requestId: request.id,
      requestName: request.name,
      field,
    });

    for (const h of request.headers ?? []) {
      if (h.enabled === false) continue;
      const lk = h.key.toLowerCase();
      const val = h.value;

      if (lk === 'authorization') {
        const m = val.match(/^(bearer|basic|token|digest)\s+(.+)$/i);
        if (m && looksLikeSecret(m[2])) {
          addCandidate(map, m[2], `${m[1].toUpperCase()}_TOKEN`, `Authorization ${m[1]} token`, occ(`header:${h.key}`), 1);
        } else if (looksLikeSecret(val)) {
          addCandidate(map, val, 'AUTH_TOKEN', 'Authorization header value', occ(`header:${h.key}`), 1);
        }
      } else if (SENSITIVE_HEADER_NAMES.has(lk) && looksLikeSecret(val)) {
        addCandidate(map, val, toVarName(h.key), `Sensitive header: ${h.key}`, occ(`header:${h.key}`), 2);
      } else if (looksLikeSecret(val, 20) && !val.includes(' ') && /^[A-Za-z0-9+/=_.-]+$/.test(val)) {
        addCandidate(map, val, toVarName(h.key) || 'HEADER_VALUE', `Long opaque value in header: ${h.key}`, occ(`header:${h.key}`), 5);
      }
    }

    for (const q of request.query ?? []) {
      if (q.enabled === false) continue;
      if (SENSITIVE_QUERY_KEYS.has(q.key.toLowerCase()) && looksLikeSecret(q.value)) {
        addCandidate(map, q.value, toVarName(q.key), `Sensitive query param: ${q.key}`, occ(`query:${q.key}`), 2);
      }
    }
  }

  // ── Shared base-URL detection ─────────────────────────────────────────────
  const urlBuckets = new Map<string, Array<{ requestId: string; requestName: string; field: string }>>();
  for (const { request } of flat) {
    if (!request.url || isForgeVar(request.url)) continue;
    try {
      const u = new URL(request.url);
      const isLocal = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(u.hostname);
      if (!isLocal) {
        const base = `${u.protocol}//${u.host}`;
        const bucket = urlBuckets.get(base) ?? [];
        bucket.push({ requestId: request.id, requestName: request.name, field: 'url' });
        urlBuckets.set(base, bucket);
      }
    } catch { /* skip un-parseable URLs */ }
  }
  for (const [base, occs] of urlBuckets) {
    if (occs.length >= Math.max(minOccurrences, 2) && !map.has(base)) {
      map.set(base, {
        varName: 'BASE_URL',
        reason: `Shared base URL across ${occs.length} requests`,
        occurrences: occs,
        priority: 3,
      });
    }
  }

  // ── Build sorted result ───────────────────────────────────────────────────
  return [...map.entries()]
    .filter(([, e]) => e.occurrences.length >= minOccurrences)
    .sort((a, b) => a[1].priority - b[1].priority || a[0].localeCompare(b[0]))
    .map(([value, e]) => ({
      varName: e.varName,
      value,
      reason: e.reason,
      occurrences: e.occurrences,
    }));
}

/**
 * Apply env-variable replacements to a collection's items in-place.
 *
 * For each suggestion, the hardcoded value is replaced with `{{VAR_NAME}}` in:
 *   - request URLs
 *   - header values (auth prefix like "Bearer " is preserved)
 *   - query-param values
 *
 * @param items        The mutable `CollectionItem[]` to modify.
 * @param suggestions  Which replacements to apply.
 * @returns            Map of `varName → replacement count`.
 */
export function applyEnvSuggestionsToItems(
  items: CollectionItem[],
  suggestions: Array<{ varName: string; value: string }>
): Record<string, number> {
  const counts: Record<string, number> = {};
  _applyToItems(items, suggestions, counts);
  return counts;
}

function _applyToItems(
  items: CollectionItem[],
  suggestions: Array<{ varName: string; value: string }>,
  counts: Record<string, number>
): void {
  for (const item of items) {
    if (item.type === 'folder') {
      if (item.items) _applyToItems(item.items, suggestions, counts);
      continue;
    }
    const req = item as CollectionRequestItem;
    for (const s of suggestions) {
      const ph = `{{${s.varName}}}`;

      if (req.url?.includes(s.value)) {
        req.url = req.url.split(s.value).join(ph);
        counts[s.varName] = (counts[s.varName] ?? 0) + 1;
      }

      for (const h of req.headers ?? []) {
        const authMatch = h.value.match(/^(bearer|basic|token|digest)\s+(.+)$/i);
        if (authMatch && authMatch[2] === s.value) {
          h.value = `${authMatch[1]} ${ph}`;
          counts[s.varName] = (counts[s.varName] ?? 0) + 1;
        } else if (h.value === s.value) {
          h.value = ph;
          counts[s.varName] = (counts[s.varName] ?? 0) + 1;
        }
      }

      for (const q of req.query ?? []) {
        if (q.value === s.value) {
          q.value = ph;
          counts[s.varName] = (counts[s.varName] ?? 0) + 1;
        }
      }
    }
  }
}
