---
name: create-test-suite
description: Create a test suite for sanity, regression, smoke, or end-to-end testing
triggers: ["create test suite", "sanity test", "regression test", "test suite", "e2e test", "integration test", "smoke test"]
---

# Create Test Suite Skill

Create a well-structured test suite for sanity, regression, smoke, or end-to-end testing.

## Suite File Format

Test suites are stored as `.suite.json` files in `assets/suites/` (or subfolders for organization).

### Schema
See `.http-forge/AGENTS.md` § JSON Schemas for the full suite schema. Key file: `suite.schema.json`.

### Node Types

| Type | Purpose | Key Fields |
|---|---|---|
| `request` | Execute an HTTP request | `name`, `request` (collectionId, requestId, method, folderPath), `enabled` |
| `script` | Run JavaScript code | `name`, `script` (code), `enabled` |
| `if` | Conditional branch | `name`, `condition`, `then`, `elseif[]`, `else`, `enabled` |
| `switch` | Multi-way branch | `name`, `expression`, `cases[]`, `default`, `enabled` |
| `for` | Loop with counter | `name`, `init`, `condition`, `update`, `maxIterations`, `nodes`, `enabled` |
| `while` | Loop with condition | `name`, `condition`, `maxIterations`, `nodes`, `enabled` |
| `block` | Group of nodes | `name`, `nodes`, `enabled` |

### Request Node Example
```json
{
  "type": "request",
  "name": "Login",
  "request": {
    "collectionId": "my_collection",
    "collectionName": "My Collection",
    "requestId": "login_request_id",
    "name": "Login",
    "method": "POST",
    "folderPath": "auth",
    "enabled": true
  },
  "enabled": true
}
```

### Script Node Example
```json
{
  "type": "script",
  "name": "Setup test data",
  "script": "pm.variables.set('testId', '123');\npm.environment.set('auth_token', 'Bearer abc');",
  "enabled": true
}
```

### If Node Example
```json
{
  "type": "if",
  "name": "Check auth status",
  "condition": "pm.response.status === 200",
  "then": [ /* nodes */ ],
  "elseif": [
    { "condition": "pm.response.status === 401", "nodes": [ /* nodes */ ] }
  ],
  "else": [ /* nodes */ ],
  "enabled": true
}
```

## MCP Tools for Suite Management

| Tool | Purpose |
|---|---|
| `create_suite` | Create a new empty suite |
| `list_suites` | List all suites (includes folderPath) |
| `get_suite` | Get a suite by ID or name |
| `add_suite_requests` | Add requests from a collection to a suite |
| `add_suite_node` | Add a control-flow node (script, if, switch, for, while, block) |
| `update_suite_node` | Update a node's configuration |
| `remove_suite_node` | Remove a node |
| `move_suite_node` | Move/reorder a node |
| `run_suite` | Execute a suite |
| `delete_suite` | Delete a suite |
| `duplicate_suite` | Duplicate a suite |

## Suite Types

### Sanity Suite
- Covers critical paths only (login, core CRUD, logout)
- Fast execution (< 30 seconds)
- Run on every deployment
- Status code checks only

### Regression Suite
- Covers all endpoints and edge cases
- Includes error scenarios (4xx, 5xx)
- Validates response schemas
- Run before releases

### Smoke Suite
- Minimal set of requests to verify system is up
- Single request per critical endpoint
- Run after every deploy

### E2E Suite
- Full user journey (login → create → read → update → delete → logout)
- Uses flow control (if/switch/for) for complex scenarios
- Validates business logic, not just status codes

## Best Practices
- Name suites clearly: "Sanity: Auth Flow", "Regression: Full API", "Smoke: Health Check"
- Use `pm.setNextRequest()` for dynamic flow control
- Add `pm.test()` assertions for every request
- Use `pm.iterationData` for data-driven testing
- Set `stopOnError: true` for dependent requests
- Use `iterations` for load testing scenarios
- Organize suites in folders by feature area (auth/, users/, orders/)
- Use `folderPath` for hierarchical organization

## Example: Sanity Suite Structure
```
Sanity: Core Flows
├── [request] Login (auth bootstrap)
├── [request] Get User Profile
├── [request] List Products
├── [request] Create Order
├── [request] Get Order Details
└── [request] Logout (cleanup)
```

## Example: Regression Suite with Flow Control
```
Regression: Full API
├── [script] Setup (seed test data)
├── [request] Login
├── [if] Auth successful
│   ├── [request] Create Resource
│   ├── [request] Read Resource
│   ├── [request] Update Resource
│   └── [request] Delete Resource
├── [else]
│   └── [script] Log auth failure
└── [script] Cleanup (remove test data)
```

## CLI Commands
```bash
# Run a single suite
http-forge run suite "Sanity: Core Flows" --env dev

# Run all suites
http-forge run suite --all-suites --env dev

# Run suites in a folder
http-forge run suite --suite-folder "auth" --env dev

# Run multiple suites
http-forge run suite --suites "Sanity: Auth,Regression: Full" --env dev
```

## Template Syntax in Suites
- `{{variableName}}` — variable reference
- `{{variable | filter}}` — filter chain
- `{{$guid}}`, `{{$timestamp}}` — dynamic variables
- `pm.variables.get('key')` — read variable in scripts
- `pm.variables.set('key', 'value')` — set variable in scripts
- `pm.iterationData.get('key')` — read data file row
