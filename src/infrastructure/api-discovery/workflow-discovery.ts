/**
 * Phase 2a — Workflow discovery (L3).
 *
 * Analyzes discovered endpoints to find cross-request chains, emitted as
 * suite flow-graph nodes (`request` + `if`/`for` + `script`):
 *
 *  - AUTH chains: a token-producing endpoint (login/token/oauth) → protected
 *    endpoints (`auth.required`). The producer's post-response script extracts
 *    the token into a variable; an `if` gate runs dependents only when present.
 *  - CRUD chains: a create endpoint (`POST /x`) → id-scoped dependents
 *    (`GET/PUT/DELETE /x/{id}`). The producer captures the created id; the
 *    dependents run inside a `for` loop over one iteration.
 *
 * Extends `generate_scenarios` (within-request edge cases) with cross-request
 * chains. Deterministic: chains are emitted sorted by producer path.
 */

import type { SuiteFlowNode, SuiteRequestNode } from '../test-suite/interfaces';
import type { DiscoveredApi } from './types';

export interface WorkflowProducer {
  endpointId: string;
  requestName: string;
  method: string;
  path: string;
}

export interface WorkflowDependent {
  endpointId: string;
  requestName: string;
  method: string;
  path: string;
}

export interface WorkflowChain {
  id: string;
  kind: 'auth' | 'crud';
  name: string;
  confidence: 'high' | 'medium';
  producer: WorkflowProducer;
  dependents: WorkflowDependent[];
  /** Variable the producer stores for dependents to read. */
  variableName: string;
  /** Suite flow nodes implementing the chain (request producer + if/for gate + dependents). */
  nodes: SuiteFlowNode[];
}

/** Options for workflow discovery. */
export interface WorkflowDiscoveryOptions {
  /** Collection id referenced by generated suite request nodes. */
  collectionId: string;
  /** Collection name referenced by generated suite request nodes. */
  collectionName: string;
  /** Folder path within the collection where the requests live (default ''). */
  folderPath?: string;
}

const AUTH_PRODUCER_HINTS = [
  /(^|\/)(login|signin|token|oauth|auth|sessions?)(\/|$)/i,
  /token|jwt|bearer/i,
];
const AUTH_VAR_NAME = 'authToken';

const AUTH_MIDDLEWARE_HINTS = /(auth|require|protect|token|jwt|guard|secured)/i;

/** Whether an endpoint reads as protected (explicit auth or auth-named middleware). */
function isProtectedEndpoint(ep: DiscoveredApi): boolean {
  if (ep.auth?.required) return true;
  return (ep.middleware ?? []).some((m) => AUTH_MIDDLEWARE_HINTS.test(m.name));
}

/** Extract the resource name from a path like `/api/users` or `/api/users/{id}` → `users`. */
function resourceFromPath(path: string): string | undefined {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return undefined;
  // Drop a trailing id placeholder (`{id}`) to group id-scoped endpoints with their resource.
  const last = segments[segments.length - 1];
  if (/^\{.*\}$/.test(last)) {
    segments.pop();
    if (segments.length === 0) return undefined;
  }
  const resource = segments[segments.length - 1];
  if (/^\{.*\}$/.test(resource)) return undefined;
  return resource;
}

/** Deterministic chain id. */
function chainId(kind: 'auth' | 'crud', producerPath: string, variable: string): string {
  let hash = 0;
  const seed = `${kind}:${producerPath}:${variable}`;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `${kind}_${(hash >>> 0).toString(36).slice(0, 10)}`;
}

function toProducer(ep: DiscoveredApi): WorkflowProducer {
  return {
    endpointId: ep.id,
    requestName: ep.source?.symbolName || `${ep.method || 'GET'} ${ep.pathExpression}`,
    method: ep.method || 'GET',
    path: ep.pathExpression,
  };
}

function toDependent(ep: DiscoveredApi): WorkflowDependent {
  return {
    endpointId: ep.id,
    requestName: ep.source?.symbolName || `${ep.method || 'GET'} ${ep.pathExpression}`,
    method: ep.method || 'GET',
    path: ep.pathExpression,
  };
}

