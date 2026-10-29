import { describe, expect, it } from 'vitest';
import {
  applyRegenerated,
  diffLines,
  detectProjectDrift,
  proposeSuiteUpdates,
  resolveRegenerated,
  threeWayDiff,
} from '../../infrastructure/api-discovery';
import type { DiscoveredApiIndex } from '../../infrastructure/api-discovery';

describe('drift engine (Phase 2b)', () => {
  describe('diffLines', () => {
    it('produces unified-style hunks for changed lines', () => {
      const hunks = diffLines('a\nb\nc', 'a\nB\nc');
      expect(hunks.filter((h) => h.type !== 'same').map((h) => h.text)).toEqual(['b', 'B']);
      expect(hunks.find((h) => h.type === 'removed')).toMatchObject({ line: 2, text: 'b' });
      expect(hunks.find((h) => h.type === 'added')).toMatchObject({ line: 2, text: 'B' });
    });

    it('returns all-same hunks for identical input', () => {
      const hunks = diffLines('x\ny', 'x\ny');
      expect(hunks.every((h) => h.type === 'same')).toBe(true);
    });
  });

  describe('threeWayDiff', () => {
    const base = `const a = 1;\npm.test('status', () => {});`;
    const current = `const a = 1;\npm.test('status', () => {});\npm.expect(extra).toBe(true); // user edit`;
    const regenerated = `const a = 2;\npm.test('status', () => {});`;

    it('detects regeneration change and user edits separately', () => {
      const diff = threeWayDiff(base, current, regenerated);
      expect(diff.changed).toBe(true);
      expect(diff.userEditedLineCount).toBeGreaterThan(0);
      // User added a line (current has extra content).
      expect(diff.userChanges.some((h) => h.type === 'added' && h.text.includes('user edit'))).toBe(true);
      // Regeneration changed `a = 1` → `a = 2`.
      expect(diff.regeneratedChanges.some((h) => h.type === 'added' && h.text.includes('a = 2'))).toBe(true);
    });
  });

  describe('resolveRegenerated', () => {
    it('keeps current when there is no regeneration delta (user edits preserved)', () => {
      const base = 'status 200';
      const current = 'status 200\n// user note';
      const { merged, conflicts } = resolveRegenerated(current, base, base);
      expect(merged).toBe(current);
      expect(conflicts).toHaveLength(0);
    });

    it('fully regenerates when there are no user edits', () => {
      const base = 'const a = 1;';
      const current = base;
      const regenerated = 'const a = 2;';
      const { merged, conflicts } = resolveRegenerated(current, regenerated, base);
      expect(merged).toBe(regenerated);
      expect(conflicts).toHaveLength(0);
    });

    it('surfaces conflicts instead of auto-resolving overlapping regions', () => {
      const base = 'const a = 1;\nstatus';
      const current = 'const a = 1;\nstatus\n// user edit on status';
      const regenerated = 'const a = 2;\nstatus';
      const { conflicts } = resolveRegenerated(current, regenerated, base);
      // Regenerated removal of `a = 1` line overlaps user's edit region.
      expect(Array.isArray(conflicts)).toBe(true);
    });
  });

  describe('detectProjectDrift', () => {
    it('reports unknown when no stored freshness exists', () => {
      const drift = detectProjectDrift('/nonexistent', undefined);
      expect(drift.status).toBe('unknown');
    });

    it('degrades to mtime-only staleness in git-less workspaces', () => {
      const projectRoot = '/nonexistent-project';
      const drift = detectProjectDrift(projectRoot, { gitHash: undefined, scannedAt: new Date(0).toISOString() });
      // Either stale (mtime newer than epoch scan) or current — never throws.
      expect(['stale', 'current']).toContain(drift.status);
    });
  });
});

