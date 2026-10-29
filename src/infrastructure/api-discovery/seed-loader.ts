import * as fs from 'fs';
import * as path from 'path';
import { DiscoveredApi, DiscoveryContext, DiscoveryWarning } from './types';

/**
 * Loads seed endpoints from an optional custom loader module.
 *
 * Ported from `node-api-forge/src/discovery/seed-loader.ts`. Only active when
 * `context.customSeedLoaderModulePath` is set (hybrid seed + auto-discovery).
 */
export function loadHybridSeedEndpoints(
  projectRoot: string,
  context: DiscoveryContext
): { endpoints: DiscoveredApi[]; warnings: DiscoveryWarning[] } {
  const modulePathSetting = context.customSeedLoaderModulePath?.trim();
  if (!modulePathSetting) {
    return { endpoints: [], warnings: [] };
  }

  const resolvedModulePath = path.isAbsolute(modulePathSetting)
    ? modulePathSetting
    : path.join(projectRoot, modulePathSetting);

  if (!fs.existsSync(resolvedModulePath)) {
    return {
      endpoints: [],
      warnings: [
        {
          code: 'seed-loader-failed',
          filePath: resolvedModulePath,
          message: `Custom seed loader module not found: ${resolvedModulePath}`
        }
      ]
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require(resolvedModulePath) as {
      loadSeedManifestEndpoints?: (
        currentProjectRoot: string,
        discoveryContext: DiscoveryContext
      ) => { endpoints?: DiscoveredApi[]; warnings?: DiscoveryWarning[] } | DiscoveredApi[];
      default?: (
        currentProjectRoot: string,
        discoveryContext: DiscoveryContext
      ) => { endpoints?: DiscoveredApi[]; warnings?: DiscoveryWarning[] } | DiscoveredApi[];
    };

    const loader = loaded.loadSeedManifestEndpoints ?? loaded.default;
    if (typeof loader !== 'function') {
      return {
        endpoints: [],
        warnings: [
          {
            code: 'seed-loader-failed',
            filePath: resolvedModulePath,
            message: `Custom seed loader module must export a function named loadSeedManifestEndpoints or a default function.`
          }
        ]
      };
    }

    const result = loader(projectRoot, context);
    if (Array.isArray(result)) {
      return { endpoints: result, warnings: [] };
    }

    return {
      endpoints: result?.endpoints ?? [],
      warnings: result?.warnings ?? []
    };
  } catch (error) {
    return {
      endpoints: [],
      warnings: [
        {
          code: 'seed-loader-failed',
          filePath: resolvedModulePath,
          message: `Custom seed loader failed at ${resolvedModulePath}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}
