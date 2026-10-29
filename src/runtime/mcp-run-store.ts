/**
 * MCP Async Run Store
 *
 * Shared in-memory store for async run records. Both the embedded core runtime
 * and the VS Code extension MCP server import this class so the record shape
 * and helper operations stay identical and there is only one implementation
 * to maintain.
 */

export interface McpRunRecord {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  suiteName: string;
  startedAt: number;
  completedAt?: number;
  progress: { completed: number; total: number };
  summary: { passed: number; failed: number; total: number; allPassed: boolean };
  failedRequests: object[];
  allResults: object[];
  reportPath: string | null;
  error?: string;
  /** Request names (unique) that ran without any pm.test() assertion */
  noAssertionExamples?: string[];
}

const RUN_TTL_MS = 60 * 60 * 1000; // 1 hour

export class McpRunStore {
  private readonly store = new Map<string, McpRunRecord>();

  newId(): string {
    return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Allocate a new record, register it, and return it. */
  create(label: string, totalRequests: number): McpRunRecord {
    this.prune();
    const record: McpRunRecord = {
      id: this.newId(),
      status: 'running',
      suiteName: label,
      startedAt: Date.now(),
      progress: { completed: 0, total: totalRequests },
      summary: { passed: 0, failed: 0, total: 0, allPassed: false },
      failedRequests: [],
      allResults: [],
      reportPath: null,
    };
    this.store.set(record.id, record);
    return record;
  }

  get(id: string): McpRunRecord | undefined {
    return this.store.get(id);
  }

  /**
   * Return the record for the supplied run id, throwing a descriptive error if
   * the id is missing, not a string, or has expired.
   */
  require(runId: unknown): McpRunRecord {
    if (typeof runId !== 'string' || !runId) {
      throw new Error('"runId" is required');
    }
    const rec = this.store.get(runId);
    if (!rec) {
      throw new Error(
        `Run "${runId}" not found. It may have expired (1-hour TTL) or never existed.`
      );
    }
    return rec;
  }

  /** Remove records older than the TTL. Called automatically before each create(). */
  prune(): void {
    const cutoff = Date.now() - RUN_TTL_MS;
    for (const [id, rec] of this.store) {
      if (rec.startedAt < cutoff) this.store.delete(id);
    }
  }

  /** Iterate all stored run records (non-expired). */
  values(): IterableIterator<McpRunRecord> {
    return this.store.values();
  }

  /**
   * Best-effort cancellation: mark a running run as 'cancelled' so that the
   * execution loop can detect it and skip remaining requests.
   *
   * Returns `true` when the status was changed; `false` if the run doesn't
   * exist, has already finished, or is in an unmodifiable state.
   */
  cancel(id: string): boolean {
    const rec = this.store.get(id);
    if (!rec || rec.status !== 'running') return false;
    rec.status = 'cancelled';
    rec.completedAt = Date.now();
    return true;
  }
}
