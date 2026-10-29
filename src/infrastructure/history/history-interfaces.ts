/**
 * Request History Types and Interfaces
 * 
 * Extracted from VS Code plugin: src/services/interfaces/request-history.interface.ts
 * Adapted for core package - storage-agnostic design
 */

import { HttpRequest, HttpResponse, RequestBody } from '../../types/types';

/**
 * History entry - records a single request execution
 */
export interface HistoryEntry {
    /** Unique entry ID */
    id: string;
    /** Timestamp of execution */
    timestamp: number;
    /** Associated ticket/issue number */
    ticket?: string | null;
    /** Git branch name */
    branch?: string;
    /** Environment used */
    environment: string;
    /** HTTP method */
    method: string;
    
    /** Actual HTTP request sent */
    sentRequest: {
        url: string;
        method: string;
        headers: Record<string, string>;
        body?: RequestBody | any | null;
        params?: Record<string, string>;
        query?: Record<string, string>;
    };

    /** Original request configuration (before variable resolution) */
    originalConfig?: {
        method: string;
        path: string;
        params: Record<string, string>;
        query: Record<string, string>;
        headers: Record<string, string>;
        body: RequestBody | null;
    };

    /** Request settings */
    settings?: {
        timeout?: number;
        followRedirects?: boolean;
        followOriginalMethod?: boolean;
        followAuthHeader?: boolean;
        maxRedirects?: number;
        strictSSL?: boolean;
        decompress?: boolean;
        includeCookies?: boolean;
    };

    /** Scripts associated with request */
    scripts?: {
        preRequest?: string;
        postResponse?: string;
    };
    
    /** Response summary */
    response: {
        status: number;
        statusText: string;
        time: number;
    };
    
    /** Optional note/comment */
    note?: string;
}

/**
 * Full response data (stored separately for large responses)
 */
export interface FullResponse {
    timestamp: number;
    status: number;
    statusText: string;
    headers: Record<string, string | string[]>;
    cookies: any[];
    body: any;
    time: number;
}

/**
 * Request history container
 */
export interface RequestHistory {
    environment: string;
    requestPath: string;
    requestId: string;
    method: string;
    requests: HistoryEntry[];
}

/**
 * History read operations
 */
export interface IHistoryReader {
    /**
     * Get all entries for a request
     */
    getEntries(requestId: string, environment?: string): HistoryEntry[];
    
    /**
     * Get a specific entry by ID
     */
    getEntry(entryId: string): HistoryEntry | undefined;
    
    /**
     * Get full response for an entry
     */
    getFullResponse(entryId: string): FullResponse | undefined;
    
    /**
     * Get entry count
     */
    readonly count: number;
}

/**
 * History write operations
 */
export interface IHistoryWriter {
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
    ): HistoryEntry;
    
    /**
     * Delete a specific entry
     */
    deleteEntry(entryId: string): boolean;
    
    /**
     * Clear all history for a request
     */
    clearHistory(requestId: string): void;
    
    /**
     * Clear all history
     */
    clearAll(): void;
}

/**
 * Full history service interface
 */
export interface IRequestHistory extends IHistoryReader, IHistoryWriter {
    /** Maximum entries to keep per request (oldest removed when exceeded) */
    maxEntriesPerRequest: number;
}
