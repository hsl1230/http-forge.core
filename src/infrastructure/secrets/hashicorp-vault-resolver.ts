/**
 * HashiCorp Vault resolver
 *
 * Credentials are NEVER stored in HTTP Forge config.
 * Settings:
 *   config.address  server address, falling back to VAULT_ADDR
 *   config.namespace Enterprise/HCP namespace, falling back to VAULT_NAMESPACE
 *   VAULT_TOKEN     env var (token auth, always required)
 *
 * Token syntax: {{secret:vault/<mountPath>/<secretPath>#<field>}}
 * e.g.          {{secret:vault/secret/myapp/prod#db_password}}
 *               {{secret:vault/kv/myapp/config#api_key}}
 *
 * The path format after the provider prefix: <mount>/<path>#<field>
 * If no field is specified and the secret has a single key "value", that is returned.
 */

import type { HashiCorpVaultConfig } from '../../types/secret-resolver';
import { BaseSecretResolver } from './base-secret-resolver';

const REQUEST_TIMEOUT_MS = 10000;

function encodePath(value: string): string {
    return value.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

export class HashiCorpVaultResolver extends BaseSecretResolver {
    readonly providerName = 'vault';

    private readonly address: string;
    private readonly mountPath: string;
    private readonly namespace: string | undefined;

    constructor(config: HashiCorpVaultConfig) {
        super({ cacheTtlMs: (config as any)?.cacheTtlMs });
        this.address = (config.address || process.env['VAULT_ADDR'] || 'http://127.0.0.1:8200').replace(/\/$/, '');
        this.mountPath = config.mountPath || 'secret';
        this.namespace = config.namespace || process.env['VAULT_NAMESPACE'];
    }

    protected async fetchRaw(secretPath: string, jsonPath?: string): Promise<string | undefined> {
        // path format: "<secretPath>#<field>" or just "<secretPath>"


        // Legacy #field handling (when base class didn't split on #)
        const hashIdx = secretPath.lastIndexOf('#');
        let path = secretPath;
        let field: string | undefined;
        if (hashIdx >= 0) {
            path = secretPath.slice(0, hashIdx);
            field = secretPath.slice(hashIdx + 1);
        }

        const token = process.env['VAULT_TOKEN'];
        if (!token) {
            throw new Error(
                '[HTTP Forge] HashiCorp Vault resolver requires VAULT_TOKEN environment variable to be set.'
            );
        }

        // Use KV v2 API: /v1/<mount>/data/<path>. Encode each segment so
        // spaces/#/? in secret paths cannot change the request structure.
        const url = `${this.address}/v1/${encodePath(this.mountPath)}/data/${encodePath(path)}`;

        const headers: Record<string, string> = { 'X-Vault-Token': token };
        if (this.namespace) {
            headers['X-Vault-Namespace'] = this.namespace;
        }

        let response: Response;
        try {
            response = await fetch(url, {
                headers,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (err: any) {
            const reason = err?.name === 'TimeoutError'
                ? `request timed out after ${REQUEST_TIMEOUT_MS}ms`
                : err?.message ?? err;
            throw new Error(`[HTTP Forge] Vault request failed: ${reason}`);
        }

        if (response.status === 404) return undefined;

        if (!response.ok) {
            throw new Error(`[HTTP Forge] Vault returned HTTP ${response.status} for path: ${path}`);
        }

        const body = await response.json() as any;
        const data: Record<string, string> | undefined = body?.data?.data;

        if (!data) return undefined;

        if (!data) return undefined;

        // If a specific field was requested via #field (legacy), return it directly.
        if (field) {
            return data[field] !== undefined ? String(data[field]) : undefined;
        }

        // If a JSON path was requested (.path), return the raw JSON so the
        // base class can traverse it.
        if (jsonPath) {
            return JSON.stringify(data);
        }

        // No path: backward compat — return "value" key if present, else first key.
        if ('value' in data) return String(data['value']);
        const keys = Object.keys(data);
        return keys.length === 1 ? String(data[keys[0]]) : JSON.stringify(data);
    }
}
