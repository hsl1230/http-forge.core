/**
 * API Discovery — Core Domain Types
 *
 * The unified, platform-agnostic model for source-code API discovery (plan §3.2).
 * This is a SUPERSET of the models used by the `node-api-forge` and
 * `spring-api-tester` extensions. Every layer above discovery (workflow, test
 * generation, maintenance, review) depends on THIS shape and nothing else.
 *
 * Rules (DECISIONS D4/D5/D11):
 * - provenance (`source`) and `confidence` are mandatory on every endpoint.
 * - deterministic ordering; no timestamps inside endpoint records.
 * - structured `JsonSchema` preferred over string hints for body/response.
 */

// ─── Framework & confidence ───────────────────────────────────────────────────

export type ApiFramework =
  | 'express'
  | 'nestjs'
  | 'fastify'
  | 'lambda'
  | 'spring'
  | 'fastapi'
  | 'unknown';

export type EndpointConfidence = 'high' | 'medium' | 'low';

// ─── Provenance ───────────────────────────────────────────────────────────────

export interface SourceLocation {
  filePath: string;
  line: number;
  column?: number;
  symbolName?: string;
  accessMode?: 'read' | 'write';
}

// ─── Schema (minimal, ajv-compatible JSON Schema subset) ─────────────────────

export type JsonSchema = Record<string, unknown>;

// ─── Parameters ───────────────────────────────────────────────────────────────

export type ParameterLocation =
  | 'path'
  | 'query'
  | 'header'
  | 'cookie'
  | 'body'
  | 'form'
  | 'locals'
  | (string & {});

export interface DiscoveredApiParameter {
  name: string;
  location: ParameterLocation;
  type?: string;
  required?: boolean;
  description?: string;
  example?: string;
  schema?: JsonSchema;
  detectionLocation?: SourceLocation;
  evidenceLocations?: SourceLocation[];
  conflictingTypes?: string[];
}

// ─── Body / response / auth / middleware ──────────────────────────────────────

export interface DiscoveredApiBody {
  type?: 'json' | 'form' | 'text' | 'multipart' | 'graphql' | string;
  schema?: JsonSchema;
  required?: boolean;
  example?: unknown;
  detectionLocation?: SourceLocation;
}

export interface DiscoveredApiResponse {
  statusCode?: number;
  headers?: DiscoveredApiParameter[];
  body?: { type?: string; schema?: JsonSchema };
}

export interface DiscoveredApiAuth {
  required: boolean;
  type?: 'jwt' | 'basic' | 'oauth2' | 'cookie' | 'apiKey' | (string & {});
  /** @Secured, @PreAuthorize, passport strategy, firewall rules, etc. */
  annotation?: string;
  detectionLocation?: SourceLocation;
}

export interface DiscoveredApiMiddleware {
  name: string;
  location?: SourceLocation;
}

export interface DiscoveredApiCookie {
  name: string;
  type?: 'request' | 'response';
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
  detectionLocation?: SourceLocation;
}

// ─── Endpoint (the normalized model) ──────────────────────────────────────────

export interface DiscoveredApi {
  id: string;
  framework: ApiFramework;
  method: string;
  pathExpression: string;
  resolvedPath?: string;
  source: SourceLocation;
  confidence: EndpointConfidence;
  requestBody?: DiscoveredApiBody;
  params?: DiscoveredApiParameter[];
  /** Summarized validation rules: @Valid, joi/zod/class-validator, etc. */
  validation?: string[];
  auth?: DiscoveredApiAuth;
  responseModels?: JsonSchema[];
  responses?: DiscoveredApiResponse[];
  cookies?: DiscoveredApiCookie[];
  middleware?: DiscoveredApiMiddleware[];
  tags?: string[];
  projectName?: string;
  projectRoot?: string;
  deprecated?: boolean;
  description?: string;
}

// ─── Discovery context / result ───────────────────────────────────────────────

export interface DiscoveryContext {
  workspaceFolder: string;
  includeProjectRoots?: string[];
  frameworksByProjectRoot?: Record<string, ApiFramework[]>;
  /** Overrides for `process.env.*` resolution during path/route parsing (see envOverrides). */
  envOverrides?: Record<string, string>;
  /** Absolute path to a custom seed loader module; only active when set (see seed-loader). */
  customSeedLoaderModulePath?: string;
  /**
   * Sub-property names on request/response objects to track as shared context.
   * Defaults to `["locals"]` (Express `res.locals` convention).
   */
  contextProperties?: string[];
  /** Skip per-endpoint component dependency traversal; call enrichEndpoint() on demand. */
  skipComponentAnalysis?: boolean;
}

export interface DiscoveryWarning {
  code:
    | 'provider-not-supported'
    | 'provider-failed'
    | 'dynamic-path-unresolved'
    | 'parameter-type-conflict'
    | 'component-dependency-limit-reached'
    | 'seed-manifest-invalid'
    | 'seed-endpoint-unmatched'
    | 'seed-loader-failed'
    | 'project-fingerprint-missing'
    | (string & {});
  message: string;
  framework?: ApiFramework;
  filePath?: string;
}

export interface DiscoveryStats {
  frameworksDetected: ApiFramework[];
  providersRun: string[];
  endpointCount: number;
  unresolvedEndpointCount: number;
  scanDurationMs: number;
}

export interface DiscoveryResult {
  endpoints: DiscoveredApi[];
  warnings: DiscoveryWarning[];
  stats: DiscoveryStats;
}

// ─── Framework fingerprint (provider input) ───────────────────────────────────

export interface FrameworkFingerprint {
  projectRoot: string;
  packageJsonPath?: string;
  packageJson?: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  evidenceFiles: string[];
  /** Pre-collected source files, shared across providers in one run. */
  sourceFiles?: string[];
}

// ─── Git-native index (plan §3.3, DECISIONS D12) ──────────────────────────────

export interface DiscoveredApiIndex {
  version: string;
  generatedAt: string;
  projects: DiscoveredApiIndexProject[];
}

export interface DiscoveredApiIndexProject {
  projectRoot: string;
  frameworks: ApiFramework[];
  /** Freshness metadata for drift detection (mtime + git hash where available). */
  freshness: {
    gitHash?: string;
    scannedAt: string;
  };
  endpoints: DiscoveredApi[];
}
