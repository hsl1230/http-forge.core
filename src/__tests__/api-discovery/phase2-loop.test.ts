/**
 * Phase 2 loop — generate-suite → runSuite integration test.
 *
 * Proves the closed loop: discover → generate a suite with status assertions →
 * run it against a live server via core's `runSuite` → the run summary reports
 * pass/fail per request.
 *
 * Mirrors what the CLI `generate-suite --run` does, but in-process.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiDiscoveryService,
  ExpressDiscoveryProvider,
  generateSuiteFromEndpoints,
} from '../../infrastructure/api-discovery';
import { createNodeContainer } from '../../runtime/node-bootstrap';
import { runSuite } from '../../runtime/direct-execution';

let server: ChildProcess | undefined;
let serverPort = 0;
let ws = '';

async function waitForServer(port: number): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

beforeAll(async () => {
  // Boot a live Express server with two endpoints.
  const srvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-srv-'));
  fs.writeFileSync(path.join(srvDir, 'package.json'), JSON.stringify({
    name: 'loop-srv', private: true, dependencies: { express: '^4.19.2' },
  }));
  fs.writeFileSync(path.join(srvDir, 'server.js'), `
const express = require('express');
const app = express();
app.use(express.json());
const users = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });
app.get('/users', (_req, res) => { res.json(users); });
app.get('/users/:id', (req, res) => {
  const user = users.find((u) => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json(user);
});
app.post('/users', (req, res) => { res.status(201).json({ id: 3, ...req.body }); });
app.delete('/users/:id', (req, res) => { res.status(204).end(); });
const port = process.env.PORT || 3000;
app.listen(port, () => console.log('up'));
`);
  const { execSync } = require('child_process');
  execSync('npm install --no-audit --no-fund --silent', { cwd: srvDir, stdio: 'pipe' });
  serverPort = 5200 + Math.floor(Math.random() * 200);
  server = spawn(process.execPath, ['server.js'], {
    cwd: srvDir, env: { ...process.env, PORT: String(serverPort) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(serverPort);

  // Workspace: collection + config + environments + suites dir.
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-ws-'));
  const assets = path.join(ws, '.http-forge', 'assets');
  fs.mkdirSync(path.join(assets, 'collections', 'demo'), { recursive: true });
  fs.mkdirSync(path.join(assets, 'suites'), { recursive: true });
  fs.mkdirSync(path.join(assets, 'environments'), { recursive: true });
  fs.writeFileSync(path.join(assets, 'collections', 'demo', 'collection.json'), JSON.stringify({
    id: 'demo', name: 'demo', description: '', items: [], version: 1,
  }));
  fs.writeFileSync(path.join(assets, 'environments', '_global.json'), JSON.stringify({ variables: {}, defaultHeaders: [] }));
  fs.writeFileSync(path.join(assets, 'environments', 'dev.json'), JSON.stringify({ variables: {}, description: 'dev' }));
  fs.writeFileSync(path.join(ws, '.http-forge', 'http-forge.config.json'), JSON.stringify({
    version: '1.0', storage: { format: 'folder', root: './.http-forge/assets' }, environments: { default: 'dev' },
  }));
});

afterAll(() => {
  server?.kill();
  if (ws) fs.rmSync(ws, { recursive: true, force: true });
});

describe('Phase 2 loop — generate → runSuite', () => {
  it('generates a suite from discovery and executes it against the live server', async () => {
    const container = createNodeContainer(ws);
    try {
      // Discover the express-app fixture (source on disk) and create requests
      // whose URLs point at the live server.
      const fixtureRoot = path.resolve(process.cwd(), 'test-fixtures', 'express-app');
      const service = new ApiDiscoveryService({ providers: [new ExpressDiscoveryProvider()] });
      const result = await service.discover({ workspaceFolder: fixtureRoot });

      const base = `http://127.0.0.1:${serverPort}`;
      const col = container.collection.getAllCollections()[0];
      const endpoints = [];
      for (const ep of result.endpoints) {
        const pathExpr = (ep.resolvedPath ?? ep.pathExpression).replace(/^\/+/, '');
        const params: Record<string, string> = {};
        for (const p of ep.params ?? []) {
          if (p.location === 'path') {
            params[p.name] = p.type === 'integer' ? '1' : p.type === 'number' ? '1.0' : p.example ?? 'test';
          }
        }
        const req = await container.collection.createRequest({
          collectionId: col.id,
          name: ep.source?.symbolName || `${ep.method} ${ep.pathExpression}`,
          method: ep.method,
          url: `${base}/${pathExpr}`,
          headers: [],
          query: [],
          params,
        });
        endpoints.push({ ...ep, id: req.id });
      }
      await container.collection.saveCollection(col);

      // Generate the suite with status assertions.
      const { suite } = generateSuiteFromEndpoints(endpoints, {
        collectionId: col.id,
        collectionName: col.name,
        name: 'Phase2Loop',
      });
      expect(suite.ai_generated).toBe(true);
      expect(suite.nodes.length).toBeGreaterThan(0);

      // Save + run the suite via core's runSuite.
      await container.testSuite.updateSuite(suite);
      const runResult = await runSuite({ workspaceFolder: ws, suiteId: suite.id });

      // The summary must reflect actual runs against the live server.
      const summary = (runResult as { summary?: { total?: number; passed?: number } }).summary;
      expect(summary).toBeDefined();
      expect(summary!.total).toBe(suite.nodes.length);
      // /health, /users, and /users/:id (path param now substituted) return 200
      // and their assertions expect 200 → pass, and DELETE /users/:id returns
      // 204 (asserted 200 from discovery) → fails, which is expected for a naive
      // status-only generation. POST /users returns 201 (asserted 200) too.
      expect(summary!.passed).toBe(4);
    } finally {
      container.dispose();
    }
  }, 30000);
});
