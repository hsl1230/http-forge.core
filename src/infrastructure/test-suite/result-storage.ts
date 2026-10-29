/**
 * Result Storage Interfaces for Test Suite
 *
 * SOLID Principles:
 * - Interface Segregation: Separate interfaces for different concerns
 * - Dependency Inversion: Define abstractions for storage operations
 */

import { ExecutionResult } from '../../types/types';

/**
 * HTTP Method encoding for memory efficiency
 * Using numbers instead of strings saves ~5 bytes per summary
 */
export const HTTP_METHOD_MAP: Record<string, number> = {
    'GET': 0, 'POST': 1, 'PUT': 2, 'DELETE': 3, 'PATCH': 4,
    'HEAD': 5, 'OPTIONS': 6, 'TRACE': 7, 'CONNECT': 8
};

export const HTTP_METHOD_REVERSE: Record<number, string> = {
    0: 'GET', 1: 'POST', 2: 'PUT', 3: 'DELETE', 4: 'PATCH',
    5: 'HEAD', 6: 'OPTIONS', 7: 'TRACE', 8: 'CONNECT'
};

/**
 * Compact Summary for memory efficiency (~150 bytes vs ~450 bytes)
 * Sent to webview during run - contains only essential display data
 */
export interface ResultSummary {
    /** Index within run (i) */
    i: number;
    /** Iteration 1-based (it) */
    it: number;
    /** Request name (n) */
    n: string;
    /** HTTP method code (m) - use HTTP_METHOD_REVERSE to decode */
    m: number;
    /** HTTP status code (s) */
    s: number;
    /** Duration in ms (d) */
    d: number;
    /** Passed (p) */
    p: boolean;
    /** Assertions passed count — excludes skipped (ap) */
    ap: number;
    /** Assertions failed count (af) */
    af: number;
    /** Assertions skipped via pm.test.skip() (as) — omitted when 0 */
    as?: number;
    /** Request ID (r) - used to rebuild filename */
    r: string;
    /** Error message if failed (e) - null if passed */
    e: string | null;
    /** Folder path (fp) - slash-separated; omitted/empty for root-level requests */
    fp?: string;
    /** Display group path (gp) - block label or folder path used for grouped results */
    gp?: string;
    /** Display grouping source (gt) - block label vs root-folder grouping */
    gt?: 'folder' | 'block';
    /** Collection name (cn) - omitted/empty when unknown */
    cn?: string;
}

/**
 * Build result filename from summary components
 */
export function buildResultFileName(index: number, iteration: number, requestId: string): string {
    const indexStr = String(index).padStart(6, '0');
    const iterStr = String(iteration).padStart(4, '0');
    return `result-${indexStr}-iter-${iterStr}-${requestId}.json`;
}

/**
 * Helper to decode ResultSummary for display
 */
export function expandSummary(s: ResultSummary): {
    index: number;
    iteration: number;
    name: string;
    method: string;
    status: number;
    duration: number;
    passed: boolean;
    assertionsPassed: number;
    assertionsFailed: number;
    requestId: string;
    resultFile: string;
    error: string | null;
} {
    return {
        index: s.i,
        iteration: s.it,
        name: s.n,
        method: HTTP_METHOD_REVERSE[s.m] || 'GET',
        status: s.s,
        duration: s.d,
        passed: s.p,
        assertionsPassed: s.ap,
        assertionsFailed: s.af,
        requestId: s.r,
        resultFile: buildResultFileName(s.i, s.it, s.r),
        error: s.e
    };
}

/**
 * Per-request aggregated statistics
 */
export interface RequestStats {
    /** Request name */
    name: string;
    /** Total executions */
    count: number;
    /** Passed executions */
    passed: number;
    /** Failed executions */
    failed: number;
    /** Total duration for averaging */
    totalDuration: number;
    /** Average duration */
    avgDuration: number;
    /** Minimum duration */
    minDuration: number;
    /** Maximum duration */
    maxDuration: number;
    /** 50th percentile */
    p50?: number;
    /** 90th percentile */
    p90?: number;
    /** 95th percentile */
    p95?: number;
    /** 99th percentile */
    p99?: number;
}

