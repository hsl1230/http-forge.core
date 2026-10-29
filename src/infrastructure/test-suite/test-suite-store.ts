/**
 * Test Suite Store
 * 
 * Manages suite requests that can come from different collections.
 * Supports folder-based suite storage where each request has its own directory.
 * Falls back to resolving from collection service for legacy suites.
 * 
 * Single Responsibility: Maintain suite state and resolve requests
 * Dependency Inversion: Depends on ICollectionService abstraction
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    Collection,
    CollectionFolderItem,
    CollectionItem,
    CollectionRequest,
    CollectionRequestItem,
    ICollectionService,
    RequestAuth,
    RequestScripts
} from '../../types/collection';
import { generateSlug, readScriptsFromDir, writeScriptsToDir } from '../collection/folder-io';
import { SuiteRequest, TestSuite } from './interfaces';

/**
 * Cached request entry with full context
 */
export interface SuiteRequestEntry {
    /** The full request object from the source collection */
    request: CollectionRequest;
    /** Suite request metadata */
    suiteRequest: SuiteRequest;
    /** Collection scripts */
    collectionScripts?: RequestScripts;
    /** Collection auth */
    collectionAuth?: RequestAuth;
    /** Folder scripts chain */
    folderScriptsChain: RequestScripts[];
    /** Folder auth chain */
    folderAuthChain: RequestAuth[];
    /** Folder path resolved from source collection traversal */
    resolvedFolderPath?: string;
    /** Collection name resolved from the source collection */
    resolvedCollectionName?: string;
}

/**
 * Interface for TestSuiteStore
 */
export interface ITestSuiteStore {
    /**
     * Set the test suite
     */
    setSuite(suite: TestSuite): void;

    /**
     * Set the suite directory path (for folder-based suites)
     */
    setSuiteDir(dir: string | undefined): void;

    /**
     * Get the current suite
     */
    getSuite(): TestSuite | undefined;

    /**
     * Get a request by ID with full context (collection scripts + folder scripts)
     */
    getRequestWithContext(collectionId: string, requestId: string): SuiteRequestEntry | undefined;

    /**
     * Get a request by slug with full context
     */
    getRequestBySlug(slug: string): SuiteRequestEntry | undefined;

    /**
     * Get all suite requests with their resolved data
     */
    getAllSuiteRequests(): SuiteRequestEntry[];

    /**
     * Resolve a SuiteRequest to a full entry with collection context.
     * Works for any SuiteRequest object regardless of whether it's in suite.requests.
     */
    resolveRequestEntry(suiteRequest: SuiteRequest): SuiteRequestEntry | undefined;

    /**
     * Get resolved requests for webview display
     */
    getResolvedRequests(): Array<{
        id: string;
        collectionId: string;
        requestId: string;
        name: string;
        method: string;
        url: string;
        collectionName: string;
        folderPath: string;
        enabled: boolean;
        hasEmbeddedRequest: boolean;
        slug?: string;
        description?: string;
    }>;

    /**
     * Get suite requests by selection state
     * @param selectedIds IDs of selected requests in execution order
     */
    getSelectedRequests(selectedIds: string[]): SuiteRequestEntry[];

    /**
     * Add a request to the suite (creates folder if suiteDir is set)
     */
    addRequest(request: SuiteRequest, fullRequest?: CollectionRequest): void;

    /**
     * Remove a request from the suite
     */
    removeRequest(requestId: string): void;

    /**
     * Reorder requests
     */
    reorderRequests(requestIds: string[]): void;

    /**
     * Update a suite request's data in its folder
     */
    updateSuiteRequest(slug: string, updatedRequest: CollectionRequest): void;

    /**
     * Re-sync a suite request from its source collection
     */
    resyncFromCollection(slug: string): CollectionRequest | undefined;
}

/**
 * Implementation of TestSuiteStore
 */
export class TestSuiteStore implements ITestSuiteStore {
    private suite: TestSuite | undefined;
    private suiteDir: string | undefined;

    constructor(
        private readonly collectionService: ICollectionService
    ) {}

