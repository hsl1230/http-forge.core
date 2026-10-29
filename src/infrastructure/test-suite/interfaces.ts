/**
 * Test Suite Interfaces
 * 
 * Defines data structures for Test Suite functionality
 */

/**
 * Request reference within a Test Suite
 * References a request from a Collection with an optional embedded snapshot.
 * When a slug is present, request data lives in the suite's folder structure.
 */
export interface SuiteRequest {
    /** Folder slug (directory name) within the suite — required for folder-based suites */
    slug?: string;
    /** Collection ID where the request lives */
    collectionId: string;
    /** Collection name for display purposes */
    collectionName: string;
    /** Request ID within the collection */
    requestId: string;
    /** Cached display info (avoid querying collection each time) */
    name: string;
    method: string;
    folderPath: string;
    /** Whether this request is enabled for execution */
    enabled?: boolean;
    /** Optional description of what this request does in the suite */
    description?: string;
}

/**
 * Base properties for suite flow nodes.
 */
export interface SuiteFlowNodeBase {
    /** Optional stable node id */
    id?: string;
    /** Optional display label */
    name?: string;
    /** Whether this node is enabled */
    enabled?: boolean;
    /** JavaScript boolean expression evaluated before entering the node */
    condition?: string;
}

export interface SuiteRequestNode extends SuiteFlowNodeBase {
    type: 'request';
    request: SuiteRequest;
    /** Inline post-response script executed after the request completes. */
    postResponseScript?: string[];
}

export interface SuiteBlockNode extends SuiteFlowNodeBase {
    type: 'block';
    nodes: SuiteFlowNode[];
}

export interface SuiteElseIfBranch {
    condition: string;
    nodes: SuiteFlowNode[];
}

export interface SuiteIfNode extends SuiteFlowNodeBase {
    type: 'if';
    if: string;
    then: SuiteFlowNode[];
    elseif?: SuiteElseIfBranch[];
    else?: SuiteFlowNode[];
}

export interface SuiteSwitchCase {
    /** If provided, this case matches when `equals === switchExpressionResult` */
    equals?: unknown;
    /** Optional boolean expression when equals is omitted */
    condition?: string;
    nodes: SuiteFlowNode[];
}

export interface SuiteSwitchNode extends SuiteFlowNodeBase {
    type: 'switch';
    expression: string;
    cases: SuiteSwitchCase[];
    default?: SuiteFlowNode[];
}

export interface SuiteForNode extends SuiteFlowNodeBase {
    type: 'for';
    init?: string | string[];
    /** Loop continuation expression. Distinct from `condition` (guard) on SuiteFlowNodeBase. */
    loopCondition?: string;
    update?: string | string[];
    nodes: SuiteFlowNode[];
    maxIterations?: number;
}

export interface SuiteWhileNode extends SuiteFlowNodeBase {
    type: 'while';
    while: string;
    nodes: SuiteFlowNode[];
    maxIterations?: number;
}

export interface SuiteScriptNode extends SuiteFlowNodeBase {
    type: 'script';
    /** Inline script source */
    script?: string | string[];
    /** Reusable script key from TestSuite.scripts */
    scriptRef?: string;
    /** Optional phase hint. Defaults to 'pre'. */
    phase?: 'pre' | 'post';
}

export type SuiteFlowNode =
    | SuiteRequestNode
    | SuiteBlockNode
    | SuiteIfNode
    | SuiteSwitchNode
    | SuiteForNode
    | SuiteWhileNode
    | SuiteScriptNode;

/**
 * Test Suite run configuration
 */
export interface SuiteConfig {
    /** Number of iterations to run */
    iterations: number;
    /** Delay between requests in milliseconds */
    delayBetweenRequests: number;
    /** Stop execution on first error */
    stopOnError: boolean;
    /** Read variables from shared session */
    readFromSharedSession: boolean;
    /** Write variables to shared session */
    writeToSharedSession: boolean;
    /** Data file path for variable injection */
    dataFilePath?: string;
}

/**
 * Raw shape of a suite.json file on disk — includes the deprecated `requests`
 * field that may be present in legacy files. Never used as an in-memory model.
 */
export interface LegacySuiteFileData {
    id: string;
    name: string;
    description?: string;
    /** @deprecated Legacy flat list — migrated to `nodes` on load. */
    requests?: SuiteRequest[];
    scripts?: Record<string, string | string[]>;
    nodes?: SuiteFlowNode[];
    config?: SuiteConfig;
    isTemporary?: boolean;
    createdAt?: number;
    updatedAt?: number;
    [key: string]: unknown;
}

