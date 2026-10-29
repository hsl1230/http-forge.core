import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AwsSecretResolver } from '../infrastructure/secrets/aws-secret-resolver';
import { AzureKeyVaultResolver } from '../infrastructure/secrets/azure-keyvault-resolver';
import { DopplerResolver } from '../infrastructure/secrets/doppler-resolver';
import { GcpSecretResolver } from '../infrastructure/secrets/gcp-secret-resolver';
import { OnePasswordResolver } from '../infrastructure/secrets/onepassword-resolver';

function moduleNotFound(): Error {
    return Object.assign(new Error('module not found'), { code: 'MODULE_NOT_FOUND' });
}

describe('AWS secret resolver', () => {
    it('uses the injected SDK loader, returns JSON fields, and reuses the client', async () => {
        let clients = 0;
        let sends = 0;
        const inputs: any[] = [];
        let clientOptions: any;

        class SecretsManagerClient {
            constructor(public options: any) {
                clients += 1;
                clientOptions = options;
            }
            async send(command: any) {
                sends += 1;
                inputs.push(command.input);
                return { SecretString: JSON.stringify({ db_password: 'aws-secret' }) };
            }
        }
        class GetSecretValueCommand {
            constructor(public input: any) {}
        }

        const resolver = new AwsSecretResolver(
            { provider: 'aws', region: 'us-east-1' },
            name => {
                expect(name).toBe('@aws-sdk/client-secrets-manager');
                return { SecretsManagerClient, GetSecretValueCommand };
            },
        );

        expect(await resolver.resolve('myapp/prod#db_password')).toBe('aws-secret');
        expect(await resolver.resolve('myapp/raw')).toBe('{"db_password":"aws-secret"}');
        expect(clients).toBe(1);
        expect(sends).toBe(2);
        expect(inputs[0]).toEqual({ SecretId: 'myapp/prod' });
        expect(clientOptions).toMatchObject({ region: 'us-east-1' });
    });

    it('passes a configured profile to the SDK client', async () => {
        let clientOptions: any;

        class SecretsManagerClient {
            constructor(options: any) {
                clientOptions = options;
            }
            async send() {
                return { SecretString: 'aws-secret' };
            }
        }
        class GetSecretValueCommand {
            constructor(public input: any) {}
        }

        const resolver = new AwsSecretResolver(
            { provider: 'aws', profile: 'my-sso-profile' },
            () => ({ SecretsManagerClient, GetSecretValueCommand }),
        );

        await expect(resolver.resolve('myapp/prod')).resolves.toBe('aws-secret');
        expect(clientOptions).toMatchObject({ profile: 'my-sso-profile' });
    });

    it('reports the install command when the optional SDK is missing', async () => {
        const resolver = new AwsSecretResolver(
            { provider: 'aws' },
            () => {
                throw moduleNotFound();
            },
        );

        await expect(resolver.resolve('myapp/prod')).rejects.toThrow(
            /@aws-sdk\/client-secrets-manager/,
        );
    });
});

describe('Azure Key Vault resolver', () => {
    afterEach(() => {
        delete process.env['AZURE_KEYVAULT_URL'];
    });

    it('falls back to the env URL for an empty configured URL and reuses the client', async () => {
        process.env['AZURE_KEYVAULT_URL'] = 'https://env-vault.vault.azure.net';
        let clients = 0;
        const calls: any[] = [];

        class SecretClient {
            constructor(public url: string, public credential: any) {
                clients += 1;
            }
            async getSecret(name: string, options: any) {
                calls.push({ name, options });
                return { value: 'azure-secret' };
            }
        }
        class DefaultAzureCredential {}

        const resolver = new AzureKeyVaultResolver(
            { provider: 'azure', vaultUrl: '' },
            name => {
                if (name === '@azure/keyvault-secrets') return { SecretClient };
                return { DefaultAzureCredential };
            },
        );

        expect(await resolver.resolve('api-key')).toBe('azure-secret');
        expect(await resolver.resolve('api-key/7')).toBe('azure-secret');
        expect(clients).toBe(1);
        expect(calls).toEqual([
            { name: 'api-key', options: {} },
            { name: 'api-key', options: { version: '7' } },
        ]);
    });

    it('rejects when no URL is configured or available in the environment', async () => {
        delete process.env['AZURE_KEYVAULT_URL'];
        const resolver = new AzureKeyVaultResolver({ provider: 'azure', vaultUrl: '' });

        await expect(resolver.resolve('api-key')).rejects.toThrow(/no vault URL configured/);
    });
});

