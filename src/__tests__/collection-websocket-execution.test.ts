import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { FolderCollectionStore } from '../infrastructure/collection/folder-collection-store';
import { CollectionRequestExecutor } from '../infrastructure/execution/collection-request-executor';
import type { IRequestPreparer } from '../infrastructure/execution/request-preparer-interfaces';
import type { IHttpRequestService } from '../infrastructure/http/interfaces';
import { ScriptExecutor } from '../infrastructure/script/script-executor';
import { runCollection, runRequest, runSuite } from '../runtime/direct-execution';
import type { TestSuite } from '../infrastructure/test-suite/interfaces';
import type { Collection, CollectionRequestItem } from '../types/collection';
import type { IEnvironmentConfigService } from '../types/environment-config';
import type {
    IDisposable,
    ISocketIoClient,
    ISocketIoConnection,
    SocketIoConnectOptions,
    SocketIoEvent,
    IWebSocketClient,
    IWebSocketConnection,
    WebSocketCloseInfo,
    WebSocketConnectOptions,
    WebSocketConnectionState,
    WebSocketFrame,
} from '../types/platform';
import type {
    ExecutionRequest,
    PreparedRequest,
    WebSocketRunTranscript,
} from '../types/types';

class FakeConnection implements IWebSocketConnection {
    state: WebSocketConnectionState = 'open';
    negotiatedProtocol = '';
    readonly sent: Array<string | Uint8Array> = [];
    readonly closeCalls: Array<{ code?: number; reason?: string }> = [];

    private readonly frameListeners = new Set<(frame: WebSocketFrame) => void>();
    private readonly closeListeners = new Set<(info: WebSocketCloseInfo) => void>();
    private readonly errorListeners = new Set<(error: Error) => void>();

    async send(data: string | Uint8Array): Promise<void> {
        this.sent.push(data);
    }

    async close(code = 1000, reason = ''): Promise<void> {
        this.closeCalls.push({ code, reason });
        if (this.state === 'closed') {
            return;
        }
        this.state = 'closed';
        const info: WebSocketCloseInfo = { code, reason, wasClean: true };
        for (const listener of this.closeListeners) {
            listener(info);
        }
    }

    onFrame(listener: (frame: WebSocketFrame) => void): IDisposable {
        this.frameListeners.add(listener);
        return { dispose: () => this.frameListeners.delete(listener) };
    }

    onClose(listener: (info: WebSocketCloseInfo) => void): IDisposable {
        this.closeListeners.add(listener);
        return { dispose: () => this.closeListeners.delete(listener) };
    }

    onError(listener: (error: Error) => void): IDisposable {
        this.errorListeners.add(listener);
        return { dispose: () => this.errorListeners.delete(listener) };
    }

    emitFrame(frame: WebSocketFrame): void {
        for (const listener of this.frameListeners) {
            listener(frame);
        }
    }

    dispose(): void {
        this.state = 'closed';
    }
}

class FakeSocketIoConnection implements ISocketIoConnection {
    connected = true;
    id = 'fake-socket-id';
    private readonly eventListeners = new Set<(event: SocketIoEvent) => void>();
    private readonly connectListeners = new Set<() => void>();
    private readonly disconnectListeners = new Set<(reason: string) => void>();
    private readonly reconnectFailedListeners = new Set<() => void>();
    private readonly errorListeners = new Set<(error: Error) => void>();
    private disposed = false;

    emitEvent(event: SocketIoEvent): void {
        for (const listener of [...this.eventListeners]) {
            listener(event);
        }
    }

    async send(event: string, args: unknown[], expectAck?: boolean): Promise<unknown[] | undefined> {
        setTimeout(() => {
            this.emitEvent({ event, args: ['hi from server'] });
        }, 0);
        if (expectAck) {
            return ['ack-ok'];
        }
        return undefined;
    }

    close(): void {
        this.connected = false;
    }

    onEvent(listener: (event: SocketIoEvent) => void): IDisposable {
        this.eventListeners.add(listener);
        return { dispose: () => this.eventListeners.delete(listener) };
    }

    onConnect(listener: () => void): IDisposable {
        this.connectListeners.add(listener);
        return { dispose: () => this.connectListeners.delete(listener) };
    }

