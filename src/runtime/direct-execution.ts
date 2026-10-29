/**
 * Direct Execution APIs
 * 
 * Execute requests, collections, and suites without requiring MCP server.
 * Uses shared execution logic from core executors.
 * 
 * This module is intentionally thin: it holds only the public entry points
 * (`runRequest` / `runCollection` / `runFolder` / `runSuite`) plus the
 * collection/folder resolution glue. The heavy lifting lives in:
 * - `suite-executor.ts` — the suite node-graph flow engine
 * - `execution-helpers.ts` — request conversion, overrides, auth, redaction
 * - `collection-traversal.ts` — collection tree walking
 * 
 * Used by:
 * - CLI commands (run-request, run-collection, run-suite)
 * - Third-party Node apps that want to execute HTTP Forge collections programmatically
 */

import type { ServiceContainer } from '../di/service-container';
import { InMemoryCookieJar } from '../infrastructure/cookie/in-memory-cookie-jar';
import { CollectionRequestExecutor } from '../infrastructure/execution/collection-request-executor';
import { JUnitReportGenerator } from '../infrastructure/test-suite/junit-report-generator';
import { ResultStorageService } from '../infrastructure/test-suite/result-storage-service';
import type { Collection } from '../types/collection';
import type { ExecutionResult } from '../types/types';
import {
  findRequestInCollection,
  filterByFolderPath,
  flattenCollection,
  slugifyFolderPath,
} from './collection-traversal';
import {
  applyOverrides,
  disposeContainerResources,
  getRedactedCookies,
  getRedactedResponseHeaders,
  isSuccessfulExecutionStatus,
  resolveInheritedAuth,
  sanitizeIdPart,
  shouldGenerateReports,
  toExecutionRequest,
  toStringRecord,
  tryParseJson,
} from './execution-helpers';
import { createNodeContainer } from './node-bootstrap';
import type { ResolutionInfo } from './ref-resolver';
import {
  resolveCollectionRef,
  resolveFolderRef,
  resolveRequestRef,
} from './ref-resolver';
import { resolveResultGrouping } from './result-grouping';
import type {
  RunCollectionOptions,
  RunRequestOptions,
  RunSuiteOptions
} from './runtime-contracts';
import { SuiteExecutor } from './suite-executor';

/**
 * Resolve the target collection from run options, accepting either an exact
 * `collectionId` or a `collectionRef` (id/slug/name). Reports ref resolution
 * via `onResolve`.
 */
function resolveCollectionForRun(
  collectionService: ServiceContainer['collection'],
  options: {
    collectionId?: string;
    collectionRef?: string;
    onResolve?: (info: ResolutionInfo) => void;
  }
): Collection {
  if (options.collectionId) {
    const collection = collectionService.getCollection(options.collectionId);
    if (!collection) {
      throw new Error(`Collection "${options.collectionId}" not found`);
    }
    return collection;
  }

  if (options.collectionRef) {
    const { collection, tier } = resolveCollectionRef(
      collectionService.getAllCollections(),
      options.collectionRef
    );
    options.onResolve?.({ kind: 'collection', value: options.collectionRef, tier, id: collection.id });
    return collection;
  }

  throw new Error('A collection reference is required (collectionId or collectionRef)');
}

/**
 * Resolve the optional folder scope from run options, accepting either an exact
 * `folderPath` (folder names) or a `folderRef` (id/slug/name slash path).
 * Returns the folder-name path or undefined when no folder scope is given.
 */
function resolveFolderForRun(
  collection: Collection,
  options: {
    folderPath?: string;
    folderRef?: string;
    onResolve?: (info: ResolutionInfo) => void;
  }
): string | undefined {
  if (options.folderPath) {
    return options.folderPath;
  }
  if (options.folderRef) {
    const { folderPath } = resolveFolderRef(collection, options.folderRef);
    options.onResolve?.({ kind: 'folder', value: options.folderRef, tier: 'name', id: folderPath, path: folderPath });
    return folderPath;
  }
  return undefined;
}

/**
 * Execute a single request without MCP server overhead.
 * Returns typed result; never calls process.exit.
 */
