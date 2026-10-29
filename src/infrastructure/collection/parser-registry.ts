/**
 * Parser Registry Service
 * 
 * Open/Closed Principle: New parsers can be added without modifying existing code
 * Single Responsibility: Manage collection parser registration and lookup
 */

import type { ICollectionParser } from '../../types/collection';

/**
 * Registry for collection parsers
 * Allows registering parsers for different collection formats
 */
export class ParserRegistry {
    private parsers: Map<string, ICollectionParser> = new Map();
    
    /**
     * Register a parser for a format
     * @param format Format identifier (e.g., 'http-forge', 'postman', 'insomnia')
     * @param parser Parser implementation
     */
    register(format: string, parser: ICollectionParser): void {
        this.parsers.set(format.toLowerCase(), parser);
    }
    
    /**
     * Get a parser by format
     * @param format Format identifier
     * @returns Parser or undefined if not found
     */
    get(format: string): ICollectionParser | undefined {
        return this.parsers.get(format.toLowerCase());
    }
    
    /**
     * Check if a parser is registered for a format
     * @param format Format identifier
     */
    has(format: string): boolean {
        return this.parsers.has(format.toLowerCase());
    }
    
    /**
     * Get all registered format names
     */
    getFormats(): string[] {
        return Array.from(this.parsers.keys());
    }
    
    /**
     * Try to detect format and find appropriate parser
     * @param content Raw file content
     * @returns Parser and detected format, or null if not recognized
     */
    detect(content: string): { parser: ICollectionParser; format: string } | null {
        for (const [format, parser] of this.parsers) {
            if (parser.canParse(content)) {
                return { parser, format };
            }
        }
        return null;
    }
    
    /**
     * Clear all registered parsers
     */
    clear(): void {
        this.parsers.clear();
    }
}
