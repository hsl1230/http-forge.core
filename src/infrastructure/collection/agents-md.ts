/**
 * AGENTS.md Guide Management
 *
 * Single Responsibility: own the `.http-forge/AGENTS.md` template (version +
 * content) and the read/status/refresh operations on it. `FolderCollectionStore`
 * delegates first-time creation here; the VS Code extension and the CLI reuse
 * the status/refresh helpers so every host agrees on what "stale" means.
 *
 * Versioning: `AGENTS_MD_VERSION` must be bumped on every template change.
 * Files without a marker (all guides written before versioning) read as
 * version 0 and are therefore stale. Refresh is always replace-with-backup —
 * the previous file is copied to `AGENTS.md.bak` (single deterministic
 * backup, overwritten on repeat) before the fresh template is written, so
 * user customizations are never silently lost.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Current template version. Bump when `buildAgentsMdContent()` changes. */
export const AGENTS_MD_VERSION = 4;

export const AGENTS_MD_FILENAME = 'AGENTS.md';
export const AGENTS_MD_BACKUP_FILENAME = 'AGENTS.md.bak';

const VERSION_MARKER_RE = /http-forge-agents-md-version:\s*(\d+)/;

/** Absolute path of the guide inside a `.http-forge/` directory. */
export function getAgentsMdPath(forgeDir: string): string {
    return path.join(forgeDir, AGENTS_MD_FILENAME);
}

/**
 * Parse the version marker from guide content.
 * Missing or unparseable markers read as 0 (legacy guide — stale).
 */
