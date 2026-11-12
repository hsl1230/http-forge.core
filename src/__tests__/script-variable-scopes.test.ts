import { describe, expect, it } from 'vitest';
import { ScriptExecutor } from '../infrastructure/script/script-executor';

describe('script variable scope results', () => {
  it('reports collection and request-local writes separately from environment writes', async () => {
    const executor = new ScriptExecutor();
    const session = executor.createRequestSession({
      request: {
        url: 'https://example.com/users',
        method: 'GET'
      },
      variables: {},
      environmentVariables: { envVar: 'env' },
      globals: { globalVar: 'global' },
      collectionVariables: { base: 'base' },
      info: { eventName: 'prerequest', requestName: 'Get users', requestId: 'r1' }
    });

    const result = await session.executePreRequest(`
      pm.collectionVariables.set('token', 'abc');
      pm.collectionVariables.unset('base');
      pm.variables.set('local', 'value');
      pm.environment.set('envVar', 'env-updated');
      pm.globals.set('globalVar', 'global-updated');
    `);

    expect(result.success).toBe(true);
    expect(result.modifiedCollectionVariables).toEqual({ token: 'abc' });
    expect(result.requestLocalWrites).toEqual({ local: 'value' });
    expect(result.modifiedEnvironmentVariables).toEqual({ envVar: 'env-updated' });
    expect(result.modifiedGlobals).toEqual({ globalVar: 'global-updated' });
  });
});