export async function runRequest(options: RunRequestOptions): Promise<unknown> {
  const container = createNodeContainer(options.workspaceFolder);
  const include = options.include ?? [];
  const reporters = options.reporters ?? [];
  const wantJUnit = reporters.includes('junit');
  const generateReports = shouldGenerateReports(include, reporters);

  try {
    const collectionService = container.collection;
    const collection = resolveCollectionForRun(collectionService, options);

    // Resolve optional folder scope (narrows request name resolution).
    const folderScope = resolveFolderForRun(collection, options);

    let requestId = options.requestId;
    if (!requestId) {
      if (!options.requestRef) {
        throw new Error('A request reference is required (requestId or requestRef)');
      }
      const resolved = resolveRequestRef(collection, options.requestRef, folderScope);
      requestId = resolved.request.id;
      options.onResolve?.({
        kind: 'request',
        value: options.requestRef,
        tier: resolved.tier,
        id: requestId,
        path: resolved.folderPath ? `${resolved.folderPath}/${resolved.request.name}` : resolved.request.name,
      });
    }

    const found = findRequestInCollection(collection, requestId);
    if (!found) {
      throw new Error(`Request "${requestId}" not found in collection "${collection.name}"`);
    }
    // The loaded collection may be light (metadata only): hydrate heavy
    // fields (body/scripts) before executing. findRequest enriches on demand.
    const hydrated = collectionService.findRequest(collection.id, requestId);
    const request = hydrated ?? found.request;

    const effectiveAuth = resolveInheritedAuth(request.auth, found.folderAuthChain, collection.auth);

    const env = options.environment || container.environmentConfig.getSelectedEnvironment();
    const execReq = applyOverrides(toExecutionRequest({ ...request, auth: effectiveAuth }), {
      headers: options.headers,
      query: options.query,
      body: options.body,
      variables: options.variables
    });

    const executor = new CollectionRequestExecutor(
      container.httpRequest,
      container.scriptExecutor,
      container.environmentConfig,
      container.requestPreparer,
      env,
      new InMemoryCookieJar(),
      collection.scripts,
      found.folderScriptsChain,
      undefined,
      collection.name,
      collection.auth,
      undefined,
      undefined,
      container.webSocketClient,
      container.socketIoClient
    );

    const result: ExecutionResult = await executor.execute(execReq, toStringRecord(options.variables));

    const grouping = resolveResultGrouping({
      collectionName: collection.name,
      folderPath: found.folderPath,
    });

    result.folderPath = found.folderPath;
    result.collectionName = collection.name;
    result.groupPath = grouping.groupPath;
    result.groupType = grouping.groupType;

    let reportPath: string | null = null;
    let junitPath: string | null = null;
    if (generateReports || wantJUnit) {
      const resultStorage = new ResultStorageService(container.config);
      const suiteId = `request-${sanitizeIdPart(collection.id)}-${sanitizeIdPart(requestId)}`;
      const suiteName = `Request: ${found.request.name}`;

      const runId = await resultStorage.initializeRun(
        suiteId,
        suiteName,
        env,
        { iterations: 1, delayBetweenRequests: 0, stopOnError: true },
        {
          targetType: 'collection',
          targetName: collection.name,
          collectionName: collection.name,
          folderPath: found.folderPath || undefined,
        }
      );
      await resultStorage.saveResult(1, result);
      reportPath = await resultStorage.finalizeRun('completed', generateReports);

      if (wantJUnit) {
        try {
          junitPath = await new JUnitReportGenerator(resultStorage.getBasePath()).generate(suiteId, runId);
        } catch (e) {
          console.warn('[direct-execution] JUnit report generation failed:', e);
        }
      }
    }

    const responseHeaders = getRedactedResponseHeaders(result.response?.headers);
    const responseCookies = getRedactedCookies(result.response?.cookies);

    return {
      request: found.request.name,
      status: result.response?.status || 0,
      ok: isSuccessfulExecutionStatus(result.response?.status, execReq.requestType),
      duration: `${result.duration}ms`,
      body: tryParseJson(result.response?.body),
      allPassed: result.passed,
      assertions: result.assertions?.map(a => ({ name: a.name, passed: a.passed, message: a.message })),
      ...(include.includes('headers') ? { headers: responseHeaders } : {}),
      ...(include.includes('cookies') ? { cookies: responseCookies } : {}),
      ...(include.includes('tests')
        ? {
          tests: result.assertions?.map(a => ({
            name: a.name,
            passed: a.passed,
            ...(a.message ? { message: a.message } : {})
          }))
        }
        : {}),
      ...(Object.keys(result.modifiedVariables ?? {}).length ? { modifiedVariables: result.modifiedVariables } : {}),
      ...(include.includes('consoleOutput') && result.consoleOutput?.length
        ? { consoleOutput: result.consoleOutput }
        : {}),
      ...(reportPath !== null
        ? {
          report: {
            uri: `file://${reportPath}`,
            hint: 'Click the URI to open the HTML report in your browser'
          }
        }
        : {}),
      ...(junitPath !== null ? { junitReport: { path: junitPath } } : {}),
      ...(result.error ? { error: result.error } : {})
    };
  } catch (err) {
    throw err;
  } finally {
    disposeContainerResources(container);
  }
}

