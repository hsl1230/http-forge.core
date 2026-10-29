/**
 * AI Context Assemblers
 *
 * Turn everything HTTP Forge knows about a workspace — collection structure,
 * per-request business docs (`doc.md`), descriptions, OpenAPI metadata,
 * workspace knowledge files, and test-run results — into compact, bounded
 * "business context" blocks that get injected into AI prompts and MCP task
 * payloads. This gives every AI feature the same grounding: the calling LLM
 * no longer has to guess what an endpoint does or why a test failed.
 *
 * Platform-independent except the optional workspace-knowledge reader, which
 * is guarded so it no-ops when no workspace folder is available.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Collection, CollectionRequestItem } from '../../types/collection';
import type { McpRunStore } from '../../runtime/mcp-run-store';

// ─── Bounds (keep token budget predictable) ───────────────────────────────────

/** Max chars for a single request's business context block. */
const REQUEST_CONTEXT_MAX = 1200;
/** Max chars for the collection-level block. */
const COLLECTION_CONTEXT_MAX = 800;
/** Max chars for the whole workspace-knowledge block. */
const KNOWLEDGE_MAX = 4000;
/** Max chars for the run-results block. */
const RUN_RESULTS_MAX = 2500;

// ─── ApiKnowledgeSource seam (plan §3.1) ──────────────────────────────────────

/**
 * Kinds of knowledge a source can provide. Adding a new source = one file
 * implementing `ApiKnowledgeSource` + one `registerKnowledgeSource` call.
 */
export type ApiKnowledgeKind =
  | 'collection'
  | 'openapi'
  | 'discovered-code'
  | 'workspace-knowledge'
  | 'run-results';

/**
 * A bounded, token-budgeted snapshot of a knowledge source — the same
 * discipline as the builders above, but packaged as a self-describing block so
 * `assembleBusinessContext` can render it without knowing the source type.
 */
export interface ApiKnowledgeSnapshot {
  kind: ApiKnowledgeKind;
  /** Display heading used when this snapshot is assembled into a context block. */
  heading: string;
  /** Bounded body (never unbounded — each source caps its own output). */
  body: string;
  /** When the snapshot was produced. */
  generatedAt: number;
}

/**
 * The pluggable "understanding" contract every AI feature reads from. One
 * implementation per source; registration is the only wiring needed.
 */
export interface ApiKnowledgeSource {
  kind: ApiKnowledgeKind;
  /** Produce a bounded context block. Cheap enough to call on demand. */
  snapshot(): ApiKnowledgeSnapshot;
  /** Drives auto-maintain + watch: 'fresh' when the source's data is current. */
  freshness(): 'fresh' | 'stale';
}

// ─── Built-in sources (wrap the builders above) ───────────────────────────────

/** Collection-structure context (description, vars, auth, folder tree, methods). */
export function collectionKnowledgeSource(collection: Collection): ApiKnowledgeSource {
  return {
    kind: 'collection',
    snapshot: () => {
      const body = buildCollectionBusinessContext(collection);
      return { kind: 'collection', heading: 'Collection', body, generatedAt: Date.now() };
    },
    freshness: () => (collection.items.length > 0 ? 'fresh' : 'stale'),
  };
}

/** Single-request business context (docs, OpenAPI metadata, schema, body). */
export function requestKnowledgeSource(
  request: CollectionRequestItem,
  folderPath?: string
): ApiKnowledgeSource {
  return {
    kind: 'collection',
    snapshot: () => {
      const body = buildRequestBusinessContext(request, folderPath);
      return { kind: 'collection', heading: 'Request', body, generatedAt: Date.now() };
    },
    freshness: () => (buildRequestBusinessContext(request, folderPath) ? 'fresh' : 'stale'),
  };
}

/** Workspace business knowledge (`.http-forge/knowledge/**`, README, AGENTS). */
export function workspaceKnowledgeSource(workspaceFolder?: string): ApiKnowledgeSource {
  return {
    kind: 'workspace-knowledge',
    snapshot: () => {
      const body = gatherWorkspaceKnowledge(workspaceFolder);
      return {
        kind: 'workspace-knowledge',
        heading: 'Business Knowledge',
        body,
        generatedAt: Date.now(),
      };
    },
    freshness: () => (gatherWorkspaceKnowledge(workspaceFolder) ? 'fresh' : 'stale'),
  };
}

/** Test-run results context from the shared run store. */
export function runResultsKnowledgeSource(runStore: McpRunStore, runId?: string): ApiKnowledgeSource {
  return {
    kind: 'run-results',
    snapshot: () => {
      const body = buildRunResultsContext(runStore, runId);
      return { kind: 'run-results', heading: 'Test Results', body, generatedAt: Date.now() };
    },
    freshness: () => {
      if (!runId || !runStore) return 'stale';
      const rec = runStore.get(runId);
      if (!rec) return 'stale';
      return rec.status === 'running' ? 'stale' : 'fresh';
    },
  };
}

// ─── Registration (plan §3.1 exit criterion: one file + one registration) ─────

