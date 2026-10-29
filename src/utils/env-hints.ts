/**
 * Env-suggestion heuristics shared by the rule-based suggester (env-suggester),
 * the AI suggester (ai-env-suggester), and the curl parser (curl-parser).
 *
 * Single source of truth for:
 * - Sensitive header/query key detection
 * - `{{VAR}}` placeholder detection
 * - Var-name derivation and secret-value heuristics
 */

export const SENSITIVE_HEADER_NAMES = new Set([
    'x-api-key', 'x-auth-token', 'x-access-token', 'x-token', 'x-secret',
    'api-key', 'apikey', 'x-client-secret', 'x-rapidapi-key',
]);

export const SENSITIVE_QUERY_KEYS = new Set([
    'api_key', 'apikey', 'api-key',
    'access_token', 'token', 'auth_token',
    'client_id', 'client_secret',
    'key', 'secret',
]);

/** True if the value contains a `{{var}}` placeholder. */
export function isForgeVar(value: string): boolean {
    return /\{\{[^}]+\}\}/.test(value);
}

/** True if the value looks like a hardcoded secret (long, non-placeholder). */
export function looksLikeSecret(value: string, minLen = 16): boolean {
    return Boolean(value) && value.length >= minLen && !isForgeVar(value);
}

/** Derive an UPPER_SNAKE var name from a raw key/value. */
export function toVarName(raw: string): string {
    return raw.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}
