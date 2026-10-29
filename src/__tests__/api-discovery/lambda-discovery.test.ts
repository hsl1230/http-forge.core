import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  ApiDiscoveryService,
  FrameworkFingerprint,
  LambdaDiscoveryProvider,
  parseYamlToObject,
} from '../../infrastructure/api-discovery';
import { normalizeForGolden } from './golden-utils';

const FIXTURE_ROOT = path.resolve(process.cwd(), 'test-fixtures', 'lambda-app');
const GOLDEN_PATH = path.join(FIXTURE_ROOT, 'expected.endpoints.golden.json');

function makeService(): ApiDiscoveryService {
  return new ApiDiscoveryService({ providers: [new LambdaDiscoveryProvider()] });
}

describe('api-discovery: lambda golden conformance', () => {
  it('discovers the lambda-app fixture matching the locked golden file', async () => {
    const service = makeService();

    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf-8'));
    const normalized = normalizeForGolden(result.endpoints, FIXTURE_ROOT);

    expect(normalized).toEqual(golden);
  });
});

describe('api-discovery: lambda behavior', () => {
  it('shouldDiscoverServerlessConfigRoutes', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const health = result.endpoints.find((ep) => ep.pathExpression === '/health');
    expect(health).toBeDefined();
    expect(health!.method).toBe('GET');
    expect(health!.resolvedPath).toBe('/health');
    expect(health!.confidence).toBe('high');
    expect(health!.source.filePath).toContain('src/handlers/health.ts');
    expect(health!.source.symbolName).toBe('main');
    expect(result.endpoints).toHaveLength(5);
  });

  it('shouldResolveCurlyPathParamsFromConfig', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const getById = result.endpoints.find(
      (ep) => ep.method === 'GET' && ep.pathExpression === '/users/{id}',
    );
    expect(getById?.params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'id', location: 'path', required: true }),
      ]),
    );
  });

  it('shouldExtractAuthorizerAsMiddleware', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const getById = result.endpoints.find(
      (ep) => ep.method === 'GET' && ep.pathExpression === '/users/{id}',
    );
    expect(getById?.middleware).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'AuthAuthorizer' })]),
    );
  });

  it('shouldSkipNonLambdaProject', () => {
    const provider = new LambdaDiscoveryProvider();
    const lambdaFingerprint: FrameworkFingerprint = {
      projectRoot: '/tmp/a',
      evidenceFiles: [],
      packageJson: { dependencies: { serverless: '^3.0.0' } },
    };
    expect(provider.supports(lambdaFingerprint).supported).toBe(true);

    const expressFingerprint: FrameworkFingerprint = {
      projectRoot: '/tmp/b',
      evidenceFiles: [],
      packageJson: { dependencies: { express: '^4.19.2' } },
    };
    expect(provider.supports(expressFingerprint).supported).toBe(false);
  });

  it('shouldParseNestedServerlessYaml', () => {
    const parsed = parseYamlToObject([
      'functions:',
      '  createUser:',
      '    handler: src/handlers/users.create',
      '    events:',
      '      - http:',
      '          path: users',
      '          method: post',
    ].join('\n'));

    expect(parsed).toEqual({
      functions: {
        createUser: {
          handler: 'src/handlers/users.create',
          events: [{ http: { path: 'users', method: 'post' } }],
        },
      },
    });
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
