/**
 * Review Engine
 *
 * Single Responsibility: Run the deterministic review rules over a suite +
 * run-results pair (Phase 3, Layer 7) and produce a structured ReviewReport.
 *
 * Determinism contract (from the plan): rules are pure, repeatable functions —
 * the same suite + run-results always yield the same findings. This is what
 * makes the review gate CI-usable (a reviewer that depends on an LLM is
 * non-deterministic and unreviewable). An LLM may ENRICH the report later
 * (see mcp-prompts buildReviewSuitePrompt), but it never IS the rules.
 *
 * The engine deliberately has zero `vscode` imports and depends only on the
 * normalized inputs below so CLI/MCP/CI all share the same implementation.
 */

import type { TestSuite } from '../test-suite/interfaces';

// ── Severity / report model ──────────────────────────────────────────────────

export type ReviewSeverity = 'error' | 'warn' | 'info';

/**
 * A single request-level result. The run stores use `responseStatus` on failed
 * results and `status` elsewhere, and may split failed tests into `failedTests`,
 * so both shapes are accepted and normalized here.
 */
export interface ReviewRequestResult {
  name: string;
  method?: string;
  url?: string;
  /** Numeric HTTP status (accepts either storage shape). */
  status?: number;
  responseStatus?: number;
  /** Raw response body (string or parsed). */
  body?: unknown;
  requestBody?: unknown;
  /** Transport/script-level error (request never produced a response). */
  error?: string;
  /** Response time in milliseconds. */
  duration?: number;
  assertions?: Array<{ name: string; passed: boolean; message?: string }>;
  /** Alternative shape used by direct-execution failed results. */
  failedTests?: Array<{ name: string; message?: string }>;
}

export interface ReviewFinding {
  /** Stable rule id (used by CI gates and the LLM-enrichment step). */
  rule: string;
  severity: ReviewSeverity;
  /** Short headline, safe to render as a list item. */
  title: string;
  /** Human-readable detail. */
  message: string;
  /** The affected request, when the finding is request-scoped. */
  requestName?: string;
  /** Concrete remediation, when known. */
  suggestion?: string;
}

export interface ReviewOptions {
  /** Responses slower than this (ms) are flagged slow-response. Default 2000. */
  slowResponseMs?: number;
  /** When a request has no assertions, skip the missing-assertions warning. */
  allowNoAssertions?: boolean;
}

export interface ReviewReport {
  suiteId?: string;
  suiteName?: string;
  runId?: string;
  generatedAt: number;
  summary: { errors: number; warnings: number; infos: number; total: number; pass: boolean };
  findings: ReviewFinding[];
  rulesRun: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SENSITIVE_KEY_RE = /(password|passwd|pwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|private[_-]?key|cookie|token)\b/i;
const SENSITIVE_VALUE_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}|bearer\s+[a-z0-9._~+/=-]{12,}|-----BEGIN/i;

function normalizedStatus(r: ReviewRequestResult): number | undefined {
  return r.status ?? r.responseStatus;
}

function allAssertions(r: ReviewRequestResult): Array<{ name: string; passed: boolean; message?: string }> {
  if (r.assertions && r.assertions.length > 0) return r.assertions;
  if (r.failedTests && r.failedTests.length > 0) {
    return r.failedTests.map((t) => ({ name: t.name, passed: false, message: t.message }));
  }
  return [];
}

function hasFailedAssertions(r: ReviewRequestResult): boolean {
  const list = allAssertions(r);
  return list.some((a) => a.passed === false);
}

