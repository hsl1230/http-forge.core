/**
 * API Discovery — Service Orchestrator
 *
 * Single entry point for source-code discovery across all frameworks (plan §3.3).
 * Depends only on the `ApiDiscoveryProvider` abstraction and `IFileSystem`
 * (dependency inversion). Providers are injected — the service never constructs
 * them and never special-cases a framework (Open/Closed).
 *
 * Orchestration mirrors `node-api-forge/src/discovery/discovery-engine.ts`
 * (Phase 1 port): fingerprint → framework detection → eligible providers →
 * parallel discovery → seed merge → deterministic path-parameter enrichment →
 * dedupe + sort → git-native index (DECISIONS D12).
 */

import type { IFileSystem } from '../../types/platform';
import { enrichEndpointAuthAndValidation } from './auth-validation';
import { extractPathParameters } from './analyzer';
import { FrameworkDetector } from './framework-detector';
import {
  ApiDiscoveryProvider,
} from './provider';
import { loadHybridSeedEndpoints } from './seed-loader';
import { collectSourceFiles } from './source-files';
import {
  ApiFramework,
  DiscoveryContext,
  DiscoveryResult,
  DiscoveredApi,
  DiscoveredApiIndex,
  DiscoveredApiIndexProject,
  DiscoveryWarning,
  ParameterLocation,
} from './types';

export interface IApiDiscoveryService {
  discover(context: DiscoveryContext): Promise<DiscoveryResult>;
  getIndex(): DiscoveredApiIndex | undefined;
  getEndpoint(id: string): DiscoveredApi | undefined;
  invalidate(projectRoots?: string[]): void;
  persistIndex(index: DiscoveredApiIndex): Promise<void>;
}

export interface ApiDiscoveryServiceOptions {
  providers?: ApiDiscoveryProvider[];
  fileSystem?: IFileSystem;
  indexFilePath?: string;
  indexVersion?: string;
  detector?: FrameworkDetector;
}

const SORT_METHOD_ORDER: Record<string, number> = {
  GET: 0,
  POST: 1,
  PUT: 2,
  PATCH: 3,
  DELETE: 4,
  HEAD: 5,
  OPTIONS: 6,
};

function compareEndpoints(a: DiscoveredApi, b: DiscoveredApi): number {
  const methodOrder = (SORT_METHOD_ORDER[a.method.toUpperCase()] ?? 99)
    - (SORT_METHOD_ORDER[b.method.toUpperCase()] ?? 99);
  if (methodOrder !== 0) return methodOrder;
  const pathA = a.resolvedPath ?? a.pathExpression;
  const pathB = b.resolvedPath ?? b.pathExpression;
  if (pathA !== pathB) return pathA < pathB ? -1 : 1;
  if (a.source.filePath !== b.source.filePath) return a.source.filePath < b.source.filePath ? -1 : 1;
  return a.source.line - b.source.line;
}

export class ApiDiscoveryService implements IApiDiscoveryService {
  private readonly providers: ApiDiscoveryProvider[];
  private readonly fileSystem?: IFileSystem;
  private readonly indexFilePath?: string;
  private readonly indexVersion: string;
  private readonly detector: FrameworkDetector;
  private index?: DiscoveredApiIndex;

  constructor(options: ApiDiscoveryServiceOptions = {}) {
    this.providers = options.providers ?? [];
    this.fileSystem = options.fileSystem;
    this.indexFilePath = options.indexFilePath;
    this.indexVersion = options.indexVersion ?? '1';
    this.detector = options.detector ?? new FrameworkDetector();
  }

  public async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const startedAt = Date.now();
    const forceProviderAnalysis = Boolean(context.customSeedLoaderModulePath?.trim());
    const projectRoots = context.includeProjectRoots?.length
      ? context.includeProjectRoots
      : [context.workspaceFolder];

    const merged: DiscoveryResult = {
      endpoints: [],
      warnings: [],
      stats: {
        frameworksDetected: [],
        providersRun: [],
        endpointCount: 0,
        unresolvedEndpointCount: 0,
        scanDurationMs: 0,
      },
    };

