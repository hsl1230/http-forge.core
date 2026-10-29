# MCP Management Tools — Solution Design

## Overview

This document specifies the **management tool layer** for the HTTP Forge MCP server.  
The existing MCP tools cover *running* collections, folders, requests, and suites.  
These new tools cover *authoring and organizing* that content so that AI agents can:

- **Help QA** build, compose, and maintain test suites from scratch or from
  developer-provided collections — with zero manual file editing.
- **Help Developers** create and maintain collections (requests, folders, scripts,
  ordering) and environments directly through chat, so the project stays in sync.

Both audiences work through Copilot Chat (or any MCP-compatible client) and never
need to touch JSON files on disk.

---

## Audience & Workflow

### QA Engineer (test suite author)

Typical session:

```
1. list_collections                 → see what the dev team has published
2. list_requests(collection)        → browse available endpoints
3. create_suite("Checkout Regression")
4. add_suite_requests(suiteId, [...requestIds], insertAt=0)
5. select_environment("SIT")
6. set_environment_variable("auth_token", "eyJ...")
7. run_suite(suiteId, env="SIT")
8. get_run_summary(runId)           → failedRequests + _nextStep auto-trigger AI diagnosis
```

QA never needs to know the collection disk format.  
They only need to know *which requests exist* and *what environment variables they expect*.

### Developer (collection author)

Typical session:

```
1. create_collection("Payments API v3")
2. create_folder(collectionId, "Checkout")
3. create_request(collectionId, folderId, { method:"POST", url:"{{base_url}}/orders", ...})
4. set_request_script(collectionId, requestId, "pre-request", "pm.environment.set('orderId', ...)")
5. reorder_collection_items(collectionId, folderId, ["req-a","req-b","req-c"])
6. run_collection(collectionId, env="dev")  ← existing tool, unchanged
```

Developers never need to edit `collection.json`, `request.json`, or `pre-request.js` by hand.

---

## Disk Format Reference

### Collections

```
collections/
  <collection-slug>/
    collection.json          { id, name, order?: string[] }
    <folder-slug>/
      folder.json            { id, name, order?: string[] }
      <request-slug>/
        request.json         { id, name, method, url, headers, body, auth, settings, ... }
        scripts/
          pre-request.js
          post-response.js
    <request-slug>/
      request.json
      scripts/
        pre-request.js
        post-response.js
```

`order` in `collection.json` / `folder.json` is an array of child slugs controlling
display and execution order.  Items not listed in `order` are appended at the end.

### Suites

```
suites/
  <id>.suite.json     { id, name, description, requests: SuiteRequest[], config, createdAt, updatedAt }
```

`requests` array order = execution order.

### Environments

```
environments/
  <name>.json          { name, description, variables: Record<string,string> }
  <name>.local.json    { variables: ... }   ← gitignored local overrides
  _global.json         { variables: ..., defaultHeaders: ... }
  _global.local.json   { variables: ... }
```

---

## Tool Groups

### Group 1 — Collection Inspection (read, already exists, documented for completeness)

| Tool | Purpose |
|------|---------|
| `list_collections` | List collections with name, id, request count |
| `list_folders` | List folders in a collection with path and request count |
| `list_requests` | Paginated request list within a collection / folder |
| `search_requests` | Search by name / URL / method / description |

These are existing generic tools.  No changes required.

---

### Group 2 — Collection Structure Management (new)

#### `create_collection`

Create a new empty collection on disk.

**Input**
```json
{ "name": "string (required)" }
```

**Output**
```json
{ "id": "payments-api-v3", "name": "Payments API v3", "created": true }
```

**Service call**: `CollectionService.createCollection(name)` — already exists.

---

#### `rename_collection`

Rename an existing collection.

**Input**
```json
{ "collection": "string — name or id (required)", "newName": "string (required)" }
```

**Output**
```json
{ "id": "...", "oldName": "...", "newName": "...", "renamed": true }
```

**Service call**: `CollectionService.renameCollection(id, newName)` — already exists.

---

#### `delete_collection`

Delete a collection and all its files.  Requires `confirm: true` to prevent accidents.

**Input**
```json
{ "collection": "string (required)", "confirm": true }
```

**Output**
```json
{ "deleted": true, "collection": "..." }
```

**Service call**: `CollectionService.deleteCollection(id)` — already exists.

---

#### `duplicate_collection`

Clone a collection under a new name (all folders, requests, and scripts are copied).

**Input**
```json
{ "collection": "string (required)", "newName": "string (required)" }
```

**Output**
```json
{ "id": "...", "name": "...", "duplicatedFrom": "..." }
```

**Service call**: `CollectionService.duplicateCollection(sourceId, newName)` — already exists.

---

#### `create_folder`

Create a folder (optionally nested) inside a collection.

**Input**
```json
{
  "collection": "string (required)",
  "name": "string (required)",
  "parentFolder": "string — slash-separated path or folder id (optional)"
}
```

**Output**
```json
{ "id": "checkout", "name": "Checkout", "path": "Checkout", "created": true }
```

**Service call**: New method `CollectionService.createFolder(collectionId, name, parentFolderId?)`.
Writes `folder.json` via `FolderCollectionStore`, updates parent `order` array.

---

#### `delete_folder`

Delete a folder and all its contents (requests, sub-folders, scripts).

**Input**
```json
{ "collection": "string (required)", "folder": "string — path or id (required)", "confirm": true }
```

**Output**
```json
{ "deleted": true, "folder": "...", "requestsRemoved": 4 }
```

**Service call**: New method `CollectionService.deleteFolder(collectionId, folderId)`.

---

### Group 3 — Request Management (new)

#### `create_request`

Create a new request inside a collection (optionally inside a folder).

