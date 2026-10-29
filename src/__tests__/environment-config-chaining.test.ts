/**
 * Environment variable chaining tests
 *
 * Regression: when running a collection/suite from the CLI with an `--env`
 * that differs from the service's default `selectedEnvironment` ('dev'),
 * `pm.environment.set()` must write into the *run* environment bucket so the
 * next request can read it back. Previously writes always went to
 * `selectedEnvironment`, so chained requests lost values like `access_token`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { EnvironmentConfigService } from '../infrastructure/environment/environment-config-service';

function createService(): EnvironmentConfigService {
    const store = new Map<string, unknown>();
    const workspaceStore: any = {
        get: (key: string, def?: unknown) => (store.has(key) ? store.get(key) : def),
        update: (key: string, value: unknown) => { store.set(key, value); return Promise.resolve(); }
    };
    const configService: any = {
        getEnvironmentsPath: () => '/tmp/http-forge-test-envs',
        getHistoryPath: () => '/tmp/http-forge-test-history'
    };

    const svc = new EnvironmentConfigService('/tmp/http-forge-test', workspaceStore, configService);

    // Pre-seed configs so getResolvedEnvironment() does not touch disk.
    (svc as any).sharedConfig = {
        globalVariables: {},
        defaultHeaders: {},
        environments: {
            dev: { variables: {} },
            auth: { variables: {} }
        }
    };
    (svc as any).localConfig = { credentials: {}, variables: {} };

    return svc;
}

describe('Environment variable chaining', () => {
    let svc: EnvironmentConfigService;

    beforeEach(() => {
        svc = createService();
    });

    it('writes to the targeted run environment, not the selected one', () => {
        // Default selected env is 'dev'; run env is 'auth'.
        svc.setEnvironmentVariable('access_token', 'jwt-123', 'auth');

        // Next request in the same run reads the 'auth' env.
        const authEnv = svc.getResolvedEnvironment('auth');
        expect(authEnv?.variables.access_token).toBe('jwt-123');

        // It must NOT leak into the unrelated 'dev' (selected) bucket.
        const devEnv = svc.getResolvedEnvironment('dev');
        expect(devEnv?.variables.access_token).toBeUndefined();
    });

    it('falls back to the selected environment when no envName is given', () => {
        svc.setEnvironmentVariable('legacy_key', 'val'); // no envName -> selected ('dev')

        expect(svc.getResolvedEnvironment('dev')?.variables.legacy_key).toBe('val');
        expect(svc.getResolvedEnvironment('auth')?.variables.legacy_key).toBeUndefined();
    });

    it('deletes from the targeted run environment', () => {
        svc.setEnvironmentVariable('access_token', 'jwt-123', 'auth');
        expect(svc.getResolvedEnvironment('auth')?.variables.access_token).toBe('jwt-123');

        svc.deleteEnvironmentVariable('access_token', 'auth');
        expect(svc.getResolvedEnvironment('auth')?.variables.access_token).toBeUndefined();
    });

    it('clears only the targeted run environment', () => {
        svc.setEnvironmentVariable('a', '1', 'auth');
        svc.setEnvironmentVariable('b', '2', 'dev');

        svc.clearEnvironmentVariables('auth');

        expect(svc.getResolvedEnvironment('auth')?.variables.a).toBeUndefined();
        expect(svc.getResolvedEnvironment('dev')?.variables.b).toBe('2');
    });

    it('does not let the selected environment locals bleed into resolution for another env', () => {
        // 'dev' (the default selected env) has its own override for the same key.
        svc.setEnvironmentVariable('access_token', 'dev-token', 'dev');
        // The active run is 'auth' and sets the real token.
        svc.setEnvironmentVariable('access_token', 'auth-token', 'auth');

        // Resolving for 'auth' must use the auth value, NOT the selected ('dev') override.
        const resolved = svc.resolveVariables('Bearer {{access_token}}', 'auth');
        expect(resolved).toBe('Bearer auth-token');
    });
});
