/**
 * JUnit XML Report Generator for Test Suite Results
 *
 * Reads the same persisted run artifacts as {@link HtmlReportGenerator}
 * (manifest + index pages + per-result files produced by ResultStorageService)
 * and emits a JUnit-compatible XML report that CI systems (GitHub Actions,
 * GitLab CI, Jenkins, etc.) can parse and display.
 *
 * Output: {basePath}/{suiteId}/{runId}/junit.xml
 *
 * Mapping:
 *   <testsuites>                aggregate across the whole run
 *     <testsuite>              one per (collection + folder path) group
 *       <testcase>            one per request execution (per iteration)
 *         <failure>          present when assertions failed
 *         <error>           present when the request itself errored
 *         <system-out>      console output, when captured
 */

import * as fsp from 'fs/promises';
import * as path from 'path';
import {
    FullResultDetails,
    HTTP_METHOD_REVERSE,
    IndexPage,
    ResultSummary,
    RunManifest,
    buildResultFileName,
} from './result-storage';

/** Escape a string for use in XML text/attribute content. */
function escapeXml(str: unknown): string {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
        // Strip XML-1.0-illegal control chars (keep \t \n \r).
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** Milliseconds → seconds string with 3 decimals, per JUnit convention. */
function msToSeconds(ms: number): string {
    return (Math.max(0, ms) / 1000).toFixed(3);
}

interface JUnitCase {
    name: string;
    classname: string;
    durationMs: number;
    status: number;
    passed: boolean;
    error: string | null;
    failedAssertions: Array<{ name: string; message: string | null }>;
    skippedAssertions: number;
    consoleOutput?: string[];
}

interface JUnitGroup {
    /** classname / testsuite name */
    label: string;
    cases: JUnitCase[];
}

export class JUnitReportGenerator {
    constructor(private readonly basePath: string) {}

    /**
     * Generate a JUnit XML report for the given run.
     * @returns absolute path to the written junit.xml
     */
    async generate(suiteId: string, runId: string): Promise<string> {
        const runDir = path.join(this.basePath, suiteId, runId);

        const manifest: RunManifest = JSON.parse(
            await fsp.readFile(path.join(runDir, 'manifest.json'), 'utf-8')
        );

        const summaries = await this.loadAllSummaries(runDir, manifest.totalIndexPages);
        const details = await this.loadAllDetails(runDir, summaries);

        const xml = this.buildXml(manifest, summaries, details);
        const reportPath = path.join(runDir, 'junit.xml');
        await fsp.writeFile(reportPath, xml, 'utf-8');

        return reportPath;
    }

    private async loadAllSummaries(runDir: string, totalPages: number): Promise<ResultSummary[]> {
        const all: ResultSummary[] = [];
        for (let p = 1; p <= totalPages; p++) {
            const pagePath = path.join(
                runDir, 'index',
                `page-${String(p).padStart(4, '0')}.json`
            );
            try {
                const page: IndexPage = JSON.parse(await fsp.readFile(pagePath, 'utf-8'));
                all.push(...page.summaries);
            } catch {
                // skip missing pages
            }
        }
        return all;
    }

    /** Load detail files (for per-assertion failure messages and console output). */
    private async loadAllDetails(
        runDir: string,
        summaries: ResultSummary[]
    ): Promise<Map<string, FullResultDetails>> {
        const map = new Map<string, FullResultDetails>();
        for (const s of summaries) {
            const fileName = buildResultFileName(s.i, s.it, s.r);
            const key = `${s.i}-${s.it}`;
            try {
                const detail: FullResultDetails = JSON.parse(
                    await fsp.readFile(path.join(runDir, 'results', fileName), 'utf-8')
                );
                map.set(key, detail);
            } catch {
                // result file may not exist — fall back to summary data
            }
        }
        return map;
    }

    /**
     * Group request executions by (collection + folder path), preserving
     * execution order. Iteration is folded into the test case name when the run
     * has more than one iteration.
     */
    private buildGroups(
        manifest: RunManifest,
        summaries: ResultSummary[],
        details: Map<string, FullResultDetails>
    ): JUnitGroup[] {
        const multiIter = manifest.config?.iterations > 1;
        const order: string[] = [];
        const groups = new Map<string, JUnitGroup>();

        for (const s of summaries) {
            const detail = details.get(`${s.i}-${s.it}`);
            const cn = s.cn || detail?.collectionName || manifest.suiteName || '';
            const fp = s.fp || detail?.folderPath || '';
            const groupKey = `${cn}\u0000${fp}`;
            if (!groups.has(groupKey)) {
                const label = [cn, fp].filter(Boolean).join(' / ') || manifest.suiteName || 'Requests';
                groups.set(groupKey, { label, cases: [] });
                order.push(groupKey);
            }

            const baseName = s.n || detail?.name || HTTP_METHOD_REVERSE[s.m] || 'request';
            const name = multiIter ? `${baseName} (iteration ${s.it})` : baseName;

            const failedAssertions = (detail?.assertions ?? [])
                .filter(a => !a.passed && !a.skipped)
                .map(a => ({ name: a.name, message: a.message }));

            const skippedAssertions = (detail?.assertions ?? [])
                .filter(a => a.skipped).length || (s.as ?? 0);

            // When details are unavailable but the summary records failed
            // assertions, synthesise a single placeholder so the count is shown.
            if (failedAssertions.length === 0 && s.af > 0) {
                failedAssertions.push({ name: `${s.af} assertion(s) failed`, message: null });
            }

            groups.get(groupKey)!.cases.push({
                name,
                classname: [cn, fp].filter(Boolean).join('.') || manifest.suiteName || 'http-forge',
                durationMs: s.d,
                status: s.s,
                passed: s.p,
                error: s.e ?? detail?.error ?? null,
                failedAssertions,
                skippedAssertions,
                consoleOutput: detail?.consoleOutput,
            });
        }

        return order.map(k => groups.get(k)!);
    }

    private buildXml(
        manifest: RunManifest,
        summaries: ResultSummary[],
        details: Map<string, FullResultDetails>
    ): string {
        const groups = this.buildGroups(manifest, summaries, details);

        let totalTests = 0;
        let totalFailures = 0;
        let totalErrors = 0;
        let totalSkipped = 0;
        let totalTimeMs = 0;

        const suiteXml: string[] = [];
        groups.forEach((group, idx) => {
            let tests = 0;
            let failures = 0;
            let errors = 0;
            let skipped = 0;
            let timeMs = 0;
            const caseXml: string[] = [];

            for (const c of group.cases) {
                tests++;
                timeMs += c.durationMs;
                const isError = !c.passed && c.failedAssertions.length === 0 && !!c.error;
                const isFailure = !c.passed && !isError;
                if (isError) errors++;
                if (isFailure) failures++;
                if (c.skippedAssertions > 0) skipped++;

                const inner: string[] = [];
                if (isFailure) {
                    const summaryMsg = c.failedAssertions.length > 0
                        ? c.failedAssertions.map(a => a.name).join('; ')
                        : (c.error || 'Assertion failed');
                    const body = c.failedAssertions
                        .map(a => (a.message ? `${a.name}: ${a.message}` : a.name))
                        .join('\n');
                    inner.push(
                        `        <failure message="${escapeXml(summaryMsg)}" type="AssertionFailure">${escapeXml(body)}</failure>`
                    );
                }
                if (isError) {
                    inner.push(
                        `        <error message="${escapeXml(c.error)}" type="RequestError">${escapeXml(c.error)}</error>`
                    );
                }
                if (c.skippedAssertions > 0) {
                    inner.push(
                        `        <skipped message="${c.skippedAssertions} assertion(s) skipped via pm.test.skip()" />`
                    );
                }
                if (c.consoleOutput && c.consoleOutput.length > 0) {
                    inner.push(
                        `        <system-out>${escapeXml(c.consoleOutput.join('\n'))}</system-out>`
                    );
                }

                const caseOpen =
                    `      <testcase name="${escapeXml(c.name)}" classname="${escapeXml(c.classname)}" time="${msToSeconds(c.durationMs)}"`;
                if (inner.length === 0) {
                    caseXml.push(`${caseOpen} />`);
                } else {
                    caseXml.push(`${caseOpen}>\n${inner.join('\n')}\n      </testcase>`);
                }
            }

            totalTests += tests;
            totalFailures += failures;
            totalErrors += errors;
            totalTimeMs += timeMs;
            totalSkipped += skipped;

            const props: string[] = [
                `        <property name="environment" value="${escapeXml(manifest.environment)}" />`,
                `        <property name="suiteName" value="${escapeXml(manifest.suiteName)}" />`,
                `        <property name="runId" value="${escapeXml(manifest.runId)}" />`,
                `        <property name="status" value="${escapeXml(manifest.status)}" />`,
                `        <property name="iterations" value="${manifest.config?.iterations ?? 1}" />`,
                `        <property name="delay" value="${manifest.config?.delayBetweenRequests ?? 0}ms" />`,
                `        <property name="stopOnError" value="${manifest.config?.stopOnError ?? false}" />`,
            ];
            const propertiesBlock = `      <properties>\n${props.join('\n')}\n      </properties>`;

            suiteXml.push(
                `    <testsuite name="${escapeXml(group.label)}" tests="${tests}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${msToSeconds(timeMs)}" timestamp="${escapeXml(manifest.startTime)}" id="${idx}">\n${propertiesBlock}\n${caseXml.join('\n')}\n    </testsuite>`
            );
        });

        const header = '<?xml version="1.0" encoding="UTF-8"?>';
        const rootOpen =
            `<testsuites name="${escapeXml(manifest.suiteName)}" tests="${totalTests}" failures="${totalFailures}" errors="${totalErrors}" skipped="${totalSkipped}" time="${msToSeconds(totalTimeMs)}">`;
        return `${header}\n${rootOpen}\n${suiteXml.join('\n')}\n</testsuites>\n`;
    }
}
