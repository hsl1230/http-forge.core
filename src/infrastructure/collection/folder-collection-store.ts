/**
 * Folder Collection Store
 * 
 * Loads and manages collections from directory structure using Collection types.
 * Implements the rich ICollectionStore interface with full CRUD operations.
 * 
 * Each collection is a folder containing:
 * - collection.json (metadata)
 * - scripts/ (pre-request.js, post-response.js)
 * - {folder-slug}/ (subfolders)
 * - {request-slug}/ (request folders)
 * 
 * Ported from the VS Code extension's FolderCollectionLoader.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Collection, CollectionFolderItem, CollectionItem, CollectionRequestItem, RequestScripts } from '../../types/collection';
import type { RequestBody } from '../../types/types';
import { generateId } from '../../utils/helpers';
import type { CollectionMetadata, FolderMetadata, ICollectionStore, RequestMetadata } from './collection-store';
import { isLightLoaded, markDetailLoaded } from './collection-store';
import { ensureAgentsMdFile } from './agents-md';
import {
    METADATA_FILES,
    SCHEMA_FILES,
    SCRIPTS_DIR,
    cleanupOldBodyFiles,
    deleteItemFromTree,
    findItemById,
    generateSlug,
    prepareBodyForSave,
    readBodyFromDir,
    readSchemaFile,
    readScriptsFromDir,
    searchForItemPath,
    searchForItemPathById,
    sortItemsByOrder,
    writeSchemaFiles,
    writeScriptsToDir,
} from './folder-io';

/** Public GitHub raw URLs so AI tools can resolve the schema outside the VS Code extension context. */
const SCHEMA_URLS = {
    collection: 'https://raw.githubusercontent.com/hsl1230/http-forge/main/resources/collection.schema.json',
    folder:     'https://raw.githubusercontent.com/hsl1230/http-forge/main/resources/folder.schema.json',
    request:    'https://raw.githubusercontent.com/hsl1230/http-forge/main/resources/request.schema.json',
} as const;

/**
 * Loads and manages collections from folder structure using Collection types.
 * 
 * Structure:
 * collections/
 *   {collection-slug}/
 *     collection.json
 *     scripts/
 *       pre-request.js
 *       post-response.js
 *     {folder-slug}/
 *       folder.json
 *       scripts/
 *       {request-slug}/
 *         request.json
 *         scripts/
 */
export class FolderCollectionStore implements ICollectionStore {
    private collectionsDir: string;
    private cache: Map<string, Collection> = new Map();
    private slugToIdMap: Map<string, string> = new Map();
    private idToSlugMap: Map<string, string> = new Map();
    /**
     * When true, `loadRequestFromDir` delegates to the light loader
     * (metadata only). Set only inside `loadAllLight()`; never left on.
     */
    private lightLoad = false;

    constructor(collectionsDir: string) {
        this.collectionsDir = collectionsDir;
        // Do not create directories eagerly — only when first collection/suite/env is saved.
        // This allows opening an empty workspace without polluting it with .http-forge.
    }

    // ==================== Slug Lookup ====================

    /**
     * Get collection/item slug from ID
     */
    getSlugById(id: string): string | undefined {
        return this.idToSlugMap.get(id);
    }

    /**
     * Get collection/item ID from slug
     */
    getIdBySlug(slug: string): string | undefined {
        return this.slugToIdMap.get(slug);
    }

    /**
     * Ensure collections directory exists, and write AGENTS.md to the forge root
     * (.http-forge/) on first initialisation so AI agents can discover the workspace
     * schema without needing MCP tools.
     * Only called when actually saving data, not on construction.
     */
    private ensureDirectory(): void {
        if (!fs.existsSync(this.collectionsDir)) {
            fs.mkdirSync(this.collectionsDir, { recursive: true });
        }
        this.ensureAgentsMd();
    }

    /**
     * Write .http-forge/AGENTS.md the first time a workspace is initialised.
     * Template ownership lives in `./agents-md` (versioned via
     * `AGENTS_MD_VERSION`). This stays write-once so user customizations are
     * never overwritten; stale guides are refreshed explicitly through
     * `refreshAgentsMd()` (extension command / CLI), which backs up the
     * previous file to `AGENTS.md.bak` first.
     *
     * collectionsDir = {forgeRoot}/collections  →  forgeRoot = parent dir
     * forgeRoot lives inside .http-forge/assets/ in the extension, so we walk
     * two levels up to land in .http-forge/.
     */
    private ensureAgentsMd(): void {
        const forgeDir = path.resolve(this.collectionsDir, '..', '..');
        try {
            ensureAgentsMdFile(forgeDir);
        } catch {
            // Non-fatal — the workspace still functions without the guide
        }
    }

