/**
 * MCP Prompts — pre-defined analysis prompts that leverage the calling LLM.
 *
 * When an MCP client (Copilot, Claude Code, etc.) invokes a prompt, the server
 * fetches workspace data, assembles a rich structured message, and returns it
 * to the client. The client feeds this message to its already-connected LLM,
 * which produces AI-quality analysis without any extra configuration.
 *
 * Available prompts:
 *   analyze-test-failure  — diagnose failures from a completed run
 *   suggest-assertions    — write pm.test() scripts for a request
 *   review-collection     — structural review of a collection
 */

import type { ICollectionService } from '../types/collection';
import {
  collectionKnowledgeSource,
  requestKnowledgeSource,
  workspaceKnowledgeSource,
} from '../infrastructure/ai/ai-context';
import type { ReviewReport } from '../infrastructure/review';
import type { TestSuite } from '../infrastructure/test-suite/interfaces';
import { enumerateFolders, flattenRequests } from './mcp-collection-utils';
import type { McpRunRecord, McpRunStore } from './mcp-run-store';

// ── Prompt definitions (returned by prompts/list) ─────────────────────────────

export interface McpPromptArg {
  name: string;
  description: string;
  required: boolean;
}

export interface McpPromptDef {
  name: string;
  description: string;
  arguments: McpPromptArg[];
}

export const MCP_PROMPTS: McpPromptDef[] = [
  {
    name: 'analyze-test-failure',
    description:
      'Analyze a failed API test run. Returns a structured prompt the LLM uses to ' +
      'diagnose each failure and suggest concrete fixes — no extra AI configuration needed.',
    arguments: [
      {
        name: 'runId',
        description: 'Run ID returned by run_suite, run_collection, or run_folder',
        required: true,
      },
      {
        name: 'request',
        description: 'Filter analysis to a specific request name (omit to analyze all failures)',
        required: false,
      },
    ],
  },
  {
    name: 'suggest-assertions',
    description:
      'Generate pm.test() assertion scripts for a request. The LLM writes Chai-style ' +
      'assertions based on the request definition and optionally an observed response.',
    arguments: [
      { name: 'collection', description: 'Collection name or id', required: true },
      { name: 'request', description: 'Request name or id', required: true },
      {
        name: 'runId',
        description: 'Run ID to use observed response data for more accurate assertions (optional)',
        required: false,
      },
    ],
  },
  {
    name: 'review-collection',
    description:
      'Get an AI review of a collection\'s structure, naming conventions, test coverage ' +
      'gaps, and assertion quality.',
    arguments: [
      { name: 'collection', description: 'Collection name or id', required: true },
    ],
  },
];

// ── Internal helpers ──────────────────────────────────────────────────────────

interface PromptMessage {
  role: 'user' | 'assistant';
  content: { type: 'text'; text: string };
}

export interface PromptResult {
  description: string;
  messages: PromptMessage[];
}

