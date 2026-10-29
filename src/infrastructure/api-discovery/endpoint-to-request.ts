/**
 * Discovered endpoint → HTTP Forge request adapter.
 *
 * Pure helpers shared by the MCP discovery tools (`create_request_from_endpoint`,
 * `generate_test_suite`, `generate_workflow`) and the extension's Discovered
 * APIs view actions. Keeping them here (rather than inside the MCP handler)
 * lets every consumer reuse the exact same request-building rules.
 */

import type { CollectionRequestItem, CreateRequestOptions, KeyValueEntry } from '../../types/collection';
import type { RequestBody } from '../../types/types';
import type { DiscoveredApi } from './types';
import type { JsonSchema } from './types';

/**
 * Build a minimal JSON example from a JSON Schema (recursive).
 */
export function schemaToExample(schema: JsonSchema | undefined): unknown {
  if (!schema || typeof schema !== 'object') return null;
  const type = schema.type;

  if (type === 'object' || (schema.properties && !type)) {
    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    const example: Record<string, unknown> = {};
    for (const [name, propSchema] of Object.entries(properties)) {
      example[name] = schemaToExample(propSchema as JsonSchema);
    }
    return example;
  }
  if (type === 'array') {
    const items = schema.items as JsonSchema | undefined;
    return [schemaToExample(items)];
  }
  if (type === 'integer') return 0;
  if (type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'string') {
    if (schema.format === 'date-time') return '2024-01-01T00:00:00Z';
    if (schema.format === 'date') return '2024-01-01';
    if (schema.format === 'uuid') return '00000000-0000-0000-0000-000000000000';
    if (schema.format === 'binary') return '<file>';
    return 'string';
  }
  if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  return null;
}

/** Derive a request name from a discovered endpoint (source symbol, else method+path). */
export function endpointToName(endpoint: DiscoveredApi): string {
  const sourceName = endpoint.source?.symbolName || '';
  if (sourceName) return sourceName;
  return `${endpoint.method || 'GET'} ${endpoint.pathExpression}`;
}

/**
 * Convert a discovered endpoint into the request parts (headers, query, path
 * params, body) needed by `ICollectionService.createRequest`.
 *
 * - Header/query params become enabled key/value entries (sample values when
 *   `includeSampleData`).
 * - Path params get a concrete value so the request runs against a live server
 *   (e.g. `:id` → `1`).
 * - Bearer/JWT/basic auth becomes an `Authorization` header with a `{{TOKEN}}`
 *   / `{{BASIC_AUTH}}` placeholder.
 * - The discovered request body schema is rendered to a raw JSON body (or form
 *   entries for form/multipart).
 */
export function endpointToRequestParts(
  endpoint: DiscoveredApi,
  includeSampleData: boolean
): { headers: unknown[]; query: unknown[]; params: Record<string, string>; body: RequestBody | undefined } {
  const headers: unknown[] = [];
  const query: unknown[] = [];
  const params: Record<string, string> = {};

  for (const param of endpoint.params ?? []) {
    if (param.location === 'header') {
      headers.push({ name: param.name, value: includeSampleData ? (param.example ?? '') : '', enabled: true });
    } else if (param.location === 'query') {
      query.push({ name: param.name, value: includeSampleData ? (param.example ?? '') : '', enabled: true });
    } else if (param.location === 'path') {
      // Give the path param a concrete value so the request runs against a
      // live server (e.g. GET /api/users/:id with params: { id: 1 }).
      params[param.name] = param.type === 'integer' ? '1' : param.type === 'number' ? '1.0' : param.example ?? 'test';
    }
  }

  if (endpoint.auth?.type === 'bearer' || endpoint.auth?.type === 'jwt') {
    headers.push({ name: 'Authorization', value: 'Bearer {{TOKEN}}', enabled: true });
  } else if (endpoint.auth?.type === 'basic') {
    headers.push({ name: 'Authorization', value: 'Basic {{BASIC_AUTH}}', enabled: true });
  }

  const body = buildRequestBody(endpoint, includeSampleData);

  return { headers, query, params, body };
}

/** Build a `RequestBody` (raw JSON / form) from the endpoint's request body schema. */
function buildRequestBody(endpoint: DiscoveredApi, includeSampleData: boolean): RequestBody | undefined {
  const body = endpoint.requestBody;
  if (!body) return undefined;

  const bodyType = body.type ?? 'json';
  if (bodyType === 'json') {
    const schema = body.schema as JsonSchema | undefined;
    const example = includeSampleData && schema ? schemaToExample(schema) : undefined;
    return {
      type: 'raw',
      format: 'json',
      content: example ? JSON.stringify(example, null, 2) : '{}',
    };
  }

  if (bodyType === 'form' || bodyType === 'multipart') {
    const formParts = (endpoint.params ?? [])
      .filter((p) => p.location === 'form')
      .map((p) => ({ name: p.name, value: '' }));
    if (formParts.length === 0) return undefined;
    const isMultipart = bodyType === 'multipart';
    return {
      type: isMultipart ? 'form-data' : 'x-www-form-urlencoded',
      content: formParts.map((part) => ({
        key: part.name,
        value: part.value,
        type: 'text' as const,
        enabled: true,
      })),
    };
  }

  return { type: 'raw', format: 'text', content: '' };
}

/** Build the request description: endpoint description + provenance + framework/confidence. */
export function buildDescription(endpoint: DiscoveredApi): string {
  const lines: string[] = [];
  if (endpoint.description) lines.push(endpoint.description);
  if (endpoint.source?.filePath) {
    lines.push(`Discovered from ${endpoint.source.filePath}${endpoint.source.line ? `:${endpoint.source.line}` : ''}`);
  }
  lines.push(`Framework: ${endpoint.framework} | Confidence: ${endpoint.confidence}`);
  return lines.join('\n');
}

/** Build a `CreateRequestOptions` from a discovered endpoint. */
export function endpointToCreateRequestOptions(
  endpoint: DiscoveredApi,
  collectionId: string,
  baseUrl = ''
): CreateRequestOptions {
  const path = (endpoint.resolvedPath ?? endpoint.pathExpression).replace(/^\/+/, '');
  const url = baseUrl
    ? `${baseUrl.replace(/\/+$/, '')}/${path}`
    : (endpoint.resolvedPath ?? endpoint.pathExpression);
  const { headers, query, params, body } = endpointToRequestParts(endpoint, true);

  return {
    collectionId,
    name: endpointToName(endpoint),
    method: endpoint.method || 'GET',
    url,
    headers: headers as KeyValueEntry[],
    query: query as KeyValueEntry[],
    params,
    body,
    description: buildDescription(endpoint),
  };
}

/** The collection request item shape produced after `createRequest`. */
export type { CollectionRequestItem };