const registeredSources: ApiKnowledgeSource[] = [];

/** Register a custom knowledge source; every assemble call picks it up. */
export function registerKnowledgeSource(source: ApiKnowledgeSource): void {
  registeredSources.push(source);
}

/** Drop all registered sources (test teardown). */
export function clearRegisteredKnowledgeSources(): void {
  registeredSources.length = 0;
}

/** Current registered sources (read-only snapshot). */
export function getRegisteredKnowledgeSources(): ApiKnowledgeSource[] {
  return registeredSources.slice();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compact business context for a single request: what it does, its docs,
 * OpenAPI contract metadata, schema, and body. Skips empty fields.
 */
export function buildRequestBusinessContext(
  req: CollectionRequestItem,
  folderPath?: string
): string {
  const parts: string[] = [];
  const label = folderPath && folderPath !== '(root)' ? `${folderPath} / ${req.name}` : req.name;

  if (req.description?.trim()) parts.push(`Description: ${trimTo(req.description, 400)}`);
  if (req.doc?.trim()) parts.push(`Docs (doc.md): ${trimTo(req.doc, REQUEST_CONTEXT_MAX)}`);
  if (req.operationId) parts.push(`OpenAPI operationId: ${req.operationId}`);
  if (req.summary?.trim()) parts.push(`OpenAPI summary: ${trimTo(req.summary, 200)}`);
  if (req.tags?.length) parts.push(`OpenAPI tags: ${req.tags.join(', ')}`);
  if (req.deprecated) parts.push(`Deprecated: true`);
  if (req.responseSchema) {
    parts.push(`Response schema: ${trimTo(JSON.stringify(req.responseSchema), 400)}`);
  }
  if (req.bodySchema) {
    parts.push(`Request body schema: ${trimTo(JSON.stringify(req.bodySchema), 300)}`);
  }
  if (req.settings?.timeout !== undefined) {
    parts.push(`Timeout: ${req.settings.timeout}ms`);
  }

  if (parts.length === 0) return '';
  return `[${req.method ?? 'GET'} ${req.url ?? ''}] ${label}\n${parts.join('\n')}`;
}

/**
 * Collection-level business context: name, description, variables, auth,
 * folder tree and request inventory.
 */
export function buildCollectionBusinessContext(collection: Collection): string {
  const lines: string[] = [];
  if (collection.description?.trim()) {
    lines.push(`Description: ${trimTo(collection.description, 400)}`);
  }
  const varNames = Object.keys(collection.variables ?? {});
  if (varNames.length > 0) {
    lines.push(`Collection variables: ${varNames.join(', ')}`);
  }
  if (collection.auth?.type) {
    lines.push(`Collection auth: ${collection.auth.type}`);
  }

  const requests: Array<{ folderPath: string; req: CollectionRequestItem }> = [];
  const collect = (items: Collection['items'], folder: string): void => {
    for (const item of items) {
      if (item.type === 'request') requests.push({ folderPath: folder || '(root)', req: item });
      else if (item.type === 'folder' && item.items) collect(item.items, `${folder}/${item.name}`.replace(/^\//, ''));
    }
  };
  collect(collection.items, '');

  if (requests.length === 0) return lines.join('\n');

  const folders = new Set(requests.map((r) => r.folderPath));
  const folderTree = [...folders]
    .sort()
    .map((f) => `  ${f} (${requests.filter((r) => r.folderPath === f).length} requests)`)
    .join('\n');
  lines.push(`Requests: ${requests.length} across ${folders.size} folder(s)`);
  if (folderTree) lines.push(`Folders:\n${folderTree}`);

  const methodCounts = requests.reduce((acc, r) => {
    acc[r.req.method ?? 'GET'] = (acc[r.req.method ?? 'GET'] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  lines.push(`Methods: ${Object.entries(methodCounts).map(([m, n]) => `${m}(${n})`).join(', ')}`);

  return lines.join('\n').slice(0, COLLECTION_CONTEXT_MAX);
}

/**
 * Read workspace business knowledge into a bounded block. Sources (in priority
 * order):
 *   - `.http-forge/knowledge/` — user-dropped business docs: Confluence page
 *     exports, Jira ticket summaries, ADRs, API design notes (any *.md)
 *   - workspace-root `README.md` and `AGENTS.md`
 * Returns '' when no workspace folder is available or nothing was found.
 */
export function gatherWorkspaceKnowledge(workspaceFolder?: string): string {
  if (!workspaceFolder || !fs.existsSync(workspaceFolder)) return '';

  const blocks: Array<{ title: string; body: string }> = [];
  let used = 0;

  const push = (title: string, filePath: string): void => {
    const remaining = KNOWLEDGE_MAX - used;
    if (remaining <= 0) return;
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return;
    }
    if (!content.trim()) return;
    blocks.push({ title, body: trimTo(content, Math.min(remaining, 1500)) });
    used += blocks[blocks.length - 1].body.length;
  };

  // 1. Knowledge directory (any depth).
  const knowledgeDir = path.join(workspaceFolder, '.http-forge', 'knowledge');
  for (const file of listMarkdownFiles(knowledgeDir)) {
    if (used >= KNOWLEDGE_MAX) break;
    push(`Knowledge: ${path.relative(workspaceFolder, file)}`, file);
  }

  // 2. Workspace README / AGENTS.
  for (const name of ['README.md', 'AGENTS.md']) {
    if (used >= KNOWLEDGE_MAX) break;
    push(`Workspace: ${name}`, path.join(workspaceFolder, name));
  }

  if (blocks.length === 0) return '';
  return blocks.map((b) => `### ${b.title}\n${b.body}`).join('\n\n').slice(0, KNOWLEDGE_MAX);
}

/**
 * Compact run-results context from the shared run store: outcome, failures,
 * and assertion messages — the test-result grounding for failure tools.
 */
export function buildRunResultsContext(runStore: McpRunStore, runId?: string): string {
  if (!runId || !runStore) return '';

  const rec = runStore.get(runId);
  if (!rec) return '';
  if (rec.status === 'running') return `Run ${runId} is still in progress.`;

  const lines: string[] = [
    `Run: ${rec.suiteName || runId} — ${rec.status}`,
    `Result: ${rec.summary.passed} passed / ${rec.summary.failed} failed / ${rec.summary.total} total`,
  ];
  if (rec.error) lines.push(`Run error: ${rec.error}`);

  const failures = (rec.allResults as Array<Record<string, unknown>>) ?? [];
  const failed = failures.filter(
    (r) => r.passed === false || (Array.isArray(r.assertions) && r.assertions.some((a: any) => !a.passed))
  );
  for (const r of failed.slice(0, 5)) {
    const failedAssertions = (r.assertions as Array<{ name: string; passed: boolean; message?: string }> | undefined)
      ?.filter((a) => !a.passed) ?? [];
    const status = r.responseStatus ?? r.status;
    lines.push(
      `- ${r.name ?? 'request'}: status ${status ?? '?'}` +
        (failedAssertions.length > 0
          ? ` — ${failedAssertions.map((a) => `"${a.name}"${a.message ? `: ${a.message}` : ''}`).join('; ')}`
          : r.error ? ` — ${r.error}` : '')
    );
  }
  if (failed.length > 5) lines.push(`… and ${failed.length - 5} more failures`);

  return lines.join('\n').slice(0, RUN_RESULTS_MAX);
}

/**
 * Options form of the legacy context assembler. Maps to the default source set
 * via {@link createDefaultKnowledgeSources} — kept for callers that don't need
 * to compose sources themselves.
 */
export interface AssembleContextOptions {
  collection: Collection;
  request?: CollectionRequestItem;
  requestFolderPath?: string;
  workspaceFolder?: string;
  runStore?: McpRunStore;
  runId?: string;
}

/**
 * Build the default set of knowledge sources from the legacy options shape.
 * Order matches the pre-seam assembler: Collection, Request, Business
 * Knowledge, Test Results — so assembled output is byte-for-byte unchanged.
 */
export function createDefaultKnowledgeSources(options: AssembleContextOptions): ApiKnowledgeSource[] {
  const sources: ApiKnowledgeSource[] = [];
  sources.push(collectionKnowledgeSource(options.collection));
  if (options.request) {
    sources.push(requestKnowledgeSource(options.request, options.requestFolderPath));
  }
  if (options.workspaceFolder) {
    sources.push(workspaceKnowledgeSource(options.workspaceFolder));
  }
  if (options.runStore && options.runId) {
    sources.push(runResultsKnowledgeSource(options.runStore, options.runId));
  }
  return sources;
}

function assembleSources(sources: ApiKnowledgeSource[]): string {
  const sections: Array<{ heading: string; body: string }> = [];
  for (const source of [...sources, ...registeredSources]) {
    const snap = source.snapshot();
    if (snap.body) sections.push({ heading: snap.heading, body: snap.body });
  }
  if (sections.length === 0) return '';
  return sections
    .map((s) => `## ${s.heading}\n${s.body}`)
    .join('\n\n');
}

/**
 * Assemble one labeled business-context block from knowledge sources. Empty
 * sources are omitted. This is the single injection point for every AI feature
 * (plan §3.1) — passing `[]` still picks up registered sources.
 */
export function assembleBusinessContext(sources: ApiKnowledgeSource[]): string;
export function assembleBusinessContext(options: AssembleContextOptions): string;
export function assembleBusinessContext(
  input: ApiKnowledgeSource[] | AssembleContextOptions
): string {
  if (Array.isArray(input)) return assembleSources(input);
  return assembleSources(createDefaultKnowledgeSources(input));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function trimTo(text: string, max: number): string {
  if (!text || text.length <= max) return text;
  return text.slice(0, max) + `… (truncated, ${text.length - max} chars omitted)`;
}

function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.markdown'))) {
        results.push(full);
      }
    }
  };
  walk(dir);
  return results;
}
