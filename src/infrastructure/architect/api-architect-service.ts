/**
 * API Architect Service (Phase 4 / Layer 8).
 *
 * "I need a shopping cart" → a complete, reviewable API package in one flow:
 *   intent → AI-designed OpenAPI spec → imported collection → endpoints →
 *   test suite + .flow.js + workflow chains + markdown docs + round-trip
 *   OpenAPI export. Everything is tagged `ai_generated: true` so the Phase 2b
 *   drift machinery treats it as regenerable content.
 *
 * Dependencies are injected (DIP): the importer creates the collection from the
 * designed spec, the exporter proves the round-trip, and the suite/flow/workflow
 * generators are pure functions over the discovery model — all reused unchanged.
 */

import { IAiProvider } from '../ai/ai-provider';
import { extractJsonFromLlm, withAiRetry } from '../ai/ai-utils';
import { gatherWorkspaceKnowledge } from '../ai/ai-context';
import type { IOpenApiExporter, IOpenApiImporter } from '../openapi/interfaces';
import type { OpenApiExportOptions } from '../openapi/openapi-utils';
import { collectionToEndpoints } from './collection-to-endpoints';
import { buildArchitectPrompt } from './architect-prompt';
import type { DiscoveredApi } from '../api-discovery/types';
import { generateFlowFromEndpoints, generateSuiteFromEndpoints } from '../api-discovery/test-generator';
import { discoverWorkflows, WorkflowChain } from '../api-discovery/workflow-discovery';
import type { TestSuite } from '../test-suite/interfaces';

export interface ApiArchitectOptions {
  /** Collection name for the designed API (default: spec info title or intent slug). */
  collectionName?: string;
  /** Base URL for the designed API (default http://localhost:3000). */
  baseUrl?: string;
  /** Environment name to create with the server URL (optional). */
  environmentName?: string;
  /** OpenAPI info overrides for the round-trip export. */
  openapiInfo?: OpenApiExportOptions['info'];
  /** OpenAPI export format for the round-trip document (default json). */
  openapiFormat?: OpenApiExportOptions['format'];
  /** Folder path for generated suite request nodes (default ''). */
  suiteFolderPath?: string;
  /** Also assert discovered response body schemas (default false). */
  assertBodySchema?: boolean;
  /** Workspace folder for grounding knowledge (optional). */
  workspaceFolder?: string;
}

export interface ApiArchitectResult {
  /** The user intent this package was designed from. */
  intent: string;
  /** Collection created from the designed spec. */
  collectionId: string;
  collectionName: string;
  environmentCreated?: string;
  /** Endpoints derived from the designed collection (provenance = design). */
  endpoints: DiscoveredApi[];
  /** Test suite with one request node per endpoint. */
  suite: TestSuite;
  /** Runnable `.flow.js` source string. */
  flow: string;
  /** Discovered workflow chains (auth / CRUD) over the designed surface. */
  workflows: WorkflowChain[];
  /** Round-trip OpenAPI document exported from the collection. */
  openapi: string;
  /** Human-readable markdown docs for the designed API. */
  docs: string;
  /** ai_generated flag (Phase 2b drift hook). */
  ai_generated: true;
  derivedFrom: string[];
}

/**
 * Validate an AI-produced spec is a plausible OpenAPI 3.0 document.
 * Returns an error message, or null when the shape is acceptable.
 */
export function validateDesignedSpec(spec: unknown): string | null {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    return 'AI response is not a JSON object';
  }
  const doc = spec as Record<string, unknown>;
  const openapi = doc.openapi;
  if (typeof openapi !== 'string' || !/^3\.0/.test(openapi)) {
    return `openapi field must be 3.0.x, got "${String(openapi)}"`;
  }
  const paths = doc.paths;
  if (typeof paths !== 'object' || paths === null || Array.isArray(paths)) {
    return 'paths object is missing';
  }
  if (Object.keys(paths as Record<string, unknown>).length === 0) {
    return 'paths object is empty (no endpoints designed)';
  }
  return null;
}

export class ApiArchitectService {
  constructor(
    private importer: IOpenApiImporter,
    private exporter: IOpenApiExporter,
    private aiProvider: IAiProvider
  ) {}

