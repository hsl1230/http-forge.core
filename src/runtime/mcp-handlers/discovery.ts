/**
 * API discovery tool handlers.
 *
 * Bridges source-code discovery (Phase 1) into the MCP runtime: a discovered
 * endpoint becomes a working HTTP Forge request with NO OpenAPI involved and a
 * provenance label pointing at the source location it was derived from.
 */

import { GENERIC_TOOL_NAMES } from '../mcp-tool-schemas';
import {
  ApiDiscoveryService,
  DiscoveredApi,
  ExpressDiscoveryProvider,
  FastApiDiscoveryProvider,
  FastifyDiscoveryProvider,
  LambdaDiscoveryProvider,
  NestDiscoveryProvider,
  SpringDiscoveryProvider,
  buildDescription,
  discoverWorkflows,
  applyRegenerated,
  computeProjectFreshness,
  detectProjectDrift,
  endpointToName,
  endpointToRequestParts,
  generateFlowFromEndpoints,
  generateSuiteFromEndpoints,
  proposeSuiteUpdates,
  schemaToExample,
  suiteIdFromName,
} from '../../infrastructure/api-discovery';
import type {
  CollectionRequestItem,
  CreateRequestOptions,
  KeyValueEntry,
} from '../../types/collection';
import { badRequest, resolveCollectionByLabel } from './helpers';
import type { McpToolHandler } from './types';

const DISCOVERY_PROVIDERS = () => [
  new ExpressDiscoveryProvider(),
  new NestDiscoveryProvider(),
  new FastifyDiscoveryProvider(),
  new LambdaDiscoveryProvider(),
  new SpringDiscoveryProvider(),
  new FastApiDiscoveryProvider(),
];

