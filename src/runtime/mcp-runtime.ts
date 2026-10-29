/**
 * Embeddable MCP Runtime
 * 
 * Factory and lifecycle management for MCP runtime that can be embedded in Node.js apps.
 * Supports:
 * - In-process tool execution via executeTool()
 * - Optional lightweight HTTP endpoint for external callers
 */

import * as fs from 'fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import * as path from 'path';
import { ConfigService } from '../infrastructure/config/config-service';
import { createEnvAiProvider } from '../infrastructure/ai/http-providers';
import { runCollection, runRequest, runSuite } from './direct-execution';
import { decodeFolderPath, flattenRequests } from './mcp-collection-utils';
import {
  CACHE_BUSTING_TOOLS as CACHE_BUSTING_TOOLS_FROM_DISPATCHER,
  dispatchGenericTool as sharedDispatchGenericTool,
  type McpRunCallbacks
} from './mcp-dispatcher';
import { buildPromptResult, MCP_PROMPTS } from './mcp-prompts';
import { McpRunStore } from './mcp-run-store';
import { buildMcpToolList, decodeCursor, encodeCursor, type McpTool } from './mcp-tool-builder';
import { parseMcpToolName, resolveFolderToken, resolveToken } from './mcp-tool-name';
import { GENERIC_TOOL_NAMES, type GenericToolName } from './mcp-tool-schemas';
import { createNodeContainer } from './node-bootstrap';
import type { McpRuntimeHandle, McpRuntimeOptions } from './runtime-contracts';

/**
 * Internal runtime instance state
 */
interface McpRuntimeInstance {
  workspaceFolder: string;
  port: number;
  host: string;
  isRunning: boolean;
  server?: Server;
  /** Persistent container kept alive for the duration of the server run.
   *  Used for read-only config/collection access (tools/list, CORS, prefix
   *  lookup) so those paths never cold-boot a container from disk.
   *  Execution paths (tools/call) still create their own fresh containers. */
  container?: ReturnType<typeof createNodeContainer>;
  /** Per-instance async run record store (survives the lifetime of the server). */
  runStore: McpRunStore;
}

const instances = new Map<string, McpRuntimeInstance>();