  /**
   * Design an API from a natural-language intent and produce the full,
   * reviewable package. The collection is persisted via the importer;
   * the suite/flow/docs are generated (not yet saved — callers decide
   * whether to persist as part of an approve flow).
   */
  async designFromIntent(
    intent: string,
    options: ApiArchitectOptions = {}
  ): Promise<ApiArchitectResult> {
    const workspaceKnowledge = options.workspaceFolder
      ? gatherWorkspaceKnowledge(options.workspaceFolder)
      : '';

    const spec = await this.designSpec(intent, options, workspaceKnowledge);

    const imported = await this.importer.importFromString(JSON.stringify(spec), {
      collectionName: options.collectionName,
      environmentName: options.environmentName,
    });

    const endpoints = collectionToEndpoints(imported.collection);

    // Suite: one request node per endpoint, asserting the designed status code.
    const generated = generateSuiteFromEndpoints(endpoints, {
      collectionId: imported.collection.id,
      collectionName: imported.collection.name,
      folderPath: options.suiteFolderPath,
      assertBodySchema: options.assertBodySchema,
      name: `${imported.collection.name} — designed from intent`,
    });

    const workflowEndpoints: DiscoveredApi[] = endpoints;
    const workflows = discoverWorkflows(workflowEndpoints, {
      collectionId: imported.collection.id,
      collectionName: imported.collection.name,
      folderPath: options.suiteFolderPath,
    });

    const flow = generateFlowFromEndpoints(endpoints, {
      name: `${imported.collection.name}-designed`,
    });

    const openapi = await this.exporter.export(imported.collection.id, {
      format: options.openapiFormat ?? 'json',
      info: options.openapiInfo,
      environments: options.environmentName ? [options.environmentName] : undefined,
    });

    const docs = renderArchitectDocs(intent, imported.collection.name, endpoints, workflows);

    return {
      intent,
      collectionId: imported.collection.id,
      collectionName: imported.collection.name,
      environmentCreated: imported.environmentCreated,
      endpoints,
      suite: generated.suite,
      flow,
      workflows,
      openapi,
      docs,
      ai_generated: true,
      derivedFrom: endpoints.map((ep) => ep.id).filter(Boolean),
    };
  }

  /** Call the AI to produce and validate the designed OpenAPI spec. */
  private async designSpec(
    intent: string,
    options: ApiArchitectOptions,
    workspaceKnowledge: string
  ): Promise<Record<string, unknown>> {
    const prompt = buildArchitectPrompt(intent, {
      collectionName: options.collectionName,
      baseUrl: options.baseUrl,
      workspaceKnowledge,
    });

    const raw = await withAiRetry(() => this.aiProvider.complete(prompt));
    const parsed = extractJsonFromLlm<unknown>(raw);
    const validation = validateDesignedSpec(parsed);
    if (parsed === null || validation !== null) {
      throw new Error(
        `AI architect could not produce a valid OpenAPI spec. ${validation ?? 'No JSON object found in the response.'}`
      );
    }
    return parsed as Record<string, unknown>;
  }
}

/**
 * Render markdown API docs from the designed surface. Keep the docs focused:
 * intent, endpoint table, auth notes, and workflow chains.
 */
export function renderArchitectDocs(
  intent: string,
  collectionName: string,
  endpoints: DiscoveredApi[],
  workflows: WorkflowChain[]
): string {
  const lines: string[] = [];
  lines.push(`# ${collectionName}`);
  lines.push('');
  lines.push(`> Auto-generated from the intent: *${intent}*`);
  lines.push('');
  lines.push(`## Endpoints`);
  lines.push('');
  lines.push('| Method | Path | Name | Auth |');
  lines.push('| --- | --- | --- | --- |');
  for (const ep of endpoints) {
    const name = ep.source?.symbolName || ep.pathExpression;
    const auth = ep.auth?.required ? 'yes' : '';
    lines.push(`| ${ep.method.toUpperCase()} | \`${ep.pathExpression}\` | ${name} | ${auth} |`);
  }
  lines.push('');

  if (workflows.length > 0) {
    lines.push(`## Workflows (${workflows.length})`);
    lines.push('');
    for (const chain of workflows) {
      lines.push(`- **[${chain.kind}] ${chain.name}** (${chain.confidence})`);
      lines.push(`  - Producer: \`${chain.producer.method} ${chain.producer.path}\``);
      for (const dep of chain.dependents) {
        lines.push(`  - Depends on: \`${dep.method} ${dep.path}\``);
      }
    }
    lines.push('');
  }

  lines.push(`## Generated artifacts`);
  lines.push('');
  lines.push(`- \`${collectionName}.suite.json\` — one request node per endpoint`);
  lines.push(`- \`${collectionName}.flow.js\` — runnable flow`);
  lines.push(`- OpenAPI document — round-trip export of the collection`);
  lines.push('');
  lines.push('*ai_generated: true*');
  lines.push('');
  return lines.join('\n');
}
