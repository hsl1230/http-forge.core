import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { FolderCollectionLoader } from '../infrastructure/collection/folder-collection-loader';
import { FolderCollectionStore } from '../infrastructure/collection/folder-collection-store';
import { toExecutionRequest } from '../runtime/execution-helpers';
import type { Collection, CollectionRequestItem } from '../types/collection';
import type { CollectionRequest } from '../types/types';

describe('WebSocket request persistence', () => {
    let workspace: string | undefined;

    afterEach(() => {
        if (workspace) {
            rmSync(workspace, { recursive: true, force: true });
            workspace = undefined;
        }
    });

    it('round-trips request type and websocket configuration through light and detail loads', async () => {
        workspace = mkdtempSync(join(tmpdir(), 'http-forge-ws-'));
        const store = new FolderCollectionStore(join(workspace, 'collections'));
        const request: CollectionRequestItem = {
            id: 'ws-request',
            type: 'request',
            name: 'Chat socket',
            requestType: 'websocket',
            method: 'GET',
            url: 'wss://example.test/socket',
            headers: [{ key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
            auth: { type: 'inherit' },
            websocket: {
                protocol: 'socketio',
                subprotocols: ['chat', 'json'],
                settings: {
                    handshakeTimeout: 12000,
                    reconnectionAttempts: 4,
                    reconnectionInterval: 750,
                    maxMessageSizeMb: 2,
                },
                socketio: {
                    clientVersion: '4',
                    handshakePath: '/custom-socket',
                    listeners: [
                        { id: 'l1', name: 'chat.message', description: 'Incoming chat', enabled: true },
                    ],
                },
                messages: [
                    {
                        id: 'm1',
                        name: 'hello',
                        type: 'text',
                        format: 'json',
                        data: '{"type":"hello"}',
                        event: 'chat',
                        args: ['one', 'two'],
                        ack: true,
                    },
                    { id: 'm2', type: 'binary', format: 'binary', encoding: 'hex', data: '010203' },
                ],
            },
        };
        const collection: Collection = {
            id: 'ws-collection',
            name: 'WebSocket collection',
            items: [request],
        };

        await store.save(collection);

        const lightRequest = store.loadAllLight()[0].items[0] as CollectionRequestItem;
        expect(lightRequest.requestType).toBe('websocket');
        expect(lightRequest.method).toBe('GET');
        expect(lightRequest.websocket).toEqual(request.websocket);

        const detailRequest = store.loadRequestDetail('ws-collection', 'ws-request') as CollectionRequestItem;
        expect(detailRequest.requestType).toBe('websocket');
        expect(detailRequest.method).toBe('GET');
        expect(detailRequest.websocket).toEqual(request.websocket);

        const loader = new FolderCollectionLoader(join(workspace, 'collections'));
        const unifiedRequest = loader.load('ws-collection')?.items[0];
        expect(unifiedRequest?.type).toBe('request');
        if (unifiedRequest?.type !== 'request') {
            throw new Error('Expected a unified request');
        }
        expect(unifiedRequest.requestType).toBe('websocket');
        expect(unifiedRequest.method).toBe('GET');
        expect(unifiedRequest.websocket).toEqual(request.websocket);
    });

    it('preserves requestType and websocket configuration when mapping to an execution request', () => {
        const websocket = {
            protocol: 'websocket' as const,
            subprotocols: ['chat'],
            messages: [{ id: 'm1', type: 'text' as const, data: 'hello' }],
            settings: { responseTimeout: 2500 },
        };
        const request: CollectionRequest = {
            id: 'ws-request',
            name: 'Chat socket',
            requestType: 'websocket',
            method: 'GET',
            url: 'wss://example.test/socket',
            websocket,
        };

        const execution = toExecutionRequest(request);

        expect(execution.requestType).toBe('websocket');
        expect(execution.websocket).toEqual(websocket);
    });
});
