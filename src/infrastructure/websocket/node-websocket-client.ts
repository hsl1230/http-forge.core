/**
 * Node WebSocket client adapter.
 *
 * Uses `ws` lazily so HTTP-only consumers do not load it. The module is
 * intentionally VS Code-free and exposes only the core WebSocket port.
 */

import fs from 'fs';
import path from 'path';
import type { ClientOptions, RawData, WebSocket } from 'ws';
import {
    IDisposable,
    IWebSocketClient,
    IWebSocketConnection,
    WebSocketCloseInfo,
    WebSocketConnectOptions,
    WebSocketConnectionState,
    WebSocketFrame,
} from '../../types/platform';
import { mergeRequestSettings } from '../http/merge-request-settings';

type WsConstructor = typeof import('ws').WebSocket;

function toUint8Array(data: RawData): Uint8Array {
    if (Buffer.isBuffer(data)) {
        return data;
    }
    if (Array.isArray(data)) {
        return Buffer.concat(data);
    }
    return new Uint8Array(data);
}

function resolveOptionalFile(filePath: string | undefined, basePath: string | undefined, label: string): Buffer | undefined {
    if (!filePath) {
        return undefined;
    }

    const resolved = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(basePath || process.cwd(), filePath);

    try {
        return fs.readFileSync(resolved);
    } catch (error: any) {
        throw new Error(`[NodeWebSocketClient] Failed to read ${label} file at ${resolved}: ${error?.message || 'Unknown error'}`);
    }
}

class NodeWebSocketConnection implements IWebSocketConnection {
    private readonly frameListeners = new Set<(frame: WebSocketFrame) => void>();
    private readonly closeListeners = new Set<(info: WebSocketCloseInfo) => void>();
    private readonly errorListeners = new Set<(error: Error) => void>();

    private _handshakeHeaders?: Record<string, string>;

    constructor(private readonly socket: WebSocket) {
        socket.on('upgrade', (response: any) => {
            if (response && response.headers && typeof response.headers === 'object') {
                const headers: Record<string, string> = {};
                for (const [key, value] of Object.entries(response.headers)) {
                    if (typeof value === 'string') {
                        headers[key] = value;
                    } else if (Array.isArray(value)) {
                        headers[key] = value.join(', ');
                    }
                }
                this._handshakeHeaders = headers;
            }
        });
        socket.on('message', (data: RawData, isBinary: boolean) => {
            const frame: WebSocketFrame = {
                data: isBinary ? toUint8Array(data) : data.toString(),
                isBinary,
            };
            for (const listener of this.frameListeners) {
                try {
                    listener(frame);
                } catch {
                    // A listener failure must not break the socket event loop.
                }
            }
        });

        socket.on('close', (code: number, reason: Buffer) => {
            const info: WebSocketCloseInfo = {
                code,
                reason: reason.toString(),
                // `ws` does not pass the browser CloseEvent `wasClean` flag on
                // the Node EventEmitter close event. 1006 (abnormal closure)
                // and 1015 (TLS handshake failure) are the non-clean cases.
                wasClean: code !== 1006 && code !== 1015,
            };
            for (const listener of this.closeListeners) {
                try {
                    listener(info);
                } catch {
                    // ignore
                }
            }
        });

        socket.on('error', (error: Error) => {
            for (const listener of this.errorListeners) {
                try {
                    listener(error);
                } catch {
                    // ignore
                }
            }
        });
    }

    get state(): WebSocketConnectionState {
        switch (this.socket.readyState) {
            case WebSocketState.CONNECTING:
                return 'connecting';
            case WebSocketState.OPEN:
                return 'open';
            case WebSocketState.CLOSING:
                return 'closing';
            default:
                return 'closed';
        }
    }

    get negotiatedProtocol(): string {
        return this.socket.protocol;
    }

    get handshakeHeaders(): Record<string, string> | undefined {
        return this._handshakeHeaders;
    }

