/**
 * Shared helpers for direct execution.
 *
 * Small, cohesive utilities used by both the public entry points
 * (`direct-execution.ts`) and the suite flow engine (`suite-executor.ts`):
 * env-flag parsing, request conversion, override application, auth
 * inheritance, redaction wrappers, and container disposal.
 */

import type { ServiceContainer } from '../di/service-container';
import { redactCookies, redactHeaders } from '../infrastructure/security/sensitive-data-redactor';
import type { CollectionRequest } from '../types/collection';
import type { ExecutionRequest, RequestAuth, RequestType } from '../types/types';

export function disposeContainerResources(container: ServiceContainer): void {
  const disposables: Array<unknown> = [
    container.testSuite,
    container.collection,
    container.environmentConfig,
    container.config,
    container.console,
  ];

  for (const disposable of disposables) {
    try {
      (disposable as { dispose?: () => void })?.dispose?.();
    } catch {
      // Best-effort cleanup only.
    }
  }
}

export function isEnabled(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/**
 * Transport-aware success check for run summaries.
 *
 * A successful WebSocket handshake is HTTP 101 (Switching Protocols), which
 * falls outside the 2xx range used for HTTP requests. Suite/direct reporting
 * must not label a working WebSocket run as failed.
 */
export function isSuccessfulExecutionStatus(
  status: number | undefined,
  requestType?: RequestType
): boolean {
  const code = status ?? 0;
  if (requestType === 'websocket') {
    return code === 101;
  }
  return code >= 200 && code < 300;
}

export function shouldEnforceMaxRequests(): boolean {
  // CI-safe default: disabled unless explicitly enabled.
  return isEnabled(process.env.HTTP_FORGE_ENFORCE_MAX_REQUESTS);
}

export function getDirectMaxRequestsLimit(): number {
  const raw = process.env.HTTP_FORGE_MAX_REQUESTS;
  if (!raw || raw.trim() === '') {
    // Keep previous practical behavior when enforcement is enabled.
    return 50;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('HTTP_FORGE_MAX_REQUESTS must be a positive number when provided');
  }

  return Math.floor(parsed);
}

export function shouldGenerateReports(include: string[], reporters: string[] = []): boolean {
  // CI-safe default: disabled unless explicitly enabled.
  if (isEnabled(process.env.HTTP_FORGE_GENERATE_REPORTS)) return true;
  if (reporters.includes('html')) return true;
  return include.includes('report');
}

export function tryParseJson(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

function withoutSetCookie(headers: Record<string, string | string[]> | undefined): Record<string, string | string[]> {
  if (!headers) return {};
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'set-cookie')
  );
}

export function getRedactedResponseHeaders(headers: Record<string, string | string[]> | undefined): Record<string, string | string[]> {
  return redactHeaders(withoutSetCookie(headers));
}

export function getRedactedCookies(cookies: Array<{ name: string; value: string }> | undefined): Array<{ name?: string; value?: string }> {
  return redactCookies((cookies ?? []).map(c => ({ name: c.name, value: c.value })));
}

export function sanitizeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function toExecutionRequest(req: CollectionRequest): ExecutionRequest {
  const allowedAuthTypes = ['none', 'inherit', 'basic', 'bearer', 'apikey', 'oauth2'] as const;
  const authType = (req.auth?.type && (allowedAuthTypes as readonly string[]).includes(req.auth.type))
    ? (req.auth.type as 'none' | 'inherit' | 'basic' | 'bearer' | 'apikey' | 'oauth2')
    : undefined;

  return {
    id: req.id,
    name: req.name,
    requestType: req.requestType,
    method: req.method,
    url: req.url,
    websocket: req.websocket,
    headers: Array.isArray(req.headers)
      ? req.headers.reduce<Record<string, string>>((acc, h: any) => {
        if (h.enabled && h.key) acc[h.key] = h.value ?? '';
        return acc;
      }, {})
      : req.headers as unknown as Record<string, string> | undefined,
    query: Array.isArray(req.query)
      ? req.query.reduce<Record<string, string>>((acc, p: any) => {
        if (p.enabled && p.key) acc[p.key] = p.value ?? '';
        return acc;
      }, {})
      : req.query as unknown as Record<string, string> | undefined,
    params: req.params
      ? Object.entries(req.params).reduce<Record<string, string>>((acc, [key, value]) => {
        acc[key] = typeof value === 'string' ? value : ((value as any).value ?? '');
        return acc;
      }, {})
      : undefined,
    body: req.body ?? null,
    scripts: req.scripts,
    settings: req.settings,
    auth: {
      type: authType === 'inherit' ? 'none' : authType,
      bearerToken: req.auth?.bearerToken,
      basicAuth: req.auth?.basicAuth,
      apikey: req.auth?.apikey,
      oauth2: req.auth?.oauth2
    }
  };
}

export function applyOverrides(base: ExecutionRequest, args: Record<string, unknown>): ExecutionRequest {
  const overridden = { ...base };

  if (args.headers) {
    overridden.headers = { ...(base.headers ?? {}), ...(args.headers as Record<string, string>) };
  }
  if (args.query) {
    overridden.query = args.query as Record<string, string>;
  }
  if (args.body !== undefined) {
    overridden.body = { type: 'raw', format: 'json', content: args.body as string };
  }

  return overridden;
}

export function toStringRecord(input?: Record<string, unknown>): Record<string, string> {
  if (!input) return {};
  return Object.fromEntries(
    Object.entries(input).map(([k, v]) => [k, String(v)])
  );
}

export function resolveInheritedAuth(
  requestAuth: RequestAuth | undefined,
  folderAuthChain: RequestAuth[],
  collectionAuth: RequestAuth | undefined
): RequestAuth | undefined {
  if (requestAuth && requestAuth.type && requestAuth.type !== 'inherit') {
    return requestAuth.type === 'none' ? undefined : requestAuth;
  }

  for (let index = folderAuthChain.length - 1; index >= 0; index--) {
    const auth = folderAuthChain[index];
    if (auth?.type && auth.type !== 'inherit') {
      return auth.type === 'none' ? undefined : auth;
    }
  }

  if (collectionAuth && collectionAuth.type && collectionAuth.type !== 'inherit') {
    return collectionAuth.type === 'none' ? undefined : collectionAuth;
  }

  return undefined;
}