interface ExecutePayload {
  name: string;
  args?: Record<string, unknown>;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

async function withMcpExecutionDefaults<T>(work: () => Promise<T>): Promise<T> {
  const prevEnforce = process.env.HTTP_FORGE_ENFORCE_MAX_REQUESTS;
  const prevReports = process.env.HTTP_FORGE_GENERATE_REPORTS;

  process.env.HTTP_FORGE_ENFORCE_MAX_REQUESTS = 'true';
  process.env.HTTP_FORGE_GENERATE_REPORTS = 'true';

  try {
    return await work();
  } finally {
    if (prevEnforce === undefined) {
      delete process.env.HTTP_FORGE_ENFORCE_MAX_REQUESTS;
    } else {
      process.env.HTTP_FORGE_ENFORCE_MAX_REQUESTS = prevEnforce;
    }

    if (prevReports === undefined) {
      delete process.env.HTTP_FORGE_GENERATE_REPORTS;
    } else {
      process.env.HTTP_FORGE_GENERATE_REPORTS = prevReports;
    }
  }
}

/**
 * Best-effort disposal of a bootstrapped container's services. Each
 * `createNodeContainer()` call sets up a fresh collection file-watcher; the read
 * paths (tools/list, CORS, prefix lookup) must dispose it or watchers leak.
 */
function disposeContainer(container: ReturnType<typeof createNodeContainer>): void {
  const disposables: Array<unknown> = [
    container.testSuite,
    container.collection,
    container.environmentConfig,
    container.config,
    container.console,
  ];
  for (const disposable of disposables) {
    try {
      (disposable as { dispose?: () => void })?.dispose?.();
    } catch {
      // Best-effort cleanup only.
    }
  }
}

/**
 * Short-lived cache of the built tools/list response, keyed by workspace folder.
 */
const TOOL_LIST_CACHE_TTL_MS = 3000;
const toolListCache = new Map<string, { tools: McpTool[]; expiresAt: number }>();
const toolListPending = new Map<string, Promise<McpTool[]>>();

async function getCachedToolList(
  workspaceFolder: string,
  container: ReturnType<typeof createNodeContainer>
): Promise<McpTool[]> {
  const cached = toolListCache.get(workspaceFolder);
  if (cached && cached.expiresAt > Date.now()) return cached.tools;

  const pending = toolListPending.get(workspaceFolder);
  if (pending) return pending;

  const build = (async () => {
    const mcpCfg = container.config.getMcpConfig();
    const isExcluded = (ex: string[] | undefined, col: { id: string; name: string }) =>
      !!ex?.length && (ex.includes(col.id) || ex.includes(col.name));
    const collections = container.collection
      .getAllCollections()
      .filter((c) => !isExcluded(mcpCfg.excludedCollections, c));
    const suites = (await container.testSuite.getAllSuites()).filter(
      (s) => !isExcluded(mcpCfg.excludedSuites, s)
    );
    return buildMcpToolList(collections, suites, mcpCfg, workspaceFolder);
  })()
    .then((tools) => {
      toolListCache.set(workspaceFolder, { tools, expiresAt: Date.now() + TOOL_LIST_CACHE_TTL_MS });
      return tools;
    })
    .finally(() => toolListPending.delete(workspaceFolder));

  toolListPending.set(workspaceFolder, build);
  return build;
}

function stripToolPrefix(
  container: ReturnType<typeof createNodeContainer>,
  toolName: string
): string {
  const prefix = container.config.getMcpConfig().toolPrefix ?? '';
  if (!prefix) return toolName;
  if (toolName.startsWith(prefix)) return toolName.slice(prefix.length);
  return toolName;
}

function rewriteReportUris(text: string, host: string, port: number): string {
  return text.replace(
    /"uri"\s*:\s*"file:\/\/([^"]+)"/g,
    (_, filePath) => `"uri":"http://${host}:${port}/report?path=${encodeURIComponent(filePath)}"`
  );
}

function sendRpcError(res: ServerResponse, id: string | number | null, code: number, message: string): void {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id,
    error: { code, message }
  };
  sendJson(res, 200, response);
}

/** Read toolPageSize from config; defaults to 200. */
function getToolPageSize(container: ReturnType<typeof createNodeContainer>): number {
  return container.config.getMcpConfig().toolPageSize ?? 200;
}

