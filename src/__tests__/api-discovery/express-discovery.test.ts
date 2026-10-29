import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  ApiDiscoveryService,
  ExpressComponentAnalyzer,
  ExpressDiscoveryProvider,
  FrameworkFingerprint,
} from '../../infrastructure/api-discovery';
import { normalizeForGolden } from './golden-utils';

const FIXTURE_ROOT = path.resolve(process.cwd(), 'test-fixtures', 'express-app');
const GOLDEN_PATH = path.join(FIXTURE_ROOT, 'expected.endpoints.golden.json');

function makeService(): ApiDiscoveryService {
  return new ApiDiscoveryService({ providers: [new ExpressDiscoveryProvider()] });
}

const EMPTY_FINGERPRINT: FrameworkFingerprint = {
  projectRoot: '/tmp/fake-project',
  evidenceFiles: [],
};

function analyzeInline(content: string) {
  const analyzer = new ExpressComponentAnalyzer();
  return analyzer.analyzeFile('/tmp/inline.ts', content, EMPTY_FINGERPRINT, {
    workspaceFolder: '/tmp/fake-project',
  });
}

describe('api-discovery: express golden conformance', () => {
  it('discovers the express-app fixture matching the locked golden file', async () => {
    const service = makeService();

    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf-8'));
    const normalized = normalizeForGolden(result.endpoints, FIXTURE_ROOT);

    expect(normalized).toEqual(golden);
  });
});

describe('api-discovery: express behavior', () => {
  it('shouldDiscoverExpressRoutesWithMethodPathAndSource', async () => {
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

  it('shouldExtractPathParametersForColonRoutes', async () => {
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
    expect(getById?.params?.[0].detectionLocation?.line).toBe(20);
  });

  it('shouldResolveNestedRouterMountPrefixes', async () => {
    const endpoints = await analyzeInline(`
      import express from 'express';
      const app = express();
      const router = express.Router();
      router.get('/items', (_req, res) => { res.json([]); });
      app.use('/api', router);
    `);

    const apiItems = endpoints.find((ep) => ep.pathExpression === '/api/items');
    expect(apiItems).toBeDefined();
    expect(apiItems!.resolvedPath).toBe('/api/items');
    expect(apiItems!.confidence).toBe('high');
  });

  it('shouldReportDynamicPathUnresolvedWarning', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-dynamic-'));
    fs.writeFileSync(path.join(root, 'app.ts'), [
      `import express from 'express';`,
      `const app = express();`,
      `const version = getVersion();`,
      `app.get(\`/v\${version}/config\`, (_req, res) => { res.json({}); });`,
    ].join('\n'));

    const provider = new ExpressDiscoveryProvider();
    const result = await provider.discover(
      { workspaceFolder: root },
      {
        projectRoot: root,
        evidenceFiles: [path.join(root, 'app.ts')],
        sourceFiles: [path.join(root, 'app.ts')],
      },
    );

    const dynamic = result.endpoints.find((ep) => ep.pathExpression.includes('/v${version}'));
    expect(dynamic).toBeDefined();
    expect(dynamic!.resolvedPath).toBeUndefined();
    expect(dynamic!.confidence).toBe('medium');
    expect(result.warnings.some((w) => w.code === 'dynamic-path-unresolved')).toBe(true);
  });

  it('shouldSkipNonExpressProject', () => {
    const provider = new ExpressDiscoveryProvider();
    const expressFingerprint: FrameworkFingerprint = {
      projectRoot: '/tmp/a',
      evidenceFiles: [],
      packageJson: { dependencies: { express: '^4.19.2' } },
    };
    expect(provider.supports(expressFingerprint).supported).toBe(true);

    const nonExpress: FrameworkFingerprint = {
      projectRoot: '/tmp/b',
      evidenceFiles: [],
      packageJson: { dependencies: { fastify: '^4.0.0' } },
    };
    expect(provider.supports(nonExpress).supported).toBe(false);
  });

  it('shouldBeDeterministicAcrossRuns', async () => {
    const service = makeService();

    const first = await service.discover({ workspaceFolder: FIXTURE_ROOT });
    const second = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    expect(normalizeForGolden(first.endpoints, FIXTURE_ROOT)).toEqual(
      normalizeForGolden(second.endpoints, FIXTURE_ROOT),
    );
  });

  it('shouldExtractRouteMiddleware', async () => {
    const endpoints = await analyzeInline(`
      import express from 'express';
      const app = express();
      function requireAuth(req, res, next) { next(); }
      app.get('/api/users', requireAuth, (_req, res) => { res.json([]); });
    `);

    const users = endpoints.find((ep) => ep.pathExpression === '/api/users');
    expect(users?.middleware).toEqual([{ name: 'requireAuth' }]);
  });
});
