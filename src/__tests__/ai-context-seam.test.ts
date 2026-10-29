/**
 * ApiKnowledgeSource seam tests (plan §3.1).
 *
 * Verifies the pluggable "understanding" contract: sources produce bounded,
 * self-describing snapshots; a custom source is picked up by the assembler
 * after a single registration; the legacy options form and the sources form
 * produce identical output.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  assembleBusinessContext,
  clearRegisteredKnowledgeSources,
  collectionKnowledgeSource,
  createDefaultKnowledgeSources,
  getRegisteredKnowledgeSources,
  registerKnowledgeSource,
  requestKnowledgeSource,
  runResultsKnowledgeSource,
  workspaceKnowledgeSource,
} from '../infrastructure/ai/ai-context';
import type { ApiKnowledgeSource } from '../infrastructure/ai/ai-context';
import type { Collection, CollectionRequestItem } from '../types/collection';
import type { McpRunRecord } from '../runtime/mcp-run-store';

function makeCollection(): Collection {
  return {
    id: 'c1',
    name: 'Auth API',
    description: 'Customer identity endpoints',
    variables: { BASE_URL: 'https://api.example.com' },
    auth: { type: 'bearer' },
    items: [
      {
        type: 'request',
        id: 'r1',
        name: 'Login',
        method: 'POST',
        url: 'https://api.example.com/v1/login',
        operationId: 'loginUser',
        doc: '# Login\nAuthenticates a customer.',
      },
    ],
  };
}

afterEach(() => {
  clearRegisteredKnowledgeSources();
});

describe('knowledge source factories', () => {
  it('collection source yields a bounded, labeled snapshot', () => {
    const snap = collectionKnowledgeSource(makeCollection()).snapshot();
    expect(snap.kind).toBe('collection');
    expect(snap.heading).toBe('Collection');
    expect(snap.body).toContain('Customer identity endpoints');
    expect(snap.body).toContain('Requests: 1');
    expect(snap.generatedAt).toBeGreaterThan(0);
    expect(collectionKnowledgeSource(makeCollection()).freshness()).toBe('fresh');
    expect(collectionKnowledgeSource({ id: 'e', name: 'Empty', items: [] }).freshness()).toBe('stale');
  });

  it('request source carries the request heading and body', () => {
    const snap = requestKnowledgeSource(makeCollection().items[0] as CollectionRequestItem).snapshot();
    expect(snap.heading).toBe('Request');
    expect(snap.body).toContain('loginUser');
  });

  it('workspace knowledge source no-ops without a folder', () => {
    const source = workspaceKnowledgeSource(undefined);
    expect(source.snapshot().body).toBe('');
    expect(source.freshness()).toBe('stale');
  });

  it('run-results source reflects fresh vs stale via run status', () => {
    const rec: McpRunRecord = {
      id: 'run1',
      suiteName: 'S',
      status: 'completed',
      summary: { total: 1, passed: 1, failed: 0 },
      startedAt: Date.now(),
      finishedAt: Date.now(),
      allResults: [],
    } as unknown as McpRunRecord;
    const store = { get: (id: string) => (id === 'run1' ? rec : undefined) } as never;
    expect(runResultsKnowledgeSource(store, 'run1').freshness()).toBe('fresh');
    const running = { ...rec, status: 'running' as const };
    const runningStore = { get: (id: string) => (id === 'run1' ? running : undefined) } as never;
    expect(runResultsKnowledgeSource(runningStore, 'run1').freshness()).toBe('stale');
  });
});

describe('knowledge source registration (one file + one registration)', () => {
  it('a registered source is included in every assemble call', () => {
    registerKnowledgeSource({
      kind: 'openapi',
      snapshot: () => ({
        kind: 'openapi',
        heading: 'OpenAPI Spec',
        body: 'paths: /ping (get)',
        generatedAt: 0,
      }),
      freshness: () => 'fresh',
    } as ApiKnowledgeSource);

    const ctx = assembleBusinessContext([]);
    expect(ctx).toContain('## OpenAPI Spec');
    expect(ctx).toContain('paths: /ping (get)');
    expect(getRegisteredKnowledgeSources()).toHaveLength(1);
  });

  it('registered sources append after the default sources', () => {
    registerKnowledgeSource({
      kind: 'openapi',
      snapshot: () => ({ kind: 'openapi', heading: 'OpenAPI Spec', body: 'spec', generatedAt: 0 }),
      freshness: () => 'fresh',
    } as ApiKnowledgeSource);

    const ctx = assembleBusinessContext([collectionKnowledgeSource(makeCollection())]);
    expect(ctx.indexOf('## Collection')).toBeLessThan(ctx.indexOf('## OpenAPI Spec'));
  });
});

describe('assembleBusinessContext — sources form matches legacy options form', () => {
  it('produces identical output for the same inputs', () => {
    const collection = makeCollection();
    const request = collection.items[0] as CollectionRequestItem;
    const dir = '/tmp/opencode/seam-assemble-test';
    const fs = require('fs');
    const path = require('path');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, '.http-forge', 'knowledge'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.http-forge', 'knowledge', 'wiki.md'), 'Sessions expire in 24h.');

    const rec: McpRunRecord = {
      id: 'run1',
      suiteName: 'Auth Suite',
      status: 'completed',
      summary: { total: 1, passed: 0, failed: 1 },
      startedAt: Date.now(),
      finishedAt: Date.now(),
      allResults: [{ name: 'Login', passed: false }],
    } as unknown as McpRunRecord;
    const store = { get: (id: string) => (id === 'run1' ? rec : undefined) } as never;

    const viaOptions = assembleBusinessContext({
      collection,
      request,
      requestFolderPath: 'root',
      workspaceFolder: dir,
      runStore: store,
      runId: 'run1',
    });

    const viaSources = assembleBusinessContext(
      createDefaultKnowledgeSources({
        collection,
        request,
        requestFolderPath: 'root',
        workspaceFolder: dir,
        runStore: store,
        runId: 'run1',
      })
    );

    expect(viaSources).toBe(viaOptions);
    expect(viaSources).toContain('## Collection');
    expect(viaSources).toContain('## Request');
    expect(viaSources).toContain('## Business Knowledge');
    expect(viaSources).toContain('## Test Results');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty string when no source has content', () => {
    expect(assembleBusinessContext([])).toBe('');
    expect(assembleBusinessContext([collectionKnowledgeSource({ id: 'e', name: 'Empty', items: [] })]).trim()).toBe('');
  });
});