/**
 * Overall run statistics
 */
export interface RunStats {
    /** Total requests executed */
    totalRequests: number;
    /** Passed requests */
    passed: number;
    /** Failed requests */
    failed: number;
    /** Skipped requests */
    skipped: number;
    /** Total duration */
    totalDuration: number;
    /** Average duration */
    avgDuration: number;
    /** Minimum duration */
    minDuration: number;
    /** Maximum duration */
    maxDuration: number;
    /** 50th percentile latency across all requests */
    p50?: number;
    /** 95th percentile latency across all requests */
    p95?: number;
    /** 99th percentile latency across all requests */
    p99?: number;
}

/**
 * Run configuration stored in manifest
 */
export interface RunConfig {
    /** Number of iterations */
    iterations: number;
    /** Delay between requests in ms */
    delayBetweenRequests: number;
    /** Whether to stop on error */
    stopOnError: boolean;
}

/**
 * Run manifest (metadata only - kept small)
 */
export interface RunManifest {
    /** Schema version */
    version: string;
    /** Unique run ID */
    runId: string;
    /** Suite ID */
    suiteId: string;
    /** Suite name */
    suiteName: string;
    /** What kind of target produced the run */
    targetType?: 'suite' | 'collection' | 'folder';
    /** Human-readable target label */
    targetName?: string;
    /** Collection name for collection/folder runs */
    collectionName?: string;
    /** Folder path for folder runs */
    folderPath?: string;
    /** Environment used */
    environment: string;
    /** Run start time */
    startTime: string;
    /** Run end time */
    endTime?: string;
    /** Run status */
    status: 'running' | 'completed' | 'aborted' | 'error';
    /** Run configuration */
    config: RunConfig;
    /** Aggregated statistics */
    stats: RunStats;
    /** Per-request statistics */
    requestStats: Record<string, RequestStats>;
    /** Total index pages */
    totalIndexPages: number;
    /** Summaries per index page */
    indexPageSize: number;
}

/**
 * Full result details (loaded on demand from file)
 */
export interface FullResultDetails {
    /** Result index */
    index: number;
    /** Iteration number */
    iteration: number;
    /** Request ID */
    requestId: string;
    /** Request name */
    name: string;
    /** HTTP method */
    method: string;
    /** Full URL */
    url: string;
    /** Folder path within the collection (slash-separated; empty for root) */
    folderPath?: string;
    /** Display group path used by suite results (block label or folder path) */
    groupPath?: string;
    /** Display grouping source used by suite results */
    groupType?: 'folder' | 'block';
    /** Name of the collection this request belongs to */
    collectionName?: string;
    /** HTTP status code */
    status: number;
    /** HTTP status text */
    statusText: string;
    /** Duration in milliseconds */
    duration: number;
    /** Whether request passed */
    passed: boolean;
    /** Execution timestamp */
    timestamp: number;
    /** Request details */
    request: {
        method: string;
        url: string;
        headers: Record<string, string>;
        query: Record<string, string>;
        params: Record<string, string>;
        body: {
            type: string;
            format?: string;
            content: any;
        };
    };
    /** Response details */
    response: {
        headers: Record<string, string | string[]>;
        body: any;
        time?: number;
        size?: number;
        cookies?: Array<{ name?: string; value?: string }>;
    };
    /** Test assertions */
    assertions: Array<{
        name: string;
        passed: boolean;
        message: string | null;
        /** True when explicitly skipped via pm.test.skip() */
        skipped?: boolean;
    }>;
    /** Error message */
    error: string | null;
    /** Console output produced while running the request */
    consoleOutput?: string[];
    /** Variables modified by pre/post scripts */
    modifiedVariables?: Record<string, string>;
    /** Environment variables modified by scripts */
    modifiedEnvironmentVariables?: Record<string, string>;
    /** Collection variables modified by scripts */
    modifiedCollectionVariables?: Record<string, string>;
    /** pm.execution.setNextRequest() value */
    nextRequest?: string | null;
    /** pm.visualizer.set() payload */
    visualizerData?: { template: string; data?: any };
}

