/**
 * Request History Service - File-based Implementation
 * 
 * Full-featured request history service with:
 * - File-based persistence (JSON files on disk)
 * - Shared history support (team-visible history)
 * - Ticket/branch grouping
 * - Separate full response file management
 * 
 * Ported from VS Code extension's RequestHistoryService.
 * No VS Code dependencies — uses only Node.js fs/path.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateUUID, sanitizeName } from '../../utils/helpers';
import { redactFullResponse, redactHistoryEntry } from '../security/sensitive-data-redactor';
import { FullResponse, HistoryEntry, RequestHistory } from './history-interfaces';
import {
    IRequestHistoryService
} from './request-history-service-interfaces';

/**
 * File-based request history service.
 * 
 * Path-helper methods are `protected` so consumers can subclass and
 * override the directory layout if needed.
 */
export class RequestHistoryService implements IRequestHistoryService {
    protected historyPath: string;
    protected sharedHistoryPath: string;

    constructor(historyPath: string, sharedHistoryPath: string) {
        this.historyPath = historyPath;
        this.sharedHistoryPath = sharedHistoryPath;
    }

    // ── Path helpers ────────────────────────────────────────────

    /**
     * Get history folder path for environment
     */
    protected getEnvironmentHistoryPath(environment: string): string {
        return path.join(this.historyPath, sanitizeName(environment));
    }

    /**
     * Get history folder path for a collection within an environment
     */
    protected getCollectionHistoryPath(environment: string, collectionPath: string): string {
        return path.join(this.getEnvironmentHistoryPath(environment), collectionPath);
    }

    /**
     * Get request directory path
     */
    protected getRequestPath(environment: string, requestPath: string, requestId: string): string {
        return path.join(this.getCollectionHistoryPath(environment, requestPath), sanitizeName(requestId));
    }

    /**
     * Get shared history folder path for environment
     */
    protected getSharedEnvironmentHistoryPath(environment: string): string {
        return path.join(this.sharedHistoryPath, sanitizeName(environment));
    }

    /**
     * Get shared history folder path for a collection within an environment
     */
    protected getSharedCollectionHistoryPath(environment: string, collectionPath: string): string {
        return path.join(this.getSharedEnvironmentHistoryPath(environment), collectionPath);
    }

    /**
     * Get shared request directory path
     */
    protected getSharedRequestPath(environment: string, requestPath: string, requestId: string): string {
        return path.join(this.getSharedCollectionHistoryPath(environment, requestPath), sanitizeName(requestId));
    }

    /**
     * Get history file path for a request
     */
    protected getHistoryFilePath(environment: string, requestPath: string, requestId: string): string {
        return path.join(this.getRequestPath(environment, requestPath, requestId), 'transactions.json');
    }

    /**
     * Get shared history file path for a request
     */
    protected getSharedHistoryFilePath(environment: string, requestPath: string, requestId: string): string {
        return path.join(this.getSharedRequestPath(environment, requestPath, requestId), 'transactions.json');
    }

    /**
     * Get full response file path
     */
    protected getResponseFilePath(environment: string, requestPath: string, requestId: string, entryId: string): string {
        return path.join(this.getRequestPath(environment, requestPath, requestId), `${entryId}.json`);
    }

    /**
     * Get shared full response file path
     */
    protected getSharedResponseFilePath(environment: string, requestPath: string, requestId: string, entryId: string): string {
        return path.join(this.getSharedRequestPath(environment, requestPath, requestId), `${entryId}.json`);
    }

    // ── IHistoryReader ──────────────────────────────────────────

    /**
     * Load history for a request
     */
    public loadHistory(environment: string, requestPath: string, requestId: string): RequestHistory | null {
        const filePath = this.getHistoryFilePath(environment, requestPath, requestId);

        try {
            if (!fs.existsSync(filePath)) {
                return null;
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content);

            const history: RequestHistory = {
                environment: environment || data.environment,
                requestPath: requestPath || data.requestPath,
                requestId: requestId || data.requestId,
                method: data.method,
                requests: data.requests
            };

            return history;
        } catch (error) {
            console.error(`Failed to load history for ${requestId}:`, error);
            return null;
        }
    }

