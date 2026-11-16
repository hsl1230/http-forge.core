/**
 * Script source filenames
 *
 * Each script segment is executed as its own `vm.Script` with an explicit
 * filename so the Node debugger can resolve file-based breakpoints to the
 * script file a user actually opened (collection / folder / request level).
 *
 * These tests assert the observable contract:
 *   - the supplied filename appears in the executed script's stack traces
 *   - shared mode keeps top-level lexical bindings across segments
 *   - isolated mode runs post-response segments (incl. top-level await)
 *   - empty segment lists are a no-op
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PreRequestScriptContext, ResponseContext } from '../infrastructure/script/interfaces';
import { ScriptExecutor } from '../infrastructure/script/script-executor';
import { requestScriptSources } from '../infrastructure/script/script-utils';
import { ForgeEnv } from '../infrastructure/environment/forge-env';
import { RequestExecutor } from '../infrastructure/execution/request-executor';
import { FolderCollectionStore } from '../infrastructure/collection/folder-collection-store';
import { writeScriptsToDir } from '../infrastructure/collection/folder-io';
import type { CollectionRequestItem, RequestScripts } from '../types/collection';
import type { IHttpClient } from '../types/platform';
import type { UnifiedCollection, UnifiedRequest } from '../types/types';

const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

function makeContext(): PreRequestScriptContext {
    return {
        request: { url: 'http://example.com', method: 'GET', headers: {}, name: 'test', id: 'req1' },
        variables: {},
        environmentVariables: {},
        globals: {},
        environmentName: 'dev',
        onGlobalsChange: () => { /* no-op */ },
        info: { eventName: 'prerequest', requestName: 'test', requestId: 'r1' }
    } as PreRequestScriptContext;
}

function makeResponseContext(): ResponseContext {
    return {
        executedRequest: {
            url: 'http://example.com',
            method: 'GET',
            headers: {},
            body: { type: 'none', content: null },
            params: {},
            query: {}
        },
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        responseTime: 1
    };
}

describe('script source filenames', () => {
    it('reports the provided filename in executed script stack traces', async () => {
        const executor = new ScriptExecutor();
        const session = executor.createRequestSession(makeContext());
        const filename = '/tmp/forge/collections/demo/scripts/post-response.js';

        const result = await session.executePostResponse(
            [{ code: `console.log(new Error('boom').stack);`, filename }],
            makeResponseContext()
        );

        expect(result.consoleOutput?.join('\n')).toContain(filename);
    });

    it('keeps top-level lexical bindings across segments in shared mode', async () => {
        const executor = new ScriptExecutor();
        const session = executor.createRequestSession(makeContext());

        const result = await session.executePreRequest([
            { code: 'let sharedLet = 41; const sharedConst = 1;', filename: '/tmp/forge/scripts/a.js' },
            { code: 'sharedLet += sharedConst; pm.variables.set("result", String(sharedLet));', filename: '/tmp/forge/scripts/b.js' }
        ]);

        expect(result.success).toBe(true);
        expect(result.nonGlobalVariables?.result).toBe('42');
    });

    it('runs post-response segments (including top-level await) in isolated mode', async () => {
        const executor = new ScriptExecutor(undefined, [], undefined, 'isolated');
        const session = executor.createRequestSession(makeContext());

        const result = await session.executePostResponse(
            [{
                code: `await Promise.resolve();\npm.test('isolated post runs', () => { pm.expect(1).to.equal(1); });`,
                filename: '/tmp/forge/scripts/post-response.js'
            }],
            makeResponseContext()
        );

        expect(result.testResults).toHaveLength(1);
        expect(result.testResults[0].passed).toBe(true);
    });

    it('treats an empty segment list as a no-op', async () => {
        const executor = new ScriptExecutor();
        const session = executor.createRequestSession(makeContext());

        const pre = await session.executePreRequest([]);
        const post = await session.executePostResponse([], makeResponseContext());

        expect(pre.success).toBe(true);
        expect(post.testResults).toHaveLength(0);
    });
});

describe('requestScriptSources', () => {
    it('uses the load-time absolute path as the filename', () => {
        const sources = requestScriptSources({
            preRequest: 'console.log(1)',
            preRequestPath: '/tmp/forge/collections/demo/scripts/pre-request.js'
        }, 'preRequest');

        expect(sources).toEqual([{
            code: 'console.log(1)',
            filename: '/tmp/forge/collections/demo/scripts/pre-request.js'
        }]);
    });

    it('falls back to a synthetic filename for inline drafts', () => {
        expect(requestScriptSources({ postResponse: 'console.log(2)' }, 'postResponse')).toEqual([
            { code: 'console.log(2)', filename: 'post-response.js' }
        ]);
    });

    it('returns no sources when the phase has no code', () => {
        expect(requestScriptSources(undefined, 'preRequest')).toEqual([]);
        expect(requestScriptSources({ preRequestPath: '/tmp/forge/scripts/pre-request.js' }, 'preRequest')).toEqual([]);
    });
});