/**
 * Index page containing summaries
 */
export interface IndexPage {
    /** Page number (1-based) */
    page: number;
    /** Starting index */
    startIndex: number;
    /** Number of summaries in this page */
    count: number;
    /** Summaries */
    summaries: ResultSummary[];
}

/**
 * Recent error for UI display
 */
export interface RecentError {
    /** Timestamp */
    timestamp: number;
    /** Iteration number */
    iteration: number;
    /** Request name */
    requestName: string;
    /** HTTP status */
    status: number;
    /** Error message */
    error: string;
    /** Result file reference */
    resultFile: string;
}

/**
 * Result Storage Service Interface
 * Single Responsibility: Defines contract for result persistence
 */
export interface IResultStorageService {
    /**
     * Get the base path for result storage
     */
    getBasePath(): string;

    /**
     * Initialize a new run
     */
    initializeRun(
        suiteId: string,
        suiteName: string,
        environment: string,
        config: RunConfig,
        metadata?: {
            targetType?: 'suite' | 'collection' | 'folder';
            targetName?: string;
            collectionName?: string;
            folderPath?: string;
        }
    ): Promise<string>;

    /**
     * Save a request result
     * Returns lightweight summary for UI
     */
    saveResult(iteration: number, result: ExecutionResult): Promise<ResultSummary>;

    /**
     * Finalize run
     * @param status final run status
     * @param generateHtmlReport when false, the run is persisted (manifest + results)
     *        but the HTML report is not generated; returns null in that case
     * @returns path to the generated HTML report, or null if not generated / generation failed
     */
    finalizeRun(status: 'completed' | 'aborted' | 'error', generateHtmlReport?: boolean): Promise<string | null>;

    /**
     * Regenerate (or generate for the first time) the HTML report for a completed run.
     * Safe to call after finalizeRun; does not require an active run.
     * @returns absolute path to the report file, or null if generation failed
     */
    regenerateHtmlReport(suiteId: string, runId: string): Promise<string | null>;

    /**
     * Generate a JUnit XML report for a completed run.
     * Uses the persisted run artifacts (manifest + index pages + result files).
     * @returns absolute path to the written junit.xml, or null if generation failed
     */
    generateJunitReport(suiteId: string, runId: string): Promise<string | null>;

    /**
     * Generate a JUnit XML report for a completed run.
     * @returns absolute path to the written junit.xml, or null if generation failed
     */
    generateJunitReport(suiteId: string, runId: string): Promise<string | null>;

    /**
     * Get current run stats
     */
    getCurrentStats(): {
        stats: RunStats;
        requestStats: Record<string, RequestStats>;
        recentErrors: RecentError[]
    } | null;

    /**
     * Get current run ID
     */
    getCurrentRunId(): string | null;

    /**
     * Get current suite ID
     */
    getCurrentSuiteId(): string | null;

    /**
     * Get full result details from file
     */
    getResultDetails(
        suiteId: string,
        runId: string,
        resultFile: string
    ): Promise<FullResultDetails>;

    /**
     * Get index page
     */
    getIndexPage(
        suiteId: string,
        runId: string,
        page: number
    ): Promise<IndexPage>;

    /**
     * Get run manifest
     */
    getManifest(suiteId: string, runId: string): Promise<RunManifest>;

    /**
     * List all runs for a suite
     */
    listRuns(suiteId: string): Promise<RunManifest[]>;

    /**
     * Delete a run
     */
    deleteRun(suiteId: string, runId: string): Promise<void>;

    /**
     * Clean up old runs based on retention policy
     */
    cleanupOldRuns(): Promise<{ deleted: number; freed: number }>;
}