    /**
     * Load shared history for a request
     */
    public loadSharedHistory(environment: string, requestPath: string, requestId: string): RequestHistory | null {
        const filePath = this.getSharedHistoryFilePath(environment, requestPath, requestId);

        try {
            if (!fs.existsSync(filePath)) {
                return null;
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content);

            const history: RequestHistory = {
                environment: environment || data.environment,
                requestPath: requestPath || data.requestPath,
                requestId: requestId || data.requestId,
                method: data.method,
                requests: data.requests
            };

            return history;
        } catch (error) {
            console.error(`Failed to load shared history for ${requestId}:`, error);
            return null;
        }
    }

    /**
     * Get history entries for a specific environment / request
     */
    public getEntriesForEnvironment(environment: string, requestPath: string, requestId: string): HistoryEntry[] {
        const history = this.loadHistory(environment, requestPath, requestId);
        if (!history) {
            return [];
        }
        return history.requests;
    }

    /**
     * Get history entries grouped by ticket/branch
     */
    public getEntriesGroupedByTicket(
        environment: string,
        requestPath: string,
        requestId: string
    ): Map<string, HistoryEntry[]> {
        const entries = this.getEntriesForEnvironment(environment, requestPath, requestId);
        const grouped = new Map<string, HistoryEntry[]>();

        for (const entry of entries) {
            const key = entry.ticket || entry.branch || '';
            if (!grouped.has(key)) {
                grouped.set(key, []);
            }
            grouped.get(key)!.push(entry);
        }

        return grouped;
    }

    /**
     * Get shared history entries grouped by ticket/branch
     */
    public getSharedEntriesGroupedByTicket(
        environment: string,
        requestPath: string,
        requestId: string
    ): Map<string, HistoryEntry[]> {
        const entries = this.loadSharedHistory(environment, requestPath, requestId)?.requests ?? [];
        const grouped = new Map<string, HistoryEntry[]>();

        for (const entry of entries) {
            const key = entry.ticket || entry.branch || '';
            if (!grouped.has(key)) {
                grouped.set(key, []);
            }
            grouped.get(key)!.push(entry);
        }

        return grouped;
    }

    // ── IHistoryWriter ──────────────────────────────────────────

    /**
     * Save history for a request (internal)
     */
    protected saveHistory(history: RequestHistory): void {
        const requestPath = this.getRequestPath(history.environment, history.requestPath, history.requestId);
        const filePath = this.getHistoryFilePath(history.environment, history.requestPath, history.requestId);

        try {
            if (!fs.existsSync(requestPath)) {
                fs.mkdirSync(requestPath, { recursive: true });
            }
            fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf-8');
        } catch (error) {
            console.error(`Failed to save history for ${history.requestId}:`, error);
            throw error;
        }
    }

    /**
     * Save shared history for a request (internal)
     */
    protected saveSharedHistory(history: RequestHistory): void {
        const requestPath = this.getSharedRequestPath(history.environment, history.requestPath, history.requestId);
        const filePath = this.getSharedHistoryFilePath(history.environment, history.requestPath, history.requestId);

        try {
            if (!fs.existsSync(requestPath)) {
                fs.mkdirSync(requestPath, { recursive: true });
            }
            fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf-8');
        } catch (error) {
            console.error(`Failed to save shared history for ${history.requestId}:`, error);
            throw error;
        }
    }

    /**
     * Add a new entry to the history
     */
    public addEntry(
        environment: string,
        requestPath: string,
        requestId: string,
        method: string,
        entry: Omit<HistoryEntry, 'id' | 'timestamp' | 'method'>
    ): HistoryEntry {
        let history = this.loadHistory(environment, requestPath, requestId);

        if (!history) {
            history = {
                environment,
                requestPath,
                requestId,
                method,
                requests: []
            };
        }

        const newEntry: HistoryEntry = redactHistoryEntry({
            ...entry,
            method,
            id: generateUUID(),
            timestamp: Date.now()
        });

        // Add to beginning (most recent first)
        history.requests.unshift(newEntry);

        // Limit history to last 100 entries
        if (history.requests.length > 100) {
            history.requests = history.requests.slice(0, 100);
        }

        this.saveHistory(history);
        return newEntry;
    }

