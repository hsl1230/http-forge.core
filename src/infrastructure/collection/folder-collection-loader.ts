/**
 * Folder Collection Loader
 *
 * Thin adapter around FolderCollectionStore that converts between the
 * `Collection` / `CollectionItem` types (array-based headers/query with
 * `enabled` flag) and the simpler `UnifiedCollection` / `UnifiedRequest`
 * types (Record-based headers/query) used by ForgeContainer.
 *
 * All disk I/O is delegated to FolderCollectionStore — this class only
 * performs type conversion on the way in and out.
 */

import type { Collection, CollectionItem, CollectionRequestItem, ICollectionLoader } from '../../types/collection';
import type {
    CollectionAuth,
    CollectionScripts,
    KeyValueEntry,
    UnifiedCollection,
    UnifiedFolder,
    UnifiedRequest,
} from '../../types/types';
import type { CollectionMetadata } from './collection-store';
import { FolderCollectionStore } from './folder-collection-store';

// Re-export generateSlug from its canonical location for backward compatibility
export { generateSlug } from './folder-io';

// ════════════════════════════════════════════════════════════
// Type conversion helpers
// ════════════════════════════════════════════════════════════

type UnifiedItem = UnifiedFolder | UnifiedRequest;

/**
 * Convert KeyValueEntry[] (with `enabled` flag) to Record<string, string>.
 * Entries with `enabled: false` are excluded.
 */
function kvArrayToRecord(arr?: KeyValueEntry[]): Record<string, string> {
    if (!arr) return {};
    const record: Record<string, string> = {};
    for (const entry of arr) {
        if (entry.enabled !== false) {
            record[entry.key] = entry.value;
        }
    }
    return record;
}

/**
 * Convert Record<string, string> back to KeyValueEntry[] (all enabled).
 */
function recordToKvArray(record?: Record<string, string>): KeyValueEntry[] | undefined {
    if (!record || Object.keys(record).length === 0) return undefined;
    return Object.entries(record).map(([key, value]) => ({ key, value, enabled: true }));
}

/**
 * Convert a Collection (store type) → UnifiedCollection.
 */
function collectionToUnified(c: Collection, collectionPath: string): UnifiedCollection {
    return {
        id: c.id,
        name: c.name,
        description: c.description,
        variables: c.variables || {},
        auth: c.auth as unknown as CollectionAuth,
        scripts: c.scripts as CollectionScripts | undefined,
        items: (c.items || []).map(itemToUnified),
        source: {
            format: 'folder',
            filePath: collectionPath,
            version: c.version,
        },
    };
}

/**
 * Convert a CollectionItem → UnifiedFolder | UnifiedRequest.
 */
function itemToUnified(item: CollectionItem): UnifiedItem {
    if (item.type === 'folder') {
        return {
            type: 'folder',
            id: item.id,
            name: item.name,
            description: item.description,
            auth: item.auth as unknown as CollectionAuth,
            scripts: item.scripts as CollectionScripts | undefined,
            items: (item.items || []).map(itemToUnified),
        };
    }
    const req = item as CollectionRequestItem;
    return {
        type: 'request',
        id: req.id,
        name: req.name,
        description: req.description,
        requestType: req.requestType,
        method: req.method || 'GET',
        url: req.url || '',
        headers: req.headers || [],
        query: req.query || [],
        params: req.params as Record<string, string> | undefined,
        body: req.body ?? undefined,
        auth: req.auth as unknown as CollectionAuth,
        settings: req.settings,
        scripts: req.scripts as CollectionScripts | undefined,
        websocket: req.websocket,
        // Preserve extra fields that exist on disk but not in UnifiedRequest interface
        ...(req.deprecated && { deprecated: req.deprecated }),
        ...(req.doc && { doc: req.doc }),
        ...(req.responseSchema && { responseSchema: req.responseSchema }),
        ...(req.bodySchema && { bodySchema: req.bodySchema }),
        ...(req.operationId && { operationId: req.operationId }),
        ...(req.summary && { summary: req.summary }),
        ...(req.tags && req.tags.length > 0 && { tags: req.tags }),
        ...(req.examples && req.examples.length > 0 && { examples: req.examples }),
        ...(req.responses && Object.keys(req.responses).length > 0 && { responses: req.responses }),
        ...(req.security && req.security.length > 0 && { security: req.security }),
    } as UnifiedRequest;
}

/**
 * Convert a UnifiedCollection → Collection (store type).
 */
function unifiedToCollection(u: UnifiedCollection): Collection {
    return {
        id: u.id,
        name: u.name,
        description: u.description,
        version: u.source?.version,
        variables: u.variables,
        auth: u.auth as any,
        scripts: u.scripts,
        items: (u.items || []).map(unifiedItemToCollectionItem),
    };
}

/**
 * Convert a UnifiedItem → CollectionItem.
 */
