# HTTP Forge Core — Direct Execution & Embeddable APIs

Programmatic APIs for executing HTTP Forge collections, test suites, and requests without the VS Code extension.

## Installation

```bash
npm install @http-forge/core
```

## Quick Start

### 1. Execute a Single Request

```typescript
import { runRequest } from '@http-forge/core';

const result = await runRequest({
  workspaceFolder: '/path/to/workspace',
  collectionRef: 'my-api',   // name, slug, or id
  requestRef: 'get-users',   // name, slug, or id
  environment: 'production'
});

console.log(result);
// { request: 'Get Users', status: 200, ok: true, duration: '145ms', allPassed: true, ... }
```

### 2. Execute a Whole Collection

```typescript
import { runCollection } from '@http-forge/core';

const result = await runCollection({
  workspaceFolder: '/path/to/workspace',
  collectionRef: 'my-api',   // name, slug, or id
  environment: 'staging',
  iterations: 2,
  stopOnError: true,
  delay: 500
});

console.log(result);
// { collection: 'My API', environment: 'staging', summary: { total: 10, passed: 10, failed: 0, allPassed: true } }
```

### 3. Execute a Test Suite

```typescript
import { runSuite } from '@http-forge/core';

const result = await runSuite({
  workspaceFolder: '/path/to/workspace',
  suiteId: 'smoke-tests',
  environment: 'production',
  stopOnError: true
});

console.log(result);
// { suite: 'Smoke Tests', environment: 'production', summary: { total: 5, passed: 5, failed: 0, allPassed: true } }
```

### 4. Run a QA Check (Discover → Generate → Run → Report)

```typescript
import { runQaCheck, createNodeContainer } from '@http-forge/core';

const container = createNodeContainer('/path/to/workspace');
const report = await runQaCheck(
  { collection: container.collection, testSuite: container.testSuite, config: container.config },
  '/path/to/workspace',
  {
    projectPath: '/path/to/backend',
    collectionRef: 'My API',
    baseUrl: 'http://localhost:3000',
    environment: 'staging',
    dryRun: false,
  }
);

console.log(report.status); // 'pass' | 'fail' | 'drift' | 'dry-run'
// report.results: { passed, failed, skipped }; report.endpoints: per-endpoint rows
```

## API Reference

### `runRequest(options: RunRequestOptions): Promise<unknown>`

Execute a single HTTP request with full Postman parity (pre-request scripts, post-response scripts, assertions).

**Parameters:**

```typescript
interface RunRequestOptions {
  /** Workspace root folder path */
  workspaceFolder: string;

  /**
   * Collection reference — name, slug, or id (preferred).
   * Use `collectionId` for an exact id lookup (legacy).
   */
  collectionRef?: string;
  collectionId?: string;

  /**
   * Request reference — name, slug, or id (preferred).
   * Use `requestId` for an exact id lookup (legacy).
   */
  requestRef?: string;
  requestId?: string;

  /** Environment name (optional; uses default if not specified) */
  environment?: string;
  
  /** Variables to pass to the request */
  variables?: Record<string, unknown>;
  
  /** Include in response: 'headers', 'cookies', 'tests', 'consoleOutput', 'report' */
  include?: string[];
}
```

**Returns:** Result object with:
- `request` — Request name
- `status` — HTTP status code
- `ok` — Whether status is 2xx
- `duration` — Execution time (e.g., "145ms")
- `allPassed` — Whether all assertions passed
- `assertions` — Array of assertion results
- `error` — Error message if execution failed

**Example:**

```typescript
const result = await runRequest({
  workspaceFolder: process.cwd(),
  collectionRef: 'weather-api',  // name, slug, or id
  requestRef: 'get-forecast',    // name, slug, or id
  environment: 'dev',
  variables: { city: 'Seattle' },
  include: ['consoleOutput']
});

if (!result.allPassed) {
  console.error('Request failed:', result.error);
}
```

---

### `runCollection(options: RunCollectionOptions): Promise<unknown>`

Execute all enabled requests in a collection sequentially.

**Parameters:**

