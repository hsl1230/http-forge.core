import { describe, expect, it } from 'vitest';
import {
  generateFlowFromEndpoints,
  generateSuiteFromEndpoints,
  suiteIdFromName,
} from '../../infrastructure/api-discovery';
import type { DiscoveredApi } from '../../infrastructure/api-discovery';

function makeEndpoint(overrides: Partial<DiscoveredApi> = {}): DiscoveredApi {
  return {
    id: 'spring:GET:/api/users',
    framework: 'spring',
    method: 'GET',
    pathExpression: '/api/users',
    resolvedPath: '/api/users',
    confidence: 'high',
    source: {
      filePath: 'src/main/java/UserController.java',
      line: 20,
      symbolName: 'GET /api/users',
    },
    responses: [{ statusCode: 200, body: { type: 'json' } }],
    ...overrides,
  };
}

describe('test-generator (Phase 2a)', () => {
  it('generates one request node per endpoint with status assertion', () => {
    const endpoints = [
      makeEndpoint({ id: 'spring:GET:/health', method: 'GET', pathExpression: '/health', source: { filePath: 'Health.java', line: 5, symbolName: 'GET /health' } }),
      makeEndpoint({ id: 'spring:POST:/api/users', method: 'POST', pathExpression: '/api/users', source: { filePath: 'UserController.java', line: 30, symbolName: 'POST /api/users' }, responses: [{ statusCode: 201 }] }),
    ];

    const { suite, derived } = generateSuiteFromEndpoints(endpoints, {
      collectionId: 'col-1',
      collectionName: 'My API',
    });

    expect(suite.ai_generated).toBe(true);
    expect(suite.derived_from).toEqual(['spring:GET:/health', 'spring:POST:/api/users']);
    expect(suite.nodes).toHaveLength(2);

    const healthNode = suite.nodes[0] as { type: 'request'; postResponseScript?: string[] };
    expect(healthNode.type).toBe('request');
    expect(healthNode.postResponseScript).toContain("pm.test('status is 200', function () {");
    expect(healthNode.postResponseScript).toContain('  pm.expect(code).to.eq(200);');

    const postNode = suite.nodes[1] as { postResponseScript?: string[] };
    expect(postNode.postResponseScript).toContain('  pm.expect(code).to.eq(201);');

    expect(derived).toEqual([
      { endpointId: 'spring:GET:/health', requestName: 'GET /health', method: 'GET', path: '/health' },
      { endpointId: 'spring:POST:/api/users', requestName: 'POST /api/users', method: 'POST', path: '/api/users' },
    ]);
  });

  it('asserts array body schema when requested', () => {
    const endpoints = [
      makeEndpoint({
        id: 'spring:GET:/api/users',
        responses: [{
          statusCode: 200,
          body: { type: 'json', schema: { type: 'array', items: { type: 'object' } } },
        }],
      }),
    ];

    const { suite } = generateSuiteFromEndpoints(endpoints, {
      collectionId: 'col-1',
      collectionName: 'My API',
      assertBodySchema: true,
    });

    const node = suite.nodes[0] as { postResponseScript?: string[] };
    expect(node.postResponseScript).toContain("pm.test('response body is a JSON array', function () {");
  });

  it('produces a deterministic suite id from a name', () => {
    expect(suiteIdFromName('My API smoke')).toBe(suiteIdFromName('My API smoke'));
    expect(suiteIdFromName('My API smoke')).toMatch(/^my-api-smoke_/);
    expect(suiteIdFromName('X')).not.toBe(suiteIdFromName('Y'));
  });
});

describe('flow.js generation (Phase 2a L4)', () => {
  it('emits a flow function with one send + status assertion per endpoint', () => {
    const endpoints = [
      makeEndpoint({
        id: 'spring:GET:/health',
        method: 'GET',
        pathExpression: '/health',
        source: { filePath: 'Health.java', line: 5, symbolName: 'GET /health' },
      }),
      makeEndpoint({
        id: 'spring:POST:/api/users',
        method: 'POST',
        pathExpression: '/api/users',
        source: { filePath: 'UserController.java', line: 30, symbolName: 'POST /api/users' },
        responses: [{ statusCode: 201 }],
      }),
    ];

    const flow = generateFlowFromEndpoints(endpoints, {
      requestPathOf: (ep) => ep.source?.symbolName ?? ep.pathExpression,
      name: 'health-and-users',
    });

    expect(flow).toContain('ai_generated: true');
    expect(flow).toContain('derived_from: spring:GET:/health, spring:POST:/api/users');
    expect(flow).toContain("const res = await f.send('GET /health');");
    expect(flow).toContain('f.expect(res.status).toBe(200);');
    expect(flow).toContain("const res = await f.send('POST /api/users');");
    expect(flow).toContain('f.expect(res.status).toBe(201);');
    expect(flow).toContain('export default async function (f) {');
  });

  it('generated flow executes against a mock flow runtime (runnable artifact)', async () => {
    const endpoints = [
      makeEndpoint({
        id: 'req_a1b2c3d4e5f6', // looks like a real collection request id
        method: 'GET',
        pathExpression: '/health',
        source: { filePath: 'Health.java', line: 5, symbolName: 'GET /health' },
        responses: [{ statusCode: 200 }],
      }),
      makeEndpoint({
        id: 'req_f6e5d4c3b2a1',
        method: 'POST',
        pathExpression: '/api/users',
        source: { filePath: 'UserController.java', line: 30, symbolName: 'POST /api/users' },
        responses: [{ statusCode: 201 }],
      }),
    ];

    const flow = generateFlowFromEndpoints(endpoints, { name: 'runnable' });

    // Default path resolution uses #<requestId> for real request ids.
    expect(flow).toContain("f.send('#req_a1b2c3d4e5f6')");
    expect(flow).toContain("f.send('#req_f6e5d4c3b2a1')");

    // Write and import the artifact, then execute it with a mock `f`.
    const tmp = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'flow-run-'));
    const file = require('path').join(tmp, 'flow.mjs');
    require('fs').writeFileSync(file, flow, 'utf-8');

    const module = await import(`file://${file}?t=${Date.now()}`);
    const flowFn = module.default;

    const sent: string[] = [];
    const expectations: string[] = [];
    const mockF = {
      send: async (path: string) => {
        sent.push(path);
        const status = path === '#req_a1b2c3d4e5f6' ? 200 : 201;
        return { status, body: {}, headers: {}, cookies: {}, time: 1, request: {} };
      },
      expect: (value: unknown) => ({
        toBe: (expected: unknown) => {
          expectations.push(`${value} === ${expected}`);
          expect(value).toBe(expected);
        },
      }),
    };

    await flowFn(mockF);

    expect(sent).toEqual(['#req_a1b2c3d4e5f6', '#req_f6e5d4c3b2a1']);
    expect(expectations).toEqual(['200 === 200', '201 === 201']);
  });
});
