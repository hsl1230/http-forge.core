/**
 * OAuth2 Token Manager Interface
 *
 * Platform-independent interface for OAuth2 token management.
 * Handles all grant types: client_credentials, password, authorization_code, implicit.
 *
 * VS Code impl: uses vscode.env.openExternal, vscode.SecretStorage
 * CLI/Standalone impl: uses system browser + local HTTP callback server
 * Browser impl: uses window.open() + postMessage
 */

import { OAuth2Config } from '../../types/types';

export interface TokenInfo {
    accessToken: string;
    /** e.g. "Bearer" */
    tokenType: string;
    /** Unix timestamp (ms) */
    expiresAt?: number;
    refreshToken?: string;
    scope?: string;
    /** Original token response */
    raw: Record<string, unknown>;
}

export interface TokenCacheKey {
    tokenUrl: string;
    clientId: string;
    scope?: string;
    grantType: string;
}

export interface IOAuth2TokenManager {
    /**
     * Get a valid access token for the given OAuth2 configuration.
     * May return a cached token, refresh an expired token, or initiate a new flow.
     */
    getToken(config: OAuth2Config, environment: string): Promise<TokenInfo>;

    /**
     * Refresh an expired token using the refresh token.
     */
    refreshToken(config: OAuth2Config, currentRefreshToken: string, environment: string): Promise<TokenInfo>;

    /**
     * Initiate the authorization code flow (opens browser, waits for callback).
     */
    authorizationCodeFlow(config: OAuth2Config, environment: string): Promise<TokenInfo>;

    /**
     * Initiate the implicit flow (opens browser, waits for callback).
     */
    implicitFlow(config: OAuth2Config, environment: string): Promise<TokenInfo>;

    /**
     * Clear a cached token.
     */
    clearToken(cacheKey: TokenCacheKey): void;

    /**
     * Clear all cached tokens.
     */
    clearAllTokens(): void;

    /**
     * Handle authorization code callback (from browser redirect).
     */
    handleAuthorizationCallback(code: string | undefined, state: string | undefined, error?: string): void;

    /**
     * Handle implicit flow callback (from browser redirect with token in fragment).
     */
    handleImplicitCallback(accessToken: string, tokenType: string | undefined, expiresIn: number | undefined, state: string | undefined): void;
}
