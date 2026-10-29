# Changelog

All notable changes to @http-forge/core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.1 - 2026-10-29

### Fixed

- `NodeSocketIoClient` now uses a static `import * as socketioClient` so `socket.io-client` is resolved/inlined by consumer bundlers (e.g. the VS Code extension) instead of a runtime `require`/dynamic `import` that failed to resolve in bundled consumers.

## 1.0.0 - 2026-10-29

### Added

- **Initial public release** — `@http-forge/core` is now open source (MIT). Includes HTTP execution engine, Postman collection compatibility, WebSocket/Socket.IO headless execution, API discovery (6 frameworks), MCP server (60+ tools), AI features (architect, suggest, enhance, QA, drift), OpenAPI import/export, GraphQL introspection, cloud secret providers, and Test Suite orchestration.
- **LICENSE** — MIT license file added.
- **CONTRIBUTING.md** — development workflow and coding conventions.
- **Issue templates** — bug report and feature request templates.

### Changed

- **AGENTS_MD_VERSION bumped to 4** — the generated `.http-forge/AGENTS.md` template now includes the HTTP Forge Loop, Test Generation Best Practices, AI Test Generation guidance, and CLI command reference.
- **Node.js 24 support** — verified all tests and builds pass under Node 24 (latest LTS).

## 0.7.2 - 2026-10-28

### Changed

- **AGENTS_MD_VERSION bumped to 4** — the generated `.http-forge/AGENTS.md` template now includes the HTTP Forge Loop (Design → Discover → Generate → Edit → Run → Report → Fix), Test Generation Best Practices (7 test types with snippets/checklists), AI Test Generation guidance (infer vs. ask), and CLI command reference including `generate-ai-agent` / `generate-ai-config`. Existing v3 guides will be flagged stale and refreshed on next `refresh-agents-md --apply`.
- **GraphQL introspection fix** — `fetchSchema` now always sends `Content-Type: application/json` and `Accept: application/json` (user-supplied headers no longer override them), resolving 415 errors on servers that reject non-JSON content types.

## 0.7.1 - 2026-10-27

### Changed

- **AGENTS.md template** — added Test Generation Best Practices (7 test types with snippets/checklists), AI Test Generation guidance (infer vs. ask), and CLI command reference including `generate-ai-agent` / `generate-ai-config`.

## 0.7.0 - 2026-10-26

### Added

- **WebSocket and Socket.IO headless execution** — `CollectionRequestExecutor` accepts injected `IWebSocketClient` and `ISocketIoClient` and delegates to `websocket-request-runner.ts` / `socketio-request-runner.ts`. Runs connect, send saved messages, collect frames for a configurable response wait, close, and synthesize `pm.response` with code `101` and a `WebSocketRunTranscript` body. Pre-request and post-response scripts and `pm.test` assertions run against the transcript.
- **Mixed transports in one run** — HTTP, WebSocket, and Socket.IO requests execute together in collection runs, suites, CLI, and MCP; per-request `ok`/status reporting is transport-aware.
- **Socket.IO transport adapter in core** — `NodeSocketIoClient` wraps the lazily loaded `socket.io-client`; supports namespace, auth payload, transport selection, and client version (2.x/3.x/4.x).
- **Raw WebSocket handshake cookies** — `NodeWebSocketClient` captures upgrade response headers; the runner copies them to `response.headers` and the executor stores them in the cookie jar.
- **Persistent frame history** — `WebSocketRequestConfig.frameHistory` persists the frame log with the request.
- **Bundle budget** — raised to 772 KB for Socket.IO adapter support.

### Changed

- `IWebSocketConnection` now exposes `handshakeHeaders`.
- `WebSocketRunFrame` gained an optional `ack` field.
- `SocketIoConfig` gained `namespace`, `auth`, and `transports`.

## 0.6.40 - 2026-10-14

### Added

- **Lazy collection loading — light startup with on-demand heavy fields** — `FolderCollectionStore.loadAllLight()` loads tree metadata only (method/url/headers/auth, no body/scripts/schemas/`doc.md`); `CollectionService` now starts light and enriches via `findRequest()` / new `getRequestDetail()` (also added to `ICollectionService` / `ICollectionReader`). Execution paths (`direct-execution`, `suite-executor`) and single-request MCP/AI readers hydrate before touching heavy fields; bulk list/match paths stay light.
- **Save-path hydration guards** — `save`/`saveItem`/`updateItem` enrich light-loaded items before writing, so persisting a light collection can never clobber `body.json` or drop scripts/docs. `getRequestScript` now resolves through `findRequest` (enriching) instead of raw tree traversal.
- **Bundle budget** — `esbuild` size budget `736 → 740 KB` for the lazy-loading additions (~3 KB minified).
- **QA mode — one-shot discover → generate → run → report** — new `runQaCheck` orchestrator (`infrastructure/qa/qa-service`) with freshness/drift gating, idempotent request creation (matched by method + path, never duplicated), deterministic suite generation, live execution, and a CI-friendly report (`QaCheckReport`: pass/fail/drift/dry-run, per-endpoint expected-vs-actual, low-confidence list). Optional `aiAssertions` pass proposes LLM-written assertions as reviewable suggestions (failures first, capped at 10). New MCP tool `qa_api` (excluded from `execution-only` mode) and table renderer `renderQaReportTable`.
- **Bundle budget** — `esbuild` size budget `740 → 748 KB` for the QA mode additions (~7 KB minified, all stage logic reused).

### Fixed

- **`findRequest` no longer re-reads heavy files from disk on every call** — previously the light-mode heuristic (`_light === undefined`) also matched fully-loaded items, defeating the cache. Enrichment now runs only for genuinely light items, once.
- **Extension Request Tester panel typecheck** — the lazy AI-handler swap referenced a removed import; retyped to `IMessageHandler` with narrow constructor types.
- **ModuleLoader diagnostics go to stderr** — the default output channel used `console.log`, polluting CLI `--output json` on stdout. Now `console.error`; stdout stays machine-readable.

### Tests

- **9 new lazy-loading tests** — `collection-light-load.test.ts` covers metadata-only light load, in-place enrichment, idempotency across heavy-file deletion, heavy `loadAll` backward compatibility, light startup + first-access enrichment, script/detail accessors, and save/update preserving heavy files.

## 0.6.39 - 2026-09-23

### Added

- **Workspace modes — integrated vs standalone (any name) with config priority and config-relative paths** — `ConfigService` now supports two Git layouts with the same engine:
  - **Integrated** — `workspace/.http-forge/assets/{collections,environments,suites}` (default, `.http-forge` literal). **Standalone** — clone the forge repo as any folder name (`my-standalone`, `http-forge-assets`, `acme-tests`) and open it; `assets/` at root or bare `collections/` at root are both recognized. Detection is structural (`assets/collections` or `collections` exists), not name-based.
  - **Config priority flipped** — `workspace/http-forge.config.json` now wins over `workspace/.http-forge/http-forge.config.json` (previously opposite). If neither exists, the default creation location is chosen by existing layout (`assets` at root → root config, otherwise nested).
  - **All storage/history/results/`scripts.modulePaths`/`restClientExport.path`/cert paths are now resolved relative to the config file that defines them** (`path.join(configDir, …)`), not to the workspace root. Old ` "./.http-forge/assets"` inside `.http-forge` is automatically stripped to `"./assets"` for backward compat, and standalone ` "./.http-forge/assets"` at root is stripped to `"./assets"` when no `.http-forge` folder exists.
  - **Opening `assets` directly** — `my-standalone/assets` or `my-project/.http-forge/assets` opened as the VS Code workspace root is normalized to the forge root (`my-standalone` or `my-project`) so collections still load. Check is structural (`assets/collections` exists), so any parent name works.
  - **Docs** — `README.md` and `docs/core-reference.md` now document both modes, priority, relative-path rule, lazy creation, and generic-name handling.

### Changed

- **Lazy creation — no blind `.http-forge` on activation** — `FolderCollectionStore`, `CollectionService` (`ensureCollectionsDir`), `TestSuiteService` (`ensureSuitesDir`), and `JsonCollectionLoader` no longer `mkdir -p` on construction. First `createCollection`/`createSuite`/`saveEnvironment` creates `assets/collections` (or `.http-forge/assets/collections` for integrated) and `AGENTS.md` once. Opening an empty folder no longer pollutes it. `agents-md.test.ts` updated to assert lazy behavior.
- **Bundle budget** — `esbuild` size budget `735 → 736 KB` for the additional workspace/normalization logic.

### Tests

- **21 new workspace-mode tests** — `config-service-workspace-modes.test.ts` covers integrated/standalone/bare, priority, stripping, generic names, opening `assets` directly, `createDefaultConfig` for both layouts, and `CollectionService` loading via either root.
- **12 edge tests** — `config-service-edge.test.ts` covers absolute `storage.root`, empty/dot/traversal, malformed JSON fallback, partial config merging, empty `assets` not treated as root, trailing slash, mixed absolute/relative `modulePaths`, and `storage.format: "json"`.
- **8 integration tests** — `workspace-modes.integration.test.ts` verifies `ConfigService` + `CollectionService` + `TestSuiteService` + `EnvironmentConfigService` together, lazy file-system side effects, watcher resilience, and bare `collections` loading.

## 0.6.38 - 2026-09-22

### Added

- **`IVariableManager` override management** — `resetEnvironmentOverrides()` (previously implementation-only) and new `getAllEnvironmentVariableLocals()` (session overrides per environment, for editor UI) promoted to the interface. No behavior change to resolution or persistence.
- **Versioned `.http-forge/AGENTS.md` guide with opt-in refresh** — new `infrastructure/collection/agents-md.ts` module owns the guide template (`AGENTS_MD_VERSION = 1`, up-to-date with the same-workspace code/docs guidance), staleness detection (`getAgentsMdStatus` — missing markers read as v0/stale), and replace-with-backup refresh (`refreshAgentsMd` backs up to `AGENTS.md.bak`). `FolderCollectionStore` keeps write-once creation via delegation. New exports: `AGENTS_MD_VERSION`, `buildAgentsMdContent`, `ensureAgentsMdFile`, `getAgentsMdPath`, `getAgentsMdStatus`, `readAgentsMdVersion`, `refreshAgentsMd` (+ `AgentsMdStatus` / `AgentsMdRefreshResult` types).

