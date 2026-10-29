import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { AddressInfo as NetAddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../infrastructure/config/config-service';
import { CollectionService } from '../infrastructure/collection/collection-service';
import { FolderCollectionStore } from '../infrastructure/collection/folder-collection-store';
import { TestSuiteService } from '../infrastructure/test-suite/test-suite-service';
import { EnvironmentConfigService } from '../infrastructure/environment/environment-config-service';
import { runQaCheck, type QaCheckServices } from '../infrastructure/qa/qa-service';
import { renderQaReportTable } from '../infrastructure/qa/qa-report';
import type { IAiProvider } from '../infrastructure/ai/ai-provider';

const EXPRESS_APP = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'test-fixtures',
    'express-app'
);

const dirs: string[] = [];
const servers: http.Server[] = [];
afterEach(async () => {
    for (const s of servers.splice(0)) {
        await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function mkTemp(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
}

/** Minimal project copy (package.json + src only — node_modules would be skipped anyway). */
function copyFixture(): string {
    const dir = mkTemp('qa-proj-');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(EXPRESS_APP, 'package.json'), path.join(dir, 'package.json'));
    fs.cpSync(path.join(EXPRESS_APP, 'src'), path.join(dir, 'src'), { recursive: true });
    return dir;
}

function makeServices(ws: string): { services: QaCheckServices; store: FolderCollectionStore } {
    const config = new ConfigService(ws);
    fs.mkdirSync(config.getCollectionsPath(), { recursive: true });
    const store = new FolderCollectionStore(config.getCollectionsPath());
    const collection = new CollectionService(config);
    const testSuite = new TestSuiteService(collection, config, { watch: false });
    return { services: { collection, testSuite, config }, store };
}

async function seedCollection(ws: string, name: string): Promise<string> {
    const config = new ConfigService(ws);
    fs.mkdirSync(config.getCollectionsPath(), { recursive: true });
    const store = new FolderCollectionStore(config.getCollectionsPath());
    const col = await store.create(name);
    // Runs resolve variables against a real environment — create + select one.
    const envs = new EnvironmentConfigService(ws, undefined, config);
    await envs.createEnvironment('test');
    await envs.setSelectedEnvironment('test');
    return col.id;
}

function pathToRegex(pathExpression: string): RegExp {
    const pattern = pathExpression
        .split('/')
        .map((seg) => (/^[:{]/.test(seg) ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        .join('/');
    return new RegExp(`^${pattern}/?$`);
}

/** Stub server answering each discovered endpoint with its expected status. */
async function startStub(
    routes: Array<{ method: string; path: string; status: number }>,
    override?: { method: string; path: string; status: number }
): Promise<string> {
    const compiled = routes.map((r) => ({ ...r, re: pathToRegex(r.path) }));
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const hit = compiled.find(
            (r) => r.method === (req.method ?? 'GET').toUpperCase() && r.re.test(url.pathname)
        );
        let status = hit?.status ?? 404;
        if (
            override &&
            override.method === (req.method ?? 'GET').toUpperCase() &&
            pathToRegex(override.path).test(url.pathname)
        ) {
            status = override.status;
        }
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: status < 400 }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    servers.push(server);
    const port = (server.address() as NetAddressInfo).port;
    return `http://127.0.0.1:${port}`;
}

describe('runQaCheck', () => {
    it('dry-run plans without side effects', async () => {
        const ws = mkTemp('qa-dry-');
        const projectPath = copyFixture();
        const collectionId = await seedCollection(ws, 'Regress');
        const { services } = makeServices(ws);

        const report = await runQaCheck(services, ws, {
            projectPath,
            collectionRef: collectionId,
            baseUrl: 'http://127.0.0.1:9',
            dryRun: true,
        });

        expect(report.status).toBe('dry-run');
        expect(report.discovered).toBeGreaterThan(0);
        expect(report.suite).toBeDefined();
        expect(report.results.skipped).toBe(report.discovered);
        // No requests created, no suite persisted.
        expect(services.collection.getCollection(collectionId)?.items).toHaveLength(0);
        expect(await services.testSuite.getSuite(report.suite!.id)).toBeUndefined();
        // Table renders without throwing and names every endpoint.
        const table = renderQaReportTable(report);
        expect(table).toContain('DRY-RUN');
        for (const ep of report.endpoints) expect(table).toContain(ep.path);
    });

    it('full run passes and reruns reuse everything', async () => {
        const ws = mkTemp('qa-green-');
        const projectPath = copyFixture();
        const collectionId = await seedCollection(ws, 'Regress');
        const { services } = makeServices(ws);

        const dry = await runQaCheck(services, ws, {
            projectPath,
            collectionRef: collectionId,
            baseUrl: 'http://127.0.0.1:9',
            dryRun: true,
        });
        const baseUrl = await startStub(
            dry.endpoints.map((e) => ({ method: e.method, path: e.path, status: e.statusExpected }))
        );

        const first = await runQaCheck(services, ws, {
            projectPath,
            collectionRef: collectionId,
            baseUrl,
            environment: 'test',
        });

        expect(first.status).toBe('pass');
        expect(first.results.failed).toBe(0);
        expect(first.results.passed).toBe(first.discovered);
        expect(first.created).toBe(first.discovered);
        expect(first.reused).toBe(0);
        expect(await services.testSuite.getSuite(first.suite!.id)).toBeDefined();
        const idsAfterFirst = services.collection
            .getCollection(collectionId)!
            .items.map((i) => i.id)
            .sort();

        const second = await runQaCheck(services, ws, {
            projectPath,
            collectionRef: collectionId,
            baseUrl,
            environment: 'test',
        });

        expect(second.status).toBe('pass');
        expect(second.created).toBe(0);
        expect(second.reused).toBe(second.discovered);
        expect(second.suite!.id).toBe(first.suite!.id);
        const idsAfterSecond = services.collection
            .getCollection(collectionId)!
            .items.map((i) => i.id)
            .sort();
        expect(idsAfterSecond).toEqual(idsAfterFirst);

        const table = renderQaReportTable(second);
        expect(table).toContain('PASS');
        expect(table).toContain(`${second.results.passed} passed`);
    });

    it('reports per-endpoint failures with expected vs actual status', async () => {
        const ws = mkTemp('qa-red-');
        const projectPath = copyFixture();
        const collectionId = await seedCollection(ws, 'Regress');
        const { services } = makeServices(ws);

        const dry = await runQaCheck(services, ws, {
            projectPath,
            collectionRef: collectionId,
            baseUrl: 'http://127.0.0.1:9',
            dryRun: true,
        });
        const victim = dry.endpoints.find((e) => e.method === 'GET' && e.path === '/users')!;
        const baseUrl = await startStub(
            dry.endpoints.map((e) => ({ method: e.method, path: e.path, status: e.statusExpected })),
            { method: victim.method, path: victim.path, status: 500 }
        );

        const report = await runQaCheck(services, ws, {
            projectPath,
            collectionRef: collectionId,
            baseUrl,
            environment: 'test',
        });

        expect(report.status).toBe('fail');
        expect(report.results.failed).toBe(1);
        const row = report.endpoints.find((e) => e.path === victim.path && e.method === victim.method)!;
        expect(row.passed).toBe(false);
        expect(row.statusExpected).toBe(victim.statusExpected);
        expect(row.statusGot).toBe(500);
        expect(renderQaReportTable(report)).toContain('FAIL');
    });

    it('failOnDrift short-circuits a moved project', async () => {
        const ws = mkTemp('qa-drift-');
        const projectPath = copyFixture();
        const collectionId = await seedCollection(ws, 'Regress');
        const { services } = makeServices(ws);

        const report = await runQaCheck(services, ws, {
            projectPath,
            collectionRef: collectionId,
            baseUrl: 'http://127.0.0.1:9',
            failOnDrift: true,
            storedScannedAt: new Date(Date.now() - 60_000).toISOString(),
        });

        expect(report.status).toBe('drift');
        expect(report.drift.status).toBe('stale');
        expect(report.discovered).toBe(0);
        expect(report.suite).toBeUndefined();
        // Nothing persisted.
        expect(services.collection.getCollection(collectionId)?.items).toHaveLength(0);
    });

    it('rejects unknown frameworks, missing collections, and missing base-url', async () => {
        const ws = mkTemp('qa-err-');
        const projectPath = copyFixture();
        const collectionId = await seedCollection(ws, 'Regress');
        const { services } = makeServices(ws);

        await expect(
            runQaCheck(services, ws, {
                projectPath,
                collectionRef: collectionId,
                baseUrl: 'http://127.0.0.1:9',
                framework: 'cobol',
            })
        ).rejects.toThrow('unknown framework');

        await expect(
            runQaCheck(services, ws, {
                projectPath,
                collectionRef: 'no-such-collection',
                baseUrl: 'http://127.0.0.1:9',
                dryRun: true,
            })
        ).rejects.toThrow();

        await expect(
            runQaCheck(services, ws, {
                projectPath,
                collectionRef: collectionId,
            })
        ).rejects.toThrow('base-url is required');
    });

    it('attaches AI suggestions when a provider is supplied', async () => {
        const ws = mkTemp('qa-ai-');
        const projectPath = copyFixture();
        const collectionId = await seedCollection(ws, 'Regress');
        const { services } = makeServices(ws);

        const dry = await runQaCheck(services, ws, {
            projectPath,
            collectionRef: collectionId,
            baseUrl: 'http://127.0.0.1:9',
            dryRun: true,
        });
        const baseUrl = await startStub(
            dry.endpoints.map((e) => ({ method: e.method, path: e.path, status: e.statusExpected }))
        );
        const provider: IAiProvider = {
            complete: async () =>
                JSON.stringify([
                    { snippet: 'pm.test("ai", () => {});', rationale: 'AI check' },
                ]),
        };

        const report = await runQaCheck(services, ws, {
            projectPath,
            collectionRef: collectionId,
            baseUrl,
            environment: 'test',
            aiAssertions: true,
            aiProvider: provider,
        });

        expect(report.status).toBe('pass');
        expect(report.aiAssertions).toMatchObject({ requested: true, applied: true });
        expect(report.endpoints.every((e) => (e.suggestions ?? []).length > 0)).toBe(true);
    });

    it('notes skipped AI pass when no provider is available', async () => {
        const ws = mkTemp('qa-ainone-');
        const projectPath = copyFixture();
        const collectionId = await seedCollection(ws, 'Regress');
        const { services } = makeServices(ws);

        const dry = await runQaCheck(services, ws, {
            projectPath,
            collectionRef: collectionId,
            baseUrl: 'http://127.0.0.1:9',
            dryRun: true,
        });
        const baseUrl = await startStub(
            dry.endpoints.map((e) => ({ method: e.method, path: e.path, status: e.statusExpected }))
        );

        const report = await runQaCheck(services, ws, {
            projectPath,
            collectionRef: collectionId,
            baseUrl,
            environment: 'test',
            aiAssertions: true,
        });

        expect(report.status).toBe('pass');
        expect(report.aiAssertions.requested).toBe(true);
        expect(report.aiAssertions.applied).toBe(false);
        expect(report.aiAssertions.note).toContain('no AI provider');
    });
});
