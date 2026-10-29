/**
 * Reference Resolver
 *
 * Resolves user-supplied collection / folder / request references that may be
 * an id, a slug, or a display name. Resolution proceeds by tier in order
 * (id -> slug -> name) and stops at the first tier that yields a match.
 *
 * - id   : exact match against the immutable, canonical `id`.
 * - slug : `generateSlug(name)` computed with sibling-ordered de-duplication
 *          (mirrors the on-disk directory/file naming).
 * - name : case-insensitive match against the display `name`.
 *
 * A name (and, defensively, a slug) can match more than one sibling; when that
 * happens an {@link AmbiguousRefError} is thrown carrying the candidate list so
 * callers can present a clear disambiguation message instead of silently
 * picking one.
 *
 * Used by the direct-execution run APIs to let the CLI address things with a
 * single flag per concept.
 */

import { generateSlug } from '../infrastructure/collection/folder-io';
import type {
  Collection,
  CollectionFolderItem,
  CollectionItem,
  CollectionRequestItem,
} from '../types/collection';
import { encodeFolderName } from './mcp-collection-utils';

/** Tier that produced a successful match. */
export type RefTier = 'id' | 'slug' | 'name';

/** Kind of reference being resolved (used for messaging). */
export type RefKind = 'collection' | 'folder' | 'request';

/** A candidate item surfaced when a reference is ambiguous. */
export interface RefCandidate {
  id: string;
  name: string;
  /** Human-readable location (e.g. folder path) for disambiguation. */
  path: string;
}

/** Information about how a reference was resolved (for transparency/logging). */
export interface ResolutionInfo {
  kind: RefKind;
  value: string;
  tier: RefTier;
  id: string;
  path?: string;
}

/**
 * Thrown when a reference value matches multiple items within the same scope.
 */
export class AmbiguousRefError extends Error {
  constructor(
    public readonly kind: RefKind,
    public readonly value: string,
    public readonly candidates: RefCandidate[]
  ) {
    super(
      `Ambiguous ${kind} reference "${value}" matches ${candidates.length} items:\n` +
        candidates.map(c => `  - ${c.name} (id: ${c.id}, path: ${c.path || '/'})`).join('\n') +
        `\nDisambiguate by passing the id or slug.`
    );
    this.name = 'AmbiguousRefError';
  }
}

/** Compute slugs for a sibling group with on-disk-style de-duplication. */
function buildSlugMap(names: string[]): string[] {
  const existing: string[] = [];
  return names.map(name => {
    const slug = generateSlug(name, existing);
    existing.push(slug);
    return slug;
  });
}

/**
 * Resolve a single value against a flat sibling group by tier id -> slug -> name.
 * Returns the matched item and the tier that matched, or throws.
 */
function resolveAmong<T extends { id: string; name: string }>(
  items: T[],
  value: string,
  kind: RefKind,
  toPath: (item: T) => string
): { item: T; tier: RefTier } {
  // Tier 1: id (ids are unique, so first match wins).
  const byId = items.find(i => i.id === value);
  if (byId) {
    return { item: byId, tier: 'id' };
  }

  // Tier 2: slug (sibling de-duplication makes these unique within the group).
  const slugs = buildSlugMap(items.map(i => i.name));
  const slugMatches = items.filter((_, idx) => slugs[idx] === value);
  if (slugMatches.length === 1) {
    return { item: slugMatches[0], tier: 'slug' };
  }
  if (slugMatches.length > 1) {
    throw new AmbiguousRefError(kind, value, slugMatches.map(i => ({ id: i.id, name: i.name, path: toPath(i) })));
  }

  // Tier 3: name (case-insensitive; may match multiple).
  const lower = value.toLowerCase();
  const nameMatches = items.filter(i => i.name.toLowerCase() === lower);
  if (nameMatches.length === 1) {
    return { item: nameMatches[0], tier: 'name' };
  }
  if (nameMatches.length > 1) {
    throw new AmbiguousRefError(kind, value, nameMatches.map(i => ({ id: i.id, name: i.name, path: toPath(i) })));
  }

  throw new Error(`${kind.charAt(0).toUpperCase()}${kind.slice(1)} "${value}" not found`);
}

/**
 * Resolve a collection reference (id, slug, or name) among all collections.
 */
export function resolveCollectionRef(
  collections: Collection[],
  value: string
): { collection: Collection; tier: RefTier } {
  const { item, tier } = resolveAmong(collections, value, 'collection', () => '');
  return { collection: item, tier };
}

