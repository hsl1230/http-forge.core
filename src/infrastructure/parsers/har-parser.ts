/**
 * HAR (HTTP Archive) Parser
 *
 * Parses a HAR 1.2 archive into HTTP Forge requests. Extracts method, URL,
 * headers, query params, cookies, postData body, and a response-time hint from
 * each `log.entries[]` network transaction.
 *
 * Platform-independent: pure string/JSON handling, no Node.js or VS Code dep.
 */

import { generateId } from '../../utils/helpers';
import type { KeyValueEntry, RequestBody, UnifiedCollection, UnifiedFolder, UnifiedRequest } from '../../types/types';

/** Structured representation of a single HAR entry converted to a request. */
export interface ParsedHarRequest {
  name: string;
  method: string;
  url: string;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  query: Array<{ key: string; value: string; enabled: boolean }>;
  cookies: Array<{ key: string; value: string; enabled: boolean }>;
  /** Parsed postData body, or null when no body is present. */
  body: RequestBody | null;
  /** Observed response status from the HAR entry (if any). */
  responseStatus?: number;
  /** Observed response time in ms (if any). */
  responseTimeMs?: number;
  /** HAR content type of the response body (if any). */
  responseContentType?: string;
}

export interface HarImportOptions {
  /** Collection name override (default: "Imported from HAR"). */
  collectionName?: string;
  /** Skip entries that failed (HTTP 4xx/5xx). Default: false. */
  skipFailed?: boolean;
  /** Only include entries whose URL hostname matches this value. */
  filterHost?: string;
}

/** Data extracted from a parsed HAR body, when it looks like JSON. */
export interface HarJsonBody {
  parsed: unknown;
  text: string;
}

/**
 * Parse a HAR archive (as an object or a JSON string) into HTTP Forge
 * requests. Returns the flattened requests and a unified collection with the
 * entries grouped by top-level hostname folders.
 */
export function parseHar(
  har: string | Record<string, any>,
  options: HarImportOptions = {}
): { requests: ParsedHarRequest[]; collection: UnifiedCollection } {
  const data = typeof har === 'string' ? JSON.parse(har) : har;
  const log = data?.log;
  if (!log || !Array.isArray(log.entries)) {
    throw new Error('Invalid HAR: missing log.entries');
  }

  const entries = (log.entries as any[]).filter((entry) => entry?.request);
  const requests: ParsedHarRequest[] = [];

  for (const entry of entries) {
    const request = entry.request;

    if (options.filterHost) {
      try {
        const host = new URL(request.url).hostname;
        if (host !== options.filterHost) continue;
      } catch {
        continue;
      }
    }

    const responseStatus = entry.response?.status;
    if (options.skipFailed && typeof responseStatus === 'number' && responseStatus >= 400) {
      continue;
    }

    requests.push(convertEntry(entry));
  }

  const collection = buildCollection(requests, options.collectionName ?? 'Imported from HAR');
  return { requests, collection };
}

/** Parse a HAR archive's entry list into a unified collection directly. */
export function harToCollection(
  har: string | Record<string, any>,
  options: HarImportOptions = {}
): UnifiedCollection {
  return parseHar(har, options).collection;
}

// ─── Entry conversion ─────────────────────────────────────────────────────────

function convertEntry(entry: any): ParsedHarRequest {
  const request = entry.request;
  const method = request.method || 'GET';
  const url = request.url || '';
  const name = deriveName(method, url);

  const headers = (request.headers ?? [])
    .filter((h: any) => typeof h.name === 'string')
    .map((h: any) => ({ key: h.name, value: String(h.value), enabled: true }));

  const query = (request.queryString ?? [])
    .map((q: any) => ({ key: q.name, value: String(q.value), enabled: true }));

  const cookies = (request.cookies ?? [])
    .map((c: any) => ({ key: c.name, value: String(c.value), enabled: true }));

  const body = convertPostData(request.postData, headers);

  return {
    name,
    method,
    url,
    headers,
    query,
    cookies,
    body,
    responseStatus: entry.response?.status,
    responseTimeMs: typeof entry.time === 'number' ? entry.time : undefined,
    responseContentType: entry.response?.content?.mimeType,
  };
}

