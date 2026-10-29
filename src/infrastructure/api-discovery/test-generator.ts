/**
 * Phase 2a — Test generation (L4).
 *
 * Generates a runnable `.suite.json` (a `TestSuite`) from discovered endpoints.
 * One request node per endpoint, each with a post-response script asserting the
 * discovered status code. Generated artifacts are tagged `ai_generated: true`
 * and `derived_from: <endpointId>` — the Phase 2b drift hook.
 *
 * Requests referenced by the suite must already exist in the target collection
 * (created from the endpoint via `create_request_from_endpoint` semantics);
 * this module only performs the discovery → suite mapping.
 */

import { DEFAULT_SUITE_CONFIG, SuiteRequestNode, TestSuite } from '../test-suite/interfaces';
import type { DiscoveredApi } from './types';

/**
 * Options for suite generation.
 */
export interface GenerateSuiteOptions {
  /** Collection name to reference from every suite request node. */
  collectionName: string;
  /** Collection id to reference from every suite request node. */
  collectionId: string;
  /** Base folder path within the collection where requests live (default ''). */
  folderPath?: string;
  /** Suite name (default: "Generated from discovery"). */
  name?: string;
  /** Suite id (default: deterministic from name). */
  id?: string;
  /** Also assert the response body schema when a JSON schema was discovered. */
  assertBodySchema?: boolean;
}

/** Result of generation — the suite plus a mapping of which endpoints were included. */
export interface GenerateSuiteResult {
  suite: TestSuite;
  /** endpointId → generated request node name (the drift hook). */
  derived: Array<{ endpointId: string; requestName: string; method: string; path: string }>;
}

/** Deterministic suite id from a name (slug + short hash — no timestamps). */
export function suiteIdFromName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'suite';
  let hash = 0;
  for (const ch of name) {
    hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  }
  return `${slug}_${(hash >>> 0).toString(36).slice(0, 8)}`;
}

/**
 * Generate a TestSuite from discovered endpoints.
 */
export function generateSuiteFromEndpoints(
  endpoints: DiscoveredApi[],
  options: GenerateSuiteOptions
): GenerateSuiteResult {
  const name = options.name ?? 'Generated from discovery';
  const nodes: SuiteRequestNode[] = [];
  const derived: GenerateSuiteResult['derived'] = [];
  const folderPath = options.folderPath ?? '';

  for (const ep of endpoints) {
    const requestName = ep.source?.symbolName
      || `${ep.method || 'GET'} ${ep.pathExpression}`;
    const statusCode = ep.responses?.[0]?.statusCode ?? 200;

    const postResponseScript = [
      'const code = lastResult?.response?.status || 0;',
      `pm.test('status is ${statusCode}', function () {`,
      `  pm.expect(code).to.eq(${statusCode});`,
      '});',
    ];

    if (options.assertBodySchema && ep.responses?.[0]?.body?.schema) {
      const schema = ep.responses[0].body.schema as { type?: string };
      if (schema?.type === 'array') {
        postResponseScript.push(
          "pm.test('response body is a JSON array', function () {",
          "  const body = (() => { try { return JSON.parse(lastResult?.response?.body || '[]'); } catch { return null; } })();",
          '  pm.expect(Array.isArray(body)).to.eq(true);',
          '});',
        );
      }
    }

    nodes.push({
      type: 'request',
      name: requestName,
      request: {
        collectionId: options.collectionId,
        collectionName: options.collectionName,
        requestId: ep.id || requestName,
        name: requestName,
        method: ep.method || 'GET',
        folderPath,
        enabled: true,
        description: `Generated from ${ep.framework} endpoint (confidence: ${ep.confidence}).`,
      },
      postResponseScript,
    });

    derived.push({
      endpointId: ep.id,
      requestName,
      method: ep.method || 'GET',
      path: ep.pathExpression,
    });
  }

  const now = Date.now();
  const suite: TestSuite = {
    id: options.id ?? suiteIdFromName(name),
    name,
    description: 'Auto-generated from source-code discovery (Phase 2a).',
    nodes,
    config: { ...DEFAULT_SUITE_CONFIG },
    ai_generated: true,
    derived_from: endpoints.map((ep) => ep.id).filter(Boolean),
    createdAt: now,
    updatedAt: now,
  };

  return { suite, derived };
}

// ─── .flow.js generation (Phase 2a L4, secondary artifact) ───────────────────

/**
 * Options for .flow.js generation.
 */
export interface GenerateFlowOptions {
  /**
   * Maps a discovered endpoint to the request path/name that `f.send(...)`
   * resolves in the collection (e.g. `users/get-user` or a request id).
   * Defaults to `#<requestId>` when the endpoint id is a real collection
   * request id, else falls back to the request name/symbol.
   */
  requestPathOf?: (ep: DiscoveredApi) => string;
  /** Flow name used in the header comment (default derived from first endpoint). */
  name?: string;
}

/**
 * Generate a `.flow.js` source string from discovered endpoints using the
 * `http-forge.flow` runtime API (`f.send` / `f.expect` / `f.set` / `f.get`).
 * Every flow is tagged `ai_generated: true` + `derived_from: <endpointId>` in
 * the header comment (the Phase 2b drift hook).
 */
export function generateFlowFromEndpoints(
  endpoints: DiscoveredApi[],
  options: GenerateFlowOptions
): string {
  const name = options.name ?? 'discovered-api-flow';
  const lines: string[] = [];

  lines.push('/**');
  lines.push(` * ${name} — auto-generated from source-code discovery (Phase 2a L4).`);
  lines.push(` * ai_generated: true`);
  lines.push(` * derived_from: ${endpoints.map((ep) => ep.id).filter(Boolean).join(', ') || '(none)'}`);
  lines.push(' */');
  lines.push(`export default async function (f) {`);

  for (const ep of endpoints) {
    const requestPath = options.requestPathOf
      ? options.requestPathOf(ep)
      : flowRequestPath(ep);
    const statusCode = ep.responses?.[0]?.statusCode ?? 200;
    const fn = ep.method || 'GET';
    const pathLabel = `${fn} ${ep.pathExpression}`;

    lines.push('  {');
    lines.push(`    // ${pathLabel}`);
    lines.push(`    const res = await f.send('${requestPath.replace(/'/g, "\\'")}');`);
    lines.push(`    f.expect(res.status).toBe(${statusCode});`);
    lines.push('  }');
    lines.push('');
  }

  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

/**
 * Default flow request path: `#<requestId>` when the endpoint id is a real
 * collection request id (resolved by the flow runtime by id), else the request
 * symbol/name (resolved by path).
 */
function flowRequestPath(ep: DiscoveredApi): string {
  if (ep.id && /^[a-zA-Z0-9_-]+_[a-zA-Z0-9]{8,}$/.test(ep.id)) {
    return `#${ep.id}`;
  }
  return ep.source?.symbolName ?? `${ep.method || 'GET'} ${ep.pathExpression}`;
}