export function readAgentsMdVersion(content: string): number {
    const match = VERSION_MARKER_RE.exec(content);
    if (!match) {
        return 0;
    }
    const parsed = Number.parseInt(match[1] ?? '', 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export interface AgentsMdStatus {
    exists: boolean;
    path: string;
    currentVersion: number;
    latestVersion: number;
    stale: boolean;
}

/** Report whether the guide exists and whether it predates the template. */
export function getAgentsMdStatus(forgeDir: string): AgentsMdStatus {
    const guidePath = getAgentsMdPath(forgeDir);
    if (!fs.existsSync(guidePath)) {
        return {
            exists: false,
            path: guidePath,
            currentVersion: 0,
            latestVersion: AGENTS_MD_VERSION,
            stale: false,
        };
    }
    let content = '';
    try {
        content = fs.readFileSync(guidePath, 'utf-8');
    } catch {
        return {
            exists: true,
            path: guidePath,
            currentVersion: 0,
            latestVersion: AGENTS_MD_VERSION,
            stale: true,
        };
    }
    const currentVersion = readAgentsMdVersion(content);
    return {
        exists: true,
        path: guidePath,
        currentVersion,
        latestVersion: AGENTS_MD_VERSION,
        stale: currentVersion < AGENTS_MD_VERSION,
    };
}

export interface AgentsMdRefreshResult {
    path: string;
    backupPath: string | null;
    previousVersion: number;
    version: number;
    /** True when no guide existed and one was created (no backup taken). */
    created: boolean;
}

/**
 * Replace the guide with the current template, backing up the previous file
 * to `AGENTS.md.bak` first. `backupPath` is null when nothing existed before.
 */
export function refreshAgentsMd(forgeDir: string): AgentsMdRefreshResult {
    const guidePath = getAgentsMdPath(forgeDir);
    const fresh = buildAgentsMdContent();
    if (!fs.existsSync(guidePath)) {
        fs.mkdirSync(forgeDir, { recursive: true });
        fs.writeFileSync(guidePath, fresh, 'utf-8');
        return {
            path: guidePath,
            backupPath: null,
            previousVersion: 0,
            version: AGENTS_MD_VERSION,
            created: true,
        };
    }
    let previous = '';
    try {
        previous = fs.readFileSync(guidePath, 'utf-8');
    } catch {
        previous = '';
    }
    const previousVersion = readAgentsMdVersion(previous);
    const backupPath = path.join(forgeDir, AGENTS_MD_BACKUP_FILENAME);
    fs.writeFileSync(backupPath, previous, 'utf-8');
    fs.writeFileSync(guidePath, fresh, 'utf-8');
    return {
        path: guidePath,
        backupPath,
        previousVersion,
        version: AGENTS_MD_VERSION,
        created: false,
    };
}

/**
 * Write-once creation used on workspace initialisation. Returns true when the
 * file was created, false when it already existed (never overwrites).
 */
export function ensureAgentsMdFile(forgeDir: string): boolean {
    const guidePath = getAgentsMdPath(forgeDir);
    if (fs.existsSync(guidePath)) {
        return false;
    }
    fs.mkdirSync(forgeDir, { recursive: true });
    fs.writeFileSync(guidePath, buildAgentsMdContent(), 'utf-8');
    return true;
}

/**
 * Build the current `.http-forge/AGENTS.md` template. The file teaches AI
 * assistants (GitHub Copilot, Claude, Cursor, …) the folder layout and schema
 * URLs so they can author collections by editing files directly — without
 * consuming MCP tool tokens.
 */
export function buildAgentsMdContent(): string {
    const schemaBase = 'https://raw.githubusercontent.com/hsl1230/http-forge/main/resources';
    return `<!-- http-forge-agents-md-version: ${AGENTS_MD_VERSION} -->
# HTTP Forge — AI Agent Guide

This folder is already the **HTTP Forge workspace root**. Do not create a second nested \`.http-forge/\` directory inside it.

> **GitHub Copilot tip:** To keep this guide in every Copilot conversation, add one line to
> \`.github/copilot-instructions.md\`: \`See .http-forge/AGENTS.md for the HTTP Forge AI guide.\`

> **Keep this guide fresh:** if it looks outdated, run the **HTTP Forge: Refresh AI Agent Guide** command (VS Code) or \`http-forge refresh-agents-md --apply\` (CLI). Your current file is backed up to \`AGENTS.md.bak\` before replacement. To make AI tools discover this guide, run \`http-forge generate-ai-config --tool all --apply\`.

---

## Decision Tree — What to Use and When

HTTP Forge gives AI agents three ways to interact with a workspace.
**Choose the lowest-cost option that can complete the task:**

\`\`\`
Task
 │
 ├─ Discover structure / read or edit collections, requests, environments, suites?
 │    └─ ✅ Read / write the JSON files directly  (zero token cost, always available)
 │
 ├─ Execute a request, collection, folder, or suite?
 │    ├─ Is @http-forge/cli installed?  (check: http-forge --version)
 │    │    ├─ YES → ✅ CLI  (lower token cost — no tool schema preloaded)
 │    │    │            http-forge run collection <name> --env <env> --json
 │    │    │            http-forge run suite <name> --json
 │    │    │            http-forge run request <name> --collection <ref> --json
 │    │    └─ NO  → ✅ MCP  run_collection / run_suite / run_request
 │    │
 │    └─ Need async execution or real-time polling?
 │         └─ ✅ MCP  run_collection --async, then get_run_status / get_run_summary
 │
 └─ Diagnose failures, suggest assertions, explain errors?
      └─ ✅ MCP  explain_failure / suggest_assertions / analyze-test-failure prompt

  └─ Design a NEW API from a plain-English intent (endpoints + DTOs + auth)?
       ├─ Is @http-forge/cli installed?  (check: http-forge --version)
       │    └─ YES → ✅ CLI  http-forge architect "I need a shopping cart"
       └─ NO  → ✅ MCP  design_api_from_intent  (then review; apply:true to approve)

  └─ Verify an EXISTING backend end-to-end (discover → generate → run → report)?
       ├─ Is @http-forge/cli installed?  (check: http-forge --version)
       │    └─ YES → ✅ CLI  http-forge qa --path <project> --collection <ref> --base-url <url> [--dry-run]
       └─ NO  → ✅ MCP  qa_api  (idempotent reruns; dryRun:true to preview)
 \`\`\`

---

## Why This Ordering?

| Method | Token cost | Always available | Can execute | Best for |
|--------|:----------:|:----------------:|:-----------:|---------|
| Direct file access | **Zero** | ✅ (if file system access) | ❌ | Discover, read, create, edit |
| CLI \`http-forge run\` | **Low** (no tool schema) | ❌ (must be installed + shell access) | ✅ | Execution when CLI is present |
| MCP tools | **Medium** (schemas preloaded) | ✅ (when extension runs) | ✅ | Execution fallback; AI analysis |

**Key rule:** Never use MCP or CLI to discover structure — just read the JSON files.
\`list_collections\`, \`list_requests\`, \`get_request\` are redundant when you have file access.

---

## The HTTP Forge Loop: Design (manual or from intent) or Discover (from source) -> Generate -> Edit -> Run -> Report -> Fix:

HTTP Forge's core workflow for AI agents is a seven-stage loop. Each stage
has a CLI command and an MCP tool; pick the lowest-cost option that works.

1. **Design (manual or from intent)** — create an API by hand (import OpenAPI,
   create requests) or let AI design one from a plain-English intent.
   - CLI: \`http-forge architect "I need a shopping cart" --apply\`
   - MCP: \`design_api_from_intent\`
   - Output: OpenAPI spec + collection + suite + flow + docs, tagged \`ai_generated: true\`.

2. **Discover** — scan a backend project's source code for endpoints.
   - CLI: \`http-forge discover --path <project> --output json\`
   - MCP: \`create_request_from_endpoint\`, \`generate_test_suite\`
   - Output: deterministic, provenance-tagged endpoint list (framework, file, line, confidence).

3. **Generate** — turn discovered endpoints into requests, suites, and flows.
   - CLI: \`http-forge generate-suite --path <project> --collection <ref> [--run]\`
   - CLI: \`http-forge generate-workflow --path <project> --collection <ref>\`
   - MCP: \`generate_test_suite\`, \`suggest_workflow\`, \`generate_workflow\`, \`check_drift\`, \`propose_update\`
   - Generated suites carry \`ai_generated: true\` and \`derived_from: [endpointId]\` for drift tracking.

4. **Edit** — refine requests, bodies, assertions, environments, and suites.
   - Direct file access (zero token cost): edit \`request.json\`, \`collection.json\`, \`*.suite.json\`, environments.
   - CLI: \`http-forge import\` (Postman/OpenAPI), \`http-forge suggest-env\`.
   - MCP: \`create_request\`, \`update_request\`, \`create_suite\`, \`add_suite_requests\`, etc.

5. **Run** — execute requests, collections, folders, or suites.
   - CLI: \`http-forge run collection <name> --env <env> --json\`
   - CLI: \`http-forge run suite <name> --json\`
   - MCP: \`run_collection\`, \`run_suite\`, \`run_request\`, \`run_folder\`
   - WebSocket/Socket.IO requests run headlessly with the same transcript and assertion pipeline.

6. **Report** — inspect results and diagnose failures.
   - CLI: add \`--include report\` for a self-contained HTML report; \`--reporter junit\` for CI.
   - MCP: \`get_run_summary\`, \`get_failed_requests\`, \`explain_failure\`, \`suggest_assertions\`
   - Drift: \`http-forge drift --path <project>\` or MCP \`check_drift\` / \`propose_update\` to keep suites in sync with source.

7. **Fix** — apply fixes and re-run until green.
   - Heal broken assertions: MCP \`heal_assertions\`.
   - Regenerate stale suites: MCP \`propose_update\` (with \`apply: true\` for non-conflicting merges).
   - Re-run and re-report until all tests pass.

**Key rule:** Never use MCP or CLI to discover structure when you have file
access — read the JSON files directly. Use MCP/CLI for execution and analysis.

---

## Folder Structure

> Important: this directory is the workspace root. Use the paths below as-is; do not create another nested \`.http-forge/\` directory.

\`\`\`
assets/
  collections/
    {collection-slug}/
      collection.json          ← collection metadata (id, name, variables, auth, order)
      scripts/
        pre-request.js         ← collection-level pre-request script
        post-response.js       ← collection-level post-response script
      {folder-slug}/
        folder.json            ← folder metadata
        scripts/
          pre-request.js       ← folder-level pre-request script
          post-response.js     ← folder-level post-response script
        {request-slug}/
          request.json         ← request (method, url, headers, auth, body, scripts…)
                               WebSocket/Socket.IO requests set requestType: "websocket"
                               and include a "websocket" config (protocol, messages, settings).
          body.json            ← JSON body (when bodyContentType is application/json)
          body.txt             ← raw text body
          body.graphql         ← GraphQL query
          doc.md               ← optional business docs for this request (fed to AI)
          scripts/
            pre-request.js     ← request-level pre-request script
            post-response.js   ← assertions live here (pm.test() calls)
  environments/
    _global.json               ← global variables + defaultHeaders (all envs)
    {env}.json                 ← per-environment variables
    {env}.local.json           ← local overrides — gitignored, never commit
  suites/
    {name}.suite.json          ← test suite with control-flow nodes
\`\`\`

---

## Business Knowledge (\`.http-forge/knowledge/\`)

HTTP Forge feeds business context into every AI feature (assertion suggestions,
failure diagnosis, request generation, scenario generation, env-var suggestions,
collection enhancement, and the \`analyze-test-failure\` / \`suggest-assertions\` /
\`review-collection\` prompts). The AI uses it to write realistic tests and
accurate diagnoses.

Drop markdown files into \`.http-forge/knowledge/\` (any depth):

\`\`\`
.http-forge/
  knowledge/
    api-overview.md          ← Confluence export: what the API does, auth model
    jira/API-123.md          ← Jira ticket summaries / ACs relevant to tests
    decisions/adr-007.md     ← Architecture decision records
    field-glossary.md        ← Meanings of domain fields the tests assert on
\`\`\`

Every \`*.md\` file under \`.http-forge/knowledge/\` is loaded and included in AI
prompts, along with the workspace \`README.md\` and \`AGENTS.md\`. Prefer short,
dense notes — the knowledge is bounded to keep token cost predictable. There is
no need to paste Confluence/Jira content into collection files themselves.

Per-request business docs can also live next to a request as \`doc.md\`
(alongside \`request.json\`) — HTTP Forge loads it and passes it to AI features
automatically.

---

## Same-Workspace Code and Docs — Read Before Generating

In most workspaces the HTTP Forge tests (requests, suites, environments) live
**in the same repo as the API code and product docs** — \`.http-forge/\` is just
one folder among them. Before generating or editing requests, suites,
environments, or assertions, look outside \`.http-forge/\` at the workspace
root so the tests reflect real requirements and cover edge cases:

1. **Find the sources** (cheapest first — stop when you have the requirement):
   - \`README.md\`, \`AGENTS.md\`, \`docs/**\`, \`openapi.*.{json,yaml,yml}\`,
     \`*.openapi.*\` — stated contracts and acceptance criteria (ACs).
   - \`.http-forge/knowledge/**/*.md\` + per-request \`doc.md\` — Confluence
     exports, Jira ticket summaries / ACs, ADRs, field glossaries.
   - API implementation next to the tests: route/controller/handler files
     (e.g. \`src/routes/**\`, \`src/controllers/**\`, \`apps/**/views.py\`,
     \`@RestController\` classes), DTO/schema validators, auth middleware —
     the ground truth for paths, methods, status codes, validation rules,
     and error shapes.
2. **Derive tests from what you read** — every documented AC and every
   validation branch / error path in the implementation deserves a request
   or assertion (happy path + 400/401/403/404/boundary cases). Name the
   source (file + ticket/AC id) in the request \`description\` or \`doc.md\`
   so reviewers can trace coverage.
3. **When code and docs disagree**, prefer the implementation for behavior,
   but flag the drift to the user instead of silently picking one.
4. **Do not paste large source files into tests** — reference paths and
   AC ids; keep request bodies/assertions minimal and deterministic.

---

## JSON Schemas

Every file contains a \`$schema\` field — your editor and AI can validate files automatically.

| File | Schema URL |
|------|-----------|
| \`collection.json\` | \`${schemaBase}/collection.schema.json\` |
| \`folder.json\`     | \`${schemaBase}/folder.schema.json\` |
| \`request.json\`    | \`${schemaBase}/request.schema.json\` |
| \`{env}.json\`      | \`${schemaBase}/environment.schema.json\` |
| \`_global.json\`    | \`${schemaBase}/global-environment.schema.json\` |
| \`*.suite.json\`    | \`${schemaBase}/suite.schema.json\` |

---

## Authoring by Direct File Editing

### Create a new request
1. Create directory: \`assets/collections/{collection-slug}/{optional-folder-slug}/{request-slug}/\`
2. Write \`request.json\` (use the schema above for all valid fields)
3. Add the slug to \`order\` in the parent \`collection.json\` or \`folder.json\`
4. Optionally add \`pre-request.js\` and/or \`post-response.js\` for scripts/assertions

### Edit a request
Read \`request.json\`, modify fields, write it back.
Variables: \`{{variableName}}\`. Filters: \`{{value | upper}}\`, \`{{date | date:'YYYY-MM-DD'}}\`.

### Bulk update (e.g. change baseUrl across all requests)
Find-and-replace across the \`assets/collections/\` tree — no MCP needed.

### Add / update environment variables
Edit \`assets/environments/{env}.json\` directly.

### Create or edit a test suite
Write or edit \`assets/suites/{name}.suite.json\`.
Supports: \`request\`, \`block\`, \`if/elseif/else\`, \`for\`, \`while\`, \`switch\`, \`script\` nodes.

---

## Test Generation Best Practices

HTTP Forge has two test layers. Use the right one for each goal.

### 1. Collection requests - smoke / happy path
- One request per endpoint.
- 1-2 pm.test() assertions: status code + basic schema shape.
- Keep bodies minimal and deterministic.
- These are the contract checks; they run in every collection run.

Snippet:
\`\`\`
pm.test('Status is 200', () => pm.response.to.have.status(200));
pm.test('Content-Type is JSON', () => pm.response.to.have.header('Content-Type', /application\\/json/));
pm.test('Has required fields', () => {
  const json = pm.response.json();
  pm.expect(json).to.have.property('id');
  pm.expect(json).to.have.property('name');
});
\`\`\`
Checklist:
- Always assert status code first.
- Assert Content-Type when the endpoint returns JSON.
- Assert at least one top-level field exists.
- Use pm.response.responseTime for latency SLA checks.
- Do not assert on volatile fields (timestamps, IDs) unless extracting them.

### 2. Test Suites - integration, E2E, acceptance, regression
Suites reference collection requests by collectionId + requestId (no duplication).
Use suite nodes for orchestration and scenario coverage.

| Goal | Suite pattern |
|---|---|
| Integration / E2E (CRUD) | request nodes in sequence (create -> read -> update -> delete), passing IDs via pm.variables / pm.environment. |
| Acceptance (AC verification) | One request node per acceptance criterion, with full pm.test() assertions on status, body fields, and error shapes. |
| Regression pack | block or if nodes gating requests by environment/feature flag; for/while for pagination. |
| Sanity / smoke | A small suite re-running the collection's happy paths. |
| Data-driven (many inputs) | Use iterations + a CSV/JSON data file; read inputs via pm.iterationData inside pre-request or assertions. |

#### Integration / E2E (CRUD workflow)
Pass IDs between steps and always clean up:
\`\`\`
// Step 1: Create
pm.test('Create returns 201', () => pm.response.to.have.status(201));
pm.variables.set('createdId', pm.response.json().id);

// Step 2: Read  -> GET /users/{{createdId}}
// Step 3: Update -> PUT /users/{{createdId}}
// Step 4: Delete -> DELETE /users/{{createdId}}
// Step 5: Verify deleted -> GET /users/{{createdId}} expects 404
\`\`\`
Rules:
- Pass IDs via pm.variables.set() (request scope) or pm.environment.set() (cross-request).
- Always include a cleanup/delete step verifying 404.
- Assert intermediate states (re-GET after update to confirm).
- Name nodes with step numbers: 1. Create user, 2. Get user, 3. Update user, 4. Delete user, 5. Verify deleted.
- If a step fails, subsequent steps should be skipped via if conditions or stopOnError.

#### Acceptance (AC verification)
Map each acceptance criterion to one pm.test() with the AC ID in the name:
\`\`\`
pm.test('AC-1: valid user created', () => {
  pm.response.to.have.status(201);
  const json = pm.response.json();
  pm.expect(json.email).to.equal(pm.variables.get('testEmail'));
  pm.expect(json.role).to.equal('user');
});

pm.test('AC-2: missing email returns 400', () => {
  pm.response.to.have.status(400);
  pm.expect(pm.response.json().error).to.include('email');
});
\`\`\`
Checklist:
- One pm.test() per acceptance criterion, with AC ID in the name.
- Include at least one negative case per required field (missing, empty, wrong type).
- Test boundary values: min/max length, zero, negative, null.
- Assert error response shape (status + error message field), not just status.
- Test auth boundaries: no token -> 401, wrong role -> 403.

#### Regression pack
- Store expected response snippets in doc.md or suite scripts library.
- Use pm.expect(actual).to.deep.equal(expected) for stable fields.
- Exclude volatile fields (timestamps, IDs) from deep equality.
- Use pm.response.to.have.jsonSchema(...) for contract regression.

#### Sanity / smoke
- Minimal assertions: status code + Content-Type.
- Target health-check or root endpoints.
- Keep under 1 second total; skip heavy bodies.

### 3. Data-driven testing with iterations
- Suite config.iterations runs the whole node sequence N times.
- Provide a data file (--data file.csv) or variables per iteration.
- In scripts: const row = pm.iterationData.toObject(); then use row.input, row.expected.
- Each iteration is independent; variables set in one iteration do not leak.

CSV format spec:
\`\`\`
input,expectedStatus,expectedName
valid-user,201,Alice
missing-email,400,
empty-name,400,
\`\`\`
Reading pattern:
\`\`\`
const row = pm.iterationData.toObject();
pm.variables.set('input', row.input);
pm.variables.set('expectedStatus', row.expectedStatus);

pm.test('status is ' + pm.variables.get('expectedStatus'), () => {
  pm.response.to.have.status(parseInt(pm.variables.get('expectedStatus')));
});
if (pm.variables.get('expectedName')) {
  pm.test('name matches', () => {
    pm.expect(pm.response.json().name).to.equal(pm.variables.get('expectedName'));
  });
}
\`\`\`
Rules:
- Column names must be valid identifiers (no spaces, no special chars).
- First row is header; each subsequent row is one iteration.
- Empty cells -> undefined; handle with if (row.field) guards.
- Include edge rows: empty string, null, max length, Unicode, SQL injection attempts.

### 4. Assertion depth guidelines
- Collection request: status code + top-level schema.
- Suite node: full AC verification (field values, error messages, headers).
- Use pm.test(name, async () => {...}) for async checks.
- Use pm.response.to.have.jsonSchema(...) for contract checks.

### 5. Naming and traceability
- Name requests after the endpoint: GET /users/:id.
- Name suite nodes after the scenario: Create user - valid, Create user - missing email.
- Store acceptance-criteria IDs in description or doc.md next to the request.
- Mark generated suites with ai_generated: true and derived_from: [endpointId].

### 6. Flow control
- Use if/switch to skip requests based on prior results.
- Use for/while for pagination or retry loops.
- Use pm.setNextRequest(name) / pm.execution.skipRequest() for dynamic flow.
- Use script nodes for setup/teardown without an HTTP call.

Condition syntax examples:
\`\`\`
// if node condition
"{{response.status}} === 200"

// for loop (10 iterations)
"for (let __i = 0; __i < 10; __i++)"

// skip request
pm.execution.skipRequest();

// dynamic next request
pm.setNextRequest('Step 3: Update user');
\`\`\`
Rules:
- for/while conditions use __i (not i) for the loop variable.
- if conditions use pm.* aliases (pm, ctx, hf).
- script nodes run without an HTTP call - use for setup/teardown.

---

## AI Test Generation: What to ask vs. infer

### Auto-inferable from code/docs (do not ask)
- Endpoint list: ApiDiscoveryService (Express/Nest/Fastify/Lambda/Spring/FastAPI) or OpenAPI spec.
- Expected status codes: source annotations (@ResponseStatus, res.status()), OpenAPI responses.
- Auth mode: auth middleware, OpenAPI securitySchemes, existing collection auth block.
- Request/response schema: OpenAPI, Pydantic models, DTOs, TypeScript interfaces.
- Path/query params: route patterns (:id, {id}), OpenAPI parameters.
- Environment variables: .http-forge/environments/*.json, {{variable}} references.
- Base URL: environment config, OpenAPI servers, http-forge.config.json.
- Business rules / ACs: .http-forge/knowledge/**/*.md, per-request doc.md, README, OpenAPI description.
- Test data: existing fixtures or generate from schema.

### Must ask the user (cannot be inferred)
- Which test types to generate (smoke / acceptance / integration / regression / data-driven).
- Acceptance criteria (ACs) if not in code/docs.
- Edge-case scope (none / standard / aggressive).
- Target environment (dev / staging / prod).
- Auth credentials (tokens/keys are secrets).
- CI/CD context (reporters, exit codes).
- Iteration data file (provide CSV or approve AI-generated rows).
- Scope of generation (all endpoints or a subset).

### Prompt template for AI test generation

Generate tests for [endpoint or "all discovered endpoints"].

Infer from code/docs:
- Endpoints, schemas, auth, and business context from source code, OpenAPI spec,
  .http-forge/knowledge/**/*.md, and per-request doc.md files.

Confirm or override:
1. Test types: [smoke / acceptance / integration / regression / data-driven]
2. Environment: [dev / staging / prod]
3. Auth: [inherit from collection / provide token]
4. Edge cases: [none / standard (null, empty, boundary) / aggressive (injection, fuzzing)]
5. Acceptance criteria (if not in code/docs): [paste ACs or Jira IDs]
6. Data file for data-driven tests: [provide CSV or "generate from schema"]

Constraints:
- Collection requests: smoke only (status + schema)
- Suites: full AC verification
- Mark generated suites with ai_generated: true
- Use pm.* API only

---

## How AI Should Run Tests

### Decision: CLI vs MCP

| Situation | Use | Why |
|---|---|---|
| CLI installed and shell access available | CLI (lower token cost, no schema preload) | \`http-forge run ...\` |
| No CLI or no shell access | MCP tools | Always available when extension runs |
| Async / long-running / real-time polling | MCP with \`async: true\` | Poll with \`get_run_status\` |
| Failure diagnosis / assertion suggestions | MCP \`explain_failure\`, \`suggest_assertions\` | AI analysis tools |

**Key rule:** Never use MCP or CLI to discover structure - just read the JSON files.
\`list_collections\`, \`list_requests\`, \`get_request\` are redundant when you have file access.

### CLI commands (when installed)

\`\`\`bash
http-forge --version
http-forge run collection <name> --env <env> --json
http-forge run suite <name> --json
http-forge run request <name> --collection <ref> --json
http-forge run folder <path> --collection <ref> --json
http-forge mcp start --port 3000
http-forge mcp stop
http-forge mcp status
http-forge architect "I need a shopping cart" --apply
http-forge qa --path ./backend --collection "My API" --base-url http://localhost:3000
http-forge refresh-agents-md --apply
http-forge generate-ai-agent --apply
http-forge generate-ai-config --tool all --apply
\`\`\`

Add \`--include report\` to generate an HTML report (\`report.uri\`). Add \`--exit-code\` for CI (non-zero on failure).

### MCP tools (execution and analysis)

Execution: \`run_request\`, \`run_folder\`, \`run_collection\`, \`run_suite\` (add \`async: true\` for background).
Polling: \`get_run_status\`, \`get_run_summary\`, \`get_failed_requests\`, \`get_request_result\`, \`cancel_run\`.
Analysis: \`explain_failure\`, \`suggest_assertions\`, \`analyze_coverage\`, \`ai_analyze_coverage\`.
Discovery: \`create_request_from_endpoint\`, \`generate_test_suite\`, \`suggest_workflow\`, \`generate_workflow\`, \`check_drift\`, \`propose_update\`.
QA: \`qa_api\` (discover to generate to run to report).
Design: \`design_api_from_intent\`.
Management: \`list_collections\`, \`list_requests\`, \`get_request\`, \`create_request\`, \`update_request\`, \`create_suite\`, \`add_suite_requests\`, etc.

Full tool list and schemas: see the extension's MCP server docs.

### Generating reports

- CLI: \`--include report\` (HTML) or \`--reporter junit\` (JUnit XML).
- MCP: pass \`include: ["report"]\` in run options; open \`report.uri\`.
- Reports are self-contained HTML with full response details.

---

## Execution: CLI Commands (when installed)

\`\`\`bash
# Check if CLI is available
http-forge --version

# Run a collection (outputs JSON to stdout)
http-forge run collection <name> --env <env> --json

# Run a specific folder within a collection
http-forge run folder <folder-path> --collection <name> --json

# Run a single request
http-forge run request <request-name> --collection <name> --json

# Run a test suite
http-forge run suite <name> --json

# Design a new API from an intent (persists a collection; add --apply to
# persist the suite + write flow/docs/OpenAPI byproducts)
http-forge architect "I need a shopping cart"
http-forge architect "a todo list" --apply --flow-out ./todo.flow.js --docs-out ./todo.md

# One-shot QA gate (discover → generate → run → report; add --dry-run to preview)
http-forge qa --path ./backend --collection "My API" --base-url http://localhost:3000

# Pipe output to filter results (saves tokens — AI only sees what it needs)
http-forge run collection auth --json | jq '.failedRequests'
http-forge run suite checkout --json | jq '.summary'
\`\`\`

Output always contains: \`summary\` (total/passed/failed) and \`failedRequests\` (when failures exist).
For collection/suite/folder runs, add \`--include report\` to generate an HTML report (\`report.uri\`) with full response details — useful for inspecting large response bodies without consuming extra tokens.

---

## Execution: MCP Tools (always available when extension runs)

Use MCP when:
- CLI is not installed or no shell access is available
- Async / long-running execution with real-time polling is needed
- AI analysis tools are needed (failure diagnosis, assertion suggestions)

\`\`\`
run_request      → execute one request
run_folder       → execute a folder within a collection
run_collection   → execute an entire collection
run_suite        → execute a test suite
  └─ add async:true for background execution, then poll with get_run_status

get_run_summary  → summary + failed requests after a run completes
get_failed_requests → paginated failed request details
explain_failure  → AI-powered root cause analysis
suggest_assertions → generate pm.test() assertions for a request
\`\`\`

> **Token tip:** Response bodies are truncated at 4 KB by default.
> Pass \`include: ["fullBody"]\` to get the complete body.
> For collection / suite / folder runs, pass \`include: ["report"]\` to generate an HTML report
> (\`report.uri\`) — open it in a browser to inspect full response details without consuming tokens.
> Single \`run_request\` calls do not generate a report unless \`include: ["report"]\` is also passed.
`;
}