**Input**
```json
{
  "collection": "string (required)",
  "folder": "string — folder path or id (optional, adds to collection root if omitted)",
  "name": "string (required)",
  "method": "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS (required)",
  "url": "string (required) — may use {{variables}}",
  "headers": { "key": "value" },
  "body": "string — raw JSON / text / form body",
  "description": "string"
}
```

**Output**
```json
{ "id": "get-user-profile", "name": "Get User Profile", "created": true, "collection": "...", "folder": "..." }
```

**Service call**: `CollectionService.addRequest(collectionId, request, parentFolderId?)` — already exists.

---

#### `update_request`

Update fields on an existing request (partial update, omit fields to keep current values).

**Input**
```json
{
  "collection": "string (required)",
  "request": "string — request name or id (required)",
  "name": "string",
  "method": "string",
  "url": "string",
  "headers": { "key": "value" },
  "body": "string",
  "description": "string"
}
```

**Output**
```json
{ "updated": true, "request": "..." }
```

**Service call**: `CollectionService.updateRequest(collectionId, requestId, updates)` — already exists.

---

#### `delete_request`

Remove a request from a collection.

**Input**
```json
{ "collection": "string (required)", "request": "string — name or id (required)", "confirm": true }
```

**Output**
```json
{ "deleted": true, "request": "..." }
```

**Service call**: `CollectionService.deleteRequest(collectionId, requestId)` — already exists.

---

### Group 4 — Script Management (new)

#### `get_request_script`

Read the pre-request or post-response script of a request.

**Input**
```json
{
  "collection": "string (required)",
  "request": "string — name or id (required)",
  "phase": "pre-request | post-response (required)"
}
```

**Output**
```json
{
  "collection": "...",
  "request": "...",
  "phase": "pre-request",
  "script": "pm.environment.set('token', pm.response.json().token);"
}
```

**Service call**: `CollectionService.getRequestScript(collectionId, requestId, phase)` — new method.
Reads `request.json`.scripts or the standalone script file.

---

#### `set_request_script`

Write or replace the pre-request or post-response script of a request.

**Input**
```json
{
  "collection": "string (required)",
  "request": "string — name or id (required)",
  "phase": "pre-request | post-response (required)",
  "script": "string — full JavaScript source to write"
}
```

**Output**
```json
{ "updated": true, "collection": "...", "request": "...", "phase": "pre-request" }
```

**Service call**: New method `CollectionService.setRequestScript(collectionId, requestId, phase, source)`.
For folder-based collections writes the `.js` file directly; updates `request.json` for JSON collections.

---

### Group 5 — Ordering (new)

#### `reorder_collection_items`

Set the execution / display order of direct children of a collection root or folder.
Children not listed are appended after the explicitly ordered ones.

**Input**
```json
{
  "collection": "string (required)",
  "folder": "string — folder path or id (optional, defaults to collection root)",
  "order": ["item-name-or-id", "item-name-or-id", ...]
}
```

**Output**
```json
{ "reordered": true, "order": ["checkout", "auth", "products"] }
```

**Service call**: New method `CollectionService.reorderItems(collectionId, folderId | null, order)`.
Writes the `order` array to `collection.json` or the target `folder.json`.

---

### Group 6 — Suite Management (new)

#### `list_suites`

List all test suites with name, id, request count, and configuration summary.

**Input** *(none required)*
```json
{}
```

**Output**
```json
{
  "suites": [
    { "id": "checkout-regression", "name": "Checkout Regression", "requestCount": 12, "iterations": 1, "description": "..." }
  ]
}
```

**Service call**: `TestSuiteService.getAllSuites()` — already exists.

---

#### `get_suite`

Get the full detail of a suite including its request list.

**Input**
```json
{ "suite": "string — name or id (required)" }
```

**Output**
```json
{
  "id": "...", "name": "...", "description": "...",
  "config": { "iterations": 1, "delayBetweenRequests": 0, "stopOnError": false },
  "requests": [
    { "slug": "...", "collectionId": "...", "collectionName": "...", "requestId": "...", "name": "...", "method": "GET", "folderPath": "...", "enabled": true }
  ]
}
```

**Service call**: `TestSuiteService.getSuite(id)` — already exists.

---

#### `create_suite`

Create a new empty test suite (or pre-populated from a collection / folder).

**Input**
```json
{
  "name": "string (required)",
  "description": "string",
  "fromCollection": "string — collection name or id; seeds suite with all requests in execution order",
  "fromFolder": "string — folder path; used together with fromCollection to seed from one folder",
  "iterations": 1,
  "stopOnError": false,
  "delayBetweenRequests": 0
}
```

**Output**
```json
{ "id": "checkout-regression", "name": "...", "requestCount": 0, "created": true }
```

**Service call**:
- Empty: `TestSuiteService.createSuite(name)` — already exists.
- From collection: `TestSuiteService.createTempSuiteFromCollection(collectionId)` → `saveTempSuite(...)` — already exists.
- From folder: `TestSuiteService.createTempSuiteFromFolder(collectionId, folderPath)` → `saveTempSuite(...)` — already exists.

`folderPath` follows HTTP Forge's display/input convention: use ` / ` between folder levels when a folder name itself contains `/` (for example `agl-page-composition / TRAY/EPG / AVS5-5304 - TRAY/EPG`). Internally the runtime stores the same path as `agl-page-composition/TRAY%2FEPG/AVS5-5304 - TRAY%2FEPG`.

---

#### `update_suite_config`

Change a suite's name, description, or run configuration.

**Input**
```json
{
  "suite": "string (required)",
  "name": "string",
  "description": "string",
  "iterations": 3,
  "stopOnError": true,
  "delayBetweenRequests": 500
}
```

**Output**
```json
{ "updated": true, "suite": "..." }
```

**Service call**: `TestSuiteService.updateSuite(suite)` after patching fields — already exists.

