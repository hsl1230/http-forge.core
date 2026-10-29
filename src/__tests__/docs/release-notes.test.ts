import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  generateReleaseNotes,
  renderReleaseNotesMarkdown,
} from '../../infrastructure/docs/release-notes';

let tmp: string;
let first: string;

function git(args: string): string {
  return execSync(`git --no-pager ${args}`, {
    cwd: tmp,
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-release-notes-'));
  git('init -q');
  git('config user.email test@forge.dev');
  git('config user.name Test');
  git('commit --allow-empty -q -m "chore: initial scaffold"');
  first = git('rev-parse HEAD');
  git('commit --allow-empty -q -m "feat(discovery): scan spring controllers"');
  git('commit --allow-empty -q -m "fix(core): handle empty middleware list"');
  git('commit --allow-empty -q -m "perf!: batch file reads"');
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('generateReleaseNotes', () => {
  it('classifies conventional commits and counts summary', () => {
    const notes = generateReleaseNotes({ projectRoot: tmp });
    expect(notes.gitAvailable).toBe(true);
    const types = notes.entries.map((e) => e.type);
    expect(types).toContain('feat');
    expect(types).toContain('fix');
    expect(types).toContain('perf');
    expect(notes.entries.find((e) => e.type === 'feat')?.scope).toBe('discovery');
    expect(notes.entries.find((e) => e.type === 'feat')?.hash).toMatch(/^[0-9a-f]{7,}$/);
    expect(notes.entries.find((e) => e.type === 'perf')?.breaking).toBe(true);
    expect(notes.summary.feat).toBe(1);
    expect(notes.summary.fix).toBe(1);
  });

  it('respects the from..to range', () => {
    const notes = generateReleaseNotes({ projectRoot: tmp, from: first });
    // Everything after the scaffold commit.
    expect(notes.entries.length).toBe(3);
    expect(notes.entries.every((e) => e.type !== 'chore')).toBe(true);
  });

  it('reports gitAvailable=false outside a git work tree', () => {
    const notGit = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-not-git-'));
    try {
      const notes = generateReleaseNotes({ projectRoot: notGit });
      expect(notes.gitAvailable).toBe(false);
      expect(notes.entries).toEqual([]);
    } finally {
      fs.rmSync(notGit, { recursive: true, force: true });
    }
  });
});

describe('renderReleaseNotesMarkdown', () => {
  it('groups by type with breaking changes first', () => {
    const notes = generateReleaseNotes({ projectRoot: tmp, from: first });
    const md = renderReleaseNotesMarkdown(notes);
    expect(md).toContain('### ⚠️ Breaking changes');
    expect(md).toContain('### ✨ Features');
    expect(md).toContain('### 🐛 Bug fixes');
    expect(md).toContain('**discovery:**');
    const breakingIdx = md.indexOf('⚠️');
    const featIdx = md.indexOf('✨');
    const fixIdx = md.indexOf('🐛');
    expect(breakingIdx).toBeGreaterThan(-1);
    expect(breakingIdx).toBeLessThan(featIdx);
    expect(featIdx).toBeLessThan(fixIdx);
  });

  it('handles empty and non-git cases gracefully', () => {
    const empty = generateReleaseNotes({ projectRoot: tmp, from: git('rev-parse HEAD') });
    expect(renderReleaseNotesMarkdown(empty)).toContain('No commits');
    const notGit = generateReleaseNotes({ projectRoot: os.tmpdir() + '/does-not-exist-' + Date.now() });
    expect(renderReleaseNotesMarkdown(notGit)).toContain('not a git work tree');
  });
});
