/**
 * Folder Format I/O Primitives
 * 
 * Shared file I/O operations for the folder-based collection storage format.
 * Used by both FolderCollectionLoader (read-only, UnifiedCollection types)
 * and FolderCollectionStore (full CRUD, Collection types).
 * 
 * Eliminates ~200 lines of duplicated code between the two implementations.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RequestBody } from '../../types/types';

// ════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════

/** Script file names within a scripts/ directory */
export const SCRIPT_FILES = {
    preRequest: 'pre-request.js',
    postResponse: 'post-response.js'
};

/** Metadata file names that identify item types */
export const METADATA_FILES = {
    collection: 'collection.json',
    folder: 'folder.json',
    request: 'request.json'
};

/**
 * Body file extensions mapped to body type/format.
 * Files stored externally get syntax highlighting benefits.
 * Other types (form-data, urlencoded, binary, none) stay in request.json.
 */
export const BODY_FILE_MAP: Record<string, { type: 'raw' | 'graphql'; format?: 'json' | 'text' | 'xml' | 'html' | 'javascript' }> = {
    'body.json': { type: 'raw', format: 'json' },
    'body.xml': { type: 'raw', format: 'xml' },
    'body.txt': { type: 'raw', format: 'text' },
    'body.html': { type: 'raw', format: 'html' },
    'body.js': { type: 'raw', format: 'javascript' },
    'body.graphql': { type: 'graphql' }
};

/** Schema files stored alongside request.json for OpenAPI round-trip support */
export const SCHEMA_FILES = {
    responseSchema: 'response.schema.json',
    bodySchema: 'body.schema.json'
};

/** Scripts directory name */
export const SCRIPTS_DIR = 'scripts';

// ════════════════════════════════════════════════════════════
// Scripts
// ════════════════════════════════════════════════════════════

/**
 * Scripts structure (shared shape between CollectionScripts and RequestScripts)
 */
export interface ScriptsData {
    preRequest?: string;
    postResponse?: string;
}

/**
 * Read scripts from a scripts/ directory.
 * Returns undefined if the directory doesn't exist or has no scripts.
 */
export function readScriptsFromDir(scriptsPath: string): ScriptsData | undefined {
    if (!fs.existsSync(scriptsPath)) {
        return undefined;
    }

    const scripts: ScriptsData = {};

    const preRequestPath = path.join(scriptsPath, SCRIPT_FILES.preRequest);
    if (fs.existsSync(preRequestPath)) {
        scripts.preRequest = fs.readFileSync(preRequestPath, 'utf-8');
    }

    const postResponsePath = path.join(scriptsPath, SCRIPT_FILES.postResponse);
    if (fs.existsSync(postResponsePath)) {
        scripts.postResponse = fs.readFileSync(postResponsePath, 'utf-8');
    }

    return Object.keys(scripts).length > 0 ? scripts : undefined;
}

/**
 * Write scripts to a scripts/ directory.
 * If a script is empty/undefined, the corresponding file is deleted.
 */
export async function writeScriptsToDir(scriptsPath: string, scripts: ScriptsData): Promise<void> {
    await fs.promises.mkdir(scriptsPath, { recursive: true });

    const preRequestFile = path.join(scriptsPath, SCRIPT_FILES.preRequest);
    if (scripts.preRequest) {
        await fs.promises.writeFile(preRequestFile, scripts.preRequest, 'utf-8');
    } else if (fs.existsSync(preRequestFile)) {
        await fs.promises.unlink(preRequestFile);
    }

    const postResponseFile = path.join(scriptsPath, SCRIPT_FILES.postResponse);
    if (scripts.postResponse) {
        await fs.promises.writeFile(postResponseFile, scripts.postResponse, 'utf-8');
    } else if (fs.existsSync(postResponseFile)) {
        await fs.promises.unlink(postResponseFile);
    }
}

// ════════════════════════════════════════════════════════════
// Body Files
// ════════════════════════════════════════════════════════════

/**
 * Load body from external file if present.
 * Supports: body.json, body.xml, body.txt, body.html, body.js, body.graphql
 */
export function readBodyFromDir(requestPath: string): RequestBody | undefined {
    for (const [filename, typeInfo] of Object.entries(BODY_FILE_MAP)) {
        const bodyPath = path.join(requestPath, filename);
        if (fs.existsSync(bodyPath)) {
            try {
                const bodyContent = fs.readFileSync(bodyPath, 'utf-8');

                // Keep body as string so variables can be resolved first before parsing
                let content: any;
                if (typeInfo.type === 'graphql') {
                    // GraphQL: try to parse, but if it fails, keep as query string
                    try {
                        content = JSON.parse(bodyContent);
                    } catch {
                        content = bodyContent;
                    }
                } else {
                    // For JSON and other formats, keep as string for variable resolution
                    content = bodyContent;
                }

                return {
                    type: typeInfo.type,
                    format: typeInfo.format,
                    content
                } as RequestBody;
            } catch (error) {
                console.error(`[FolderIO] Failed to load body from ${bodyPath}:`, error);
            }
        }
    }
    return undefined;
}