    /**
     * Set the suite
     * Converts legacy requests to request nodes for unified nodes-only architecture
     */
    setSuite(suite: TestSuite): void {
        // nodes is the only execution model; ensure it's always an array
        this.suite = {
            ...suite,
            nodes: Array.isArray(suite.nodes) ? suite.nodes : []
        };
    }

    /**
     * Set the suite directory (for folder-based storage)
     */
    setSuiteDir(dir: string | undefined): void {
        this.suiteDir = dir;
    }

    /**
     * Get the current suite
     */
    getSuite(): TestSuite | undefined {
        return this.suite;
    }

    // ========================================
    // Folder I/O — Suite Request Storage
    // ========================================

    /**
     * Load a suite request from its folder.
     * Reads request.json + scripts/pre-request.js + scripts/post-response.js
     */
    private loadSuiteRequest(slug: string): CollectionRequest | undefined {
        if (!this.suiteDir) return undefined;

        const requestPath = path.join(this.suiteDir, slug, 'request.json');
        if (!fs.existsSync(requestPath)) return undefined;

        try {
            const request = JSON.parse(fs.readFileSync(requestPath, 'utf-8'));

            // Load scripts from separate files
            const scriptsDir = path.join(this.suiteDir, slug, 'scripts');
            const scripts = readScriptsFromDir(scriptsDir);
            if (scripts) {
                request.scripts = scripts;
            }

            return request;
        } catch (error) {
            console.error(`[TestSuiteStore] Failed to load request from ${slug}:`, error);
            return undefined;
        }
    }

