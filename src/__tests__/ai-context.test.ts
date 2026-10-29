/**
 * AI Context Assemblers Tests
 *
 * Verifies that business context (request docs, OpenAPI metadata, collection
 * summaries, workspace knowledge files, and run results) is assembled into
 * bounded, labeled blocks for AI features.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assembleBusinessContext,
  buildCollectionBusinessContext,
  buildRequestBusinessContext,
  buildRunResultsContext,
  gatherWorkspaceKnowledge,
} from '../infrastructure/ai/ai-context';
import type { Collection, CollectionRequestItem } from '../types/collection';
import type { McpRunRecord } from '../runtime/mcp-run-store';

function makeCollection(): Collection {
  return {
    id: 'c1',
    name: 'Auth API',
    description: 'Customer identity endpoints',
    variables: { BASE_URL: 'https://api.example.com', API_KEY: 'sk_live' },
    auth: { type: 'bearer' },
    items: [
      {
        type: 'request',
        id: 'r1',
        name: 'Login',
        method: 'POST',
        url: 'https://api.example.com/v1/login',
        description: 'Exchanges credentials for a session token',
        operationId: 'loginUser',
        tags: ['auth'],
        doc: '# Login\nAuthenticates a customer using email + password and returns a JWT.',
      },
      {
        type: 'folder',
        id: 'f1',
        name: 'Users',
        items: [
          {
            type: 'request',
            id: 'r2',
            name: 'Get Me',
            method: 'GET',
            url: 'https://api.example.com/v1/me',
          },
        ],
      },
    ],
  };
}

function makeRunStore(rec: McpRunRecord | null = null): any {
  return {
    get: (id: string) => (rec && rec.id === id ? rec : undefined),
    values: () => (rec ? [rec] : []),
  };
}

describe('buildRequestBusinessContext', () => {
  it('includes docs, description, and OpenAPI metadata', () => {
    const ctx = buildRequestBusinessContext(makeCollection().items[0] as CollectionRequestItem, 'root');
    expect(ctx).toContain('Login');
    expect(ctx).toContain('Exchanges credentials for a session token');
    expect(ctx).toContain('Authenticates a customer');
    expect(ctx).toContain('loginUser');
    expect(ctx).toContain('tags: auth');
  });

  it('returns empty string when no business fields are present', () => {
    const bare: CollectionRequestItem = {
      type: 'request',
      id: 'x',
      name: 'Bare',
      method: 'GET',
      url: 'https://x.dev/ping',
    };
    expect(buildRequestBusinessContext(bare)).toBe('');
  });
});

describe('buildCollectionBusinessContext', () => {
  it('summarizes description, variables, auth, folders, and methods', () => {
    const ctx = buildCollectionBusinessContext(makeCollection());
    expect(ctx).toContain('Customer identity endpoints');
    expect(ctx).toContain('BASE_URL, API_KEY');
    expect(ctx).toContain('bearer');
    expect(ctx).toContain('Requests: 2 across 2 folder(s)');
    expect(ctx).toContain('GET(1)');
    expect(ctx).toContain('POST(1)');
  });
});

describe('gatherWorkspaceKnowledge', () => {
  it('returns empty for a missing workspace folder', () => {
    expect(gatherWorkspaceKnowledge('/nonexistent/workspace')).toBe('');
    expect(gatherWorkspaceKnowledge(undefined)).toBe('');
  });

  it('reads knowledge files, README, and AGENTS', () => {
    const dir = '/tmp/opencode/ai-context-test-workspace';
    const fs = require('fs');
    const path = require('path');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, '.http-forge', 'knowledge', 'jira'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.http-forge', 'knowledge', 'confluence.md'), '# Auth API\nOAuth2 client-credentials flow.');
    fs.writeFileSync(path.join(dir, '.http-forge', 'knowledge', 'jira', 'API-123.md'), 'Ticket: add rate limiting.');
    fs.writeFileSync(path.join(dir, 'README.md'), '# Project readme');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Coding agent rules.');

    const ctx = gatherWorkspaceKnowledge(dir);
    expect(ctx).toContain('confluence.md');
    expect(ctx).toContain('OAuth2 client-credentials flow.');
    expect(ctx).toContain('API-123.md');
    expect(ctx).toContain('# Project readme');
    expect(ctx).toContain('Coding agent rules.');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('bounds total knowledge to KNOWLEDGE_MAX', () => {
    const dir = '/tmp/opencode/ai-context-test-bounds';
    const fs = require('fs');
    const path = require('path');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, '.http-forge', 'knowledge'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.http-forge', 'knowledge', 'big.md'), 'x'.repeat(5000));
    fs.writeFileSync(path.join(dir, 'README.md'), 'y'.repeat(5000));

    const ctx = gatherWorkspaceKnowledge(dir);
    expect(ctx.length).toBeLessThanOrEqual(5000);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('buildRunResultsContext', () => {
  const rec: McpRunRecord = {
    id: 'run1',
    suiteName: 'Auth Suite',
    status: 'completed',
    summary: { total: 3, passed: 2, failed: 1 },
    startedAt: Date.now(),
    finishedAt: Date.now(),
    allResults: [
      {
        name: 'Login',
        passed: false,
        status: 401,
        responseStatus: 401,
        assertions: [
          { name: 'Status is 200', passed: false, message: 'expected 200 got 401' },
        ],
      },
      { name: 'Me', passed: true, status: 200 },
    ],
  } as unknown as McpRunRecord;

  it('summarizes pass/fail counts and failed assertions', () => {
    const ctx = buildRunResultsContext(makeRunStore(rec), 'run1');
    expect(ctx).toContain('Auth Suite');
    expect(ctx).toContain('1 failed');
    expect(ctx).toContain('Login');
    expect(ctx).toContain('Status is 200');
  });

  it('returns empty for unknown runs', () => {
    expect(buildRunResultsContext(makeRunStore(rec), 'nope')).toBe('');
  });

  it('reports in-progress runs without failing', () => {
    const running = { ...rec, status: 'running' as const };
    const ctx = buildRunResultsContext(makeRunStore(running as unknown as McpRunRecord), 'run1');
    expect(ctx).toContain('in progress');
  });
});

describe('assembleBusinessContext', () => {
  it('combines collection, request, knowledge, and run sections', () => {
    const dir = '/tmp/opencode/ai-context-test-assemble';
    const fs = require('fs');
    const path = require('path');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, '.http-forge', 'knowledge'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.http-forge', 'knowledge', 'wiki.md'), 'Business rule: sessions expire in 24h.');

    const rec: McpRunRecord = {
      id: 'run1',
      suiteName: 'Auth Suite',
      status: 'completed',
      summary: { total: 1, passed: 0, failed: 1 },
      startedAt: Date.now(),
      finishedAt: Date.now(),
      allResults: [{ name: 'Login', passed: false }],
    } as unknown as McpRunRecord;

    const ctx = assembleBusinessContext({
      collection: makeCollection(),
      request: makeCollection().items[0] as CollectionRequestItem,
      requestFolderPath: 'root',
      workspaceFolder: dir,
      runStore: makeRunStore(rec),
      runId: 'run1',
    });

    expect(ctx).toContain('## Collection');
    expect(ctx).toContain('## Request');
    expect(ctx).toContain('## Business Knowledge');
    expect(ctx).toContain('Business rule: sessions expire in 24h.');
    expect(ctx).toContain('## Test Results');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty string when nothing is available', () => {
    expect(
      assembleBusinessContext({
        collection: { id: 'c', name: 'Empty', items: [] },
      })
    ).toBe('');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
