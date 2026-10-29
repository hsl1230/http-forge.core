/**
 * AWS Secrets Manager resolver
 *
 * Uses the AWS SDK v3 credential chain — no credentials are stored in HTTP Forge config.
 * A configured profile selects ~/.aws/credentials or ~/.aws/config (including SSO)
 * without requiring AWS_PROFILE in the extension host environment.
 * Order: configured profile → env vars → ~/.aws/credentials → IAM instance role → ECS task role
 *
 * Token syntax: {{secret:aws/<secretId>}}
 * e.g.          {{secret:aws/myapp/prod/db-password}}
 *               {{secret:aws/myapp/prod/api-key#field}}  (JSON secret field)
 */

import type { AwsSecretsConfig, ISecretResolver } from '../../types/secret-resolver';

export class AwsSecretResolver implements ISecretResolver {
    readonly providerName = 'aws';

    private readonly region: string | undefined;
    private readonly profile: string | undefined;
    private readonly moduleRequire: (name: string) => any;
    private sdk?: { client: any; GetSecretValueCommand: any };

    constructor(config: AwsSecretsConfig, moduleRequire?: (name: string) => any) {
        this.region = config.region ?? process.env['AWS_DEFAULT_REGION'] ?? process.env['AWS_REGION'];
        this.profile = config.profile || undefined;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        this.moduleRequire = moduleRequire ?? ((name: string) => require(name));
    }

    async resolve(path: string): Promise<string | undefined> {
        // path may be "secretId" or "secretId#<jsonFieldName>"
        const hashIdx = path.lastIndexOf('#');
        const secretId = hashIdx >= 0 ? path.slice(0, hashIdx) : path;
        const jsonField = hashIdx >= 0 ? path.slice(hashIdx + 1) : undefined;

        try {
            // Dynamic require so the SDK is optional at compile time
            if (!this.sdk) {
                const { SecretsManagerClient, GetSecretValueCommand } = this.moduleRequire('@aws-sdk/client-secrets-manager');
                this.sdk = {
                    client: new SecretsManagerClient({ region: this.region, profile: this.profile }),
                    GetSecretValueCommand,
                };
            }
            const response = await this.sdk.client.send(
                new this.sdk.GetSecretValueCommand({ SecretId: secretId })
            );

            const raw: string | undefined = response.SecretString ?? (
                response.SecretBinary
                    ? Buffer.from(response.SecretBinary as Uint8Array).toString('utf-8')
                    : undefined
            );

            if (raw === undefined) return undefined;

            if (jsonField) {
                try {
                    const parsed = JSON.parse(raw);
                    return parsed[jsonField] !== undefined ? String(parsed[jsonField]) : undefined;
                } catch {
                    return undefined;
                }
            }

            return raw;
        } catch (err: any) {
            if (err?.name === 'MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') {
                throw new Error(
                    '[HTTP Forge] AWS secret resolver requires @aws-sdk/client-secrets-manager. ' +
                    'Install it in your project: npm install @aws-sdk/client-secrets-manager'
                );
            }
            throw err;
        }
    }
}