---

#### `add_suite_requests`

Append or insert one or more requests into a suite.  Requests are identified by
collection + request name (or id).

**Input**
```json
{
  "suite": "string (required)",
  "requests": [
    { "collection": "Payments API", "request": "POST Create Order" },
    { "collection": "Payments API", "request": "GET Order Status" }
  ],
  "insertAt": 0
}
```

`insertAt` is 0-based.  Omit to append at the end.

**Output**
```json
{ "added": 2, "suite": "...", "newRequestCount": 14 }
```

**Service call**: New helper that resolves each entry to a `SuiteRequest` object then
calls `TestSuiteService.updateSuite(suite)` with the patched `requests` array.

---

#### `remove_suite_request`

Remove a request from a suite by position (0-based index) or by name.

**Input**
```json
{
  "suite": "string (required)",
  "index": 3
}
```
OR
```json
{
  "suite": "string (required)",
  "request": "POST Create Order"
}
```

**Output**
```json
{ "removed": true, "request": "...", "newRequestCount": 13 }
```

**Service call**: `TestSuiteService.updateSuite(suite)` after splicing the `requests` array.

---

#### `reorder_suite_requests`

Reorder requests in a suite by providing the new ordered list of request names.
Names not included are moved to the end.

**Input**
```json
{
  "suite": "string (required)",
  "order": ["Login", "GET Products", "POST Create Order", "GET Order Status", "DELETE Order"]
}
```

**Output**
```json
{ "reordered": true, "suite": "...", "newOrder": ["Login", "GET Products", ...] }
```

**Service call**: `TestSuiteService.updateSuite(suite)` with `requests` sorted by `order` array.

---

#### `duplicate_suite`

Clone an existing suite under a new name.

**Input**
```json
{ "suite": "string (required)", "newName": "string (required)" }
```

**Output**
```json
{ "id": "...", "name": "...", "duplicatedFrom": "...", "requestCount": 12 }
```

**Service call**: `TestSuiteService.duplicateSuite(sourceId, newName)` — already exists.

---

#### `delete_suite`

Delete a suite permanently.

**Input**
```json
{ "suite": "string (required)", "confirm": true }
```

**Output**
```json
{ "deleted": true, "suite": "..." }
```

**Service call**: `TestSuiteService.deleteSuite(id)` — already exists.

---

### Group 7 — Environment Management (new)

#### `list_environments`

List all environments with name, whether active, and the variable key list (no values —
keys are enough to know what variables exist without leaking credentials).

**Input** *(none)*

**Output**
```json
{
  "environments": [
    { "name": "dev", "active": false, "variableKeys": ["base_url", "auth_token"] },
    { "name": "SIT", "active": true, "variableKeys": ["base_url", "auth_token", "client_id"] }
  ],
  "active": "SIT"
}
```

**Service call**: `EnvironmentConfigService.getAllEnvironments()`.

---

#### `get_environment_variables`

Get the resolved (merged) variables for an environment so the AI can see what
`{{variable}}` expressions actually resolve to.  Surfaces the variable tier so
the AI knows what to change.

**Input**
```json
{ "environment": "string — defaults to active env" }
```

**Output**
```json
{
  "environment": "SIT",
  "active": true,
  "fileVariables":     { "base_url": "https://sit.api.com", "auth_token": "" },
  "sessionOverrides":  { "auth_token": "eyJ..." },
  "resolved":          { "base_url": "https://sit.api.com", "auth_token": "eyJ..." }
}
```

**Service call**:
- `EnvironmentConfigService.getResolvedEnvironment(name)` for `resolved`
- `sharedConfig.environments[name].variables` for `fileVariables`
- `localEnvironmentValues.get(name)` (via `getEnvironmentVariableLocals()`) for `sessionOverrides`

---

#### `select_environment`

Set the active environment for all subsequent run_* calls in this session.

**Input**
```json
{ "environment": "string (required)" }
```

**Output**
```json
{ "selected": true, "environment": "SIT" }
```

**Service call**: `EnvironmentConfigService.setActiveEnvironment(name)`.

---

#### `create_environment`

Create a new environment file, optionally pre-populated with variables.

**Input**
```json
{
  "name": "string (required)",
  "variables": { "base_url": "https://uat.api.com", "client_id": "" }
}
```

**Output**
```json
{ "created": true, "environment": "UAT" }
```

**Service call**: `EnvironmentConfigService.createEnvironment(name)` then for each
variable: update `sharedConfig.environments[name].variables` and `saveSharedConfig`.

---

#### `delete_environment`

Delete an environment file permanently.

**Input**
```json
{ "environment": "string (required)", "confirm": true }
```

**Output**
```json
{ "deleted": true, "environment": "UAT", "newActive": "SIT" }
```

**Service call**: `EnvironmentConfigService.deleteEnvironment(name)`.

---

#### `set_environment_variable`

Set a variable in an environment.  Two scopes:

- `session` (default): stored in workspace state — survives VS Code restart,
  equivalent to Postman "Current Value".  Use for tokens, dynamic values.
- `permanent`: written to the env `.json` file — part of source control.
  Use for stable config like `base_url`.

**Input**
```json
{
  "environment": "string — defaults to active env",
  "key": "string (required)",
  "value": "string (required)",
  "scope": "session | permanent"
}
```

**Output**
```json
{ "set": true, "key": "auth_token", "environment": "SIT", "scope": "session" }
```

**Service call**:
- `session`: `EnvironmentConfigService.setEnvironmentVariable(key, value, envName)`
- `permanent`: load `sharedConfig`, patch `environments[envName].variables[key]`, call `saveSharedConfig`

---

#### `unset_environment_variable`

Remove a session-scoped variable override (restores the file value).