function responseBodyText(r: ReviewRequestResult): string {
  const body = r.body;
  if (typeof body === 'string') return body;
  if (body === undefined || body === null) return '';
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

/** True when the suite (or its run result) asserts anything about the 401/403 auth path. */
function assertsAuthPath(r: ReviewRequestResult): boolean {
  const joined = allAssertions(r)
    .map((a) => `${a.name} ${a.message ?? ''}`)
    .join(' ');
  return /401|403|unauthor|forbidden|auth/i.test(joined);
}

/**
 * Assertion coverage for a request from its suite node (static) and its run
 * result (observed). A request counts as covered when either side defines
 * assertions.
 */
function hasAnyAssertions(r: ReviewRequestResult): boolean {
  return allAssertions(r).length > 0;
}

// ── Rules ────────────────────────────────────────────────────────────────────

/** Rule 1: response bodies must not leak secrets/passwords. */
function ruleResponseLeaksSecrets(r: ReviewRequestResult, findings: ReviewFinding[]): void {
  if (normalizedStatus(r) === undefined && !r.error) return;
  const body = responseBodyText(r);
  if (!body) return;
  if (SENSITIVE_KEY_RE.test(body) && SENSITIVE_VALUE_RE.test(body)) {
    findings.push({
      rule: 'response-leaks-secrets',
      severity: 'error',
      title: 'Response may leak a secret',
      message: `Response body of "${r.name}" contains both a sensitive key (password/secret/token/api-key) and a secret-looking value (JWT, bearer token, or PEM block).`,
      requestName: r.name,
      suggestion: 'Redact sensitive fields server-side, or verify this endpoint is meant to return credentials (e.g. a /login response) and assert the exact shape rather than echoing it.',
    });
  }
}

/** Rule 2: server errors (5xx) are always flagged. */
function ruleServerError(r: ReviewRequestResult, findings: ReviewFinding[]): void {
  const status = normalizedStatus(r);
  if (status === undefined) return;
  if (status >= 500) {
    findings.push({
      rule: 'server-error',
      severity: 'error',
      title: `Unexpected ${status} server error`,
      message: `"${r.name}" returned HTTP ${status}.`,
      requestName: r.name,
      suggestion: 'Check the server logs for the 5xx cause; a passing suite must not contain server errors.',
    });
  }
}

/** Rule 3: transport/script errors are flagged. */
function ruleRequestError(r: ReviewRequestResult, findings: ReviewFinding[]): void {
  if (!r.error) return;
  findings.push({
    rule: 'request-error',
    severity: 'error',
    title: 'Request failed to execute',
    message: `"${r.name}" failed with: ${r.error}`,
    requestName: r.name,
    suggestion: 'Fix the URL/connection/script error so the request actually runs.',
  });
}

/** Rule 4: failed assertions are flagged. */
function ruleFailedAssertions(r: ReviewRequestResult, findings: ReviewFinding[]): void {
  const failed = allAssertions(r).filter((a) => !a.passed);
  if (failed.length === 0) return;
  findings.push({
    rule: 'failed-assertions',
    severity: 'error',
    title: `${failed.length} assertion${failed.length === 1 ? '' : 's'} failed`,
    message: `"${r.name}" — ${failed.map((a) => `"${a.name}"${a.message ? `: ${a.message}` : ''}`).join('; ')}`,
    requestName: r.name,
    suggestion: 'Fix the failing assertion or the request so the suite is green.',
  });
}

/** Rule 5: DELETE returning a 2xx other than 204 violates the REST convention. */
function ruleDeleteNot204(r: ReviewRequestResult, findings: ReviewFinding[]): void {
  if ((r.method ?? '').toUpperCase() !== 'DELETE') return;
  const status = normalizedStatus(r);
  if (status === undefined) return;
  if (status >= 200 && status < 300 && status !== 204) {
    findings.push({
      rule: 'delete-not-204',
      severity: 'warn',
      title: 'DELETE returned a non-204 success',
      message: `"${r.name}" returned HTTP ${status} for a DELETE. The REST convention is 204 No Content.`,
      requestName: r.name,
      suggestion: 'Return 204 (or assert the actual contract if the API intentionally returns a body, e.g. 200 with a deleted resource).',
    });
  }
}

/** Rule 6: requests without assertions are untested. */
function ruleMissingAssertions(r: ReviewRequestResult, findings: ReviewFinding[]): void {
  if (hasAnyAssertions(r)) return;
  findings.push({
    rule: 'missing-assertions',
    severity: 'warn',
    title: 'No assertions on this request',
    message: `"${r.name}" executed without any pm.test()/pm.expect() assertion, so a regression would not be caught.`,
    requestName: r.name,
    suggestion: 'Add assertions for status, body shape, and any side-effect the request produces.',
  });
}

/** Rule 7: an observed 401/403 with no assertion about it is an unhandled auth path. */
function ruleAuthFailureUnhandled(r: ReviewRequestResult, findings: ReviewFinding[]): void {
  const status = normalizedStatus(r);
  if (status !== 401 && status !== 403) return;
  if (assertsAuthPath(r)) return;
  findings.push({
    rule: 'auth-failure-unhandled',
    severity: 'warn',
    title: `Auth failure (${status}) not asserted`,
    message: `"${r.name}" received HTTP ${status} but no assertion verifies the auth/401/403 path.`,
    requestName: r.name,
    suggestion: 'Add a pm.test asserting the 401/403 (e.g. pm.test("rejects unauthenticated", () => pm.response.to.have.status(401))) so the auth contract is pinned.',
  });
}

/** Rule 8: slow responses. */
function ruleSlowResponse(r: ReviewRequestResult, findings: ReviewFinding[], thresholdMs: number): void {
  const duration = r.duration;
  if (duration === undefined || duration < thresholdMs) return;
  findings.push({
    rule: 'slow-response',
    severity: 'warn',
    title: `Slow response (${duration}ms)`,
    message: `"${r.name}" took ${duration}ms, exceeding the ${thresholdMs}ms threshold.`,
    requestName: r.name,
    suggestion: 'Investigate latency (N+1 queries, missing indexes, slow third-party calls) or raise the threshold if this is expected.',
  });
}

// ── Entry point ──────────────────────────────────────────────────────────────

const RULES_RUN = [
  'response-leaks-secrets',
  'server-error',
  'request-error',
  'failed-assertions',
  'delete-not-204',
  'missing-assertions',
  'auth-failure-unhandled',
  'slow-response',
] as const;

/**
 * Review a suite run: run every deterministic rule over the normalized
 * request results and summarize into a ReviewReport.
 *
 * `suite` is optional — run-results alone produce a valid review. When
 * provided, its id/name are carried into the report and its request nodes are
 * used to annotate assertion coverage (see `annotateSuiteCoverage`).
 */
export function reviewSuiteRun(
  suite: TestSuite | undefined,
  results: ReviewRequestResult[],
  options?: ReviewOptions
): ReviewReport {
  const thresholdMs = options?.slowResponseMs ?? 2000;
  const findings: ReviewFinding[] = [];

  for (const r of results) {
    ruleResponseLeaksSecrets(r, findings);
    ruleServerError(r, findings);
    ruleRequestError(r, findings);
    ruleFailedAssertions(r, findings);
    ruleDeleteNot204(r, findings);
    if (!options?.allowNoAssertions) ruleMissingAssertions(r, findings);
    ruleAuthFailureUnhandled(r, findings);
    ruleSlowResponse(r, findings, thresholdMs);
  }

  if (suite && suite.nodes && suite.nodes.length > 0) {
    annotateSuiteCoverage(suite, results, findings);
  }

  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.rule.localeCompare(b.rule));

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warn').length;
  const infos = findings.filter((f) => f.severity === 'info').length;

  return {
    suiteId: suite?.id,
    suiteName: suite?.name,
    generatedAt: Date.now(),
    summary: {
      errors,
      warnings,
      infos,
      total: findings.length,
      pass: errors === 0,
    },
    findings,
    rulesRun: [...RULES_RUN],
  };
}

