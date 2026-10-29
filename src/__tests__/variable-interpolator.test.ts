/**
 * Variable Interpolator Tests
 */

import { describe, expect, it } from 'vitest';
import { VariableInterpolator } from '../infrastructure/environment/variable-interpolator';

describe('VariableInterpolator', () => {
    const interpolator = new VariableInterpolator();

    describe('interpolate', () => {
        it('should replace single variable', () => {
            const result = interpolator.interpolate('Hello {{name}}!', { name: 'World' });
            expect(result).toBe('Hello World!');
        });

        it('should replace multiple variables', () => {
            const result = interpolator.interpolate(
                '{{greeting}} {{name}}!',
                { greeting: 'Hello', name: 'World' }
            );
            expect(result).toBe('Hello World!');
        });

        it('should leave unknown variables unchanged', () => {
            const result = interpolator.interpolate('Hello {{unknown}}!', {});
            expect(result).toBe('Hello {{unknown}}!');
        });

        it('should handle empty string', () => {
            const result = interpolator.interpolate('', { name: 'World' });
            expect(result).toBe('');
        });

        it('should handle string without variables', () => {
            const result = interpolator.interpolate('Hello World!', { name: 'Test' });
            expect(result).toBe('Hello World!');
        });

        it('should escape double quotes when inside double-quoted string', () => {
            const json = '{"name": "{{value}}"}';
            const result = interpolator.interpolate(json, { value: 'hello "world"' });
            expect(result).toBe('{"name": "hello \\"world\\""}');
        });

        it('should escape single quotes when inside single-quoted string', () => {
            const str = "{'name': '{{value}}'}";
            const result = interpolator.interpolate(str, { value: "hello 'world'" });
            expect(result).toBe("{'name': 'hello \\'world\\''}");
        });

        it('should escape control characters in strings', () => {
            const json = '{"text": "{{value}}"}';
            const result = interpolator.interpolate(json, { value: 'line1\nline2\ttab' });
            expect(result).toBe('{"text": "line1\\nline2\\ttab"}');
        });

        it('should escape backslashes in strings', () => {
            const json = '{"path": "{{value}}"}';
            const result = interpolator.interpolate(json, { value: 'C:\\Users\\test' });
            expect(result).toBe('{"path": "C:\\\\Users\\\\test"}');
        });

        it('should not escape when not inside a string', () => {
            const text = 'Value is {{value}} here';
            const result = interpolator.interpolate(text, { value: 'hello "world"' });
            expect(result).toBe('Value is hello "world" here');
        });
    });

    describe('filters with inner braces', () => {
        it('should apply format filter that contains a {0} placeholder', () => {
            const result = interpolator.interpolate(
                '{{environment_name | format("efg {0}") }}',
                { environment_name: 'dev' }
            );
            expect(result).toBe('efg dev');
        });

        it('should apply format filter with additional positional args', () => {
            const result = interpolator.interpolate(
                '{{first | format("{0}-{1}", second)}}',
                { first: 'a', second: 'b' }
            );
            expect(result).toBe('a-b');
        });

        it('should resolve a plain token alongside a format token with braces', () => {
            const result = interpolator.interpolate(
                '{{plain}} and {{name | format("x{0}y")}}',
                { plain: 'P', name: 'N' }
            );
            expect(result).toBe('P and xNy');
        });

        it('should still resolve a bare format filter with no args', () => {
            const result = interpolator.interpolate(
                '{{environment_name | format}}',
                { environment_name: 'dev' }
            );
            expect(result).toBe('dev');
        });

        it('should leave the token literal when the variable is unknown', () => {
            const result = interpolator.interpolate(
                '{{missing | format("efg {0}")}}',
                {}
            );
            expect(result).toBe('{{missing | format("efg {0}")}}');
        });
    });

    describe('extractVariables', () => {
        it('should extract variable names', () => {
            const result = interpolator.extractVariables('{{foo}} and {{bar}}');
            expect(result).toEqual(['foo', 'bar']);
        });

        it('should return empty array for no variables', () => {
            const result = interpolator.extractVariables('no variables here');
            expect(result).toEqual([]);
        });

        it('should handle duplicate variable names', () => {
            const result = interpolator.extractVariables('{{foo}} {{foo}} {{bar}}');
            expect(result).toContain('foo');
            expect(result).toContain('bar');
        });
    });

    describe('interpolateObject', () => {
        it('should interpolate nested object values', () => {
            const obj = {
                url: '{{baseUrl}}/api',
                headers: {
                    Authorization: 'Bearer {{token}}'
                }
            };
            const result = interpolator.interpolateObject(obj, {
                baseUrl: 'https://example.com',
                token: 'abc123'
            });
            expect(result.url).toBe('https://example.com/api');
            expect(result.headers.Authorization).toBe('Bearer abc123');
        });

        it('should not mutate original object', () => {
            const obj = { url: '{{baseUrl}}' };
            const result = interpolator.interpolateObject(obj, { baseUrl: 'test' });
            expect(obj.url).toBe('{{baseUrl}}');
            expect(result.url).toBe('test');
        });
    });

    describe('Dynamic Variables', () => {
        it('should replace $randomInt with a number', () => {
            const result = interpolator.interpolate('key-{{$randomInt}}', {});
            expect(result).toMatch(/^key-\d+$/);
            const num = parseInt(result.split('-')[1]);
            expect(num).toBeGreaterThanOrEqual(0);
            expect(num).toBeLessThan(1000);
        });

        it('should replace $timestamp with current time', () => {
            const before = Date.now();
            const result = interpolator.interpolate('{{$timestamp}}', {});
            const after = Date.now();
            const timestamp = parseInt(result);
            expect(timestamp).toBeGreaterThanOrEqual(before);
            expect(timestamp).toBeLessThanOrEqual(after);
        });

        it('should replace $guid with UUID v4 format', () => {
            const result = interpolator.interpolate('{{$guid}}', {});
            // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
            expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        });

        it('should replace $uuid with UUID v4 format', () => {
            const result = interpolator.interpolate('{{$uuid}}', {});
            expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        });

        it('should replace $isoTimestamp with ISO 8601 format', () => {
            const result = interpolator.interpolate('{{$isoTimestamp}}', {});
            // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });

        it('should work in mixed variable and dynamic variable contexts', () => {
            const result = interpolator.interpolate(
                'api-key-{{apiKey}}-request-{{$randomInt}}',
                { apiKey: 'secret123' }
            );
            expect(result).toMatch(/^api-key-secret123-request-\d+$/);
        });

        it('should leave unknown dynamic variables unchanged', () => {
            const result = interpolator.interpolate('value-{{$unknownVar}}', {});
            expect(result).toBe('value-{{$unknownVar}}');
        });

        it('should handle multiple dynamic variables', () => {
            const result = interpolator.interpolate(
                '{{$guid}}-{{$randomInt}}-{{$timestamp}}',
                {}
            );
            const parts = result.split('-');
            // UUID has 4 hyphens (5 parts: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx),
            // plus separators to randomInt and timestamp = 7 total parts
            expect(parts.length).toBe(7);
        });
    });
});