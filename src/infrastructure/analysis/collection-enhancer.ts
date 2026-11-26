/**
 * AI Collection Enhancer
 *
 * Post-import pass that uses an IAiProvider to:
 *  1. Generate realistic request body examples (replacing schema-inferred placeholders)
 *  2. Write a postResponse test script for each request (status checks + schema assertions)
 *
 * Platform-independent — no VS Code or Node.js-specific dependency.
 * The caller supplies the AI provider implementation.
 */

import { extractJsonFromLlm, withAiRetry } from '../ai/ai-utils';
import { assembleBusinessContext, requestKnowledgeSource } from '../ai/ai-context';
import type { Collection, CollectionItem, CollectionRequestItem, ICollectionService } from '../../types/collection';
import type { IAiProvider } from '../ai/ai-provider';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EnhancementInput {
    id: string;
    name: string;
    method: string;
    url: string;
    bodyContent?: string;
    responseSchema?: string;
    description?: string;
    doc?: string;
    operationId?: string;
    tags?: string[];
}

interface EnhancementOutput {
    id: string;
    body?: string | null;
    testScript?: string;
}

/** Progress callback: (message, percentIncrement) */
export type EnhanceProgressCallback = (message: string, increment: number) => void;

// ─── Public API ───────────────────────────────────────────────────────────────

/** Max requests sent to the AI in a single prompt (keeps token budget bounded). */
const BATCH_SIZE = 10;

/**
 * Enhance a collection with AI-generated body examples and test scripts.
 *
 * @param collection       The collection to enhance (mutated in place, then saved).
 * @param collectionService Service used to persist the collection after enhancement.
 * @param aiProvider       AI backend to use (Copilot, OpenAI, Anthropic, …).
 * @param onProgress       Optional progress callback fired once per batch.
 */
