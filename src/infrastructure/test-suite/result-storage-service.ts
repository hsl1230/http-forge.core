/**
 * Result Storage Service for Test Suite
 *
 * Architecture (JMeter-inspired):
 * - Append-only index pages for fast writes
 * - Individual JSON files for full details
 * - Aggregated stats in memory (constant size)
 * - On-demand result loading
 */

import * as fsp from 'fs/promises';
import * as path from 'path';
import { ExecutionResult } from '../../types/types';
import { sanitizeName } from '../../utils/helpers';
import { IConfigService } from '../config';
import { redactFullResultDetails, redactSecretValuesDeep } from '../security/sensitive-data-redactor';
import { getSecretValues } from '../security/secret-values';
import { HtmlReportGenerator } from './html-report-generator';
import { JUnitReportGenerator } from './junit-report-generator';
import { MarkdownSummaryGenerator } from './markdown-summary-generator';
import {
    FullResultDetails,
    HTTP_METHOD_MAP,
    IndexPage,
    IResultStorageService,
    RecentError,
    RequestStats,
    ResultSummary,
    RunConfig,
    RunManifest,
    RunStats
} from './result-storage';

// Calculate percentile from sorted array
function percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const idx = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, Math.min(idx, arr.length - 1))];
}

/**
 * File-based Result Storage Service for Test Suite
 */
export class ResultStorageService implements IResultStorageService {
    private basePath: string;
    private currentRunPath: string | null = null;
    private currentRunId: string | null = null;
    private currentSuiteId: string | null = null;
    private currentManifest: RunManifest | null = null;

    // Index page buffering
    private currentIndexPage: ResultSummary[] = [];
    private currentPageNumber: number = 1;
    private readonly indexPageSize: number;

    // Recent errors tracking
    private recentErrors: RecentError[] = [];
    private readonly recentErrorsLimit: number;

    // Result counter
    private resultIndex: number = 0;

    // Track all durations per requestId for percentiles
    private requestDurations: Record<string, number[]> = {};

    constructor(private configService: IConfigService) {
        const runnerConfig = configService.getRunnerConfig();
        this.basePath = configService.getResultsPath();
        this.indexPageSize = runnerConfig.indexPageSize;
        this.recentErrorsLimit = runnerConfig.recentErrorsLimit;
    }

    /**
     * Get the base path for result storage
     */
    getBasePath(): string {
        return this.basePath;
    }

    // ==================== Run Lifecycle ====================

    /**
     * Initialize a new run
     */
    async initializeRun(
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
    ): Promise<string> {
        const runId = this.generateRunId();
        this.currentRunId = runId;
        this.currentSuiteId = suiteId;
        this.currentRunPath = path.join(this.basePath, suiteId, runId);

        // Create directories
        await fsp.mkdir(path.join(this.currentRunPath, 'results'), { recursive: true });
        await fsp.mkdir(path.join(this.currentRunPath, 'index'), { recursive: true });

        // Initialize manifest
        this.currentManifest = {
            version: '1.0',
            runId,
            suiteId,
            suiteName,
            targetType: metadata?.targetType,
            targetName: metadata?.targetName,
            collectionName: metadata?.collectionName,
            folderPath: metadata?.folderPath,
            environment,
            startTime: new Date().toISOString(),
            status: 'running',
            config,
            stats: {
                totalRequests: 0,
                passed: 0,
                failed: 0,
                skipped: 0,
                totalDuration: 0,
                avgDuration: 0,
                minDuration: Number.MAX_SAFE_INTEGER,
                maxDuration: 0
            },
            requestStats: {},
            totalIndexPages: 0,
            indexPageSize: this.indexPageSize
        };

        // Reset state
        this.currentIndexPage = [];
        this.currentPageNumber = 1;
        this.recentErrors = [];
        this.resultIndex = 0;
        this.requestDurations = {};

        // Save initial manifest
        await this.saveManifest();

        return runId;
    }

