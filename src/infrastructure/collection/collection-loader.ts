/**
 * Collection Loader Service
 * 
 * Single Responsibility: Load collections from file system
 * Dependency Inversion: Uses IFileSystem and ParserRegistry abstractions
 */

import { IFileSystem } from '../../types/platform';
import { UnifiedCollection } from '../../types/types';
import type { ICollectionLoader } from '../../types/collection';
import { ParserRegistry } from './parser-registry';

/**
 * Options for loading a collection
 */
export interface LoadOptions {
    /** Force a specific format parser */
    format?: string;
}

/**
 * Service for loading collections from files (single-file format)
 * Implements ICollectionLoader for interoperability with FolderCollectionLoader
 */
export class CollectionLoader implements ICollectionLoader {
    private directory?: string;
    
    constructor(
        private readonly fileSystem: IFileSystem,
        private readonly parserRegistry: ParserRegistry
    ) {}
    
    /**
     * Set directory for loadAll()
     */
    setDirectory(dirPath: string): void {
        this.directory = dirPath;
    }
    
    /**
     * Load all collections from configured directory
     * Implements ICollectionLoader
     */
    async loadAll(): Promise<UnifiedCollection[]> {
        if (!this.directory) {
            return [];
        }
        return this.loadDirectory(this.directory);
    }
    
    /**
     * Load a collection from a file path
     */
    async load(filePath: string, options: LoadOptions = {}): Promise<UnifiedCollection> {
        const content = await this.fileSystem.readFile(filePath);
        
        // Find appropriate parser
        if (options.format) {
            const parser = this.parserRegistry.get(options.format);
            if (!parser) {
                throw new Error(`No parser registered for format: ${options.format}`);
            }
            return parser.parse(content, filePath);
        }
        
        // Auto-detect format
        const detected = this.parserRegistry.detect(content);
        if (!detected) {
            throw new Error(`Could not detect collection format for: ${filePath}. Supported formats: ${this.parserRegistry.getFormats().join(', ')}`);
        }
        
        return detected.parser.parse(content, filePath);
    }
    
    /**
     * Load multiple collections from a directory
     */
    async loadDirectory(dirPath: string, patterns: string[] = ['*.json', '*.forge.json']): Promise<UnifiedCollection[]> {
        const collections: UnifiedCollection[] = [];
        
        const files = await this.fileSystem.glob(patterns, dirPath);
        
        for (const file of files) {
            try {
                const collection = await this.load(file);
                collections.push(collection);
            } catch (error) {
                // Skip files that can't be parsed as collections
            }
        }
        
        return collections;
    }
    
    /**
     * Check if a file can be loaded as a collection
     */
    async canLoad(filePath: string): Promise<boolean> {
        try {
            if (!await this.fileSystem.exists(filePath)) {
                return false;
            }
            const content = await this.fileSystem.readFile(filePath);
            return this.parserRegistry.detect(content) !== null;
        } catch {
            return false;
        }
    }
    
    /**
     * Get supported formats
     */
    getSupportedFormats(): string[] {
        return this.parserRegistry.getFormats();
    }
}
