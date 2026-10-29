/**
 * Cloud Secret Resolver — Phase 3
 *
 * Defines the ISecretResolver abstraction and the per-provider configuration
 * types used in http-forge.config.json under the `secrets` key.
 *
 * Token syntax resolved by this interface: {{secret:provider/path}}
 *   e.g.  {{secret:aws/myapp/prod/db-password}}
 *         {{secret:azure/my-api-key}}
 *         {{secret:vault/myapp/prod#password}}
 *         {{secret:op/MyVault/MyItem/password}}
 *
 * Credentials are NEVER stored in HTTP Forge config.
 * Each provider uses its SDK's default credential chain:
 *   - AWS   → SDK credential chain (env vars / ~/.aws / IAM role)
 *   - Azure → DefaultAzureCredential (env / managed identity / CLI login)
 *   - Vault → VAULT_TOKEN / VAULT_ADDR env vars
 *   - 1Password → OP_SERVICE_ACCOUNT_TOKEN env var, configured desktop account,
 *                 or the signed-in `op` CLI session
 */

// ============================================================
// Core interface
// ============================================================

export interface ISecretResolver {
    /**
     * Resolve a secret by its provider-relative path.
     * @param path  The path after the provider prefix, e.g. "myapp/prod/apiKey"
     * @returns     The plaintext secret value, or undefined if not found
     */
    resolve(path: string): Promise<string | undefined>;

    /**
     * Human-readable provider name, e.g. "aws", "azure", "vault", "1password"
     */
    readonly providerName: string;
}

// ============================================================
// Provider configuration types (stored in http-forge.config.json)
// ============================================================

export interface AwsSecretsConfig {
    provider: 'aws';
    /** AWS region, e.g. "us-east-1". Falls back to AWS_DEFAULT_REGION env var. */
    region?: string;
    /** AWS shared-config profile, e.g. "my-sso-profile". Falls back to AWS_PROFILE when omitted. */
    profile?: string;
}

export interface AzureKeyVaultConfig {
    provider: 'azure';
    /**
     * Key Vault URL, e.g. "https://myvault.vault.azure.net"
     * The path portion of the token is used as the secret name.
     */
    vaultUrl: string;
}

export interface HashiCorpVaultConfig {
    provider: 'vault';
    /**
     * Vault server address, e.g. "https://vault.example.com:8200"
     * Falls back to VAULT_ADDR env var.
     */
    address?: string;
    /** Mount path prefix, e.g. "secret". Defaults to "secret". */
    mountPath?: string;
    /**
     * Vault namespace (Enterprise / HCP Vault), e.g. "admin" or "admin/team-a".
     * Sent as the X-Vault-Namespace header. Falls back to VAULT_NAMESPACE env var.
     */
    namespace?: string;
}

export interface OnePasswordConfig {
    provider: '1password';
    /**
     * Vault name to search, e.g. "MyVault".
     * If omitted, the path is expected to include vault/item/field.
     */
    vault?: string;
    /**
     * 1Password desktop-app account name (or account UUID) for personal-account auth.
     * When OP_SERVICE_ACCOUNT_TOKEN is not set, the SDK uses DesktopAuth(account).
     * Requires the 1Password desktop app and @1password/sdk 0.5.0 or newer.
     * When the SDK package is unavailable, the same value is passed to the CLI as
     * OP_ACCOUNT. If omitted, HTTP Forge uses the signed-in `op` CLI session.
     */
    account?: string;
}

export interface GcpSecretsConfig {
    provider: 'gcp';
    /**
     * GCP project ID, e.g. "my-project-123".
     * Falls back to GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT env vars.
     */
    projectId?: string;
}

export interface DopplerConfig {
    provider: 'doppler';
    /**
     * Doppler service token. Falls back to DOPPLER_TOKEN env var.
     * The project/config are baked into the service token itself.
     */
    serviceToken?: string;
}

export interface CustomSecretProviderConfig {
    provider: 'custom';
    /**
     * Module path or package name resolved from the first `scripts.modulePaths`
     * entry that contains a package.json. Relative paths are resolved from that
     * module directory.
     */
    module: string;
    /** Non-sensitive options passed to the module's resolver factory. */
    options?: Record<string, unknown>;
}

export interface CustomSecretProviderContext {
    /** Alias used in `{{secret:<alias>/<path>}}`. */
    alias: string;
    /** The provider's `options` config, or an empty object. */
    options: Record<string, unknown>;
}

export interface CustomSecretResolver {
    /** Human-readable provider name; falls back to the configured alias. */
    providerName?: string;
    /** Resolve a secret path; return undefined when it does not exist. */
    resolve(path: string): Promise<string | undefined>;
}

export type CustomSecretResolverFactory =
    (context: CustomSecretProviderContext) => CustomSecretResolver;

export type SecretProviderConfig =
    | AwsSecretsConfig
    | AzureKeyVaultConfig
    | HashiCorpVaultConfig
    | OnePasswordConfig
    | GcpSecretsConfig
    | DopplerConfig
    | CustomSecretProviderConfig;

/**
 * Top-level `secrets` block in http-forge.config.json
 */
export interface SecretsConfig {
    /**
     * Named provider configs. Keys are provider aliases used in the token:
     * {{secret:<alias>/<path>}}
     *
     * Example:
     * ```json
     * {
     *   "secrets": {
     *     "providers": {
     *       "aws":    { "provider": "aws", "region": "us-east-1" },
     *       "vault":  { "provider": "vault", "address": "https://vault.example.com" }
     *     }
     *   }
     * }
     * ```
     */
    providers: Record<string, SecretProviderConfig>;
}
