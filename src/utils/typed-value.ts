/**
 * Internal marker prefix used for JSON-serialized non-string values.
 */
const JSON_TYPE_MARKER_CODE = 0x1E;

/**
 * Serialize a value for storage in variable scopes.
 * Strings are stored as-is; other values are JSON payloads with U+001E marker.
 */
export function serializeTypedValue(raw: unknown): string {
    if (typeof raw === 'string') {
        return raw;
    }

    return String.fromCharCode(JSON_TYPE_MARKER_CODE) + JSON.stringify(raw);
}

/**
 * Deserialize a value stored by script variable scopes.
 * Values prefixed with U+001E are JSON payloads and are parsed back.
 */
export function deserializeTypedValue(raw: unknown): unknown {
    if (typeof raw === 'string' && raw.charCodeAt(0) === JSON_TYPE_MARKER_CODE) {
        try {
            return JSON.parse(raw.slice(1));
        } catch {
            return raw;
        }
    }

    return raw;
}

/**
 * Deserialize every value in a variable map.
 */
export function deserializeTypedRecord(record: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!record) {
        return {};
    }

    const decoded: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
        decoded[key] = deserializeTypedValue(value);
    }
    return decoded;
}
