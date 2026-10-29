/**
 * Phase 2b — Self-maintenance / drift engine.
 *
 * Design rules (plan §Phase 2b):
 *  1. Regenerate, don't patch — on source change, re-derive the artifact and
 *     present a 3-way diff; never diff-patch arbitrary code in place.
 *  2. User-override preservation — only `ai_generated` regions are regenerable.
 *     The 3-way diff surfaces which hunks are user edits vs regenerated.
 *  3. Freshness — git hash + source mtime compare; in git-less workspaces,
 *     degrade to mtime-only (no git, no drift claims).
 *
 * Deterministic and pure where possible: no timestamps inside records beyond
 * the explicit freshness fields.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { DiscoveredApiIndex } from './types';

// ─── Freshness ───────────────────────────────────────────────────────────────

/** A project's source freshness fingerprint. */
export interface ProjectFreshness {
  gitHash?: string;
  /** Max mtime (ms) of any scanned source file under the project root. */
  maxSourceMtime: number;
}

/** Drift status for one project. */
export type DriftStatus = 'current' | 'stale' | 'unknown';

/** Result of a drift check for a single project. */
export interface ProjectDrift {
  projectRoot: string;
  status: DriftStatus;
  storedFreshness?: ProjectFreshness;
  currentFreshness: ProjectFreshness;
  /** Human-readable reason for the status. */
  reason?: string;
}

/** Drift check across an index. */
export interface DriftReport {
  projects: ProjectDrift[];
  /** Number of stale projects (needs regeneration). */
  staleCount: number;
  checkedAt: string;
}

const SOURCE_EXTENSIONS = ['.ts', '.js', '.java', '.py'];

/**
 * Compute the freshness fingerprint of a project: git HEAD hash (when in a git
 * work tree) and the newest mtime across its source files.
 */
export function computeProjectFreshness(projectRoot: string): ProjectFreshness {
  let gitHash: string | undefined;
  try {
    const head = execSync('git rev-parse HEAD', {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    if (head) gitHash = head;
  } catch {
    gitHash = undefined; // not a git work tree (or git unavailable) → mtime only
  }

  let maxMtime = 0;
  try {
    const queue = [projectRoot];
    const skip = new Set(['node_modules', '.git', 'target', 'build', 'dist', 'out', '__pycache__', '.venv', 'venv']);
    while (queue.length > 0) {
      const dir = queue.shift()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skip.has(entry.name)) queue.push(full);
          continue;
        }
        if (!entry.isFile() || !SOURCE_EXTENSIONS.some((e) => full.endsWith(e))) continue;
        try {
          const st = fs.statSync(full);
          if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
        } catch {
          // ignore unreadable
        }
      }
    }
  } catch {
    maxMtime = 0;
  }

  return { gitHash, maxSourceMtime: maxMtime };
}

/**
 * Detect drift for a single project against an existing index.
 *
 * In git work trees, drift is keyed on the git hash (revision changed since the
 * index was built). In git-less workspaces, fall back to the max source mtime —
 * a source file newer than `scannedAt` marks the project stale.
 */
export function detectProjectDrift(
  projectRoot: string,
  stored: { gitHash?: string; scannedAt: string } | undefined
): ProjectDrift {
  const current = computeProjectFreshness(projectRoot);
  if (!stored) {
    return { projectRoot, status: 'unknown', currentFreshness: current, reason: 'no stored index entry' };
  }

  // Git work tree: compare revisions.
  if (current.gitHash && stored.gitHash) {
    if (current.gitHash === stored.gitHash) {
      return { projectRoot, status: 'current', storedFreshness: { gitHash: stored.gitHash, maxSourceMtime: current.maxSourceMtime }, currentFreshness: current };
    }
    return {
      projectRoot,
      status: 'stale',
      storedFreshness: { gitHash: stored.gitHash, maxSourceMtime: current.maxSourceMtime },
      currentFreshness: current,
      reason: `git HEAD changed: ${stored.gitHash.slice(0, 8)} → ${current.gitHash.slice(0, 8)}`,
    };
  }

  // Git-less: mtime-only freshness.
  const scannedAtMs = new Date(stored.scannedAt).getTime();
  if (current.maxSourceMtime > scannedAtMs) {
    return {
      projectRoot,
      status: 'stale',
      storedFreshness: { gitHash: stored.gitHash, maxSourceMtime: current.maxSourceMtime },
      currentFreshness: current,
      reason: `source file newer than last scan (${new Date(current.maxSourceMtime).toISOString()} > ${stored.scannedAt})`,
    };
  }
  return { projectRoot, status: 'current', storedFreshness: { gitHash: stored.gitHash, maxSourceMtime: current.maxSourceMtime }, currentFreshness: current };
}

/** Run drift detection across every project in an index. */
export function detectIndexDrift(index: DiscoveredApiIndex): DriftReport {
  const projects = index.projects.map((p) => detectProjectDrift(p.projectRoot, p.freshness));
  return {
    projects,
    staleCount: projects.filter((p) => p.status === 'stale').length,
    checkedAt: new Date().toISOString(),
  };
}

