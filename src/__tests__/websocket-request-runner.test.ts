import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'net';
import { WebSocketServer } from 'ws';
import { NodeWebSocketClient } from '../infrastructure/websocket/node-websocket-client';
import {
    runWebSocketRequest,
    DEFAULT_WEBSOCKET_RESPONSE_TIMEOUT_MS,
} from '../infrastructure/websocket/websocket-request-runner';
import type {
    IDisposable,
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

    constructor(
        private readonly onSend?: (data: string | Uint8Array) => void,
        private readonly onConnect?: (connection: FakeConnection) => void
    ) {
        if (onConnect) {
            setTimeout(() => onConnect(this), 0);
        }
    }

    async send(data: string | Uint8Array): Promise<void> {
        if (this.state !== 'open') {
            throw new Error('WebSocket is not open');
        }
        this.sent.push(data);
        this.onSend?.(data);
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

    emitError(error: Error): void {
        for (const listener of this.errorListeners) {
            listener(error);
        }
    }

    dispose(): void {
        this.state = 'closed';
    }
}

function preparedRequest(url = 'wss://example.test/socket'): PreparedRequest {
    return {
        url,
        method: 'GET',
        headers: { Authorization: 'Bearer token' },
        body: { type: 'none', content: null },
        params: {},
        query: {},
    };
}

function websocketRequest(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
    return {
        id: 'ws-request',
        name: 'Chat socket',
        requestType: 'websocket',
        method: 'GET',
        url: 'wss://example.test/socket',
        headers: { Authorization: 'Bearer token' },
        websocket: {
            protocol: 'websocket',
            subprotocols: ['chat'],
            messages: [
                { id: 'text-1', type: 'text', data: 'ping' },
                { id: 'off', type: 'text', data: 'skipped', enabled: false },
                { id: 'binary-1', type: 'binary', encoding: 'hex', data: '010203' },
            ],
            settings: {
                handshakeTimeout: 2500,
                responseTimeout: 20,
                maxMessageSizeMb: 1,
            },
        },
        settings: { strictSSL: false },
        ...overrides,
    };
}

function createClient(connection: FakeConnection): {
    client: IWebSocketClient;
    connect: ReturnType<typeof vi.fn>;
    captured: { options?: WebSocketConnectOptions };
} {
    const captured: { options?: WebSocketConnectOptions } = {};
    const connect = vi.fn(async (options: WebSocketConnectOptions) => {
        captured.options = options;
        return connection;
    });
    return { client: { connect }, connect, captured };
}

describe('runWebSocketRequest', () => {
    it('sends enabled saved messages in order and records inbound frames in the transcript', async () => {
        const connection = new FakeConnection((data) => {
            setTimeout(() => {
                if (data === 'ping') {
                    connection.emitFrame({ data: 'pong', isBinary: false });
                } else {
                    connection.emitFrame({ data: new Uint8Array([4, 5, 6]), isBinary: true });
                }
            }, 0);
        });
        const { client, captured } = createClient(connection);

        const response = await runWebSocketRequest(client, websocketRequest(), preparedRequest());

        expect(captured.options).toMatchObject({
            url: 'wss://example.test/socket',
            headers: { Authorization: 'Bearer token' },
            protocols: ['chat'],
            maxPayloadBytes: 1024 * 1024,
            settings: { timeout: 2500, strictSSL: false },
        });
        expect(connection.sent).toEqual(['ping', Buffer.from([1, 2, 3])]);
        expect(response.status).toBe(101);
        expect(response.statusText).toBe('Switching Protocols');
        expect(response.cookies).toEqual([]);

        const transcript = response.body as WebSocketRunTranscript;
        expect(transcript.protocol).toBe('websocket');
        expect(transcript.frames.map(frame => ({
            direction: frame.direction,
            type: frame.type,
            data: frame.data,
            encoding: frame.encoding,
        }))).toEqual([
            { direction: 'out', type: 'text', data: 'ping', encoding: undefined },
            { direction: 'out', type: 'binary', data: '010203', encoding: 'hex' },
            { direction: 'in', type: 'text', data: 'pong', encoding: undefined },
            { direction: 'in', type: 'binary', data: 'BAUG', encoding: 'base64' },
        ]);
        expect(transcript.close).toEqual({ code: 1000, reason: 'Run complete', wasClean: true });
        expect(connection.closeCalls).toEqual([{ code: 1000, reason: 'Run complete' }]);
    });

    it('captures server frames when there are no saved messages', async () => {
        const connection = new FakeConnection(undefined, (conn) => {
            conn.emitFrame({ data: 'welcome', isBinary: false });
        });
        const { client } = createClient(connection);

        const response = await runWebSocketRequest(client, websocketRequest({
            websocket: { settings: { responseTimeout: 20 } },
        }), preparedRequest());

        const transcript = response.body as WebSocketRunTranscript;
        expect(transcript.frames).toEqual([
            expect.objectContaining({ direction: 'in', type: 'text', data: 'welcome' }),
        ]);
        expect(connection.sent).toEqual([]);
        expect(response.status).toBe(101);
    });

    it('closes immediately when responseTimeout is zero', async () => {
        const connection = new FakeConnection();
        const { client } = createClient(connection);

        const response = await runWebSocketRequest(client, websocketRequest({
            websocket: {
                messages: [{ id: 'text-1', type: 'text', data: 'hello' }],
                settings: { responseTimeout: 0 },
            },
        }), preparedRequest());

        expect(connection.sent).toEqual(['hello']);
        expect(connection.closeCalls).toEqual([{ code: 1000, reason: 'Run complete' }]);
        expect(response.status).toBe(101);
    });

    it('defaults the response collection window to one second', async () => {
        const connection = new FakeConnection();
        const { client, captured } = createClient(connection);
        const started = Date.now();

        await runWebSocketRequest(client, websocketRequest({
            websocket: { settings: {} },
        }), preparedRequest());

        // A fake connection never closes, so the runner waits for the default
        // window before closing itself.
        expect(Date.now() - started).toBeGreaterThanOrEqual(DEFAULT_WEBSOCKET_RESPONSE_TIMEOUT_MS - 5);
        expect(captured.options?.settings?.timeout).toBeUndefined();
        expect(connection.closeCalls).toEqual([{ code: 1000, reason: 'Run complete' }]);
    });

    it('rejects Socket.IO before opening a connection', async () => {
        const connection = new FakeConnection();
        const { client, connect } = createClient(connection);

        await expect(runWebSocketRequest(client, websocketRequest({
            websocket: { protocol: 'socketio', settings: { responseTimeout: 0 } },
        }), preparedRequest())).rejects.toThrow(
            'Socket.IO requests must use runSocketIoRequest, not runWebSocketRequest'
        );
        expect(connect).not.toHaveBeenCalled();
    });

    it('closes with 1001 and reports an AbortError when cancelled while collecting frames', async () => {
        const connection = new FakeConnection();
        const { client } = createClient(connection);
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5);

        await expect(runWebSocketRequest(
            client,
            websocketRequest({ websocket: { settings: { responseTimeout: 500 } } }),
            preparedRequest(),
            controller.signal
        )).rejects.toMatchObject({ name: 'AbortError' });

        expect(connection.closeCalls).toEqual([{ code: 1001, reason: 'Run cancelled' }]);
    });

    it('records socket errors as system frames', async () => {
        const connection = new FakeConnection((data) => {
            if (data === 'ping') {
                setTimeout(() => connection.emitError(new Error('protocol failure')), 0);
            }
        });
        const { client } = createClient(connection);

        const response = await runWebSocketRequest(client, websocketRequest(), preparedRequest());

        const transcript = response.body as WebSocketRunTranscript;
        expect(transcript.frames).toEqual(expect.arrayContaining([
            expect.objectContaining({
                direction: 'system',
                type: 'text',
                data: 'Error: protocol failure',
            }),
        ]));
    });
});

