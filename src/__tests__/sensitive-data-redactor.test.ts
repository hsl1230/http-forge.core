import { describe, expect, it } from 'vitest';
import {
    redactFullResponse,
    redactFullResultDetails,
    redactHistoryEntry,
} from '../infrastructure/security/sensitive-data-redactor';
import {
    attachSecretValues,
    getSecretValues,
} from '../infrastructure/security/secret-values';
import type { HistoryEntry } from '../infrastructure/history/history-interfaces';
import type { FullResultDetails } from '../infrastructure/test-suite/result-storage';

const SECRET = 's3cret-value';

describe('value-based secret redaction', () => {
    it('redacts the exact resolved value from URL path, headers, query and body', () => {
        const sentRequest = attachSecretValues(
            {
                url: `https://api.example.test/users/${SECRET}?tenant=${SECRET}`,
                method: 'GET',
                headers: { 'X-Tenant': SECRET, 'X-Name': 'visible' },
                body: {
                    type: 'raw' as const,
                    format: 'json' as const,
                    content: { data: `prefix-${SECRET}-suffix`, visible: 'keep' },
                },
                params: { id: SECRET },
                query: { tenant: SECRET },
            },
            [SECRET],
        );

        const entry: HistoryEntry = {
            id: 'entry-1',
            timestamp: 1,
            environment: 'dev',
            method: 'GET',
            sentRequest,
            response: { status: 200, statusText: 'OK', time: 1 },
        };

        const redacted = redactHistoryEntry(entry);

        expect(JSON.stringify(redacted)).not.toContain(SECRET);
        expect(redacted.sentRequest.url).toBe(
            'https://api.example.test/users/***?tenant=***',
        );
        expect(redacted.sentRequest.headers['X-Tenant']).toBe('***');
        expect(redacted.sentRequest.headers['X-Name']).toBe('visible');
        expect(redacted.sentRequest.body?.content).toEqual({
            data: 'prefix-***-suffix',
            visible: 'keep',
        });
        expect(redacted.sentRequest.params?.id).toBe('***');
        expect(redacted.sentRequest.query?.tenant).toBe('***');
    });

    it('redacts percent-encoded secret variants after URL normalization', () => {
        const encodedSecret = 'top secret';
        const sentRequest = attachSecretValues(
            {
                url: `https://api.example.test/users/${encodedSecret}/profile?token=abc`,
                method: 'GET',
                headers: {},
            },
            [encodedSecret],
        );

        const redacted = redactHistoryEntry({
            id: 'entry-1',
            timestamp: 1,
            environment: 'dev',
            method: 'GET',
            sentRequest,
            response: { status: 200, statusText: 'OK', time: 1 },
        });

        expect(redacted.sentRequest.url).toBe(
            'https://api.example.test/users/***/profile?token=***',
        );
    });

    it('keeps tracked secret values out of serialized request data', () => {
        const sentRequest = attachSecretValues(
            { url: `https://api.example.test/${SECRET}`, method: 'GET', headers: {} },
            [SECRET],
        );

        expect(getSecretValues(sentRequest)).toEqual([SECRET]);
        expect(JSON.stringify(sentRequest)).not.toContain('secretValues');
        expect(JSON.stringify(sentRequest)).toContain(SECRET);
    });

    it('redacts exact values from full responses, including bodies and cookies', () => {
        const redacted = redactFullResponse(
            {
                timestamp: 1,
                status: 200,
                statusText: 'OK',
                headers: { 'X-Echo': SECRET },
                cookies: [{ name: 'tenant', value: SECRET }],
                body: { data: `echo: ${SECRET}` },
                time: 1,
            },
            [SECRET],
        );

        expect(JSON.stringify(redacted)).not.toContain(SECRET);
        expect(redacted.headers['X-Echo']).toBe('***');
        expect(redacted.cookies[0].value).toBe('***');
        expect(redacted.body).toEqual({ data: 'echo: ***' });
    });

    it('redacts exact values from persisted suite results and console output', () => {
        const result: FullResultDetails = {
            index: 1,
            iteration: 1,
            requestId: 'req-1',
            name: 'Echo',
            method: 'POST',
            url: `https://api.example.test/${SECRET}`,
            status: 200,
            statusText: 'OK',
            duration: 1,
            passed: true,
            timestamp: 1,
            request: {
                method: 'POST',
                url: `https://api.example.test/${SECRET}`,
                headers: { 'X-Tenant': SECRET },
                query: {},
                params: {},
                body: { type: 'raw', format: 'json', content: { data: SECRET } },
            },
            response: {
                headers: {},
                body: `echo ${SECRET}`,
            },
            assertions: [{ name: 'status', passed: true, message: `saw ${SECRET}` }],
            error: null,
            consoleOutput: [`log ${SECRET}`],
            visualizerData: { template: SECRET, data: { value: SECRET } },
        };

        const redacted = redactFullResultDetails(result, [SECRET]);

        expect(JSON.stringify(redacted)).not.toContain(SECRET);
        expect(redacted.request.headers['X-Tenant']).toBe('***');
        expect(redacted.response.body).toBe('echo ***');
        expect(redacted.consoleOutput?.[0]).toBe('log ***');
        expect(redacted.assertions[0].message).toBe('saw ***');
    });

    it('does not substring-redact very short values that would corrupt unrelated data', () => {
        const redacted = redactFullResponse(
            {
                timestamp: 1,
                status: 200,
                statusText: 'OK',
                headers: { 'X-Echo': 'abc' },
                cookies: [],
                body: 'abc is a short value',
                time: 1,
            },
            ['abc'],
        );

        expect(redacted.body).toBe('abc is a short value');
    });
});
