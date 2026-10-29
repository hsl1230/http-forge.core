/**
 * Statistics Service
 * 
 * Real-time statistics calculation for Test Suite runs
 * Calculates P50, P90, P95, P99 percentiles
 */

import {
    ErrorSummary,
    IStatisticsService,
    RequestStatistics,
    RunStatistics,
    RunSummary
} from './interfaces';

/**
 * Calculate percentile from sorted array
 */
function calculatePercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)];
}

/**
 * Create empty request statistics
 */
function createEmptyRequestStats(key: string, name: string): RequestStatistics {
    return {
        key,
        name,
        count: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        durations: []
    };
}

/**
 * Recalculate statistics from durations array
 */
function recalculateStats(stats: RequestStatistics): void {
    if (stats.durations.length === 0) {
        stats.min = 0;
        stats.max = 0;
        stats.avg = 0;
        stats.p50 = 0;
        stats.p90 = 0;
        stats.p95 = 0;
        stats.p99 = 0;
        return;
    }

    const sorted = [...stats.durations].sort((a, b) => a - b);
    const sum = stats.durations.reduce((a, b) => a + b, 0);

    stats.min = sorted[0];
    stats.max = sorted[sorted.length - 1];
    stats.avg = Math.round(sum / stats.durations.length);
    stats.p50 = calculatePercentile(sorted, 50);
    stats.p90 = calculatePercentile(sorted, 90);
    stats.p95 = calculatePercentile(sorted, 95);
    stats.p99 = calculatePercentile(sorted, 99);
}

/**
 * Service for calculating real-time run statistics
 */
export class StatisticsService implements IStatisticsService {
    private summary: RunSummary;
    private byRequest: Map<string, RequestStatistics>;
    private overall: RequestStatistics;
    private errors: Map<string, number>;
    private startTime: number = 0;

    constructor() {
        this.summary = this.createEmptySummary();
        this.byRequest = new Map();
        this.overall = createEmptyRequestStats('overall', 'Overall');
        this.errors = new Map();
    }

    /**
     * Create empty summary
     */
    private createEmptySummary(): RunSummary {
        return {
            totalRequests: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            passRate: 0,
            duration: 0,
            isRunning: false
        };
    }

    /**
     * Start a new run
     */
    public start(): void {
        this.startTime = Date.now();
        this.summary.isRunning = true;
    }

    /**
     * Reset statistics for a new run
     */
    public reset(): void {
        this.summary = this.createEmptySummary();
        this.byRequest.clear();
        this.overall = createEmptyRequestStats('overall', 'Overall');
        this.errors.clear();
        this.startTime = 0;
    }

    /**
     * Mark run as complete
     */
    public complete(): void {
        this.summary.isRunning = false;
        if (this.startTime > 0) {
            this.summary.duration = Date.now() - this.startTime;
        }
    }

    /**
     * Add a result and update statistics
     */
    public addResult(
        requestKey: string,
        requestName: string, 
        duration: number, 
        passed: boolean, 
        skipped: boolean,
        error?: string
    ): void {
        // Update summary
        this.summary.totalRequests++;
        if (skipped) {
            this.summary.skipped++;
        } else if (passed) {
            this.summary.passed++;
        } else {
            this.summary.failed++;
        }

        // Calculate pass rate (excluding skipped)
        const executed = this.summary.passed + this.summary.failed;
        this.summary.passRate = executed > 0 
            ? Math.round((this.summary.passed / executed) * 1000) / 10 
            : 0;

        // Update duration
        if (this.startTime > 0) {
            this.summary.duration = Date.now() - this.startTime;
        }

        // Skip duration tracking for skipped requests
        if (skipped) {
            return;
        }

        // Get or create per-request stats
        if (!this.byRequest.has(requestKey)) {
            this.byRequest.set(requestKey, createEmptyRequestStats(requestKey, requestName));
        }
        const reqStats = this.byRequest.get(requestKey)!;
        // Keep display name fresh if a caller updates labels.
        reqStats.name = requestName;

        // Update per-request stats
        reqStats.count++;
        if (passed) {
            reqStats.passed++;
        } else {
            reqStats.failed++;
        }
        reqStats.durations.push(duration);
        recalculateStats(reqStats);

        // Update overall stats
        this.overall.count++;
        if (passed) {
            this.overall.passed++;
        } else {
            this.overall.failed++;
        }
        this.overall.durations.push(duration);
        recalculateStats(this.overall);

        // Track errors
        if (error) {
            const count = this.errors.get(error) || 0;
            this.errors.set(error, count + 1);
        }
    }

    /**
     * Get current statistics
     */
    public getStatistics(): RunStatistics {
        // Convert errors map to array
        const errorSummary: ErrorSummary[] = [];
        this.errors.forEach((count, message) => {
            errorSummary.push({ message, count });
        });

        // Sort errors by count descending
        errorSummary.sort((a, b) => b.count - a.count);

        return {
            summary: { ...this.summary },
            byRequest: new Map(this.byRequest),
            overall: { ...this.overall },
            errors: errorSummary
        };
    }

    /**
     * Get serializable statistics (for sending to webview or CLI)
     */
    public getSerializableStatistics(): {
        summary: RunSummary;
        byRequest: Array<RequestStatistics>;
        overall: RequestStatistics;
        errors: ErrorSummary[];
    } {
        const stats = this.getStatistics();
        return {
            summary: stats.summary,
            byRequest: Array.from(stats.byRequest.values()),
            overall: stats.overall,
            errors: stats.errors
        };
    }
}
