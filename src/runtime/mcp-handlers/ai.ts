/**
 * AI-native tool handlers — scaffold/openapi, suggestions, coverage, and the
 * "task" tools that instruct the calling LLM to take follow-up actions.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IAiProvider } from '../../infrastructure/ai/ai-provider';
import {
  collectionKnowledgeSource,
  requestKnowledgeSource,
  runResultsKnowledgeSource,
  workspaceKnowledgeSource,
} from '../../infrastructure/ai/ai-context';
import { extractJsonFromLlm, withAiRetry } from '../../infrastructure/ai/ai-utils';
import { applyEnvSuggestionsToItems, detectEnvSuggestions } from '../../infrastructure/analysis/env-suggester';
import { OpenApiImporter } from '../../infrastructure/openapi/openapi-importer';
import { OpenApiExporter } from '../../infrastructure/openapi/openapi-exporter';
import { SchemaInferenceService } from '../../infrastructure/openapi/schema-inference-service';
import { ApiArchitectService } from '../../infrastructure/architect/api-architect-service';
import { createEnvAiProvider } from '../../infrastructure/ai/http-providers';
import type { CollectionRequestItem } from '../../types/collection';
import { flattenRequests } from '../mcp-collection-utils';
import { GENERIC_TOOL_NAMES } from '../mcp-tool-schemas';
import {
  badRequest,
  hydrateRequest,
  resolveCollectionByLabel,
  resolveRequestByLabel,
} from './helpers';
import type { McpToolHandler } from './types';

/** HTTP methods used for spec-vs-collection matching. */
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/** Resolve an (optionally workspace-relative) spec path to an absolute path. */
function resolveSpecPath(
  specPath: string,
  workspaceFolder: string | undefined
): string {
  return workspaceFolder && !path.isAbsolute(specPath)
    ? path.join(workspaceFolder, specPath)
    : specPath;
}

/** Load a JSON or YAML OpenAPI spec file into an object. */
async function loadSpec(resolvedPath: string): Promise<Record<string, unknown>> {
  const raw = fs.readFileSync(resolvedPath, 'utf8');
  if (resolvedPath.endsWith('.json')) return JSON.parse(raw) as Record<string, unknown>;
  const { parse: parseYaml } = await import('yaml');
  return parseYaml(raw) as Record<string, unknown>;
}

/** Build a compact request summary for the LLM to inspect. */
function buildRequestSummary(col: import('../../types/collection').Collection): unknown[] {
  return flattenRequests(col).map(({ request: r, folderPath }) => ({
    id: r.id,
    name: r.name,
    folder: folderPath,
    method: r.method,
    url: r.url,
    headers: (r.headers ?? []).filter((h) => h.enabled !== false).map((h) => ({ key: h.key, value: h.value })),
    query: (r.query ?? []).filter((q) => q.enabled !== false).map((q) => ({ key: q.key, value: q.value })),
    bodyExcerpt: r.body?.type === 'raw' && typeof r.body.content === 'string'
      ? (r.body.content as string).slice(0, 300)
      : undefined,
  }));
}

/** Resolve the folder path that contains a given request (or undefined). */
function findRequestFolder(
  col: import('../../types/collection').Collection,
  req: CollectionRequestItem
): string | undefined {
  const flat = flattenRequests(col).find(
    ({ request: r }) => r.id === req.id || r.name === req.name
  );
  return flat?.folderPath;
}

/** Build a compact, prompt-friendly description of a request + observed response. */
function describeRequestForAi(
  req: CollectionRequestItem,
  latestResult: Record<string, unknown> | undefined
): string {
  const lines = [
    `Method: ${req.method ?? 'GET'}`,
    `URL: ${req.url ?? ''}`,
    ...(req.headers ?? [])
      .filter((h) => h.enabled !== false)
      .map((h) => `Header: ${h.key}: ${h.value}`),
    ...(req.query ?? [])
      .filter((q) => q.enabled !== false)
      .map((q) => `Query: ${q.key}: ${q.value}`),
  ];
  if (req.body?.type === 'raw' && typeof req.body.content === 'string') {
    lines.push(`Body: ${(req.body.content as string).slice(0, 300)}`);
  }
  if (latestResult) {
    lines.push(`Observed status: ${String(latestResult.status ?? 'unknown')}`);
    if (latestResult.responseHeaders) {
      lines.push(`Observed headers: ${JSON.stringify(latestResult.responseHeaders).slice(0, 400)}`);
    }
    const raw = latestResult.responseBody as string | undefined;
    if (raw) lines.push(`Observed body: ${raw.slice(0, 1000)}`);
    if (Array.isArray(latestResult.failedTests)) {
      lines.push(`Failed tests: ${JSON.stringify(latestResult.failedTests).slice(0, 400)}`);
    }
  }
  return lines.join('\n');
}

export interface AssertionSuggestion {
    snippet: string;
    rationale: string;
}

/** Ask an LLM for tailored pm.test() assertions, returning [] on any failure. */
export async function suggestAssertionsWithAi(
  provider: IAiProvider,
  req: CollectionRequestItem,
  latestResult: Record<string, unknown> | undefined,
  maxSuggestions: number,
  workspaceKnowledge?: string
): Promise<AssertionSuggestion[]> {
  const businessCtx = requestKnowledgeSource(req).snapshot().body;
  const prompt =
    `You are an API testing expert. Suggest high-value post-response pm.test() assertions for the request below.\n\n` +
    (businessCtx ? `Business context for this endpoint (docs, OpenAPI contract, schema):\n${businessCtx}\n\n` : '') +
    (workspaceKnowledge ? `Workspace business knowledge (Confluence exports, Jiras, project docs):\n${workspaceKnowledge}\n\n` : '') +
    `${describeRequestForAi(req, latestResult)}\n\n` +
    `Rules:\n` +
    `- Prefer business-logic and contract checks (status code, key fields, types, shapes, auth behaviour) over trivial ones.\n` +
    `- Use pm.test(), pm.response.to.have.status(), pm.expect().\n` +
    `- If an observed response body is provided, write assertions that match its actual shape.\n` +
    `- Return at most ${maxSuggestions} assertions.\n` +
    `Return ONLY a valid JSON array (no markdown fences):\n` +
    `[{"snippet":"<full pm.test JS>","rationale":"<one sentence>"}]`;

  try {
    const raw = await withAiRetry(() => provider.complete(prompt));
    const parsed = extractJsonFromLlm<AssertionSuggestion[]>(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.snippet === 'string' && s.snippet.includes('pm.test'))
      .map((s) => ({ snippet: s.snippet, rationale: s.rationale ?? '' }));
  } catch {
    return [];
  }
}