## 0.6.37 - 2026-09-22

### Fixed

- **Docs: suite flow alias parity** — `README.md` (Suite Flow Nodes) now documents that `pm`/`ctx`/`hf` are interchangeable in both script bodies and `if`/`switch`/`for`/`while` condition expressions, and details the `createTempSuiteFromRequest` performance loop (`init: hf.variables.set("__i",0)` / `loopCondition: hf.variables.get("__i") < 100` / `update: hf.variables.set("__i", hf.variables.get("__i")+1)` / `maxIterations: 100`). No runtime change – core `SuiteExecutor` already supported all three aliases (parity documented for extension fix 0.16.38).

## 0.6.36 - 2026-08-04

### Added

- **AI business-context layer** — new `infrastructure/ai/ai-context.ts` assembles compact, bounded "business context" blocks from collection structure, per-request docs (`doc.md`), descriptions, OpenAPI metadata (`operationId`/`summary`/`tags`/schemas), workspace knowledge files (`.http-forge/knowledge/**/*.md`, `README.md`, `AGENTS.md`), and test-run results. New exports: `buildRequestBusinessContext`, `buildCollectionBusinessContext`, `gatherWorkspaceKnowledge`, `buildRunResultsContext`, `assembleBusinessContext`. All AI features now receive this grounding: the MCP AI tools (`suggest_assertions`, `explain_failure`, `ai_suggest_env_vars`, `suggest_env_vars`, `ai_enhance_collection`, `generate_request_from_intent`, `generate_scenarios`, `heal_assertions`, `generate_iteration_data`), the `analyze-test-failure` / `suggest-assertions` / `review-collection` prompts, the env-var suggester (collection description), and the collection enhancer (per-request docs + OpenAPI metadata in the prompt). The `AGENTS.md` template documents the `.http-forge/knowledge/` convention and per-request `doc.md`.

### Changed

- **README updated to reflect the current runtime capabilities** — the package docs now call out source-code API discovery, workflow generation, drift detection, AI business-context assembly, and intent-to-OpenAPI API design as first-class core features.
- **Docs aligned with recent engine work** — the top-level docs now better describe the MCP runtime, discovery services, workflow/drift engine, and architect flow as they exist in the shipped code.
- **MCP dispatcher decomposed into a per-tool registry** — the ~2,270-line `dispatchGenericTool` god-function in `runtime/mcp-dispatcher.ts` was replaced by a registry + per-tool modules under `runtime/mcp-handlers/`. Public signature `dispatchGenericTool(tool, args, services, runStore, callbacks)` is preserved for `mcp-runtime.ts` and extension consumers.
- **OpenAPI exporter decomposed** — the ~1,460-line `OpenApiExporter` god-class was split into `openapi-utils.ts`, `openapi-schema-merger.ts`, `openapi-operation-builder.ts`, and `openapi-spec-writer.ts`, with a thin `openapi-exporter.ts` façade. The DI constructor `(collectionService, envConfigService, inferenceService)` and `OpenApiExportOptions` (re-exported from `openapi-utils.ts`) are unchanged.
- **Interface segregation for interceptors** — `IInterceptorChain` was split into `IInterceptorRegistry` + `IInterceptorExecutor`; the combined type is preserved as the DI token and `HttpRequestService` now depends on `IInterceptorExecutor`.
- **Dedup: variable hints** — `toVarName` / `isForgeVar` / `looksLikeSecret` / `SENSITIVE_HEADER_NAMES` / `SENSITIVE_QUERY_KEYS` consolidated into the shared `src/utils/env-hints.ts`; `env-suggester.ts`, `ai-env-suggester.ts`, and `curl-parser.ts` now import from it.
- **Dedup: header sanitization** — new `src/infrastructure/http/header-utils.ts` (`sanitizeHeaderValue` / `sanitizeHeaders`); `RequestPreprocessor` and `NodeHttpClient` delegate to it.
- **Dedup: collection tree CRUD** — `json-collection-loader.ts` and `collection-service.ts` now import `findItemById` / `deleteItemFromTree` from `folder-io.ts` instead of maintaining private copies.
- **Dedup: cookie storage keys** — added `CookieUtils.cookieKey`; `CookieJar`, `InMemoryCookieJar`, and `CookieService` delegate their identical `getCookieKey` implementations.
- **Dedup: dynamic-variable argument parsing** — the byte-identical `parseDynArgsWithVars` in `script-executor.ts` was replaced by `parseDynamicArgs`, now exported from `variable-interpolator.ts`.
- **Dedup: OpenAPI numeric type widening** — the `integer`/`number` → `number` widening rule consolidated into `widenNumericType` in `openapi-utils.ts`, shared by `schema-inferrer.ts` and `openapi-schema-merger.ts`.
- **Bundle size cut ~47%** — `lodash`, `moment`, `ajv`, `tv4`, `uuid`, `yaml`, and `@apidevtools/json-schema-ref-parser` are now externalized in the esbuild/tsup production build (minified `dist/index.js` dropped from ~1.0 MB to ~545 KB). They are loaded lazily only for the Postman script sandbox and OpenAPI import/export, and resolve via `require` at runtime (fallback shims remain for script environments without the npm modules). A 700 KB size-budget check in `esbuild.config.js` fails the production build if it regresses.

### Removed

- **35 dead public exports removed from `index.ts`** — 32 values (`decodeFolderName`, `dedupeToolsByName`, `mcpToolSegment`, `mcpToolToken`, `bootstrapNodeRuntime`, `LoggingRequestInterceptor`, `RetryErrorInterceptor`, `TimingResponseInterceptor`, `mergeRequestSettings`, `createLodashShim`, `createScriptConsole`, `detectSensitiveData`, `redactBody`, `redactUrl`, `AmbiguousRefError`, `createVariableResolver`, `DEFAULT_SUITE_CONFIG`, `expandSummary`, `parsePostmanEnvironmentFile`, `getRestClientExportFolder`, `augmentWithDynamicVars`, `DYNAMIC_VARIABLES`, `resolveDynamicVariable`, `resolveDynamicVariablesInString`, `deepClone`, `formatBytes`, `formatDuration`, `isPlainObject`, `safeJsonParse`, `generateUUID`, `mergeHeadersCaseInsensitive`, `sanitizeName`) and 3 types (`NodeBootstrapOptions`, `SensitiveDataWarning`). Consumers should use `createNodeContainer` for Node bootstrap (see RUNTIME-API.md).
- **Dead private members removed** — `CollectionService.updateItemRecursive`, `CollectionService.workspaceRoot`, `EnvironmentConfigService.loadJsonFile`, plus the duplicate `generateSlug` export in `index.ts` and the stale `Environment` type in `types/types.ts` (the resolver version is the single source).
- **Near-duplicate interface removed** — `IAsyncCookieServiceFull` was folded into the identical `IAsyncCookieService`.

## 0.6.31 - 2026-07-22

### Added

- **Dynamic HTML report filename** — `HtmlReportGenerator.generate()` now derives the output filename from the run manifest: `report-<env>-<yyyy-MM-dd>-HH-mm.html`. Spaces in the environment name are replaced with `_`.
- **JUnit `<properties>` block** — each `<testsuite>` element in the JUnit XML report now includes a `<properties>` block with: `environment`, `suiteName`, `runId`, `status`, `iterations`, `delay`, and `stopOnError`. Jenkins, GitHub Actions, and GitLab display these alongside test counts.
- **`ITestSuiteService.createTempSuiteFromRequest()`** — new method that builds a temporary performance-test suite for a single request. The request is wrapped in a `for` loop node (100 iterations using `hf.variables.set/get`) so users can prepend login/auth steps before the loop. `SuiteForNode` is now imported in `test-suite-service.ts`.
- **`IResultStorageService.regenerateHtmlReport()`** — new interface method and `ResultStorageService` implementation that regenerates the HTML report for any completed run without requiring an active run state.
- **`IResultStorageService.generateJunitReport()`** — new interface method and `ResultStorageService` implementation that writes JUnit XML for any completed run from persisted result artifacts.
- **AI-friendly `run-summary.md` output** — completed runs now generate a Markdown summary next to the HTML report with pass/fail totals, failed assertion details, truncated request/response bodies, and guidance for AI-assisted failure analysis.

### Changed

- **Environment-resolved request and proxy config** — `core-bootstrap` now sources `NodeHttpClient` request/proxy settings from `EnvironmentConfigService.getResolvedConfig()`, allowing `{{variable}}` placeholders in request/proxy config to resolve from environment files and refresh on config/env changes or environment switches.
- **Proxy configuration supports `enabled`** — `ProxyConfig` now accepts `enabled?: boolean`, allowing a configured proxy to be disabled without removing its URL settings.
- **Folder path documentation clarified** — docs now explain the external display/input form for folder names containing `/`: separate folder levels with ` / `, while internal runtime paths encode embedded slashes as `%2F`.

## 0.6.30 - 2026-07-22

### Added

- **HTTP/HTTPS proxy support in `NodeHttpClient`** — requests are now routed through a configured proxy using only Node.js built-ins (`net`, `tls`). No extra npm packages required.
  - **`ProxySource` type** — mirrors `RequestSettingsSource`: accepts a static `ProxyConfig | null` or a `() => ProxyConfig | null` provider function that is resolved fresh on every request for live reloads.
  - **`buildHttpsProxyAgent()`** — opens a TCP socket to the proxy, sends `CONNECT host:port HTTP/1.1`, and upgrades the tunnel to TLS using `tls.connect({ socket })`. Proxy credentials are forwarded as `Proxy-Authorization: Basic ...`.
  - **`buildHttpProxyAgent()`** — overrides `createConnection` to connect to the proxy host and rewrites the request `path` to an absolute URI as required by HTTP/1.1 proxies.
  - **`hostMatchesBypass()`** — evaluates bypass patterns: exact match, `*.wildcard`, or `*` catch-all. Matching hosts skip the proxy and connect directly.
- **`NodeHttpClient` constructor accepts optional `proxySource`** — new optional third parameter. Existing callers with one or two parameters are unaffected.
- **`core-bootstrap` wires proxy from config service** — `NodeHttpClient` is now constructed with `() => configService.getProxyConfig()` so proxy settings are live-reloaded whenever `http-forge.config.json` is saved.

