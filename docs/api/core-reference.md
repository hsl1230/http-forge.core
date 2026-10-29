# @http-forge/core

**Standalone HTTP testing engine with Postman collection support and JavaScript-based automation.**

[![npm version](https://img.shields.io/npm/v/@http-forge/core.svg)](https://www.npmjs.com/package/@http-forge/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 📦 What is @http-forge/core?

`@http-forge/core` is a headless, framework-agnostic HTTP execution engine with **full Postman collection compatibility**. Execute complex API workflows, test suites, and automated flows without the overhead of a UI.

**Core Features:**
- 🚀 **Postman Collections** - Load and execute `.postman_collection.json` and `.forge.json` files
- 📝 **JavaScript Scripting** - Pre-request and post-response scripts with full `pm.*` API (variables, assertions, execution flow, visualizer)
- 🔄 **Dynamic Variables** - Built-in generators: `{{$randomInt}}`, `{{$timestamp}}`, `{{$uuid}}`, `{{$guid}}`, etc.
- 🌍 **Environments** - Full variable scoping (globals, collection, environment, session, iterationData)
- � **Cloud Secret Resolvers** - Resolve `{{secret:alias/path}}` from AWS Secrets Manager, Azure Key Vault, Google Secret Manager, HashiCorp Vault, 1Password, and Doppler; credentials read from the ambient environment, never from config
- �👁️ **File Watching** - Automatic reload on collection/environment file changes with notification callbacks
- 🍪 **Cookie Persistence** - Automatic cookie storage and reuse, `pm.cookies.jar()` and `.toObject()`
- 📊 **Test Assertions** - BDD-style testing with `pm.test()` (sync/async), `pm.test.skip()` / `.fail()` / `.index()`, full Chai `expect()` chains (incl. `.contain()`), and JSON Schema validation via `pm.response.to.have.jsonSchema()`
- 🔐 **CryptoJS** - Full crypto library: hash, HMAC, AES/DES/TripleDES, PBKDF2, encoding helpers
- 🎯 **Execution Flow** - `pm.setNextRequest()`, `pm.execution.skipRequest()` for suite runner flow control
- 📈 **Visualizer** - `pm.visualizer.set(template, data)` for custom Handlebars-based HTML output
- 🔌 **Extensible** - Custom interceptors, HTTP clients, and module loaders

**Ideal for:**
- CI/CD pipeline integration (GitHub Actions, GitLab CI, Jenkins)
- Headless API testing and contract validation
- Building custom API testing CLIs
- Load testing and performance monitoring
- Automated integration test suites

## 🎯 Installation

Requires Node.js `20+`.

```bash
npm install @http-forge/core
```

Or using the tarball:
```bash
npm install ./http-forge-core-0.1.0.tgz
```

## Runtime APIs (Headless + MCP)

For current programmatic runtime APIs, see [RUNTIME-API.md](RUNTIME-API.md):
- `runRequest(options)`
- `runCollection(options)`
- `runSuite(options)`
- `runQaCheck(services, workspaceFolder, options)` — one-shot QA gate (discover → generate → run → report)
- `createMcpRuntime(options)`

This covers direct execution, embeddable MCP runtime lifecycle, response include options, and report behavior. WebSocket and Socket.IO requests (requestType: 'websocket') are supported in all three direct APIs; they return a synthetic 101 response with a WebSocketRunTranscript body.

### Suite request-count estimation and live total refinement

Flow-suite progress uses a simple initial estimate, then adjusts totals during execution.

Initial estimate rules:
- `request` = `1`, `script` = `0`, `block` = sum of children
- `if` = max branch count across `then` / `elseif[]` / `else`
- `switch` = max branch count across `cases[]` / `default`
- `for` / `while` = estimated body count x estimated loop iterations

Runtime refinement rules:
- When an `if` / `switch` branch is chosen, unselected branch budget is removed from remaining total.
- When `for` / `while` execution completes, unused loop budget is removed from remaining total.

Progress `current` remains exact (executed requests), while progress `total` converges toward actual in branch-heavy suites.

### Suite flow condition aliases and performance loop

Condition expressions on `if`/`switch`/`for`/`while` nodes and script bodies share the same alias set:

- `pm.*` — Postman-compatible
- `ctx.*` — HTTP Forge idiomatic
- `hf.*` — HTTP Forge shorthand

All three resolve to the same runtime API (`variables`/`environment`/`globals`/`collectionVariables`/`request`/`response`/`cookies`/`test`/`expect`). The helper `ITestSuiteService.createTempSuiteFromRequest(collectionId, requestId)` (also exposed as the VS Code **Run Performance Test** context action) wraps a request in a `for` node with `init: hf.variables.set("__i",0)`, `loopCondition: hf.variables.get("__i") < 100`, `update: hf.variables.set("__i", hf.variables.get("__i")+1)`, `maxIterations: 100`. Change `loopCondition`/`maxIterations` to tune load; prepend a login request above the `for` node to reuse auth.

---

## 🤖 AI & Analysis APIs

All AI features use the `IAiProvider` abstraction — bring any LLM (GitHub Copilot, OpenAI, Anthropic) without changing the core logic.

### `IAiProvider`

```typescript
interface IAiProvider {
  complete(prompt: string): Promise<string>;
}
```

Implement this interface for any LLM backend. The package ships no concrete provider — callers supply one:

| Package | Provider class |
|---|---|
| `http-forge` (VS Code extension) | `CopilotAiProvider` (wraps `vscode.lm`) |
| `@http-forge/cli` | `OpenAiProvider`, `AnthropicProvider`, `createCliAiProvider()` |

### `enhanceCollection`

Enhance a collection with AI-written example bodies and `pm.test()` assertion scripts.

```typescript
import { enhanceCollection } from '@http-forge/core';

await enhanceCollection(
  collection,          // Collection to enhance
  collectionService,   // ICollectionService
  aiProvider,          // IAiProvider
  (msg, increment) => console.log(msg)  // optional progress callback
);
```

Processes requests in batches of 10. Saves after each batch. Skips requests that already have a body and test script.

### `scanCollectionForEnvVarsWithAi`

AI-powered scan for hardcoded values (API keys, tokens, base URLs, tenant IDs).

```typescript
import { scanCollectionForEnvVarsWithAi } from '@http-forge/core';

const suggestions = await scanCollectionForEnvVarsWithAi(collection, aiProvider);
// Returns EnvSuggestion[] — same shape as detectEnvSuggestions,
// so applyEnvSuggestionsToItems works for both.
```

Returns `EnvSuggestion[]` sorted by occurrence count descending.

### `detectEnvSuggestions` (heuristic, no LLM)

Rule-based detection — no AI dependency. Flags `Authorization` headers, common sensitive header/query names, shared base URLs, and long opaque strings.

```typescript
import { detectEnvSuggestions, applyEnvSuggestionsToItems } from '@http-forge/core';

const suggestions = detectEnvSuggestions(collection, /* minOccurrences */ 1);
const counts = applyEnvSuggestionsToItems(collection.items, suggestions);
await collectionService.saveCollection(collection);
```

### `parseCurlCommand`

Parse a shell curl command string into a `ParsedCurlRequest` object ready to persist as a collection request.

```typescript
import { parseCurlCommand } from '@http-forge/core';

const parsed = parseCurlCommand(
  `curl -X POST https://api.example.com/users ` +
  `-H 'Authorization: Bearer sk-abc123' ` +
  `-d '{"name":"Alice"}'`
);
// parsed.name, .method, .url, .headers, .queryParams, .body, .suggestedVars
```

`suggestedVars` contains heuristically-detected values that should become environment variables (e.g. the Bearer token above).

### AI Context & Business Knowledge

`ai-context.ts` assembles bounded, token-budgeted "business context" blocks so every AI feature is grounded in the same knowledge. All of these are exported from `@http-forge/core`:

| Export | Purpose |
|---|---|
| `buildRequestBusinessContext` | Per-request business context from structure, `doc.md`, description, and OpenAPI metadata |
| `buildCollectionBusinessContext` | Collection-level context (structure, variables, auth, folder tree, methods) |
| `gatherWorkspaceKnowledge` | Reads `.http-forge/knowledge/**/*.md`, `README.md`, and `AGENTS.md` from the workspace |
| `buildRunResultsContext` | Compact summaries of recent test runs |
| `assembleBusinessContext` | Combines all sources (plus registered `ApiKnowledgeSource`s) into one prompt payload |
| `registerKnowledgeSource` / `getRegisteredKnowledgeSources` / `clearRegisteredKnowledgeSources` | Pluggable knowledge-source registry (`collection`, `openapi`, `discovered-code`, `workspace-knowledge`, `run-results`) |

The `.http-forge/knowledge/**/*.md` convention is documented in the AGENTS.md template that `FolderCollectionStore.ensureAgentsMd()` writes — drop Confluence exports, Jira summaries, and ADRs there. These builders feed the MCP AI tools, the MCP prompts (`analyze-test-failure`, `suggest-assertions`, `review-collection`), the env suggester, and the collection enhancer.

### API Discovery, Workflow, Drift & Architect (programmatic API)

Headless, vscode-free discovery lives in `src/infrastructure/api-discovery/`; the intent-driven API designer lives in `src/infrastructure/architect/`. Key exports:

```typescript
// Discovery service + providers (six frameworks)
import {
    ApiDiscoveryService,
    ExpressDiscoveryProvider, NestDiscoveryProvider, FastifyDiscoveryProvider,
    LambdaDiscoveryProvider, SpringDiscoveryProvider, FastApiDiscoveryProvider,
    FrameworkDetector,
} from '@http-forge/core';

// Workflow discovery + test generation (Phase 2a)
import { discoverWorkflows, generateSuiteFromEndpoints, generateFlowFromEndpoints, suiteIdFromName } from '@http-forge/core';

// Drift engine (Phase 2b)
import { computeProjectFreshness, detectProjectDrift, detectIndexDrift, diffLines, threeWayDiff, proposeSuiteUpdates, applyRegenerated } from '@http-forge/core';

// API Architect (Phase 4 / Layer 8)
import { ApiArchitectService, collectionToEndpoints, renderArchitectDocs, validateDesignedSpec } from '@http-forge/core';

// QA check (discover → generate → run → report)
import { runQaCheck, qaEndpointKey, renderQaReportTable } from '@http-forge/core';
```

- `ApiDiscoveryService` orchestrates injected providers; every `DiscoveredApi` carries `provenance` (framework, source file:line) and `confidence`. Providers are deterministic (sorted method/path/file, no timestamps) and locked by golden fixtures.
- `generateSuiteFromEndpoints` emits a `.suite.json` (one request node per endpoint asserting the discovered status code) tagged `ai_generated:true` + `derived_from:<endpointId>`; `generateFlowFromEndpoints` emits a runnable `.flow.js`.
- `ApiArchitectService.designFromIntent(intent, opts)` has an AI design an OpenAPI 3.0 spec, imports it via `OpenApiImporter.importFromString`/`importFromUrl`, and packages collection + suite + flow + workflow chains + docs; `collectionToEndpoints` bridges collections into the same discovery machinery.
- `runQaCheck(services, workspaceFolder, opts)` runs the one-shot QA gate: freshness/drift check, source discovery, idempotent request creation (matched by method + path, never duplicated), deterministic `QA <collection>` suite generation, live execution, and a CI-friendly `QaCheckReport` (`pass` / `fail` / `drift` / `dry-run`, per-endpoint expected-vs-actual, low-confidence list). Optional `aiAssertions` pass (needs `aiProvider`) proposes LLM-written assertions as reviewable suggestions; `renderQaReportTable(report)` renders the human summary.

---

## 🔌 MCP Tools — AI Agent Integration

When the MCP server is running, AI agents (Claude, Copilot, etc.) can call these tools in addition to the standard run/inspect tools:

### Agentic AI tools (no LLM config needed)

These tools use the **calling AI as the analysis engine** — no API keys required on the server side.

| Tool | Description |
|---|---|
| `ai_suggest_env_vars` | Returns request data + instructions; AI finds hardcoded values and calls `apply_env_vars`. One-shot. |
| `ai_enhance_collection` | Returns paginated requests + instructions; AI writes bodies and test scripts and calls `apply_request_enhancements`. Self-continues. |
| `ai_analyze_coverage` | Returns coverage gaps + instructions; AI calls `ai_enhance_collection` for unasserted requests and `generate_scenarios` for untested operations. |
| `generate_request_from_intent` | Takes a plain-English intent; AI calls `create_request` + `set_request_script` in one shot. |
| `generate_scenarios` | Returns request list + instructions; AI creates negative/edge-case variants (400/401/403/404/boundary) per request. Self-continues. |
| `heal_assertions` | Returns current script + last run response; AI rewrites stale assertions and calls `set_request_script`. |
| `generate_iteration_data` | Returns request schema + instructions; AI produces N varied test rows as a JSON array. |

### Data tools (read → you analyze → write)

| Tool | Description |
|---|---|
| `suggest_env_vars` | Returns heuristic suggestions + full request summary for manual or AI review |
| `apply_env_vars` | Replaces `{value, varName}[]` throughout the collection; optionally writes originals to env |
| `get_requests_for_enhancement` | Returns paginated request details (body, test script, headers) |
| `apply_request_enhancements` | Applies AI-written bodies and `pm.test()` scripts to the specified requests |
| `analyze_coverage` | Per-request assertion count + collection-level %. Optional OpenAPI spec comparison. No LLM. |
| `validate_against_spec` | Compares collection against an OpenAPI 3.0 spec: untested operations, unasserted requests, extra requests. No LLM. |

### Discovery, drift & architect tools

These tools scan a backend project's source code (no OpenAPI spec involved) and drive the Phase 1/2/4 pipeline. They are registered in `GENERIC_TOOL_NAMES` (`src/runtime/mcp-tool-schemas.ts`), handled in `src/runtime/mcp-handlers/discovery.ts` (and `ai.ts` for `design_api_from_intent`), run in `drilldown`/`auto` mode, and are excluded from `execution-only` mode.

| Tool | Description |
|---|---|
| `create_request_from_endpoint` | Scan a project and create a working request from one discovered endpoint, with provenance (framework/source/confidence). No OpenAPI required |
| `generate_test_suite` | Scan a project, create requests in a collection, and emit a `.suite.json` (one request node per endpoint, each asserting the discovered status code). Tagged `ai_generated:true` + `derived_from` |
| `suggest_workflow` | Analyze discovered endpoints and return auth/CRUD workflow chains without creating anything |
| `generate_workflow` | Persist the discovered workflow chains as a suite whose `nodes` graph encodes them (request/if/script nodes) |
| `check_drift` | Check whether a project has drifted since its discovery index (git HEAD hash, else source-mtime vs `scannedAt`) |
| `propose_update` | Phase 2b loop: propose a regeneration for suites affected by stale endpoint ids; `apply:true` computes the merged 3-way-diff content for non-conflicting proposals (developer approves) |
| `design_api_from_intent` | Architect a whole REST API from a plain-English intent: AI designs an OpenAPI spec → imported as a collection → packages suite + `.flow.js` + workflow chains + docs. Requires `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` |
| `review_suite` | Phase 3 review gate: deterministic review rules over a completed run (error/warn/info findings); CI/PR fail on `summary.pass === false` |

---

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

#### Response Body Type

Like Postman, `pm.response.body` is the **raw response string** — it is not eagerly parsed. Parse JSON on demand:

```javascript
const data = pm.response.json();          // parsed object (null if not JSON)
const text = pm.response.text();          // raw string
const obj  = JSON.parse(pm.response.body); // body is a string
```

`json()` tolerates an already-parsed object body for backward compatibility, but new code should treat `pm.response.body` as a string.

#### Legacy Postman Globals

Older Postman scripts and many Newman-exported collections rely on bare globals from the pre-`pm.*` sandbox. The core injects these so legacy scripts run unchanged.

Available in **both** pre-request and test scripts: `request` (`{ id, name, description, url, method, headers, data }`), `environment` (read snapshot), `globals` (read snapshot), `data` (iteration row), `iteration` (index), and `tv4` (`tv4.validate(data, schema)` — when the optional `tv4` module is installed).

Available in **test** scripts only: `responseBody` (raw string), `responseCode` (`{ code, name, detail }`), `responseHeaders`, `responseTime`, `responseCookies` (cookie objects with `name`, `value`, `domain`, `path`, `expires`, `maxAge`, `httpOnly`, `secure`, `sameSite`), `tests` (`tests['name'] = boolean`), plus `postman.getResponseHeader(name)` and `postman.getResponseCookie(name)` (case-insensitive; `getResponseCookie` returns the full cookie object, both return `null` if absent).

```javascript
// Legacy-style test script — runs unmodified
tests['status 200'] = responseCode.code === 200;
tests['has token'] = JSON.parse(responseBody).token !== undefined;
tests['is json'] = /application\/json/.test(postman.getResponseHeader('Content-Type'));
```

> `environment` and `globals` are read snapshots — direct assignment was never persisted in legacy Postman either. Use `postman.setEnvironmentVariable()` / `postman.setGlobalVariable()` (or the modern `pm.environment.set()` / `pm.globals.set()`) to persist changes.

#### Script Scope

Control how script levels (collection → folder → request) and the pre-request/post-response phases share a JavaScript scope via `scripts.scope` in `.http-forge/http-forge.config.json` (or the `scriptScope` SDK option):

| Mode | Behavior |
|------|----------|
| `'shared'` *(default)* | All levels and both phases run in one scope. `var`/`function` and global assignments leak across them; lowest overhead. Top-level `let`/`const` are scoped to a single phase. |
| `'isolated'` | Each level runs in its own scope, matching Postman. Declarations cannot collide or leak; pass state through `pm.variables` / `pm.environment` / `pm.globals`. |

```typescript
const forge = ForgeContainer.create({ scriptScope: 'isolated' });
```

Use `'isolated'` when importing Postman collections whose scripts re-declare the same identifiers at multiple levels, which would otherwise throw `Identifier already declared` in shared mode.

#### Async Script Execution (Event-Loop Draining)

Like Postman, scripts do **not** end when their synchronous code returns. After the sync body completes, the core keeps the sandbox alive and drains pending timers (`setTimeout`/`setInterval`) and microtasks (un-awaited `Promise`s), then commits variable scopes — so deferred `pm.globals` / `pm.environment` / `pm.variables` writes are visible to the next request **without** `await`.

```typescript
// Post-response script — committed for the next request, no await required
setTimeout(() => pm.globals.set('authToken', generateToken()), 1500);
```

The drain is bounded by `scripts.timeout` (the `scriptTimeout` SDK option), default **5000 ms**, which caps **both** synchronous CPU time and the async-drain window:

```typescript
const forge = ForgeContainer.create({ scriptTimeout: 10000 });
```

| Behavior | Notes |
|----------|-------|
| Sandbox kept alive after sync return | Pending timers/microtasks drained before the request advances |
| Deferred `pm.*` writes committed | Visible to the next request without `await` |
| Errors in timer/Promise callbacks | Reported as a console error, **non-fatal** — the request/test is not failed |
| Runaway timers | A never-clearing `setInterval` or infinite timer loop is force-cancelled at the timeout, with a warning |
| No async work | Returns immediately; draining adds no measurable latency |

**Divergences from Postman:** uses real Node timers with a poll-based wall-clock drain (no exact pending-promise count, so pathological microtask recursion is bounded by the budget rather than a precise idle signal); a single `scripts.timeout` bounds both CPU time and the async window.

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

// Read a response cookie (Postman-compatible CookieList)
const sid = pm.response.cookies.get('sessionId');        // value string
const sidCookie = pm.response.cookies.one('sessionId');  // full object
if (sidCookie?.secure && sidCookie.maxAge > 0) { /* ... */ }

// List all active cookies
const allCookies = pm.cookies.list();  // [{name, value}, ...]

// Postman-style jar callback APIs also accept URL strings or pm.request.url
const jar = pm.cookies.jar();
jar.get(pm.request.url, 'sessionId', (error, cookie) => {
    if (!error && cookie) {
        console.log(cookie.value);
    }
});

// Clear cookies
pm.cookies.clear();  // When switching users/sessions
```

Cookies are automatically extracted from `Set-Cookie` response headers and reused in subsequent `Cookie` request headers.

`pm.cookies.jar()` supports `getAll(domainOrUrl, cb)`, `get(domainOrUrl, name, cb)`, `set(domainOrUrl, name, value, cb)`, `unset(domainOrUrl, name, cb)`, and `clear(cb)` or `clear(domainOrUrl, cb)`. The `domainOrUrl` argument may be a host string, a full URL string, or `pm.request.url`.

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
    scriptTimeout?: number;          // Script budget (ms); caps CPU time + async-drain window. Default 5000
    
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

### Postman Collection Import / Export

`CollectionService` can import and export Postman Collection v2.1 JSON files, preserving all request body types, auth, scripts, and folder structure.

**Import** (`importCollection(filePath)`):

Detects Postman format by `info._postman_id` and converts all five body modes:

| Postman `mode` | HTTP Forge `type` | Notes |
|---|---|---|
| `raw` | `raw` | `format` inferred from `options.raw.language` (json/xml/html/javascript/text) |
| `urlencoded` | `x-www-form-urlencoded` | Fields mapped to `[{key, value, enabled}]` |
| `formdata` | `form-data` | Fields mapped to `[{key, value, type, enabled}]` |
| `graphql` | `graphql` | `variables` JSON string parsed to object |
| `binary` | `binary` | File path not portable; imported with empty content |

Auth types `bearer`, `basic`, and `apikey` are converted. Pre-request and test scripts (`prerequest`/`test` events) are imported as `scripts.preRequest`/`scripts.postResponse`. Folder hierarchy and item order are preserved.

When using folder storage, imported Postman item order is written to the `order` arrays in `collection.json` and `folder.json` so reloads preserve execution/display order even though filesystem directory entries may sort alphabetically.

The whole collection is built in memory and persisted with a single `saveCollection()`
call. `FolderCollectionStore.save()` writes sibling items and each request's
independent files (body, docs, scripts, schemas) in parallel and writes each
metadata file once; fresh imports skip stale-body cleanup and schema-existence
probes. Loaders read JSON via a `readJsonFileSafe` helper that silently skips
empty or half-written files, so a watcher reloading mid-import never throws
`Unexpected end of JSON input`.

**Export** (`exportCollection(collectionId, filePath)`):

Converts back to Postman v2.1 JSON. All body types round-trip correctly: `x-www-form-urlencoded` exports as `mode: "urlencoded"`, `form-data` as `mode: "formdata"`, `graphql` as `mode: "graphql"`, and `binary` as `mode: "binary"`.

```typescript
const service = container.getCollectionService();

// Import
const collection = await service.importCollection('./my-api.postman_collection.json');

// Export
await service.exportCollection(collection.id, './exported.postman_collection.json');
```

### OpenAPI Import / Export

The core library includes full OpenAPI 3.0.3 import and export with constraint preservation.

**Import** (`OpenApiImporter`):
- Parses OpenAPI 3.0 YAML/JSON specs into `UnifiedCollection`
- Extracts all parameter schema constraints (`pattern`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, `enum`, `format`)
- Preserves `oneOf` schemas from merged parameters, deriving combined enum hints for UI display

**Export** (`OpenApiExporter`):
- Generates OpenAPI 3.0.3 specs from collections
- **Host-variable server resolution** — Any `{{varName}}` that prefixes a request URL (e.g. `{{dcqHost}}/api/...`) is stripped from the path and resolved to a server URL entry. If the variable resolves in the active environment(s), a concrete `url` is added to `servers`. If unresolvable, an OAS server-variable entry is emitted: `url: '{varName}', variables: { varName: { default: '' } }`. This handles arbitrary host variables beyond `{{baseUrl}}`.
- **Environment variable placeholder sanitization** — `{{varName}}` tokens in parameter examples (path, query, header) and request body examples are replaced with `<varName>` so the exported spec contains readable human placeholders rather than raw template syntax.
- **Collision-aware merging**: When multiple requests normalize to the same path + HTTP method, they are merged into a single operation:
  - Descriptions are appended, tags are unioned
  - Parameters with the **same constraint kind** (both enum, both pattern, etc.) are merged in-place (union enum values, widen numeric ranges, alternation-join patterns)
  - Parameters with **different constraint kinds** are wrapped in `oneOf` — each variant keeps its self-consistent schema
- All constraint fields round-trip without data loss
- **OpenAPI Metadata Bridge** — External tools (e.g., spring-api-tester) can pass rich OpenAPI metadata via optional request fields:
  - `operationId` — explicit operation identifier (overrides generated)
  - `summary` — separate from request name for cleaner OpenAPI
  - `tags` — operation tags (overrides folder-based tagging)
  - `responses` — per-status-code definitions with schema, examples, headers
  - `security` — operation-level security requirements
  - `examples` — request/response examples
  
  These fields integrate seamlessly—if provided, the exporter uses them; otherwise, it falls back to deriving from folder structure and collection-level settings. This enables one-click Swagger UI-compatible spec generation from annotated Java, Python, Node.js, or any framework that understands these metadata fields.

## � Exported Types

### Configuration

`HttpForgeConfig` is the shape of `.http-forge/http-forge.config.json`. Key sub-interfaces:

| Interface | Description |
|---|---|
| `StorageConfig` | Root/history/results paths |
| `RequestConfig` | Timeout, redirects, SSL, TLS defaults, host-based certificate mappings |
| `ScriptsConfig` | Module search paths, scope mode, timeout |
| `RunnerConfig` | Retention, index page size, report body embedding |
| `EnvironmentsConfig` | Default environment |
| `RestClientExportConfig` | REST Client export path/merge settings |
| `McpConfig` | MCP server project-level settings (see below) |
| `ProxyConfig` | HTTP/HTTPS proxy configuration with bypass list |
| `SecretsConfig` | Cloud secret provider aliases/config |

**`ProxyConfig`** — routes all requests through an HTTP proxy using a pure Node.js CONNECT tunnel (no extra npm packages). Resolved live on every request so changes to `http-forge.config.json` take effect immediately.

```typescript
interface ProxyConfig {
    /** Full URL of the HTTP proxy, e.g. "http://proxy.corp.com:8080" */
    http?: string;
    /** Full URL of the HTTPS proxy. Falls back to `http` if omitted. */
    https?: string;
    /** Host patterns to bypass the proxy. Supports exact ("api.local"),
     *  wildcard subdomain ("*.corp.com"), or catch-all ("*"). */
    bypass?: string[];
}
```

Credentials are embedded in the proxy URL and forwarded as `Proxy-Authorization: Basic ...` on CONNECT:

```json
{
  "proxy": {
    "https": "http://user:pass@proxy.corp.com:8080",
    "bypass": ["localhost", "*.internal.corp.com"]
  }
}
```

Set to `null` (default) to disable proxying entirely.

When used programmatically, pass a live `ProxySource` to `NodeHttpClient` so proxy settings are re-read on every request:

```typescript
import { NodeHttpClient, ProxySource } from '@http-forge/core';

const proxySource: ProxySource = () => configService.getProxyConfig();
const client = new NodeHttpClient(undefined, process.cwd(), proxySource);
```

Representative defaults (integrated layout — `workspace/.http-forge/assets`):

```typescript
const DEFAULT_CONFIG = {
    version: '1.0',
    storage: {
        format: 'folder',
        root: './.http-forge/assets',          // when config is at workspace/ → workspace/.http-forge/assets
        history: './.http-forge/.cache/histories',
        results: './.http-forge/.cache/results'
    },
    request: {
        timeout: 30000,
        followRedirects: true,
        maxRedirects: 10,
        strictSSL: true,
        tls: {},
        certificates: []
    },
    scripts: {
        modulePaths: ['./.http-forge/assets/src', './.http-forge/assets/lib'],
        scope: 'shared',
        timeout: 5000
    }
};
```

When the config lives in `workspace/.http-forge/http-forge.config.json` (integrated fallback) the same values are written as `root: "./assets"`, `history: "./.cache/histories"` etc. — **all storage / history / results / `scripts.modulePaths` / `restClientExport.path` / cert paths are resolved relative to the config file**, not to the workspace. Old ` "./.http-forge/assets"` inside `.http-forge` is automatically stripped for backward compat.

**Workspace modes:**

* **Integrated** — `workspace/.http-forge/assets/{collections,environments,suites}`. Config priority: `workspace/http-forge.config.json` **before** `workspace/.http-forge/http-forge.config.json`. Open `workspace/.http-forge/assets` directly → normalized to `workspace`.
* **Standalone (any name)** — clone the forge repo as `my-standalone` / `http-forge-assets` / any name, open that folder. `assets/` at root or bare `collections/` at root. No nested `.http-forge` required. Generic `my-standalone/assets` opened directly → normalized to `my-standalone`. Detection is structural (`assets/collections` exists), not name-based.
* **Lazy creation** — opening an empty folder does not create `.http-forge` on `ConfigService`/`CollectionService` construction. First `createCollection`/`createSuite`/`saveEnvironment` creates `assets/collections` (or `.http-forge/assets/collections` for integrated) and `AGENTS.md` once.
```

**`McpConfig`** — controls what the HTTP Forge MCP server exposes to AI agents. All fields are optional; the service fills defaults automatically via `IConfigService.getMcpConfig()`.

```typescript
interface McpConfig {
        port:                number;    // HTTP port (default: 3100)
    excludedCollections: string[];  // IDs or names to hide (default: [] = expose all)
    excludedSuites:      string[];  // IDs or names to hide (default: [] = expose all)
    toolPrefix:          string;    // Prefix for every tool name (default: "")
    maxRequestsPerCall:  number;    // Safety cap per collection/suite call (default: 500; min 1, max 10000)
    toolMode:            'flat' | 'drilldown' | 'auto'; // How tools are exposed (default: 'auto')
    drilldownThreshold:  number;    // 'auto' switches to drill-down above this request-tool count (default: 100; min 10, max 500)
    toolPageSize:        number;    // Max tools per tools/list page (default: 200; 0 = no pagination; min 10, max 1000)
    cors: {
        allowedOrigins:  string[];  // CORS origins (default: ["http://localhost","http://127.0.0.1"])
    };
}
```

**`toolMode`** controls how collections/requests are surfaced as MCP tools:

- `auto` (**default**) — uses `flat` below `drilldownThreshold` (100 requests), then switches to `drilldown`. Adapts automatically as the workspace grows.
- `drilldown` — a small fixed set of generic tools (`list_collections`, `list_requests`, `run_request`, `run_folder`, `run_collection`, `run_suite`) whose arguments select the target. Keeps the tool list tiny regardless of scale.
- `flat` — one tool per request, folder, collection, and suite. Only suitable for small, stable collections (<100 requests). **Avoid for large workspaces** — the tool list bloats the AI context window and degrades tool-selection accuracy.

Use `IConfigService.getMcpConfig()` to read the resolved config with all defaults applied.

**`SecretsConfig`** — defines named aliases used by `{{secret:alias/path}}` expressions:

```typescript
interface SecretsConfig {
    providers: Record<string, {
        provider: 'aws' | 'azure' | 'gcp' | 'vault' | '1password' | 'doppler';
        region?: string;
        profile?: string;
        vaultUrl?: string;
        projectId?: string;
        address?: string;
        mountPath?: string;
        namespace?: string;
        vault?: string;
        serviceToken?: string;
    }>;
}
```

---

## �🛠️ Use Cases

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

- [HTTP Forge Extension](https://marketplace.visualstudio.com/items?itemName=your-publisher.http-forge)
- [GitHub Repository](https://github.com/hsl1230/http-forge)
- [Issues](https://github.com/hsl1230/http-forge/issues)

## 📝 Changelog

### 0.6.x (API Discovery, Workflow, Drift, Architect)

- ✅ **Phase 1 API discovery** — `ApiDiscoveryService` with six framework providers (Express, NestJS, Fastify, Lambda, Spring, FastAPI); deterministic `DiscoveredApi[]` with provenance/confidence; golden-fixture conformance
- ✅ **Phase 2a workflow + test generation** — `discoverWorkflows` (auth/CRUD chains), `generateSuiteFromEndpoints`, `generateFlowFromEndpoints`; MCP tools `create_request_from_endpoint`, `generate_test_suite`, `suggest_workflow`, `generate_workflow`
- ✅ **Phase 2b drift engine** — `computeProjectFreshness`, `detectProjectDrift`, `threeWayDiff`, `proposeSuiteUpdates`, `applyRegenerated`; MCP tools `check_drift`, `propose_update`
- ✅ **Phase 4 / Layer 8 API Architect** — `ApiArchitectService.designFromIntent`, `collectionToEndpoints`, `buildArchitectPrompt`; `OpenApiImporter.importFromUrl`/`importFromString`; MCP tool `design_api_from_intent`
- ✅ **QA check** — `runQaCheck` (discover → generate → run → report, idempotent reruns, CI-friendly status); MCP tool `qa_api`; CLI `http-forge qa`
- ✅ **AI context layer** — `ai-context.ts` business-context builders + `.http-forge/knowledge/` convention
- ✅ **MCP runtime decomposition** — per-tool registry under `runtime/mcp-handlers/`; prompts `analyze-test-failure` / `suggest-assertions` / `review-collection`; `review_suite` review gate

### 0.7.0 (WebSocket & Socket.IO + AI & Analysis)

- ✅ **WebSocket headless execution** — `runWebSocketRequest`, `runSocketIoRequest`; `CollectionRequestExecutor` accepts injected `IWebSocketClient` and `ISocketIoClient`; mixed HTTP/WS/SIO runs; transport-aware `ok`/status reporting
- ✅ **Socket.IO adapter in core** — `NodeSocketIoClient` wraps lazily loaded `socket.io-client`; supports namespace, auth payload, transports, client version (2.x/3.x/4.x)
- ✅ **Raw WebSocket handshake cookies** — `NodeWebSocketClient` captures upgrade response headers
- ✅ **Persistent frame history** — `WebSocketRequestConfig.frameHistory`
- ✅ **`IAiProvider`** — Platform-agnostic LLM interface; bring Copilot, OpenAI, Anthropic, or any other LLM
- ✅ **`enhanceCollection`** — Batch-enhances collection requests with AI-written example bodies and `pm.test()` scripts
- ✅ **`scanCollectionForEnvVarsWithAi`** — AI-powered scan for hardcoded values (keys, tokens, base URLs)
- ✅ **`detectEnvSuggestions`** / **`applyEnvSuggestionsToItems`** — Heuristic env var detection (no LLM)
- ✅ **`parseCurlCommand`** — Tokenising shell curl parser producing a ready-to-persist `ParsedCurlRequest`
- ✅ **MCP agentic tools** — `ai_suggest_env_vars`, `ai_enhance_collection`, `suggest_env_vars`, `apply_env_vars`, `get_requests_for_enhancement`, `apply_request_enhancements`
- ✅ **MCP gap-closure tools** — `analyze_coverage`, `ai_analyze_coverage`, `validate_against_spec`, `generate_request_from_intent`, `generate_scenarios`, `heal_assertions`, `generate_iteration_data`

### 0.2.16 (Duplicate Collection & Folder)

- ✅ **`duplicateCollection(sourceId, newName)`** — Duplicates a collection including all nested folders, requests, scripts, and schemas
- ✅ **`duplicateFolder(collectionId, folderId, newName)`** — Duplicates a folder within a collection, preserving all nested request content
- ✅ **`getItemPath(collectionId, itemId)`** — Resolves the disk path of a folder or request within a collection

### 0.2.6 (OpenAPI Export — Environment Variable Handling)

- ✅ **Host-variable URL stripping** — Any leading `{{varName}}` in a request URL (e.g. `{{dcqHost}}/DCQ/templates/GetEpg`) is now correctly stripped from the path. The variable name is resolved via `envConfigService.resolveVariables()` and the resulting URL is added to `servers`. When the variable cannot be resolved, an OAS server-variable entry (`url: '{varName}', variables: { varName: { default: '' } }`) is emitted instead. Previously, unknown host variables were converted to `/{varName}/...` path segments.
- ✅ **Example sanitization** — `{{varName}}` placeholders in parameter examples (path, query, header) and request body examples are replaced with `<varName>` so they render as readable human placeholders instead of raw template syntax in the exported spec.

### 0.2.5 (OpenAPI Constraint Round-Trip & Collision Merging)

- ✅ **Full parameter constraint round-trip** — OpenAPI import/export now preserves all schema constraint fields: `pattern`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, and `oneOf` on both `KeyValueEntry` and `PathParamEntry`
- ✅ **Collision-aware OpenAPI export** — When multiple requests normalize to the same path + HTTP method, the exporter merges them into a single operation with intelligent parameter schema merging (same-kind merge in-place, different-kind wraps in `oneOf`)
- ✅ **`oneOf` import with UI hints** — `applyOneOfHints()` derives combined enum arrays and type hints from `oneOf` variants for downstream UI rendering (combobox vs strict dropdown)
- ✅ **`format` vs `pattern` separation** — `format` is a semantic hint (e.g. `"uuid"`), `pattern` is an enforced regex. Both stored and round-tripped independently

### 0.2.4 (File Watching & Request Documentation)

- ✅ **File watching for CollectionService** - Automatic reload and `onCollectionsChanged` callback when collection files change on disk
- ✅ **File watching for EnvironmentConfigService** - Automatic reload and `onEnvironmentsChanged` callback when environment JSON files change on disk
- ✅ **Request documentation (`doc.md`)** - Persist per-request Markdown documentation as `doc.md` alongside `request.json`
- ✅ **`doc` field on UnifiedRequest / CollectionRequest** - Optional `doc?: string` field for request documentation content
- ✅ **`fileWatcherFactory` bootstrap option** - Pass `IFileWatcherFactory` to enable file watching in both collection and environment services

### 0.2.0 (Postman API Parity)

- ✅ **Async `pm.test()` support** - Tests with async callbacks are properly awaited
- ✅ **Expect chain assertions** - `.a(type)`, `.an(type)`, `.deep.equal()`, `.lengthOf()`, `.exist`, `.members()`, `.keys()`, `.string()`
- ✅ **`pm.iterationData`** scope - Data-driven testing with iteration variables
- ✅ **Response status getters** - `response.to.be.ok`, `.error`, `.clientError`, `.serverError` work as getters and functions
- ✅ **Response headers HeaderList** - `.get()`, `.has()`, `.toObject()`, `.each()` on `pm.response.headers`
- ✅ **`pm.cookies.toObject()`** - Flat `{name: value}` cookie map
- ✅ **`replaceIn()` on all scopes** - Available on `pm.variables`, `pm.environment`, `pm.collectionVariables`, `pm.globals`
- ✅ **Sandbox globals** - `xml2Json()`, `jsonStringify()`, `jsonParse()` available in scripts
- ✅ **Request headers API** - `.toObject()`, `.each()` on `pm.request.headers`
- ✅ **`pm.execution.setNextRequest()`** - Runner flow control (jump to named request or stop with `null`)
- ✅ **`pm.execution.skipRequest()`** - Skip HTTP call from pre-request scripts
- ✅ **`pm.setNextRequest()`** - Top-level alias for flow control
- ✅ **`pm.visualizer.set(template, data)`** - Custom HTML visualization with Handlebars templates
- ✅ **`pm.request.url` as Url object** - Postman SDK-compatible Url with `getHost()`, `getPath()`, `getQueryString()`, `protocol`, `host`, `port`, `path`, `query`, `hash`
- ✅ **Full CryptoJS** - AES/DES/TripleDES encrypt/decrypt, PBKDF2, all hash algorithms (SHA1/256/384/512/SHA3/MD5/RIPEMD160), HMAC, encoding helpers (Hex/Base64/Utf8/Latin1/Utf16)

### 0.1.0 (Initial Release)

- ✅ **Core request execution** with Postman collection support
- ✅ **Dynamic variables** - 7 generators for on-the-fly value generation
- ✅ **Postman-compatible scripting** - `pm.*` API with full feature parity
- ✅ **Variable scoping** - globals, collection, environment, session, flow-level
- ✅ **Cookie persistence** - automatic storage and reuse across request chains
- ✅ **Pre-request & post-response scripts** with shared VM context
- ✅ **Test assertions** with BDD-style `pm.test()` and expect chains
- ✅ **Environment management** with variable substitution
- ✅ **Cookie jar** with domain-aware matching
- ✅ **Request/response interceptors** for customization
- ✅ **Request history** tracking
- ✅ **File and folder collection formats** (Postman-compatible)
- ✅ **Full TypeScript support** with comprehensive types
- ✅ **Dependency injection** for extensibility
- ✅ **Comprehensive test coverage**
