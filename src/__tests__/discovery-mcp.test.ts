/**
 * MCP discovery handler tests.
 *
 * Validates `create_request_from_endpoint`: a discovered endpoint becomes a
 * working HTTP Forge request (no OpenAPI involved) with provenance.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { GENERIC_TOOL_NAMES } from '../runtime/mcp-tool-schemas';
import { GENERIC_TOOL_REGISTRY } from '../runtime/mcp-handlers/registry';
import { schemaToExample } from '../runtime/mcp-handlers/discovery';
import type { Collection } from '../types/collection';

const FIXTURE_ROOT = path.resolve(process.cwd(), 'test-fixtures', 'spring-app');

function makeCollection(name = 'discovered'): Collection {
  return {
    id: 'col-1',
    name,
    description: '',
    items: [],
    version: 1,
  } as unknown as Collection;
}

function makeContext(args: Record<string, unknown>, col: Collection) {
  return {
    tool: GENERIC_TOOL_NAMES.createRequestFromEndpoint,
    args,
    services: {
      collection: {
        createRequest: async (opts: unknown) => ({ ...(opts as object), id: 'req-1' }),
      },
      environmentConfig: {},
      testSuite: {},
      workspaceFolder: FIXTURE_ROOT,
    },
    runStore: {},
    callbacks: {},
    collections: [col],
  } as any;
}

describe('mcp discovery handler', () => {
  it('registers create_request_from_endpoint in the registry', () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.createRequestFromEndpoint);
    expect(handler).toBeDefined();
  });

  it('creates a request from a discovered Spring endpoint', async () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.createRequestFromEndpoint)!;
    const col = makeCollection();
    const ctx = makeContext({
      projectPath: FIXTURE_ROOT,
      method: 'GET',
      path: '/api/users/{id}',
      collection: col.name,
      baseUrl: 'https://api.example.com',
    }, col);

    const result: any = await handler.handle(ctx);

    expect(result).toMatchObject({
      created: true,
      method: 'GET',
      url: 'https://api.example.com/api/users/{id}',
      collection: col.name,
    });
    expect(result.provenance).toMatchObject({
      framework: 'spring',
      confidence: 'high',
    });
    expect(result.provenance.source).toHaveProperty('filePath');
    expect(result.provenance.source).toHaveProperty('line');
  });

  it('includes header params as request headers', async () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.createRequestFromEndpoint)!;
    const col = makeCollection();
    const ctx = makeContext({
      projectPath: FIXTURE_ROOT,
      method: 'POST',
      path: '/api/users',
      collection: col.name,
      baseUrl: 'https://api.example.com',
    }, col);

    const result: any = await handler.handle(ctx);
    expect(result.created).toBe(true);
    expect(result.url).toBe('https://api.example.com/api/users');
  });

  it('rejects when no endpoint matches', async () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.createRequestFromEndpoint)!;
    const col = makeCollection();
    const ctx = makeContext({
      projectPath: FIXTURE_ROOT,
      method: 'GET',
      path: '/nonexistent',
      collection: col.name,
    }, col);

    await expect(handler.handle(ctx)).rejects.toThrow(/No endpoint matched/);
  });

  it('falls back to the workspace folder when projectPath is missing', async () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.createRequestFromEndpoint)!;
    const col = makeCollection();
    const ctx = makeContext({
      method: 'GET',
      path: '/health',
      collection: col.name,
    }, col);

    const result: any = await handler.handle(ctx);
    expect(result.created).toBe(true);
    expect(result.url).toBe('/health');
  });

  it('builds sample JSON from a schema', () => {
    const example = schemaToExample({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
        active: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    });
    expect(example).toEqual({
      name: 'string',
      age: 0,
      active: false,
      tags: ['string'],
    });
  });
});

describe('mcp discovery handler on fastapi fixture', () => {
  it('creates a request with pydantic body sample when sampleData is set', async () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.createRequestFromEndpoint)!;
    const fastapiRoot = path.resolve(process.cwd(), 'test-fixtures', 'fastapi-app');
    const col = makeCollection('fastapi');
    const ctx = makeContext({
      projectPath: fastapiRoot,
      method: 'POST',
      path: '/v1/api/users/',
      collection: col.name,
      baseUrl: 'https://api.example.com',
      sampleData: true,
    }, col);

    const result: any = await handler.handle(ctx);
    expect(result.created).toBe(true);
    expect(result.url).toBe('https://api.example.com/v1/api/users/');
  });
});

describe('mcp generate_test_suite tool', () => {
  it('generates a suite from discovered endpoints in dry-run mode', async () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.generateTestSuite)!;
    const col = makeCollection('gen');
    const ctx = makeContext({
      projectPath: FIXTURE_ROOT,
      collection: col.name,
      dryRun: true,
    }, col);

    const result: any = await handler.handle(ctx);

    expect(result).toMatchObject({
      generated: true,
      dryRun: true,
      aiGenerated: true,
      endpointCount: 9,
      collection: col.name,
    });
    expect(result.derived).toHaveLength(9);
    expect(result.derived[0]).toHaveProperty('endpointId');
    expect(result.flowSource).toContain('ai_generated: true');
    expect(result.flowSource).toContain('f.expect(res.status).toBe(200);');
    expect(result.requestsCreated).toBeUndefined();
  });

  it('creates requests and a suite when not dry-run', async () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.generateTestSuite)!;
    const col = makeCollection('gen2');
    const created: unknown[] = [];
    const ctx = makeContext({}, col);
    ctx.services.collection.createRequest = async (opts: unknown) => {
      const o = opts as { name?: string };
      created.push(o);
      return { ...(o as object), id: `req-${created.length}` };
    };
    ctx.args = {
      projectPath: FIXTURE_ROOT,
      collection: col.name,
      baseUrl: 'https://api.example.com',
    };
    ctx.services.testSuite = { updateSuite: async () => undefined };

    const result: any = await handler.handle(ctx);

    expect(result.generated).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.requestsCreated).toHaveLength(9);
    expect(created).toHaveLength(9);
    expect((created[0] as { method?: string }).method).toBe('GET');
    expect((created[0] as { url?: string }).url).toContain('https://api.example.com/');
    expect(result.suite).toBeDefined();
  });
});

describe('mcp workflow tools (Phase 2a L3)', () => {
  it('suggest_workflow finds chains on a project with auth + CRUD', async () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.suggestWorkflow)!;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-'));
    fs.writeFileSync(path.join(tmp, 'main.py'), `
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class User(BaseModel):
    id: int
    name: str

@app.post("/api/auth/login")
def login():
    return {"token": "x"}

@app.post("/api/users")
def create_user(user: User):
    return user

@app.get("/api/users/{id}", dependencies=[Depends(auth)])
def get_user(id: int):
    return {}
`);

    const col = makeCollection('wf');
    const ctx = makeContext({ projectPath: tmp }, col);
    const result: any = await handler.handle(ctx);

    expect(result.chainCount).toBeGreaterThan(0);
    const kinds = result.chains.map((c: { kind: string }) => c.kind);
    expect(kinds).toContain('auth');
    expect(kinds).toContain('crud');
  });

  it('generate_workflow creates a suite with chain nodes (dry-run)', async () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.generateWorkflow)!;
    const col = makeCollection('wfgen');
    const ctx = makeContext({
      projectPath: FIXTURE_ROOT,
      collection: col.name,
      dryRun: true,
    }, col);

    const result: any = await handler.handle(ctx);
    expect(result.generated).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.aiGenerated).toBe(true);
    expect(result.suite).toBeDefined();
  });
});

describe('mcp check_drift tool (Phase 2b)', () => {
  it('returns freshness without stored state', async () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.checkDrift)!;
    const col = makeCollection('drift');
    const ctx = makeContext({ projectPath: FIXTURE_ROOT }, col);

    const result: any = await handler.handle(ctx);
    expect(result.projectPath).toBe(FIXTURE_ROOT);
    expect(result.status).toBe('unknown');
    expect(result.freshness).toHaveProperty('maxSourceMtime');
  });

  it('reports stale when the stored git hash differs', async () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.checkDrift)!;
    const col = makeCollection('drift2');
    const ctx = makeContext({
      projectPath: FIXTURE_ROOT,
      storedGitHash: '0000000000000000000000000000000000000000',
      storedScannedAt: new Date(0).toISOString(),
    }, col);

    const result: any = await handler.handle(ctx);
    expect(['stale', 'current']).toContain(result.status);
    expect(result.reason).toBeDefined();
  });
});

describe('mcp propose_update tool (Phase 2b loop)', () => {
  it('proposes regeneration for affected suites and flags conflicts', async () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.proposeUpdate)!;
    const col = makeCollection('propose');
    const base = "pm.test('status is 200', () => {});\n";
    const regenerated = "pm.test('status is 201', () => {});\n";
    const ctx = makeContext({
      staleEndpointIds: ['spring:GET:/users'],
      suites: [
        { id: 's1', name: 'S1', currentContent: base, derivedFrom: ['spring:GET:/users'] },
        { id: 's2', name: 'S2', currentContent: base, derivedFrom: ['spring:GET:/other'] },
      ],
      baseContent: { s1: base },
      regeneratedContent: { s1: regenerated },
    }, col);

    const result: any = await handler.handle(ctx);
    expect(result.proposedCount).toBe(1);
    expect(result.proposals[0].suiteId).toBe('s1');
    expect(result.proposals[0].hasConflicts).toBe(false);
  });

  it('computes merged content when apply:true', async () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.proposeUpdate)!;
    const col = makeCollection('propose2');
    const base = "pm.test('status is 200', () => {});\n";
    const regenerated = "pm.test('status is 201', () => {});\n";
    const ctx = makeContext({
      staleEndpointIds: ['spring:GET:/users'],
      suites: [
        { id: 's1', name: 'S1', currentContent: base, derivedFrom: ['spring:GET:/users'] },
      ],
      baseContent: { s1: base },
      regeneratedContent: { s1: regenerated },
      apply: true,
    }, col);

    const result: any = await handler.handle(ctx);
    expect(result.proposals[0].canApply).toBe(true);
    expect(result.proposals[0].mergedContent).toContain("pm.test('status is 201'");
  });
});