/**
 * Resolve a slash-separated folder reference into the folder-name path expected
 * by the collection runner. Each segment is resolved id -> slug -> name against
 * the folders at that level of the tree.
 *
 * @returns the resolved folder path (folder names joined by '/') and the tier
 *   that matched each segment.
 */
export function resolveFolderRef(
  collection: Collection,
  slashPath: string
): { folderPath: string; tiers: RefTier[] } {
  const segments = slashPath
    .split('/')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  let currentItems: CollectionItem[] = collection.items;
  const namePath: string[] = [];
  const tiers: RefTier[] = [];

  for (const segment of segments) {
    const folders = currentItems.filter(i => i.type === 'folder') as CollectionFolderItem[];
    const prefix = namePath.join('/');
    const { item, tier } = resolveAmong(folders, segment, 'folder', f =>
      prefix ? `${prefix}/${f.name}` : f.name
    );
    namePath.push(item.name);
    tiers.push(tier);
    currentItems = item.items ?? [];
  }

  return { folderPath: namePath.map(encodeFolderName).join('/'), tiers };
}

interface FlatRequest {
  item: CollectionRequestItem;
  folderPath: string;
  slug: string;
}

/**
 * Flatten all requests in a collection, computing each request's slug with
 * de-duplication scoped to its own parent folder's request siblings.
 */
function flattenRequests(
  items: CollectionItem[],
  folderPath: string,
  out: FlatRequest[]
): void {
  const existingSlugs: string[] = [];
  for (const item of items) {
    if (item.type === 'request') {
      const slug = generateSlug(item.name, existingSlugs);
      existingSlugs.push(slug);
      out.push({ item: item as CollectionRequestItem, folderPath, slug });
    }
  }
  for (const item of items) {
    if (item.type === 'folder') {
      const folder = item as CollectionFolderItem;
      const childPath = folderPath ? `${folderPath}/${encodeFolderName(folder.name)}` : encodeFolderName(folder.name);
      flattenRequests(folder.items ?? [], childPath, out);
    }
  }
}

/**
 * Resolve a request reference (id, slug, or name) to a request id.
 *
 * When `folderPath` (folder names joined by '/') is provided, the search is
 * scoped to that folder's subtree (recursively); otherwise the whole collection
 * is searched. Ambiguous matches throw {@link AmbiguousRefError}.
 */
export function resolveRequestRef(
  collection: Collection,
  value: string,
  folderPath?: string
): { request: CollectionRequestItem; tier: RefTier; folderPath: string } {
  const all: FlatRequest[] = [];
  flattenRequests(collection.items, '', all);

  const target = folderPath ? folderPath.replace(/\/+$/, '') : undefined;
  const scope = target
    ? all.filter(r => r.folderPath === target || r.folderPath.startsWith(`${target}/`))
    : all;

  const candidatePath = (r: FlatRequest): string =>
    r.folderPath ? `${r.folderPath}/${r.item.name}` : r.item.name;

  // Tier 1: id.
  const byId = scope.find(r => r.item.id === value);
  if (byId) {
    return { request: byId.item, tier: 'id', folderPath: byId.folderPath };
  }

  // Tier 2: slug.
  const slugMatches = scope.filter(r => r.slug === value);
  if (slugMatches.length === 1) {
    return { request: slugMatches[0].item, tier: 'slug', folderPath: slugMatches[0].folderPath };
  }
  if (slugMatches.length > 1) {
    throw new AmbiguousRefError(
      'request',
      value,
      slugMatches.map(r => ({ id: r.item.id, name: r.item.name, path: candidatePath(r) }))
    );
  }

  // Tier 3: name (case-insensitive).
  const lower = value.toLowerCase();
  const nameMatches = scope.filter(r => r.item.name.toLowerCase() === lower);
  if (nameMatches.length === 1) {
    return { request: nameMatches[0].item, tier: 'name', folderPath: nameMatches[0].folderPath };
  }
  if (nameMatches.length > 1) {
    throw new AmbiguousRefError(
      'request',
      value,
      nameMatches.map(r => ({ id: r.item.id, name: r.item.name, path: candidatePath(r) }))
    );
  }

  const scopeMsg = target ? ` under folder "${target}"` : '';
  throw new Error(`Request "${value}" not found in collection "${collection.name}"${scopeMsg}`);
}