## 0.6.28 - 2026-07-21

### Added

- **`ReportConfig` interface and `HtmlReportOptions`** — new configuration for HTML report body embedding: `maxBodyChars` (default 100 000) caps the size of each embedded request/response body, and `embedBodies` (`'all'` | `'failed'` | `'none'`; default `'failed'`) controls which requests include bodies in the report. Prevents multi-GB HTML files that exhaust V8's string length limit.
- **`RequestSettingsSource` type** — `NodeHttpClient` constructor now accepts either a plain `Partial<RequestSettings>` object or a `() => Partial<RequestSettings>` provider function. The provider form resolves settings lazily on every request, so live configuration changes (e.g. newly added host TLS certificates) take effect without recreating the client instance.

### Changed

- **`NodeHttpClient` settings resolved lazily** — `core-bootstrap.ts` now passes a provider function to `NodeHttpClient` instead of a static snapshot. TLS certificate mappings and other request settings added after startup are picked up immediately.
- **HTML report detail rendering moved client-side** — per-request detail panels (headers, bodies, assertions, metadata) are stored as a single JSON blob in the report and rendered on demand when expanded, instead of duplicating the HTML for every request. Reduces report file size significantly for large collections.
- **Result storage no longer persists `modifiedVariables`** — `modifiedVariables`, `modifiedEnvironmentVariables`, and `modifiedCollectionVariables` are runtime-only fields used to carry state between requests. Persisting them bloated every result file many-fold (e.g. when scripts stash large blobs in variables). They are now omitted from disk; nothing reads them back.

### Fixed

- **`FetchHttpClient` no longer strips request body for GET and HEAD** — the method-based body exclusion (`['GET', 'HEAD']` check) has been removed. The body is now passed through to `fetch()` for all HTTP methods, consistent with `NodeHttpClient` which already had no method restriction. This aligns with RFC 9110 which does not forbid request bodies on any method.
- **Postman import: malformed event objects no longer imported as empty requests** — exported Postman collections sometimes contain event objects (with `listen`/`script` properties but no `request`) at the item level. These are now filtered out during import instead of creating nameless, broken request entries.
- **Postman import: missing folder/request names handled gracefully** — folders without a `name` field default to `'Folder'`; requests without a `name` default to the HTTP method or `'Request'`.
- **Collection metadata `order` written after children are resolved** — `collection.json` and `folder.json` now write the `$schema` + `order` fields after all child items have been saved, ensuring the order array reflects the actual slugs on disk.
- **`NodeFileWatcher` rewrite** — the file watcher now correctly distinguishes create, change, and delete events (previously all callbacks were no-ops). Includes debouncing of duplicate `fs.watch` events, glob-to-path resolution for both directory and specific-file patterns, and proper cleanup on `dispose()`.

## 0.6.27 - 2026-07-17

### Added

- **`execution-only` MCP tool mode** — new `McpToolMode` value. In this mode `buildMcpToolList()` returns only the ~20 tools that require the HTTP Forge runtime (run, poll, AI analysis tools), omitting discovery and collection-management tools that AI agents with file-system access can replace by reading the plain-JSON collection files directly.
- **Auto-detection of `execution-only` in `auto` mode** — `buildMcpToolList()` now accepts an optional `workspaceFolder` parameter. When `toolMode` is `"auto"` and drilldown would normally activate, the function checks for `.http-forge/AGENTS.md`. If present, the mode is upgraded to `execution-only` automatically — no configuration needed.
- **`applyMcpBodyTruncation()` exported** — post-processes run results at the MCP layer: truncates `result.body` (single-request runs) and `result.failedRequests[N].body` (collection/suite runs) to 4 KB. Returns a `{ _truncated, excerpt, totalLength, hint }` envelope when truncation occurs. CLI and SDK consumers are unaffected.
- **`fullBody` include option** — all run tools (`run_request`, `run_collection`, `run_folder`, `run_suite`) and `get_run_summary` now accept `include: ["fullBody"]` to disable body truncation. `include: ["report"]` on collection/suite/folder runs generates an HTML report with unrestricted detail.
- **`AGENTS.md` auto-generated on workspace init** — `FolderCollectionStore.ensureDirectory()` writes `.http-forge/AGENTS.md` the first time a workspace is initialised. The file explains the folder layout, schema URLs, and a decision tree (direct file editing → CLI → MCP) for AI agents.
- **`$schema` field in all generated JSON files** — `request.json`, `collection.json`, `folder.json`, `{env}.json`, `_global.json`, and `*.suite.json` now include a `$schema` URL pointing to the GitHub raw schema so AI tools outside VS Code can validate and auto-complete without the extension.
- **Skipped assertion tracking (`pm.test.skip()`)** — the result storage layer now captures skipped assertions:
  - `ResultSummary.as` (`number?`) — skipped assertion count, omitted when zero
  - `FullResultDetails.assertions[].skipped` (`boolean?`) — set on skipped entries
  - `ResultStorageService` preserves the `skipped` flag and counts `ap`/`af`/`as` correctly
- **HTML report redesign** — `HtmlReportGenerator` now emits a multi-tab report: Summary, Total Requests (expandable, filterable), Failed Tests (grouped, collapsed assertions with `▶`), Skipped Tests (`⊘` icon), Per-Request Stats (assertion-based P50/P90/P99), and Timeline.
- **JUnit skipped assertion support** — `JUnitReportGenerator` emits `<skipped message="N assertion(s) skipped via pm.test.skip()"/>` per test case and propagates `skipped="N"` to `<testsuite>` and `<testsuites>` attributes.
- **`ServiceContainer.dispose()`** — new lifecycle method that closes runtime file watchers and other disposable singleton resources. Embedders that bootstrap containers directly via `createNodeContainer()` should call `container.dispose()` before process shutdown to allow Node to exit cleanly.

### Changed

- **`buildMcpToolList()` signature** — optional fourth parameter `workspaceFolder?: string` added. Existing callers without the parameter continue to work unchanged.
- **`McpToolMode` type** — extended to `'flat' | 'drilldown' | 'auto' | 'execution-only'`. Config validation in `ConfigService` accepts the new value.
- **URL builder trailing slash behaviour** — removed the unconditional trailing-slash strip from `url-builder.ts`. Requests with a trailing slash in the path (e.g. `DELETE /favorites/`) are now sent exactly as configured.

### Fixed

- **Skipped assertion counting in storage** — assertions with `skipped: true` are no longer counted in `ap` (passed) or `af` (failed); they are reported separately in `as`.

## 0.6.22 - 2026-07-15

### Added

- **Result grouping normalization utility exported** — added and exported `resolveResultGrouping` for consistent group-path/group-type derivation across runtime consumers.

### Changed

- **Flow-suite request totals now use a simple estimate with live runtime refinement**:
  - pre-run totals estimate enabled request counts across `if`, `switch`, `for`, `while`, and `block` structures
  - runtime branch/loop decisions adjust remaining totals so progress converges toward actual counts
  - progress semantics remain: exact executed `current`, refined/converging `total`
- **Direct execution result grouping alignment** — request results now consistently resolve group path/type from collection/folder/block context for more stable statistics and report grouping.
- **Core docs updated** (`README` + `core-reference`) to document suite estimation/refinement semantics for extension/runtime integrations.

## 0.6.21 - 2026-07-14

### Changed

- **Configuration and runtime reference docs refreshed** — docs now reflect the canonical `.http-forge/http-forge.config.json` location, the full current default config surface (`request.tls`, `request.certificates`, `restClientExport`, `mcp.port`, `secrets.providers`), and updated Postman compatibility notes.

### Fixed

- **Postman cookie-jar compatibility gap in script docs/runtime** — `pm.cookies.jar()` now documents and supports Postman-style callback usage with host strings, full URL strings, and `pm.request.url` objects for `get`, `getAll`, `set`, `unset`, and scoped `clear` calls.

## 0.6.20 - 2026-07-13

### Added

- **Flow-first suite model in core types** — introduced explicit flow-node contracts for suite execution:
  - `SuiteFlowNode` union with `request`, `script`, `if`, `switch`, `for`, `while`, and `block` node types
  - reusable suite script library support via `TestSuite.scripts` + `scriptRef`
  - `LegacySuiteFileData` type for safe legacy file migration handling
- **Typed variable serialization utilities** — added typed-value helpers to preserve non-string values in runtime/script variable scopes:
  - `serializeTypedValue`
  - `deserializeTypedValue`
  - `deserializeTypedRecord`
- **Expression evaluator utility** — added sandboxed expression evaluation helpers used by flow/runtime conditions:
  - `isExpression`
  - `evaluateExpression`
- **TLS certificate mapping support in request configuration** — request/config types now include:
  - `request.tls` per-request TLS settings
  - `request.certificates` host-based certificate mappings

### Changed

- **Direct suite runtime now executes control-flow node graphs (`suite.nodes`) as the primary execution model**:
  - request nodes execute with inherited auth/script context
  - `if` / `switch` / `for` / `while` / `block` orchestration is evaluated at runtime
  - script nodes run through the existing request script session engine (`pm.variables`, `pm.environment`, `pm.globals`) instead of ad-hoc VM execution
  - `for` nodes use `loopCondition` as canonical loop expression (legacy `condition` remains compatible)
  - loop execution enforces `maxIterations` with optional `maxNodeLoopIterations` runtime cap
- **Suite persistence and migration are now flow-first**:
  - legacy flat `requests` suites are migrated to request nodes on load
  - new suites are created with `nodes` as source of truth
  - temporary suite generation and duplication now operate on node graphs
- **Per-request statistics identity changed from name-only grouping to key-based grouping** to avoid collisions for same-named requests across folders/collections.
- **MCP flat tool names are now length-safe and deterministic**:
  - short safe IDs remain human-readable in tool names
  - long/unsafe segments are tokenized with deterministic hash-backed tokens
  - reverse resolution supports hashed, raw legacy, and legacy base64url folder tokens
- **Documentation refreshed for flow runtime behavior** in `README.md` and `RUNTIME-API.md`, including script sandbox notes and branch optionality semantics.

### Fixed

