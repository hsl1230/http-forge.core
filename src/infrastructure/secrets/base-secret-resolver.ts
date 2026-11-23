/**
 * Base Secret Resolver — universal caching + JSON path resolution.
 *
 * Specific providers (AWS, Azure, GCP, Vault, ...) extend this class and
 * implement only `fetchRaw(secretName)`, which retrieves the raw secret string
 * from the backing store. All shared logic lives here:
 *
 *   - TTL-based caching of raw secret strings (cross-request, per instance)
 *   - Universal JSON path resolution with dot-notation and array indices:
 *       {{secret:alias/secret-name}}              → raw string
 *       {{secret:alias/secret-name.field}}         → JSON field (nested)
 *       {{secret:alias/secret-name.items[0].id}}   → array index traversal
 *       {{secret:alias/secret-name#field}}         → legacy #field (still supported)
 *   - Conversion of resolved values to strings
 *
 * Providers never parse JSON or manage cache themselves.
 */

export interface SecretCacheEntry {
    value: string;
    expiresAt: number;
}

const FAILED_SENTINEL = '__FAILED__';
const FAILURE_TTL_MS = 30 * 1000; // 30 seconds for failures

export abstract class BaseSecretResolver {
    readonly abstract providerName: string;

    /** Default TTL: 5 minutes. Override via constructor option. */
    protected readonly ttlMs: number;

    private readonly cache = new Map<string, SecretCacheEntry>();

    constructor(options?: { cacheTtlMs?: number }) {
        this.ttlMs = options?.cacheTtlMs ?? 5 * 60 * 1000;
    }

    /**
     * Public entry point. Handles caching, path splitting, JSON parsing and
     * traversal. Providers implement `fetchRaw` only.
     */
    async resolve(secretPath: string): Promise<string | undefined> {
        // Split into secret name + optional JSON path using dot-notation.
        let secretName = secretPath;
        let jsonPath: string | undefined;

        const dotIdx = secretPath.indexOf('.');
        if (dotIdx >= 0) {
            secretName = secretPath.slice(0, dotIdx);
            jsonPath = secretPath.slice(dotIdx + 1);
        }

        // Cache lookup (by secret name, so multiple paths share one fetch)
        const cached = this.cache.get(secretName);
        if (cached && cached.expiresAt > Date.now()) {
            if (cached.value === FAILED_SENTINEL) return undefined;
            const raw = cached.value;
            return this.resolvePath(raw, jsonPath);
        }

        let raw: string | undefined;
        try {
            raw = await this.fetchRaw(secretName, jsonPath);
        } catch (err) {
            // Cache the failure (short TTL) to avoid hammering the provider
            // on every request when credentials are missing or the secret
            // doesn't exist.
            this.cache.set(secretName, { value: FAILED_SENTINEL, expiresAt: Date.now() + FAILURE_TTL_MS });
            throw err;
        }
        if (raw !== undefined) {
            this.cache.set(secretName, { value: raw, expiresAt: Date.now() + this.ttlMs });
        } else {
            this.cache.set(secretName, { value: FAILED_SENTINEL, expiresAt: Date.now() + FAILURE_TTL_MS });
        }

        if (raw === undefined) return undefined;
        return this.resolvePath(raw, jsonPath);
    }

    private resolvePath(raw: string, jsonPath: string | undefined): string | undefined {
        // No JSON path → return raw (with backward-compat convenience for
        // single-key objects: if raw is JSON with a "value" key, return it).
        if (!jsonPath) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'value' in parsed && Object.keys(parsed).length === 1) {
                    return toStringValue(parsed.value);
                }
            } catch {
                // not JSON — return raw as-is
            }
            return raw;
        }

        // JSON path → parse + traverse
        let parsed: any;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return undefined;
        }
        const value = traverseJsonPath(parsed, jsonPath);
        return toStringValue(value);
    }

    /**
     * Provider-specific raw string retrieval. Implement in subclasses.
     * Must return the raw secret payload as a string (possibly JSON).
     */
    protected abstract fetchRaw(secretName: string, jsonPath?: string): Promise<string | undefined>;

    /**
     * Clear the cache (e.g. on config reload or manual refresh).
     */
    clearCache(): void {
        this.cache.clear();
    }
}

/**
 * Traverse a parsed JSON value using a dot-notation path with array indices.
 * Supports: "a.b", "a[0]", "a.b[0].c", "items[2][1]".
 */
export function traverseJsonPath(obj: any, path: string): any {
    if (!path) return obj;
    const tokens = path.split('.');
    let current: any = obj;
    for (const token of tokens) {
        // Split token into property name + array indices, e.g. "foo[0][1]"
        const parts = token.split(/(\[\d+\])/).filter(Boolean);
        for (const part of parts) {
            const arrMatch = part.match(/^\[(\d+)\]$/);
            if (arrMatch) {
                const idx = parseInt(arrMatch[1], 10);
                if (Array.isArray(current) && idx >= 0 && idx < current.length) {
                    current = current[idx];
                } else {
                    return undefined;
                }
            } else {
                if (current !== null && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, part)) {
                    current = current[part];
                } else {
                    return undefined;
                }
            }
        }
        if (current === undefined) return undefined;
    }
    return current;
}

function toStringValue(value: any): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
}