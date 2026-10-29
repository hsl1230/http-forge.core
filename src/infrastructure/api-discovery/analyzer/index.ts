/**
 * Analyzer barrel — ported subset of `node-api-forge/src/discovery/analyzer`.
 *
 * Express is the first ported framework (Phase 1 vertical slice). Fastify,
 * Lambda and external-call analysis are ported in a later pass.
 */
export {
  analyzeComponentChainMetadata,
  analyzeHandlerMetadata,
  combineConfidence,
  dedupeDiscoveredApiParameters,
  extractPathParameters,
} from './component-analyzer';
export type {
  ComponentAnalyzer,
  PrefixState,
  RouteDefinitionBase,
} from './component-analyzer';
export { ExpressComponentAnalyzer } from './express-component-analyzer';
export { FastifyComponentAnalyzer } from './fastify-component-analyzer';
export { LambdaComponentAnalyzer } from './lambda-component-analyzer';