describe('RequestExecutor script filenames', () => {
    it('runs collection, folder, and request scripts with their recorded paths', async () => {
        const httpClient: IHttpClient = {
            send: async () => ({
                status: 200,
                statusText: 'OK',
                headers: {},
                body: 'ok',
                cookies: []
            } as any)
        };
        const executor = new RequestExecutor(httpClient, ForgeEnv.create({}));

        const collection = {
            id: 'c1',
            name: 'Paths',
            items: [{
                type: 'folder',
                id: 'f1',
                name: 'Folder',
                scripts: {
                    preRequest: `console.log(new Error('folder').stack);`,
                    preRequestPath: '/tmp/forge/collection/folder/scripts/pre-request.js'
                },
                items: [{
                    type: 'request',
                    id: 'r1',
                    name: 'Request',
                    method: 'GET',
                    url: 'http://example.test/',
                    headers: [],
                    query: [],
                    scripts: {
                        preRequest: `console.log(new Error('request').stack);`,
                        preRequestPath: '/tmp/forge/collection/folder/request/scripts/pre-request.js'
                    }
                }]
            }],
            scripts: {
                preRequest: `console.log(new Error('collection').stack);`,
                preRequestPath: '/tmp/forge/collection/scripts/pre-request.js'
            }
        } as unknown as UnifiedCollection;

        const request = (collection.items[0] as any).items[0] as UnifiedRequest;
        const result = await executor.execute(request, collection);
        const output = result.preRequestResult?.consoleOutput?.join('\n') ?? '';

        expect(output).toContain('/tmp/forge/collection/scripts/pre-request.js');
        expect(output).toContain('/tmp/forge/collection/folder/scripts/pre-request.js');
        expect(output).toContain('/tmp/forge/collection/folder/request/scripts/pre-request.js');
    });
});

describe('writeScriptsToDir paths', () => {
    it('fills the path fields on the passed scripts object', async () => {
        const dir = makeTempDir('forge-script-write-');
        const scripts: RequestScripts = {
            preRequest: 'console.log(1)',
            postResponse: 'console.log(2)'
        };

        await writeScriptsToDir(dir, scripts);

        expect(scripts.preRequestPath).toBe(path.join(dir, 'pre-request.js'));
        expect(scripts.postResponsePath).toBe(path.join(dir, 'post-response.js'));
    });

    it('clears a stale path when a script is removed', async () => {
        const dir = makeTempDir('forge-script-clear-');
        const scripts: RequestScripts = {
            preRequest: 'console.log(1)',
            preRequestPath: '/stale/pre-request.js'
        };

        await writeScriptsToDir(dir, scripts);
        scripts.preRequest = '';
        await writeScriptsToDir(dir, scripts);

        expect(scripts.preRequestPath).toBeUndefined();
    });
});

describe('collection save script paths', () => {
    it('leaves a fully saved collection debug-ready in memory', async () => {
        const dir = makeTempDir('forge-script-save-');
        const store = new FolderCollectionStore(dir);
        const collection = await store.create('Paths');
        collection.scripts = { postResponse: 'console.log("collection")' };
        collection.items.push({
            id: 'req-1',
            type: 'request',
            name: 'Request',
            method: 'GET',
            url: 'https://example.test/',
            headers: [],
            scripts: { preRequest: 'console.log("request")' }
        } as CollectionRequestItem);

        await store.save(collection);

        const collectionPath = store.getCollectionPath(collection.id);
        const itemPath = store.getItemPath(collection.id, 'req-1');
        if (!collectionPath || !itemPath) throw new Error('saved paths not found');

        expect(collection.scripts?.postResponsePath).toBe(path.join(collectionPath, 'scripts', 'post-response.js'));
        expect((collection.items[0] as CollectionRequestItem).scripts?.preRequestPath)
            .toBe(path.join(itemPath, 'scripts', 'pre-request.js'));
    });

    it('fills paths on the caller object when saving item scripts', async () => {
        const dir = makeTempDir('forge-script-item-');
        const store = new FolderCollectionStore(dir);
        const collection = await store.create('Paths');
        await store.saveItem(collection.id, {
            id: 'req-1',
            type: 'request',
            name: 'Request',
            method: 'GET',
            url: 'https://example.test/',
            headers: []
        } as CollectionRequestItem);

        const scripts: RequestScripts = { preRequest: 'console.log(1)' };
        await store.saveScripts(collection.id, 'req-1', scripts);

        const itemPath = store.getItemPath(collection.id, 'req-1');
        if (!itemPath) throw new Error('saved item path not found');

        expect(scripts.preRequestPath).toBe(path.join(itemPath, 'scripts', 'pre-request.js'));
    });
});
