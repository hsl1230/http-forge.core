/**
 * Headless WebSocket request runner.
 *
 * Collection/suite execution has no interactive frame stream, so a WebSocket
 * request is executed as a bounded transcript:
 *   1. connect (prepared URL, headers, subprotocols, TLS/timeout settings)
 *   2. send the saved messages in order
 *   3. collect inbound frames for `websocket.settings.responseTimeout`
 *   4. close and return a synthetic `HttpResponse`
 *
 * The response body is a `WebSocketRunTranscript`, exposed to post-response
 * scripts as `pm.response.json()`. The executor owns pre/post script
 * orchestration; this module only owns the socket lifecycle.
 */

import {
    IDisposable,
    IWebSocketClient,
    IWebSocketConnection,
    WebSocketCloseInfo,
    WebSocketFrame,
} from '../../types/platform';
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

/** Default time to collect inbound frames after the saved messages are sent. */
export const DEFAULT_WEBSOCKET_RESPONSE_TIMEOUT_MS = 1000;

function createAbortError(): Error {
    const error = new Error('WebSocket request cancelled');
    error.name = 'AbortError';
    return error;
}

function normalizeResponseTimeout(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) {
        return DEFAULT_WEBSOCKET_RESPONSE_TIMEOUT_MS;
    }
    return Math.max(0, Math.floor(value));
}

function toMaxPayloadBytes(maxMessageSizeMb: number | undefined): number | undefined {
    if (!maxMessageSizeMb || !Number.isFinite(maxMessageSizeMb) || maxMessageSizeMb <= 0) {
        return undefined;
    }
    return Math.floor(maxMessageSizeMb * 1024 * 1024);
}

function connectSettings(request: ExecutionRequest): Partial<RequestSettings> | undefined {
    const websocketSettings = request.websocket?.settings;
    const handshakeTimeout = websocketSettings?.handshakeTimeout;
    const timeout = handshakeTimeout && handshakeTimeout > 0
        ? handshakeTimeout
        : request.settings?.timeout;

    if (!request.settings && timeout === undefined) {
        return undefined;
    }

    return {
        ...(request.settings ?? {}),
        ...(timeout !== undefined ? { timeout } : {}),
    };
}

function decodeBinary(data: string, encoding: WebSocketBinaryEncoding | undefined): Buffer {
    return encoding === 'hex' ? Buffer.from(data, 'hex') : Buffer.from(data, 'base64');
}

function toTranscriptFrame(frame: WebSocketFrame, direction: 'in' | 'out'): WebSocketRunFrame {
    if (frame.isBinary) {
        const bytes = frame.data as Uint8Array;
        return {
            direction,
            type: 'binary',
            data: Buffer.from(bytes).toString('base64'),
            encoding: 'base64',
            size: bytes.byteLength,
            time: Date.now(),
        };
    }

    const data = String(frame.data);
    return {
        direction,
        type: 'text',
        data,
        size: Buffer.byteLength(data, 'utf8'),
        time: Date.now(),
    };
}

async function sendSavedMessage(
    connection: IWebSocketConnection,
    transcript: WebSocketRunTranscript,
    message: WebSocketMessageDraft
): Promise<void> {
    const type = message.type === 'binary' ? 'binary' : 'text';
    const encoding = type === 'binary' ? (message.encoding === 'hex' ? 'hex' : 'base64') : undefined;
    const data = message.data ?? '';
    const payload = type === 'binary' ? decodeBinary(data, encoding) : data;

    await connection.send(payload);

    transcript.frames.push({
        direction: 'out',
        type,
        data,
        ...(encoding ? { encoding } : {}),
        size: type === 'binary' ? payload.length : Buffer.byteLength(data, 'utf8'),
        time: Date.now(),
    });
}