function truncate(text: string, maxLen = 2000): string {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n… (truncated, ${text.length - maxLen} chars omitted)`;
}

function redactSensitive(text: string): string {
  return text
    .replace(/"(Authorization|authorization)"\s*:\s*"[^"]+"/g, '"Authorization": "[REDACTED]"')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]')
    .replace(/"(password|secret|token|api[-_]?key)"\s*:\s*"[^"]+"/gi, '"$1": "[REDACTED]"');
}

function resolveCollectionByLabel(label: string, collectionService: ICollectionService) {
  const collections = collectionService.getAllCollections();
  const q = label.toLowerCase();
  const col =
    collections.find((c) => c.id === label || c.name === label) ??
    collections.find((c) => c.name.toLowerCase() === q) ??
    collections.find((c) => c.name.toLowerCase().includes(q));
  if (!col) {
    const names = collections.map((c) => `"${c.name}"`).join(', ');
    throw new Error(`Collection "${label}" not found. Available: ${names || '(none)'}`);
  }
  return col;
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildAnalyzeTestFailurePrompt(
  args: Record<string, string>,
  runStore: McpRunStore,
  workspaceFolder?: string
): PromptResult {
  const runId = args.runId;
  const requestFilter = args.request?.toLowerCase();

  const rec = runStore.get(runId);
  if (!rec) {
    throw new Error(
      `Run "${runId}" not found. It may have expired or never existed. ` +
      `Use get_run_status to see recent runs.`
    );
  }
  if (rec.status === 'running') {
    throw new Error(`Run "${runId}" is still in progress. Wait for it to complete before analyzing.`);
  }

  const allResults = (rec.allResults as Array<Record<string, unknown>>) ?? [];
  const failures = allResults.filter((r) => {
    if (requestFilter && typeof r.name === 'string' && !r.name.toLowerCase().includes(requestFilter)) {
      return false;
    }
    return r.passed === false || (Array.isArray(r.assertions) && r.assertions.some((a: any) => !a.passed));
  });

  const summary = rec.summary;
  const failedCount = failures.length;

  const knowledge = workspaceKnowledgeSource(workspaceFolder).snapshot().body;

  let text =
    `I ran an HTTP API test suite and got failures. Please analyze the results and provide:\n\n` +
    `1. **Root cause** for each failure\n` +
    `2. **Specific fixes** (updated URLs, auth headers, request body, environment variables)\n` +
    `3. **Updated pm.test() assertion scripts** where the assertions themselves are wrong\n\n` +
    (knowledge ? `## Business Context (workspace knowledge)\n${knowledge}\n\n` : '') +
    `## Run Summary\n` +
    `- Suite: ${rec.suiteName || '(unnamed)'}\n` +
    `- Status: ${rec.status}\n` +
    `- Total: ${summary.total} | Passed: ${summary.passed} | Failed: ${summary.failed}\n` +
    (rec.error ? `- Run error: ${rec.error}\n` : '') +
    `\n## Failed Requests\n`;

  if (failedCount === 0) {
    text += `\n(No failures found`;
    if (requestFilter) text += ` matching "${args.request}"`;
    text += `. The run may have passed entirely or the filter matched nothing.)\n`;
  } else {
    for (const r of failures.slice(0, 20)) {
      const name = String(r.name ?? '(unknown)');
      const method = String(r.method ?? '');
      const url = String(r.url ?? '');
      const status = r.responseStatus ?? r.status ?? '?';
      const error = r.error as string | undefined;
      const assertions =
        (r.assertions as Array<{ name: string; passed: boolean; message?: string }> | undefined) ?? [];
      const failedAssertions = assertions.filter((a) => !a.passed);
      // failedTests is the field name in direct-execution failedResults
      const failedTests =
        (r.failedTests as Array<{ name: string; message?: string }> | undefined) ?? failedAssertions;
      const responseBody =
        typeof r.body === 'string'
          ? truncate(redactSensitive(r.body), 600)
          : r.body ? truncate(redactSensitive(JSON.stringify(r.body)), 600) : '';
      const requestBody =
        typeof r.requestBody === 'string'
          ? truncate(redactSensitive(r.requestBody), 400)
          : r.requestBody ? truncate(redactSensitive(JSON.stringify(r.requestBody)), 400) : '';

      text += `\n### ${name}`;
      if (method || url) text += ` [${method} ${url}]`;
      text += `\n- HTTP status received: ${status}`;
      if (error) text += `\n- Request error: ${error}`;
      if (requestBody) text += `\n- Request body sent:\n\`\`\`json\n${requestBody}\n\`\`\``;
      if (failedTests.length > 0) {
        text += `\n- Failed assertions:`;
        for (const a of failedTests) {
          text += `\n  - \`${a.name}\`: ${a.message ?? 'assertion failed'}`;
        }
      }
      if (responseBody) {
        text += `\n- Response body:\n\`\`\`json\n${responseBody}\n\`\`\``;
      }
      text += '\n';
    }
    if (failedCount > 20) {
      text += `\n_(${failedCount - 20} more failures omitted — fix the above first)_\n`;
    }
  }

  text += `\nPlease diagnose each failure and provide concrete, actionable fixes.`;

  return {
    description: `Analyze ${failedCount} failure(s) from run "${runId}"`,
    messages: [{ role: 'user', content: { type: 'text', text } }],
  };
}

