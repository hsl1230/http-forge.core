/**
 * OAuth2 Token Manager
 *
 * Platform-independent implementation of OAuth2 token lifecycle management:
 *  - Token caching with expiration
 *  - PKCE (S256 / plain) challenge generation
 *  - Authorization Code flow via system browser + URI handler callback
 *  - Implicit flow via system browser
 *  - Client Credentials and Password grant token fetching
 *  - Token refresh with automatic retry
 *  - Secure storage for refresh tokens via ISecretStore
 *
 * Platform-specific behaviour (browser opening, secret storage, callback URIs)
 * is injected via IExternalBrowserService and ISecretStore interfaces.
 */

import * as crypto from 'crypto';
import { IEnvironmentConfigService } from '../../types/environment-config';
import { IExternalBrowserService, ISecretStore } from '../../types/platform';
import { OAuth2Config } from '../../types/types';
import { IHttpRequestService } from '../http/interfaces';
import { IOAuth2TokenManager, TokenCacheKey, TokenInfo } from './interfaces';

// ─── Implementation ──────────────────────────────────────

/** Refresh token 30 s before actual expiry */
const EXPIRY_BUFFER_MS = 30_000;

export class OAuth2TokenManager implements IOAuth2TokenManager {
    private tokenCache = new Map<string, TokenInfo>();

    /**
     * Pending authorization-code resolve/reject.
     * Set when we launch the browser; resolved when the URI handler fires.
     */
    private pendingAuthCallback: {
        resolve: (value: { code: string; state?: string }) => void;
        reject: (reason: Error) => void;
        state: string;
    } | null = null;

    /**
     * Pending implicit-flow resolve/reject.
     */
    private pendingImplicitCallback: {
        resolve: (value: { accessToken: string; tokenType?: string; expiresIn?: number; state?: string }) => void;
        reject: (reason: Error) => void;
        state: string;
    } | null = null;

    /**
     * @param secretStore       Secure storage for refresh tokens (wraps vscode.SecretStorage, keytar, etc.)
     * @param browserService    External browser interaction (wraps vscode.env.openExternal, etc.)
     * @param envConfigService  Environment variable resolution
     * @param httpService       HTTP client for token endpoint calls
     * @param callbackPath      Platform-specific callback path (e.g. "henry-huang.http-forge/oauth2/callback")
     */
    constructor(
        private readonly secretStore: ISecretStore,
        private readonly browserService: IExternalBrowserService,
        private readonly envConfigService: IEnvironmentConfigService,
        private readonly httpService: IHttpRequestService,
        private readonly callbackPath: string = 'henry-huang.http-forge/oauth2/callback',
    ) {}

    // ─── Public API ────────────────────────────────────

    /**
     * Get a valid token — uses cache, refresh, or full re-auth as needed.
     */
    async getToken(config: OAuth2Config, environment: string): Promise<TokenInfo> {
        // If user already set an accessToken, use it directly
        if (config.accessToken) {
            const resolved = this.resolve(config.accessToken, environment);
            return {
                accessToken: resolved,
                tokenType: config.tokenPrefix || 'Bearer',
                raw: {}
            };
        }

        const cacheKey = this.buildCacheKeyString(config);
        const cached = this.tokenCache.get(cacheKey);

        // Return cached if still valid
        if (cached && !this.isExpired(cached)) {
            return cached;
        }

        // Try refresh if we have a refresh token (in-memory cache)
        if (cached?.refreshToken) {
            try {
                return await this.refreshToken(config, cached.refreshToken, environment);
            } catch {
                // Refresh failed — fall through to full re-auth
                this.tokenCache.delete(cacheKey);
            }
        }

        // Try stored refresh token from SecretStore (survives restarts)
        if (!cached) {
            const storedRefresh = await this.secretStore.get(`oauth2_refresh_${cacheKey}`);
            if (storedRefresh) {
                try {
                    return await this.refreshToken(config, storedRefresh, environment);
                } catch {
                    // Stored refresh token is stale — remove it
                    await this.secretStore.delete(`oauth2_refresh_${cacheKey}`);
                }
            }
        }

        // Full acquisition based on grant type
        let tokenInfo: TokenInfo;
        switch (config.grantType) {
            case 'client_credentials':
                tokenInfo = await this.fetchToken(config, environment, 'client_credentials');
                break;
            case 'password':
                tokenInfo = await this.fetchToken(config, environment, 'password');
                break;
            case 'authorization_code':
                tokenInfo = await this.authorizationCodeFlow(config, environment);
                break;
            case 'implicit':
                tokenInfo = await this.implicitFlow(config, environment);
                break;
            default:
                throw new Error(`Unknown OAuth2 grant type: ${config.grantType}`);
        }

        this.tokenCache.set(cacheKey, tokenInfo);

        // Persist refresh token securely
        if (tokenInfo.refreshToken) {
            await this.storeRefreshToken(cacheKey, tokenInfo.refreshToken);
        }

        return tokenInfo;
    }