function waitForSettle(
    connection: IWebSocketConnection,
    timeoutMs: number,
    signal: AbortSignal | undefined
): Promise<void> {
    return new Promise<void>((resolve) => {
        let settled = false;
        let closeListener: IDisposable | undefined;
        let timer: NodeJS.Timeout | undefined;

        const finish = () => {
            if (settled) {
                return;
            }
            settled = true;
            if (timer) {
                clearTimeout(timer);
            }
            closeListener?.dispose();
            signal?.removeEventListener('abort', finish);
            resolve();
        };

        closeListener = connection.onClose(finish);
        signal?.addEventListener('abort', finish, { once: true });

        // The peer may have closed between the state check and listener attach.
        if (connection.state !== 'open') {
            finish();
            return;
        }

        timer = setTimeout(finish, timeoutMs);
    });
}

async function closeQuietly(
    connection: IWebSocketConnection,
    code: number,
    reason: string
): Promise<void> {
    if (connection.state === 'closed') {
        return;
    }
    try {
        await connection.close(code, reason);
    } catch {
        // The socket may already be gone; the caller only needs best-effort close.
    }
}

/**
 * Execute a WebSocket request headlessly and return its transcript response.
 *
 * Socket.IO requests are rejected for now: the client lives in the extension
 * host so core stays free of `socket.io-client`. A core-side transport port is
 * a separate design decision.
 */
export async function runWebSocketRequest(
    client: IWebSocketClient,
    request: ExecutionRequest,
    prepared: PreparedRequest,
    signal?: AbortSignal
): Promise<HttpResponse> {
    if (request.websocket?.protocol === 'socketio') {
        throw new Error(
            'Socket.IO requests must use runSocketIoRequest, not runWebSocketRequest'
        );
    }

    const started = Date.now();
    const websocket = request.websocket;
    const responseTimeout = normalizeResponseTimeout(websocket?.settings?.responseTimeout);
    const transcript: WebSocketRunTranscript = {
        protocol: 'websocket',
        frames: [],
    };

    const connection = await client.connect({
        url: prepared.url,
        headers: prepared.headers,
        protocols: websocket?.subprotocols,
        settings: connectSettings(request),
        maxPayloadBytes: toMaxPayloadBytes(websocket?.settings?.maxMessageSizeMb),
        signal,
    });

    const disposables: IDisposable[] = [];
    let closeInfo: WebSocketCloseInfo | undefined;

    try {
        disposables.push(connection.onFrame((frame) => {
            transcript.frames.push(toTranscriptFrame(frame, 'in'));
        }));

        disposables.push(connection.onClose((info) => {
            closeInfo = info;
        }));

        disposables.push(connection.onError((error) => {
            transcript.frames.push({
                direction: 'system',
                type: 'text',
                data: `Error: ${error.message}`,
                size: 0,
                time: Date.now(),
            });
        }));

        for (const message of websocket?.messages ?? []) {
            if (message.enabled === false) {
                continue;
            }
            if (signal?.aborted) {
                await closeQuietly(connection, 1001, 'Run cancelled');
                throw createAbortError();
            }
            await sendSavedMessage(connection, transcript, message);
        }

        if (signal?.aborted) {
            await closeQuietly(connection, 1001, 'Run cancelled');
            throw createAbortError();
        }

        if (responseTimeout > 0 && connection.state === 'open') {
            await waitForSettle(connection, responseTimeout, signal);
        }

        if (signal?.aborted) {
            await closeQuietly(connection, 1001, 'Run cancelled');
            throw createAbortError();
        }

        await closeQuietly(connection, 1000, 'Run complete');

        if (closeInfo) {
            transcript.close = { ...closeInfo };
        }

        return {
            status: 101,
            statusText: 'Switching Protocols',
            headers: connection.handshakeHeaders ?? {},
            cookies: [],
            body: transcript,
            time: Date.now() - started,
            size: Buffer.byteLength(JSON.stringify(transcript), 'utf8'),
        };
    } finally {
        for (const disposable of disposables) {
            disposable.dispose();
        }
        // `close()` releases the socket. Calling `dispose()` on a socket that is
        // still in the closing state would install another close timer, so only
        // use it as a last resort when the connection never reached a closed state.
        if (connection.state !== 'closed') {
            await closeQuietly(connection, 1000, 'Run complete');
        }
    }
}
