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

/** Normalize a script ref to `scripts/{name}.js`. */
export function normalizeScriptRef(ref: string): string {
    const name = ref.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^scripts\//, '').replace(/\.js$/, '');
    return name ? `scripts/${name}.js` : '';
}

/** Normalize a block ref to `blocks/{name}.block.json`. */
export function normalizeBlockRef(ref: string): string {
    const normalized = ref.replace(/\\/g, '/').replace(/^\.\//, '');
    if (normalized.startsWith('blocks/')) {
        return normalized.endsWith('.block.json') ? normalized : `${normalized}.block.json`;
    }
    return `blocks/${normalized.replace(/\.block\.json$/, '')}.block.json`;
}

function isPathLikeScriptRef(ref: string): boolean {
    return ref.includes('/') || ref.includes('\\') || ref.endsWith('.js');
}

/**
 * Persist external script/block content and clear it from the inline node tree.
 *
 * - External script nodes: `node.script` (or the inline library entry) is
 *   written to `scripts/{name}.js`, then removed from the node/JSON.
 * - External block nodes: children are written to `blocks/{name}.block.json`,
 *   then removed from the node/JSON (leaving `storage` + `blockRef`).
 * - Inline nodes that previously pointed at an external file: the file content
 *   is moved back and the file/ref is deleted.
 *
 * Mutates `nodes` (and `scripts` when provided) in place.
 */
export function persistExternalContent(
    nodes: any[],
    suiteDir: string,
    scripts?: Record<string, unknown>
): void {
    const persistScripts = (list: any[]) => {
        for (const node of list || []) {
            if (node?.type === 'script') {
                const rawRef = typeof node.scriptRef === 'string' ? node.scriptRef.trim() : '';
                const explicitExternal = node.storage === 'external';
                if (rawRef && (explicitExternal || isPathLikeScriptRef(rawRef))) {
                    const canonical = normalizeScriptRef(rawRef);
                    const scriptPath = path.join(suiteDir, canonical);
                    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });

                    let content: string | undefined;
                    if (typeof node.script === 'string') {
                        content = node.script;
                    } else if (fs.existsSync(scriptPath)) {
                        // The external file is the source of truth; never overwrite it
                        // with a stale inline-library copy. Only fall back to the
                        // library for an empty file (e.g. a freshly created one).
                        content = fs.readFileSync(scriptPath, 'utf-8');
                        if (!content) {
                            if (scripts && typeof scripts[rawRef] === 'string') {
                                content = scripts[rawRef] as string;
                            } else if (scripts && typeof scripts[canonical] === 'string') {
                                content = scripts[canonical] as string;
                            }
                        }
                    } else if (scripts && typeof scripts[rawRef] === 'string') {
                        content = scripts[rawRef] as string;
                    } else if (scripts && typeof scripts[canonical] === 'string') {
                        content = scripts[canonical] as string;
                    }
                    if (content === undefined) content = '';
                    fs.writeFileSync(scriptPath, content, 'utf-8');

                    delete node.script;
                    node.storage = 'external';
                    if (scripts) {
                        delete scripts[rawRef];
                        delete scripts[canonical];
                    }
                } else if (rawRef && (isPathLikeScriptRef(rawRef) || node.storage === 'inline')) {
                    // Switching back to inline: move file content into the node, then remove the file.
                    // Leave plain inline-library keys alone when no external file exists.
                    const canonical = normalizeScriptRef(rawRef);
                    const scriptPath = path.join(suiteDir, canonical);
                    if (fs.existsSync(scriptPath)) {
                        if (!node.script || (typeof node.script === 'string' && !node.script.trim())) {
                            try {
                                node.script = fs.readFileSync(scriptPath, 'utf-8');
                            } catch {
                                // ignore
                            }
                        }
                        fs.unlinkSync(scriptPath);
                        delete node.scriptRef;
                    } else if (isPathLikeScriptRef(rawRef) && node.script !== undefined) {
                        delete node.scriptRef;
                    }
                }
            }
            if (Array.isArray(node?.nodes)) persistScripts(node.nodes);
            if (Array.isArray(node?.then)) persistScripts(node.then);
            if (Array.isArray(node?.else)) persistScripts(node.else);
            if (Array.isArray(node?.elseif)) {
                for (const branch of node.elseif) {
                    if (Array.isArray(branch?.nodes)) persistScripts(branch.nodes);
                }
            }
            if (Array.isArray(node?.cases)) {
                for (const c of node.cases) {
                    if (Array.isArray(c?.nodes)) persistScripts(c.nodes);
                }
            }
            if (Array.isArray(node?.default)) persistScripts(node.default);
        }
    };

    const persistBlocks = (list: any[]) => {
        for (const node of list || []) {
            if (node?.type === 'block' && node.storage === 'external' && node.blockRef) {
                const blockRef = normalizeBlockRef(node.blockRef);
                node.blockRef = blockRef;
                const blockPath = path.join(suiteDir, blockRef);
                fs.mkdirSync(path.dirname(blockPath), { recursive: true });

                let blockNodes = Array.isArray(node.nodes) ? node.nodes : [];
                if (blockNodes.length === 0 && fs.existsSync(blockPath)) {
                    // Lazily-loaded content was never read; preserve the existing file.
                    try {
                        const existing = JSON.parse(fs.readFileSync(blockPath, 'utf-8'));
                        blockNodes = Array.isArray(existing.nodes) ? existing.nodes : [];
                    } catch {
                        // ignore
                    }
                }
                persistScripts(blockNodes);
                persistBlocks(blockNodes);

                fs.writeFileSync(blockPath, JSON.stringify({
                    id: node.name || 'block',
                    name: node.name || 'Block',
                    nodes: blockNodes,
                }, null, 2), 'utf-8');
                node.nodes = [];
            } else if (node?.type === 'block' && node.storage !== 'external' && node.blockRef) {
                const blockRef = normalizeBlockRef(node.blockRef);
                const blockPath = path.join(suiteDir, blockRef);
                if ((!node.nodes || node.nodes.length === 0) && fs.existsSync(blockPath)) {
                    try {
                        const blockData = JSON.parse(fs.readFileSync(blockPath, 'utf-8'));
                        node.nodes = blockData.nodes || [];
                    } catch {
                        // ignore
                    }
                }
                if (fs.existsSync(blockPath)) {
                    fs.unlinkSync(blockPath);
                }
                delete node.blockRef;
            }
            if (Array.isArray(node?.nodes)) persistBlocks(node.nodes);
            if (Array.isArray(node?.then)) persistBlocks(node.then);
            if (Array.isArray(node?.else)) persistBlocks(node.else);
            if (Array.isArray(node?.elseif)) {
                for (const branch of node.elseif) {
                    if (Array.isArray(branch?.nodes)) persistBlocks(branch.nodes);
                }
            }
            if (Array.isArray(node?.cases)) {
                for (const c of node.cases) {
                    if (Array.isArray(c?.nodes)) persistBlocks(c.nodes);
                }
            }
            if (Array.isArray(node?.default)) persistBlocks(node.default);
        }
    };

    persistScripts(nodes);
    persistBlocks(nodes);
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