    /**
     * Refresh an existing token.
     */
    async refreshToken(config: OAuth2Config, currentRefreshToken: string, environment: string): Promise<TokenInfo> {
        const tokenUrl = this.resolve(config.tokenUrl || '', environment);
        if (!tokenUrl) throw new Error('OAuth2 tokenUrl is required for token refresh');

        const clientId = this.resolve(config.clientId || '', environment);
        const clientSecret = this.resolve(config.clientSecret || '', environment);

        const params = new URLSearchParams();
        params.append('grant_type', 'refresh_token');
        params.append('refresh_token', currentRefreshToken);

        const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
        this.applyClientAuth(config, headers, params, clientId, clientSecret, environment);

        const resp = await this.httpService.execute({ method: 'POST', url: tokenUrl, headers, body: params.toString() });
        const tokenInfo = this.parseTokenResponse(resp.body, config);

        // Carry forward original refresh token if not replaced
        if (!tokenInfo.refreshToken) {
            tokenInfo.refreshToken = currentRefreshToken;
        }

        const cacheKey = this.buildCacheKeyString(config);
        this.tokenCache.set(cacheKey, tokenInfo);

        if (tokenInfo.refreshToken) {
            await this.storeRefreshToken(cacheKey, tokenInfo.refreshToken);
        }

        return tokenInfo;
    }