export async function enhanceCollection(
    collection: Collection,
    collectionService: ICollectionService,
    aiProvider: IAiProvider,
    onProgress?: EnhanceProgressCallback
): Promise<void> {
    const requests = collectAllRequests(collection.items);
    if (requests.length === 0) return;

    const totalBatches = Math.ceil(requests.length / BATCH_SIZE);

    for (let i = 0; i < requests.length; i += BATCH_SIZE) {
        const batch = requests.slice(i, i + BATCH_SIZE).map(
            // Collections load light (metadata only): hydrate heavy fields
            // (body/schemas/doc) before sending them to the AI.
            (r) => collectionService.getRequestDetail(collection.id, r.id) ?? r
        );
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;

        onProgress?.(
            `Enhancing requests (batch ${batchNum}/${totalBatches})…`,
            (1 / totalBatches) * 100
        );

        const inputs: EnhancementInput[] = batch.map(r => ({
            id: r.id,
            name: r.name,
            method: r.method ?? 'GET',
            url: r.url ?? '',
            bodyContent: extractBodyContent(r),
            responseSchema: r.responseSchema
                ? JSON.stringify(r.responseSchema).slice(0, 500)
                : undefined,
            description: r.description?.slice(0, 200),
            doc: r.doc ? r.doc.slice(0, 800) : undefined,
            operationId: r.operationId,
            tags: r.tags?.slice(0, 5),
        }));

        try {
            const raw = await withAiRetry(() => aiProvider.complete(buildPrompt(inputs, batch)));
            const outputs = parseAiResponse(raw);
            applyEnhancements(batch, outputs);
        } catch {
            // Batch failure is non-fatal — continue with remaining batches
        }
    }

    await collectionService.saveCollection(collection);
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(inputs: EnhancementInput[], batch: CollectionRequestItem[]): string {
    const businessCtx = assembleBusinessContext(batch.map(r => requestKnowledgeSource(r)));

    return `You are an API testing expert. For each HTTP request below, return two improvements:
1. "body" — a realistic, human-readable JSON request body string (not schema placeholders like "string" or 0). If the request has no body or is a GET/HEAD/DELETE, return null.
2. "testScript" — a JavaScript postResponse test using pm.test() syntax. Always include a status code check. Add response body assertions if a responseSchema is provided.

Business context (use this to generate realistic values that match the documented API contract):
${businessCtx || '(none provided — use generic realistic values)'}

Input requests (JSON array):
${JSON.stringify(inputs, null, 2)}

Return ONLY a valid JSON array matching this shape (no markdown fences, no extra text):
[{"id":"<request id>","body":"<JSON string or null>","testScript":"<JS string>"}]

Rules:
- Keep "body" as a valid JSON string (escaped). Use realistic values, not placeholder strings.
- Keep "testScript" as valid JS. Use pm.test(), pm.response.to.have.status(), pm.expect().
- One output object per input, same order, same id.`;
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseAiResponse(raw: string): EnhancementOutput[] {
    const parsed = extractJsonFromLlm<EnhancementOutput[]>(raw);
    return Array.isArray(parsed) ? parsed : [];
}

// ─── Apply ────────────────────────────────────────────────────────────────────

function applyEnhancements(requests: CollectionRequestItem[], outputs: EnhancementOutput[]): void {
    const byId = new Map(outputs.map(o => [o.id, o]));

    for (const req of requests) {
        const out = byId.get(req.id);
        if (!out) continue;

        if (out.body && req.body?.type === 'raw') {
            try {
                JSON.parse(out.body); // validate before applying
                (req.body as any).content = out.body;
            } catch { /* skip invalid JSON body */ }
        }

        if (out.testScript?.trim()) {
            if (!req.scripts) req.scripts = {};
            if (!req.scripts.postResponse) {
                req.scripts.postResponse = out.testScript.trim();
            }
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function collectAllRequests(items: CollectionItem[]): CollectionRequestItem[] {
    const results: CollectionRequestItem[] = [];
    for (const item of items) {
        if (item.type === 'request') {
            results.push(item);
        } else if (item.type === 'folder' && item.items) {
            results.push(...collectAllRequests(item.items));
        }
    }
    return results;
}

function extractBodyContent(r: CollectionRequestItem): string | undefined {
    if (r.body?.type === 'raw' && typeof r.body.content === 'string') {
        return r.body.content.slice(0, 300);
    }
    return undefined;
}

// ─── Structural Improvements ──────────────────────────────────────────────────

export interface StructuralSuggestion {
    type: 'rename' | 'move' | 'merge' | 'split' | 'reorder' | 'duplicate';
    targetId: string;
    description: string;
    proposedValue?: string;
}

/**
 * Analyze a collection and suggest structural improvements.
 * Returns suggestions (does not mutate the collection).
 */
export function suggestStructuralImprovements(collection: Collection): StructuralSuggestion[] {
    const suggestions: StructuralSuggestion[] = [];
    const requests = collectAllRequests(collection.items);

    // 1. Detect duplicate names
    const nameCounts = new Map<string, string[]>();
    for (const r of requests) {
        const lower = r.name.toLowerCase().trim();
        if (!nameCounts.has(lower)) nameCounts.set(lower, []);
        nameCounts.get(lower)!.push(r.id);
    }
    for (const [name, ids] of nameCounts) {
        if (ids.length > 1) {
            suggestions.push({
                type: 'duplicate',
                targetId: ids[1],
                description: `Duplicate request name "${name}" found ${ids.length} times. Consider renaming or merging.`,
            });
        }
    }

    // 2. Detect requests without descriptions
    for (const r of requests) {
        if (!r.description && !r.doc) {
            suggestions.push({
                type: 'rename',
                targetId: r.id,
                description: `Request "${r.name}" has no description. Consider adding one for documentation.`,
            });
        }
    }

    // 3. Detect inconsistent naming (mixed case styles)
    const hasSpaces = requests.some((r) => r.name.includes(' '));
    const hasCamelCase = requests.some((r) => /[a-z][A-Z]/.test(r.name));
    const hasSnakeCase = requests.some((r) => r.name.includes('_'));
    const styles = [hasSpaces, hasCamelCase, hasSnakeCase].filter(Boolean).length;
    if (styles > 1) {
        suggestions.push({
            type: 'rename',
            targetId: requests[0]?.id || '',
            description: 'Mixed naming styles detected (spaces, camelCase, snake_case). Consider standardizing.',
        });
    }

    // 4. Detect empty folders
    const folders = collectFolders(collection.items);
    for (const folder of folders) {
        const items = (folder as any).items || [];
        if (items.length === 0) {
            suggestions.push({
                type: 'split',
                targetId: (folder as any).id || '',
                description: `Empty folder "${(folder as any).name || 'unnamed'}" detected. Consider removing or populating.`,
            });
        }
    }

    return suggestions;
}

/**
 * Apply structural suggestions to a collection (mutates in place).
 * Currently supports: rename (updates name), and returns the modified collection.
 */
export function applyStructuralSuggestions(
    collection: Collection,
    suggestions: StructuralSuggestion[]
): { applied: number; skipped: number } {
    let applied = 0;
    let skipped = 0;
    const requests = collectAllRequests(collection.items);

    for (const suggestion of suggestions) {
        const req = requests.find((r) => r.id === suggestion.targetId);
        if (!req) { skipped++; continue; }

        switch (suggestion.type) {
            case 'rename':
                if (suggestion.proposedValue) {
                    req.name = suggestion.proposedValue;
                    applied++;
                } else {
                    skipped++;
                }
                break;
            default:
                skipped++;
                break;
        }
    }

    return { applied, skipped };
}

function collectFolders(items: CollectionItem[]): CollectionItem[] {
    const folders: CollectionItem[] = [];
    const walk = (list: CollectionItem[]) => {
        for (const item of list) {
            if (item.type === 'folder') {
                folders.push(item);
                if (item.items) walk(item.items);
            }
        }
    };
    walk(items);
    return folders;
}