    onDisconnect(listener: (reason: string) => void): IDisposable {
        this.disconnectListeners.add(listener);
        return { dispose: () => this.disconnectListeners.delete(listener) };
    }

    onReconnectFailed(listener: () => void): IDisposable {
        this.reconnectFailedListeners.add(listener);
        return { dispose: () => this.reconnectFailedListeners.delete(listener) };
    }

    onError(listener: (error: Error) => void): IDisposable {
        this.errorListeners.add(listener);
        return { dispose: () => this.errorListeners.delete(listener) };
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.eventListeners.clear();
        this.connectListeners.clear();
        this.disconnectListeners.clear();
        this.reconnectFailedListeners.clear();
        this.errorListeners.clear();
    }
}

function createEnvironmentConfig(): {
    service: IEnvironmentConfigService;
    environmentValues: Record<string, string>;
} {
    const environmentValues: Record<string, string> = {};
    const service = {
        getResolvedEnvironment: () => ({ name: 'dev', headers: {}, variables: {} }),
        getGlobalVariables: () => ({}),
        setEnvironmentVariable: (key: string, value: string) => {
            environmentValues[key] = value;
        },
        deleteEnvironmentVariable: (key: string) => {
            delete environmentValues[key];
        },
        clearEnvironmentVariables: () => {
            for (const key of Object.keys(environmentValues)) {
                delete environmentValues[key];
            }
        },
        setGlobalVariable: vi.fn(),
        deleteGlobalVariable: vi.fn(),
        clearGlobalVariables: vi.fn(),
    } as unknown as IEnvironmentConfigService;
    return { service, environmentValues };
}

function createExecutor(webSocketClient?: IWebSocketClient | null, socketIoClient?: ISocketIoClient | null): {
    executor: CollectionRequestExecutor;
    preparedInput: () => ExecutionRequest | undefined;
    preparedVariables: () => Record<string, string> | undefined;
    capturedConnect: () => WebSocketConnectOptions | undefined;
    environmentValues: Record<string, string>;
    connection: FakeConnection;
} {
    const connection = new FakeConnection();
    let preparedInput: ExecutionRequest | undefined;
    let preparedVariables: Record<string, string> | undefined;
    let capturedConnect: WebSocketConnectOptions | undefined;

    const requestPreparer: IRequestPreparer = {
        prepareRequest: async (input, _environment, _resolvedEnv, extraVariables) => {
            preparedInput = input;
            preparedVariables = extraVariables;
            const prepared: PreparedRequest = {
                url: input.url,
                method: input.method,
                headers: { ...(input.headers ?? {}) },
                body: { type: 'none', content: null },
                params: {},
                query: {},
            };
            return prepared;
        },
    };

    const defaultClient: IWebSocketClient = {
        connect: async (options: WebSocketConnectOptions) => {
            capturedConnect = options;
            setTimeout(() => connection.emitFrame({ data: 'welcome', isBinary: false }), 0);
            return connection;
        },
    };
    const client = webSocketClient === null ? undefined : (webSocketClient ?? defaultClient);
    const socketIo = socketIoClient === null ? undefined : (socketIoClient ?? undefined);

    const { service: envConfigService, environmentValues } = createEnvironmentConfig();

    const executor = new CollectionRequestExecutor(
        {} as unknown as IHttpRequestService,
        new ScriptExecutor(),
        envConfigService,
        requestPreparer,
        'dev',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        client,
        socketIo
    );

    return {
        executor,
        preparedInput: () => preparedInput,
        preparedVariables: () => preparedVariables,
        capturedConnect: () => capturedConnect,
        environmentValues,
        connection,
    };
}

