/**
 * Request Preprocessor
 * 
 * Extracted 100% from VS Code plugin: src/services/request-preprocessor.ts
 * 
 * Single Responsibility: Handles request preparation (header sanitization, body encoding)
 * DO NOT modify the core logic - it has been tested and is reliable.
 */

import { RequestBody } from '../../types/types';
import { sanitizeHeaderValue, sanitizeHeaders as sanitizeAllHeaders } from './header-utils';

/**
 * Request Preprocessor Interface
 * Same as plugin's IRequestPreprocessor
 */
export interface IRequestPreprocessor {
    /**
     * Sanitize header value to remove/replace invalid characters
     */
    sanitizeHeaderValue(value: string): string;

    /**
     * Sanitize all headers
     */
    sanitizeHeaders(headers: Record<string, string>): Record<string, string>;

    /**
     * Encode body from RequestBody wrapped format
     */
    encodeBody(body: RequestBody | null | undefined): any;

    /**
     * Set Content-Type header based on RequestBody if not already set
     */
    setContentTypeHeader(
        headers: Record<string, string>,
        body: RequestBody | null | undefined,
        bodyContentType?: string
    ): void;
}

/**
 * Content type mappings for different body types
 * Same as plugin's CONTENT_TYPE_MAP
 */
const CONTENT_TYPE_MAP: Record<string, string> = {
    'json': 'application/json',
    'xml': 'application/xml',
    'html': 'text/html',
    'text': 'text/plain',
    'javascript': 'application/javascript',
    'css': 'text/css',
    'x-www-form-urlencoded': 'application/x-www-form-urlencoded',
    'form-data': 'multipart/form-data',
    'graphql': 'application/json'
};

/**
 * Request Preprocessor implementation
 * 
 * Extracted 100% from plugin's RequestPreprocessor class
 * 
 * Handles:
 * - Header sanitization (removing invalid characters)
 * - Body encoding (URL encoding, JSON, etc.)
 * - Content-Type header management
 */
export class RequestPreprocessor implements IRequestPreprocessor {
    /**
     * Sanitize header value to remove/replace invalid characters
     * Node.js http module doesn't allow certain characters in header values
     * 
     * Same implementation as plugin's RequestPreprocessor.sanitizeHeaderValue
     */
    public sanitizeHeaderValue(value: string): string {
        return sanitizeHeaderValue(value);
    }

    /**
     * Sanitize all headers
     * Same implementation as plugin's RequestPreprocessor.sanitizeHeaders
     */
    public sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
        return sanitizeAllHeaders(headers);
    }

    /**
     * Encode body from RequestBody wrapped format
     * Extracts type and content, encodes based on body type
     * 
     * Same implementation as plugin's RequestPreprocessor.encodeBody
     */
    public encodeBody(body: RequestBody | null | undefined): any {
        if (!body || body.type === 'none') return null;

        const { type, content } = body;

        switch (type) {
            case 'x-www-form-urlencoded':
                return this.encodeUrlEncodedBody(content);

            case 'form-data':
                // Keep the Postman-style array representation here for compatibility.
                // Execution layers convert this into native FormData before sending,
                // so fetch can generate the multipart boundary automatically.
                return content;

            case 'graphql':
                return this.encodeGraphQLBody(content);

            case 'raw':
                // Raw body - return as-is (will be stringified by HTTP client if needed)
                return content;

            case 'binary':
            default:
                // Binary/unknown - return as-is
                return content;
        }
    }

    /**
     * Encode URL-encoded body
     * Same implementation as plugin's RequestPreprocessor.encodeUrlEncodedBody
     */
    private encodeUrlEncodedBody(content: any): string {
        // Convert array of {key, value, enabled} to URL encoded string
        if (Array.isArray(content)) {
            const params = new URLSearchParams();
            for (const item of content) {
                if (item.enabled !== false && item.key) {
                    params.append(item.key, item.value || '');
                }
            }
            return params.toString();
        }
        // If already a string, return as-is
        return typeof content === 'string' ? content : String(content);
    }

    /**
     * Encode GraphQL body
     * Same implementation as plugin's RequestPreprocessor.encodeGraphQLBody
     */
    private encodeGraphQLBody(content: any): string {
        // If content is a raw string (e.g. loaded from body.graphql file),
        // parse it first so we can normalise the variables field below.
        if (typeof content === 'string') {
            try {
                content = JSON.parse(content);
            } catch {
                // Not valid JSON — send as-is (plain query string)
                return content;
            }
        }

        // GraphQL body should be { query: string, variables?: object }
        if (typeof content === 'object' && content !== null && content.query) {
            // variables is stored as a JSON-encoded string in body.graphql files
            // (the UI variables editor stores text). Parse it into an object so
            // the GraphQL server receives a proper variables object, not a string.
            let variables = content.variables;
            if (typeof variables === 'string') {
                try {
                    variables = variables.trim() ? JSON.parse(variables) : undefined;
                } catch {
                    variables = undefined;
                }
            }

            return JSON.stringify({
                query: content.query,
                ...(variables !== undefined && variables !== null ? { variables } : {}),
                ...(content.operationName ? { operationName: content.operationName } : {})
            });
        }

        return JSON.stringify(content);
    }

    /**
     * Set Content-Type header based on RequestBody if not already set
     * Same implementation as plugin's RequestPreprocessor.setContentTypeHeader
     */
    public setContentTypeHeader(
        headers: Record<string, string>,
        body: RequestBody | null | undefined,
        bodyContentType?: string
    ): void {
        // Check if Content-Type is already set (case-insensitive)
        const hasContentType = Object.keys(headers).some(
            key => key.toLowerCase() === 'content-type'
        );

        if (hasContentType) {
            return; // Don't override existing Content-Type
        }

        // Use bodyContentType if provided (from request-builder.js)
        if (bodyContentType) {
            headers['Content-Type'] = bodyContentType;
            return;
        }

        // No body or none type - no Content-Type needed
        if (!body || body.type === 'none') {
            return;
        }

        // Determine Content-Type based on body type
        let contentType: string | undefined;

        switch (body.type) {
            case 'x-www-form-urlencoded':
                contentType = CONTENT_TYPE_MAP['x-www-form-urlencoded'];
                break;
            case 'raw':
                // Set Content-Type based on raw format (json, xml, html, text, javascript)
                contentType = body.format ? CONTENT_TYPE_MAP[body.format] : 'text/plain';
                if (!contentType) {
                    contentType = 'text/plain'; // Default for unknown raw formats
                }
                break;
            case 'graphql':
                contentType = CONTENT_TYPE_MAP['graphql'];
                break;
            case 'binary':
                // Binary defaults to application/octet-stream if not specified
                contentType = 'application/octet-stream';
                break;
            // Multipart bodies are handled by the execution layer. If callers send a
            // raw multipart body themselves, they must provide a complete boundary-aware
            // Content-Type header.
        }

        if (contentType) {
            headers['Content-Type'] = contentType;
        }
    }
}
