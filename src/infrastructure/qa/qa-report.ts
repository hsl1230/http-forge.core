/**
 * QA check report rendering — table output for humans.
 * JSON output is `JSON.stringify(report, null, 2)` at the call site.
 */

import type { QaCheckReport } from './qa-service';

/** Render a QA check report as a human-readable summary table. */
export function renderQaReportTable(report: QaCheckReport): string {
    const lines: string[] = [];
    const statusWord =
        report.status === 'pass' ? 'PASS'
        : report.status === 'fail' ? 'FAIL'
        : report.status === 'drift' ? 'DRIFT'
        : report.status === 'dry-run' ? 'DRY-RUN'
        : 'INFRA ERROR';
    lines.push(`QA check: ${statusWord}`);
    lines.push(`  project: ${report.project.path}`);
    if (report.project.gitHash) lines.push(`  git: ${report.project.gitHash.slice(0, 12)}`);
    if (report.project.frameworks.length > 0) {
        lines.push(`  frameworks: ${report.project.frameworks.join(', ')}`);
    }
    lines.push(`  drift: ${report.drift.status}${report.drift.reason ? ` (${report.drift.reason})` : ''}`);
    lines.push(
        `  discovered: ${report.discovered}  reused: ${report.reused}  created: ${report.created}` +
        (report.updatedUrls > 0 ? `  urls updated: ${report.updatedUrls}` : '')
    );
    if (report.suite) lines.push(`  suite: ${report.suite.name} (${report.suite.id})`);
    lines.push(
        `  results: ${report.results.passed} passed, ${report.results.failed} failed` +
        (report.results.skipped > 0 ? `, ${report.results.skipped} skipped` : '')
    );

    if (report.endpoints.length > 0) {
        lines.push('');
        lines.push('  endpoints:');
        for (const ep of report.endpoints) {
            const mark = report.status === 'dry-run' ? '·' : ep.passed === false ? '✗' : '✓';
            const outcome =
                report.status === 'dry-run'
                    ? `${ep.reused ? 'reuse' : 'create'}`
                    : `${ep.statusGot ?? '?'}${ep.duration ? ` (${ep.duration})` : ''}`;
            const conf = ep.confidence === 'low' ? ' [low-confidence]' : '';
            lines.push(`    ${mark} ${ep.method} ${ep.path} → ${outcome}${conf}`);
            if (ep.error) lines.push(`      error: ${ep.error}`);
            for (const f of ep.failures ?? []) lines.push(`      failed: ${f}`);
        }
    }

    const failures = report.endpoints.filter((e) => e.passed === false);
    if (failures.length > 0) {
        lines.push('');
        lines.push(`  failures: ${failures.length}`);
        for (const f of failures) {
            lines.push(
                `    - [${f.method}] ${f.path}: expected ${f.statusExpected}, got ${f.statusGot ?? 'no response'}` +
                (f.error ? ` (${f.error})` : '')
            );
        }
    }

    if (report.lowConfidence.length > 0) {
        lines.push('');
        lines.push('  low-confidence discoveries (verify manually):');
        for (const key of report.lowConfidence) lines.push(`    - ${key}`);
    }

    return lines.join('\n');
}
