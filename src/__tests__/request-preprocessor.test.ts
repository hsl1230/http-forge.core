/**
 * Request Preprocessor Tests
 * 
 * Tests for RequestPreprocessor implementation
 * Validates that the logic matches the VS Code plugin's RequestPreprocessor
 */

import { describe, expect, it } from 'vitest';
import { RequestPreprocessor } from '../infrastructure/http/request-preprocessor';
import { RequestBody } from '../types/types';

describe('RequestPreprocessor', () => {
    const preprocessor = new RequestPreprocessor();

    describe('sanitizeHeaderValue', () => {
        it('should return empty string for falsy value', () => {
            expect(preprocessor.sanitizeHeaderValue('')).toBe('');
        });

        it('should replace smart quotes with ASCII quotes', () => {
            // Use unicode escapes for smart quotes to avoid encoding issues
            expect(preprocessor.sanitizeHeaderValue('\u201Ctest\u201D')).toBe('"test"');
            expect(preprocessor.sanitizeHeaderValue('\u2018test\u2019')).toBe("'test'");
        });

        it('should remove control characters', () => {
            expect(preprocessor.sanitizeHeaderValue('hello\x00world')).toBe('helloworld');
            expect(preprocessor.sanitizeHeaderValue('hello\nworld')).toBe('helloworld');
        });

        it('should preserve tabs', () => {
            expect(preprocessor.sanitizeHeaderValue('hello\tworld')).toBe('hello\tworld');
        });
    });

    describe('sanitizeHeaders', () => {
        it('should sanitize all header values', () => {
            const headers = {
                'Content-Type': 'application/json',
                'X-Custom': 'value\x00with\x00nulls'
            };
            
            const result = preprocessor.sanitizeHeaders(headers);
            
            expect(result['Content-Type']).toBe('application/json');
            expect(result['X-Custom']).toBe('valuewithnulls');
        });

        it('should convert non-string values to string', () => {
            const headers = {
                'X-Number': 123 as any
            };
            
            const result = preprocessor.sanitizeHeaders(headers);
            
            expect(result['X-Number']).toBe('123');
        });
    });

    describe('encodeBody', () => {
        it('should return null for null body', () => {
            expect(preprocessor.encodeBody(null)).toBeNull();
        });

        it('should return null for none type', () => {
            const body: RequestBody = { type: 'none' };
            expect(preprocessor.encodeBody(body)).toBeNull();
        });

        it('should return content as-is for raw JSON type', () => {
            const body: RequestBody = { type: 'raw', format: 'json', content: { foo: 'bar' } };
            expect(preprocessor.encodeBody(body)).toEqual({ foo: 'bar' });
        });

        it('should encode URL-encoded body from array', () => {
            const body: RequestBody = {
                type: 'x-www-form-urlencoded',
                content: [
                    { key: 'name', value: 'John', enabled: true },
                    { key: 'age', value: '30', enabled: true },
                    { key: 'disabled', value: 'skip', enabled: false }
                ]
            };
            
            const result = preprocessor.encodeBody(body);
            
            expect(result).toBe('name=John&age=30');
        });

        it('should encode URL-encoded body from string', () => {
            const body: RequestBody = {
                type: 'x-www-form-urlencoded',
                content: 'name=John&age=30'
            };
            
            expect(preprocessor.encodeBody(body)).toBe('name=John&age=30');
        });

        it('should encode GraphQL body', () => {
            const body: RequestBody = {
                type: 'graphql',
                content: {
                    query: '{ users { id name } }',
                    variables: { limit: 10 }
                }
            };
            
            const result = JSON.parse(preprocessor.encodeBody(body));
            
            expect(result.query).toBe('{ users { id name } }');
            expect(result.variables).toEqual({ limit: 10 });
        });

        it('should return raw text body as-is', () => {
            const body: RequestBody = { type: 'raw', format: 'text', content: 'Hello World' };
            expect(preprocessor.encodeBody(body)).toBe('Hello World');
        });
    });

    describe('setContentTypeHeader', () => {
        it('should not override existing Content-Type', () => {
            const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
            const body: RequestBody = { type: 'raw', format: 'json', content: {} };
            
            preprocessor.setContentTypeHeader(headers, body);
            
            expect(headers['Content-Type']).toBe('text/plain');
        });

        it('should not override existing content-type (lowercase)', () => {
            const headers: Record<string, string> = { 'content-type': 'text/plain' };
            const body: RequestBody = { type: 'raw', format: 'json', content: {} };
            
            preprocessor.setContentTypeHeader(headers, body);
            
            expect(headers['content-type']).toBe('text/plain');
        });

        it('should use bodyContentType if provided', () => {
            const headers: Record<string, string> = {};
            const body: RequestBody = { type: 'raw', format: 'json', content: {} };
            
            preprocessor.setContentTypeHeader(headers, body, 'application/vnd.api+json');
            
            expect(headers['Content-Type']).toBe('application/vnd.api+json');
        });

        it('should set application/json for raw JSON body', () => {
            const headers: Record<string, string> = {};
            const body: RequestBody = { type: 'raw', format: 'json', content: {} };
            
            preprocessor.setContentTypeHeader(headers, body);
            
            expect(headers['Content-Type']).toBe('application/json');
        });

        it('should set application/x-www-form-urlencoded for form body', () => {
            const headers: Record<string, string> = {};
            const body: RequestBody = { type: 'x-www-form-urlencoded', content: [] };
            
            preprocessor.setContentTypeHeader(headers, body);
            
            expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
        });

        it('should set text/plain for raw text body', () => {
            const headers: Record<string, string> = {};
            const body: RequestBody = { type: 'raw', format: 'text', content: 'hello' };
            
            preprocessor.setContentTypeHeader(headers, body);
            
            expect(headers['Content-Type']).toBe('text/plain');
        });

        it('should set content type based on format for raw body', () => {
            const headers: Record<string, string> = {};
            const body: RequestBody = { type: 'raw', content: '<html></html>', format: 'html' };
            
            preprocessor.setContentTypeHeader(headers, body);
            
            expect(headers['Content-Type']).toBe('text/html');
        });

        it('should set application/json for GraphQL body', () => {
            const headers: Record<string, string> = {};
            const body: RequestBody = { type: 'graphql', content: { query: '{}' } };
            
            preprocessor.setContentTypeHeader(headers, body);
            
            expect(headers['Content-Type']).toBe('application/json');
        });

        it('should not set content type for none body', () => {
            const headers: Record<string, string> = {};
            const body: RequestBody = { type: 'none' };
            
            preprocessor.setContentTypeHeader(headers, body);
            
            expect(headers['Content-Type']).toBeUndefined();
        });

        it('should not set content type for null body', () => {
            const headers: Record<string, string> = {};
            
            preprocessor.setContentTypeHeader(headers, null);
            
            expect(headers['Content-Type']).toBeUndefined();
        });
    });
});