async function dispatchRpc(instance: McpRuntimeInstance, rpc: JsonRpcRequest): Promise<unknown> {
  switch (rpc.method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: 'http-forge', version: '1.0.0' },
        instructions:
          'You are assisting with HTTP API testing via HTTP Forge. ' +
          'When a run_suite, run_collection, or run_folder call completes with failures ' +
          '(summary.failed > 0 or allPassed === false), automatically analyze the ' +
          '\'failedRequests\' in the response and provide: (1) root cause for each failure, ' +
          '(2) specific fix recommendations, (3) updated pm.test() assertion scripts where ' +
          'relevant. Do not wait for the user to ask — proactively diagnose and suggest fixes. ' +
          'For async runs (status: \'running\'), poll with get_run_status until complete, then ' +
          'call get_run_summary. When get_run_summary returns a _nextStep field you MUST execute ' +
          'it immediately — the failedRequests array is already included inline so no extra tool ' +
          'call is needed. Analyze the failures and provide diagnosis without waiting for the user.'
      };

    case 'tools/list': {
      const allTools = await getCachedToolList(instance.workspaceFolder, instance.container!);
      const listParams = (rpc.params ?? {}) as Record<string, unknown>;
      const cursor = typeof listParams.cursor === 'string' ? listParams.cursor : undefined;
      const pageSize = getToolPageSize(instance.container!);
      if (pageSize <= 0 || allTools.length <= pageSize) {
        return { tools: allTools };
      }
      const offset = decodeCursor(cursor);
      const page = allTools.slice(offset, offset + pageSize);
      const nextOffset = offset + pageSize;
      const result: Record<string, unknown> = { tools: page };
      if (nextOffset < allTools.length) {
        result.nextCursor = encodeCursor(nextOffset);
      }
      return result;
    }

    case 'tools/call': {
      const params = (rpc.params ?? {}) as Record<string, unknown>;
      const name = params.name as string | undefined;
      const toolArgs = params.arguments as Record<string, unknown> | undefined;
      if (!name) {
        throw new Error('Missing tool name');
      }

      const result = await dispatchTool(instance, name, toolArgs ?? {});

      // Inject AI guidance when runs complete with failures.
      // The failure data is already in the result — the AI can analyze it inline
      // without needing a separate prompt invocation.
      const runResult = result as Record<string, unknown> | null;
      const runSummary = runResult?.summary as { failed?: number; allPassed?: boolean } | undefined;
      if (runSummary && ((runSummary.failed ?? 0) > 0 || runSummary.allPassed === false)) {
        runResult!._nextStep =
          `${runSummary.failed ?? 'Some'} request(s) failed. ` +
          `Please analyze the 'failedRequests' above: identify the root cause of each failure, ` +
          `suggest specific fixes (URL, auth, body, environment variables), and provide ` +
          `updated pm.test() assertion scripts where the assertions are incorrect.`;
      }

      const text = JSON.stringify(result, null, 2);
      const rewritten = rewriteReportUris(text, instance.host, instance.port);
      // Append a Markdown link so the report URL is clickable in Copilot Chat
      const reportUrlMatch = rewritten.match(/"uri"\s*:\s*"(http:\/\/[^"]+\/report\?[^"]+)"/);
      const linkSuffix = reportUrlMatch
          ? `\n\n[View HTML Report](${reportUrlMatch[1]})`
          : '';
      return { content: [{ type: 'text', text: rewritten + linkSuffix }] };
    }

    case 'prompts/list':
      return { prompts: MCP_PROMPTS };

    case 'prompts/get': {
      const params = (rpc.params ?? {}) as Record<string, unknown>;
      const promptName = params.name as string | undefined;
      const promptArgs = (params.arguments ?? {}) as Record<string, string>;
      if (!promptName) throw new Error('Missing prompt name');

      const container = createNodeContainer(instance.workspaceFolder);
      try {
        const result = await buildPromptResult(
          promptName,
          promptArgs,
          container.collection,
          instance.runStore,
          instance.workspaceFolder
        );
        return result;
      } finally {
        disposeContainer(container);
      }
    }

    default:
      throw new Error(`Method not found: ${rpc.method}`);
  }
}

function applyCorsHeaders(instance: McpRuntimeInstance, req: IncomingMessage, res: ServerResponse): void {
  // Use the persistent container (no disk I/O) if the server is running;
  // fall back to a short-lived container for out-of-band calls (e.g. pre-start).
  const ownContainer = !instance.container;
  const container = instance.container ?? createNodeContainer(instance.workspaceFolder);
  let allowedOrigins: string[];
  try {
    allowedOrigins = container.config.getMcpConfig().cors.allowedOrigins ?? ['http://localhost', 'http://127.0.0.1'];
  } finally {
    if (ownContainer) disposeContainer(container);
  }
  const origin = req.headers.origin ?? '';
  const corsOrigin = allowedOrigins.includes(origin) ? origin : (allowedOrigins[0] ?? 'http://localhost');

  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id');
}