function severityRank(s: ReviewSeverity): number {
  if (s === 'error') return 0;
  if (s === 'warn') return 1;
  return 2;
}

/**
 * Suite-side coverage annotation: any request node defined in the suite that
 * never ran (no matching run result) and has no assertions is a coverage gap.
 * This keeps the review honest about requests the run skipped entirely.
 */
function annotateSuiteCoverage(suite: TestSuite, results: ReviewRequestResult[], findings: ReviewFinding[]): void {
  const seen = new Set(
    results.map((r) => r.name.trim().toLowerCase()).filter(Boolean)
  );
  for (const node of suite.nodes) {
    if (node.type !== 'request') continue;
    const reqName = node.request?.name;
    if (!reqName) continue;
    const key = reqName.trim().toLowerCase();
    if (seen.has(key)) continue;
    const scripts = node.postResponseScript ?? [];
    const hasAssertions = scripts.some((s) => /pm\.test\s*\(|pm\.expect\s*\(/.test(s));
    if (!hasAssertions) {
      findings.push({
        rule: 'missing-assertions',
        severity: 'warn',
        title: 'Suite request never ran',
        message: `"${reqName}" is defined in the suite but did not execute in this run and has no assertions.`,
        requestName: reqName,
        suggestion: 'Enable the request in the suite, or add assertions and confirm it executes.',
      });
    }
  }
}

/**
 * Normalize an McpRunRecord-style run into ReviewRequestResult[].
 * Accepts both a full record ({ allResults }) and a bare array.
 */
export function toReviewRequestResults(run: unknown): ReviewRequestResult[] {
  if (Array.isArray(run)) return run as ReviewRequestResult[];
  if (run && typeof run === 'object') {
    const rec = run as { allResults?: unknown[] };
    if (Array.isArray(rec.allResults)) return rec.allResults as ReviewRequestResult[];
  }
  return [];
}
