/**
 * Request Object Factory
 *
 * Single Responsibility: Build the Postman-compatible pm.request object proxy
 * with getters/setters for modification tracking.
 *
 * Maps HTTP Forge body types to Postman modes for script API compatibility.
 */

import { createPostmanUrl } from './script-factories';

export function createRequestObject(modifiedRequest: any, context: any) {
    // Helper: Map HTTP Forge type to Postman mode
    const typeToMode = (type?: string): string => {
        if (!type) return 'none';
        switch (type) {
            case 'raw': return 'raw';
            case 'form-data': return 'formdata';
            case 'x-www-form-urlencoded': return 'urlencoded';
            case 'binary': return 'file';
            case 'graphql': return 'graphql';
            case 'none': return 'none';
            default: return 'raw';
        }
    };

    // Helper: Map Postman mode to HTTP Forge type
    const modeToType = (mode?: string): string => {
        if (!mode) return 'none';
        switch (mode) {
            case 'raw': return 'raw';
            case 'formdata': return 'form-data';
            case 'urlencoded': return 'x-www-form-urlencoded';
            case 'file': return 'binary';
            case 'graphql': return 'graphql';
            case 'none': return 'none';
            default: return 'raw';
        }
    };

    const headersProxy = {
        ...modifiedRequest.headers,
        add: (headerObj: { key: string; value: string }) => {
            if (headerObj && headerObj.key) {
                modifiedRequest.headers[headerObj.key] = headerObj.value || '';
            }
        },
        get: (headerName: string) => {
            for (const [key, value] of Object.entries(modifiedRequest.headers)) {
                if (key.toLowerCase() === headerName.toLowerCase()) {
                    return value;
                }
            }
            return undefined;
        },
        has: (headerName: string) => {
            for (const key of Object.keys(modifiedRequest.headers)) {
                if (key.toLowerCase() === headerName.toLowerCase()) {
                    return true;
                }
            }
            return false;
        },
        remove: (headerName: string) => {
            for (const key of Object.keys(modifiedRequest.headers)) {
                if (key.toLowerCase() === headerName.toLowerCase()) {
                    delete modifiedRequest.headers[key];
                    break;
                }
            }
        },
        update: (headerObj: { key: string; value: string }) => {
            if (headerObj && headerObj.key) {
                for (const key of Object.keys(modifiedRequest.headers)) {
                    if (key.toLowerCase() === headerObj.key.toLowerCase()) {
                        modifiedRequest.headers[key] = headerObj.value || '';
                        return;
                    }
                }
            }
        },
        upsert: (headerObj: { key: string; value: string }) => {
            if (headerObj && headerObj.key) {
                for (const key of Object.keys(modifiedRequest.headers)) {
                    if (key.toLowerCase() === headerObj.key.toLowerCase()) {
                        modifiedRequest.headers[key] = headerObj.value || '';
                        return;
                    }
                }
                modifiedRequest.headers[headerObj.key] = headerObj.value || '';
            }
        },
        toObject: () => {
            const obj: Record<string, string> = {};
            for (const [key, value] of Object.entries(modifiedRequest.headers)) {
                if (typeof value === 'string') {
                    obj[key] = value;
                }
            }
            return obj;
        },
        each: (cb: (header: { key: string; value: string }) => void) => {
            for (const [key, value] of Object.entries(modifiedRequest.headers)) {
                if (typeof value === 'string') {
                    cb({ key, value });
                }
            }
        }
    };

    const bodyProxy = {
        get mode() { return typeToMode(modifiedRequest.body?.type); },
        set mode(value: string) {
            const forgeType = modeToType(value);
            if (!modifiedRequest.body) {
                modifiedRequest.body = { type: forgeType, content: null };
            } else {
                modifiedRequest.body.type = forgeType;
            }
        },
        
        get raw() {
            const content = modifiedRequest.body?.content;
            if (typeof content === 'string') {
                return content;
            } else if (content && typeof content === 'object') {
                return JSON.stringify(content);
            }
            return '';
        },
        set raw(value: string) {
            if (!modifiedRequest.body) {
                modifiedRequest.body = { type: 'raw', content: value };
            } else {
                modifiedRequest.body.type = 'raw';
                modifiedRequest.body.content = value;
            }
        },
        
        get formdata() {
            if (modifiedRequest.body?.type === 'form-data' && Array.isArray(modifiedRequest.body.content)) {
                return modifiedRequest.body.content;
            }
            return [];
        },
        
        get urlencoded() {
            if (modifiedRequest.body?.type === 'x-www-form-urlencoded' && Array.isArray(modifiedRequest.body.content)) {
                return modifiedRequest.body.content;
            }
            return [];
        },
        
        get graphql() {
            if (modifiedRequest.body?.type === 'graphql') {
                return modifiedRequest.body.content;
            }
            return null;
        },
        
        get file() {
            if (modifiedRequest.body?.type === 'binary') {
                return modifiedRequest.body.content;
            }
            return null;
        }
    };

    return {
        get url() { return createPostmanUrl(modifiedRequest.url); },
        set url(value: any) { modifiedRequest.url = typeof value === 'string' ? value : String(value); },
        get method() { return modifiedRequest.method; },
        set method(value: string) { modifiedRequest.method = value; },
        headers: headersProxy,
        
        get body() { return bodyProxy; },
        set body(value: any) { 
            if (value === null || value === undefined) {
                modifiedRequest.body = null;
            } else if (typeof value === 'string') {
                modifiedRequest.body = { type: 'raw', content: value };
            } else if (typeof value === 'object') {
                if (value.type || value.mode || value.content !== undefined) {
                    const forgeType = value.mode ? modeToType(value.mode) : (value.type || 'raw');
                    modifiedRequest.body = {
                        type: forgeType,
                        format: value.format,
                        content: value.content
                    };
                } else {
                    modifiedRequest.body = { type: 'raw', content: value };
                }
            }
        },

        get params() { return modifiedRequest.params || {}; },
        set params(value: any) { modifiedRequest.params = value || {}; },
        get query() { return modifiedRequest.query || {}; },
        set query(value: any) { modifiedRequest.query = value || {}; },

        get auth() { return context.request?.auth || null; },
        set auth(value: any) {
            if (context.request) { context.request.auth = value; }
        },

        get certificate() { return context.request?.certificate || null; },
        set certificate(value: any) {
            if (context.request) { context.request.certificate = value; }
        },

        get description() { return context.request?.description || null; },
        set description(value: any) {
            if (context.request) { context.request.description = value; }
        },
        get name() { return context.request?.name || null; },
        set name(value: string) {
            if (context.request) { context.request.name = value; }
        },
        get id() { return context.request?.id || null; },
        get disabled() { return context.request?.disabled || false; },
        set disabled(value: boolean) {
            if (context.request) { context.request.disabled = value; }
        },
        get messages() { return context.request?.messages || []; },
        get methodPath() { return context.request?.methodPath || null; },
        get metadata() { return context.request?.metadata || []; },

        getHeaders(options?: any) {
            const headersObj: Record<string, string> = {};
            for (const [key, value] of Object.entries(modifiedRequest.headers)) {
                if (typeof value === 'string') {
                    headersObj[key] = value;
                }
            }
            return headersObj;
        },

        addQueryParams(params: any[] | string) {
            if (typeof params === 'string') {
                const parsed = new URLSearchParams(params);
                for (const [key, value] of parsed) {
                    if (!modifiedRequest.query) modifiedRequest.query = {};
                    modifiedRequest.query[key] = value;
                }
            } else if (Array.isArray(params)) {
                if (!modifiedRequest.query) modifiedRequest.query = {};
                params.forEach((param: any) => {
                    if (param.key) {
                        modifiedRequest.query[param.key] = param.value || '';
                    }
                });
            }
        },

        removeQueryParams(params: string | string[] | any[]) {
            if (!modifiedRequest.query) return;
            if (typeof params === 'string') {
                delete modifiedRequest.query[params];
            } else if (Array.isArray(params)) {
                params.forEach((param: any) => {
                    const key = typeof param === 'string' ? param : param.key;
                    if (key) { delete modifiedRequest.query[key]; }
                });
            }
        },

        authorizeUsing(type: string | any, options?: any) {
            if (!context.request) return;
            if (typeof type === 'string') {
                if (!context.request.auth) { context.request.auth = {}; }
                context.request.auth.type = type;
                if (options) { context.request.auth.parameters = options; }
            } else if (typeof type === 'object') {
                context.request.auth = type;
            }
        },

        clone() {
            return {
                url: modifiedRequest.url,
                method: modifiedRequest.method,
                headers: { ...modifiedRequest.headers },
                body: modifiedRequest.body ? { ...modifiedRequest.body } : null,
                params: modifiedRequest.params ? { ...modifiedRequest.params } : {},
                query: modifiedRequest.query ? { ...modifiedRequest.query } : {},
                auth: context.request?.auth,
                certificate: context.request?.certificate,
                description: context.request?.description,
                name: context.request?.name,
                id: context.request?.id,
                disabled: context.request?.disabled,
                metadata: context.request?.metadata,
                messages: context.request?.messages,
                methodPath: context.request?.methodPath
            };
        },

        describe(content: string, type?: string) {
            if (!context.request) return;
            context.request.description = {
                content: content,
                type: type || 'text/plain'
            };
        },

        // Legacy HTTP Forge methods
        setHeader(name: string, value: string) {
            modifiedRequest.headers[name] = value;
        },
        // Postman alias for setHeader
        addHeader(header: string | { key: string; value: string }, value?: string) {
            if (typeof header === 'object' && header !== null) {
                modifiedRequest.headers[header.key] = header.value;
            } else {
                modifiedRequest.headers[header] = value as string;
            }
        },
        removeHeader(name: string) {
            delete modifiedRequest.headers[name];
        },
        setBody(content: any, bodyType?: string, rawFormat?: string) {
            modifiedRequest.body = {
                type: bodyType || modifiedRequest.body?.type || 'raw',
                format: rawFormat || modifiedRequest.body?.format,
                content
            };
        }
    };
}