// ─── 3-way diff (regenerate, don't patch) ────────────────────────────────────

export type DiffLineType = 'same' | 'removed' | 'added';

export interface DiffHunk {
  type: DiffLineType;
  /** 1-based line number in the relevant version (base for same/removed, target for added). */
  line: number;
  text: string;
}

/**
 * A minimal LCS-based line diff between two texts. Returns unified-style hunks
 * in document order (removed lines from `a`, added lines from `b`).
 */
export function diffLines(a: string, b: string): DiffHunk[] {
  const aLines = a.split('\n');
  const bLines = b.split('\n');

  // DP over LCS.
  const n = aLines.length;
  const m = bLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const hunks: DiffHunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      hunks.push({ type: 'same', line: i + 1, text: aLines[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      hunks.push({ type: 'removed', line: i + 1, text: aLines[i] });
      i++;
    } else {
      hunks.push({ type: 'added', line: j + 1, text: bLines[j] });
      j++;
    }
  }
  while (i < n) { hunks.push({ type: 'removed', line: i + 1, text: aLines[i] }); i++; }
  while (j < m) { hunks.push({ type: 'added', line: j + 1, text: bLines[j] }); j++; }

  return hunks;
}

/**
 * A 3-way diff over a generated artifact:
 *   - `base`        — the last generated version (ground truth from previous scan)
 *   - `current`     — what's on disk now (may include user edits)
 *   - `regenerated` — freshly re-derived from current source
 *
 * This is the "regenerate, don't patch" surface: the caller shows the user
 * which hunks differ, and only `ai_generated` regions are safe to overwrite.
 */
export interface ThreeWayDiff {
  /** Line hunks: base → current (what the user changed since generation). */
  userChanges: DiffHunk[];
  /** Line hunks: base → regenerated (what source drift would change). */
  regeneratedChanges: DiffHunk[];
  /** Whether regeneration would change the artifact at all. */
  changed: boolean;
  /** Number of user-edited lines (never auto-overwritten). */
  userEditedLineCount: number;
}

export function threeWayDiff(base: string, current: string, regenerated: string): ThreeWayDiff {
  const userChanges = diffLines(base, current);
  const regeneratedChanges = diffLines(base, regenerated);
  const userEditedLineCount = userChanges.filter((h) => h.type !== 'same').length;
  return {
    userChanges,
    regeneratedChanges,
    changed: regenerated !== base,
    userEditedLineCount,
  };
}

/**
 * Given a current artifact and its freshly regenerated version, compute what
 * should be written: regenerate the `ai_generated` regions, preserving user
 * edits. Conflict lines (same region edited both ways) are NOT auto-resolved —
 * they are surfaced in `conflicts` for the developer.
 */
export function resolveRegenerated(
  current: string,
  regenerated: string,
  base: string
): { merged: string; conflicts: DiffHunk[] } {
  const baseLines = base.split('\n');
  const currentLines = current.split('\n');
  const regeneratedLines = regenerated.split('\n');

  // Per-base-line action maps from each diff (base → current and base → regenerated).
  const userActions = buildBaseLineActions(baseLines, currentLines);
  const regenActions = buildBaseLineActions(baseLines, regeneratedLines);

  // No regeneration delta → keep current as-is (preserves all user edits).
  if (regenActions.changedCount === 0) {
    return { merged: current, conflicts: [] };
  }

  // No user edits → safe to fully regenerate.
  if (userActions.changedCount === 0) {
    return { merged: regenerated, conflicts: [] };
  }

  const merged: string[] = [];
  const conflicts: DiffHunk[] = [];
  const n = baseLines.length;

  for (let i = 0; i < n; i++) {
    const user = userActions.byLine[i];
    const regen = regenActions.byLine[i];

    const userRemoved = user === 'removed';
    const regenRemoved = regen === 'removed';

    if (userRemoved && regenRemoved) {
      // Both sides replaced this line. If they inserted identical content it's
      // a clean regeneration; differing replacements are a user conflict.
      const userInserted = userActions.insertionsBefore[i].join('\n');
      const regenInserted = regenActions.insertionsBefore[i].join('\n');
      for (const line of userActions.insertionsBefore[i]) merged.push(line);
      if (userInserted !== regenInserted && regenInserted !== '') {
        conflicts.push({ type: 'removed', line: i + 1, text: baseLines[i] });
        for (const line of regenActions.insertionsBefore[i]) merged.push(line);
      }
      continue;
    }
    if (userRemoved && !regenRemoved) {
      // User removed the line, regeneration keeps it → user intent wins.
      for (const line of userActions.insertionsBefore[i]) merged.push(line);
      continue;
    }
    if (!userRemoved && regenRemoved) {
      // Regeneration removes a line the user left untouched → apply it cleanly
      // (the regenerated replacement, if any, was already emitted above).
      for (const line of regenActions.insertionsBefore[i]) merged.push(line);
      continue;
    }
    // Both keep the line. Emit insertions (user's first, then regenerated's),
    // then the line itself (unchanged, since 'kept' means untouched content).
    for (const line of userActions.insertionsBefore[i]) merged.push(line);
    for (const line of regenActions.insertionsBefore[i]) merged.push(line);
    merged.push(baseLines[i]);
  }

  // Trailing insertions.
  for (const line of userActions.insertionsBefore[n]) merged.push(line);
  for (const line of regenActions.insertionsBefore[n]) merged.push(line);

  return { merged: merged.join('\n'), conflicts };
}

interface BaseLineActions {
  /** baseLineIndex (0-based) → 'removed' when the side dropped the line, else 'kept'. */
  byLine: Array<'removed' | 'kept'>;
  /** insertionsBefore[i] = lines inserted before base line i (i == n for trailing). */
  insertionsBefore: string[][];
  /** Number of lines changed (removed or inserted) on this side. */
  changedCount: number;
}

/**
 * Convert a side's diff (base → target) into per-base-line actions:
 * which base lines were removed, and which target lines were inserted where.
 */
function buildBaseLineActions(baseLines: string[], targetLines: string[]): BaseLineActions {
  const n = baseLines.length;
  const byLine: Array<'removed' | 'kept'> = new Array(n).fill('kept');
  const insertionsBefore: string[][] = Array.from({ length: n + 1 }, () => []);
  let changedCount = 0;

  const hunks = diffLines(baseLines.join('\n'), targetLines.join('\n'));
  // Walk hunks; 'removed' line numbers are 1-based base lines; 'added' line
  // numbers are 1-based target lines. Determine insertion position by the base
  // line that follows the run.
  let insertCursor = 0; // base line index before which insertions apply (0-based, n = end)
  for (const hunk of hunks) {
    if (hunk.type === 'same') {
      insertCursor = hunk.line; // base line 1-based → next insertions before base line hunk.line+1... adjust below
      continue;
    }
    if (hunk.type === 'removed') {
      const idx = hunk.line - 1;
      byLine[idx] = 'removed';
      changedCount++;
      insertCursor = hunk.line; // insertions after this removed line → before next kept line
      continue;
    }
    // added
    changedCount++;
    insertionsBefore[insertCursor].push(hunk.text);
  }

  return { byLine, insertionsBefore, changedCount };
}

// ─── Phase 2b loop: stale project → affected suites → proposed update ───────

/** A suite artifact that was generated from discovery (carries derived_from). */
export interface GeneratedSuite {
  id: string;
  name: string;
  /** Serialized suite content currently on disk (may include user edits). */
  currentContent: string;
  /** Endpoint ids this suite was derived from (Phase 2a drift hook). */
  derivedFrom: string[];
}

/** Proposed regeneration for one affected suite. */
export interface SuiteUpdateProposal {
  suiteId: string;
  suiteName: string;
  /** Endpoint ids in this suite that map to a drifted source file. */
  affectedEndpointIds: string[];
  /** 3-way diff: base → current (user edits) vs base → regenerated. */
  diff: ThreeWayDiff;
  /** Whether user edits overlap regeneration (needs developer approval). */
  hasConflicts: boolean;
}

/**
 * Map drifted source files → affected endpoints → affected suites, and produce
 * a regeneration proposal (3-way diff) for each affected suite.
 *
 * `storedContent` is the last-generated (base) content for each suite; the
 * caller passes current on-disk content and freshly regenerated content.
 */
export function proposeSuiteUpdates(
  staleEndpointIds: string[],
  suites: GeneratedSuite[],
  baseContent: Record<string, string>,
  regeneratedContent: Record<string, string>
): SuiteUpdateProposal[] {
  const affected = new Set(staleEndpointIds);
  const proposals: SuiteUpdateProposal[] = [];

  for (const suite of suites) {
    const impacted = suite.derivedFrom.filter((id) => affected.has(id));
    if (impacted.length === 0) continue;

    const base = baseContent[suite.id] ?? '';
    const regenerated = regeneratedContent[suite.id];
    if (regenerated === undefined) continue;

    const diff = threeWayDiff(base, suite.currentContent, regenerated);
    proposals.push({
      suiteId: suite.id,
      suiteName: suite.name,
      affectedEndpointIds: impacted,
      diff,
      hasConflicts: diff.userEditedLineCount > 0 && diff.changed,
    });
  }

  return proposals;
}

/**
 * Apply a regeneration proposal for one suite: compute the merged content with
 * user-override preservation (`resolveRegenerated`). When the proposal has no
 * conflicts and the regeneration actually changed something, the caller may
 * write `merged` to disk — the "Developer approves" step. Conflicting proposals
 * are never auto-applied.
 */
export function applyRegenerated(
  proposal: SuiteUpdateProposal,
  currentContent: string,
  regeneratedContent: string,
  baseContent: string
): { canApply: boolean; merged: string; conflicts: number } {
  if (proposal.hasConflicts) {
    return { canApply: false, merged: currentContent, conflicts: proposal.diff.userEditedLineCount };
  }
  if (!proposal.diff.changed) {
    return { canApply: false, merged: currentContent, conflicts: 0 };
  }
  const { merged, conflicts } = resolveRegenerated(currentContent, regeneratedContent, baseContent);
  return { canApply: true, merged, conflicts: conflicts.length };
}
