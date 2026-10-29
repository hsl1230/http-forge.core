/**
 * AI Collection Enhancer Tests
 *
 * Verifies enhanceCollection applies body examples and test scripts across
 * batches, tolerates invalid AI output, and handles provider failures.
 */

import { describe, expect, it, vi } from 'vitest';
import { enhanceCollection } from '../infrastructure/analysis/collection-enhancer';
import type { Collection, ICollectionService } from '../types/collection';
import type { IAiProvider } from '../infrastructure/ai/ai-provider';

function makeCollection(): Collection {
    return {
        id: 'c1',
        name: 'Users API',
        items: [
            {
                type: 'request',
                id: 'r1',
                name: 'Create User',
                method: 'POST',
                url: 'https://api.example.com/users',
                body: { type: 'raw', format: 'json', content: '{"name":"placeholder"}' },
            },
            {
                type: 'folder',
                id: 'f1',
                name: 'Auth',
                items: [
                    {
                        type: 'request',
                        id: 'r2',
                        name: 'Login',
                        method: 'POST',
                        url: 'https://api.example.com/login',
                        body: { type: 'raw', format: 'json', content: '{"email":"x"}' },
                    },
                ],
            },
        ],
    };
}

function mockService(): ICollectionService {
    // In-memory collections are already fully loaded: no lazy hydration needed.
    return { saveCollection: vi.fn(), getRequestDetail: () => undefined } as unknown as ICollectionService;
}

describe('enhanceCollection', () => {
    it('applies AI body examples and test scripts to all requests', async () => {
        const provider: IAiProvider = {
            complete: vi.fn().mockResolvedValue(
                JSON.stringify([
                    { id: 'r1', body: '{"name":"Alice"}', testScript: 'pm.test("status is 201", () => pm.response.to.have.status(201));' },
                    { id: 'r2', body: '{"email":"a@b.com"}', testScript: 'pm.test("status is 200", () => pm.response.to.have.status(200));' },
                ])
            ),
        };
        const service = mockService();
        const collection = makeCollection();

        await enhanceCollection(collection, service, provider);

        expect(service.saveCollection).toHaveBeenCalledWith(collection);

        const r1 = collection.items[0] as { body: { content: string }; scripts?: { postResponse?: string } };
        expect(r1.body.content).toBe('{"name":"Alice"}');
        expect(r1.scripts?.postResponse).toContain('pm.test');

        const folder = collection.items[1] as { items: Array<{ scripts?: { postResponse?: string }; body: { content: string } }> };
        const r2 = folder.items[0];
        expect(r2.body.content).toBe('{"email":"a@b.com"}');
        expect(r2.scripts?.postResponse).toContain('pm.test');
    });

    it('keeps an existing post-response script (does not overwrite)', async () => {
        const provider: IAiProvider = {
            complete: vi.fn().mockResolvedValue(
                JSON.stringify([{ id: 'r1', body: '{"name":"Bob"}', testScript: 'pm.test("fresh")' }])
            ),
        };
        const collection = makeCollection();
        const r1 = collection.items[0] as { scripts?: { postResponse?: string } };
        r1.scripts = { postResponse: 'pm.test("existing script")' };

        await enhanceCollection(collection, mockService(), provider);
        expect(r1.scripts.postResponse).toBe('pm.test("existing script")');
    });

    it('tolerates malformed AI JSON without crashing', async () => {
        const provider: IAiProvider = { complete: vi.fn().mockResolvedValue('not json at all') };
        const collection = makeCollection();
        await expect(enhanceCollection(collection, mockService(), provider)).resolves.toBeUndefined();
    });

    it('skips invalid JSON bodies but still saves', async () => {
        const provider: IAiProvider = {
            complete: vi.fn().mockResolvedValue(JSON.stringify([{ id: 'r1', body: '{broken', testScript: 'pm.test("x")' }])),
        };
        const collection = makeCollection();
        const r1 = collection.items[0] as { body: { content: string }; scripts?: { postResponse?: string } };
        const original = r1.body.content;

        await enhanceCollection(collection, mockService(), provider);
        expect(r1.body.content).toBe(original); // invalid JSON not applied
        expect(r1.scripts?.postResponse).toBe('pm.test("x")');
    });

    it('continues past a provider failure batch', async () => {
        const provider: IAiProvider = {
            complete: vi
                .fn()
                .mockRejectedValueOnce(new Error('network error'))
                .mockResolvedValueOnce(JSON.stringify([{ id: 'r1', body: '{"name":"Carol"}', testScript: 'pm.test("ok")' }])),
        };
        const collection = makeCollection();
        const service = mockService();

        await enhanceCollection(collection, service, provider);
        // First batch (r1) failed but the batch is non-fatal; saveCollection still ran.
        expect(service.saveCollection).toHaveBeenCalledWith(collection);
    });

    it('does nothing when the collection has no requests', async () => {
        const provider: IAiProvider = { complete: vi.fn() };
        const service = mockService();
        const empty: Collection = { id: 'e', name: 'Empty', items: [] };

        await enhanceCollection(empty, service, provider);
        expect(provider.complete).not.toHaveBeenCalled();
        expect(service.saveCollection).not.toHaveBeenCalled();
    });
});
