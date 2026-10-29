/**
 * Secret Resolver Registry — Phase 3
 *
 * Builds and caches ISecretResolver instances from config, and provides
 * async pre-resolution of {{secret:provider/path}} tokens in template strings.
 *
 * Design:
 * - Registry is created once at startup from IConfigService
 * - resolveSecretTokens() is called BEFORE variable interpolation per-request
 * - Resolved values are injected as extraVariables so the sync VariableResolver
 *   picks them up transparently
 * - Results are cached within a single request lifetime to avoid redundant API calls
 */

import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import { parseFilterChain } from '../../utils/filter-engine';
import type {
    CustomSecretProviderConfig,
    ISecretResolver,
    SecretProviderConfig,
} from '../../types/secret-resolver';
import type { IConfigService } from '../config/config.interface';
import { AwsSecretResolver } from './aws-secret-resolver';
import { AzureKeyVaultResolver } from './azure-keyvault-resolver';
import { DopplerResolver } from './doppler-resolver';
import { GcpSecretResolver } from './gcp-secret-resolver';
import { HashiCorpVaultResolver } from './hashicorp-vault-resolver';
import { OnePasswordResolver } from './onepassword-resolver';

export class SecretResolverRegistry {
    private readonly resolvers: Map<string, ISecretResolver> = new Map();

    /**
     * Require function rooted at the user's project (via config `scripts.modulePaths`),
     * so optional cloud SDKs resolve from the same place users install custom script
     * modules — not from the extension's own bundle. Rebuilt when module paths change.
     */
    private moduleRequire: (name: string) => any;

    /**
     * Snapshot of the config blocks that determine the resolver set. A config
     * reload (including file-watcher reloads) changes this key, which triggers a
     * rebuild on the next resolution instead of leaving startup resolvers stale.
     */
    private configKey?: string;

