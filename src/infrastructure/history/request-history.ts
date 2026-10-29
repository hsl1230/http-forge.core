/**
 * Request History - In-Memory Implementation
 * 
 * Core package version - memory-based, no persistence
 * Consumers can extend or replace with persistent storage if needed
 * 
 * Based on VS Code plugin's RequestHistoryService logic,
 * but adapted for storage-agnostic design.
 */

import { HttpRequest, HttpResponse } from '../../types/types';
import {
    FullResponse,
    HistoryEntry,
    IRequestHistory
} from './history-interfaces';

/**
 * Generate a simple UUID
 */
function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * In-memory request history storage
 * 
 * Features:
 * - Stores history entries in memory
 * - Automatic cleanup when maxEntriesPerRequest is exceeded
 * - Optional full response storage
 * - No persistence (resets on process restart)
 */
export class RequestHistoryStore implements IRequestHistory {
    /** Map of entryId -> HistoryEntry */
    private entries: Map<string, HistoryEntry> = new Map();
    
    /** Map of requestId -> entryIds (ordered, newest first) */
    private requestIndex: Map<string, string[]> = new Map();
    
    /** Map of entryId -> FullResponse */
    private fullResponses: Map<string, FullResponse> = new Map();
    
    /** Maximum entries per request */
    maxEntriesPerRequest: number;
    
    /** Whether to store full responses */
    private storeFullResponses: boolean;

    constructor(options: {
        maxEntriesPerRequest?: number;
        storeFullResponses?: boolean;
    } = {}) {
        this.maxEntriesPerRequest = options.maxEntriesPerRequest ?? 100;
        this.storeFullResponses = options.storeFullResponses ?? true;
    }

    /**
     * Get all entries for a request
     */
    getEntries(requestId: string, environment?: string): HistoryEntry[] {
        const entryIds = this.requestIndex.get(requestId) || [];
        const entries: HistoryEntry[] = [];
        
        for (const id of entryIds) {
            const entry = this.entries.get(id);
            if (entry) {
                if (!environment || entry.environment === environment) {
                    entries.push(entry);
                }
            }
        }
        
        return entries;
    }

    /**
     * Get a specific entry by ID
     */
    getEntry(entryId: string): HistoryEntry | undefined {
        return this.entries.get(entryId);
    }

    /**
     * Get full response for an entry
     */
    getFullResponse(entryId: string): FullResponse | undefined {
        return this.fullResponses.get(entryId);
    }

    /**
     * Get total entry count
     */
    get count(): number {
        return this.entries.size;
    }

    /**
     * Add a new history entry
     */
    addEntry(
        requestId: string,
        request: HttpRequest,
        response: HttpResponse,
        environment: string,
        metadata?: {
            ticket?: string;
            branch?: string;
            note?: string;
        }
    ): HistoryEntry {
        const entryId = generateUUID();
        const timestamp = Date.now();
        
        const entry: HistoryEntry = {
            id: entryId,
            timestamp,
            environment,
            method: request.method,
            ticket: metadata?.ticket,
            branch: metadata?.branch,
            note: metadata?.note,
            sentRequest: {
                url: request.url,
                method: request.method,
                headers: { ...request.headers },
                body: request.body
            },
            response: {
                status: response.status,
                statusText: response.statusText,
                time: response.time
            }
        };
        
        // Store entry
        this.entries.set(entryId, entry);
        
        // Update request index (newest first)
        const entryIds = this.requestIndex.get(requestId) || [];
        entryIds.unshift(entryId);
        
        // Cleanup old entries if exceeding limit
        while (entryIds.length > this.maxEntriesPerRequest) {
            const oldId = entryIds.pop();
            if (oldId) {
                this.entries.delete(oldId);
                this.fullResponses.delete(oldId);
            }
        }
        
        this.requestIndex.set(requestId, entryIds);
        
        // Store full response if enabled
        if (this.storeFullResponses) {
            const fullResponse: FullResponse = {
                timestamp,
                status: response.status,
                statusText: response.statusText,
                headers: { ...response.headers },
                cookies: response.cookies || [],
                body: response.body,
                time: response.time
            };
            this.fullResponses.set(entryId, fullResponse);
        }
        
        return entry;
    }

    /**
     * Delete a specific entry
     */
    deleteEntry(entryId: string): boolean {
        const entry = this.entries.get(entryId);
        if (!entry) {
            return false;
        }
        
        // Remove from entries
        this.entries.delete(entryId);
        this.fullResponses.delete(entryId);
        
        // Remove from request index
        for (const [requestId, entryIds] of this.requestIndex.entries()) {
            const index = entryIds.indexOf(entryId);
            if (index !== -1) {
                entryIds.splice(index, 1);
                if (entryIds.length === 0) {
                    this.requestIndex.delete(requestId);
                }
                break;
            }
        }
        
        return true;
    }

    /**
     * Clear all history for a request
     */
    clearHistory(requestId: string): void {
        const entryIds = this.requestIndex.get(requestId);
        if (!entryIds) {
            return;
        }
        
        for (const id of entryIds) {
            this.entries.delete(id);
            this.fullResponses.delete(id);
        }
        
        this.requestIndex.delete(requestId);
    }

    /**
     * Clear all history
     */
    clearAll(): void {
        this.entries.clear();
        this.requestIndex.clear();
        this.fullResponses.clear();
    }
}
