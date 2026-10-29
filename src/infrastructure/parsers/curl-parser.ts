/**
 * Curl Command Parser (rule-based)
 *
 * Parses a curl command string into a structured HTTP request definition.
 * No AI dependency — works entirely with shell tokenization and flag matching.
 * Platform-independent (no Node.js dependency).
 *
 * Supported curl flags:
 *   -X / --request          HTTP method
 *   -H / --header           Request headers
 *   -d / --data / --data-raw / --data-binary / --data-ascii   Request body
 *   --json                  JSON body (also sets Content-Type: application/json)
 *   -u / --user             Basic auth (user:pass → Authorization: Basic …)
 *   -b / --cookie           Cookie string (added as Cookie header)
 *   --url                   Explicit URL
 *   -G / --get              Force GET method
 *   -F / --form             Form-data fields
 *   --data-urlencode        URL-encoded body field
 *   -A / --user-agent       User-Agent header
 *   -e / --referer          Referer header
 *   Backslash-newline continuation is normalised to spaces before parsing.
 */

import { isForgeVar, looksLikeSecret, SENSITIVE_HEADER_NAMES, SENSITIVE_QUERY_KEYS, toVarName } from '../../utils/env-hints';

/** Structured representation of a parsed curl command. */
export interface ParsedCurlRequest {
  /** Suggested request name derived from the URL path segment. */
  name: string;
  method: string;
  url: string;
  /** Headers without curl-internal additions (Content-Type from --json, etc. are still included). */
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  queryParams: Array<{ key: string; value: string; enabled: boolean }>;
  /** Parsed body, or null when no body is present. */
  body: { type: 'raw'; format: 'json' | 'text'; content: string } | null;
  /**
   * Detected hardcoded values (tokens, API keys, base URLs) that are good
   * environment-variable candidates.
   */
  suggestedVars: Array<{ key: string; value: string }>;
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

/**
 * Split a shell-style command string into tokens, respecting single-quoted,
 * double-quoted strings and backslash escapes.
 * Backslash-newline continuation is treated as whitespace.
 */
function tokenize(cmd: string): string[] {
  const normalized = cmd.replace(/\\\n/g, ' ');
  const tokens: string[] = [];
  let current = '';
  let i = 0;

  while (i < normalized.length) {
    const ch = normalized[i];

    if (ch === '\\' && i + 1 < normalized.length) {
      current += normalized[++i];
      i++;
    } else if (ch === "'") {
      // Single-quoted — no escape processing inside
      i++;
      while (i < normalized.length && normalized[i] !== "'") {
        current += normalized[i++];
      }
      i++; // closing quote
    } else if (ch === '"') {
      // Double-quoted — process \" \\ \$ \`
      i++;
      while (i < normalized.length && normalized[i] !== '"') {
        if (normalized[i] === '\\' && i + 1 < normalized.length) {
          const next = normalized[i + 1];
          if (next === '"' || next === '\\' || next === '$' || next === '`') {
            current += next;
            i += 2;
          } else {
            current += normalized[i++];
          }
        } else {
          current += normalized[i++];
        }
      }
      i++; // closing quote
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      i++;
    } else {
      current += ch;
      i++;
    }
  }

  if (current.length > 0) tokens.push(current);
  return tokens;
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

function extractQueryParams(rawUrl: string): {
  cleanUrl: string;
  params: Array<{ key: string; value: string; enabled: boolean }>;
} {
  try {
    // Temporarily replace {{variables}} so URL parsing doesn't choke on them
    const PLACEHOLDER = '__FV__';
    const vars: string[] = [];
    const safe = rawUrl.replace(/\{\{[^}]+\}\}/g, (m) => {
      vars.push(m);
      return `${PLACEHOLDER}${vars.length - 1}`;
    });

    const qIdx = safe.indexOf('?');
    if (qIdx === -1) return { cleanUrl: rawUrl, params: [] };

    const baseRaw = safe.slice(0, qIdx);
    const queryRaw = safe.slice(qIdx + 1);

    const restore = (s: string): string =>
      s.replace(new RegExp(`${PLACEHOLDER}(\\d+)`, 'g'), (_, idx) => vars[parseInt(idx, 10)]);

    const base = restore(baseRaw);
    const params = queryRaw
      .split('&')
      .filter(Boolean)
      .map((pair) => {
        const r = restore(pair);
        const eqIdx = r.indexOf('=');
        if (eqIdx === -1) return { key: r, value: '', enabled: true };
        return {
          key: decodeURIComponent(r.slice(0, eqIdx)),
          value: decodeURIComponent(r.slice(eqIdx + 1)),
          enabled: true,
        };
      });

    return { cleanUrl: base, params };
  } catch {
    return { cleanUrl: rawUrl, params: [] };
  }
}

function suggestName(url: string): string {
  try {
    const u = new URL(url.replace(/\{\{[^}]+\}\}/g, 'placeholder'));
    const segments = u.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && !/^\d+$/.test(last) && !last.startsWith('{')) {
      return last.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
    if (segments.length > 1) {
      return segments[segments.length - 2].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return u.hostname.replace(/^www\./, '').split('.')[0] ?? 'Request';
  } catch {
    return 'Request';
  }
}

// ─── Hardcoded-value detection ────────────────────────────────────────────────

function detectSuggestedVars(
  headers: Array<{ key: string; value: string }>,
  queryParams: Array<{ key: string; value: string }>,
  url: string
): Array<{ key: string; value: string }> {
  const vars: Array<{ key: string; value: string }> = [];
  const seen = new Set<string>();

  const add = (key: string, value: string): void => {
    if (!seen.has(value)) {
      seen.add(value);
      vars.push({ key, value });
    }
  };

  for (const h of headers) {
    const lk = h.key.toLowerCase();
    if (lk === 'authorization') {
      const m = h.value.match(/^(bearer|basic|token|digest)\s+(.+)$/i);
      if (m && looksLikeSecret(m[2])) {
        add(`${m[1].toUpperCase()}_TOKEN`, m[2]);
      } else if (looksLikeSecret(h.value)) {
        add('AUTH_TOKEN', h.value);
      }
    } else if (SENSITIVE_HEADER_NAMES.has(lk) && looksLikeSecret(h.value)) {
      add(toVarName(h.key), h.value);
    }
  }

  for (const q of queryParams) {
    if (SENSITIVE_QUERY_KEYS.has(q.key.toLowerCase()) && looksLikeSecret(q.value)) {
      add(toVarName(q.key), q.value);
    }
  }

  // Suggest BASE_URL for non-localhost URLs
  try {
    const u = new URL(url.replace(/\{\{[^}]+\}\}/g, 'placeholder'));
    const isLocal = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(u.hostname);
    if (!isLocal && !isForgeVar(url)) {
      const baseUrl = `${u.protocol}//${u.host}`;
      add('BASE_URL', baseUrl);
    }
  } catch { /* ignore */ }