function makeRequestNode(ep: DiscoveredApi, options: WorkflowDiscoveryOptions, postResponseScript?: string[]): SuiteRequestNode {
  return {
    type: 'request',
    name: ep.source?.symbolName || `${ep.method || 'GET'} ${ep.pathExpression}`,
    request: {
      collectionId: options.collectionId,
      collectionName: options.collectionName,
      requestId: ep.id,
      name: ep.source?.symbolName || `${ep.method || 'GET'} ${ep.pathExpression}`,
      method: ep.method || 'GET',
      folderPath: options.folderPath ?? '',
      enabled: true,
    },
    ...(postResponseScript ? { postResponseScript } : {}),
  };
}

/**
 * Discover cross-request workflow chains from discovered endpoints.
 */
export function discoverWorkflows(
  endpoints: DiscoveredApi[],
  options: WorkflowDiscoveryOptions
): WorkflowChain[] {
  const chains: WorkflowChain[] = [];

  // ── AUTH chains ─────────────────────────────────────────────────────────
  const authProducers = endpoints.filter((ep) =>
    AUTH_PRODUCER_HINTS.some((re) => re.test(ep.pathExpression))
  );
  const protectedEndpoints = endpoints.filter(isProtectedEndpoint);

  for (const producer of authProducers) {
    const dependents = protectedEndpoints.filter((dep) => dep.id !== producer.id);
    if (dependents.length === 0) continue;

    const producerNode = makeRequestNode(producer, options, [
      'const body = (() => {',
      "  try { return JSON.parse(lastResult?.response?.body || '{}'); } catch { return {}; }",
      '})();',
      `const token = body.token || body.access_token || body.id_token || body.jwt;`,
      `if (token) pm.variables.set('${AUTH_VAR_NAME}', token);`,
    ]);

    const thenNodes = dependents.map((dep) => makeRequestNode(dep, options));

    const nodes: SuiteFlowNode[] = [
      producerNode,
      {
        type: 'if',
        if: `!!pm.variables.get('${AUTH_VAR_NAME}')`,
        then: thenNodes,
      },
    ];

    chains.push({
      id: chainId('auth', producer.pathExpression, AUTH_VAR_NAME),
      kind: 'auth',
      name: `${producer.method} ${producer.pathExpression} → protected endpoints`,
      confidence: 'high',
      producer: toProducer(producer),
      dependents: dependents.map(toDependent),
      variableName: AUTH_VAR_NAME,
      nodes,
    });
  }

  // ── CRUD chains ─────────────────────────────────────────────────────────
  const byResource = new Map<string, DiscoveredApi[]>();
  for (const ep of endpoints) {
    const resource = resourceFromPath(ep.pathExpression);
    if (!resource) continue;
    const bucket = byResource.get(resource) ?? [];
    bucket.push(ep);
    byResource.set(resource, bucket);
  }

  const crudChains: WorkflowChain[] = [];
  for (const [resource, group] of byResource.entries()) {
    const create = group.find((ep) => ep.method === 'POST');
    const idDependents = group.filter((ep) =>
      ep.method !== 'POST' && /\{id\}/.test(ep.pathExpression)
    );
    if (!create || idDependents.length === 0) continue;

    const varName = `${resource.replace(/[^a-zA-Z0-9]/g, '_')}Id`;

    const producerNode = makeRequestNode(create, options, [
      'const body = (() => {',
      "  try { return JSON.parse(lastResult?.response?.body || '{}'); } catch { return {}; }",
      '})();',
      `const id = body.id ?? body.${resource}?.id;`,
      `if (id !== undefined) pm.variables.set('${varName}', id);`,
    ]);

    const thenNodes = idDependents.map((dep) => makeRequestNode(dep, options));

    const nodes: SuiteFlowNode[] = [
      producerNode,
      {
        type: 'if',
        if: `pm.variables.get('${varName}') !== undefined`,
        then: thenNodes,
      },
    ];

    crudChains.push({
      id: chainId('crud', create.pathExpression, varName),
      kind: 'crud',
      name: `Create ${resource} → id-scoped operations`,
      confidence: 'high',
      producer: toProducer(create),
      dependents: idDependents.map(toDependent),
      variableName: varName,
      nodes,
    });
  }
  crudChains.sort((a, b) => (a.name < b.name ? -1 : 1));
  chains.push(...crudChains);

  return chains;
}
