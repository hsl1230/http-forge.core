/**
 * Data File Parser Tests
 * 
 * Tests for DataFileParser implementation
 * Validates that the logic matches the VS Code plugin's DataFileParser
 */

import { describe, expect, it } from 'vitest';
import { DataFileParser } from '../infrastructure/platform/data-file-parser';

describe('DataFileParser', () => {
    const parser = new DataFileParser();

    describe('parseJson', () => {
        it('should parse array of objects', () => {
            const content = JSON.stringify([
                { name: 'John', age: 30 },
                { name: 'Jane', age: 25 }
            ]);
            
            const result = parser.parseJson(content);
            
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ name: 'John', age: 30 });
            expect(result[1]).toEqual({ name: 'Jane', age: 25 });
        });

        it('should wrap single object in array', () => {
            const content = JSON.stringify({ name: 'John', age: 30 });
            
            const result = parser.parseJson(content);
            
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ name: 'John', age: 30 });
        });

        it('should throw error for invalid JSON', () => {
            expect(() => parser.parseJson('invalid json')).toThrow('Failed to parse JSON data file');
        });
    });

    describe('parseCsv', () => {
        it('should parse simple CSV', () => {
            const content = 'name,age\nJohn,30\nJane,25';
            
            const result = parser.parseCsv(content);
            
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ name: 'John', age: '30' });
            expect(result[1]).toEqual({ name: 'Jane', age: '25' });
        });

        it('should handle quoted values', () => {
            const content = 'name,description\nJohn,"Hello, World"\nJane,"She said ""Hi"""';
            
            const result = parser.parseCsv(content);
            
            expect(result).toHaveLength(2);
            expect(result[0].description).toBe('Hello, World');
            expect(result[1].description).toBe('She said "Hi"');
        });

        it('should handle empty values', () => {
            const content = 'name,age,city\nJohn,,NYC\nJane,25,';
            
            const result = parser.parseCsv(content);
            
            expect(result[0]).toEqual({ name: 'John', age: '', city: 'NYC' });
            expect(result[1]).toEqual({ name: 'Jane', age: '25', city: '' });
        });

        it('should handle Windows line endings', () => {
            const content = 'name,age\r\nJohn,30\r\nJane,25';
            
            const result = parser.parseCsv(content);
            
            expect(result).toHaveLength(2);
        });

        it('should return empty object for single line CSV', () => {
            const content = 'name,age';
            
            const result = parser.parseCsv(content);
            
            expect(result).toEqual([{}]);
        });

        it('should handle missing values', () => {
            const content = 'name,age,city\nJohn,30\nJane';
            
            const result = parser.parseCsv(content);
            
            expect(result[0]).toEqual({ name: 'John', age: '30', city: '' });
            expect(result[1]).toEqual({ name: 'Jane', age: '', city: '' });
        });

        it('should trim whitespace', () => {
            const content = 'name, age \n John , 30 ';
            
            const result = parser.parseCsv(content);
            
            expect(result[0]).toEqual({ name: 'John', age: '30' });
        });
    });

    describe('parse', () => {
        it('should parse JSON file', () => {
            const content = JSON.stringify([{ name: 'John' }]);
            
            const result = parser.parse(content, 'data.json');
            
            expect(result[0]).toEqual({ name: 'John' });
        });

        it('should parse JSON file case insensitive', () => {
            const content = JSON.stringify([{ name: 'John' }]);
            
            const result = parser.parse(content, 'data.JSON');
            
            expect(result[0]).toEqual({ name: 'John' });
        });

        it('should parse CSV file', () => {
            const content = 'name\nJohn';
            
            const result = parser.parse(content, 'data.csv');
            
            expect(result[0]).toEqual({ name: 'John' });
        });

        it('should treat non-json as CSV', () => {
            const content = 'name\nJohn';
            
            const result = parser.parse(content, 'data.txt');
            
            expect(result[0]).toEqual({ name: 'John' });
        });
    });
});
