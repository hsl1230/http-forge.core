<!-- http-forge-agents-md-version: {{VERSION}} -->
# HTTP Forge — AI Agent Guide

This folder is the **HTTP Forge workspace root**. Do not create a nested `.http-forge/`.

> **Copilot tip:** Add `See .http-forge/AGENTS.md for the HTTP Forge AI guide.` to `.github/copilot-instructions.md`.
> **Refresh:** `http-forge refresh-agents-md --apply` (backs up to `AGENTS.md.bak`).

---

## Quick Reference

### Most-used commands
```
http-forge run collection <name> --env <env> --json
http-forge run suite <name> --json
http-forge run request <name> --collection <ref> --json
http-forge discover --path <project> --output json
http-forge generate-suite --path <project> --collection <ref> [--run]
http-forge architect "intent" --apply
http-forge qa --path <project> --collection <ref> --base-url <url>
http-forge drift --path <project>
```

### Key paths
```
assets/collections/{slug}/request.json     — request definition
assets/collections/{slug}/scripts/post-response.js — assertions (pm.test)
assets/environments/{env}.json             — environment variables
assets/suites/{name}.suite.json           — test suite
.http-forge/knowledge/**/*.md             — business context for AI
```

### Template syntax
```
{{variableName}}                    — variable
{{variable | upper | trim}}         — filter chain
{{$guid}} / {{$timestamp}}          — dynamic variable
{{variable | date:'YYYY-MM-DD'}}    — filter with argument
```

### Script globals
`pm` (also `ctx`, `hf`), `request`, `response`, `responseBody`, `tests`, `postman`, `CryptoJS`, `moment`, `_` (lodash), `querystring`, `require`, `console`, `Buffer`, `URL`, `atob`/`btoa`

---

## Decision Tree

| Task | Approach |
|---|---|
| Discover structure | Read JSON files directly (zero token cost) |
| Execute request/collection/suite | CLI if installed (`http-forge run ...`), else MCP (`run_request`, etc.) |
| Async/long-running execution | MCP with `async: true`, poll `get_run_status` |
| Diagnose failures / suggest assertions | MCP `explain_failure`, `suggest_assertions` |
| Design new API from intent | CLI `http-forge architect` or MCP `design_api_from_intent` |
| Verify existing backend E2E | CLI `http-forge qa` or MCP `qa_api` |
| Discover endpoints from source | CLI `http-forge discover` or MCP `create_request_from_endpoint` |

**Rule:** Never use MCP/CLI to discover structure — read the JSON files directly.

---

## Workflow: Design → Discover → Generate → Edit → Run → Report → Fix

1. **Design** — create API manually or from intent: `http-forge architect "..." --apply` / MCP `design_api_from_intent`
2. **Discover** — scan backend source: `http-forge discover --path <project>` / MCP `create_request_from_endpoint`
3. **Generate** — endpoints → requests/suites/flows: `http-forge generate-suite --path <project> --collection <ref>` / MCP `generate_test_suite`
4. **Edit** — refine requests, bodies, assertions, environments (direct file edit, zero token cost)
5. **Run** — execute: `http-forge run collection <name> --env <env> --json` / MCP `run_collection`
6. **Report** — inspect results: `--include report` (HTML) / MCP `get_run_summary`, `explain_failure`
7. **Fix** — heal assertions (`heal_assertions`), regenerate stale suites (`propose_update`), re-run

---

## Folder Structure

```
assets/
  collections/{slug}/
    collection.json          (id, name, variables, auth, order)
    scripts/                 (pre-request.js, post-response.js)
    {folder-slug}/
      folder.json
      {request-slug}/
        request.json         (method, url, headers, auth, body, scripts…)
        body.json / body.txt / body.graphql
        doc.md               (business docs, fed to AI)
        scripts/             (pre-request.js, post-response.js)
  environments/
    _global.json             (global vars + defaultHeaders)
    {env}.json               (per-env vars)
    {env}.local.json         (gitignored overrides)
  suites/
    {name}.suite.json        (test suite with control-flow nodes)
```

---

## Business Knowledge (`.http-forge/knowledge/`)

Drop markdown files into `.http-forge/knowledge/` (any depth). All `*.md` files are loaded and included in AI prompts, along with `README.md` and `AGENTS.md`. Per-request docs can live as `doc.md` next to `request.json`.

---

## Code & Docs in Same Workspace

Before generating tests, read the workspace for requirements:
1. `README.md`, `docs/**`, `openapi.*` — contracts and ACs.
2. `.http-forge/knowledge/**/*.md`, `doc.md` — Confluence exports, Jira ACs, ADRs.
3. API source code — route/controller files, DTOs, auth middleware (ground truth for paths, methods, status codes, validation rules).
4. Derive tests from what you read; name sources (file + AC id) in request descriptions.
5. When code and docs disagree, prefer implementation but flag drift to user.

