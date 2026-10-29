/**
 * Resolved secret value tracking and opacity.
 *
 * Secret values are tracked in a WeakMap keyed by the prepared request. This
 * keeps them out of JSON/webview payloads while still letting persistence code
 * redact exact occurrences later in the execution pipeline.
 *
 * The protect/unprotect helpers keep a resolved value opaque to recursive
 * variable interpolation: a secret containing `{{...}}` must not be treated as
 * a template and expanded again.
 */

const secretValuesByObject = new WeakMap<object, readonly string[]>();

const SECRET_OPEN = '__HF_SECRET_OPEN__';
const SECRET_CLOSE = '__HF_SECRET_CLOSE__';

function normalizeSecretValues(values: Iterable<string> | undefined): readonly string[] {
    if (!values) return [];
    return [...new Set(Array.from(values).filter(value => typeof value === 'string' && value.length > 0))];
}

/** Associate resolved secret values with a request/result object. */
export function attachSecretValues<T extends object>(target: T, values: Iterable<string> | undefined): T {
    const normalized = normalizeSecretValues(values);
    if (normalized.length > 0) {
        secretValuesByObject.set(target, normalized);
    }
    return target;
}

/** Read the resolved secret values associated with an object, if any. */
export function getSecretValues(target: object | null | undefined): readonly string[] {
    return target ? secretValuesByObject.get(target) ?? [] : [];
}

/** Copy tracked secret values from one object to a derived object. */
export function copySecretValues<T extends object>(source: object | null | undefined, target: T): T {
    return attachSecretValues(target, getSecretValues(source));
}

/** Replace template delimiters so a resolved value stays opaque during interpolation. */
export function protectSecretValue(value: string): string {
    return value.split('{{').join(SECRET_OPEN).split('}}').join(SECRET_CLOSE);
}

/** Restore template delimiters in a previously protected secret value. */
export function unprotectSecretValue(value: string): string {
    return value.split(SECRET_OPEN).join('{{').split(SECRET_CLOSE).join('}}');
}

/**
 * Recursively restore protected delimiters in plain request data.
 * Non-plain objects (Buffer, FormData, streams) are returned unchanged.
 */
export function unprotectSecretValuesDeep<T>(value: T): T {
    if (typeof value === 'string') {
        return unprotectSecretValue(value) as T;
    }
    if (Array.isArray(value)) {
        return value.map(item => unprotectSecretValuesDeep(item)) as T;
    }
    if (value !== null && typeof value === 'object') {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            return value;
        }
        const result: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            result[key] = unprotectSecretValuesDeep(item);
        }
        return result as T;
    }
    return value;
}