export const discoveryHandlers: McpToolHandler[] = [
  {
    toolNames: [GENERIC_TOOL_NAMES.createRequestFromEndpoint],
    async handle({ args, services, collections }) {
      const projectPath = typeof args.projectPath === 'string' && args.projectPath.trim()
        ? args.projectPath.trim()
        : services.workspaceFolder;
      if (!projectPath) {
        throw badRequest('"projectPath" is required (or set services.workspaceFolder).');
      }

      const method = (typeof args.method === 'string' ? args.method.toUpperCase() : '') || undefined;
      const pathExpression = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : undefined;
      if (!method && !pathExpression && !args.endpointId) {
        throw badRequest('Provide "method" + "path", or "endpointId" to select the endpoint.');
      }

      const endpoint = await findEndpoint(projectPath, {
        endpointId: typeof args.endpointId === 'string' ? args.endpointId : undefined,
        method,
        pathExpression,
      });
      if (!endpoint) {
        throw badRequest(
          `No endpoint matched in ${projectPath}` +
          (method && pathExpression ? ` for ${method} ${pathExpression}` : '')
        );
      }

      const col = resolveCollectionByLabel(args.collection, collections);
      const name = typeof args.name === 'string' && args.name.trim()
        ? args.name.trim()
        : endpointToName(endpoint);

      const baseUrl = typeof args.baseUrl === 'string' && args.baseUrl.trim()
        ? args.baseUrl.trim().replace(/\/+$/, '')
        : '';
      const path = (endpoint.resolvedPath ?? endpoint.pathExpression).replace(/^\/+/, '');
      const url = baseUrl
        ? `${baseUrl}/${path}`
        : (endpoint.resolvedPath ?? endpoint.pathExpression);

      const { headers, query, params, body } = endpointToRequestParts(endpoint, args.sampleData === true);

      const opts: CreateRequestOptions = {
        collectionId: col.id,
        name,
        method: endpoint.method || 'GET',
        url,
        headers: headers as KeyValueEntry[],
        query: query as KeyValueEntry[],
        params,
        body,
        description: buildDescription(endpoint),
      };

      const req = await services.collection.createRequest(opts) as CollectionRequestItem;
      return {
        id: req.id,
        name: req.name,
        method: req.method,
        url: req.url,
        created: true,
        collection: col.name,
        provenance: {
          framework: endpoint.framework,
          source: endpoint.source,
          confidence: endpoint.confidence,
        },
        hint: 'Request created from a discovered endpoint. Call run_request to execute it.',
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.generateTestSuite],
    async handle({ args, services, collections }) {
      const projectPath = typeof args.projectPath === 'string' && args.projectPath.trim()
        ? args.projectPath.trim()
        : services.workspaceFolder;
      if (!projectPath) {
        throw badRequest('"projectPath" is required (or set services.workspaceFolder).');
      }

      const col = resolveCollectionByLabel(args.collection, collections);
      const baseUrl = typeof args.baseUrl === 'string' && args.baseUrl.trim()
        ? args.baseUrl.trim().replace(/\/+$/, '')
        : '';
      const assertBodySchema = args.assertBodySchema === true;
      const dryRun = args.dryRun === true;
      const name = typeof args.name === 'string' && args.name.trim()
        ? args.name.trim()
        : `Generated ${col.name} suite`;

      const result = await discoverAll(projectPath);
      if (result.endpoints.length === 0) {
        return {
          generated: false,
          endpointCount: 0,
          message: 'No endpoints discovered in ' + projectPath,
        };
      }

      const created: Array<{ name: string; id: string }> = [];
      const endpointsWithIds: DiscoveredApi[] = [];

      for (const ep of result.endpoints) {
        if (dryRun) {
          endpointsWithIds.push(ep);
          continue;
        }
        const { headers, query, params, body } = endpointToRequestParts(ep, args.sampleData === true);
        const path = (ep.resolvedPath ?? ep.pathExpression).replace(/^\/+/, '');
        const url = baseUrl ? `${baseUrl}/${path}` : (ep.resolvedPath ?? ep.pathExpression);
        const opts: CreateRequestOptions = {
          collectionId: col.id,
          name: endpointToName(ep),
          method: ep.method || 'GET',
          url,
          headers: headers as KeyValueEntry[],
          query: query as KeyValueEntry[],
          params,
          body,
          description: buildDescription(ep),
        };
        const req = await services.collection.createRequest(opts) as CollectionRequestItem;
        endpointsWithIds.push({ ...ep, id: req.id });
        created.push({ name: req.name, id: req.id });
      }

      const { suite, derived } = generateSuiteFromEndpoints(endpointsWithIds, {
        collectionId: col.id,
        collectionName: col.name,
        folderPath: '',
        name,
        assertBodySchema,
      });

      const flowSource = generateFlowFromEndpoints(endpointsWithIds, {
        requestPathOf: (ep) => ep.source?.symbolName ?? ep.pathExpression,
        name: `${name} flow`,
      });

      if (!dryRun && services.testSuite) {
        await services.testSuite.updateSuite(suite);
      }

      return {
        generated: true,
        suite: suite.id,
        name: suite.name,
        collection: col.name,
        endpointCount: suite.nodes.length,
        dryRun,
        aiGenerated: suite.ai_generated,
        derived,
        flowSource,
        requestsCreated: dryRun ? undefined : created,
        hint: dryRun
          ? 'Dry-run: no requests were created. Re-run without dryRun to persist.'
          : 'Suite generated. Run it with run_suite to execute the discovered endpoints.',
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.suggestWorkflow],
    async handle({ args, services }) {
      const projectPath = typeof args.projectPath === 'string' && args.projectPath.trim()
        ? args.projectPath.trim()
        : services.workspaceFolder;
      if (!projectPath) {
        throw badRequest('"projectPath" is required (or set services.workspaceFolder).');
      }

      const { endpoints } = await discoverAll(projectPath);
      // Analysis only — no collection required; use placeholder refs for the scan.
      const chains = discoverWorkflows(endpoints, {
        collectionId: '',
        collectionName: '',
      });

      return {
        projectPath,
        chainCount: chains.length,
        chains: chains.map((c) => ({
          id: c.id,
          kind: c.kind,
          name: c.name,
          confidence: c.confidence,
          producer: c.producer,
          dependents: c.dependents,
          variableName: c.variableName,
        })),
        hint: 'Call generate_workflow to persist a chain as a runnable suite.',
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.generateWorkflow],
    async handle({ args, services, collections }) {
      const projectPath = typeof args.projectPath === 'string' && args.projectPath.trim()
        ? args.projectPath.trim()
        : services.workspaceFolder;
      if (!projectPath) {
        throw badRequest('"projectPath" is required (or set services.workspaceFolder).');
      }

      const col = resolveCollectionByLabel(args.collection, collections);
      const baseUrl = typeof args.baseUrl === 'string' && args.baseUrl.trim()
        ? args.baseUrl.trim().replace(/\/+$/, '')
        : '';
      const dryRun = args.dryRun === true;
      const name = typeof args.name === 'string' && args.name.trim()
        ? args.name.trim()
        : `Generated ${col.name} workflow suite`;

      const { endpoints } = await discoverAll(projectPath);
      if (endpoints.length === 0) {
        return { generated: false, chainCount: 0, message: 'No endpoints discovered in ' + projectPath };
      }

      // Create requests for every endpoint (unless dry-run) so the suite nodes
      // can reference real requestIds.
      const created: Array<{ name: string; id: string }> = [];
      const endpointsWithIds: DiscoveredApi[] = [];
      for (const ep of endpoints) {
        if (dryRun) {
          endpointsWithIds.push(ep);
          continue;
        }
        const { headers, query, params, body } = endpointToRequestParts(ep, args.sampleData === true);
        const path = (ep.resolvedPath ?? ep.pathExpression).replace(/^\/+/, '');
        const url = baseUrl ? `${baseUrl}/${path}` : (ep.resolvedPath ?? ep.pathExpression);
        const opts: CreateRequestOptions = {
          collectionId: col.id,
          name: endpointToName(ep),
          method: ep.method || 'GET',
          url,
          headers: headers as KeyValueEntry[],
          query: query as KeyValueEntry[],
          params,
          body,
          description: buildDescription(ep),
        };
        const req = await services.collection.createRequest(opts) as CollectionRequestItem;
        endpointsWithIds.push({ ...ep, id: req.id });
        created.push({ name: req.name, id: req.id });
      }

      const chains = discoverWorkflows(endpointsWithIds, {
        collectionId: col.id,
        collectionName: col.name,
      });

      // Build the suite from the chain flow nodes (request + if gates).
      const now = Date.now();
      const suite = {
        id: `wf_${suiteIdFromName(name)}`,
        name,
        description: 'Workflow chains generated from source-code discovery (Phase 2a L3).',
        nodes: chains.flatMap((c) => c.nodes),
        config: {
          iterations: 1,
          delayBetweenRequests: 0,
          stopOnError: false,
          readFromSharedSession: false,
          writeToSharedSession: false,
        },
        ai_generated: true,
        derived_from: endpoints.map((ep) => ep.id).filter(Boolean),
        createdAt: now,
        updatedAt: now,
      };

      if (!dryRun && services.testSuite) {
        await services.testSuite.updateSuite(suite);
      }

      return {
        generated: chains.length > 0,
        suite: suite.id,
        name: suite.name,
        collection: col.name,
        chainCount: chains.length,
        dryRun,
        aiGenerated: true,
        chains: chains.map((c) => ({
          id: c.id,
          kind: c.kind,
          name: c.name,
          confidence: c.confidence,
          producer: c.producer,
          dependents: c.dependents,
          nodeCount: c.nodes.length,
        })),
        requestsCreated: dryRun ? undefined : created,
        hint: dryRun
          ? 'Dry-run: no requests were created. Re-run without dryRun to persist.'
          : 'Workflow suite generated. Run it with run_suite to execute the chains.',
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.checkDrift],
    async handle({ args, services }) {
      const projectPath = typeof args.projectPath === 'string' && args.projectPath.trim()
        ? args.projectPath.trim()
        : services.workspaceFolder;
      if (!projectPath) {
        throw badRequest('"projectPath" is required (or set services.workspaceFolder).');
      }

      // Optional stored state from a prior scan: pass storedGitHash and/or
      // storedScannedAt to get a drift status instead of freshness only.
      const storedGitHash = typeof args.storedGitHash === 'string' ? args.storedGitHash : undefined;
      const storedScannedAt = typeof args.storedScannedAt === 'string' ? args.storedScannedAt : undefined;

      const freshness = computeProjectFreshness(projectPath);
      if (!storedGitHash && !storedScannedAt) {
        return {
          projectPath,
          freshness: {
            gitHash: freshness.gitHash ?? null,
            maxSourceMtime: freshness.maxSourceMtime,
          },
          status: 'unknown',
          hint: 'Pass storedGitHash (and/or storedScannedAt) from a prior scan to get a current/stale verdict.',
        };
      }

      const drift = detectProjectDrift(projectPath, {
        gitHash: storedGitHash,
        scannedAt: storedScannedAt ?? new Date(0).toISOString(),
      });

      return {
        projectPath,
        status: drift.status,
        reason: drift.reason,
        freshness: {
          gitHash: drift.currentFreshness.gitHash ?? null,
          maxSourceMtime: drift.currentFreshness.maxSourceMtime,
        },
        stored: drift.storedFreshness
          ? { gitHash: drift.storedFreshness.gitHash ?? null }
          : null,
        hint: drift.status === 'stale'
          ? 'Project drifted since the last scan. Re-run create_request_from_endpoint or generate_test_suite to regenerate artifacts.'
          : undefined,
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.proposeUpdate],
    handle({ args }) {
      const staleEndpointIds = Array.isArray(args.staleEndpointIds)
        ? (args.staleEndpointIds as string[])
        : [];
      const suites = Array.isArray(args.suites)
        ? (args.suites as Array<{ id: string; name?: string; currentContent: string; derivedFrom?: string[] }>)
        : [];
      const baseContent = (args.baseContent ?? {}) as Record<string, string>;
      const regeneratedContent = (args.regeneratedContent ?? {}) as Record<string, string>;
      const apply = args.apply === true;

      if (staleEndpointIds.length === 0) {
        throw badRequest('"staleEndpointIds" must be a non-empty array (e.g. from check_drift).');
      }
      if (suites.length === 0) {
        throw badRequest('"suites" must be a non-empty array.');
      }

      const suiteDefs = suites.map((s) => ({
        id: s.id,
        name: s.name ?? s.id,
        currentContent: s.currentContent,
        derivedFrom: s.derivedFrom ?? [],
      }));

      const proposals = proposeSuiteUpdates(
        staleEndpointIds,
        suiteDefs,
        baseContent,
        regeneratedContent
      );

      return {
        proposedCount: proposals.length,
        proposals: proposals.map((p) => {
          const suite = suiteDefs.find((s) => s.id === p.suiteId);
          const applied = apply
            ? applyRegenerated(p, suite?.currentContent ?? '', regeneratedContent[p.suiteId] ?? '', baseContent[p.suiteId] ?? '')
            : undefined;
          return {
            suiteId: p.suiteId,
            suiteName: p.suiteName,
            affectedEndpointIds: p.affectedEndpointIds,
            changed: p.diff.changed,
            userEditedLineCount: p.diff.userEditedLineCount,
            hasConflicts: p.hasConflicts,
            ...(applied ? {
              canApply: applied.canApply,
              mergedContent: applied.canApply ? applied.merged : undefined,
              conflictCount: applied.conflicts,
            } : {}),
            hint: p.hasConflicts
              ? 'User edits overlap regeneration — requires developer approval (do not auto-apply).'
              : 'No conflicts — safe to regenerate.',
          };
        }),
      };
    },
  },
];

async function discoverAll(projectPath: string): Promise<{ endpoints: DiscoveredApi[] }> {
  const service = new ApiDiscoveryService({
    providers: DISCOVERY_PROVIDERS(),
  });
  const result = await service.discover({ workspaceFolder: projectPath });
  return { endpoints: result.endpoints };
}

async function findEndpoint(
  projectPath: string,
  match: { endpointId?: string; method?: string; pathExpression?: string }
): Promise<DiscoveredApi | undefined> {
  const { endpoints } = await discoverAll(projectPath);

  if (match.endpointId) {
    const byId = endpoints.find((ep) => ep.id === match.endpointId);
    if (byId) return byId;
  }

  return endpoints.find((ep) => {
    const methodOk = !match.method || (ep.method || '').toUpperCase() === match.method;
    const pathOk = !match.pathExpression
      || (ep.resolvedPath ?? ep.pathExpression) === match.pathExpression
      || ep.pathExpression === match.pathExpression;
    return methodOk && pathOk;
  });
}

export { schemaToExample };