interface AiDiagnosis {
  diagnosis: string;
  suggestedFixes: string[];
}

/** Ask an LLM for a real failure diagnosis, returning null on any failure. */
async function explainFailureWithAi(
  provider: IAiProvider,
  result: Record<string, unknown>,
  businessContext?: string
): Promise<AiDiagnosis | null> {
  const failedAssertions = (result.assertions as Array<{ name: string; passed: boolean; message?: string }> | undefined)
    ?.filter((a) => !a.passed) ?? [];

  const prompt =
    `You are an API testing expert diagnosing a failed HTTP test. Use the request, response, and assertion failures below.\n\n` +
    (businessContext ? `Business context for this endpoint (docs, OpenAPI contract, workspace knowledge):\n${businessContext}\n\n` : '') +
    `Method: ${String(result.method ?? '')}\n` +
    `URL: ${String(result.url ?? '')}\n` +
    `Request body: ${String(result.requestBody ?? '(none)').slice(0, 500)}\n` +
    `Response status: ${String(result.responseStatus ?? 'unknown')}\n` +
    `Response headers: ${JSON.stringify(result.responseHeaders ?? {}).slice(0, 500)}\n` +
    `Response body: ${String(result.responseBody ?? '(none)').slice(0, 2000)}\n` +
    (result.error
      ? `Execution error: ${String(result.error)}\n`
      : '') +
    (failedAssertions.length > 0
      ? `Failed assertions:\n${failedAssertions.map((a) => `- ${a.name}${a.message ? `: ${a.message}` : ''}`).join('\n')}\n`
      : '') +
    `\nDiagnose the likely root cause and give concrete, ordered fixes.\n` +
    `Return ONLY a valid JSON object (no markdown fences):\n` +
    `{"diagnosis":"<2-4 sentences>","suggestedFixes":["<fix 1>","<fix 2>"]}`;

  try {
    const raw = await withAiRetry(() => provider.complete(prompt));
    const parsed = extractJsonFromLlm<AiDiagnosis>(raw);
    if (!parsed || typeof parsed.diagnosis !== 'string' || !parsed.diagnosis.trim()) return null;
    return {
      diagnosis: parsed.diagnosis.trim(),
      suggestedFixes: Array.isArray(parsed.suggestedFixes)
        ? parsed.suggestedFixes.filter((f): f is string => typeof f === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

/** Rule-based assertion suggestions used when no AI provider is configured. */
function buildHeuristicAssertions(
  foundReq: CollectionRequestItem,
  latestResult: Record<string, unknown> | undefined,
  maxSuggestions: number
): AssertionSuggestion[] {
  const suggestions: AssertionSuggestion[] = [];

  const observedStatus = latestResult?.status as number | undefined;
  if (observedStatus) {
    suggestions.push({
      snippet: `pm.test("Status code is ${observedStatus}", function () {\n  pm.response.to.have.status(${observedStatus});\n});`,
      rationale: `Observed status ${observedStatus} in the most recent run.`,
    });
  } else {
    suggestions.push({
      snippet: `pm.test("Status code is 2xx", function () {\n  pm.expect(pm.response.code).to.be.within(200, 299);\n});`,
      rationale: `No run history in this session — asserting a generic 2xx success.`,
    });
  }

  suggestions.push({
    snippet: `pm.test("Response time is under 2000ms", function () {\n  pm.expect(pm.response.responseTime).to.be.below(2000);\n});`,
    rationale: `Good practice to gate on response time in CI.`,
  });

  const responseBody = latestResult?.responseBody as string | undefined;
  if (responseBody) {
    try {
      const parsed = JSON.parse(responseBody);
      if (parsed && typeof parsed === 'object') {
        suggestions.push({
          snippet: `pm.test("Content-Type is application/json", function () {\n  pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");\n});`,
          rationale: `Response body was valid JSON — assert Content-Type accordingly.`,
        });
        const topFields = Object.keys(Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : parsed).slice(0, 5);
        for (const field of topFields) {
          if (suggestions.length >= maxSuggestions) break;
          const accessor = Array.isArray(parsed) ? `body[0]` : `body`;
          suggestions.push({
            snippet: `pm.test("Response has field '${field}'", function () {\n  const body = pm.response.json();\n  pm.expect(${accessor}).to.have.property("${field}");\n});`,
            rationale: `Field "${field}" was present in the observed response body.`,
          });
        }
      }
    } catch {
      suggestions.push({
        snippet: `pm.test("Response body is not empty", function () {\n  pm.expect(pm.response.text()).to.not.be.empty;\n});`,
        rationale: `Response body was non-JSON text.`,
      });
    }
  }

  return suggestions;
}

export const aiHandlers: McpToolHandler[] = [
  {
    toolNames: [GENERIC_TOOL_NAMES.scaffoldCollectionFromOpenApi],
    async handle({ args, services }) {
      const specPath = typeof args.specPath === 'string' ? args.specPath.trim() : '';
      if (!specPath) throw badRequest('"specPath" is required');

      const resolvedSpec = resolveSpecPath(specPath, services.workspaceFolder);

      if (!fs.existsSync(resolvedSpec)) {
        throw badRequest(`OpenAPI spec file not found: "${resolvedSpec}"`);
      }

      const importer = new OpenApiImporter(services.collection, services.environmentConfig);
      const result = await importer.import(resolvedSpec, {
        collectionName: typeof args.collectionName === 'string' ? args.collectionName : undefined,
        environmentName: typeof args.environmentName === 'string' ? args.environmentName : undefined,
      });

      return {
        collectionId: result.collection.id,
        collectionName: result.collection.name,
        requestCount: result.collection.items.filter((i) => i.type === 'request').length,
        environmentCreated: result.environmentCreated ?? null,
        hint: `Use list_requests to browse the scaffolded collection, then run_request to test individual endpoints.`,
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.suggestAssertions],
    async handle({ args, services, collections, runStore }) {
      const colLabel = args.collection;
      const reqLabel = typeof args.request === 'string' ? args.request.trim() : '';
      if (!reqLabel) throw badRequest('"request" is required');
      const col = resolveCollectionByLabel(colLabel, collections);
      const foundReq = resolveRequestByLabel(args.request, col);
      const req = hydrateRequest(services, col.id, foundReq);

      const maxSuggestions = typeof args.maxSuggestions === 'number' ? Math.min(20, Math.max(1, args.maxSuggestions)) : 10;

      // Look for the most recent completed run that contains this request
      const allRuns = Array.from(runStore.values());
      const recentResults = allRuns
        .filter((r) => r.status !== 'running')
        .flatMap((r) => (r.allResults as Array<Record<string, unknown>>) ?? [])
        .filter(
          (r) =>
            r.name === foundReq.name ||
            (typeof r.name === 'string' && r.name.toLowerCase() === foundReq.name.toLowerCase())
        );
      const latestResult = recentResults[recentResults.length - 1] as Record<string, unknown> | undefined;

      // Prefer a real LLM for tailored, business-logic assertions when a provider
      // is configured; fall back to the built-in heuristics otherwise.
      if (services.aiProvider) {
        const aiSuggestions = await suggestAssertionsWithAi(
          services.aiProvider,
          req,
          latestResult,
          maxSuggestions,
          workspaceKnowledgeSource(services.workspaceFolder).snapshot().body
        );
        if (aiSuggestions.length > 0) {
          return {
            collection: col.name,
            request: foundReq.name,
            source: 'ai',
            suggestions: aiSuggestions.slice(0, maxSuggestions),
            hint: 'Paste the snippets into the request\'s post-response script using set_request_script.',
          };
        }
      }

      const suggestions = buildHeuristicAssertions(req, latestResult, maxSuggestions);

      return {
        collection: col.name,
        request: foundReq.name,
        source: 'heuristic',
        suggestions: suggestions.slice(0, maxSuggestions),
        hint: 'Paste the snippets into the request\'s post-response script using set_request_script.',
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.explainFailure],
    async handle({ args, services, collections, runStore }) {
      const runIdArg = typeof args.runId === 'string' ? args.runId.trim() : undefined;
      const requestArg = typeof args.request === 'string' ? args.request.trim() : '';
      const iteration = typeof args.iteration === 'number' ? args.iteration : 1;

      if (runIdArg) {
        // Explain from an in-memory MCP run record
        const rec = runStore.require(runIdArg);
        if (rec.status === 'running') {
          return { runId: runIdArg, status: 'running', message: 'The run has not completed yet. Try again in a moment.' };
        }
        if (!requestArg) throw badRequest('"request" is required when "runId" is provided');
        const result = (rec.allResults as Array<Record<string, unknown>>).find(
          (r) =>
            r.iteration === iteration &&
            (r.name === requestArg || (typeof r.name === 'string' && r.name.toLowerCase() === requestArg.toLowerCase()))
        );
        if (!result) {
          throw new Error(`Request "${requestArg}" (iteration ${iteration}) not found in run "${runIdArg}".`);
        }

        const passed = (result.assertions as Array<{ passed: boolean }> | undefined)?.every((a) => a.passed) ?? true;
        const requestError = result.error as string | undefined;
        const failedAssertions = (result.assertions as Array<{ name: string; passed: boolean; message?: string }> | undefined)
          ?.filter((a) => !a.passed) ?? [];

        let diagnosis = '';
        let suggestedFixes: string[] = [];

        // Prefer a real LLM diagnosis when a provider is configured.
        if (services.aiProvider && (requestError || failedAssertions.length > 0)) {
          const businessContext = [
            workspaceKnowledgeSource(services.workspaceFolder).snapshot().body,
            runResultsKnowledgeSource(runStore, runIdArg).snapshot().body,
          ]
            .filter(Boolean)
            .join('\n\n');
          const aiDiagnosis = await explainFailureWithAi(services.aiProvider, result, businessContext || undefined);
          if (aiDiagnosis) {
            diagnosis = aiDiagnosis.diagnosis;
            suggestedFixes = aiDiagnosis.suggestedFixes;
          }
        }

        if (!diagnosis) {
          if (requestError) {
            diagnosis = `The request itself failed to execute: ${requestError}. Check the URL, network access, authentication, and that the environment variables are set correctly.`;
          } else if (failedAssertions.length > 0) {
            diagnosis = `${failedAssertions.length} assertion(s) failed. Review the expected vs actual values below and verify the API contract.`;
          } else if (!passed) {
            diagnosis = 'The request was marked as failed but no specific errors were captured.';
          } else {
            diagnosis = 'No failures detected. The request appears to have passed.';
          }
        }

        return {
          runId: runIdArg,
          request: result.name,
          iteration,
          status: result.status ?? 'unknown',
          passed: result.passed ?? true,
          error: requestError ?? null,
          failedAssertions,
          allAssertions: result.assertions ?? [],
          requestDetails: {
            method: result.method,
            url: result.url,
            requestBody: result.requestBody,
          },
          responseDetails: {
            status: result.responseStatus,
            headers: result.responseHeaders,
            body: (() => {
              const raw = result.responseBody as string | undefined;
              if (!raw || raw.length <= 4096) return raw ?? null;
              return {
                _truncated: true,
                excerpt: raw.slice(0, 4096),
                totalLength: raw.length,
                hint: 'Body truncated. Pass include:["fullBody"] to get the complete body, or include:["report"] to generate an HTML report with full details.',
              };
            })(),
          },
          diagnosis,
          suggestedFixes:
            suggestedFixes.length > 0
              ? suggestedFixes
              : requestError
                ? ['Verify the URL is correct and reachable', 'Check all required environment variables are set', 'Inspect authentication headers']
                : failedAssertions.map((a) => `Fix assertion "${a.name}": ${a.message ?? 'expected value mismatch'}`),
        };
      }

      // Fallback: explain from collection/request label (most recent history entry)
      const colLabel = args.collection;
      if (!requestArg) throw badRequest('"request" is required');
      const col = resolveCollectionByLabel(colLabel, collections);
      const foundReq = resolveRequestByLabel(args.request, col);

      return {
        request: foundReq.name,
        collection: col.name,
        message: 'No live run id provided. Run the request first using run_request, then call explain_failure with the runId from the result.',
        hint: 'Use run_request or run_collection with include:["consoleOutput"] to capture a fresh run, then pass the runId here.',
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.aiSuggestEnvVars],
    handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const minOcc = typeof args.minOccurrences === 'number' ? Math.max(1, args.minOccurrences) : 1;
      const envArg = typeof args.environment === 'string' ? args.environment : undefined;
      const envName = envArg ?? services.environmentConfig.getSelectedEnvironment() ?? undefined;

      const heuristic = detectEnvSuggestions(col, minOcc);
      const requestSummary = buildRequestSummary(col);

      return {
        task: {
          action: 'analyze_and_apply_env_vars',
          instructions: [
            'Review requestSummary. Find ALL hardcoded values: base URLs, API keys/tokens, tenant IDs, user IDs, secrets, repeated hostnames.',
            'Skip placeholders ({{...}}), HTTP methods, standard header names, empty strings, booleans, short numbers.',
            'Combine heuristicSuggestions with your own findings into one list.',
            `Call apply_env_vars immediately with: { collection: "${col.name}", suggestions: [...], ${envName ? `environment: "${envName}"` : ''} }`,
            'Do NOT ask for confirmation. Apply everything at once.',
          ],
          collection: col.name,
          businessContext: collectionKnowledgeSource(col).snapshot().body || undefined,
          heuristicSuggestions: heuristic.map((s) => ({ varName: s.varName, value: s.value, reason: s.reason })),
          requestSummary,
          expectedCallAfterThis: 'apply_env_vars',
        },
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.aiEnhanceCollection],
    handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const offset = typeof args.offset === 'number' ? Math.max(0, args.offset) : 0;
      const limit = typeof args.limit === 'number' ? Math.min(20, Math.max(1, args.limit)) : 10;
      const folderFilter = typeof args.folder === 'string' ? args.folder.toLowerCase() : undefined;

      const all = flattenRequests(col).filter(
        ({ folderPath }) => !folderFilter || folderPath.toLowerCase().includes(folderFilter)
      );
      const batch = all.slice(offset, offset + limit).map(({ request, folderPath }) => {
        // Batch is bounded (≤20); hydrate heavy fields once per item (cached after).
        const r = hydrateRequest(services, col.id, request);
        return {
        id: r.id,
        name: r.name,
        folder: folderPath,
        method: r.method,
        url: r.url,
        headers: (r.headers ?? []).filter((h) => h.enabled !== false).map((h) => ({ key: h.key, value: h.value })),
        query: (r.query ?? []).filter((q) => q.enabled !== false).map((q) => ({ key: q.key, value: q.value })),
        currentBody: r.body?.type === 'raw' && typeof r.body.content === 'string' ? r.body.content : undefined,
        currentTestScript: services.collection.getRequestScript(col.id, r.id, 'post-response') ?? undefined,
        description: r.description?.slice(0, 200),
        doc: r.doc ? r.doc.slice(0, 600) : undefined,
        operationId: r.operationId,
        };
      });

      const hasMore = offset + limit < all.length;

      return {
        task: {
          action: 'enhance_requests',
          instructions: [
            'For each request in requests, produce body and/or testScript as appropriate:',
            '  body: realistic JSON (or form) example matching the endpoint purpose. Only for POST/PUT/PATCH.',
            '  testScript: pm.test() assertions — check status code, response schema, key fields. Always provide this.',
            `Call apply_request_enhancements immediately with: { collection: "${col.name}", enhancements: [{ requestId, body?, testScript }] }`,
            hasMore
              ? `After applying, call ai_enhance_collection again with: { collection: "${col.name}", offset: ${offset + limit}, limit: ${limit} } to continue.`
              : 'This is the last batch — no further calls needed after applying.',
            'Do NOT ask for confirmation. Apply everything at once.',
          ],
          collection: col.name,
          total: all.length,
          offset,
          hasMore,
          nextOffset: hasMore ? offset + limit : undefined,
          requests: batch,
          expectedCallAfterThis: 'apply_request_enhancements',
        },
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.suggestEnvVars],
    handle({ args, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const minOcc = typeof args.minOccurrences === 'number' ? Math.max(1, args.minOccurrences) : 1;
      const heuristic = detectEnvSuggestions(col, minOcc);

      // Build a compact request summary the calling LLM can inspect to find additional hardcoded values
      const summary = buildRequestSummary(col);

      return {
        collection: col.name,
        businessContext: collectionKnowledgeSource(col).snapshot().body || undefined,
        heuristicSuggestions: heuristic.map((s) => ({
          varName: s.varName,
          value: s.value,
          reason: s.reason,
          occurrences: s.occurrences.length,
        })),
        requestSummary: summary,
        hint: 'Review requestSummary for additional hardcoded values, then call apply_env_vars with your combined {value, varName} list.',
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.applyEnvVars],
    async handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const rawSuggestions = args.suggestions;
      if (!Array.isArray(rawSuggestions) || rawSuggestions.length === 0) {
        throw badRequest('"suggestions" must be a non-empty array of {value, varName} objects');
      }
      const suggestions = rawSuggestions as Array<{ value: string; varName: string }>;

      const counts = applyEnvSuggestionsToItems(col.items, suggestions);
      await services.collection.saveCollection(col);

      // Optionally write original values to the target environment
      const envArg = typeof args.environment === 'string' ? args.environment : undefined;
      const envName = envArg ?? services.environmentConfig.getSelectedEnvironment();
      if (envName) {
        for (const s of suggestions) {
          services.environmentConfig.setEnvironmentVariable(s.varName, s.value, envName);
        }
      }

      const totalReplacements = Object.values(counts).reduce((a, b) => a + b, 0);
      return {
        collection: col.name,
        applied: suggestions.map((s) => ({ varName: s.varName, replacements: counts[s.varName] ?? 0 })),
        totalReplacements,
        ...(envName ? { writtenToEnvironment: envName } : {}),
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.getRequestsForEnhancement],
    handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const offset = typeof args.offset === 'number' ? Math.max(0, args.offset) : 0;
      const limit = typeof args.limit === 'number' ? Math.min(30, Math.max(1, args.limit)) : 10;
      const folderFilter = typeof args.folder === 'string' ? args.folder.toLowerCase() : undefined;

      const all = flattenRequests(col).filter(
        ({ folderPath }) => !folderFilter || folderPath.toLowerCase().includes(folderFilter)
      );

      const batch = all.slice(offset, offset + limit).map(({ request, folderPath }) => {
        // Batch is bounded (≤30); hydrate heavy fields once per item (cached after).
        const r = hydrateRequest(services, col.id, request);
        return {
        id: r.id,
        name: r.name,
        folder: folderPath,
        method: r.method,
        url: r.url,
        headers: (r.headers ?? []).filter((h) => h.enabled !== false).map((h) => ({ key: h.key, value: h.value })),
        query: (r.query ?? []).filter((q) => q.enabled !== false).map((q) => ({ key: q.key, value: q.value })),
        currentBody: r.body?.type === 'raw' && typeof r.body.content === 'string'
          ? r.body.content
          : undefined,
        currentTestScript: services.collection.getRequestScript(col.id, r.id, 'post-response') ?? undefined,
        };
      });

      return {
        collection: col.name,
        total: all.length,
        offset,
        limit,
        requests: batch,
        hasMore: offset + limit < all.length,
        hint: 'For each request write a realistic body and pm.test() assertions, then call apply_request_enhancements.',
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.applyRequestEnhancements],
    async handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const rawEnhancements = args.enhancements;
      if (!Array.isArray(rawEnhancements) || rawEnhancements.length === 0) {
        throw badRequest('"enhancements" must be a non-empty array');
      }

      const results: Array<{ requestId: string; applied: string[] }> = [];

      for (const item of rawEnhancements as Array<{ requestId: string; body?: string; testScript?: string }>) {
        const { requestId, body, testScript } = item;
        const flat = flattenRequests(col).find(({ request }) => request.id === requestId);
        if (!flat) {
          results.push({ requestId, applied: [`skipped: request not found`] });
          continue;
        }

        const applied: string[] = [];

        if (typeof body === 'string') {
          await services.collection.updateRequest(col.id, requestId, {
            body: { type: 'raw', content: body, format: 'json' } as any,
          });
          applied.push('body');
        }

        if (typeof testScript === 'string') {
          await services.collection.setRequestScript(col.id, requestId, 'post-response', testScript);
          applied.push('testScript');
        }

        results.push({ requestId, applied });
      }

      return {
        collection: col.name,
        results,
        totalUpdated: results.filter((r) => r.applied.length > 0 && !r.applied[0].startsWith('skipped')).length,
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.analyzeCoverage, GENERIC_TOOL_NAMES.aiAnalyzeCoverage],
    async handle({ args, services, collections, tool }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const folderFilter = typeof args.folder === 'string' ? args.folder.toLowerCase() : undefined;
      const all = flattenRequests(col).filter(
        ({ folderPath }) => !folderFilter || folderPath.toLowerCase().includes(folderFilter)
      );

      const perRequest = all.map(({ request: r, folderPath }) => {
        const script = services.collection.getRequestScript(col.id, r.id, 'post-response') ?? '';
        const assertionCount = (script.match(/pm\.test\s*\(/g) ?? []).length;
        return {
          id: r.id,
          name: r.name,
          method: r.method,
          folder: folderPath,
          hasAssertions: assertionCount > 0,
          assertionCount,
        };
      });

      const covered = perRequest.filter((r) => r.hasAssertions).length;
      const total = perRequest.length;
      const coveragePct = total === 0 ? 100 : Math.round((covered / total) * 100);

      // Optional: compare against OpenAPI spec
      let untestedOperations: Array<{ method: string; path: string }> = [];
      const specPathArg = typeof args.specPath === 'string' ? args.specPath.trim() : '';
      if (specPathArg) {
        try {
          const resolvedSpec = resolveSpecPath(specPathArg, services.workspaceFolder);
          const spec = await loadSpec(resolvedSpec);
          const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;
          for (const [opPath, methods] of Object.entries(paths)) {
            for (const method of HTTP_METHODS) {
              if (!(method in methods)) continue;
              const methodUpper = method.toUpperCase();
              const matched = all.some(({ request: r }) =>
                r.method.toUpperCase() === methodUpper &&
                (r.url ?? '').replace(/\{\{[^}]+\}\}/g, '{param}').includes(
                  opPath.replace(/\{[^}]+\}/g, '{param}').replace(/^\//, '')
                )
              );
              if (!matched) untestedOperations.push({ method: methodUpper, path: opPath });
            }
          }
        } catch {
          // Spec load failures are non-fatal — coverage analysis still returns
        }
      }

      const untestedRequests = perRequest.filter((r) => !r.hasAssertions);

      if (tool === GENERIC_TOOL_NAMES.aiAnalyzeCoverage) {
        const nextActions: string[] = [];
        if (untestedRequests.length > 0) {
          nextActions.push(
            `${untestedRequests.length} request(s) have no pm.test() assertions. ` +
            `Call ai_enhance_collection (collection="${col.name}") to add assertions to all of them.`
          );
        }
        if (untestedOperations.length > 0) {
          nextActions.push(
            `${untestedOperations.length} spec operation(s) have no matching collection request. ` +
            `Call generate_scenarios (collection="${col.name}") to generate negative and edge-case requests for them.`
          );
        }
        if (nextActions.length === 0) {
          nextActions.push(`Coverage is ${coveragePct}% — all requests have assertions and all spec operations are covered.`);
        }
        return {
          task: {
            action: 'ai_analyze_coverage',
            instructions: [
              'Review the coverage data below.',
              ...nextActions,
              'Address the highest-impact gap first. Do NOT ask for confirmation — proceed immediately.',
            ],
            collection: col.name,
            coveragePct,
            covered,
            total,
            untestedRequests,
            untestedOperations,
            expectedCallAfterThis: untestedRequests.length > 0 ? 'ai_enhance_collection' : untestedOperations.length > 0 ? 'generate_scenarios' : null,
          },
        };
      }

      return {
        collection: col.name,
        coveragePct,
        covered,
        total,
        requests: perRequest,
        ...(untestedOperations.length > 0 ? { untestedOperations } : {}),
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.generateRequestFromIntent],
    handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const intent = typeof args.intent === 'string' ? args.intent.trim() : '';
      if (!intent) throw badRequest('"intent" is required — describe what to test in plain English');

      // Collect context: existing request names/URLs + available env vars
      const all = flattenRequests(col);
      const requestSample = all.slice(0, 20).map(({ request: r, folderPath }) => ({
        name: r.name,
        method: r.method,
        url: r.url ?? '',
        folder: folderPath,
      }));
      const envVars = Object.keys(
        services.environmentConfig.getResolvedEnvironment(
          services.environmentConfig.getSelectedEnvironment()
        )?.variables ?? {}
      );

      const knowledge = workspaceKnowledgeSource(services.workspaceFolder).snapshot().body;

      return {
        task: {
          action: 'generate_request_from_intent',
          instructions: [
            `Intent: "${intent}"`,
            'Using the collection context below, determine: method, full URL (reuse existing {{vars}} where possible), headers, request body (if applicable), and expected HTTP status.',
            'Then immediately:',
            '  1. Call create_request with name, method, url, and body.',
            '  2. Call set_request_script (phase: "post-response") with pm.test() assertions that verify the intent.',
            'Do NOT ask for confirmation — implement the full request + assertions in one shot.',
          ],
          collection: col.name,
          intent,
          businessContext: [
            collectionKnowledgeSource(col).snapshot().body,
            knowledge,
          ]
            .filter(Boolean)
            .join('\n\n') || undefined,
          existingRequests: requestSample,
          availableEnvVars: envVars,
          targetFolder: typeof args.folder === 'string' ? args.folder : undefined,
          expectedCallAfterThis: 'create_request',
        },
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.designApiFromIntent],
    async handle({ args, services }) {
      const intent = typeof args.intent === 'string' ? args.intent.trim() : '';
      if (!intent) throw badRequest('"intent" is required — describe the API you want designed');

      // The architect needs a real AI provider. Prefer the one injected by the
      // server (extension wires Copilot); fall back to env-based providers.
      const provider = services.aiProvider ?? createEnvAiProvider();
      if (!provider) {
        throw new Error(
          'design_api_from_intent requires an AI provider. Set OPENAI_API_KEY or ANTHROPIC_API_KEY, ' +
          'or use the extension (which wires Copilot).'
        );
      }

      const importer = new OpenApiImporter(services.collection, services.environmentConfig);
      const exporter = new OpenApiExporter(
        services.collection,
        services.environmentConfig,
        new SchemaInferenceService({} as never, {} as never, {} as never)
      );
      const architect = new ApiArchitectService(importer, exporter, provider);

      const result = await architect.designFromIntent(intent, {
        collectionName: typeof args.collectionName === 'string' ? args.collectionName : undefined,
        baseUrl: typeof args.baseUrl === 'string' ? args.baseUrl : undefined,
        environmentName: typeof args.environmentName === 'string' ? args.environmentName : undefined,
        workspaceFolder: services.workspaceFolder,
      });

      // Approve step: persist the suite and write byproduct files.
      let applied: string[] = [];
      if (args.apply === true) {
        await services.testSuite.updateSuite(result.suite);
        applied.push(`suite:${result.suite.id}`);

        if (services.workspaceFolder) {
          const resolveOut = (p: string) =>
            path.isAbsolute(p) ? p : path.join(services.workspaceFolder!, p);
          if (typeof args.flowOut === 'string' && args.flowOut) {
            const p = resolveOut(args.flowOut);
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, result.flow, 'utf-8');
            applied.push(`flow:${p}`);
          }
          if (typeof args.docsOut === 'string' && args.docsOut) {
            const p = resolveOut(args.docsOut);
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, result.docs, 'utf-8');
            applied.push(`docs:${p}`);
          }
          if (typeof args.openapiOut === 'string' && args.openapiOut) {
            const p = resolveOut(args.openapiOut);
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, result.openapi, 'utf-8');
            applied.push(`openapi:${p}`);
          }
        }
      }

      return {
        intent: result.intent,
        collectionId: result.collectionId,
        collectionName: result.collectionName,
        environmentCreated: result.environmentCreated ?? null,
        aiGenerated: result.ai_generated,
        endpoints: result.endpoints.map((ep) => ({
          id: ep.id,
          method: ep.method,
          path: ep.pathExpression,
          name: ep.source?.symbolName ?? ep.pathExpression,
          auth: ep.auth?.required ?? false,
          confidence: ep.confidence,
        })),
        suite: {
          id: result.suite.id,
          name: result.suite.name,
          nodeCount: result.suite.nodes.length,
        },
        workflowChains: result.workflows.map((chain) => ({
          id: chain.id,
          kind: chain.kind,
          name: chain.name,
          producer: { method: chain.producer.method, path: chain.producer.path },
          dependents: chain.dependents.map((d) => ({ method: d.method, path: d.path })),
        })),
        flow: result.flow,
        openapi: result.openapi,
        docs: result.docs,
        applied,
        hint: args.apply !== true
          ? 'Review the designed package. Call again with "apply": true to persist the suite and byproduct files.'
          : undefined,
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.validateAgainstSpec],
    async handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const specPathArg = typeof args.specPath === 'string' ? args.specPath.trim() : '';
      if (!specPathArg) throw badRequest('"specPath" is required');

      const resolvedSpec = resolveSpecPath(specPathArg, services.workspaceFolder);

      let spec: Record<string, unknown>;
      try {
        spec = await loadSpec(resolvedSpec);
      } catch (e: unknown) {
        throw new Error(`Could not load spec at "${resolvedSpec}": ${e instanceof Error ? e.message : String(e)}`);
      }

      const specPaths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;
      const all = flattenRequests(col);

      const untestedOperations: Array<{ method: string; path: string; operationId?: string }> = [];
      const matchedWithoutAssertions: Array<{ method: string; path: string; requestName: string }> = [];
      const extraRequests: Array<{ method: string; url: string; requestName: string }> = [];

      const normalize = (s: string) =>
        s.replace(/\{\{[^}]+\}\}/g, '{p}').replace(/\{[^}]+\}/g, '{p}').replace(/\/+$/, '');

      for (const [opPath, methods] of Object.entries(specPaths)) {
        for (const method of HTTP_METHODS) {
          if (!(method in methods)) continue;
          const op = methods[method] as Record<string, unknown>;
          const methodUpper = method.toUpperCase();
          const normOp = normalize(opPath);
          const match = all.find(({ request: r }) =>
            r.method.toUpperCase() === methodUpper &&
            normalize(r.url ?? '').includes(normOp)
          );
          if (!match) {
            untestedOperations.push({ method: methodUpper, path: opPath, operationId: op.operationId as string | undefined });
          } else {
            const script = services.collection.getRequestScript(col.id, match.request.id, 'post-response') ?? '';
            const hasAssertions = /pm\.test\s*\(/.test(script);
            if (!hasAssertions) {
              matchedWithoutAssertions.push({ method: methodUpper, path: opPath, requestName: match.request.name });
            }
          }
        }
      }

      // Find collection requests whose URL/method is not in the spec
      const allSpecOps = new Set(
        Object.entries(specPaths).flatMap(([p, ms]) =>
          HTTP_METHODS.filter((m) => m in ms).map((m) => `${m.toUpperCase()}:${normalize(p)}`)
        )
      );
      for (const { request: r } of all) {
        const normUrl = normalize(r.url ?? '');
        const key = `${r.method.toUpperCase()}:`;
        const inSpec = [...allSpecOps].some((op) => op.startsWith(key) && normUrl.includes(op.split(':')[1]));
        if (!inSpec) {
          extraRequests.push({ method: r.method, url: r.url ?? '', requestName: r.name });
        }
      }

      return {
        collection: col.name,
        spec: path.basename(specPathArg),
        summary: {
          untestedOperations: untestedOperations.length,
          matchedWithoutAssertions: matchedWithoutAssertions.length,
          extraRequests: extraRequests.length,
        },
        untestedOperations,
        matchedWithoutAssertions,
        extraRequests,
        hint: untestedOperations.length > 0
          ? `Call generate_scenarios (collection="${col.name}") to create negative/edge-case requests for untested operations.`
          : 'All spec operations have matching collection requests.',
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.generateScenarios],
    handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const requestFilter = typeof args.request === 'string' ? args.request.trim().toLowerCase() : undefined;
      const folderFilter = typeof args.folder === 'string' ? args.folder.toLowerCase() : undefined;
      const offset = typeof args.offset === 'number' ? Math.max(0, args.offset) : 0;
      const limit = typeof args.limit === 'number' ? Math.min(10, Math.max(1, args.limit)) : 5;

      const all = flattenRequests(col).filter(({ request: r, folderPath }) => {
        if (requestFilter && r.name.toLowerCase() !== requestFilter && !r.name.toLowerCase().includes(requestFilter)) return false;
        if (folderFilter && !folderPath.toLowerCase().includes(folderFilter)) return false;
        return true;
      });

      const batch = all.slice(offset, offset + limit).map(({ request, folderPath }) => {
        // Batch is bounded (≤10); hydrate heavy fields once per item (cached after).
        const r = hydrateRequest(services, col.id, request);
        return {
        id: r.id,
        name: r.name,
        method: r.method,
        url: r.url ?? '',
        folder: folderPath,
        headers: (r.headers ?? []).filter((h) => h.enabled !== false).map((h) => ({ key: h.key, value: h.value })),
        body: r.body?.type === 'raw' && typeof r.body.content === 'string' ? r.body.content : undefined,
        currentTestScript: services.collection.getRequestScript(col.id, r.id, 'post-response') ?? undefined,
        description: r.description?.slice(0, 200),
        doc: r.doc ? r.doc.slice(0, 600) : undefined,
        operationId: r.operationId,
        };
      });

      const knowledge = workspaceKnowledgeSource(services.workspaceFolder).snapshot().body;

      return {
        task: {
          action: 'generate_scenarios',
          instructions: [
            'For each request below, generate negative and edge-case test scenario variants.',
            'Scenarios to generate per request (as applicable):',
            '  - Missing required fields → expect 400 or 422',
            '  - Invalid field type or format (e.g. string where number expected) → expect 400',
            '  - No Authorization header (remove it) → expect 401',
            '  - Valid auth but insufficient scope/role → expect 403',
            '  - Non-existent resource ID in URL → expect 404',
            '  - Boundary values: empty string, max-length string, 0, -1, very large number',
            'For each scenario:',
            '  1. Call create_request with a descriptive name (e.g. "Create User - Missing Email → 422"), method, url, and body.',
            '  2. Immediately call set_request_script (phase: "post-response") with the status assertion.',
            '  3. Place the new request in the same folder as the original (use folder argument in create_request).',
            'If task.hasMore is true, call generate_scenarios again with task.nextOffset after finishing this batch.',
            'Do NOT ask for confirmation — generate all scenarios autonomously.',
          ],
          collection: col.name,
          businessContext: [
            collectionKnowledgeSource(col).snapshot().body,
            knowledge,
          ]
            .filter(Boolean)
            .join('\n\n') || undefined,
          requests: batch,
          total: all.length,
          offset,
          hasMore: offset + limit < all.length,
          nextOffset: offset + limit,
          expectedCallAfterThis: 'create_request',
        },
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.healAssertions],
    handle({ args, services, collections, runStore }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const req = hydrateRequest(services, col.id, resolveRequestByLabel(args.request, col));
      const currentScript = services.collection.getRequestScript(col.id, req.id, 'post-response') ?? '';

      // Try to get last response from runStore if runId provided
      let lastResponse: Record<string, unknown> | undefined;
      const runIdArg = typeof args.runId === 'string' ? args.runId.trim() : undefined;
      if (runIdArg) {
        try {
          const rec = runStore.require(runIdArg);
          const result = (rec.allResults as Array<Record<string, unknown>>).find(
            (r) => typeof r.name === 'string' && r.name.toLowerCase() === req.name.toLowerCase()
          );
          if (result) {
            lastResponse = {
              status: result.status,
              responseBody: result.responseBody,
              responseHeaders: result.responseHeaders,
              failedTests: result.failedTests,
            };
          }
        } catch {
          // runId not found — continue without it
        }
      }

      return {
        task: {
          action: 'heal_assertions',
          instructions: [
            `Request: ${req.method} ${req.url ?? ''}`,
            'The current test script may have stale or incorrect assertions (e.g. wrong status code, missing/renamed fields).',
            'Compare task.currentScript against task.lastResponse (if available).',
            'Rewrite the complete post-response script so all assertions match the observed response while keeping valid checks.',
            'Call set_request_script (phase: "post-response") with the updated script immediately.',
            'Do NOT ask for confirmation.',
          ],
          collection: col.name,
          request: req.name,
          method: req.method,
          url: req.url ?? '',
          businessContext: [
            requestKnowledgeSource(req, findRequestFolder(col, req)).snapshot().body,
            workspaceKnowledgeSource(services.workspaceFolder).snapshot().body,
          ]
            .filter(Boolean)
            .join('\n\n') || undefined,
          currentScript,
          lastResponse: lastResponse ?? null,
          note: lastResponse
            ? 'Last response data available — use it to align assertions with actual behavior.'
            : 'No run data available — run the request first with run_request, then call heal_assertions again with the runId.',
          expectedCallAfterThis: 'set_request_script',
        },
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.generateIterationData],
    handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const req = hydrateRequest(services, col.id, resolveRequestByLabel(args.request, col));
      const iterations = typeof args.iterations === 'number'
        ? Math.min(50, Math.max(1, args.iterations))
        : 5;

      const body = req.body?.type === 'raw' && typeof req.body.content === 'string'
        ? req.body.content
        : undefined;
      const headers = (req.headers ?? []).filter((h) => h.enabled !== false).map((h) => ({ key: h.key, value: h.value }));
      const queryParams = (req.query ?? []).filter((q) => q.enabled !== false).map((q) => ({ key: q.key, value: q.value }));

      // Extract {{variable}} placeholders from URL, body, headers
      const placeholderRe = /\{\{([^}]+)\}\}/g;
      const placeholders = new Set<string>();
      for (const str of [req.url ?? '', body ?? '', ...headers.map((h) => h.value), ...queryParams.map((q) => q.value)]) {
        let m: RegExpExecArray | null;
        placeholderRe.lastIndex = 0;
        while ((m = placeholderRe.exec(str)) !== null) placeholders.add(m[1]);
      }

      return {
        task: {
          action: 'generate_iteration_data',
          instructions: [
            `Generate ${iterations} test data rows for: ${req.method} ${req.url ?? ''}`,
            `The request uses these {{variable}} placeholders: ${[...placeholders].join(', ') || '(none detected)'}`,
            'Each row must be a JSON object whose keys match the placeholder names.',
            'Cover a mix of: (1) valid happy-path data, (2) boundary values, (3) invalid inputs that should fail, (4) edge cases.',
            'Return the rows as a JSON array in a code block labeled "iterationData".',
            'This data can be used with: http-forge run-request --collection ... --variables \'[...]\' or passed to run_request via the variables argument.',
          ],
          collection: col.name,
          request: req.name,
          method: req.method,
          url: req.url ?? '',
          businessContext: requestKnowledgeSource(req, findRequestFolder(col, req)).snapshot().body || undefined,
          body: body ?? null,
          headers,
          queryParams,
          placeholders: [...placeholders],
          iterations,
        },
      };
    },
  },
];