    constructor(private readonly configService?: IConfigService) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        this.moduleRequire = (name: string) => require(name);
        this.refreshProviders();
    }

    /**
     * Scan a string (or recursively, any object) for {{secret:alias/path}} tokens
     * and resolve them all in parallel.
     *
     * Returns a flat map of  "secret:alias/path" → plaintext value
     * suitable for injection as extraVariables into VariableResolver.
     */
    async resolveSecretTokens(input: any, cache?: Map<string, string>): Promise<Record<string, string>> {
        this.refreshProviders();
        const requestCache = cache ?? new Map<string, string>();
        const tokens = new Set<string>();
        this.collectTokens(input, tokens);

        if (tokens.size === 0) return {};

        await Promise.all(
            Array.from(tokens).map(async (token) => {
                if (requestCache.has(token)) return;

                // token is e.g. "secret:aws/myapp/prod/apiKey"
                const rest = token.slice('secret:'.length); // "aws/myapp/prod/apiKey"
                const slashIdx = rest.indexOf('/');
                if (slashIdx < 0) {
                    console.warn(
                        `[HTTP Forge] {{${token}}} is malformed; expected {{secret:<alias>/<path>}}.`
                    );
                    return;
                }

                const alias = rest.slice(0, slashIdx);
                const path = rest.slice(slashIdx + 1);
                const resolver = this.resolvers.get(alias);
                if (!resolver) {
                    console.warn(
                        `[HTTP Forge] {{${token}}} could not be resolved: ` +
                        `no secret provider is configured for alias "${alias}".`
                    );
                    return;
                }

                try {
                    const value = await resolver.resolve(path);
                    if (value !== undefined) {
                        requestCache.set(token, value);
                    } else {
                        console.warn(
                            `[HTTP Forge] {{${token}}} could not be resolved: secret not found.`
                        );
                    }
                } catch (err: any) {
                    // Log a visible warning so the user knows why the token wasn't resolved
                    const reason = err?.message ?? String(err);
                    console.warn(`[HTTP Forge] {{${token}}} could not be resolved: ${reason}`);
                    // leave unresolved — token will remain in output
                }
            })
        );

        const result: Record<string, string> = {};
        for (const [k, v] of requestCache.entries()) {
            result[k] = v;
        }
        return result;
    }

    /** Whether any providers are configured */
    get hasProviders(): boolean {
        this.refreshProviders();
        return this.resolvers.size > 0;
    }

    // ----------------------------------------------------------------
    // Private helpers
    // ----------------------------------------------------------------

    /**
     * Rebuild the resolver set when the config snapshot changes.
     *
     * ConfigService.reload() swaps its in-memory config without notifying every
     * consumer; comparing the small `secrets` block here keeps the registry in
     * sync with file-watcher reloads while avoiding per-request rebuilds.
     */
    private refreshProviders(): void {
        if (!this.configService) return;

        let rawConfig: any;
        let modulePaths: string[] = [];
        try {
            rawConfig = (this.configService.getConfig() as any).secrets;
            modulePaths = this.configService.getModulePaths() ?? [];
        } catch {
            return;
        }

        const key = JSON.stringify({ secrets: rawConfig || null, modulePaths });
        if (key === this.configKey) return;
        this.configKey = key;
        this.moduleRequire = this.buildModuleRequire(modulePaths);
        this.resolvers.clear();

        if (!rawConfig?.providers || typeof rawConfig.providers !== 'object') return;

        for (const [alias, providerCfg] of Object.entries<SecretProviderConfig>(rawConfig.providers)) {
            try {
                const resolver = this.createResolver(alias, providerCfg);
                if (resolver) {
                    this.resolvers.set(alias, resolver);
                } else {
                    console.warn(
                        `[HTTP Forge] Secret "${alias}" skipped: unsupported type "${(providerCfg as SecretProviderConfig)?.provider}".`
                    );
                }
            } catch (err: any) {
                const provider = (providerCfg as SecretProviderConfig)?.provider ?? 'unknown';
                console.warn(
                    `[HTTP Forge] Secret "${alias}" (${provider}) skipped: ${err?.message ?? String(err)}`
                );
            }
        }
    }

    private collectTokens(input: any, out: Set<string>): void {
        if (typeof input === 'string') {
            const regex = /\{\{(secret:[^}]+)\}\}/g;
            let m: RegExpExecArray | null;
            while ((m = regex.exec(input)) !== null) {
                const token = this.baseToken(m[1]);
                if (token) out.add(token);
            }
        } else if (Array.isArray(input)) {
            input.forEach(item => this.collectTokens(item, out));
        } else if (input !== null && typeof input === 'object') {
            Object.values(input).forEach(v => this.collectTokens(v, out));
        }
    }

    /**
     * Normalize a captured template expression to the bare token.
     * `{{secret:aws/x | upper}}` resolves the `secret:aws/x` value first and
     * lets the normal interpolation pipeline apply the filter chain.
     */
    private baseToken(expression: string): string | undefined {
        const trimmed = expression.trim();
        const filterChain = parseFilterChain(trimmed);
        const token = (filterChain?.input ?? trimmed).trim();
        return token.startsWith('secret:') ? token : undefined;
    }

    private createResolver(
        alias: string,
        config: SecretProviderConfig,
    ): ISecretResolver | undefined {
        switch (config.provider) {
            case 'aws':
                return new AwsSecretResolver(config, this.moduleRequire);
            case 'azure':
                return new AzureKeyVaultResolver(config, this.moduleRequire);
            case 'vault':
                // vault uses built-in fetch — no SDK require needed
                return new HashiCorpVaultResolver(config);
            case '1password':
                return new OnePasswordResolver(config, this.moduleRequire);
            case 'gcp':
                return new GcpSecretResolver(config, this.moduleRequire);
            case 'doppler':
                // doppler uses built-in https — no SDK require needed
                return new DopplerResolver(config);
            case 'custom':
                return this.createCustomResolver(alias, config);
            default:
                return undefined;
        }
    }

    private createCustomResolver(
        alias: string,
        config: CustomSecretProviderConfig,
    ): ISecretResolver {
        if (!config.module || typeof config.module !== 'string') {
            throw new Error(
                `Custom secret provider "${alias}" requires a "module" path or package name.`
            );
        }

        let loaded: any;
        try {
            loaded = this.moduleRequire(config.module);
        } catch (err: any) {
            throw new Error(
                `Custom secret provider "${alias}" could not load module "${config.module}". ` +
                `Ensure scripts.modulePaths contains a package.json and the module is installed ` +
                `or the relative path is correct. Cause: ${err?.message ?? String(err)}`
            );
        }

        const candidate = loaded?.default ?? loaded;
        const factory = typeof candidate === 'function'
            ? candidate
            : typeof candidate?.createResolver === 'function'
                ? candidate.createResolver.bind(candidate)
                : undefined;

        let resolver: any;
        if (factory) {
            resolver = factory({ alias, options: config.options ?? {} });
        } else if (candidate && typeof candidate.resolve === 'function') {
            resolver = candidate;
        } else {
            throw new Error(
                `Custom secret provider "${alias}" module "${config.module}" must export ` +
                `a resolver factory function, a createResolver function, or an object with resolve(path).`
            );
        }

        if (resolver && typeof resolver.then === 'function') {
            throw new Error(
                `Custom secret provider "${alias}" module "${config.module}" returned a Promise. ` +
                `Resolver factories must be synchronous; use an async resolve(path) method instead.`
            );
        }

        if (!resolver || typeof resolver.resolve !== 'function') {
            throw new Error(
                `Custom secret provider "${alias}" module "${config.module}" did not return ` +
                `a resolver with resolve(path).`
            );
        }

        return {
            providerName: typeof resolver.providerName === 'string' && resolver.providerName.trim()
                ? resolver.providerName
                : alias,
            resolve: async (path: string) => resolver.resolve(path),
        };
    }

    /**
     * Build a `require` function rooted at the user's project, so optional cloud SDKs
     * resolve from the same `node_modules` where users install custom script modules
     * (via config `scripts.modulePaths`). Falls back to the default `require` so the
     * CLI (which lists SDKs in optionalDependencies) still works without modulePaths.
     */
    private buildModuleRequire(modulePaths: string[]): (name: string) => any {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fallback = (name: string) => require(name);

        // Use the first modulePath that contains a package.json (same rule as ModuleLoader)
        for (const modulePath of modulePaths) {
            try {
                const packageJsonPath = path.resolve(modulePath, 'package.json');
                if (fs.existsSync(packageJsonPath)) {
                    const normalizedPackageJsonPath = fs.realpathSync(packageJsonPath);
                    const userRequire = createRequire(normalizedPackageJsonPath);
                    // Try user modules first. Only fall back to the built-in
                    // resolution for a missing bare package; relative paths and
                    // module evaluation errors should surface unchanged.
                    return (name: string) => {
                        try {
                            return userRequire(name);
                        } catch (err: any) {
                            const isBareSpecifier =
                                !name.startsWith('.') && !path.isAbsolute(name);
                            const missingRequestedModule =
                                err?.code === 'MODULE_NOT_FOUND' &&
                                String(err?.message ?? '').includes(`'${name}'`);
                            if (isBareSpecifier && missingRequestedModule) {
                                return fallback(name);
                            }
                            throw err;
                        }
                    };
                }
            } catch {
                // try next path
            }
        }

        return fallback;
    }
}