async function buildSuggestAssertionsPrompt(
  args: Record<string, string>,
  collectionService: ICollectionService,
  runStore: McpRunStore,
  workspaceFolder?: string
): Promise<PromptResult> {
  const col = resolveCollectionByLabel(args.collection, collectionService);
  const flat = flattenRequests(col);
  const rq = args.request.toLowerCase();
  const found =
    flat.find((r) => r.request.id === args.request || r.request.name === args.request) ??
    flat.find((r) => r.request.name.toLowerCase() === rq) ??
    flat.find((r) => r.request.name.toLowerCase().includes(rq));
  if (!found) {
    throw new Error(`Request "${args.request}" not found in collection "${col.name}"`);
  }

  const req = collectionService.getRequestDetail(col.id, found.request.id) ?? found.request;
  const preScript = collectionService.getRequestScript(col.id, req.id, 'pre-request') ?? '';
  const postScript = collectionService.getRequestScript(col.id, req.id, 'post-response') ?? '';

  const businessCtx = requestKnowledgeSource(req, found.folderPath).snapshot().body;
  const knowledge = workspaceKnowledgeSource(workspaceFolder).snapshot().body;

  // Observed response from a completed run
  let observedSection = '';
  if (args.runId) {
    const rec = runStore.get(args.runId);
    if (rec && rec.status !== 'running') {
      const allResults = (rec.allResults as Array<Record<string, unknown>>) ?? [];
      const result = allResults.find(
        (r) => typeof r.name === 'string' && r.name.toLowerCase() === req.name.toLowerCase()
      );
      if (result) {
        const status = result.responseStatus ?? result.status;
        const body =
          typeof result.responseBody === 'string'
            ? truncate(redactSensitive(result.responseBody), 1500)
            : '';
        const headers = result.responseHeaders
          ? truncate(JSON.stringify(result.responseHeaders, null, 2), 500)
          : '';
        observedSection = `\n## Observed Response (run ${args.runId})\n- Status: ${status}\n`;
        if (headers) observedSection += `- Headers:\n\`\`\`json\n${headers}\n\`\`\`\n`;
        if (body) observedSection += `- Body:\n\`\`\`json\n${body}\n\`\`\`\n`;
      }
    }
  }

  const headersStr =
    req.headers?.filter((h: any) => h.enabled !== false).map((h: any) => `  ${h.name}: ${h.value}`).join('\n') ||
    '  (none)';
  const bodyStr = req.body ? truncate(JSON.stringify(req.body, null, 2), 600) : '(no body)';

  const text =
    `Please write pm.test() assertion scripts for the following HTTP API request.\n\n` +
    (businessCtx ? `## Business Context (request docs & OpenAPI contract)\n${businessCtx}\n\n` : '') +
    (knowledge ? `## Business Context (workspace knowledge)\n${knowledge}\n\n` : '') +
    `## Request: ${req.name}\n` +
    `- Method: ${req.method}\n` +
    `- URL: ${req.url ?? '(not set)'}\n` +
    `- Folder: ${found.folderPath || '(root)'}\n` +
    `- Description: ${req.description ?? '(none)'}\n\n` +
    `## Headers\n${headersStr}\n\n` +
    `## Body\n\`\`\`json\n${bodyStr}\n\`\`\`\n` +
    (preScript ? `\n## Pre-Request Script\n\`\`\`javascript\n${truncate(preScript, 600)}\n\`\`\`\n` : '') +
    observedSection +
    `\n## Existing Post-Response Script\n\`\`\`javascript\n${postScript || '// (empty — no assertions yet)'}\n\`\`\`\n\n` +
    `## Instructions\n` +
    `Write comprehensive pm.test() assertions for the **post-response script**. Cover:\n` +
    `1. Status code (use the observed status if available, otherwise infer from the endpoint)\n` +
    `2. Response time (reasonable threshold for this type of endpoint)\n` +
    `3. Content-Type header\n` +
    `4. Key response body fields (existence, type, value constraints)\n` +
    `5. Business logic validations specific to this endpoint\n\n` +
    `Use Chai-style assertions (\`pm.expect(...).to...\`). ` +
    `Output only the JavaScript code block, ready to paste into the post-response script.`;

  return {
    description: `Suggest assertions for "${req.name}" in "${col.name}"`,
    messages: [{ role: 'user', content: { type: 'text', text } }],
  };
}