/**
 * Execute a collection without MCP server overhead.
 * Runs all enabled requests in sequence.
 * Returns typed result; never calls process.exit.
 */
export async function runCollection(options: RunCollectionOptions): Promise<unknown> {
  const container = createNodeContainer(options.workspaceFolder);

  try {
    const collectionService = container.collection;
    const collection = resolveCollectionForRun(collectionService, options);

    const folderPath = resolveFolderForRun(collection, options);

    const flat = flattenCollection(collection);
    const scoped = filterByFolderPath(flat, folderPath, options.recursive);

    if (scoped.length === 0) {
      if (folderPath) {
        throw new Error(
          `No requests found under folder "${folderPath}" in collection "${collection.name}"`
        );
      }
      // Empty collection: fall through with no requests (executeSuite handles it).
    }

    const suiteRequests = scoped.map(({ request, folderPath: fp }) => ({
      id: request.id,
      slug: request.id.toLowerCase().replace(/\s+/g, '-'),
      collectionId: collection.id,
      requestId: request.id,
      name: request.name,
      method: request.method,
      collectionName: collection.name,
      folderPath: fp,
      enabled: true
    }));

    const tempSuite = {
      id: folderPath
        ? `temp-${collection.id}-${slugifyFolderPath(folderPath)}`
        : `temp-${collection.id}`,
      name: folderPath
        ? `${collection.name} / ${folderPath}`
        : collection.name,
      requests: suiteRequests,
      config: {
        iterations: 1,
        delay: 0,
        stopOnError: options.stopOnError ?? false,
        readFromSharedSession: false,
        writeToSharedSession: false
      },
      isTemporary: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    return new SuiteExecutor(container).execute(tempSuite, {
      environment: options.environment,
      iterations: options.iterations,
      stopOnError: options.stopOnError,
      delay: options.delay,
      requestFilter: undefined,
      include: options.include,
      reporters: options.reporters,
      concurrency: options.concurrency,
      variables: options.variables
    }, 'collection');
  } catch (err) {
    throw err;
  } finally {
    disposeContainerResources(container);
  }
}

/**
 * Execute the requests under a specific folder of a collection without MCP
 * server overhead. Thin wrapper over {@link runCollection} that scopes the run
 * to `options.folderPath` (recursively by default). Returns the same result
 * shape as a collection run.
 */
export async function runFolder(
  options: RunCollectionOptions & ({ folderPath: string } | { folderRef: string })
): Promise<unknown> {
  return runCollection({ recursive: true, ...options });
}

/**
 * Execute a test suite without MCP server overhead.
 * Returns typed result; never calls process.exit.
 */
export async function runSuite(options: RunSuiteOptions): Promise<unknown> {
  const container = createNodeContainer(options.workspaceFolder);

  try {
    const testSuiteService = container.testSuite;
    const suite = await testSuiteService.getSuite(options.suiteId);

    if (!suite) {
      throw new Error(`Test suite "${options.suiteId}" not found`);
    }

    return new SuiteExecutor(container).execute(suite, {
      environment: options.environment,
      iterations: options.iterations,
      stopOnError: options.stopOnError,
      delay: options.delay,
      requestFilter: options.requestFilter,
      include: options.include,
      reporters: options.reporters,
      concurrency: options.concurrency,
      variables: options.variables
    }, 'suite');
  } catch (err) {
    throw err;
  } finally {
    disposeContainerResources(container);
  }
}