    /**
     * Authorization Code + PKCE flow.
     *
     * 1. Generate code_verifier & code_challenge (S256)
     * 2. Open system browser with authorize URL
     * 3. Wait for URI handler callback with ?code=xxx&state=yyy
     * 4. Exchange code + code_verifier for token
     */
    async authorizationCodeFlow(config: OAuth2Config, environment: string): Promise<TokenInfo> {
        const authUrl = this.resolve(config.authUrl || '', environment);
        const tokenUrl = this.resolve(config.tokenUrl || '', environment);
        const clientId = this.resolve(config.clientId || '', environment);
        const clientSecret = this.resolve(config.clientSecret || '', environment);
        const scope = config.scope ? this.resolve(config.scope, environment) : undefined;

        if (!authUrl) throw new Error('OAuth2 authUrl is required for authorization code flow');
        if (!tokenUrl) throw new Error('OAuth2 tokenUrl is required for authorization code flow');
        if (!clientId) throw new Error('OAuth2 clientId is required for authorization code flow');

        // PKCE (default enabled for auth code)
        const usePkce = config.usePkce !== false;
        let codeVerifier: string | undefined;
        let codeChallenge: string | undefined;
        let codeChallengeMethod: string | undefined;
        if (usePkce) {
            codeVerifier = this.generateCodeVerifier();
            const method = config.pkceMethod || 'S256';
            codeChallenge = method === 'S256'
                ? this.generateCodeChallengeS256(codeVerifier)
                : codeVerifier; // plain
            codeChallengeMethod = method;
        }

        // Generate state for CSRF protection
        const state = config.state || crypto.randomBytes(16).toString('hex');

        // Build authorization URL
        const callbackUri = await this.getCallbackUri();
        const authorizeUrl = new URL(authUrl);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', clientId);
        authorizeUrl.searchParams.set('redirect_uri', callbackUri);
        if (scope) authorizeUrl.searchParams.set('scope', scope);
        authorizeUrl.searchParams.set('state', state);
        if (codeChallenge) {
            authorizeUrl.searchParams.set('code_challenge', codeChallenge);
            authorizeUrl.searchParams.set('code_challenge_method', codeChallengeMethod!);
        }
        if (config.audience) authorizeUrl.searchParams.set('audience', this.resolve(config.audience, environment));
        if (config.resource) authorizeUrl.searchParams.set('resource', this.resolve(config.resource, environment));
        if (config.extraParams) {
            for (const [k, v] of Object.entries(config.extraParams)) {
                authorizeUrl.searchParams.set(k, this.resolve(v, environment));
            }
        }

        // Reject any pending auth flow before starting a new one
        if (this.pendingAuthCallback) {
            this.pendingAuthCallback.reject(new Error('OAuth2 authorization superseded by a new request'));
            this.pendingAuthCallback = null;
        }

        // Create a promise that resolves when the URI handler fires
        const callbackPromise = new Promise<{ code: string; state?: string }>((resolve, reject) => {
            this.pendingAuthCallback = { resolve, reject, state };
        });

        // Open browser
        await this.browserService.openExternal(authorizeUrl.toString());

        // Wait for callback (with 2 minute timeout)
        let result: { code: string; state?: string };
        try {
            result = await Promise.race([
                callbackPromise,
                new Promise<never>((_, reject) =>
                    setTimeout(() => {
                        this.pendingAuthCallback = null;
                        reject(new Error('OAuth2 authorization timed out after 2 minutes'));
                    }, 120_000)
                )
            ]);
        } finally {
            this.pendingAuthCallback = null;
        }

        // Validate state
        if (result.state && result.state !== state) {
            throw new Error('OAuth2 state mismatch — potential CSRF attack');
        }

        // Exchange code for token
        const tokenParams = new URLSearchParams();
        tokenParams.append('grant_type', 'authorization_code');
        tokenParams.append('code', result.code);
        tokenParams.append('redirect_uri', callbackUri);
        if (codeVerifier) tokenParams.append('code_verifier', codeVerifier);

        const tokenHeaders: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
        this.applyClientAuth(config, tokenHeaders, tokenParams, clientId, clientSecret, environment);

        const resp = await this.httpService.execute({
            method: 'POST', url: tokenUrl, headers: tokenHeaders, body: tokenParams.toString()
        });

        const tokenInfo = this.parseTokenResponse(resp.body, config);
        const cacheKey = this.buildCacheKeyString(config);
        this.tokenCache.set(cacheKey, tokenInfo);

        if (tokenInfo.refreshToken) {
            await this.storeRefreshToken(cacheKey, tokenInfo.refreshToken);
        }

        return tokenInfo;
    }

    /**
     * Implicit flow — opens browser, waits for hash fragment with access_token.
     * Since the URI handler receives query params (not fragments), a small
     * redirect page is needed to convert fragment → query. We handle both cases.
     */
    async implicitFlow(config: OAuth2Config, environment: string): Promise<TokenInfo> {
        const authUrl = this.resolve(config.authUrl || '', environment);
        const clientId = this.resolve(config.clientId || '', environment);
        const scope = config.scope ? this.resolve(config.scope, environment) : undefined;

        if (!authUrl) throw new Error('OAuth2 authUrl is required for implicit flow');
        if (!clientId) throw new Error('OAuth2 clientId is required for implicit flow');

        const state = config.state || crypto.randomBytes(16).toString('hex');
        const callbackUri = await this.getCallbackUri();

        const authorizeUrl = new URL(authUrl);
        authorizeUrl.searchParams.set('response_type', 'token');
        authorizeUrl.searchParams.set('client_id', clientId);
        authorizeUrl.searchParams.set('redirect_uri', callbackUri);
        if (scope) authorizeUrl.searchParams.set('scope', scope);
        authorizeUrl.searchParams.set('state', state);
        if (config.audience) authorizeUrl.searchParams.set('audience', this.resolve(config.audience, environment));
        if (config.resource) authorizeUrl.searchParams.set('resource', this.resolve(config.resource, environment));
        if (config.extraParams) {
            for (const [k, v] of Object.entries(config.extraParams)) {
                authorizeUrl.searchParams.set(k, this.resolve(v, environment));
            }
        }

        // Reject any pending implicit flow before starting a new one
        if (this.pendingImplicitCallback) {
            this.pendingImplicitCallback.reject(new Error('OAuth2 implicit flow superseded by a new request'));
            this.pendingImplicitCallback = null;
        }

        const callbackPromise = new Promise<{ accessToken: string; tokenType?: string; expiresIn?: number; state?: string }>(
            (resolve, reject) => {
                this.pendingImplicitCallback = { resolve, reject, state };
            }
        );

        await this.browserService.openExternal(authorizeUrl.toString());

        let result: { accessToken: string; tokenType?: string; expiresIn?: number; state?: string };
        try {
            result = await Promise.race([
                callbackPromise,
                new Promise<never>((_, reject) =>
                    setTimeout(() => {
                        this.pendingImplicitCallback = null;
                        reject(new Error('OAuth2 implicit flow timed out after 2 minutes'));
                    }, 120_000)
                )
            ]);
        } finally {
            this.pendingImplicitCallback = null;
        }

        if (result.state && result.state !== state) {
            throw new Error('OAuth2 state mismatch — potential CSRF attack');
        }

        const tokenInfo: TokenInfo = {
            accessToken: result.accessToken,
            tokenType: result.tokenType || config.tokenPrefix || 'Bearer',
            expiresAt: result.expiresIn ? Date.now() + result.expiresIn * 1000 : undefined,
            raw: { access_token: result.accessToken, token_type: result.tokenType, expires_in: result.expiresIn }
        };

        const cacheKey = this.buildCacheKeyString(config);
        this.tokenCache.set(cacheKey, tokenInfo);
        return tokenInfo;
    }