```typescript
interface RunCollectionOptions {
  /** Workspace root folder path */
  workspaceFolder: string;
  
  /**
   * Collection reference — name, slug, or id (preferred).
   * Use `collectionId` for an exact id lookup (legacy).
   */
  collectionRef?: string;
  collectionId?: string;
  
  /** Environment name (optional) */
  environment?: string;
  
  /** Variables to pass to all requests */
  variables?: Record<string, unknown>;
  
  /** Number of times to run the collection (default: 1) */
  iterations?: number;
  
  /** Stop execution on first failure (default: false) */
  stopOnError?: boolean;
  
  /** Delay between requests in milliseconds (default: 0) */
  delay?: number;
  
  /** Include in response: 'perRequest', 'failedOnly', 'consoleOutput', 'report' */
  include?: string[];
}
```

**Returns:** Result object with:
- `collection` — Collection name
- `environment` — Used environment name
- `summary` — Execution summary (total, passed, failed, allPassed, iterations)
- `results` — Per-request results if `include: ['perRequest']` was set

**Example:**

```typescript
const result = await runCollection({
  workspaceFolder: '/home/user/projects/api-tests',
  collectionRef: 'api-tests',  // name, slug, or id
  environment: 'staging',
  iterations: 3,
  stopOnError: true,
  delay: 1000,
  include: ['perRequest']
});

console.log(`Passed: ${result.summary.passed}/${result.summary.total}`);
console.log(result.results); // Details of each request
```

---

### `runSuite(options: RunSuiteOptions): Promise<unknown>`

Execute a pre-defined test suite.

**Parameters:**

```typescript
interface RunSuiteOptions {
  /** Workspace root folder path */
  workspaceFolder: string;
  
  /** Test suite ID */
  suiteId: string;
  
  /** Environment name (optional) */
  environment?: string;
  
  /** Variables to pass to all requests */
  variables?: Record<string, unknown>;
  
  /** Number of times to run the suite (default: 1) */
  iterations?: number;
  
  /** Stop execution on first failure (default: false) */
  stopOnError?: boolean;
  
  /** Delay between requests in milliseconds (default: 0) */
  delay?: number;
  
  /** Filter requests by name pattern */
  requestFilter?: string[];

  /**
   * Default loop guard for flow nodes (`for` / `while`) when a node-level
   * `maxIterations` is not provided. Clamped to [1, 10_000].
   *
   * Default: 100
   */
  maxNodeLoopIterations?: number;
  
  /** Include in response: 'perRequest', 'failedOnly', 'consoleOutput', 'report' */
  include?: string[];
}
```

### `runQaCheck(services, workspaceFolder, options: QaCheckOptions): Promise<QaCheckReport>`

One-shot API quality gate: freshness/drift check, source-code discovery, idempotent
request creation (matched by method + path, never duplicated), deterministic suite
generation, live execution, and a CI-friendly report.

**Parameters:**

```typescript
interface QaCheckOptions {
  /** Backend project root to scan */
  projectPath: string;
  /** Target collection (id, slug, or name) */
  collectionRef: string;
  /** Running server to execute against (required unless dryRun) */
  baseUrl?: string;
  /** Environment name (defaults to selected) */
  environment?: string;
  /** Extra variables injected into every request */
  variables?: Record<string, unknown>;
  /** Restrict discovery (express, nestjs, fastify, lambda, spring, fastapi) */
  framework?: string;
  /** Preview only: no writes, no network calls */
  dryRun?: boolean;
  /** Return `drift` status instead of proceeding when the project moved */
  failOnDrift?: boolean;
  /** Git HEAD / scan time from a prior scan (enables drift comparison) */
  storedGitHash?: string;
  storedScannedAt?: string;
  /** Also assert JSON array response bodies */
  assertBodySchema?: boolean;
  /** Propose LLM-written assertions after the run (advisory only) */
  aiAssertions?: boolean;
  /** AI backend for the assertion pass */
  aiProvider?: IAiProvider;
}
```

`QaCheckReport.status` is `pass` / `fail` / `drift` / `dry-run`; `results` carries
`{ passed, failed, skipped }` and `endpoints` carries per-endpoint rows
(`endpointKey`, `statusExpected` vs `statusGot`, `failures`, optional `suggestions`).

### Suite Flow Node Model

Suites can optionally define `nodes` to execute flow-control graphs instead of the flat `requests` list.

Supported node types:
- `request`
- `script`
- `if`
- `switch`
- `for`
- `while`
- `block`

`script` nodes support inline scripts or reusable references:
- `script`: inline script source (`string | string[]`)
- `scriptRef`: key lookup from `suite.scripts`
- `phase`: `'pre' | 'post'` (defaults to `'pre'`)

Example:

