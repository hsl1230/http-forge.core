/**
 * Core Utility Helpers
 * 
 * Pure utility functions used across the core package.
 */

/**
 * Sanitize a name for use in file paths and identifiers.
 * Replaces invalid characters, collapses whitespace, and limits length.
 */
export function sanitizeName(name: string): string {
    return name
        .replace(/[^a-zA-Z0-9-_]/g, '_')
        .replace(/\s+/g, '-')
        .toLowerCase()
        .substring(0, 100);
}

/**
 * Monotonic counter to disambiguate ids generated within the same millisecond
 * (e.g. when bulk-importing many same-named requests in a tight loop). Resets
 * per process; the random segment covers the cross-session case.
 */
let idSequence = 0;

/**
 * Generate a unique identifier.
 * Combines a base-36 timestamp, a per-process monotonic counter, and a random
 * suffix so ids created in the same millisecond are still distinct.
 * Optional prefix is sanitized and prepended.
 */
export function generateId(prefix?: string): string {
    const base = Date.now().toString(36) + (idSequence++).toString(36) + Math.random().toString(36).slice(2, 7);
    return prefix ? `${sanitizeName(prefix)}_${base}` : base;
}

/**
 * Generate a UUID v4.
 */
export function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * Merge two header objects with case-insensitive key matching.
 * The `override` headers take precedence over `base` headers.
 * Original casing of the override key is preserved.
 */
export function mergeHeadersCaseInsensitive(
    base: Record<string, string>,
    override: Record<string, string>
): Record<string, string> {
    const result: Record<string, string> = {};
    const lowerKeyMap: Record<string, string> = {};
    for (const [key, value] of Object.entries(base)) {
        const lowerKey = key.toLowerCase();
        lowerKeyMap[lowerKey] = key;
        result[key] = value;
    }
    for (const [key, value] of Object.entries(override)) {
        const lowerKey = key.toLowerCase();
        const existingKey = lowerKeyMap[lowerKey];
        if (existingKey) {
            delete result[existingKey];
        }
        lowerKeyMap[lowerKey] = key;
        result[key] = value;
    }
    return result;
}

/**
 * Deep clone an object using JSON serialization.
 * Works for JSON-serializable values (no functions, symbols, circular refs).
 */
export function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if a value is a plain object (not array, null, Date, etc.)
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Safely parse a JSON string, returning a fallback value on failure.
 */
export function safeJsonParse<T>(str: string, fallback: T): T {
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

/**
 * Format bytes to human readable string (e.g., "1.5 KB")
 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format milliseconds to human readable string (e.g., "1.5 s")
 */
export function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
}