function handleReportRequest(instance: McpRuntimeInstance, req: IncomingMessage, res: ServerResponse): void {
  const parsed = new URL(req.url!, `http://${instance.host}:${instance.port}`);
  const requestedPath = parsed.searchParams.get('path');

  if (!requestedPath) {
    res.statusCode = 400;
    res.end('Missing path parameter');
    return;
  }

  const normalized = path.resolve(requestedPath);
  // Derive allowedBase from the config so it always matches where reports are written
  const resultsPath = instance.container?.config.getResultsPath();
  const allowedBase = resultsPath
      ? path.dirname(resultsPath)
      : path.resolve(instance.workspaceFolder, '.http-forge', '.cache');
  if (!normalized.startsWith(allowedBase + path.sep) || !normalized.endsWith('.html')) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.readFile(normalized, 'utf-8', (err, content) => {
    if (err) {
      res.statusCode = 404;
      res.end('Report not found');
      return;
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(content);
  });
}

/**
 * Start an async run in the background using the instance's run store.
 * Returns { runId } immediately; the promise updates the record on completion.
 */
function startAsyncRun(
  store: McpRunStore,
  label: string,
  totalRequests: number,
  run: () => Promise<unknown>
): object {
  const record = store.create(label, totalRequests);
  run().then((result: any) => {
    if (record.status === 'cancelled') return; // preserve cancellation
    record.status = 'completed';
    record.completedAt = Date.now();
    record.summary = result?.summary ?? record.summary;
    if (result?.failedRequests) record.failedRequests = result.failedRequests;
    if (result?.noAssertionExamples) record.noAssertionExamples = result.noAssertionExamples;
    record.reportPath = result?.report?.uri?.replace('file://', '') ?? null;
    record.progress.completed = record.progress.total;
  }).catch((err: Error) => {
    if (record.status === 'cancelled') return; // preserve cancellation
    record.status = 'failed';
    record.completedAt = Date.now();
    record.error = err.message;
  });
  return {
    runId: record.id,
    status: 'running',
    total: totalRequests,
    message: 'Run started. Use get_run_status to poll.',
  };
}

/**
 * Build the run callbacks for the shared dispatcher, closing over the
 * workspace folder and the instance's run store.
 */
function buildRunCallbacks(
  instance: McpRuntimeInstance
): McpRunCallbacks {
  const workspaceFolder = instance.workspaceFolder;
  return {
    async runRequest(col, requestId, a) {
      return withMcpExecutionDefaults(() => runRequest({
        workspaceFolder,
        collectionId: col.id,
        requestId,
        environment: a.environment as string | undefined,
        variables: a.variables as Record<string, unknown> | undefined,
        headers: a.headers as Record<string, string> | undefined,
        query: a.query as Record<string, string> | undefined,
        body: a.body as string | undefined,
        include: a.include as string[] | undefined,
      }));
    },
    async runFolder(col, folderPath, a) {
      const requestCount = flattenRequests(col).filter(
        ({ folderPath: fp }) => fp === folderPath || fp.startsWith(`${folderPath}/`)
      ).length;
      if (a.async === true) {
        return startAsyncRun(
          instance.runStore, `${col.name} / ${decodeFolderPath(folderPath)}`, requestCount,
          () => withMcpExecutionDefaults(() => runCollection({
            workspaceFolder, collectionId: col.id, folderPath,
            recursive: a.recursive as boolean | undefined,
            environment: a.environment as string | undefined,
            variables: a.variables as Record<string, unknown> | undefined,
            iterations: a.iterations as number | undefined,
            stopOnError: a.stopOnError as boolean | undefined,
            delay: a.delay as number | undefined,
            include: a.include as string[] | undefined,
          }))
        );
      }
      return withMcpExecutionDefaults(() => runCollection({
        workspaceFolder, collectionId: col.id, folderPath,
        recursive: a.recursive as boolean | undefined,
        environment: a.environment as string | undefined,
        variables: a.variables as Record<string, unknown> | undefined,
        iterations: a.iterations as number | undefined,
        stopOnError: a.stopOnError as boolean | undefined,
        delay: a.delay as number | undefined,
        include: a.include as string[] | undefined,
      }));
    },
    async runCollection(col, a) {
      const requestCount = flattenRequests(col).length;
      if (a.async === true) {
        return startAsyncRun(
          instance.runStore, col.name, requestCount,
          () => withMcpExecutionDefaults(() => runCollection({
            workspaceFolder, collectionId: col.id,
            environment: a.environment as string | undefined,
            variables: a.variables as Record<string, unknown> | undefined,
            iterations: a.iterations as number | undefined,
            stopOnError: a.stopOnError as boolean | undefined,
            delay: a.delay as number | undefined,
            include: a.include as string[] | undefined,
          }))
        );
      }
      return withMcpExecutionDefaults(() => runCollection({
        workspaceFolder, collectionId: col.id,
        environment: a.environment as string | undefined,
        variables: a.variables as Record<string, unknown> | undefined,
        iterations: a.iterations as number | undefined,
        stopOnError: a.stopOnError as boolean | undefined,
        delay: a.delay as number | undefined,
        include: a.include as string[] | undefined,
      }));
    },
    async runSuite(suiteId, suiteName, a) {
      // Re-read suite to compute request count for progress tracking
      const tempContainer = createNodeContainer(workspaceFolder);
      let suiteRequestCount = 0;
      try {
        const suite = await tempContainer.testSuite.getSuite(suiteId);
        const nodeCount = suite?.nodes.filter(n => (n as any).type === 'request').length ?? 0;
        suiteRequestCount = nodeCount *
          ((a.iterations as number | undefined) ?? suite?.config?.iterations ?? 1);
      } finally {
        disposeContainer(tempContainer);
      }
      if (a.async === true) {
        return startAsyncRun(
          instance.runStore, suiteName, suiteRequestCount,
          () => withMcpExecutionDefaults(() => runSuite({
            workspaceFolder, suiteId,
            environment: a.environment as string | undefined,
            variables: a.variables as Record<string, unknown> | undefined,
            iterations: a.iterations as number | undefined,
            stopOnError: a.stopOnError as boolean | undefined,
            delay: a.delay as number | undefined,
            requestFilter: a.requestFilter as string[] | undefined,
            include: a.include as string[] | undefined,
          }))
        );
      }
      return withMcpExecutionDefaults(() => runSuite({
        workspaceFolder, suiteId,
        environment: a.environment as string | undefined,
        variables: a.variables as Record<string, unknown> | undefined,
        iterations: a.iterations as number | undefined,
        stopOnError: a.stopOnError as boolean | undefined,
        delay: a.delay as number | undefined,
        requestFilter: a.requestFilter as string[] | undefined,
        include: a.include as string[] | undefined,
      }));
    },
  };
}

/** Tools that modify the collection/suite structure and should bust the tool-list cache. */
const CACHE_BUSTING_TOOLS = CACHE_BUSTING_TOOLS_FROM_DISPATCHER;

async function dispatchTool(
  instance: McpRuntimeInstance,
  name: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const workspaceFolder = instance.workspaceFolder;
  const stripped = stripToolPrefix(instance.container!, name);

  if ((Object.values(GENERIC_TOOL_NAMES) as string[]).includes(stripped)) {
    // Generic (argument-selected) tool — use the shared dispatcher.
    // A fresh container supplies the services; the run callbacks close over the instance.
    const container = createNodeContainer(workspaceFolder);
    const aiProvider = createEnvAiProvider();
    try {
      const result = await sharedDispatchGenericTool(
        stripped as GenericToolName,
        args,
        {
          collection: container.collection,
          testSuite: container.testSuite,
          environmentConfig: container.environmentConfig,
          workspaceFolder,
          ...(aiProvider ? { aiProvider } : {}),
        },
        instance.runStore,
        buildRunCallbacks(instance)
      );
      // Bust the tool-list cache for any tool that modifies the collection/suite structure.
      if (CACHE_BUSTING_TOOLS.has(stripped)) {
        toolListCache.delete(workspaceFolder);
      }
      return result;
    } finally {
      disposeContainer(container);
    }
  }

  // Flat-mode encoded tool — resolve tokens and execute directly.
  const parsed = parseMcpToolName(stripped);
  const container = createNodeContainer(workspaceFolder);
  try {
    const collections = container.collection.getAllCollections();
    const collectionIds = collections.map((c) => c.id);

    const resolveCollection = (token: string) => {
      const colId = resolveToken(token, collectionIds);
      const col = colId ? collections.find((c) => c.id === colId) : undefined;
      if (!col) throw new Error(`Collection not found for tool: ${name}`);
      return col;
    };

    if (parsed.kind === 'request') {
      const [colToken, reqToken] = parsed.tokens;
      if (!colToken || !reqToken) throw new Error(`Malformed request tool: ${name}`);
      const col = resolveCollection(colToken);
      const requestIds = flattenRequests(col).map((r) => r.request.id);
      const requestId = resolveToken(reqToken, requestIds);
      if (!requestId) throw new Error(`Request not found in collection "${col.name}" for tool: ${name}`);
      return withMcpExecutionDefaults(() => runRequest({
        workspaceFolder, collectionId: col.id, requestId,
        environment: args.environment as string | undefined,
        variables: args.variables as Record<string, unknown> | undefined,
        headers: args.headers as Record<string, string> | undefined,
        query: args.query as Record<string, string> | undefined,
        body: args.body as string | undefined,
        include: args.include as string[] | undefined,
      }));
    }

    if (parsed.kind === 'collection') {
      const [colToken] = parsed.tokens;
      if (!colToken) throw new Error(`Malformed collection tool: ${name}`);
      const col = resolveCollection(colToken);
      return withMcpExecutionDefaults(() => runCollection({
        workspaceFolder, collectionId: col.id,
        environment: args.environment as string | undefined,
        variables: args.variables as Record<string, unknown> | undefined,
        iterations: args.iterations as number | undefined,
        stopOnError: args.stopOnError as boolean | undefined,
        delay: args.delay as number | undefined,
        include: args.include as string[] | undefined,
      }));
    }

    if (parsed.kind === 'folder') {
      const [colToken, folderToken] = parsed.tokens;
      if (!colToken || !folderToken) throw new Error(`Malformed folder tool: ${name}`);
      const col = resolveCollection(colToken);
      const folderPaths = container.collection.getAllCollections()
        .find(c => c.id === col.id) ? undefined : undefined; // get from already-loaded collection
      const allFolderPaths = flattenRequests(col)
        .map(r => r.folderPath)
        .filter((p, i, arr) => p && arr.indexOf(p) === i);
      const folderPath = resolveFolderToken(folderToken, allFolderPaths);
      if (!folderPath) throw new Error(`Folder not found in collection "${col.name}" for tool: ${name}`);
      return withMcpExecutionDefaults(() => runCollection({
        workspaceFolder, collectionId: col.id, folderPath,
        recursive: args.recursive as boolean | undefined,
        environment: args.environment as string | undefined,
        variables: args.variables as Record<string, unknown> | undefined,
        iterations: args.iterations as number | undefined,
        stopOnError: args.stopOnError as boolean | undefined,
        delay: args.delay as number | undefined,
        include: args.include as string[] | undefined,
      }));
    }

    const [suiteToken] = parsed.tokens;
    if (!suiteToken) throw new Error(`Malformed suite tool: ${name}`);
    const suites = await container.testSuite.getAllSuites();
    const suiteId = resolveToken(suiteToken, suites.map((s) => s.id));
    if (!suiteId) throw new Error(`Test suite not found for tool: ${name}`);
    return withMcpExecutionDefaults(() => runSuite({
      workspaceFolder, suiteId,
      environment: args.environment as string | undefined,
      variables: args.variables as Record<string, unknown> | undefined,
      iterations: args.iterations as number | undefined,
      stopOnError: args.stopOnError as boolean | undefined,
      delay: args.delay as number | undefined,
      requestFilter: args.requestFilter as string[] | undefined,
      include: args.include as string[] | undefined,
    }));
  } finally {
    disposeContainer(container);
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('Request body too large (max 1MB)'));
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function buildServer(instance: McpRuntimeInstance): Server {
  return createServer(async (req, res) => {
    try {
      applyCorsHeaders(instance, req, res);

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.method === 'GET' && req.url === '/health') {
        sendJson(res, 200, {
          status: 'ok',
          port: instance.port
        });
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/report?')) {
        handleReportRequest(instance, req, res);
        return;
      }

      if (req.method === 'POST' && (req.url === '/' || req.url === '/mcp')) {
        let rpc: JsonRpcRequest;
        try {
          rpc = await readJsonBody(req) as JsonRpcRequest;
        } catch {
          sendRpcError(res, null, -32700, 'Parse error');
          return;
        }

        try {
          const result = await dispatchRpc(instance, rpc);
          sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id ?? null, result } as JsonRpcResponse);
        } catch (error) {
          sendRpcError(res, rpc.id ?? null, -32603, (error as Error).message || 'Internal error');
        }
        return;
      }

      if (req.method === 'POST' && req.url === '/tools/execute') {
        const payload = await readJsonBody(req) as ExecutePayload;
        if (!payload || typeof payload.name !== 'string' || payload.name.trim() === '') {
          sendJson(res, 400, { error: 'Field "name" is required' });
          return;
        }

        const result = await dispatchTool(instance, payload.name, payload.args ?? {});
        sendJson(res, 200, { result });
        return;
      }

      sendJson(res, 405, { error: 'Method not allowed' });
    } catch (error) {
      sendJson(res, 500, { error: (error as Error).message });
    }
  });
}