```json
{
  "id": "suite-flow-1",
  "name": "Flow Suite",
  "requests": [],
  "scripts": {
    "bootstrap": "pm.variables.set('token', 'abc');"
  },
  "nodes": [
    { "type": "script", "scriptRef": "bootstrap" },
    {
      "type": "if",
      "if": "pm.variables.get('token')",
      "then": [
        {
          "type": "request",
          "request": {
            "collectionId": "my-api_abc",
            "requestId": "get-profile_def",
            "name": "Get Profile"
          }
        }
      ]
    }
  ],
  "config": { "iterations": 1 }
}
```

Flow script execution notes:
- Flow scripts are executed through the same request script session runtime.
- Variable updates from scripts are merged at runtime through `localVariables`. (`modifiedVariables` is not persisted in result files.)
- Existing suites with only `requests` continue to run unchanged.

**Returns:** Result object with:
- `suite` — Suite name
- `environment` — Used environment name
- `summary` — Execution summary (total, passed, failed, allPassed, iterations)
- `results` — Per-request results if `include: ['perRequest']` was set

**Example:**

```typescript
const result = await runSuite({
  workspaceFolder: process.cwd(),
  suiteId: 'smoke-tests',
  environment: 'production',
  iterations: 2,
  maxNodeLoopIterations: 200,
  stopOnError: true,
  requestFilter: ['auth', 'user'],
  include: ['perRequest']
});

const failures = result.results?.filter(r => !r.passed) || [];
if (failures.length > 0) {
  console.error(`${failures.length} tests failed`);
}
```

---

### `createMcpRuntime(options: McpRuntimeOptions): Promise<McpRuntimeHandle>`

Create an embeddable MCP (Model Context Protocol) server for AI agent integration.

**Parameters:**

```typescript
interface McpRuntimeOptions {
  /** Workspace root folder path */
  workspaceFolder: string;
  
  /**
   * Port to listen on.
   * If omitted, runtime uses mcp.port from http-forge.config.json (default: 3100).
   */
  port?: number;
  
  /** Host to bind to (default: 127.0.0.1) */
  host?: string;
}
```

**Returns:** Handle object with:

```typescript
interface McpRuntimeHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getPort(): number;
  executeTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
}
```

When started, the runtime exposes:
- `POST /` (and `POST /mcp` alias) — JSON-RPC endpoint (`initialize`, `tools/list`, `tools/call`)
- `GET /health` — health check
- `GET /report?path=...` — serves generated HTML reports under workspace `.http-forge-cache`
- `POST /tools/execute` — legacy compatibility endpoint

The workspace is loaded once when `start()` is called and the resulting container is reused for the lifetime of the server — `tools/list` and `tools/call` do not re-read files from disk on every request.

The set of tools returned by `tools/list` depends on `mcp.toolMode` in `http-forge.config.json`: `"auto"` (**default** — `flat` below `drilldownThreshold` of 100, then `drilldown`; upgrades to `execution-only` when `.http-forge/AGENTS.md` exists), `"execution-only"` (~20 runtime and AI-analysis tools only), `"drilldown"` (always a small fixed set: `list_collections`, `list_requests`, `run_request`, `run_folder`, `run_collection`, `run_suite`), or `"flat"` (one tool per request/folder/collection/suite — avoid for large workspaces). `executeTool()` accepts both flat tool names and the generic drill-down tool names.

**Example:**

```typescript
const { createMcpRuntime } = require('@http-forge/core');

const runtime = await createMcpRuntime({
  workspaceFolder: '/home/user/workspace',
  host: '127.0.0.1'
});

await runtime.start();
console.log(`MCP Server running on port ${runtime.getPort()}`);

// Execute a request via MCP
const result = await runtime.executeTool('request__my-api__get-users', {
  environment: 'dev'
});

await runtime.stop();
```

---

### `createNodeContainer(workspaceFolder: string): ServiceContainer`

Initialize the HTTP Forge service container with Node.js-specific adapters. Advanced use case for custom service access.

**Parameters:**

```typescript
workspaceFolder: string; // Workspace root folder path
```

> **Stateless runs:** The Node.js bootstrap runs in stateless mode — `pm.environment.set()` overrides written by scripts are in-memory only for the duration of the run and are never persisted to disk. This means each CLI invocation starts with a clean variable state from the workspace JSON files.

**Returns:** ServiceContainer with access to all HTTP Forge services:
- `collection` — ICollectionService
- `httpRequest` — IHttpRequestService
- `environmentConfig` — IEnvironmentConfigService
- `testSuite` — ITestSuiteService
- And many more...

