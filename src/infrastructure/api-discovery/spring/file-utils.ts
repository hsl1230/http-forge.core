/**
 * Pure filesystem helpers for Spring discovery (no vscode imports).
 * Ported from `spring-api-tester/src/utils/fileUtils.ts` with all
 * `vscode.workspace.fs` / `vscode.Uri` glue replaced by node `fs`/`path`
 * calls over concrete paths (DECISIONS D2 — no vscode in core).
 */

import * as fs from 'fs';
import * as path from 'path';

/** Directories to skip when recursively walking project trees. */
const SKIP_DIRS = new Set([
  'target',
  'build',
  'bin',
  'out',
  'dist',
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.gradle',
  '.mvn',
  '.idea',
  '.vscode',
  '.settings',
  '.history',
  '__pycache__',
]);

/**
 * Recursively find files under `baseDir` whose name matches `include`,
 * skipping directories in SKIP_DIRS.
 */
export function findFilesRecursive(baseDir: string, include: RegExp): string[] {
  const results: string[] = [];
  const frontier: string[] = [baseDir];

  while (frontier.length > 0) {
    const current = frontier.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          frontier.push(fullPath);
        }
      } else if (entry.isFile() && include.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/** Collect every `.java` file under `projectRoot` (skipping build/cache dirs). */
export function collectJavaFiles(projectRoot: string): string[] {
  return findFilesRecursive(projectRoot, /\.java$/);
}

/** Read a file as UTF-8 text. */
export function readFileText(filePath: string): Promise<string> {
  return fs.promises.readFile(filePath, 'utf-8');
}

/** Normalise a file-system path so that comparisons work cross-platform. */
export function normalizePath(fsPath: string): string {
  let p = fsPath.replace(/\\/g, '/');
  if (/^[A-Z]:\//.test(p)) {
    p = p[0].toLowerCase() + p.substring(1);
  }
  return p;
}

/** Return the last segment (file or folder name) of a path. */
export function baseName(fsPath: string): string {
  return fsPath.replace(/\\/g, '/').split('/').pop() || '';
}

/** Return the parent directory of a file-system path. */
export function dirName(fsPath: string): string {
  const norm = fsPath.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? fsPath.substring(0, idx) : fsPath;
}

/** Simple in-memory cache for `findJavaTypeFiles` results. */
const javaTypeFileCache = new Map<string, { ts: number; files: string[] }>();
const JAVA_TYPE_CACHE_TTL = 30_000; // 30 seconds

/** Clear the Java type file cache (e.g. when files change on disk). */
export function clearJavaTypeFileCache(): void {
  javaTypeFileCache.clear();
}

/**
 * Find Java files by simple class name under `projectRoot`.
 * Returns [] if no file matches the simple name.
 */
export function findJavaTypeFiles(projectRoot: string, simpleName: string): Promise<string[]> {
  const cached = javaTypeFileCache.get(simpleName);
  if (cached && Date.now() - cached.ts < JAVA_TYPE_CACHE_TTL) {
    return Promise.resolve(cached.files);
  }

  const pattern = new RegExp(`^${simpleName}\\.java$`);
  const files = collectJavaFiles(projectRoot).filter((f) => pattern.test(baseName(f)));
  javaTypeFileCache.set(simpleName, { ts: Date.now(), files });
  return Promise.resolve(files);
}
