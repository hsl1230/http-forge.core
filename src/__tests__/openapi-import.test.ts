/**
 * OpenApiImporter — URL / string import path tests.
 *
 * The file-based `import()` path was previously untested; this covers the new
 * Phase 0 Layer 1 surfaces: `importFromUrl` (fetch-based, Node 18 global fetch)
 * and `importFromString` (JSON + YAML), sharing the same `importFromSpec` core.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ICollectionService } from '../types/collection';
import type { IEnvironmentConfigService } from '../types/environment-config';
import { OpenApiImporter } from '../infrastructure/openapi/openapi-importer';

const PETSTORE_JSON = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Pet Store', version: '1.0.0', description: 'A pet store API' },
  servers: [{ url: 'https://api.petstore.example.com/v1' }],
  tags: [{ name: 'pets', description: 'Pet operations' }],
  paths: {
    '/pets/{petId}': {
      get: {
        operationId: 'getPet',
        summary: 'Get a pet',
        tags: ['pets'],
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'integer', format: 'int64' } }],
        responses: {
          200: {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: { Pet: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } } },
  },
});

function mockServices(): { collection: ICollectionService; env: IEnvironmentConfigService } {
  const collection = { saveCollection: vi.fn() } as unknown as ICollectionService;
  const env = { setEnvironmentVariable: vi.fn() } as unknown as IEnvironmentConfigService;
  return { collection, env };
}

describe('OpenApiImporter — string import', () => {
  it('imports a JSON spec from a string', async () => {
    const { collection, env } = mockServices();
    const importer = new OpenApiImporter(collection, env);

    const result = await importer.importFromString(PETSTORE_JSON);

    expect(result.collection.name).toBe('Pet Store');
    expect(result.collection.variables?.baseUrl).toBe('https://api.petstore.example.com/v1');
    expect(result.collection.items).toHaveLength(1);
    const folder = result.collection.items[0] as any;
    expect(folder.type).toBe('folder');
    expect(folder.name).toBe('pets');
    const request = folder.items[0];
    expect(request.method).toBe('GET');
    expect(request.url).toBe('{{baseUrl}}/pets/:petId');
    expect(request.operationId).toBe('getPet');
    expect(request.params?.petId).toBeDefined();
    expect(collection.saveCollection).toHaveBeenCalledWith(result.collection);
  });

  it('imports a YAML spec from a string', async () => {
    const { collection, env } = mockServices();
    const importer = new OpenApiImporter(collection, env);

    const yaml = `openapi: 3.0.3
info:
  title: Pet Store
  version: 1.0.0
servers:
  - url: https://api.petstore.example.com/v1
paths:
  /pets:
    post:
      operationId: createPet
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Pet'
      responses:
        '201':
          description: created
components:
  schemas:
    Pet:
      type: object
      properties:
        id: { type: integer }
        name: { type: string }`;

    const result = await importer.importFromString(yaml);

    expect(result.collection.name).toBe('Pet Store');
    const request = (result.collection.items[0] as any).items?.[0] ?? result.collection.items[0];
    expect(request.method).toBe('POST');
    expect(request.body?.type).toBe('raw');
    expect(request.body?.format).toBe('json');
  });

  it('throws on empty content', async () => {
    const { collection, env } = mockServices();
    const importer = new OpenApiImporter(collection, env);
    await expect(importer.importFromString('   ')).rejects.toThrow(/empty/);
  });
});

describe('OpenApiImporter — URL import', () => {
  it('fetches a spec from a URL and imports it', async () => {
    const { collection, env } = mockServices();
    const importer = new OpenApiImporter(collection, env);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => PETSTORE_JSON,
    }));

    try {
      const result = await importer.importFromUrl('https://specs.example.com/petstore.json');
      expect(result.collection.name).toBe('Pet Store');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://specs.example.com/petstore.json',
        expect.objectContaining({ headers: expect.anything() })
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws a descriptive error on HTTP failure', async () => {
    const { collection, env } = mockServices();
    const importer = new OpenApiImporter(collection, env);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'nope',
    }));

    try {
      await expect(
        importer.importFromUrl('https://specs.example.com/missing.json')
      ).rejects.toThrow(/HTTP 404/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