function unifiedItemToCollectionItem(item: UnifiedItem): CollectionItem {
    if (item.type === 'folder') {
        return {
            type: 'folder',
            id: item.id,
            name: item.name,
            description: item.description,
            auth: item.auth as any,
            scripts: item.scripts,
            items: (item.items || []).map(unifiedItemToCollectionItem),
        };
    }
    return {
        type: 'request',
        id: item.id,
        name: item.name,
        description: item.description,
        requestType: item.requestType,
        method: item.method,
        url: item.url,
        headers: item.headers,
        query: item.query,
        params: item.params,
        body: item.body,
        auth: item.auth as any,
        settings: item.settings,
        scripts: item.scripts,
        websocket: item.websocket,
        ...((item as any).deprecated && { deprecated: (item as any).deprecated }),
        ...((item as any).doc && { doc: (item as any).doc }),
        ...((item as any).responseSchema && { responseSchema: (item as any).responseSchema }),
        ...((item as any).bodySchema && { bodySchema: (item as any).bodySchema }),
        ...((item as any).operationId && { operationId: (item as any).operationId }),
        ...((item as any).summary && { summary: (item as any).summary }),
        ...((item as any).tags && { tags: (item as any).tags }),
        ...((item as any).examples && { examples: (item as any).examples }),
        ...((item as any).responses && { responses: (item as any).responses }),
        ...((item as any).security && { security: (item as any).security }),
    } as CollectionRequestItem;
}

// ════════════════════════════════════════════════════════════
// FolderCollectionLoader — adapter over FolderCollectionStore
// ════════════════════════════════════════════════════════════

/**
 * Folder Collection Loader
 *
 * Implements `ICollectionLoader` and exposes CRUD using `UnifiedCollection` /
 * `UnifiedRequest` types. All disk I/O is handled by the underlying
 * `FolderCollectionStore`; this class converts types on the boundary.
 */
export class FolderCollectionLoader implements ICollectionLoader {
    /** The underlying canonical store that handles all disk I/O */
    private readonly store: FolderCollectionStore;

    constructor(collectionsDir: string) {
        this.store = new FolderCollectionStore(collectionsDir);
    }

    // ── ICollectionLoader ───────────────────────────────────

    loadAll(): UnifiedCollection[] {
        const collections = this.store.loadAll();
        return collections.map(c =>
            collectionToUnified(c, this.store.getCollectionPath(c.id))
        );
    }

    // ── Slug lookup (convenience) ───────────────────────────

    getSlugById(id: string): string | undefined {
        return this.store.getSlugById(id);
    }

    getIdBySlug(slug: string): string | undefined {
        return this.store.getIdBySlug(slug);
    }

    // ── Collection-level CRUD ───────────────────────────────

    load(id: string): UnifiedCollection | undefined {
        const c = this.store.load(id);
        if (!c) return undefined;
        return collectionToUnified(c, this.store.getCollectionPath(c.id));
    }

    async create(name: string, id?: string): Promise<UnifiedCollection> {
        const c = await this.store.create(name, id);
        return collectionToUnified(c, this.store.getCollectionPath(c.id));
    }

    async save(collection: UnifiedCollection): Promise<void> {
        return this.store.save(unifiedToCollection(collection));
    }

    async delete(id: string): Promise<boolean> {
        return this.store.delete(id);
    }

    exists(id: string): boolean {
        return this.store.exists(id);
    }

    getCollectionPath(id: string): string {
        return this.store.getCollectionPath(id);
    }

    async updateCollectionMetadata(collectionId: string, updates: Partial<CollectionMetadata>): Promise<void> {
        return this.store.updateCollectionMetadata(collectionId, updates);
    }

    // ── Item-level CRUD ─────────────────────────────────────

    async saveItem(collectionId: string, item: UnifiedItem, parentId?: string): Promise<void> {
        return this.store.saveItem(collectionId, unifiedItemToCollectionItem(item), parentId);
    }

    async updateItem(collectionId: string, itemId: string, updates: Partial<UnifiedItem>): Promise<boolean> {
        // Headers and query are already in KeyValueEntry[] format, pass through as-is
        const storeUpdates: Partial<CollectionItem> = { ...updates } as any;
        return this.store.updateItem(collectionId, itemId, storeUpdates);
    }

    async deleteItem(collectionId: string, itemId: string): Promise<boolean> {
        return this.store.deleteItem(collectionId, itemId);
    }

    async moveItem(collectionId: string, itemId: string, newParentId?: string): Promise<boolean> {
        return this.store.moveItem(collectionId, itemId, newParentId);
    }

    async reorderItems(collectionId: string, parentId: string | undefined, orderedItemIds: string[]): Promise<boolean> {
        return this.store.reorderItems(collectionId, parentId, orderedItemIds);
    }

    // ── Script-level CRUD ───────────────────────────────────

    async saveScripts(collectionId: string, itemId: string, scripts: CollectionScripts): Promise<void> {
        return this.store.saveScripts(collectionId, itemId, scripts);
    }

    loadScripts(collectionId: string, itemId: string): CollectionScripts | undefined {
        return this.store.loadScripts(collectionId, itemId);
    }
}
