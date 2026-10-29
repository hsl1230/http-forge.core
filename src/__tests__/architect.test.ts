/**
 * API Architect (Phase 4 / Layer 8) — service tests.
 *
 * The architect flow is: intent → AI designs an OpenAPI spec → imported into a
 * collection → endpoints derived → suite + flow + workflows generated → the
 * collection is exported back to OpenAPI (round-trip) → docs rendered.
 *
 * These tests drive ApiArchitectService with a fake IAiProvider (deterministic
 * designed spec) and assert the whole reviewable package comes out consistent.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Collection, ICollectionService } from '../types/collection';
import type { IEnvironmentConfigService } from '../types/environment-config';
import type { IAiProvider } from '../infrastructure/ai/ai-provider';
import { OpenApiImporter } from '../infrastructure/openapi/openapi-importer';
import { OpenApiExporter } from '../infrastructure/openapi/openapi-exporter';
import { SchemaInferenceService } from '../infrastructure/openapi/schema-inference-service';
import {
  ApiArchitectService,
  validateDesignedSpec,
  renderArchitectDocs,
} from '../infrastructure/architect';
import { GENERIC_TOOL_NAMES } from '../runtime/mcp-tool-schemas';
import { GENERIC_TOOL_REGISTRY } from '../runtime/mcp-handlers/registry';

// A designed spec a well-behaved AI might return for a shopping-cart intent.
const DESIGNED_SPEC: Record<string, unknown> = {
  openapi: '3.0.3',
  info: { title: 'Shopping Cart API', version: '1.0.0', description: 'Cart operations' },
  servers: [{ url: 'https://api.cart.example.com' }],
  tags: [{ name: 'carts', description: 'Cart operations' }],
  security: [{ bearerAuth: [] }],
  paths: {
    '/carts': {
      get: {
        operationId: 'listCarts',
        summary: 'List carts',
        tags: ['carts'],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CartList' } } },
          },
        },
      },
      post: {
        operationId: 'createCart',
        summary: 'Create a cart',
        tags: ['carts'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/NewCart' } } },
        },
        responses: {
          '201': {
            description: 'created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Cart' } } },
          },
        },
      },
    },
    '/carts/{id}': {
      get: {
        operationId: 'getCart',
        summary: 'Get a cart',
        tags: ['carts'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Cart' } } },
          },
        },
      },
      delete: {
        operationId: 'deleteCart',
        summary: 'Delete a cart',
        tags: ['carts'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '204': { description: 'deleted' } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Cart: {
        type: 'object',
        required: ['id', 'items'],
        properties: {
          id: { type: 'integer' },
          items: { type: 'array', items: { type: 'string' } },
        },
      },
      CartList: { type: 'array', items: { $ref: '#/components/schemas/Cart' } },
      NewCart: { type: 'object', properties: { name: { type: 'string' } } },
    },
  },
};

function makeCollectionService(): ICollectionService {
  const store = new Map<string, Collection>();
  const svc = {
    saveCollection: vi.fn(async (c: Collection) => { store.set(c.id, c); }),
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
  const vars: Record<string, string> = { baseUrl: 'https://api.cart.example.com' };
  return {
    setEnvironmentVariable: vi.fn((key: string, value: string) => { vars[key] = value; }),
    getSelectedEnvironment: vi.fn(() => 'test'),
    resolveVariables: vi.fn((v: string) => v.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`)),
    getEnvironmentVariable: vi.fn((key: string) => vars[key]),
  } as unknown as IEnvironmentConfigService;
}

function makeService(aiProvider: IAiProvider): ApiArchitectService {
  const collectionService = makeCollectionService();
  const envService = makeEnvService();
  const importer = new OpenApiImporter(collectionService, envService);
  const exporter = new OpenApiExporter(
    collectionService,
    envService,
    new SchemaInferenceService({} as any, {} as any, {} as any)
  );
  return new ApiArchitectService(importer, exporter, aiProvider);
}

describe('validateDesignedSpec', () => {
  it('accepts a valid 3.0 document with non-empty paths', () => {
    expect(validateDesignedSpec(DESIGNED_SPEC)).toBeNull();
  });

  it('rejects non-object responses', () => {
    expect(validateDesignedSpec('nope')).toContain('not a JSON object');
  });

  it('rejects non-3.0 openapi versions', () => {
    expect(validateDesignedSpec({ openapi: '2.0', paths: {} })).toContain('3.0.x');
  });

  it('rejects empty paths', () => {
    expect(validateDesignedSpec({ openapi: '3.0.3', paths: {} })).toContain('empty');
  });
});

describe('ApiArchitectService.designFromIntent', () => {
  it('produces a complete reviewable package from an intent', async () => {
    const aiProvider: IAiProvider = {
      complete: vi.fn(async () => JSON.stringify(DESIGNED_SPEC)),
    };
    const service = makeService(aiProvider);

    const result = await service.designFromIntent('I need a shopping cart', {
      collectionName: 'Cart API',
      baseUrl: 'https://api.cart.example.com',
    });

    // Intent → spec prompt actually asked the AI about the intent.
    expect(aiProvider.complete).toHaveBeenCalledTimes(1);
    expect(aiProvider.complete).toHaveBeenCalledWith(expect.stringContaining('shopping cart'));

    // Collection created with the designed endpoints.
    expect(result.collectionName).toBe('Cart API');
    expect(result.collectionId).toBeTruthy();
    expect(result.endpoints).toHaveLength(4); // GET/POST /carts, GET/DELETE /carts/{id}

    // Suite: one node per endpoint, asserting designed status codes.
    expect(result.suite.ai_generated).toBe(true);
    expect(result.suite.nodes).toHaveLength(4);
    const script = result.suite.nodes[1] as { postResponseScript?: string[] };
    expect(script.postResponseScript).toContain('  pm.expect(code).to.eq(201);');

    // Flow: runnable artifact, tagged ai_generated.
    expect(result.flow).toContain('ai_generated: true');
    expect(result.flow).toContain('await f.send');

    // Workflow discovery: the design has POST /carts → GET/DELETE /carts/{id}.
    const crud = result.workflows.find((w) => w.kind === 'crud');
    expect(crud).toBeDefined();
    expect(crud!.producer.path).toBe('/carts');
    expect(crud!.dependents.map((d) => d.method).sort()).toEqual(['DELETE', 'GET']);

    // Round-trip OpenAPI export.
    const spec = JSON.parse(result.openapi);
    expect(spec.openapi).toBe('3.0.3');
    expect(Object.keys(spec.paths).sort()).toEqual(['/carts', '/carts/{id}']);

    // Docs rendered.
    expect(result.docs).toContain('# Cart API');
    expect(result.docs).toContain('| GET |');
    expect(result.docs).toContain('ai_generated: true');

    // Drift hook present.
    expect(result.ai_generated).toBe(true);
    expect(result.derivedFrom).toHaveLength(4);
  });

  it('throws a clear error when the AI returns non-JSON', async () => {
    const aiProvider: IAiProvider = {
      complete: vi.fn(async () => 'Sorry, I cannot design APIs.'),
    };
    const service = makeService(aiProvider);

    await expect(
      service.designFromIntent('a todo list')
    ).rejects.toThrow(/valid OpenAPI spec/);
  });

  it('throws a clear error when the AI returns a non-3.0 doc', async () => {
    const aiProvider: IAiProvider = {
      complete: vi.fn(async () => JSON.stringify({ openapi: '2.0', paths: { '/x': {} } })),
    };
    const service = makeService(aiProvider);

    await expect(
      service.designFromIntent('a todo list')
    ).rejects.toThrow(/openapi field must be 3.0.x/);
  });

  it('derives path params and auth from the designed spec', async () => {
    const aiProvider: IAiProvider = {
      complete: vi.fn(async () => JSON.stringify(DESIGNED_SPEC)),
    };
    const service = makeService(aiProvider);
    const result = await service.designFromIntent('shopping cart');

    const getCart = result.endpoints.find((ep) => ep.pathExpression === '/carts/{id}');
    expect(getCart).toBeDefined();
    expect(getCart!.params?.some((p) => p.name === 'id' && p.location === 'path')).toBe(true);
    expect(getCart!.auth?.required).toBe(true);
    expect(getCart!.responses?.[0]?.statusCode).toBe(200);
  });
});

describe('renderArchitectDocs', () => {
  it('renders a docs table with the intent and endpoints', () => {
    const docs = renderArchitectDocs('shopping cart', 'Cart API', [
      { id: 'c1', framework: 'unknown', method: 'POST', pathExpression: '/carts', source: { filePath: 'design-from-intent', line: 0 }, confidence: 'high' } as any,
    ], []);
    expect(docs).toContain('# Cart API');
    expect(docs).toContain('shopping cart');
    expect(docs).toContain('POST');
    expect(docs).toContain('/carts');
  });
});

describe('MCP design_api_from_intent tool', () => {
  it('is registered in the generic tool registry', () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.designApiFromIntent);
    expect(handler).toBeDefined();
    expect(handler?.toolNames).toContain('design_api_from_intent');
  });

  it('throws a clear error when no AI provider is available', async () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.designApiFromIntent)!;
    const col = { id: 'col-1', name: 'api', items: [] } as any;
    const ctx = {
      tool: GENERIC_TOOL_NAMES.designApiFromIntent,
      args: { intent: 'shopping cart' },
      services: {
        collection: { saveCollection: async () => undefined },
        environmentConfig: {},
        testSuite: { updateSuite: async () => undefined },
        workspaceFolder: undefined,
        aiProvider: undefined,
      },
      runStore: {},
      callbacks: {},
      collections: [col],
    } as never;

    await expect(handler.handle(ctx as any)).rejects.toThrow(/AI provider/);
  });

  it('returns a full designed package when an AI provider is supplied', async () => {
    const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.designApiFromIntent)!;
    const col = { id: 'col-1', name: 'api', items: [] } as any;
    const saved: unknown[] = [];
    const ctx = {
      tool: GENERIC_TOOL_NAMES.designApiFromIntent,
      args: { intent: 'shopping cart', collectionName: 'Cart API' },
      services: {
        collection: {
          saveCollection: async (c: unknown) => { saved.push(c); },
          getCollection: (id: string) => saved.find((c: any) => c.id === id),
          getCollectionById: (id: string) => saved.find((c: any) => c.id === id),
          getCollectionByName: () => undefined,
          getCollectionVariables: async () => ({}),
          getCollectionVariableLocals: async () => ({}),
          listCollections: async () => saved,
        },
        environmentConfig: {
          setEnvironmentVariable: async () => undefined,
          getSelectedEnvironment: () => 'test',
          resolveVariables: (v: string) => v,
          getEnvironmentVariable: () => undefined,
        },
        testSuite: { updateSuite: async (s: unknown) => { saved.push({ __suite: s }); } },
        workspaceFolder: undefined,
        aiProvider: { complete: async () => JSON.stringify(DESIGNED_SPEC) },
      },
      runStore: {},
      callbacks: {},
      collections: [col],
    } as never;

    const result: any = await handler.handle(ctx as any);
    expect(result.collectionName).toBe('Cart API');
    expect(result.aiGenerated).toBe(true);
    expect(result.endpoints).toHaveLength(4);
    expect(result.suite.nodeCount).toBe(4);
    // No apply → no suite persisted.
    expect(result.applied).toEqual([]);
    expect(result.hint).toContain('apply');
  });
});
