/**
 * Shared MCP tool input schemas.
 *
 * Both MCP server implementations (the embeddable core runtime and the VS Code
 * extension) expose the same tools, so they must advertise identical input
 * schemas. Keeping these in one place prevents the two sides from drifting
 * (e.g. the extension previously omitted `iterations`/`delay`/`include` for
 * collection and folder runs even though its executor supported them).
 */

export const REQUEST_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    environment: {
      type: 'string',
      description: 'Environment name to use (defaults to the currently selected environment)'
    },
    variables: {
      type: 'object',
      description: 'Extra variables to inject — merged with environment variables, {{name}} syntax',
      additionalProperties: { type: 'string' }
    },
    headers: {
      type: 'object',
      description: 'Override or add request headers',
      additionalProperties: { type: 'string' }
    },
    query: {
      type: 'object',
      description: 'Override query parameters',
      additionalProperties: { type: 'string' }
    },
    body: {
      type: 'string',
      description: 'Replace the request body (JSON string). Omit to use the saved body.'
    },
    include: {
      type: 'array',
      items: { type: 'string', enum: ['headers', 'cookies', 'tests', 'consoleOutput', 'report', 'fullBody'] },
      description: 'Extra fields to include in the response (default: status, ok, body, allPassed). Use fullBody to disable the 4KB body truncation.'
    }
  }
} as const;

export const COLLECTION_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    environment: { type: 'string', description: 'Environment name to use' },
    variables: {
      type: 'object',
      description: 'Extra variables injected into every request',
      additionalProperties: { type: 'string' }
    },
    iterations: { type: 'number', description: 'Number of iterations (default: 1)' },
    concurrency: { type: 'number', description: 'Number of parallel virtual users (1–50, default: 1). Each VU runs the full request sequence independently, preserving inter-request dependencies.' },
    stopOnError: { type: 'boolean', description: 'Stop on first failure' },
    delay: { type: 'number', description: 'Delay between requests in ms' },
    include: {
      type: 'array',
      items: { type: 'string', enum: ['perRequest', 'failedOnly', 'consoleOutput', 'report'] },
      description: 'Result detail level'
    },
    async: {
      type: 'boolean',
      description: 'When true, start the run in the background and return a runId immediately. Use get_run_status / get_failed_requests to poll results. Recommended for folders with many requests.'
    }
  }
} as const;

export const FOLDER_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    environment: { type: 'string', description: 'Environment name to use' },
    variables: {
      type: 'object',
      description: 'Extra variables injected into every request',
      additionalProperties: { type: 'string' }
    },
    iterations: { type: 'number', description: 'Number of iterations (default: 1)' },
    concurrency: { type: 'number', description: 'Number of parallel virtual users (1–50, default: 1). Each VU runs the full request sequence independently.' },
    stopOnError: { type: 'boolean', description: 'Stop on first failure' },
    delay: { type: 'number', description: 'Delay between requests in ms' },
    recursive: { type: 'boolean', description: 'Include requests in nested subfolders (default: true)' },
    include: {
      type: 'array',
      items: { type: 'string', enum: ['perRequest', 'failedOnly', 'consoleOutput', 'report'] },
      description: 'Result detail level'
    },
    async: {
      type: 'boolean',
      description: 'When true, start the run in the background and return a runId immediately. Use get_run_status / get_failed_requests to poll results. Recommended for folders with many requests.'
    }
  }
} as const;

export const SUITE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    environment: { type: 'string', description: 'Environment name to use' },
    iterations: { type: 'number', description: 'Number of iterations (overrides suite default)' },
    concurrency: { type: 'number', description: 'Number of parallel virtual users (1–50, default: 1). Each VU runs the full request sequence independently.' },
    stopOnError: { type: 'boolean', description: 'Stop on first failure' },
    delay: { type: 'number', description: 'Delay between requests in ms' },
    variables: {
      type: 'object',
      description: 'Extra variables injected into every request',
      additionalProperties: { type: 'string' }
    },
    async: {
      type: 'boolean',
      description: 'When true, start the run in the background and return a runId immediately. Use get_run_status / get_failed_requests to poll results.'
    },
    requestFilter: {
      type: 'array',
      items: { type: 'string' },
      description: 'Run only requests whose names match one of these strings (case-insensitive)'
    },
    include: {
      type: 'array',
      items: { type: 'string', enum: ['perRequest', 'failedOnly', 'consoleOutput', 'report'] },
      description: 'Result detail level (default: summary + failedRequests)'
    }
  }
} as const;

// ── Drill-down (generic) tools ───────────────────────────────────────────────
// A small, fixed set of tools whose ARGUMENTS select the target, used when the
// per-request tool list would be too large. The collection/suite are advertised
// as JSON-schema `enum`s so AI agents pick real values instead of guessing.

/** Stable names of the generic drill-down tools (prefix is added separately). */
export const GENERIC_TOOL_NAMES = {
  listCollections: 'list_collections',
  listFolders: 'list_folders',
  listRequests: 'list_requests',
  searchRequests: 'search_requests',
  getEnvironment: 'get_environment',
  runRequest: 'run_request',
  runFolder: 'run_folder',
  runCollection: 'run_collection',
  runSuite: 'run_suite',
  // Tier 3 — async run polling
  getRunStatus: 'get_run_status',
  getRunSummary: 'get_run_summary',
  getFailedRequests: 'get_failed_requests',
  getRequestResult: 'get_request_result',
  cancelRun: 'cancel_run',
  // Tier 4 — variable inspection
  setVariable: 'set_variable',
  // ── Collection management ──────────────────────────────────────────────
  createCollection: 'create_collection',
  renameCollection: 'rename_collection',
  deleteCollection: 'delete_collection',
  duplicateCollection: 'duplicate_collection',
  createFolder: 'create_folder',
  deleteFolder: 'delete_folder',
  // ── Request management ─────────────────────────────────────────────────
  getRequest: 'get_request',
  createRequest: 'create_request',
  updateRequest: 'update_request',
  deleteRequest: 'delete_request',
  // ── API discovery ──────────────────────────────────────────────────────
  createRequestFromEndpoint: 'create_request_from_endpoint',
  generateTestSuite: 'generate_test_suite',
  suggestWorkflow: 'suggest_workflow',
  generateWorkflow: 'generate_workflow',
  checkDrift: 'check_drift',
  proposeUpdate: 'propose_update',
  qaApi: 'qa_api',
  reviewSuite: 'review_suite',
  // ── Script management ──────────────────────────────────────────────────
  getRequestScript: 'get_request_script',
  setRequestScript: 'set_request_script',
  // ── Ordering ───────────────────────────────────────────────────────────
  reorderCollectionItems: 'reorder_collection_items',
  // ── Suite management ───────────────────────────────────────────────────
  listSuites: 'list_suites',
  getSuite: 'get_suite',
  createSuite: 'create_suite',
  updateSuiteConfig: 'update_suite_config',
  getSuiteNode: 'get_suite_node',
  listSuiteNodePaths: 'list_suite_node_paths',
  addSuiteNode: 'add_suite_node',
  updateSuiteNode: 'update_suite_node',
  removeSuiteNode: 'remove_suite_node',
  moveSuiteNode: 'move_suite_node',
  addSuiteRequests: 'add_suite_requests',
  removeSuiteRequest: 'remove_suite_request',
  reorderSuiteRequests: 'reorder_suite_requests',
  duplicateSuite: 'duplicate_suite',
  deleteSuite: 'delete_suite',
  // ── Environment management ─────────────────────────────────────────────
  listEnvironments: 'list_environments',
  getEnvironmentVariables: 'get_environment_variables',
  selectEnvironment: 'select_environment',
  createEnvironment: 'create_environment',
  deleteEnvironment: 'delete_environment',
  setEnvironmentVariable: 'set_environment_variable',
  unsetEnvironmentVariable: 'unset_environment_variable',
  setGlobalVariable: 'set_global_variable',
  getGlobals: 'get_globals',
  // ── AI-native tools ────────────────────────────────────────────────────
  scaffoldCollectionFromOpenApi: 'scaffold_collection_from_openapi',
  suggestAssertions: 'suggest_assertions',
  explainFailure: 'explain_failure',  // ── Env-var extraction ─────────────────────────────────────────────────────
  suggestEnvVars: 'suggest_env_vars',
  applyEnvVars: 'apply_env_vars',
  // ── Collection enhancement ─────────────────────────────────────────────────
  getRequestsForEnhancement: 'get_requests_for_enhancement',
  applyRequestEnhancements: 'apply_request_enhancements',
  aiSuggestEnvVars: 'ai_suggest_env_vars',
  aiEnhanceCollection: 'ai_enhance_collection',
  // ── Gap-closure tools ──────────────────────────────────────────────────────
  analyzeCoverage: 'analyze_coverage',
  aiAnalyzeCoverage: 'ai_analyze_coverage',
  generateRequestFromIntent: 'generate_request_from_intent',
  designApiFromIntent: 'design_api_from_intent',
  validateAgainstSpec: 'validate_against_spec',
  generateScenarios: 'generate_scenarios',
  healAssertions: 'heal_assertions',
  generateIterationData: 'generate_iteration_data',
} as const;

