/**
 * Collection and folder management tool handlers.
 */

import { GENERIC_TOOL_NAMES } from '../mcp-tool-schemas';
import type { CollectionItem } from '../../types/collection';
import { enumerateFolders, flattenRequests } from './helpers';
import {
  badRequest,
  findFolderById,
  resolveCollectionByLabel,
} from './helpers';
import type { McpToolHandler } from './types';

/**
 * Find a folder item by its slash-separated path (fallback when only the
 * folder path string is known — used by create_folder's parent resolution).
 */
function findFolderByPath(
  items: CollectionItem[],
  path: string
): { id: string } | undefined {
  for (const item of items) {
    if (item.type !== 'folder') continue;
    const folder = item as import('../../types/collection').CollectionFolderItem;
    if (folder.name === path || path.endsWith('/' + folder.name)) {
      return { id: folder.id };
    }
    const sub = findFolderByPath(folder.items ?? [], path);
    if (sub) return sub;
  }
  return undefined;
}

export const collectionHandlers: McpToolHandler[] = [
  {
    toolNames: [GENERIC_TOOL_NAMES.createCollection],
    async handle({ args, services }) {
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      if (!name) throw badRequest('"name" is required');
      const col = await services.collection.createCollection(name);
      return {
        id: col.id,
        name: col.name,
        created: true,
        hint: 'Collection is empty. Call create_folder to add folders, or create_request to add requests directly.',
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.renameCollection],
    async handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const newName = typeof args.newName === 'string' ? args.newName.trim() : '';
      if (!newName) throw badRequest('"newName" is required');
      await services.collection.renameCollection(col.id, newName);
      return { id: col.id, oldName: col.name, newName, renamed: true };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.deleteCollection],
    async handle({ args, services, collections }) {
      if (args.confirm !== true) throw badRequest('"confirm" must be true to delete a collection');
      const col = resolveCollectionByLabel(args.collection, collections);
      await services.collection.deleteCollection(col.id);
      return { deleted: true, collection: col.name };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.duplicateCollection],
    async handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const newName = typeof args.newName === 'string' ? args.newName.trim() : '';
      if (!newName) throw badRequest('"newName" is required');
      const dup = await services.collection.duplicateCollection(col.id, newName);
      return { id: dup.id, name: dup.name, duplicatedFrom: col.name };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.createFolder],
    async handle({ args, services, collections }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      if (!name) throw badRequest('"name" is required');
      // Resolve optional parent folder by path or id
      let parentId: string | undefined;
      if (typeof args.parentFolder === 'string' && args.parentFolder.trim()) {
        const pq = args.parentFolder.toLowerCase();
        const folders = enumerateFolders(col);
        const parent =
          flattenRequests(col).map((r) => r.folderPath) &&
          folders.find((f) => f.folderPath === args.parentFolder || f.folderPath.toLowerCase() === pq);
        if (parent) {
          // resolve folder id from path
          const foldersWithId = enumerateFolders(col);
          const matchedPath = foldersWithId.find(
            (f) => f.folderPath === args.parentFolder || f.folderPath.toLowerCase() === pq
          );
          if (matchedPath) {
            // find the folder item by path segment
            const flat = col.items;
            const folderItem = findFolderByPath(flat, matchedPath.folderPath);
            parentId = folderItem?.id;
          }
        }
      }
      const folder = await services.collection.createFolder({ collectionId: col.id, name, parentId });
      return { id: folder.id, name: folder.name, created: true, collection: col.name };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.deleteFolder],
    async handle({ args, services, collections }) {
      if (args.confirm !== true) throw badRequest('"confirm" must be true to delete a folder');
      const col = resolveCollectionByLabel(args.collection, collections);
      if (typeof args.folder !== 'string' || !args.folder.trim()) throw badRequest('"folder" is required');
      const fq = args.folder.toLowerCase();
      const folderMeta = enumerateFolders(col).find(
        (f) => f.folderPath === args.folder || f.folderPath.toLowerCase() === fq
      );
      if (!folderMeta) throw badRequest(`folder "${args.folder}" not found in collection "${col.name}"`);
      const folderItem = findFolderById(col.items, folderMeta.folderId);
      if (!folderItem) throw badRequest(`folder "${args.folder}" could not be resolved`);
      const requestsRemoved = folderMeta.requestCount;
      await services.collection.deleteFolder(col.id, folderItem.id);
      return { deleted: true, folder: folderMeta.folderPath, requestsRemoved };
    },
  },
];
