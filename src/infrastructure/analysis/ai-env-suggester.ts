/**
 * AI Environment Variable Suggester (platform-agnostic)
 *
 * Uses any IAiProvider to scan a collection for hardcoded values and produce
 * EnvSuggestion objects — the same shape returned by the rule-based suggester
 * in env-suggester.ts, so apply logic is shared.
 *
 * Platform-independent: no Node.js or VS Code dependency.
 */

import { flattenRequests } from '../../runtime/mcp-collection-utils';
import type { Collection, CollectionRequestItem } from '../../types/collection';
import type { IAiProvider } from '../ai/ai-provider';
import { extractJsonFromLlm, withAiRetry } from '../ai/ai-utils';
import { assembleBusinessContext, requestKnowledgeSource } from '../ai/ai-context';
import type { EnvSuggestion } from './env-suggester';
import { toVarName } from '../../utils/env-hints';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Ask the AI to scan a collection for hardcoded values that should become
 * environment variables. Returns suggestions in the same `EnvSuggestion` shape
 * used by the rule-based detector so `applyEnvSuggestionsToItems` works for both.
 *
 * @param collection  The collection to scan.
 * @param aiProvider  Any IAiProvider (Copilot, OpenAI, Anthropic, …).
 * @returns           Suggestions sorted by occurrence count descending.
 */
export async function scanCollectionForEnvVarsWithAi(
  collection: Collection,
  aiProvider: IAiProvider,
  collectionService?: Pick<import('../../types/collection').ICollectionService, 'getRequestDetail'>
): Promise<EnvSuggestion[]> {
  const requests = flattenRequests(collection).map((f) => f.request);

  if (requests.length === 0) return [];

  // Collections load light (metadata only): hydrate heavy fields (body/doc)
  // before sending them to the AI. Skipped when no service is supplied (tests).
  const hydrated = collectionService
    ? requests.slice(0, 30).map((r) => collectionService.getRequestDetail(collection.id, r.id) ?? r)
    : requests.slice(0, 30);
  const summary = assembleBusinessContext(hydrated.map((r) => requestKnowledgeSource(r)));

  const prompt =
    `You are an API testing expert scanning an HTTP collection for hardcoded values.\n` +
    `Find all values that should be extracted to environment variables: base URLs, API keys/tokens, tenant or org IDs, user IDs, repeated hostnames.\n` +
    `Skip: HTTP methods, standard header names (Content-Type, Accept, Authorization key names), empty values, boolean literals, short numeric IDs.\n\n` +
    `Collection: "${collection.name}"\n` +
    (collection.description?.trim() ? `Description: ${collection.description.trim().slice(0, 300)}\n` : '') +
    `\n${summary}\n\n` +
    `Return ONLY a valid JSON array (no markdown fences):\n` +
    `[{"value":"exact hardcoded string","suggestedName":"UPPER_SNAKE_CASE_NAME","reason":"one sentence","requestIds":["id1","id2"]}]`;

  const raw = await withAiRetry(() => aiProvider.complete(prompt));

  const aiResults = extractJsonFromLlm<Array<{ value: string; suggestedName: string; reason: string; requestIds: string[] }>>(raw);
  if (!Array.isArray(aiResults)) return [];

  return aiResults
    .filter((s) => s.value && s.suggestedName)
    .map((s) => ({
      varName: toVarName(s.suggestedName),
      value: s.value,
      reason: s.reason ?? '',
      occurrences: findOccurrences(requests, s.value),
    }))
    .filter((s) => s.occurrences.length > 0)
    .sort((a, b) => b.occurrences.length - a.occurrences.length);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findOccurrences(
  requests: CollectionRequestItem[],
  value: string
): Array<{ requestId: string; requestName: string; field: string }> {
  const results: Array<{ requestId: string; requestName: string; field: string }> = [];
  for (const r of requests) {
    const rName = r.name ?? r.url ?? r.id;
    if (r.url?.includes(value)) {
      results.push({ requestId: r.id, requestName: rName, field: 'URL' });
    }
    for (const h of r.headers ?? []) {
      if (String(h.value ?? '').includes(value)) {
        results.push({ requestId: r.id, requestName: rName, field: `Header: ${h.key}` });
      }
    }
    for (const q of r.query ?? []) {
      if (String(q.value ?? '').includes(value)) {
        results.push({ requestId: r.id, requestName: rName, field: `Query: ${q.key}` });
      }
    }
    if (r.body?.type === 'raw' && typeof r.body.content === 'string' && r.body.content.includes(value)) {
      results.push({ requestId: r.id, requestName: rName, field: 'Body' });
    }
  }
  return results;
}
