/**
 * Collection traversal utilities shared by the MCP tool-list builder and the
 * generic tool dispatcher.
 *
 * Imported by both the embedded core runtime and the VS Code extension via
 * @http-forge/core, so keeping this module free of Node.js platform
 * dependencies is important.
 */

import type {
  Collection,
  CollectionFolderItem,
  CollectionItem,
  CollectionRequestItem,
} from '../types/collection';

export interface FlatRequest {
  request: CollectionRequestItem;
  folderPath: string;
}

/**
 * Encode a single folder name segment so that '/' within the name is
 * unambiguous from the '/' path separator used in folderPath strings.
 * Only '/' is encoded; all other characters are left as-is.
 */
export function encodeFolderName(name: string): string {
  return name.replace(/\//g, '%2F');
}

/**
 * Decode a single folder name segment back to its display form.
 */
export function decodeFolderName(name: string): string {
  return name.replace(/%2F/gi, '/');
}

/**
 * Convert an internal folderPath (segments joined by '/', with '/' inside
 * names encoded as '%2F') to a human-readable display string.
 * E.g. "agl-page-composition/TRAY%2FEPG/AVS5-5303 - TRAY%2FEPG"
 *   → "agl-page-composition / TRAY/EPG / AVS5-5303 - TRAY/EPG"
 */
export function decodeFolderPath(folderPath: string): string {
  if (!folderPath) return '';
  return folderPath.split('/').map(decodeFolderName).join(' / ');
}

/**
 * Convert a user-supplied folder input to an internal folderPath.
 * Accepts both the display form ("A / B/C / D" with ' / ' separators)
 * and the raw form ("A/B/C"). In the raw form, each slash that matches a
 * known separator boundary is kept; slashes within a segment are encoded.
 * The simplest reliable approach: if ' / ' is present, treat it as the
 * separator; otherwise encode all '/' as '%2F' (treating the whole input
 * as a single folder name or leaf to match by inclusion).
 */
export function normalizeFolderInput(input: string): string {
  if (input.includes(' / ')) {
    return input.split(' / ').map(s => encodeFolderName(s.trim())).join('/');
  }
  // Encode '/' so substring matching works correctly against internal paths
  return encodeFolderName(input);
}

/** Flatten all requests in a collection into a list with their folder paths. */
export function flattenRequests(
  collection: Collection,
  items: CollectionItem[] = collection.items,
  folderPath = ''
): FlatRequest[] {
  const result: FlatRequest[] = [];
  for (const item of items) {
    if (item.type === 'request') {
      result.push({ request: item as CollectionRequestItem, folderPath });
    } else {
      const folder = item as CollectionFolderItem;
      const encoded = encodeFolderName(folder.name);
      const next = folderPath ? `${folderPath}/${encoded}` : encoded;
      result.push(...flattenRequests(collection, folder.items ?? [], next));
    }
  }
  return result;
}

/** Enumerate every folder path in a collection along with its id and recursive request count. */
export function enumerateFolders(
  collection: Collection,
  items: CollectionItem[] = collection.items,
  prefix = ''
): Array<{ folderId: string; folderPath: string; requestCount: number }> {
  const result: Array<{ folderId: string; folderPath: string; requestCount: number }> = [];
  for (const item of items) {
    if (item.type === 'folder') {
      const folder = item as CollectionFolderItem;
      const encoded = encodeFolderName(folder.name);
      const folderPath = prefix ? `${prefix}/${encoded}` : encoded;
      result.push({ folderId: folder.id, folderPath, requestCount: countRequests(folder.items ?? []) });
      result.push(...enumerateFolders(collection, folder.items ?? [], folderPath));
    }
  }
  return result;
}

/** Recursively count request items in an item list. */
export function countRequests(items: CollectionItem[]): number {
  let n = 0;
  for (const item of items) {
    if (item.type === 'request') {
      n++;
    } else {
      n += countRequests((item as CollectionFolderItem).items ?? []);
    }
  }
  return n;
}