    for (const projectRoot of projectRoots) {
      const fingerprint = this.detector.buildFingerprint(projectRoot);
      // Only pre-populate TS/JS source files when present; an empty set must
      // let framework-specific providers (Spring, FastAPI) fall back to their
      // own file collectors instead of inheriting a stub empty list.
      const collectedSourceFiles = collectSourceFiles(projectRoot);
      if (collectedSourceFiles.length > 0) {
        fingerprint.sourceFiles = collectedSourceFiles;
      }

      const frameworks = context.frameworksByProjectRoot?.[projectRoot]
        ?? this.detector.detectFrameworks(fingerprint);
      merged.stats.frameworksDetected.push(...frameworks);

      const eligible = this.providers.filter((provider) => {
        const frameworkMatch = provider.framework === 'unknown'
          || frameworks.includes('unknown')
          || frameworks.includes(provider.framework);
        if (!frameworkMatch) return false;
        const support = provider.supports(fingerprint);
        return support.supported || forceProviderAnalysis;
      });

      merged.stats.providersRun.push(...eligible.map((p) => p.id));

      const results = await Promise.all(
        eligible.map(async (provider) => {
          try {
            return await provider.discover(context, fingerprint);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const warning: DiscoveryWarning = {
              code: 'provider-failed',
              framework: provider.framework,
              message: `Provider ${provider.id} failed: ${message}`,
            };
            return {
              endpoints: [] as DiscoveredApi[],
              warnings: [warning],
              stats: {
                frameworksDetected: [] as ApiFramework[],
                providersRun: [] as string[],
                endpointCount: 0,
                unresolvedEndpointCount: 0,
                scanDurationMs: 0,
              },
            } as DiscoveryResult;
          }
        }),
      );

      for (const result of results) {
        for (const ep of result.endpoints) {
          ep.projectRoot = ep.projectRoot ?? projectRoot;
        }
        merged.endpoints.push(...result.endpoints);
        merged.warnings.push(...result.warnings);
      }

      const seed = loadHybridSeedEndpoints(projectRoot, context);
      merged.warnings.push(...seed.warnings);
      for (const seedEndpoint of seed.endpoints) {
        if (!seedEndpoint.projectRoot) seedEndpoint.projectRoot = projectRoot;
        const matched = merged.endpoints.find(
          (autoEndpoint) => this.endpointKey(autoEndpoint) === this.endpointKey(seedEndpoint),
        );
        if (!matched) {
          merged.endpoints.push(seedEndpoint);
          merged.warnings.push({
            code: 'seed-endpoint-unmatched',
            framework: seedEndpoint.framework,
            filePath: seedEndpoint.source.filePath,
            message: `Seed endpoint ${seedEndpoint.method} ${seedEndpoint.pathExpression} was not matched by auto-discovery and was kept as seed.`,
          });
          continue;
        }
        this.mergeSeedIntoEndpoint(matched, seedEndpoint);
      }
    }

    // Deterministic path-parameter extraction from the route pattern (regex only).
    for (const endpoint of merged.endpoints) {
      enrichEndpointPathParameters(endpoint);
    }

    // Auth + validation convergence: derive structured fields from middleware
    // names / JSON Schema constraints where the providers did not emit them.
    for (const endpoint of merged.endpoints) {
      enrichEndpointAuthAndValidation(endpoint);
    }

    const sorted = this.dedupeAndSort(merged.endpoints);
    for (const endpoint of sorted) {
      endpoint.id = deterministicEndpointId(endpoint);
    }

    merged.endpoints = sorted;
    merged.stats.frameworksDetected = Array.from(
      new Set(merged.stats.frameworksDetected),
    );
    merged.stats.providersRun = Array.from(new Set(merged.stats.providersRun));
    merged.stats.endpointCount = merged.endpoints.length;
    merged.stats.unresolvedEndpointCount = merged.endpoints.filter(
      (ep) => !ep.resolvedPath,
    ).length;
    merged.stats.scanDurationMs = Date.now() - startedAt;

