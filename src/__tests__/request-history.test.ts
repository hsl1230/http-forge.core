/**
 * Request History Store Tests
 * Tests based on VS Code plugin's request-history-service.ts
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { RequestHistoryStore } from '../infrastructure/history/request-history';
import { HttpRequest, HttpResponse } from '../types/types';

describe('RequestHistoryStore', () => {
    let store: RequestHistoryStore;
    
    beforeEach(() => {
        store = new RequestHistoryStore({ maxEntriesPerRequest: 100 });
    });
    
    const createRequest = (overrides?: Partial<HttpRequest>): HttpRequest => ({
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: {},
        ...overrides
    });
    
    const createResponse = (overrides?: Partial<HttpResponse>): HttpResponse => ({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"users": []}',
        time: 150,
        cookies: [],
        ...overrides
    });
    
    describe('addEntry', () => {
        it('should add entry to history', () => {
            const request = createRequest();
            const response = createResponse();
            
            const entry = store.addEntry('test-request', request, response, 'dev');
            
            const entries = store.getEntries('test-request');
            expect(entries).toHaveLength(1);
            expect(entries[0].id).toBe(entry.id);
        });
        
        it('should add entries with unique IDs', () => {
            const request = createRequest();
            const response = createResponse();
            
            const entry1 = store.addEntry('test-request', request, response, 'dev');
            const entry2 = store.addEntry('test-request', request, response, 'dev');
            
            const entries = store.getEntries('test-request');
            expect(entries).toHaveLength(2);
            expect(entry1.id).not.toBe(entry2.id);
        });
        
        it('should maintain entries in order (newest first)', () => {
            const request = createRequest();
            const response = createResponse();
            
            const entry1 = store.addEntry('test-request', request, response, 'dev');
            const entry2 = store.addEntry('test-request', request, response, 'dev');
            
            const entries = store.getEntries('test-request');
            // Most recent first (LIFO)
            expect(entries[0].id).toBe(entry2.id);
            expect(entries[1].id).toBe(entry1.id);
        });
        
        it('should respect maxEntriesPerRequest limit', () => {
            const limitedStore = new RequestHistoryStore({ maxEntriesPerRequest: 3 });
            const request = createRequest();
            const response = createResponse();
            
            const entryIds: string[] = [];
            for (let i = 0; i < 5; i++) {
                const entry = limitedStore.addEntry('test-request', request, response, 'dev');
                entryIds.push(entry.id);
            }
            
            const entries = limitedStore.getEntries('test-request');
            expect(entries).toHaveLength(3);
            // Should keep most recent entries
            expect(entries.map(e => e.id)).toEqual([entryIds[4], entryIds[3], entryIds[2]]);
        });
        
        it('should group entries by requestId', () => {
            const request = createRequest();
            const response = createResponse();
            
            store.addEntry('request-1', request, response, 'dev');
            store.addEntry('request-2', request, response, 'dev');
            store.addEntry('request-1', request, response, 'dev');
            
            expect(store.getEntries('request-1')).toHaveLength(2);
            expect(store.getEntries('request-2')).toHaveLength(1);
        });
        
        it('should include metadata in entry', () => {
            const request = createRequest();
            const response = createResponse();
            
            const entry = store.addEntry('test-request', request, response, 'dev', {
                ticket: 'JIRA-123',
                branch: 'feature/test',
                note: 'Test note'
            });
            
            expect(entry.ticket).toBe('JIRA-123');
            expect(entry.branch).toBe('feature/test');
            expect(entry.note).toBe('Test note');
        });
        
        it('should store request and response details', () => {
            const request = createRequest({ method: 'POST', body: '{"data": "test"}' });
            const response = createResponse({ status: 201, time: 250 });
            
            const entry = store.addEntry('test-request', request, response, 'dev');
            
            expect(entry.sentRequest.method).toBe('POST');
            expect(entry.sentRequest.body).toBe('{"data": "test"}');
            expect(entry.response.status).toBe(201);
            expect(entry.response.time).toBe(250);
        });
    });
    
    describe('getEntries', () => {
        it('should return empty array for unknown requestId', () => {
            const entries = store.getEntries('unknown-request');
            expect(entries).toEqual([]);
        });
        
        it('should filter by environment', () => {
            const request = createRequest();
            const response = createResponse();
            
            store.addEntry('test-request', request, response, 'dev');
            store.addEntry('test-request', request, response, 'prod');
            store.addEntry('test-request', request, response, 'dev');
            
            const devEntries = store.getEntries('test-request', 'dev');
            const prodEntries = store.getEntries('test-request', 'prod');
            
            expect(devEntries).toHaveLength(2);
            expect(prodEntries).toHaveLength(1);
        });
    });
    
    describe('getEntry', () => {
        it('should return specific entry by id', () => {
            const request = createRequest();
            const response = createResponse();
            
            const entry = store.addEntry('test-request', request, response, 'dev');
            
            const result = store.getEntry(entry.id);
            expect(result).toBeDefined();
            expect(result!.id).toBe(entry.id);
        });
        
        it('should return undefined for unknown entry id', () => {
            const result = store.getEntry('unknown-id');
            expect(result).toBeUndefined();
        });
        
        it('should find entry across different requestIds', () => {
            const request = createRequest();
            const response = createResponse();
            
            const entry1 = store.addEntry('request-1', request, response, 'dev');
            const entry2 = store.addEntry('request-2', request, response, 'dev');
            
            expect(store.getEntry(entry1.id)).toBeDefined();
            expect(store.getEntry(entry2.id)).toBeDefined();
        });
    });
    
    describe('deleteEntry', () => {
        it('should delete specific entry', () => {
            const request = createRequest();
            const response = createResponse();
            
            const toDelete = store.addEntry('test-request', request, response, 'dev');
            const toKeep = store.addEntry('test-request', request, response, 'dev');
            
            const result = store.deleteEntry(toDelete.id);
            
            expect(result).toBe(true);
            expect(store.getEntry(toDelete.id)).toBeUndefined();
            expect(store.getEntry(toKeep.id)).toBeDefined();
        });
        
        it('should return false for unknown entry', () => {
            const result = store.deleteEntry('unknown-id');
            expect(result).toBe(false);
        });
    });
    
    describe('clearHistory', () => {
        it('should clear history for specific requestId', () => {
            const request = createRequest();
            const response = createResponse();
            
            store.addEntry('request-1', request, response, 'dev');
            store.addEntry('request-2', request, response, 'dev');
            
            store.clearHistory('request-1');
            
            expect(store.getEntries('request-1')).toHaveLength(0);
            expect(store.getEntries('request-2')).toHaveLength(1);
        });
    });
    
    describe('clearAll', () => {
        it('should clear all history', () => {
            const request = createRequest();
            const response = createResponse();
            
            store.addEntry('request-1', request, response, 'dev');
            store.addEntry('request-2', request, response, 'dev');
            
            store.clearAll();
            
            expect(store.getEntries('request-1')).toHaveLength(0);
            expect(store.getEntries('request-2')).toHaveLength(0);
            expect(store.count).toBe(0);
        });
    });
    
    describe('count', () => {
        it('should return total entry count', () => {
            const request = createRequest();
            const response = createResponse();
            
            store.addEntry('request-1', request, response, 'dev');
            store.addEntry('request-2', request, response, 'dev');
            store.addEntry('request-1', request, response, 'dev');
            
            expect(store.count).toBe(3);
        });
        
        it('should return 0 for empty history', () => {
            expect(store.count).toBe(0);
        });
    });
    
    describe('Full Response Storage', () => {
        it('should store full response when enabled', () => {
            const request = createRequest();
            const response = createResponse({
                status: 200,
                headers: { 'content-type': 'application/json', 'x-custom': 'value' },
                body: '{"data": "full"}'
            });
            
            const entry = store.addEntry('test-request', request, response, 'dev');
            
            const fullResponse = store.getFullResponse(entry.id);
            expect(fullResponse).toBeDefined();
            expect(fullResponse!.status).toBe(200);
            expect(fullResponse!.body).toBe('{"data": "full"}');
        });
        
        it('should not store full response when disabled', () => {
            const noFullStore = new RequestHistoryStore({ 
                maxEntriesPerRequest: 100,
                storeFullResponses: false 
            });
            const request = createRequest();
            const response = createResponse();
            
            const entry = noFullStore.addEntry('test-request', request, response, 'dev');
            
            const fullResponse = noFullStore.getFullResponse(entry.id);
            expect(fullResponse).toBeUndefined();
        });
        
        it('should delete full response when entry is deleted', () => {
            const request = createRequest();
            const response = createResponse();
            
            const entry = store.addEntry('test-request', request, response, 'dev');
            expect(store.getFullResponse(entry.id)).toBeDefined();
            
            store.deleteEntry(entry.id);
            
            expect(store.getFullResponse(entry.id)).toBeUndefined();
        });
        
        it('should clear full responses when clearing all', () => {
            const request = createRequest();
            const response = createResponse();
            
            const entry = store.addEntry('test-request', request, response, 'dev');
            
            store.clearAll();
            
            expect(store.getFullResponse(entry.id)).toBeUndefined();
        });
    });
});
