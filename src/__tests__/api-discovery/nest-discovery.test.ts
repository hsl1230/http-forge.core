import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  ApiDiscoveryService,
  FrameworkFingerprint,
  NestDiscoveryProvider,
} from '../../infrastructure/api-discovery';
import { normalizeForGolden } from './golden-utils';

const FIXTURE_ROOT = path.resolve(process.cwd(), 'test-fixtures', 'nest-app');
const GOLDEN_PATH = path.join(FIXTURE_ROOT, 'expected.endpoints.golden.json');

function makeService(): ApiDiscoveryService {
  return new ApiDiscoveryService({ providers: [new NestDiscoveryProvider()] });
}

describe('api-discovery: nest golden conformance', () => {
  it('discovers the nest-app fixture matching the locked golden file', async () => {
    const service = makeService();

    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf-8'));
    const normalized = normalizeForGolden(result.endpoints, FIXTURE_ROOT);

    expect(normalized).toEqual(golden);
  });
});

describe('api-discovery: nest behavior', () => {
  it('shouldDiscoverNestControllersWithControllerPrefix', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const findAll = result.endpoints.find(
      (ep) => ep.method === 'GET' && ep.pathExpression === '/users',
    );
    expect(findAll).toBeDefined();
    expect(findAll!.resolvedPath).toBe('/users');
    expect(findAll!.confidence).toBe('high');
    expect(findAll!.source.filePath).toContain('src/users/users.controller.ts');
    expect(findAll!.source.symbolName).toBe('findAll');
  });

  it('shouldJoinMethodRoutePathParams', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const findOne = result.endpoints.find(
      (ep) => ep.method === 'GET' && ep.pathExpression === '/users/:id',
    );
    expect(findOne).toBeDefined();
    expect(findOne?.params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'id', location: 'path', required: true }),
      ]),
    );
  });

  it('shouldExtractClassAndMethodMiddleware', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const remove = result.endpoints.find(
      (ep) => ep.method === 'DELETE' && ep.pathExpression === '/users/:id',
    );
    expect(remove?.middleware).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'UseGuards:AuthGuard' })]),
    );
  });

  it('shouldSkipNonNestProject', () => {
    const provider = new NestDiscoveryProvider();
    const nestFingerprint: FrameworkFingerprint = {
      projectRoot: '/tmp/a',
      evidenceFiles: [],
      packageJson: { dependencies: { '@nestjs/common': '^10.0.0' } },
    };
    expect(provider.supports(nestFingerprint).supported).toBe(true);

    const nonNest: FrameworkFingerprint = {
      projectRoot: '/tmp/b',
      evidenceFiles: [],
      packageJson: { dependencies: { express: '^4.19.2' } },
    };
    expect(provider.supports(nonNest).supported).toBe(false);
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
