import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../infrastructure/config/config-service';
import { CollectionService } from '../infrastructure/collection/collection-service';
import { TestSuiteService } from '../infrastructure/test-suite/test-suite-service';
import { EnvironmentConfigService } from '../infrastructure/environment/environment-config-service';

/**
 * Integration: ConfigService + CollectionService + TestSuiteService + EnvironmentConfigService
 * Verifies file-system side effects, watcher resilience, and interaction between the
 * 2 workspace modes (integrated .http-forge/ vs standalone generic).
 */

function writeCollection(root: string, slug: string): void {
    const dir = path.join(root, 'collections', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'collection.json'), JSON.stringify({ id: slug, name: slug, items: [] }), 'utf-8');
}

describe('Workspace modes integration', () => {
    const dirs: string[] = [];
    afterEach(() => {
        for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    });

    it('integrated: create collection → .http-forge/assets/collections + AGENTS.md, suites lazy', async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'int-int-'));
        dirs.push(ws);
        const cfg = new ConfigService(ws);
        const cols = new CollectionService(cfg);
        const suites = new TestSuiteService(cols, cfg, { watch: false });

        expect(fs.existsSync(path.join(ws, '.http-forge'))).toBe(false);
        expect(fs.existsSync(cfg.getSuitesPath())).toBe(false);

        await cols.createCollection('First');
        expect(fs.existsSync(path.join(ws, '.http-forge', 'assets', 'collections', 'first'))).toBe(true);
        expect(fs.existsSync(path.join(ws, '.http-forge', 'AGENTS.md'))).toBe(true);
        expect(fs.existsSync(cfg.getSuitesPath())).toBe(false);

        await suites.createSuite('S1');
        expect(fs.existsSync(cfg.getSuitesPath())).toBe(true);
        expect(cols.getAllCollections().map(c => c.name)).toContain('First');
    });

    it('standalone generic: create collection → assets/collections, no .http-forge', async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'my-standalone-'));
        dirs.push(ws);
        // Pre-create assets to force standalone detection (no .http-forge folder)
        fs.mkdirSync(path.join(ws, 'assets'), { recursive: true });
        const cfg = new ConfigService(ws);
        const cols = new CollectionService(cfg);
        expect(cfg.getRootPath()).toBe(path.join(ws, 'assets'));

        await cols.createCollection('StandCol');
        // Should be under assets, not .http-forge/assets
        expect(fs.existsSync(path.join(ws, 'assets', 'collections', 'standcol'))).toBe(true);
        expect(fs.existsSync(path.join(ws, '.http-forge'))).toBe(false);
    });

    it('standalone with existing assets: CollectionService + TestSuiteService share same root', async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'my-standalone2-'));
        dirs.push(ws);
        writeCollection(path.join(ws, 'assets'), 'existing');
        const cfg = new ConfigService(ws);
        const cols = new CollectionService(cfg);
        const suites = new TestSuiteService(cols, cfg, { watch: false });

        expect(cfg.getRootPath()).toBe(path.join(ws, 'assets'));
        expect(cols.getAllCollections().map(c => c.name)).toEqual(['existing']);
        expect(cfg.getSuitesPath()).toBe(path.join(ws, 'assets', 'suites'));

        await suites.createSuite('Suite1');
        expect(fs.existsSync(path.join(ws, 'assets', 'suites'))).toBe(true);
        expect(fs.existsSync(path.join(ws, '.http-forge'))).toBe(false);
    });

    it('opening assets directly (generic) → workspace is parent, collections load', async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'my-standalone3-'));
        dirs.push(ws);
        writeCollection(path.join(ws, 'assets'), 'c1');
        const cfg = new ConfigService(path.join(ws, 'assets'));
        expect(cfg.getWorkspacePath()).toBe(ws);
        const cols = new CollectionService(cfg);
        expect(cols.getAllCollections().map(c => c.name)).toEqual(['c1']);
        await cols.createCollection('NewViaAssets');
        expect(fs.existsSync(path.join(ws, 'assets', 'collections', 'newviaassets'))).toBe(true);
    });

    it('environment service creates environments lazily under correct root', async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'env-int-'));
        dirs.push(ws);
        const cfg = new ConfigService(ws);
        const envSvc = new EnvironmentConfigService(ws, undefined, cfg);
        // No dir yet
        expect(fs.existsSync(cfg.getEnvironmentsPath())).toBe(false);
        // Saving a shared config should create it under integrated root
        envSvc.saveSharedConfig({ environments: { dev: { variables: { a: '1' } } }, globalVariables: {}, defaultHeaders: {} });
        expect(fs.existsSync(path.join(ws, '.http-forge', 'assets', 'environments', 'dev.json'))).toBe(true);
        envSvc.dispose?.();

        const ws2 = fs.mkdtempSync(path.join(os.tmpdir(), 'my-env-stand-'));
        dirs.push(ws2);
        fs.mkdirSync(path.join(ws2, 'assets'), { recursive: true });
        const cfg2 = new ConfigService(ws2);
        const envSvc2 = new EnvironmentConfigService(ws2, undefined, cfg2);
        expect(cfg2.getRootPath()).toBe(path.join(ws2, 'assets'));
        envSvc2.saveSharedConfig({ environments: { prod: { variables: { b: '2' } } }, globalVariables: {}, defaultHeaders: {} });
        expect(fs.existsSync(path.join(ws2, 'assets', 'environments', 'prod.json'))).toBe(true);
        envSvc2.dispose?.();
    });

    it('file watcher does not crash when suites/collections dirs do not exist yet', async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'));
        dirs.push(ws);
        const cfg = new ConfigService(ws);
        const cols = new CollectionService(cfg);
        const suites = new TestSuiteService(cols, cfg, { watch: true });
        // Should not throw even though dirs missing
        expect(fs.existsSync(cfg.getCollectionsPath())).toBe(false);
        expect(fs.existsSync(cfg.getSuitesPath())).toBe(false);
        // After creating, watcher should still be alive (no exception)
        await cols.createCollection('Watched');
        await suites.createSuite('WatchedSuite');
        expect(fs.existsSync(cfg.getCollectionsPath())).toBe(true);
        suites.dispose();
        (cols as any).fileWatcher?.dispose?.();
    });

    it('priority: root config wins, and relative history is from that configDir', async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'prio-int-'));
        dirs.push(ws);
        fs.mkdirSync(path.join(ws, '.http-forge'), { recursive: true });
        fs.writeFileSync(path.join(ws, 'http-forge.config.json'), JSON.stringify({ version: '1.0', storage: { format: 'folder', root: './custom', history: './custom-hist', results: './custom-res' }, environments: { default: 'dev' } }), 'utf-8');
        fs.writeFileSync(path.join(ws, '.http-forge', 'http-forge.config.json'), JSON.stringify({ version: '1.0', storage: { format: 'folder', root: './should-not-win', history: './nope', results: './nope' }, environments: { default: 'dev' } }), 'utf-8');
        const cfg = new ConfigService(ws);
        expect(cfg.getRootPath()).toBe(path.join(ws, 'custom'));
        expect(cfg.getHistoryPath()).toBe(path.join(ws, 'custom-hist'));
        const cols = new CollectionService(cfg);
        await cols.createCollection('PrioCol');
        expect(fs.existsSync(path.join(ws, 'custom', 'collections', 'priocol'))).toBe(true);
        expect(fs.existsSync(path.join(ws, '.http-forge', 'assets'))).toBe(false);
    });

    it('bare collections at workspace root are still loaded (http-forge-assets style)', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'my-bare-'));
        dirs.push(ws);
        writeCollection(ws, 'bare1');
        const cfg = new ConfigService(ws);
        expect(cfg.getRootPath()).toBe(ws);
        const cols = new CollectionService(cfg);
        expect(cols.getAllCollections().map(c => c.name)).toEqual(['bare1']);
    });
});