---

## JSON Schemas

Every file has a `$schema` field. Schema base: `https://raw.githubusercontent.com/hsl1230/http-forge/main/resources/`
Files: `collection.schema.json`, `folder.schema.json`, `request.schema.json`, `environment.schema.json`, `global-environment.schema.json`, `suite.schema.json`

---

## Authoring by Direct File Editing

- **Create request:** create dir `assets/collections/{slug}/{folder}/{request}/`, write `request.json`, add slug to parent `order`.
- **Edit request:** read `request.json`, modify, write back. Variables: `{{name}}`. Filters: `{{value | upper}}`.
- **Bulk update:** find-and-replace across `assets/collections/`.
- **Environment:** edit `assets/environments/{env}.json`.
- **Suite:** write/edit `assets/suites/{name}.suite.json` (nodes: request, block, if/elseif/else, for, while, switch, script).

---

## Test Generation Best Practices

### Collection requests (smoke)
- 1-2 assertions: status code + schema shape. Keep bodies minimal.
- Assert status first, then Content-Type, then top-level fields. No volatile fields (timestamps, IDs).

### Test suites (integration/E2E/acceptance/regression)
- Suites reference requests by `collectionId` + `requestId` (no duplication).
- **Integration/E2E (CRUD):** request nodes in sequence, pass IDs via `pm.variables`/`pm.environment`, always cleanup + verify 404.
- **Acceptance:** one request node per AC, full assertions on status/body/error shapes, AC ID in test name.
- **Regression:** block/if nodes gating by env/flag; for/while for pagination.
- **Sanity:** minimal status + Content-Type, health-check endpoints, <1s.
- **Data-driven:** iterations + CSV/JSON data file; read via `pm.iterationData.toObject()`.

### Assertion depth
- Collection request: status + top-level schema.
- Suite node: full AC verification (field values, error messages, headers).
- Use `pm.response.to.have.jsonSchema(...)` for contract checks.

### Naming & traceability
- Requests: `GET /users/:id`. Suite nodes: `1. Create user`, `2. Get user`.
- Store AC IDs in `description` or `doc.md`. Mark generated suites with `ai_generated: true` + `derived_from`.

---

## AI Test Generation

### Auto-inferable (do not ask)
Endpoints, schemas, auth, params, env vars, base URL, business rules (from code/docs/knowledge), test data.

### Must ask user
Test types, ACs (if not in code), edge-case scope, target environment, auth credentials, CI/CD context, iteration data file, scope (all or subset).

### Prompt template
```
Generate tests for [endpoint or "all discovered endpoints"].
Infer from code/docs: endpoints, schemas, auth, business context.
Confirm: 1) test types  2) environment  3) auth  4) edge cases  5) ACs  6) data file
Constraints: collection requests = smoke only; suites = full AC verification; mark ai_generated: true; use pm.* API only
```

---

## Scripts & Assertions

### Template
```javascript
pm.test('Status is 200', () => pm.response.to.have.status(200));
pm.test('Content-Type is JSON', () => pm.response.to.have.header('Content-Type', /application\/json/));
pm.test('Has required fields', () => {
  const json = pm.response.json();
  pm.expect(json).to.have.property('id');
  pm.expect(json).to.have.property('name');
});
```

### Expect chain reference
- `pm.response.to.have.status(code)` — HTTP status
- `pm.response.to.have.header(name, value?)` — header exists/equals
- `pm.response.to.have.body(value?)` / `.jsonBody(value?)` / `.jsonSchema(schema)`
- `pm.response.to.be.ok / .success / .error / .clientError / .serverError`
- `pm.expect(v).to.equal(x)` / `.eql(x)` / `.have.property(n, v?)` / `.have.jsonSchema(s)`
- `pm.expect(v).to.be.ok / .true / .false / .null / .empty` / `.to.not...`
- `pm.response.responseTime` (ms), `.json()`, `.text()`, `.getHeader(name)`
- `pm.response.cookies.get(name)` / `.one(name)` / `.has(name)` / `.toObject()`
- `pm.execution.setNextRequest(name)` / `.skipRequest()` / `.runRequest(target, cb?)`
- `pm.visualizer.set(template, data)` / `.clear()`
- `pm.test(name, fn)` / `.skip()` / `.fail()` / `.index()`
- `pm.setNextRequest(name)` (top-level alias)

### Auth & variables
- `pm.environment.get/set/has/unset/clear/toObject/replaceIn`
- `pm.globals.*`, `pm.collectionVariables.*`, `pm.variables.*` (merged), `pm.iterationData`
- `pm.cookies.get/set/has/list/toObject/jar`
- `pm.request` (method, url, body, headers), `pm.response` (code, status, body, headers, cookies, responseTime)
- Legacy: `postman.setGlobalVariable()`, `postman.setEnvironmentVariable()`, `postman.getResponseHeader()`

