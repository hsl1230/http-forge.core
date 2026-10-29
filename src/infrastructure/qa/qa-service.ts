/**
 * QA Check service — one-shot API quality gate.
 *
 * Orchestrates the discover → generate → run → report loop in a single call:
 * source-code discovery, idempotent request creation (reuse by endpoint key,
 * never duplicate), deterministic suite generation, live execution, and a
 * machine-readable report with CI-friendly status.
 *
 * All stage logic lives in its existing module (drift-engine, discovery
 * providers, test-generator, suite executor). This module only sequences them.
 */

import type { IConfigService } from '../config';
import type { ICollectionService, CollectionItem, CollectionRequestItem } from '../../types/collection';
import type { ITestSuiteService } from '../test-suite/interfaces';
import type { DiscoveryConfig } from '../config';
import {
    ApiDiscoveryService,
    computeProjectFreshness,
    detectProjectDrift,
    endpointToCreateRequestOptions,
    ExpressDiscoveryProvider,
    FastApiDiscoveryProvider,
    FastifyDiscoveryProvider,
    generateSuiteFromEndpoints,
    LambdaDiscoveryProvider,
    NestDiscoveryProvider,
    SpringDiscoveryProvider,
    suiteIdFromName,
} from '../api-discovery';
import type { DiscoveredApi } from '../api-discovery';
import { resolveCollectionRef } from '../../runtime/ref-resolver';
import { runSuite } from '../../runtime/direct-execution';
import { suggestAssertionsWithAi } from '../../runtime/mcp-handlers/ai';
import type { IAiProvider } from '../ai/ai-provider';

/** Services the QA check is sequenced over (narrow interface — no container). */
export interface QaCheckServices {
    collection: ICollectionService;
    testSuite: ITestSuiteService;
    /** Optional: discovery tuning. Defaults apply when absent (e.g. MCP). */
    config?: IConfigService;
}

/** Options for a QA check run. */
export interface QaCheckOptions {
    /** Backend project root to scan. */
    projectPath: string;
    /** Target collection (id, slug, or name). Requests are created/reused here. */
    collectionRef: string;
    /** Running server to execute against. Required unless `dryRun`. */
    baseUrl?: string;
    /** Environment name for variable resolution. */
    environment?: string;
    /** Extra variables injected into every request (e.g. auth tokens). */
    variables?: Record<string, unknown>;
    /** Restrict discovery to one framework (express, nestjs, fastify, lambda, spring, fastapi). */
    framework?: string;
    /** Preview only: no requests created, nothing saved, no network calls. */
    dryRun?: boolean;
    /** Return `drift` status instead of proceeding when the project moved. */
    failOnDrift?: boolean;
    /** Git HEAD from a prior scan (enables git-based drift comparison). */
    storedGitHash?: string;
    /** Scan time from a prior scan (enables mtime-based drift comparison). */
    storedScannedAt?: string;
    /** Also assert JSON array response bodies in generated suites. */
    assertBodySchema?: boolean;
    /** Request an AI assertion pass after the deterministic run (needs `aiProvider`). */
    aiAssertions?: boolean;
    /** AI backend for the assertion pass. Without it, the flag is noted and skipped. */
    aiProvider?: IAiProvider;
    /** Max AI suggestions per endpoint (default 5). */
    aiMaxSuggestions?: number;
}

/** Terminal status of a QA check (maps to CLI exit codes 0/1/3/2). */
export type QaCheckStatus = 'pass' | 'fail' | 'drift' | 'infra' | 'dry-run';

/** Per-endpoint row of the QA report. */
export interface QaEndpointResult {
    /** Stable endpoint key: `METHOD /resolved/path`. */
    endpointKey: string;
    method: string;
    path: string;
    confidence: DiscoveredApi['confidence'];
    requestId: string;
    requestName: string;
    /** True when an existing collection request was reused. */
    reused: boolean;
    statusExpected: number;
    statusGot?: number;
    passed?: boolean;
    duration?: string;
    failures?: string[];
    error?: string;
    /** AI-suggested assertions (only when the `aiAssertions` pass ran for this endpoint). */
    suggestions?: Array<{ snippet: string; rationale: string }>;
}

