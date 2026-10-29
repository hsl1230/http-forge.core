import { describe, expect, it } from 'vitest';
import {
  enrichEndpointAuthAndValidation,
  inferAuthFromMiddleware,
  inferValidationFromJsonSchema,
  inferValidationFromMiddleware,
} from '../../infrastructure/api-discovery/auth-validation';
import type { DiscoveredApi } from '../../infrastructure/api-discovery/types';

describe('inferAuthFromMiddleware', () => {
  it('maps jwt/passport middleware to auth type jwt', () => {
    const auth = inferAuthFromMiddleware([
      { name: 'passport.authenticate("jwt")', location: { filePath: 'a.ts', line: 1 } },
      { name: 'expressJwt', location: { filePath: 'a.ts', line: 1 } },
    ]);
    expect(auth).toEqual({
      required: true,
      type: 'jwt',
      annotation: 'passport.authenticate("jwt"), expressJwt',
    });
  });

  it('flags UseGuards as auth (type inferred only from recognizable hints)', () => {
    const auth = inferAuthFromMiddleware([{ name: 'UseGuards:AuthGuard', location: { filePath: 'a.ts', line: 1 } }]);
    expect(auth?.required).toBe(true);
    expect(auth?.type).toBeUndefined();
    expect(auth?.annotation).toBe('UseGuards:AuthGuard');
  });

  it('maps oauth/sso to oauth2 and api key hints to apiKey', () => {
    expect(inferAuthFromMiddleware([{ name: 'oauth2', location: { filePath: 'a.ts', line: 1 } }])?.type).toBe('oauth2');
    expect(inferAuthFromMiddleware([{ name: 'apiKeyAuth', location: { filePath: 'a.ts', line: 1 } }])?.type).toBe('apiKey');
  });

  it('returns undefined for non-auth middleware', () => {
    expect(inferAuthFromMiddleware([{ name: 'cors', location: { filePath: 'a.ts', line: 1 } }])).toBeUndefined();
    expect(inferAuthFromMiddleware([])).toBeUndefined();
    expect(inferAuthFromMiddleware(undefined)).toBeUndefined();
  });
});

describe('inferValidationFromMiddleware', () => {
  it('collects validation middleware names (deduped)', () => {
    expect(
      inferValidationFromMiddleware([
        { name: 'validate', location: { filePath: 'a.ts', line: 1 } },
        { name: 'ValidationPipe', location: { filePath: 'a.ts', line: 1 } },
        { name: 'validate', location: { filePath: 'a.ts', line: 1 } },
        { name: 'cors', location: { filePath: 'a.ts', line: 1 } },
      ])
    ).toEqual(['validate', 'ValidationPipe']);
  });

  it('returns undefined when none match', () => {
    expect(inferValidationFromMiddleware([{ name: 'cors', location: { filePath: 'a.ts', line: 1 } }])).toBeUndefined();
  });
});

describe('inferValidationFromJsonSchema', () => {
  it('summarizes required/format/min/max/pattern/enum constraints', () => {
    const rules = inferValidationFromJsonSchema({
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'integer', format: 'int64' },
        name: { type: 'string', minLength: 1, maxLength: 50 },
        status: { type: 'string', enum: ['active', 'paused'] },
        code: { type: 'string', pattern: '^[A-Z]{2}$' },
        qty: { type: 'integer', minimum: 0, maximum: 100 },
      },
    });
    expect(rules).toContain('required fields');
    expect(rules).toContain('id: format=int64');
    expect(rules).toContain('name: minLength=1');
    expect(rules).toContain('name: maxLength=50');
    expect(rules).toContain('status: enum(2 values)');
    expect(rules).toContain('code: pattern');
    expect(rules).toContain('qty: minimum=0');
    expect(rules).toContain('qty: maximum=100');
  });

  it('returns undefined for schemas without constraints', () => {
    expect(inferValidationFromJsonSchema({ type: 'object', properties: { name: { type: 'string' } } })).toBeUndefined();
    expect(inferValidationFromJsonSchema(undefined)).toBeUndefined();
  });
});

describe('enrichEndpointAuthAndValidation', () => {
  it('sets auth + validation from middleware when absent', () => {
    const ep: DiscoveredApi = {
      method: 'GET',
      path: '/users',
      middleware: [
        { name: 'requireAuth', filePath: 'x.ts' },
        { name: 'validate', filePath: 'x.ts' },
      ],
    } as unknown as DiscoveredApi;
    enrichEndpointAuthAndValidation(ep);
    expect(ep.auth?.required).toBe(true);
    expect(ep.validation).toEqual(['validate']);
  });

  it('prefers JSON-schema validation when no validation middleware exists', () => {
    const ep = {
      method: 'POST',
      path: '/users',
      middleware: [{ name: 'cors', filePath: 'x.ts' }],
      requestBody: {
        schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      },
    } as unknown as DiscoveredApi;
    enrichEndpointAuthAndValidation(ep);
    expect(ep.validation).toContain('required fields');
    expect(ep.auth).toBeUndefined();
  });

  it('does not overwrite explicit auth/validation values', () => {
    const ep = {
      method: 'GET',
      path: '/x',
      auth: { required: false },
      validation: ['custom rule'],
      middleware: [{ name: 'requireAuth', filePath: 'x.ts' }],
    } as unknown as DiscoveredApi;
    enrichEndpointAuthAndValidation(ep);
    expect(ep.auth).toEqual({ required: false });
    expect(ep.validation).toEqual(['custom rule']);
  });
});
