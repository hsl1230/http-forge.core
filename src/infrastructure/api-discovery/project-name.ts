import { DiscoveredApi } from './types';

export function resolveProjectName(endpoint: DiscoveredApi, projectRoots: string[]): string | undefined {
  const explicitProjectName = endpoint.projectName?.trim();
  if (explicitProjectName) {
    return explicitProjectName;
  }

  const handlerPath = normalizePath(endpoint.source.filePath);
  const aglProjectName = extractAglConfigProjectName(handlerPath);
  if (aglProjectName) {
    return aglProjectName;
  }

  let bestMatch: string | undefined;

  for (const projectRoot of projectRoots) {
    const normalizedRoot = normalizePath(projectRoot);
    if (handlerPath === normalizedRoot || handlerPath.startsWith(`${normalizedRoot}/`)) {
      if (!bestMatch || normalizedRoot.length > bestMatch.length) {
        bestMatch = normalizedRoot;
      }
    }
  }

  if (!bestMatch) {
    return undefined;
  }

  const segments = bestMatch.split('/').filter(Boolean);
  return segments[segments.length - 1] || undefined;
}

function extractAglConfigProjectName(filePath: string): string | undefined {
  const match = filePath.match(/(?:^|\/)agl-config-([^/]+)(?:\/|$)/);
  return match?.[1];
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/\/+$/, '');
}