/** Machine-readable QA check report (JSON-serializable). */
export interface QaCheckReport {
    status: QaCheckStatus;
    project: {
        path: string;
        gitHash?: string;
        frameworks: string[];
    };
    drift: {
        status: 'current' | 'stale' | 'unknown';
        reason?: string;
    };
    discovered: number;
    reused: number;
    created: number;
    updatedUrls: number;
    suite?: { id: string; name: string };
    results: { passed: number; failed: number; skipped: number };
    endpoints: QaEndpointResult[];
    /** Low-confidence discoveries are reported, never silently dropped. */
    lowConfidence: string[];
    /** Outcome of the optional AI assertion pass. */
    aiAssertions: { requested: boolean; applied: boolean; note?: string };
    checkedAt: string;
}

/** Stable endpoint identity across runs: method + resolved path. */
export function qaEndpointKey(ep: Pick<DiscoveredApi, 'method' | 'resolvedPath' | 'pathExpression'>): string {
    return `${(ep.method || 'GET').toUpperCase()} ${ep.resolvedPath ?? ep.pathExpression}`;
}

/** Requests created by generation carry provenance in their description. */
function isGeneratedRequest(req: CollectionRequestItem): boolean {
    return (req.description ?? '').includes('Discovered from ');
}

/** Path portion of a URL (or path expression) for endpoint matching. */
function urlPath(url: string | undefined): string {
    if (!url) return '';
    try {
        return new URL(url, 'http://qa.local').pathname.replace(/\/+$/, '') || '/';
    } catch {
        return url;
    }
}

function collectRequests(items: CollectionItem[], out: CollectionRequestItem[]): void {
    for (const item of items) {
        if (item.type === 'request') out.push(item);
        else if (item.type === 'folder' && item.items) collectRequests(item.items, out);
    }
}

function buildProviders(framework: string | undefined) {
    const all = [
        new ExpressDiscoveryProvider(),
        new NestDiscoveryProvider(),
        new FastifyDiscoveryProvider(),
        new LambdaDiscoveryProvider(),
        new SpringDiscoveryProvider(),
        new FastApiDiscoveryProvider(),
    ];
    if (!framework) return all;
    const q = framework.toLowerCase();
    const filtered = all.filter((p) => p.framework === q);
    if (filtered.length === 0) {
        throw new Error(
            `unknown framework "${framework}" (expected one of: ${all.map((p) => p.framework).join(', ')})`
        );
    }
    return filtered;
}

/**
 * Run the QA check pipeline: freshness → discover → generate → run → report.
 *
 * Idempotent: reruns reuse existing requests matched by endpoint key and
 * overwrite the deterministic QA suite, so repeated runs create nothing new
 * unless the source changed.
 */
