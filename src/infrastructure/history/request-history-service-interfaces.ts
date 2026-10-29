/**
 * Request History Service Interface
 * 
 * Interface Segregation: Separated into focused sub-interfaces
 * Dependency Inversion: Consumers depend on this abstraction
 */

import { FullResponse, HistoryEntry, RequestHistory } from './history-interfaces';
export type { FullResponse, HistoryEntry, RequestHistory };

/**
 * History read operations
 */
export interface IHistoryReader {
    loadHistory(environment: string, requestPath: string, requestId: string): RequestHistory | null;
    loadSharedHistory(environment: string, requestPath: string, requestId: string): RequestHistory | null;
    getEntriesForEnvironment(environment: string, storagePath: string, endpointId: string): HistoryEntry[];
    getEntriesGroupedByTicket(environment: string, storagePath: string, endpointId: string): Map<string, HistoryEntry[]>;
    getSharedEntriesGroupedByTicket(environment: string, storagePath: string, endpointId: string): Map<string, HistoryEntry[]>;
}

/**
 * History write operations
 */
export interface IHistoryWriter {
    addEntry(environment: string, storagePath: string, endpointId: string, method: string, entry: Omit<HistoryEntry, 'id' | 'timestamp' | 'method'>): HistoryEntry;
    deleteEntry(environment: string, storagePath: string, endpointId: string, entryId: string): boolean;
    deleteSharedEntry(environment: string, storagePath: string, endpointId: string, entryId: string): boolean;
    clearHistory(environment: string, storagePath: string, endpointId: string): void;
    shareEntry(environment: string, storagePath: string, endpointId: string, entryId: string, tag: string): boolean;
    moveSharedEntry(environment: string, storagePath: string, endpointId: string, entryId: string, tag: string): boolean;
    renameSharedGroup(environment: string, storagePath: string, endpointId: string, oldTag: string, newTag: string): boolean;
}

/**
 * Full response storage operations
 */
export interface IResponseStorage {
    saveFullResponse(environment: string, requestPath: string, requestId: string, entryId: string, response: FullResponse, secretValues?: readonly string[]): void;
    loadFullResponse(environment: string, requestPath: string, requestId: string, entryId: string): FullResponse | null;
    loadSharedFullResponse(environment: string, requestPath: string, requestId: string, entryId: string): FullResponse | null;
}

/**
 * Full request history service interface
 */
export interface IRequestHistoryService extends IHistoryReader, IHistoryWriter, IResponseStorage {}
