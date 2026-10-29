import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../infrastructure/config/config-service';

function writeRawConfig(dir: string, content: string): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'http-forge.config.json'), content, 'utf-8');
}

describe('ConfigService edge cases', () => {
    const dirs: string[] = [];
    afterEach(() => {
        for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    });

    it('absolute storage.root bypasses relative logic', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-abs-'));
        dirs.push(ws);
        const absRoot = path.join(os.tmpdir(), `hf-abs-root-${Date.now()}`);
        fs.mkdirSync(path.join(absRoot, 'collections'), { recursive: true });
        writeRawConfig(ws, JSON.stringify({ version: '1.0', storage: { format: 'folder', root: absRoot, history: absRoot, results: absRoot }, environments: { default: 'dev' } }));
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(absRoot);
        expect(svc.getCollectionsPath()).toBe(path.join(absRoot, 'collections'));
        fs.rmSync(absRoot, { recursive: true, force: true });
    });

    it('empty string storage.root resolves to configDir itself', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-empty-'));
        dirs.push(ws);
        writeRawConfig(ws, JSON.stringify({ version: '1.0', storage: { format: 'folder', root: '', history: '', results: '' }, environments: { default: 'dev' } }));
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(ws);
    });

    it('dot "." storage.root resolves to configDir', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-dot-'));
        dirs.push(ws);
        writeRawConfig(ws, JSON.stringify({ version: '1.0', storage: { format: 'folder', root: '.', history: '.', results: '.' }, environments: { default: 'dev' } }));
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(ws);
    });

    it('traversal "../" resolves to parent of configDir', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-trav-'));
        dirs.push(ws);
        writeRawConfig(path.join(ws, '.http-forge'), JSON.stringify({ version: '1.0', storage: { format: 'folder', root: '../other-root', history: '../other-hist', results: '../other-res' }, environments: { default: 'dev' } }));
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(path.join(ws, 'other-root'));
        expect(svc.getHistoryPath()).toBe(path.join(ws, 'other-hist'));
    });

    it('malformed JSON falls back to defaults and does not throw', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-badjson-'));
        dirs.push(ws);
        writeRawConfig(ws, '{ invalid json ');
        const svc = new ConfigService(ws);
        // Should still return default integrated root (no crash)
        expect(svc.getRootPath()).toBe(path.join(ws, '.http-forge', 'assets'));
        expect(svc.configExists()).toBe(true); // file exists even though parse failed
    });

    it('partial config (only root) merges with defaults for history/results', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-partial-'));
        dirs.push(ws);
        fs.mkdirSync(path.join(ws, '.http-forge'), { recursive: true });
        fs.writeFileSync(
            path.join(ws, '.http-forge', 'http-forge.config.json'),
            JSON.stringify({ version: '1.0', storage: { format: 'folder', root: './my-root' }, environments: { default: 'dev' } }),
            'utf-8',
        );
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(path.join(ws, '.http-forge', 'my-root'));
        // history/results should still be defaults relative to .http-forge
        expect(svc.getHistoryPath()).toBe(path.join(ws, '.http-forge', '.cache', 'histories'));
        expect(svc.getResultsPath()).toBe(path.join(ws, '.http-forge', '.cache', 'results'));
    });

    it('assets folder exists but empty (no collections) is not treated as assets root', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-empty-assets-'));
        dirs.push(ws);
        fs.mkdirSync(path.join(ws, 'assets'), { recursive: true });
        // Also create an empty .http-forge/assets with a collection to verify preference
        fs.mkdirSync(path.join(ws, '.http-forge', 'assets', 'collections', 'c1'), { recursive: true });
        fs.writeFileSync(path.join(ws, '.http-forge', 'assets', 'collections', 'c1', 'collection.json'), JSON.stringify({ id: 'c1' }), 'utf-8');
        const svc = new ConfigService(ws);
        // Should prefer .http-forge/assets because assets/ is empty
        expect(svc.getRootPath()).toBe(path.join(ws, '.http-forge', 'assets'));
    });

    it('trailing slash in storage.root is normalized', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-slash-'));
        dirs.push(ws);
        writeRawConfig(path.join(ws, '.http-forge'), JSON.stringify({ version: '1.0', storage: { format: 'folder', root: './assets/', history: './.cache/histories/', results: './.cache/results/' }, environments: { default: 'dev' } }));
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(path.join(ws, '.http-forge', 'assets'));
        expect(svc.getHistoryPath()).toBe(path.join(ws, '.http-forge', '.cache', 'histories'));
    });

    it('modulePaths with mixed absolute and relative', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-mods-'));
        dirs.push(ws);
        const absMod = path.join(os.tmpdir(), `hf-absmod-${Date.now()}`);
        fs.mkdirSync(absMod, { recursive: true });
        writeRawConfig(ws, JSON.stringify({ version: '1.0', storage: { format: 'folder', root: './.http-forge/assets', history: './.http-forge/.cache/h', results: './.http-forge/.cache/r' }, scripts: { modulePaths: [absMod, './assets/src'] }, environments: { default: 'dev' } }));
        const svc = new ConfigService(ws);
        const mods = svc.getModulePaths();
        expect(mods[0]).toBe(absMod);
        expect(mods[1]).toBe(path.join(ws, 'assets', 'src'));
        fs.rmSync(absMod, { recursive: true, force: true });
    });

    it('opening assets path that is not an assets root (no collections) stays as assets', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-notroot-'));
        dirs.push(ws);
        const assetsPath = path.join(ws, 'assets');
        fs.mkdirSync(assetsPath, { recursive: true });
        // No collections inside assets -> isAssetsRoot false
        const svc = new ConfigService(assetsPath);
        expect(svc.getWorkspacePath()).toBe(assetsPath);
    });

    it('both assets and .http-forge/assets have collections — integrated wins', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-both-'));
        dirs.push(ws);
        fs.mkdirSync(path.join(ws, 'assets', 'collections', 'c1'), { recursive: true });
        fs.writeFileSync(path.join(ws, 'assets', 'collections', 'c1', 'collection.json'), JSON.stringify({ id: 'c1' }), 'utf-8');
        fs.mkdirSync(path.join(ws, '.http-forge', 'assets', 'collections', 'c2'), { recursive: true });
        fs.writeFileSync(path.join(ws, '.http-forge', 'assets', 'collections', 'c2', 'collection.json'), JSON.stringify({ id: 'c2' }), 'utf-8');
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(path.join(ws, '.http-forge', 'assets'));
    });

    it('json storage format still resolves collections path via root', () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-jsonfmt-'));
        dirs.push(ws);
        writeRawConfig(ws, JSON.stringify({ version: '1.0', storage: { format: 'json', root: './my-json-root', history: './.cache/h', results: './.cache/r' }, environments: { default: 'dev' } }));
        const svc = new ConfigService(ws);
        expect(svc.getRootPath()).toBe(path.join(ws, 'my-json-root'));
        expect(svc.getStorageConfig().format).toBe('json');
    });
});