### Template syntax
- `{{variableName}}` — variable
- `{{value | upper | trim}}` — filter chain
- `{{$guid}}`, `{{$timestamp}}` — dynamic variables
- `{{variable | date:'YYYY-MM-DD'}}` — filter with argument

---

## Recipes (step-by-step)

### Generate a collection from an OpenAPI spec
1. `http-forge import openapi spec.yaml --collection "My API"` (or MCP `scaffold_collection_from_openapi`)
2. Review generated requests in `assets/collections/{slug}/`
3. Run: `http-forge run collection "My API" --env dev --json`

### Generate tests for a discovered backend
1. `http-forge discover --path ./backend --output json` (see endpoints)
2. `http-forge qa --path ./backend --collection "My API" --base-url http://localhost:3000` (one-shot: discover → generate → run → report)
3. Or step by step: `http-forge generate-suite --path ./backend --collection "My API" --run`
4. Review generated suites in `assets/suites/`, refine assertions

### Generate a collection from natural language (AI)
1. MCP: `design_api_from_intent(intent: "I need a shopping cart with products and checkout")`
2. Review the designed OpenAPI spec + collection + suite
3. Pass `apply: true` to persist the suite and byproducts
4. Or CLI: `http-forge architect "I need a shopping cart" --apply`

### Create an environment
1. Create `assets/environments/dev.json` with `{ "name": "dev", "variables": { "baseUrl": "http://localhost:3000" } }`
2. Or use MCP: `create_environment(name: "dev")` then `set_environment_variable`
3. Use `{{baseUrl}}` in requests; reference with `--env dev`

### Write assertions for a request
1. Use MCP `suggest_assertions(collection, request)` for AI-generated assertions
2. Or write manually in `post-response.js`:
```javascript
pm.test('Status is 200', () => pm.response.to.have.status(200));
pm.test('Has id', () => pm.expect(pm.response.json()).to.have.property('id'));
```
3. Use `pm.response.json()` to parse, `pm.expect().to.equal()` for values

### Fix a failing request
1. Run: `http-forge run request <name> --collection <ref> --json`
2. Check status, headers, body in output
3. MCP: `explain_failure` for AI root-cause analysis
4. MCP: `heal_assertions` to auto-fix broken assertions
5. Fix and re-run

### Generate a test suite from discovered endpoints
1. `http-forge generate-suite --path ./backend --collection "My API"`
2. Review `assets/suites/{name}.suite.json`
3. Run: `http-forge run suite <name> --json`
4. Add assertions to request `post-response.js` files

---

## How AI Should Run Tests

### Decision: CLI vs MCP

| Situation | Use |
|---|---|
| CLI installed + shell access | CLI (lower token cost) |
| No CLI or no shell | MCP tools |
| Async / long-running | MCP with `async: true`, poll `get_run_status` |
| Failure diagnosis / assertions | MCP `explain_failure`, `suggest_assertions` |

**Rule:** Never use MCP/CLI to discover structure — read JSON files directly.

### CLI commands
```
http-forge run collection <name> --env <env> --json
http-forge run suite <name> --json
http-forge run request <name> --collection <ref> --json
http-forge run folder <path> --collection <ref> --json
http-forge discover --path <project> --output json
http-forge generate-suite --path <project> --collection <ref> [--run]
http-forge architect "intent" --apply
http-forge qa --path <project> --collection <ref> --base-url <url>
http-forge drift --path <project>
http-forge refresh-agents-md --apply
```
Add `--include report` for HTML report. Add `--exit-code` for CI.

### MCP tools
- **Execution:** `run_request`, `run_folder`, `run_collection`, `run_suite` (add `async: true`)
- **Polling:** `get_run_status`, `get_run_summary`, `get_failed_requests`, `get_request_result`, `cancel_run`
- **Analysis:** `explain_failure`, `suggest_assertions`, `analyze_coverage`, `ai_analyze_coverage`
- **Discovery:** `create_request_from_endpoint`, `generate_test_suite`, `suggest_workflow`, `generate_workflow`, `check_drift`, `propose_update`
- **QA:** `qa_api`
- **Design:** `design_api_from_intent`
- **Management:** `list_collections`, `list_requests`, `get_request`, `create_request`, `update_request`, `create_suite`, `add_suite_requests`

### Reports
- CLI: `--include report` (HTML) or `--reporter junit` (JUnit XML)
- MCP: pass `include: ["report"]`, open `report.uri`

---

## Documentation

Key docs: https://github.com/hsl1230/http-forge/tree/main/docs/user-guide
Script API types: `.http-forge/assets/http-forge-globals.d.ts`
`;