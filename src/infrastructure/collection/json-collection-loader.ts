/**
 * JSON Collection Loader
 * 
 * Loads collections from single JSON files (legacy format)
 * Each collection is stored as a single .json file
 * 
 * For JSON format, all item-level operations fall back to saving the entire collection
 * since everything is in one file anyway.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Collection, CollectionFolderItem, CollectionItem, RequestScripts } from '../../types/collection';
import { generateId } from '../../utils/helpers';
import type { CollectionMetadata, ICollectionStore } from './collection-store';
import { deleteItemFromTree, findItemById } from './folder-io';

/**
 * Loads collections from JSON files
 * Format: collections/{collection-id}.json
 */
export class JsonCollectionLoader implements ICollectionStore {
    private collectionsDir: string;
    private cache: Map<string, Collection> = new Map();

    constructor(collectionsDir: string) {
        this.collectionsDir = collectionsDir;
        // Lazy — only create when first collection is saved
    }

    /**
     * Ensure collections directory exists (lazy)
     */
    private ensureDirectory(): void {
        if (!fs.existsSync(this.collectionsDir)) {
            fs.mkdirSync(this.collectionsDir, { recursive: true });
        }
    }

    /**
     * Load all collections from disk
     */
    loadAll(): Collection[] {
        this.cache.clear();

        if (!fs.existsSync(this.collectionsDir)) {
            return [];
        }

        const files = fs.readdirSync(this.collectionsDir);
        const collections: Collection[] = [];

        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const filePath = path.join(this.collectionsDir, file);
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const collection = JSON.parse(content) as Collection;

                    if (collection.id && collection.name) {
                        this.cache.set(collection.id, collection);
                        collections.push(collection);
                    }
                } catch (error) {
                    console.error(`[JsonCollectionLoader] Failed to load ${file}:`, error);
                }
            }
        }

        return collections;
    }

    /**
     * Load a single collection by ID
     */
    load(id: string): Collection | undefined {
        // Check cache first
        if (this.cache.has(id)) {
            return this.cache.get(id);
        }

        // Try to load from disk
        const filePath = this.getCollectionPath(id);
        if (!fs.existsSync(filePath)) {
            return undefined;
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const collection = JSON.parse(content) as Collection;
            this.cache.set(id, collection);
            return collection;
        } catch (error) {
            console.error(`[JsonCollectionLoader] Failed to load collection ${id}:`, error);
            return undefined;
        }
    }

    /**
     * Save a collection
     */
    async save(collection: Collection): Promise<void> {
        this.ensureDirectory();

        if (!collection.name) {
            throw new Error('Collection name is required');
        }

        if (!collection.id) {
            collection.id = generateId(collection.name);
        }

        const filePath = this.getCollectionPath(collection.id);
        const content = JSON.stringify(collection, null, 2);
        
        await fs.promises.writeFile(filePath, content, 'utf-8');
        this.cache.set(collection.id, collection);
    }

    /**
     * Delete a collection
     */
    async delete(id: string): Promise<boolean> {
        const filePath = this.getCollectionPath(id);
        
        if (!fs.existsSync(filePath)) {
            return false;
        }

        try {
            await fs.promises.unlink(filePath);
            this.cache.delete(id);
            return true;
        } catch (error) {
            console.error(`[JsonCollectionLoader] Failed to delete collection ${id}:`, error);
            return false;
        }
    }

    /**
     * Check if a collection exists
     */
    exists(id: string): boolean {
        return fs.existsSync(this.getCollectionPath(id));
    }

    /**
     * Get the file path for a collection
     */
    getCollectionPath(id: string): string {
        return path.join(this.collectionsDir, `${id}.json`);
    }

    /**
     * Get the disk path of an item within a collection
     * JSON format stores everything in one file, so items don't have individual paths
     */
    getItemPath(_collectionId: string, _itemId: string): string | undefined {
        return undefined;
    }

    /**
     * Create a new collection
     */
    async create(name: string, id?: string): Promise<Collection> {
        const collection: Collection = {
            id: id || generateId(name),
            name,
            items: []
        };

        await this.save(collection);
        return collection;
    }

    /**
     * Save scripts for a specific item
     * In JSON format, scripts are embedded in the collection JSON
     */
    async saveScripts(collectionId: string, itemId: string, scripts: RequestScripts): Promise<void> {
        const collection = this.load(collectionId);
        if (!collection) {
            throw new Error(`Collection ${collectionId} not found`);
        }

        const item = findItemById(collection.items, itemId);
        if (item) {
            item.scripts = scripts;
            await this.save(collection);
        }
    }

    /**
     * Load scripts for a specific item
     */
    loadScripts(collectionId: string, itemId: string): RequestScripts | undefined {
        const collection = this.load(collectionId);
        if (!collection) {
            return undefined;
        }

        const item = findItemById(collection.items, itemId);
        return item?.scripts;
    }

    // ==================== Item-level Operations ====================
    // For JSON format, these all fall back to save() since it's one file

    /**
     * Update collection metadata
     */
    async updateCollectionMetadata(collectionId: string, updates: Partial<CollectionMetadata>): Promise<void> {
        const collection = this.load(collectionId);
        if (!collection) {
            throw new Error(`Collection ${collectionId} not found`);
        }

        if (updates.name !== undefined) collection.name = updates.name;
        if (updates.description !== undefined) collection.description = updates.description;
        if (updates.version !== undefined) collection.version = updates.version;
        if (updates.variables !== undefined) collection.variables = updates.variables;
        if (updates.auth !== undefined) collection.auth = updates.auth;

        await this.save(collection);
    }

    /**
     * Save/update a single item
     * For JSON format: saves entire collection
     */
    async saveItem(collectionId: string, item: CollectionItem, parentId?: string): Promise<void> {
        const collection = this.load(collectionId);
        if (!collection) {
            throw new Error(`Collection ${collectionId} not found`);
        }

        // Check if item exists, update it; otherwise add it
        const existing = findItemById(collection.items, item.id);
        if (existing) {
            Object.assign(existing, item);
        } else {
            // Add new item
            if (parentId) {
                const parent = findItemById(collection.items, parentId);
                if (parent && parent.type === 'folder') {
                    parent.items = parent.items || [];
                    parent.items.push(item);
                } else {
                    throw new Error(`Parent folder ${parentId} not found`);
                }
            } else {
                collection.items.push(item);
            }
        }

        await this.save(collection);
    }

    /**
     * Delete a single item
     */
    async deleteItem(collectionId: string, itemId: string): Promise<boolean> {
        const collection = this.load(collectionId);
        if (!collection) {
            return false;
        }

        const deleted = deleteItemFromTree(collection.items, itemId);
        if (deleted) {
            await this.save(collection);
        }
        return deleted;
    }

    /**
     * Update a single item
     */
    async updateItem(collectionId: string, itemId: string, updates: Partial<CollectionItem>): Promise<boolean> {
        const collection = this.load(collectionId);
        if (!collection) {
            return false;
        }

        const item = findItemById(collection.items, itemId);
        if (!item) {
            return false;
        }

        // Apply updates (don't overwrite id or type)
        const { id, type, ...safeUpdates } = updates;
        Object.assign(item, safeUpdates);

        await this.save(collection);
        return true;
    }

    /**
     * Move an item to a new parent
     */
    async moveItem(collectionId: string, itemId: string, newParentId?: string): Promise<boolean> {
        const collection = this.load(collectionId);
        if (!collection) {
            return false;
        }

        // Find and remove the item from current location
        const item = findItemById(collection.items, itemId);
        if (!item) {
            return false;
        }

        // Clone the item before removing
        const itemClone = { ...item };
        if (!deleteItemFromTree(collection.items, itemId)) {
            return false;
        }

        // Add to new location
        if (newParentId) {
            const newParent = findItemById(collection.items, newParentId);
            if (newParent && newParent.type === 'folder') {
                newParent.items = newParent.items || [];
                newParent.items.push(itemClone);
            } else {
                // Rollback - add back to root
                collection.items.push(itemClone);
                return false;
            }
        } else {
            collection.items.push(itemClone);
        }

        await this.save(collection);
        return true;
    }

    /**
     * Reorder items within a parent (collection or folder)
     * For JSON format, just reorder the items array and save
     */
    async reorderItems(collectionId: string, parentId: string | undefined, orderedItemIds: string[]): Promise<boolean> {
        const collection = this.load(collectionId);
        if (!collection) {
            return false;
        }

        try {
            let items: CollectionItem[];
            if (parentId) {
                const folder = findItemById(collection.items, parentId) as CollectionFolderItem | undefined;
                if (!folder || !folder.items) {
                    return false;
                }
                items = folder.items;
            } else {
                items = collection.items;
            }

            // Create a map of items by ID
            const itemMap = new Map(items.map(item => [item.id, item]));
            const sorted: CollectionItem[] = [];

            // Add items in specified order
            for (const id of orderedItemIds) {
                const item = itemMap.get(id);
                if (item) {
                    sorted.push(item);
                    itemMap.delete(id);
                }
            }

            // Add remaining items not in order
            for (const item of itemMap.values()) {
                sorted.push(item);
            }

            // Update the items array
            if (parentId) {
                const folder = findItemById(collection.items, parentId) as CollectionFolderItem | undefined;
                if (folder) {
                    folder.items = sorted;
                }
            } else {
                collection.items = sorted;
            }

            await this.save(collection);
            return true;
        } catch (error) {
            console.error(`[JsonCollectionLoader] Failed to reorder items:`, error);
            return false;
        }
    }
}
