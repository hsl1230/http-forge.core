/**
 * Auth + validation enrichment for discovered endpoints.
 *
 * Phase 1 convergence gap (plan §2): the ported node providers captured
 * middleware names but never emitted the structured `auth` / `validation`
 * fields on DiscoveredApi. These helpers derive both from data the providers
 * already collect, deterministically:
 *
 *   - `auth` from middleware names (jwt/passport/guard/authenticate/…)
 *   - `validation` from middleware names (zod/joi/validat/schema/…)
 *     and from JSON Schema constraint keywords (FastAPI/Pydantic).
 *
 * Applied centrally in ApiDiscoveryService so every provider converges on one
 * implementation. Metadata-only — never affects run_request execution.
 */

import type {
  DiscoveredApi,
  DiscoveredApiAuth,
  DiscoveredApiMiddleware,
} from './types';

export type JsonSchema = Record<string, unknown>;

const AUTH_MIDDLEWARE_HINTS =
  /(authenticate|authorization|authorise|authorize|requireauth|protect|secured?|guards?|jwt|passport|bearer|token|oauth|sso|auth0|session|basic|apikey|api[_-]?key|firebase|cognito|keycloak|casbin)/i;

const AUTH_TYPE_HINTS: Array<{ re: RegExp; type: NonNullable<DiscoveredApiAuth['type']> }> = [
  { re: /jwt|token|bearer|passport|firebase|cognito|keycloak|casbin/i, type: 'jwt' },
  { re: /oauth|sso|auth0/i, type: 'oauth2' },
  { re: /basic/i, type: 'basic' },
  { re: /apikey|api[_-]?key/i, type: 'apiKey' },
  { re: /session|cookie/i, type: 'cookie' },
];

const VALIDATION_MIDDLEWARE_HINTS =
  /(validat|schema|sanitiz|zod|joi|yup|ajv|express-validator|class-validator|validationpipe|dto)/i;

/**
 * Derive auth metadata from middleware names. Returns undefined when no
 * middleware reads as auth-related so callers keep the field unset.
 */
export function inferAuthFromMiddleware(
  middleware?: DiscoveredApiMiddleware[]
): DiscoveredApiAuth | undefined {
  if (!middleware || middleware.length === 0) return undefined;
  const matching = middleware.filter((m) => AUTH_MIDDLEWARE_HINTS.test(m.name));
  if (matching.length === 0) return undefined;
  const joined = matching.map((m) => m.name).join(' ');
  const hit = AUTH_TYPE_HINTS.find((h) => h.re.test(joined));
  return {
    required: true,
    type: hit?.type,
    annotation: matching.map((m) => m.name).join(', '),
  };
}

/**
 * Derive summarized validation rules from middleware names (Nest ValidationPipe,
 * Express validator chains, Fastify schema options, Lambda middy validators).
 */
export function inferValidationFromMiddleware(
  middleware?: DiscoveredApiMiddleware[]
): string[] | undefined {
  if (!middleware || middleware.length === 0) return undefined;
  const found = middleware
    .filter((m) => VALIDATION_MIDDLEWARE_HINTS.test(m.name))
    .map((m) => m.name);
  if (found.length === 0) return undefined;
  return [...new Set(found)];
}

/**
 * Derive summarized validation rules from a JSON Schema's constraint keywords
 * (Pydantic → JSON Schema in FastAPI). Returns undefined when no constraints.
 */
export function inferValidationFromJsonSchema(
  schema: JsonSchema | undefined
): string[] | undefined {
  if (!schema || typeof schema !== 'object') return undefined;
  const rules: string[] = [];
  if (Array.isArray(schema.required) && (schema.required as unknown[]).length > 0) {
    rules.push('required fields');
  }
  const props = schema.properties as Record<string, unknown> | undefined;
  if (props && typeof props === 'object') {
    for (const [name, prop] of Object.entries(props)) {
      if (!prop || typeof prop !== 'object') continue;
      const p = prop as Record<string, unknown>;
      if (p.minLength !== undefined) rules.push(`${name}: minLength=${String(p.minLength)}`);
      if (p.maxLength !== undefined) rules.push(`${name}: maxLength=${String(p.maxLength)}`);
      if (p.minimum !== undefined) rules.push(`${name}: minimum=${String(p.minimum)}`);
      if (p.maximum !== undefined) rules.push(`${name}: maximum=${String(p.maximum)}`);
      if (p.pattern !== undefined) rules.push(`${name}: pattern`);
      if (p.format !== undefined) rules.push(`${name}: format=${String(p.format)}`);
      if (p.enum !== undefined) rules.push(`${name}: enum(${Array.isArray(p.enum) ? p.enum.length : '1'} values)`);
    }
  }
  return rules.length > 0 ? rules : undefined;
}

/** Combined enrichment applied to every merged endpoint. */
export function enrichEndpointAuthAndValidation(endpoint: DiscoveredApi): void {
  if (!endpoint.auth) {
    endpoint.auth = inferAuthFromMiddleware(endpoint.middleware);
  }
  if (!endpoint.validation) {
    endpoint.validation =
      inferValidationFromMiddleware(endpoint.middleware) ??
      inferValidationFromJsonSchema(endpoint.requestBody?.schema);
  }
}
