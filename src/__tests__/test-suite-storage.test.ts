import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { materializeExternalContent } from '../infrastructure/test-suite/external-content';
import { TestSuiteService } from '../infrastructure/test-suite/test-suite-service';

const tmpDirs: string[] = [];

function makeService(): { service: TestSuiteService; suitesDir: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-suite-audit-'));
    tmpDirs.push(root);
    const suitesDir = path.join(root, 'suites');
    fs.mkdirSync(suitesDir, { recursive: true });
    const configService: any = { getSuitesPath: () => suitesDir };
    const collectionService: any = {};
    const service = new TestSuiteService(collectionService, configService, { watch: false });
    return { service, suitesDir };
}

function suite(id: string, name: string, overrides: any = {}) {
    return {
        id,
        name,
        nodes: [],
        scripts: {},
        config: { iterations: 1, delayBetweenRequests: 0, stopOnError: false },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...overrides,
    } as any;
}

function readSuiteJson(suitesDir: string, id: string): any {
    return JSON.parse(fs.readFileSync(path.join(suitesDir, id, 'suite.json'), 'utf-8'));
}

afterEach(() => {
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
    tmpDirs.length = 0;
});

describe('TestSuiteService storage modes', () => {
    it('saving one suite must not delete other suites', async () => {
        const { service, suitesDir } = makeService();
        await service.updateSuite(suite('alpha', 'Alpha'));
        await service.updateSuite(suite('beta', 'Beta'));

        expect(fs.existsSync(path.join(suitesDir, 'alpha', 'suite.json'))).toBe(true);
        expect(fs.existsSync(path.join(suitesDir, 'beta', 'suite.json'))).toBe(true);
    });

    it('deleting a legacy flat suite must not delete the entire suites directory', async () => {
        const { service, suitesDir } = makeService();
        await service.updateSuite(suite('alpha', 'Alpha'));

        fs.writeFileSync(path.join(suitesDir, 'legacy.suite.json'), JSON.stringify(suite('legacy', 'Legacy')), 'utf-8');
        service.loadSuites();

        const ok = await service.deleteSuite('legacy');
        expect(ok).toBe(true);
        expect(fs.existsSync(path.join(suitesDir, 'legacy.suite.json'))).toBe(false);
        expect(fs.existsSync(path.join(suitesDir, 'alpha', 'suite.json'))).toBe(true);
    });

    it('writes external script content to scripts/ and removes it from JSON', async () => {
        const { service, suitesDir } = makeService();
        const node = { type: 'script', name: 'Setup', storage: 'external', scriptRef: 'setup', script: 'console.log(1);' };
        await service.updateSuite(suite('s1', 'S1', { nodes: [node] }));

        const scriptPath = path.join(suitesDir, 's1', 'scripts', 'setup.js');
        expect(fs.readFileSync(scriptPath, 'utf-8')).toBe('console.log(1);');
        expect(fs.existsSync(scriptPath)).toBe(true);

        const saved = readSuiteJson(suitesDir, 's1');
        expect(saved.nodes[0].script).toBeUndefined();
        expect(saved.nodes[0].storage).toBe('external');
        expect(saved.nodes[0].scriptRef).toBe('setup');
        expect(saved.scripts?.['setup']).toBeUndefined();
    });

    it('loads external scripts lazily and moves content back inline on switch', async () => {
        const { service, suitesDir } = makeService();
        fs.mkdirSync(path.join(suitesDir, 's2', 'scripts'), { recursive: true });
        fs.writeFileSync(path.join(suitesDir, 's2', 'scripts', 'setup.js'), 'let x = 1;', 'utf-8');
        fs.writeFileSync(path.join(suitesDir, 's2', 'suite.json'), JSON.stringify(suite('s2', 'S2', {
            nodes: [{ type: 'script', name: 'Setup', storage: 'external', scriptRef: 'setup' }],
        })), 'utf-8');

        service.loadSuites();
        const loaded = await service.getSuite('s2');
        expect(loaded!.nodes[0]).toMatchObject({ storage: 'external', scriptRef: 'setup' });
        expect((loaded!.nodes[0] as any).script).toBeUndefined();

        // Switch to inline and save
        const node = loaded!.nodes[0] as any;
        node.storage = 'inline';
        await service.updateSuite(loaded!);

        const saved = readSuiteJson(suitesDir, 's2');
        expect(saved.nodes[0].script).toBe('let x = 1;');
        expect(saved.nodes[0].scriptRef).toBeUndefined();
        expect(fs.existsSync(path.join(suitesDir, 's2', 'scripts', 'setup.js'))).toBe(false);
    });

    it('writes external block nodes to blocks/ and clears them from JSON', async () => {
        const { service, suitesDir } = makeService();
        const node = {
            type: 'block',
            name: 'Auth Flow',
            storage: 'external',
            blockRef: 'auth',
            nodes: [{ type: 'script', name: 'Inner', script: 'inner();' }],
        };
        await service.updateSuite(suite('s3', 'S3', { nodes: [node] }));

        const blockPath = path.join(suitesDir, 's3', 'blocks', 'auth.block.json');
        const block = JSON.parse(fs.readFileSync(blockPath, 'utf-8'));
        expect(block.nodes).toHaveLength(1);

        const saved = readSuiteJson(suitesDir, 's3');
        expect(saved.nodes[0].storage).toBe('external');
        expect(saved.nodes[0].blockRef).toBe('blocks/auth.block.json');
        expect(saved.nodes[0].nodes).toEqual([]);
    });

    it('moves external block nodes back inline and deletes the file on switch', async () => {
        const { service, suitesDir } = makeService();
        fs.mkdirSync(path.join(suitesDir, 's4', 'blocks'), { recursive: true });
        fs.writeFileSync(path.join(suitesDir, 's4', 'blocks', 'auth.block.json'), JSON.stringify({
            id: 'auth', name: 'Auth', nodes: [{ type: 'script', name: 'Inner', script: 'inner();' }],
        }), 'utf-8');
        fs.writeFileSync(path.join(suitesDir, 's4', 'suite.json'), JSON.stringify(suite('s4', 'S4', {
            nodes: [{ type: 'block', name: 'Auth', storage: 'external', blockRef: 'blocks/auth.block.json', nodes: [] }],
        })), 'utf-8');

        service.loadSuites();
        const loaded = await service.getSuite('s4');
        (loaded!.nodes[0] as any).storage = 'inline';
        await service.updateSuite(loaded!);

        const saved = readSuiteJson(suitesDir, 's4');
        expect(saved.nodes[0].nodes).toHaveLength(1);
        expect(saved.nodes[0].blockRef).toBeUndefined();
        expect(fs.existsSync(path.join(suitesDir, 's4', 'blocks', 'auth.block.json'))).toBe(false);
    });

    it('does not truncate a lazily-loaded external block when saving', async () => {
        const { service, suitesDir } = makeService();
        fs.mkdirSync(path.join(suitesDir, 's5', 'blocks'), { recursive: true });
        fs.writeFileSync(path.join(suitesDir, 's5', 'blocks', 'auth.block.json'), JSON.stringify({
            id: 'auth', name: 'Auth', nodes: [{ type: 'script', name: 'Inner', script: 'inner();' }],
        }), 'utf-8');
        fs.writeFileSync(path.join(suitesDir, 's5', 'suite.json'), JSON.stringify(suite('s5', 'S5', {
            nodes: [{ type: 'block', name: 'Auth', storage: 'external', blockRef: 'blocks/auth.block.json', nodes: [] }],
        })), 'utf-8');

        service.loadSuites();
        const loaded = await service.getSuite('s5');
        await service.updateSuite(loaded!);

        const block = JSON.parse(fs.readFileSync(path.join(suitesDir, 's5', 'blocks', 'auth.block.json'), 'utf-8'));
        expect(block.nodes).toHaveLength(1);
    });

    it('saveBlockFile moves inline script content to an external file and clears it', () => {
        const { service, suitesDir } = makeService();
        const suiteDir = path.join(suitesDir, 's8');
        const blockPath = path.join(suiteDir, 'blocks', 'setup.block.json');

        service.saveBlockFile(blockPath, suiteDir, {
            id: 'Setup',
            name: 'Setup',
            nodes: [
                { type: 'script', name: 'Setup vars', storage: 'external', scriptRef: 'vars', script: 'pm.variables.set("x", 1);' },
            ],
        });

        expect(fs.readFileSync(path.join(suiteDir, 'scripts', 'vars.js'), 'utf-8'))
            .toBe('pm.variables.set("x", 1);');
        const saved = JSON.parse(fs.readFileSync(blockPath, 'utf-8'));
        expect(saved.nodes[0].script).toBeUndefined();
        expect(saved.nodes[0].storage).toBe('external');
        expect(saved.nodes[0].scriptRef).toBe('vars');
    });

    it('does not overwrite an existing external script with a stale library copy', () => {
        const { service, suitesDir } = makeService();
        const suiteDir = path.join(suitesDir, 's9');
        const blockPath = path.join(suiteDir, 'blocks', 'setup.block.json');
        fs.mkdirSync(path.join(suiteDir, 'scripts'), { recursive: true });
        fs.writeFileSync(path.join(suiteDir, 'scripts', 'vars.js'), 'fresh();', 'utf-8');

        service.saveBlockFile(blockPath, suiteDir, {
            id: 'Setup',
            name: 'Setup',
            nodes: [{ type: 'script', storage: 'external', scriptRef: 'vars' }],
        }, { vars: 'stale();' });

        expect(fs.readFileSync(path.join(suiteDir, 'scripts', 'vars.js'), 'utf-8')).toBe('fresh();');
    });

    it('materializes external scripts and blocks for execution', () => {
        const { suitesDir } = makeService();
        const suiteDir = path.join(suitesDir, 's7');
        fs.mkdirSync(path.join(suiteDir, 'scripts'), { recursive: true });
        fs.mkdirSync(path.join(suiteDir, 'blocks'), { recursive: true });
        fs.writeFileSync(path.join(suiteDir, 'scripts', 'setup.js'), 'setup();', 'utf-8');
        fs.writeFileSync(path.join(suiteDir, 'blocks', 'auth.block.json'), JSON.stringify({
            id: 'auth', name: 'Auth', nodes: [{ type: 'script', scriptRef: 'inner' }],
        }), 'utf-8');
        fs.writeFileSync(path.join(suiteDir, 'scripts', 'inner.js'), 'inner();', 'utf-8');

        const resolved = materializeExternalContent([
            { type: 'script', storage: 'external', scriptRef: 'setup' },
            { type: 'block', storage: 'external', blockRef: 'auth', nodes: [] },
        ], suiteDir);

        expect(resolved[0].script).toBe('setup();');
        expect(resolved[1].nodes).toHaveLength(1);
        expect(resolved[1].nodes[0].script).toBe('inner();');
    });

    it('preserves legacy inline scriptRef keys (does not create external files)', async () => {
        const { service, suitesDir } = makeService();
        const node = { type: 'script', name: 'Shared', scriptRef: 'shared' };
        await service.updateSuite(suite('s6', 'S6', { nodes: [node], scripts: { shared: 'console.log(2);' } }));

        expect(fs.existsSync(path.join(suitesDir, 's6', 'scripts', 'shared.js'))).toBe(false);
        const saved = readSuiteJson(suitesDir, 's6');
        expect(saved.nodes[0].scriptRef).toBe('shared');
        expect(saved.scripts.shared).toBe('console.log(2);');
    });
});