    /**
     * Save a suite request to its folder.
     * Writes request.json + scripts/pre-request.js + scripts/post-response.js atomically.
     */
    private saveSuiteRequest(slug: string, request: CollectionRequest): void {
        if (!this.suiteDir) return;

        const requestDir = path.join(this.suiteDir, slug);
        fs.mkdirSync(requestDir, { recursive: true });

        // Extract scripts to separate files
        const scripts = request.scripts;
        const requestWithoutScripts = { ...request };
        delete (requestWithoutScripts as any).scripts;

        // Write request.json (without inline scripts)
        const requestPath = path.join(requestDir, 'request.json');
        const tempPath = `${requestPath}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tempPath, JSON.stringify(requestWithoutScripts, null, 2), 'utf-8');
        fs.renameSync(tempPath, requestPath);

        // Write scripts to separate .js files
        if (scripts) {
            const scriptsDir = path.join(requestDir, 'scripts');
            writeScriptsToDir(scriptsDir, {
                preRequest: scripts.preRequest || undefined,
                postResponse: scripts.postResponse || undefined
            });
        }
    }

    /**
     * Check if a suite request has embedded data in its folder
     */
    private hasEmbeddedRequest(slug: string | undefined): boolean {
        if (!this.suiteDir || !slug) return false;
        return fs.existsSync(path.join(this.suiteDir, slug, 'request.json'));
    }

    /**
     * Resolve a suite request to its full request data.
     * Priority: suite folder → collection (fallback for legacy suites)
     */
    resolveRequestEntry(
        suiteRequest: SuiteRequest
    ): SuiteRequestEntry | undefined {
        // Try loading from suite folder first (folder-based suites)
        const embeddedRequest = suiteRequest.slug
            ? this.loadSuiteRequest(suiteRequest.slug)
            : undefined;

        const collection = this.collectionService.getCollection(suiteRequest.collectionId);

        if (embeddedRequest) {
            // Scripts: ALWAYS resolve live from collection (not snapshotted)
            let collectionScripts: RequestScripts | undefined;
            let folderScriptsChain: RequestScripts[] = [];
            let folderAuthChain: RequestAuth[] = [];
            let resolvedFolderPath: string | undefined;

            if (collection) {
                collectionScripts = collection.scripts;
                const requestData = this.findRequestInCollection(collection, suiteRequest.requestId);
                if (requestData) {
                    folderScriptsChain = requestData.folderScriptsChain;
                    folderAuthChain = requestData.folderAuthChain;
                    resolvedFolderPath = requestData.folderPath;
                }
            }

            return {
                request: embeddedRequest,
                suiteRequest,
                collectionScripts,
                collectionAuth: collection?.auth,
                folderScriptsChain,
                folderAuthChain,
                resolvedFolderPath,
                resolvedCollectionName: collection?.name
            };
        }

        // Fallback: resolve from collection (legacy suites without slug/folder)
        if (!collection) {
            console.warn(`[TestSuiteStore] Collection not found: ${suiteRequest.collectionId}`);
            return undefined;
        }

        const requestData = this.findRequestInCollection(
            collection, 
            suiteRequest.requestId
        );
        if (!requestData) {
            console.warn(`[TestSuiteStore] Request not found: ${suiteRequest.requestId}`);
            return undefined;
        }

        return {
            request: requestData.request,
            suiteRequest,
            collectionScripts: collection.scripts,
            collectionAuth: collection.auth,
            folderScriptsChain: requestData.folderScriptsChain,
            folderAuthChain: requestData.folderAuthChain,
            resolvedFolderPath: requestData.folderPath,
            resolvedCollectionName: collection.name
        };
    }

    /**
     * Find a request in a collection, including folder scripts
     */
    private findRequestInCollection(
        collection: Collection,
        requestId: string,
        folderScriptsChain: RequestScripts[] = []
    ): { request: CollectionRequest; folderScriptsChain: RequestScripts[]; folderAuthChain: RequestAuth[]; folderPath: string } | undefined {
        const items = collection.items || [];
        return this.searchItems(items, requestId, folderScriptsChain);
    }

    /**
     * Recursively search for a request
     */
    private searchItems(
        items: CollectionItem[],
        requestId: string,
        currentScripts: RequestScripts[],
        currentAuth: RequestAuth[] = [],
        currentFolderPath: string = ''
    ): { request: CollectionRequest; folderScriptsChain: RequestScripts[]; folderAuthChain: RequestAuth[]; folderPath: string } | undefined {
        for (const item of items) {
            if (item.type === 'folder') {
                const folderItem = item as unknown as CollectionFolderItem;
                if (!folderItem.items) continue;

                // It's a folder
                const newScripts = folderItem.scripts 
                    ? [...currentScripts, folderItem.scripts]
                    : currentScripts;
                const newAuth = folderItem.auth
                    ? [...currentAuth, folderItem.auth]
                    : currentAuth;
                const encodedFolderName = (folderItem.name || '').replace(/\//g, '%2F');
                const nextFolderPath = currentFolderPath
                    ? `${currentFolderPath}/${encodedFolderName}`
                    : encodedFolderName;
                
                const found = this.searchItems(folderItem.items || [], requestId, newScripts, newAuth, nextFolderPath);
                if (found) return found;
            } else if (item.id === requestId) {
                // Found the request
                return {
                    request: this.normalizeRequest(item),
                    folderScriptsChain: currentScripts,
                    folderAuthChain: currentAuth,
                    folderPath: currentFolderPath
                };
            }
        }
        return undefined;
    }

    /**
     * Normalize request data
     */
    private normalizeRequest(item: CollectionRequestItem): CollectionRequest {
        const { type, ...request } = item;
        return request as CollectionRequest;
    }

    /**
     * Normalize key-value array or object to standard format
     * Handles both array format [{key, value}] and object format {key: value}
     */
    private normalizeKeyValues(items: any): Array<{ key: string; value: string; enabled: boolean }> {
        if (!items) return [];
        
        // Handle array format
        if (Array.isArray(items)) {
            return items.map(item => ({
                key: item.key || '',
                value: item.value || '',
                enabled: item.enabled !== false
            }));
        }
        
        // Handle object format { key: value }
        if (typeof items === 'object') {
            return Object.entries(items).map(([key, value]) => ({
                key,
                value: String(value || ''),
                enabled: true
            }));
        }
        
        return [];
    }

    /**
     * Get a request with full context
     * Always resolves fresh from collection service to ensure latest data
     */
    getRequestWithContext(collectionId: string, requestId: string): SuiteRequestEntry | undefined {
        if (!this.suite) return undefined;

        const suiteRequest = this._getRequestNodes().find(
            sr => sr.collectionId === collectionId && sr.requestId === requestId
        );
        if (!suiteRequest) return undefined;

        return this.resolveRequestEntry(suiteRequest);
    }

    getRequestBySlug(slug: string): SuiteRequestEntry | undefined {
        if (!this.suite) return undefined;
        const suiteRequest = this._getRequestNodes().find(sr => sr.slug === slug);
        if (!suiteRequest) return undefined;
        return this.resolveRequestEntry(suiteRequest);
    }

    /**
     * Get all suite requests with resolved data
     * Always resolves fresh from collection service to ensure latest data
     */
    getAllSuiteRequests(): SuiteRequestEntry[] {
        if (!this.suite) return [];

        const results: SuiteRequestEntry[] = [];
        for (const suiteRequest of this._getRequestNodes()) {
            const entry = this.resolveRequestEntry(suiteRequest);
            if (entry) {
                results.push(entry);
            }
        }
        return results;
    }

    /**
     * Get resolved requests for webview display.
     * Returns simplified format with display-relevant properties, ordered by nodes.
     */
    getResolvedRequests(): Array<{
        id: string;
        collectionId: string;
        requestId: string;
        name: string;
        method: string;
        url: string;
        collectionName: string;
        folderPath: string;
        enabled: boolean;
        hasEmbeddedRequest: boolean;
        slug?: string;
        description?: string;
    }> {
        if (!this.suite) return [];

        const allNodes: any[] = this.suite.nodes || [];
        const requestNodes = allNodes.filter(n => n.type === 'request');
        const allSlugs: string[] = requestNodes.map((n: any) => n.request?.slug || '').filter(Boolean);

        const results = [];
        for (const node of requestNodes) {
            const suiteRequest: SuiteRequest = node.request;
            if (!suiteRequest) continue;

            if (!suiteRequest.slug) {
                suiteRequest.slug = generateSlug(suiteRequest.name || 'request', allSlugs);
                allSlugs.push(suiteRequest.slug);
            }

            const entry = this.resolveRequestEntry(suiteRequest);
            if (entry) {
                const collection = this.collectionService.getCollection(suiteRequest.collectionId);
                results.push({
                    id: `${suiteRequest.collectionId}:${suiteRequest.requestId}`,
                    collectionId: suiteRequest.collectionId,
                    requestId: suiteRequest.requestId,
                    name: entry.request.name || 'Unknown',
                    method: entry.request.method || 'GET',
                    url: entry.request.url || '',
                    collectionName: collection?.name || 'Unknown Collection',
                    folderPath: suiteRequest.folderPath || '',
                    enabled: node.enabled !== false,
                    hasEmbeddedRequest: this.hasEmbeddedRequest(suiteRequest.slug),
                    slug: suiteRequest.slug,
                    description: node.name !== entry.request.name ? node.name : (suiteRequest.description || undefined)
                });
            } else {
                console.warn(`[TestSuiteStore] getResolvedRequests: could not resolve request — collectionId=${suiteRequest.collectionId} requestId=${suiteRequest.requestId} slug=${suiteRequest.slug}`);
            }
        }
        return results;
    }

    /**
     * Get selected requests in order
     * Always resolves fresh from collection service to ensure latest data
     */
    getSelectedRequests(selectedIds: string[]): SuiteRequestEntry[] {
        const results: SuiteRequestEntry[] = [];
        for (const id of selectedIds) {
            // selectedIds format: "collectionId:requestId"
            const [collectionId, requestId] = id.split(':');
            const suiteRequest = this._getRequestNodes().find(
                sr => sr.collectionId === collectionId && sr.requestId === requestId
            );
            if (suiteRequest) {
                const entry = this.resolveRequestEntry(suiteRequest);
                if (entry) {
                    results.push(entry);
                }
            }
        }
        return results;
    }

    /**
     * Add a request to the suite as a flow node.
     * Copy-on-write: do NOT create an embedded request folder at add time.
     * A folder snapshot is created only when the request is edited/reset in-suite.
     */
    addRequest(request: SuiteRequest, fullRequest?: CollectionRequest): void {
        if (!this.suite) return;

        if (!this.suite.nodes) this.suite.nodes = [];

        if (this.suiteDir && fullRequest) {
            if (!request.slug) {
                const existingSlugs = this._getRequestNodes().map(r => r.slug || '').filter(Boolean);
                request.slug = generateSlug(request.name || fullRequest.name || 'request', existingSlugs);
            } else {
                request.slug = this.resolveUniqueSlug(request.slug);
            }
        }

        this.suite.nodes.push({
            type: 'request',
            name: request.description || request.name,
            request,
            enabled: request.enabled !== false
        });
    }

    /**
     * Resolve a unique slug (handle duplicates with numeric suffix)
     */
    private resolveUniqueSlug(baseSlug: string): string {
        if (!this.suite) return baseSlug;
        const existingSlugs = new Set(this._getRequestNodes().map(r => r.slug).filter(Boolean));
        if (!existingSlugs.has(baseSlug)) return baseSlug;

        let counter = 2;
        while (existingSlugs.has(`${baseSlug}-${counter}`)) counter++;
        return `${baseSlug}-${counter}`;
    }

    /**
     * Remove a request from the suite (removes its node)
     */
    removeRequest(requestId: string): void {
        if (!this.suite?.nodes) return;
        this.suite.nodes = this.suite.nodes.filter(
            (n: any) => !(n.type === 'request' && n.request?.requestId === requestId)
        );
    }

    /**
     * Reorder request nodes by "collectionId:requestId" keys
     */
    reorderRequests(orderedKeys: string[]): void {
        if (!this.suite?.nodes) return;

        const requestNodeMap = new Map<string, any>();
        for (const node of this.suite.nodes) {
            if ((node as any).type === 'request' && (node as any).request) {
                const req = (node as any).request as SuiteRequest;
                requestNodeMap.set(`${req.collectionId}:${req.requestId}`, node);
            }
        }

        const nonRequestNodes = this.suite.nodes.filter((n: any) => n.type !== 'request');
        const reordered: any[] = [];
        for (const key of orderedKeys) {
            const node = requestNodeMap.get(key);
            if (node) reordered.push(node);
        }
        this.suite.nodes = [...reordered, ...nonRequestNodes];
    }

    /**
     * Update the request data in the suite folder.
     * Called when user edits a request from the suite panel.
     */
    updateSuiteRequest(slug: string, updatedRequest: CollectionRequest): void {
        if (!this.suite || !this.suiteDir) return;

        this.saveSuiteRequest(slug, updatedRequest);

        // Sync cached display fields in the node
        const node = this.suite.nodes?.find((n: any) => n.type === 'request' && n.request?.slug === slug) as any;
        if (node?.request) {
            node.request.name = updatedRequest.name || node.request.name;
            node.request.method = updatedRequest.method || node.request.method;
        }
    }

    /**
     * Replace the suite request with the latest version from the collection.
     * Overwrites the request folder content.
     */
    resyncFromCollection(slug: string): CollectionRequest | undefined {
        if (!this.suite || !this.suiteDir) return undefined;

        const node = this.suite.nodes?.find((n: any) => n.type === 'request' && n.request?.slug === slug) as any;
        if (!node?.request) return undefined;
        const sr: SuiteRequest = node.request;

        const collection = this.collectionService.getCollection(sr.collectionId);
        if (!collection) return undefined;

        const requestData = this.findRequestInCollection(collection, sr.requestId);
        if (!requestData) return undefined;

        this.saveSuiteRequest(slug, requestData.request);

        // Sync display fields on the node
        node.request.name = requestData.request.name || sr.name;
        node.request.method = requestData.request.method || sr.method;

        return requestData.request;
    }

    /**
     * Extract all SuiteRequest objects from top-level request nodes.
     * Nodes is the sole source of truth — no suite.requests access.
     */
    private _getRequestNodes(): SuiteRequest[] {
        return (this.suite?.nodes || [])
            .filter((n: any) => n.type === 'request' && n.request)
            .map((n: any) => n.request as SuiteRequest);
    }
}

