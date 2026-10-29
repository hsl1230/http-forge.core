/**
 * Shared utilities for resolving Spring type names and MediaType constants.
 */

// ----------------------------------------------------------------
// MediaType constant resolution
// ----------------------------------------------------------------

/**
 * Map of Spring `MediaType.*_VALUE` constants to their MIME type strings.
 * Also includes short forms that may appear after expression resolution.
 */
const MEDIA_TYPE_MAP: Record<string, string> = {
    // Full constant names
    'MediaType.ALL_VALUE': '*/*',
    'MediaType.APPLICATION_ATOM_XML_VALUE': 'application/atom+xml',
    'MediaType.APPLICATION_CBOR_VALUE': 'application/cbor',
    'MediaType.APPLICATION_FORM_URLENCODED_VALUE': 'application/x-www-form-urlencoded',
    'MediaType.APPLICATION_GRAPHQL_VALUE': 'application/graphql',
    'MediaType.APPLICATION_GRAPHQL_RESPONSE_VALUE': 'application/graphql-response+json',
    'MediaType.APPLICATION_JSON_VALUE': 'application/json',
    'MediaType.APPLICATION_JSON_UTF8_VALUE': 'application/json;charset=UTF-8',
    'MediaType.APPLICATION_NDJSON_VALUE': 'application/x-ndjson',
    'MediaType.APPLICATION_OCTET_STREAM_VALUE': 'application/octet-stream',
    'MediaType.APPLICATION_PDF_VALUE': 'application/pdf',
    'MediaType.APPLICATION_PROBLEM_JSON_VALUE': 'application/problem+json',
    'MediaType.APPLICATION_PROBLEM_XML_VALUE': 'application/problem+xml',
    'MediaType.APPLICATION_PROTOBUF_VALUE': 'application/x-protobuf',
    'MediaType.APPLICATION_RSS_XML_VALUE': 'application/rss+xml',
    'MediaType.APPLICATION_STREAM_JSON_VALUE': 'application/stream+json',
    'MediaType.APPLICATION_XHTML_XML_VALUE': 'application/xhtml+xml',
    'MediaType.APPLICATION_XML_VALUE': 'application/xml',
    'MediaType.APPLICATION_YAML_VALUE': 'application/yaml',
    'MediaType.IMAGE_GIF_VALUE': 'image/gif',
    'MediaType.IMAGE_JPEG_VALUE': 'image/jpeg',
    'MediaType.IMAGE_PNG_VALUE': 'image/png',
    'MediaType.MULTIPART_FORM_DATA_VALUE': 'multipart/form-data',
    'MediaType.MULTIPART_MIXED_VALUE': 'multipart/mixed',
    'MediaType.MULTIPART_RELATED_VALUE': 'multipart/related',
    'MediaType.TEXT_EVENT_STREAM_VALUE': 'text/event-stream',
    'MediaType.TEXT_HTML_VALUE': 'text/html',
    'MediaType.TEXT_MARKDOWN_VALUE': 'text/markdown',
    'MediaType.TEXT_PLAIN_VALUE': 'text/plain',
    'MediaType.TEXT_XML_VALUE': 'text/xml',
};

/**
 * Resolve a `consumes` value to a MIME type string.
 *
 * Handles:
 *  - Already-resolved strings: `"application/json"` → returned as-is
 *  - MediaType constants: `MediaType.APPLICATION_JSON_VALUE` → `"application/json"`
 *  - Partial references: `APPLICATION_JSON_VALUE` → `"application/json"`
 */