async function buildReviewCollectionPrompt(
  args: Record<string, string>,
  collectionService: ICollectionService,
  workspaceFolder?: string
): Promise<PromptResult> {
  const col = resolveCollectionByLabel(args.collection, collectionService);
  const flat = flattenRequests(col);
  const folders = enumerateFolders(col);

  const collectionCtx = collectionKnowledgeSource(col).snapshot().body;
  const knowledge = workspaceKnowledgeSource(workspaceFolder).snapshot().body;

  const requestSummaries = flat.slice(0, 60).map(({ request, folderPath }) => {
    const postScript = collectionService.getRequestScript(col.id, request.id, 'post-response') ?? '';
    const hasAssertions = postScript.includes('pm.test') || postScript.includes('pm.expect');
    const hasPreScript = !!(collectionService.getRequestScript(col.id, request.id, 'pre-request'));
    return { name: request.name, method: request.method, url: request.url ?? '', folder: folderPath || '(root)', hasPreScript, hasAssertions };
  });

  const noAssertions = requestSummaries.filter((r) => !r.hasAssertions);
  const methodCounts = requestSummaries.reduce((acc, r) => {
    acc[r.method] = (acc[r.method] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const folderList = folders.map((f) => `  ${f.folderPath} (${f.requestCount} requests)`).join('\n');
  const requestList = requestSummaries
    .map((r) => `  [${r.method}] ${r.folder !== '(root)' ? r.folder + ' / ' : ''}${r.name}${r.hasAssertions ? ' ✓' : ' ⚠ no assertions'}`)
    .join('\n');

  const text =
    `Please review the following HTTP Forge API collection and provide actionable recommendations.\n\n` +
    (collectionCtx ? `## Business Context (collection)\n${collectionCtx}\n\n` : '') +
    (knowledge ? `## Business Context (workspace knowledge)\n${knowledge}\n\n` : '') +
    `## Collection: ${col.name}\n` +
    `- Description: ${col.description ?? '(none)'}\n` +
    `- Total requests: ${flat.length}\n` +
    `- Folders: ${folders.length}\n` +
    `- HTTP methods: ${Object.entries(methodCounts).map(([m, n]) => `${m}(${n})`).join(', ')}\n\n` +
    `## Folder Structure\n${folderList || '  (no folders — all requests at root)'}\n\n` +
    `## Requests (✓ = has assertions, ⚠ = missing)\n` +
    requestList +
    (flat.length > 60 ? `\n  … (${flat.length - 60} more requests omitted)` : '') +
    `\n\n## Coverage Gaps\n` +
    `Requests without assertions: ${noAssertions.length} / ${flat.length}\n` +
    noAssertions.slice(0, 10).map((r) => `  - [${r.method}] ${r.name}`).join('\n') +
    (noAssertions.length > 10 ? `\n  … and ${noAssertions.length - 10} more` : '') +
    `\n\n## Review Criteria\nPlease provide recommendations for:\n` +
    `1. **Naming conventions** — are request and folder names clear and consistent?\n` +
    `2. **Coverage gaps** — what error cases, edge cases, or HTTP methods are missing?\n` +
    `3. **Assertion priority** — which requests without assertions should be fixed first?\n` +
    `4. **Organization** — should any requests be moved into folders or sub-folders?\n` +
    `5. **Authentication** — is auth consistent across requests that need it?\n` +
    `6. **Environment variables** — are URLs and credentials properly parameterized?\n\n` +
    `Be specific: name the exact requests or folders that need attention.`;

  return {
    description: `Review collection "${col.name}" (${flat.length} requests, ${noAssertions.length} without assertions)`,
    messages: [{ role: 'user', content: { type: 'text', text } }],
  };
}

/**
 * Build the LLM-enrichment prompt for the review_suite tool.
 *
 * Rules-first: the deterministic findings are always the source of truth; the
 * LLM only prioritizes them and adds actionable prose. Passing the findings in
 * keeps the model honest (it cannot invent severity) and keeps the gate CI-safe.
 */
export async function buildReviewSuitePrompt(input: {
  rec: McpRunRecord;
  suite?: TestSuite;
  report: ReviewReport;
}): Promise<string> {
  const { rec, suite, report } = input;
  const severityLabel: Record<string, string> = {
    error: '🔴 error',
    warn: '🟡 warning',
    info: '🔵 info',
  };

  const findingLines = report.findings.map(
    (f, i) =>
      `${i + 1}. [${severityLabel[f.severity] ?? f.severity}] **${f.title}**` +
      (f.requestName ? ` (request: \`${f.requestName}\`)` : '') +
      `\n   ${f.message}` +
      (f.suggestion ? `\n   → ${f.suggestion}` : ''),
  );

  return (
    `A deterministic review of a suite run produced ${report.summary.errors} error(s), ` +
    `${report.summary.warnings} warning(s). Do NOT change severities or dismiss findings — ` +
    `prioritize them and give the developer concrete next steps.\n\n` +
    `## Run\n` +
    `- Suite: ${rec.suiteName || suite?.name || '(unnamed)'}\n` +
    `- Result: ${rec.summary.passed} passed / ${rec.summary.failed} failed / ${rec.summary.total} total\n` +
    (rec.error ? `- Run error: ${rec.error}\n` : '') +
    `\n## Deterministic Findings\n` +
    (findingLines.length > 0 ? findingLines.join('\n') : '(none)') +
    `\n\n## Your task\n` +
    `1. Rank the findings by what to fix first (1 = most important).\n` +
    `2. For the top 3, give a concrete remediation (exact assertion, config change, or code fix).\n` +
    `3. Note anything the deterministic rules cannot see (spec compliance, business logic) as a ` +
    `separate "Manual review" section.\n` +
    `Keep it under 600 words.`
  );
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function buildPromptResult(
  name: string,
  args: Record<string, string>,
  collectionService: ICollectionService,
  runStore: McpRunStore,
  workspaceFolder?: string
): Promise<PromptResult> {
  switch (name) {
    case 'analyze-test-failure':
      return buildAnalyzeTestFailurePrompt(args, runStore, workspaceFolder);
    case 'suggest-assertions':
      return buildSuggestAssertionsPrompt(args, collectionService, runStore, workspaceFolder);
    case 'review-collection':
      return buildReviewCollectionPrompt(args, collectionService, workspaceFolder);
    default:
      throw new Error(
        `Unknown prompt: "${name}". Available: ${MCP_PROMPTS.map((p) => p.name).join(', ')}`
      );
  }
}
