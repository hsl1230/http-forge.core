/**
 * AGENTS.md Guide Management Tests
 *
 * Verifies versioned template behavior for `.http-forge/AGENTS.md`: template
 * self-consistency (marker matches the version constant), staleness detection
 * for legacy/malformed/current guides, write-once creation, and explicit
 * refresh-with-backup semantics (user customizations are never silently lost).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    AGENTS_MD_VERSION,
    buildAgentsMdContent,
    ensureAgentsMdFile,
    getAgentsMdStatus,
    readAgentsMdVersion,
    refreshAgentsMd,
} from '../infrastructure/collection/agents-md';
import { FolderCollectionStore } from '../infrastructure/collection/folder-collection-store';

const workspaces: string[] = [];

function makeForgeDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-agents-md-'));
    workspaces.push(dir);
    const forgeDir = path.join(dir, '.http-forge');
    fs.mkdirSync(forgeDir, { recursive: true });
    return forgeDir;
}

afterEach(() => {
    for (const dir of workspaces.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('buildAgentsMdContent', () => {
    it('embeds a version marker matching AGENTS_MD_VERSION', () => {
        const content = buildAgentsMdContent();
        expect(readAgentsMdVersion(content)).toBe(AGENTS_MD_VERSION);
        expect(AGENTS_MD_VERSION).toBeGreaterThan(0);
    });

    it('keeps the same-workspace and business-knowledge guidance in the template', () => {
        const content = buildAgentsMdContent();
        expect(content).toContain('## Same-Workspace Code and Docs — Read Before Generating');
        expect(content).toContain('## Business Knowledge');
    });
});

describe('readAgentsMdVersion', () => {
    it('reads legacy guides without a marker as version 0', () => {
        expect(readAgentsMdVersion('# HTTP Forge — AI Agent Guide\n')).toBe(0);
        expect(readAgentsMdVersion('')).toBe(0);
    });

    it('reads malformed markers as version 0', () => {
        expect(readAgentsMdVersion('<!-- http-forge-agents-md-version: abc -->')).toBe(0);
    });
});

describe('getAgentsMdStatus', () => {
    it('reports missing guides as not stale (creation path owns them)', () => {
        const forgeDir = makeForgeDir();
        const status = getAgentsMdStatus(forgeDir);
        expect(status).toMatchObject({ exists: false, stale: false, currentVersion: 0 });
        expect(status.latestVersion).toBe(AGENTS_MD_VERSION);
    });

    it('reports legacy guides without a marker as stale', () => {
        const forgeDir = makeForgeDir();
        fs.writeFileSync(path.join(forgeDir, 'AGENTS.md'), '# HTTP Forge — AI Agent Guide\n', 'utf-8');
        const status = getAgentsMdStatus(forgeDir);
        expect(status).toMatchObject({ exists: true, stale: true, currentVersion: 0 });
    });

    it('reports current guides as not stale', () => {
        const forgeDir = makeForgeDir();
        fs.writeFileSync(path.join(forgeDir, 'AGENTS.md'), buildAgentsMdContent(), 'utf-8');
        const status = getAgentsMdStatus(forgeDir);
        expect(status).toMatchObject({ exists: true, stale: false, currentVersion: AGENTS_MD_VERSION });
    });
});

describe('ensureAgentsMdFile', () => {
    it('creates the guide once and never overwrites customizations', () => {
        const forgeDir = makeForgeDir();
        expect(ensureAgentsMdFile(forgeDir)).toBe(true);
        expect(readAgentsMdVersion(fs.readFileSync(path.join(forgeDir, 'AGENTS.md'), 'utf-8'))).toBe(
            AGENTS_MD_VERSION
        );

        fs.writeFileSync(path.join(forgeDir, 'AGENTS.md'), 'my custom guide', 'utf-8');
        expect(ensureAgentsMdFile(forgeDir)).toBe(false);
        expect(fs.readFileSync(path.join(forgeDir, 'AGENTS.md'), 'utf-8')).toBe('my custom guide');
    });
});

describe('refreshAgentsMd', () => {
    it('backs up the legacy guide byte-for-byte and writes the current template', () => {
        const forgeDir = makeForgeDir();
        const legacy = '# HTTP Forge — AI Agent Guide\n\nMy team notes.\n';
        fs.writeFileSync(path.join(forgeDir, 'AGENTS.md'), legacy, 'utf-8');

        const result = refreshAgentsMd(forgeDir);

        expect(result.created).toBe(false);
        expect(result.previousVersion).toBe(0);
        expect(result.version).toBe(AGENTS_MD_VERSION);
        expect(result.backupPath).toBe(path.join(forgeDir, 'AGENTS.md.bak'));
        expect(fs.readFileSync(result.backupPath as string, 'utf-8')).toBe(legacy);
        const fresh = fs.readFileSync(result.path, 'utf-8');
        expect(readAgentsMdVersion(fresh)).toBe(AGENTS_MD_VERSION);
        expect(fresh).toContain('## Same-Workspace Code and Docs — Read Before Generating');
        expect(getAgentsMdStatus(forgeDir).stale).toBe(false);
    });

    it('creates the guide with no backup when nothing existed', () => {
        const forgeDir = makeForgeDir();
        const result = refreshAgentsMd(forgeDir);
        expect(result).toMatchObject({ created: true, backupPath: null, previousVersion: 0 });
        expect(fs.existsSync(path.join(forgeDir, 'AGENTS.md.bak'))).toBe(false);
    });
});

describe('FolderCollectionStore guide creation', () => {
    it('does not create .http-forge blindly on construction; creates guide lazily on first save', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-agents-md-store-'));
        workspaces.push(dir);
        const collectionsDir = path.join(dir, '.http-forge', 'assets', 'collections');
        const store = new FolderCollectionStore(collectionsDir);
        const guidePath = path.join(dir, '.http-forge', 'AGENTS.md');
        // Lazy: no directory or guide after construction
        expect(fs.existsSync(guidePath)).toBe(false);
        expect(fs.existsSync(collectionsDir)).toBe(false);
        // First save should create both the collections dir and the guide
        await store.save({ id: 'test', name: 'Test', items: [] });
        expect(fs.existsSync(guidePath)).toBe(true);
        expect(readAgentsMdVersion(fs.readFileSync(guidePath, 'utf-8'))).toBe(AGENTS_MD_VERSION);
    });
});
