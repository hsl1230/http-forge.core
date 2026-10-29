/**
 * Collection Store Interface
 * 
 * Rich CRUD interface for collection storage operations.
 * Strategy Pattern: Different stores for different storage formats
 * - JsonCollectionLoader: Loads from single JSON files
 * - FolderCollectionStore: Loads from directory structure
 */

import type { Collection, CollectionItem, RequestScripts } from '../../types/collection';
import type { CollectionRequest } from '../../types/types';

/**
 * Rich interface for loading, saving, and managing collections
 */
export interface ICollectionStore {
    // ==================== Collection-level Operations ====================

    /**
     * Load all collections from storage
     */
    loadAll(): Collection[];

    /**
     * Load a single collection by ID
     */
    load(id: string): Collection | undefined;

    /**
     * Save an entire collection (use for bulk operations or JSON format)
     */
    save(collection: Collection): Promise<void>;

    /**
     * Delete a collection
     */
    delete(id: string): Promise<boolean>;

    /**
     * Check if a collection exists
     */
    exists(id: string): boolean;

    /**
     * Get the path for a collection
     */
    getCollectionPath(id: string): string;

    /**
     * Create a new collection with default structure
     */
    create(name: string, id?: string): Promise<Collection>;

    /**
     * Update collection metadata only (name, description, variables, auth)
     */
    updateCollectionMetadata(collectionId: string, updates: Partial<CollectionMetadata>): Promise<void>;

    // ==================== Item-level Operations (Folder format optimized) ====================

    /**
     * Save/update a single item (request or folder)
     * For folder format: only writes the specific item's files
     * For JSON format: falls back to save()
     */
    saveItem(collectionId: string, item: CollectionItem, parentId?: string): Promise<void>;

    /**
     * Delete a single item by ID
     */
    deleteItem(collectionId: string, itemId: string): Promise<boolean>;

    /**
     * Update a single item's metadata (not scripts)
     * For folder format: only updates request.json or folder.json
     */
    updateItem(collectionId: string, itemId: string, updates: Partial<CollectionItem>): Promise<boolean>;

    /**
     * Move an item to a new parent
     */
    moveItem(collectionId: string, itemId: string, newParentId?: string): Promise<boolean>;

    /**
     * Reorder items within a parent (collection or folder)
     * @param collectionId - The collection ID
     * @param parentId - The parent folder ID (undefined for collection root)
     * @param orderedItemIds - Array of item IDs in the desired order
     */
    reorderItems(collectionId: string, parentId: string | undefined, orderedItemIds: string[]): Promise<boolean>;

    // ==================== Script Operations ====================

    /**
     * Save scripts for a specific item
     */
    saveScripts(collectionId: string, itemId: string, scripts: RequestScripts): Promise<void>;

    /**
     * Load scripts for a specific item
     */
    loadScripts(collectionId: string, itemId: string): RequestScripts | undefined;

    /**
     * Get the disk path of an item (folder or request) within a collection
     */
    getItemPath(collectionId: string, itemId: string): string | undefined;

    /**
     * Load heavy request detail (body, scripts, schemas, doc) on demand.
     * Used to keep `loadAll()` light for tree view and defer I/O until a request is opened/executed.
     */
    loadRequestDetail?(collectionId: string, requestId: string): CollectionItem | undefined;

    /**
     * Load all collections in light mode (cheap metadata only, no body/scripts/schemas/doc).
     * Optimized for tree view and startup.
     */
    loadAllLight?(): Collection[];
}

/**
 * In-memory marker for requests loaded via `loadAllLight()`.
 * Never persisted to disk — set only on the in-memory item and cleared by
 * `loadRequestDetail()` once heavy fields are enriched (or enrichment is attempted).
 */
export interface LightLoadedRequest {
    _light?: boolean;
}

/** True when the item still needs on-demand heavy-field enrichment. */
export function isLightLoaded(item: CollectionItem): boolean {
    return (item as CollectionItem & LightLoadedRequest)._light === true;
}

/** Mark an item as fully loaded (enriched, or enrichment attempted). */
export function markDetailLoaded(item: CollectionItem): void {
    (item as CollectionItem & LightLoadedRequest)._light = false;
}

/**
 * Metadata stored in collection.json for folder format
 */
export interface CollectionMetadata {
    id: string;
    name: string;
    description?: string;
    version?: string;
    variables?: Record<string, string>;
    auth?: Collection['auth'];
    /** Order of child items (folder slugs). If not specified, filesystem order is used. */
    order?: string[];
}

/**
 * Metadata stored in folder.json
 */
export interface FolderMetadata {
    id: string;
    name: string;
    description?: string;
    auth?: Collection['auth'];
    /** Order of child items (folder slugs). If not specified, filesystem order is used. */
    order?: string[];
}

/**
 * Metadata stored in request.json (scripts stored separately in scripts/ directory)
 */
export type RequestMetadata = Omit<CollectionRequest, 'scripts'>;