    /**
     * Delete a specific entry
     */
    public deleteEntry(environment: string, requestPath: string, requestId: string, entryId: string): boolean {
        const history = this.loadHistory(environment, requestPath, requestId);
        if (!history) {
            return false;
        }

        const originalLength = history.requests.length;
        history.requests = history.requests.filter(entry => entry.id !== entryId);

        if (history.requests.length !== originalLength) {
            this.saveHistory(history);

            // Also delete the full response file if it exists
            const responseFilePath = this.getResponseFilePath(environment, requestPath, requestId, entryId);
            if (fs.existsSync(responseFilePath)) {
                fs.unlinkSync(responseFilePath);
            }

            return true;
        }
        return false;
    }

    /**
     * Delete a specific entry from shared history
     */
    public deleteSharedEntry(environment: string, requestPath: string, requestId: string, entryId: string): boolean {
        const history = this.loadSharedHistory(environment, requestPath, requestId);
        if (!history) {
            return false;
        }

        const originalLength = history.requests.length;
        history.requests = history.requests.filter(entry => entry.id !== entryId);

        if (history.requests.length !== originalLength) {
            this.saveSharedHistory(history);

            // Also delete the full response file if it exists
            const responseFilePath = this.getSharedResponseFilePath(environment, requestPath, requestId, entryId);
            if (fs.existsSync(responseFilePath)) {
                fs.unlinkSync(responseFilePath);
            }

            return true;
        }
        return false;
    }

    /**
     * Move entry to shared history and remove from local history
     */
    public shareEntry(environment: string, requestPath: string, requestId: string, entryId: string, tag: string): boolean {
        const tagName = (tag || '').trim();
        if (!tagName) {
            return false;
        }

        const history = this.loadHistory(environment, requestPath, requestId);
        if (!history) {
            return false;
        }

        const entryIndex = history.requests.findIndex(entry => entry.id === entryId);
        if (entryIndex === -1) {
            return false;
        }

        const [entry] = history.requests.splice(entryIndex, 1);
        this.saveHistory(history);

        const sharedHistory = this.loadSharedHistory(environment, requestPath, requestId) || {
            environment,
            requestPath,
            requestId,
            method: history.method,
            requests: []
        };

        if (!sharedHistory.requests.some(existing => existing.id === entryId)) {
            const sharedEntry: HistoryEntry = {
                ...entry,
                ticket: null,
                branch: tagName
            };
            sharedHistory.requests.unshift(sharedEntry);

            if (sharedHistory.requests.length > 100) {
                sharedHistory.requests = sharedHistory.requests.slice(0, 100);
            }

            this.saveSharedHistory(sharedHistory);
        }

        // Move the full response file from local to shared
        const sourceResponsePath = this.getResponseFilePath(environment, requestPath, requestId, entryId);
        const targetResponsePath = this.getSharedResponseFilePath(environment, requestPath, requestId, entryId);
        if (fs.existsSync(sourceResponsePath)) {
            const targetDir = path.dirname(targetResponsePath);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            try {
                // fast-path: rename (moves across same filesystem)
                fs.renameSync(sourceResponsePath, targetResponsePath);
            } catch (_renameErr) {
                // fallback: copy then remove source (handle cross-device / permission issues)
                try {
                    fs.copyFileSync(sourceResponsePath, targetResponsePath);
                } catch (copyErr) {
                    console.error(`Failed to copy full response from ${sourceResponsePath} to ${targetResponsePath}:`, copyErr);
                    // leave original in place and continue — don't throw from shareEntry
                    return true;
                }

                try {
                    fs.unlinkSync(sourceResponsePath);
                } catch (unlinkErr) {
                    // warn but do not fail the share operation if we couldn't remove the original
                    console.warn(`Failed to remove original full response after copy: ${sourceResponsePath}`, unlinkErr);
                }
            }
        }

        return true;
    }

