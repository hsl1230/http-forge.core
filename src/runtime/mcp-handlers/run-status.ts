/**
 * Async run polling tool handlers — inspect/cancel in-memory run records.
 */

import { GENERIC_TOOL_NAMES } from '../mcp-tool-schemas';
import { applyMcpBodyTruncation, badRequest } from './helpers';
import type { McpToolHandler } from './types';

export const runStatusHandlers: McpToolHandler[] = [
  {
    toolNames: [GENERIC_TOOL_NAMES.getRunStatus],
    handle({ args, runStore }) {
      const rec = runStore.require(args.runId);
      return {
        runId: rec.id,
        status: rec.status,
        suiteName: rec.suiteName,
        progress: rec.progress,
        ...(rec.error ? { error: rec.error } : {}),
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.getRunSummary],
    handle({ args, runStore }) {
      const rec = runStore.require(args.runId);
      if (rec.status === 'running') {
        return { runId: rec.id, status: 'running', progress: rec.progress };
      }
      const hasFailed = (rec.summary.failed ?? 0) > 0 || rec.summary.allPassed === false;
      const noAssertExamples = rec.noAssertionExamples ?? [];
      const noAssertCount = noAssertExamples.length;
      const totalRequests = rec.summary.total;
      const noAssertSuggestion =
        noAssertCount > 0
          ? noAssertCount / (totalRequests || 1) > 0.5
            ? `${noAssertCount}/${totalRequests} requests have no pm.test() assertions. ` +
              `Invoke the "review-collection" prompt (collection="${rec.suiteName}") for a full coverage analysis.`
            : `${noAssertCount} request(s) have no pm.test() assertions ` +
              `(e.g. ${noAssertExamples.slice(0, 3).map((n) => `"${n}"`).join(', ')}). ` +
              `Invoke the "suggest-assertions" prompt (collection="${rec.suiteName}") to add test coverage.`
          : null;
      return {
        runId: rec.id,
        status: rec.status,
        suiteName: rec.suiteName,
        summary: rec.summary,
        ...(rec.reportPath ? { report: { uri: `file://${rec.reportPath}` } } : {}),
        ...(hasFailed ? { failedRequests: (applyMcpBodyTruncation({ failedRequests: rec.failedRequests }, []) as Record<string, unknown>).failedRequests } : {}),
        ...(hasFailed ? {
          _nextStep:
            `REQUIRED ACTION: ${rec.summary.failed} request(s) failed. ` +
            `The failedRequests array above contains the full details (method, url, requestBody, ` +
            `requestHeaders, status, responseBody, failedTests). ` +
            `Immediately analyze each failed request and provide: ` +
            `(1) root cause, (2) specific fix, (3) corrected pm.test() assertions if relevant. ` +
            `Do NOT wait for the user to ask — diagnose now.`,
        } : {}),
        ...(noAssertSuggestion ? { _suggestions: [noAssertSuggestion] } : {}),
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.getFailedRequests],
    handle({ args, runStore }) {
      const rec = runStore.require(args.runId);
      if (rec.status === 'running') {
        return {
          runId: rec.id,
          status: 'running',
          progress: rec.progress,
          failedSoFar: rec.failedRequests.length,
        };
      }
      const offset = typeof args.offset === 'number' ? Math.max(0, args.offset) : 0;
      const limit =
        typeof args.limit === 'number' ? Math.min(100, Math.max(1, args.limit)) : 20;
      return {
        runId: rec.id,
        status: rec.status,
        totalFailed: rec.failedRequests.length,
        offset,
        limit,
        failedRequests: rec.failedRequests.slice(offset, offset + limit),
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.getRequestResult],
    handle({ args, runStore }) {
      const rec = runStore.require(args.runId);
      const requestName = args.request;
      if (typeof requestName !== 'string' || !requestName) {
        throw badRequest('"request" is required');
      }
      const iteration =
        typeof args.iteration === 'number' ? args.iteration : 1;
      const result = (rec.allResults as Array<{ name: string; iteration: number }>).find(
        (r) =>
          r.iteration === iteration &&
          (r.name === requestName ||
            r.name.toLowerCase() === requestName.toLowerCase())
      );
      if (!result) {
        if (rec.status === 'running') {
          return {
            runId: rec.id,
            status: 'running',
            message: `Request "${requestName}" has not completed yet.`,
          };
        }
        throw new Error(
          `Request "${requestName}" (iteration ${iteration}) not found in run "${rec.id}".`
        );
      }
      return { runId: rec.id, ...result };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.cancelRun],
    handle({ args, runStore }) {
      const rec = runStore.require(args.runId);
      if (rec.status !== 'running') {
        return {
          runId: rec.id,
          status: rec.status,
          cancelled: false,
          message: `Run is already "${rec.status}" — nothing to cancel.`,
        };
      }
      const wasCancelled = runStore.cancel(String(args.runId));
      return {
        runId: rec.id,
        status: 'cancelled',
        cancelled: wasCancelled,
        progress: rec.progress,
        message: 'Cancellation requested. The currently-executing request will finish; remaining requests will be skipped.',
      };
    },
  },
];