describe('runWebSocketRequest with NodeWebSocketClient', () => {
    let server: WebSocketServer;
    let url: string;

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

    it('produces a transcript from a real handshake, saved messages, and echoed frames', async () => {
        const response = await runWebSocketRequest(
            new NodeWebSocketClient(),
            {
                id: 'ws-request',
                name: 'Chat socket',
                requestType: 'websocket',
                method: 'GET',
                url,
                websocket: {
                    messages: [
                        { id: 'text-1', type: 'text', data: 'hello' },
                        { id: 'binary-1', type: 'binary', encoding: 'hex', data: '010203' },
                    ],
                    settings: { responseTimeout: 100 },
                },
            },
            {
                url,
                method: 'GET',
                headers: {},
                body: { type: 'none', content: null },
                params: {},
                query: {},
            }
        );

        expect(response.status).toBe(101);
        const transcript = response.body as WebSocketRunTranscript;
        expect(transcript.frames).toEqual(expect.arrayContaining([
            expect.objectContaining({ direction: 'out', type: 'text', data: 'hello' }),
            expect.objectContaining({ direction: 'out', type: 'binary', data: '010203', encoding: 'hex' }),
            expect.objectContaining({ direction: 'in', type: 'text', data: 'welcome' }),
            expect.objectContaining({ direction: 'in', type: 'text', data: 'hello' }),
            expect.objectContaining({ direction: 'in', type: 'binary', data: 'AQID', encoding: 'base64' }),
        ]));
        expect(transcript.close).toMatchObject({ code: 1000, wasClean: true });
    });
});