function resolveRuntimePort(options: McpRuntimeOptions): number {
  if (typeof options.port === 'number' && Number.isFinite(options.port)) {
    return Math.min(65535, Math.max(1, Math.floor(options.port)));
  }

  const configService = new ConfigService(path.resolve(options.workspaceFolder));
  const configuredPort = configService.getMcpConfig().port;
  return Math.min(65535, Math.max(1, Math.floor(configuredPort || 3100)));
}

/**
 * Create an embeddable MCP runtime instance.
 * 
 * The returned handle provides lifecycle control and tool execution.
 * Multiple instances can coexist with different ports and workspaces.
 * 
 * @param options Configuration for the runtime
 * @returns Handle for controlling the runtime
 */
export async function createMcpRuntime(options: McpRuntimeOptions): Promise<McpRuntimeHandle> {
  const port = resolveRuntimePort(options);
  const host = options.host || '127.0.0.1';
  const instanceId = `${host}:${port}`;

  // Create instance state
  const instance: McpRuntimeInstance = {
    workspaceFolder: options.workspaceFolder,
    port,
    host,
    isRunning: false,
    runStore: new McpRunStore(),
  };

  instances.set(instanceId, instance);

  // Return handle
  return {
    async start(): Promise<void> {
      if (instance.isRunning) {
        return;
      }

      // Boot the persistent container once. File watchers will keep its
      // in-memory collection/config data fresh for the server lifetime.
      if (!instance.container) {
        instance.container = createNodeContainer(instance.workspaceFolder);
      }

      const server = buildServer(instance);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(instance.port, instance.host, () => {
          server.off('error', reject);
          resolve();
        });
      });

      instance.server = server;
      instance.isRunning = true;
    },

    async stop(): Promise<void> {
      // Dispose the persistent container before tearing down the server.
      if (instance.container) {
        disposeContainer(instance.container);
        instance.container = undefined;
      }

      if (!instance.server) {
        instance.isRunning = false;
        return;
      }

      await new Promise<void>((resolve, reject) => {
        instance.server!.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });

      instance.server = undefined;
      instance.isRunning = false;
    },

    isRunning(): boolean {
      return instance.isRunning;
    },

    getPort(): number {
      return instance.port;
    },

    async executeTool(name: string, args?: Record<string, unknown>): Promise<unknown> {
      return dispatchTool(instance, name, args ?? {});
    }
  };
}