> **Lifecycle note:** `createNodeContainer()` and other direct container bootstrap helpers create file watchers and disposable runtime resources. Call `container.dispose()` before process shutdown when you manage the container yourself to allow Node to exit cleanly.

**Example:**

```typescript
import { createNodeContainer } from '@http-forge/core';

const container = createNodeContainer(process.cwd());

// Direct access to services
const collections = container.collection.getCollections();
const envConfig = container.environmentConfig;
const testSuites = container.testSuite;

// Use services directly
for (const collection of collections) {
  console.log(collection.name);
}
```

## Error Handling

All APIs throw errors with descriptive messages:

```typescript
try {
  const result = await runRequest({
    workspaceFolder: '/path/to/workspace',
    collectionRef: 'missing',
    requestRef: 'test'
  });
} catch (err) {
  console.error(err.message); // "Collection "missing" not found"
}
```

## Environment Variables

Variables can be passed at runtime and will override environment variable definitions:

```typescript
const result = await runRequest({
  workspaceFolder: '/path/to/workspace',
  collectionId: 'api',
  requestId: 'get-user',
  variables: {
    userId: '123',
    apiKey: 'secret-key'
  }
});

// In pre-request script: pm.variables.get('userId') → '123'
```

Execution toggles:
- `HTTP_FORGE_ENFORCE_MAX_REQUESTS=true|false` — enforce `mcp.maxRequestsPerCall` in direct mode.
- `HTTP_FORGE_GENERATE_REPORTS=true|false` — generate the self-contained HTML report in direct mode.

> **Result persistence vs. report generation:** `runCollection` and `runSuite` **always** persist the run manifest, per-iteration result files, and the result index to `.http-forge-cache/results/<suiteId>/<runId>/`, regardless of report settings. The `report` include flag (and `HTTP_FORGE_GENERATE_REPORTS`) only controls whether the HTML `report.html` is also produced. This means CLI runs without `include: ['report']` still appear in the VS Code **History** tab.

Note: MCP runtime enables both toggles during tool execution to keep MCP parity behavior.

## Integration Examples

### Express.js Middleware

```typescript
import express from 'express';
import { runRequest } from '@http-forge/core';

const app = express();

app.post('/execute', async (req, res) => {
  try {
    const result = await runRequest({
      workspaceFolder: '/path/to/workspace',
      collectionId: req.body.collection,
      requestId: req.body.request,
      environment: req.body.environment,
      variables: req.body.variables
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

### Testing Framework

```typescript
import { runSuite } from '@http-forge/core';
import assert from 'assert';

describe('API Integration Tests', () => {
  it('should pass all smoke tests', async () => {
    const result = await runSuite({
      workspaceFolder: process.cwd(),
      suiteId: 'smoke-tests',
      environment: 'staging'
    });

    assert.strictEqual(result.summary.allPassed, true);
    assert.strictEqual(result.summary.failed, 0);
  });
});
```

### CI/CD Pipeline

```typescript
#!/usr/bin/env node
import { runSuite } from '@http-forge/core';

async function main() {
  const result = await runSuite({
    workspaceFolder: process.cwd(),
    suiteId: 'smoke-tests',
    environment: 'production',
    stopOnError: true
  });

  console.log(`Tests: ${result.summary.passed}/${result.summary.total}`);
  
  if (!result.summary.allPassed) {
    process.exit(1);
  }
}

main();
```

## Architecture

The direct execution APIs:
1. **Bootstrap** a Node.js-specific service container
2. **Locate** the requested collection, request, or suite
3. **Execute** using the same `CollectionRequestExecutor` as the VS Code extension
4. **Return** structured results without process exit

This ensures **100% parity** between:
- VS Code extension execution
- CLI execution  
- Direct API execution
- MCP server execution

## Limitations

- **No GUI**: APIs return structured data; consume generated report URIs in your own tooling/UI.
- **OAuth2**: Not supported in Node.js; use static tokens in variables
- **Browser**: External browser service not available; can't open OAuth flows
- **Real-time updates**: File watching is basic; may miss rapid file changes

## Testing

Test the APIs:

```bash
npm test
```

This runs:
- Service container bootstrap test
- API export verification
- Service interface checks

## Related

- [CLI Documentation](../../../http-forge.cli/README.md)
- [Extension Documentation](../../../http-forge/README.md)
- [Postman Format Support](../../../http-forge/docs/user-guide/import-export.md)