function websocketExecutionRequest(): ExecutionRequest {
    return {
        id: 'ws-request',
        name: 'Chat socket',
        requestType: 'websocket',
        method: 'GET',
        url: 'wss://example.test/socket',
        headers: { Authorization: 'Bearer original' },
        websocket: {
            protocol: 'websocket',
            messages: [{ id: 'hello', type: 'text', data: 'hello' }],
            settings: { responseTimeout: 20 },
        },
        scripts: {
            preRequest: `
                pm.variables.set('handshakeToken', 'abc');
                pm.request.headers.add({ key: 'X-Pre-Request', value: 'yes' });
            `,
            postResponse: `
                pm.test('opened with 101', () => pm.expect(pm.response.code).to.equal(101));
                pm.test('captured both directions', () => {
                    const transcript = pm.response.json();
                    pm.expect(transcript.protocol).to.equal('websocket');
                    pm.expect(transcript.frames.some(f => f.direction === 'in' && f.data === 'welcome')).to.be.true;
                    pm.expect(transcript.frames.some(f => f.direction === 'out' && f.data === 'hello')).to.be.true;
                });
                pm.environment.set('wsGreeting', 'ok');
            `,
        },
    };
}

describe('CollectionRequestExecutor WebSocket execution', () => {
    it('runs pre-request and post-response scripts against the WebSocket transcript', async () => {
        const {
            executor,
            preparedInput,
            preparedVariables,
            capturedConnect,
            environmentValues,
            connection,
        } = createExecutor();

        const result = await executor.execute(websocketExecutionRequest(), {});

        expect(result.response.status).toBe(101);
        expect(result.response.statusText).toBe('Switching Protocols');
        expect(result.passed).toBe(true);
        expect(result.assertions).toHaveLength(2);
        expect(result.assertions.every(assertion => assertion.passed)).toBe(true);

        expect(preparedVariables()).toMatchObject({ handshakeToken: 'abc' });
        expect(preparedInput()?.headers).toMatchObject({
            Authorization: 'Bearer original',
            'X-Pre-Request': 'yes',
        });

        // The runner receives the normalized (uppercase) headers that HTTP uses.
        expect(capturedConnect()?.url).toBe('wss://example.test/socket');
        expect(capturedConnect()?.headers).toMatchObject({
            AUTHORIZATION: 'Bearer original',
            'X-PRE-REQUEST': 'yes',
        });
        expect(connection.sent).toEqual(['hello']);
        expect(environmentValues).toMatchObject({ wsGreeting: 'ok' });

        const transcript = result.response.body as WebSocketRunTranscript;
        expect(transcript.frames).toEqual(expect.arrayContaining([
            expect.objectContaining({ direction: 'out', data: 'hello' }),
            expect.objectContaining({ direction: 'in', data: 'welcome' }),
        ]));
        expect(result.executedRequest.body).toEqual({ type: 'none', content: null });
    });

    it('returns a failed result when the WebSocket client is not configured', async () => {
        const { executor } = createExecutor(null);

        await expect(executor.execute(websocketExecutionRequest(), {}))
            .rejects.toThrow('WebSocket execution is not configured for this runner');
    });
});

function createRunWorkspace(prefix: string): { workspace: string; assets: string } {
    const workspace = mkdtempSync(join(tmpdir(), prefix));
    const assets = join(workspace, '.http-forge', 'assets');
    mkdirSync(join(assets, 'environments'), { recursive: true });
    writeFileSync(join(workspace, 'http-forge.config.json'), JSON.stringify({
        version: '1.0',
        storage: { format: 'folder', root: './.http-forge/assets' },
        environments: { default: 'dev' },
    }));
    writeFileSync(join(assets, 'environments', '_global.json'), JSON.stringify({
        variables: {},
        defaultHeaders: [],
    }));
    writeFileSync(join(assets, 'environments', 'dev.json'), JSON.stringify({
        variables: {},
        description: 'dev',
    }));
    return { workspace, assets };
}

function createMixedRequests(httpUrl: string, wsUrl: string): {
    httpBefore: CollectionRequestItem;
    websocket: CollectionRequestItem;
    httpAfter: CollectionRequestItem;
} {
    return {
        httpBefore: {
            id: 'http-before',
            type: 'request',
            name: 'HTTP before',
            requestType: 'http',
            method: 'GET',
            url: `${httpUrl}/hello`,
            scripts: {
                postResponse: `pm.test('http before ok', () => pm.expect(pm.response.code).to.equal(200));`,
            },
        },
        websocket: {
            id: 'ws-chat',
            type: 'request',
            name: 'WS chat',
            requestType: 'websocket',
            method: 'GET',
            url: wsUrl,
            websocket: {
                protocol: 'websocket',
                messages: [{ id: 'hello', type: 'text', data: 'hello' }],
                settings: { responseTimeout: 50 },
            },
            scripts: {
                postResponse: `
                    pm.test('ws opened', () => pm.expect(pm.response.code).to.equal(101));
                    pm.test('ws echoed', () => {
                        const transcript = pm.response.json();
                        pm.expect(transcript.frames.some(f => f.direction === 'in' && f.data === 'echo:hello')).to.be.true;
                    });
                `,
            },
        },
        httpAfter: {
            id: 'http-after',
            type: 'request',
            name: 'HTTP after',
            requestType: 'http',
            method: 'GET',
            url: `${httpUrl}/after`,
            scripts: {
                postResponse: `pm.test('http after ok', () => pm.expect(pm.response.code).to.equal(200));`,
            },
        },
    };
}

