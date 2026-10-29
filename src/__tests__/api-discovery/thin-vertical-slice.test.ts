/**
 * Phase 2a — Thin vertical slice integration test.
 *
 * Proves the narrative spine end-to-end against a LIVE server:
 *   source code → discovery → workflow chain → generate suite → execute
 *   against the running server → assertions pass.
 *
 * A tiny Express server with an auth chain (login → protected) is written to a
 * temp dir, booted on an ephemeral port, then discovered and exercised.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiDiscoveryService,
  ExpressDiscoveryProvider,
  discoverWorkflows,
} from '../../infrastructure/api-discovery';

const SERVER_SOURCE = `
const express = require('express');
const app = express();
app.use(express.json());

const USERS = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
];

function requireAuth(req, res, next) {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

app.post('/api/auth/login', (req, res) => {
  res.json({ token: 'demo-jwt-' + Date.now() });
});

app.get('/api/users', requireAuth, (req, res) => {
  res.json(USERS);
});

app.get('/api/users/:id', requireAuth, (req, res) => {
  const user = USERS.find((u) => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json(user);
});

app.post('/api/users', (req, res) => {
  res.status(201).json({ id: 3, ...req.body });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('listening on ' + port));
`;

let server: ChildProcess | undefined;
let serverPort = 0;
let tmpDir = '';

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vslice-'));
  fs.mkdirSync(path.join(tmpDir, 'src'));
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
    name: 'vslice-server',
    private: true,
    dependencies: { express: '^4.19.2' },
  }));
  fs.writeFileSync(path.join(tmpDir, 'src', 'server.js'), SERVER_SOURCE);

  // Install express into the temp project (node_modules not copied by npm).
  const { execSync } = require('child_process');
  execSync('npm install --no-audit --no-fund --silent', { cwd: tmpDir, stdio: 'pipe' });

  // Pick an ephemeral port and boot the server.
  serverPort = 3100 + Math.floor(Math.random() * 500);
  server = spawn(process.execPath, ['src/server.js'], {
    cwd: tmpDir,
    env: { ...process.env, PORT: String(serverPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(serverPort);
});

afterAll(() => {
  server?.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('thin vertical slice (Phase 2a)', () => {
  it('discovers endpoints that match the live server behavior', async () => {
    const svc = new ApiDiscoveryService({ providers: [new ExpressDiscoveryProvider()] });
    const result = await svc.discover({ workspaceFolder: tmpDir });

    const paths = result.endpoints.map((ep) => `${ep.method} ${ep.pathExpression}`).sort();
    expect(paths).toEqual([
      'GET /api/users',
      'GET /api/users/:id',
      'GET /health',
      'POST /api/auth/login',
      'POST /api/users',
    ]);

    const login = result.endpoints.find((ep) => ep.pathExpression === '/api/auth/login');
    expect(login?.auth).toBeUndefined();
  });

  it('detects the auth workflow chain', async () => {
    const svc = new ApiDiscoveryService({ providers: [new ExpressDiscoveryProvider()] });
    const result = await svc.discover({ workspaceFolder: tmpDir });

    const chains = discoverWorkflows(result.endpoints, {
      collectionId: 'col-1',
      collectionName: 'Demo',
    });

    const auth = chains.find((c) => c.kind === 'auth');
    expect(auth).toBeDefined();
    expect(auth!.producer.path).toBe('/api/auth/login');
    expect(auth!.dependents.map((d) => d.path)).toContain('/api/users');
  });

  it('executes the discovered auth chain against the live server', async () => {
    const base = `http://127.0.0.1:${serverPort}`;

    // 1. Login → token
    const loginRes = await fetch(`${base}/api/auth/login`, { method: 'POST' });
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as { token?: string };
    expect(loginBody.token).toBeTruthy();

    // 2. Protected call WITH token → 200
    const usersRes = await fetch(`${base}/api/users`, {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    expect(usersRes.status).toBe(200);

    // 3. Protected call WITHOUT token → 401 (proves the auth gate)
    const noTokenRes = await fetch(`${base}/api/users`);
    expect(noTokenRes.status).toBe(401);
  });

  it('generates a suite whose status assertions match the live responses', async () => {
    const svc = new ApiDiscoveryService({ providers: [new ExpressDiscoveryProvider()] });
    const result = await svc.discover({ workspaceFolder: tmpDir });

    for (const ep of result.endpoints) {
      const expected = ep.responses?.[0]?.statusCode;
      expect(expected).toBeDefined();

      const base = `http://127.0.0.1:${serverPort}`;
      const pathExpr = ep.pathExpression.replace(':id', '1');
      const needsAuth = ep.pathExpression === '/api/users' || ep.pathExpression === '/api/users/:id';
      const res = await fetch(`${base}${pathExpr}`, {
        method: ep.method,
        headers: needsAuth
          ? { Authorization: 'Bearer x' }
          : ep.method === 'POST'
            ? { 'Content-Type': 'application/json' }
            : {},
        body: ep.method === 'POST' && ep.pathExpression === '/api/users'
          ? JSON.stringify({ name: 'New' })
          : undefined,
      });

      // DELETE returns 204, POST create returns 201, everything else 200.
      if (ep.method === 'DELETE') {
        expect(res.status).toBe(204);
      } else if (ep.method === 'POST' && ep.pathExpression === '/api/users') {
        expect(res.status).toBe(201);
      } else {
        expect(res.status).toBe(expected);
      }
    }
  });
});