export type GenericToolName = (typeof GENERIC_TOOL_NAMES)[keyof typeof GENERIC_TOOL_NAMES];

/** MCP 2025-11 tool annotations — surface hints to AI clients about safety and idempotency. */
interface ToolAnnotations {
  /** true = no side-effects (safe to call freely) */
  readOnlyHint?: boolean;
  /** true = irreversible side-effect (client should confirm before calling) */
  destructiveHint?: boolean;
  /** true = safe to retry without unintended side-effects */
  idempotentHint?: boolean;
  /** true = may interact with external systems; false = workspace-local only */
  openWorldHint?: boolean;
}

interface GenericToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

/** Optional `enum` constraint — omitted when there are no values to avoid an empty enum. */
function enumProp(description: string, values: readonly string[]): Record<string, unknown> {
  const base: Record<string, unknown> = { type: 'string', description };
  if (values.length > 0) base.enum = [...values];
  return base;
}

/**
 * Build the generic drill-down tool definitions. `collectionLabels` and
 * `suiteLabels` are the human-readable names injected as enums so the model can
 * only choose targets that exist.
 */
export function buildGenericTools(
  prefix: string,
  collectionLabels: readonly string[],
  suiteLabels: readonly string[]
): GenericToolDef[] {
  const collectionEnum = (req: boolean) => enumProp(
    'Name of the collection to act on.' + (req ? '' : ' Optional.'),
    collectionLabels
  );

  return [
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.listCollections}`,
      description:
        'List all available HTTP Forge collections (name, description, and request count). ' +
        'Call this first to discover what collections exist, then use list_folders, list_requests or run_* tools.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.listFolders}`,
      description:
        'List all folders in a collection with their full paths and request counts. ' +
        'Use this before run_folder to discover the exact folder path string to pass.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
        },
        required: ['collection'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.listRequests}`,
      description:
        'List the saved requests in a collection (name, HTTP method, folder, and description). ' +
        'Use this to find the exact request name before calling run_request. ' +
        'For large collections use the folder filter and offset/limit to page through results.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          folder: { type: 'string', description: 'Optional folder path to filter by (e.g. "Auth").' },
          offset: { type: 'number', description: 'Zero-based index to start from (default: 0).' },
          limit: { type: 'number', description: 'Maximum number of results to return (default: 50, max: 200).' },
        },
        required: ['collection'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.searchRequests}`,
      description:
        'Search for requests across a collection by name, URL, method, or folder path. ' +
        'Returns matching requests with their folder location. Useful for large collections.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          query: { type: 'string', description: 'Text to search for in request names, URLs, methods, and folder paths (case-insensitive).' },
        },
        required: ['collection', 'query'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.getRequest}`,
      description:
        'Get the full details of a single saved request: URL, method, headers, body, auth, and scripts. ' +
        'Use this to inspect a request before editing it, or to read a script before rewriting it.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          request: { type: 'string', description: 'Request name or id. Use list_requests to find names.' },
        },
        required: ['collection', 'request'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.getEnvironment}`,
      description:
        'Show the current environment variable values (merged initial + runtime pm.environment.set overrides). ' +
        'Use this to inspect variable state before running a folder, or to debug {{variable}} resolution failures.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name to inspect (defaults to the currently selected environment).' },
        },
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.setVariable}`,
      description:
        'Override an environment variable for the current session. ' +
        'In the VS Code extension the change is saved to VS Code workspace storage (survives restarts, but is not in the env JSON file and not source-controlled). ' +
        'In the standalone CLI/core runtime the change is in-memory only and lost when the server restarts. ' +
        'Use set_environment_variable with scope:"permanent" to write to the env JSON file (source-controlled, works in both runtimes).',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name (the part inside {{...}}).' },
          value: { type: 'string', description: 'New value to set.' },
          environment: { type: 'string', description: 'Environment to update (defaults to the currently selected environment).' },
        },
        required: ['key', 'value'],
      },
      annotations: { idempotentHint: true },
    },
    // ── Tier 3: async run polling ────────────────────────────────────────────
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.getRunStatus}`,
      description:
        'Check whether an async run is still running, completed, or failed. ' +
        'Poll this after calling run_folder/run_collection/run_suite with async:true.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Run ID returned by an async run_* call.' },
        },
        required: ['runId'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.getRunSummary}`,
      description:
        'Get the pass/fail summary of a completed async run (total, passed, failed counts). ' +
        'Use after get_run_status shows "completed". ' +
        'When failures are present the response includes a failedRequests array with full details ' +
        '(method, url, requestBody, status, responseBody, failedTests) and a _nextStep directive. ' +
        'You MUST follow the _nextStep directive immediately — analyze the failures and provide ' +
        'diagnosis without waiting for the user to ask.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Run ID returned by an async run_* call.' },
        },
        required: ['runId'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.getFailedRequests}`,
      description:
        'Get the list of failed requests from a completed async run — the failures-first view. ' +
        'Never returns passing requests. Use this instead of get_run_summary when you need to see what broke.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Run ID returned by an async run_* call.' },
          offset: { type: 'number', description: 'Zero-based index to start from (default: 0).' },
          limit: { type: 'number', description: 'Maximum failures to return (default: 20, max: 100).' },
        },
        required: ['runId'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.getRequestResult}`,
      description:
        'Get the full result (status, body, assertions, console output) for one specific request from an async run. ' +
        'Use after get_failed_requests to drill into a single failure.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Run ID returned by an async run_* call.' },
          request: { type: 'string', description: 'Name of the request to look up.' },
          iteration: { type: 'number', description: 'Iteration number (default: 1).' },
        },
        required: ['runId', 'request'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.cancelRun}`,
      description:
        'Request cancellation of an in-progress async run. ' +
        'Cancellation is best-effort: the currently-executing HTTP request completes normally, ' +
        'but no further requests in the run are started. ' +
        'The run status changes to "cancelled". ' +
        'Has no effect on runs that are already completed, failed, or cancelled.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Run ID returned by run_collection, run_folder, or run_suite with async:true.' },
        },
        required: ['runId'],
      },
      annotations: { idempotentHint: true },
    },
    // ── Tier 2: execution ──────────────────────────────────────────────────
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.runRequest}`,
      description: 'Run a single saved request. Pick the collection, then the request name within it.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          request: {
            type: 'string',
            description: 'Name of the request to run. Use list_requests or search_requests to find names.',
          },
          requestId: {
            type: 'string',
            description: 'ID of the request (from list_requests/search_requests). Preferred over "request" name when available — avoids ambiguity with duplicate names.',
          },
          ...REQUEST_INPUT_SCHEMA.properties,
        },
        required: ['collection', 'request'],
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.runFolder}`,
      description: 'Run every request inside a folder of a collection.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          folder: { type: 'string', description: 'Folder path within the collection (e.g. "Auth/Login").' },
          ...FOLDER_INPUT_SCHEMA.properties,
        },
        required: ['collection', 'folder'],
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.runCollection}`,
      description: 'Run every request in a collection.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          ...COLLECTION_INPUT_SCHEMA.properties,
        },
        required: ['collection'],
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.runSuite}`,
      description: 'Run a saved test suite.',
      inputSchema: {
        type: 'object',
        properties: {
          suite: enumProp('Name of the test suite to run.', suiteLabels),
          ...SUITE_INPUT_SCHEMA.properties,
        },
        required: ['suite'],
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    // ── Collection management ────────────────────────────────────────────
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.createCollection}`,
      description: 'Create a new empty collection.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name for the new collection.' },
        },
        required: ['name'],
      },
      annotations: { idempotentHint: false },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.renameCollection}`,
      description: 'Rename an existing collection.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          newName: { type: 'string', description: 'New display name for the collection.' },
        },
        required: ['collection', 'newName'],
      },
      annotations: { idempotentHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.deleteCollection}`,
      description: 'Permanently delete a collection and all its contents. Set confirm:true to proceed.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          confirm: { type: 'boolean', description: 'Must be true to confirm deletion.' },
        },
        required: ['collection', 'confirm'],
      },
      annotations: { destructiveHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.duplicateCollection}`,
      description: 'Clone a collection under a new name (all folders, requests, and scripts are copied).',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          newName: { type: 'string', description: 'Name for the duplicated collection.' },
        },
        required: ['collection', 'newName'],
      },
      annotations: { idempotentHint: false },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.createFolder}`,
      description: 'Create a folder inside a collection (optionally nested inside another folder).',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          name: { type: 'string', description: 'Display name for the new folder.' },
          parentFolder: { type: 'string', description: 'Slash-separated folder path or folder id of the parent. Omit to create at collection root.' },
        },
        required: ['collection', 'name'],
      },
      annotations: { idempotentHint: false },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.deleteFolder}`,
      description: 'Delete a folder and all its requests. Set confirm:true to proceed.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          folder: { type: 'string', description: 'Slash-separated folder path or folder id to delete.' },
          confirm: { type: 'boolean', description: 'Must be true to confirm deletion.' },
        },
        required: ['collection', 'folder', 'confirm'],
      },
      annotations: { destructiveHint: true },
    },
    // ── Request management ───────────────────────────────────────────────
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.createRequest}`,
      description: 'Create a new HTTP request inside a collection (optionally inside a folder).',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          folder: { type: 'string', description: 'Folder path or id. Omit to add at collection root.' },
          name: { type: 'string', description: 'Display name for the request.' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'], description: 'HTTP method.' },
          url: { type: 'string', description: 'Request URL, may include {{variable}} placeholders.' },
          headers: { type: 'object', description: 'Key/value header map.', additionalProperties: { type: 'string' } },
          body: { type: 'string', description: 'Raw request body (JSON, text, etc.).' },
          description: { type: 'string', description: 'Human-readable description.' },
        },
        required: ['collection', 'name', 'method', 'url'],
      },
      annotations: { idempotentHint: false },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.createRequestFromEndpoint}`,
      description:
        'Scan a backend project from source code (no OpenAPI involved) and create a working HTTP Forge ' +
        'request from one discovered endpoint. Returns the created request with a provenance label ' +
        '(framework, source file:line, confidence).',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Project root to scan (default: workspace folder).' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'], description: 'HTTP method of the endpoint to select.' },
          path: { type: 'string', description: 'Path expression of the endpoint to select (e.g. /api/users/{id}).' },
          endpointId: { type: 'string', description: 'Discovery endpoint id (from a prior scan) — preferred over method+path when available.' },
          collection: collectionEnum(true),
          name: { type: 'string', description: 'Display name for the created request (default: derived from the endpoint).' },
          baseUrl: { type: 'string', description: 'Optional base URL to prefix the discovered path with (e.g. https://api.example.com).' },
          sampleData: { type: 'boolean', description: 'Pre-fill the request body with a sample JSON derived from the discovered schema (default: false).' },
        },
        required: ['collection'],
      },
      annotations: { idempotentHint: false },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.generateTestSuite}`,
      description:
        'Scan a backend project from source code and generate a runnable test suite (`.suite.json`) ' +
        'with one request node per discovered endpoint, each asserting the discovered status code. ' +
        'Requests are created in the target collection first. Generated suites are tagged ' +
        'ai_generated:true and derived_from:<endpointId> for drift detection.',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Project root to scan (default: workspace folder).' },
          collection: collectionEnum(true),
          name: { type: 'string', description: 'Suite name (default: "Generated from discovery").' },
          baseUrl: { type: 'string', description: 'Optional base URL to prefix discovered paths (e.g. https://api.example.com).' },
          assertBodySchema: { type: 'boolean', description: 'Also assert JSON array response bodies (default: false).' },
          dryRun: { type: 'boolean', description: 'Return the generated suite without saving or creating requests (default: false).' },
        },
        required: ['collection'],
      },
      annotations: { idempotentHint: false },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.suggestWorkflow}`,
      description:
        'Analyze discovered endpoints from a backend project (no OpenAPI involved) and suggest cross-request ' +
        'workflow chains (auth: token-producer → protected endpoints; CRUD: create → id-scoped operations). ' +
        'Returns the chains without creating anything — call generate_workflow to persist them as a suite.',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Project root to scan (default: workspace folder).' },
        },
        required: [],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.generateWorkflow}`,
      description:
        'Create requests for every endpoint of a project in the target collection, then generate a test suite ' +
        'whose flow-graph encodes the discovered workflow chains (auth + CRUD) using request/if/script nodes. ' +
        'Generated suites are tagged ai_generated:true and derived_from:<endpointId>.',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Project root to scan (default: workspace folder).' },
          collection: collectionEnum(true),
          name: { type: 'string', description: 'Suite name (default: "Generated workflow suite").' },
          baseUrl: { type: 'string', description: 'Optional base URL to prefix discovered paths (e.g. https://api.example.com).' },
          dryRun: { type: 'boolean', description: 'Return the generated suite without saving or creating requests (default: false).' },
        },
        required: ['collection'],
      },
      annotations: { idempotentHint: false },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.checkDrift}`,
      description:
        'Check whether a backend project has drifted since its discovery index was built. ' +
        'In git work trees, compares the git HEAD hash; otherwise degrades to source-file mtime vs ' +
        'scannedAt. Returns per-project status (current/stale/unknown) — a stale project should be ' +
        're-scanned (create_request_from_endpoint / generate_test_suite) and regenerated artifacts ' +
        '3-way diffed against user edits.',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Project root to check (default: workspace folder).' },
        },
        required: [],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.proposeUpdate}`,
      description:
        'Phase 2b loop: given a set of stale endpoint ids (from check_drift) and the generated suites ' +
        'that reference them via derived_from, propose a regeneration for each affected suite. Returns a ' +
        '3-way diff (base vs current vs regenerated) and flags conflicts when user edits overlap ' +
        'regeneration (those require developer approval — never auto-resolved). Set apply:true to compute ' +
        'the merged content for non-conflicting proposals (the Developer approves step).',
      inputSchema: {
        type: 'object',
        properties: {
          staleEndpointIds: { type: 'array', items: { type: 'string' }, description: 'Endpoint ids that drifted (e.g. from check_drift).' },
          suites: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                currentContent: { type: 'string', description: 'Current suite content on disk (may include user edits).' },
                derivedFrom: { type: 'array', items: { type: 'string' } },
              },
              required: ['id', 'currentContent', 'derivedFrom'],
            },
          },
          baseContent: { type: 'object', description: 'Map of suiteId → last-generated content.' },
          regeneratedContent: { type: 'object', description: 'Map of suiteId → freshly regenerated content.' },
          apply: { type: 'boolean', description: 'Compute merged content for non-conflicting proposals (default: false).' },
        },
        required: ['staleEndpointIds', 'suites', 'baseContent', 'regeneratedContent'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.qaApi}`,
      description:
        'One-shot API quality gate: discover endpoints from backend source code, generate (or reuse) ' +
        'requests in the target collection, run the deterministic QA suite against a live server, and ' +
        'report per-endpoint results. Requests are matched by method + path and reused across runs — ' +
        'reruns create nothing new unless the source changed. Returns a report with status ' +
        '(pass/fail/drift/dry-run), counts, per-endpoint expected-vs-actual statuses, drift info, and ' +
        'low-confidence discoveries. Set dryRun:true to preview the plan without writing or running.',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Project root to scan (default: workspace folder).' },
          collection: collectionEnum(true),
          environment: { type: 'string', description: 'Environment for variable resolution (default: selected).' },
          baseUrl: { type: 'string', description: 'Running server to execute against (required unless dryRun is true).' },
          variables: { type: 'object', description: 'Extra variables injected into every request (e.g. auth tokens).' },
          framework: { type: 'string', description: 'Restrict discovery (express, nestjs, fastify, lambda, spring, fastapi).' },
          dryRun: { type: 'boolean', description: 'Preview the plan without creating requests or running (default: false).' },
          aiAssertions: { type: 'boolean', description: 'Propose LLM-written assertions after the run; advisory only (default: false).' },
          failOnDrift: { type: 'boolean', description: 'Return drift status instead of proceeding when the project moved (default: false).' },
          storedGitHash: { type: 'string', description: 'Git HEAD from a prior scan (enables git-based drift).' },
          storedScannedAt: { type: 'string', description: 'Scan time from a prior scan (enables mtime-based drift).' },
        },
        required: ['collection'],
      },
      annotations: { idempotentHint: true, openWorldHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.reviewSuite}`,
      description:
        'Phase 3 review gate: run deterministic review rules over a completed suite run ' +
        '(suite + run-results) and return a structured ReviewReport with findings at ' +
        'error/warn/info severity. Rules are pure and repeatable (response leaks, server ' +
        'errors, failed assertions, DELETE!=204, missing assertions, unhandled 401/403, slow ' +
        'responses). When an AI provider is configured, the report is enriched with prose ' +
        'recommendations — the rules never depend on the LLM. Use as a CI/PR gate: fail on ' +
        'summary.pass === false (errors present).',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Run id from run_suite / run_collection (must be completed).' },
          suiteId: { type: 'string', description: 'Optional suite id/label to carry suite context into the review.' },
          slowResponseMs: { type: 'number', description: 'Slow-response threshold in ms (default: 2000).' },
        },
        required: ['runId'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.updateRequest}`,
      description: 'Update fields on an existing request (partial update — omit fields to keep current values).',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          request: { type: 'string', description: 'Request name or id.' },
          name: { type: 'string', description: 'New display name.' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] },
          url: { type: 'string' },
          headers: { type: 'object', additionalProperties: { type: 'string' } },
          body: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['collection', 'request'],
      },
      annotations: { idempotentHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.deleteRequest}`,
      description: 'Remove a request from a collection. Set confirm:true to proceed.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          request: { type: 'string', description: 'Request name or id to delete.' },
          confirm: { type: 'boolean', description: 'Must be true to confirm deletion.' },
        },
        required: ['collection', 'request', 'confirm'],
      },
      annotations: { destructiveHint: true },
    },
    // ── Script management ────────────────────────────────────────────────
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.getRequestScript}`,
      description: 'Read the pre-request or post-response script of a request.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          request: { type: 'string', description: 'Request name or id.' },
          phase: { type: 'string', enum: ['pre-request', 'post-response'], description: 'Which script phase to read.' },
        },
        required: ['collection', 'request', 'phase'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.setRequestScript}`,
      description: 'Write or replace the pre-request or post-response script of a request.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          request: { type: 'string', description: 'Request name or id.' },
          phase: { type: 'string', enum: ['pre-request', 'post-response'], description: 'Which script phase to write.' },
          script: { type: 'string', description: 'Full JavaScript source to write.' },
        },
        required: ['collection', 'request', 'phase', 'script'],
      },
      annotations: { idempotentHint: true },
    },
    // ── Ordering ─────────────────────────────────────────────────────────
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.reorderCollectionItems}`,
      description: 'Set the execution/display order of direct children of a collection root or folder. Items not listed are appended at the end.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          folder: { type: 'string', description: 'Folder path or id. Omit to reorder collection root.' },
          order: { type: 'array', items: { type: 'string' }, description: 'Ordered list of item names or ids.' },
        },
        required: ['collection', 'order'],
      },
      annotations: { idempotentHint: true },
    },
    // ── Suite management ─────────────────────────────────────────────────
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.listSuites}`,
      description: 'List all test suites with name, id, request count, and configuration summary.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.getSuite}`,
      description: 'Get full details of a test suite including flow nodes (suite.nodes) and a flattened request list.',
      inputSchema: {
        type: 'object',
        properties: {
          suite: enumProp('Name or id of the test suite.', suiteLabels),
        },
        required: ['suite'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.createSuite}`,
      description: 'Create a new test suite (empty, pre-populated from a collection/folder, or initialized with an explicit flow nodes graph).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name for the new suite.' },
          description: { type: 'string', description: 'Optional description.' },
          fromCollection: { type: 'string', description: 'Collection name or id to seed the suite from (all requests in execution order).' },
          fromFolder: { type: 'string', description: 'Folder path within fromCollection to seed from.' },
          nodes: { type: 'array', items: { type: 'object' }, description: 'Optional full suite.nodes graph. If provided, this becomes the suite flow definition.' },
          iterations: { type: 'number', description: 'Number of iterations (default: 1).' },
          stopOnError: { type: 'boolean', description: 'Stop on first failure (default: false).' },
          delayBetweenRequests: { type: 'number', description: 'Milliseconds delay between requests (default: 0).' },
        },
        required: ['name'],
      },
      annotations: { idempotentHint: false },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.updateSuiteConfig}`,
      description: "Change a suite's name/description/run configuration and optionally replace the full suite.nodes flow graph.",
      inputSchema: {
        type: 'object',
        properties: {
          suite: enumProp('Name or id of the suite to update.', suiteLabels),
          name: { type: 'string', description: 'New display name.' },
          description: { type: 'string', description: 'New description.' },
          nodes: { type: 'array', items: { type: 'object' }, description: 'Optional full suite.nodes graph replacement.' },
          iterations: { type: 'number' },
          stopOnError: { type: 'boolean' },
          delayBetweenRequests: { type: 'number' },
        },
        required: ['suite'],
      },
      annotations: { idempotentHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.getSuiteNode}`,
      description: 'Get a single suite flow node by path (for example: "2.then.0" or "1.cases.0.nodes.1").',
      inputSchema: {
        type: 'object',
        properties: {
          suite: enumProp('Name or id of the suite.', suiteLabels),
          path: { type: 'string', description: 'Node path to read (dot notation).' },
        },
        required: ['suite', 'path'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.listSuiteNodePaths}`,
      description: 'List all node paths and editable branch-array paths for a suite flow graph. Use before add/update/remove/move_suite_node.',
      inputSchema: {
        type: 'object',
        properties: {
          suite: enumProp('Name or id of the suite.', suiteLabels),
          includeBranches: { type: 'boolean', description: 'Include branch-array paths (default: true).' },
        },
        required: ['suite'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.addSuiteNode}`,
      description: 'Add a flow node to a suite. Insert at root or into a branch array of a parent node.',
      inputSchema: {
        type: 'object',
        properties: {
          suite: enumProp('Name or id of the suite.', suiteLabels),
          node: { type: 'object', description: 'Node object to insert (request/script/if/switch/for/while/block).' },
          parentPath: { type: 'string', description: 'Optional parent node path (for example: "2" or "1.cases.0"). Omit to insert at root.' },
          branch: { type: 'string', description: 'Branch array on parent node (for example: "nodes", "then", "else", "default", "cases.0.nodes"). Required when parentPath is provided.' },
          index: { type: 'number', description: 'Optional insertion index inside target array. Omit to append.' },
        },
        required: ['suite', 'node'],
      },
      annotations: { idempotentHint: false },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.updateSuiteNode}`,
      description: 'Replace a flow node at a specific path in suite.nodes.',
      inputSchema: {
        type: 'object',
        properties: {
          suite: enumProp('Name or id of the suite.', suiteLabels),
          path: { type: 'string', description: 'Node path to replace (for example: "0" or "2.then.1").' },
          node: { type: 'object', description: 'Full replacement node object.' },
        },
        required: ['suite', 'path', 'node'],
      },
      annotations: { idempotentHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.removeSuiteNode}`,
      description: 'Remove a flow node at a specific path from suite.nodes.',
      inputSchema: {
        type: 'object',
        properties: {
          suite: enumProp('Name or id of the suite.', suiteLabels),
          path: { type: 'string', description: 'Node path to remove (for example: "0" or "2.else.0").' },
        },
        required: ['suite', 'path'],
      },
      annotations: { destructiveHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.moveSuiteNode}`,
      description: 'Move a flow node from one path to another parent/branch/index within suite.nodes.',
      inputSchema: {
        type: 'object',
        properties: {
          suite: enumProp('Name or id of the suite.', suiteLabels),
          fromPath: { type: 'string', description: 'Source node path (for example: "1.then.0").' },
          toParentPath: { type: 'string', description: 'Optional destination parent node path. Omit to move to root.' },
          toBranch: { type: 'string', description: 'Destination branch array on parent node. Required when toParentPath is provided.' },
          toIndex: { type: 'number', description: 'Optional destination index in target array. Omit to append.' },
        },
        required: ['suite', 'fromPath'],
      },
      annotations: { idempotentHint: false },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.addSuiteRequests}`,
      description: 'Legacy compatibility helper. Add one or more request nodes at the suite root, using the same insertion semantics as add_suite_node with type:"request".',
      inputSchema: {
        type: 'object',
        properties: {
          suite: enumProp('Name or id of the suite.', suiteLabels),
          requests: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                collection: { type: 'string', description: 'Collection name or id.' },
                request: { type: 'string', description: 'Request name or id.' },
              },
              required: ['collection', 'request'],
            },
            description: 'Requests to add.',
          },
          insertAt: { type: 'number', description: 'Zero-based root nodes-array index to insert at. Omit to append at end.' },
        },
        required: ['suite', 'requests'],
      },
      annotations: { idempotentHint: false },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.removeSuiteRequest}`,
      description: 'Remove a request from a request-only root suite by position (0-based) or by name. For flow suites, edit nodes via get_suite/update_suite_config.',
      inputSchema: {
        type: 'object',
        properties: {
          suite: enumProp('Name or id of the suite.', suiteLabels),
          index: { type: 'number', description: 'Zero-based position in the suite requests list.' },
          request: { type: 'string', description: 'Request name to remove (used if index is not provided).' },
        },
        required: ['suite'],
      },
      annotations: { destructiveHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.reorderSuiteRequests}`,
      description: 'Reorder requests in a request-only root suite. Requests not listed are moved to the end. For flow suites, edit nodes via get_suite/update_suite_config.',
      inputSchema: {
        type: 'object',
        properties: {
          suite: enumProp('Name or id of the suite.', suiteLabels),
          order: { type: 'array', items: { type: 'string' }, description: 'Ordered list of request names.' },
        },
        required: ['suite', 'order'],
      },
      annotations: { idempotentHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.duplicateSuite}`,
      description: 'Clone an existing suite under a new name.',
      inputSchema: {
        type: 'object',
        properties: {
          suite: enumProp('Name or id of the suite to clone.', suiteLabels),
          newName: { type: 'string', description: 'Name for the duplicated suite.' },
        },
        required: ['suite', 'newName'],
      },
      annotations: { idempotentHint: false },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.deleteSuite}`,
      description: 'Delete a test suite permanently. Set confirm:true to proceed.',
      inputSchema: {
        type: 'object',
        properties: {
          suite: enumProp('Name or id of the suite to delete.', suiteLabels),
          confirm: { type: 'boolean', description: 'Must be true to confirm deletion.' },
        },
        required: ['suite', 'confirm'],
      },
      annotations: { destructiveHint: true },
    },
    // ── Environment management ───────────────────────────────────────────
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.listEnvironments}`,
      description: 'List all environments with their variable keys (values hidden). Use get_environment_variables to see values.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.getEnvironmentVariables}`,
      description: 'Get the resolved (merged file + session overrides) variables for an environment.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name (defaults to active environment).' },
        },
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.selectEnvironment}`,
      description: 'Set the active environment for all subsequent run_* calls in this session.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Name of the environment to activate.' },
        },
        required: ['environment'],
      },
      annotations: { idempotentHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.createEnvironment}`,
      description: 'Create a new environment file, optionally pre-populated with variables.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Environment name (becomes the filename).' },
          variables: { type: 'object', description: 'Initial key/value variable map.', additionalProperties: { type: 'string' } },
        },
        required: ['name'],
      },
      annotations: { idempotentHint: false },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.deleteEnvironment}`,
      description: 'Delete an environment file permanently. Set confirm:true to proceed.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name to delete.' },
          confirm: { type: 'boolean', description: 'Must be true to confirm deletion.' },
        },
        required: ['environment', 'confirm'],
      },
      annotations: { destructiveHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.setEnvironmentVariable}`,
      description:
        'Set a variable in an environment. ' +
        'Scope "session" (default) is in-memory only and always temporary (both runtimes). ' +
        'Scope "permanent" writes to the env JSON config file — source-controlled and shared with the CLI runtime.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name (defaults to active environment).' },
          key: { type: 'string', description: 'Variable name.' },
          value: { type: 'string', description: 'New value.' },
          scope: { type: 'string', enum: ['session', 'permanent'], description: 'Storage scope. "permanent" writes to disk.' },
        },
        required: ['key', 'value'],
      },
      annotations: { idempotentHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.unsetEnvironmentVariable}`,
      description: 'Remove a session-scoped variable override, restoring the file value.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name (defaults to active environment).' },
          key: { type: 'string', description: 'Variable name to unset.' },
        },
        required: ['key'],
      },
      annotations: { idempotentHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.setGlobalVariable}`,
      description:
        'Set a global variable visible across all environments. ' +
        'Scope "session" (default) is in-memory only and lost on restart (both runtimes). ' +
        'Scope "permanent" writes to _global.json — source-controlled and shared with the CLI runtime.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Global variable name.' },
          value: { type: 'string', description: 'Value to set.' },
          scope: { type: 'string', enum: ['session', 'permanent'], description: 'Storage scope. "permanent" writes to _global.json.' },
        },
        required: ['key', 'value'],
      },
      annotations: { idempotentHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.getGlobals}`,
      description: 'Return all global variables (merged _global.json + runtime pm.globals.set() values).',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    },
    // ── AI-native tools ──────────────────────────────────────────────────────
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.scaffoldCollectionFromOpenApi}`,
      description:
        'Import an OpenAPI 3.0 spec (JSON or YAML) and scaffold a complete HTTP Forge collection from it. ' +
        'All operations become requests grouped by tag/path. An optional environment is created from the server URL. ' +
        'Returns the new collection id and name. Use this to quickly bootstrap API testing from a spec file.',
      inputSchema: {
        type: 'object',
        properties: {
          specPath: {
            type: 'string',
            description: 'Absolute or workspace-relative path to the OpenAPI 3.0 JSON or YAML file.',
          },
          collectionName: {
            type: 'string',
            description: 'Override the collection name (defaults to the spec title).',
          },
          environmentName: {
            type: 'string',
            description: 'Name for the generated environment that contains the server base URL. Omit to skip environment creation.',
          },
        },
        required: ['specPath'],
      },
      annotations: { idempotentHint: false },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.suggestAssertions}`,
      description:
        'Analyse the last execution history for a request and suggest pm.test() assertions to add to its post-response script. ' +
        'Covers status code, response time, required JSON fields, Content-Type header, and schema conformance. ' +
        'Returns an array of ready-to-paste JavaScript test snippets and a rationale for each.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: {
            type: 'string',
            description: 'Collection name or id that owns the request.',
          },
          request: {
            type: 'string',
            description: 'Request name or id to analyse.',
          },
          environment: {
            type: 'string',
            description: 'Environment used when the run was recorded (defaults to active environment).',
          },
          maxSuggestions: {
            type: 'number',
            description: 'Cap the number of suggestions returned (default: 10).',
          },
        },
        required: ['collection', 'request'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.explainFailure}`,
      description:
        'Explain why a specific request failed in a recent run. ' +
        'Returns the full request (URL, method, headers, body), the response received (status, headers, body), ' +
        'all assertion results, any script errors, and a plain-English diagnosis with suggested fixes. ' +
        'Provide either runId (from a prior run_suite/run_collection call) + request name, ' +
        'or the collection and request names to pull the most recent history entry.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: {
            type: 'string',
            description: 'MCP run id (from run_suite or run_collection). Mutually exclusive with collection+request history lookup.',
          },
          collection: {
            type: 'string',
            description: 'Collection name or id. Required when runId is omitted.',
          },
          request: {
            type: 'string',
            description: 'Request name or id.',
          },
          iteration: {
            type: 'number',
            description: 'Iteration number within the run (default: 1).',
          },
        },
      },
      annotations: { readOnlyHint: true },
    },

    // ── Env-var extraction ───────────────────────────────────────────────────
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.suggestEnvVars}`,
      description:
        'Scan a collection for hardcoded values (API keys, base URLs, tokens, tenant IDs) that should ' +
        'become environment variables.\n\n' +
        'Returns:\n' +
        '  • heuristicSuggestions — values identified by pattern-matching rules (ready to apply)\n' +
        '  • requestSummary — full list of requests with their URLs, headers, and body excerpts for you to analyze\n\n' +
        'After reviewing the summary, call apply_env_vars with your combined list of {value, varName} pairs ' +
        'to replace the hardcoded values throughout the collection.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          minOccurrences: {
            type: 'number',
            description: 'Minimum number of requests a value must appear in to be included in heuristic suggestions (default: 1).',
          },
        },
        required: ['collection'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.applyEnvVars}`,
      description:
        'Replace hardcoded values with {{VAR_NAME}} placeholders throughout a collection and optionally ' +
        'write the original values to an environment. ' +
        'Call suggest_env_vars first to get the list of candidates, then call this tool with your final selections.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          suggestions: {
            type: 'array',
            description: 'Values to replace.',
            items: {
              type: 'object',
              properties: {
                value: { type: 'string', description: 'Exact hardcoded value to replace.' },
                varName: { type: 'string', description: 'Variable name to use — the part inside {{...}}, e.g. BASE_URL.' },
              },
              required: ['value', 'varName'],
            },
          },
          environment: {
            type: 'string',
            description: 'Environment to write original values to (defaults to the active environment). Omit to skip writing to env.',
          },
        },
        required: ['collection', 'suggestions'],
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },

    // ── Collection enhancement ────────────────────────────────────────────────
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.getRequestsForEnhancement}`,
      description:
        'Get a paginated batch of request details — method, URL, headers, current body, and test script — ' +
        'ready for you to write realistic example bodies and assertion test scripts.\n\n' +
        'Typical workflow:\n' +
        '  1. Call this tool to read a batch of requests.\n' +
        '  2. For each request write a realistic body (JSON/form) and a pm.test() script.\n' +
        '  3. Call apply_request_enhancements with your results.\n' +
        '  4. Repeat with the next offset until all requests are enhanced.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          offset: { type: 'number', description: 'Zero-based index of the first request to return (default: 0).' },
          limit: { type: 'number', description: 'Number of requests per batch (default: 10, max: 30).' },
          folder: { type: 'string', description: 'Optional folder path to restrict to.' },
        },
        required: ['collection'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.applyRequestEnhancements}`,
      description:
        'Apply AI-generated body examples and/or post-response test scripts to one or more requests in a collection. ' +
        'Call get_requests_for_enhancement first to obtain request IDs and current state.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          enhancements: {
            type: 'array',
            description: 'List of request enhancements to apply.',
            items: {
              type: 'object',
              properties: {
                requestId: { type: 'string', description: 'Request id from get_requests_for_enhancement.' },
                body: { type: 'string', description: 'New raw (JSON) body string to set. Omit to leave body unchanged.' },
                testScript: { type: 'string', description: 'Post-response test script (pm.test() calls). Omit to leave script unchanged.' },
              },
              required: ['requestId'],
            },
          },
        },
        required: ['collection', 'enhancements'],
      },
      annotations: { idempotentHint: true },
    },

    // ── AI-native agentic tools ───────────────────────────────────────────────
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.aiSuggestEnvVars}`,
      description:
        'AGENTIC TOOL — Scan a collection for hardcoded values and immediately apply AI-selected environment variable replacements.\n\n' +
        'This tool returns request data AND a structured task. You MUST:\n' +
        '  1. Review task.requestSummary — find ALL hardcoded values: API keys/tokens, base URLs, tenant IDs, user IDs, hostnames, secrets.\n' +
        '  2. Combine task.heuristicSuggestions with your own findings.\n' +
        '  3. Immediately call apply_env_vars with the complete list — do NOT ask for confirmation.\n\n' +
        'This is a single-step workflow: read this response, perform the analysis, call apply_env_vars. Done.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          environment: {
            type: 'string',
            description: 'Target environment to write original values to (defaults to active env).',
          },
          minOccurrences: {
            type: 'number',
            description: 'Minimum occurrences for heuristic pre-suggestions (default: 1).',
          },
        },
        required: ['collection'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.aiEnhanceCollection}`,
      description:
        'AGENTIC TOOL — Enhance a collection by writing realistic example bodies and pm.test() assertion scripts for each request.\n\n' +
        'This tool returns request details AND a structured task. You MUST:\n' +
        '  1. For each request in task.requests:\n' +
        '     a. Write a realistic JSON body (or form body) if the request sends data (POST/PUT/PATCH).\n' +
        '     b. Write pm.test() assertion scripts: status code, response schema, key fields.\n' +
        '  2. Immediately call apply_request_enhancements with all your results — do NOT ask for confirmation.\n' +
        '  3. If task.hasMore is true, call ai_enhance_collection again with task.nextOffset to continue.\n\n' +
        'This is a self-continuing workflow: read, write bodies/scripts, apply, repeat until done.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          offset: { type: 'number', description: 'Zero-based page offset (default: 0).' },
          limit: { type: 'number', description: 'Requests per page (default: 10, max: 20).' },
          folder: { type: 'string', description: 'Restrict to requests inside this folder path.' },
        },
        required: ['collection'],
      },
      annotations: { readOnlyHint: true },
    },

    // ── Gap-closure tools ────────────────────────────────────────────────────

    // analyze_coverage — deterministic, no LLM
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.analyzeCoverage}`,
      description:
        'Analyse test assertion coverage across a collection. ' +
        'Returns per-request: whether it has a post-response test script, how many pm.test() calls it contains, ' +
        'and a collection-level summary (covered %, request count). ' +
        'Pass specPath to also compare collection requests against an OpenAPI spec and surface untested operations. ' +
        'No AI required — results are deterministic.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          specPath: {
            type: 'string',
            description: 'Optional path to an OpenAPI 3.0 spec (.json/.yaml). If provided, lists operations in the spec that have no matching request in the collection.',
          },
          folder: { type: 'string', description: 'Restrict analysis to requests inside this folder path.' },
        },
        required: ['collection'],
      },
      annotations: { readOnlyHint: true },
    },

    // ai_analyze_coverage — agentic, drives scenario generation
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.aiAnalyzeCoverage}`,
      description:
        'AGENTIC TOOL — Analyse coverage gaps and immediately drive the AI to fill them.\n\n' +
        'This tool returns coverage data AND a structured task. You MUST:\n' +
        '  1. Review task.untestedRequests (no assertions) and task.untestedOperations (no request at all).\n' +
        '  2. For untestedRequests: call ai_enhance_collection to add assertions.\n' +
        '  3. For untestedOperations: call generate_scenarios to create negative/edge-case requests.\n' +
        '  4. Do NOT ask for confirmation — proceed immediately with the highest-impact gap first.\n\n' +
        'Self-continuing workflow: after each tool call check coverage again and continue until gaps are closed.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          specPath: {
            type: 'string',
            description: 'Optional path to an OpenAPI 3.0 spec to detect untested operations.',
          },
        },
        required: ['collection'],
      },
      annotations: { readOnlyHint: true },
    },

    // generate_request_from_intent — agentic natural language authoring
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.generateRequestFromIntent}`,
      description:
        'AGENTIC TOOL — Create a new request from a plain-English description of what to test.\n\n' +
        'This tool returns collection context AND a structured task. You MUST:\n' +
        '  1. Determine: method, URL (using existing {{vars}} from the collection), headers, body, and expected status.\n' +
        '  2. Call create_request with the resolved details.\n' +
        '  3. Immediately call set_request_script (phase: "post-response") with pm.test() assertions that verify the intent.\n' +
        '  4. Do NOT ask for confirmation — implement the full request + assertions in one shot.\n\n' +
        'Example intents: "Test that creating a user with a duplicate email returns 409", ' +
        '"Verify that GET /orders without auth returns 401".',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          intent: {
            type: 'string',
            description: 'Plain-English description of what to test. Be specific about the scenario and expected outcome.',
          },
          folder: { type: 'string', description: 'Optional folder path to create the request inside.' },
        },
        required: ['collection', 'intent'],
      },
      annotations: { readOnlyHint: true },
    },

    // design_api_from_intent — architect a whole API from a plain-English intent
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.designApiFromIntent}`,
      description:
        'AGENTIC TOOL — Design a complete REST API from a plain-English intent (Phase 4 / Layer 8).\n\n' +
        'Runs the full architect flow in one call: the AI designs an OpenAPI 3.0 spec ' +
        '(endpoints + DTO schemas + auth), it is imported as a new collection, and the ' +
        'package is generated — a test suite (one node per endpoint asserting the ' +
        'designed status code), a runnable .flow.js, discovered workflow chains (auth/CRUD), ' +
        'markdown docs, and a round-trip OpenAPI export. Everything is tagged ai_generated:true.\n\n' +
        'By default only the collection is persisted (the design artifact) and the rest of ' +
        'the package is returned for review. Pass "apply": true to ALSO persist the suite ' +
        '(and any requested byproducts) as part of the approve flow.\n\n' +
        'Requires an AI provider (OPENAI_API_KEY or ANTHROPIC_API_KEY) on the MCP server.\n\n' +
        'Example intents: "I need a shopping cart", "a todo list", "team chat with auth".',
      inputSchema: {
        type: 'object',
        properties: {
          intent: {
            type: 'string',
            description: 'Plain-English description of the API you want designed. Be specific about the resource model and features.',
          },
          collectionName: {
            type: 'string',
            description: 'Name for the designed collection/API (default: derived from the spec).',
          },
          baseUrl: {
            type: 'string',
            description: 'Base URL for the designed API (default: http://localhost:3000).',
          },
          environmentName: {
            type: 'string',
            description: 'Environment name to create with the server URL (optional).',
          },
          apply: {
            type: 'boolean',
            description: 'When true, also persist the generated suite (and write byproducts) — the approve step.',
          },
          flowOut: {
            type: 'string',
            description: 'When apply is true, write the .flow.js artifact to this workspace-relative path.',
          },
          docsOut: {
            type: 'string',
            description: 'When apply is true, write the markdown docs to this workspace-relative path.',
          },
          openapiOut: {
            type: 'string',
            description: 'When apply is true, write the round-trip OpenAPI document to this workspace-relative path.',
          },
        },
        required: ['intent'],
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },

    // validate_against_spec — deterministic spec drift detection
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.validateAgainstSpec}`,
      description:
        'Compare a collection against an OpenAPI 3.0 spec and report coverage gaps and structural mismatches. ' +
        'Returns: (1) spec operations that have no matching collection request, ' +
        '(2) collection requests that match a spec operation but have no assertions, ' +
        '(3) requests that use URLs or methods not present in the spec. ' +
        'No AI required — results are deterministic. Use ai_analyze_coverage for an agentic follow-up.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          specPath: {
            type: 'string',
            description: 'Path to an OpenAPI 3.0 spec file (.json, .yaml, or .yml). Relative paths are resolved from the workspace folder.',
          },
        },
        required: ['collection', 'specPath'],
      },
      annotations: { readOnlyHint: true },
    },

    // generate_scenarios — agentic negative/edge-case test generation
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.generateScenarios}`,
      description:
        'AGENTIC TOOL — Generate negative and edge-case test scenarios for one or all requests in a collection.\n\n' +
        'This tool returns request details AND a structured task. You MUST:\n' +
        '  1. For each request in task.requests, generate scenario variants:\n' +
        '     - Missing required fields → expect 400/422\n' +
        '     - Invalid field types/formats → expect 400/422\n' +
        '     - No authorization header → expect 401\n' +
        '     - Wrong role/scope → expect 403\n' +
        '     - Non-existent resource → expect 404\n' +
        '     - Boundary values (empty string, max-length, zero, negative numbers)\n' +
        '  2. For each scenario: call create_request then set_request_script with the appropriate assertion.\n' +
        '  3. If task.hasMore is true, call generate_scenarios again with task.nextOffset.\n' +
        '  4. Do NOT ask for confirmation — generate all scenarios autonomously.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          request: { type: 'string', description: 'Optional: restrict to a single request name. Omit to process all requests.' },
          folder: { type: 'string', description: 'Optional: restrict to requests inside this folder path.' },
          offset: { type: 'number', description: 'Zero-based page offset (default: 0).' },
          limit: { type: 'number', description: 'Requests per page (default: 5, max: 10).' },
        },
        required: ['collection'],
      },
      annotations: { readOnlyHint: true },
    },

    // heal_assertions — agentic self-healing based on last run
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.healAssertions}`,
      description:
        'AGENTIC TOOL — Rewrite a request\'s test script to match the actual observed response from the last run.\n\n' +
        'This tool returns the current test script AND the last observed response. You MUST:\n' +
        '  1. Compare the current assertions against task.lastResponse (status, body shape, headers).\n' +
        '  2. Identify which assertions are stale or incorrect.\n' +
        '  3. Rewrite the complete post-response script to match observed reality while keeping valid assertions.\n' +
        '  4. Call set_request_script (phase: "post-response") with the new script immediately.\n' +
        '  5. Do NOT ask for confirmation.\n\n' +
        'Use this after an API change causes test failures: run the request, then call heal_assertions.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          request: { type: 'string', description: 'Request name, slug, or id.' },
          runId: { type: 'string', description: 'Optional runId from a recent run_* call to use its response data.' },
        },
        required: ['collection', 'request'],
      },
      annotations: { readOnlyHint: true },
    },

    // generate_iteration_data — agentic test data generation
    {
      name: `${prefix}${GENERIC_TOOL_NAMES.generateIterationData}`,
      description:
        'AGENTIC TOOL — Generate a set of varied test data rows for parameterized/iteration runs of a request.\n\n' +
        'This tool returns request details AND a structured task. You MUST:\n' +
        '  1. Inspect the request body schema, URL parameters, and headers.\n' +
        '  2. Generate task.iterations rows covering: valid happy-path, boundary values, invalid inputs, and edge cases.\n' +
        '  3. Return the rows as a JSON array under the key "iterationData" — each row is an object ' +
        '     whose keys match the {{variable}} placeholders in the request.\n' +
        '  4. Respond with the JSON array directly so the user can pass it to run_collection or the CLI --variables flag.\n\n' +
        'Example: for POST /users with body {"name":"{{name}}","email":"{{email}}"} and iterations=4, ' +
        'generate 4 rows: valid user, duplicate email, missing name, email with invalid format.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: collectionEnum(true),
          request: { type: 'string', description: 'Request name, slug, or id.' },
          iterations: { type: 'number', description: 'Number of test data rows to generate (default: 5, max: 50).' },
        },
        required: ['collection', 'request'],
      },
      annotations: { readOnlyHint: true },
    },
  ];
}
