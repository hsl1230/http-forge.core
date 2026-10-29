import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  ApiDiscoveryService,
  FastifyComponentAnalyzer,
  FastifyDiscoveryProvider,
  FrameworkFingerprint,
} from '../../infrastructure/api-discovery';
import { normalizeForGolden } from './golden-utils';

const FIXTURE_ROOT = path.resolve(process.cwd(), 'test-fixtures', 'fastify-app');
const GOLDEN_PATH = path.join(FIXTURE_ROOT, 'expected.endpoints.golden.json');

function makeService(): ApiDiscoveryService {
  return new ApiDiscoveryService({ providers: [new FastifyDiscoveryProvider()] });
}

const EMPTY_FINGERPRINT: FrameworkFingerprint = {
  projectRoot: '/tmp/fake-project',
  evidenceFiles: [],
};

function analyzeInline(content: string) {
  const analyzer = new FastifyComponentAnalyzer();
  return analyzer.analyzeFile('/tmp/inline.ts', content, EMPTY_FINGERPRINT, {
    workspaceFolder: '/tmp/fake-project',
  });
}

describe('api-discovery: fastify golden conformance', () => {
  it('discovers the fastify-app fixture matching the locked golden file', async () => {
    const service = makeService();

    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf-8'));
    const normalized = normalizeForGolden(result.endpoints, FIXTURE_ROOT);

    expect(normalized).toEqual(golden);
  });
});

describe('api-discovery: fastify behavior', () => {
  it('shouldDiscoverFastifyRoutesWithMethodPathAndSource', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const health = result.endpoints.find((ep) => ep.pathExpression === '/health');
    expect(health).toBeDefined();
    expect(health!.method).toBe('GET');
    expect(health!.resolvedPath).toBe('/health');
    expect(health!.confidence).toBe('high');
    expect(health!.source.filePath).toContain('src/app.ts');
    expect(health!.source.line).toBeGreaterThan(0);
  });

  it('shouldResolvePathParamsWithHandlerDetection', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const getById = result.endpoints.find(
      (ep) => ep.method === 'GET' && ep.pathExpression === '/users/:id',
    );
    expect(getById?.params).toHaveLength(1);
    expect(getById?.params?.[0]).toMatchObject({
      name: 'id',
      location: 'path',
      required: true,
      type: 'string',
    });
    expect(getById?.params?.[0].detectionLocation?.line).toBe(19);
  });

  it('shouldExtractStructuredRequestBodySchema', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const create = result.endpoints.find(
      (ep) => ep.method === 'POST' && ep.pathExpression === '/users',
    );
    expect(create?.requestBody).toBeDefined();
    expect(create?.requestBody?.type).toBe('json');
    expect(create?.requestBody?.required).toBe(true);
    expect(create?.requestBody?.schema).toEqual({
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    });
    expect(create?.params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'name', location: 'body', required: true }),
      ]),
    );
  });

  it('shouldResolveNestedRegisterPrefix', async () => {
    const endpoints = await analyzeInline(`
      import Fastify from 'fastify';
      const app = Fastify();
      app.register(async (instance) => {
        instance.get('/items', async () => ({ items: [] }));
      }, { prefix: '/api' });
    `);

    const apiItems = endpoints.find((ep) => ep.pathExpression === '/api/items');
    expect(apiItems).toBeDefined();
    expect(apiItems!.resolvedPath).toBe('/api/items');
    expect(apiItems!.confidence).toBe('high');
  });

  it('shouldSkipNonFastifyProject', () => {
    const provider = new FastifyDiscoveryProvider();
    const fastifyFingerprint: FrameworkFingerprint = {
      projectRoot: '/tmp/a',
      evidenceFiles: [],
      packageJson: { dependencies: { fastify: '^4.0.0' } },
    };
    expect(provider.supports(fastifyFingerprint).supported).toBe(true);

    const nonFastify: FrameworkFingerprint = {
      projectRoot: '/tmp/b',
      evidenceFiles: [],
      packageJson: { dependencies: { express: '^4.19.2' } },
    };
    expect(provider.supports(nonFastify).supported).toBe(false);
  });

  it('shouldBeDeterministicAcrossRuns', async () => {
    const service = makeService();

    const first = await service.discover({ workspaceFolder: FIXTURE_ROOT });
    const second = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    expect(normalizeForGolden(first.endpoints, FIXTURE_ROOT)).toEqual(
      normalizeForGolden(second.endpoints, FIXTURE_ROOT),
    );
  });
});
