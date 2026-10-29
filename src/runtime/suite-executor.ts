/**
 * Suite flow engine for direct execution.
 *
 * Encapsulates the node-graph interpreter used to execute a test suite
 * (or a collection replayed as a suite): conditional/loop/switch nodes,
 * request execution, pre/post scripts, per-iteration concurrency, result
 * persistence, and report generation.
 */

import type { ServiceContainer } from '../di/service-container';
import { InMemoryCookieJar } from '../infrastructure/cookie/in-memory-cookie-jar';
import { CollectionRequestExecutor } from '../infrastructure/execution/collection-request-executor';
import type { PreRequestScriptContext, ResponseContext } from '../infrastructure/script/interfaces';
import { redactHeaders } from '../infrastructure/security/sensitive-data-redactor';
import { JUnitReportGenerator } from '../infrastructure/test-suite/junit-report-generator';
import { ResultStorageService } from '../infrastructure/test-suite/result-storage-service';
import type { ExecutionRequest, ExecutionResult, RequestAuth } from '../types/types';
import { evaluateExpression } from '../utils/expression-evaluator';
import { deserializeTypedRecord, deserializeTypedValue, serializeTypedValue } from '../utils/typed-value';
import { findRequestInCollection } from './collection-traversal';
import {
  applyOverrides,
  getDirectMaxRequestsLimit,
  getRedactedCookies,
  getRedactedResponseHeaders,
  isSuccessfulExecutionStatus,
  resolveInheritedAuth,
  shouldEnforceMaxRequests,
  shouldGenerateReports,
  toExecutionRequest,
  toStringRecord,
  tryParseJson,
} from './execution-helpers';
import { resolveResultGrouping } from './result-grouping';

type FlowState = {
  vars: Record<string, unknown>;
  lastResult?: ExecutionResult;
};

type FlatRequestRef = {
  collectionId: string;
  requestId: string;
  name: string;
  folderPath?: string;
  enabled?: boolean;
};

/**
 * Executes a suite node graph against a resolved service container.
 *
 * The whole flow engine lives here so the public entry points in
 * `direct-execution.ts` stay thin. One instance is scoped to one run.
 */
export class SuiteExecutor {
  constructor(private readonly container: ServiceContainer) {}

