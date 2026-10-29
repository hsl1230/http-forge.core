/**
 * API Architect (Phase 4 / Layer 8) — barrel.
 *
 * Exports the intent-driven API design service plus its pure helpers.
 */

export { ApiArchitectService, renderArchitectDocs, validateDesignedSpec } from './api-architect-service';
export type { ApiArchitectOptions, ApiArchitectResult } from './api-architect-service';
export { collectionToEndpoints } from './collection-to-endpoints';
export { buildArchitectPrompt } from './architect-prompt';
export type { ArchitectPromptOptions } from './architect-prompt';
