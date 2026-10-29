/**
 * Collection Service
 *
 * Service for managing HTTP Forge collections.
 * Platform-agnostic — uses IFileWatcherFactory instead of VS Code APIs.
 *
 * Refactored to use:
 * - ConfigService for configuration
 * - CollectionLoader for storage abstraction (supports folder and json formats)
 */

import type { Collection, CollectionItem, CollectionRequestItem, CreateRequestOptions, ICollectionService, KeyValueEntry, RequestScripts } from '../../types/collection';
import { IFileWatcher, IFileWatcherFactory } from '../../types/platform';
import type { BodyType, RequestSettings, ResponseSchemaDefinition } from '../../types/types';
import { generateId, sanitizeName } from '../../utils/helpers';
import { IConfigService } from '../config';
import { writeEnvFile, writeFolderItems, writeScriptFile } from '../import-export/rest-client-export';
import { CollectionLoaderFactory } from './collection-loader-factory';
import { ICollectionStore, isLightLoaded, markDetailLoaded } from './collection-store';
import { deleteItemFromTree, findItemById } from './folder-io';

import * as fs from 'fs';
import * as path from 'path';

/**
 * Detects the body type from content string.
 * Returns one of: 'json' | 'xml' | 'html' | 'javascript' | 'text'
 */
function detectBodyFormat(content: string): 'json' | 'xml' | 'html' | 'javascript' | 'text' {
    if (typeof content !== 'string') return 'text';
    const trimmed = content.trim();
    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null) return 'json';
    } catch {}
    if (/^<\?xml/.test(trimmed) || /^<([a-zA-Z_][\w\-\.]*)[\s>]/.test(trimmed)) {
        if (/^<\!DOCTYPE html>/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
            return 'html';
        }
        return 'xml';
    }
    if (/^<\!DOCTYPE html>/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
        return 'html';
    }
    if (/^(function\s*\(|\(\)\s*=>|const |let |var |export |import )/.test(trimmed)) {
        return 'javascript';
    }
    return 'text';
}

// --- Postman v2.1 Mapping ---
function toPostmanCollection(collection: Collection): any {
    return {
        info: {
            name: collection.name,
            _postman_id: collection.id,
            schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
        },
        item: collection.items.map(item => mapItem(item)),
        event: mapScripts(collection.scripts),
        variable: collection.variables
            ? Object.entries(collection.variables).map(([key, value]) => ({ key, value }))
            : []
    };
}

function mapItem(item: CollectionItem): any {
    if (item.type === 'folder') {
        return {
            name: item.name,
            item: item.items ? item.items.map(mapItem) : [],
            event: mapScripts(item.scripts)
        };
    } else if (item.type === 'request') {
        const req = item as CollectionRequestItem;
        return {
            name: req.name,
            request: {
                method: req.method,
                header: (req.headers || []).map(mapHeader),
                url: mapUrl(req),
                body: mapBody(req),
                auth: mapAuth(req.auth),
                description: req.description
            },
            event: mapScripts(req.scripts),
            protocolProfileBehavior: mapSettings(req.settings)
        };
    }
}

function mapHeader(header: KeyValueEntry) {
    return {
        key: header.key,
        value: header.value,
        disabled: header.enabled === false,
        ...(header.description !== undefined ? { description: header.description } : {}),
        ...(header.type !== undefined ? { type: header.type } : {}),
        ...(header.required !== undefined ? { required: header.required } : {}),
        ...(header.format !== undefined ? { format: header.format } : {}),
        ...(header.enum !== undefined ? { enum: header.enum } : {}),
        ...(header.deprecated !== undefined ? { deprecated: header.deprecated } : {}),
        ...(header.pattern !== undefined ? { pattern: header.pattern } : {}),
        ...(header.minLength !== undefined ? { minLength: header.minLength } : {}),
        ...(header.maxLength !== undefined ? { maxLength: header.maxLength } : {}),
        ...(header.minimum !== undefined ? { minimum: header.minimum } : {}),
        ...(header.maximum !== undefined ? { maximum: header.maximum } : {}),
        ...(header.exclusiveMinimum !== undefined ? { exclusiveMinimum: header.exclusiveMinimum } : {}),
        ...(header.exclusiveMaximum !== undefined ? { exclusiveMaximum: header.exclusiveMaximum } : {}),
        ...(header.multipleOf !== undefined ? { multipleOf: header.multipleOf } : {}),
        ...(header.minItems !== undefined ? { minItems: header.minItems } : {}),
        ...(header.maxItems !== undefined ? { maxItems: header.maxItems } : {}),
        ...(header.uniqueItems !== undefined ? { uniqueItems: header.uniqueItems } : {}),
        ...(header.nullable !== undefined ? { nullable: header.nullable } : {}),
        ...(header.oneOf !== undefined ? { oneOf: header.oneOf } : {})
    };
}