/**
 * Separate body content into metadata-inline vs. external-file parts.
 */
export function prepareBodyForSave(body: any): {
    bodyForMetadata: any;
    externalBodyFile?: { filename: string; content: string };
} {
    if (!body || body.type === 'none') {
        return { bodyForMetadata: body };
    }

    if (body.type === 'raw') {
        const format = body.format || 'json';
        const extensionMap: Record<string, string> = {
            json: 'body.json',
            xml: 'body.xml',
            text: 'body.txt',
            html: 'body.html',
            javascript: 'body.js'
        };
        const filename = extensionMap[format];
        if (filename) {
            const content = format === 'json'
                ? (typeof body.content === 'string' ? body.content : JSON.stringify(body.content, null, 2))
                : String(body.content || '');
            return {
                bodyForMetadata: { type: body.type, format: body.format },
                externalBodyFile: { filename, content }
            };
        }
    }

    if (body.type === 'graphql') {
        const content = typeof body.content === 'string'
            ? body.content
            : JSON.stringify(body.content, null, 2);
        return {
            bodyForMetadata: { type: body.type },
            externalBodyFile: { filename: 'body.graphql', content }
        };
    }

    // form-data, x-www-form-urlencoded, binary stay in metadata
    return { bodyForMetadata: body };
}

/**
 * Remove stale body files that don't match the current format.
 */
export async function cleanupOldBodyFiles(requestPath: string, currentBodyFile?: string): Promise<void> {
    for (const filename of Object.keys(BODY_FILE_MAP)) {
        if (filename !== currentBodyFile) {
            const filePath = path.join(requestPath, filename);
            if (fs.existsSync(filePath)) {
                try {
                    await fs.promises.unlink(filePath);
                } catch {
                    // Ignore cleanup errors
                }
            }
        }
    }
}

// ════════════════════════════════════════════════════════════
// Schema Files
// ════════════════════════════════════════════════════════════

/**
 * Load a JSON schema file if it exists.
 * Returns the parsed object or undefined.
 */
export function readSchemaFile(filePath: string): any | undefined {
    if (!fs.existsSync(filePath)) {
        return undefined;
    }
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.error(`[FolderIO] Failed to load schema file ${filePath}:`, error);
        return undefined;
    }
}

/**
 * Save OpenAPI schema files (response.schema.json, body.schema.json).
 */
export async function writeSchemaFiles(
    requestPath: string,
    responseSchema?: any,
    bodySchema?: any
): Promise<void> {
    const responseSchemaPath = path.join(requestPath, SCHEMA_FILES.responseSchema);
    const bodySchemaPath = path.join(requestPath, SCHEMA_FILES.bodySchema);

    if (responseSchema) {
        await fs.promises.writeFile(
            responseSchemaPath,
            JSON.stringify(responseSchema, null, 2),
            'utf-8'
        );
    } else if (fs.existsSync(responseSchemaPath)) {
        await fs.promises.unlink(responseSchemaPath);
    }

    if (bodySchema) {
        await fs.promises.writeFile(
            bodySchemaPath,
            JSON.stringify(bodySchema, null, 2),
            'utf-8'
        );
    } else if (fs.existsSync(bodySchemaPath)) {
        await fs.promises.unlink(bodySchemaPath);
    }
}

// ════════════════════════════════════════════════════════════
// Generic Tree Helpers
// ════════════════════════════════════════════════════════════

/** Minimal interface for tree traversal — both UnifiedFolder/UnifiedRequest and CollectionItem satisfy this */
interface TreeNode {
    id: string;
    type: string;
    items?: TreeNode[];
}

/**
 * Find an item by ID in a tree (recursive).
 */
export function findItemById<T extends TreeNode>(items: T[], id: string): T | undefined {
    for (const item of items) {
        if (item.id === id) {
            return item;
        }
        if (item.type === 'folder' && item.items) {
            const found = findItemById(item.items as T[], id);
            if (found) {
                return found;
            }
        }
    }
    return undefined;
}

/**
 * Remove an item from a tree by ID (mutates the array).
 */
export function deleteItemFromTree<T extends TreeNode>(items: T[], id: string): boolean {
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.id === id) {
            items.splice(i, 1);
            return true;
        }
        if (item.type === 'folder' && item.items) {
            if (deleteItemFromTree(item.items as T[], id)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Re-sort items to match an ordered list of IDs.
 * Items not in orderedIds are appended at the end.
 */
export function sortItemsByOrder<T extends { id: string }>(items: T[], orderedIds: string[]): T[] {
    const itemMap = new Map(items.map(item => [item.id, item]));
    const sorted: T[] = [];

    for (const id of orderedIds) {
        const item = itemMap.get(id);
        if (item) {
            sorted.push(item);
            itemMap.delete(id);
        }
    }

    for (const item of itemMap.values()) {
        sorted.push(item);
    }

    return sorted;
}

/**
 * Recursively search for a directory named targetSlug under basePath.
 */
export function searchForItemPath(basePath: string, targetSlug: string): string | undefined {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(basePath, { withFileTypes: true });
    } catch {
        return undefined;
    }

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === SCRIPTS_DIR) {
            continue;
        }

        if (entry.name === targetSlug) {
            return path.join(basePath, entry.name);
        }

        const found = searchForItemPath(path.join(basePath, entry.name), targetSlug);
        if (found) {
            return found;
        }
    }

    return undefined;
}