- **Global variable propagation reliability across chained requests** — updates from `pm.globals.set()` / `postman.setGlobalVariable()` now reliably propagate through script execution and subsequent variable resolution.
- **Config-less workspace backward compatibility in path resolution** — root/history/results path resolution now preserves legacy data visibility when no explicit config exists while keeping configured paths authoritative.
- **Native HTTP client TLS handling** — Node client now resolves per-request TLS settings and host-based certificate mappings consistently through explicit HTTPS agent construction.
- **Suite file lifecycle cleanup** — deleting/saving suites now also handles suite directory cleanup paths to avoid stale temporary artifacts.

## 0.6.18 - 2026-07-10
### Fixed

- **Backward compatibility for config-less workspaces restored** — when no config file exists, core now auto-detects legacy storage/cache data and preserves visibility of existing data after upgrade:
  - collections fallback: `./http-forge-assets` (historical pre-0.6.16 default)
  - history/results fallback: `./.http-forge-cache/{histories,results}` when current `.http-forge/.cache/*` paths are empty
- **Fallback scope tightened to official historical defaults** — compatibility fallbacks no longer probe non-default roots; explicit config values remain authoritative.


## 0.6.16 - 2026-07-10

### Changed

- **Default storage paths standardized to `.http-forge/`** — core defaults now consistently target:
  - `storage.root`: `./.http-forge/assets`
  - `storage.history`: `./.http-forge/.cache/histories`
  - `storage.results`: `./.http-forge/.cache/results`
- **Config discovery remains config-first with legacy compatibility** — preferred config file path is `.http-forge/http-forge.config.json` with legacy fallback retained in core.
- **Node runtime cache/store paths aligned** — node bootstrap/runtime fallback paths now use `.http-forge/.cache` conventions.
- **Script module-loader messaging aligned** — runtime guidance for module lookup now references `.http-forge/assets/modules`.

## 0.6.12 - 2026-07-08

### Changed

- **MCP runtime port resolution now documented as config-first** — `mcp.port` in `http-forge.config.json` is the project-level default (default `3100`), while `createMcpRuntime({ port })` remains an explicit runtime override.
- **Runtime API docs updated for config-driven defaults** — examples and option docs now clarify that omitting `McpRuntimeOptions.port` uses `mcp.port` from config.

- **Package keyword metadata alignment** — keywords were normalized to the shared HTTP Forge family baseline while keeping core-specific runtime and headless-engine discovery terms.

## 0.6.11 - 2026-07-05

### Changed

- **README split into landing page + reference docs** — the main README now acts as a short package landing page focused on discoverability, use cases, key APIs, and links to deeper documentation.
- **Detailed package guide preserved** — the previous long-form package documentation was moved to `docs/core-reference.md` so the technical reference remains available without overloading the main README.
- **npm package metadata improved for discoverability** — package description and keywords now better reflect headless API testing, Postman-compatible runtime behavior, OpenAPI workflows, Node.js embedding, CI/CD, and MCP/server use cases.
- **Folder collection persistence** (`folder-collection-store`) now reads/writes extended metadata fields from `request.json` so values survive disk round-trips.
- **Collection adapter mapping** (`folder-collection-loader`) now preserves extended metadata in both conversion directions (`CollectionRequest` ↔ `UnifiedRequest`).
- **Collection creation path** (`CollectionService.createRequest`) now persists extended metadata provided by callers.
- All new metadata fields are **backward-compatible** (optional); existing collections work unchanged.


### Added

- **Collection storage support for extended OpenAPI metadata** — `CollectionRequest` now includes optional fields for:
  - `operationId`, `summary`, `tags`, `examples`, `responses`, `security`
- **OpenAPI Metadata Bridge for External Tools** — new optional fields in `UnifiedRequest` allow external tools (like spring-api-tester) to pass rich OpenAPI metadata:
  - `operationId?: string` — explicit operation identifier (overrides generated)
  - `summary?: string` — OpenAPI summary field (separate from request name)
  - `tags?: string[]` — operation tags (overrides folder-based tagging)
  - `examples?: OperationExample[]` — request/response examples
  - `responses?: Record<string, OperationResponse>` — per-status-code response definitions with schema, examples, and headers
  - `security?: Record<string, string[]>[]` — operation-level security requirements

- **New Types** — `OperationExample` and `OperationResponse` interfaces for structured metadata representation.

- **Enhanced OpenAPI Exporter** — `OpenApiExporter.processRequest()` now:
  - Consumes `request.operationId` if provided (fallback: generates)
  - Consumes `request.summary` if provided (fallback: derives from name)
  - Consumes `request.tags` if provided (fallback: uses folder name)
  - Consumes `request.responses` if provided (fallback: builds from schema)
  - Consumes `request.security` if provided (fallback: uses collection-level)

- **New Helper Method** — `mapResponseDefinitions()` converts operation-level response definitions to OpenAPI format, supporting per-status schema, examples, and headers.

### Fixed

- **Metadata truncation across storage boundaries** — requests created/updated with enriched OpenAPI metadata no longer lose fields when passing through collection loaders/stores.


## 0.6.10 - 2026-07-03

### Fixed

- **Collection item duplication in `createFolder` and `createRequest`** — both methods now reload and synchronize the in-memory collection cache (`this.collections`) immediately after persisting the new item via `loader.saveItem()`. This prevents an out-of-sync state where the loader's cache and the service's map diverged, causing the file watcher to reload the item a second time and create visible duplicates in the collection tree.

## 0.6.6 - 2026-07-02

### Fixed

- **Folder path separator ambiguity** — `/` characters inside folder names are now encoded as `%2F` in all internal `folderPath` strings so the `/` separator is always unambiguous. Affected functions: `flattenRequests` and `enumerateFolders` in `mcp-collection-utils.ts`, `flattenCollection` in `direct-execution.ts`, `flattenRequests` and `resolveFolderRef` in `ref-resolver.ts`, and `extractRequestsFromCollection` in `test-suite-service.ts`. `decodeFolderPath` / `encodeFolderName` / `normalizeFolderInput` helpers are exported from the package.
- **`enumerateFolders` now returns `folderId`** — callers no longer need to re-walk the tree to obtain a folder's ID, eliminating the `split('/').pop()` anti-pattern that broke on folder names containing `/`.
- **`findFolderByPath` replaced with `findFolderById`** in `mcp-dispatcher.ts` — `delete_folder`, `create_request (folder arg)`, and `reorder_collection_items (folder arg)` all resolve the target folder by its immutable ID rather than re-parsing the display path string.
- **`run_folder` `startsWith` false-positive** — the `startsWith(`${target}/`)` check no longer incorrectly includes sibling folders whose encoded names happen to start with the target name followed by `%2F` (the encoding makes segments distinct).
- **`create_suite fromFolder` loose substring filter** replaced with exact prefix-match against encoded internal paths, preventing unintended folder matches.
- **Display output uses ` / ` separator** — `list_folders`, `list_requests`, and `search_requests` decode internal encoded paths to human-readable ` / ` separated strings using `folderNameSegments` (previously stored alongside paths but now derived on demand via `decodeFolderPath`).

## 0.6.5 - 2026-06-30

### Added

- **7 gap-closure agentic MCP tools** — expand the AI surface to cover the full testing lifecycle:
  - **`analyze_coverage`** — computes per-request assertion counts and optionally compares against an OpenAPI spec to identify untested paths and methods. Returns coverage percentage, gap list, and per-request breakdown.
  - **`ai_analyze_coverage`** — agentic variant; returns the same coverage data plus `task.instructions` so an AI agent can immediately act on the gaps (e.g. call `generate_scenarios` or `heal_assertions`).
  - **`generate_request_from_intent`** — returns existing collection context (request names, URLs, environment variable names) and instructions guiding the agent to call `create_request` + `set_request_script` to implement a natural-language request description.
  - **`validate_against_spec`** — loads an OpenAPI spec from disk (JSON or YAML), normalises URL patterns (`{{var}}` → `{param}`), and returns three lists: untested operations, matched requests without assertions, and extra requests absent from the spec.
  - **`generate_scenarios`** — returns paginated request details and instructions for an AI agent to generate negative/edge-case variants (400/401/403/404/boundary). Supports `nextOffset` for large collections so the agent can paginate autonomously.
  - **`heal_assertions`** — returns the current test script and last-run response (when a `runId` is provided) with instructions for an AI agent to rewrite broken assertions and call `set_request_script`.
  - **`generate_iteration_data`** — extracts `{{variable}}` placeholders from the URL, body, and headers of a request and returns them with instructions for an AI agent to produce N varied test-data rows for iteration runs.

- **Env-var extraction and application tools** — detect hardcoded values in a collection and replace them with environment variable placeholders:
  - **`suggest_env_vars`** — scans a collection for hardcoded values (API keys, base URLs, tokens, tenant IDs) using pattern-matching heuristics. Returns `heuristicSuggestions` and a `requestSummary` (URLs, headers, body excerpts) for manual review. Follow up with `apply_env_vars`.
  - **`apply_env_vars`** — replaces hardcoded values with `{{VAR_NAME}}` placeholders throughout a collection and optionally writes the original values to an environment. Call `suggest_env_vars` first to get candidate list.
  - **`ai_suggest_env_vars`** — agentic variant of `suggest_env_vars`; returns `task.instructions` directing the agent to analyse the collection and immediately call `apply_env_vars` without asking for confirmation.

- **Collection enhancement tools** — add example request bodies and `pm.test()` assertion scripts to an existing collection:
  - **`get_requests_for_enhancement`** — returns a paginated batch of request details (method, URL, headers, current body, current test script) ready for an AI agent to write realistic bodies and assertions. Supports `offset`/`limit`/`folder` filtering.
  - **`apply_request_enhancements`** — applies AI-generated body examples and/or post-response test scripts to one or more requests in a collection. Call `get_requests_for_enhancement` first to obtain request IDs and current state.
  - **`ai_enhance_collection`** — agentic variant that combines both steps: returns a batch of requests with `task.instructions` directing the agent to call `apply_request_enhancements` immediately and then paginate via `nextOffset` until all requests are enhanced.

## 0.6.1 - 2026-06-26

### Added

- **JUnit XML reporter** (`infrastructure/test-suite/junit-report-generator.ts`)
  — produces standards-compliant JUnit 5 XML (`<testsuites>/<testsuite>/<testcase>
  /<failure>/<error>/<system-out>`) from persisted run artifacts. Reads the same
  manifest/index/results files the HTML reporter uses, so it works for any run
  size and any number of iterations.