function mapUrl(req: CollectionRequestItem) {
    const raw = req.url;
    let urlNoProto = req.url.replace(/^[a-zA-Z]+:\/\//, '');
    let hostArr: string[] = [];
    const hostMatch = urlNoProto.match(/^([^\/\?]+)/);
    if (hostMatch) {
        const host = hostMatch[1];
        if (/^{{.*}}$/.test(host)) {
            hostArr = [host];
        } else {
            hostArr = host.split('.');
        }
    }
    let pathArr: string[] = [];
    const pathMatch = urlNoProto.match(/^[^\/\?]+(\/[^\?]*)?/);
    if (pathMatch && pathMatch[1] !== undefined) {
        let pathStr = pathMatch[1].replace(/^\//, '');
        if (pathStr.endsWith('/')) {
            pathArr = pathStr.slice(0, -1).split('/');
            pathArr.push('');
        } else {
            pathArr = pathStr.length > 0 ? pathStr.split('/') : [];
        }
    }
    let query: Record<string, unknown>[] | undefined = undefined;
    if (Array.isArray(req.query) && req.query.length > 0) {
        query = req.query.map((q: any) => {
            const qp: Record<string, unknown> = { key: q.key, value: q.value };
            if (q.enabled === false) qp.disabled = true;
            if (q.description !== undefined) qp.description = q.description;
            if (q.type !== undefined) qp.type = q.type;
            if (q.required !== undefined) qp.required = q.required;
            if (q.format !== undefined) qp.format = q.format;
            if (q.enum !== undefined) qp.enum = q.enum;
            if (q.deprecated !== undefined) qp.deprecated = q.deprecated;
            if (q.pattern !== undefined) qp.pattern = q.pattern;
            if (q.minLength !== undefined) qp.minLength = q.minLength;
            if (q.maxLength !== undefined) qp.maxLength = q.maxLength;
            if (q.minimum !== undefined) qp.minimum = q.minimum;
            if (q.maximum !== undefined) qp.maximum = q.maximum;
            if (q.exclusiveMinimum !== undefined) qp.exclusiveMinimum = q.exclusiveMinimum;
            if (q.exclusiveMaximum !== undefined) qp.exclusiveMaximum = q.exclusiveMaximum;
            if (q.multipleOf !== undefined) qp.multipleOf = q.multipleOf;
            if (q.minItems !== undefined) qp.minItems = q.minItems;
            if (q.maxItems !== undefined) qp.maxItems = q.maxItems;
            if (q.uniqueItems !== undefined) qp.uniqueItems = q.uniqueItems;
            if (q.nullable !== undefined) qp.nullable = q.nullable;
            if (q.oneOf !== undefined) qp.oneOf = q.oneOf;
            return qp;
        });
    } else {
        const queryIndex = urlNoProto.indexOf('?');
        if (queryIndex !== -1) {
            const queryString = urlNoProto.substring(queryIndex + 1);
            query = queryString.split('&').map(q => {
                const [key, ...rest] = q.split('=');
                return { key, value: rest.join('=') };
            });
        }
    }
    let variable: { key: string; value: string }[] | undefined = undefined;
    if (req.params && typeof req.params === 'object') {
        variable = Object.entries(req.params).map(([key, value]) => ({ key, value: String(value) }));
    }
    return {
        raw,
        host: hostArr.length > 0 ? hostArr : undefined,
        path: pathArr.length > 0 ? pathArr : undefined,
        query: query && query.length > 0 ? query : undefined,
        variable: variable && variable.length > 0 ? variable : undefined
    };
}

function mapBody(req: CollectionRequestItem) {
    if (!req.body) return undefined;
    const body = req.body as any;
    if (typeof body === 'string') {
        let format = detectBodyFormat(body);
        return {
            mode: 'raw',
            raw: body,
            options: { raw: { language: format } }
        };
    }
    if (body.type === 'raw') {
        const format = body.format || detectBodyFormat(body.content);
        return {
            mode: 'raw',
            raw: body.content,
            options: { raw: { language: format } }
        };
    }
    const formdataEntries = body.type === 'form-data' && Array.isArray(body.content)
        ? body.content
        : body.type === 'formdata' && Array.isArray(body.fields)
        ? body.fields
        : null;
    if (formdataEntries) {
        return {
            mode: 'formdata',
            formdata: formdataEntries.map((f: any) => ({
                key: f.key, value: f.value, type: f.type || 'text', disabled: f.enabled === false
            }))
        };
    }
    const urlencodedEntries = body.type === 'x-www-form-urlencoded' && Array.isArray(body.content)
        ? body.content
        : body.type === 'urlencoded' && Array.isArray(body.fields)
        ? body.fields
        : null;
    if (urlencodedEntries) {
        return {
            mode: 'urlencoded',
            urlencoded: urlencodedEntries.map((f: any) => ({
                key: f.key, value: f.value, disabled: f.enabled === false
            }))
        };
    }
    if (body.type === 'file' && body.fileName) {
        return { mode: 'file', file: { src: body.fileName } };
    }
    if (body.type === 'binary') {
        return { mode: 'binary', file: {} };
    }
    const graphqlContent = body.type === 'graphql'
        ? (body.content ?? (body.query ? body : null))
        : null;
    if (graphqlContent) {
        const q = graphqlContent.query ?? '';
        const vars = graphqlContent.variables;
        return {
            mode: 'graphql',
            graphql: {
                query: q,
                variables: vars ? (typeof vars === 'string' ? vars : JSON.stringify(vars)) : undefined
            }
        };
    }
    if (body.content) {
        return { mode: 'raw', raw: body.content };
    }
    return undefined;
}

function mapAuth(auth?: any) {
    if (!auth || !auth.type || auth.type === 'none') return undefined;
    if (auth.type === 'bearer') {
        return { type: 'bearer', bearer: [{ key: 'token', value: auth.bearerToken, type: 'string' }] };
    }
    if (auth.type === 'basic' && auth.basicAuth) {
        return {
            type: 'basic',
            basic: [
                { key: 'username', value: auth.basicAuth.username, type: 'string' },
                { key: 'password', value: auth.basicAuth.password, type: 'string' }
            ]
        };
    }
    return undefined;
}

function mapSettings(settings?: any): Record<string, any> | undefined {
    if (!settings) return undefined;
    const ppb: Record<string, any> = {};
    if (settings.followRedirects === false) ppb.followRedirects = false;
    if (settings.followOriginalMethod === true) ppb.followOriginalHttpMethod = true;
    if (settings.followAuthHeader === false) ppb.followAuthorizationHeader = false;
    if (settings.maxRedirects !== undefined) ppb.maxRedirects = settings.maxRedirects;
    if (settings.strictSSL === false) ppb.disableUrlEncoding = false;
    if (settings.timeout !== undefined) ppb.requestTimeout = settings.timeout;
    return Object.keys(ppb).length > 0 ? ppb : undefined;
}

function mapScripts(scripts?: any) {
    if (!scripts) return [];
    const events = [];
    if (scripts.preRequest) {
        events.push({ listen: "prerequest", script: { type: "text/javascript", exec: [scripts.preRequest] } });
    }
    if (scripts.postResponse) {
        events.push({ listen: "test", script: { type: "text/javascript", exec: [scripts.postResponse] } });
    }
    return events;
}

/**
 * Service for managing HTTP Forge collections
 */
export class CollectionService implements ICollectionService {
    private collectionsDir: string;
    private collections: Map<string, Collection> = new Map();
    private fileWatcher?: IFileWatcher;
    private loader: ICollectionStore;

    /** Debounce timer for coalescing rapid file-watcher change events */
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Set to true before any self-initiated write so that the resulting
     * file-watcher event skips the expensive full `loadAll()` reload —
     * the in-memory state was already updated by the write method itself.
     * The watcher callback still fires `onCollectionsChanged` so tree views
     * and panels are notified of the change.
     */
    private selfWritePending = false;

    /**
     * In-memory Local Values for collection variables (not persisted)
     */
    private localCollectionValues: Map<string, Record<string, string>> = new Map();

    /**
     * Callback invoked when collections are reloaded due to file system changes.
     * Set by the extension host to refresh tree views and panels.
     */
    public onCollectionsChanged?: () => void;

    constructor(
        private configService: IConfigService,
        private fileWatcherFactory?: IFileWatcherFactory
    ) {
        this.collectionsDir = configService.getCollectionsPath();
        this.loader = CollectionLoaderFactory.create(configService);
        // Do not create .http-forge/assets/collections eagerly — only when first collection is saved.
        this.loadCollections();
        this.setupFileWatcher();
    }

    private ensureCollectionsDir(): void {
        if (!fs.existsSync(this.collectionsDir)) {
            fs.mkdirSync(this.collectionsDir, { recursive: true });
        }
    }

    private loadCollections(): void {
        this.collections.clear();
        // Light mode keeps startup/tree-view cheap (metadata only, no
        // body/scripts/schemas/doc). Heavy fields load on demand via
        // findRequest()/getRequestDetail()/getRequestScript(). Stores without
        // lazy support (JSON format) fall back to full load.
        const loadedCollections = this.loader.loadAllLight?.() ?? this.loader.loadAll();
        for (const collection of loadedCollections) {
            this.collections.set(collection.id, collection);
        }
    }

    /**
     * Load heavy request detail on demand (body, scripts, schemas, doc).
     * No-op for stores without lazy support (e.g. JSON format) — falls back to `findRequest`.
     */
    public getRequestDetail(collectionId: string, requestId: string): CollectionRequestItem | undefined {
        const detail = this.loader.loadRequestDetail?.(collectionId, requestId);
        if (detail) return detail as CollectionRequestItem;
        return this.findRequest(collectionId, requestId);
    }

    private setupFileWatcher(): void {
        if (!this.fileWatcherFactory) {
            return;
        }
        this.fileWatcher = this.fileWatcherFactory.createFileWatcher(this.collectionsDir, '**/*');
        // Debounce: bulk operations (e.g. importing a collection) write many files in quick
        // succession. Reloading on every event re-scans the entire collections directory and
        // may read partially-written JSON. Coalesce the burst into a single reload once the
        // writes settle.
        const reloadAndNotify = () => {
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }
            this.debounceTimer = setTimeout(() => {
                this.debounceTimer = null;
                const wasSelf = this.selfWritePending;
                this.selfWritePending = false;
                if (!wasSelf) {
                    // External change (e.g. git pull, another process) — reload from disk.
                    this.loadCollections();
                }
                // Always notify UI so tree views and panels refresh with current state.
                this.onCollectionsChanged?.();
            }, 300);
        };
        this.fileWatcher.onDidChange(reloadAndNotify);
        this.fileWatcher.onDidCreate(reloadAndNotify);
        this.fileWatcher.onDidDelete(reloadAndNotify);
    }

    public getAllCollections(): Collection[] {
        return Array.from(this.collections.values());
    }

    public getCollection(id: string): Collection | undefined {
        return this.collections.get(id);
    }

    public getCollectionById(id: string): Collection | undefined {
        for (const collection of this.collections.values()) {
            if (collection.id === id) {
                return collection;
            }
        }
        return undefined;
    }

    public getCollectionByName(name: string): Collection | undefined {
        const lowerName = name.toLowerCase();
        for (const collection of this.collections.values()) {
            if (collection.name.toLowerCase() === lowerName) {
                return collection;
            }
        }
        return undefined;
    }

    public async saveCollection(collection: Collection): Promise<void> {
        this.ensureCollectionsDir();
        if (!collection.name) {
            throw new Error('Collection name is required');
        }
        if (!collection.id) {
            collection.id = generateId(collection.name);
        }
        this.selfWritePending = true;
        await this.loader.save(collection);
        this.collections.set(collection.id, collection);
    }

    // ========================================
    // Collection Variables
    // ========================================

    public getCollectionVariables(collectionId: string): Record<string, string> {
        const collection = this.collections.get(collectionId);
        return collection?.variables ? { ...collection.variables } : {};
    }

    public getCollectionVariableLocals(collectionId: string): Record<string, string> {
        return { ...(this.localCollectionValues.get(collectionId) || {}) };
    }

    public setCollectionVariable(collectionId: string, key: string, value: unknown): void {
        if (!this.localCollectionValues.has(collectionId)) {
            this.localCollectionValues.set(collectionId, {});
        }
        this.localCollectionValues.get(collectionId)![key] = String(value);
    }

    public deleteCollectionVariable(collectionId: string, key: string): void {
        const collectionVars = this.localCollectionValues.get(collectionId);
        if (collectionVars) {
            delete collectionVars[key];
        }
    }

    public clearCollectionVariables(collectionId: string): void {
        this.localCollectionValues.set(collectionId, {});
    }

    public async deleteCollection(id: string): Promise<boolean> {
        const collection = this.collections.get(id);
        if (!collection) {
            return false;
        }
        this.selfWritePending = true;
        const deleted = await this.loader.delete(id);
        if (deleted) {
            this.collections.delete(id);
        }
        return deleted;
    }

    public findRequest(collectionId: string, requestId: string): CollectionRequestItem | undefined {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            return undefined;
        }
        const found = this.findItemRecursive(collection.items, requestId) as CollectionRequestItem | undefined;
        if (!found) return undefined;
        // Enrich on demand, but ONLY for light-loaded items that haven't been
        // enriched yet. Fully-loaded items skip disk I/O entirely.
        if (isLightLoaded(found)) {
            const detail = this.loader.loadRequestDetail?.(collectionId, requestId) as CollectionRequestItem | undefined;
            markDetailLoaded(detail ?? found);
            if (detail) return detail;
        }
        return found;
    }

    public findRequestByPath(collectionId: string, requestPath: string): CollectionItem | undefined {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            return undefined;
        }
        const parts = requestPath.split('/').filter(p => p.trim());
        return this.findItemByPath(collection.items, parts);
    }

    public async updateRequest(
        collectionId: string,
        requestId: string,
        updates: Partial<CollectionRequestItem>
    ): Promise<boolean> {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            return false;
        }
        this.selfWritePending = true;
        const updated = await this.loader.updateItem(collectionId, requestId, updates);
        if (updated) {
            const item = this.findItemRecursive(collection.items, requestId);
            if (item) {
                const { id, type, ...safeUpdates } = updates;
                Object.assign(item, safeUpdates);
            }
        }
        return updated;
    }

    public async addRequest(
        collectionId: string,
        request: CollectionRequestItem,
        parentFolderId?: string
    ): Promise<boolean> {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            return false;
        }
        if (!request.id) {
            request.id = generateId(request.name);
        }
        this.selfWritePending = true;
        try {
            await this.loader.saveItem(collectionId, request, parentFolderId);
            return true;
        } catch (error) {
            console.error('[CollectionService] Failed to add request:', error);
            return false;
        }
    }

    public async deleteRequest(collectionId: string, requestId: string): Promise<boolean> {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            return false;
        }
        this.selfWritePending = true;
        const deleted = await this.loader.deleteItem(collectionId, requestId);
        if (deleted) {
            this.deleteItemRecursive(collection.items, requestId);
        }
        return deleted;
    }

    public getAllRequests(collectionId: string): CollectionItem[] {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            return [];
        }
        const requests: CollectionRequestItem[] = [];
        this.collectRequestsRecursive(collection.items, requests);
        return requests;
    }

    // --- Helper methods ---

    private findItemRecursive(items: CollectionItem[], id: string): CollectionItem | undefined {
        for (const item of items) {
            if (item.id === id) {
                return item;
            }
            if (item.type === 'folder' && item.items) {
                const found = this.findItemRecursive(item.items, id);
                if (found) return found;
            }
        }
        return undefined;
    }

    private findItemByPath(items: CollectionItem[], pathParts: string[]): CollectionItem | undefined {
        if (pathParts.length === 0) return undefined;
        const [current, ...rest] = pathParts;
        const item = items.find(i => i.name === current);
        if (!item) return undefined;
        if (rest.length === 0) {
            return item;
        }
        if (item.type === 'folder' && item.items) {
            return this.findItemByPath(item.items, rest);
        }
        return undefined;
    }

    private deleteItemRecursive(items: CollectionItem[], id: string): boolean {
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.id === id) {
                items.splice(i, 1);
                return true;
            }
            if (item.type === 'folder' && item.items) {
                if (this.deleteItemRecursive(item.items, id)) {
                    return true;
                }
            }
        }
        return false;
    }

    private collectRequestsRecursive(items: CollectionItem[], result: CollectionRequestItem[]): void {
        for (const item of items) {
            if (item.type === 'request') {
                result.push(item);
            } else if (item.type === 'folder' && item.items) {
                this.collectRequestsRecursive(item.items, result);
            }
        }
    }

    public async createCollection(name: string): Promise<Collection> {
        const collection: Collection = {
            id: generateId(name),
            name,
            items: []
        };
        await this.saveCollection(collection);
        return collection;
    }

    public async renameCollection(id: string, newName: string): Promise<boolean> {
        const collection = this.collections.get(id);
        if (!collection) {
            return false;
        }
        collection.name = newName;
        await this.saveCollection(collection);
        return true;
    }

    public async duplicateCollection(sourceId: string, newName: string): Promise<Collection> {
        const source = this.collections.get(sourceId);
        if (!source) {
            throw new Error(`Collection not found: ${sourceId}`);
        }
        this.selfWritePending = true;

        const newId = generateId(newName);
        const sourcePath = this.loader.getCollectionPath(sourceId);
        const targetPath = path.join(this.collectionsDir, newId);

        if (!fs.existsSync(sourcePath)) {
            throw new Error(`Collection directory not found: ${sourcePath}`);
        }

        // Copy entire collection directory
        this.copyDirRecursive(sourcePath, targetPath);

        // Overwrite collection.json with new ID and name
        const collectionJsonPath = path.join(targetPath, 'collection.json');
        if (fs.existsSync(collectionJsonPath)) {
            const metadata = JSON.parse(fs.readFileSync(collectionJsonPath, 'utf-8'));
            metadata.id = newId;
            metadata.name = newName;
            fs.writeFileSync(collectionJsonPath, JSON.stringify(metadata, null, 2));
        } else {
            // Fallback: create a minimal collection.json
            fs.writeFileSync(collectionJsonPath, JSON.stringify({ id: newId, name: newName }, null, 2));
        }

        // Reload all collections to pick up the new one
        this.loadCollections();

        const newCollection = this.collections.get(newId);
        if (!newCollection) {
            throw new Error('Failed to load duplicated collection');
        }
        return newCollection;
    }

    public async createFolder(options: { name: string; collectionId: string; parentId?: string }): Promise<CollectionItem> {
        const collection = this.collections.get(options.collectionId);
        if (!collection) {
            throw new Error('Collection not found');
        }
        this.selfWritePending = true;

        const folder: CollectionItem = {
            id: generateId(options.name),
            type: 'folder',
            name: options.name,
            items: []
        };

        await this.loader.saveItem(options.collectionId, folder, options.parentId);

        // Reload and sync the collection to prevent duplicates from file watcher
        const updatedCollection = this.loader.load(options.collectionId);
        if (updatedCollection) {
            this.collections.set(options.collectionId, updatedCollection);
        }

        return folder;
    }

    public async deleteFolder(collectionId: string, folderId: string): Promise<boolean> {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            return false;
        }
        this.selfWritePending = true;
        const deleted = await this.loader.deleteItem(collectionId, folderId);
        if (deleted) {
            deleteItemFromTree(collection.items, folderId);
        }
        return deleted;
    }

    public async renameFolder(collectionId: string, folderId: string, newName: string): Promise<boolean> {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            return false;
        }
        this.selfWritePending = true;
        const updated = await this.loader.updateItem(collectionId, folderId, { name: newName });
        if (updated) {
            const folder = findItemById(collection.items, folderId);
            if (folder) {
                folder.name = newName;
            }
        }
        return updated;
    }

    public async duplicateFolder(collectionId: string, folderId: string, newName: string): Promise<CollectionItem> {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            throw new Error('Collection not found');
        }

        const sourcePath = this.loader.getItemPath(collectionId, folderId);
        if (!sourcePath || !fs.existsSync(sourcePath)) {
            throw new Error(`Folder not found on disk: ${folderId}`);
        }

        // Determine parent directory (same parent as source folder)
        const parentDir = path.dirname(sourcePath);
        const newId = generateId(newName);
        const targetPath = path.join(parentDir, newId);

        // Copy entire folder directory recursively
        this.selfWritePending = true;
        this.copyDirRecursive(sourcePath, targetPath);

        // Overwrite folder.json with new ID and name
        const folderJsonPath = path.join(targetPath, 'folder.json');
        if (fs.existsSync(folderJsonPath)) {
            const metadata = JSON.parse(fs.readFileSync(folderJsonPath, 'utf-8'));
            metadata.id = newId;
            metadata.name = newName;
            fs.writeFileSync(folderJsonPath, JSON.stringify(metadata, null, 2));
        } else {
            fs.writeFileSync(folderJsonPath, JSON.stringify({ id: newId, name: newName, type: 'folder' }, null, 2));
        }

        // Reload all collections from disk to pick up the duplicated folder tree.
        // loader.load() returns a stale cached version; a full reload is needed to
        // reflect the copied subfolder/request structure.
        this.loadCollections();

        const updatedCollection = this.collections.get(collectionId);
        const newFolder = updatedCollection ? findItemById(updatedCollection.items, newId) : undefined;
        if (!newFolder) {
            // Return a minimal folder item if not found in tree
            return { id: newId, type: 'folder', name: newName, items: [] };
        }
        return newFolder;
    }

    public async createRequest(options: CreateRequestOptions): Promise<CollectionRequestItem> {
        const collection = this.collections.get(options.collectionId);
        if (!collection) {
            throw new Error('Collection not found');
        }
        this.selfWritePending = true;

        const request: CollectionRequestItem = {
            id: options.id || generateId(options.name),
            type: 'request',
            name: options.name,
            requestType: options.requestType,
            method: options.method || 'GET',
            url: options.url,
            params: options.params,
            query: options.query,
            headers: options.headers,
            body: options.body,
            auth: options.auth,
            settings: options.settings,
            websocket: options.websocket,
            scripts: options.scripts,
            deprecated: options.deprecated,
            description: options.description,
            doc: options.doc,
            responseSchema: options.responseSchema,
            bodySchema: options.bodySchema,
            operationId: options.operationId,
            summary: options.summary,
            tags: options.tags,
            examples: options.examples,
            responses: options.responses,
            security: options.security
        };

        await this.loader.saveItem(options.collectionId, request, options.parentId);

        // Reload and sync the collection to prevent duplicates from file watcher
        const updatedCollection = this.loader.load(options.collectionId);
        if (updatedCollection) {
            this.collections.set(options.collectionId, updatedCollection);
        }

        return request;
    }

    public async renameRequest(collectionId: string, requestId: string, newName: string): Promise<boolean> {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            return false;
        }
        this.selfWritePending = true;
        const updated = await this.loader.updateItem(collectionId, requestId, { name: newName });
        if (updated) {
            const request = findItemById(collection.items, requestId);
            if (request) {
                request.name = newName;
            }
        }
        return updated;
    }

    public async moveItem(collectionId: string, itemId: string, newParentId?: string): Promise<boolean> {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            return false;
        }
        this.selfWritePending = true;
        const moved = await this.loader.moveItem(collectionId, itemId, newParentId);
        if (moved) {
            this.loadCollections();
        }
        return moved;
    }

    public async reorderItems(collectionId: string, parentId: string | undefined, orderedItemIds: string[]): Promise<boolean> {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            return false;
        }
        this.selfWritePending = true;
        const reordered = await this.loader.reorderItems(collectionId, parentId, orderedItemIds);
        if (reordered) {
            this.loadCollections();
        }
        return reordered;
    }

    public getRequestScript(
        collectionId: string,
        requestId: string,
        phase: 'pre-request' | 'post-response'
    ): string | undefined {
        // Via findRequest so light-loaded items are enriched on demand.
        const req = this.findRequest(collectionId, requestId);
        if (!req) return undefined;
        return phase === 'pre-request' ? req.scripts?.preRequest : req.scripts?.postResponse;
    }

    public async setRequestScript(
        collectionId: string,
        requestId: string,
        phase: 'pre-request' | 'post-response',
        source: string
    ): Promise<boolean> {
        const collection = this.collections.get(collectionId);
        if (!collection) return false;
        const item = findItemById(collection.items, requestId);
        if (!item || item.type !== 'request') return false;
        const req = item as import('../../types/collection').CollectionRequestItem;
        const existing = req.scripts ?? {};
        const updated: import('../../types/collection').RequestScripts = {
            ...existing,
            ...(phase === 'pre-request' ? { preRequest: source } : { postResponse: source }),
        };
        req.scripts = updated;
        this.selfWritePending = true;
        try {
            await this.loader.saveScripts(collectionId, requestId, updated);
            return true;
        } catch {
            return false;
        }
    }

    private copyDirRecursive(src: string, dest: string): void {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                this.copyDirRecursive(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    public async importCollection(filePath: string): Promise<Collection> {
        const content = fs.readFileSync(filePath, 'utf-8');
        let data: any;

        try {
            data = JSON.parse(content);
        } catch {
            throw new Error('Invalid JSON file');
        }

        if (data.info && data.info._postman_id) {
            return this.importPostmanCollection(data);
        }

        const collection: Collection = {
            id: data.id || generateId(data.name || 'Imported Collection'),
            name: data.name || 'Imported Collection',
            description: data.description,
            items: data.items || []
        };

        await this.saveCollection(collection);
        return collection;
    }

    private async importPostmanCollection(data: any): Promise<Collection> {
        const convertAuth = (postmanAuth: any): any | undefined => {
            if (!postmanAuth) return undefined;

            const authType = postmanAuth.type?.toLowerCase();
            switch (authType) {
                case 'bearer':
                    const bearerToken = postmanAuth.bearer?.find((item: any) => item.key === 'token');
                    return { type: 'bearer', bearerToken: bearerToken?.value || '' };
                case 'basic':
                    const username = postmanAuth.basic?.find((item: any) => item.key === 'username');
                    const password = postmanAuth.basic?.find((item: any) => item.key === 'password');
                    return {
                        type: 'basic',
                        basicAuth: { username: username?.value || '', password: password?.value || '' }
                    };
                case 'apikey':
                    const key = postmanAuth.apikey?.find((item: any) => item.key === 'key');
                    const value = postmanAuth.apikey?.find((item: any) => item.key === 'value');
                    const inField = postmanAuth.apikey?.find((item: any) => item.key === 'in');
                    return {
                        type: 'apikey',
                        apikey: { key: key?.value || '', value: value?.value || '', in: inField?.value || 'header' }
                    };
                case 'noauth':
                    return { type: 'none' };
                default:
                    return undefined;
            }
        };

        const convertScripts = (events: any[]): RequestScripts | undefined => {
            if (!Array.isArray(events) || events.length === 0) return undefined;
            const scripts: RequestScripts = {};
            for (const event of events) {
                const script = event.script?.exec;
                if (!script) continue;
                const scriptContent = Array.isArray(script) ? script.join('\n') : script;
                if (event.listen === 'prerequest') {
                    scripts.preRequest = scriptContent;
                } else if (event.listen === 'test') {
                    scripts.postResponse = scriptContent;
                }
            }
            return (scripts.preRequest || scripts.postResponse) ? scripts : undefined;
        };

        const convertSettings = (ppb: any): RequestSettings | undefined => {
            if (!ppb || typeof ppb !== 'object') return undefined;
            const s: RequestSettings = {};
            if (ppb.followRedirects === false) s.followRedirects = false;
            if (ppb.followOriginalHttpMethod === true) s.followOriginalMethod = true;
            if (ppb.followAuthorizationHeader === false) s.followAuthHeader = false;
            if (ppb.maxRedirects !== undefined) s.maxRedirects = ppb.maxRedirects;
            if (ppb.requestTimeout !== undefined) s.timeout = ppb.requestTimeout;
            return Object.keys(s).length > 0 ? s : undefined;
        };

        const convertQuery = (urlObj: any): KeyValueEntry[] | undefined => {
            if (!urlObj || typeof urlObj === 'string') return undefined;
            const query = urlObj.query;
            if (!Array.isArray(query) || query.length === 0) return undefined;
            return query.map((q: any) => ({
                key: q.key || '',
                value: q.value || '',
                enabled: q.disabled !== true,
                ...(q.description !== undefined ? { description: q.description } : {}),
                ...(q.type !== undefined ? { type: q.type } : {}),
                ...(q.required !== undefined ? { required: q.required } : {}),
                ...(q.format !== undefined ? { format: q.format } : {}),
                ...(q.enum !== undefined ? { enum: q.enum } : {}),
                ...(q.deprecated !== undefined ? { deprecated: q.deprecated } : {}),
                ...(q.pattern !== undefined ? { pattern: q.pattern } : {}),
                ...(q.minLength !== undefined ? { minLength: q.minLength } : {}),
                ...(q.maxLength !== undefined ? { maxLength: q.maxLength } : {}),
                ...(q.minimum !== undefined ? { minimum: q.minimum } : {}),
                ...(q.maximum !== undefined ? { maximum: q.maximum } : {}),
                ...(q.exclusiveMinimum !== undefined ? { exclusiveMinimum: q.exclusiveMinimum } : {}),
                ...(q.exclusiveMaximum !== undefined ? { exclusiveMaximum: q.exclusiveMaximum } : {}),
                ...(q.multipleOf !== undefined ? { multipleOf: q.multipleOf } : {}),
                ...(q.minItems !== undefined ? { minItems: q.minItems } : {}),
                ...(q.maxItems !== undefined ? { maxItems: q.maxItems } : {}),
                ...(q.uniqueItems !== undefined ? { uniqueItems: q.uniqueItems } : {}),
                ...(q.nullable !== undefined ? { nullable: q.nullable } : {}),
                ...(q.oneOf !== undefined ? { oneOf: q.oneOf } : {})
            }));
        };

        const convertUrl = (urlObj: any): string => {
            if (typeof urlObj === 'string') {
                return urlObj;
            }
            if (!urlObj) return '';

            const variableKeys = new Set<string>();
            if (Array.isArray(urlObj.variable)) {
                for (const v of urlObj.variable) {
                    if (v.key) {
                        variableKeys.add(v.key);
                    }
                }
            }

            if (variableKeys.size === 0 && urlObj.raw) {
                return urlObj.raw;
            }

            let url = '';
            if (urlObj.protocol) {
                url += urlObj.protocol + '://';
            }
            if (urlObj.host) {
                url += Array.isArray(urlObj.host) ? urlObj.host.join('.') : urlObj.host;
            }
            if (urlObj.port) {
                url += ':' + urlObj.port;
            }
            if (urlObj.path) {
                const pathSegments = Array.isArray(urlObj.path) ? urlObj.path : [urlObj.path];
                const normalizedSegments = pathSegments.map((segment: string) => {
                    const cleanSegment = segment.startsWith(':') ? segment.substring(1) : segment;
                    if (variableKeys.has(cleanSegment)) {
                        return ':' + cleanSegment;
                    }
                    if (segment.startsWith(':')) {
                        return segment;
                    }
                    return segment;
                });
                url += '/' + normalizedSegments.join('/');
            }

            if (!url && urlObj.raw) {
                return urlObj.raw;
            }

            return url;
        };

        const convertExamples = (responses: any[]): ResponseSchemaDefinition | undefined => {
            if (!Array.isArray(responses) || responses.length === 0) return undefined;

            const result: ResponseSchemaDefinition = { responses: {} };

            for (const response of responses) {
                const statusCode = String(response.code || 200);

                let contentType: string | undefined;
                const mappedHeaders: Record<string, { description?: string; schema: { type: string } }> = {};
                if (Array.isArray(response.header)) {
                    for (const h of response.header) {
                        if (!h.key || h.disabled) continue;
                        if (h.key.toLowerCase() === 'content-type') {
                            contentType = (h.value as string)?.split(';')[0]?.trim();
                        } else {
                            mappedHeaders[h.key] = { description: String(h.value ?? ''), schema: { type: 'string' } };
                        }
                    }
                }

                let bodyValue: any = response.body;
                if (typeof response.body === 'string' && response.body) {
                    try { bodyValue = JSON.parse(response.body); } catch { /* keep as string */ }
                }

                const origReq = response.originalRequest;
                let summary: string | undefined;
                if (origReq) {
                    const rawUrl = typeof origReq.url === 'string'
                        ? origReq.url
                        : (origReq.url?.raw ?? '');
                    summary = `${origReq.method || ''} ${rawUrl}`.trim() || undefined;
                }

                const exampleKey = response.name
                    ? response.name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase() || `example_${statusCode}`
                    : `example_${statusCode}`;

                if (result.responses[statusCode]) {
                    const existing = result.responses[statusCode];
                    existing.examples = existing.examples ?? {};
                    existing.examples[exampleKey] = { summary, value: bodyValue };
                } else {
                    result.responses[statusCode] = {
                        description: response.name,
                        contentType,
                        examples: { [exampleKey]: { summary, value: bodyValue } },
                        ...(Object.keys(mappedHeaders).length > 0 ? { headers: mappedHeaders } : {})
                    };
                }
            }

            return Object.keys(result.responses).length > 0 ? result : undefined;
        };

        // Some exported collections contain malformed `item` arrays where Postman
        // event objects (with `listen`/`script`) leaked in alongside real folders
        // and requests. These are not valid items and must be skipped, otherwise
        // they import as nameless requests and break folder-format saving.
        const isImportableItem = (item: any): boolean => {
            if (!item || typeof item !== 'object') return false;
            if (item.item === undefined && item.request === undefined
                && (item.listen !== undefined || item.script !== undefined)) {
                return false;
            }
            return true;
        };

        const convertItems = (items: any[]): CollectionItem[] => {
            return items.filter(isImportableItem).map(item => {
                if (item.item) {
                    return {
                        id: generateId(item.name),
                        type: 'folder' as const,
                        name: item.name || 'Folder',
                        description: item.description,
                        auth: convertAuth(item.auth),
                        scripts: convertScripts(item.event),
                        items: convertItems(item.item)
                    };
                } else {
                    const request = item.request || {};
                    return {
                        id: generateId(item.name),
                        type: 'request' as const,
                        name: item.name || request.method || 'Request',
                        description: item.description || request.description,
                        method: typeof request.method === 'string' ? request.method : 'GET',
                        url: convertUrl(request.url),
                        query: convertQuery(request.url),
                        headers: Array.isArray(request.header)
                                                        ? request.header.map((h: any) => ({
                                                                key: h.key || h.name || '',
                                                                value: h.value || h.value || '',
                                                                enabled: h.disabled !== true,
                                                                ...(h.description !== undefined ? { description: h.description } : {}),
                                                                ...(h.type !== undefined ? { type: h.type } : {}),
                                                                ...(h.required !== undefined ? { required: h.required } : {}),
                                                                ...(h.format !== undefined ? { format: h.format } : {}),
                                                                ...(h.enum !== undefined ? { enum: h.enum } : {}),
                                                                ...(h.deprecated !== undefined ? { deprecated: h.deprecated } : {}),
                                                                ...(h.pattern !== undefined ? { pattern: h.pattern } : {}),
                                                                ...(h.minLength !== undefined ? { minLength: h.minLength } : {}),
                                                                ...(h.maxLength !== undefined ? { maxLength: h.maxLength } : {}),
                                                                ...(h.minimum !== undefined ? { minimum: h.minimum } : {}),
                                                                ...(h.maximum !== undefined ? { maximum: h.maximum } : {}),
                                                                ...(h.exclusiveMinimum !== undefined ? { exclusiveMinimum: h.exclusiveMinimum } : {}),
                                                                ...(h.exclusiveMaximum !== undefined ? { exclusiveMaximum: h.exclusiveMaximum } : {}),
                                                                ...(h.multipleOf !== undefined ? { multipleOf: h.multipleOf } : {}),
                                                                ...(h.minItems !== undefined ? { minItems: h.minItems } : {}),
                                                                ...(h.maxItems !== undefined ? { maxItems: h.maxItems } : {}),
                                                                ...(h.uniqueItems !== undefined ? { uniqueItems: h.uniqueItems } : {}),
                                                                ...(h.nullable !== undefined ? { nullable: h.nullable } : {}),
                                                                ...(h.oneOf !== undefined ? { oneOf: h.oneOf } : {})
                                                            }))
                            : [],
                        body: (() => {
                            const b = request.body;
                            if (!b) return undefined;
                            if (b.mode === 'raw' && b.raw) {
                                const lang = b.options?.raw?.language;
                                const format = lang === 'xml' ? 'xml' : lang === 'html' ? 'html' : lang === 'javascript' ? 'javascript' : lang === 'text' ? 'text' : 'json';
                                return { type: 'raw' as BodyType, format, content: b.raw };
                            }
                            if (b.mode === 'urlencoded' && Array.isArray(b.urlencoded)) {
                                return {
                                    type: 'x-www-form-urlencoded' as BodyType,
                                    content: b.urlencoded.map((f: any) => ({
                                        key: f.key || '',
                                        value: f.value || '',
                                        enabled: f.disabled !== true
                                    }))
                                };
                            }
                            if (b.mode === 'formdata' && Array.isArray(b.formdata)) {
                                return {
                                    type: 'form-data' as BodyType,
                                    content: b.formdata.map((f: any) => ({
                                        key: f.key || '',
                                        value: f.value || '',
                                        type: f.type || 'text',
                                        enabled: f.disabled !== true
                                    }))
                                };
                            }
                            if (b.mode === 'graphql' && b.graphql) {
                                let variables: Record<string, unknown> | undefined;
                                if (b.graphql.variables) {
                                    try {
                                        variables = JSON.parse(b.graphql.variables);
                                    } catch {
                                        variables = undefined;
                                    }
                                }
                                return {
                                    type: 'graphql' as BodyType,
                                    content: { query: b.graphql.query || '', variables }
                                };
                            }
                            if (b.mode === 'binary') {
                                return { type: 'binary' as BodyType, content: '' };
                            }
                            return undefined;
                        })(),
                        auth: convertAuth(request.auth),
                        scripts: convertScripts(item.event),
                        settings: convertSettings(item.protocolProfileBehavior),
                        responseSchema: convertExamples(item.response)
                    };
                }
            });
        };

        const importedItems = convertItems(data.item || []);
        const collection: Collection = {
            id: generateId(data.info?.name || 'Imported Postman Collection'),
            name: data.info?.name || 'Imported Postman Collection',
            description: data.info?.description,
            auth: convertAuth(data.auth),
            scripts: convertScripts(data.event),
            variables: Array.isArray(data.variable)
                ? Object.fromEntries(
                    data.variable
                        .filter((entry: any) => entry && entry.key)
                        .map((entry: any) => [entry.key, String(entry.value ?? '')])
                  )
                : typeof data.variable === 'object' && data.variable !== null
                    ? Object.fromEntries(
                        Object.entries(data.variable).map(([key, value]) => [key, String(value ?? '')])
                      )
                    : undefined,
            items: importedItems
        };

        await this.saveCollection(collection);
        return collection;
    }

    public async exportCollection(collectionId: string, filePath: string): Promise<void> {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            throw new Error('Collection not found');
        }
        const postmanCollection = toPostmanCollection(collection);
        const content = JSON.stringify(postmanCollection, null, 2);
        fs.writeFileSync(filePath, content, 'utf-8');
    }

    public async exportCollectionAsRestClientFolder(collectionId: string, outDir: string): Promise<void> {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            throw new Error('Collection not found');
        }
        const basePath = path.join(outDir, sanitizeName(collection.name));
        fs.mkdirSync(basePath, { recursive: true });
        const collectionVars = collection.variables || {};
        writeEnvFile(path.join(basePath, `${sanitizeName(collection.name)}.env`), collectionVars);
        writeScriptFile(basePath, sanitizeName(collection.name), collection.scripts);
        writeFolderItems(collection.items, basePath, collection);
    }

    public dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.fileWatcher?.dispose();
    }
}