    send(data: string | Uint8Array): Promise<void> {
        if (this.socket.readyState !== WebSocketState.OPEN) {
            return Promise.reject(new Error('WebSocket is not open'));
        }

        return new Promise<void>((resolve, reject) => {
            this.socket.send(data, { binary: typeof data !== 'string' }, (error?: Error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    close(code = 1000, reason = ''): Promise<void> {
        if (this.socket.readyState === WebSocketState.CLOSED) {
            return Promise.resolve();
        }

        if (this.socket.readyState === WebSocketState.CONNECTING) {
            this.socket.terminate();
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            let timer: NodeJS.Timeout | undefined;
            const finish = () => {
                if (timer) clearTimeout(timer);
                resolve();
            };

            this.socket.once('close', finish);

            // A peer that never completes the close handshake must not leave the
            // panel stuck in the closing state.
            timer = setTimeout(() => {
                this.socket.terminate();
                finish();
            }, 5000);

            if (this.socket.readyState === WebSocketState.CLOSING) {
                return;
            }

            this.socket.close(code, reason);
        });
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

    dispose(): void {
        if (this.socket.readyState === WebSocketState.CLOSED) {
            return;
        }
        void this.close(1000, 'Disposed').catch(() => {
            this.socket.terminate();
        });
    }
}

// Keep the numeric readyState values local so the port does not depend on ws
// enums at runtime (the module is imported lazily).
const WebSocketState = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
} as const;

export interface NodeWebSocketClientOptions {
    /** Base directory used to resolve relative TLS certificate paths. */
    basePath?: string;
}

/**
 * WebSocket client backed by the `ws` package.
 */
export class NodeWebSocketClient implements IWebSocketClient {
    constructor(private readonly options: NodeWebSocketClientOptions = {}) {}

    async connect(options: WebSocketConnectOptions): Promise<IWebSocketConnection> {
        if (options.signal?.aborted) {
            throw createAbortError();
        }

        const settings = mergeRequestSettings(options.settings);
        const wsConstructor = await loadWebSocketConstructor();
        const transportOptions = this.buildTransportOptions(options, settings);

        return new Promise<IWebSocketConnection>((resolve, reject) => {
            let settled = false;
            let socket: WebSocket;

            const cleanup = () => {
                options.signal?.removeEventListener('abort', onAbort);
            };

            const fail = (error: Error) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                reject(error);
            };

            const onAbort = () => {
                if (socket) {
                    socket.terminate();
                }
                fail(createAbortError());
            };

            try {
                socket = new wsConstructor(
                    options.url,
                    options.protocols && options.protocols.length > 0 ? options.protocols : undefined,
                    transportOptions
                );
            } catch (error: any) {
                fail(error instanceof Error ? error : new Error(String(error)));
                return;
            }

            options.signal?.addEventListener('abort', onAbort, { once: true });

            socket.once('open', () => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                resolve(new NodeWebSocketConnection(socket));
            });

            socket.once('error', (error: Error) => {
                fail(error);
            });

            socket.once('unexpected-response', (_request, response) => {
                socket.terminate();
                fail(new Error(`WebSocket handshake failed: HTTP ${response.statusCode} ${response.statusMessage || ''}`.trim()));
            });
        });
    }

    private buildTransportOptions(
        options: WebSocketConnectOptions,
        settings: ReturnType<typeof mergeRequestSettings>
    ): ClientOptions {
        const tls = settings.tls;
        const transportOptions: ClientOptions & { servername?: string } = {
            headers: options.headers,
            handshakeTimeout: settings.timeout > 0 ? settings.timeout : undefined,
            maxPayload: options.maxPayloadBytes && options.maxPayloadBytes > 0
                ? options.maxPayloadBytes
                : undefined,
            rejectUnauthorized: settings.strictSSL,
        };

        const ca = resolveOptionalFile(tls?.caPath, this.options.basePath, 'CA certificate');
        if (ca) {
            transportOptions.ca = ca;
        }

        const cert = resolveOptionalFile(tls?.certPath, this.options.basePath, 'client certificate');
        if (cert) {
            transportOptions.cert = cert;
        }

        const key = resolveOptionalFile(tls?.keyPath, this.options.basePath, 'client private key');
        if (key) {
            transportOptions.key = key;
        }

        const pfx = resolveOptionalFile(tls?.pfxPath, this.options.basePath, 'client pfx');
        if (pfx) {
            transportOptions.pfx = pfx;
        }

        if (tls?.passphrase) {
            transportOptions.passphrase = tls.passphrase;
        }

        if (tls?.servername) {
            transportOptions.servername = tls.servername;
        }

        return transportOptions;
    }
}

async function loadWebSocketConstructor(): Promise<WsConstructor> {
    const module = await import('ws');
    return module.WebSocket;
}

function createAbortError(): Error {
    const error = new Error('WebSocket connection cancelled');
    error.name = 'AbortError';
    return error;
}
