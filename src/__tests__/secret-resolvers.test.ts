/**
 * Cloud secret resolver behaviour tests.
 *
 * Uses a local HTTP server implementing the HashiCorp Vault KV v2 read API so
 * the tests exercise the real registry/resolver/request-preparer path without
 * any cloud credentials or SDK installation.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '../infrastructure/config/config-service';
import { EnvironmentConfigService } from '../infrastructure/environment/environment-config-service';
import { RequestPreparer } from '../infrastructure/execution/request-preparer';
import { RequestPreprocessor } from '../infrastructure/http/request-preprocessor';
import type { IHttpRequestService } from '../infrastructure/http/interfaces';
import type { IOAuth2TokenManager, TokenInfo } from '../infrastructure/auth/interfaces';
import { SecretResolverRegistry } from '../infrastructure/secrets/secret-resolver-registry';
import { HashiCorpVaultResolver } from '../infrastructure/secrets/hashicorp-vault-resolver';
import { getSecretValues } from '../infrastructure/security/secret-values';
import { redactHistoryEntry } from '../infrastructure/security/sensitive-data-redactor';
import { ScriptExecutor } from '../infrastructure/script/script-executor';
import type { PreRequestScriptContext, ResponseContext } from '../infrastructure/script/interfaces';
import type { ResolvedEnvironment } from '../types/environment-config';
import type { ExecutionRequest, OAuth2Config } from '../types/types';

const VAULT_SECRETS: Record<string, Record<string, string>> = {
    app: {
        password: 's3cret',
        client_secret: 'client-secret-value',
        value: 'vault-value',
    },
    tricky: {
        value: '{{secret:vault/app#password}}',
    },
    'app?x': {
        value: 'question-secret',
    },
    'app name': {
        value: 'space-secret',
    },
};

let server: http.Server;
let vaultUrl: string;
let vaultRequests = 0;
const tempDirs: string[] = [];

const httpService: IHttpRequestService = {
    buildUrl(url, params, query) {
        let result = url;
        for (const [key, value] of Object.entries(params ?? {})) {
            result = result.replace(`:${key}`, encodeURIComponent(value));
        }
        const search = new URLSearchParams(query ?? {}).toString();
        return search ? `${result}?${search}` : result;
    },
    async execute() {
        throw new Error('HTTP execution is not used in these tests');
    },
};

class CapturingTokenManager implements IOAuth2TokenManager {
    public lastConfig: OAuth2Config | undefined;

    async getToken(config: OAuth2Config): Promise<TokenInfo> {
        this.lastConfig = config;
        return { accessToken: 'issued-token', tokenType: 'Bearer', raw: {} };
    }

    async refreshToken(config: OAuth2Config): Promise<TokenInfo> {
        return this.getToken(config);
    }

    async authorizationCodeFlow(config: OAuth2Config): Promise<TokenInfo> {
        return this.getToken(config);
    }

    async implicitFlow(config: OAuth2Config): Promise<TokenInfo> {
        return this.getToken(config);
    }

    clearToken(): void {}
    clearAllTokens(): void {}
    handleAuthorizationCallback(): void {}
    handleImplicitCallback(): void {}
}

function makeWorkspace(): string {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-secrets-'));
    tempDirs.push(workspace);
    const forgeDir = path.join(workspace, '.http-forge');
    fs.mkdirSync(forgeDir, { recursive: true });
    fs.writeFileSync(
        path.join(forgeDir, 'http-forge.config.json'),
        JSON.stringify(
            {
                version: '1.0',
                secrets: {
                    providers: {
                        vault: { provider: 'vault', address: vaultUrl, mountPath: 'secret' },
                    },
                },
            },
            null,
            2,
        ),
        'utf-8',
    );
    return workspace;
}

function makeRegistry(): SecretResolverRegistry {
    const configService = new ConfigService(makeWorkspace());
    return new SecretResolverRegistry(configService);
}

function writeFakeOnePasswordSdk(workspace: string, modulePathName: string, value: string): void {
    const moduleRoot = path.join(workspace, modulePathName);
    const packageRoot = path.join(moduleRoot, 'node_modules', '@1password', 'sdk');
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(
        path.join(moduleRoot, 'package.json'),
        JSON.stringify({ name: modulePathName, version: '1.0.0' }),
        'utf-8',
    );
    fs.writeFileSync(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: '@1password/sdk', version: '1.0.0', main: 'index.js' }),
        'utf-8',
    );
    fs.writeFileSync(
        path.join(packageRoot, 'index.js'),
        `exports.createClient = async function () {
            return { secrets: { resolve: async function () { return ${JSON.stringify(value)}; } } };
        };`,
        'utf-8',
    );
}

function makePreparer(
    registry: SecretResolverRegistry,
    tokenManager?: IOAuth2TokenManager,
): RequestPreparer {
    const workspace = makeWorkspace();
    const configService = new ConfigService(workspace);
    const environmentsDir = path.join(workspace, '.http-forge', 'assets', 'environments');
    fs.mkdirSync(environmentsDir, { recursive: true });
    fs.writeFileSync(
        path.join(environmentsDir, 'dev.json'),
        JSON.stringify({
            variables: { apiKey: '{{secret:vault/app#client_secret}}' },
        }),
        'utf-8',
    );
    const envService = new EnvironmentConfigService(workspace, undefined, configService);
    return new RequestPreparer(
        envService,
        httpService,
        new RequestPreprocessor(),
        tokenManager,
        { name: 'test', version: '1.0.0' },
        registry,
    );
}

function request(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
    return {
        id: 'req-1',
        name: 'Test request',
        method: 'GET',
        url: 'https://api.example.test/users',
        headers: {},
        ...overrides,
    };
}

const emptyEnv: ResolvedEnvironment = {
    name: 'dev',
    headers: {},
    variables: {},
};

function responseContext(): ResponseContext {
    return {
        executedRequest: {
            url: 'https://api.example.test',
            method: 'GET',
            headers: {},
            body: { type: 'none', content: null },
            params: {},
            query: {},
        },
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        responseTime: 1,
    };
}

beforeAll(async () => {
    process.env['VAULT_TOKEN'] = 'test-token';
    server = http.createServer((req, res) => {
        vaultRequests += 1;
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const match = url.pathname.match(/^\/v1\/secret\/data\/(.+)$/);
        const secretPath = match ? decodeURIComponent(match[1]) : '';
        const data = VAULT_SECRETS[secretPath];

        if (secretPath === 'boom') {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ errors: ['provider failure'] }));
            return;
        }

        if (!data) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ errors: [] }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: { data } }));
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (address && typeof address === 'object') {
                vaultUrl = `http://127.0.0.1:${address.port}`;
            }
            resolve();
        });
    });
});

afterAll(async () => {
    delete process.env['VAULT_TOKEN'];
    await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
    });
});

beforeEach(() => {
    vaultRequests = 0;
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env['OP_SERVICE_ACCOUNT_TOKEN'];
    delete process.env['VAULT_ADDR'];
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('SecretResolverRegistry', () => {
    it('resolves a Vault KV v2 secret with a field selector', async () => {
        const registry = makeRegistry();

        const resolved = await registry.resolveSecretTokens('{{secret:vault/app#password}}');

        expect(resolved['secret:vault/app#password']).toBe('s3cret');
    });

    it('fetches a repeated token only once per resolution pass', async () => {
        const registry = makeRegistry();

        const resolved = await registry.resolveSecretTokens([
            '{{secret:vault/app#password}}',
            'Bearer {{secret:vault/app#password}}',
        ]);

        expect(resolved['secret:vault/app#password']).toBe('s3cret');
        expect(vaultRequests).toBe(1);
    });

    it('warns and leaves tokens with unknown aliases unresolved', async () => {
        const registry = makeRegistry();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const resolved = await registry.resolveSecretTokens('{{secret:missing/app#password}}');

        expect(resolved).toEqual({});
        expect(vaultRequests).toBe(0);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('alias "missing"'));
    });

    it('warns when a provider reports that the secret does not exist', async () => {
        const registry = makeRegistry();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const resolved = await registry.resolveSecretTokens('{{secret:vault/missing#password}}');

        expect(resolved).toEqual({});
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('secret not found'));
    });

    it('warns for malformed secret tokens', async () => {
        const registry = makeRegistry();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const resolved = await registry.resolveSecretTokens('{{secret:no-path}}');

        expect(resolved).toEqual({});
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('malformed'));
    });

    it('logs and leaves the token unresolved when a provider request fails', async () => {
        const registry = makeRegistry();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const resolved = await registry.resolveSecretTokens('{{secret:vault/boom#password}}');

        expect(resolved).toEqual({});
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('secret:vault/boom#password'),
        );
    });

    it('rebuilds resolvers after the config is reloaded', async () => {
        const workspace = makeWorkspace();
        const configPath = path.join(workspace, '.http-forge', 'http-forge.config.json');
        fs.writeFileSync(
            configPath,
            JSON.stringify({ version: '1.0', secrets: { providers: {} } }),
            'utf-8',
        );
        const configService = new ConfigService(workspace);
        const registry = new SecretResolverRegistry(configService);

        expect(await registry.resolveSecretTokens('{{secret:teamvault/app#password}}')).toEqual({});

        fs.writeFileSync(
            configPath,
            JSON.stringify({
                version: '1.0',
                secrets: {
                    providers: {
                        teamvault: { provider: 'vault', address: vaultUrl, mountPath: 'secret' },
                    },
                },
            }),
            'utf-8',
        );
        configService.reload();

        const resolved = await registry.resolveSecretTokens('{{secret:teamvault/app#password}}');
        expect(resolved['secret:teamvault/app#password']).toBe('s3cret');
    });

    it('logs a warning when a configured provider cannot be constructed', () => {
        const workspace = makeWorkspace();
        const configPath = path.join(workspace, '.http-forge', 'http-forge.config.json');
        fs.writeFileSync(
            configPath,
            JSON.stringify({
                version: '1.0',
                secrets: { providers: { broken: { provider: 'unsupported' } } },
            }),
            'utf-8',
        );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        new SecretResolverRegistry(new ConfigService(workspace));

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('"broken"'));
    });

    it('passes modulePaths to 1Password and rebuilds them after config reload', async () => {
        process.env['OP_SERVICE_ACCOUNT_TOKEN'] = 'service-token';
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-secrets-'));
        tempDirs.push(workspace);
        const configPath = path.join(workspace, '.http-forge', 'http-forge.config.json');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        writeFakeOnePasswordSdk(workspace, 'lib-a', 'module-a');
        writeFakeOnePasswordSdk(workspace, 'lib-b', 'module-b');

        const writeConfig = (modulePath: string) => fs.writeFileSync(
            configPath,
            JSON.stringify({
                version: '1.0',
                scripts: { modulePaths: [modulePath] },
                secrets: { providers: { op: { provider: '1password' } } },
            }),
            'utf-8',
        );

        writeConfig('../lib-a');
        const configService = new ConfigService(workspace);
        const registry = new SecretResolverRegistry(configService);

        expect(
            (await registry.resolveSecretTokens('{{secret:op/Vault/Item/field}}'))['secret:op/Vault/Item/field'],
        ).toBe('module-a');

        writeConfig('../lib-b');
        configService.reload();

        expect(
            (await registry.resolveSecretTokens('{{secret:op/Vault/Item/field}}'))['secret:op/Vault/Item/field'],
        ).toBe('module-b');

        delete process.env['OP_SERVICE_ACCOUNT_TOKEN'];
    });
});

describe('HashiCorp Vault resolver', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('URL-encodes special characters in secret path segments', async () => {
        const registry = makeRegistry();

        expect(
            (await registry.resolveSecretTokens('{{secret:vault/app?x#value}}'))['secret:vault/app?x#value'],
        ).toBe('question-secret');
        expect(
            (await registry.resolveSecretTokens('{{secret:vault/app name#value}}'))['secret:vault/app name#value'],
        ).toBe('space-secret');
    });

    it('reports request timeouts clearly', async () => {
        process.env['VAULT_TOKEN'] = 'test-token';
        const fetchMock = vi.fn(async (_url: string | URL | Request, _options?: any) => {
            throw Object.assign(new Error('request timeout'), { name: 'TimeoutError' });
        });
        vi.stubGlobal('fetch', fetchMock);

        const resolver = new HashiCorpVaultResolver({
            provider: 'vault',
            address: 'https://vault.example.test',
        });

        await expect(resolver.resolve('app#password')).rejects.toThrow(
            /timed out after 10000ms/,
        );
        const options = fetchMock.mock.calls[0]?.[1] as any;
        expect(options?.signal).toBeDefined();
    });

    it('falls back to VAULT_ADDR and the default mount path for empty config values', async () => {
        process.env['VAULT_ADDR'] = vaultUrl;
        try {
            const resolver = new HashiCorpVaultResolver({
                provider: 'vault',
                address: '',
                mountPath: '',
            });

            expect(await resolver.resolve('app#password')).toBe('s3cret');
        } finally {
            delete process.env['VAULT_ADDR'];
        }
    });
});

describe('RequestPreparer secret resolution', () => {
    it('resolves direct secret tokens in URL, headers and body', async () => {
        const registry = makeRegistry();
        const preparer = makePreparer(registry);

        const prepared = await preparer.prepareRequest(
            request({
                url: 'https://api.example.test/{{secret:vault/app#password}}',
                headers: { 'X-Api-Key': '{{secret:vault/app#password}}' },
                body: {
                    type: 'raw',
                    format: 'json',
                    content: '{"client_secret":"{{secret:vault/app#client_secret}}"}',
                },
            }),
            'dev',
            emptyEnv,
        );

        expect(prepared.url).toBe('https://api.example.test/s3cret');
        expect(prepared.headers['X-Api-Key']).toBe('s3cret');
        expect(prepared.body?.content).toEqual({ client_secret: 'client-secret-value' });
    });

    it('applies interpolation filters to a resolved secret token', async () => {
        const registry = makeRegistry();
        const preparer = makePreparer(registry);

        const prepared = await preparer.prepareRequest(
            request({
                headers: { Authorization: 'Bearer {{secret:vault/app#password | upper}}' },
            }),
            'dev',
            emptyEnv,
        );

        expect(prepared.headers.Authorization).toBe('Bearer S3CRET');
    });

    it('resolves secret tokens nested in environment variables and default headers', async () => {
        const registry = makeRegistry();
        const preparer = makePreparer(registry);

        const prepared = await preparer.prepareRequest(
            request({ headers: { 'X-Api-Key': '{{apiKey}}' } }),
            'dev',
            {
                name: 'dev',
                headers: { 'X-Env-Key': '{{secret:vault/app#password}}' },
                variables: { apiKey: '{{secret:vault/app#client_secret}}' },
            },
        );

        expect(prepared.headers['X-Api-Key']).toBe('client-secret-value');
        expect(prepared.headers['X-Env-Key']).toBe('s3cret');
    });

    it('keeps a resolved secret opaque to recursive variable interpolation', async () => {
        const registry = makeRegistry();
        const preparer = makePreparer(registry);

        const prepared = await preparer.prepareRequest(
            request({ headers: { 'X-Tricky': '{{secret:vault/tricky#value}}' } }),
            'dev',
            emptyEnv,
        );

        expect(prepared.headers['X-Tricky']).toBe('{{secret:vault/app#password}}');
        expect(prepared.headers['X-Tricky']).not.toBe('s3cret');
    });

    it('tracks resolved values for persistence redaction without serializing metadata', async () => {
        const registry = makeRegistry();
        const preparer = makePreparer(registry);

        const prepared = await preparer.prepareRequest(
            request({
                url: 'https://api.example.test/{{secret:vault/app#password}}',
                headers: { 'X-Tenant': '{{secret:vault/app#password}}' },
            }),
            'dev',
            emptyEnv,
        );

        expect(getSecretValues(prepared)).toEqual(['s3cret']);
        expect(JSON.stringify(prepared)).not.toContain('secretValues');

        const redacted = redactHistoryEntry({
            id: 'entry-1',
            timestamp: 1,
            environment: 'dev',
            method: 'GET',
            sentRequest: prepared,
            response: { status: 200, statusText: 'OK', time: 1 },
        });

        expect(JSON.stringify(redacted)).not.toContain('s3cret');
        expect(redacted.sentRequest.url).toBe('https://api.example.test/***');
        expect(redacted.sentRequest.headers['X-Tenant']).toBe('***');
    });

    it('resolves a secret used directly as an OAuth2 access token', async () => {
        const registry = makeRegistry();
        const tokenManager = new CapturingTokenManager();
        const preparer = makePreparer(registry, tokenManager);

        const prepared = await preparer.prepareRequest(
            request({
                auth: {
                    type: 'oauth2',
                    oauth2: {
                        grantType: 'client_credentials',
                        accessToken: '{{secret:vault/app#password}}',
                    },
                },
            }),
            'dev',
            emptyEnv,
        );

        expect(prepared.headers.Authorization).toBe('Bearer s3cret');
        expect(tokenManager.lastConfig).toBeUndefined();
    });

    it('resolves OAuth2 client credentials before handing them to the token manager', async () => {
        const registry = makeRegistry();
        const tokenManager = new CapturingTokenManager();
        const preparer = makePreparer(registry, tokenManager);

        const prepared = await preparer.prepareRequest(
            request({
                method: 'POST',
                auth: {
                    type: 'oauth2',
                    oauth2: {
                        grantType: 'client_credentials',
                        tokenUrl: 'https://auth.example.test/token',
                        clientId: 'client-id',
                        clientSecret: '{{secret:vault/app#client_secret}}',
                    },
                },
            }),
            'dev',
            emptyEnv,
        );

        expect(tokenManager.lastConfig?.clientSecret).toBe('client-secret-value');
        expect(prepared.headers.Authorization).toBe('Bearer issued-token');
    });
});

describe('pm.vault', () => {
    it('reads secrets through the configured provider registry', async () => {
        const registry = makeRegistry();
        const executor = new ScriptExecutor(undefined, [], registry);
        const context = {
            request: { url: 'https://api.example.test', method: 'GET', headers: {}, name: 'test', id: 'req-1' },
            variables: {},
            environmentVariables: {},
            globals: {},
            environmentName: 'dev',
        } as PreRequestScriptContext;

        const session = executor.createRequestSession(context);
        await session.executePreRequest('// no-op');
        const result = await session.executePostResponse(
            `
            pm.test('vault read', async function () {
                const value = await pm.vault.get('vault/app#password');
                pm.expect(value).to.equal('s3cret');
            });
            `,
            responseContext(),
        );

        expect(result.testResults).toHaveLength(1);
        expect(result.testResults[0].passed).toBe(true);
    });
});

describe('pm.sendRequest', () => {
    it('resolves variables and secret tokens before sending', async () => {
        const registry = makeRegistry();
        const captured: any[] = [];
        const capturingService: IHttpRequestService = {
            buildUrl(url, params, query) {
                let result = url;
                for (const [key, value] of Object.entries(params ?? {})) {
                    result = result.replace(`:${key}`, encodeURIComponent(value));
                }
                const search = new URLSearchParams(query ?? {}).toString();
                return search ? `${result}?${search}` : result;
            },
            async execute(req) {
                captured.push(req);
                return { status: 200, statusText: 'OK', headers: {}, cookies: [], body: '{}', time: 1 };
            },
        };
        const executor = new ScriptExecutor(capturingService, [], registry, 'isolated');
        const context = {
            request: { url: 'https://api.example.test', method: 'GET', headers: {}, name: 'test', id: 'req-1' },
            variables: { baseUrl: 'https://api.example.test' },
            environmentVariables: {},
            globals: {},
            environmentName: 'dev',
        } as PreRequestScriptContext;

        const session = executor.createRequestSession(context);
        await session.executePreRequest(`
            const base = pm.variables.get('baseUrl');
            await pm.sendRequest({
                url: base + '/{{secret:vault/app#password}}',
                method: 'GET',
                headers: { 'X-Api-Key': '{{secret:vault/app#client_secret | upper}}' }
            });
        `);

        expect(captured).toHaveLength(1);
        expect(captured[0].url).toBe('https://api.example.test/s3cret');
        expect(captured[0].headers['X-Api-Key']).toBe('CLIENT-SECRET-VALUE');
    });
});
