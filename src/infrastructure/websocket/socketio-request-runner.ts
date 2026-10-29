/**
 * Headless Socket.IO request runner.
 *
 * Mirrors `websocket-request-runner.ts` for the Socket.IO flavor: a Socket.IO
 * request is executed as a bounded transcript (connect → emit saved messages
 * → collect events for `websocket.settings.responseTimeout` → disconnect).
 *
 * Socket.IO is a higher-level protocol than raw WebSocket, so this runner
 * talks to the injected `ISocketIoClient` (extension host / Node adapter) and
 * records events + acknowledgements as transcript frames.
 */
import type { ISocketIoClient, ISocketIoConnection, SocketIoConnectOptions, SocketIoEvent } from '../../types/platform';
import {
    ExecutionRequest,
    HttpResponse,
    PreparedRequest,
    RequestSettings,
    WebSocketBinaryEncoding,
    WebSocketMessageDraft,
    WebSocketRunFrame,
    WebSocketRunTranscript,
} from '../../types/types';

export const DEFAULT_SOCKETIO_RESPONSE_TIMEOUT_MS = 1000;

function decodeBinary(data: string, encoding?: WebSocketBinaryEncoding): Uint8Array {
    if (encoding === 'hex') {
        return new Uint8Array(Buffer.from(data, 'hex'));
    }
    return new Uint8Array(Buffer.from(data, 'base64'));
}

function formatArg(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (value instanceof Uint8Array) {
        return Buffer.from(value).toString('base64');
    }
    if (Buffer.isBuffer(value)) {
        return Buffer.from(value).toString('base64');
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function toOutboundFrame(
    message: WebSocketMessageDraft,
    type: 'text' | 'binary',
    event: string,
    args: unknown[]
): WebSocketRunFrame {
    const data = message.data || '';
    const size = type === 'binary'
        ? decodeBinary(data, message.encoding).length
        : Buffer.byteLength(data, 'utf8');
    return {
        direction: 'out',
        type,
        data,
        encoding: type === 'binary' ? (message.encoding || 'base64') : undefined,
        event,
        args: (message.args || []).map((value) => String(value)),
        ack: message.ack === true,
        size,
        time: Date.now(),
    };
}

function toInboundFrame(event: SocketIoEvent): WebSocketRunFrame {
    const args = Array.isArray(event.args) ? event.args : [];
    const first = args[0];
    const binary = first instanceof Uint8Array || Buffer.isBuffer(first);
    const extraArgs = args.slice(1).map((value) => formatArg(value));
    let data = '';
    let size = 0;
    let type: 'text' | 'binary' = 'text';
    let encoding: WebSocketBinaryEncoding | undefined;

    if (args.length === 0) {
        data = '';
        size = 0;
    } else if (binary) {
        type = 'binary';
        encoding = 'base64';
        data = Buffer.from(first as Uint8Array).toString('base64');
        size = (first as Uint8Array).byteLength;
    } else if (typeof first === 'string') {
        data = first;
        size = Buffer.byteLength(first, 'utf8');
    } else {
        data = formatArg(first);
        size = Buffer.byteLength(data, 'utf8');
    }

    size += extraArgs.reduce((total, value) => total + Buffer.byteLength(value, 'utf8'), 0);

    return {
        direction: 'in',
        type,
        data,
        encoding,
        event: event.event,
        args: extraArgs,
        size,
        time: Date.now(),
    };
}

export async function runSocketIoRequest(
    client: ISocketIoClient,
    request: ExecutionRequest,
    prepared: PreparedRequest,
    signal?: AbortSignal
): Promise<HttpResponse> {
    const started = Date.now();
    const messages = (request.websocket?.messages ?? []).filter((message) => message.enabled !== false);
    const settings = request.websocket?.settings;
    const responseTimeout = settings?.responseTimeout ?? DEFAULT_SOCKETIO_RESPONSE_TIMEOUT_MS;
    const handshakeTimeout =
        settings?.handshakeTimeout && settings.handshakeTimeout > 0
            ? settings.handshakeTimeout
            : (request.settings?.timeout ?? 0) || 30000;

    const frames: WebSocketRunFrame[] = [];
    let connection: ISocketIoConnection | undefined;
    let closeReason = 'Run complete';
    let eventDisposable: { dispose(): void } | undefined;
    let errorDisposable: { dispose(): void } | undefined;
    let disconnectDisposable: { dispose(): void } | undefined;

    try {
        const socketio = request.websocket?.socketio;
        const options: SocketIoConnectOptions = {
            url: prepared.url,
            headers: prepared.headers,
            path: socketio?.handshakePath || '/socket.io',
            clientVersion: socketio?.clientVersion,
            namespace: socketio?.namespace,
            auth: socketio?.auth,
            transports: socketio?.transports,
            timeout: handshakeTimeout,
            reconnectionAttempts: settings?.reconnectionAttempts ?? 0,
            reconnectionDelay: settings?.reconnectionInterval ?? 5000,
        };

        connection = await client.connect(options);

        eventDisposable = connection.onEvent((event) => {
            frames.push(toInboundFrame(event));
        });
        errorDisposable = connection.onError((error) => {
            frames.push({
                direction: 'system',
                type: 'text',
                data: error.message,
                size: 0,
                time: Date.now(),
            });
        });
        disconnectDisposable = connection.onDisconnect((reason) => {
            closeReason = reason || closeReason;
        });

        if (signal?.aborted) {
            throw new Error('Request aborted');
        }

        for (const message of messages) {
            if (signal?.aborted) {
                throw new Error('Request aborted');
            }

            const event = message.event?.trim() || 'message';
            const type = message.type === 'binary' ? 'binary' : 'text';
            const firstArg = type === 'binary'
                ? decodeBinary(message.data, message.encoding)
                : message.data;
            const extraArgs = (message.args || []).map((value) => value);
            const args = [firstArg, ...extraArgs];

            frames.push(toOutboundFrame(message, type, event, args));

            if (message.ack === true) {
                const ackArgs = await connection.send(event, args, true);
                if (ackArgs && ackArgs.length > 0) {
                    frames.push({
                        direction: 'in',
                        type: 'text',
                        data: ackArgs.map((value) => formatArg(value)).join(' '),
                        event: 'ack',
                        args: ackArgs.map((value) => formatArg(value)),
                        ack: true,
                        size: ackArgs.reduce((total: number, value: unknown) => total + Buffer.byteLength(formatArg(value), 'utf8'), 0),
                        time: Date.now(),
                    });
                }
            } else {
                await connection.send(event, args, false);
            }
        }

        if (responseTimeout > 0 && !signal?.aborted) {
            await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, responseTimeout);
                const abortHandler = () => {
                    clearTimeout(timer);
                    resolve();
                };
                signal?.addEventListener('abort', abortHandler, { once: true });
            });
        }

        connection.close();
        connection.dispose();
        eventDisposable.dispose();
        errorDisposable.dispose();
        disconnectDisposable.dispose();

        const transcript: WebSocketRunTranscript = {
            protocol: 'socketio',
            frames,
            close: {
                code: 1000,
                reason: closeReason,
                wasClean: true,
            },
        };

        return {
            status: 101,
            statusText: 'Switching Protocols',
            headers: {},
            body: transcript,
            cookies: [],
            time: Date.now() - started,
            size: Buffer.byteLength(JSON.stringify(transcript), 'utf8'),
        };
    } catch (error) {
        try {
            eventDisposable?.dispose();
            errorDisposable?.dispose();
            disconnectDisposable?.dispose();
            connection?.dispose();
        } catch {
            // Best-effort cleanup only.
        }
        throw error;
    }
}