describe('GCP secret resolver', () => {
    afterEach(() => {
        delete process.env['GOOGLE_CLOUD_PROJECT'];
        delete process.env['GCLOUD_PROJECT'];
        delete process.env['GCP_PROJECT'];
    });

    it('falls back to the env project, validates versions, and reuses the client', async () => {
        process.env['GOOGLE_CLOUD_PROJECT'] = 'env-project';
        let clients = 0;
        const names: string[] = [];

        class SecretManagerServiceClient {
            constructor() {
                clients += 1;
            }
            async accessSecretVersion(request: any) {
                names.push(request.name);
                return [{ payload: { data: Buffer.from('gcp-secret', 'utf-8') } }];
            }
        }

        const resolver = new GcpSecretResolver(
            { provider: 'gcp', projectId: '' },
            name => {
                expect(name).toBe('@google-cloud/secret-manager');
                return { SecretManagerServiceClient };
            },
        );

        expect(await resolver.resolve('api-key')).toBe('gcp-secret');
        expect(await resolver.resolve('api-key/versions/3')).toBe('gcp-secret');
        expect(clients).toBe(1);
        expect(names).toEqual([
            'projects/env-project/secrets/api-key/versions/latest',
            'projects/env-project/secrets/api-key/versions/3',
        ]);
    });

    it.each(['api-key/3', 'api-key/versions/', 'api-key/versions/1/extra'])(
        'rejects malformed path %s instead of silently requesting latest',
        async (path) => {
            const resolver = new GcpSecretResolver(
                { provider: 'gcp', projectId: 'project' },
                () => ({ SecretManagerServiceClient: class {} }),
            );

            await expect(resolver.resolve(path)).rejects.toThrow(/must be/);
        },
    );

    it('reports the missing project id', async () => {
        delete process.env['GOOGLE_CLOUD_PROJECT'];
        delete process.env['GCLOUD_PROJECT'];
        delete process.env['GCP_PROJECT'];
        const resolver = new GcpSecretResolver({ provider: 'gcp', projectId: '' });

        await expect(resolver.resolve('api-key')).rejects.toThrow(/no projectId configured/);
    });
});

describe('Doppler secret resolver', () => {
    afterEach(() => {
        delete process.env['DOPPLER_TOKEN'];
    });

    function fakeRequest(response: {
        statusCode?: number;
        body?: string;
        streamError?: Error;
    }) {
        const calls: Array<{ url: string; options: any }> = [];
        const requestFn = (url: string, options: any, callback: (res: any) => void) => {
            calls.push({ url, options });
            const req = new EventEmitter() as any;
            req.destroy = (error: Error) => req.emit('error', error);
            req.end = () => {
                const res = new EventEmitter() as any;
                res.statusCode = response.statusCode ?? 200;
                callback(res);
                queueMicrotask(() => {
                    if (response.streamError) {
                        res.emit('error', response.streamError);
                        return;
                    }
                    res.emit('data', Buffer.from(response.body ?? '', 'utf-8'));
                    res.emit('end');
                });
            };
            return req;
        };
        return { requestFn: requestFn as any, calls };
    }

    it('uses the env token for an empty configured token and calls the Doppler API', async () => {
        process.env['DOPPLER_TOKEN'] = 'env-token';
        const fake = fakeRequest({
            body: JSON.stringify({ value: { computed: 'doppler-secret' } }),
        });
        const resolver = new DopplerResolver({ provider: 'doppler', serviceToken: '' }, fake.requestFn);

        expect(await resolver.resolve('api_key')).toBe('doppler-secret');
        expect(fake.calls[0].url).toBe(
            'https://api.doppler.com/v3/configs/config/secret?name=API_KEY',
        );
        expect(fake.calls[0].options.headers.Authorization).toBe('Bearer env-token');
        expect(fake.calls[0].options.timeout).toBe(10000);
    });

    it('returns undefined for a missing secret and rejects other HTTP failures', async () => {
        process.env['DOPPLER_TOKEN'] = 'token';

        const missing = new DopplerResolver(
            { provider: 'doppler' },
            fakeRequest({ statusCode: 404, body: '{}' }).requestFn,
        );
        expect(await missing.resolve('missing')).toBeUndefined();

        const failing = new DopplerResolver(
            { provider: 'doppler' },
            fakeRequest({ statusCode: 500, body: 'boom' }).requestFn,
        );
        await expect(failing.resolve('broken')).rejects.toThrow(/returned 500/);
    });

    it('propagates response stream errors', async () => {
        process.env['DOPPLER_TOKEN'] = 'token';
        const resolver = new DopplerResolver(
            { provider: 'doppler' },
            fakeRequest({ streamError: new Error('stream failed') }).requestFn,
        );

        await expect(resolver.resolve('api_key')).rejects.toThrow('stream failed');
    });

    it('rejects when no token is configured', async () => {
        delete process.env['DOPPLER_TOKEN'];
        const resolver = new DopplerResolver({ provider: 'doppler' });

        await expect(resolver.resolve('api_key')).rejects.toThrow(/no service token found/);
    });
});