function convertPostData(
  postData: any,
  headers: Array<{ key: string; value: string; enabled: boolean }>
): RequestBody | null {
  if (!postData) return null;

  const text = typeof postData.text === 'string' ? postData.text : '';
  const mimeType = postData.mimeType || inferMimeType(headers);

  if (!text && postData.params?.length) {
    const entries: KeyValueEntry[] = postData.params.map((p: any) => ({
      key: p.name,
      value: String(p.value ?? ''),
      enabled: true,
    }));
    return {
      type: mimeType.includes('json') ? 'raw' : 'x-www-form-urlencoded',
      ...(mimeType.includes('json') ? { format: 'json' as const } : {}),
      content: entries,
    };
  }

  if (mimeType.includes('json')) {
    return { type: 'raw', format: 'json', content: text };
  }
  if (mimeType.includes('xml')) {
    return { type: 'raw', format: 'xml', content: text };
  }
  if (mimeType.includes('html')) {
    return { type: 'raw', format: 'html', content: text };
  }
  if (mimeType.includes('form-urlencoded') || mimeType.includes('multipart')) {
    const entries: KeyValueEntry[] = parseUrlEncoded(text);
    if (entries.length > 0) {
      return { type: 'x-www-form-urlencoded', content: entries };
    }
  }

  return { type: 'raw', format: 'text', content: text };
}

function parseUrlEncoded(text: string): KeyValueEntry[] {
  try {
    const params = new URLSearchParams(text);
    return [...params.entries()].map(([key, value]) => ({ key, value, enabled: true }));
  } catch {
    return [];
  }
}

function inferMimeType(headers: Array<{ key: string; value: string; enabled: boolean }>): string {
  const ct = headers.find((h) => h.key.toLowerCase() === 'content-type');
  return ct?.value?.split(';')[0].trim() ?? '';
}

function deriveName(method: string, url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    return seg ? `${method} ${decodeURIComponent(seg)}` : `${method} ${u.hostname}`;
  } catch {
    return `${method} ${url.slice(0, 80)}`;
  }
}

// ─── Collection building ─────────────────────────────────────────────────────

function buildCollection(
  requests: ParsedHarRequest[],
  collectionName: string
): UnifiedCollection {
  const folders = new Map<string, UnifiedFolder>();

  const items: (UnifiedFolder | UnifiedRequest)[] = [];
  for (const req of requests) {
    let hostname = 'unknown-host';
    try {
      hostname = new URL(req.url).hostname;
    } catch { /* fall back to unknown-host */ }

    let folder = folders.get(hostname);
    if (!folder) {
      folder = {
        type: 'folder',
        id: generateId(`har-${hostname}`),
        name: hostname,
        items: [],
      };
      folders.set(hostname, folder);
      items.push(folder);
    }

    folder.items.push(toUnifiedRequest(req));
  }

  return {
    id: generateId('har-collection'),
    name: collectionName,
    items,
    source: { format: 'har', filePath: '' },
    meta: { requestCount: requests.length },
  };
}

function toUnifiedRequest(req: ParsedHarRequest): UnifiedRequest {
  const headers = req.headers.map((h) => ({ ...h }));

  if (req.cookies.length > 0) {
    const cookieHeader = headers.find((h) => h.key.toLowerCase() === 'cookie');
    if (cookieHeader) {
      const extra = req.cookies.map((c) => `${c.key}=${c.value}`).join('; ');
      cookieHeader.value = cookieHeader.value ? `${cookieHeader.value}; ${extra}` : extra;
    } else {
      headers.push({
        key: 'Cookie',
        value: req.cookies.map((c) => `${c.key}=${c.value}`).join('; '),
        enabled: true,
      });
    }
  }

  const request: UnifiedRequest = {
    type: 'request',
    id: generateId(`har-${req.method}-${req.url}`),
    name: req.name,
    method: req.method,
    url: req.url,
    headers,
    query: req.query.map((q) => ({ ...q })),
    body: req.body ?? undefined,
    responseSchema: req.responseStatus
      ? {
          responses: {
            [String(req.responseStatus)]: {
              description: `Observed response (${req.responseTimeMs ?? 'unknown'} ms)`,
              contentType: req.responseContentType,
            },
          },
        }
      : undefined,
  };

  return request;
}
