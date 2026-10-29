/**
 * HTTP Forge Collection Parser Adapter - Implements ICollectionParser
 * 
 * Wraps existing HttpForgeParser to conform to the port interface
 */

import { ICollectionParser } from '../../ports/parsers/collection-parser.interface';
import { UnifiedCollection } from '../../types/types';
import { HttpForgeParser } from './http-forge-parser';

/**
 * Adapter that implements ICollectionParser for HTTP Forge format
 */
export class HttpForgeCollectionParserAdapter implements ICollectionParser {
    private parser = new HttpForgeParser();

    get supportedFormats(): string[] {
        return ['http-forge', 'json'];
    }

    canHandle(content: string, format?: string): boolean {
        if (format && ['http-forge', 'json'].includes(format)) {
            return true;
        }

        // Try to detect JSON format
        try {
            const obj = JSON.parse(content);
            // Check if it looks like HTTP Forge collection
            return typeof obj === 'object' && 
                   obj !== null &&
                   ('items' in obj || 'requests' in obj || 'name' in obj);
        } catch {
            return false;
        }
    }

    async parse(content: string): Promise<UnifiedCollection> {
        return this.parser.parse(content, '');
    }
}

/**
 * Collection Parser Registry - Manages multiple parsers
 * 
 * Implements ICollectionParser by delegating to registered parsers
 */
export class CollectionParserRegistry implements ICollectionParser {
    private parsers: ICollectionParser[] = [];

    constructor(initialParsers?: ICollectionParser[]) {
        this.parsers = initialParsers || [];
    }

    /**
     * Register a parser
     */
    register(parser: ICollectionParser): void {
        this.parsers.push(parser);
    }

    get supportedFormats(): string[] {
        const formats = new Set<string>();
        for (const parser of this.parsers) {
            for (const format of parser.supportedFormats) {
                formats.add(format);
            }
        }
        return Array.from(formats);
    }

    canHandle(content: string, format?: string): boolean {
        return this.parsers.some(p => p.canHandle(content, format));
    }

    async parse(content: string, format?: string): Promise<UnifiedCollection> {
        // Try to find a matching parser
        let matchingParser: ICollectionParser | undefined;

        if (format) {
            // If format specified, look for exact match
            matchingParser = this.parsers.find(
                p => p.supportedFormats.includes(format)
            );
        }

        // If no format specified or no exact match, try parsers in order
        if (!matchingParser) {
            for (const parser of this.parsers) {
                if (parser.canHandle(content, format)) {
                    matchingParser = parser;
                    break;
                }
            }
        }

        if (!matchingParser) {
            throw new Error(
                `No parser found for format: ${format || 'unknown'}. ` +
                `Supported formats: ${this.supportedFormats.join(', ')}`
            );
        }

        return matchingParser.parse(content);
    }
}