    /**
     * Called by the URI handler when browser redirects back.
     * Handles both authorization_code (?code=) and implicit (?access_token=) callbacks.
     */
    handleAuthorizationCallback(code: string | undefined, state: string | undefined, error?: string): void {
        if (error) {
            const err = new Error(`OAuth2 authorization error: ${error}`);
            this.pendingAuthCallback?.reject(err);
            this.pendingImplicitCallback?.reject(err);
            this.pendingAuthCallback = null;
            this.pendingImplicitCallback = null;
            return;
        }

        // Authorization code callback
        if (code && this.pendingAuthCallback) {
            this.pendingAuthCallback.resolve({ code, state });
            this.pendingAuthCallback = null;
            return;
        }

        // Implicit flow would have access_token in params — handled by extension.ts
        // This is a fallback
        if (!code && !this.pendingAuthCallback && this.pendingImplicitCallback) {
            this.pendingImplicitCallback.reject(new Error('OAuth2 implicit flow did not receive access_token'));
            this.pendingImplicitCallback = null;
        }
    }

    /**
     * Handle implicit callback with access_token directly.
     */
    handleImplicitCallback(accessToken: string, tokenType: string | undefined, expiresIn: number | undefined, state: string | undefined): void {
        if (this.pendingImplicitCallback) {
            this.pendingImplicitCallback.resolve({ accessToken, tokenType, expiresIn, state });
            this.pendingImplicitCallback = null;
        }
    }

    clearToken(cacheKey: TokenCacheKey): void {
        const key = `${cacheKey.tokenUrl}|${cacheKey.clientId}|${cacheKey.scope || ''}|${cacheKey.grantType}`;
        this.tokenCache.delete(key);
        this.secretStore.delete(`oauth2_refresh_${key}`);
    }

    clearAllTokens(): void {
        // Delete stored refresh tokens for every cached key
        for (const key of this.tokenCache.keys()) {
            this.secretStore.delete(`oauth2_refresh_${key}`);
        }
        this.tokenCache.clear();
    }

    // ─── Private helpers ───────────────────────────────

