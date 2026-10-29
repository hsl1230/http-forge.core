import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, expect, it } from 'vitest';
import {
    ApiDiscoveryService,
    FrameworkFingerprint,
    SpringDiscoveryProvider,
} from '../../infrastructure/api-discovery';
import { normalizeForGolden } from './golden-utils';

const FIXTURE_ROOT = path.resolve(process.cwd(), 'test-fixtures', 'spring-app');
const GOLDEN_PATH = path.join(FIXTURE_ROOT, 'expected.endpoints.golden.json');

function makeService(): ApiDiscoveryService {
  return new ApiDiscoveryService({ providers: [new SpringDiscoveryProvider()] });
}

describe('api-discovery: spring golden conformance', () => {
  it('discovers the spring-app fixture matching the locked golden file', async () => {
    const service = makeService();

    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf-8'));
    const normalized = normalizeForGolden(result.endpoints, FIXTURE_ROOT);

    expect(normalized).toEqual(golden);
  });
});

describe('api-discovery: spring behavior', () => {
  it('shouldDiscoverSpringRoutesWithMethodPathAndSource', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const health = result.endpoints.find((ep) => ep.pathExpression === '/health');
    expect(health).toBeDefined();
    expect(health!.method).toBe('GET');
    expect(health!.resolvedPath).toBe('/health');
    expect(health!.confidence).toBe('high');
    expect(health!.source.filePath).toContain('HealthController.java');
    expect(health!.source.line).toBeGreaterThan(0);
  });

  it('shouldMergeControllerBasePathWithMethodPath', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const list = result.endpoints.find(
      (ep) => ep.method === 'GET' && ep.pathExpression === '/api/users',
    );
    expect(list).toBeDefined();
  });

  it('shouldExtractPathVariableAsRequiredPathParam', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const getById = result.endpoints.find(
      (ep) => ep.method === 'GET' && ep.pathExpression === '/api/users/{id}',
    );
    expect(getById).toBeDefined();
    expect(getById!.params).toHaveLength(1);
    expect(getById!.params![0]).toMatchObject({
      name: 'id',
      location: 'path',
      required: true,
    });
  });

  it('shouldExtractRequestBodySchemaFromDto', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const create = result.endpoints.find(
      (ep) => ep.method === 'POST' && ep.pathExpression === '/api/users',
    );
    expect(create?.requestBody).toBeDefined();
    expect(create?.requestBody?.type).toBe('json');
    expect(create?.requestBody?.required).toBe(true);
    expect(create?.requestBody?.schema).toEqual({
      type: 'object',
      properties: {
        id: { type: 'integer', format: 'int64' },
        name: { type: 'string' },
        email: { type: 'string' },
      },
    });
  });

  it('shouldNotEmitBodyForBodylessDelete', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const del = result.endpoints.find(
      (ep) => ep.method === 'DELETE' && ep.pathExpression === '/api/users/{id}',
    );
    expect(del).toBeDefined();
    expect(del!.requestBody).toBeUndefined();
  });

  it('shouldDetectSpringViaPomXml', () => {
    const provider = new SpringDiscoveryProvider();
    const pomFingerprint: FrameworkFingerprint = {
      projectRoot: FIXTURE_ROOT,
      evidenceFiles: [path.join(FIXTURE_ROOT, 'pom.xml')],
    };
    const support = provider.supports(pomFingerprint);
    expect(support.supported).toBe(true);
    expect(support.confidence).toBeGreaterThan(0.9);
  });

  it('shouldRejectNonSpringProject', () => {
    const provider = new SpringDiscoveryProvider();
    const nonSpring: FrameworkFingerprint = {
      projectRoot: path.resolve(process.cwd(), 'test-fixtures', 'express-app'),
      evidenceFiles: [],
      packageJson: { dependencies: { express: '^4.19.2' } },
    };
    expect(provider.supports(nonSpring).supported).toBe(false);
  });

  it('shouldBeDeterministicAcrossRuns', async () => {
    const service = makeService();

    const first = await service.discover({ workspaceFolder: FIXTURE_ROOT });
    const second = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    expect(normalizeForGolden(first.endpoints, FIXTURE_ROOT)).toEqual(
      normalizeForGolden(second.endpoints, FIXTURE_ROOT),
    );
  });

  it('shouldFallBackToJavaScanWhenNoTsJsSourceFiles', async () => {
    const provider = new SpringDiscoveryProvider();
    const support = provider.supports({
      projectRoot: FIXTURE_ROOT,
      evidenceFiles: [],
      sourceFiles: [],
    });
    expect(support.supported).toBe(true);
    expect(support.reasons[0]).toBe('pom.xml detected');
  });

  it('shouldDiscoverStandaloneControllerWithoutBuildFile', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spring-rec-'));
    fs.writeFileSync(path.join(tmp, 'HealthController.java'), `
package com.example.demo;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
@RestController
public class HealthController {
    @GetMapping("/ping")
    public String ping() { return "pong"; }
}
`);
    const service = makeService();
    const result = await service.discover({ workspaceFolder: tmp });

    const ping = result.endpoints.find((ep) => ep.pathExpression === '/ping');
    expect(ping).toBeDefined();
    expect(ping!.method).toBe('GET');
    expect(ping!.confidence).toBe('high');
  });

  it('shouldDiscoverJavaControllerWhenTsJsSourceFilesExist', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spring-rec-'));
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'test' }));
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.writeFileSync(path.join(tmp, 'src', 'index.ts'), `console.log('hello');`);
    fs.writeFileSync(path.join(tmp, 'HealthController.java'), `
package com.example.demo;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
@RestController
public class HealthController {
    @GetMapping("/ping")
    public String ping() { return "pong"; }
}
`);

    const service = makeService();
    const result = await service.discover({ workspaceFolder: tmp });

    const ping = result.endpoints.find((ep) => ep.pathExpression === '/ping');
    expect(ping).toBeDefined();
    expect(ping!.method).toBe('GET');
    expect(ping!.confidence).toBe('high');
  });

  it('shouldMapMultipartUploadToFormFileParts', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const upload = result.endpoints.find(
      (ep) => ep.method === 'POST' && ep.pathExpression === '/api/files/upload',
    );
    expect(upload).toBeDefined();
    expect(upload!.requestBody?.type).toBe('multipart');
    expect(upload!.requestBody?.required).toBe(true);
    expect(upload!.params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'file', location: 'form', type: 'file', required: true }),
        expect.objectContaining({ name: 'description', location: 'form', required: false }),
      ]),
    );
  });

  it('shouldMapFormUrlEncodedParamsToFormLocation', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const form = result.endpoints.find(
      (ep) => ep.method === 'POST' && ep.pathExpression === '/api/files/form',
    );
    expect(form).toBeDefined();
    expect(form!.requestBody?.type).toBe('form');
    expect(form!.params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'name', location: 'form', type: 'string' }),
        expect.objectContaining({ name: 'age', location: 'form', type: 'integer', required: false }),
      ]),
    );
  });

  it('shouldKeepRequestHeaderRequiredByDefault', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const meta = result.endpoints.find(
      (ep) => ep.method === 'GET' && ep.pathExpression === '/api/files/meta',
    );
    expect(meta?.params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'X-Request-Id', location: 'header', required: true }),
        expect.objectContaining({ name: 'verbose', location: 'query', required: false, type: 'boolean' }),
      ]),
    );
  });

  it('shouldSummarizeParameterValidationConstraints', async () => {
    const service = makeService();
    const result = await service.discover({ workspaceFolder: FIXTURE_ROOT });

    const list = result.endpoints.find(
      (ep) => ep.method === 'GET' && ep.pathExpression === '/api/users',
    );
    expect(list?.validation).toEqual(
      expect.arrayContaining(['query role: pattern=[a-z]+, minLength=2, maxLength=32']),
    );
  });
});
