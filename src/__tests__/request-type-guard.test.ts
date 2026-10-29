import { describe, expect, it } from 'vitest';
import { CollectionRequestExecutor } from '../infrastructure/execution/collection-request-executor';
import { RequestExecutor } from '../infrastructure/execution/request-executor';
import { HttpRequestService } from '../infrastructure/http/http-request-service';
import type { IRequestPreparer } from '../infrastructure/execution/request-preparer-interfaces';
import type { IForgeEnv } from '../infrastructure/environment/forge-env';
import type { IInterceptorExecutor } from '../infrastructure/http/interceptor-chain';
import type { IHttpRequestService } from '../infrastructure/http/interfaces';
import type { IUrlBuilder } from '../infrastructure/http/url-builder';
import type { IScriptExecutor } from '../infrastructure/script/interfaces';
import type { IEnvironmentConfigService } from '../types/environment-config';
import type { IHttpClient } from '../types/platform';
import type { UnifiedCollection, UnifiedRequest } from '../types/types';

describe('WebSocket request type guard', () => {
    it('rejects a WebSocket request in the HTTP transport', async () => {
        const service = new HttpRequestService(
            {} as unknown as IUrlBuilder,
            {} as unknown as IInterceptorExecutor,
            {} as unknown as IHttpClient
        );

        await expect(service.execute({
            method: 'GET',
            url: 'wss://example.test/socket'
        })).rejects.toThrow('WebSocket requests must be executed through the WebSocket client');
    });

    it('requires a WebSocket client when the collection runner executes a WebSocket request', async () => {
        const executor = new CollectionRequestExecutor(
            {} as unknown as IHttpRequestService,
            {} as unknown as IScriptExecutor,
            {} as unknown as IEnvironmentConfigService,
            {} as unknown as IRequestPreparer,
            'dev'
        );

        await expect(executor.execute({
            id: 'ws-request',
            name: 'Chat socket',
            requestType: 'websocket',
            method: 'GET',
            url: 'wss://example.test/socket'
        }, {})).rejects.toThrow('WebSocket execution is not configured for this runner');
    });

    it('rejects a WebSocket request in the shared request executor', async () => {
        const executor = new RequestExecutor(
            {} as unknown as IHttpClient,
            {} as unknown as IForgeEnv
        );

        await expect(executor.execute({
            type: 'request',
            id: 'ws-request',
            name: 'Chat socket',
            requestType: 'websocket',
            method: 'GET',
            url: 'wss://example.test/socket',
            headers: [],
            query: []
        } as UnifiedRequest, {} as UnifiedCollection)).rejects.toThrow(
            'WebSocket requests are not supported by the HTTP request executor'
        );
    });
});
