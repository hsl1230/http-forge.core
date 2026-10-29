/**
 * Node.js File System Implementation
 * 
 * Single Responsibility: File operations using Node.js fs module
 * Dependency Inversion: Implements IFileSystem interface
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { IFileSystem } from '../../types/platform';

/**
 * Node.js implementation of IFileSystem.
 * Uses Node.js fs/promises for all operations.
 */
export class NodeFileSystem implements IFileSystem {
    /**
     * Read file contents as string
     */
    async readFile(filePath: string): Promise<string> {
        return fs.readFile(filePath, 'utf-8');
    }

    /**
     * Write string content to file
     */
    async writeFile(filePath: string, content: string): Promise<void> {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        await this.mkdir(dir);
        await fs.writeFile(filePath, content, 'utf-8');
    }

    /**
     * Check if file or directory exists
     */
    async exists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Create directory (recursive)
     */
    async mkdir(dirPath: string): Promise<void> {
        await fs.mkdir(dirPath, { recursive: true });
    }

    /**
     * List files matching glob pattern
     * Simple implementation using readdir + filter
     */
    async glob(patterns: string[], cwd?: string): Promise<string[]> {
        const directory = cwd || process.cwd();
        const results: string[] = [];
        
        try {
            await this.walkDirectory(directory, (filePath) => {
                const fileName = path.basename(filePath);
                for (const pattern of patterns) {
                    if (this.matchPattern(fileName, pattern)) {
                        results.push(filePath);
                        break;
                    }
                }
            });
        } catch {
            // Directory doesn't exist or can't be read
        }

        return results;
    }

    /**
     * Read directory contents
     */
    async readDir(dirPath: string): Promise<string[]> {
        return fs.readdir(dirPath);
    }

    /**
     * Check if path is a directory
     */
    async isDirectory(filePath: string): Promise<boolean> {
        try {
            const stat = await fs.stat(filePath);
            return stat.isDirectory();
        } catch {
            return false;
        }
    }

    /**
     * Walk directory recursively
     */
    private async walkDirectory(
        dir: string,
        callback: (filePath: string) => void
    ): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                await this.walkDirectory(fullPath, callback);
            } else if (entry.isFile()) {
                callback(fullPath);
            }
        }
    }

    /**
     * Simple glob pattern matching
     * Supports: *.ext, prefix*, *suffix
     */
    private matchPattern(fileName: string, pattern: string): boolean {
        // Convert glob pattern to regex
        const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*');
        
        const regex = new RegExp(`^${regexPattern}$`, 'i');
        return regex.test(fileName);
    }
}