export async function runQaCheck(
    services: QaCheckServices,
    workspaceFolder: string,
    options: QaCheckOptions
): Promise<QaCheckReport> {
    const dryRun = options.dryRun === true;
    const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');

    // ── Stage 1: freshness ──────────────────────────────────────────────
    const freshness = computeProjectFreshness(options.projectPath);
    const hasStored = options.storedGitHash !== undefined || options.storedScannedAt !== undefined;
    const drift = detectProjectDrift(
        options.projectPath,
        hasStored
            ? { gitHash: options.storedGitHash, scannedAt: options.storedScannedAt ?? new Date(0).toISOString() }
            : undefined
    );

    if (options.failOnDrift === true && drift.status === 'stale') {
        return {
            status: 'drift',
            project: { path: options.projectPath, gitHash: freshness.gitHash, frameworks: [] },
            drift: { status: drift.status, reason: drift.reason },
            discovered: 0,
            reused: 0,
            created: 0,
            updatedUrls: 0,
            results: { passed: 0, failed: 0, skipped: 0 },
            endpoints: [],
            lowConfidence: [],
            aiAssertions: { requested: options.aiAssertions === true, applied: false },
            checkedAt: new Date().toISOString(),
        };
    }

    // ── Stage 2: discover ───────────────────────────────────────────────
    let discoveryConfig: DiscoveryConfig = {} as DiscoveryConfig;
    try {
        const fromService = services.config?.getDiscoveryConfig();
        if (fromService) discoveryConfig = fromService;
    } catch {
        // Defaults apply (e.g. MCP callers without a config service).
    }
    const discovery = new ApiDiscoveryService({ providers: buildProviders(options.framework) });
    let discovered: DiscoveredApi[];
    let frameworks: string[];
    try {
        const result = await discovery.discover({ workspaceFolder: options.projectPath, ...discoveryConfig });
        discovered = [...result.endpoints].sort(
            (a, b) => qaEndpointKey(a).localeCompare(qaEndpointKey(b))
        );
        frameworks = result.stats?.frameworksDetected ?? [];
    } catch (error) {
        throw new Error(`discovery failed for ${options.projectPath}: ${(error as Error).message}`);
    }

    // ── Resolve collection ──────────────────────────────────────────────
    const { collection: col } = resolveCollectionRef(
        services.collection.getAllCollections(),
        options.collectionRef
    );

    const lowConfidence = discovered
        .filter((ep) => ep.confidence === 'low')
        .map((ep) => qaEndpointKey(ep));

    // ── Stage 3: generate (idempotent create/reuse) ─────────────────────
    const existing: CollectionRequestItem[] = [];
    collectRequests(col.items, existing);

    let reused = 0;
    let created = 0;
    let updatedUrls = 0;
    const endpointsForSuite: DiscoveredApi[] = [];
    const endpointRows = new Map<string, QaEndpointResult>();

    for (const ep of discovered) {
        const key = qaEndpointKey(ep);
        const method = (ep.method || 'GET').toUpperCase();
        const epPath = urlPath(ep.resolvedPath ?? ep.pathExpression);
        const match = existing.find(
            (r) => (r.method || 'GET').toUpperCase() === method && urlPath(r.url) === epPath
        );
        const statusExpected = ep.responses?.[0]?.statusCode ?? 200;

        if (match) {
            reused++;
            if (!dryRun && baseUrl && isGeneratedRequest(match)) {
                const built = endpointToCreateRequestOptions(ep, col.id, baseUrl);
                if (match.url !== built.url) {
                    await services.collection.updateRequest(col.id, match.id, { url: built.url });
                    updatedUrls++;
                }
            }
            endpointsForSuite.push({ ...ep, id: match.id });
            endpointRows.set(key, {
                endpointKey: key,
                method,
                path: ep.resolvedPath ?? ep.pathExpression,
                confidence: ep.confidence,
                requestId: match.id,
                requestName: match.name,
                reused: true,
                statusExpected,
            });
        } else {
            if (!dryRun) {
                if (!baseUrl) {
                    throw new Error(
                        `base-url is required to create requests (endpoint ${key} has no reusable request). ` +
                        `Pass --base-url or re-run with --dry-run to preview.`
                    );
                }
                const req = await services.collection.createRequest(
                    endpointToCreateRequestOptions(ep, col.id, baseUrl)
                );
                if (req.type !== 'request') {
                    throw new Error(`QA check produced a non-request item for endpoint ${key}.`);
                }
                created++;
                existing.push(req);
                endpointsForSuite.push({ ...ep, id: req.id });
                endpointRows.set(key, {
                    endpointKey: key,
                    method,
                    path: ep.resolvedPath ?? ep.pathExpression,
                    confidence: ep.confidence,
                    requestId: req.id,
                    requestName: req.name,
                    reused: false,
                    statusExpected,
                });
            } else {
                endpointsForSuite.push(ep);
                endpointRows.set(key, {
                    endpointKey: key,
                    method,
                    path: ep.resolvedPath ?? ep.pathExpression,
                    confidence: ep.confidence,
                    requestId: '',
                    requestName: endpointToNameOf(ep),
                    reused: false,
                    statusExpected,
                });
            }
        }
    }

    const suiteName = `QA ${col.name}`;
    const { suite } = generateSuiteFromEndpoints(endpointsForSuite, {
        collectionId: col.id,
        collectionName: col.name,
        name: suiteName,
        id: suiteIdFromName(suiteName),
        assertBodySchema: options.assertBodySchema,
    });

    if (!dryRun) {
        if (created > 0 || updatedUrls > 0) {
            await services.collection.saveCollection(col);
        }
        await services.testSuite.updateSuite(suite);
    }

    // ── Stage 4: run ────────────────────────────────────────────────────
    if (dryRun) {
        return {
            status: 'dry-run',
            project: { path: options.projectPath, gitHash: freshness.gitHash, frameworks },
            drift: { status: drift.status, reason: drift.reason },
            discovered: discovered.length,
            reused,
            created,
            updatedUrls,
            suite: { id: suite.id, name: suite.name },
            results: { passed: 0, failed: 0, skipped: discovered.length },
            endpoints: [...endpointRows.values()],
            lowConfidence,
            // The AI pass needs run results, so dry-run records the request only.
            aiAssertions: { requested: options.aiAssertions === true, applied: false },
            checkedAt: new Date().toISOString(),
        };
    }

    if (!baseUrl && created > 0) {
        // Unreachable: creation already requires baseUrl. Guard for safety.
        throw new Error('base-url is required to run a QA check (pass --base-url or --dry-run).');
    }

    const run = (await runSuite({
        workspaceFolder,
        suiteId: suite.id,
        environment: options.environment,
        variables: options.variables,
        include: ['perRequest', 'failedOnly'],
    })) as {
        summary?: { passed?: number; failed?: number; total?: number };
        results?: Array<{ name?: string; status?: number; duration?: string; allPassed?: boolean }>;
        failedRequests?: Array<{
            name?: string; method?: string; url?: string; status?: number;
            duration?: string; error?: string;
            failedTests?: Array<{ name?: string; message?: string }>;
        }>;
    };

    const failedByName = new Map((run.failedRequests ?? []).map((f) => [f.name ?? '', f]));
    const perRequestByName = new Map((run.results ?? []).map((r) => [r.name ?? '', r]));
    let passed = 0;
    let failed = 0;

    for (const row of endpointRows.values()) {
        const failure = failedByName.get(row.requestName);
        const per = perRequestByName.get(row.requestName);
        if (failure) {
            row.passed = false;
            row.statusGot = failure.status;
            row.duration = failure.duration;
            row.error = failure.error;
            row.failures = (failure.failedTests ?? []).map((t) =>
                t.message ? `${t.name ?? 'assertion'}: ${t.message}` : (t.name ?? 'assertion')
            );
            failed++;
        } else {
            row.passed = true;
            row.statusGot = per?.status ?? row.statusExpected;
            row.duration = per?.duration;
            passed++;
        }
    }

    // ── Stage 5: optional AI assertion pass ─────────────────────────────
    // Deterministic assertions already ran. The LLM pass proposes richer
    // business-logic assertions as reviewable suggestions — never a gate.
    // Failures first, capped so large suites don't fan out unbounded calls.
    let aiNote: string | undefined;
    let aiApplied = false;
    if (options.aiAssertions === true) {
        if (!options.aiProvider) {
            aiNote =
                'ai-assertions requested but no AI provider is available ' +
                '(set OPENAI_API_KEY / ANTHROPIC_API_KEY or configure a provider).';
        } else {
            const prioritized = [...endpointRows.values()].sort(
                (a, b) => Number(a.passed === false) - Number(b.passed === false)
            );
            const capped = prioritized.slice(0, 10);
            if (prioritized.length > capped.length) {
                aiNote = `AI assertion pass capped at 10 of ${prioritized.length} endpoints.`;
            }
            for (const row of capped) {
                try {
                    const req = services.collection.getRequestDetail(col.id, row.requestId);
                    if (!req) continue;
                    const fail = failedByName.get(row.requestName);
                    const suggestions = await suggestAssertionsWithAi(
                        options.aiProvider,
                        req,
                        toLatestResult(fail, row),
                        options.aiMaxSuggestions ?? 5,
                        undefined
                    );
                    if (suggestions.length > 0) {
                        row.suggestions = suggestions;
                        aiApplied = true;
                    }
                } catch {
                    // Per-endpoint AI failure is non-fatal — deterministic results stand.
                }
            }
        }
    }

    return {
        status: failed === 0 ? 'pass' : 'fail',
        project: { path: options.projectPath, gitHash: freshness.gitHash, frameworks },
        drift: { status: drift.status, reason: drift.reason },
        discovered: discovered.length,
        reused,
        created,
        updatedUrls,
        suite: { id: suite.id, name: suite.name },
        results: { passed, failed, skipped: 0 },
        endpoints: [...endpointRows.values()],
        lowConfidence,
        aiAssertions: {
            requested: options.aiAssertions === true,
            applied: aiApplied,
            ...(aiNote ? { note: aiNote } : {}),
        },
        checkedAt: new Date().toISOString(),
    };
}

/** Adapt a suite failure entry to the observed-result shape AI prompts expect. */
function toLatestResult(
    fail:
        | {
              status?: number;
              body?: unknown;
              headers?: unknown;
              failedTests?: Array<{ name?: string; message?: string }>;
          }
        | undefined,
    row: QaEndpointResult
): Record<string, unknown> | undefined {
    if (!fail) {
        return { status: row.statusGot ?? row.statusExpected };
    }
    return {
        status: fail.status,
        responseBody:
            typeof fail.body === 'string' ? fail.body : JSON.stringify(fail.body ?? ''),
        responseHeaders: fail.headers,
        failedTests: fail.failedTests,
    };
}

function endpointToNameOf(ep: DiscoveredApi): string {
    return ep.source?.symbolName || `${ep.method || 'GET'} ${ep.pathExpression}`;
}
