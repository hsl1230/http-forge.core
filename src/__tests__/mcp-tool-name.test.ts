/**
 * MCP Tool Name Tests
 *
 * Validates the shared tool-name encoding/decoding helper used by both MCP
 * server implementations (extension + core runtime).
 */

import { describe, expect, it } from 'vitest';
import {
    buildCollectionToolName,
    buildFolderToolName,
    buildRequestToolName,
    buildSuiteToolName,
    mcpToolSegment,
    mcpToolToken,
    parseMcpToolName,
    resolveFolderToken,
    resolveToken,
} from '../runtime/mcp-tool-name';

// A pathological ID like the ones generateId() produces (name slug + suffix).
const LONG_COL_ID = 'my-very-long-collection-name-that-makes-tool-names-too-long_ab12cd34';
const LONG_REQ_ID = 'an-equally-long-request-name-that-blows-the-budget_ef56gh78';

// Realistic short ids (slug + base36 suffix) that fit verbatim.
const SHORT_COL_ID = 'reg-agl-sq5_lz3k9a0f2x8';
const SHORT_REQ_ID = 'get-bookmarks_lz3k9b1g7y2';

describe('mcpToolToken', () => {
    it('is deterministic and 12 hex chars', () => {
        const t1 = mcpToolToken(LONG_REQ_ID);
        const t2 = mcpToolToken(LONG_REQ_ID);
        expect(t1).toBe(t2);
        expect(t1).toMatch(/^[a-z0-9_-]+_[0-9a-f]{12}$/);
    });

    it('contains no "__" delimiter', () => {
        expect(mcpToolToken(LONG_COL_ID)).not.toContain('__');
    });

    it('differs for different inputs', () => {
        expect(mcpToolToken('a')).not.toBe(mcpToolToken('b'));
    });
});

describe('tool name builders stay under 128 chars', () => {
    const prefix = 'http_forge_';
    it('request', () => {
        const name = buildRequestToolName(prefix, LONG_COL_ID, LONG_REQ_ID);
        expect(name.length).toBeLessThan(128);
        expect(name.startsWith(`${prefix}request__`)).toBe(true);
    });
    it('collection', () => {
        expect(buildCollectionToolName(prefix, LONG_COL_ID).length).toBeLessThan(128);
    });
    it('folder', () => {
        const name = buildFolderToolName(prefix, LONG_COL_ID, 'Auth/Login/Deeply/Nested/Folder/Path');
        expect(name.length).toBeLessThan(128);
    });
    it('suite', () => {
        expect(buildSuiteToolName(prefix, LONG_REQ_ID).length).toBeLessThan(128);
    });
});

describe('build + parse round-trip', () => {
    it('request tokens resolve back to the original ids', () => {
        const name = buildRequestToolName('', LONG_COL_ID, LONG_REQ_ID);
        const parsed = parseMcpToolName(name);
        expect(parsed.kind).toBe('request');
        expect(resolveToken(parsed.tokens[0], [LONG_COL_ID, 'other'])).toBe(LONG_COL_ID);
        expect(resolveToken(parsed.tokens[1], [LONG_REQ_ID, 'other'])).toBe(LONG_REQ_ID);
    });

    it('folder tokens resolve back to the original path', () => {
        const folderPath = 'Auth/Login';
        const name = buildFolderToolName('', LONG_COL_ID, folderPath);
        const parsed = parseMcpToolName(name);
        expect(parsed.kind).toBe('folder');
        expect(resolveFolderToken(parsed.tokens[1], [folderPath, 'Other'])).toBe(folderPath);
    });

    it('throws on an unknown tool name', () => {
        expect(() => parseMcpToolName('mystery__abc')).toThrow();
    });
});

describe('resolveToken', () => {
    it('matches by hash token', () => {
        expect(resolveToken(mcpToolToken('id-1'), ['id-1', 'id-2'])).toBe('id-1');
    });

    it('falls back to a raw legacy id', () => {
        // A name listed before hashing embedded the raw id directly.
        expect(resolveToken('id-1', ['id-1', 'id-2'])).toBe('id-1');
    });

    it('returns undefined when nothing matches', () => {
        expect(resolveToken('deadbeef0000', ['id-1', 'id-2'])).toBeUndefined();
    });
});

describe('resolveFolderToken legacy fallback', () => {
    it('decodes a legacy base64url folder token', () => {
        const folderPath = 'Auth/Login';
        const legacy = Buffer.from(folderPath, 'utf8').toString('base64url');
        expect(resolveFolderToken(legacy, [folderPath])).toBe(folderPath);
    });
});