**Input**
```json
{
  "environment": "string — defaults to active env",
  "key": "string (required)"
}
```

**Output**
```json
{ "unset": true, "key": "auth_token", "environment": "SIT" }
```

**Service call**: `EnvironmentConfigService.deleteEnvironmentVariable(key, envName)`.

---

#### `set_global_variable`

Set a global variable visible across all environments (memory-only, not persisted).

**Input**
```json
{ "key": "string (required)", "value": "string (required)" }
```

**Output**
```json
{ "set": true, "key": "...", "scope": "global" }
```

**Service call**: `EnvironmentConfigService.setGlobalVariable(key, value)`.

---

#### `get_globals`

Return all global variables (merged `_global.json` + runtime `pm.globals.set()` values).

**Input** *(none)*

**Output**
```json
{ "globals": { "client_id": "abc", "debug": "true" } }
```

**Service call**: `EnvironmentConfigService.getGlobalVariables()`.

---

### Group 8 — API Discovery, Drift, QA & Architect (added v0.6)

These tools scan a backend project's **source code** (no OpenAPI spec required) and drive the
Phase 1 / Phase 2a / Phase 2b / Phase 4 pipeline. Handlers live in
`src/runtime/mcp-handlers/discovery.ts` (`qa.ts` for `qa_api`, `ai.ts` for
`design_api_from_intent`). They are
exposed in `drilldown`/`auto` mode and **excluded from `execution-only` mode** (they are workspace
management, not execution).

#### `create_request_from_endpoint`

Scan a project and create a working HTTP Forge request from one discovered endpoint.

**Input**
```json
{
  "projectPath": "/repo/my-api",
  "method": "POST",
  "path": "/api/users/{id}",
  "endpointId": "ep_abc123",
  "collection": "My API",
  "name": "Update User",
  "baseUrl": "https://api.example.com",
  "sampleData": true
}
```

**Output**
```json
{
  "requestId": "update-user_x1y2z3",
  "provenance": { "framework": "Express", "source": "src/routes/users.ts:42", "confidence": "high" }
}
```

**Notes**: `schemaToExample` derives sample JSON bodies from discovered schemas when `sampleData:true`.

---

#### `generate_test_suite`

Scan a project, create requests in the target collection, and emit a runnable `.suite.json`
(one request node per endpoint, each asserting the discovered status code).

**Input**
```json
{
  "projectPath": "/repo/my-api",
  "collection": "My API",
  "name": "Generated from discovery",
  "baseUrl": "https://api.example.com",
  "dryRun": false
}
```

**Output**
```json
{ "suiteId": "gen-suite_abc", "requestCount": 12, "ai_generated": true, "derived_from": ["ep_abc123", "..."] }
```

**Notes**: generated suites carry `ai_generated:true` + `derived_from:<endpointId>` — the drift
hook for Phase 2b.

---

#### `suggest_workflow`

Analyze discovered endpoints and suggest cross-request workflow chains (AUTH: token-producer →
protected endpoints; CRUD: create → id-scoped operations). Returns chains without persisting
anything — call `generate_workflow` to persist them as a suite.

**Input**
```json
{ "projectPath": "/repo/my-api" }
```

**Output**
```json
{ "chains": [ { "type": "auth", "producer": "ep_login", "dependents": ["ep_me", "ep_orders"] } ] }
```

---

#### `generate_workflow`

Create requests for every endpoint of a project, then generate a suite whose flow graph
(`suite.nodes`) encodes the discovered workflow chains using request/if/script nodes.

**Input**
```json
{
  "projectPath": "/repo/my-api",
  "collection": "My API",
  "name": "Generated workflow suite",
  "baseUrl": "https://api.example.com",
  "dryRun": false
}
```

**Output**
```json
{ "suiteId": "wf-suite_xyz", "nodes": 18, "ai_generated": true, "derived_from": ["..."] }
```

---

#### `check_drift`

Check whether a backend project has drifted since its discovery index was built. In git work
trees compares the git HEAD hash; otherwise degrades to source-file mtime vs `scannedAt`.

**Input**
```json
{ "projectPath": "/repo/my-api" }
```

**Output**
```json
{ "status": "stale", "lastScannedAt": 1722..., "driftedFiles": ["src/users.ts", "src/orders.ts"] }
```

**Service call**: `computeProjectFreshness` / `detectProjectDrift` (drift-engine.ts).

---

#### `propose_update`

Phase 2b loop: given stale endpoint ids (from `check_drift`) and the suites that reference them
via `derived_from`, propose a regeneration per affected suite. Returns a 3-way diff
(base vs current vs regenerated) and flags conflicts when user edits overlap regeneration
(those require developer approval — never auto-resolved). `apply:true` computes the merged
content for non-conflicting proposals.

**Input**
```json
{
  "staleEndpointIds": ["ep_abc123"],
  "suites": [{ "id": "s1", "currentContent": "{...}", "derivedFrom": ["ep_abc123"] }],
  "baseContent": { "s1": "{...last generated...}" },
  "regeneratedContent": { "s1": "{...freshly regenerated...}" },
  "apply": true
}
```

**Output**
```json
{ "proposals": [ { "suiteId": "s1", "conflicts": [], "mergedContent": "{...}" } ] }
```

**Service call**: `proposeSuiteUpdates` / `applyRegenerated` / `threeWayDiff` (drift-engine.ts).

---

#### `qa_api`

One-shot API quality gate: discover endpoints from backend source, generate (or reuse)
requests in the target collection, run the deterministic QA suite against a live server,
and report per-endpoint results. Requests are matched by method + path and reused across
runs — reruns create nothing new unless the source changed.

**Input**
```json
{
  "projectPath": "/repo/my-api",
  "collection": "My API",
  "baseUrl": "https://api.example.com",
  "environment": "staging",
  "variables": { "TOKEN": "abc" },
  "framework": "express",
  "dryRun": false,
  "aiAssertions": false,
  "failOnDrift": false
}
```

