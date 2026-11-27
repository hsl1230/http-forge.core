/**
 * External content materialization for test suites.
 *
 * Suites store inline content in `suite.json`. When a script or block is
 * external the content lives beside the suite (`scripts/*.js`,
 * `blocks/*.block.json`) and must be resolved on demand. This module provides
 * the shared, on-demand resolver used by both the core executors and the
 * extension's composite-suite builder.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TestSuite } from './interfaces';

/**
 * Resolve a suite's directory on disk (new format:
 * `<suites>/[folder/]<id>`).
 */
export function resolveSuiteDirectory(
    suitesDir: string | undefined,
    suite: Pick<TestSuite, 'id' | 'folderPath'>
): string | undefined {
    if (!suitesDir) return undefined;
    return suite.folderPath
        ? path.join(suitesDir, ...suite.folderPath.split('/'), suite.id)
        : path.join(suitesDir, suite.id);
}

/**
 * Return a deep-ish copy of `nodes` with external scripts/blocks replaced by
 * their inline content. Inline nodes are left untouched. Content is read fresh
 * from disk; there is no persistent cache, so edits are always reflected.
 */
export function materializeExternalContent(
    nodes: any[],
    suiteDir: string | undefined,
    scripts?: Record<string, unknown>
): any[] {
    const walk = (list: any[]): any[] => (list || []).map(node => {
        if (!node || typeof node !== 'object') return node;
        const n: any = { ...node };

        if (n.type === 'script' && n.script === undefined && typeof n.scriptRef === 'string') {
            const ref = n.scriptRef.trim().replace(/\\/g, '/');
            const lib = scripts?.[n.scriptRef] ?? scripts?.[ref];
            if (typeof lib === 'string') {
                n.script = lib;
            } else if (suiteDir) {
                const name = ref.replace(/^scripts\//, '').replace(/\.js$/, '') + '.js';
                try {
                    n.script = fs.readFileSync(path.join(suiteDir, 'scripts', name), 'utf-8');
                } catch {
                    // missing or unreadable external script — leave inline content absent
                }
            }
        }

        if (n.type === 'block' && n.storage === 'external' && n.blockRef && suiteDir) {
            const ref = String(n.blockRef).replace(/\\/g, '/').replace(/^\.\//, '');
            const rel = ref.startsWith('blocks/')
                ? (ref.endsWith('.block.json') ? ref : `${ref}.block.json`)
                : `blocks/${ref.replace(/\.block\.json$/, '')}.block.json`;
            try {
                const data = JSON.parse(fs.readFileSync(path.join(suiteDir, rel), 'utf-8'));
                if (Array.isArray(data.nodes)) n.nodes = data.nodes;
            } catch {
                // missing or unreadable external block — keep metadata only
            }
        }

        for (const key of ['nodes', 'then', 'else', 'default']) {
            if (Array.isArray(n[key])) n[key] = walk(n[key]);
        }
        if (Array.isArray(n.elseif)) {
            n.elseif = n.elseif.map((branch: any) =>
                branch && Array.isArray(branch.nodes)
                    ? { ...branch, nodes: walk(branch.nodes) }
                    : branch
            );
        }
        if (Array.isArray(n.cases)) {
            n.cases = n.cases.map((c: any) =>
                c && Array.isArray(c.nodes) ? { ...c, nodes: walk(c.nodes) } : c
            );
        }
        return n;
    });

    return walk(nodes);
}
