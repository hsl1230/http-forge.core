/**
 * Collection Types
 * 
 * Migrated from src/collection/ for better organization
 * These types define the contracts for collection management
 */

import {
    CollectionRequest,
    KeyValueEntry,
    RequestAuth,
    RequestScripts,
    RequestSettings
} from './types';

// Re-export for convenience
export type { CollectionRequest, KeyValueEntry, RequestAuth, RequestScripts, RequestSettings };

/**
 * Request item in a collection - CollectionRequest with type discriminator
 */
export type CollectionRequestItem = CollectionRequest & { type: 'request' };

/**
 * Folder item in a collection
 */
export interface CollectionFolderItem {
    type: 'folder';
    id: string;
    name: string;
    description?: string;
    auth?: RequestAuth;
    scripts?: RequestScripts;
    items?: CollectionItem[];
}

/**
 * Collection item - discriminated union of request or folder
 */
export type CollectionItem = CollectionRequestItem | CollectionFolderItem;

/**
 * Collection definition
 */
export interface Collection {
    id: string;
    name: string;
    description?: string;
    version?: string;
    variables?: Record<string, string>;
    auth?: RequestAuth;
    scripts?: RequestScripts;
    items: CollectionItem[];
}

/**
 * Options for creating a request in a collection
 */
export type CreateRequestOptions =
    Omit<CollectionRequest, 'id'> &
    { collectionId: string; parentId?: string; id?: string };

/**
 * Options for creating a folder
 */
export interface CreateFolderOptions {
    name: string;
    collectionId: string;
    parentId?: string;
}

/**
 * Read-only collection operations
 */
export interface ICollectionReader {
    getAllCollections(): Collection[];
    getCollection(id: string): Collection | undefined;
    getCollectionById(id: string): Collection | undefined;
    getCollectionByName(name: string): Collection | undefined;
    findRequest(collectionId: string, requestId: string): CollectionRequestItem | undefined;
    /**
     * Load heavy request detail (body, scripts, schemas, doc) on demand.
     * Falls back to `findRequest` on stores without lazy support.
     */
    getRequestDetail(collectionId: string, requestId: string): CollectionRequestItem | undefined;
    getCollectionVariables(collectionId: string): Record<string, string>;
}

/**
 * Collection modification operations
 */
export interface ICollectionWriter {
    createCollection(name: string): Promise<Collection>;
    duplicateCollection(sourceId: string, newName: string): Promise<Collection>;
    saveCollection(collection: Collection): Promise<void>;
    deleteCollection(id: string): Promise<boolean>;
    renameCollection(id: string, newName: string): Promise<boolean>;
}

/**
 * Request management operations
 */
export interface IRequestManager {
    createRequest(options: CreateRequestOptions): Promise<CollectionItem>;
    updateRequest(collectionId: string, requestId: string, updates: Partial<CollectionItem>): Promise<boolean>;
    deleteRequest(collectionId: string, requestId: string): Promise<boolean>;
    renameRequest(collectionId: string, requestId: string, newName: string): Promise<boolean>;
}

/**
 * Folder management operations
 */
export interface IFolderManager {
    createFolder(options: CreateFolderOptions): Promise<CollectionItem>;
    duplicateFolder(collectionId: string, folderId: string, newName: string): Promise<CollectionItem>;
    deleteFolder(collectionId: string, folderId: string): Promise<boolean>;
    renameFolder(collectionId: string, folderId: string, newName: string): Promise<boolean>;
}

/**
 * Collection variable management
 */
export interface ICollectionVariableManager {
    setCollectionVariable(collectionId: string, key: string, value: unknown): void;
    deleteCollectionVariable(collectionId: string, key: string): void;
    clearCollectionVariables(collectionId: string): void;
    getCollectionVariableLocals(collectionId: string): Record<string, string>;
}

/**
 * Collection ordering operations
 */
export interface IOrderingManager {
    reorderItems(collectionId: string, parentId: string | undefined, orderedItemIds: string[]): Promise<boolean>;
}

/**
 * Request script read/write operations
 */
export interface IScriptManager {
    getRequestScript(collectionId: string, requestId: string, phase: 'pre-request' | 'post-response'): string | undefined;
    setRequestScript(collectionId: string, requestId: string, phase: 'pre-request' | 'post-response', source: string): Promise<boolean>;
}

/**
 * Collection import/export operations
 */
export interface ICollectionImportExport {
    importCollection(filePath: string): Promise<Collection>;
    exportCollection(id: string, filePath: string): Promise<void>;
    exportCollectionAsRestClientFolder(id: string, outDir: string): Promise<void>;
}

/**
 * Full collection service interface
 */
export interface ICollectionService
    extends ICollectionReader,
            ICollectionWriter,
            IRequestManager,
            IFolderManager,
            IOrderingManager,
            IScriptManager,
            ICollectionVariableManager,
            ICollectionImportExport {
    dispose(): void;
}

/**
 * Collection loader interface
 */
export interface ICollectionLoader {
    load(filePath: string, options?: any): Promise<import('./types').UnifiedCollection> | import('./types').UnifiedCollection | undefined;
    loadAll(): Promise<import('./types').UnifiedCollection[]> | import('./types').UnifiedCollection[];
}

/**
 * Collection parser interface (infrastructure-level)
 * Different from ports/parsers/ICollectionParser
 */
export interface ICollectionParser {
    canParse(content: string): boolean;
    parse(content: string, filePath?: string): import('./types').UnifiedCollection;
}