/**
 * Test Suite definition — in-memory model only.
 * `requests` never appears here; legacy files are migrated to `nodes` on load.
 */
export interface TestSuite {
    /** Unique identifier */
    id: string;
    /** Suite name */
    name: string;
    /** Optional description */
    description?: string;
    /**
     * Optional reusable script library addressable by `scriptRef` from flow nodes.
     */
    scripts?: Record<string, string | string[]>;
    /**
     * Control-flow graph — the primary and only execution model.
     */
    nodes: SuiteFlowNode[];
    /** Run configuration */
    config: SuiteConfig;
    /** Whether this is a temporary suite (not saved) */
    isTemporary?: boolean;
    /** Phase 2a/2b drift hook: true when generated from discovery, not hand-written */
    ai_generated?: boolean;
    /** Phase 2a/2b drift hook: endpoint ids this suite was derived from */
    derived_from?: string[];
    /** Creation timestamp */
    createdAt: number;
    /** Last update timestamp */
    updatedAt: number;
}

/**
 * Per-request statistics
 */
export interface RequestStatistics {
    /** Unique identity key for this request in statistics */
    key: string;
    /** Request name */
    name: string;
    /** Number of executions */
    count: number;
    /** Number of passed executions */
    passed: number;
    /** Number of failed executions */
    failed: number;
    /** Number of skipped executions */
    skipped: number;
    /** Minimum response time (ms) */
    min: number;
    /** Maximum response time (ms) */
    max: number;
    /** Average response time (ms) */
    avg: number;
    /** 50th percentile (median) */
    p50: number;
    /** 90th percentile */
    p90: number;
    /** 95th percentile */
    p95: number;
    /** 99th percentile */
    p99: number;
    /** Raw duration data for recalculation */
    durations: number[];
}

/**
 * Run statistics summary
 */
export interface RunSummary {
    /** Total requests executed */
    totalRequests: number;
    /** Number of passed requests */
    passed: number;
    /** Number of failed requests */
    failed: number;
    /** Number of skipped requests */
    skipped: number;
    /** Pass rate percentage */
    passRate: number;
    /** Total duration in milliseconds */
    duration: number;
    /** Whether run is still in progress */
    isRunning: boolean;
}

/**
 * Error summary entry
 */
export interface ErrorSummary {
    /** Error message or status */
    message: string;
    /** Number of occurrences */
    count: number;
}

/**
 * Complete run statistics
 */
export interface RunStatistics {
    /** Summary statistics */
    summary: RunSummary;
    /** Statistics grouped by request identity key */
    byRequest: Map<string, RequestStatistics>;
    /** Overall statistics across all requests */
    overall: RequestStatistics;
    /** Error summary */
    errors: ErrorSummary[];
}

/**
 * Test Suite Service Interface
 */
export interface ITestSuiteService {
    // CRUD operations
    createSuite(name: string): Promise<TestSuite>;
    getSuite(id: string): Promise<TestSuite | undefined>;
    getAllSuites(): Promise<TestSuite[]>;
    updateSuite(suite: TestSuite): Promise<void>;
    deleteSuite(id: string): Promise<boolean>;
    
    // Utility methods
    duplicateSuite(sourceId: string, newName: string): Promise<TestSuite>;
    createTempSuiteFromCollection(collectionId: string): Promise<TestSuite | undefined>;
    createTempSuiteFromFolder(collectionId: string, folderPath: string, recursive?: boolean): Promise<TestSuite | undefined>;
    createTempSuiteFromRequest(collectionId: string, requestId: string): Promise<TestSuite | undefined>;
    saveTempSuite(suite: TestSuite, name: string): Promise<TestSuite>;
}

/**
 * Statistics Service Interface
 */
export interface IStatisticsService {
    /** Add a result and update statistics */
    addResult(requestKey: string, requestName: string, duration: number, passed: boolean, skipped: boolean, error?: string): void;
    
    /** Get current statistics */
    getStatistics(): RunStatistics;
    
    /** Reset statistics for a new run */
    reset(): void;
    
    /** Mark run as complete */
    complete(): void;
    
    /** Set start time for duration tracking */
    start(): void;
}

/**
 * Default suite configuration
 */
export const DEFAULT_SUITE_CONFIG: SuiteConfig = {
    iterations: 1,
    delayBetweenRequests: 0,
    stopOnError: false,
    readFromSharedSession: false,
    writeToSharedSession: false
};
