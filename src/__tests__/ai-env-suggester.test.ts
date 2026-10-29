/**
 * AI Environment Variable Suggester Tests
 *
 * Verifies scanCollectionForEnvVarsWithAi handles clean JSON, fenced output,
 * trailing prose, invalid output, and retries — all through a mock provider.
 */

import { describe, expect, it, vi } from 'vitest';
import { scanCollectionForEnvVarsWithAi } from '../infrastructure/analysis/ai-env-suggester';
import type { Collection } from '../types/collection';
import type { IAiProvider } from '../infrastructure/ai/ai-provider';

function mockProvider(completion: string | null, fn = vi.fn()): IAiProvider {
    const impl = completion === null ? Promise.reject(new Error('provider down')) : Promise.resolve(completion);
    fn.mockReturnValue(impl);
    return { complete: fn as unknown as IAiProvider['complete'] };
}

function makeCollection(): Collection {
    return {
        id: 'c1',
        name: 'Auth API',
        items: [
            {
                type: 'request',
                id: 'r1',
                name: 'Login',
                method: 'POST',
                url: 'https://api.example.com/v1/login',
                headers: [{ key: 'x-api-key', value: 'sk_live_123', enabled: true }],
            },
            {
                type: 'request',
                id: 'r2',
                name: 'Me',
                method: 'GET',
                url: 'https://api.example.com/v1/me',
                query: [{ key: 'tenant', value: 'acme', enabled: true }],
            },
        ],
    };
}

describe('scanCollectionForEnvVarsWithAi', () => {
    it('maps clean AI output to EnvSuggestion objects', async () => {
        const provider = mockProvider(
            JSON.stringify([
                { value: 'https://api.example.com', suggestedName: 'API_BASE_URL', reason: 'Repeated hostname', requestIds: ['r1', 'r2'] },
                { value: 'sk_live_123', suggestedName: 'API_KEY', reason: 'Looks like a secret', requestIds: ['r1'] },
            ])
        );
        const results = await scanCollectionForEnvVarsWithAi(makeCollection(), provider);

        expect(results).toHaveLength(2);
        expect(results[0]).toMatchObject({ varName: 'API_BASE_URL', value: 'https://api.example.com' });
        expect(results[0].occurrences).toHaveLength(2);
        expect(results[1].varName).toBe('API_KEY');
    });

    it('parses fenced JSON with trailing prose', async () => {
        const provider = mockProvider(
            'Here are my findings:\n```json\n[{"value":"acme","suggestedName":"TENANT_ID","reason":"tenant id"}]\n```\nThat covers it.'
        );
        const results = await scanCollectionForEnvVarsWithAi(makeCollection(), provider);
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({ varName: 'TENANT_ID', value: 'acme' });
    });

    it('returns [] for non-JSON output', async () => {
        const provider = mockProvider('I could not find any hardcoded values in this collection.');
        await expect(scanCollectionForEnvVarsWithAi(makeCollection(), provider)).resolves.toEqual([]);
    });

    it('returns [] for malformed JSON output', async () => {
        const provider = mockProvider('[{"value": broken JSON!!!]');
        await expect(scanCollectionForEnvVarsWithAi(makeCollection(), provider)).resolves.toEqual([]);
    });

    it('retries transient provider failures', async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce(new Error('503 service unavailable'))
            .mockResolvedValueOnce(JSON.stringify([{ value: 'acme', suggestedName: 'TENANT_ID', reason: 'x' }]));
        const provider = { complete: fn as unknown as IAiProvider['complete'] };
        const results = await scanCollectionForEnvVarsWithAi(makeCollection(), provider);

        expect(fn).toHaveBeenCalledTimes(2);
        expect(results).toHaveLength(1);
    });

    it('returns [] when the collection has no requests', async () => {
        const provider = mockProvider('[{"value":"x","suggestedName":"X","reason":"x"}]');
        await expect(scanCollectionForEnvVarsWithAi({ id: 'c', name: 'Empty', items: [] }, provider)).resolves.toEqual([]);
    });

    it('drops suggestions that do not occur in any request', async () => {
        const provider = mockProvider(
            JSON.stringify([
                { value: 'https://api.example.com', suggestedName: 'API_BASE_URL', reason: 'Repeated' },
                { value: 'never-seen-anywhere', suggestedName: 'GHOST', reason: 'Not present' },
            ])
        );
        const results = await scanCollectionForEnvVarsWithAi(makeCollection(), provider);
        expect(results.map((r) => r.varName)).toEqual(['API_BASE_URL']);
    });
});
