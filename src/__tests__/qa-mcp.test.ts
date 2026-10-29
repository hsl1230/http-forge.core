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
import { GENERIC_TOOL_NAMES } from '../runtime/mcp-tool-schemas';
import { GENERIC_TOOL_REGISTRY } from '../runtime/mcp-handlers/registry';
import { buildMcpToolList } from '../runtime/mcp-tool-builder';
import type { McpToolContext } from '../runtime/mcp-handlers/types';

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

function copyFixture(): string {
    const dir = mkTemp('qamcp-proj-');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(EXPRESS_APP, 'package.json'), path.join(dir, 'package.json'));
    fs.cpSync(path.join(EXPRESS_APP, 'src'), path.join(dir, 'src'), { recursive: true });
    return dir;
}

async function makeMcpWorld(ws: string, collectionName: string) {
    const config = new ConfigService(ws);
    fs.mkdirSync(config.getCollectionsPath(), { recursive: true });
    const store = new FolderCollectionStore(config.getCollectionsPath());
    const created = await store.create(collectionName);
    const collection = new CollectionService(config);
    const testSuite = new TestSuiteService(collection, config, { watch: false });
    const environmentConfig = new EnvironmentConfigService(ws, undefined, config);
    await environmentConfig.createEnvironment('test');
    await environmentConfig.setSelectedEnvironment('test');
    return { config, collection, testSuite, environmentConfig, collectionId: created.id };
}

function makeContext(
    world: Awaited<ReturnType<typeof makeMcpWorld>>,
    ws: string,
    args: Record<string, unknown>
): McpToolContext {
    return {
        tool: GENERIC_TOOL_NAMES.qaApi,
        args,
        services: {
            collection: world.collection,
            testSuite: world.testSuite,
            environmentConfig: world.environmentConfig,
            workspaceFolder: ws,
        },
        runStore: {},
        callbacks: {},
        collections: world.collection.getAllCollections(),
    } as unknown as McpToolContext;
}

async function startStub(): Promise<string> {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as NetAddressInfo).port}`;
}

describe('mcp qa_api handler', () => {
    it('registers qa_api in the registry', () => {
        expect(GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.qaApi)).toBeDefined();
    });

    it('dry-run reports the plan without side effects', async () => {
        const ws = mkTemp('qamcp-dry-');
        const projectPath = copyFixture();
        const world = await makeMcpWorld(ws, 'McpRegress');
        const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.qaApi)!;

        const result = (await handler.handle(
            makeContext(world, ws, {
                projectPath,
                collection: world.collectionId,
                baseUrl: 'http://127.0.0.1:9',
                dryRun: true,
            })
        )) as { status: string; discovered: number; hint: string };

        expect(result.status).toBe('dry-run');
        expect(result.discovered).toBeGreaterThan(0);
        expect(typeof result.hint).toBe('string');
        expect(world.collection.getCollection(world.collectionId)?.items).toHaveLength(0);
    });

    it('full run passes through the MCP dispatch path', async () => {
        const ws = mkTemp('qamcp-run-');
        const projectPath = copyFixture();
        const world = await makeMcpWorld(ws, 'McpRegress');
        const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.qaApi)!;
        const baseUrl = await startStub();

        const result = (await handler.handle(
            makeContext(world, ws, {
                projectPath,
                collection: world.collectionId,
                baseUrl,
                environment: 'test',
            })
        )) as { status: string; results: { passed: number; failed: number }; created: number };

        expect(result.status).toBe('pass');
        expect(result.results.failed).toBe(0);
        expect(result.created).toBeGreaterThan(0);
    });

    it('rejects missing collection and missing baseUrl', async () => {
        const ws = mkTemp('qamcp-err-');
        const projectPath = copyFixture();
        const world = await makeMcpWorld(ws, 'McpRegress');
        const handler = GENERIC_TOOL_REGISTRY.get(GENERIC_TOOL_NAMES.qaApi)!;

        await expect(
            handler.handle(makeContext(world, ws, { projectPath, baseUrl: 'http://x', dryRun: true }))
        ).rejects.toThrow('"collection" is required');

        await expect(
            handler.handle(
                makeContext(world, ws, { projectPath, collection: world.collectionId })
            )
        ).rejects.toThrow('"baseUrl" is required');
    });

    it('is exposed in drilldown but excluded from execution-only mode', async () => {
        const ws = mkTemp('qamcp-mode-');
        const world = await makeMcpWorld(ws, 'McpRegress');
        const base = world.config.getMcpConfig();

        const drilldown = buildMcpToolList([], [], { ...base, toolMode: 'drilldown' }, ws);
        expect(drilldown.some((t) => t.name === 'qa_api')).toBe(true);

        const executionOnly = buildMcpToolList([], [], { ...base, toolMode: 'execution-only' }, ws);
        expect(executionOnly.some((t) => t.name === 'qa_api')).toBe(false);
    });
});