export function resolveMediaType(raw: string): string {
    // Already a MIME type (contains '/')
    if (raw.includes('/')) return raw;

    // Full constant: MediaType.XXX_VALUE
    if (MEDIA_TYPE_MAP[raw]) return MEDIA_TYPE_MAP[raw];

    // May have been extracted without the MediaType. prefix
    const withPrefix = `MediaType.${raw}`;
    if (MEDIA_TYPE_MAP[withPrefix]) return MEDIA_TYPE_MAP[withPrefix];

    // Try matching just the constant name portion across all entries
    for (const [key, val] of Object.entries(MEDIA_TYPE_MAP)) {
        if (key.endsWith(raw)) return val;
    }

    // Handle custom constants like Constants.APPLICATION_JSON or BMConstants.JSON_MEDIA_TYPE
    // Extract the constant name after the last dot and match against known MediaType names
    const lastDot = raw.lastIndexOf('.');
    if (lastDot >= 0) {
        const constName = raw.substring(lastDot + 1);
        // Try direct match: Constants.APPLICATION_JSON_VALUE → APPLICATION_JSON_VALUE
        const directKey = `MediaType.${constName}`;
        if (MEDIA_TYPE_MAP[directKey]) return MEDIA_TYPE_MAP[directKey];
        // Try with _VALUE suffix: Constants.APPLICATION_JSON → APPLICATION_JSON_VALUE
        const valueSuffixKey = `MediaType.${constName}_VALUE`;
        if (MEDIA_TYPE_MAP[valueSuffixKey]) return MEDIA_TYPE_MAP[valueSuffixKey];
    }

    // Last resort: scan for substring match in constant names
    const upper = raw.toUpperCase();
    if (upper.includes('JSON')) return 'application/json';
    if (upper.includes('XML') && !upper.includes('HTML')) return 'application/xml';
    if (upper.includes('FORM_URLENCODED')) return 'application/x-www-form-urlencoded';
    if (upper.includes('MULTIPART')) return 'multipart/form-data';
    if (upper.includes('TEXT_PLAIN') || upper.includes('PLAIN_TEXT')) return 'text/plain';
    if (upper.includes('OCTET_STREAM')) return 'application/octet-stream';

    return raw; // return as-is if unresolvable
}

/**
 * Resolve an array of consumes values, expanding MediaType constants.
 */
export function resolveMediaTypes(values: string[]): string[] {
    return values.map(resolveMediaType);
}

// ----------------------------------------------------------------
// Wrapper type unwrapping
// ----------------------------------------------------------------

/** Types that wrap the actual body type as a generic parameter. */
const WRAPPER_TYPES = new Set([
    'HttpEntity',
    'RequestEntity',
    'ResponseEntity',
    'Mono',
    'Flux',
    'Optional',
    'CompletableFuture',
    'DeferredResult',
    'ListenableFuture',
    'Callable',
]);

/**
 * If `typeName` is a known wrapper type (e.g. `HttpEntity<Foo>`), return
 * the inner type (`Foo`).  Otherwise return the original type unchanged.
 */
export function unwrapBodyType(typeName: string): string {
    if (!typeName) return typeName;
    const match = /^([A-Za-z0-9_]+)<(.+)>$/.exec(typeName);
    if (!match) return typeName;
    const outer = match[1];
    const inner = match[2];
    if (WRAPPER_TYPES.has(outer)) {
        // Recursively unwrap: e.g. Mono<HttpEntity<Foo>> → Foo
        return unwrapBodyType(inner.trim());
    }
    return typeName;
}

// ----------------------------------------------------------------
// Raw / primitive body type detection
// ----------------------------------------------------------------

/** Returns true if the type should be sent as raw text (not JSON). */
export function isRawTextType(typeName: string): boolean {
    return /^(String|CharSequence)$/.test(typeName);
}

/** Returns true if the type should be sent as binary. */
export function isBinaryType(typeName: string): boolean {
    return /^(byte\[\]|Byte\[\]|ByteArray|InputStream|InputStreamResource|Resource|ByteArrayResource|MultipartFile)$/.test(typeName);
}

/** Returns true if the type is a MultipartFile (file upload). */
export function isMultipartFileType(typeName: string): boolean {
    return /MultipartFile/.test(typeName);
}