    /**
     * Save a request result
     * Returns lightweight summary for UI
     */
    async saveResult(iteration: number, result: ExecutionResult): Promise<ResultSummary> {
        if (!this.currentRunPath || !this.currentManifest) {
            throw new Error('No active run. Call initializeRun first.');
        }

        const secretValues = getSecretValues(result.executedRequest);
        const redactedError = result.error
            ? redactSecretValuesDeep(result.error, secretValues)
            : result.error;

        this.resultIndex++;
        const timestamp = Date.now();
        const iterStr = String(iteration).padStart(4, '0');
        const indexStr = String(this.resultIndex).padStart(6, '0');
        const sanitizedRequestId = sanitizeName(result.requestId);
        const resultFileName = `result-${indexStr}-iter-${iterStr}-${sanitizedRequestId}.json`;

        const resultPath = path.join(this.currentRunPath, 'results', resultFileName);

        // 1. Write full result to JSON file
        const fullResult: FullResultDetails = {
            index: this.resultIndex,
            iteration,
            requestId: result.requestId,
            name: result.name,
            method: result.executedRequest.method,
            url: result.executedRequest.url,
            folderPath: result.folderPath || '',
            groupPath: result.groupPath || result.folderPath || '',
            groupType: result.groupType,
            collectionName: result.collectionName || '',
            status: result.response.status,
            statusText: result.response.statusText || '',
            duration: result.duration,
            passed: result.passed,
            timestamp,
            request: {
                method: result.executedRequest.method,
                url: result.executedRequest.url,
                headers: result.executedRequest.headers,
                query: result.executedRequest.query,
                params: result.executedRequest.params,
                body: result.executedRequest.body
            },
            response: {
                headers: result.response.headers,
                body: result.response.body,
                time: result.response.time,
                size: result.response.size,
                cookies: result.response.cookies
            },
            assertions: result.assertions.map(a => ({
                name: a.name,
                passed: a.passed,
                message: a.message || null,
                ...(a.skipped ? { skipped: true } : {})
            })),
            error: redactedError || null,
            consoleOutput: result.consoleOutput,
            // NOTE: modifiedVariables / modifiedEnvironmentVariables /
            // modifiedCollectionVariables are intentionally NOT persisted. They are
            // only used at runtime (in-memory) to carry variable state to the next
            // request; nothing reads them back from disk (neither the HTML report nor
            // the result-detail view). Persisting the full accumulated variable set —
            // which can include large blobs stashed in variables (e.g. an entire
            // framework script) — bloated every result file many-fold.
            nextRequest: result.nextRequest ?? null,
            visualizerData: result.visualizerData
        };

        await fsp.writeFile(
            resultPath,
            JSON.stringify(
                redactFullResultDetails(fullResult, secretValues),
                null,
                2
            ),
            'utf-8'
        );

        // 2. Create compact summary
        const assertionsPassed = result.assertions.filter(a => a.passed && !a.skipped).length;
        const assertionsFailed = result.assertions.filter(a => !a.passed && !a.skipped).length;
        const assertionsSkipped = result.assertions.filter(a => a.skipped).length;

        const summary: ResultSummary = {
            i: this.resultIndex,
            it: iteration,
            n: result.name,
            m: HTTP_METHOD_MAP[result.executedRequest.method.toUpperCase()] ?? 0,
            s: result.response.status,
            d: result.duration,
            p: result.passed,
            ap: assertionsPassed,
            af: assertionsFailed,
            ...(assertionsSkipped > 0 ? { as: assertionsSkipped } : {}),
            r: result.requestId,
            e: result.passed ? null : (redactedError || null),
            fp: result.folderPath || '',
            gp: result.groupPath || result.folderPath || '',
            gt: result.groupType,
            cn: result.collectionName || ''
        };

        // 3. Add to current index page buffer
        this.currentIndexPage.push(summary);

        // 4. Write index page if full
        if (this.currentIndexPage.length >= this.indexPageSize) {
            await this.writeCurrentIndexPage();
        }

        // 5. Update aggregated stats
        this.updateStats(result);
        if (!this.requestDurations[result.requestId]) {
            this.requestDurations[result.requestId] = [];
        }
        this.requestDurations[result.requestId].push(result.duration);

        // 6. Track recent errors
        if (!result.passed) {
            this.recentErrors.unshift({
                timestamp,
                iteration,
                requestName: result.name,
                status: result.response.status,
                error: redactedError || `Status ${result.response.status}`,
                resultFile: resultFileName
            });
            if (this.recentErrors.length > this.recentErrorsLimit) {
                this.recentErrors.pop();
            }
        }

        return summary;
    }

