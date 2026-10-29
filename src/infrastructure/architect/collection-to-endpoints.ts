/**
 * API Architect — collection → discovered-endpoints adapter (L8).
 *
 * Converts a designed OpenAPI collection (created via the OpenAPI importer)
 * back into the discovery `DiscoveredApi` model so the Phase 2a test-suite /
 * flow / workflow generators can be reused unchanged. The design flow has no
 * source code, so provenance is the design itself (confidence 'high', the
 * design is the ground truth for the intended surface).
 */

import { Collection, CollectionFolderItem, CollectionRequestItem } from '../../types/collection';
import { RequestAuth } from '../../types/types';
import { DiscoveredApi, DiscoveredApiAuth, DiscoveredApiParameter, DiscoveredApiResponse } from '../api-discovery/types';

/** Strip the `{{baseUrl}}` prefix and convert `:param` → `{param}` so path
 *  expressions match the workflow-discovery conventions (e.g. `/users/{id}`). */
function toPathExpression(url: string): string {
  let path = url.replace(/^\{\{\w+\}\}/, '').replace(/^\//, '/');
  return path.replace(/:([a-zA-Z_]\w*)/g, '{$1}');
}

/** Map a stored request auth config to the discovery auth model. */
function toAuth(auth: RequestAuth | undefined): DiscoveredApiAuth | undefined {
  if (!auth || auth.type === 'none' || auth.type === 'inherit' || !auth.type) {
    return undefined;
  }
  const type: DiscoveredApiAuth['type'] =
    auth.type === 'bearer' ? 'jwt'
    : auth.type === 'apikey' ? 'apiKey'
    : auth.type;
  return { required: true, type };
}

/** Map stored path/query params to discovery parameters. */
function toParams(request: CollectionRequestItem): DiscoveredApiParameter[] {
  const out: DiscoveredApiParameter[] = [];
  for (const [name, value] of Object.entries(request.params ?? {})) {
    out.push({
      name,
      location: 'path',
      required: true,
      type: typeof value === 'string' ? 'string' : value.type,
    });
  }
  for (const q of request.query ?? []) {
    if (q.enabled === false) continue;
    out.push({
      name: q.key,
      location: 'query',
      type: q.type,
      required: q.required,
      description: q.description,
    });
  }
  return out;
}

/** Map stored response schemas to discovery responses. */
function toResponses(request: CollectionRequestItem): DiscoveredApiResponse[] {
  const responses: DiscoveredApiResponse[] = [];
  for (const [status, def] of Object.entries(request.responseSchema?.responses ?? {})) {
    responses.push({
      statusCode: Number(status),
      body: def.contentType && def.schema
        ? { type: def.contentType.split('/')[0], schema: def.schema as Record<string, unknown> }
        : def.schema
          ? { schema: def.schema as Record<string, unknown> }
          : undefined,
    });
  }
  return responses;
}

/** Walk a collection tree, mapping every request item to a DiscoveredApi. */
export function collectionToEndpoints(collection: Collection): DiscoveredApi[] {
  const endpoints: DiscoveredApi[] = [];
  const collectionAuth = toAuth(collection.auth);

  const visit = (items: Collection['items']): void => {
    for (const item of items) {
      if (item.type === 'folder') {
        const folder = item as CollectionFolderItem;
        visit(folder.items ?? []);
        continue;
      }
      const request = item as CollectionRequestItem;
      const pathExpression = toPathExpression(request.url);
      const requestAuth = toAuth(request.auth);
      // Global (collection-level) security applies unless the operation
      // explicitly opts out (request.auth.type === 'none').
      const auth =
        request.auth?.type === 'none' ? undefined
        : requestAuth ?? collectionAuth;
      endpoints.push({
        id: request.id,
        framework: 'unknown',
        method: request.method || 'GET',
        pathExpression,
        resolvedPath: pathExpression,
        confidence: 'high',
        source: {
          filePath: 'design-from-intent',
          line: 0,
          symbolName: request.name,
        },
        description: request.description,
        tags: request.tags,
        requestBody: request.bodySchema?.schema
          ? { type: 'json', schema: request.bodySchema.schema as Record<string, unknown> }
          : undefined,
        params: toParams(request),
        responses: toResponses(request),
        auth,
      });
    }
  };

  visit(collection.items);
  return endpoints;
}