    /**
     * Move a shared history entry to another group tag
     */
    public moveSharedEntry(
        environment: string,
        requestPath: string,
        requestId: string,
        entryId: string,
        tag: string
    ): boolean {
        const tagName = (tag || '').trim();
        if (!tagName) {
            return false;
        }

        const sharedHistory = this.loadSharedHistory(environment, requestPath, requestId);
        if (!sharedHistory) {
            return false;
        }

        let updated = false;
        sharedHistory.requests = sharedHistory.requests.map(entry => {
            if (entry.id === entryId) {
                updated = true;
                return { ...entry, ticket: null, branch: tagName };
            }
            return entry;
        });

        if (!updated) {
            return false;
        }

        this.saveSharedHistory(sharedHistory);
        return true;
    }

    /**
     * Rename a shared history group tag
     */
    public renameSharedGroup(
        environment: string,
        requestPath: string,
        requestId: string,
        oldTag: string,
        newTag: string
    ): boolean {
        const oldName = (oldTag || '').trim();
        const newName = (newTag || '').trim();
        if (!oldName || !newName || oldName === newName) {
            return false;
        }

        const sharedHistory = this.loadSharedHistory(environment, requestPath, requestId);
        if (!sharedHistory) {
            return false;
        }

        let updated = false;
        sharedHistory.requests = sharedHistory.requests.map(entry => {
            if (!entry.ticket && entry.branch === oldName) {
                updated = true;
                return { ...entry, branch: newName };
            }
            return entry;
        });

        if (!updated) {
            return false;
        }

        this.saveSharedHistory(sharedHistory);
        return true;
    }

    /**
     * Clear all history for a request
     */
    public clearHistory(environment: string, requestPath: string, requestId: string): void {
        const requestDirPath = this.getRequestPath(environment, requestPath, requestId);
        if (fs.existsSync(requestDirPath)) {
            const files = fs.readdirSync(requestDirPath);
            for (const file of files) {
                fs.unlinkSync(path.join(requestDirPath, file));
            }
            fs.rmdirSync(requestDirPath);
        }
    }

    // ── IResponseStorage ────────────────────────────────────────

    /**
     * Save full response to a separate file
     */
    public saveFullResponse(
        environment: string,
        requestPath: string,
        requestId: string,
        entryId: string,
        response: FullResponse,
        secretValues?: readonly string[]
    ): void {
        const requestDir = this.getRequestPath(environment, requestPath, requestId);
        const filePath = this.getResponseFilePath(environment, requestPath, requestId, entryId);

        try {
            if (!fs.existsSync(requestDir)) {
                fs.mkdirSync(requestDir, { recursive: true });
            }
            const redacted = redactFullResponse(response, secretValues);
            fs.writeFileSync(filePath, JSON.stringify(redacted, null, 2), 'utf-8');
        } catch (error) {
            console.error(`Failed to save full response for ${entryId}:`, error);
            throw error;
        }
    }

    /**
     * Load full response from file
     */
    public loadFullResponse(environment: string, requestPath: string, requestId: string, entryId: string): FullResponse | null {
        const filePath = this.getResponseFilePath(environment, requestPath, requestId, entryId);

        try {
            if (!fs.existsSync(filePath)) {
                return null;
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content) as FullResponse;
        } catch (error) {
            console.error(`Failed to load full response for ${entryId}:`, error);
            return null;
        }
    }

    /**
     * Load full response from shared history file
     */
    public loadSharedFullResponse(environment: string, requestPath: string, requestId: string, entryId: string): FullResponse | null {
        const filePath = this.getSharedResponseFilePath(environment, requestPath, requestId, entryId);

        try {
            if (!fs.existsSync(filePath)) {
                return null;
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content) as FullResponse;
        } catch (error) {
            console.error(`Failed to load shared full response for ${entryId}:`, error);
            return null;
        }
    }
}
