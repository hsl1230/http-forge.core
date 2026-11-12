import { describe, expect, it, vi } from 'vitest';
import { CollectionRequestExecutor } from '../infrastructure/execution/collection-request-executor';
import type { IRequestPreparer } from '../infrastructure/execution/request-preparer-interfaces';
import type { IHttpRequestService } from '../infrastructure/http/interfaces';
import { ScriptExecutor } from '../infrastructure/script/script-executor';
import type { IEnvironmentConfigService } from '../types/environment-config';

function createExecutor(): CollectionRequestExecutor {
    const environmentConfig = {
        getResolvedEnvironment: () => ({ name: 'dev', headers: {}, variables: {} }),
        getGlobalVariables: () => ({}),
        setEnvironmentVariable: vi.fn(),
        deleteEnvironmentVariable: vi.fn(),
        clearEnvironmentVariables: vi.fn(),
        setGlobalVariable: vi.fn(),
        deleteGlobalVariable: vi.fn(),
        clearGlobalVariables: vi.fn(),
    } as unknown as IEnvironmentConfigService;

    const httpService = {
        buildUrl: (url: string) => url,
        execute: vi.fn(async () => ({
            status: 200,
            statusText: 'OK',
            headers: {},
            body: { ok: true },
            time: 1,
            cookies: [],
        })),
    } as unknown as IHttpRequestService;

    const requestPreparer = {
        prepareRequest: async (input: any) => ({
            url: input.url,
            method: input.method,
            headers: {},
            body: { type: 'none', content: null },
            params: {},
            query: {},
        }),
    } as IRequestPreparer;

    return new CollectionRequestExecutor(
        httpService,
        new ScriptExecutor(),
        environmentConfig,
        requestPreparer,
        'dev'
    );
}

describe('CollectionRequestExecutor iteration data', () => {
    it('exposes the raw data row through pm.iterationData and legacy data', async () => {
        const executor = createExecutor();
        executor.setIterationData({ userId: '42', role: 'admin' });

        const result = await executor.execute({
            id: 'req-iteration-data',
            name: 'User from data row',
            method: 'GET',
            url: 'https://api.example.test/users/{{userId}}',
            scripts: {
                preRequest: `
                    pm.variables.set('preRow', pm.iterationData.get('userId'));
                `,
                postResponse: `
                    pm.test('pm.iterationData.get reads the row', () => {
                        pm.expect(pm.iterationData.get('userId')).to.equal('42');
                    });
                    pm.test('pm.iterationData.has sees the row key', () => {
                        pm.expect(pm.iterationData.has('role')).to.equal(true);
                    });
                    pm.test('pm.iterationData.toObject returns the full row', () => {
                        pm.expect(pm.iterationData.toObject().role).to.equal('admin');
                    });
                    pm.test('legacy data object sees the row', () => {
                        pm.expect(data.userId).to.equal('42');
                    });
                    pm.variables.set('postRow', pm.iterationData.get('userId'));
                `,
            },
        }, { userId: '42' });

        expect(result.assertions).toHaveLength(4);
        expect(result.assertions.every(assertion => assertion.passed)).toBe(true);
        expect(result.requestLocalWrites).toMatchObject({ postRow: '42' });
    });

    it('defaults to an empty data row when no iteration data is supplied', async () => {
        const executor = createExecutor();

        const result = await executor.execute({
            id: 'req-no-iteration-data',
            name: 'No data row',
            method: 'GET',
            url: 'https://api.example.test/users',
            scripts: {
                postResponse: `
                    pm.test('pm.iterationData is empty', () => {
                        pm.expect(pm.iterationData.toObject()).to.deep.equal({});
                    });
                `,
            },
        }, {});

        expect(result.assertions).toHaveLength(1);
        expect(result.assertions[0].passed).toBe(true);
    });
});
