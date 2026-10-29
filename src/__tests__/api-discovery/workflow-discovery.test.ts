import { describe, expect, it } from 'vitest';
import { discoverWorkflows } from '../../infrastructure/api-discovery';
import type { DiscoveredApi } from '../../infrastructure/api-discovery';

function ep(overrides: Partial<DiscoveredApi> & { id: string; method: string; path: string }): DiscoveredApi {
  return {
    framework: 'spring',
    confidence: 'high',
    source: { filePath: 'X.java', line: 1, symbolName: `${overrides.method} ${overrides.path}` },
    responses: [{ statusCode: 200 }],
    pathExpression: overrides.path,
    resolvedPath: overrides.path,
    ...overrides,
  };
}

const OPTS = { collectionId: 'col-1', collectionName: 'My API' };

describe('workflow discovery (Phase 2a L3)', () => {
  it('detects an auth chain from a login endpoint to protected endpoints', () => {
    const endpoints = [
      ep({ id: 'a1', method: 'POST', path: '/api/auth/login' }),
      ep({ id: 'a2', method: 'GET', path: '/api/users', auth: { required: true } }),
      ep({ id: 'a3', method: 'GET', path: '/health' }),
    ];

    const chains = discoverWorkflows(endpoints, OPTS);

    const auth = chains.find((c) => c.kind === 'auth');
    expect(auth).toBeDefined();
    expect(auth!.producer.endpointId).toBe('a1');
    expect(auth!.dependents.map((d) => d.endpointId)).toEqual(['a2']);
    expect(auth!.confidence).toBe('high');
    expect(auth!.variableName).toBe('authToken');

    // Flow nodes: producer request + if gate with dependents inside then.
    expect(auth!.nodes[0].type).toBe('request');
    const ifNode = auth!.nodes[1] as { type: 'if'; if: string; then: unknown[] };
    expect(ifNode.type).toBe('if');
    expect(ifNode.if).toContain('authToken');
    expect(ifNode.then).toHaveLength(1);
  });

  it('detects a CRUD chain from create to id-scoped operations', () => {
    const endpoints = [
      ep({ id: 'c1', method: 'POST', path: '/api/users' }),
      ep({ id: 'c2', method: 'GET', path: '/api/users/{id}' }),
      ep({ id: 'c3', method: 'PUT', path: '/api/users/{id}' }),
      ep({ id: 'c4', method: 'DELETE', path: '/api/users/{id}' }),
      ep({ id: 'c5', method: 'GET', path: '/api/users/list' }),
    ];

    const chains = discoverWorkflows(endpoints, OPTS);

    const crud = chains.find((c) => c.kind === 'crud');
    expect(crud).toBeDefined();
    expect(crud!.producer.endpointId).toBe('c1');
    // Only {id}-scoped dependents; /api/users/list is not id-scoped.
    expect(crud!.dependents.map((d) => d.endpointId).sort()).toEqual(['c2', 'c3', 'c4']);
    expect(crud!.variableName).toBe('usersId');

    const ifNode = crud!.nodes[1] as { type: 'if'; if: string; then: unknown[] };
    expect(ifNode.if).toContain('usersId');
    expect(ifNode.then).toHaveLength(3);
  });

  it('does not emit chains without producers or dependents', () => {
    const endpoints = [
      ep({ id: 'x1', method: 'GET', path: '/api/things' }),
      ep({ id: 'x2', method: 'DELETE', path: '/api/things/{id}' }), // no POST producer
    ];
    const chains = discoverWorkflows(endpoints, OPTS);
    expect(chains).toHaveLength(0);
  });

  it('is deterministic across runs', () => {
    const endpoints = [
      ep({ id: 'd1', method: 'POST', path: '/api/orders' }),
      ep({ id: 'd2', method: 'GET', path: '/api/orders/{id}' }),
      ep({ id: 'd3', method: 'POST', path: '/api/auth/login' }),
      ep({ id: 'd4', method: 'GET', path: '/api/orders', auth: { required: true } }),
    ];
    const first = discoverWorkflows(endpoints, OPTS).map((c) => c.id);
    const second = discoverWorkflows(endpoints, OPTS).map((c) => c.id);
    expect(first).toEqual(second);
  });
});
