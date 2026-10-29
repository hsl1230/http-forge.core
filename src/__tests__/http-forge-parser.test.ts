/**
 * HTTP Forge Parser Tests
 */

import { describe, expect, it } from 'vitest';
import { HttpForgeParser } from '../infrastructure/parsers/http-forge-parser';

describe('HttpForgeParser', () => {
    const parser = new HttpForgeParser();

    describe('canParse', () => {
        it('should detect HTTP Forge format', () => {
            const content = JSON.stringify({
                id: 'test-collection',
                name: 'Test Collection',
                items: []
            });
            expect(parser.canParse(content)).toBe(true);
        });

        it('should reject Postman format', () => {
            const content = JSON.stringify({
                info: {
                    name: 'Test',
                    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
                },
                item: []
            });
            expect(parser.canParse(content)).toBe(false);
        });

        it('should reject invalid JSON', () => {
            expect(parser.canParse('not json')).toBe(false);
        });

        it('should reject objects without required fields', () => {
            const content = JSON.stringify({ name: 'Test' });
            expect(parser.canParse(content)).toBe(false);
        });
    });

    describe('parse', () => {
        it('should parse simple collection', () => {
            const content = JSON.stringify({
                id: 'test-id',
                name: 'Test Collection',
                description: 'A test collection',
                items: [
                    {
                        id: 'req-1',
                        type: 'request',
                        name: 'Get Users',
                        method: 'GET',
                        url: 'https://api.example.com/users'
                    }
                ]
            });

            const result = parser.parse(content, '/path/to/collection.json');

            expect(result.id).toBe('test-id');
            expect(result.name).toBe('Test Collection');
            expect(result.description).toBe('A test collection');
            expect(result.items).toHaveLength(1);
            expect(result.items[0].type).toBe('request');
            expect(result.items[0].name).toBe('Get Users');
        });

        it('should parse collection with folders', () => {
            const content = JSON.stringify({
                id: 'test-id',
                name: 'Test Collection',
                items: [
                    {
                        id: 'folder-1',
                        type: 'folder',
                        name: 'Users',
                        items: [
                            {
                                id: 'req-1',
                                type: 'request',
                                name: 'Get Users',
                                method: 'GET',
                                url: '/users'
                            }
                        ]
                    }
                ]
            });

            const result = parser.parse(content, '/path/to/collection.json');

            expect(result.items).toHaveLength(1);
            expect(result.items[0].type).toBe('folder');
            
            const folder = result.items[0] as any;
            expect(folder.name).toBe('Users');
            expect(folder.items).toHaveLength(1);
            expect(folder.items[0].name).toBe('Get Users');
        });

        it('should convert headers array and preserve KeyValueEntry[] shape', () => {
            const content = JSON.stringify({
                id: 'test-id',
                name: 'Test',
                items: [
                    {
                        id: 'req-1',
                        type: 'request',
                        name: 'Test Request',
                        method: 'GET',
                        url: '/test',
                        headers: [
                            { key: 'Content-Type', value: 'application/json', enabled: true },
                            { key: 'X-Disabled', value: 'disabled', enabled: false }
                        ]
                    }
                ]
            });

            const result = parser.parse(content, '/path/to/collection.json');
            const request = result.items[0] as any;

            expect(Array.isArray(request.headers)).toBe(true);
            expect(request.headers).toHaveLength(1);
            expect(request.headers[0]).toEqual({ key: 'Content-Type', value: 'application/json', enabled: true });
            expect(request.headers.find((item: any) => item.key === 'X-Disabled')).toBeUndefined();
        });

        it('should convert query params array to object and ignore disabled entries', () => {
            const content = JSON.stringify({
                id: 'test-id',
                name: 'Test',
                items: [
                    {
                        id: 'req-1',
                        type: 'request',
                        name: 'Test Request',
                        method: 'GET',
                        url: '/test',
                        query: [
                            { key: 'active', value: 'yes', enabled: true },
                            { key: 'disabled', value: 'no', enabled: false }
                        ]
                    }
                ]
            });

            const result = parser.parse(content, '/path/to/collection.json');
            const request = result.items[0] as any;

            expect(request.query).toHaveLength(1);
            expect(request.query[0]).toEqual({ key: 'active', value: 'yes', enabled: true });
            expect(request.query.find((item: any) => item.key === 'disabled')).toBeUndefined();
        });
    });
});
