import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  ApiDiscoveryService,
  FastApiDiscoveryProvider,
  FrameworkFingerprint,
} from '../../infrastructure/api-discovery';
import { normalizeForGolden } from './golden-utils';

const FIXTURE_ROOT = path.resolve(process.cwd(), 'test-fixtures', 'fastapi-app');
const GOLDEN_PATH = path.join(FIXTURE_ROOT, 'expected.endpoints.golden.json');

function makeService(): ApiDiscoveryService {
  return new ApiDiscoveryService({ providers: [new FastApiDiscoveryProvider()] });
}

describe('api-discovery: fastapi golden conformance', () => {
  it('discovers the fastapi-app fixture matching the locked golden file', async () => {
    const service = makeService();

    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf-8'));
    const normalized = normalizeForGolden(result.endpoints, FIXTURE_ROOT);

    expect(normalized).toEqual(golden);
  });
});

describe('api-discovery: fastapi behavior', () => {
  it('shouldDiscoverFastApiRoutesWithMethodPathAndSource', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const health = result.endpoints.find((ep) => ep.pathExpression === '/health');
    expect(health).toBeDefined();
    expect(health!.method).toBe('GET');
    expect(health!.resolvedPath).toBe('/health');
    expect(health!.confidence).toBe('high');
    expect(health!.source.filePath).toContain('app/main.py');
    expect(health!.source.line).toBeGreaterThan(0);
  });

  it('shouldMergeIncludeRouterPrefixBeforeRouterPrefix', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const list = result.endpoints.find(
      (ep) => ep.method === 'GET' && ep.pathExpression === '/v1/api/users/',
    );
    expect(list).toBeDefined();
    expect(list!.resolvedPath).toBe('/v1/api/users/');
    expect(list!.tags).toEqual(['users']);
  });

  it('shouldMarkQueryParamsOptionalWhenDefaulted', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const list = result.endpoints.find(
      (ep) => ep.method === 'GET' && ep.pathExpression === '/v1/api/users/',
    );
    expect(list?.params).toHaveLength(2);
    expect(list?.params?.[0]).toMatchObject({
      name: 'role',
      location: 'query',
      required: false,
      type: 'string',
    });
    expect(list?.params?.[1]).toMatchObject({
      name: 'limit',
      location: 'query',
      required: false,
      type: 'integer',
    });
  });

  it('shouldExtractPathParamTypeFromAnnotation', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const getById = result.endpoints.find(
      (ep) => ep.method === 'GET' && ep.pathExpression === '/v1/api/users/{user_id}',
    );
    expect(getById?.params).toHaveLength(1);
    expect(getById?.params?.[0]).toMatchObject({
      name: 'user_id',
      location: 'path',
      required: true,
      type: 'integer',
    });
  });

  it('shouldExtractPydanticRequestBodySchema', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const create = result.endpoints.find(
      (ep) => ep.method === 'POST' && ep.pathExpression === '/v1/api/users/',
    );
    expect(create?.requestBody).toBeDefined();
    expect(create?.requestBody?.type).toBe('json');
    expect(create?.requestBody?.required).toBe(true);
    expect(create?.requestBody?.schema).toEqual({
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        email: { type: 'string' },
        nickname: { type: 'string' },
      },
      required: ['id', 'name', 'email'],
    });
  });

  it('shouldExtractResponseModelFromReturnAnnotation', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const list = result.endpoints.find(
      (ep) => ep.method === 'GET' && ep.pathExpression === '/v1/api/users/',
    );
    expect(list?.responses?.[0].body?.schema).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          email: { type: 'string' },
          nickname: { type: 'string' },
        },
        required: ['id', 'name', 'email'],
      },
    });
  });

  it('shouldDetectSecurityDependencies', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const protectedEp = result.endpoints.find((ep) => ep.pathExpression === '/protected');
    expect(protectedEp?.auth).toMatchObject({
      required: true,
      type: 'jwt',
      annotation: 'get_current_user',
    });
  });

  it('shouldRespectExplicitStatusCode', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const del = result.endpoints.find(
      (ep) => ep.method === 'DELETE' && ep.pathExpression === '/v1/api/users/{user_id}',
    );
    expect(del?.responses?.[0].statusCode).toBe(204);
    expect(del?.requestBody).toBeUndefined();
  });

  it('shouldDetectFastApiViaRequirementsTxt', () => {
    const provider = new FastApiDiscoveryProvider();
    const support = provider.supports({
      projectRoot: FIXTURE_ROOT,
      evidenceFiles: [path.join(FIXTURE_ROOT, 'requirements.txt')],
    });
    expect(support.supported).toBe(true);
    expect(support.confidence).toBeGreaterThan(0.8);
  });

  it('shouldRejectNonFastApiProject', () => {
    const provider = new FastApiDiscoveryProvider();
    const nonFastApi: FrameworkFingerprint = {
      projectRoot: path.resolve(process.cwd(), 'test-fixtures', 'express-app'),
      evidenceFiles: [],
      packageJson: { dependencies: { express: '^4.19.2' } },
    };
    expect(provider.supports(nonFastApi).supported).toBe(false);
  });

  it('shouldBeDeterministicAcrossRuns', async () => {
    const service = makeService();

    const first = await service.discover({ workspaceFolder: FIXTURE_ROOT });
    const second = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    expect(normalizeForGolden(first.endpoints, FIXTURE_ROOT)).toEqual(
      normalizeForGolden(second.endpoints, FIXTURE_ROOT),
    );
  });

  it('shouldExpandRouterIncludedUnderMultiplePrefixes', async () => {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fastapi-multi-'));
    fs.mkdirSync(path.join(tmp, 'app'));
    fs.writeFileSync(path.join(tmp, 'app', 'routers.py'), `
from fastapi import APIRouter

router = APIRouter(prefix="/users")

@router.get("/")
def list_users():
    return []
`);
    fs.writeFileSync(path.join(tmp, 'app', 'main.py'), `
from fastapi import FastAPI
from .routers import router

app = FastAPI()
app.include_router(router, prefix="/v1")
app.include_router(router, prefix="/v2")
`);

    const service = makeService();
    const result = await service.discover({ workspaceFolder: tmp });

    const paths = result.endpoints.map((ep) => ep.pathExpression).sort();
    expect(paths).toEqual(['/v1/users/', '/v2/users/']);
    expect(result.endpoints.every((ep) => ep.confidence === 'high')).toBe(true);
  });

  it('shouldMarkFStringPathAsLowConfidence', async () => {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fastapi-fstr-'));
    fs.writeFileSync(path.join(tmp, 'main.py'), `
from fastapi import FastAPI

app = FastAPI()
prefix = "/api"

@app.get(f"{prefix}/items")
def list_items():
    return []
`);

    const service = makeService();
    const result = await service.discover({ workspaceFolder: tmp });

    const ep = result.endpoints.find((e) => e.pathExpression.includes('items'));
    expect(ep).toBeDefined();
    expect(ep!.confidence).toBe('low');
  });
});