  async execute(
    suite: any,
    args: Record<string, unknown>,
    source: 'suite' | 'collection'
  ): Promise<unknown> {
    const container = this.container;
    const env = (args.environment as string | undefined) ?? container.environmentConfig.getSelectedEnvironment();
    const iterations: number = (args.iterations as number | undefined) ?? suite.config?.iterations ?? 1;
    const stopOnError: boolean = (args.stopOnError as boolean | undefined) ?? suite.config?.stopOnError ?? false;
    const delayMs: number = (args.delay as number | undefined) ?? suite.config?.delayBetweenRequests ?? 0;
    const concurrency: number = Math.max(1, Math.min(50, (args.concurrency as number | undefined) ?? 1));
    const filter = args.requestFilter as string[] | undefined;
    const include = (args.include as string[] | undefined) ?? [];
    const reporters = (args.reporters as string[] | undefined) ?? [];
    const wantJUnit = reporters.includes('junit');
    const variables = toStringRecord(args.variables as Record<string, unknown> | undefined);
    const enforceMaxRequests = shouldEnforceMaxRequests();
    const generateReports = shouldGenerateReports(include, reporters);

    const maxNodeLoopIterations = Math.max(1, Math.min(10_000, Number(args.maxNodeLoopIterations ?? 100)));

    const flowState: FlowState = {
      vars: { ...variables }
    };

    function normalizeScript(script: unknown): string | undefined {
      if (typeof script === 'string') {
        return script;
      }

      if (Array.isArray(script)) {
        const lines = script.filter((part): part is string => typeof part === 'string');
        return lines.join('\n');
      }

      return undefined;
    }

    function resolveNodeScriptSource(node: any): unknown {
      if (!node || typeof node !== 'object') {
        return undefined;
      }

      if (node.script !== undefined) {
        return node.script;
      }

      if (typeof node.scriptRef === 'string' && node.scriptRef.trim()) {
        const library = suite?.scripts;
        if (library && typeof library === 'object') {
          return (library as Record<string, unknown>)[node.scriptRef];
        }
      }

      return undefined;
    }

    function safeNodeName(node: any): string {
      return node?.name || node?.label || node?.id || 'flow-node';
    }

    function createExpressionContext(node: any, iter: number): Record<string, unknown> {
      const resolvedEnv = container.environmentConfig.getResolvedEnvironment(env);
      const decodedVars = deserializeTypedRecord(flowState.vars as Record<string, unknown>);

      const variablesApi = {
        get: (key: string) => deserializeTypedValue(flowState.vars[key]),
        set: (key: string, value: unknown) => {
          if (typeof key === 'string' && key.trim()) {
            flowState.vars[key] = serializeTypedValue(value);
          }
        },
        unset: (key: string) => {
          if (typeof key === 'string' && key.trim()) {
            delete flowState.vars[key];
          }
        },
        has: (key: string) => Object.prototype.hasOwnProperty.call(flowState.vars, key),
        toObject: () => ({ ...decodedVars })
      };

      const environmentApi = {
        get: (key: string) => deserializeTypedValue(resolvedEnv?.variables?.[key]),
        set: (key: string, value: unknown) => {
          if (typeof key === 'string' && key.trim()) {
            container.environmentConfig.setEnvironmentVariable(key, serializeTypedValue(value), env);
          }
        },
        unset: (key: string) => {
          if (typeof key === 'string' && key.trim()) {
            container.environmentConfig.deleteEnvironmentVariable(key, env);
          }
        },
        clear: () => {
          container.environmentConfig.clearEnvironmentVariables(env);
        }
      };

      const globalsApi = {
        get: (key: string) => deserializeTypedValue(container.environmentConfig.getGlobalVariables()?.[key]),
        set: (key: string, value: unknown) => {
          if (typeof key === 'string' && key.trim()) {
            container.environmentConfig.setGlobalVariable(key, serializeTypedValue(value));
          }
        },
        unset: (key: string) => {
          if (typeof key === 'string' && key.trim()) {
            container.environmentConfig.deleteGlobalVariable(key);
          }
        },
        clear: () => {
          container.environmentConfig.clearGlobalVariables();
        }
      };

      const pmApi = {
        variables: variablesApi,
        environment: environmentApi,
        globals: globalsApi
      };

      return {
        vars: decodedVars,
        lastResult: flowState.lastResult,
        iteration: iter,
        node,
        // All three aliases exposed so conditions can use pm.*, ctx.*, or hf.*
        pm: pmApi,
        ctx: pmApi,
        hf: pmApi
      };
    }

    function evaluateNodeCondition(expression: unknown, node: any, iter: number): boolean {
      if (typeof expression !== 'string' || !expression.trim()) {
        return true;
      }

      const value = evaluateExpression(expression, createExpressionContext(node, iter));
      return Boolean(value);
    }

    function toStringHeaders(headers: Record<string, string | string[]> | undefined): Record<string, string> {
      if (!headers) {
        return {};
      }

      const output: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        output[key] = Array.isArray(value) ? value.join('; ') : String(value);
      }
      return output;
    }

    function toResponseContext(result: ExecutionResult): ResponseContext {
      return {
        executedRequest: result.executedRequest,
        status: result.response?.status ?? 0,
        statusText: result.response?.statusText ?? '',
        headers: toStringHeaders(result.response?.headers),
        body: result.response?.body,
        cookies: result.response?.cookies,
        responseTime: result.duration,
        responseSize: typeof result.response?.body === 'string' ? Buffer.byteLength(result.response.body, 'utf8') : 0
      };
    }

