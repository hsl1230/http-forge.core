/**
 * Release Notes (Layer 6 — docs as a BYPRODUCT of drift)
 *
 * Single Responsibility: derive a "what changed" release-notes artifact from
 * the same git history the drift engine fingerprints. No dedicated docs phase
 * budget (plan §4 Phase 3 / §7): the reviewer ships the diff, this renders it.
 *
 * Deterministic: pure `git log` parsing + conventional-commit classification.
 */

import { execSync } from 'child_process';

export type ReleaseNoteType =
  | 'feat'
  | 'fix'
  | 'perf'
  | 'docs'
  | 'refactor'
  | 'test'
  | 'build'
  | 'chore'
  | 'other';

export interface ReleaseNoteEntry {
  /** Conventional-commit type, e.g. `feat`, `fix`, `perf`. */
  type: ReleaseNoteType;
  /** Optional scope, e.g. `core`, `discovery`, `review`. */
  scope?: string;
  /** Commit subject (without the type/scope prefix). */
  subject: string;
  /** Short git hash. */
  hash: string;
  /** True when the subject carries `!` (e.g. `feat!:`) or "BREAKING CHANGE". */
  breaking: boolean;
}

export interface ReleaseNotesOptions {
  /** Project root (must be inside a git work tree). */
  projectRoot: string;
  /** Lower bound (exclusive). Omit to list all reachable history up to `to`. */
  from?: string;
  /** Upper bound (inclusive). Defaults to HEAD. */
  to?: string;
}

export interface ReleaseNotes {
  from: string | null;
  to: string;
  /** The resolved `to` hash, when available. */
  toHash?: string;
  entries: ReleaseNoteEntry[];
  /** Type → count. */
  summary: Partial<Record<ReleaseNoteType, number>>;
  /** True when the project is not a git work tree (no notes could be generated). */
  gitAvailable: boolean;
}

const TYPE_PREFIX_RE = /^(feat|fix|perf|docs|refactor|test|build|chore)(?:\(([^)]*)\))?(!?):\s*(.+)$/i;
const BREAKING_SUBJECT_RE = /BREAKING[- ]CHANGE:/i;

/**
 * List conventional commits between two refs via `git log`. Returns [] when
 * git is unavailable or the range is empty/invalid.
 */
export function generateReleaseNotes(options: ReleaseNotesOptions): ReleaseNotes {
  const { projectRoot, from, to = 'HEAD' } = options;

  const range = from ? `${from}..${to}` : to;
  let gitAvailable = true;
  let toHash: string | undefined;
  let rawLog = '';

  try {
    rawLog = execSync(`git log --no-merges --pretty=format:%h%x09%s ${range}`, {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    toHash = execSync('git rev-parse HEAD', {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
  } catch {
    // Not a git work tree, an invalid ref range, or no commits in range.
    gitAvailable = false;
  }

  const entries: ReleaseNoteEntry[] = rawLog
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseLogLine)
    .filter((e): e is ReleaseNoteEntry => e !== null);

  const summary: Partial<Record<ReleaseNoteType, number>> = {};
  for (const e of entries) {
    summary[e.type] = (summary[e.type] ?? 0) + 1;
  }

  return {
    from: from ?? null,
    to,
    toHash,
    entries,
    summary,
    gitAvailable,
  };
}

function parseLogLine(line: string): ReleaseNoteEntry | null {
  const tab = line.indexOf('\t');
  if (tab < 0) return null;
  const hash = line.slice(0, tab);
  const subject = line.slice(tab + 1);
  const match = subject.match(TYPE_PREFIX_RE);
  if (!match) {
    return { type: 'other', subject, hash, breaking: BREAKING_SUBJECT_RE.test(subject) };
  }
  const [, type, scope, bang, rest] = match;
  return {
    type: type.toLowerCase() as ReleaseNoteType,
    scope: scope || undefined,
    subject: rest,
    hash,
    breaking: bang === '!' || BREAKING_SUBJECT_RE.test(rest),
  };
}

/**
 * Render release notes as markdown — grouped by type, breaking changes first.
 * This is the artifact dropped into a PR/release body or release-notes.md.
 */
export function renderReleaseNotesMarkdown(notes: ReleaseNotes): string {
  if (!notes.gitAvailable) {
    return 'Release notes unavailable: project is not a git work tree.';
  }
  if (notes.entries.length === 0) {
    return notes.from
      ? `No commits in ${notes.from}..${notes.to}.`
      : `No commits found up to ${notes.to}.`;
  }

  const typeOrder: ReleaseNoteType[] = [
    'feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'chore', 'other',
  ];
  const breaking = notes.entries.filter((e) => e.breaking);
  const sections: string[] = [];

  if (breaking.length > 0) {
    sections.push('### ⚠️ Breaking changes', ...breaking.map((e) => `- **${e.subject}** \`${e.hash}\``));
  }

  for (const type of typeOrder) {
    const group = notes.entries.filter((e) => e.type === type && !e.breaking);
    if (group.length === 0) continue;
    const title: Record<ReleaseNoteType, string> = {
      feat: '### ✨ Features',
      fix: '### 🐛 Bug fixes',
      perf: '### ⚡ Performance',
      refactor: '### 🔧 Refactors',
      docs: '### 📚 Docs',
      test: '### ✅ Tests',
      build: '### 📦 Build',
      chore: '### 🧹 Chores',
      other: '### Other',
    };
    sections.push(title[type]);
    for (const e of group) {
      const scope = e.scope ? `**${e.scope}:** ` : '';
      sections.push(`- ${scope}${e.subject} \`${e.hash}\``);
    }
  }

  return sections.join('\n');
}
