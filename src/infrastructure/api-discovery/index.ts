/**
 * API Discovery — public barrel.
 *
 * Phase 1 port target. The unified `DiscoveredApi` model and the
 * `ApiDiscoveryProvider` contract are the seam every framework provider
 * implements and every upstream layer (workflow, tests, maintenance, review)
 * consumes.
 */

export * from './types';
export * from './provider';
export { FrameworkDetector } from './framework-detector';
export { collectSourceFiles } from './source-files';
export { loadHybridSeedEndpoints } from './seed-loader';
export { resolveProjectName } from './project-name';
export { ExpressDiscoveryProvider } from './providers/express-discovery-provider';
export { FastifyDiscoveryProvider } from './providers/fastify-discovery-provider';
export { NestDiscoveryProvider } from './providers/nest-discovery-provider';
export { LambdaDiscoveryProvider, parseYamlToObject } from './providers/lambda-discovery-provider';
export { SpringDiscoveryProvider } from './spring/spring-discovery-provider';
export { FastApiDiscoveryProvider } from './fastapi/fastapi-discovery-provider';
export * from './analyzer';
export {
  buildDescription,
  endpointToCreateRequestOptions,
  endpointToName,
  endpointToRequestParts,
  schemaToExample,
} from './endpoint-to-request';
export type { CollectionRequestItem } from './endpoint-to-request';
export {
  generateSuiteFromEndpoints,
  suiteIdFromName,
  generateFlowFromEndpoints,
} from './test-generator';
export type {
  GenerateSuiteOptions,
  GenerateSuiteResult,
  GenerateFlowOptions,
} from './test-generator';
export {
  discoverWorkflows,
} from './workflow-discovery';
export type {
  WorkflowChain,
  WorkflowDiscoveryOptions,
  WorkflowDependent,
  WorkflowProducer,
} from './workflow-discovery';
export {
  applyRegenerated,
  computeProjectFreshness,
  detectIndexDrift,
  detectProjectDrift,
  diffLines,
  proposeSuiteUpdates,
  resolveRegenerated,
  threeWayDiff,
} from './drift-engine';
export type {
  DiffHunk,
  DiffLineType,
  DriftReport,
  DriftStatus,
  GeneratedSuite,
  ProjectDrift,
  ProjectFreshness,
  SuiteUpdateProposal,
  ThreeWayDiff,
} from './drift-engine';
export {
  ApiDiscoveryService,
} from './api-discovery-service';
export type {
  IApiDiscoveryService,
  ApiDiscoveryServiceOptions,
} from './api-discovery-service';
