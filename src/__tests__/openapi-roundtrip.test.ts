/**
 * OpenAPI → Collection → OpenAPI round-trip golden test.
 *
 * Imports a fixture spec (with params, body, security, tags), exports it back
 * to an OpenAPI document via OpenApiExporter, then re-imports the exported
 * document. Structural assertions verify the spine survives: paths, methods,
 * path/query parameters, request body schema, tags, and servers.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Collection, ICollectionService } from '../types/collection';
import type { IEnvironmentConfigService } from '../types/environment-config';
import { OpenApiImporter } from '../infrastructure/openapi/openapi-importer';
import { OpenApiExporter } from '../infrastructure/openapi/openapi-exporter';
import { SchemaInferenceService } from '../infrastructure/openapi/schema-inference-service';

const FIXTURE_SPEC = `openapi: 3.0.3
info:
  title: Round Trip API
  version: 2.1.0
  description: Used for the round-trip golden test.
servers:
  - url: https://api.roundtrip.example.com/v1
tags:
  - name: pets
    description: Pet operations
  - name: users
    description: User operations
security:
  - bearerAuth: []
paths:
  /pets:
    get:
      operationId: listPets
      summary: List pets
      tags: [pets]
      parameters:
        - name: limit
          in: query
          schema: { type: integer, format: int32, minimum: 1 }
        - name: verbose
          in: query
          schema: { type: boolean }
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Pet'
    post:
      operationId: createPet
      summary: Create a pet
      tags: [pets]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Pet'
      responses:
        '201':
          description: created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
  /pets/{petId}:
    get:
      operationId: getPet
      summary: Get a pet by id
      tags: [pets]
      parameters:
        - name: petId
          in: path
          required: true
          schema: { type: string }
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  schemas:
    Pet:
      type: object
      required: [name]
      properties:
        id: { type: integer, format: int64 }
        name: { type: string }
        tag: { type: string }
`;

function makeCollectionService(): ICollectionService {
  const store = new Map<string, Collection>();
  const svc = {
    saveCollection: vi.fn(async (c: Collection) => {
      store.set(c.id, c);
    }),
    getCollection: vi.fn((id: string) => store.get(id)),
    getCollectionById: vi.fn((id: string) => store.get(id)),
    getCollectionByName: vi.fn((name: string) => [...store.values()].find((c) => c.name === name)),
    getCollectionVariables: vi.fn(() => ({})),
    getCollectionVariableLocals: vi.fn(() => ({})),
    listCollections: vi.fn(() => [...store.values()]),
  } as unknown as ICollectionService;
  return svc;
}

function makeEnvService(): IEnvironmentConfigService {
  const vars: Record<string, string> = { baseUrl: 'https://api.roundtrip.example.com/v1' };
  return {
    setEnvironmentVariable: vi.fn((key: string, value: string) => {
      vars[key] = value;
    }),
    getSelectedEnvironment: vi.fn(() => 'test'),
    resolveVariables: vi.fn((v: string) => v.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`)),
    getEnvironmentVariable: vi.fn((key: string) => vars[key]),
  } as unknown as IEnvironmentConfigService;
}

describe('OpenAPI round-trip golden test', () => {
  it('preserves paths, methods, params, body, tags, and servers through export + re-import', async () => {
    const collectionService = makeCollectionService();
    const envService = makeEnvService();
    const importer = new OpenApiImporter(collectionService, envService);

    const first = await importer.importFromString(FIXTURE_SPEC);
    expect(first.collection.items).toHaveLength(2); // pets + users folders

    // Export the imported collection back to OpenAPI.
    const exporter = new OpenApiExporter(
      collectionService,
      envService,
      new SchemaInferenceService({} as any, {} as any, {} as any)
    );
    const exported = await exporter.export(first.collection.id, {
      format: 'json',
      environments: [],
    });
    const spec = JSON.parse(exported);

    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('Round Trip API');
    expect(spec.info.version).toBe('2.1.0');
    expect(spec.servers.some((s: any) => s.url === 'https://api.roundtrip.example.com/v1')).toBe(true);

    // All three paths survived.
    expect(Object.keys(spec.paths).sort()).toEqual(['/pets', '/pets/{petId}']);
    expect(Object.keys(spec.paths['/pets']).sort()).toEqual(['get', 'post']);
    expect(Object.keys(spec.paths['/pets/{petId}']).sort()).toEqual(['get']);

    // Query param constraints survived.
    const limit = spec.paths['/pets'].get.parameters.find((p: any) => p.name === 'limit');
    expect(limit.in).toBe('query');
    expect(limit.schema.minimum).toBe(1);

    // Path param survived.
    const petId = spec.paths['/pets/{petId}'].get.parameters.find((p: any) => p.name === 'petId');
    expect(petId.required).toBe(true);

    // Request body schema survived — check the referenced Pet component shape.
    const bodySchemaRef = spec.paths['/pets'].post.requestBody.content['application/json'].schema;
    const petSchema = bodySchemaRef.$ref
      ? spec.components.schemas[bodySchemaRef.$ref.split('/').pop()]
      : bodySchemaRef;
    expect(petSchema.type).toBe('object');
    expect(petSchema.properties.name.type).toBe('string');
    expect(petSchema.required).toContain('name');

    // Re-import the exported document and assert structural equivalence.
    const second = await importer.importFromString(JSON.stringify(spec));
    const reqs = (name: string) => {
      const folder = second.collection.items.find((i: any) => i.type === 'folder' && i.name === name);
      return folder ? (folder as any).items : [];
    };

    const petReqs = reqs('pets');
    const petPaths = petReqs.map((r: any) => r.url.replace('{{baseUrl}}', '')).sort();
    expect(petPaths).toEqual(['/pets', '/pets', '/pets/:petId']);

    const postPet = petReqs.find((r: any) => r.method === 'POST' && r.url.includes('/pets'));
    expect(postPet.body?.type).toBe('raw');
    expect(postPet.body?.format).toBe('json');

    const getPet = petReqs.find((r: any) => r.url.includes('/pets/:petId'));
    expect(getPet.params?.petId).toBeDefined();
    expect(getPet.operationId).toBe('getPet');

    // baseUrl variable carried across both directions.
    expect(second.collection.variables?.baseUrl).toBe('https://api.roundtrip.example.com/v1');
  });
});