describe('1Password resolver', () => {
    afterEach(() => {
        delete process.env['OP_SERVICE_ACCOUNT_TOKEN'];
        delete process.env['OP_ACCOUNT'];
    });

    it('uses the injected SDK loader and reuses the SDK client', async () => {
        process.env['OP_SERVICE_ACCOUNT_TOKEN'] = 'service-token';
        let clients = 0;
        const refs: string[] = [];
        const moduleRequire = vi.fn((name: string) => {
            expect(name).toBe('@1password/sdk');
            return {
                createClient: async (options: any) => {
                    clients += 1;
                    expect(options.auth).toBe('service-token');
                    return {
                        secrets: {
                            async resolve(ref: string) {
                                refs.push(ref);
                                return 'sdk-secret';
                            },
                        },
                    };
                },
            };
        });

        const resolver = new OnePasswordResolver(
            { provider: '1password' },
            moduleRequire,
        );

        expect(await resolver.resolve('MyVault/MyItem/password')).toBe('sdk-secret');
        expect(await resolver.resolve('MyVault/MyItem/username')).toBe('sdk-secret');
        expect(clients).toBe(1);
        expect(moduleRequire).toHaveBeenCalledTimes(1);
        expect(refs).toEqual([
            'op://MyVault/MyItem/password',
            'op://MyVault/MyItem/username',
        ]);
    });

    it('falls back to the CLI when the SDK is not installed', async () => {
        delete process.env['OP_SERVICE_ACCOUNT_TOKEN'];
        const calls: any[] = [];
        const execFileFn = vi.fn(async (file: string, args: string[], options: any) => {
            calls.push({ file, args, options });
            return { stdout: '  cli-secret  \n' };
        });

        const resolver = new OnePasswordResolver(
            { provider: '1password', vault: 'Private' },
            () => {
                throw moduleNotFound();
            },
            execFileFn as any,
        );

        expect(await resolver.resolve('MyItem/password')).toBe('  cli-secret  ');
        expect(calls[0].file).toBe('op');
        expect(calls[0].args).toEqual(['read', 'op://Private/MyItem/password']);
    });

    it('maps only recognized CLI not-found output to undefined', async () => {
        delete process.env['OP_SERVICE_ACCOUNT_TOKEN'];
        const resolver = new OnePasswordResolver(
            { provider: '1password' },
            () => {
                throw moduleNotFound();
            },
            (async () => {
                throw Object.assign(new Error('exit 1'), {
                    code: 1,
                    stderr: '"Missing" isn\'t an item in the "Private" vault.',
                });
            }) as any,
        );

        expect(await resolver.resolve('Private/Missing/password')).toBeUndefined();
    });

    it('does not treat CLI auth failures as a missing secret', async () => {
        delete process.env['OP_SERVICE_ACCOUNT_TOKEN'];
        const resolver = new OnePasswordResolver(
            { provider: '1password' },
            () => {
                throw moduleNotFound();
            },
            (async () => {
                throw Object.assign(new Error('exit 1'), {
                    code: 1,
                    stderr: '[ERROR] not signed in. Run `op signin` first.',
                });
            }) as any,
        );

        await expect(resolver.resolve('Private/Item/password')).rejects.toThrow(
            /not authenticated/,
        );
    });

    it('uses DesktopAuth for a configured personal account when no service token is set', async () => {
        delete process.env['OP_SERVICE_ACCOUNT_TOKEN'];
        let auth: any;

        class DesktopAuth {
            constructor(readonly accountName: string) {}
        }

        const resolver = new OnePasswordResolver(
            { provider: '1password', account: 'personal' },
            () => ({
                DesktopAuth,
                createClient: async (options: any) => {
                    auth = options.auth;
                    return {
                        secrets: {
                            async resolve() {
                                return 'desktop-secret';
                            },
                        },
                    };
                },
            }),
        );

        expect(await resolver.resolve('MyVault/MyItem/password')).toBe('desktop-secret');
        expect(auth).toBeInstanceOf(DesktopAuth);
        expect(auth.accountName).toBe('personal');
    });

    it('prefers a service-account token over a configured desktop account', async () => {
        process.env['OP_SERVICE_ACCOUNT_TOKEN'] = 'service-token';
        let auth: any;

        class DesktopAuth {
            constructor(readonly accountName: string) {}
        }

        const resolver = new OnePasswordResolver(
            { provider: '1password', account: 'personal' },
            () => ({
                DesktopAuth,
                createClient: async (options: any) => {
                    auth = options.auth;
                    return { secrets: { resolve: async () => 'sdk-secret' } };
                },
            }),
        );

        expect(await resolver.resolve('MyVault/MyItem/password')).toBe('sdk-secret');
        expect(auth).toBe('service-token');
    });

    it('passes a configured account to the CLI when the SDK is not installed', async () => {
        delete process.env['OP_SERVICE_ACCOUNT_TOKEN'];
        const calls: any[] = [];

        const resolver = new OnePasswordResolver(
            { provider: '1password', vault: 'Private', account: 'personal' },
            () => {
                throw moduleNotFound();
            },
            (async (file: string, args: string[], options: any) => {
                calls.push({ file, args, options });
                return { stdout: 'cli-secret\n' };
            }) as any,
        );

        expect(await resolver.resolve('MyItem/password')).toBe('cli-secret');
        expect(calls[0].options.env.OP_ACCOUNT).toBe('personal');
    });

    it('does not combine OP_ACCOUNT with a service-account token for the CLI', async () => {
        process.env['OP_SERVICE_ACCOUNT_TOKEN'] = 'service-token';
        process.env['OP_ACCOUNT'] = 'personal';
        const calls: any[] = [];

        const resolver = new OnePasswordResolver(
            { provider: '1password', vault: 'Private' },
            () => {
                throw moduleNotFound();
            },
            (async (file: string, args: string[], options: any) => {
                calls.push({ file, args, options });
                return { stdout: 'cli-secret\n' };
            }) as any,
        );

        expect(await resolver.resolve('MyItem/password')).toBe('cli-secret');
        expect(calls[0].options.env.OP_ACCOUNT).toBeUndefined();
        expect(calls[0].options.env.OP_SERVICE_ACCOUNT_TOKEN).toBe('service-token');
    });

    it('reports a clear error when the SDK predates DesktopAuth', async () => {
        delete process.env['OP_SERVICE_ACCOUNT_TOKEN'];

        const resolver = new OnePasswordResolver(
            { provider: '1password', account: 'personal' },
            () => ({
                createClient: async () => ({
                    secrets: { resolve: async () => 'unused' },
                }),
            }),
        );

        await expect(resolver.resolve('MyVault/MyItem/password')).rejects.toThrow(
            /DesktopAuth requires @1password\/sdk 0\.5\.0/,
        );
    });
});
