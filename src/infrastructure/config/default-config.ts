/**
 * HTTP Forge Default Configuration
 */

import { HttpForgeConfig } from './config.interface';

/**
 * Default configuration values
 * Used when http-forge.config.json doesn't exist or has missing fields
 */
export const DEFAULT_CONFIG: HttpForgeConfig = {
    version: '1.0',

    storage: {
        format: 'folder',
        root: './.http-forge/assets',
        history: './.http-forge/.cache/histories',
        results: './.http-forge/.cache/results'
    },

    request: {
        timeout: 30000,
        followRedirects: true,
        maxRedirects: 10,
        strictSSL: true,
        tls: {},
        certificates: []
    },

    scripts: {
        modulePaths: ['./.http-forge/assets/src', './.http-forge/assets/lib'],
        scope: 'shared',
        timeout: 5000
    },

    runner: {
        resultsRetentionDays: 7,
        indexPageSize: 1000,
        recentErrorsLimit: 20,
        report: {
            maxBodyChars: 100000,
            embedBodies: 'failed'
        }
    },

    environments: {
        default: 'dev'
    },

    restClientExport: {
        path: 'collections-rest-client',
        mergeGlobals: true
    },

    discovery: {
        customSeedLoaderModulePath: undefined,
        frameworks: ['auto'],
        contextProperties: ['locals'],
        skipComponentAnalysis: false
    },

    mcp: {
        port: 3100,
        excludedCollections: [],
        excludedSuites: [],
        toolPrefix: '',
        maxRequestsPerCall: 500,
        toolMode: 'auto',
        drilldownThreshold: 100,
        toolPageSize: 200,
        cors: {
            allowedOrigins: ['http://localhost', 'http://127.0.0.1']
        }
    },

    proxy: null,

    // Zero-config cloud secret providers. Each provider is pre-registered under
    // its own name as the alias, so users can write {{secret:aws/...}},
    // {{secret:gcp/...}}, etc. without any configuration. Providers read their
    // settings from ambient credentials / environment variables:
    //   aws      → AWS_REGION + SDK credential chain
    //   azure    → AZURE_KEYVAULT_URL + DefaultAzureCredential
    //   gcp      → GOOGLE_CLOUD_PROJECT + Application Default Credentials
    //   vault    → VAULT_ADDR + VAULT_TOKEN
    //   op       → op CLI session (1Password)
    //   doppler  → DOPPLER_TOKEN
    // Users can override any alias (or add more) via the `secrets` block in
    // http-forge.config.json.
    secrets: {
        providers: {
            aws: { provider: 'aws' },
            azure: { provider: 'azure', vaultUrl: '' },
            gcp: { provider: 'gcp' },
            vault: { provider: 'vault' },
            op: { provider: '1password' },
            doppler: { provider: 'doppler' }
        }
    }
};

/**
 * Configuration file names
 */
export const CONFIG_FILES = {
    /** Preferred main configuration file */
    preferred: '.http-forge/http-forge.config.json',
    /** Backward-compatible legacy configuration file */
    legacy: 'http-forge.config.json',
};

/**
 * Directory names within the root
 */
export const ROOT_DIRECTORIES = {
    /** Collections directory */
    collections: 'collections',
    /** Environments directory */
    environments: 'environments',
    /** Flows directory */
    flows: 'flows',
    /** Suites directory */
    suites: 'suites'
};