- **`reporters` option on all run APIs** — `runSuite`, `runCollection`,
  `runFolder`, and `runRequest` in `direct-execution.ts` now accept
  `reporters?: string[]`. Passing `['junit']` generates JUnit XML alongside the
  HTML report. The result object gains a `junitReport: { path }` field.
  `reporters: ['html']` can be used as an explicit alias for `--include report` /
  `HTTP_FORGE_GENERATE_REPORTS`.

- **`shouldGenerateReports` updated** to accept a `reporters` array; returns
  `true` when `reporters.includes('html')`, in addition to the existing
  `--include report` / `HTTP_FORGE_GENERATE_REPORTS` triggers.

- **`JUnitReportGenerator` exported** from `src/index.ts`.

- **`RunRequestOptions`, `RunCollectionOptions`, `RunSuiteOptions` gain
  `reporters?: string[]`** in `runtime-contracts.ts`.

- **3 AI-native MCP tools** added to `GENERIC_TOOL_NAMES`, `buildGenericTools`,
  and `dispatchGenericTool`:
  - **`scaffold_collection_from_openapi`** — wraps `OpenApiImporter`; resolves
    relative paths against `services.workspaceFolder`; creates the collection
    and an optional environment from the spec's server URL.
  - **`suggest_assertions`** — looks up the most recent completed run in
    `McpRunStore` for the target request, then returns up to 20 ready-to-paste
    `pm.test()` snippets derived from the observed status code, body, and
    Content-Type. Uses `resolveRequestByLabel` (full four-tier lookup: id →
    exact → case-insensitive → substring).
  - **`explain_failure`** — given a `runId` + request name, returns the full
    request/response context, assertion results, and a deterministic plain-English
    diagnosis. Falls back to a "run first" hint when no `runId` is provided.

- **`get_request` MCP tool** — new read-only tool that returns the full request
  definition (URL, method, headers, body, auth, and both scripts) for a named
  request. Eliminates the two-step `list_requests` + `get_request_script` pattern
  when an agent needs to inspect a request before editing it.

- **`cancel_run` MCP tool** — best-effort cancellation for in-progress async
  runs. Marks the run record as `'cancelled'`; the execution loop skips remaining
  requests after the currently-executing one finishes. Has no effect on runs that
  are already completed, failed, or cancelled.
  `McpRunRecord.status` now includes `'cancelled'` as a valid value.
  `McpRunStore.cancel(id)` added.

- **MCP tool annotations** — `GenericToolDef` now includes an `annotations`
  field (`ToolAnnotations` interface); all 48 tools carry appropriate hints:
  - `readOnlyHint: true` — all list/get/inspect/polling tools
  - `destructiveHint: true` — all delete tools
  - `idempotentHint: true` — all update/set tools
  - `idempotentHint: false` — all create/duplicate tools
  - `openWorldHint: true` — all run/execution tools
  `buildMcpToolList` and `McpTool` are updated to forward annotations in the
  JSON-RPC `tools/list` response.

- **`McpRunStore.values()`** public method added for iterating all stored run
  records (used by `suggest_assertions`).

- **`McpDispatchServices.workspaceFolder?: string`** added to the shared
  dispatch-services interface so AI-native tools can resolve relative file paths.
  The core runtime passes `workspaceFolder` when constructing the services object.

### Fixed

- **`suggest_assertions` and `explain_failure`** previously used an incomplete
  inline request lookup (id, exact name, case-insensitive name only). Both now
  delegate to the shared `resolveRequestByLabel` helper which also tries a
  **substring match** as a fourth tier, consistent with `run_request`.

- **`request not found` errors** now include the first 10 request names from the
  collection and a hint to call `list_requests` or `search_requests`.

- **`suite not found` errors** now include all available suite names and a hint
  to call `list_suites`.

- **`create_collection`, `create_request`, `create_suite` responses** now include
  a `hint` field guiding the agent to the next logical action (e.g.
  `create_folder`, `add_suite_requests`, `run_request`).

### Requires

- Node.js ≥ 20.

## 0.6.0 - 2026-06-25

### Added

- **27 new generic MCP tools** implemented in `dispatchGenericTool`
  (`mcp-dispatcher.ts`) and registered in `buildGenericTools`
  (`mcp-tool-schemas.ts`):

  *Collection management:* `create_collection`, `rename_collection`,
  `delete_collection`, `duplicate_collection`, `create_folder`, `delete_folder`,
  `create_request`, `update_request`, `delete_request`, `get_request_script`,
  `set_request_script`, `reorder_collection_items`

  *Suite management:* `list_suites`, `get_suite`, `create_suite`,
  `update_suite_config`, `add_suite_requests`, `remove_suite_request`,
  `reorder_suite_requests`, `duplicate_suite`, `delete_suite`

  *Environment management:* `list_environments`, `get_environment_variables`,
  `select_environment`, `create_environment`, `delete_environment`,
  `set_environment_variable`, `unset_environment_variable`, `set_global_variable`,
  `get_globals`

- **`set_environment_variable` gains `scope` parameter**: `"session"` (default,
  in-memory) or `"permanent"` (writes directly to the environment JSON config
  file, surviving restarts).

- **`set_global_variable` gains `scope` parameter**: `"session"` keeps the
  value in-memory; `"permanent"` writes it to `_global.json` via
  `saveSharedConfig`.

- **`CACHE_BUSTING_TOOLS` exported from `mcp-dispatcher.ts`**: the set of tools
  that should invalidate the tool-list cache after execution is now a named
  export, shared by both the core runtime and the VS Code extension's executor.

- **`ICollectionService` extended** with `IOrderingManager`
  (`reorderItems`) and `IScriptManager` (`getRequestScript`,
  `setRequestScript`) interfaces.

- **`IEnvironmentConfigService` extended** with `getAllEnvironments()`,
  `createEnvironment(name)`, and `deleteEnvironment(id)`.

### Changed

- **`toolPageSize` default raised from 150 to 200** in `DEFAULT_CONFIG` and
  `getMcpConfig()` fallback.

- **`GENERIC_TOOL_NAMES`** now contains 41 entries (was 14).

## 0.5.3 - 2026-06-25

### Fixed

- **MCP server no longer re-reads the whole workspace on every request**: each
  `McpRuntimeInstance` now holds a single persistent `NodeContainer` created in
  `start()` and disposed in `stop()`. All request handling paths (`tools/list`,
  `tools/call`, CORS, `/report`, `/tools/execute`) reuse this container instead
  of calling `createNodeContainer(workspaceFolder)` on every HTTP request. On a
  workspace with ~1000 collection requests this reduces `tools/list` latency
  from 7–9 seconds to under 50 ms.

## 0.5.2 - 2026-06-24

### Changed

- **MCP default `toolMode` changed from `'flat'` to `'auto'`**: auto-switches to
  drill-down at `drilldownThreshold` (now `100`). No config change needed for
  most workspaces.

- **MCP config defaults**:
  - `maxRequestsPerCall`: `50` → `500`
  - `drilldownThreshold`: `200` → `100`
  - `toolPageSize`: new, default `150`

- **MCP config values clamped in `getMcpConfig()`**:
  - `drilldownThreshold`: [10, 500]
  - `toolPageSize`: [10, 1000] (`0` = no pagination)
  - `maxRequestsPerCall`: [1, 10000]
  - `toolMode`: unknown values fall back to `'auto'`

- **`flat` mode warns when request count > 500** via `console.warn`.

- **`McpToolMode` JSDoc reordered**: `auto` is now listed first as the
  recommended default; `flat` carries an explicit warning about large workspaces.

### Added

- **`list_requests` / `search_requests` return `id`** on each entry in
  `mcp-runtime.ts`.

- **`run_request` accepts `requestId`** in `mcp-runtime.ts`; takes precedence
  over the `request` name argument. Falls back to name if `requestId` is absent.

- **`run_request` schema gains `requestId` property** in `mcp-tool-schemas.ts`.

- **Fuzzy/partial collection and folder resolution** in `mcp-runtime.ts`:
  exact → case-insensitive → substring → segment fallback. Errors include the
  full candidate list.

- **`toolPageSize` field** added to `McpConfig` interface and `DEFAULT_CONFIG`.

### Documentation

- Updated `README.md` (`McpConfig` interface block + `toolMode` prose) and
  `RUNTIME-API.md` (`tools/list` behaviour description) to reflect new defaults
  and the `toolPageSize` field.

## 0.5.1 - 2026-06-24

### Fixed

- **MCP output channel no longer goes silent after `tools/list`**: `bootstrapNodeRuntime`
  previously called `ServiceContainer.instance.clear()`, wiping the global singleton that
  the VS Code extension host uses for all its services (including the `ConsoleService` that
  writes to the "HTTP Forge" output channel). Every `tools/list` call silently removed the
  output channel registration, so subsequent extension operations stopped logging.
  Fixed by adding `ServiceContainer.createFresh()`, which creates an isolated container
  instance without touching the singleton. All MCP runtime operations now use this fresh
  container; the extension's global singleton is never cleared.

- **MCP `tools/list` cache stampede**: when multiple concurrent `tools/list` requests
  arrived with a cold cache, each independently called `buildToolList()` — reading and
  walking every collection file in parallel. A `toolListPending` map now collapses any
  number of simultaneous callers into a single in-flight build; subsequent callers share
  the same `Promise` rather than spawning duplicates.

- **MCP flat-mode `tools/call` leaked a file-system watcher per call**: `dispatchTool`
  created a container for collection-ID resolution but never disposed it, leaking an
  `fs.watch()` handle on every call. With `createFresh()` producing real isolated
  containers, this accumulated. The container is now disposed in a `try/finally` block.

- **`CollectionService` triggered a full disk reload after every self-write**: file-watcher
  events fired by the service's own `saveCollection`, `addRequest`, `updateRequest`,
  `deleteRequest`, `createFolder`, `renameFolder`, `deleteFolder`, `renameRequest`,
  `deleteCollection`, `moveItem`, `reorderItems`, and `duplicateCollection` calls
  unnecessarily re-read every collection file from disk, even though the in-memory
  `collections` map was already up to date. A `selfWritePending` flag now suppresses the
  `loadAll()` call for self-write events while still firing `onCollectionsChanged()` so
  tree views and panels refresh correctly. External changes (git pull, another process)
  are unaffected.

