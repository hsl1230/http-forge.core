import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import { WebSocketServer } from 'ws';
import { NodeWebSocketClient } from '../infrastructure/websocket/node-websocket-client';
import type { IWebSocketConnection, WebSocketFrame } from '../types/platform';

function nextFrame(connection: IWebSocketConnection): Promise<WebSocketFrame> {
    return new Promise((resolve) => {
        const listener = connection.onFrame((frame) => {
            listener.dispose();
            resolve(frame);
        });
    });
}

describe('NodeWebSocketClient', () => {
    let server: WebSocketServer;
    let url: string;

    beforeAll(async () => {
        server = new WebSocketServer({
            port: 0,
            handleProtocols: (protocols) => protocols.has('chat') ? 'chat' : false,
        });

        server.on('connection', (socket) => {
            socket.on('message', (data, isBinary) => {
                socket.send(data, { binary: isBinary });
            });
        });

        await new Promise<void>((resolve) => server.once('listening', resolve));
        const address = server.address() as AddressInfo;
        url = `ws://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('connects with headers and a negotiated subprotocol, then echoes text and binary frames', async () => {
        const authorization = new Promise<string>((resolve) => {
            server.once('connection', (_socket, request) => {
                resolve(String(request.headers.authorization || ''));
            });
        });

        const client = new NodeWebSocketClient();
        const connection = await client.connect({
            url,
            headers: { Authorization: 'Bearer test-token' },
            protocols: ['chat'],
        });

        expect(connection.state).toBe('open');
        expect(connection.negotiatedProtocol).toBe('chat');
        await expect(authorization).resolves.toBe('Bearer test-token');

        await connection.send('hello');
        await expect(nextFrame(connection)).resolves.toMatchObject({ data: 'hello', isBinary: false });

        await connection.send(new Uint8Array([1, 2, 3]));
        const binary = await nextFrame(connection);
        expect(binary.isBinary).toBe(true);
        expect(Array.from(binary.data as Uint8Array)).toEqual([1, 2, 3]);

        const closed = new Promise<{ code: number; reason: string }>((resolve) => {
            connection.onClose((info) => resolve(info));
        });
        await connection.close(1000, 'done');
        await expect(closed).resolves.toMatchObject({ code: 1000, reason: 'done' });
    });

    it('closes the socket when an incoming frame exceeds maxPayloadBytes', async () => {
        server.once('connection', (socket) => {
            socket.send('x'.repeat(256));
        });

        const client = new NodeWebSocketClient();
        const connection = await client.connect({ url, maxPayloadBytes: 128 });
        let framed = false;
        connection.onFrame(() => {
            framed = true;
        });
        const closed = new Promise<{ code: number }>((resolve) => {
            connection.onClose((info) => resolve(info));
        });

        await expect(closed).resolves.toMatchObject({ code: 1006 });
        expect(framed).toBe(false);
        connection.dispose();
    });

    it('rejects a send after the connection is closed', async () => {
        const client = new NodeWebSocketClient();
        const connection = await client.connect({ url });

        await connection.close(1000, 'done');

        await expect(connection.send('late')).rejects.toThrow('WebSocket is not open');
    });

    it('honours an aborted connect signal', async () => {
        const client = new NodeWebSocketClient();
        const controller = new AbortController();
        controller.abort();

        await expect(client.connect({ url, signal: controller.signal }))
            .rejects.toMatchObject({ name: 'AbortError' });
    });
});