    /**
     * Finalize run
     * @returns path to the generated HTML report, or null if generation failed
     */
    async finalizeRun(status: 'completed' | 'aborted' | 'error' = 'completed', generateHtmlReport: boolean = true): Promise<string | null> {
        if (!this.currentManifest) return null;

        // Write remaining index page
        if (this.currentIndexPage.length > 0) {
            await this.writeCurrentIndexPage();
        }

        // Update manifest
        this.currentManifest.endTime = new Date().toISOString();
        this.currentManifest.status = status;
        this.currentManifest.totalIndexPages = this.currentPageNumber - 1;

        // Calculate final averages
        if (this.currentManifest.stats.totalRequests > 0) {
            this.currentManifest.stats.avgDuration = Math.round(
                this.currentManifest.stats.totalDuration / this.currentManifest.stats.totalRequests
            );
        }
        if (this.currentManifest.stats.minDuration === Number.MAX_SAFE_INTEGER) {
            this.currentManifest.stats.minDuration = 0;
        }

        for (const reqId in this.currentManifest.requestStats) {
            const stats = this.currentManifest.requestStats[reqId];
            const durations = this.requestDurations[reqId] || [];
            if (stats.count > 0) {
                stats.avgDuration = Math.round(stats.totalDuration / stats.count);
            }
            if (stats.minDuration === Number.MAX_SAFE_INTEGER) {
                stats.minDuration = 0;
            }
            if (durations.length > 0) {
                durations.sort((a, b) => a - b);
                stats.p50 = percentile(durations, 50);
                stats.p90 = percentile(durations, 90);
                stats.p95 = percentile(durations, 95);
                stats.p99 = percentile(durations, 99);
            }
        }

        // Compute run-level percentiles from all per-request durations combined
        const allDurations = Object.values(this.requestDurations).flat();
        if (allDurations.length > 0) {
            allDurations.sort((a, b) => a - b);
            this.currentManifest.stats.p50 = percentile(allDurations, 50);
            this.currentManifest.stats.p95 = percentile(allDurations, 95);
            this.currentManifest.stats.p99 = percentile(allDurations, 99);
        }

        this.requestDurations = {};

        await this.saveManifest();

        // Generate HTML report (non-blocking — failure does not affect run finalization)
        let reportPath: string | null = null;
        const savedRunPath = this.currentRunPath;
        const savedSuiteId = this.currentSuiteId;
        const savedRunId = this.currentRunId;

        // Clear state before async report generation so next run can start
        this.currentRunPath = null;
        this.currentRunId = null;
        this.currentSuiteId = null;
        this.currentManifest = null;
        this.currentIndexPage = [];
        this.recentErrors = [];
        this.resultIndex = 0;

        if (generateHtmlReport && savedSuiteId && savedRunId && savedRunPath) {
            try {
                const reportOptions = this.configService.getRunnerConfig().report;
                const generator = new HtmlReportGenerator(this.basePath, reportOptions);
                reportPath = await generator.generate(savedSuiteId, savedRunId);
            } catch (e) {
                console.warn('[ResultStorage] HTML report generation failed:', e);
            }
            // Generate run-summary.md for AI tools alongside the HTML report
            try {
                const suitesPath = this.configService.getSuitesPath();
                const mdGenerator = new MarkdownSummaryGenerator(this.basePath, suitesPath);
                await mdGenerator.generate(savedSuiteId, savedRunId);
            } catch (e) {
                console.warn('[ResultStorage] Markdown summary generation failed:', e);
            }
        }

        return reportPath;
    }

    // ==================== Query Methods ====================

    getCurrentStats(): {
        stats: RunStats;
        requestStats: Record<string, RequestStats>;
        recentErrors: RecentError[]
    } | null {
        if (!this.currentManifest) return null;

        return {
            stats: { ...this.currentManifest.stats },
            requestStats: { ...this.currentManifest.requestStats },
            recentErrors: [...this.recentErrors]
        };
    }

    getCurrentRunId(): string | null {
        return this.currentRunId;
    }

    getCurrentSuiteId(): string | null {
        return this.currentSuiteId;
    }

    /**
     * Regenerate the HTML report for any completed run — callable after finalizeRun.
     */
    async regenerateHtmlReport(suiteId: string, runId: string): Promise<string | null> {
        try {
            const reportOptions = this.configService.getRunnerConfig().report;
            const generator = new HtmlReportGenerator(this.basePath, reportOptions);
            return await generator.generate(suiteId, runId);
        } catch (e) {
            console.warn('[ResultStorage] HTML report regeneration failed:', e);
            return null;
        }
    }

    /**
     * Generate a JUnit XML report for any completed run.
     */
    async generateJunitReport(suiteId: string, runId: string): Promise<string | null> {
        try {
            const generator = new JUnitReportGenerator(this.basePath);
            return await generator.generate(suiteId, runId);
        } catch (e) {
            console.warn('[ResultStorage] JUnit report generation failed:', e);
            return null;
        }
    }

    async getResultDetails(
        suiteId: string,
        runId: string,
        resultFile: string
    ): Promise<FullResultDetails> {
        const filePath = path.join(this.basePath, suiteId, runId, 'results', resultFile);
        const content = await fsp.readFile(filePath, 'utf-8');
        return JSON.parse(content);
    }

    async getIndexPage(
        suiteId: string,
        runId: string,
        page: number
    ): Promise<IndexPage> {
        const pagePath = path.join(
            this.basePath,
            suiteId,
            runId,
            'index',
            `page-${String(page).padStart(4, '0')}.json`
        );
        const content = await fsp.readFile(pagePath, 'utf-8');
        return JSON.parse(content);
    }

    async getManifest(suiteId: string, runId: string): Promise<RunManifest> {
        const manifestPath = path.join(this.basePath, suiteId, runId, 'manifest.json');
        const content = await fsp.readFile(manifestPath, 'utf-8');
        return JSON.parse(content);
    }