describe('runRequest WebSocket execution', () => {
    let server: WebSocketServer;
    let url: string;
    let workspace: string | undefined;

    beforeAll(async () => {
        server = new WebSocketServer({ port: 0 });
        server.on('connection', (socket) => {
            setTimeout(() => socket.send('welcome'), 10);
            socket.on('message', (data, isBinary) => {
                socket.send(data, { binary: isBinary });
            });
        });
        await new Promise<void>(resolve => server.once('listening', resolve));
        const address = server.address() as AddressInfo;
        url = `ws://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    afterEach(() => {
        if (workspace) {
            rmSync(workspace, { recursive: true, force: true });
            workspace = undefined;
        }
    });

    it('executes a persisted WebSocket request through the public runRequest API', async () => {
        const prepared = createRunWorkspace('http-forge-ws-run-');
        workspace = prepared.workspace;
        const { assets } = prepared;

        const store = new FolderCollectionStore(join(assets, 'collections'));
        const request: CollectionRequestItem = {
            id: 'ws-request',
            type: 'request',
            name: 'Chat socket',
            requestType: 'websocket',
            method: 'GET',
            url,
            websocket: {
                protocol: 'websocket',
                messages: [{ id: 'hello', type: 'text', data: 'hello' }],
                settings: { responseTimeout: 50 },
            },
            scripts: {
                postResponse: `
                    pm.test('opened', () => pm.expect(pm.response.code).to.equal(101));
                    pm.test('captured both directions', () => {
                        const transcript = pm.response.json();
                        pm.expect(transcript.frames.some(f => f.direction === 'in' && f.data === 'welcome')).to.be.true;
                        pm.expect(transcript.frames.some(f => f.direction === 'out' && f.data === 'hello')).to.be.true;
                    });
                `,
            },
        };
        const collection: Collection = {
            id: 'ws-collection',
            name: 'WebSocket collection',
            items: [request],
        };
        await store.save(collection);

        const result = await runRequest({
            workspaceFolder: workspace,
            collectionId: 'ws-collection',
            requestId: 'ws-request',
        }) as {
            request: string;
            status: number;
            ok: boolean;
            allPassed: boolean;
            assertions: Array<{ name: string; passed: boolean }>;
            body: WebSocketRunTranscript;
        };

        expect(result.request).toBe('Chat socket');
        expect(result.status).toBe(101);
        expect(result.ok).toBe(true);
        expect(result.allPassed).toBe(true);
        expect(result.assertions).toHaveLength(2);
        expect(result.assertions.every(assertion => assertion.passed)).toBe(true);
        expect(result.body.frames).toEqual(expect.arrayContaining([
            expect.objectContaining({ direction: 'out', data: 'hello' }),
            expect.objectContaining({ direction: 'in', data: 'welcome' }),
        ]));
    });
});

describe('mixed HTTP and WebSocket collection execution', () => {
    let httpServer: Server;
    let wsServer: WebSocketServer;
    let httpUrl: string;
    let wsUrl: string;
    let workspace: string | undefined;

    beforeAll(async () => {
        httpServer = createServer((req, res) => {
            if (req.url === '/hello') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
                return;
            }
            if (req.url === '/after') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ after: true }));
                return;
            }
            res.writeHead(404);
            res.end();
        });
        await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
        const httpAddress = httpServer.address() as AddressInfo;
        httpUrl = `http://127.0.0.1:${httpAddress.port}`;

        wsServer = new WebSocketServer({ port: 0 });
        wsServer.on('connection', (socket) => {
            socket.on('message', (data) => {
                socket.send(`echo:${data.toString()}`);
            });
        });
        await new Promise<void>(resolve => wsServer.once('listening', resolve));
        const wsAddress = wsServer.address() as AddressInfo;
        wsUrl = `ws://127.0.0.1:${wsAddress.port}`;
    });

    afterAll(async () => {
        wsServer.clients.forEach(client => client.terminate());
        await new Promise<void>(resolve => wsServer.close(() => resolve()));
        httpServer.closeAllConnections();
        await new Promise<void>(resolve => httpServer.close(() => resolve()));
    });

    afterEach(() => {
        if (workspace) {
            rmSync(workspace, { recursive: true, force: true });
            workspace = undefined;
        }
    });

    it('runs HTTP and WebSocket requests together through runCollection', async () => {
        const prepared = createRunWorkspace('http-forge-mixed-run-');
        workspace = prepared.workspace;
        const store = new FolderCollectionStore(join(prepared.assets, 'collections'));

        const { httpBefore, websocket, httpAfter } = createMixedRequests(httpUrl, wsUrl);
        const collection: Collection = {
            id: 'mixed-collection',
            name: 'Mixed collection',
            items: [httpBefore, websocket, httpAfter],
        };
        await store.save(collection);

        const result = await runCollection({
            workspaceFolder: workspace,
            collectionId: 'mixed-collection',
            include: ['perRequest'],
        }) as {
            collection: string;
            summary: { total: number; passed: number; failed: number; allPassed: boolean };
            results: Array<{ name: string; status?: number; ok: boolean; allPassed: boolean }>;
        };

        expect(result.collection).toBe('Mixed collection');
        expect(result.summary).toEqual(expect.objectContaining({
            total: 3,
            passed: 3,
            failed: 0,
            allPassed: true,
        }));
        expect(result.results).toHaveLength(3);

        const byName = new Map(result.results.map(entry => [entry.name, entry] as const));
        expect(byName.get('HTTP before')).toEqual(expect.objectContaining({ status: 200, ok: true, allPassed: true }));
        expect(byName.get('WS chat')).toEqual(expect.objectContaining({ status: 101, ok: true, allPassed: true }));
        expect(byName.get('HTTP after')).toEqual(expect.objectContaining({ status: 200, ok: true, allPassed: true }));
    });

    it('runs HTTP and WebSocket requests together in a persisted test suite', async () => {
        const prepared = createRunWorkspace('http-forge-mixed-suite-');
        workspace = prepared.workspace;
        const store = new FolderCollectionStore(join(prepared.assets, 'collections'));
        const { httpBefore, websocket, httpAfter } = createMixedRequests(httpUrl, wsUrl);
        const collection: Collection = {
            id: 'mixed-collection',
            name: 'Mixed collection',
            items: [httpBefore, websocket, httpAfter],
        };
        await store.save(collection);

        const suiteDir = join(prepared.assets, 'suites');
        mkdirSync(suiteDir, { recursive: true });
        const suite: TestSuite = {
            id: 'mixed-suite',
            name: 'Mixed suite',
            nodes: [
                {
                    id: 'node-http-before',
                    type: 'request',
                    name: 'HTTP before',
                    request: {
                        collectionId: 'mixed-collection',
                        collectionName: 'Mixed collection',
                        requestId: 'http-before',
                        name: 'HTTP before',
                        method: 'GET',
                        folderPath: '',
                        enabled: true,
                    },
                },
                {
                    id: 'node-ws-chat',
                    type: 'request',
                    name: 'WS chat',
                    request: {
                        collectionId: 'mixed-collection',
                        collectionName: 'Mixed collection',
                        requestId: 'ws-chat',
                        name: 'WS chat',
                        method: 'GET',
                        folderPath: '',
                        enabled: true,
                    },
                },
                {
                    id: 'node-http-after',
                    type: 'request',
                    name: 'HTTP after',
                    request: {
                        collectionId: 'mixed-collection',
                        collectionName: 'Mixed collection',
                        requestId: 'http-after',
                        name: 'HTTP after',
                        method: 'GET',
                        folderPath: '',
                        enabled: true,
                    },
                },
            ],
            config: {
                iterations: 1,
                delayBetweenRequests: 0,
                stopOnError: false,
                readFromSharedSession: false,
                writeToSharedSession: false,
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        writeFileSync(join(suiteDir, 'mixed-suite.suite.json'), JSON.stringify(suite, null, 2));

        const result = await runSuite({
            workspaceFolder: workspace,
            suiteId: 'mixed-suite',
            include: ['perRequest'],
        }) as {
            suite: string;
            summary: { total: number; passed: number; failed: number; allPassed: boolean };
            results: Array<{ name: string; status?: number; ok: boolean; allPassed: boolean }>;
        };

        expect(result.suite).toBe('Mixed suite');
        expect(result.summary).toEqual(expect.objectContaining({
            total: 3,
            passed: 3,
            failed: 0,
            allPassed: true,
        }));
        expect(result.results).toHaveLength(3);

        const byName = new Map(result.results.map(entry => [entry.name, entry] as const));
        expect(byName.get('HTTP before')).toEqual(expect.objectContaining({ status: 200, ok: true, allPassed: true }));
        expect(byName.get('WS chat')).toEqual(expect.objectContaining({ status: 101, ok: true, allPassed: true }));
        expect(byName.get('HTTP after')).toEqual(expect.objectContaining({ status: 200, ok: true, allPassed: true }));
    });
});

describe('Socket.IO headless execution', () => {
    it('runs a Socket.IO request through the collection runner', async () => {
        const socketIoConnection = new FakeSocketIoConnection();
        const fakeClient: ISocketIoClient = {
            connect: async () => socketIoConnection,
        };

        const { executor, environmentValues } = createExecutor(null, fakeClient);

        const request: ExecutionRequest = {
            id: 'sio-request',
            name: 'Socket chat',
            requestType: 'websocket',
            method: 'GET',
            url: 'http://example.test/socket',
            websocket: {
                protocol: 'socketio',
                messages: [
                    {
                        id: 'hello',
                        type: 'text',
                        data: 'hello',
                        event: 'chat',
                        args: ['extra'],
                        ack: true,
                    },
                ],
                settings: { responseTimeout: 50 },
            },
            scripts: {
                postResponse: `
                    pm.test('opened', () => pm.expect(pm.response.code).to.equal(101));
                    pm.test('captured socket.io frames', () => {
                        const transcript = pm.response.json();
                        pm.expect(transcript.protocol).to.equal('socketio');
                        pm.expect(transcript.frames.some(f => f.direction === 'out' && f.event === 'chat' && f.ack === true)).to.be.true;
                        pm.expect(transcript.frames.some(f => f.direction === 'in' && f.event === 'chat' && f.data === 'hi from server')).to.be.true;
                        pm.expect(transcript.frames.some(f => f.direction === 'in' && f.event === 'ack' && f.ack === true)).to.be.true;
                    });
                `,
            },
        };

        const result = await executor.execute(request, {}) as {
            passed: boolean;
            response: { status: number; body: WebSocketRunTranscript };
            assertions: Array<{ name: string; passed: boolean }>;
        };

        expect(result.response.status).toBe(101);
        expect(result.passed).toBe(true);
        expect(result.assertions).toHaveLength(2);
        expect(result.assertions.every(assertion => assertion.passed)).toBe(true);
        expect(result.response.body.protocol).toBe('socketio');
        expect(result.response.body.frames).toEqual(expect.arrayContaining([
            expect.objectContaining({ direction: 'out', event: 'chat', ack: true }),
            expect.objectContaining({ direction: 'in', event: 'chat', data: 'hi from server' }),
            expect.objectContaining({ direction: 'in', event: 'ack', ack: true }),
        ]));
    });

    it('requires a Socket.IO client when the collection runner executes a Socket.IO request', async () => {
        const { executor } = createExecutor(null, null);

        await expect(executor.execute({
            id: 'sio-request',
            name: 'Socket chat',
            requestType: 'websocket',
            method: 'GET',
            url: 'http://example.test/socket',
            websocket: {
                protocol: 'socketio',
                messages: [],
                settings: { responseTimeout: 0 },
            },
        }, {})).rejects.toThrow('Socket.IO execution is not configured for this runner');
    });
});
