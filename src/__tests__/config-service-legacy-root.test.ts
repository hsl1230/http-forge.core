import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../infrastructure/config/config-service';

function writeCollection(rootPath: string, slug: string): void {
    const collectionDir = path.join(rootPath, 'collections', slug);
    fs.mkdirSync(collectionDir, { recursive: true });
    fs.writeFileSync(
        path.join(collectionDir, 'collection.json'),
        JSON.stringify({ id: slug, name: slug, items: [] }, null, 2),
        'utf-8',
    );
}

describe('ConfigService legacy root fallback', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        tempDirs.length = 0;
    });

    it('uses current default root when no config exists and no legacy root is found', () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-config-'));
        tempDirs.push(workspace);

        const svc = new ConfigService(workspace);
        expect(svc.configExists()).toBe(false);
        expect(svc.getCollectionsPath()).toBe(
            path.join(workspace, '.http-forge', 'assets', 'collections'),
        );
    });

    it('treats a .http-forge directory as the generated root, not the workspace root', () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-config-'));
        tempDirs.push(workspace);

        const forgeRoot = path.join(workspace, '.http-forge');
        fs.mkdirSync(forgeRoot, { recursive: true });

        const svc = new ConfigService(forgeRoot);
        expect(svc.configExists()).toBe(false);
        expect(svc.getCollectionsPath()).toBe(
            path.join(workspace, '.http-forge', 'assets', 'collections'),
        );
        expect(svc.getWorkspacePath()).toBe(workspace);
    });

    it('falls back to legacy ./http-forge-assets root when no config exists', () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-config-'));
        tempDirs.push(workspace);

        writeCollection(path.join(workspace, 'http-forge-assets'), 'legacy-assets-collection');

        const svc = new ConfigService(workspace);
        expect(svc.configExists()).toBe(false);
        expect(svc.getCollectionsPath()).toBe(
            path.join(workspace, 'http-forge-assets', 'collections'),
        );
    });

    it('prefers new default root when it already contains collections', () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-config-'));
        tempDirs.push(workspace);

        writeCollection(workspace, 'legacy-collection');
        writeCollection(path.join(workspace, '.http-forge', 'assets'), 'new-default-collection');

        const svc = new ConfigService(workspace);
        expect(svc.getCollectionsPath()).toBe(
            path.join(workspace, '.http-forge', 'assets', 'collections'),
        );
    });

    it('uses explicit configured root when config exists', () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-config-'));
        tempDirs.push(workspace);

        writeCollection(workspace, 'legacy-collection');

        const configDir = path.join(workspace, '.http-forge');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
            path.join(configDir, 'http-forge.config.json'),
            JSON.stringify(
                {
                    version: '1.0',
                    storage: {
                        format: 'folder',
                        root: './custom-root',
                        history: './.http-forge/.cache/histories',
                        results: './.http-forge/.cache/results',
                    },
                    request: {
                        timeout: 30000,
                        followRedirects: true,
                        maxRedirects: 10,
                        strictSSL: true,
                    },
                    scripts: {
                        modulePaths: ['./.http-forge/assets/src', './.http-forge/assets/lib'],
                        scope: 'shared',
                        timeout: 5000,
                    },
                    runner: {
                        resultsRetentionDays: 7,
                        indexPageSize: 1000,
                        recentErrorsLimit: 20,
                    },
                    environments: { default: 'dev' },
                    restClientExport: { path: 'collections-rest-client', mergeGlobals: true },
                    mcp: {
                        port: 3100,
                        excludedCollections: [],
                        excludedSuites: [],
                        toolPrefix: '',
                        maxRequestsPerCall: 500,
                        toolMode: 'auto',
                        drilldownThreshold: 100,
                        toolPageSize: 200,
                        cors: { allowedOrigins: ['http://localhost', 'http://127.0.0.1'] },
                    },
                    proxy: null,
                    secrets: {
                        providers: {
                            aws: { provider: 'aws' },
                            azure: { provider: 'azure', vaultUrl: '' },
                            gcp: { provider: 'gcp' },
                            vault: { provider: 'vault' },
                            op: { provider: '1password' },
                            doppler: { provider: 'doppler' },
                        },
                    },
                },
                null,
                2,
            ),
            'utf-8',
        );

        const svc = new ConfigService(workspace);
        expect(svc.configExists()).toBe(true);
        // root is relative to the config file location (.http-forge/)
        expect(svc.getCollectionsPath()).toBe(path.join(workspace, '.http-forge', 'custom-root', 'collections'));
    });

    it('uses current default cache paths when no config exists and no legacy cache is found', () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-config-'));
        tempDirs.push(workspace);

        const svc = new ConfigService(workspace);
        expect(svc.getHistoryPath()).toBe(path.join(workspace, '.http-forge', '.cache', 'histories'));
        expect(svc.getResultsPath()).toBe(path.join(workspace, '.http-forge', '.cache', 'results'));
    });

    it('falls back to legacy ./.http-forge-cache when no config exists and legacy cache has data', () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-config-'));
        tempDirs.push(workspace);

        const legacyHistory = path.join(workspace, '.http-forge-cache', 'histories');
        const legacyResults = path.join(workspace, '.http-forge-cache', 'results');
        fs.mkdirSync(legacyHistory, { recursive: true });
        fs.mkdirSync(legacyResults, { recursive: true });
        fs.writeFileSync(path.join(legacyHistory, 'history-entry.json'), '{}', 'utf-8');
        fs.writeFileSync(path.join(legacyResults, 'result-entry.json'), '{}', 'utf-8');

        const svc = new ConfigService(workspace);
        expect(svc.getHistoryPath()).toBe(legacyHistory);
        expect(svc.getResultsPath()).toBe(legacyResults);
    });

    it('loads discovery configuration from http-forge.config.json', () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-config-'));
        tempDirs.push(workspace);

        const configDir = path.join(workspace, '.http-forge');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
            path.join(configDir, 'http-forge.config.json'),
            JSON.stringify(
                {
                    version: '1.0',
                    storage: {
                        format: 'folder',
                        root: './.http-forge/assets',
                        history: './.http-forge/.cache/histories',
                        results: './.http-forge/.cache/results'
                    },
                    request: {
                        timeout: 30000,
                        followRedirects: true,
                        maxRedirects: 10,
                        strictSSL: true
                    },
                    scripts: {
                        modulePaths: ['./.http-forge/assets/src', './.http-forge/assets/lib'],
                        scope: 'shared',
                        timeout: 5000
                    },
                    runner: {
                        resultsRetentionDays: 7,
                        indexPageSize: 1000,
                        recentErrorsLimit: 20,
                        report: { maxBodyChars: 100000, embedBodies: 'failed' }
                    },
                    environments: { default: 'dev' },
                    discovery: {
                        customSeedLoaderModulePath: './node-api-forge-agl-loader.js',
                        frameworks: ['auto'],
                        contextProperties: ['locals'],
                        skipComponentAnalysis: true
                    }
                },
                null,
                2
            ),
            'utf-8'
        );

        const svc = new ConfigService(workspace);
        const discovery = svc.getDiscoveryConfig();
        expect(discovery.customSeedLoaderModulePath).toBe('./node-api-forge-agl-loader.js');
        expect(discovery.frameworks).toEqual(['auto']);
        expect(discovery.contextProperties).toEqual(['locals']);
        expect(discovery.skipComponentAnalysis).toBe(true);
    });
});
