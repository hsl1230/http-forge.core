/**
 * Review tool handlers (Phase 3, Layer 7).
 *
 * Deterministic-first: the rule engine runs over the suite + run-results and
 * produces a structured ReviewReport. An optional AI provider then enriches
 * the findings with prioritized prose — the rules NEVER depend on the LLM
 * (that would make the gate non-deterministic and CI-unusable).
 */

import { withAiRetry } from '../../infrastructure/ai/ai-utils';
import { reviewSuiteRun, toReviewRequestResults } from '../../infrastructure/review';
import { buildReviewSuitePrompt } from '../mcp-prompts';
import { GENERIC_TOOL_NAMES } from '../mcp-tool-schemas';
import { badRequest, resolveSuiteByLabel } from './helpers';
import type { McpToolHandler } from './types';

export const reviewHandlers: McpToolHandler[] = [
  {
    toolNames: [GENERIC_TOOL_NAMES.reviewSuite],
    async handle({ args, services, runStore }) {
      const runId = typeof args.runId === 'string' ? args.runId.trim() : undefined;
      if (!runId) {
        throw badRequest('"runId" is required — the id of a completed suite run.');
      }
      const rec = runStore.require(runId);
      if (rec.status === 'running') {
        return {
          runId,
          status: 'running',
          message: 'The run has not completed yet. Wait for it to finish, then review again.',
        };
      }

      const suite = args.suiteId
        ? await resolveSuiteByLabel(args.suiteId, services)
        : undefined;

      const slowResponseMs =
        typeof args.slowResponseMs === 'number' && args.slowResponseMs > 0
          ? args.slowResponseMs
          : 2000;

      const report = reviewSuiteRun(
        suite,
        toReviewRequestResults(rec),
        { slowResponseMs },
      );

      // Best-effort LLM enrichment — failure to reach the provider never fails
      // the tool; the deterministic findings are the review.
      let aiRecommendations: string | undefined;
      if (services.aiProvider && report.findings.length > 0) {
        try {
          const prompt = await buildReviewSuitePrompt({ rec, suite, report });
          const raw = await withAiRetry(() => services.aiProvider!.complete(prompt));
          aiRecommendations = raw.trim().slice(0, 12000) || undefined;
        } catch {
          // deterministic findings stand alone
        }
      }

      return {
        runId,
        suiteId: suite?.id,
        suiteName: suite?.name,
        status: rec.status,
        pass: report.summary.pass,
        summary: report.summary,
        findings: report.findings,
        aiRecommendations,
        hint: report.summary.pass
          ? 'No error-severity findings. Use in CI as a gate on summary.pass.'
          : `${report.summary.errors} error(s) found — fix before merge.`,
      };
    },
  },
];
