import * as path from 'path';
import { DiscoveredApi } from '../../infrastructure/api-discovery';

const SORT_METHOD_ORDER: Record<string, number> = {
  GET: 0,
  POST: 1,
  PUT: 2,
  PATCH: 3,
  DELETE: 4,
  HEAD: 5,
  OPTIONS: 6,
};

/**
 * Golden normalization (see test-fixtures/README.md).
 * 1. Sort: method asc, resolved path asc, source file asc, line asc.
 * 2. Strip volatile fields: id, projectRoot, projectName.
 * 3. Relativize every absolute filePath against the fixture root (source,
 *    detection/evidence locations) so absolute workspace paths never leak.
 * 4. Drop undefined-valued keys so the result matches JSON parsed from disk.
 */
export function normalizeForGolden(
  endpoints: DiscoveredApi[],
  projectRoot: string,
): unknown[] {
  const sorted = [...endpoints].sort(compareForGolden);
  return sorted.map((ep) => normalizeEndpoint(ep, projectRoot));
}

function compareForGolden(a: DiscoveredApi, b: DiscoveredApi): number {
  const methodOrder = (SORT_METHOD_ORDER[a.method.toUpperCase()] ?? 99)
    - (SORT_METHOD_ORDER[b.method.toUpperCase()] ?? 99);
  if (methodOrder !== 0) return methodOrder;
  const pathA = a.resolvedPath ?? a.pathExpression;
  const pathB = b.resolvedPath ?? b.pathExpression;
  if (pathA !== pathB) return pathA < pathB ? -1 : 1;
  if (a.source.filePath !== b.source.filePath) {
    return a.source.filePath < b.source.filePath ? -1 : 1;
  }
  return a.source.line - b.source.line;
}

function normalizeEndpoint(ep: DiscoveredApi, projectRoot: string): unknown {
  const { id, projectRoot: _projectRoot, projectName, ...rest } = ep;
  return relativizeFilePaths(stripUndefined({ ...rest }), projectRoot);
}

/** Recursively relativize any `filePath` string that is absolute under projectRoot. */
function relativizeFilePaths(value: unknown, projectRoot: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => relativizeFilePaths(item, projectRoot));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === 'filePath' && typeof child === 'string') {
        result[key] = relativizePath(child, projectRoot);
      } else {
        result[key] = relativizeFilePaths(child, projectRoot);
      }
    }
    return result;
  }
  return value;
}

function relativizePath(filePath: string, projectRoot: string): string {
  const relative = path.relative(projectRoot, filePath);
  const normalized = relative.split(path.sep).join('/');
  return normalized.startsWith('..') ? filePath : normalized;
}

/** Recursively drop properties whose value is `undefined` (JSON-stable compare). */
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefined(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue;
      result[key] = stripUndefined(child);
    }
    return result;
  }
  return value;
}