    async listRuns(suiteId: string): Promise<RunManifest[]> {
        const suitePath = path.join(this.basePath, suiteId);

        try {
            const runs = await fsp.readdir(suitePath);
            const manifests: RunManifest[] = [];

            for (const run of runs.sort().reverse()) {
                try {
                    const manifest = await this.getManifest(suiteId, run);
                    manifests.push(manifest);
                } catch {
                    // Skip invalid runs
                }
            }

            return manifests;
        } catch {
            return [];
        }
    }

    async listSuites(): Promise<string[]> {
        try {
            const entries = await fsp.readdir(this.basePath, { withFileTypes: true });
            return entries
                .filter(e => e.isDirectory())
                .map(e => e.name);
        } catch {
            return [];
        }
    }

    async deleteRun(suiteId: string, runId: string): Promise<void> {
        const runPath = path.join(this.basePath, suiteId, runId);
        await fsp.rm(runPath, { recursive: true, force: true });
    }

    async cleanupOldRuns(): Promise<{ deleted: number; freed: number }> {
        const runnerConfig = this.configService.getRunnerConfig();
        const retentionDays = runnerConfig.resultsRetentionDays;

        if (retentionDays === 0) {
            return { deleted: 0, freed: 0 };
        }

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - retentionDays);

        let deleted = 0;
        let freed = 0;

        const suites = await this.listSuites();

        for (const suite of suites) {
            const runs = await this.listRuns(suite);

            for (const run of runs) {
                if (new Date(run.startTime) < cutoff) {
                    const runPath = path.join(this.basePath, suite, run.runId);
                    const size = await this.getDirectorySize(runPath);
                    await fsp.rm(runPath, { recursive: true, force: true });
                    deleted++;
                    freed += size;
                }
            }
        }

        return { deleted, freed };
    }

    // ==================== Private Methods ====================

    private generateRunId(): string {
        const now = new Date();
        const date = now.toISOString().slice(0, 10).replace(/-/g, '');
        const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
        const ms = String(now.getMilliseconds()).padStart(3, '0');
        return `run-${date}-${time}-${ms}`;
    }

    private async saveManifest(): Promise<void> {
        if (!this.currentRunPath || !this.currentManifest) return;

        const manifestPath = path.join(this.currentRunPath, 'manifest.json');
        await fsp.writeFile(manifestPath, JSON.stringify(this.currentManifest, null, 2), 'utf-8');
    }

    private async writeCurrentIndexPage(): Promise<void> {
        if (!this.currentRunPath || this.currentIndexPage.length === 0) return;

        const pageFileName = `page-${String(this.currentPageNumber).padStart(4, '0')}.json`;
        const pagePath = path.join(this.currentRunPath, 'index', pageFileName);

        const indexPage: IndexPage = {
            page: this.currentPageNumber,
            startIndex: (this.currentPageNumber - 1) * this.indexPageSize + 1,
            count: this.currentIndexPage.length,
            summaries: this.currentIndexPage
        };

        await fsp.writeFile(pagePath, JSON.stringify(indexPage), 'utf-8');

        this.currentPageNumber++;
        this.currentIndexPage = [];
    }

    private updateStats(result: ExecutionResult): void {
        if (!this.currentManifest) return;

        const stats = this.currentManifest.stats;
        const reqStats = this.currentManifest.requestStats;

        // Update overall stats
        stats.totalRequests++;
        stats.totalDuration += result.duration;
        stats.minDuration = Math.min(stats.minDuration, result.duration);
        stats.maxDuration = Math.max(stats.maxDuration, result.duration);

        if (result.passed) {
            stats.passed++;
        } else {
            stats.failed++;
        }

        // Update per-request stats
        if (!reqStats[result.requestId]) {
            reqStats[result.requestId] = {
                name: result.name,
                count: 0,
                passed: 0,
                failed: 0,
                totalDuration: 0,
                avgDuration: 0,
                minDuration: Number.MAX_SAFE_INTEGER,
                maxDuration: 0
            };
        }

        const rs = reqStats[result.requestId];
        rs.count++;
        rs.totalDuration += result.duration;
        rs.minDuration = Math.min(rs.minDuration, result.duration);
        rs.maxDuration = Math.max(rs.maxDuration, result.duration);

        if (result.passed) {
            rs.passed++;
        } else {
            rs.failed++;
        }
    }

    private async getDirectorySize(dirPath: string): Promise<number> {
        let size = 0;

        try {
            const entries = await fsp.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const entryPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    size += await this.getDirectorySize(entryPath);
                } else {
                    const stat = await fsp.stat(entryPath);
                    size += stat.size;
                }
            }
        } catch {
            // Ignore errors
        }

        return size;
    }
}
