# Suite Flow Script Sandbox Solution

> ## Status / Current State
>
> This design is **implemented and current**: suite flow-node scripts (`if`/`switch`/`for`/`while`/
> `block`/`request`) run through the same script session runtime as request scripts via
> `container.scriptExecutor.createRequestSession(...)` — see
> `src/runtime/suite-executor.ts` (the node-graph flow engine).
>
> Correction to the "Implementation Files" section below: the flow-node script wiring originally
> lived in `src/runtime/direct-execution.ts`, but that module was later thinned to only the public
> entry points (`runRequest`/`runCollection`/`runFolder`/`runSuite`). The flow-node execution logic
> now lives in `src/runtime/suite-executor.ts`.

## Goal

Enable suite flow-node scripts (`if`, `switch`, `for`, `while`, `block`, `request`) to use the same HTTP Forge scripting model as request scripts, especially:

- `pm.variables.set/get`
- isolated vs non-isolated script mode behavior
- shared script semantics and safety limits

## Problem

The initial flow-node prototype used an ad-hoc `vm.runInNewContext` sandbox with custom helpers (`setVar/getVar`).

That introduced a second script model and diverged from request pre-request/post-response behavior.

## Solution

Route flow-node scripts through the existing script session runtime (`container.scriptExecutor.createRequestSession`) instead of a custom VM.

### What changed

1. Flow-node script execution now creates a real script session context.
2. Node pre scripts run via `session.executePreRequest(...)`.
3. Node post scripts (when a response exists) run via `session.executePostResponse(...)`.
4. Node script variable changes are merged back into flow state from:
   - `localVariables`
   - `modifiedVariables`
5. Example flow suite now uses `pm.variables.set(...)` directly.

## Backward Compatibility

Compatibility is preserved for existing suites:

1. Legacy suites with only `requests` still run unchanged.
2. Flow-enabled suites continue using the same node structure.
3. Existing variable-based conditions (`vars.*`) still work because flow state remains the condition source.
4. Request execution/reporting behavior is unchanged.

## API Direction

Preferred API for flow-node scripts:

- `pm.variables.set/get`

Notes:

- `vars` remains available in node conditions/expressions.
- Post-response node scripts now run with response context when available.

## Safety and Limits

Existing safeguards remain:

1. loop `maxIterations` enforcement
2. request cap enforcement (`HTTP_FORGE_MAX_REQUESTS` when enabled)
3. script runtime timeout behavior inherited from the existing script engine

## Implementation Files

- `src/runtime/suite-executor.ts`
  - Suite node-graph flow engine. Flow-node scripts run via the script session runtime
    (`container.scriptExecutor.createRequestSession`, `executePreRequest` / `executePostResponse`)
    instead of a custom VM.
- `src/runtime/direct-execution.ts`
  - Public entry points (`runRequest` / `runCollection` / `runFolder` / `runSuite`) that delegate
    to `suite-executor.ts`.
- `src/infrastructure/script/interfaces.ts`
  - `PostResponseScriptResult` extended with optional `modifiedVariables` and `localVariables`.
- `src/infrastructure/script/request-script-session.ts`
  - Post-response returns now include variable snapshots for flow-state propagation.

## Example

Updated example using `pm.variables`:

- `http-forge/assets/suites/http_forge_showcase_flow_example.suite.json`

Minimal flow example with reusable script library:

```json
{
  "id": "demo-suite",
  "name": "Demo Suite",
  "requests": [],
  "scripts": {
    "setRole": "pm.variables.set('role', 'admin');"
  },
  "nodes": [
    { "type": "script", "scriptRef": "setRole" },
    {
      "type": "switch",
      "expression": "pm.variables.get('role')",
      "cases": [
        {
          "equals": "admin",
          "nodes": [
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
      ]
    }
  ],
  "config": { "iterations": 1 }
}
```

## Public Documentation

User-facing references:

1. `README.md` — overview and flow-node discoverability.
2. `../api/RUNTIME-API.md` — `runSuite` options and flow-node examples.

## Follow-up Suggestions

1. Add JSON schema-level validation docs for `nodes` payloads.
2. Add end-to-end CI examples using flow-node suites.