  return vars;
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Parse a curl command string into a structured HTTP request definition.
 *
 * @param cmd - Full curl command including the `curl` prefix (e.g. `"curl -X POST ..."`)
 * @returns Parsed request with headers, query params, body, and suggested env variables.
 */
export function parseCurlCommand(cmd: string): ParsedCurlRequest {
  const tokens = tokenize(cmd.trim());

  // Skip the leading `curl` token
  let start = 0;
  while (start < tokens.length && tokens[start].toLowerCase() === 'curl') {
    start++;
  }
  const toks = tokens.slice(start);

  let method = '';
  let url = '';
  const rawHeaders: Array<{ key: string; value: string }> = [];
  let bodyContent: string | null = null;
  let bodyIsJson = false;
  let forceGet = false;
  const formFields: Array<{ key: string; value: string }> = [];
  const urlEncoded: string[] = [];

  let i = 0;
  while (i < toks.length) {
    const tok = toks[i];

    if (tok === '-X' || tok === '--request') {
      method = toks[++i] ?? '';
    } else if (tok === '-H' || tok === '--header') {
      const hdr = toks[++i] ?? '';
      const colon = hdr.indexOf(':');
      if (colon > 0) {
        rawHeaders.push({ key: hdr.slice(0, colon).trim(), value: hdr.slice(colon + 1).trim() });
      }
    } else if (
      tok === '-d' || tok === '--data' ||
      tok === '--data-raw' || tok === '--data-binary' || tok === '--data-ascii'
    ) {
      bodyContent = toks[++i] ?? '';
    } else if (tok === '--json') {
      bodyContent = toks[++i] ?? '';
      bodyIsJson = true;
    } else if (tok === '-u' || tok === '--user') {
      const creds = toks[++i] ?? '';
      const encoded = btoa(creds); // platform-independent base64
      rawHeaders.push({ key: 'Authorization', value: `Basic ${encoded}` });
    } else if (tok === '-b' || tok === '--cookie') {
      rawHeaders.push({ key: 'Cookie', value: toks[++i] ?? '' });
    } else if (tok === '--url') {
      url = toks[++i] ?? '';
    } else if (tok === '-G' || tok === '--get') {
      forceGet = true;
    } else if (tok === '-F' || tok === '--form') {
      const field = toks[++i] ?? '';
      const eqIdx = field.indexOf('=');
      if (eqIdx > 0) {
        formFields.push({ key: field.slice(0, eqIdx), value: field.slice(eqIdx + 1) });
      }
    } else if (tok === '--data-urlencode') {
      urlEncoded.push(toks[++i] ?? '');
    } else if (tok === '-A' || tok === '--user-agent') {
      rawHeaders.push({ key: 'User-Agent', value: toks[++i] ?? '' });
    } else if (tok === '-e' || tok === '--referer' || tok === '--referrer') {
      rawHeaders.push({ key: 'Referer', value: toks[++i] ?? '' });
    } else if (
      tok === '--compressed' || tok === '-L' || tok === '--location' ||
      tok === '-v' || tok === '--verbose' || tok === '-s' || tok === '--silent' ||
      tok === '-i' || tok === '--include' || tok === '-k' || tok === '--insecure' ||
      tok === '--http1.1' || tok === '--http2' || tok === '--http3'
    ) {
      // No-arg flags — ignored
    } else if (
      tok === '-o' || tok === '--output' || tok === '--max-time' ||
      tok === '--connect-timeout' || tok === '-m' || tok === '--limit-rate' ||
      tok === '--proxy' || tok === '-x'
    ) {
      i++; // Skip flag value
    } else if (!tok.startsWith('-') && !url) {
      url = tok;
    }

    i++;
  }

  // Determine final method
  if (forceGet) {
    method = 'GET';
  } else if (!method) {
    method = (bodyContent !== null || formFields.length > 0 || urlEncoded.length > 0) ? 'POST' : 'GET';
  }

  const { cleanUrl, params: queryParams } = extractQueryParams(url);

  // Build body
  let body: ParsedCurlRequest['body'] = null;

  if (formFields.length > 0) {
    const encoded = formFields
      .map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`)
      .join('&');
    body = { type: 'raw', format: 'text', content: encoded };
    if (!rawHeaders.some((h) => h.key.toLowerCase() === 'content-type')) {
      rawHeaders.push({ key: 'Content-Type', value: 'multipart/form-data' });
    }
  } else if (urlEncoded.length > 0) {
    body = { type: 'raw', format: 'text', content: urlEncoded.join('&') };
    if (!rawHeaders.some((h) => h.key.toLowerCase() === 'content-type')) {
      rawHeaders.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded' });
    }
  } else if (bodyContent !== null) {
    const trimmed = bodyContent.trim();
    const isJson = bodyIsJson || trimmed.startsWith('{') || trimmed.startsWith('[');
    body = { type: 'raw', format: isJson ? 'json' : 'text', content: bodyContent };
    if (isJson && !rawHeaders.some((h) => h.key.toLowerCase() === 'content-type')) {
      rawHeaders.push({ key: 'Content-Type', value: 'application/json' });
    }
  }

  const headers = rawHeaders.map((h) => ({ ...h, enabled: true }));
  const suggestedVars = detectSuggestedVars(rawHeaders, queryParams, cleanUrl || url);

  return {
    name: suggestName(cleanUrl || url),
    method: method.toUpperCase(),
    url: cleanUrl || url,
    headers,
    queryParams,
    body,
    suggestedVars,
  };
}
