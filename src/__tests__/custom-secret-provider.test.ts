/**
 * Custom secret provider behaviour tests.
 *
 * A custom provider is a user-authored module resolved from the workspace's
 * `scripts.modulePaths`. These tests exercise the real registry/config path with
 * temporary workspace modules, not an in-process mock of the loader.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '../infrastructure/config/config-service';
import { SecretResolverRegistry } from '../infrastructure/secrets/secret-resolver-registry';

const tempDirs: string[] = [];

const FACTORY_MODULE = `
module.exports = function createResolver({ alias, options }) {
    return {
        providerName: 'corp',
        async resolve(path) {
            if (path === 'missing') return undefined;
            if (path === 'boom') throw new Error('corp unavailable');
            return alias + '|' + options.mount + '|' + path;
        },
    };
};
`;

function makeWorkspace(
    moduleSource: string,
    provider: Record<string, unknown> = {},
): string {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-custom-secret-'));
    tempDirs.push(workspace);

    const forgeDir = path.join(workspace, '.http-forge');
    const libDir = path.join(workspace, 'lib');
    fs.mkdirSync(forgeDir, { recursive: true });
    fs.mkdirSync(libDir, { recursive: true });

    fs.writeFileSync(
        path.join(libDir, 'package.json'),
        JSON.stringify({ name: 'custom-secret-lib', version: '1.0.0' }),
        'utf-8',
    );
    fs.writeFileSync(path.join(libDir, 'corp-secrets.js'), moduleSource, 'utf-8');
    fs.writeFileSync(
        path.join(forgeDir, 'http-forge.config.json'),
        JSON.stringify({
            version: '1.0',
            scripts: { modulePaths: ['../lib'] },
            secrets: {
                providers: {
                    corp: {
                        provider: 'custom',
                        module: './corp-secrets.js',
                        ...provider,
                    },
                },
            },
        }),
        'utf-8',
    );

    return workspace;
}

function makeRegistry(workspace: string): SecretResolverRegistry {
    return new SecretResolverRegistry(new ConfigService(workspace));
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('custom secret provider', () => {
    it('resolves a secret through a workspace factory module', async () => {
        const registry = makeRegistry(
            makeWorkspace(FACTORY_MODULE, { options: { mount: 'kv' } }),
        );

        const resolved = await registry.resolveSecretTokens('{{secret:corp/app#token}}');

        expect(resolved['secret:corp/app#token']).toBe('corp|kv|app#token');
    });

    it('accepts an object module that exports createResolver', async () => {
        const registry = makeRegistry(
            makeWorkspace(`
module.exports = {
    createResolver({ options }) {
        return {
            providerName: 'corp',
            async resolve(path) {
                return options.prefix + path;
            },
        };
    },
};
`, { options: { prefix: 'object:' } }),
        );

        const resolved = await registry.resolveSecretTokens('{{secret:corp/token}}');

        expect(resolved['secret:corp/token']).toBe('object:token');
    });

    it('accepts a plain resolver object export', async () => {
        const registry = makeRegistry(
            makeWorkspace(`
module.exports = {
    providerName: 'corp',
    async resolve(path) {
        return 'plain:' + path;
    },
};
`),
        );

        const resolved = await registry.resolveSecretTokens('{{secret:corp/token}}');

        expect(resolved['secret:corp/token']).toBe('plain:token');
    });

    it('warns and leaves the token unresolved for an invalid module export', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const registry = makeRegistry(makeWorkspace('module.exports = { nope: true };'));

        const resolved = await registry.resolveSecretTokens('{{secret:corp/token}}');

        expect(resolved).toEqual({});
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('must export a resolver factory function'),
        );
    });

    it('warns with the module path when the module cannot be loaded', async () => {
        const workspace = makeWorkspace(FACTORY_MODULE);
        const configPath = path.join(workspace, '.http-forge', 'http-forge.config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.secrets.providers.corp.module = './missing.js';
        fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        new SecretResolverRegistry(new ConfigService(workspace));

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('./missing.js'));
    });

    it('preserves module evaluation errors instead of hiding them behind fallback resolution', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        new SecretResolverRegistry(
            new ConfigService(makeWorkspace(`throw new Error('module boom');`)),
        );

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('module boom'));
    });

    it('warns when a custom provider has no module configured', () => {
        const workspace = makeWorkspace(FACTORY_MODULE);
        const configPath = path.join(workspace, '.http-forge', 'http-forge.config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        delete config.secrets.providers.corp.module;
        fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        new SecretResolverRegistry(new ConfigService(workspace));

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('requires a "module"'));
    });

    it('warns when the factory returns an invalid resolver', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        new SecretResolverRegistry(
            new ConfigService(makeWorkspace('module.exports = () => ({});')),
        );

        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('did not return a resolver with resolve(path)'),
        );
    });

    it('warns when the factory is async instead of returning a resolver synchronously', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        new SecretResolverRegistry(
            new ConfigService(makeWorkspace(`
module.exports = async function createResolver() {
    return { providerName: 'corp', async resolve() { return 'value'; } };
};
`)),
        );

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('returned a Promise'));
    });

    it('logs the resolver failure and leaves the token unresolved', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const registry = makeRegistry(makeWorkspace(FACTORY_MODULE, { options: { mount: 'kv' } }));

        const resolved = await registry.resolveSecretTokens('{{secret:corp/boom}}');

        expect(resolved).toEqual({});
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('corp unavailable'));
    });

    it('rebuilds the custom resolver after the config is reloaded', async () => {
        const workspace = makeWorkspace(FACTORY_MODULE, { options: { mount: 'one' } });
        const configPath = path.join(workspace, '.http-forge', 'http-forge.config.json');
        const configService = new ConfigService(workspace);
        const registry = new SecretResolverRegistry(configService);

        expect(
            (await registry.resolveSecretTokens('{{secret:corp/token}}'))['secret:corp/token'],
        ).toBe('corp|one|token');

        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.secrets.providers.corp.options.mount = 'two';
        fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8');
        configService.reload();

        expect(
            (await registry.resolveSecretTokens('{{secret:corp/token}}'))['secret:corp/token'],
        ).toBe('corp|two|token');
    });
});
