/**
 * QA tool handler — one-shot discover → generate → run → report quality gate.
 *
 * Thin adapter over the core QA service (`infrastructure/qa/qa-service`):
 * argument validation only. Reruns are idempotent (requests matched by
 * method + path and reused), so agents can safely re-run after fixing code.
 */

import { runQaCheck } from '../../infrastructure/qa/qa-service';
import { GENERIC_TOOL_NAMES } from '../mcp-tool-schemas';
import { badRequest } from './helpers';
import type { McpToolHandler } from './types';

function stringArg(args: Record<string, unknown>, name: string): string | undefined {
    const value = args[name];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw badRequest(`"${name}" must be a string.`);
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

export const qaHandlers: McpToolHandler[] = [
    {
        toolNames: [GENERIC_TOOL_NAMES.qaApi],
        async handle({ args, services }) {
            const projectPath = stringArg(args, 'projectPath') ?? services.workspaceFolder;
            if (!projectPath) {
                throw badRequest('"projectPath" is required (or set services.workspaceFolder).');
            }
            const collection = stringArg(args, 'collection');
            if (!collection) {
                throw badRequest('"collection" is required.');
            }
            const baseUrl = stringArg(args, 'baseUrl')?.replace(/\/+$/, '') || undefined;
            const dryRun = args.dryRun === true;
            if (!dryRun && !baseUrl) {
                throw badRequest('"baseUrl" is required unless dryRun is true.');
            }
            if (args.variables !== undefined && (typeof args.variables !== 'object' || args.variables === null || Array.isArray(args.variables))) {
                throw badRequest('"variables" must be an object.');
            }

            const report = await runQaCheck(
                { collection: services.collection, testSuite: services.testSuite },
                services.workspaceFolder ?? projectPath,
                {
                    projectPath,
                    collectionRef: collection,
                    baseUrl,
                    environment: stringArg(args, 'environment'),
                    variables: args.variables as Record<string, unknown> | undefined,
                    framework: stringArg(args, 'framework'),
                    dryRun,
                    failOnDrift: args.failOnDrift === true,
                    storedGitHash: stringArg(args, 'storedGitHash'),
                    storedScannedAt: stringArg(args, 'storedScannedAt'),
                    aiAssertions: args.aiAssertions === true,
                    aiProvider: services.aiProvider,
                }
            );

            return {
                ...report,
                hint:
                    report.status === 'fail'
                        ? 'Fix the failing endpoints, then re-run qa_api (requests are reused, nothing is duplicated).'
                        : report.status === 'drift'
                            ? 'Project moved since the stored scan — review drift, then re-run without failOnDrift to regenerate.'
                            : 'Use get_request for full detail on any endpoint, or analyze_test_failure for failures.',
            };
        },
    },
];
