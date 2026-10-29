/**
 * Pure collection traversal helpers for direct execution.
 *
 * Walking a collection tree to find/flatten requests and resolving folder
 * paths into id-safe slugs. No side effects, no service dependencies.
 */

import type {
  Collection,
  CollectionFolderItem,
  CollectionItem,
  CollectionRequestItem,
} from '../types/collection';
import type { RequestAuth, RequestScripts } from '../types/types';
import { encodeFolderName } from './mcp-collection-utils';

export function findRequestInCollection(
  collection: Collection,
  requestId: string,
  items: CollectionItem[] = collection.items,
  folderChain: RequestScripts[] = [],
  authChain: RequestAuth[] = [],
  folderNameChain: string[] = []
): { request: CollectionRequestItem; folderScriptsChain: RequestScripts[]; folderAuthChain: RequestAuth[]; folderPath: string } | undefined {
  for (const item of items) {
    if (item.type === 'request' && item.id === requestId) {
      return {
        request: item as CollectionRequestItem,
        folderScriptsChain: [...folderChain],
        folderAuthChain: [...authChain],
        folderPath: folderNameChain.map(encodeFolderName).join('/')
      };
    }
    if (item.type === 'folder') {
      const folder = item as CollectionFolderItem;
      const next = folder.scripts ? [...folderChain, folder.scripts] : [...folderChain];
      const nextAuth = folder.auth ? [...authChain, folder.auth] : [...authChain];
      const nextNames = [...folderNameChain, folder.name];
      const found = findRequestInCollection(collection, requestId, folder.items ?? [], next, nextAuth, nextNames);
      if (found) return found;
    }
  }
  return undefined;
}

export function flattenCollection(
  collection: Collection,
  items: CollectionItem[] = collection.items,
  folderChain: RequestScripts[] = [],
  folderNameChain: string[] = []
): Array<{ request: CollectionRequestItem; folderScriptsChain: RequestScripts[]; folderPath: string }> {
  const result: Array<{ request: CollectionRequestItem; folderScriptsChain: RequestScripts[]; folderPath: string }> = [];
  for (const item of items) {
    if (item.type === 'request') {
      result.push({
        request: item as CollectionRequestItem,
        folderScriptsChain: [...folderChain],
        folderPath: folderNameChain.map(encodeFolderName).join('/')
      });
    } else {
      const folder = item as CollectionFolderItem;
      const next = folder.scripts ? [...folderChain, folder.scripts] : [...folderChain];
      const nextNames = [...folderNameChain, folder.name];
      result.push(...flattenCollection(collection, folder.items ?? [], next, nextNames));
    }
  }
  return result;
}

/**
 * Filter flattened collection requests to those under a folder path.
 *
 * @param flat - flattened requests with slash-separated `folderPath`
 * @param folderPath - target folder path (folder names joined by '/'); when
 *   omitted or empty, the input is returned unchanged
 * @param recursive - include requests in nested subfolders (default: true)
 */
export function filterByFolderPath<T extends { folderPath: string }>(
  flat: T[],
  folderPath?: string,
  recursive: boolean = true
): T[] {
  if (!folderPath) return flat;
  const target = folderPath.replace(/\/+$/, '');
  return flat.filter(({ folderPath: fp }) =>
    recursive ? fp === target || fp.startsWith(`${target}/`) : fp === target
  );
}

/** Convert a folder path into a filesystem/id-safe slug. */
export function slugifyFolderPath(folderPath: string): string {
  return folderPath
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
