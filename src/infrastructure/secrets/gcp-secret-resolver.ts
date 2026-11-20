/**
 * Google Cloud Secret Manager resolver
 *
 * Uses Application Default Credentials — no credentials stored in HTTP Forge config.
 * Order: GOOGLE_APPLICATION_CREDENTIALS env var → gcloud CLI login → Workload Identity (GKE)
 *        → Metadata server (Cloud Run, Compute Engine)
 *
 * Token syntax: {{secret:gcp/<secretName>}}
 *               {{secret:gcp/<secretName>/versions/<version>}}  (specific version, default: latest)
 *
 * Config: { "provider": "gcp", "projectId": "my-project" }
 * projectId falls back to GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT env vars.
 */

import type { GcpSecretsConfig } from '../../types/secret-resolver';
import { BaseSecretResolver } from './base-secret-resolver';

export class GcpSecretResolver extends BaseSecretResolver {
    readonly providerName = 'gcp';

    private readonly projectId: string | undefined;
    private readonly moduleRequire: (name: string) => any;
    private client?: any;

    constructor(config: GcpSecretsConfig, moduleRequire?: (name: string) => any) {
        super({ cacheTtlMs: (config as any)?.cacheTtlMs });
        this.projectId =
            config.projectId ||
            process.env['GOOGLE_CLOUD_PROJECT'] ||
            process.env['GCLOUD_PROJECT'] ||
            process.env['GCP_PROJECT'];
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        this.moduleRequire = moduleRequire ?? ((name: string) => require(name));
    }

    protected async fetchRaw(secretName: string, _jsonPath?: string): Promise<string | undefined> {
        // secretName may be "name" or "name/versions/version"
        const parts = secretName.split('/');
        const name = parts[0];
        const version =
            parts.length === 1
                ? 'latest'
                : parts.length === 3 && parts[1] === 'versions' && parts[2]
                    ? parts[2]
                    : undefined;

        if (!name || version === undefined) {
            throw new Error(
                `[HTTP Forge] GCP secret path "${secretName}" must be ` +
                '"<secretName>" or "<secretName>/versions/<version>".'
            );
        }
        const secretNameFinal = name;

        if (!this.projectId) {
            throw new Error(
                '[HTTP Forge] GCP secret resolver: no projectId configured and ' +
                'GOOGLE_CLOUD_PROJECT env var is not set.'
            );
        }

        try {
            if (!this.client) {
                const { SecretManagerServiceClient } = this.moduleRequire('@google-cloud/secret-manager');
                this.client = new SecretManagerServiceClient();
            }
            const name = `projects/${this.projectId}/secrets/${secretNameFinal}/versions/${version}`;
            const [response] = await this.client.accessSecretVersion({ name });
            const payload = response.payload?.data;
            if (!payload) return undefined;
            return Buffer.isBuffer(payload)
                ? payload.toString('utf-8')
                : Buffer.from(payload as Uint8Array).toString('utf-8');
        } catch (err: any) {
            if (err?.name === 'MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') {
                throw new Error(
                    '[HTTP Forge] GCP secret resolver requires @google-cloud/secret-manager. ' +
                    'Install it: npm install @google-cloud/secret-manager'
                );
            }
            throw err;
        }
    }
}
