import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../infrastructure/config/config-service';
import { CollectionService } from '../infrastructure/collection/collection-service';
import { isLightLoaded } from '../infrastructure/collection/collection-store';
import { FolderCollectionStore } from '../infrastructure/collection/folder-collection-store';
import type { CollectionRequestItem } from '../types/collection';

/**
 * Lazy collection loading (startup optimization).
 *
 * `loadAllLight()` must return tree metadata (method/url/name/headers/auth)
 * without touching heavy per-request files (scripts/, body.*, schemas, doc.md),
 * and `loadRequestDetail()` must enrich the cached item in place on demand.
 * The heavy `loadAll()` path keeps full detail for backward compatibility.
 */

const dirs: string[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function mkTemp(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
}

/** Seed one collection with a request that has every heavy field populated. */
async function seedCollectionsDir(collectionsDir: string): Promise<{ collectionId: string; itemPath: string }> {
    const store = new FolderCollectionStore(collectionsDir);
    const collection = await store.create('Shop');
    const item: CollectionRequestItem = {
        id: 'req-1',
        type: 'request',
        name: 'Create order',
        method: 'POST',
        url: 'https://api.example.com/orders',
        headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
        body: { type: 'raw', format: 'json', content: JSON.stringify({ sku: 'widget' }) },
        scripts: { postResponse: 'pm.test("created", () => {});' },
        doc: '# Orders\nCreates an order.',
        responseSchema: { responses: {} },
        bodySchema: { schema: { type: 'object' } },
    };
    await store.saveItem(collection.id, item);
    const itemPath = store.getItemPath(collection.id, 'req-1');
    if (!itemPath) throw new Error('seed failed: item path not found');
    return { collectionId: collection.id, itemPath };
}

function lightRequest(store: FolderCollectionStore): CollectionRequestItem {
    const collections = store.loadAllLight();
    expect(collections).toHaveLength(1);
    const request = collections[0].items[0] as CollectionRequestItem;
    expect(request.type).toBe('request');
    return request;
}

describe('collection light loading', () => {
    it('light load returns tree metadata without heavy fields', async () => {
        const dir = mkTemp('light-meta-');
        await seedCollectionsDir(dir);

        const store = new FolderCollectionStore(dir);
        const request = lightRequest(store);

        // Tree view needs exactly this.
        expect(request.id).toBe('req-1');
        expect(request.method).toBe('POST');
        expect(request.url).toBe('https://api.example.com/orders');
        expect(request.name).toBe('Create order');
        expect(request.headers).toHaveLength(1);

        // Heavy files stay on disk.
        expect(request.scripts).toBeUndefined();
        expect(request.doc).toBeUndefined();
        expect(request.responseSchema).toBeUndefined();
        expect(request.bodySchema).toBeUndefined();
        expect(request.body?.content).toBeUndefined();
        expect(isLightLoaded(request)).toBe(true);
    });

    it('detail load enriches the cached item in place', async () => {
        const dir = mkTemp('light-detail-');
        const { collectionId } = await seedCollectionsDir(dir);

        const store = new FolderCollectionStore(dir);
        const light = lightRequest(store);

        const detail = store.loadRequestDetail(collectionId, 'req-1') as CollectionRequestItem;

        expect(detail.scripts?.postResponse).toContain('pm.test');
        expect(detail.doc).toContain('Creates an order');
        expect(detail.body?.content).toContain('widget');
        expect(detail.responseSchema).toBeDefined();
        expect(detail.bodySchema).toBeDefined();
        expect(isLightLoaded(detail)).toBe(false);
        // Same object the tree already holds — no stale copies.
        expect(detail).toBe(light);
    });

    it('detail load is idempotent and survives heavy-file deletion', async () => {
        const dir = mkTemp('light-idem-');
        const { collectionId, itemPath } = await seedCollectionsDir(dir);

        const store = new FolderCollectionStore(dir);
        lightRequest(store);
        const first = store.loadRequestDetail(collectionId, 'req-1') as CollectionRequestItem;
        expect(first.scripts?.postResponse).toContain('pm.test');

        // Remove every heavy file from disk; the enriched cache must still serve.
        for (const heavy of ['scripts', 'doc.md', 'body.json', 'response.schema.json', 'body.schema.json']) {
            fs.rmSync(path.join(itemPath, heavy), { recursive: true, force: true });
        }

        const second = store.loadRequestDetail(collectionId, 'req-1');
        expect(second).toBe(first);
        expect((second as CollectionRequestItem).scripts?.postResponse).toContain('pm.test');
        expect((second as CollectionRequestItem).doc).toContain('Creates an order');
    });

    it('heavy loadAll keeps full detail for backward compatibility', async () => {
        const dir = mkTemp('light-heavy-');
        await seedCollectionsDir(dir);

        const store = new FolderCollectionStore(dir);
        const request = store.loadAll()[0].items[0] as CollectionRequestItem;

        expect(request.scripts?.postResponse).toContain('pm.test');
        expect(request.doc).toContain('Creates an order');
        expect(request.body?.content).toContain('widget');
        expect(request.responseSchema).toBeDefined();
        expect(isLightLoaded(request)).toBe(false);
    });

    it('service findRequest serves heavy data without re-reading disk', async () => {
        const ws = mkTemp('light-svc-');
        const config = new ConfigService(ws);
        const collectionsDir = config.getCollectionsPath();
        fs.mkdirSync(collectionsDir, { recursive: true });
        const { collectionId, itemPath } = await seedCollectionsDir(collectionsDir);

        const service = new CollectionService(config);
        const found = service.findRequest(collectionId, 'req-1');
        expect(found?.scripts?.postResponse).toContain('pm.test');

        // Delete heavy files; a fully-loaded service must not touch disk again.
        for (const heavy of ['scripts', 'doc.md', 'body.json', 'response.schema.json', 'body.schema.json']) {
            fs.rmSync(path.join(itemPath, heavy), { recursive: true, force: true });
        }

        const again = service.findRequest(collectionId, 'req-1');
        expect(again).toBe(found);
        expect(again?.scripts?.postResponse).toContain('pm.test');
    });

    it('service starts light and enriches on first access', async () => {
        const ws = mkTemp('light-startup-');
        const config = new ConfigService(ws);
        const collectionsDir = config.getCollectionsPath();
        fs.mkdirSync(collectionsDir, { recursive: true });
        const { collectionId } = await seedCollectionsDir(collectionsDir);

        const service = new CollectionService(config);
        const treeItem = service.getAllCollections()[0].items[0] as CollectionRequestItem;
        expect(isLightLoaded(treeItem)).toBe(true);
        expect(treeItem.scripts).toBeUndefined();

        const found = service.findRequest(collectionId, 'req-1');
        expect(found?.scripts?.postResponse).toContain('pm.test');
        expect(found?.body?.content).toContain('widget');
        expect(found?.doc).toContain('Creates an order');
        expect(isLightLoaded(found as CollectionRequestItem)).toBe(false);
    });

    it('service getRequestScript and getRequestDetail work on light items', async () => {
        const ws = mkTemp('light-script-');
        const config = new ConfigService(ws);
        const collectionsDir = config.getCollectionsPath();
        fs.mkdirSync(collectionsDir, { recursive: true });
        const { collectionId } = await seedCollectionsDir(collectionsDir);

        const service = new CollectionService(config);
        expect(service.getRequestScript(collectionId, 'req-1', 'post-response')).toContain('pm.test');
        expect(service.getRequestDetail(collectionId, 'req-1')?.doc).toContain('Creates an order');
    });

    it('saving a light collection preserves heavy files', async () => {
        const ws = mkTemp('light-save-');
        const config = new ConfigService(ws);
        const collectionsDir = config.getCollectionsPath();
        fs.mkdirSync(collectionsDir, { recursive: true });
        const { collectionId } = await seedCollectionsDir(collectionsDir);

        const service = new CollectionService(config);
        expect(isLightLoaded(service.getAllCollections()[0].items[0])).toBe(true);
        const collection = service.getCollection(collectionId);
        if (!collection) throw new Error('collection not loaded');
        await service.saveCollection(collection);

        const reloaded = new FolderCollectionStore(collectionsDir).loadAll()[0]
            .items[0] as CollectionRequestItem;
        expect(reloaded.body?.content).toContain('widget');
        expect(reloaded.scripts?.postResponse).toContain('pm.test');
        expect(reloaded.doc).toContain('Creates an order');
        expect(reloaded.responseSchema).toBeDefined();
        expect(reloaded.bodySchema).toBeDefined();
    });

    it('updating a light item preserves heavy files', async () => {
        const ws = mkTemp('light-update-');
        const config = new ConfigService(ws);
        const collectionsDir = config.getCollectionsPath();
        fs.mkdirSync(collectionsDir, { recursive: true });
        const { collectionId } = await seedCollectionsDir(collectionsDir);

        const service = new CollectionService(config);
        await service.updateRequest(collectionId, 'req-1', { name: 'Renamed order' });

        const reloaded = new FolderCollectionStore(collectionsDir).loadAll()[0]
            .items[0] as CollectionRequestItem;
        expect(reloaded.name).toBe('Renamed order');
        expect(reloaded.body?.content).toContain('widget');
        expect(reloaded.scripts?.postResponse).toContain('pm.test');
        expect(reloaded.doc).toContain('Creates an order');
    });
});