**Output**
```json
{
  "status": "pass",
  "discovered": 14,
  "reused": 11,
  "created": 3,
  "results": { "passed": 14, "failed": 0, "skipped": 0 },
  "endpoints": [{ "endpointKey": "POST /orders", "statusExpected": 201, "statusGot": 201, "passed": true }],
  "drift": { "status": "current" },
  "lowConfidence": [],
  "hint": "…"
}
```

**Notes**: `status` is `pass` / `fail` / `drift` / `dry-run`. `dryRun:true` previews the plan
without writing or running. `aiAssertions:true` uses the injected `aiProvider` for a
second, advisory-only suggestion pass (failures first, capped at 10 endpoints). Excluded
from `execution-only` mode like the other discovery tools.

**Service call**: `runQaCheck` (`infrastructure/qa/qa-service.ts`); handler in
`src/runtime/mcp-handlers/qa.ts`.

---

#### `design_api_from_intent` (architect)

Architect a whole REST API from a plain-English intent (Phase 4 / Layer 8). The AI designs an
OpenAPI 3.0 spec, it is imported as a new collection, and the package is generated — test suite,
runnable `.flow.js`, discovered workflow chains, markdown docs, and a round-trip OpenAPI export,
all tagged `ai_generated:true`. By default only the collection is persisted; `apply:true` persists
the suite and writes byproducts.

**Input**
```json
{
  "intent": "I need a shopping cart with checkout and order history",
  "collectionName": "Shopping Cart API",
  "baseUrl": "https://api.example.com",
  "apply": true,
  "flowOut": ".http-forge/shopping-cart.flow.js"
}
```

**Output**
```json
{
  "collectionId": "shopping-cart_mq1234",
  "openapi": "{...round-trip spec...}",
  "suite": { "id": "arch-suite_xyz", "requestCount": 14, "ai_generated": true },
  "workflowChains": [ { "type": "auth", "..." : "..." } ],
  "docs": "# Shopping Cart API..."
}
```