- **Collection service debounce raised 200 ms → 300 ms**: reduces the risk of reading a
  partially-written file during large bulk imports.

- **`createFolder` / `createRequest` returned stale in-memory state**: both methods called
  `this.loader.load(collectionId)` after writing, expecting fresh data, but
  `FolderCollectionStore.load()` serves from its cache (which `saveItem()` does not
  invalidate). The new folder or request was absent from `CollectionService.collections`
  until the next file-watcher debounce cycle reloaded everything. Both methods now update
  the in-memory `collection.items` tree directly, matching the pattern already used by
  `addRequest` and `deleteRequest`.

- **`duplicateFolder` returned stale in-memory state** for the same reason. It now calls
  `this.loadCollections()` directly — the same approach used by `duplicateCollection` —
  ensuring the copied folder tree is immediately visible in memory and suppressing the
  redundant watcher-triggered double reload.

## 0.5.0 - 2026-06-24

### Added

- **MCP drill-down tool mode for large workspaces**: a new `mcp.toolMode`
  (`'flat'` | `'drilldown'` | `'auto'`, default `'flat'`) controls how tools are
  exposed. `flat` keeps today's one-tool-per-request behavior (most AI-friendly
  for normal workspaces). `drilldown` instead exposes a small, fixed set of
  generic tools — `list_collections`, `list_requests`, `run_request`,
  `run_folder`, `run_collection`, `run_suite` — whose *arguments* select the
  target, with collection/suite names advertised as JSON-schema `enum`s so agents
  pick real values instead of guessing. `auto` stays flat until the per-request
  tool count would exceed `mcp.drilldownThreshold` (default `200`), then switches
  to drill-down so the tool list stays bounded and well under client/model
  tool-count limits. Both MCP server implementations share the same logic.

### Documentation

- Documented the MCP drill-down tool mode in `README.md` (the `McpConfig`
  interface gains `toolMode`/`drilldownThreshold` with prose on the three modes)
  and `RUNTIME-API.md` (the `POST /mcp` alias and how `tools/list` content varies
  by `toolMode`, including the generic tool names).

### Changed

- **`pm.response.cookies` is now a Postman-compatible `CookieList`** instead of a
  plain `{ name: value }` map. Use `cookies.get(name)` for the value string,
  `cookies.one(name)` for the full cookie object (`domain`, `path`, `expires`,
  `maxAge`, `httpOnly`, `secure`, `sameSite`), `cookies.has(name)`,
  `cookies.toObject()`, or iterate it directly (`forEach`, `for...of`, numeric
  index). Individual cookies coerce to their value string via `valueOf()`/
  `toString()`. **Breaking:** `pm.response.cookies['name']` no longer returns the
  value — use `cookies.get('name')`.

- **`pm.response.status` is now the reason phrase string (Postman parity)** — e.g.
  `"OK"` — and `pm.response.code` is the numeric status code (e.g. `200`). Previously
  both returned the number. **Breaking:** assertions like
  `pm.expect(pm.response.status).to.equal(200)` must use `pm.response.code` (or the
  Postman form `pm.response.to.have.status(200)`).

- **Removed non-Postman convenience methods from the script response object**:
  `response.getHeader()`, `response.getCookie()`, `response.cookie()`, and
  `response.hasCookie()` no longer exist (they were never part of the Postman API).
  Use `response.headers.get(name)`, `response.cookies.get(name)`, and
  `response.cookies.has(name)` instead. The legacy `postman.getResponseHeader()` /
  `postman.getResponseCookie()` helpers are unaffected.

## 0.4.8 - 2026-06-23

### Added

- **MCP server accepts `POST /mcp`** in addition to `POST /`, so standard MCP
  clients that assume the de-facto `/mcp` path connect without custom config. The
  CORS `Access-Control-Allow-Headers` also advertises `Mcp-Session-Id`.

- **Legacy (pre-`pm.*`) Postman sandbox globals** are now injected so older
  Postman scripts and Newman-exported collections run unmodified. Both phases get
  `request` (`{ id, name, description, url, method, headers, data }`),
  `environment`/`globals` (read snapshots), `data`, and `iteration`; test scripts
  additionally get `responseBody`, `responseCode` (`{ code, name, detail }`),
  `responseHeaders`, `responseTime`, `responseCookies`, the `tests[name] = bool`
  assertion bag, and `postman.getResponseHeader()` / `postman.getResponseCookie()`
  (case-insensitive). `tv4` is exposed as a bare global for
  `tv4.validate(data, schema)` when the optional module is installed.
  `responseCookies` entries and `postman.getResponseCookie()` results now include
  full cookie metadata parsed from `Set-Cookie` (`domain`, `path`, `expires`,
  `maxAge`, `httpOnly`, `secure`, `sameSite`) instead of just `name`/`value`.

### Fixed

- **MCP tool names now stay under the 128-character limit**: collection/request
  IDs embed the human-readable name, so generated tool names (e.g.
  `request__<collectionId>__<requestId>`) could exceed 224 chars and be rejected
  by providers such as Anthropic (`tools.N.custom.name: String should have at
  most 128 characters`). Tool names now embed the raw ID verbatim when it is a
  short, safe segment (≤60 chars, no `__`) for discoverability, and otherwise
  substitute a short deterministic hash token; a whole-name length guard
  re-hashes every segment when the assembled name would still be too long. Calls
  resolve back to the real entity by matching each segment against the current
  collections/requests/folders/suites (raw equality OR hash, with a legacy
  base64url folder fallback so previously-listed names keep working). IDs
  themselves are unchanged. Shared `mcp-tool-name` helper is reused by both MCP
  server implementations so they can't drift.

- **MCP `tools/list` no longer emits duplicate tools**: Postman allows
  same-named sibling folders, which produced identical "run folder" tool names.
  The list is now de-duplicated by name (first occurrence wins) in both server
  implementations, so MCP clients see each tool once.

- **MCP server no longer re-reads the whole workspace on every request**: each
  read (tools/list, CORS, prefix lookup) bootstrapped a fresh service container —
  re-parsing every collection file from disk AND leaking a file watcher per call.
  Read-path containers are now disposed, and `tools/list` is cached for a short
  window so a discovery burst builds the list once. Collection edits remain
  visible within a couple of seconds via the cache TTL.

### Changed

- MCP tool **descriptions** now consistently name the request/folder/collection
  so the model can match inexact user phrasing to the right tool.

- **Response body is now a raw string (Postman parity)**: `pm.response.body` /
  `ctx.response.body` is no longer eagerly `JSON.parse`d — both HTTP clients keep
  the raw response text, matching Postman. Parse on demand with
  `pm.response.json()` (returns `null` for non-JSON) or `pm.response.text()`. The
  legacy `responseBody` global is likewise always a string. `json()`/`text()` and
  the response assertions still tolerate an already-parsed object body for
  backward compatibility. OAuth2 token responses are parsed internally, so token
  acquisition is unaffected.

## 0.4.7 - 2026-06-23

### Added

- **Postman-compatible async/timer draining**: scripts no longer end when their
  synchronous code returns. After the sync body completes, the sandbox is kept
  alive and pending timers (`setTimeout`/`setInterval`) and microtasks
  (un-awaited `Promise`s) are drained before variable scopes are committed — so
  deferred `pm.globals` / `pm.environment` / `pm.variables` writes are visible to
  the next request **without** `await`. Errors thrown inside timer/Promise
  callbacks are reported as non-fatal console errors instead of failing the
  request, and runaway timers (e.g. an uncleared `setInterval`) are force-cancelled
  at the timeout. Scripts with no pending async work return immediately.
- **`scripts.timeout` config** (`scriptTimeout` SDK option, default `5000` ms):
  a single per-script budget that bounds **both** synchronous CPU time and the
  asynchronous drain window. Configurable via `http-forge.config.json` or
  `ForgeContainer.create({ scriptTimeout })`.

## 0.4.6 - 2026-06-22

### Added

- **`ForgeEnv` global-variable API**: `IForgeEnv` now exposes `getGlobals()`,
  `setGlobal(key, value)`, `unsetGlobal(key)` and `clearGlobals()`, surfacing the
  environment-agnostic global layer that previously lived only on the underlying
  resolver. Globals are treated as environment variables without an environment
  scope.

### Fixed

- **`pm.globals` now persists across requests**: globals are handled with the
  same live push-callback mechanism as environment variables (`onGlobalsChange`),
  so `pm.globals.set()` / `unset()` / `clear()` made in one request (or the
  pre-request phase) are written straight to the shared global store and are
  visible to subsequent requests in the run. Previously the collection executor
  seeded an empty global scope and discarded changes, and the SDK
  `RequestExecutor` never seeded or persisted globals at all.
  Note: file-defined globals from `_global.json` act as defaults — `unset()` /
  `clear()` only remove session-set globals, not the file defaults.

## 0.4.5 - 2026-06-22

### Added

- **Configurable script scope** (`scripts.scope`): choose how script levels
  (collection → folder → request) and the pre-request/post-response phases share
  a JavaScript scope. `'shared'` (default) keeps the existing behavior where all
  levels and both phases run in one scope; `'isolated'` runs each level in its own
  scope for Postman compatibility, preventing identifier collisions and cross-phase
  leakage (state must pass through `pm.variables` / `pm.environment` / `pm.globals`).
  Configurable via `http-forge.config.json` or the `scriptScope` option on
  `ForgeContainer.create()`.

## 0.4.4 - 2026-06-22

### Changed

- **Faster collection saves / imports**: `FolderCollectionStore.save()` now writes
  sibling items and the independent files of each request (body, docs, scripts,
  schemas) in parallel, and writes each `collection.json` / `folder.json`
  metadata file only once. Fresh imports take a fast path that skips stale-body
  cleanup and schema-existence probes. Net effect: large `importCollection()`
  runs complete substantially faster.
- **Resilient partial-read handling**: folder/request/collection loaders read JSON
  through a shared `readJsonFileSafe` helper that silently skips empty or
  half-written files (e.g. a file still being written during an import) instead of
  throwing `Unexpected end of JSON input`.


## 0.4.3 - 2026-06-22

### Added

