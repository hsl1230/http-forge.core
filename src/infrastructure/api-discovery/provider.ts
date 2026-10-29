/**
 * API Discovery — Provider Contract
 *
 * One provider per framework (Express, NestJS, Fastify, Lambda, Spring, FastAPI).
 * New frameworks are additive: implement this interface and register it — never
 * modify `ApiDiscoveryService` to special-case a framework (Open/Closed).
 *
 * Ported from `node-api-forge/src/discovery/provider.ts` (unchanged semantics).
 */

import {
  DiscoveryContext,
  DiscoveryResult,
  FrameworkFingerprint,
  ApiFramework,
} from './types';

export interface ProviderSupport {
  supported: boolean;
  confidence: number;
  reasons: string[];
}

export interface ApiDiscoveryProvider {
  readonly id: string;
  /** The framework this provider parses. Used to filter providers by detection. */
  readonly framework: ApiFramework;

  /** Whether this provider can parse the given project root (cheap check). */
  supports(fingerprint: FrameworkFingerprint): ProviderSupport;

  /**
   * Discover endpoints for one project root. Must return deterministic ordering
   * (method asc, path asc, file asc) — see DECISIONS D11.
   */
  discover(
    context: DiscoveryContext,
    fingerprint: FrameworkFingerprint,
  ): Promise<DiscoveryResult>;

  /** Release per-project caches (e.g. after a file change or refresh). */
  clearCache?(projectRoot?: string): void;
}
