/**
 * Request and script management tool handlers.
 */

import { GENERIC_TOOL_NAMES } from '../mcp-tool-schemas';
import type { CollectionFolderItem } from '../../types/collection';
import { enumerateFolders, flattenRequests } from './helpers';
import {
  badRequest,
  resolveCollectionByLabel,
  resolveRequestByLabel,
} from './helpers';
import type { McpToolHandler } from './types';

export const requestHandlers: McpToolHandler[] = [
  {
    toolNames: [GENERIC_TOOL_NAMES.createRequest],
    async handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      if (!name) throw badRequest('"name" is required');
      const method = (typeof args.method === 'string' ? args.method.toUpperCase() : 'GET') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
      const url = typeof args.url === 'string' ? args.url : '';
      if (!url) throw badRequest('"url" is required');
      // Resolve optional folder
      let parentId: string | undefined;
      if (typeof args.folder === 'string' && args.folder.trim()) {
        const fq = args.folder.toLowerCase();
        const folderMeta = enumerateFolders(col).find(
          (f) => f.folderPath === args.folder || f.folderPath.toLowerCase() === fq
        );
        if (folderMeta) {
          parentId = folderMeta.folderId;
        }
      }
      const opts: import('../../types/collection').CreateRequestOptions = {
        collectionId: col.id,
        parentId,
        name,
        method,
        url,
        headers: undefined,
        body: args.body ? { type: 'raw', format: 'json', content: String(args.body) } : undefined,
        description: typeof args.description === 'string' ? args.description : undefined,
      };
      const req = await services.collection.createRequest(opts);
      return {
        id: req.id,
        name: req.name,
        created: true,
        collection: col.name,
        hint: 'Request created. Call run_request to execute it, or set_request_script to add pre-request/post-response scripts.',
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.updateRequest],
    async handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const req = resolveRequestByLabel(args.request, col);
      const updates: Partial<import('../../types/collection').CollectionRequestItem> = {};
      if (typeof args.name === 'string') updates.name = args.name;
      if (typeof args.method === 'string') updates.method = args.method.toUpperCase() as any;
      if (typeof args.url === 'string') updates.url = args.url;
      if (args.headers && typeof args.headers === 'object' && !Array.isArray(args.headers)) {
        updates.headers = Object.entries(args.headers).map(([name, value]) => ({ name, value: String(value), enabled: true })) as any;
      }
      if (typeof args.body === 'string') updates.body = { type: 'raw', format: 'json', content: args.body };
      if (typeof args.description === 'string') updates.description = args.description;
      await services.collection.updateRequest(col.id, req.id, updates);
      return { updated: true, request: req.name };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.deleteRequest],
    async handle({ args, services, collections }) {
      if (args.confirm !== true) throw badRequest('"confirm" must be true to delete a request');
      const col = resolveCollectionByLabel(args.collection, collections);
      const req = resolveRequestByLabel(args.request, col);
      await services.collection.deleteRequest(col.id, req.id);
      return { deleted: true, request: req.name };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.getRequestScript],
    handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const req = resolveRequestByLabel(args.request, col);
      const phase = args.phase as 'pre-request' | 'post-response';
      if (phase !== 'pre-request' && phase !== 'post-response') throw badRequest('"phase" must be "pre-request" or "post-response"');
      const script = services.collection.getRequestScript(col.id, req.id, phase);
      return { collection: col.name, request: req.name, phase, script: script ?? '' };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.setRequestScript],
    async handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const req = resolveRequestByLabel(args.request, col);
      const phase = args.phase as 'pre-request' | 'post-response';
      if (phase !== 'pre-request' && phase !== 'post-response') throw badRequest('"phase" must be "pre-request" or "post-response"');
      if (typeof args.script !== 'string') throw badRequest('"script" is required');
      await services.collection.setRequestScript(col.id, req.id, phase, args.script);
      return { updated: true, collection: col.name, request: req.name, phase };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.reorderCollectionItems],
    async handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      if (!Array.isArray(args.order)) throw badRequest('"order" must be an array');
      let parentId: string | undefined;
      if (typeof args.folder === 'string' && args.folder.trim()) {
        const fq = args.folder.toLowerCase();
        const folderMeta = enumerateFolders(col).find(
          (f) => f.folderPath === args.folder || f.folderPath.toLowerCase() === fq
        );
        if (!folderMeta) throw badRequest(`folder "${args.folder}" not found in collection "${col.name}"`);
        parentId = folderMeta.folderId;
      }
      // Resolve order items — accept names or ids
      const allItems = parentId
        ? (col.items.find((i) => i.id === parentId) as CollectionFolderItem)?.items ?? []
        : col.items;
      const resolvedIds = (args.order as string[]).map((nameOrId) => {
        const item = allItems.find((i) => i.id === nameOrId || i.name === nameOrId);
        return item?.id ?? nameOrId;
      });
      await services.collection.reorderItems(col.id, parentId, resolvedIds);
      return { reordered: true, collection: col.name, order: args.order };
    },
  },
];
