import { describe, it, expect } from 'vitest';
import { ScriptExecutor } from '../infrastructure/script/script-executor';

describe('bare postman', () => {
    it('works', async () => {
        const executor = new ScriptExecutor();
        const ctx: any = {
            request: { url: 'http://example.com', method: 'GET', headers: {}, name: 'test', id: 'req1' },
            variables: {},
            environmentVariables: {},
            globals: { token: 'old-token' },
            environmentName: 'dev',
            onGlobalsChange: (action: any, key: any, value: any) => {},
            info: { requestName: 'test', requestId: 'r1' }
        };
        const session = executor.createRequestSession(ctx);
        await session.executePreRequest('// no-op');
        const res: any = await session.executePostResponse(`console.log('typeof postman:', typeof postman);`, { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, cookies: [], body: '{}', responseTime: 1, size: 2, executedRequest: { url: 'http://example.com', method: 'GET', headers: {}, body: { type: 'none', content: null }, params: {}, query: {} } } as any);
        console.log('testResults:', JSON.stringify(res.testResults));
        console.log('consoleOutput:', JSON.stringify(res.consoleOutput));
    });
});
