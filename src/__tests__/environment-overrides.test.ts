/**
 * Environment Session-Override Tests
 *
 * Verifies the lifecycle of `pm.environment.set()` session overrides
 * ("Current Values"): per-environment visibility for the editor UI,
 * single-key revert, and full reset-to-initial (Postman's "Reset All").
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { EnvironmentConfigService } from '../infrastructure/environment/environment-config-service';

function createService(): { svc: EnvironmentConfigService; store: Map<string, unknown> } {
    const store = new Map<string, unknown>();
    const workspaceStore: any = {
        get: (key: string, def?: unknown) => (store.has(key) ? store.get(key) : def),
        update: (key: string, value: unknown) => { store.set(key, value); return Promise.resolve(); }
    };
    const configService: any = {
        getEnvironmentsPath: () => '/tmp/hf-env-overrides-test-envs',
        getHistoryPath: () => '/tmp/hf-env-overrides-test-history'
    };
    const svc = new EnvironmentConfigService('/tmp/hf-env-overrides-test', workspaceStore, configService);
    (svc as any).sharedConfig = {
        globalVariables: {},
        defaultHeaders: {},
        environments: {
            dev: { variables: { baseUrl: 'https://dev.example.com' } },
            prod: { variables: { baseUrl: 'https://api.example.com' } }
        }
    };
    (svc as any).localConfig = { credentials: {}, variables: {} };
    return { svc, store };
}

describe('environment session overrides', () => {
    let svc: EnvironmentConfigService;

    beforeEach(() => {
        svc = createService().svc;
    });

    it('starts with no session overrides', () => {
        expect(svc.getAllEnvironmentVariableLocals()).toEqual({});
    });

    it('exposes script-set overrides per environment without touching file values', () => {
        svc.setEnvironmentVariable('token', 'abc', 'dev');
        svc.setEnvironmentVariable('token', 'xyz', 'prod');

        expect(svc.getAllEnvironmentVariableLocals()).toEqual({
            dev: { token: 'abc' },
            prod: { token: 'xyz' }
        });
        // File values unchanged — overrides shadow rather than replace
        expect(svc.getSharedConfig()?.environments?.['dev']?.variables?.['token']).toBeUndefined();
    });

    it('reverts a single override so the file value shines through', () => {
        svc.setEnvironmentVariable('token', 'abc', 'dev');
        expect(svc.getAllEnvironmentVariableLocals()).toEqual({ dev: { token: 'abc' } });
        svc.deleteEnvironmentVariable('token', 'dev');
        expect(svc.getAllEnvironmentVariableLocals()).toEqual({ dev: {} });
        // Resolution falls back to the file value again
        expect(svc.getResolvedEnvironment('dev')?.variables['baseUrl']).toBe('https://dev.example.com');
    });

    it('resets one environment while keeping others', async () => {
        svc.setEnvironmentVariable('token', 'abc', 'dev');
        svc.setEnvironmentVariable('token', 'xyz', 'prod');

        await svc.resetEnvironmentOverrides('dev');

        expect(svc.getAllEnvironmentVariableLocals()).toEqual({ prod: { token: 'xyz' } });
    });

    it('reset on an untouched environment is a no-op', async () => {
        await expect(svc.resetEnvironmentOverrides('dev')).resolves.toBeUndefined();
        expect(svc.getAllEnvironmentVariableLocals()).toEqual({});
    });
});