    async function runNodeScript(
      script: unknown,
      node: any,
      iter: number,
      phase: 'pre' | 'post',
      options?: { request?: ExecutionRequest; response?: ResponseContext }
    ): Promise<void> {
      const sourceCode = normalizeScript(script);
      if (!sourceCode || !sourceCode.trim()) {
        return;
      }

      const resolvedEnv = container.environmentConfig.getResolvedEnvironment(env);
      const initialGlobals = container.environmentConfig.getGlobalVariables();
      const requestContext = {
        url: options?.request?.url ?? flowState.lastResult?.executedRequest?.url ?? 'http://flow.local/node',
        method: options?.request?.method ?? flowState.lastResult?.executedRequest?.method ?? 'GET',
        headers: toStringHeaders(options?.request?.headers as Record<string, string | string[]> | undefined),
        body: options?.request?.body ?? null,
        params: options?.request?.params ?? {},
        query: options?.request?.query ?? {}
      };

      const scriptContext: PreRequestScriptContext = {
        request: requestContext,
        variables: toStringRecord(flowState.vars as Record<string, unknown>),
        environmentVariables: resolvedEnv?.variables || {},
        globals: { ...initialGlobals },
        environmentName: env,
        info: {
          eventName: phase === 'post' ? 'test' : 'prerequest',
          requestName: safeNodeName(node),
          requestId: String(node?.id ?? safeNodeName(node)),
          collectionName: suite.name,
          iteration: iter,
          iterationCount: iterations
        },
        onEnvironmentChange: (action: 'set' | 'unset' | 'clear', key?: string, value?: string) => {
          if (action === 'set' && key && value !== undefined) {
            container.environmentConfig.setEnvironmentVariable(key, value, env);
          } else if (action === 'unset' && key) {
            container.environmentConfig.deleteEnvironmentVariable(key, env);
          } else if (action === 'clear') {
            container.environmentConfig.clearEnvironmentVariables(env);
          }
        },
        onGlobalsChange: (action: 'set' | 'unset' | 'clear', key?: string, value?: string) => {
          if (action === 'set' && key && value !== undefined) {
            container.environmentConfig.setGlobalVariable(key, value);
          } else if (action === 'unset' && key) {
            container.environmentConfig.deleteGlobalVariable(key);
          } else if (action === 'clear') {
            container.environmentConfig.clearGlobalVariables();
          }
        }
      };

      const session = container.scriptExecutor.createRequestSession(scriptContext);
      try {
        if (phase === 'post' && options?.response) {
          const postResult = await session.executePostResponse(sourceCode, options.response);
          const scriptVariables = postResult.localVariables ?? postResult.modifiedVariables;
          if (scriptVariables && typeof scriptVariables === 'object') {
            // Replace the flow snapshot so unset/clear operations do not leave stale keys.
            flowState.vars = { ...scriptVariables };
          }
        } else {
          const preResult = await session.executePreRequest(sourceCode);
          if (!preResult.success) {
            throw new Error(preResult.error || 'Script execution failed');
          }
          const scriptVariables = preResult.localVariables ?? preResult.modifiedVariables;
          if (scriptVariables && typeof scriptVariables === 'object') {
            // Replace the flow snapshot so unset/clear operations do not leave stale keys.
            flowState.vars = { ...scriptVariables };
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Suite ${phase}-script failed on node "${safeNodeName(node)}": ${message}`);
      } finally {
        session.dispose?.();
      }
    }

    function toFlatRequestRef(node: any): FlatRequestRef | undefined {
      const request = node?.type === 'request' && node?.request ? node.request : node;
      if (!request || typeof request !== 'object') {
        return undefined;
      }

      if (!request.collectionId || !request.requestId || !request.name) {
        return undefined;
      }

      return {
        collectionId: request.collectionId,
        requestId: request.requestId,
        name: request.name,
        folderPath: request.folderPath,
        enabled: request.enabled
      };
    }

    function isRequestNode(node: any): boolean {
      if (!node || typeof node !== 'object') {
        return false;
      }

      if (node.type === 'request') {
        return !!toFlatRequestRef(node);
      }

      return !!(node.collectionId && node.requestId && node.name);
    }

    function resolveChildren(node: any, keys: string[]): any[] {
      for (const key of keys) {
        const value = node?.[key];
        if (Array.isArray(value)) {
          return value;
        }
      }
      return [];
    }

    async function executeRequestRef(iter: number, req: FlatRequestRef, blockLabel?: string): Promise<void> {
      if (abortCtrl.signal.aborted) {
        return;
      }

      if (req.enabled === false) {
        return;
      }

      if (filter && !filter.some(f => req.name.toLowerCase().includes(f.toLowerCase()))) {
        return;
      }

      const collection = container.collection.getCollection(req.collectionId);
      if (!collection) {
        return;
      }

      const found = findRequestInCollection(collection, req.requestId);
      if (!found) {
        return;
      }

      // The loaded collection may be light (metadata only): hydrate heavy
      // fields (body/scripts) before executing. findRequest enriches on demand.
      const request = container.collection.findRequest(collection.id, req.requestId) ?? found.request;

      const effectiveAuth = resolveInheritedAuth(request.auth, found.folderAuthChain, collection.auth);

      const executor = new CollectionRequestExecutor(
        container.httpRequest,
        container.scriptExecutor,
        container.environmentConfig,
        container.requestPreparer,
        env,
        cookieJar,
        collection.scripts,
        found.folderScriptsChain,
        undefined,
        collection.name,
        collection.auth,
        iter,
        iterations,
        container.webSocketClient,
        container.socketIoClient
      );

      const execReq = applyOverrides(toExecutionRequest({ ...request, auth: effectiveAuth }), {
        headers: args.headers,
        query: args.query,
        body: args.body,
        variables: {
          ...flowState.vars,
          ...(args.variables as Record<string, unknown> | undefined)
        }
      });

      const result: ExecutionResult = await executor.execute(execReq, toStringRecord(flowState.vars), abortCtrl.signal);
      flowState.lastResult = result;

      if (result.modifiedVariables && typeof result.modifiedVariables === 'object') {
        // `modifiedVariables` is a full local snapshot from the script session.
        // Replace instead of merge to honor pm.variables/environment unset/clear.
        flowState.vars = { ...result.modifiedVariables };
      }

      const grouping = resolveResultGrouping({
        collectionName: collection.name,
        folderPath: req.folderPath ?? '',
        blockLabel
      });

      result.folderPath = req.folderPath ?? '';
      result.collectionName = collection.name;
      result.groupPath = grouping.groupPath;
      result.groupType = grouping.groupType;
      await resultStorage.saveResult(iter, result);

      if (!(result.assertions?.length)) {
        noAssertionNames.add(req.name);
      }

      if (result.passed) {
        totalPassed++;
      } else {
        totalFailed++;
      }

      if (include.includes('perRequest')) {
        perRequestResults.push({
          name: req.name,
          iteration: iter,
          status: result.response?.status,
          ok: isSuccessfulExecutionStatus(result.response?.status, execReq.requestType),
          duration: `${result.duration}ms`,
          allPassed: result.passed,
          ...(include.includes('consoleOutput') && result.consoleOutput?.length
            ? { consoleOutput: result.consoleOutput }
            : {})
        });
      }

      if (!result.passed) {
        failedResults.push({
          name: req.name,
          iteration: iter,
          method: result.executedRequest?.method,
          url: result.executedRequest?.url,
          requestBody: tryParseJson(result.executedRequest?.body?.content as string) ?? result.executedRequest?.body?.content ?? null,
          requestHeaders: redactHeaders(result.executedRequest?.headers ?? {}),
          status: result.response?.status,
          duration: `${result.duration}ms`,
          body: tryParseJson(result.response?.body),
          headers: getRedactedResponseHeaders(result.response?.headers),
          cookies: getRedactedCookies(result.response?.cookies),
          failedTests: result.assertions?.filter((a: any) => !a.passed).map((a: any) => ({
            name: a.name,
            ...(a.message ? { message: a.message } : {})
          })),
          ...(result.error ? { error: result.error } : {}),
          ...(include.includes('consoleOutput') && result.consoleOutput?.length
            ? { consoleOutput: result.consoleOutput }
            : {})
        });
        if (stopOnError) {
          abortCtrl.abort();
        }
      }

      if (delayMs > 0 && !abortCtrl.signal.aborted) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    async function executeNodes(iter: number, nodes: any[], blockLabel?: string): Promise<void> {
      for (const node of nodes) {
        if (abortCtrl.signal.aborted) {
          break;
        }
        await executeNode(iter, node, blockLabel);
      }
    }

    async function executeNode(iter: number, node: any, blockLabel?: string): Promise<void> {
      if (!node || typeof node !== 'object') {
        return;
      }

      if (node.enabled === false) {
        return;
      }

      if (!evaluateNodeCondition(node.condition, node, iter)) {
        return;
      }

      if (isRequestNode(node)) {
        const req = toFlatRequestRef(node);
        if (req) {
          await executeRequestRef(iter, req, blockLabel);
        }
        return;
      }

      const type = typeof node.type === 'string' ? node.type.toLowerCase() : '';
      const thenNodes = resolveChildren(node, ['then', 'nodes', 'body']);

      if (type === 'block') {
        const nextBlockLabel = typeof node.name === 'string' ? node.name.trim() : '';
        await executeNodes(iter, thenNodes, nextBlockLabel || blockLabel);
        return;
      }

      if (type === 'script') {
        const source = resolveNodeScriptSource(node);
        const phase = node.phase === 'post' ? 'post' : 'pre';
        await runNodeScript(source, node, iter, phase);
        return;
      }

      if (type === 'if') {
        const ifExpr = typeof node.if === 'string' ? node.if : node.condition;
        if (evaluateNodeCondition(ifExpr, node, iter)) {
          await executeNodes(iter, thenNodes, blockLabel);
          return;
        }

        if (Array.isArray(node.elseif)) {
          for (const branch of node.elseif) {
            if (evaluateNodeCondition(branch?.condition, branch, iter)) {
              await executeNodes(iter, resolveChildren(branch, ['then', 'nodes', 'body']), blockLabel);
              return;
            }
          }
        }

        await executeNodes(iter, resolveChildren(node, ['else', 'elseNodes']), blockLabel);
        return;
      }

      if (type === 'switch') {
        const switchValue = evaluateExpression(String(node.expression ?? ''), createExpressionContext(node, iter));

        if (Array.isArray(node.cases)) {
          for (const caseNode of node.cases) {
            const caseMatches = Object.prototype.hasOwnProperty.call(caseNode ?? {}, 'equals')
              ? caseNode.equals === switchValue
              : evaluateNodeCondition(caseNode?.condition, caseNode, iter);
            if (caseMatches) {
              await executeNodes(iter, resolveChildren(caseNode, ['then', 'nodes', 'body']), blockLabel);
              return;
            }
          }
        }

        await executeNodes(iter, resolveChildren(node, ['default', 'defaultNodes']), blockLabel);
        return;
      }

      if (type === 'while') {
        const loopCondition = typeof node.while === 'string' ? node.while : node.condition;
        const maxIterations = Math.max(1, Math.min(10_000, Number(node.maxIterations ?? maxNodeLoopIterations)));
        let count = 0;
        while (evaluateNodeCondition(loopCondition, node, iter)) {
          count += 1;
          if (count > maxIterations) {
            throw new Error(`Suite while loop exceeded maxIterations (${maxIterations}) on node "${safeNodeName(node)}"`);
          }
          await executeNodes(iter, thenNodes, blockLabel);
          if (abortCtrl.signal.aborted) {
            break;
          }
        }
        return;
      }

      if (type === 'for') {
        const maxIterations = Math.max(1, Math.min(10_000, Number(node.maxIterations ?? maxNodeLoopIterations)));
        const initScript = normalizeScript(node.init);
        const updateScript = normalizeScript(node.update);
        // loopCondition is the canonical field; fall back to legacy condition field for old suites
        const conditionExpr = typeof (node as any).loopCondition === 'string' && (node as any).loopCondition.trim()
          ? (node as any).loopCondition
          : typeof node.condition === 'string' && node.condition.trim()
            ? node.condition
            : 'true';

        if (initScript) {
          await runNodeScript(initScript, node, iter, 'pre');
        }

        let count = 0;
        while (evaluateNodeCondition(conditionExpr, node, iter)) {
          count += 1;
          if (count > maxIterations) {
            throw new Error(`Suite for loop exceeded maxIterations (${maxIterations}) on node "${safeNodeName(node)}"`);
          }

          await executeNodes(iter, thenNodes, blockLabel);
          if (abortCtrl.signal.aborted) {
            break;
          }

          if (updateScript) {
            await runNodeScript(updateScript, node, iter, 'post');
          }
        }
        return;
      }

      // Unknown node type with nested children: execute as a generic block.
      if (thenNodes.length > 0) {
        await executeNodes(iter, thenNodes, blockLabel);
      }
    }

    function countEligibleRequests(nodes: any[]): number {
      let count = 0;
      const stack = [...nodes];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node !== 'object' || node.enabled === false) {
          continue;
        }

        if (isRequestNode(node)) {
          const req = toFlatRequestRef(node);
          if (req && (!filter || filter.some(f => req.name.toLowerCase().includes(f.toLowerCase())))) {
            count += 1;
          }
          continue;
        }

        for (const key of ['nodes', 'then', 'body', 'else', 'elseNodes', 'default', 'defaultNodes']) {
          if (Array.isArray(node[key])) {
            stack.push(...node[key]);
          }
        }

        if (Array.isArray(node.elseif)) {
          for (const branch of node.elseif) {
            if (Array.isArray(branch?.nodes)) {
              stack.push(...branch.nodes);
            }
            if (Array.isArray(branch?.then)) {
              stack.push(...branch.then);
            }
          }
        }

        if (Array.isArray(node.cases)) {
          for (const caseNode of node.cases) {
            if (Array.isArray(caseNode?.nodes)) {
              stack.push(...caseNode.nodes);
            }
            if (Array.isArray(caseNode?.then)) {
              stack.push(...caseNode.then);
            }
          }
        }
      }
      return count;
    }

    const rootNodes: any[] = Array.isArray(suite.nodes)
      ? suite.nodes
      : Array.isArray(suite.requests)
        ? suite.requests.map((request: any) => ({ type: 'request', request }))
        : [];

    const eligibleRequestCount = countEligibleRequests(rootNodes);

    if (enforceMaxRequests) {
      const maxRequests = getDirectMaxRequestsLimit();
      const totalCalls = eligibleRequestCount * iterations;
      if (totalCalls > maxRequests) {
        throw new Error(
          `Suite "${suite.name}" would execute ${totalCalls} request calls (${eligibleRequestCount} requests × ` +
          `${iterations} iterations), which exceeds HTTP_FORGE_MAX_REQUESTS (${maxRequests}). ` +
          `Reduce iterations, use requestFilter, or increase HTTP_FORGE_MAX_REQUESTS.`
        );
      }
    }

    // Results are always persisted to disk so they are available for the VS Code
    // history view and on-demand report generation. The `--include report` flag
    // (or HTTP_FORGE_GENERATE_REPORTS) only controls HTML report generation.
    const resultStorage = new ResultStorageService(container.config);
    const runId = await resultStorage.initializeRun(
      suite.id,
      suite.name,
      env,
      { iterations, delayBetweenRequests: delayMs, stopOnError },
      {
        targetType: source === 'suite' ? 'suite' : 'collection',
        targetName: suite.name,
        collectionName: source === 'suite' ? undefined : (suite as any).collectionName,
        folderPath: source === 'suite' ? undefined : (suite as any).folderPath,
      }
    );

    const perRequestResults: object[] = [];
    const failedResults: object[] = [];
    let totalPassed = 0;
    let totalFailed = 0;
    // Set so duplicate names across iterations are counted only once
    const noAssertionNames = new Set<string>();

    const abortCtrl = new AbortController();
    const cookieJar = new InMemoryCookieJar();

    /**
     * Run one full iteration of the suite sequentially.
     * Each virtual user runs the complete request flow in order so that
     * inter-request dependencies (e.g. login → token → protected call) are
     * preserved. Concurrency means N independent VUs running in parallel, NOT
     * requests within a single flow running in parallel.
     */
    async function runIteration(iter: number): Promise<void> {
      await executeNodes(iter, rootNodes);
    }

    try {
      // Run iterations in concurrent batches of size `concurrency`.
      // Each iteration is a complete sequential run of the full request flow,
      // so inter-request dependencies (login → token → protected call) are
      // always respected within an iteration.
      for (let batchStart = 1; batchStart <= iterations; batchStart += concurrency) {
        if (abortCtrl.signal.aborted) break;
        const batchEnd = Math.min(batchStart + concurrency - 1, iterations);
        const batch = Array.from({ length: batchEnd - batchStart + 1 }, (_, i) => batchStart + i);
        await Promise.all(batch.map(runIteration));
      }
    } finally {
      // run finalization below
    }

    const reportPath = await resultStorage.finalizeRun('completed', generateReports);

    let junitPath: string | null = null;
    if (wantJUnit) {
      try {
        junitPath = await new JUnitReportGenerator(resultStorage.getBasePath()).generate(suite.id, runId);
      } catch (e) {
        console.warn('[direct-execution] JUnit report generation failed:', e);
      }
    }

    const summaryKey = source === 'collection' ? 'collection' : 'suite';

    // Compute latency percentiles from all stored results
    const currentStats = resultStorage.getCurrentStats();
    const stats = currentStats?.stats;
    const durationMs = stats
      ? {
          min: stats.minDuration,
          max: stats.maxDuration,
          avg: stats.avgDuration,
          p50: stats.p50 ?? null,
          p95: stats.p95 ?? null,
          p99: stats.p99 ?? null,
        }
      : null;

    const out: Record<string, unknown> = {
      [summaryKey]: suite.name,
      environment: env,
      summary: {
        total: totalPassed + totalFailed,
        passed: totalPassed,
        failed: totalFailed,
        ...(iterations > 1 ? { iterations } : {}),
        ...(concurrency > 1 ? { concurrency } : {}),
        allPassed: totalFailed === 0,
        ...(durationMs ? { durationMs } : {})
      }
    };

    if (totalFailed > 0 || include.includes('failedOnly')) {
      out.failedRequests = failedResults;
    }

    if (include.includes('perRequest')) {
      out.results = perRequestResults;
    }

    if (reportPath !== null) {
      out.report = {
        uri: `file://${reportPath}`,
        hint: 'Click the URI to open the HTML report in your browser'
      };
    }

    if (junitPath !== null) {
      out.junitReport = { path: junitPath };
    }

    // Suggest assertion prompts when requests have no pm.test() coverage
    if (noAssertionNames.size > 0) {
      const uniqueTotal = Math.max(eligibleRequestCount, 1);
      const noAssertCount = noAssertionNames.size;
      const examples = Array.from(noAssertionNames).slice(0, 5);
      out.noAssertionExamples = examples; // carried over to async record
      const suiteName = suite.name;
      if (noAssertCount / uniqueTotal > 0.5) {
        out._suggestions = [
          `${noAssertCount}/${uniqueTotal} requests have no pm.test() assertions. ` +
          `Invoke the "review-collection" prompt (collection="${suiteName}") ` +
          `for a full coverage analysis and to identify assertion gaps.`
        ];
      } else {
        const exampleList = examples.map((n) => `"${n}"`).join(', ');
        out._suggestions = [
          `${noAssertCount} request(s) have no pm.test() assertions: ${exampleList}. ` +
          `Invoke the "suggest-assertions" prompt (collection="${suiteName}") ` +
          `to generate test coverage for them.`
        ];
      }
    }

    return out;
  }
}
