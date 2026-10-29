import type { IDisposable } from '../../types/platform';
import * as socketioClient from 'socket.io-client';
import type {
    ISocketIoClient,
    ISocketIoConnection,
    SocketIoConnectOptions,
    SocketIoEvent,
} from '../../types/platform';

export type { IDisposable, ISocketIoClient, ISocketIoConnection, SocketIoConnectOptions, SocketIoEvent };

function normalizeSocketIoAuth(auth: unknown): unknown {
    if (typeof auth !== 'string') {
        return auth;
    }
    const trimmed = auth.trim();
    if (trimmed === '') {
        return undefined;
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        return trimmed;
    }
}

const RESERVED_SOCKET_IO_EVENTS = new Set([
    'connect',
    'connect_error',
    'disconnect',
    'disconnecting',
    'newListener',
    'removeListener',
]);

interface SocketIoModule {
    io: typeof import('socket.io-client').io;
}

/**
 * Node.js Socket.IO transport adapter.
 *
 * Wraps the lazily loaded `socket.io-client` so Socket.IO requests can run
 * headlessly (collection runner / suite executor) and interactively (Request
 * Tester). `socket.io-client` stays out of the eager bundle.
 */
export class NodeSocketIoClient implements ISocketIoClient {
    async connect(options: SocketIoConnectOptions): Promise<ISocketIoConnection> {
        const module = await loadSocketIoModule();
        const namespace = options.namespace?.trim();
        const base = options.url.endsWith('/') ? options.url.slice(0, -1) : options.url;
        const ns = namespace ? (namespace.startsWith('/') ? namespace.slice(1) : namespace) : '';
        const url = namespace && namespace !== '/' ? `${base}/${ns}` : options.url;
        const transports = options.transports && options.transports.length > 0
            ? options.transports
            : (options.clientVersion === '2' || options.clientVersion === '3')
                ? ['polling', 'websocket']
                : ['websocket'];
        return new Promise<ISocketIoConnection>((resolve, reject) => {
            const socket = module.io(url, {
                transports,
                extraHeaders: options.headers,
                path: options.path,
                timeout: options.timeout,
                reconnection: (options.reconnectionAttempts ?? 0) > 0,
                reconnectionAttempts: options.reconnectionAttempts,
                reconnectionDelay: options.reconnectionDelay,
                auth: normalizeSocketIoAuth(options.auth) as any,
            });

            let settled = false;
            const fail = (error: Error) => {
                if (settled) {
                    return;
                }
                settled = true;
                socket.disconnect();
                reject(error);
            };

            socket.once('connect', () => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(new NodeSocketIoConnection(socket, options.listeners));
            });

            socket.once('connect_error', (error: Error) => {
                fail(error instanceof Error ? error : new Error(String(error)));
            });
        });
    }
}

/**
 * Backwards-compatible alias for the extension's previous adapter name.
 */
export class SocketIoClientAdapter extends NodeSocketIoClient {}

class NodeSocketIoConnection implements ISocketIoConnection {
    private readonly eventListeners = new Set<(event: SocketIoEvent) => void>();
    private readonly connectListeners = new Set<() => void>();
    private readonly disconnectListeners = new Set<(reason: string) => void>();
    private readonly reconnectFailedListeners = new Set<() => void>();
    private readonly errorListeners = new Set<(error: Error) => void>();
    private readonly disposal: IDisposable[] = [];
    private disposed = false;

    constructor(
        private readonly socket: import('socket.io-client').Socket,
        _listeners?: string[]
    ) {
        const onAny = (event: string, ...args: unknown[]) => {
            if (RESERVED_SOCKET_IO_EVENTS.has(event)) {
                return;
            }
            for (const listener of [...this.eventListeners]) {
                listener({ event, args });
            }
        };
        const onConnect = () => {
            for (const listener of [...this.connectListeners]) {
                listener();
            }
        };
        const onDisconnect = (reason: string) => {
            for (const listener of [...this.disconnectListeners]) {
                listener(reason);
            }
        };
        const onReconnectFailed = () => {
            for (const listener of [...this.reconnectFailedListeners]) {
                listener();
            }
        };
        const onError = (error: Error) => {
            for (const listener of [...this.errorListeners]) {
                listener(error);
            }
        };

        this.socket.on('connect', onConnect);
        this.socket.on('disconnect', onDisconnect);
        this.socket.on('connect_error', onError);
        this.socket.io.on('reconnect_failed', onReconnectFailed);
        this.socket.onAny(onAny);

        this.disposal.push({
            dispose: () => {
                this.socket.off('connect', onConnect);
                this.socket.off('disconnect', onDisconnect);
                this.socket.off('connect_error', onError);
                this.socket.io.off('reconnect_failed', onReconnectFailed);
                this.socket.offAny(onAny);
            },
        });
    }

    get connected(): boolean {
        return this.socket.connected;
    }

    get id(): string | undefined {
        return this.socket.id;
    }

    async send(event: string, args: unknown[], expectAck = false): Promise<unknown[] | undefined> {
        const name = event?.trim() || 'message';
        if (!expectAck) {
            this.socket.emit(name, ...args);
            return Promise.resolve(undefined);
        }

        return new Promise((resolve) => {
            this.socket.emit(name, ...args, (...ackArgs: unknown[]) => {
                resolve(ackArgs);
            });
        });
    }

    close(): void {
        this.socket.disconnect();
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
        this.socket.disconnect();
        for (const disposable of this.disposal) {
            disposable.dispose();
        }
        this.disposal.length = 0;
        this.eventListeners.clear();
        this.connectListeners.clear();
        this.disconnectListeners.clear();
        this.reconnectFailedListeners.clear();
        this.errorListeners.clear();
    }
}

async function loadSocketIoModule(): Promise<SocketIoModule> {
    // socket.io-client is bundled into consumers (extension) so it must be a
    // static import for esbuild to resolve and inline it. The module is
    // loaded lazily by callers (only when a Socket.IO request runs).
    return { io: (socketioClient as any).io ?? (socketioClient as any).default?.io };
}

interface SocketIoModule {
    io: typeof import('socket.io-client').io;
}