    /**
     * Fetch token using client_credentials or password grant.
     */
    private async fetchToken(
        config: OAuth2Config,
        environment: string,
        grantType: 'client_credentials' | 'password'
    ): Promise<TokenInfo> {
        const tokenUrl = this.resolve(config.tokenUrl || '', environment);
        if (!tokenUrl) throw new Error('OAuth2 tokenUrl is required');

        const clientId = this.resolve(config.clientId || '', environment);
        const clientSecret = this.resolve(config.clientSecret || '', environment);
        const scope = config.scope ? this.resolve(config.scope, environment) : undefined;

        const params = new URLSearchParams();
        params.append('grant_type', grantType);
        if (scope) params.append('scope', scope);

        // Password grant
        if (grantType === 'password') {
            const username = this.resolve(config.username || '', environment);
            const password = this.resolve(config.password || '', environment);
            if (!username) throw new Error('OAuth2 password grant requires username');
            params.append('username', username);
            params.append('password', password);
        }

        // Audience / resource / extra params
        if (config.audience) params.append('audience', this.resolve(config.audience, environment));
        if (config.resource) params.append('resource', this.resolve(config.resource, environment));
        if (config.extraParams) {
            for (const [k, v] of Object.entries(config.extraParams)) {
                params.append(k, this.resolve(v, environment));
            }
        }

        const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
        this.applyClientAuth(config, headers, params, clientId, clientSecret, environment);

        const resp = await this.httpService.execute({
            method: 'POST', url: tokenUrl, headers, body: params.toString()
        });

        return this.parseTokenResponse(resp.body, config);
    }

    /**
     * Apply client authentication to the request (body or Basic Auth header).
     */
    private applyClientAuth(
        config: OAuth2Config,
        headers: Record<string, string>,
        params: URLSearchParams,
        clientId: string,
        clientSecret: string,
        _environment: string
    ): void {
        if (config.clientAuthentication === 'header') {
            // Send as Basic Auth header
            const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
            headers['Authorization'] = `Basic ${encoded}`;
        } else {
            // Default: send in body
            if (clientId) params.set('client_id', clientId);
            if (clientSecret) params.set('client_secret', clientSecret);
        }
    }

    /**
     * Parse token endpoint response body into TokenInfo.
     */
    private parseTokenResponse(body: unknown, config: OAuth2Config): TokenInfo {
        // The HTTP client returns the raw response body as a string; parse it
        // here on demand (Postman-compatible). Tolerate already-parsed objects too.
        let parsed: unknown = body;
        if (typeof parsed === 'string') {
            try {
                parsed = JSON.parse(parsed);
            } catch {
                throw new Error('OAuth2 token response is not valid JSON');
            }
        }
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('OAuth2 token response is not a valid JSON object');
        }

        const raw = parsed as Record<string, unknown>;
        const tokenField = config.tokenField || 'access_token';
        const accessToken = raw[tokenField] as string | undefined;
        if (!accessToken) {
            throw new Error(`OAuth2 token fetch failed: '${tokenField}' not present in response`);
        }

        const expiresIn = typeof raw.expires_in === 'number' ? raw.expires_in : undefined;
        return {
            accessToken,
            tokenType: (raw.token_type as string) || config.tokenPrefix || 'Bearer',
            expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
            refreshToken: raw.refresh_token as string | undefined,
            scope: raw.scope as string | undefined,
            raw
        };
    }

    private isExpired(token: TokenInfo): boolean {
        if (!token.expiresAt) return false;
        return Date.now() >= token.expiresAt - EXPIRY_BUFFER_MS;
    }

    private buildCacheKeyString(config: OAuth2Config): string {
        return `${config.tokenUrl || ''}|${config.clientId || ''}|${config.scope || ''}|${config.grantType}`;
    }

    /**
     * Get the callback URI for OAuth2 redirects.
     * Uses the browser service to create a valid, externally accessible callback URI.
     */
    private async getCallbackUri(): Promise<string> {
        const rawUri = `${this.browserService.uriScheme}://${this.callbackPath}`;
        return this.browserService.asExternalUri(rawUri);
    }

    /** Resolve environment variables in a string */
    private resolve(value: string, environment: string): string {
        return this.envConfigService.resolveVariables(value, environment);
    }

    // ─── PKCE helpers ──────────────────────────────────

    private generateCodeVerifier(): string {
        // 32 random bytes → 43 base64url characters
        return crypto.randomBytes(32)
            .toString('base64url');
    }

    private generateCodeChallengeS256(verifier: string): string {
        return crypto.createHash('sha256')
            .update(verifier)
            .digest('base64url');
    }

    // ─── Secure storage helpers ────────────────────────

    private async storeRefreshToken(cacheKey: string, refreshToken: string): Promise<void> {
        try {
            await this.secretStore.store(`oauth2_refresh_${cacheKey}`, refreshToken);
        } catch {
            // Non-critical — refresh tokens can be re-acquired
        }
    }
}
