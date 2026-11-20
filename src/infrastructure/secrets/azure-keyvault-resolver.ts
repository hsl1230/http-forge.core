/**
 * Azure Key Vault resolver
 *
 * Uses DefaultAzureCredential — no credentials stored in HTTP Forge config.
 * Order: env vars (AZURE_*) → managed identity → Azure CLI login → VS Code login
 *
 * Token syntax: {{secret:azure/<secretName>}}
 * e.g.          {{secret:azure/my-api-key}}
 *               {{secret:azure/my-api-key/1.0}}  (specific version)
 *
 * Config requires vaultUrl, e.g. "https://myvault.vault.azure.net"
 */

import type { AzureKeyVaultConfig } from '../../types/secret-resolver';
import { BaseSecretResolver } from './base-secret-resolver';

export class AzureKeyVaultResolver extends BaseSecretResolver {
    readonly providerName = 'azure';

    private readonly vaultUrl: string;
    private readonly moduleRequire: (name: string) => any;
    private client?: any;

    constructor(config: AzureKeyVaultConfig, moduleRequire?: (name: string) => any) {
        super({ cacheTtlMs: (config as any)?.cacheTtlMs });
        // Treat empty string (zero-config default) as "fall back to env var"
        const url = (config.vaultUrl || process.env['AZURE_KEYVAULT_URL']) ?? '';
        this.vaultUrl = url.replace(/\/$/, '');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        this.moduleRequire = moduleRequire ?? ((name: string) => require(name));
    }

    protected async fetchRaw(secretName: string, _jsonPath?: string): Promise<string | undefined> {
        if (!this.vaultUrl) {
            throw new Error(
                '[HTTP Forge] Azure Key Vault resolver: no vault URL configured. ' +
                'Set secrets.providers.<alias>.vaultUrl or the AZURE_KEYVAULT_URL env var.'
            );
        }
        // secretName may be "name" or "name/version"
        const parts = secretName.split('/');
        const name = parts[0];
        const version = parts[1]; // undefined → latest

        try {
            // Dynamic require so SDKs are optional at compile time
            if (!this.client) {
                const { SecretClient } = this.moduleRequire('@azure/keyvault-secrets');
                const { DefaultAzureCredential } = this.moduleRequire('@azure/identity');
                this.client = new SecretClient(this.vaultUrl, new DefaultAzureCredential());
            }
            const secret = await this.client.getSecret(name, version ? { version } : {});
            return secret.value;
        } catch (err: any) {
            if (err?.name === 'MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') {
                throw new Error(
                    '[HTTP Forge] Azure Key Vault resolver requires @azure/keyvault-secrets and @azure/identity. ' +
                    'Install them: npm install @azure/keyvault-secrets @azure/identity'
                );
            }
            throw err;
        }
    }
}
