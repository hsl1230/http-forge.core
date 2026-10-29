/**
 * Collection Parser Port - Abstract collection parsing
 * 
 * Implementations: HttpForgeParser, PostmanParser, OpenAPIParser
 */

import { UnifiedCollection } from '../../types/types';

/**
 * Collection Parser - Parses different collection formats
 */
export interface ICollectionParser {
    /**
     * Check if this parser can handle the content
     */
    canHandle(content: string, format?: string): boolean;

    /**
     * Parse collection from content
     */
    parse(content: string): Promise<UnifiedCollection>;

    /**
     * Supported formats (e.g., 'http-forge', 'postman', 'openapi')
     */
    readonly supportedFormats: string[];
}
