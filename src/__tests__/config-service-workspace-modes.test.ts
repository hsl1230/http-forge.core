import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../infrastructure/config/config-service';
import { CollectionService } from '../infrastructure/collection/collection-service';
import { TestSuiteService } from '../infrastructure/test-suite/test-suite-service';
import { FolderCollectionStore } from '../infrastructure/collection/folder-collection-store';

function writeCollection(rootPath: string, slug: string): void {
    const dir = path.join(rootPath, 'collections', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'collection.json'), JSON.stringify({ id: slug, name: slug, items: [] }), 'utf-8');
}

function writeConfig(dir: string, storage: { root: string; history: string; results: string }, modulePaths?: string[]): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'http-forge.config.json'),
        JSON.stringify(
            {
                version: '1.0',
                storage: { format: 'folder', root: storage.root, history: storage.history, results: storage.results },
                scripts: { modulePaths: modulePaths ?? ['./.http-forge/assets/src'], scope: 'shared', timeout: 5000 },
                request: { timeout: 30000, followRedirects: true, maxRedirects: 10, strictSSL: true },
                runner: { resultsRetentionDays: 7, indexPageSize: 1000, recentErrorsLimit: 20, report: { maxBodyChars: 100000, embedBodies: 'failed' } },
                environments: { default: 'dev' },
            },
            null,
            2,
        ),
        'utf-8',
    );
}