    /**
     * Read and parse a JSON metadata file, tolerating transient partial/empty reads.
     *
     * While another process writes files (e.g. importing a collection), a file watcher may
     * trigger a load before the write completes, yielding empty or truncated content. Such
     * cases are transient and expected, so they are skipped silently. Genuinely malformed
     * (non-empty, complete) JSON is still reported.
     */
    private readJsonFileSafe<T>(filePath: string, context: string): T | undefined {
        let content: string;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        } catch (error) {
            console.error(`[FolderCollectionStore] Failed to read ${context} ${filePath}:`, error);
            return undefined;
        }

        if (content.trim().length === 0) {
            // Empty file — almost certainly a partial write in progress; skip silently.
            return undefined;
        }

        try {
            return JSON.parse(content) as T;
        } catch (error) {
            if (error instanceof SyntaxError && /Unexpected end of JSON input/.test(error.message)) {
                // Truncated content from an in-progress write; skip silently.
                return undefined;
            }
            console.error(`[FolderCollectionStore] Failed to parse ${context} ${filePath}:`, error);
            return undefined;
        }
    }

    /**
     * Load all collections from disk
     */
    loadAll(): Collection[] {
        this.cache.clear();
        this.slugToIdMap.clear();
        this.idToSlugMap.clear();

        if (!fs.existsSync(this.collectionsDir)) {
            return [];
        }

        const entries = fs.readdirSync(this.collectionsDir, { withFileTypes: true });
        const collections: Collection[] = [];

        for (const entry of entries) {
            if (entry.isDirectory()) {
                try {
                    const collection = this.loadCollectionFromFolder(entry.name);
                    if (collection) {
                        this.cache.set(collection.id, collection);
                        this.slugToIdMap.set(entry.name, collection.id);
                        this.idToSlugMap.set(collection.id, entry.name);
                        collections.push(collection);
                    }
                } catch (error) {
                    console.error(`[FolderCollectionStore] Failed to load ${entry.name}:`, error);
                }
            }
        }

        return collections;
    }

    /**
     * Load a collection from a folder
     */
    private loadCollectionFromFolder(slug: string): Collection | undefined {
        const collectionPath = path.join(this.collectionsDir, slug);
        const metadataPath = path.join(collectionPath, METADATA_FILES.collection);

        if (!fs.existsSync(metadataPath)) {
            return undefined;
        }

        const metadata = this.readJsonFileSafe<CollectionMetadata>(metadataPath, 'collection');
        if (!metadata) {
            return undefined;
        }

        try {
            // Load collection scripts
            const scripts = this.loadScriptsFromDir(path.join(collectionPath, SCRIPTS_DIR));

            // Load items (folders and requests), respecting order if specified
            const items = this.loadItemsFromDir(collectionPath, metadata.id, metadata.order);

            const collection: Collection = {
                id: metadata.id,
                name: metadata.name,
                description: metadata.description,
                version: metadata.version,
                variables: metadata.variables,
                auth: metadata.auth,
                scripts,
                items
            };

            return collection;
        } catch (error) {
            console.error(`[FolderCollectionStore] Failed to parse ${metadataPath}:`, error);
            return undefined;
        }
    }

    /**
     * Load items from a directory
     */
    private loadItemsFromDir(dirPath: string, parentId: string, order?: string[]): CollectionItem[] {
        const items: CollectionItem[] = [];
        const itemsBySlug: Map<string, CollectionItem> = new Map();
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name === SCRIPTS_DIR) {
                continue;
            }

            const itemPath = path.join(dirPath, entry.name);

            if (fs.existsSync(path.join(itemPath, METADATA_FILES.folder))) {
                const folder = this.loadFolderFromDir(itemPath, entry.name);
                if (folder) {
                    itemsBySlug.set(entry.name, folder);
                }
            } else if (fs.existsSync(path.join(itemPath, METADATA_FILES.request))) {
                const request = this.loadRequestFromDir(itemPath, entry.name);
                if (request) {
                    itemsBySlug.set(entry.name, request);
                }
            }
        }

        if (order && order.length > 0) {
            for (const slug of order) {
                const item = itemsBySlug.get(slug);
                if (item) {
                    items.push(item);
                    itemsBySlug.delete(slug);
                }
            }
            for (const item of itemsBySlug.values()) {
                items.push(item);
            }
        } else {
            for (const item of itemsBySlug.values()) {
                items.push(item);
            }
        }

        return items;
    }

    /**
     * Load a folder from directory
     */
    private loadFolderFromDir(folderPath: string, slug: string): CollectionItem | undefined {
        const metadataPath = path.join(folderPath, METADATA_FILES.folder);

        const metadata = this.readJsonFileSafe<FolderMetadata>(metadataPath, 'folder');
        if (!metadata) {
            return undefined;
        }

        try {
            const scripts = this.loadScriptsFromDir(path.join(folderPath, SCRIPTS_DIR));
            const items = this.loadItemsFromDir(folderPath, metadata.id, metadata.order);

            this.slugToIdMap.set(slug, metadata.id);
            this.idToSlugMap.set(metadata.id, slug);

            return {
                id: metadata.id,
                type: 'folder',
                name: metadata.name,
                description: metadata.description,
                auth: metadata.auth,
                scripts,
                items
            };
        } catch (error) {
            console.error(`[FolderCollectionStore] Failed to load folder ${folderPath}:`, error);
            return undefined;
        }
    }

    /**
     * Load a request from directory — light mode (cheap metadata only, no heavy I/O).
     * Used by `loadAllLight()` for tree view / startup optimization.
     */
    private loadRequestFromDirLight(requestPath: string, slug: string): CollectionItem | undefined {
        const metadataPath = path.join(requestPath, METADATA_FILES.request);
        const metadata = this.readJsonFileSafe<RequestMetadata>(metadataPath, 'request');
        if (!metadata) return undefined;
        try {
            this.slugToIdMap.set(slug, metadata.id);
            this.idToSlugMap.set(metadata.id, slug);
            return {
                id: metadata.id,
                type: 'request',
                name: metadata.name,
                description: metadata.description,
                requestType: metadata.requestType,
                method: metadata.method,
                url: metadata.url,
                params: metadata.params,
                query: metadata.query,
                headers: metadata.headers,
                body: metadata.body,
                bodyContentType: metadata.bodyContentType,
                auth: metadata.auth,
                settings: metadata.settings,
                websocket: metadata.websocket,
                disabled: metadata.disabled,
                deprecated: metadata.deprecated,
                operationId: metadata.operationId,
                summary: metadata.summary,
                tags: metadata.tags,
                examples: metadata.examples,
                responses: metadata.responses,
                security: metadata.security,
                // Marker for lazy heavy loading (in-memory only, never persisted)
                _light: true,
            } as CollectionItem;
        } catch (error) {
            console.error(`[FolderCollectionStore] Failed to load request (light) ${requestPath}:`, error);
            return undefined;
        }
    }

    /**
     * Load heavy request detail on demand (body, scripts, schemas, doc).
     * Populates the cached collection item in-place when found.
     * Idempotent: items that are already fully loaded are returned without disk I/O.
     */
    public loadRequestDetail(collectionId: string, requestId: string): CollectionItem | undefined {
        const light = this.findItemById(this.cache.get(collectionId)?.items || [], requestId) as CollectionRequestItem | undefined;
        if (light && !isLightLoaded(light)) {
            return light;
        }
        const itemPath = this.findItemPath(collectionId, requestId);
        if (!itemPath || !fs.existsSync(itemPath)) return light;
        const slug = this.idToSlugMap.get(requestId) || path.basename(itemPath);
        // Read heavy from disk
        const scripts = this.loadScriptsFromDir(path.join(itemPath, SCRIPTS_DIR));
        const loadedBody = this.loadBodyFromDir(itemPath);
        const responseSchema = this.loadSchemaFile(path.join(itemPath, SCHEMA_FILES.responseSchema));
        const bodySchema = this.loadSchemaFile(path.join(itemPath, SCHEMA_FILES.bodySchema));
        const docPath = path.join(itemPath, 'doc.md');
        const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf-8') : undefined;
        // If we have a cached light item, enrich it in-place
        if (light) {
            if (loadedBody) light.body = loadedBody;
            if (scripts) light.scripts = scripts;
            if (responseSchema) light.responseSchema = responseSchema;
            if (bodySchema) light.bodySchema = bodySchema;
            if (doc) light.doc = doc;
            markDetailLoaded(light);
            return light;
        }
        // Fallback: load full from disk (eager) if not in cache
        return this.loadRequestFromDir(itemPath, slug);
    }

    /**
     * Load all collections in light mode (no heavy I/O) — optimized for startup/tree view.
     */
    public loadAllLight(): Collection[] {
        this.lightLoad = true;
        try {
            return this.loadAll();
        } finally {
            this.lightLoad = false;
        }
    }

    /**
     * Load a request from directory
     *
     * Heavy fields are loaded eagerly here for backward compatibility (direct execution, tests).
     * For startup optimization, use `loadAllLight()` + `loadRequestDetail()` on demand.
     */
    private loadRequestFromDir(requestPath: string, slug: string): CollectionItem | undefined {
        if (this.lightLoad) {
            return this.loadRequestFromDirLight(requestPath, slug);
        }
        const metadataPath = path.join(requestPath, METADATA_FILES.request);

        const metadata = this.readJsonFileSafe<RequestMetadata>(metadataPath, 'request');
        if (!metadata) {
            return undefined;
        }

        try {
            const scripts = this.loadScriptsFromDir(path.join(requestPath, SCRIPTS_DIR));

            let body = metadata.body;
            const loadedBody = this.loadBodyFromDir(requestPath);
            if (loadedBody) {
                body = loadedBody;
            }

            const responseSchema = this.loadSchemaFile(path.join(requestPath, SCHEMA_FILES.responseSchema));
            const bodySchema = this.loadSchemaFile(path.join(requestPath, SCHEMA_FILES.bodySchema));

            // Load doc.md if present
            const docPath = path.join(requestPath, 'doc.md');
            const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf-8') : undefined;

            this.slugToIdMap.set(slug, metadata.id);
            this.idToSlugMap.set(metadata.id, slug);

            return {
                id: metadata.id,
                type: 'request',
                name: metadata.name,
                description: metadata.description,
                requestType: metadata.requestType,
                method: metadata.method,
                url: metadata.url,
                params: metadata.params,
                query: metadata.query,
                headers: metadata.headers,
                body,
                bodyContentType: metadata.bodyContentType,
                auth: metadata.auth,
                settings: metadata.settings,
                websocket: metadata.websocket,
                scripts,
                disabled: metadata.disabled,
                deprecated: metadata.deprecated,
                operationId: metadata.operationId,
                summary: metadata.summary,
                tags: metadata.tags,
                examples: metadata.examples,
                responses: metadata.responses,
                security: metadata.security,
                ...(doc && { doc }),
                ...(responseSchema && { responseSchema }),
                ...(bodySchema && { bodySchema })
            };
        } catch (error) {
            console.error(`[FolderCollectionStore] Failed to load request ${requestPath}:`, error);
            return undefined;
        }
    }

    /**
     * Load scripts from a scripts directory
     */
    private loadScriptsFromDir(scriptsPath: string): RequestScripts | undefined {
        return readScriptsFromDir(scriptsPath);
    }

    /**
     * Load body from external file if present
     */
    private loadBodyFromDir(requestPath: string): RequestBody | undefined {
        return readBodyFromDir(requestPath);
    }

    /**
     * Load a JSON schema file if it exists.
     */
    private loadSchemaFile(filePath: string): any | undefined {
        return readSchemaFile(filePath);
    }

    /**
     * Save OpenAPI schema files if present.
     */
    private async saveSchemaFiles(requestPath: string, request: CollectionRequestItem): Promise<void> {
        return writeSchemaFiles(requestPath, request.responseSchema, request.bodySchema);
    }

    /**
     * Load a single collection by ID
     */
    load(id: string): Collection | undefined {
        if (this.cache.has(id)) {
            return this.cache.get(id);
        }

        const slug = this.idToSlugMap.get(id);
        if (slug) {
            const collection = this.loadCollectionFromFolder(slug);
            if (collection) {
                this.cache.set(id, collection);
            }
            return collection;
        }

        this.loadAll();
        return this.cache.get(id);
    }

    /**
     * Save a collection
     */
    async save(collection: Collection): Promise<void> {
        this.ensureDirectory();

        if (!collection.name) {
            throw new Error('Collection name is required');
        }

        // Never persist light-loaded items without their heavy files.
        this.hydrateLightItems(collection.id, collection.items);

        if (!collection.id) {
            collection.id = generateId(collection.name);
        }

        let slug = this.idToSlugMap.get(collection.id);
        if (!slug) {
            const existingSlugs = fs.readdirSync(this.collectionsDir);
            slug = generateSlug(collection.name, existingSlugs);
            this.idToSlugMap.set(collection.id, slug);
            this.slugToIdMap.set(slug, collection.id);
        }

        const collectionPath = path.join(this.collectionsDir, slug);
        // When the collection directory does not yet exist (e.g. importing), the whole
        // subtree is brand new, so per-item stale-file cleanup probes can be skipped.
        const fresh = !fs.existsSync(collectionPath);
        await fs.promises.mkdir(collectionPath, { recursive: true });

        const metadata: CollectionMetadata = {
            id: collection.id,
            name: collection.name,
            description: collection.description,
            version: collection.version,
            variables: collection.variables,
            auth: collection.auth
        };

        // Write children (and scripts) first, then write collection.json once with the
        // resolved order. Sibling items are written concurrently; deeper levels recurse.
        const [orderedSlugs] = await Promise.all([
            this.saveItemsToDir(collectionPath, collection.items, fresh),
            collection.scripts
                ? this.saveScriptsToDir(path.join(collectionPath, SCRIPTS_DIR), collection.scripts)
                : Promise.resolve()
        ]);

        if (orderedSlugs.length > 0) {
            metadata.order = orderedSlugs;
        }
        const collectionJson = { $schema: SCHEMA_URLS.collection, ...metadata };
        await fs.promises.writeFile(
            path.join(collectionPath, METADATA_FILES.collection),
            JSON.stringify(collectionJson, null, 2),
            'utf-8'
        );
        this.cache.set(collection.id, collection);
    }

    /**
     * Save items to a directory
     */
    private async saveItemsToDir(parentPath: string, items: CollectionItem[], fresh = false): Promise<string[]> {
        const existingSlugs: string[] = [];
        const resolved: { item: CollectionItem; slug: string }[] = [];

        // Resolve slugs sequentially first so dedup is deterministic, then write concurrently.
        for (const item of items) {
            let slug = this.idToSlugMap.get(item.id);
            if (!slug) {
                slug = generateSlug(item.name, existingSlugs);
                this.idToSlugMap.set(item.id, slug);
                this.slugToIdMap.set(slug, item.id);
            }
            existingSlugs.push(slug);
            resolved.push({ item, slug });
        }

        await Promise.all(resolved.map(async ({ item, slug }) => {
            const itemPath = path.join(parentPath, slug);
            await fs.promises.mkdir(itemPath, { recursive: true });

            if (item.type === 'folder') {
                await this.saveFolderToDir(itemPath, item, fresh);
            } else {
                await this.saveRequestToDir(itemPath, item, fresh);
            }
        }));

        return existingSlugs;
    }

    /**
     * Save a folder to directory
     */
    private async saveFolderToDir(folderPath: string, folder: CollectionFolderItem, fresh = false): Promise<void> {
        const metadata: FolderMetadata = {
            id: folder.id,
            name: folder.name,
            description: folder.description,
            auth: folder.auth
        };

        // Write children (and scripts) first, then write folder.json once with the resolved
        // order, avoiding a redundant second write.
        const [orderedSlugs] = await Promise.all([
            folder.items ? this.saveItemsToDir(folderPath, folder.items, fresh) : Promise.resolve([] as string[]),
            folder.scripts
                ? this.saveScriptsToDir(path.join(folderPath, SCRIPTS_DIR), folder.scripts)
                : Promise.resolve()
        ]);

        if (orderedSlugs.length > 0) {
            metadata.order = orderedSlugs;
        }
        const folderJson = { $schema: SCHEMA_URLS.folder, ...metadata };
        await fs.promises.writeFile(
            path.join(folderPath, METADATA_FILES.folder),
            JSON.stringify(folderJson, null, 2),
            'utf-8'
        );
    }

    /**
     * Save a request to directory
     */
    private async saveRequestToDir(requestPath: string, request: CollectionRequestItem, fresh = false): Promise<void> {
        const { bodyForMetadata, externalBodyFile } = this.prepareBodyForSave(request.body);

        const metadata: RequestMetadata = {
            id: request.id,
            name: request.name,
            requestType: request.requestType,
            method: request.method || 'GET',
            url: request.url || '',
            description: request.description,
            params: request.params,
            query: request.query,
            headers: request.headers,
            body: bodyForMetadata,
            bodyContentType: request.bodyContentType,
            auth: request.auth,
            settings: request.settings,
            ...(request.websocket && { websocket: request.websocket }),
            ...(request.disabled !== undefined && { disabled: request.disabled }),
            ...(request.deprecated && { deprecated: request.deprecated }),
            ...(request.operationId && { operationId: request.operationId }),
            ...(request.summary && { summary: request.summary }),
            ...(request.tags && request.tags.length > 0 && { tags: request.tags }),
            ...(request.examples && request.examples.length > 0 && { examples: request.examples }),
            ...(request.responses && Object.keys(request.responses).length > 0 && { responses: request.responses }),
            ...(request.security && request.security.length > 0 && { security: request.security })
        };

        // These writes target distinct files, so run them concurrently.
        const writes: Promise<unknown>[] = [
            fs.promises.writeFile(
                path.join(requestPath, METADATA_FILES.request),
                JSON.stringify({ $schema: SCHEMA_URLS.request, ...metadata }, null, 2),
                'utf-8'
            )
        ];

        if (externalBodyFile) {
            writes.push(fs.promises.writeFile(
                path.join(requestPath, externalBodyFile.filename),
                externalBodyFile.content,
                'utf-8'
            ));
        }

        // On a fresh directory there are no stale files to remove, so skip the probes.
        if (!fresh) {
            writes.push(this.cleanupOldBodyFiles(requestPath, externalBodyFile?.filename));
        }
        if (!fresh || request.responseSchema || request.bodySchema) {
            writes.push(this.saveSchemaFiles(requestPath, request));
        }

        // Save doc.md if doc content is present
        if (request.doc) {
            writes.push(fs.promises.writeFile(
                path.join(requestPath, 'doc.md'),
                request.doc,
                'utf-8'
            ));
        }

        if (request.scripts) {
            writes.push(this.saveScriptsToDir(path.join(requestPath, SCRIPTS_DIR), request.scripts));
        }

        await Promise.all(writes);
    }

    /**
     * Prepare body for saving - determine what goes in metadata vs external file
     */
    private prepareBodyForSave(body: any): { bodyForMetadata: any; externalBodyFile?: { filename: string; content: string } } {
        return prepareBodyForSave(body);
    }

    /**
     * Clean up old body files that don't match current format
     */
    private async cleanupOldBodyFiles(requestPath: string, currentBodyFile?: string): Promise<void> {
        return cleanupOldBodyFiles(requestPath, currentBodyFile);
    }

    /**
     * Save scripts to a directory
     */
    private async saveScriptsToDir(scriptsPath: string, scripts: RequestScripts): Promise<void> {
        return writeScriptsToDir(scriptsPath, scripts);
    }

    /**
     * Delete a collection
     */
    async delete(id: string): Promise<boolean> {
        let slug = this.idToSlugMap.get(id);
        if (!slug) {
            this.loadAll();
            slug = this.idToSlugMap.get(id);
            if (!slug) {
                return false;
            }
        }

        const collectionPath = path.join(this.collectionsDir, slug);

        if (!fs.existsSync(collectionPath)) {
            return false;
        }

        try {
            await fs.promises.rm(collectionPath, { recursive: true, force: true });
            this.cache.delete(id);
            this.idToSlugMap.delete(id);
            this.slugToIdMap.delete(slug);
            return true;
        } catch (error) {
            console.error(`[FolderCollectionStore] Failed to delete collection ${id}:`, error);
            return false;
        }
    }

    /**
     * Check if a collection exists
     */
    exists(id: string): boolean {
        const slug = this.idToSlugMap.get(id);
        if (!slug) {
            return false;
        }
        return fs.existsSync(path.join(this.collectionsDir, slug, METADATA_FILES.collection));
    }

    /**
     * Get the path for a collection
     */
    getCollectionPath(id: string): string {
        const slug = this.idToSlugMap.get(id) || id;
        return path.join(this.collectionsDir, slug);
    }

    /**
     * Get the disk path of an item (folder or request) within a collection
     */
    getItemPath(collectionId: string, itemId: string): string | undefined {
        return this.findItemPath(collectionId, itemId);
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
     */
    async saveScripts(collectionId: string, itemId: string, scripts: RequestScripts): Promise<void> {
        const collection = this.load(collectionId);
        if (!collection) {
            throw new Error(`Collection ${collectionId} not found`);
        }

        const itemPath = this.findItemPath(collectionId, itemId);
        if (!itemPath) {
            throw new Error(`Item ${itemId} not found in collection ${collectionId}`);
        }

        await this.saveScriptsToDir(path.join(itemPath, SCRIPTS_DIR), scripts);

        const item = this.findItemById(collection.items, itemId);
        if (item) {
            item.scripts = scripts;
        }
    }

    /**
     * Load scripts for a specific item
     */
    loadScripts(collectionId: string, itemId: string): RequestScripts | undefined {
        const itemPath = this.findItemPath(collectionId, itemId);
        if (!itemPath) {
            return undefined;
        }

        return this.loadScriptsFromDir(path.join(itemPath, SCRIPTS_DIR));
    }

    // ==================== Item-level Operations ====================

    /**
     * Hydrate light-loaded requests in place before a disk write.
     * Saving a light item would otherwise persist metadata without its heavy
     * files (e.g. overwrite body.json with empty content). The cache holds the
     * same object references the service works with, so in-place enrichment
     * fixes both the write and any live readers.
     */
    private hydrateLightItems(collectionId: string, items?: CollectionItem[]): void {
        if (!items) return;
        for (const item of items) {
            if (item.type === 'request') {
                if (isLightLoaded(item)) {
                    this.loadRequestDetail(collectionId, item.id);
                }
            } else if (item.items) {
                this.hydrateLightItems(collectionId, item.items);
            }
        }
    }

    /**
     * Resolve the request to persist: a detached light copy carries no heavy
     * fields, so prefer the enriched cached item when available.
     */
    private resolveWritableRequest(collectionId: string, item: CollectionItem): CollectionItem {
        if (item.type === 'request' && isLightLoaded(item)) {
            const full = this.loadRequestDetail(collectionId, item.id);
            if (full) return full;
        }
        return item;
    }

    /**
     * Update collection metadata only
     */
    async updateCollectionMetadata(collectionId: string, updates: Partial<CollectionMetadata>): Promise<void> {
        const collection = this.load(collectionId);
        if (!collection) {
            throw new Error(`Collection ${collectionId} not found`);
        }

        const collectionSlug = this.idToSlugMap.get(collectionId);
        if (!collectionSlug) {
            throw new Error(`Collection slug not found for ${collectionId}`);
        }

        const collectionPath = path.join(this.collectionsDir, collectionSlug);
        const metadataPath = path.join(collectionPath, METADATA_FILES.collection);

        const currentContent = fs.readFileSync(metadataPath, 'utf-8');
        const currentMetadata = JSON.parse(currentContent) as CollectionMetadata;

        const newMetadata: CollectionMetadata = {
            ...currentMetadata,
            ...updates,
            id: collectionId
        };

        await fs.promises.writeFile(metadataPath, JSON.stringify(newMetadata, null, 2), 'utf-8');

        if (updates.name !== undefined) collection.name = updates.name;
        if (updates.description !== undefined) collection.description = updates.description;
        if (updates.version !== undefined) collection.version = updates.version;
        if (updates.variables !== undefined) collection.variables = updates.variables;
        if (updates.auth !== undefined) collection.auth = updates.auth;
    }

    /**
     * Save/update a single item
     */
    async saveItem(collectionId: string, item: CollectionItem, parentId?: string): Promise<void> {
        const collection = this.load(collectionId);
        if (!collection) {
            throw new Error(`Collection ${collectionId} not found`);
        }

        const collectionSlug = this.idToSlugMap.get(collectionId);
        if (!collectionSlug) {
            throw new Error(`Collection slug not found for ${collectionId}`);
        }

        let parentPath: string;
        if (parentId) {
            const parentItemPath = this.findItemPath(collectionId, parentId);
            if (!parentItemPath) {
                throw new Error(`Parent folder ${parentId} not found`);
            }
            parentPath = parentItemPath;
        } else {
            parentPath = path.join(this.collectionsDir, collectionSlug);
        }

        let itemSlug = this.idToSlugMap.get(item.id);
        if (!itemSlug) {
            const existingSlugs = fs.readdirSync(parentPath)
                .filter(f => fs.statSync(path.join(parentPath, f)).isDirectory() && f !== SCRIPTS_DIR);
            itemSlug = generateSlug(item.name, existingSlugs);
            this.idToSlugMap.set(item.id, itemSlug);
            this.slugToIdMap.set(itemSlug, item.id);
        }

        const itemPath = path.join(parentPath, itemSlug);
        await fs.promises.mkdir(itemPath, { recursive: true });

        // Never persist a light-loaded item without its heavy files.
        item = this.resolveWritableRequest(collectionId, item);
        if (item.type === 'folder') {
            await this.saveFolderToDir(itemPath, item);
        } else {
            await this.saveRequestToDir(itemPath, item);
        }

        const existingItem = this.findItemById(collection.items, item.id);
        if (existingItem) {
            Object.assign(existingItem, item);
        } else {
            if (parentId) {
                const parent = this.findItemById(collection.items, parentId);
                if (parent && parent.type === 'folder') {
                    parent.items = parent.items || [];
                    parent.items.push(item);
                }
            } else {
                collection.items.push(item);
            }
        }
    }

    /**
     * Delete a single item
     */
    async deleteItem(collectionId: string, itemId: string): Promise<boolean> {
        const collection = this.load(collectionId);
        if (!collection) {
            return false;
        }

        const itemPath = this.findItemPath(collectionId, itemId);
        if (!itemPath || !fs.existsSync(itemPath)) {
            return false;
        }

        try {
            await fs.promises.rm(itemPath, { recursive: true, force: true });

            this.deleteItemFromTree(collection.items, itemId);

            const itemSlug = this.idToSlugMap.get(itemId);
            if (itemSlug) {
                this.slugToIdMap.delete(itemSlug);
                this.idToSlugMap.delete(itemId);
            }

            return true;
        } catch (error) {
            console.error(`[FolderCollectionStore] Failed to delete item ${itemId}:`, error);
            return false;
        }
    }

    /**
     * Update a single item's metadata
     */
    async updateItem(collectionId: string, itemId: string, updates: Partial<CollectionItem>): Promise<boolean> {
        const collection = this.load(collectionId);
        if (!collection) {
            return false;
        }

        const itemPath = this.findItemPath(collectionId, itemId);
        if (!itemPath) {
            return false;
        }

        const item = this.findItemById(collection.items, itemId);
        if (!item) {
            return false;
        }

        // The cached item may be light-loaded: enrich before the full rewrite
        // below so heavy files survive a metadata-only update.
        if (item.type === 'request' && isLightLoaded(item)) {
            this.loadRequestDetail(collectionId, itemId);
        }

        const { id, type, items, ...safeUpdates } = updates as Record<string, unknown>;
        Object.assign(item, safeUpdates);

        if (item.type === 'folder') {
            await this.saveFolderToDir(itemPath, item as CollectionFolderItem);
        } else {
            await this.saveRequestToDir(itemPath, item as CollectionRequestItem);
        }

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

        const collectionSlug = this.idToSlugMap.get(collectionId);
        if (!collectionSlug) {
            return false;
        }

        const currentPath = this.findItemPath(collectionId, itemId);
        if (!currentPath || !fs.existsSync(currentPath)) {
            return false;
        }

        let newParentPath: string;
        if (newParentId) {
            const parentPath = this.findItemPath(collectionId, newParentId);
            if (!parentPath) {
                return false;
            }
            newParentPath = parentPath;
        } else {
            newParentPath = path.join(this.collectionsDir, collectionSlug);
        }

        const itemSlug = this.idToSlugMap.get(itemId);
        if (!itemSlug) {
            return false;
        }

        const newPath = path.join(newParentPath, itemSlug);

        if (fs.existsSync(newPath)) {
            return false;
        }

        try {
            await fs.promises.rename(currentPath, newPath);

            const item = this.findItemById(collection.items, itemId);
            if (item) {
                const itemClone = item.type === 'folder'
                    ? { ...item, items: item.items ? [...item.items] : [] }
                    : { ...item };
                this.deleteItemFromTree(collection.items, itemId);

                if (newParentId) {
                    const newParent = this.findItemById(collection.items, newParentId);
                    if (newParent && newParent.type === 'folder') {
                        newParent.items = newParent.items || [];
                        newParent.items.push(itemClone);
                    }
                } else {
                    collection.items.push(itemClone);
                }
            }

            return true;
        } catch (error) {
            console.error(`[FolderCollectionStore] Failed to move item ${itemId}:`, error);
            return false;
        }
    }

    /**
     * Reorder items within a parent
     */
    async reorderItems(collectionId: string, parentId: string | undefined, orderedItemIds: string[]): Promise<boolean> {
        const collection = this.load(collectionId);
        if (!collection) {
            return false;
        }

        const collectionSlug = this.idToSlugMap.get(collectionId);
        if (!collectionSlug) {
            return false;
        }

        const orderedSlugs: string[] = [];
        for (const itemId of orderedItemIds) {
            const slug = this.idToSlugMap.get(itemId);
            if (slug) {
                orderedSlugs.push(slug);
            }
        }

        try {
            if (parentId) {
                const folderPath = this.findItemPath(collectionId, parentId);
                if (!folderPath) {
                    return false;
                }
                const metadataPath = path.join(folderPath, METADATA_FILES.folder);
                const content = fs.readFileSync(metadataPath, 'utf-8');
                const metadata = JSON.parse(content) as FolderMetadata;
                metadata.order = orderedSlugs;
                await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

                const folder = this.findItemById(collection.items, parentId);
                if (folder && folder.type === 'folder' && folder.items) {
                    folder.items = this.sortItemsByOrder(folder.items, orderedItemIds);
                }
            } else {
                const metadataPath = path.join(this.collectionsDir, collectionSlug, METADATA_FILES.collection);
                const content = fs.readFileSync(metadataPath, 'utf-8');
                const metadata = JSON.parse(content) as CollectionMetadata;
                metadata.order = orderedSlugs;
                await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

                collection.items = this.sortItemsByOrder(collection.items, orderedItemIds);
            }

            return true;
        } catch (error) {
            console.error(`[FolderCollectionStore] Failed to reorder items:`, error);
            return false;
        }
    }

    /**
     * Sort items array by ID order
     */
    private sortItemsByOrder(items: CollectionItem[], orderedIds: string[]): CollectionItem[] {
        return sortItemsByOrder(items, orderedIds);
    }

    // ==================== Private Helpers ====================

    private findItemPath(collectionId: string, itemId: string): string | undefined {
        const collectionSlug = this.idToSlugMap.get(collectionId);
        if (!collectionSlug) {
            return undefined;
        }

        const collectionPath = path.join(this.collectionsDir, collectionSlug);

        // Ids are globally unique; slugs are de-duplicated only among siblings, so two items
        // with the same name in different folders share a leaf slug (e.g. "login"). Resolve by
        // id so that only the directory whose metadata id matches is ever updated, regardless
        // of slug collisions.
        const byId = searchForItemPathById(collectionPath, itemId);
        if (byId) {
            return byId;
        }

        // Fallback: build the full slug path (root → item) from the in-memory tree. Used when
        // the on-disk metadata is not yet readable (e.g. a brand-new item being created).
        const collection = this.load(collectionId);
        if (collection) {
            const slugPath = this.buildSlugPath(collection.items, itemId);
            if (slugPath) {
                return path.join(collectionPath, ...slugPath);
            }
        }

        // Last-resort fallback: leaf-slug tree search.
        const itemSlug = this.idToSlugMap.get(itemId);
        if (!itemSlug) {
            return undefined;
        }

        return searchForItemPath(collectionPath, itemSlug);
    }

    /**
     * Build the on-disk slug path (root → item) for the given item id by walking the
     * in-memory collection tree. Each segment is resolved via idToSlugMap so it matches
     * the folder names produced during save. Returns undefined if the item is not found
     * or any ancestor lacks a known slug.
     */
    private buildSlugPath(items: CollectionItem[], targetId: string): string[] | undefined {
        for (const item of items) {
            const slug = this.idToSlugMap.get(item.id);
            if (!slug) {
                continue;
            }
            if (item.id === targetId) {
                return [slug];
            }
            if (item.type === 'folder' && item.items) {
                const childPath = this.buildSlugPath(item.items, targetId);
                if (childPath) {
                    return [slug, ...childPath];
                }
            }
        }
        return undefined;
    }

    private findItemById(items: CollectionItem[], id: string): CollectionItem | undefined {
        return findItemById(items, id);
    }

    private deleteItemFromTree(items: CollectionItem[], id: string): boolean {
        return deleteItemFromTree(items, id);
    }
}
