/**
 * REST Client Export Utilities
 * 
 * Pure functions for exporting collections to REST Client format (.http files).
 * No VS Code dependency — uses only Node.js fs/path and core types.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    Collection,
    CollectionItem,
    CollectionRequestItem,
    ICollectionService,
} from '../../types/collection';
import type { IEnvironmentConfigService } from '../../types/environment-config';
import type { RequestScripts } from '../../types/types';
import { sanitizeName } from '../../utils/helpers';

/**
 * Write an env file given an object of key/value pairs. Existing file is overwritten.
 */
export function writeEnvFile(filePath: string, vars: Record<string, string> = {}): void {
    const lines: string[] = [];
    Object.entries(vars).forEach(([k, v]) => {
        lines.push(`${k}=${v}`);
    });
    if (lines.length) {
        fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    }
}

/**
 * Write pre/post scripts to separate files (pre.js and post.js). If no content, does nothing.
 */
export function writeScriptFile(dir: string, baseName: string, scripts?: RequestScripts | undefined): void {
    if (!scripts) return;
    if (scripts.preRequest && scripts.preRequest.trim()) {
        fs.writeFileSync(path.join(dir, `${baseName}.pre.js`), scripts.preRequest, 'utf-8');
    }
    if (scripts.postResponse && scripts.postResponse.trim()) {
        fs.writeFileSync(path.join(dir, `${baseName}.post.js`), scripts.postResponse, 'utf-8');
    }
}

/**
 * Determine the folder where REST-Client exports should be saved.
 *
 * The setting value may be an absolute path or a workspace-relative
 * path.  If the provided `pathSetting` is empty/undefined the default
 * "collections-rest-client" directory under the workspace root is used.
 */
export function getRestClientExportFolder(workspaceFolder: string, pathSetting?: string): string {
    const defaultName = 'collections-rest-client';
    let candidate = pathSetting && pathSetting.trim() ? pathSetting.trim() : defaultName;
    if (path.isAbsolute(candidate)) {
        return candidate;
    }
    // treat as relative to workspace
    return path.join(workspaceFolder, candidate);
}

/**
 * Perform a complete export for a given collection ID into the specified folder.
 * This includes the collection requests and environment exports (honoring the
 * mergeGlobals workspace setting).
 */
export async function exportCollectionToRestClient(
    collectionService: ICollectionService,
    envConfigService: IEnvironmentConfigService,
    collectionId: string,
    targetFolder: string,
    mergeGlobals: boolean
): Promise<void> {
    // ensure collection structure written first
    await collectionService.exportCollectionAsRestClientFolder(collectionId, targetFolder);
    envConfigService.exportEnvironmentsToFolder(targetFolder, mergeGlobals);
}

/**
 * Recursively write a folder's items (folders and requests) into the output path.
 */
export function writeFolderItems(items: CollectionItem[], dest: string, collection: Collection): void {
    items.forEach(item => {
        if (item.type === 'folder') {
            const dir = path.join(dest, sanitizeName(item.name));
            fs.mkdirSync(dir, { recursive: true });
            writeScriptFile(dir, sanitizeName(item.name), item.scripts);
            writeFolderItems(item.items || [], dir, collection);
        } else if (item.type === 'request') {
            const req = item as CollectionRequestItem;
            const fileName = sanitizeName(req.name) + '.http';
            const filePath = path.join(dest, fileName);
            const content = renderRequestFile(req, collection);
            fs.writeFileSync(filePath, content, 'utf-8');
            writeScriptFile(dest, sanitizeName(req.name), req.scripts);
        }
    });
}

/**
 * Build request file contents for a single request.
 */
function renderRequestFile(item: CollectionRequestItem, collection: Collection): string {
    const lines: string[] = [];
    lines.push(`### ${collection.name} / ${item.name}`);
    lines.push(`# collection env: ${sanitizeName(collection.name)}.env`);
    lines.push(`# request scripts: ${sanitizeName(item.name)}.pre.js and .post.js`);

    const url = buildUrl(item);
    lines.push(`${item.method} ${url}`);
    (item.headers || []).filter(h => h.enabled !== false).forEach(h => {
        lines.push(`${h.key}: ${h.value}`);
    });
    if (item.body && item.body.content) {
        lines.push('', item.body.content);
    }
    return lines.join('\n');
}

/**
 * Build URL string including query parameters
 */
function buildUrl(req: CollectionRequestItem): string {
    let url = req.url;
    if (req.query && req.query.length) {
        const qs = req.query
            .filter(q => q.enabled !== false)
            .map(q => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`)
            .join('&');
        if (qs) {
            url += (url.includes('?') ? '&' : '?') + qs;
        }
    }
    return url;
}