describe('ConfigService workspace modes — integrated vs standalone (any name)', () => {
    const dirs: string[] = [];
    afterEach(() => {
        for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    });

    it('integrated: no config, assets under .http-forge/assets', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-int-'));
        dirs.push(ws);
        writeCollection(path.join(ws, '.http-forge', 'assets'), 'col1');
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(path.join(ws, '.http-forge', 'assets'));
        expect(svc.getCollectionsPath()).toBe(path.join(ws, '.http-forge', 'assets', 'collections'));
    });

    it('standalone: no config, assets at workspace/assets (generic name)', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'my-standalone-'));
        dirs.push(ws);
        writeCollection(path.join(ws, 'assets'), 'col1');
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(path.join(ws, 'assets'));
        expect(svc.getCollectionsPath()).toBe(path.join(ws, 'assets', 'collections'));
    });

    it('standalone bare: no config, collections at workspace/collections (http-forge-assets style, any name)', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'my-bare-'));
        dirs.push(ws);
        writeCollection(ws, 'col1');
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(ws);
        expect(svc.getCollectionsPath()).toBe(path.join(ws, 'collections'));
    });

    it('standalone generic name with bare collections is name-agnostic', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'acme-api-'));
        dirs.push(ws);
        writeCollection(ws, 'col1');
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(ws);
    });

    it('root config takes priority over nested .http-forge config', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-prio-'));
        dirs.push(ws);
        writeConfig(ws, { root: './custom-root', history: './.cache/h', results: './.cache/r' });
        writeConfig(path.join(ws, '.http-forge'), { root: './nested-root', history: './.cache/h', results: './.cache/r' });
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(path.join(ws, 'custom-root'));
    });

    it('nested config with ./assets is relative to .http-forge', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-nested-'));
        dirs.push(ws);
        writeConfig(path.join(ws, '.http-forge'), { root: './assets', history: './.cache/h', results: './.cache/r' });
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(path.join(ws, '.http-forge', 'assets'));
        expect(svc.getCollectionsPath()).toBe(path.join(ws, '.http-forge', 'assets', 'collections'));
    });

    it('nested old default ./.http-forge/assets is stripped to ./assets (backward compat)', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-old-'));
        dirs.push(ws);
        writeConfig(path.join(ws, '.http-forge'), { root: './.http-forge/assets', history: './.http-forge/.cache/h', results: './.http-forge/.cache/r' }, ['./.http-forge/assets/src']);
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(path.join(ws, '.http-forge', 'assets'));
        expect(svc.getHistoryPath()).toBe(path.join(ws, '.http-forge', '.cache', 'h'));
        expect(svc.getResultsPath()).toBe(path.join(ws, '.http-forge', '.cache', 'r'));
        expect(svc.getModulePaths()).toEqual([path.join(ws, '.http-forge', 'assets', 'src')]);
    });

    it('root config with ./.http-forge/assets stays workspace-relative when integrated (has .http-forge folder)', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-root-int-'));
        dirs.push(ws);
        fs.mkdirSync(path.join(ws, '.http-forge'), { recursive: true });
        writeConfig(ws, { root: './.http-forge/assets', history: './.http-forge/.cache/h', results: './.http-forge/.cache/r' });
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(path.join(ws, '.http-forge', 'assets'));
    });

    it('standalone root config ./assets is relative to workspace', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-standcfg-'));
        dirs.push(ws);
        writeCollection(path.join(ws, 'assets'), 'col1');
        writeConfig(ws, { root: './assets', history: './.cache/h', results: './.cache/r' });
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(path.join(ws, 'assets'));
        expect(svc.getHistoryPath()).toBe(path.join(ws, '.cache', 'h'));
    });

    it('standalone root old default ./.http-forge/assets is stripped to ./assets when no .http-forge folder', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-stand-old-'));
        dirs.push(ws);
        writeCollection(path.join(ws, 'assets'), 'col1');
        writeConfig(ws, { root: './.http-forge/assets', history: './.http-forge/.cache/h', results: './.http-forge/.cache/r' }, ['./.http-forge/assets/src']);
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(path.join(ws, 'assets'));
        expect(svc.getHistoryPath()).toBe(path.join(ws, '.cache', 'h'));
        expect(svc.getModulePaths()).toEqual([path.join(ws, 'assets', 'src')]);
    });

    it('opening .http-forge folder directly as standalone (named .http-forge) keeps it as forge root', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-clone-'));
        dirs.push(tmp);
        const ws = path.join(tmp, '.http-forge');
        fs.mkdirSync(path.join(ws, 'assets', 'collections', 'col1'), { recursive: true });
        fs.writeFileSync(path.join(ws, 'assets', 'collections', 'col1', 'collection.json'), JSON.stringify({ id: 'col1' }));
        writeConfig(ws, { root: './assets', history: './.cache/h', results: './.cache/r' });
        const svc = new ConfigService(ws);
        expect(svc.getWorkspacePath()).toBe(ws);
        expect(svc.getRootPath()).toBe(path.join(ws, 'assets'));
    });

    it('opening .http-forge folder directly when empty normalizes to parent (integrated)', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-empty-'));
        dirs.push(ws);
        const forgeRoot = path.join(ws, '.http-forge');
        fs.mkdirSync(forgeRoot, { recursive: true });
        const svc = new ConfigService(forgeRoot);
        expect(svc.getWorkspacePath()).toBe(ws);
        expect(svc.getCollectionsPath()).toBe(path.join(ws, '.http-forge', 'assets', 'collections'));
    });

    it('opening assets directly — generic standalone (any name) normalizes to parent', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'my-standalone-'));
        dirs.push(ws);
        writeCollection(path.join(ws, 'assets'), 'c1');
        const assetsPath = path.join(ws, 'assets');
        const svc = new ConfigService(assetsPath);
        expect(svc.getWorkspacePath()).toBe(ws);
        expect(svc.getRootPath()).toBe(path.join(ws, 'assets'));
        expect(svc.getCollectionsPath()).toBe(path.join(ws, 'assets', 'collections'));
    });

    it('opening .http-forge/assets directly (integrated) normalizes to project root', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'my-project-'));
        dirs.push(ws);
        writeCollection(path.join(ws, '.http-forge', 'assets'), 'c1');
        const assetsPath = path.join(ws, '.http-forge', 'assets');
        const svc = new ConfigService(assetsPath);
        expect(svc.getWorkspacePath()).toBe(ws);
        expect(svc.getRootPath()).toBe(path.join(ws, '.http-forge', 'assets'));
    });

    it('lazy: does not create .http-forge on construction, creates on first collection', async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'lazy-'));
        dirs.push(ws);
        const cfg = new ConfigService(ws);
        const colSvc = new CollectionService(cfg);
        expect(fs.existsSync(path.join(ws, '.http-forge'))).toBe(false);
        const store = new FolderCollectionStore(cfg.getCollectionsPath());
        expect(fs.existsSync(path.join(ws, '.http-forge'))).toBe(false);
        await colSvc.createCollection('First');
        expect(fs.existsSync(path.join(ws, '.http-forge', 'assets', 'collections'))).toBe(true);
        expect(fs.existsSync(path.join(ws, '.http-forge', 'AGENTS.md'))).toBe(true);
        // lazy for FolderCollectionStore directly
        const ws2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lazy2-'));
        dirs.push(ws2);
        const cfg2 = new ConfigService(ws2);
        const store2 = new FolderCollectionStore(cfg2.getCollectionsPath());
        expect(fs.existsSync(path.join(ws2, '.http-forge'))).toBe(false);
        await store2.save({ id: 'test', name: 'Test', items: [] });
        expect(fs.existsSync(path.join(ws2, '.http-forge', 'AGENTS.md'))).toBe(true);
    });

    it('lazy: does not create suites dir until first suite', async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'lazy-suite-'));
        dirs.push(ws);
        const cfg = new ConfigService(ws);
        const colSvc = new CollectionService(cfg);
        const suiteSvc = new TestSuiteService(colSvc, cfg, { watch: false });
        expect(fs.existsSync(cfg.getSuitesPath())).toBe(false);
        await suiteSvc.createSuite('My Suite');
        expect(fs.existsSync(cfg.getSuitesPath())).toBe(true);
    });

    it('standalone with assets — CollectionService loads collections via assets', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'my-standalone-'));
        dirs.push(ws);
        writeCollection(path.join(ws, 'assets'), 'mycol');
        const cfg = new ConfigService(ws);
        const colSvc = new CollectionService(cfg);
        expect(colSvc.getAllCollections().map(c => c.name)).toEqual(['mycol']);
    });

    it('integrated — CollectionService loads via .http-forge/assets', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'my-project-'));
        dirs.push(ws);
        writeCollection(path.join(ws, '.http-forge', 'assets'), 'mycol');
        const cfg = new ConfigService(ws);
        const colSvc = new CollectionService(cfg);
        expect(colSvc.getAllCollections().map(c => c.name)).toEqual(['mycol']);
    });

    it('opening assets directly (generic) still loads collections', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'my-standalone-'));
        dirs.push(ws);
        writeCollection(path.join(ws, 'assets'), 'c1');
        const cfg = new ConfigService(path.join(ws, 'assets'));
        const colSvc = new CollectionService(cfg);
        expect(colSvc.getAllCollections().map(c => c.name)).toEqual(['c1']);
    });

    it('createDefaultConfig writes correct relative root for nested vs standalone', async () => {
        // Nested (integrated) -> ./assets
        const ws1 = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-create-'));
        dirs.push(ws1);
        fs.mkdirSync(path.join(ws1, '.http-forge'), { recursive: true });
        const cfg1 = new ConfigService(ws1);
        await cfg1.createDefaultConfig();
        const c1 = JSON.parse(fs.readFileSync(path.join(ws1, '.http-forge', 'http-forge.config.json'), 'utf-8'));
        expect(c1.storage.root).toBe('./assets');
        expect(c1.storage.history).toBe('./.cache/histories');

        // Standalone (assets at root, no .http-forge) -> ./assets
        const ws2 = fs.mkdtempSync(path.join(os.tmpdir(), 'my-standalone-'));
        dirs.push(ws2);
        fs.mkdirSync(path.join(ws2, 'assets'), { recursive: true });
        const cfg2 = new ConfigService(ws2);
        await cfg2.createDefaultConfig();
        const c2 = JSON.parse(fs.readFileSync(path.join(ws2, 'http-forge.config.json'), 'utf-8'));
        expect(c2.storage.root).toBe('./assets');
    });

    it('history/results are relative to config location', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-hist-'));
        dirs.push(ws);
        // Nested old history
        writeConfig(path.join(ws, '.http-forge'), { root: './.http-forge/assets', history: './.http-forge/.cache/h', results: './.http-forge/.cache/r' });
        let svc = new ConfigService(ws);
        expect(svc.getHistoryPath()).toBe(path.join(ws, '.http-forge', '.cache', 'h'));
        fs.rmSync(path.join(ws, '.http-forge', 'http-forge.config.json'));
        fs.rmSync(path.join(ws, '.http-forge'), { recursive: true, force: true });
        // Standalone old history at root should be stripped
        fs.mkdirSync(path.join(ws, 'assets'), { recursive: true });
        writeConfig(ws, { root: './.http-forge/assets', history: './.http-forge/.cache/h', results: './.http-forge/.cache/r' });
        svc = new ConfigService(ws);
        expect(svc.getHistoryPath()).toBe(path.join(ws, '.cache', 'h'));
    });
});