/**
 * Read the item id from a directory's metadata file (request.json or folder.json).
 * Returns undefined if neither file exists or cannot be parsed.
 */
function readItemIdFromDir(dirPath: string): string | undefined {
    for (const metadataFile of [METADATA_FILES.request, METADATA_FILES.folder]) {
        const metadataPath = path.join(dirPath, metadataFile);
        if (fs.existsSync(metadataPath)) {
            try {
                const content = fs.readFileSync(metadataPath, 'utf-8');
                const parsed = JSON.parse(content) as { id?: string };
                return parsed.id;
            } catch {
                return undefined;
            }
        }
    }
    return undefined;
}

/**
 * Recursively search for the directory whose metadata id equals targetId.
 *
 * Ids are globally unique, whereas slugs are de-duplicated only among siblings — so two
 * items with the same name in different folders share a leaf slug. Resolving by id (reading
 * each candidate's metadata) guarantees that only the directory belonging to that exact id
 * is matched, regardless of slug collisions.
 */
export function searchForItemPathById(basePath: string, targetId: string): string | undefined {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(basePath, { withFileTypes: true });
    } catch {
        return undefined;
    }

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === SCRIPTS_DIR) {
            continue;
        }

        const childPath = path.join(basePath, entry.name);
        if (readItemIdFromDir(childPath) === targetId) {
            return childPath;
        }

        const found = searchForItemPathById(childPath, targetId);
        if (found) {
            return found;
        }
    }

    return undefined;
}

// ════════════════════════════════════════════════════════════
// Slug Generation
// ════════════════════════════════════════════════════════════

/**
 * Generate a slug from a name.
 * Handles HTTP method prefixes, version indicators (T7, 1.5), path parameters,
 * and deduplication with counter suffixes.
 */
export function generateSlug(name: string, existingSlugs: string[] = []): string {
    const lowerName = name.toLowerCase().trim();
    
    // Extract HTTP method if present at start
    const methodMatch = lowerName.match(/^(get|post|put|patch|delete|head|options)[_\s-]/i);
    const method = methodMatch ? methodMatch[1] : '';
    
    // Extract the highest T-version (T7 > T2 > T1) - look for all T# patterns
    const tVersionMatches = lowerName.match(/t(\d+)/gi) || [];
    let maxTVersion = 0;
    for (const match of tVersionMatches) {
        const num = parseInt(match.substring(1));
        if (num > maxTVersion) {
            maxTVersion = num;
        }
    }
    
    // If no T-version found, look for numeric version like 1.5, 2.0
    let version = '';
    if (maxTVersion > 0) {
        version = `t${maxTVersion}`;
    } else {
        // Look for standalone numeric versions like 1.5, 2.0, 2.1
        const numericVersionMatch = lowerName.match(/[_\s-](\d+\.\d+)[_\s-]/);
        if (numericVersionMatch) {
            version = `v${numericVersionMatch[1].replace('.', '_')}`;
        }
    }
    
    // Remove method prefix for path processing
    let pathPart = lowerName;
    if (methodMatch) {
        pathPart = pathPart.substring(methodMatch[0].length);
    }
    
    // Remove ALL version indicators: T7, T2, T7.2, 1.5, etc.
    pathPart = pathPart.replace(/[_\s-]?t\d+(?:\.\d+)?[_\s-]?/gi, '-');
    pathPart = pathPart.replace(/[_\s-]?\d+\.\d+[_\s-]?/g, '-');
    
    // Remove regex constraints like (RECORDING|VOD|PROGRAM)
    pathPart = pathPart.replace(/\([^)]+\)/g, '');
    
    // Remove path parameters like :id, :setId, :contentType
    pathPart = pathPart.replace(/:[a-z_][a-z0-9_]*/gi, '');
    
    // Remove curly brace groups like {RECORDING,VOD,PROGRAM}
    pathPart = pathPart.replace(/\{[^}]+\}/g, '');
    
    // Remove common noise words and patterns
    pathPart = pathPart
        .replace(/\?$/g, '')
        .replace(/[_/\\ ]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    
    // Split into segments and filter out empty ones
    const segments = pathPart.split('-').filter(s => s.length > 0);
    
    // Build final slug: method-segments-version
    const parts: string[] = [];
    if (method) parts.push(method);
    parts.push(...segments);
    if (version) parts.push(version);
    
    let slug = parts.join('-');
    
    if (!slug) {
        slug = 'item';
    }

    // Handle duplicates
    if (existingSlugs.includes(slug)) {
        let counter = 2;
        while (existingSlugs.includes(`${slug}-${counter}`)) {
            counter++;
        }
        slug = `${slug}-${counter}`;
    }

    return slug;
}