- **Reference resolution by id, slug, or name**: `runRequest()`, `runCollection()`,
  and `runFolder()` accept new `collectionRef`, `requestRef`, and `folderRef`
  options that resolve a value by tier — id, then slug, then display name —
  stopping at the first match. Exact `collectionId` / `requestId` / `folderPath`
  still take precedence when provided.
  - `requestRef` resolution is scoped to `folderRef` when that is provided,
    otherwise it searches the whole collection.
  - `folderRef` is a slash path whose segments are each resolved id → slug → name.
  - A name that matches multiple items throws `AmbiguousRefError`, which carries
    the candidate list (id + path) so callers can disambiguate.
  - New `onResolve` callback reports how each reference resolved (kind, value,
    tier, id) for transparent logging.
  - New exports: `resolveCollectionRef`, `resolveFolderRef`, `resolveRequestRef`,
    `AmbiguousRefError`, and types `RefTier`, `RefKind`, `RefCandidate`,
    `ResolutionInfo`.

## 0.4.2 - 2026-06-22

### Added

- **Run a single folder within a collection**: `runCollection()` accepts two new options — `folderPath` (slash-separated folder names, e.g. `"Auth/Login"`) and `recursive` (default `true`) — to scope a run to one folder. A new `runFolder(options)` convenience wrapper requires `folderPath`. When `folderPath` is set, the temporary suite is named `Collection / Folder`; an empty/invalid folder throws a clear `No requests found under folder "…"` error.
  - `ITestSuiteService.createTempSuiteFromFolder(collectionId, folderPath, recursive?)` builds a temporary suite from a folder for the VS Code runner, mirroring `createTempSuiteFromCollection`.
  - The embeddable MCP runtime now publishes a per-folder tool (`folder__<collectionId>__<base64url(path)>`) for every folder in every collection and dispatches it through `runCollection` with the scoped `folderPath` / `recursive`.

## 0.4.1 - 2026-06-19

### Added

- **Test-suite/collection results are now always persisted in direct/CLI execution**: `runCollection` / `runSuite` (and the CLI) write the run manifest, per-iteration result files, and the result index to `.http-forge-cache/results/<suiteId>/<runId>/` on **every** run, independent of report generation. Previously results were only saved when reports were enabled, so CLI runs without `--include report` produced no on-disk results and nothing appeared in the VS Code **History** tab. HTML report generation remains gated by `include: ['report']` / `HTTP_FORGE_GENERATE_REPORTS`.
  - `IResultStorageService.finalizeRun(status, generateHtmlReport?)` gained a second parameter: when `false`, the run is persisted but the HTML report is skipped (returns `null`).
- **Collection/folder grouping metadata captured for every result**: `flattenCollection()` now records each request's `folderPath` (slash-separated), and `runCollection` / `runSuite` stamp `folderPath` + `collectionName` onto each `ExecutionResult`. These are persisted on both the compact `ResultSummary` (`fp` / `cn`) and `FullResultDetails` (`folderPath` / `collectionName`), enabling iteration → collection → folder grouping in the HTML report and the VS Code results view.
- **Richer `FullResultDetails`**: persisted result files now include the request `method` / `url` / `query` / `params` and a structured `body` (`{ type, format?, content }`); response `time` / `size` / `cookies`; plus `consoleOutput`, `modifiedVariables`, `modifiedEnvironmentVariables`, `modifiedCollectionVariables`, `modifiedSessionVariables`, `nextRequest`, and `visualizerData`.
- **HTML report overhaul (`HtmlReportGenerator`)**: results are grouped by iteration, then by collection + folder; failing groups are flagged with a red header and a red `(passed/total)` count; the **Assertions** section is shown at the top of each request detail; **Execution Metadata** is rendered in its own box under the shorter of the request/response columns; request bodies are hidden when empty (e.g. a `GET` with no body); and jumping to a request expands its parent collapsible sections.

### Changed

- **Postman compatibility — script assertions**: added `pm.expect(...).to.contain()` (alias of `.include()` for strings, arrays, and objects), a dependency-free `validateJsonSchema()` plus the `pm.response.to.have.jsonSchema(schema)` response assertion, and the `pm.test.skip(name, fn?)`, `pm.test.fail(name)`, and `pm.test.index()` helpers. Assertion/validation builders were extracted into a new `script-factories.ts`.
- **Environment variable scoping during multi-request runs**: variable management and resolution now accept an optional `envName` so script writes (`pm.environment.set()`) and `{{var}}` resolution target the **active run** environment rather than the service's selected environment. This fixes chained requests under the CLI when `--env <name>` differs from the selected environment.
  - `IVariableManager.setEnvironmentVariable` / `deleteEnvironmentVariable` / `clearEnvironmentVariables` and `IVariableResolver.resolveVariables` / `resolveVariablesInObject` gained an optional `envName` argument.
  - New `resolveVariablesWithExtra()` and `resolveVariablesInObjectWithExtra()` resolve `{{var}}` with request-scoped extra variables against a specific environment.

### Fixed

- **Runtime resource cleanup**: `runRequest`, `runCollection`, and `runSuite` now dispose container-held resources (test-suite, collection, and related services) in a `finally` block, preventing leaks across repeated direct-execution calls.

## 0.4.0 - 2026-06-18

### Added

- **Cloud secret resolvers (`{{secret:alias/path}}`)**: New `SecretResolverRegistry` resolves secret tokens from external providers before variable interpolation, injecting values as request-scoped extra variables. Supported providers:
  - **AWS Secrets Manager** (`@aws-sdk/client-secrets-manager`) — `region` falls back to `AWS_DEFAULT_REGION`/`AWS_REGION`; supports `#jsonField`
  - **Azure Key Vault** (`@azure/keyvault-secrets`, `@azure/identity`) — `vaultUrl` falls back to `AZURE_KEYVAULT_URL`; supports `/version`
  - **Google Secret Manager** (`@google-cloud/secret-manager`) — `projectId` falls back to `GOOGLE_CLOUD_PROJECT`/`GCLOUD_PROJECT`/`GCP_PROJECT`; supports `/versions/<n>`
  - **HashiCorp Vault** (KV v2) — built-in `fetch`; `VAULT_TOKEN` + `VAULT_ADDR`, optional `mountPath` and `namespace` (`X-Vault-Namespace`, falls back to `VAULT_NAMESPACE`)
  - **1Password** — `op` CLI or `@1password/sdk` via `OP_SERVICE_ACCOUNT_TOKEN`
  - **Doppler** — built-in `https`; `serviceToken` falls back to `DOPPLER_TOKEN`
- **Zero-config defaults**: `DEFAULT_CONFIG.secrets.providers` pre-registers all six aliases so `{{secret:aws/...}}` etc. work without any config when credentials are present; `ConfigService` deep-merges user `secrets.providers` over the defaults per alias.
- **On-demand SDK loading**: Cloud SDKs are resolved through a `require` rooted at the user's project (`scripts.modulePaths`) rather than bundled, so host extensions stay slim. The CLI declares them as `optionalDependencies`.
- **New exports**: `SecretResolverRegistry`, the six resolver classes, and the `ISecretResolver` / `SecretProviderConfig` / `SecretsConfig` types.

## 0.3.2 - 2026-06-17

### Changed

- **Runtime API documentation — include/report semantics**: Updated `RUNTIME-API.md` to reflect current include options for direct APIs:
  - `runRequest`: `headers`, `cookies`, `tests`, `consoleOutput`, `report`
  - `runCollection` / `runSuite`: `perRequest`, `failedOnly`, `consoleOutput`, `report`
- **MCP runtime protocol documentation**: Added endpoint and protocol coverage for embeddable runtime behavior:
  - `POST /` JSON-RPC (`initialize`, `tools/list`, `tools/call`)
  - `GET /health`
  - `GET /report?path=...`
  - legacy `POST /tools/execute`
- **Operational guidance**: Documented direct-execution environment toggles used for parity controls:
  - `HTTP_FORGE_ENFORCE_MAX_REQUESTS`
  - `HTTP_FORGE_GENERATE_REPORTS`
- **README navigation**: Added a dedicated runtime API pointer section in the core README to improve discoverability of direct execution and MCP runtime usage.

## 0.3.1 - 2026-06-16

### Fixed

- **`TestSuiteService.createTempSuiteFromCollection()` — stable ID**: Temporary suites created from a collection now use a deterministic ID (`temp-<collectionId>`) instead of a randomly generated one. This ensures all runs of the same collection accumulate under one directory in `.http-forge-cache/results/` rather than creating a new top-level directory per run.

## 0.3.0 - 2026-06-16

### Added

- **`HtmlReportGenerator`**: New class that reads existing JSON result files from a test suite run and generates a self-contained HTML report (`report.html`) in the run directory. No external dependencies — pure HTML/CSS/JS with a dark theme.
  - Summary cards: total, passed, failed, duration
  - Per-request statistics table with P90/P99 percentiles
  - Request timeline with duration bars
  - Expandable failure details with request/response bodies and assertion results

- **`IResultStorageService.finalizeRun()` return type**: Changed from `Promise<void>` to `Promise<string | null>`. Returns the path to the generated HTML report, or `null` if generation failed (non-fatal). Callers (e.g. the suite-run handler) can forward the path to the UI or MCP response.

- **`McpConfig` and `McpCorsConfig` interfaces** (`config.interface.ts`): Project-level MCP server configuration stored in `http-forge.config.json`. Fields:
  - `excludedCollections` — collection IDs/names to hide from MCP tools (opt-out, default empty = expose all)
  - `excludedSuites` — suite IDs/names to hide from MCP tools
  - `toolPrefix` — prefix string for all tool names
  - `maxRequestsPerCall` — safety cap on requests per collection/suite MCP call (default `50`)
  - `cors.allowedOrigins` — origins the MCP server accepts (default `["http://localhost","http://127.0.0.1"]`)

- **`IConfigService.getMcpConfig()`**: New method on the config service interface. Returns the resolved `McpConfig`, always filled with defaults for missing fields.

- **`McpConfig` and `McpCorsConfig` exported** from `src/index.ts` and `src/infrastructure/config/index.ts`.

### Changed

- **Module loader — require resolution order**: `createRequireFunction()` now checks builtins (lodash, moment, crypto, uuid, etc.) before the `modules/` directory guard. Built-in modules are always reachable without a `modules/` directory present.

