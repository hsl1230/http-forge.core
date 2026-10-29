<div align="center">

<a href="https://marketplace.visualstudio.com/items?itemName=henry-huang.http-forge">
<img src="https://raw.githubusercontent.com/hsl1230/http-forge/main/resources/http-forge-icon.png" alt="HTTP Forge" width="120"/>
</a>

</div>

# @http-forge/core

**Standalone HTTP testing engine with Postman collection support and JavaScript-based automation.**

[![npm version](https://img.shields.io/npm/v/@http-forge/core.svg)](https://www.npmjs.com/package/@http-forge/core)
[![npm downloads](https://img.shields.io/npm/dm/%40http-forge%2Fcore)](https://www.npmjs.com/package/@http-forge/core)
[![node](https://img.shields.io/node/v/%40http-forge%2Fcore)](https://www.npmjs.com/package/@http-forge/core)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/henry-huang.http-forge?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=henry-huang.http-forge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 📦 What is @http-forge/core?

`@http-forge/core` is a headless, framework-agnostic HTTP execution engine with **full Postman collection compatibility**. Execute complex API workflows, test suites, and automated flows without the overhead of a UI.

**Core Features:**
| Capability | What you get | Typical use case |
|---|---|---|
| **Postman-compatible execution** | Run `.postman_collection.json` and `.forge.json` with high `pm.*` API compatibility | Migrate existing Postman suites without rewriting tests |
| **AI and MCP automation** | Agent-ready MCP runtime and tools for listing, running, and managing API workflows | Copilot/agent integrations and autonomous API operations |
| **Built-in scripting and assertions** | Pre-request and post-response scripts with `pm.test()` and Chai `expect()` | API contract checks in CI/CD |
| **Variables and environments** | `{{variables}}` resolution across global, collection, environment, and runtime scopes; dynamic values like `{{$timestamp}}` and `{{$uuid}}` | Multi-environment testing (dev/staging/prod) |
| **Environment-resolved runtime config** | Request and proxy config can resolve `{{variable}}` placeholders from environment files and refresh when config/env files change | Per-environment proxy, TLS, and request tuning without restarting the runtime |
| **Stateful request flows** | Automatic cookie persistence and flow control with `pm.setNextRequest()` / `pm.execution.skipRequest()` | Auth/login chains and dependent request sequences |
| **Suite flow nodes** | Conditional/loop/script orchestration via `suite.nodes` with reusable `scriptRef` library entries | Advanced API scenarios without creating script-only HTTP requests |
| **AI-readable result artifacts** | Completed runs can produce HTML, JUnit XML, and `run-summary.md` summaries from persisted artifacts | CI publishing and AI-assisted failure analysis |
| **API discovery from source code** | `ApiDiscoveryService` scans Express, NestJS, Fastify, Lambda, Spring, and FastAPI projects and returns deterministic, provenance-tagged endpoints | Generate requests/test suites from a backend repo with no OpenAPI spec |
| **Workflow & drift automation** | Discover auth/CRUD chains, generate `.suite.json`/`.flow.js`, and 3-way-diff regenerated content against user edits | Self-maintaining generated test suites |
| **AI API design** | `ApiArchitectService.designFromIntent` designs an OpenAPI spec from plain English and packages it as collection + suite + flow + docs | Greenfield API design and review |
| **WebSocket & Socket.IO execution** | Raw WebSocket and Socket.IO requests execute headlessly with saved messages, frame transcripts, scripts, and assertions; mixed with HTTP in collections and suites | API testing for real-time endpoints |
| **Business knowledge for AI** | `.http-forge/knowledge/**/*.md`, per-request `doc.md`, and run-results assembled into bounded AI context blocks | Grounded Copilot/agent workflows |
| **OpenAPI and docs-ready workflows** | Request metadata stays aligned with API contracts and generated artifacts | Spec-driven API lifecycle and governance |
| **Extensible architecture** | Custom HTTP clients, interceptors, module loaders, and file-watching hooks | Internal platform tooling and custom runners |

**Ideal for:**
- CI/CD pipeline integration (GitHub Actions, GitLab CI, Jenkins)
- Headless API testing and contract validation
- Building custom API testing CLIs
- Load testing and performance monitoring
- Automated integration test suites

### Latest platform capabilities

- API discovery from source code for six frameworks with provenance and confidence scoring.
- Workflow generation for auth and CRUD chains, along with `.suite.json` and runnable `.flow.js` artifacts.
- Drift detection and 3-way merge logic that can regenerate stale suite content while preserving intentional edits.
- Intent-to-API design via `ApiArchitectService.designFromIntent`, turning plain-English requirements into OpenAPI, collection, suite, flow, and docs outputs.
- AI context assembly from `.http-forge/knowledge`, request docs, and test results for grounded MCP and Copilot automation.

## 🧭 Quick Navigation

- Pick the right entry point: [Start Here](#-start-here)
- AI/agent integrations: [AI and MCP Features](#-ai-and-mcp-features)
- Discovery, workflow, drift, and API design: [API Discovery & Architect](#-api-discovery-and-architect)
- Business knowledge for AI features: [AI Context & Business Knowledge](#-ai-context-and-business-knowledge)
- First integration run: [Quick Start](#-quick-start)
- Common setup issues: [Troubleshooting](#-troubleshooting)
- Install: [Installation](#-installation)
- Core architecture and execution model: [Core Concepts](#-core-concepts)
- Advanced customization: [Advanced Features](#-advanced-features)
- Types and contracts: [API Reference](#-api-reference)
- End-to-end examples: [Use Cases](#-use-cases)
- Ecosystem links: [Links](#-links)

## 🚦 Start Here

If you installed `@http-forge/core` from npm and do not have source access, this section is the fastest way to get productive.

### 1. 30-Second Path: Pick The Right Entry Point

| Goal | Best Entry | Start Here |
|---|---|---|
| Visual authoring + debugging | HTTP Forge Extension | https://marketplace.visualstudio.com/items?itemName=henry-huang.http-forge |
| CI/CD automation + reports | HTTP Forge CLI | https://github.com/hsl1230/http-forge.cli#readme |
| Custom runtime/framework integration | `@http-forge/core` | Continue in this README |

Open-source implementation references:
- Extension source: https://github.com/hsl1230/http-forge
- CLI source: https://github.com/hsl1230/http-forge.cli

### 2. Minimal Integration Template

Create a file such as `run-core.ts`:

```typescript
import { ForgeContainer } from '@http-forge/core';

async function main() {
    const forge = new ForgeContainer({
        enableCookies: true,
        requestTimeout: 15000,
    });

    // Load a collection (folder or file format)
    const collection = await forge.loadCollection('./collections/my-api.forge.json');

    // Optional: inject environment values used by {{variables}}
    forge.setEnvironment({
        baseUrl: 'https://api.example.com',
        apiKey: process.env.API_KEY || ''
    });

    // Execute first request
    const request = collection.items[0];
    const result = await forge.execute(request, collection);

    console.log('status:', result.response.status);
    console.log('body:', result.response.body);
    console.log('tests:', result.postResponseResult?.assertions || []);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
```

Run it with your preferred TypeScript runtime or compile and execute with Node.

### 3. Production Usage Checklist

- Set `requestTimeout` to match your environment/SLA.
- Enable cookies if your flow includes session-based auth.
- Feed secrets via environment variables, never hardcoded strings.
- Exit non-zero when assertions fail in CI pipelines.
- Keep collections/environments in source control for repeatability.

### 4. Learn Faster From Real Products Built On Core

- HTTP Forge extension (UI-first workflow): https://marketplace.visualstudio.com/items?itemName=henry-huang.http-forge
- HTTP Forge CLI docs (automation workflow): https://github.com/hsl1230/http-forge.cli#readme

Both are powered by `@http-forge/core` patterns you can reuse.

### 5. Postman Compatibility Matrix

| Capability | Compatibility |
|---|---|
| Postman collection import/export flows | Yes |
| Environment and variable interpolation (`{{var}}`) | Yes |
| `pm.test()` and assertions | Yes |
| `pm.variables`, `pm.environment`, `pm.collectionVariables`, `pm.globals` | Yes |
| `pm.execution.setNextRequest()` / `pm.setNextRequest()` | Yes |
| Cookie jar and persistence | Yes |
| Dynamic variables (`{{$timestamp}}`, `{{$uuid}}`, etc.) | Yes |
| Pre-request and post-response scripting | Yes |

### 6. From Postman To HTTP Forge In 3 Steps

```bash
# 1) Import Postman assets with HTTP Forge CLI
http-forge import collection --postman ./MyApi.postman_collection.json
http-forge import env --postman ./MyEnv.postman_environment.json --env staging --overwrite

# 2) Run them in CI-ready mode
http-forge run collection "MyApi" --env staging --exit-code

# 3) Embed the same collection with @http-forge/core (see Minimal Integration Template)
```

## 🤖 AI and MCP Features

`@http-forge/core` includes MCP runtime capabilities used by HTTP Forge agent workflows.

- Exposes MCP-compatible operations for collections, environments, and test execution.
- **Authoring and management tools** — create/rename/delete collections, folders, requests, suites, and environments; script and ordering tools.
- **Discovery and drift tools** — `create_request_from_endpoint`, `generate_test_suite`, `suggest_workflow`, `generate_workflow`, `check_drift`, `propose_update`, the QA gate `qa_api`, plus the API-architect tool `design_api_from_intent`.
- **Review gate** — `review_suite` runs deterministic review rules (response leaks, server errors, failed assertions, missing assertions, etc.) over a completed run and returns error/warn/info findings for use as a CI/PR gate.
- **MCP prompts** — `analyze-test-failure`, `suggest-assertions`, and `review-collection` return structured `messages[]` that the MCP host passes to its connected LLM for deep analysis.
- Enables AI agents to inspect, run, and update API testing resources programmatically.
- Powers HTTP Forge CLI/extension AI workflows through shared runtime behavior.
- Supports execution-only MCP mode for agents with workspace file access, reducing tool-list token overhead when `.http-forge/AGENTS.md` exists.
- Completed runs can generate `run-summary.md` alongside the HTML report so AI tools can inspect failures without reading raw paged result JSON first.

Learn more:
- Runtime API (MCP runtime): [docs/api/RUNTIME-API.md](docs/api/RUNTIME-API.md)
- MCP management tools reference: [docs/developer/MCP_MANAGEMENT_TOOLS.md](docs/developer/MCP_MANAGEMENT_TOOLS.md)

## 🔍 API Discovery and Architect

`@http-forge/core` can scan a backend project's source code — no OpenAPI spec required — and produce requests, test suites, workflow chains, and even a designed API. Everything lives in `src/infrastructure/api-discovery/` and `src/infrastructure/architect/`.

### API Discovery Service (`ApiDiscoveryService`)

- Scans a project root with six framework providers and returns deterministic, provenance-tagged `DiscoveredApi[]` records.
- **Providers:** Express, NestJS, Fastify, AWS Lambda (TypeScript/JavaScript), Spring (Java), and FastAPI (Python).
- Every endpoint carries `provenance` (framework, source file:line) and a `confidence` score; unknown patterns are downgraded to `confidence: 'low'` rather than guessed.
- Framework detection is file-extension-aware, so hints never leak across languages (TS/JS, `.java`, `.py`).
- Providers return endpoints sorted (method asc, path asc, file asc) with no timestamps, and each framework is locked by a golden-fixture conformance suite.

### Workflow Discovery & Test Generation (Phase 2a)

- `discoverWorkflows` detects cross-request chains from discovered endpoints — **AUTH** (token-producer → protected dependents, `authToken` variable) and **CRUD** (POST `/x` → `/{id}` operations).
- `generateSuiteFromEndpoints` / `suiteIdFromName` produce a `.suite.json` with one request node per endpoint, each asserting the discovered status code. Generated suites are tagged `ai_generated: true` + `derived_from: <endpointId>`.
- `generateFlowFromEndpoints` emits a runnable `.flow.js` artifact for the `http-forge.flow` runner.

### Drift Engine (Phase 2b)

- `computeProjectFreshness` / `detectProjectDrift` / `detectIndexDrift` — git-hash and source-mtime freshness tracking.
- `diffLines` / `threeWayDiff` / `resolveRegenerated` — LCS line diff, 3-way diff, and user-override-preserving merge.
- `proposeSuiteUpdates` / `applyRegenerated` — stale endpoint ids → affected suites (via `derived_from`) → regeneration proposals with conflict flags; the developer approves the merge step.

### API Architect (Phase 4 / Layer 8)

- `ApiArchitectService.designFromIntent(intent, opts)` — an AI designs an OpenAPI 3.0 spec from a plain-English intent, it is imported via `OpenApiImporter.importFromString`/`importFromUrl`, converted to discovered endpoints, and a reviewable package is generated: a test suite (one node per endpoint), a `.flow.js`, discovered workflow chains, markdown docs, and a round-trip OpenAPI export — all tagged `ai_generated: true`.
- `collectionToEndpoints` converts a collection into `DiscoveredApi[]` so the same workflow/CRUD machinery works on collections too.
- CLI surface: `http-forge architect "<intent>"`; MCP tool: `design_api_from_intent`.

### QA Check (discover → generate → run → report)

- `runQaCheck(services, workspaceFolder, opts)` (`src/infrastructure/qa/qa-service.ts`) — one-shot quality gate: project freshness/drift check, source discovery, idempotent request creation (matched by method + path, never duplicated), deterministic suite generation (`QA <collection>`), live execution, and a CI-friendly `QaCheckReport` (`pass` / `fail` / `drift` / `dry-run`, per-endpoint expected-vs-actual, low-confidence list). Optional `aiAssertions` pass proposes LLM-written assertions as reviewable suggestions (never a gate).
- `renderQaReportTable(report)` renders the human-readable summary; JSON output is the report object itself.
- CLI surface: `http-forge qa --path <project> --collection <ref> --base-url <url>` (exit codes `0` pass/dry-run, `1` failures, `2` infra error, `3` drift); MCP tool: `qa_api`.

## 🧠 AI Context and Business Knowledge

Every AI feature gets the same grounding through `src/infrastructure/ai/ai-context.ts`, which assembles bounded, token-budgeted "business context" blocks:

- `buildRequestBusinessContext` / `buildCollectionBusinessContext` — per-request and per-collection business context from structure, `doc.md`, descriptions, and OpenAPI metadata.
- `gatherWorkspaceKnowledge` / `workspaceKnowledgeSource` — reads `.http-forge/knowledge/**/*.md` files, `README.md`, and `AGENTS.md` from the workspace.
- `buildRunResultsContext` / `runResultsKnowledgeSource` — compact summaries of recent test runs.
- `assembleBusinessContext` — combines all sources (plus pluggable `registerKnowledgeSource` sources) into one prompt payload.
- The `.http-forge/AGENTS.md` template documents the `.http-forge/knowledge/` convention: drop Confluence exports, Jira summaries, and ADRs there so Copilot and MCP agents understand the domain.
- These builders are wired into the MCP AI tools (`ai.ts`), the MCP prompts (`mcp-prompts.ts`), the env suggester, the collection enhancer, and the extension's webview AI handlers.

## 🔀 Suite Flow Nodes

`@http-forge/core` now supports graph-style suite execution through optional `nodes` on a suite definition.

What you can use:
- `request` nodes for normal HTTP steps
- `script` nodes for script-only orchestration steps
- `if`, `switch`, `for`, `while`, and `block` for flow control
- `scripts` library on the suite plus `scriptRef` on script nodes for reuse

Behavior notes:
- `if` nodes support `then`, optional `elseif[]`, and optional `else` branches.
- `switch` nodes support `cases[]` and optional `default`.
- `for` nodes prefer `loopCondition` for loop evaluation (legacy `condition` remains backward compatible).
- Suite progress starts from a simple request-count estimate and adjusts totals live as branch and loop decisions resolve.
- **Alias parity:** condition expressions (`if`/`switch`/`for`/`while`) and script bodies both expose `pm`/`ctx`/`hf` interchangeably (`hf.variables.get("__i") < 100` === `pm.variables.get("__i") < 100` === `ctx.variables.get("__i") < 100`). The performance-test helper `TestSuiteService.createTempSuiteFromRequest` uses `hf` by default.

Flow scripts run through the same script session runtime as request scripts, so you can use `pm.variables.set/get`, `pm.environment`, and `pm.globals` (or the `ctx`/`hf` aliases) consistently.

> Performance loop: `ITestSuiteService.createTempSuiteFromRequest()` wraps a single request in a `for` node with `init: hf.variables.set("__i",0)`, `loopCondition: hf.variables.get("__i") < 100`, `update: hf.variables.set("__i", hf.variables.get("__i")+1)`, `maxIterations: 100`. Edit `loopCondition`/`maxIterations` to tune load; prepend a login request above the `for` node to reuse auth.

```json
{
    "id": "smoke-with-flow",
    "name": "Smoke With Flow",
    "requests": [],
    "scripts": {
        "setRole": "pm.variables.set('role', 'admin');"
    },
    "nodes": [
        { "type": "script", "scriptRef": "setRole" },
        {
            "type": "if",
            "if": "pm.variables.get('role') === 'admin'",
            "then": [
                {
                    "type": "request",
                    "request": {
                        "collectionId": "my-api_abc123",
                        "requestId": "get-users_def456",
                        "name": "Get Users"
                    }
                }
            ]
        }
    ],
    "config": { "iterations": 1 }
}
```

For the full runtime behavior and limits, see:
- [docs/api/RUNTIME-API.md](docs/api/RUNTIME-API.md)
- [docs/developer/SUITE_FLOW_SCRIPT_SANDBOX_SOLUTION.md](docs/developer/SUITE_FLOW_SCRIPT_SANDBOX_SOLUTION.md)

## 🎯 Installation

Requires Node.js `20+`.

```bash
npm install @http-forge/core
```

## ⚡ Quick Start

### Basic Usage

```typescript
import { ForgeContainer } from '@http-forge/core';

// Create a container with default settings
const forge = new ForgeContainer();

// Load a collection
const collection = await forge.loadCollection('./my-api.forge.json');

// Execute a request
const result = await forge.execute(collection.items[0], collection);

console.log(result.response.status);        // 200
console.log(result.response.body);          // Response data
console.log(result.postResponseResult?.assertions);  // Test results
```

### With Environment Variables

```typescript
const forge = new ForgeContainer();

// Set environment variables
forge.setEnvironment({
    baseUrl: 'https://api.example.com',
    apiKey: 'your-api-key',
    timeout: '5000'
});

// Variables are automatically interpolated in requests
// URL: {{baseUrl}}/users -> https://api.example.com/users
const result = await forge.execute(request, collection);
```

### Environment-Resolved Request And Proxy Config

When you use the higher-level environment/config services, request settings and proxy settings can resolve `{{variable}}` placeholders from file-backed environment config.

- `EnvironmentConfigService.getResolvedConfig(env)` returns the fully resolved config for one environment.
- The resolved config cache is invalidated on config-file reloads, environment-file changes, and environment switches.
- `proxy.enabled: false` disables a configured proxy without deleting the proxy URLs.

### With Custom Configuration

```typescript
const forge = new ForgeContainer({
    // Use native Node.js http/https instead of fetch
    useNativeHttp: true,
    
    // Enable automatic cookie management
    enableCookies: true,
    
    // Set request timeout
    requestTimeout: 10000,
    
    // Enable request history
    enableHistory: true,
    maxHistoryEntries: 50,
    
    // Storage format
    storageFormat: 'folder'  // or 'file'
});
```

## 🧯 Troubleshooting

### Request body not reaching backend

- `@http-forge/core` sends request bodies for all HTTP methods. This includes DELETE, GET, HEAD, and OPTIONS, matching RFC 9110 and Postman behavior.
- When `useNativeHttp: true` is enabled, the native Node.js HTTP client uses explicit `Content-Length` handling so backend services receive the body payload reliably.
- If a request still fails, verify the request headers and body content in the response detail or development logs.

### Collection Not Found

- Verify the path passed to `loadCollection()` points to an existing `.forge.json` file or collection folder.
- Use absolute paths in CI to avoid working-directory drift.

### Folder Paths With `/` In Folder Names

- User-facing folder paths should separate levels with ` / ` when a folder name itself contains `/`.
- Example display path: `agl-page-composition / TRAY/EPG / AVS5-5304 - TRAY/EPG`
- Internal `folderPath` values encode embedded slashes as `%2F`, for example `agl-page-composition/TRAY%2FEPG/AVS5-5304 - TRAY%2FEPG`.
- This convention is used by folder-scoped helpers such as temporary suite creation, MCP folder tools, and flat request/folder listings.

### Variables Not Resolving (`{{baseUrl}}` remains literal)

- Ensure variables are set before `execute()` via `setEnvironment(...)` or environment config.
- Check for typos and case mismatches in variable names.

### Script Timeout Or Stuck Script

- Increase `scriptTimeout` for heavy scripts.
- Remove long-running loops and external network calls from scripts.

### Authentication/Cookie Flows Failing Across Requests

- Enable `enableCookies: true` in `ForgeContainer` options.
- Confirm login responses include `Set-Cookie` and that subsequent requests reuse the same container instance.

### CI Does Not Fail On Test Assertion Errors

- Inspect `postResponseResult?.assertions` after each request and exit with non-zero code when failures exist.
- If using CLI, include `--exit-code`.
- If embedding `@http-forge/core` directly or bootstrapping a Node runtime, call `container.dispose()` before your process exits so runtime file watchers and disposable services are released cleanly.

## 🗂️ Workspace Modes & Configuration

HTTP Forge supports two Git layouts with the same engine. All paths in `http-forge.config.json` are **relative to the config file that defines them**, not to the workspace root.

### Integrated — `.http-forge` inside a project (default)

You open the project root (`my-project`). `.http-forge` is a literal subfolder:

```
my-project/                 ← workspace you open
 ├─ http-forge.config.json  ← OPTIONAL, if present it WINS
 └─ .http-forge/
    ├─ http-forge.config.json  ← fallback if root config missing
    └─ assets/
       ├─ collections/  (shopping-cart-api/ …)
       ├─ environments/ (dev.json, _global.json)
       └─ suites/
```

*No config:* `root = my-project/.http-forge/assets`.
*Root config* `{"storage":{"root":"./custom"}}` → `my-project/custom`.
*Nested config* `{"storage":{"root":"./assets"}}` in `.http-forge/` → `my-project/.http-forge/assets`. Old `"./.http-forge/assets"` inside `.http-forge` is automatically stripped for backward compat.

### Standalone — `.http-forge` is its own repo (any name)

Clone the forge repo anywhere (`my-standalone`, `http-forge-assets`, `acme-tests` — **not** required to be named `.http-forge`) and open that folder. No nested `.http-forge` layer:

```
my-standalone/              ← workspace = forge root, any name
 ├─ http-forge.config.json  ← OPTIONAL {"storage":{"root":"./assets"}}
 ├─ assets/
 │  ├─ collections/
 │  └─ environments/
 └─ .cache/
```

Bare `collections/` at root (`http-forge-assets` today) also works: `root = my-bare` when `my-bare/collections/c1/collection.json` exists.

*No config:* probes `my-standalone/.http-forge/assets` (miss) → `my-standalone/assets` (hit) → `my-standalone/assets`; bare → `my-standalone` itself.
*With `my-standalone/http-forge.config.json` `{"storage":{"root":"./assets"}}` → `my-standalone/assets`. Old `"./.http-forge/assets"` + standalone is stripped to `"./assets"`.

**Priority:** `workspace/http-forge.config.json` **before** `workspace/.http-forge/http-forge.config.json` (previously opposite). Same for `proxy`, `scripts.modulePaths`, `storage.history/results`, `restClientExport.path`, cert paths.

**Opening `assets` directly:** `my-standalone/assets` → normalizes to `my-standalone`; `my-project/.http-forge/assets` → normalizes to `my-project`. Both load the same `assets/collections`. The check is structural (`assets/collections` exists), not name-based, so a standalone repo named anything works.

**Lazy creation:** Opening an empty folder does **not** create `.http-forge` on activation. It is created only on first `createCollection()` / `createSuite()` / `saveEnvironment()` — then `assets/collections` + `AGENTS.md` appear. This applies to both modes and any folder name.

## 📚 Core Concepts

### ForgeContainer

The main entry point - a dependency injection container that wires up all components.

```typescript
const forge = new ForgeContainer(options);

// Load collections
const collection = await forge.loadCollection(path);
const folderCollection = await forge.loadFolderCollection(path);

// Execute requests
const result = await forge.execute(request, collection, options);

// Manage environments
forge.setEnvironment(variables);
forge.setActiveEnvironment(name);
const resolved = forge.getResolvedEnvironment();

// Access services
const executor = forge.getRequestExecutor();
const loader = forge.getCollectionLoader();
```

### Request Execution

Execute requests with full control over the execution pipeline:

```typescript
const result = await forge.execute(request, collection, {
    environment: 'production',
    overrides: {
        url: 'https://override.com/api',
        headers: { 'X-Custom': 'value' }
    },
    skipPreRequest: false,
    skipPostResponse: false,
    timeout: 5000
});

// Access results
console.log(result.response);           // HTTP response
console.log(result.preRequestResult);   // Pre-request script output
console.log(result.postResponseResult); // Test results
```

### Dynamic Variables

Automatic variable generation within request templates:

```javascript
// URL with dynamic timestamp
https://api.example.com/events?timestamp={{$timestamp}}

// Headers with unique ID
X-Request-ID: {{$uuid}}

// Query parameters with random value
?page=1&seed={{$randomInt:1:100}}
```

**Supported dynamic variables:**
- `{{$randomInt}}` - Random integer (0-2147483647)
- `{{$randomInt:min:max}}` - Random integer in range
- `{{$timestamp}}` - Current Unix timestamp (seconds)
- `{{$uuid}}` - UUID v4
- `{{$guid}}` - GUID (alias for uuid)
- `{{$randomString}}` - 10-char alphanumeric string
- `{{$randomHexadecimal}}` - Random hex string
- `{{$isoTimestamp}}` - ISO 8601 timestamp

### Script Execution

Run pre-request and post-response scripts with full Postman API compatibility:

**Pre-request script - Set variables & modify request:**
```javascript
// Set variables across scopes
pm.variables.set('requestId', pm.variables.randomUUID());
pm.environment.set('token', 'abc-123');
pm.collectionVariables.set('counter', '1');

// Modify request headers
pm.request.headers.add({
    name: 'X-Request-ID',
    value: pm.variables.get('requestId')
});
pm.request.headers.update({
    name: 'Authorization',
    value: 'Bearer ' + pm.environment.get('token')
});

// Modify URL and body
pm.request.url = 'https://api.example.com' + pm.request.url;
pm.request.body.raw = JSON.stringify({ timestamp: Date.now() });

// Set cookies for next request
pm.cookies.set('sessionId', 'sess_abc123');
```

**Post-response script - Test & extract data:**
```javascript
// Run assertions
pm.test('Status is 200', () => {
    pm.expect(pm.response.code).to.equal(200);
});
pm.test('Response time under 1s', () => {
    pm.expect(pm.response.responseTime).to.be.below(1000);
});

// Extract data for next request
const data = pm.response.json();
pm.environment.set('userId', data.id);
pm.environment.set('authToken', data.token);

// Store non-string values (auto-serialized with type safety)
pm.environment.set('userList', data.users);     // Array → stored with type marker
pm.environment.set('config', { retries: 3 });   // Object → stored with type marker
pm.environment.set('count', 42);                // Number → stored with type marker

// get() auto-deserializes back to the original type
const users = pm.environment.get('userList');    // → Array
const config = pm.environment.get('config');     // → Object
const count = pm.environment.get('count');       // → 42 (number)

// Strings are never misinterpreted — "true" stays a string, true stays a boolean
pm.environment.set('flag', true);               // boolean
pm.environment.set('label', 'true');            // string
pm.environment.get('flag');                     // → true (boolean)
pm.environment.get('label');                    // → "true" (string)

// Store cookies from response
if (pm.response.headers.has('Set-Cookie')) {
    pm.cookies.set('authCookie', data.authCookie);
}
```

### Environment Management

```typescript
// Define multiple environments
forge.setEnvironmentConfig({
    dev: { baseUrl: 'https://dev.api.com', apiKey: 'dev-key' },
    staging: { baseUrl: 'https://staging.api.com', apiKey: 'staging-key' },
    prod: { baseUrl: 'https://api.com', apiKey: 'prod-key' }
});

// Switch environments
forge.setActiveEnvironment('prod');

// Get resolved variables (with inheritance and overrides)
const vars = forge.getResolvedEnvironment('prod');
```

## 🔧 Advanced Features

### Custom HTTP Client

Implement your own HTTP client:

```typescript
import { IHttpClient, HttpRequest, HttpResponse } from '@http-forge/core';

class CustomHttpClient implements IHttpClient {
    async send(request: HttpRequest): Promise<HttpResponse> {
        // Your custom HTTP logic
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            body: {},
            duration: 100,
            size: 1024
        };
    }
}

const forge = new ForgeContainer({
    httpClient: new CustomHttpClient()
});
```

### Request/Response Interceptors

Add custom interceptors to modify requests and responses:

```typescript
import { IRequestInterceptor, IResponseInterceptor } from '@http-forge/core';

// Request interceptor
class AuthInterceptor implements IRequestInterceptor {
    async intercept(request: HttpRequest): Promise<HttpRequest> {
        request.headers['Authorization'] = `Bearer ${getToken()}`;
        return request;
    }
}

// Response interceptor
class LoggingInterceptor implements IResponseInterceptor {
    async intercept(response: HttpResponse, request: HttpRequest): Promise<HttpResponse> {
        console.log(`${request.method} ${request.url} -> ${response.status}`);
        return response;
    }
}

const forge = new ForgeContainer({
    requestInterceptors: [new AuthInterceptor()],
    responseInterceptors: [new LoggingInterceptor()]
});
```

### Cookie Management & Persistence

Automatic cookie storage and reuse across multi-request flows:

```typescript
const forge = new ForgeContainer({
    enableCookies: true  // Cookies persist across requests in session
});

// Login - response sets Session-ID cookie
const loginResult = await forge.execute(loginRequest, collection);

// Subsequent requests automatically include Session-ID
// No need to manually extract and re-add cookies
const dataResult = await forge.execute(dataRequest, collection);
const updateResult = await forge.execute(updateRequest, collection);
```

**Access cookies in scripts:**
```javascript
// Pre-request script - read stored cookies
if (pm.cookies.has('sessionId')) {
    const sid = pm.cookies.get('sessionId');
    pm.request.headers.add({
        name: 'Cookie',
        value: 'sessionId=' + sid
    });
}

// Post-response script - store new cookies
pm.response.cookies.forEach(cookie => {
    pm.cookies.set(cookie.name, cookie.value);
});

// List all active cookies
const allCookies = pm.cookies.list();  // [{name, value}, ...]

// Clear cookies
pm.cookies.clear();  // When switching users/sessions
```

Cookies are automatically extracted from `Set-Cookie` response headers and reused in subsequent `Cookie` request headers.

### Request History

Track all executed requests:

```typescript
const forge = new ForgeContainer({
    enableHistory: true,
    maxHistoryEntries: 100
});

// Execute requests
await forge.execute(request1, collection);
await forge.execute(request2, collection);

// Access history
const history = forge.getRequestHistory();
const entries = history.getAll();         // All requests
const byId = history.getByRequestId(id);  // Specific request history
```

## 📖 API Reference

### ForgeContainer

**Constructor Options:**
```typescript
interface ForgeContainerOptions {
    forgeRoot?: string;              // Path to http-forge folder
    storageFormat?: 'file' | 'folder'; // Collection storage format
    
    // HTTP Settings
    useNativeHttp?: boolean;         // Use native http/https
    httpClient?: IHttpClient;        // Custom HTTP client
    httpSettings?: RequestSettings;  // Default HTTP settings
    requestTimeout?: number;         // Request timeout (ms)
    
    // Cookie Settings
    enableCookies?: boolean;         // Enable cookie jar
    cookieJar?: ICookieJar;         // Custom cookie jar
    
    // Interceptors
    requestInterceptors?: IRequestInterceptor[];
    responseInterceptors?: IResponseInterceptor[];
    errorInterceptors?: IErrorInterceptor[];
    
    // Script Settings
    scriptRunner?: IScriptRunner;    // Custom script runner
    scriptTimeout?: number;          // Script timeout (ms)
    
    // History
    enableHistory?: boolean;         // Enable request history
    maxHistoryEntries?: number;      // Max history size
    
    // File Watching
    fileWatcherFactory?: IFileWatcherFactory; // Watch for collection/environment file changes
}
```

**Methods:**
```typescript
// Collection loading
loadCollection(path: string): Promise<UnifiedCollection>
loadFolderCollection(path: string): Promise<UnifiedCollection>

// Request execution
execute(
    request: UnifiedRequest,
    collection: UnifiedCollection,
    options?: ExecuteOptions
): Promise<ExecuteResult>

// Environment management
setEnvironment(variables: Record<string, string>): void
setEnvironmentConfig(config: EnvironmentConfig): void
setActiveEnvironment(name: string): void
getResolvedEnvironment(name?: string): Record<string, string>

// Service access
getRequestExecutor(): RequestExecutor
getCollectionLoader(): ICollectionLoader
getEnvironmentResolver(): EnvironmentResolver
getRequestHistory(): IRequestHistory
```

### ExecuteResult

```typescript
interface ExecuteResult {
    response: HttpResponse;          // HTTP response
    preRequestResult?: ScriptResult; // Pre-request script output
    postResponseResult?: ScriptResult; // Test results
    requestId: string;               // Unique request ID
    timestamp: number;               // Execution timestamp
}
```

### HttpResponse

```typescript
interface HttpResponse {
    status: number;                  // HTTP status code
    statusText: string;              // Status text
    headers: Record<string, string>; // Response headers
    body: any;                       // Parsed response body
    cookies?: Cookie[];              // Response cookies
    duration: number;                // Request duration (ms)
    size: number;                    // Response size (bytes)
    redirected?: boolean;            // Whether redirected
}
```

### KeyValueEntry

Used for headers and query parameters in `CollectionRequest`. Supports OpenAPI metadata for generation and validation.

```typescript
interface KeyValueEntry {
    key: string;
    value: string;
    enabled?: boolean;
    // OpenAPI metadata (all optional, backward-compatible)
    type?: 'string' | 'integer' | 'number' | 'boolean' | 'array';
    required?: boolean;
    description?: string;
    format?: string;               // Semantic hint (e.g. "uuid", "date-time")
    enum?: string[];               // Allowed values
    deprecated?: boolean;
    // Extended constraint fields for full OpenAPI round-trip
    pattern?: string;              // Regex validation pattern
    minimum?: number;
    maximum?: number;
    exclusiveMinimum?: number;
    exclusiveMaximum?: number;
    minLength?: number;
    maxLength?: number;
    oneOf?: Array<Record<string, any>>; // Merged constraint variants
}
```

### PathParamEntry

Used for path parameters (`:param` in URLs). Same constraint fields as `KeyValueEntry` minus `key`/`enabled`.

```typescript
interface PathParamEntry {
    value: string;
    type?: 'string' | 'integer' | 'number' | 'boolean';
    description?: string;
    format?: string;
    enum?: string[];
    deprecated?: boolean;
    pattern?: string;
    minimum?: number;
    maximum?: number;
    exclusiveMinimum?: number;
    exclusiveMaximum?: number;
    minLength?: number;
    maxLength?: number;
    oneOf?: Array<Record<string, any>>;
}
```

### OpenAPI Import / Export

The core library includes full OpenAPI 3.0.3 import and export with constraint preservation.

**Import** (`OpenApiImporter`):
- Parses OpenAPI 3.0 YAML/JSON specs into `UnifiedCollection`
- Extracts all parameter schema constraints (`pattern`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, `enum`, `format`)
- Preserves `oneOf` schemas from merged parameters, deriving combined enum hints for UI display

**Export** (`OpenApiExporter`):
- Generates OpenAPI 3.0.3 specs from collections
- **Collision-aware merging**: When multiple requests normalize to the same path + HTTP method, they are merged into a single operation:
  - Descriptions are appended, tags are unioned
  - Parameters with the **same constraint kind** (both enum, both pattern, etc.) are merged in-place (union enum values, widen numeric ranges, alternation-join patterns)
  - Parameters with **different constraint kinds** are wrapped in `oneOf` — each variant keeps its self-consistent schema
- All constraint fields round-trip without data loss

## 🛠️ Use Cases

### CLI Tool

```typescript
#!/usr/bin/env node
import { ForgeContainer } from '@http-forge/core';

async function runTests(collectionPath: string) {
    const forge = new ForgeContainer();
    const collection = await forge.loadCollection(collectionPath);
    
    for (const request of collection.items) {
        const result = await forge.execute(request, collection);
        const tests = result.postResponseResult?.assertions || [];
        
        console.log(`\n${request.name}: ${result.response.status}`);
        tests.forEach(test => {
            console.log(`  ${test.passed ? '✓' : '✗'} ${test.name}`);
        });
    }
}

runTests(process.argv[2]);
```

### CI/CD Integration

```typescript
import { ForgeContainer } from '@http-forge/core';

async function ciTest() {
    const forge = new ForgeContainer({
        enableCookies: true,
        requestTimeout: 30000
    });
    
    forge.setEnvironment({
        baseUrl: process.env.API_URL,
        apiKey: process.env.API_KEY
    });
    
    const collection = await forge.loadCollection('./api-tests.forge.json');
    
    let failedTests = 0;
    for (const request of collection.items) {
        const result = await forge.execute(request, collection);
        const failed = result.postResponseResult?.assertions?.filter(t => !t.passed) || [];
        failedTests += failed.length;
    }
    
    process.exit(failedTests > 0 ? 1 : 0);
}
```

### Custom Testing Framework

```typescript
import { ForgeContainer } from '@http-forge/core';

class ApiTestRunner {
    private forge: ForgeContainer;
    
    constructor() {
        this.forge = new ForgeContainer({
            enableCookies: true,
            enableHistory: true
        });
    }
    
    async runSuite(suites: TestSuite[]) {
        for (const suite of suites) {
            await this.runTests(suite);
        }
    }
    
    async runTests(suite: TestSuite) {
        const collection = await this.forge.loadCollection(suite.collection);
        
        for (const request of collection.items) {
            const result = await this.forge.execute(request, collection);
            suite.results.push(result);
        }
    }
}
```

### Multi-Request Workflows

Execute dependent request chains with automatic cookie and variable management:

```typescript
import { ForgeContainer } from '@http-forge/core';

async function apiAuthWorkflow() {
    const forge = new ForgeContainer({
        enableCookies: true,  // Cookies persist across requests
        enableHistory: true
    });

    // Request 1: Login (sets session cookie)
    const loginReq = {
        name: 'Login',
        method: 'POST',
        url: 'https://api.example.com/auth/login',
        body: { type: 'raw', content: JSON.stringify({ 
            username: '{{email}}',
            password: '{{password}}'
        })},
        scripts: {
            postResponse: `
                const { token, userId } = pm.response.json();
                pm.environment.set('authToken', token);
                pm.environment.set('userId', userId);
            `
        }
    };
    
    const loginResult = await forge.execute(loginReq, collection);
    console.log('✓ Logged in, token:', forge.getResolvedEnvironment()['authToken']);
    
    // Request 2: Fetch user profile (uses session cookie automatically)
    const profileReq = {
        name: 'Get Profile',
        method: 'GET',
        url: 'https://api.example.com/users/{{userId}}',
        headers: {
            'Authorization': 'Bearer {{authToken}}'  // Uses token from login
        }
    };
    
    const profileResult = await forge.execute(profileReq, collection);
    console.log('✓ Profile:', profileResult.response.body);
    
    // Request 3: Update profile (session cookie still active)
    const updateReq = {
        name: 'Update Profile',
        method: 'PATCH',
        url: 'https://api.example.com/users/{{userId}}',
        headers: {
            'Authorization': 'Bearer {{authToken}}'
        },
        body: { type: 'raw', content: JSON.stringify({ status: 'active' })}
    };
    
    const updateResult = await forge.execute(updateReq, collection);
    console.log('✓ Updated profile');
    
    // Session automatically logged out - cookies cleared
    forge.getRequestHistory().clear();
}
```

## 📦 Storage Formats

### File Format (Single JSON)
```
my-api.forge.json
```

### Folder Format (Directory Structure)
```
my-api/
  collection.json
  requests/
    login/
      request.json
      doc.md               # Optional request documentation (Markdown)
    users/
      get-users/
        request.json
        doc.md
      create-user/
        request.json
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT © Henry Huang

## 🔗 Links

- [HTTP Forge Extension](https://marketplace.visualstudio.com/items?itemName=henry-huang.http-forge)
- [HTTP Forge CLI](https://github.com/hsl1230/http-forge.cli#readme)
- [Core Reference Docs](docs/api/core-reference.md)
- [Changelog](CHANGELOG.md)
- [GitHub Repository](https://github.com/hsl1230/http-forge)
- [Issues](https://github.com/hsl1230/http-forge/issues)