**Notes**: requires an AI provider on the server (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`); the
handler uses the injected `services.aiProvider`, falling back to `createEnvAiProvider()`. Added to
`CACHE_BUSTING_TOOLS`.

---

#### `review_suite` (Phase 3 review gate)

Run deterministic review rules over a completed suite run and return a structured `ReviewReport`
with findings at error/warn/info severity (response leaks, server errors, failed assertions,
`DELETE != 204`, missing assertions, unhandled 401/403, slow responses). Use as a CI/PR gate: fail
on `summary.pass === false`.

**Input**
```json
{ "runId": "run-20260806-120000", "slowResponseMs": 2000 }
```

**Output**
```json
{
  "summary": { "pass": true, "error": 0, "warn": 2, "info": 1 },
  "findings": [ { "severity": "warn", "requestId": "req_1", "rule": "slow-response", "message": "..." } ]
}
```

**Service call**: `reviewSuiteRun` (`src/infrastructure/review/`) — rules are pure and repeatable;
an optional AI provider enriches the report with prose recommendations but the rules never depend
on the LLM.

---

## AI Context & Business Knowledge

Discovery/architect/analysis tools and the MCP prompts (`analyze-test-failure`,
`suggest-assertions`, `review-collection`) are grounded by the **AI context layer**
(`src/infrastructure/ai/ai-context.ts`). It assembles bounded, token-budgeted business-context
blocks from:

- Collection structure and per-request business docs — `buildRequestBusinessContext`,
  `buildCollectionBusinessContext`
- Workspace knowledge — `gatherWorkspaceKnowledge` reads `.http-forge/knowledge/**/*.md`,
  `README.md`, and `AGENTS.md`
- Test-run results — `buildRunResultsContext`
- Pluggable sources — `registerKnowledgeSource` / `ApiKnowledgeSource`
  (`collection`, `openapi`, `discovered-code`, `workspace-knowledge`, `run-results`)

The `.http-forge/knowledge/**/*.md` convention is documented in the AGENTS.md template that
`FolderCollectionStore.ensureAgentsMd()` writes — drop Confluence exports, Jira summaries, and ADRs
there so agents understand the domain without guessing.

---

## Total Tool Count

| Group | Tools | New? |
|-------|-------|------|
| Collection inspection | 4 | No (existing) |
| Collection structure | 4 | Yes |
| Request management | 3 | Yes |
| Script management | 2 | Yes |
| Ordering | 1 | Yes |
| Suite management | 8 | Yes |
| Environment management | 9 | Yes |
| API discovery, drift, architect & QA (added v0.6) | 9 | Yes |
| **Total** | **40** | **36 new** |

> The 4 existing inspection tools (`list_collections`, `list_folders`,
> `list_requests`, `search_requests`) are already in `buildGenericTools()`.
> All new tools go into the same `GENERIC_TOOL_NAMES` enum and
> `buildGenericTools()` list so they are served in both *flat* and *drilldown* modes.
>
> The discovery/drift/architect group (Group 8) is **excluded from `execution-only` MCP mode**
> (`DISCOVERY_AND_MANAGEMENT_TOOL_SUFFIXES` in `mcp-tool-builder.ts`) because those tools scan and
> modify workspace files rather than merely executing requests.

---

## Implementation Plan

### Step 1 — New service methods (http-forge.core)

These methods are missing from the services and must be added:

#### `CollectionService`

| Method | Description |
|--------|-------------|
| `createFolder(collectionId, name, parentFolderId?)` | Write `folder.json`, update parent `order` |
| `deleteFolder(collectionId, folderId)` | Remove folder dir, remove from parent `order` |
| `getRequestScript(collectionId, requestId, phase)` | Read script source string |
| `setRequestScript(collectionId, requestId, phase, source)` | Write script, update request.json |
| `reorderItems(collectionId, folderId \| null, order)` | Patch `order` in `collection.json` or `folder.json` |

All other needed collection methods (`createCollection`, `renameCollection`,
`deleteCollection`, `duplicateCollection`, `addRequest`, `updateRequest`,
`deleteRequest`) already exist.

#### `TestSuiteService`

No new service methods are required.  All suite operations compose existing
methods (`createSuite`, `getSuite`, `updateSuite`, `deleteSuite`,
`duplicateSuite`, `createTempSuiteFromCollection`, `createTempSuiteFromFolder`,
`saveTempSuite`).

#### `EnvironmentConfigService`

No new service methods required — all are already present.

---

### Step 2 — Tool schemas (`mcp-tool-schemas.ts`)

Add 27 new tool name constants to `GENERIC_TOOL_NAMES` and 27 new tool
definition objects to `buildGenericTools()`.

New constants to add:
```typescript
// Collection management
createCollection: 'create_collection',
renameCollection: 'rename_collection',
deleteCollection: 'delete_collection',
duplicateCollection: 'duplicate_collection',
createFolder: 'create_folder',
deleteFolder: 'delete_folder',
// Request management
createRequest: 'create_request',
updateRequest: 'update_request',
deleteRequest: 'delete_request',
// Script management
getRequestScript: 'get_request_script',
setRequestScript: 'set_request_script',
// Ordering
reorderCollectionItems: 'reorder_collection_items',
// Suite management
listSuites: 'list_suites',
getSuite: 'get_suite',
createSuite: 'create_suite',
updateSuiteConfig: 'update_suite_config',
addSuiteRequests: 'add_suite_requests',
removeSuiteRequest: 'remove_suite_request',
reorderSuiteRequests: 'reorder_suite_requests',
duplicateSuite: 'duplicate_suite',
deleteSuite: 'delete_suite',
// Environment management
listEnvironments: 'list_environments',
getEnvironmentVariables: 'get_environment_variables',
selectEnvironment: 'select_environment',
createEnvironment: 'create_environment',
deleteEnvironment: 'delete_environment',
setEnvironmentVariable: 'set_environment_variable',
unsetEnvironmentVariable: 'unset_environment_variable',
setGlobalVariable: 'set_global_variable',
getGlobals: 'get_globals',
```

---

### Step 3 — Dispatch handlers (`mcp-runtime.ts` and `mcp-server.ts`)

The handler for each new tool name follows the pattern already used for
`listCollections`, `setVariable`, etc. in `dispatchGenericTool()`.

All management tool dispatchers will use the **persistent instance container**
(`instance.container`) rather than creating a new container per call — so that
`setEnvironmentVariable`, `setGlobalVariable`, and runtime state written by
management tools is immediately visible to subsequent `run_*` calls in the same
session.

> **Important for the extension server (`mcp-server.ts`)**: it already has access
> to `CollectionService`, `TestSuiteService`, and `EnvironmentConfigService` via
> its injected `IContainer`.  The core `mcp-runtime.ts` uses `createNodeContainer`
> which already wires those services.  The same dispatch logic can live in a shared
> helper or be duplicated (the extension server has always handled dispatch
> separately due to its VS Code dependencies).

---

### Step 4 — Cache invalidation

Management tools that write to disk must bust the `toolListCache` for the
workspace folder so the next `tools/list` call reflects the new collections,
folders, or suites:

```typescript
toolListCache.delete(instance.workspaceFolder);
```

This one-liner is added at the end of any dispatch handler that creates,
renames, deletes, or reorders a collection, folder, request, or suite.

---

### Step 5 — Security guards

- `delete_collection`, `delete_folder`, `delete_request`, `delete_suite`,
  `delete_environment` — require `"confirm": true` in the input.  The tool
  schema marks `confirm` as required and its description says
  *"must be `true` to proceed"*.  If absent or `false`, the handler returns
  an error without touching disk.

- `set_environment_variable` with `scope: "permanent"` patches a source-controlled
  file.  The tool description warns: *"permanent scope writes to the env JSON file
  and is committed to source control"*.

---

## File Change Summary

| File | Change |
|------|--------|
| `src/infrastructure/collection/collection-service.ts` | Add `createFolder`, `deleteFolder`, `getRequestScript`, `setRequestScript`, `reorderItems` |
| `src/runtime/mcp-tool-schemas.ts` | Add 27 new tool name constants + 27 tool definitions in `buildGenericTools` |
| `src/runtime/mcp-runtime.ts` | Add 27 new dispatch branches in `dispatchGenericTool` |
| `src/infrastructure/mcp/mcp-server.ts` (extension) | Add same 27 dispatch branches |

`TestSuiteService` and `EnvironmentConfigService` need no changes.

---

## AI-Native Tools

Three additional tools are registered under the `GENERIC_TOOL_NAMES` map and handled in `dispatchGenericTool`. Unlike the management tools above, these are **read-oriented** — they do not write to disk — and are designed to be called by AI agents (Copilot, Claude, etc.) to accelerate API test authoring.

---

### `scaffold_collection_from_openapi`

Imports an OpenAPI 3.0 spec file and creates a complete HTTP Forge collection from it. All operations become requests grouped by tag/path. An optional environment entry is created from the server URL.

**Tool name:** `scaffold_collection_from_openapi`

**Input schema:**

| Field | Type | Required | Description |
|---|---|---|---|
| `specPath` | `string` | ✅ | Absolute or workspace-relative path to a `.json` or `.yaml` OpenAPI 3.0 file |
| `collectionName` | `string` | — | Override the collection name (defaults to the spec `info.title`) |
| `environmentName` | `string` | — | Name for the generated environment that contains the server base URL. Omit to skip environment creation |

**Returns:**

```json
{
  "collectionId": "my-api_mq1234",
  "collectionName": "My API",
  "requestCount": 42,
  "environmentCreated": "my-api",
  "hint": "Use list_requests to browse the scaffolded collection, then run_request to test individual endpoints."
}
```

**Example agent interaction:**

```
User: scaffold a collection from the OpenAPI spec at ./api.yml

Agent calls: scaffold_collection_from_openapi({ "specPath": "./api.yml", "environmentName": "my-api-dev" })

→ Collection "My API" created with 42 requests.
→ Environment "my-api-dev" created with BASE_URL=https://api.example.com.
```

**Implementation notes:**
- Delegates to `OpenApiImporter` which handles YAML/JSON parsing, `$ref` resolution, example generation, and auth mapping (Bearer, Basic, API key).
- Relative `specPath` values are resolved against `services.workspaceFolder`.
- The importer writes the collection to disk immediately; the new collection is available in subsequent `list_collections` / `run_request` calls.

---

### `suggest_assertions`

Analyses the most recent run results for a request in the current MCP session and returns ready-to-paste `pm.test()` assertion snippets. No LLM is involved — assertions are derived from the observed response: status code, response time, Content-Type, and top-level JSON fields.

**Tool name:** `suggest_assertions`

**Input schema:**

| Field | Type | Required | Description |
|---|---|---|---|
| `collection` | `string` | ✅ | Collection name or id that owns the request |
| `request` | `string` | ✅ | Request name, id, slug, or partial name (substring match) |
| `maxSuggestions` | `number` | — | Cap the number of snippets returned (default: 10, max: 20) |

**Returns:**

```json
{
  "collection": "My API",
  "request": "Create Order",
  "suggestions": [
    {
      "snippet": "pm.test(\"Status code is 201\", function () {\n  pm.response.to.have.status(201);\n});",
      "rationale": "Observed status 201 in the most recent run."
    },
    {
      "snippet": "pm.test(\"Response time is under 2000ms\", function () {\n  pm.expect(pm.response.responseTime).to.be.below(2000);\n});",
      "rationale": "Good practice to gate on response time in CI."
    },
    {
      "snippet": "pm.test(\"Response has field 'orderId'\", function () {\n  const body = pm.response.json();\n  pm.expect(body).to.have.property(\"orderId\");\n});",
      "rationale": "Field \"orderId\" was present in the observed response body."
    }
  ],
  "hint": "Paste the snippets into the request's post-response script using set_request_script."
}
```

**Example agent interaction:**

```
User: suggest assertions for the "Create Order" request

Agent:
1. run_request({ collection: "my-api", request: "Create Order", environment: "dev", include: ["tests"] })
   → { status: 201, body: { orderId: "abc-123", total: 99.99 } }

2. suggest_assertions({ collection: "my-api", request: "Create Order" })
   → 5 snippets returned

3. set_request_script({ collection: "my-api", request: "Create Order", phase: "post-response", script: "<combined snippets>" })
   → Script saved.
```

**Implementation notes:**
- Looks up results in the caller's `McpRunStore` (in-memory, session-scoped). If the request has not been run in the current session, generic fallback snippets are returned.
- Request resolution uses the full four-tier lookup: id → exact name → case-insensitive name → substring.

---

### `explain_failure`

Explains why a specific request failed in a recent run. Returns the full request context (URL, method, headers, body), the response received (status, headers, body), all assertion results, any script errors, and a plain-English diagnosis with suggested fixes.

**Tool name:** `explain_failure`

**Input schema:**

| Field | Type | Required | Description |
|---|---|---|---|
| `runId` | `string` | — | MCP run id (from a prior `run_suite` or `run_collection` call). Provide this for the most accurate results |
| `collection` | `string` | — | Collection name or id. Required when `runId` is omitted |
| `request` | `string` | — | Request name, id, or partial name |
| `iteration` | `number` | — | Iteration number within the run (default: 1) |

Provide either `runId` + `request`, or `collection` + `request`. When only `collection` + `request` is given and no run has been recorded yet, the tool returns a hint to run the request first.

**Returns:**

```json
{
  "runId": "run-20260626-141501-813",
  "request": "Create Order",
  "iteration": 1,
  "status": "failed",
  "passed": false,
  "error": null,
  "failedAssertions": [
    { "name": "Status is 201", "passed": false, "message": "expected 500 to equal 201" }
  ],
  "allAssertions": [ ... ],
  "requestDetails": {
    "method": "POST",
    "url": "https://staging.example.com/orders",
    "requestBody": "{ \"productId\": \"p-99\" }"
  },
  "responseDetails": {
    "status": 500,
    "headers": { "content-type": "application/json" },
    "body": "{ \"error\": \"Database connection refused\" }"
  },
  "diagnosis": "1 assertion(s) failed. Review the expected vs actual values below and verify the API contract.",
  "suggestedFixes": [
    "Fix assertion \"Status is 201\": expected 500 to equal 201"
  ]
}
```

**Example agent interaction:**

```
User: why did the smoke test fail?

Agent:
1. run_suite({ suite: "smoke-tests", environment: "staging" })
   → { runId: "run-20260626-141501", allPassed: false, failedRequests: ["Create Order"] }

2. explain_failure({ runId: "run-20260626-141501", request: "Create Order" })
   → Diagnosis: "The server returned 500 — Database connection refused. Check that the staging database is running and that DB_HOST is set correctly."
```

**Implementation notes:**
- When `runId` is provided, results are read from the `McpRunStore` (in-memory).
- When only `collection` + `request` is given, the tool returns a hint to run the request first. It does not read persisted disk results (use `getRunSummary` / `getFailedRequests` for that).
- Diagnosis is deterministic (rule-based), not AI-generated. The explanation is always consistent and does not require an LLM.

---

## Tool Registration Summary (all tools)

The complete `GENERIC_TOOL_NAMES` map now includes 5 tiers:

```
Tier 1 — Inspection & execution (original)
  list_collections, list_folders, list_requests, search_requests,
  get_environment, set_variable,
  get_run_status, get_run_summary, get_failed_requests, get_request_result, cancel_run,
  run_request, run_folder, run_collection, run_suite

Tier 2 — Collection & suite management (added in v0.5)
  create_collection, rename_collection, delete_collection, duplicate_collection,
  create_folder, delete_folder,
  create_request, update_request, delete_request,
  get_request_script, set_request_script,
  reorder_collection_items,
  list_suites, get_suite, create_suite, update_suite_config,
  add_suite_requests, remove_suite_request, reorder_suite_requests,
  duplicate_suite, delete_suite,
  list_environments, get_environment_variables, select_environment,
  create_environment, delete_environment,
  set_environment_variable, unset_environment_variable,
  set_global_variable, get_globals

Tier 3 — AI-native (added in v0.6)
  scaffold_collection_from_openapi,
  suggest_assertions,
  explain_failure

Tier 4 — API discovery, drift, QA & architect (added v0.6; excluded from execution-only mode)
  create_request_from_endpoint, generate_test_suite,
  suggest_workflow, generate_workflow,
  check_drift, propose_update,
  qa_api,
  design_api_from_intent,
  review_suite

Tier 5 — Agentic AI + gap-closure (added v0.6)
  suggest_env_vars, apply_env_vars,
  get_requests_for_enhancement, apply_request_enhancements,
  ai_suggest_env_vars, ai_enhance_collection,
  analyze_coverage, ai_analyze_coverage,
  generate_request_from_intent, validate_against_spec,
  generate_scenarios, heal_assertions, generate_iteration_data
```

---

## MCP Prompts

In addition to tools, the MCP server exposes **prompts** (via `prompts/list` and `prompts/get`). Prompts differ from tools: instead of returning data, they return structured `messages[]` that the MCP host passes directly to its connected LLM. This lets the calling AI (Copilot, Claude, etc.) perform deep analysis without any extra configuration.

Prompt payloads are grounded by the **AI context layer** (`src/infrastructure/ai/ai-context.ts`) — collection/request business context, per-request `doc.md`, workspace knowledge (`.http-forge/knowledge/**/*.md`), OpenAPI metadata, and run results are assembled into bounded context blocks so the LLM does not have to guess what an endpoint does.

### Prompt: `analyze-test-failure`

Diagnose every failed request in a completed run and suggest concrete fixes.

**Arguments:**

| Name | Required | Description |
|---|---|---|
| `runId` | Yes | Run ID returned by `run_suite`, `run_collection`, or `run_folder` |
| `request` | No | Filter analysis to a single request name |

**When it is triggered:**
- **Automatically (sync runs):** When `run_suite` / `run_collection` / `run_folder` returns with `summary.failed > 0`, the response includes a `_nextStep` field with a "REQUIRED ACTION" directive. The AI is expected to act on it immediately without waiting for the user.
- **Automatically (async runs):** `get_run_summary` embeds `failedRequests` inline and the same `_nextStep` directive when failures are detected.
- **Explicitly:** User asks "analyze failures from run abc123" → AI calls `prompts/get`.

**LLM output covers:**
1. Root cause per failure (HTTP error, assertion mismatch, script exception, environment variable missing, etc.)
2. Specific fix (corrected URL, added header, updated request body, updated assertion)
3. Replacement `pm.test()` script where the existing assertions are wrong

---

### Prompt: `suggest-assertions`

Write `pm.test()` assertion scripts for a request based on its definition and (optionally) an observed response.

**Arguments:**

| Name | Required | Description |
|---|---|---|
| `collection` | Yes | Collection name or id |
| `request` | Yes | Request name or id |
| `runId` | No | If provided, uses the actual observed response body for more accurate assertions |

**When it is triggered:**
- **Automatically:** After any run, if some (but ≤ 50%) requests produced no assertions, the run result includes `_suggestions` pointing to this prompt with the specific request names.
- **Explicitly:** User asks "suggest assertions for the Login request" → AI calls `prompts/get`.

---

### Prompt: `review-collection`

Summarise a collection's structure, coverage gaps, and assertion quality, then ask the LLM for an actionable review.

**Arguments:**

| Name | Required | Description |
|---|---|---|
| `collection` | Yes | Collection name or id |

**When it is triggered:**
- **Automatically:** After any run where > 50% of requests have no `pm.test()` assertions, the run result includes `_suggestions` pointing to this prompt.
- **Explicitly:** User asks "review my user-api collection" → AI calls `prompts/get`.

---

### AI guidance fields in tool responses

Run tools inject the following fields when relevant:

| Field | Appears on | Description |
|---|---|---|
| `_nextStep` | `run_*` (sync), `get_run_summary` (async) | Imperative instruction for the AI agent. Present when `summary.failed > 0`. Value starts with "REQUIRED ACTION:" so the AI treats it as mandatory. |
| `failedRequests` | `get_run_summary` | Full per-failure details: `method`, `url`, `requestBody`, `requestHeaders` (redacted), `status`, `responseBody`, `failedTests`. Inline so no extra `get_failed_requests` call is needed. |
| `_suggestions` | `run_*` (sync), `get_run_summary` (async) | Present when requests have no `pm.test()` coverage. Points AI to `suggest-assertions` (< 50% untested) or `review-collection` (> 50% untested). |
| `noAssertionExamples` | `get_run_summary` (async) | Up to 5 request names that ran without any assertions. Used to build `_suggestions`. |