- **`DEFAULT_CONFIG`**: Added `mcp` section with all fields populated to their defaults.

## 0.2.18 - 2026-06-03

### Fixed

- **Script execution — legacy Postman API support**: Added backward-compatible `postman.*` global namespace to the VM sandbox alongside `pm.*`. Old scripts using `postman.setGlobalVariable()`, `postman.setEnvironmentVariable()`, etc. now work unchanged. Both APIs are now fully supported.
- **Script execution — legacy Postman global variables**: Response scripts can now use the legacy Postman API:
  - `responseBody` (string) — raw response body text, auto-injected before script execution
  - `tests[]` (object) — assign boolean values to create assertions, e.g. `tests["my check"] = true`. Values are automatically converted to test assertions.
- **Module loader — lodash shim expansion**: Extended lodash shim from basic functions to 25+ utility functions, providing near-complete lodash compatibility:
  - Object: `keys`, `values`, `entries`, `assign`, `merge`, `omit`, `pick`
  - Collection: `each`, `forEach`, `map`, `filter`, `find`, `reduce`, `includes`
  - Type checks: `isObject`, `isArray`, `isString`, `isNumber`, `isFunction`, `isNil`, `isEmpty`
  - These functions now work even when lodash is not installed via `modules/package.json`
- **Module loader — error handling**: Built-in modules (uuid, crypto, path, lodash, moment, etc.) are now always available without requiring a `modules/` directory. The error "no valid modules/ directory found" now only appears when attempting to load relative paths or workspace modules. This allows scripts to use `require('crypto')`, `require('uuid')`, etc. without additional setup.

- **OpenAPI export — host-variable URL stripping**: Request URLs that begin with an arbitrary `{{varName}}` host variable (e.g. `{{dcqHost}}/DCQ/templates/GetEpg`) are now handled correctly. Previously, only `{{baseUrl}}`-style names were stripped; any other variable fell through to the general `{{var}} → {var}` path-parameter conversion and became a spurious path segment (`/{dcqHost}/...`). The exporter now strips any leading `{{varName}}` from the URL, attempts to resolve it via `envConfigService.resolveVariables()` across the selected environments, and adds a concrete server entry for each resolved URL. When the variable cannot be resolved, an OAS server-variable entry is emitted: `url: '{varName}', variables: { varName: { default: '' } }`.
- **OpenAPI export — environment variable placeholders in examples**: `{{varName}}` tokens in path, query, and header parameter examples as well as request body examples were passed raw into the exported spec. They are now replaced with `<varName>` — a readable human placeholder — so the spec does not contain unexpanded template syntax or leaked configuration values.

## 0.2.17 - 2026-06-01

### Fixed

- **Postman import — all body modes now imported correctly**: Previously only `mode: "raw"` was handled; `urlencoded`, `formdata`, `graphql`, and `binary` bodies were silently discarded. All five Postman body modes are now mapped to their HTTP Forge equivalents:
  - `raw` → `{ type: "raw", format, content }` — `format` is inferred from `options.raw.language` (json/xml/html/javascript/text)
  - `urlencoded` → `{ type: "x-www-form-urlencoded", content: [{key, value, enabled}] }`
  - `formdata` → `{ type: "form-data", content: [{key, value, type, enabled}] }`
  - `graphql` → `{ type: "graphql", content: { query, variables } }` — `variables` JSON string is parsed to an object
  - `binary` → `{ type: "binary", content: "" }`

- **Postman export — `x-www-form-urlencoded` and `form-data` bodies exported correctly**: `mapBody()` previously checked for the legacy internal type names (`urlencoded`, `formdata` with a `fields` array). It now also handles the canonical types (`x-www-form-urlencoded` with a `content` array, `form-data` with a `content` array) that the importer produces, so a round-trip import → export preserves body type and fields. Also fixed `graphql` export (content is stored under `body.content.query`/`body.content.variables`, not `body.query`) and added missing `binary` export support.

- **Collection item order not preserved after import**: When saving a collection with `saveItemsToDir`, the insertion order of items was tracked internally but never written to disk. On reload, `readdirSync` returned items in filesystem (alphabetical) order instead. `saveItemsToDir` now returns the ordered slug array, which is persisted into the `order` field of `collection.json` and `folder.json` for both top-level items and nested folder children.

## 0.2.15 - 2026-05-28

### Added

- **`duplicateCollection(sourceId, newName)`**: New method on `CollectionService` (and `ICollectionWriter` interface) that duplicates a collection including all nested folders, requests, scripts, and schemas.
- **`duplicateFolder(collectionId, folderId, newName)`**: New method on `CollectionService` (and `IFolderManager` interface) that duplicates a folder within a collection, preserving all nested request content.
- **`getItemPath(collectionId, itemId)`**: New method on `ICollectionStore` interface for resolving the disk path of a folder or request.

### Changed

- **Dead code removal**: Removed unused interfaces, DTOs, domain services, ports, and utility files (74 files, ~5000 lines). No public API changes — only internal code that was never imported or referenced.

## 0.2.14 - 2026-05-22

### Added

- **`description` field on `SuiteRequest` interface**: Optional per-request description for documenting what each request does within a test suite. Round-trips through JSON persistence automatically.

## 0.2.13 - 2026-05-20

### Added

- **Property/index access in variable interpolation**: The template engine now supports `{{arr[0]}}`, `{{obj.key}}`, and chained access like `{{arr[0].name}}` or `{{obj["key"]}}`. Typed variables are deserialized before property access, matching filter behavior.

### Fixed

- **Script `replaceIn` breaks on filter pipes with typed variables**: `resolveScriptFilterInput` did not deserialize the `\x1E` type marker, causing filters like `first` to receive a raw serialized string instead of an array. The raw string (containing unescaped quotes) was then interpolated into the script source, producing invalid JavaScript. Added `deserializeValueStatic()` to handle deserialization consistently in the script execution context.
- **Expression evaluation in scripts uses raw type-marked values**: Step 4 (JS expression eval) of the script `replaceIn` pipeline now deserializes all variables before passing them to the sandbox, fixing `{{arr[1]}}` inside scripts.

## 0.2.12 - 2026-05-20

### Changed

- **Type-marker serialization for non-string values**: Replaced the naive `JSON.parse()` fallback with a deterministic type marker (`\x1E` Record Separator prefix). `set(key, value)` stores non-string values as `\x1E` + JSON, and `get(key)` only deserializes values that carry the marker. This eliminates false positives where plain strings like `"true"`, `"123"`, or `"[text]"` were incorrectly parsed as non-string types.
- **Template filter integration**: The variable interpolator now recognizes the type marker when resolving filter input. Typed variables (arrays, objects, numbers, booleans) pass their native value into filter chains (e.g. `{{arr | first}}`, `{{obj | prop("key")}}`), while plain string variables continue to display as-is.

## 0.2.11 - 2026-05-20

### Added

- **`duplicateSuite(sourceId, newName)`**: New method on `TestSuiteService` (and `ITestSuiteService` interface) that duplicates a suite including its request folders. Recursively copies all `<suiteDir>/<slug>/` directories so customized requests are preserved in the copy.

### Changed

- **Auto-serialization for non-string variable values**: `pm.environment.set()`, `pm.globals.set()`, `pm.collectionVariables.set()`, and `pm.variables.set()` now automatically JSON-stringify non-string values (arrays, objects, numbers, booleans). Corresponding `get()` methods attempt `JSON.parse()` and fall back to the raw string. This matches modern Postman behavior and eliminates the need for manual `JSON.stringify`/`JSON.parse` wrappers.

## 0.2.10 - 2026-05-01

### Added

- **Suite Request Customization (TestSuiteStore)**:
  - `updateSuiteRequest(slug, request)` — Save an edited request to the suite folder (`<suiteDir>/<slug>/request.json` + scripts)
  - `resyncFromCollection(slug)` — Replace the suite request with the latest version from the collection
  - `getRequestBySlug(slug)` — Resolve a suite request by slug (suite folder first, collection fallback)
  - `getResolvedRequests()` — Returns resolved requests with `hasEmbeddedRequest` flag and lazy slug generation for legacy suites
  - `hasEmbeddedRequest(slug)` — Check if a customized request exists in the suite folder
  - `resolveUniqueSlug(baseSlug)` — Generate collision-free slugs for new requests
  - Private `loadSuiteRequest(slug)` / `saveSuiteRequest(slug, request)` — Folder-based I/O with separate script files
  - `SuiteRequest.slug` field added to interfaces

- **Result Storage Service (History)**:
  - `listRuns(suiteId)` — List all historical runs for a suite with their manifests
  - `getManifest(suiteId, runId)` — Load a specific run's manifest
  - `getIndexPage(suiteId, runId, page)` — Load paginated result summaries
  - `deleteRun(suiteId, runId)` — Remove a run's data from disk
  - `cleanupOldRuns()` — Retention-based cleanup of old results

- **Statistics Service**:
  - `getSerializableStatistics()` — Returns `{ summary, byRequest, overall, errors }` for webview consumption
  - Per-request percentile fields (`p50`, `p90`, `p95`, `p99`) in `RequestStatistics` interface

### Changed

- **TestSuiteStore.resolveRequest()** — Now checks the suite folder first (via `loadSuiteRequest(slug)`) before falling back to the collection. Scripts are always resolved live from the collection regardless of whether the request is embedded.

## 0.1.0 - 2026-04-01

### Added

- Initial release of `@http-forge/core`
- Postman-compatible collection loader (`.postman_collection.json` and `.forge.json`)
- Request execution pipeline with pre-request/post-response scripting
- Full `pm.*` scripting API (variables, assertions, cookies, execution flow, visualizer)
- Dynamic variable resolution (`{{$randomInt}}`, `{{$timestamp}}`, `{{$uuid}}`, etc.)
- Environment/variable scoping (globals, collection, environment, iteration data)
- Cookie persistence with `pm.cookies.jar()` support
- CryptoJS integration for hashing, HMAC, and encryption in scripts
- Test suite runner with `pm.setNextRequest()` flow control
- Result storage service with paginated index and run manifests
- Statistics service with per-request percentile tracking
- Template engine with Handlebars-style filters
- File watching for collections and environments
- Sensitive data redaction in stored results