    this.index = this.buildIndex(merged.endpoints, projectRoots, new Date());
    return merged;
  }

  public getIndex(): DiscoveredApiIndex | undefined {
    return this.index;
  }

  public getEndpoint(id: string): DiscoveredApi | undefined {
    if (!this.index) return undefined;
    for (const project of this.index.projects) {
      const found = project.endpoints.find((ep) => ep.id === id);
      if (found) return found;
    }
    return undefined;
  }

  public invalidate(projectRoots?: string[]): void {
    if (!projectRoots || projectRoots.length === 0) {
      this.index = undefined;
      for (const provider of this.providers) {
        provider.clearCache?.();
      }
      return;
    }
    for (const provider of this.providers) {
      for (const root of projectRoots) {
        provider.clearCache?.(root);
      }
    }
  }

  public async persistIndex(index: DiscoveredApiIndex): Promise<void> {
    if (!this.fileSystem || !this.indexFilePath) {
      throw new Error('ApiDiscoveryService.persistIndex requires fileSystem + indexFilePath');
    }
    await this.fileSystem.writeFile(
      this.indexFilePath,
      `${JSON.stringify(index, null, 2)}\n`,
    );
  }

  private endpointKey(endpoint: { method: string; resolvedPath?: string; pathExpression: string }): string {
    const resolvedPath = endpoint.resolvedPath ?? endpoint.pathExpression;
    return `${endpoint.method.toUpperCase()}::${resolvedPath}`;
  }

  private mergeSeedIntoEndpoint(target: DiscoveredApi, seed: DiscoveredApi): void {
    target.description = target.description ?? seed.description;

    if (!target.source?.filePath && seed.source?.filePath) {
      target.source = seed.source;
    }

    if (!target.middleware || target.middleware.length === 0) {
      target.middleware = seed.middleware;
      return;
    }

    const existing = new Set(target.middleware.map((item) => item.name));
    for (const middleware of seed.middleware ?? []) {
      if (!existing.has(middleware.name)) {
        target.middleware.push(middleware);
      }
    }
  }

  private buildIndex(
    endpoints: DiscoveredApi[],
    projectRoots: string[],
    now: Date,
  ): DiscoveredApiIndex {
    const projects: DiscoveredApiIndexProject[] = projectRoots.map((root) => {
      const projectEndpoints = endpoints
        .filter((ep) => (ep.projectRoot ?? root) === root)
        .sort(compareEndpoints);
      return {
        projectRoot: root,
        frameworks: Array.from(new Set(projectEndpoints.map((ep) => ep.framework))),
        freshness: {
          scannedAt: now.toISOString(),
        },
        endpoints: projectEndpoints,
      };
    });
    return {
      version: this.indexVersion,
      generatedAt: now.toISOString(),
      projects,
    };
  }

  private dedupeAndSort(endpoints: DiscoveredApi[]): DiscoveredApi[] {
    const seen = new Set<string>();
    const unique: DiscoveredApi[] = [];
    for (const ep of endpoints) {
      const key = `${ep.framework}:${ep.method.toUpperCase()}:${ep.resolvedPath ?? ep.pathExpression}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(ep);
    }
    return unique.sort(compareEndpoints);
  }
}

function enrichEndpointPathParameters(endpoint: DiscoveredApi): void {
  const routePattern = endpoint.resolvedPath ?? endpoint.pathExpression;
  if (!routePattern) {
    return;
  }

  const existing = new Set<string>();
  for (const parameter of endpoint.params ?? []) {
    existing.add(parameterKey(parameter.location, parameter.name));
  }

  const fromRoute = extractPathParameters(routePattern);
  if (fromRoute.length === 0) {
    return;
  }

  const additions: DiscoveredApi['params'] = [];
  for (const parameter of fromRoute) {
    const key = parameterKey(parameter.location, parameter.name);
    if (existing.has(key)) {
      continue;
    }

    existing.add(key);
    additions.push(parameter);
  }

  if (additions.length > 0) {
    endpoint.params = [...(endpoint.params ?? []), ...additions];
  }
}

function parameterKey(location: ParameterLocation, name: string): string {
  return `${location}:${name.toLowerCase()}`;
}

function deterministicEndpointId(endpoint: DiscoveredApi): string {
  return `${endpoint.framework}:${endpoint.method.toUpperCase()}:${endpoint.resolvedPath ?? endpoint.pathExpression}:${endpoint.source.filePath}:${endpoint.source.line}`;
}
