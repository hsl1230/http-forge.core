/**
 * 1Password secret resolver
 *
 * Credentials are NEVER stored in HTTP Forge config.
 * Authentication priority:
 *   1. OP_SERVICE_ACCOUNT_TOKEN env var → SDK service-account auth (no app/CLI)
 *   2. `account` provider config         → SDK DesktopAuth (personal account,
 *                                          requires the desktop app + SDK 0.5+)
 *   3. `op` CLI signed-in session        → interactive personal account
 *
 * Token syntax: {{secret:1password/<vault>/<item>/<field>}}
 * e.g.          {{secret:1password/MyVault/MyApp/api_key}}
 *               {{secret:1password/Shared/prod-db/password}}
 *
 * If `vault` is specified in the provider config, the token path may omit it:
 *   {{secret:1password/<item>/<field>}}
 *
 * The SDK is used when either a service-account token or a desktop account is
 * configured; otherwise this falls back to the 1Password CLI (`op`). If the SDK
 * package is missing, the CLI is also used with the configured account.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ISecretResolver, OnePasswordConfig } from '../../types/secret-resolver';

const execFileAsync = promisify(execFile);

type ExecFileLike = (
    file: string,
    args: string[],
    options: Record<string, unknown>
) => Promise<{ stdout: string; stderr?: string }>;

const NOT_FOUND_PATTERN = /not found|isn't an item|is not an item|no item matched|could not find/i;
const AUTH_FAILURE_PATTERN = /not signed in|sign in|authentication|authorization|unauthorized/i;

export class OnePasswordResolver implements ISecretResolver {
    readonly providerName = '1password';

    private readonly defaultVault: string | undefined;
    private readonly account: string | undefined;
    private readonly moduleRequire: (name: string) => any;
    private readonly execFileFn: ExecFileLike;
    private sdkClientPromise?: Promise<any>;
    private sdkAuthKey?: string;

    constructor(
        config: OnePasswordConfig,
        moduleRequire?: (name: string) => any,
        execFileFn: ExecFileLike = execFileAsync as ExecFileLike
    ) {
        this.defaultVault = config.vault;
        this.account = config.account;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        this.moduleRequire = moduleRequire ?? ((name: string) => require(name));
        this.execFileFn = execFileFn;
    }

    async resolve(path: string): Promise<string | undefined> {
        // Path format (depending on whether config.vault is set):
        //   With default vault: "<item>/<field>"  → vault/item/field
        //   Without:            "<vault>/<item>/<field>"
        const parts = path.split('/');

        let vault: string;
        let item: string;
        let field: string;

        if (this.defaultVault) {
            if (parts.length < 2) {
                throw new Error(
                    `[HTTP Forge] 1Password path "${path}" must be "<item>/<field>" when vault is set in config.`
                );
            }
            vault = this.defaultVault;
            item = parts.slice(0, parts.length - 1).join('/');
            field = parts[parts.length - 1];
        } else {
            if (parts.length < 3) {
                throw new Error(
                    `[HTTP Forge] 1Password path "${path}" must be "<vault>/<item>/<field>".`
                );
            }
            vault = parts[0];
            item = parts.slice(1, parts.length - 1).join('/');
            field = parts[parts.length - 1];
        }

        // Try SDK first (1password/sdk — optional peer dep)
        const sdkResult = await this.tryResolveSdk(vault, item, field);
        if (sdkResult !== null) return sdkResult;

        // Fall back to op CLI
        return this.resolveViaCli(vault, item, field);
    }

    private async tryResolveSdk(vault: string, item: string, field: string): Promise<string | null | undefined> {
        // A service-account token wins over a configured desktop account so CI
        // stays deterministic even if a developer account is present in config.
        const token = process.env['OP_SERVICE_ACCOUNT_TOKEN'] || undefined;
        const account = token ? undefined : this.account;
        if (!token && !account) return null; // SDK has no credential source

        try {
            const client = await this.getSdkClient(token, account);
            const secretRef = `op://${vault}/${item}/${field}`;
            const value: string = await client.secrets.resolve(secretRef);
            return value;
        } catch (err: any) {
            if (err?.name === 'MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') {
                return null; // SDK not installed — fall through to CLI
            }
            throw new Error(`[HTTP Forge] 1Password SDK error for "${vault}/${item}/${field}": ${err?.message ?? err}`);
        }
    }

    private getSdkClient(token: string | undefined, account: string | undefined): Promise<any> {
        // Cache per credential; including it in the key makes a token rotation
        // or account switch create a fresh client.
        const authKey = token ? `t:${token}` : `a:${account}`;
        if (!this.sdkClientPromise || this.sdkAuthKey !== authKey) {
            this.sdkAuthKey = authKey;
            this.sdkClientPromise = (async () => {
                const sdk = this.moduleRequire('@1password/sdk');
                if (!token && typeof sdk.DesktopAuth !== 'function') {
                    throw new Error('[HTTP Forge] DesktopAuth requires @1password/sdk 0.5.0+.');
                }
                // account is defined whenever token is absent (see tryResolveSdk).
                const auth = token ?? new sdk.DesktopAuth(account);
                return sdk.createClient({
                    auth,
                    integrationName: 'HTTP Forge',
                    integrationVersion: '1.0.0',
                });
            })().catch(err => {
                this.sdkClientPromise = undefined;
                this.sdkAuthKey = undefined;
                throw err;
            });
        }
        return this.sdkClientPromise;
    }

    private async resolveViaCli(vault: string, item: string, field: string): Promise<string | undefined> {
        // The service-account token identifies its own account; combining it with
        // OP_ACCOUNT makes the CLI reject the invocation. Otherwise a configured
        // desktop account also selects the account for `op read`, which covers the
        // case where the SDK package is not installed.
        const env = { ...process.env };
        if (env['OP_SERVICE_ACCOUNT_TOKEN']) {
            delete env['OP_ACCOUNT'];
        } else if (this.account) {
            env['OP_ACCOUNT'] = this.account;
        }

        try {
            const { stdout } = await this.execFileFn('op', [
                'read',
                `op://${vault}/${item}/${field}`,
            ], {
                env,
                timeout: 10000,
            });

            // `op read` appends a newline; remove only that newline so a secret's
            // own leading/trailing whitespace is preserved.
            return stdout.replace(/\r?\n$/, '');
        } catch (err: any) {
            if (err?.code === 'ENOENT') {
                throw new Error(
                    '[HTTP Forge] 1Password needs @1password/sdk or the `op` CLI.\n' +
                    '  Service Account: set OP_SERVICE_ACCOUNT_TOKEN\n' +
                    '  Desktop account: set "account" (SDK 0.5.0+)\n' +
                    '  CLI: install 1Password CLI and run `op signin`'
                );
            }
            const stderr = String(err?.stderr ?? '');
            // `op` exits non-zero for both missing items and auth failures.
            // Only a recognized not-found message means the secret is absent.
            if (NOT_FOUND_PATTERN.test(stderr)) {
                return undefined;
            }
            if (AUTH_FAILURE_PATTERN.test(stderr)) {
                throw new Error(
                    '[HTTP Forge] 1Password CLI is not authenticated. Run `op signin` ' +
                    'or set OP_SERVICE_ACCOUNT_TOKEN and install @1password/sdk.'
                );
            }
            throw new Error(`[HTTP Forge] 1Password CLI error: ${err?.stderr || err?.message || err}`);
        }
    }
}
