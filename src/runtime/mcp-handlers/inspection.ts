/**
 * Inspection tool handlers — list/search/read collections, folders, requests.
 */

import { GENERIC_TOOL_NAMES } from '../mcp-tool-schemas';
import {
  badRequest,
  decodeFolderPath,
  enumerateFolders,
  flattenRequests,
  hydrateRequest,
  resolveCollectionByLabel,
  resolveRequestByLabel,
} from './helpers';
import type { McpToolHandler } from './types';

export const inspectionHandlers: McpToolHandler[] = [
  {
    toolNames: [GENERIC_TOOL_NAMES.listCollections],
    handle({ collections }) {
      return {
        collections: collections.map((c) => ({
          name: c.name,
          id: c.id,
          description: c.description ?? '',
          requestCount: flattenRequests(c).length,
        })),
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.listFolders],
    handle({ args, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      return {
        collection: col.name,
        folders: enumerateFolders(col).map(({ folderPath, requestCount }) => ({
          path: decodeFolderPath(folderPath),
          requestCount,
        })),
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.listRequests],
    handle({ args, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const folderFilter =
        typeof args.folder === 'string' ? args.folder.toLowerCase() : undefined;
      const offset = typeof args.offset === 'number' ? Math.max(0, args.offset) : 0;
      const limit =
        typeof args.limit === 'number' ? Math.min(200, Math.max(1, args.limit)) : 50;
      const all = flattenRequests(col)
        .filter(
          ({ folderPath }) =>
            !folderFilter || folderPath.toLowerCase().includes(folderFilter)
        )
        .map(({ request, folderPath }) => ({
          id: request.id,
          name: request.name,
          method: request.method,
          folder: decodeFolderPath(folderPath),
          description: request.description ?? '',
        }));
      return {
        collection: col.name,
        total: all.length,
        offset,
        limit,
        requests: all.slice(offset, offset + limit),
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.searchRequests],
    handle({ args, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const query =
        typeof args.query === 'string' ? args.query.toLowerCase().trim() : '';
      if (!query) throw badRequest('the "query" argument is required');
      const matches = flattenRequests(col)
        .filter(
          ({ request, folderPath }) =>
            request.name.toLowerCase().includes(query) ||
            (request.url ?? '').toLowerCase().includes(query) ||
            request.method.toLowerCase().includes(query) ||
            folderPath.toLowerCase().includes(query) ||
            (request.description ?? '').toLowerCase().includes(query)
        )
        .map(({ request, folderPath }) => ({
          id: request.id,
          name: request.name,
          method: request.method,
          url: request.url ?? '',
          folder: decodeFolderPath(folderPath),
          description: request.description ?? '',
        }));
      return {
        collection: col.name,
        query: args.query,
        total: matches.length,
        requests: matches,
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.getRequest],
    handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const req = hydrateRequest(services, col.id, resolveRequestByLabel(args.request, col));
      const preScript = services.collection.getRequestScript(col.id, req.id, 'pre-request') ?? '';
      const postScript = services.collection.getRequestScript(col.id, req.id, 'post-response') ?? '';
      return {
        id: req.id,
        name: req.name,
        method: req.method,
        url: req.url ?? '',
        description: req.description ?? '',
        headers: req.headers ?? [],
        body: req.body ?? null,
        auth: req.auth ?? null,
        scripts: {
          preRequest: preScript,
          postResponse: postScript,
        },
        hint: 'Use update_request to modify fields, set_request_script to modify scripts, or run_request to execute it.',
      };
    },
  },
];
