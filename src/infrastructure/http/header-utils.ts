/**
 * Header sanitization helpers shared by RequestPreprocessor and NodeHttpClient.
 * Single source of truth for removing characters invalid in HTTP header values.
 */

/**
 * Sanitize a single header value by replacing smart/curly quotes with ASCII
 * equivalents and stripping control characters (tab preserved).
 */
export function sanitizeHeaderValue(value: string): string {
    if (!value) return '';
    return String(value)
        // Replace smart/curly quotes with standard ASCII quotes
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
        // Remove control characters (0x00-0x1F and 0x7F) except for tab (0x09)
        .replace(/[\x00-\x08\x0A-\x1F\x7F]/g, '');
}

/**
 * Sanitize every value in a headers record.
 */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        sanitized[key] = sanitizeHeaderValue(String(value));
    }
    return sanitized;
}