describe('mcpToolSegment (raw vs hashed)', () => {
    it('keeps a short, safe id verbatim', () => {
        expect(mcpToolSegment(SHORT_COL_ID)).toBe(SHORT_COL_ID);
    });

    it('hashes an id longer than the raw cap', () => {
        expect(mcpToolSegment(LONG_COL_ID)).toMatch(/^[a-z0-9_-]+_[0-9a-f]{12}$/);
        expect(mcpToolSegment(LONG_COL_ID)).toBe(mcpToolToken(LONG_COL_ID));
    });

    it('hashes an id containing the "__" delimiter', () => {
        // A name like "v2 (beta)" sanitizes to "v2___beta_", embedding "__".
        const withDelim = 'v2___beta__lz3k9a0f2x8';
        expect(mcpToolSegment(withDelim)).toMatch(/^[a-z0-9_-]+_[0-9a-f]{12}$/);
    });

    it('hashes an id with unsafe characters', () => {
        expect(mcpToolSegment('has/slash')).toMatch(/^[a-z0-9_-]+_[0-9a-f]{12}$/);
    });
});

describe('resolveToken hash-suffix compatibility', () => {
    it('resolves from bare hash tokens emitted by older hash-only format', () => {
        // hard-coded old-format token for LONG_REQ_ID (hash-only)
        const oldHashOnlyToken = '41eefcbd6736';
        expect(resolveToken(oldHashOnlyToken, [LONG_REQ_ID, 'other'])).toBe(LONG_REQ_ID);
    });
});

describe('builders embed short ids verbatim and still round-trip', () => {
    it('request: short ids appear raw and resolve', () => {
        const name = buildRequestToolName('', SHORT_COL_ID, SHORT_REQ_ID);
        expect(name).toBe(`request__${SHORT_COL_ID}__${SHORT_REQ_ID}`);
        expect(name.length).toBeLessThan(128);
        const parsed = parseMcpToolName(name);
        expect(parsed.kind).toBe('request');
        expect(resolveToken(parsed.tokens[0], [SHORT_COL_ID, 'other'])).toBe(SHORT_COL_ID);
        expect(resolveToken(parsed.tokens[1], [SHORT_REQ_ID, 'other'])).toBe(SHORT_REQ_ID);
    });

    it('collection / suite: short id appears raw', () => {
        expect(buildCollectionToolName('', SHORT_COL_ID)).toBe(`collection__${SHORT_COL_ID}`);
        expect(buildSuiteToolName('', SHORT_COL_ID)).toBe(`suite__${SHORT_COL_ID}`);
    });

    it('folder: a simple top-level folder name stays raw and resolves', () => {
        const folderPath = 'bookmarks';
        const name = buildFolderToolName('', SHORT_COL_ID, folderPath);
        expect(name).toBe(`folder__${SHORT_COL_ID}__${folderPath}`);
        const parsed = parseMcpToolName(name);
        expect(resolveFolderToken(parsed.tokens[1], [folderPath, 'other'])).toBe(folderPath);
    });

    it('folder: a nested (slash) path is hashed', () => {
        const folderPath = 'auth/login';
        const name = buildFolderToolName('', SHORT_COL_ID, folderPath);
        // colId stays raw, folderPath hashes because it contains "/".
        expect(name).toBe(`folder__${SHORT_COL_ID}__${mcpToolToken(folderPath)}`);
        const parsed = parseMcpToolName(name);
        expect(resolveFolderToken(parsed.tokens[1], [folderPath])).toBe(folderPath);
    });
});

describe('whole-name length guard', () => {
    it('re-hashes every segment when two raw-but-long ids would overflow', () => {
        // Each id is safe-charset and <= 60 chars individually, but together they
        // overflow SAFE_MAX_NAME_LENGTH, so the builder falls back to hashes.
        const idA = 'a'.repeat(58) + '_x';
        const idB = 'b'.repeat(58) + '_y';
        const name = buildRequestToolName('http_forge_', idA, idB);
        expect(name.length).toBeLessThan(128);
        expect(name).toBe(`http_forge_request__${mcpToolToken(idA)}__${mcpToolToken(idB)}`);
        const parsed = parseMcpToolName('request__' + mcpToolToken(idA) + '__' + mcpToolToken(idB));
        expect(resolveToken(parsed.tokens[0], [idA, idB])).toBe(idA);
        expect(resolveToken(parsed.tokens[1], [idA, idB])).toBe(idB);
    });
});
