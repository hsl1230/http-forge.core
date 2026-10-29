/**
 * HTTP Forge Collection Parser
 * 
 * Single Responsibility: Parse HTTP Forge collection format (.forge.json)
 * Dependency Inversion: Implements ICollectionParser interface
 */

import { ICollectionParser } from '../../types/collection';
import { CollectionAuth, RequestBody, RequestSettings, UnifiedCollection, UnifiedFolder, UnifiedRequest } from '../../types/types';

/**
 * HTTP Forge native collection format
 */
interface ForgeCollection {
    id: string;
    name: string;
    description?: string;
    version?: string;
    variables?: Record<string, string>;
    auth?: CollectionAuth;
    scripts?: {
        preRequest?: string;
        postResponse?: string;
    };
    items: ForgeItem[];
}

interface ForgeItem {
    id: string;
    type: 'request' | 'folder';
    name: string;
    description?: string;
    // Request-specific
    method?: string;
    url?: string;
    params?: Record<string, string>;
    query?: QueryParam[];
    headers?: HeaderParam[];
    body?: RequestBody;
    auth?: CollectionAuth;
    settings?: RequestSettings;
    scripts?: {
        preRequest?: string;
        postResponse?: string;
    };
    // Folder-specific
    items?: ForgeItem[];
}

interface QueryParam {
    key: string;
    value: string;
    enabled?: boolean;
}

interface HeaderParam {
    key: string;
    value: string;
    enabled?: boolean;
}

/**
 * Parser for HTTP Forge native collection format
 */
export class HttpForgeParser implements ICollectionParser {
    readonly format = 'http-forge';
    
    /**
     * Check if content is HTTP Forge format
     */
    canParse(content: string): boolean {
        try {
            const data = JSON.parse(content);
            return (
                typeof data === 'object' &&
                data !== null &&
                'id' in data &&
                'name' in data &&
                'items' in data &&
                Array.isArray(data.items) &&
                // Not Postman format (has info.schema)
                !data.info?.schema?.includes('postman') &&
                // Not Insomnia format (has _type)
                !data._type
            );
        } catch {
            return false;
        }
    }
    
    /**
     * Parse HTTP Forge collection content
     */
    parse(content: string, filePath: string): UnifiedCollection {
        const data = JSON.parse(content) as ForgeCollection;
        
        return {
            id: data.id,
            name: data.name,
            description: data.description,
            variables: data.variables || {},
            auth: data.auth,
            scripts: data.scripts ? {
                preRequest: data.scripts.preRequest,
                postResponse: data.scripts.postResponse
            } : undefined,
            items: this.convertItems(data.items),
            source: {
                format: 'http-forge',
                filePath,
                version: data.version
            }
        };
    }
    
    /**
     * Convert HTTP Forge items to unified format
     */
    private convertItems(items: ForgeItem[]): (UnifiedFolder | UnifiedRequest)[] {
        return items.map(item => {
            if (item.type === 'folder') {
                return this.convertFolder(item);
            } else {
                return this.convertRequest(item);
            }
        });
    }
    
    /**
     * Convert folder to unified format
     */
    private convertFolder(item: ForgeItem): UnifiedFolder {
        return {
            type: 'folder',
            id: item.id,
            name: item.name,
            description: item.description,
            auth: item.auth,
            scripts: item.scripts ? {
                preRequest: item.scripts.preRequest,
                postResponse: item.scripts.postResponse
            } : undefined,
            items: item.items ? this.convertItems(item.items) : []
        };
    }
    
    /**
     * Convert request to unified format
     */
    private convertRequest(item: ForgeItem): UnifiedRequest {
        // Convert headers from array to Record for fast lookup while normalizing
        const headers: Record<string, string> = {};
        if (item.headers) {
            for (const header of item.headers) {
                if (header.enabled !== false) {
                    headers[header.key] = header.value;
                }
            }
        }
        
        // Convert query params from array to Record
        const query: Record<string, string> = {};
        if (item.query) {
            for (const param of item.query) {
                if (param.enabled !== false) {
                    query[param.key] = param.value;
                }
            }
        }
        
        return {
            type: 'request',
            id: item.id,
            name: item.name,
            description: item.description,
            method: item.method || 'GET',
            url: item.url || '',
            headers: Object.entries(headers).map(([key, value]) => ({ key, value, enabled: true })),
            query: Object.entries(query).map(([key, value]) => ({ key, value, enabled: true })),
            params: item.params,
            body: item.body,
            auth: item.auth,
            settings: item.settings,
            scripts: item.scripts ? {
                preRequest: item.scripts.preRequest,
                postResponse: item.scripts.postResponse
            } : undefined
        };
    }
}