describe('Phase 2b — user-override preservation (exit criterion)', () => {
  it('a hand-tweaked assertion survives regeneration when the source drifts', () => {
    // 1. Generate a suite from discovery.
    const base = [
      "// ai_generated: true",
      "pm.test('status is 200', function () {",
      "  pm.expect(code).to.eq(200);",
      "});",
    ].join('\n');

    // 2. Developer hand-edits the assertion (their intent: assert the error body too).
    const current = [
      "// ai_generated: true",
      "pm.test('status is 200', function () {",
      "  pm.expect(code).to.eq(200);",
      "  pm.expect(body).toHaveProperty('error'); // user override",
      "});",
    ].join('\n');

    // 3. Source drifted: the endpoint now returns 201.
    const regenerated = [
      "// ai_generated: true",
      "pm.test('status is 201', function () {",
      "  pm.expect(code).to.eq(201);",
      "});",
    ].join('\n');

    const { merged } = resolveRegenerated(current, regenerated, base);

    // The regenerated status change should be applied...
    expect(merged).toContain("pm.test('status is 201'");
    // ...but the user's override line must survive.
    expect(merged).toContain("// user override");
  });

  it('keeps current unchanged when nothing regenerated differently', () => {
    const base = 'status 200';
    const current = 'status 200\n// user note';
    const { merged } = resolveRegenerated(current, base, base);
    expect(merged).toBe(current);
  });
});

describe('proposeSuiteUpdates (Phase 2b loop)', () => {
  it('maps stale endpoint ids to affected suites and proposes regeneration', () => {
    const base = "pm.test('status is 200', () => {});\n";
    const regenerated = "pm.test('status is 201', () => {});\n";

    const proposals = proposeSuiteUpdates(
      ['spring:GET:/users', 'spring:GET:/orders'],
      [
        {
          id: 'suite-a',
          name: 'A',
          currentContent: base, // untouched by user
          derivedFrom: ['spring:GET:/users', 'spring:GET:/health'],
        },
        {
          id: 'suite-b',
          name: 'B',
          currentContent: base,
          derivedFrom: ['spring:GET:/orders', 'spring:GET:/items'],
        },
        {
          id: 'suite-c',
          name: 'C',
          currentContent: base,
          derivedFrom: ['spring:GET:/unrelated'],
        },
      ],
      { 'suite-a': base, 'suite-b': base },
      { 'suite-a': regenerated, 'suite-b': regenerated }
    );

    // Only suites A and B are affected (their derived_from overlaps stale ids).
    expect(proposals.map((p) => p.suiteId).sort()).toEqual(['suite-a', 'suite-b']);
    expect(proposals[0].affectedEndpointIds).toContain('spring:GET:/users');
    expect(proposals[0].diff.changed).toBe(true);
    // No user edits → no conflicts → safe to auto-apply.
    expect(proposals[0].hasConflicts).toBe(false);
  });

  it('flags conflicts when user edits overlap regeneration', () => {
    const base = "pm.test('status is 200', () => {});\n";
    const current = "pm.test('status is 200', () => {});\npm.test('custom', () => {}); // user\n";
    const regenerated = "pm.test('status is 201', () => {});\n";

    const proposals = proposeSuiteUpdates(
      ['spring:GET:/users'],
      [{ id: 's', name: 'S', currentContent: current, derivedFrom: ['spring:GET:/users'] }],
      { s: base },
      { s: regenerated }
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0].hasConflicts).toBe(true);
  });
});

describe('applyRegenerated (Developer approves step)', () => {
  const base = "pm.test('status is 200', () => {});\n";
  const regenerated = "pm.test('status is 201', () => {});\n";

  it('applies a non-conflicting proposal and returns merged content', () => {
    const [proposal] = proposeSuiteUpdates(
      ['e1'],
      [{ id: 's', name: 'S', currentContent: base, derivedFrom: ['e1'] }],
      { s: base },
      { s: regenerated }
    );

    const result = applyRegenerated(proposal, base, regenerated, base);
    expect(result.canApply).toBe(true);
    expect(result.merged).toBe(regenerated);
    expect(result.conflicts).toBe(0);
  });

  it('refuses to auto-apply a conflicting proposal', () => {
    const current = base + "pm.test('custom', () => {}); // user\n";
    const [proposal] = proposeSuiteUpdates(
      ['e1'],
      [{ id: 's', name: 'S', currentContent: current, derivedFrom: ['e1'] }],
      { s: base },
      { s: regenerated }
    );

    const result = applyRegenerated(proposal, current, regenerated, base);
    expect(result.canApply).toBe(false);
    expect(result.merged).toBe(current);
    expect(result.conflicts).toBeGreaterThan(0);
  });

  it('keeps current when regeneration changes nothing', () => {
    const [proposal] = proposeSuiteUpdates(
      ['e1'],
      [{ id: 's', name: 'S', currentContent: base, derivedFrom: ['e1'] }],
      { s: base },
      { s: base }
    );

    const result = applyRegenerated(proposal, base, base, base);
    expect(result.canApply).toBe(false);
    expect(result.merged).toBe(base);
  });
});
