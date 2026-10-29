/**
 * HTML Report Generator for Test Suite Results
 *
 * Reads the existing JSON result files produced by ResultStorageService and
 * generates a self-contained single-file HTML report (no external dependencies).
 *
 * Output: {basePath}/{suiteId}/{runId}/report.html
 *
 * Each request entry expands to show:
 *   - Full request URL, method, headers, body
 *   - Response status, headers, body (pretty-printed)
 *   - All test assertions (pass/fail + messages)
 *   - Console output (if any)
 *   - Error message (if any)
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

function escapeHtml(str: unknown): string {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Maximum characters of a single request/response body embedded in the report.
 * Large collections can produce hundreds of MB of body data; embedding it all
 * builds one giant HTML string that blows past V8's max string length and
 * exhausts the extension host's memory, hanging the run before it can finalize.
 * The full, untruncated body always remains in the on-disk result JSON.
 *
 * Used as the fallback when no explicit cap is supplied.
 */
const MAX_REPORT_BODY_CHARS = 100_000;

/** Truncate an embedded body/string for the report, appending a notice. */
function truncateForReport(text: string, maxChars: number = MAX_REPORT_BODY_CHARS): string {
    if (text.length <= maxChars) {
        return text;
    }
    const omitted = text.length - maxChars;
    return text.slice(0, maxChars)
        + `\n\n… [truncated ${omitted.toLocaleString()} characters — open the full result file on disk to see the complete body] …`;
}

function fmtMs(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

function fmtDate(iso: string): string {
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

function statusClass(status: number): string {
    if (status >= 100 && status < 200) return 'status-1xx';
    if (status >= 200 && status < 300) return 'status-2xx';
    if (status >= 300 && status < 400) return 'status-3xx';
    if (status >= 400 && status < 500) return 'status-4xx';
    return 'status-5xx';
}

function passRate(passed: number, total: number): string {
    if (total === 0) return '—';
    return `${Math.round((passed / total) * 100)}%`;
}

function jsonPretty(val: unknown): string {
    try {
        if (typeof val === 'string') val = JSON.parse(val);
        return JSON.stringify(val, null, 2);
    } catch {
        return String(val ?? '');
    }
}

function renderKvTable(obj: Record<string, unknown> | undefined): string {
    if (!obj || Object.keys(obj).length === 0) return '<span class="dim">—</span>';
    const rows = Object.entries(obj).map(([k, v]) => {
        const val = Array.isArray(v) ? v.join(', ') : String(v ?? '');
        return `<tr><td class="kv-key">${escapeHtml(k)}</td><td class="kv-val">${escapeHtml(val)}</td></tr>`;
    }).join('');
    return `<table class="kv-table">${rows}</table>`;
}

function renderValue(value: unknown): string {
    if (value === null || value === undefined || value === '') {
        return '<span class="dim">—</span>';
    }
    if (typeof value === 'string') {
        return escapeHtml(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return escapeHtml(String(value));
    }
    return `<pre class="code">${escapeHtml(jsonPretty(value))}</pre>`;
}

function renderMetaTable(obj: Record<string, unknown> | undefined): string {
    if (!obj || Object.keys(obj).length === 0) return '<span class="dim">—</span>';
    const rows = Object.entries(obj).map(([k, v]) => `
      <tr>
        <td class="kv-key">${escapeHtml(k)}</td>
        <td class="kv-val">${renderValue(v)}</td>
      </tr>`).join('');
    return `<table class="kv-table meta-table">${rows}</table>`;
}

function renderCookieTable(cookies: Array<{ name?: string; value?: string }> | undefined): string {
    if (!cookies || cookies.length === 0) return '<span class="dim">—</span>';
    const rows = cookies.map(cookie => `
      <tr>
        <td class="kv-key">${escapeHtml(cookie.name ?? '(unnamed)')}</td>
        <td class="kv-val">${escapeHtml(cookie.value ?? '')}</td>
      </tr>`).join('');
    return `<table class="kv-table">${rows}</table>`;
}

function renderBody(body: unknown, maxChars: number, contentType?: string): string {
    if (body === null || body === undefined || body === '') {
        return '<span class="dim">— empty —</span>';
    }
    const pretty = truncateForReport(jsonPretty(body), maxChars);
    return `<pre class="code">${escapeHtml(pretty)}</pre>`;
}

/** Options controlling how much request/response data the report embeds. */
export interface HtmlReportOptions {
    /** Max characters per embedded request/response body. */
    maxBodyChars: number;
    /** Which requests embed their bodies: all, only failed, or none. */
    embedBodies: 'all' | 'failed' | 'none';
}

const DEFAULT_REPORT_OPTIONS: HtmlReportOptions = {
    maxBodyChars: MAX_REPORT_BODY_CHARS,
    embedBodies: 'failed',
};

/**
 * Client-side renderer embedded in the report. Each request's heavy detail
 * (headers, bodies, assertions, metadata) is stored ONCE as JSON in a
 * <script id="hf-details"> tag instead of being expanded into duplicated HTML
 * per request. This function builds a request's detail markup on demand the
 * first time its <details> row is expanded, keeping the file small and fast to
 * open. It mirrors the server-side detail markup and reuses the same CSS.
 * NOTE: written with plain string concatenation (no template literals / ${}) so
 * it embeds cleanly inside the generator's own template string.
 */
const CLIENT_RENDER_SCRIPT = `
(function(){
  var ROOT = {};
  try { ROOT = JSON.parse(document.getElementById('hf-details').textContent || '{}'); } catch(e){ ROOT = {}; }
  var DATA = ROOT.items || {};
  function esc(s){ s = (s==null?'':String(s)); return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function pretty(v){ try{ if(typeof v==='string'){ v = JSON.parse(v); } return JSON.stringify(v,null,2); }catch(e){ return (v==null?'':String(v)); } }
  function fmtMs(ms){ return ms>=1000 ? (ms/1000).toFixed(2)+'s' : ms+'ms'; }
  function statusClass(s){ if(s>=100&&s<200){return 'status-1xx';} if(s>=200&&s<300){return 'status-2xx';} if(s>=300&&s<400){return 'status-3xx';} if(s>=400&&s<500){return 'status-4xx';} return 'status-5xx'; }
  function kv(obj){ if(!obj){ return '<span class="dim">—</span>'; } var ks=Object.keys(obj); if(!ks.length){ return '<span class="dim">—</span>'; } var rows=''; for(var i=0;i<ks.length;i++){ var k=ks[i]; var v=obj[k]; var val=Array.isArray(v)?v.join(', '):(v==null?'':String(v)); rows += '<tr><td class="kv-key">'+esc(k)+'</td><td class="kv-val">'+esc(val)+'</td></tr>'; } return '<table class="kv-table">'+rows+'</table>'; }
  function rval(v){ if(v===null||v===undefined||v===''){ return '<span class="dim">—</span>'; } if(typeof v==='string'){ return esc(v); } if(typeof v==='number'||typeof v==='boolean'){ return esc(String(v)); } return '<pre class="code">'+esc(pretty(v))+'</pre>'; }
  function meta(obj){ if(!obj){ return '<span class="dim">—</span>'; } var ks=Object.keys(obj); if(!ks.length){ return '<span class="dim">—</span>'; } var rows=''; for(var i=0;i<ks.length;i++){ var k=ks[i]; rows += '<tr><td class="kv-key">'+esc(k)+'</td><td class="kv-val">'+rval(obj[k])+'</td></tr>'; } return '<table class="kv-table meta-table">'+rows+'</table>'; }
  function cookies(cs){ if(!cs||!cs.length){ return '<span class="dim">—</span>'; } var rows=''; for(var i=0;i<cs.length;i++){ var c=cs[i]; rows += '<tr><td class="kv-key">'+esc(c.name||'(unnamed)')+'</td><td class="kv-val">'+esc(c.value||'')+'</td></tr>'; } return '<table class="kv-table">'+rows+'</table>'; }
  function body(b){ if(b===null||b===undefined||b===''){ return '<span class="dim">— empty —</span>'; } return '<pre class="code">'+esc(pretty(b))+'</pre>'; }
  function omitted(){ return '<span class="dim">— body omitted; open the full result file on disk to see it —</span>'; }
  function asserts(d){ if(!d.assertions||!d.assertions.length){ return '<span class="dim">No assertions</span>'; } var out=''; for(var i=0;i<d.assertions.length;i++){ var a=d.assertions[i]; if(a.skipped){ out += '<li class="skip"><span class="assert-icon">⊘</span><span class="assert-skip-name">'+esc(a.name)+'</span><span class="assert-msg"> — skipped</span></li>'; } else { out += '<li class="'+(a.passed?'pass':'fail')+'"><span class="assert-icon">'+(a.passed?'✓':'✗')+'</span>'+esc(a.name)+(a.message?'<span class="assert-msg"> — '+esc(a.message)+'</span>':'')+'</li>'; } } return '<ul class="assert-list">'+out+'</ul>'; }
  function build(key){
    var e = DATA[key]; if(!e){ return '<span class="dim">— detail unavailable —</span>'; }
    var d = e.d || {}; var embed = !!e.embed; var method = e.method || 'GET';
    var req = d.request || {}; var resp = d.response || {};
    var rb = req.body; var rbType = (rb && typeof rb==='object') ? rb.type : undefined;
    var rbVal = (rb && typeof rb==='object' && ('content' in rb)) ? rb.content : rb;
    var hasReq = rbType!=='none' && !(rbVal===undefined||rbVal===null||rbVal==='');
    var reqBody = hasReq ? (embed ? body(rbVal) : omitted()) : '';
    var respBody = !embed ? omitted() : ((resp.body!==undefined && resp.body!==null) ? body(resp.body) : '<span class="dim">— no body —</span>');
    var reqMeta = meta({ method: req.method, url: req.url, query: req.query, params: req.params, bodyType: rbType, bodyFormat: rb && rb.format });
    var respMeta = meta({ status: d.status, statusText: d.statusText, durationMs: d.duration, responseTimeMs: resp.time, responseSizeBytes: resp.size });
    var execMeta = meta({ timestamp: d.timestamp ? new Date(d.timestamp).toISOString() : undefined, nextRequest: d.nextRequest, visualizerTemplate: d.visualizerData && d.visualizerData.template, visualizerData: d.visualizerData && d.visualizerData.data });
    var counts = '<span class="assert-counts"><span class="pass">'+(e.ap||0)+' passed</span>'+((e.af||0)>0?'<span class="fail"> · '+e.af+' failed</span>':'')+((e.as||0)>0?'<span class="skip-badge"> · '+e.as+' skipped</span>':'')+'</span>';
    var assertSec = '<div class="detail-section"><div class="pane-section-title">Assertions '+counts+'</div>'+asserts(d)+'</div>';
    var reqCol = '<div class="pane-section"><div class="pane-section-title">Overview</div>'+reqMeta+'</div><div class="pane-section"><div class="pane-section-title">Headers</div>'+kv(req.headers)+'</div>'+(hasReq?'<div class="pane-section"><div class="pane-section-title">Body</div>'+reqBody+'</div>':'');
    var respCol = '<div class="pane-section"><div class="pane-section-title">Overview</div>'+respMeta+'</div><div class="pane-section"><div class="pane-section-title">Headers</div>'+kv(resp.headers)+'</div><div class="pane-section"><div class="pane-section-title">Cookies</div>'+cookies(resp.cookies)+'</div><div class="pane-section"><div class="pane-section-title">Body</div>'+respBody+'</div>';
    var execBox = '<div class="col-pane exec-meta-box"><div class="pane-title">Execution Metadata</div><div class="pane-section">'+execMeta+'</div></div>';
    var reqShorter = reqCol.length <= respCol.length;
    var conArr = d.consoleOutput || [];
    var con = conArr.length ? '<div class="detail-section"><div class="pane-section-title">Console Output</div><div class="console-block"><pre class="code console-code">'+conArr.map(function(l){ return esc(typeof l==='string'?l:JSON.stringify(l)); }).join('\\n')+'</pre></div></div>' : '';
    var err = d.error ? '<div class="error-box">⚠ '+esc(d.error)+'</div>' : '';
    var url = '<div class="detail-section url-row"><span class="method method-'+method.toLowerCase()+'">'+method+'</span><code class="url-text">'+esc(d.url||'—')+'</code></div>';
    var grid = '<div class="req-resp-grid"><div class="col-stack"><div class="col-pane"><div class="pane-title">Request</div>'+reqCol+'</div>'+(reqShorter?execBox:'')+'</div><div class="col-stack"><div class="col-pane"><div class="pane-title">Response <span class="'+statusClass(e.s)+' status-badge">'+e.s+'</span></div>'+respCol+'</div>'+(reqShorter?'':execBox)+'</div></div>';
    return err+url+assertSec+grid+con;
  }
  document.addEventListener('toggle', function(ev){
    var det = ev.target;
    if(!det || det.nodeName!=='DETAILS' || !det.classList || !det.classList.contains('req-detail') || !det.open){ return; }
    var b = det.querySelector(':scope > .req-body[data-lazy]');
    if(!b || b.getAttribute('data-rendered')==='1'){ return; }
    b.innerHTML = build(det.getAttribute('data-key'));
    b.setAttribute('data-rendered','1');
  }, true);
})();
`;

export class HtmlReportGenerator {
    private readonly options: HtmlReportOptions;

    constructor(private readonly basePath: string, options?: Partial<HtmlReportOptions>) {
        this.options = { ...DEFAULT_REPORT_OPTIONS, ...options };
    }

    /** Whether a request with the given pass state should embed its bodies. */
    private shouldEmbedBody(passed: boolean): boolean {
        switch (this.options.embedBodies) {
            case 'all': return true;
            case 'none': return false;
            case 'failed':
            default: return !passed;
        }
    }

    /** Placeholder shown where a body was intentionally not embedded. */
    private bodyOmittedNote(): string {
        const reason = this.options.embedBodies === 'none'
            ? 'body embedding disabled'
            : 'passed request — body omitted';
        return `<span class="dim">— ${reason}; open the full result file on disk to see it —</span>`;
    }

    /**
     * Generate an HTML report for the given run.
     * The filename is derived from the run's environment and start time:
     *   report-<env>-<yyyy-MM-dd>-HH-mm.html
     * Spaces in the environment name are replaced with underscores.
     * @returns absolute path to the written report file.
     */
    async generate(suiteId: string, runId: string): Promise<string> {
        const runDir = path.join(this.basePath, suiteId, runId);

        // 1. Load manifest
        const manifest: RunManifest = JSON.parse(
            await fsp.readFile(path.join(runDir, 'manifest.json'), 'utf-8')
        );

        // 2. Load all index pages → flat list of summaries
        const summaries = await this.loadAllSummaries(runDir, manifest.totalIndexPages);

        // 3. Load full details for ALL requests (not just failed ones)
        const allDetails = await this.loadAllDetails(runDir, summaries);

        // 4. Build and write HTML
        const html = this.buildHtml(manifest, summaries, allDetails);
        const reportPath = path.join(runDir, this.buildReportFileName(manifest));
        await fsp.writeFile(reportPath, html, 'utf-8');

        return reportPath;
    }

    /**
     * Build the report filename from manifest metadata.
     * Format: report-<env>-<yyyy-MM-dd>-<HH>-<mm>.html
     * Spaces in env name are replaced with underscores.
     */
    private buildReportFileName(manifest: RunManifest): string {
        const env = (manifest.environment || 'default').replace(/\s+/g, '_').replace(/[^\w.-]/g, '');
        let datePart = 'unknown';
        try {
            const d = new Date(manifest.startTime);
            const yyyy = d.getFullYear();
            const MM = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const HH = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            datePart = `${yyyy}-${MM}-${dd}-${HH}-${mm}`;
        } catch { /* keep 'unknown' */ }
        return `report-${env}-${datePart}.html`;
    }

    // ─── Private helpers ───────────────────────────────────────────────────

    private async loadAllSummaries(runDir: string, totalPages: number) {
        const all: IndexPage['summaries'][0][] = [];
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

    /** Load every result file for every request (pass + fail). */
    private async loadAllDetails(
        runDir: string,
        summaries: IndexPage['summaries'][0][]
    ): Promise<Map<string, FullResultDetails>> {
        const map = new Map<string, FullResultDetails>();
        for (const s of summaries) {
            const fileName = buildResultFileName(s.i, s.it, s.r);
            const key = `${s.i}-${s.it}`;
            try {
                const detail: FullResultDetails = JSON.parse(
                    await fsp.readFile(path.join(runDir, 'results', fileName), 'utf-8')
                );
                // Bound in-memory bodies (the Map holds every request's detail).
                // Drop response bodies we won't embed, and truncate the ones we will,
                // so big runs don't exhaust the extension host. Full bodies remain on disk.
                if (this.shouldEmbedBody(s.p)) {
                    if (typeof detail.response?.body === 'string') {
                        detail.response.body = truncateForReport(detail.response.body, this.options.maxBodyChars);
                    }
                } else if (detail.response) {
                    detail.response.body = undefined;
                }
                map.set(key, detail);
            } catch {
                // result file may not exist — silently skip
            }
        }
        return map;
    }

    // ─── HTML builder ──────────────────────────────────────────────────────

    /**
     * Group summaries by iteration, then by contiguous (collection + group path)
     * segments while preserving exact execution order.
     */
    private groupByIterCollectionFolder(
        summaries: ResultSummary[]
    ): Array<{ it: number; groups: Array<{ cn: string; fp: string; gt?: 'folder' | 'block'; items: ResultSummary[] }> }> {
      const grouped: Array<{ it: number; groups: Array<{ cn: string; fp: string; gt?: 'folder' | 'block'; items: ResultSummary[] }> }> = [];

      let currentIteration: { it: number; groups: Array<{ cn: string; fp: string; gt?: 'folder' | 'block'; items: ResultSummary[] }> } | null = null;
      let currentGroup: { cn: string; fp: string; gt?: 'folder' | 'block'; items: ResultSummary[] } | null = null;
      let currentKey: string | null = null;

      for (const s of summaries) {
        const cn = s.cn || '';
        const fp = s.gp || s.fp || '';
        const gt = s.gt;

        if (!currentIteration || currentIteration.it !== s.it) {
          currentIteration = { it: s.it, groups: [] };
          grouped.push(currentIteration);
          currentGroup = null;
          currentKey = null;
        }

        const key = `${gt || ''}\u0000${fp}`;
        if (!currentGroup || key !== currentKey) {
          currentGroup = { cn, fp, gt, items: [] };
          currentIteration.groups.push(currentGroup);
          currentKey = key;
        }

        currentGroup.items.push(s);
      }

      return grouped;
    }

    /**
     * Build a combined group header label like:
     *   "01 - MyCollection: Auth/Login"
     * Collection or folder parts are omitted when empty; falls back to "(root)".
     */
    private groupLabel(cn: string, fp: string, gt: 'folder' | 'block' | undefined, index: number): string {
        const num = String(index).padStart(2, '0');
      let label = '';
      if (gt === 'block') {
        label = escapeHtml(fp || '(unnamed block)');
      } else if (fp) {
            const folders = fp.split('/')
                .map(p => escapeHtml(p.replace(/^\s*\d+\s*-\s*/, '')))
                .join('/');
        label = folders;
        }
        if (!label) label = '(root)';
        return `${num} - ${label}`;
    }

    /** Render the detail accordions grouped by iteration → (collection + folder). */
    private renderGroupedDetails(
        summaries: ResultSummary[],
        m: RunManifest,
        detailFor: (s: ResultSummary) => string
    ): string {
      const multiIter = true;
        return this.groupByIterCollectionFolder(summaries).map(g => {
            const inner = g.groups.map((grp, idx) => {
                const passed = grp.items.filter(s => s.p).length;
                const total = grp.items.length;
                const hasFail = passed < total;
                const body = grp.items.map(detailFor).join('');
                const icon = grp.gt === 'block' ? '🧩' : '📁';
                return `
        <details class="group-block${hasFail ? ' group-fail' : ''}" open>
          <summary class="group-head">
            <span class="group-title">${icon} ${this.groupLabel(grp.cn, grp.fp, grp.gt, idx + 1)}</span>
            <span class="group-count ${hasFail ? 'fail' : 'dim'}">(${passed}/${total})</span>
          </summary>
          <div class="group-body">${body}</div>
        </details>`;
            }).join('');
            if (!multiIter) return inner;
            const passed = g.groups.reduce((a, grp) => a + grp.items.filter(s => s.p).length, 0);
            const total = g.groups.reduce((a, grp) => a + grp.items.length, 0);
            return `
      <details class="iter-block" open>
        <summary class="iter-head">
          <span class="iter-title">Iteration ${g.it}</span>
          <span class="dim iter-count">(${passed}/${total} passed)</span>
        </summary>
        <div class="iter-body">${inner}</div>
      </details>`;
        }).join('');
    }

    /** Render the timeline table rows grouped by iteration → (collection + folder). */
    private renderGroupedTimeline(
        summaries: ResultSummary[],
        m: RunManifest,
        rowFor: (s: ResultSummary) => string
    ): string {
      const multiIter = true;
        const colspan = 8;
        return this.groupByIterCollectionFolder(summaries).map(g => {
            let out = '';
            if (multiIter) {
                out += `<tr class="group-row iter-row"><td colspan="${colspan}">Iteration ${g.it}</td></tr>`;
            }
            g.groups.forEach((grp, idx) => {
              const icon = grp.gt === 'block' ? '🧩' : '📁';
              out += `<tr class="group-row folder-row"><td colspan="${colspan}">${icon} ${this.groupLabel(grp.cn, grp.fp, grp.gt, idx + 1)}</td></tr>`;
                out += grp.items.map(rowFor).join('');
            });
            return out;
        }).join('');
    }

    private buildHtml(
        m: RunManifest,
        summaries: IndexPage['summaries'][0][],
        allDetails: Map<string, FullResultDetails>
    ): string {
        const duration = fmtMs(m.stats.totalDuration);
        const allPassed = m.stats.failed === 0;
        // Per-request detail payload, embedded once as JSON and rendered client-side
        // on expand (see CLIENT_RENDER_SCRIPT) instead of duplicating markup per request.
        const detailData: Record<string, unknown> = {};

        // ── Assertion totals (computed from summaries) ───────────────────
        const totalAssertionsPassed = summaries.reduce((a, s) => a + (s.ap ?? 0), 0);
        const totalAssertionsFailed = summaries.reduce((a, s) => a + (s.af ?? 0), 0);
        const totalAssertionsSkipped = summaries.reduce((a, s) => a + (s.as ?? 0), 0);
        const totalAssertions = totalAssertionsPassed + totalAssertionsFailed + totalAssertionsSkipped;

        // ── Assertion-level stats grouped by request name + folder path ──
        // Build a map: requestId → { name, fp, gp, gt, cn, totalAP, totalAF, durations[] }
        const assertionStatsByReqId = new Map<string, {
            name: string; fp?: string; gp?: string; gt?: 'folder' | 'block'; cn?: string;
            ap: number; af: number; durations: number[];
        }>();
        for (const s of summaries) {
            const existing = assertionStatsByReqId.get(s.r);
            if (existing) {
                existing.ap += (s.ap ?? 0);
                existing.af += (s.af ?? 0);
                existing.durations.push(s.d);
            } else {
                assertionStatsByReqId.set(s.r, {
                    name: s.n, fp: s.fp, gp: s.gp, gt: s.gt, cn: s.cn,
                    ap: s.ap ?? 0, af: s.af ?? 0, durations: [s.d]
                });
            }
        }

        // Build a deduplicated summary list (one entry per unique requestId in execution order)
        // used for grouping the stats table the same way as All Requests tab
        const seenReqIds = new Set<string>();
        const dedupedSummaries: ResultSummary[] = [];
        for (const s of summaries) {
            if (!seenReqIds.has(s.r)) {
                seenReqIds.add(s.r);
                dedupedSummaries.push(s);
            }
        }

        // ── Per-request stats (assertion-based, grouped) ─────────────────
        const statsRowFor = (s: ResultSummary): string => {
            const rs = assertionStatsByReqId.get(s.r);
            if (!rs) return '';
            const totalA = rs.ap + rs.af;
            const pr = passRate(rs.ap, totalA);
            const avgD = rs.durations.length
                ? Math.round(rs.durations.reduce((a, b) => a + b, 0) / rs.durations.length)
                : 0;
            const warn = rs.af > 0 ? ' class="row-fail"' : '';
            const method = HTTP_METHOD_REVERSE[s.m] ?? 'GET';
            return `
          <tr${warn}>
            <td><span class="method method-${method.toLowerCase()}">${method}</span></td>
            <td>${escapeHtml(rs.name)}</td>
            <td>${totalA || '<span class="dim">—</span>'}</td>
            <td class="pass">${rs.ap}</td>
            <td class="${rs.af > 0 ? 'fail' : ''}">${rs.af}</td>
            <td>${fmtMs(avgD)}</td>
            <td class="${rs.af > 0 ? 'fail' : 'pass'}">${pr}</td>
          </tr>`;
        };
        const statsRows = this.renderGroupedTimeline(dedupedSummaries, m, statsRowFor);

        // ── Timeline rows ────────────────────────────────────────────────
        const maxDur = Math.max(...summaries.map(s => s.d), 1);
        const timelineRowFor = (s: ResultSummary) => {
            const method = HTTP_METHOD_REVERSE[s.m] ?? 'GET';
            const w = Math.max(2, Math.round((s.d / maxDur) * 100));
            const cls = s.p ? 'bar-pass' : 'bar-fail';
            const rowCls = s.p ? '' : ' class="row-fail"';
            const anchor = `req-${s.i}-${s.it}`;
            return `
          <tr${rowCls}>
            <td class="dim">${s.i}</td>
            <td>${s.it}</td>
            <td><span class="method method-${method.toLowerCase()}">${method}</span></td>
            <td><a href="#${anchor}" class="req-link">${escapeHtml(s.n)}</a></td>
            <td class="${statusClass(s.s)}">${s.s}</td>
            <td>${fmtMs(s.d)}</td>
            <td><div class="bar-wrap"><div class="${cls}" style="width:${w}%"></div></div></td>
            <td class="${s.p ? 'pass' : 'fail'}">${s.p ? '✓' : '✗'}</td>
          </tr>`;
        };
        const timelineRows = this.renderGroupedTimeline(summaries, m, timelineRowFor);

        // ── Full request detail builder ───────────────────────────────────
        const buildDetailFor = (s: ResultSummary, opts: { inlineFailedAssertions?: boolean } = {}) => {
            const key = `${s.i}-${s.it}`;
            const d = allDetails.get(key);
            const method = HTTP_METHOD_REVERSE[s.m] ?? 'GET';
            const anchor = `req-${s.i}-${s.it}`;
            const passed = s.p;
            const borderColor = passed ? '#1f6feb40' : '#f8514940';

            // Assertions list (pass / fail / skipped)
            const assertions = d?.assertions?.length
                ? `<ul class="assert-list">${
                    d.assertions.map(a => {
                        if (a.skipped) {
                            return `
                    <li class="skip">
                      <span class="assert-icon">⊘</span>
                      <span class="assert-skip-name">${escapeHtml(a.name)}</span>
                      <span class="assert-msg"> — skipped</span>
                    </li>`;
                        }
                        return `
                    <li class="${a.passed ? 'pass' : 'fail'}">
                      <span class="assert-icon">${a.passed ? '✓' : '✗'}</span>
                      ${escapeHtml(a.name)}
                      ${a.message ? `<span class="assert-msg"> — ${escapeHtml(a.message)}</span>` : ''}
                    </li>`;
                    }).join('')
                }</ul>`
                : '<span class="dim">No assertions</span>';

            // Request headers
            const reqHeaders = renderKvTable(d?.request?.headers as Record<string, unknown> | undefined);
            const reqMeta = renderMetaTable(d ? {
              method: d.request?.method,
              url: d.request?.url,
              query: d.request?.query,
              params: d.request?.params,
              bodyType: d.request?.body?.type,
              bodyFormat: d.request?.body?.format,
            } : undefined);

            const rawReqBody = d?.request?.body as any;
            const reqBodyType = rawReqBody && typeof rawReqBody === 'object' ? rawReqBody.type : undefined;
            const requestBodyValue = (rawReqBody && typeof rawReqBody === 'object' && 'content' in rawReqBody)
              ? rawReqBody.content
              : rawReqBody;
            const hasRequestBody = reqBodyType !== 'none' && !(
              requestBodyValue === undefined || requestBodyValue === null || requestBodyValue === ''
            );
            const embedBodies = this.shouldEmbedBody(s.p);
            const reqBody = hasRequestBody
              ? (embedBodies ? renderBody(requestBodyValue, this.options.maxBodyChars) : this.bodyOmittedNote())
              : '';

            // Response headers / body
            const respHeaders = renderKvTable(d?.response?.headers as Record<string, unknown> | undefined);
            const respMeta = renderMetaTable(d ? {
              status: d.status, statusText: d.statusText,
              durationMs: d.duration, responseTimeMs: d.response?.time, responseSizeBytes: d.response?.size,
            } : undefined);
            const respBody = !embedBodies
                ? this.bodyOmittedNote()
                : (d?.response?.body !== undefined && d.response.body !== null
                    ? renderBody(d.response.body, this.options.maxBodyChars)
                    : '<span class="dim">— no body —</span>');
            const respCookies = renderCookieTable(d?.response?.cookies);
            const executionMeta = renderMetaTable(d ? {
              timestamp: d.timestamp ? new Date(d.timestamp).toISOString() : undefined,
              nextRequest: d.nextRequest,
              visualizerTemplate: d.visualizerData?.template,
              visualizerData: d.visualizerData?.data,
            } : undefined);

            const assertionsSection = `
            <div class="detail-section">
              <div class="pane-section-title">Assertions
                <span class="assert-counts">
                  <span class="pass">${s.ap} passed</span>
                  ${s.af > 0 ? `<span class="fail"> · ${s.af} failed</span>` : ''}
                  ${(s.as ?? 0) > 0 ? `<span class="skip-badge"> · ${s.as} skipped</span>` : ''}
                </span>
              </div>
              ${assertions}
            </div>`;

            const execMetaBox = `
              <div class="col-pane exec-meta-box">
                <div class="pane-title">Execution Metadata</div>
                <div class="pane-section">${executionMeta}</div>
              </div>`;

            const reqColSections = `
                <div class="pane-section"><div class="pane-section-title">Overview</div>${reqMeta}</div>
                <div class="pane-section"><div class="pane-section-title">Headers</div>${reqHeaders}</div>
                ${hasRequestBody ? `<div class="pane-section"><div class="pane-section-title">Body</div>${reqBody}</div>` : ''}`;

            const respColSections = `
                <div class="pane-section"><div class="pane-section-title">Overview</div>${respMeta}</div>
                <div class="pane-section"><div class="pane-section-title">Headers</div>${respHeaders}</div>
                <div class="pane-section"><div class="pane-section-title">Cookies</div>${respCookies}</div>
                <div class="pane-section"><div class="pane-section-title">Body</div>${respBody}</div>`;

            const reqShorter = reqColSections.length <= respColSections.length;
            const reqExtra = reqShorter ? execMetaBox : '';
            const respExtra = reqShorter ? '' : execMetaBox;

            const consoleOut = (d as any)?.consoleOutput?.length
                ? `<div class="console-block"><pre class="code console-code">${
                    (d as any).consoleOutput
                        .map((l: any) => escapeHtml(typeof l === 'string' ? l : JSON.stringify(l)))
                        .join('\n')
                }</pre></div>`
                : '';
            const error = d?.error ? `<div class="error-box">⚠ ${escapeHtml(d.error)}</div>` : '';
            const statusBadge = d
                ? `<span class="${statusClass(d.status)} status-badge">${d.status} ${escapeHtml(d.statusText ?? '')}</span>`
                : '';
            const durationBadge = `<span class="dur-badge">${fmtMs(s.d)}</span>`;
            const iterBadge = m.config.iterations > 1 ? `<span class="iter-badge">iter ${s.it}</span>` : '';

            // Store the heavy detail once as data; the browser builds it on expand.
            detailData[`${s.i}-${s.it}`] = {
                d: d ?? null, method, s: s.s, ap: s.ap, af: s.af, as: s.as ?? 0, embed: embedBodies
            };
            const searchText = escapeHtml(`${s.n} ${d?.url ?? ''}`.toLowerCase());

            return `
        <details class="req-detail ${passed ? 'req-pass' : 'req-fail'}" id="${anchor}" data-key="${s.i}-${s.it}" data-search="${searchText}" style="--border:${borderColor}">
          <summary class="req-summary">
            <span class="toggle-icon">▶</span>
            <span class="req-index dim">#${s.i}</span>
            <span class="method method-${method.toLowerCase()}">${method}</span>
            <span class="req-name">${escapeHtml(s.n)}</span>
            ${statusBadge}
            ${durationBadge}
            ${iterBadge}
            <span class="req-outcome ${passed ? 'pass' : 'fail'}">${passed ? '✓' : '✗'}</span>
          </summary>
          <div class="req-body" data-lazy="1"></div>
        </details>`;
        };

        // ── All-requests detail accordions ───────────────────────────────
        const detailFor = (s: ResultSummary) => buildDetailFor(s);
        const requestDetails = this.renderGroupedDetails(summaries, m, detailFor);

        // ── Failures tab: grouped with inline collapsed failed assertions ─
        const failedSummaries = summaries.filter(s => !s.p);
        const failureDetailFor = (s: ResultSummary) => {
            const key = `${s.i}-${s.it}`;
            const d = allDetails.get(key);
            const method = HTTP_METHOD_REVERSE[s.m] ?? 'GET';
            const anchor = `req-${s.i}-${s.it}`;
            const statusBadge = d
                ? `<span class="${statusClass(d.status)} status-badge">${d.status} ${escapeHtml(d.statusText ?? '')}</span>`
                : `<span class="${statusClass(s.s)} status-badge">${s.s}</span>`;
            const durationBadge = `<span class="dur-badge">${fmtMs(s.d)}</span>`;
            const iterBadge = m.config.iterations > 1 ? `<span class="iter-badge">iter ${s.it}</span>` : '';
            const errorMsg = (d?.error ?? s.e) ? `<div class="fail-assert-error">⚠ ${escapeHtml(d?.error ?? s.e ?? '')}</div>` : '';

            // Failed assertions (shown collapsed)
            const failedAsserts = d?.assertions?.filter(a => !a.passed) ?? [];
            const failedAssertHtml = failedAsserts.length
                ? `<ul class="assert-list fail-assert-list">${
                    failedAsserts.map(a => `
                    <li class="fail">
                      <span class="assert-icon">✗</span>
                      <div class="fail-assert-detail">
                        <div class="fail-assert-name">${escapeHtml(a.name)}</div>
                        ${a.message ? `<div class="fail-assert-msg">${escapeHtml(a.message)}</div>` : ''}
                      </div>
                    </li>`).join('')
                }</ul>`
                : '';

            return `
        <div class="fail-entry">
          <a href="#${anchor}" onclick="jumpToRequest('${anchor}')" class="fail-entry-link">
            <div class="fail-entry-header">
              <span class="toggle-icon fail-toggle">▶</span>
              <span class="req-index dim">#${s.i}</span>
              <span class="method method-${method.toLowerCase()}">${method}</span>
              <span class="req-name">${escapeHtml(s.n)}</span>
              ${statusBadge}
              ${durationBadge}
              ${iterBadge}
              <span class="fail-count-badge">${s.af} failed</span>
            </div>
          </a>
          ${failedAssertHtml || errorMsg ? `
          <details class="fail-assertions-block">
            <summary class="fail-assertions-toggle">
              <span class="fail-toggle-icon">▶</span>
              <span class="fail-assertions-label">${failedAsserts.length} failed assertion${failedAsserts.length !== 1 ? 's' : ''}</span>
            </summary>
            <div class="fail-assertions-body">
              ${errorMsg}
              ${failedAssertHtml}
            </div>
          </details>` : ''}
        </div>`;
        };
        const failureDetails = failedSummaries.length > 0
            ? this.renderGroupedDetails(failedSummaries, m, failureDetailFor)
            : '';

        // ── Skipped tab renderer ──────────────────────────────────────────
        // Shows skipped assertions inline (collapsed), same grouping as All Requests.
        const skippedDetailFor = (s: ResultSummary): string => {
            const key = `${s.i}-${s.it}`;
            const d = allDetails.get(key);
            const method = HTTP_METHOD_REVERSE[s.m] ?? 'GET';
            const anchor = `req-${s.i}-${s.it}`;
            const durationBadge = `<span class="dur-badge">${fmtMs(s.d)}</span>`;
            const iterBadge = m.config.iterations > 1 ? `<span class="iter-badge">iter ${s.it}</span>` : '';
            const isRequestSkip = s.s === 0 && s.p;
            const skipAssertions = d?.assertions?.filter(a => a.skipped) ?? [];

            const skipAssertHtml = skipAssertions.length
                ? `<ul class="assert-list fail-assert-list">${
                    skipAssertions.map(a => `
                    <li class="skip">
                      <span class="assert-icon">⊘</span>
                      <div class="fail-assert-detail">
                        <div class="fail-assert-name">${escapeHtml(a.name)}</div>
                        <div class="fail-assert-msg">skipped via pm.test.skip()</div>
                      </div>
                    </li>`).join('')
                }</ul>`
                : '';

            const skipReasonBadge = isRequestSkip
                ? `<span class="skip-count-badge">request skipped</span>`
                : `<span class="skip-count-badge">${s.as ?? skipAssertions.length} assertion${(s.as ?? skipAssertions.length) !== 1 ? 's' : ''} skipped</span>`;

            return `
        <div class="fail-entry" style="border-color:#b08d5740">
          <a href="#${anchor}" onclick="jumpToRequest('${anchor}')" class="fail-entry-link">
            <div class="fail-entry-header" style="background:#1a1600">
              <span class="toggle-icon fail-toggle">▶</span>
              <span class="req-index dim">#${s.i}</span>
              <span class="method method-${method.toLowerCase()}">${method}</span>
              <span class="req-name">${escapeHtml(s.n)}</span>
              ${durationBadge}
              ${iterBadge}
              ${skipReasonBadge}
            </div>
          </a>
          ${skipAssertHtml ? `
          <details class="fail-assertions-block" style="border-top-color:#b08d5740">
            <summary class="fail-assertions-toggle">
              <span class="fail-toggle-icon">▶</span>
              <span class="fail-assertions-label" style="color:#d29922">${skipAssertions.length} skipped assertion${skipAssertions.length !== 1 ? 's' : ''}</span>
            </summary>
            <div class="fail-assertions-body">
              ${skipAssertHtml}
            </div>
          </details>` : ''}
        </div>`;
        };

        // ── Skipped tab ───────────────────────────────────────────────────
        // Two kinds of "skipped":
        //   1. Requests bypassed by setNextRequest() — status=0, passed=true, no assertions
        //   2. Requests that have pm.test.skip() assertions (s.as > 0)
        const skippedRequestSummaries = summaries.filter(s => s.s === 0 && s.p);
        const skippedAssertionSummaries = summaries.filter(s => (s.as ?? 0) > 0);
        // Deduplicated union: requests that appear in either list
        const skippedSummaryIds = new Set([...skippedRequestSummaries, ...skippedAssertionSummaries].map(s => `${s.i}-${s.it}`));
        const skippedSummaries = summaries.filter(s => skippedSummaryIds.has(`${s.i}-${s.it}`));
        const skippedCount = skippedSummaries.length > 0
            ? skippedSummaries.length
            : (m.stats.skipped ?? 0);

        // ── Summary tab content ───────────────────────────────────────────
        const assertPassRate = passRate(totalAssertionsPassed, totalAssertionsPassed + totalAssertionsFailed);
        const reqPassRate = passRate(m.stats.passed, m.stats.totalRequests);
        const avgRespTime = m.stats.avgDuration ? fmtMs(Math.round(m.stats.avgDuration)) : '—';

        // Serialize the per-request detail payload. Escape angle brackets / line
        // separators so the JSON is safe inside a <script> tag and valid to parse.
        const detailsJson = JSON.stringify({ iterations: m.config.iterations, items: detailData })
            .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
            .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

        // Full HTML
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HTTP Forge — ${escapeHtml(m.suiteName)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
       font-size:13px;background:#0d1117;color:#e6edf3;line-height:1.5}
  a{color:#58a6ff;text-decoration:none}
  a:hover{text-decoration:underline}
  h2{font-size:18px;font-weight:600;margin-bottom:12px}
  h3{font-size:14px;font-weight:600;margin:20px 0 8px}
  h4{font-size:12px;font-weight:600;margin:12px 0 4px;color:#8b949e}
  .container{max-width:1260px;margin:0 auto;padding:24px 16px}

  /* ── Header ────────────────────────────────────────────── */
  .header{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px 24px;margin-bottom:20px}
  .header-top{display:flex;justify-content:space-between;align-items:flex-start}
  .suite-name{font-size:22px;font-weight:700}
  .meta{color:#8b949e;margin-top:4px;font-size:12px}
  .badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600}
  .badge-pass{background:#1a4731;color:#3fb950}
  .badge-fail{background:#4d1f24;color:#f85149}

  /* ── Summary cards ──────────────────────────────────────── */
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
  @media(max-width:640px){.cards{grid-template-columns:repeat(2,1fr)}}
  .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center}
  .card-value{font-size:28px;font-weight:700;line-height:1}
  .card-label{font-size:11px;color:#8b949e;margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
  .card-pass .card-value{color:#3fb950}
  .card-fail .card-value{color:#f85149}

  /* ── Section / table ────────────────────────────────────── */
  .section{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px 20px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:6px 10px;font-size:11px;font-weight:600;color:#8b949e;
     text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #30363d}
  td{padding:6px 10px;border-bottom:1px solid #21262d;vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tr.row-fail td{background:#1c0f12}
  .pass{color:#3fb950}
  .fail{color:#f85149}
  .skip{color:#d29922}
  .dim{color:#8b949e;font-size:11px}

  /* ── Status / Method badges ─────────────────────────────── */
  .status-1xx{color:#3fb950}
  .status-2xx{color:#3fb950}
  .status-3xx{color:#58a6ff}
  .status-4xx{color:#d29922}
  .status-5xx{color:#f85149}
  .status-badge{font-size:11px;font-weight:700;padding:1px 5px;border-radius:3px;
                background:#21262d;margin-left:4px}
  .method{display:inline-block;padding:1px 7px;border-radius:4px;font-size:11px;font-weight:700;font-family:monospace;flex-shrink:0}
  .method-get{background:#1a3a4d;color:#58a6ff}
  .method-post{background:#1a4020;color:#3fb950}
  .method-put{background:#3d2800;color:#d29922}
  .method-patch{background:#2d1a40;color:#a371f7}
  .method-delete{background:#4d1f24;color:#f85149}
  .method-head,.method-options{background:#21262d;color:#8b949e}

  /* ── Timeline bar ───────────────────────────────────────── */
  .bar-wrap{background:#21262d;border-radius:3px;height:8px;overflow:hidden}
  .bar-pass{background:#1f6feb;height:8px;border-radius:3px}
  .bar-fail{background:#f85149;height:8px;border-radius:3px}
  .req-link{color:#e6edf3}

  /* ── Request detail accordion ───────────────────────────── */
  .req-detail{border:1px solid var(--border,#30363d);border-radius:8px;margin-bottom:10px;overflow:hidden}
  .req-pass{--border:#1f6feb40}
  .req-fail{--border:#f8514940}

  /* ── Iteration / collection-folder grouping ─────────────── */
  .iter-block{margin-bottom:18px;border:1px solid #30363d;border-radius:8px;overflow:hidden}
  .iter-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#e6edf3;
             padding:9px 14px;background:#161b22;border-left:3px solid #1f6feb;cursor:pointer;
             user-select:none;list-style:none}
  .iter-head::-webkit-details-marker{display:none}
  .iter-head::before{content:'▶';font-size:10px;color:#8b949e;display:inline-block;
                     transition:transform .15s;flex-shrink:0}
  details.iter-block[open]>.iter-head::before{transform:rotate(90deg)}
  .iter-body{padding:12px 14px 4px;background:#0d1117}
  .iter-count{font-weight:400}

  .group-block{margin-bottom:10px;border:1px solid #30363d;border-radius:6px;overflow:hidden}
  .group-head{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#c9d1d9;
              padding:7px 12px;background:#13181f;cursor:pointer;user-select:none;list-style:none}
  .group-head::-webkit-details-marker{display:none}
  .group-head::before{content:'▶';font-size:9px;color:#8b949e;display:inline-block;
                      transition:transform .15s;flex-shrink:0}
  details.group-block[open]>.group-head::before{transform:rotate(90deg)}
  .group-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .group-count{font-weight:400;flex-shrink:0}
  .group-count.fail{color:#f85149;font-weight:600}
  .group-body{padding:10px 12px 2px;background:#0d1117}
  .group-block.group-fail{border-color:#f8514966}
  .group-block.group-fail>.group-head{background:#2d1518;border-left:3px solid #f85149;padding-left:9px}

  .group-row td{background:#161b22;font-weight:700;color:#e6edf3;border-bottom:1px solid #30363d}
  .group-row.folder-row td{font-weight:600;color:#8b949e;padding-left:18px}

  .req-summary{
    display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;
    list-style:none;background:#161b22;user-select:none;flex-wrap:wrap}
  .req-summary::-webkit-details-marker{display:none}
  .toggle-icon{font-size:10px;color:#8b949e;transition:transform .15s;flex-shrink:0}
  .req-detail[open]>.req-summary .toggle-icon{transform:rotate(90deg)}
  .req-index{font-size:11px;min-width:26px}
  .req-name{flex:1;font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .req-outcome{font-size:14px;font-weight:700;margin-left:auto}
  .dur-badge{font-size:11px;color:#8b949e;background:#21262d;padding:1px 6px;border-radius:3px}
  .iter-badge{font-size:11px;color:#8b949e}

  .req-body{padding:16px;background:#0d1117;border-top:1px solid var(--border,#30363d)}

  /* ── URL row ────────────────────────────────────────────── */
  .url-row{display:flex;align-items:center;gap:8px;background:#161b22;border-radius:6px;padding:8px 12px;margin-bottom:14px;overflow:hidden}
  .url-text{font-size:12px;font-family:monospace;color:#8b949e;word-break:break-all;flex:1}

  /* ── Request / Response two-column grid ─────────────────── */
  .req-resp-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
  @media(max-width:780px){.req-resp-grid{grid-template-columns:1fr}}
  .col-stack{display:flex;flex-direction:column;gap:12px;min-width:0}
  .col-pane{background:#161b22;border:1px solid #30363d;border-radius:6px;overflow:hidden}
  .pane-title{font-size:12px;font-weight:700;color:#8b949e;padding:8px 12px;
              border-bottom:1px solid #21262d;text-transform:uppercase;letter-spacing:.5px}
  .pane-section{padding:10px 12px;border-bottom:1px solid #21262d}
  .pane-section:last-child{border-bottom:none}
  .pane-section-title{font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;
                      letter-spacing:.5px;margin-bottom:6px;display:flex;align-items:center;gap:6px}

  /* ── KV table (headers) ──────────────────────────────────── */
  .kv-table{width:100%;border-collapse:collapse}
  .kv-table tr:not(:last-child) td{border-bottom:1px solid #21262d}
  .kv-key{font-family:monospace;font-size:11px;color:#79c0ff;padding:2px 6px 2px 0;
          white-space:nowrap;vertical-align:top;width:40%;min-width:120px}
  .kv-val{font-family:monospace;font-size:11px;color:#8b949e;padding:2px 0;word-break:break-all;vertical-align:top}

  /* ── Code blocks ─────────────────────────────────────────── */
  .code{background:#0d1117;border:1px solid #21262d;border-radius:4px;padding:10px;
        font-size:11px;font-family:monospace;overflow:auto;max-height:400px;white-space:pre;display:block}
  .console-code{color:#d4a657;max-height:200px}

  /* ── Assertions ──────────────────────────────────────────── */
  .assert-list{list-style:none}
  .assert-list li{display:flex;align-items:flex-start;gap:6px;padding:3px 0;font-size:12px;
                  border-bottom:1px solid #21262d}
  .assert-list li:last-child{border-bottom:none}
  .assert-icon{flex-shrink:0;width:14px;text-align:center}
  .assert-msg{color:#8b949e;font-size:11px}
  .assert-counts{font-weight:400;margin-left:6px;font-size:11px}
  .skip-badge{color:#d29922;font-size:11px}
  .assert-skip-name{color:#d29922}

  /* ── Error box ───────────────────────────────────────────── */
  .error-box{background:#4d1f2480;border:1px solid #f8514940;border-radius:6px;
             padding:10px 14px;margin-bottom:12px;color:#f85149;font-family:monospace;font-size:12px}

  /* ── Detail section wrapper ─────────────────────────────── */
  .detail-section{margin-bottom:14px}
  .detail-section:last-child{margin-bottom:0}
  .console-block{margin-top:6px}

  /* ── Tab switcher ────────────────────────────────────────── */
  .tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px}
  .tab{padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;
       background:#21262d;color:#8b949e;border:none;outline:none}
  .tab.active{background:#1f6feb;color:#fff}
  .tab-content{display:none}
  .tab-content.active{display:block}

  /* ── Filter bar ──────────────────────────────────────────── */
  .filter-bar{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}
  .filter-bar input{background:#21262d;border:1px solid #30363d;border-radius:6px;color:#e6edf3;
                    padding:5px 10px;font-size:12px;flex:1;min-width:160px;outline:none}
  .filter-bar input:focus{border-color:#58a6ff}
  .filter-btn{padding:5px 12px;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;
              border:none;background:#21262d;color:#8b949e}
  .filter-btn.active{background:#1f6feb22;color:#58a6ff;border:1px solid #1f6feb}
  .result-count{font-size:11px;color:#8b949e;margin-left:auto}

  /* ── Summary tab ─────────────────────────────────────────── */
  .summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  @media(max-width:640px){.summary-grid{grid-template-columns:1fr}}
  .summary-section{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px 20px}
  .summary-section h3{font-size:13px;font-weight:700;color:#e6edf3;margin-bottom:10px;
                      padding-bottom:6px;border-bottom:1px solid #30363d}
  .summary-row{display:flex;justify-content:space-between;align-items:center;
               padding:5px 0;border-bottom:1px solid #21262d;font-size:12px}
  .summary-row:last-child{border-bottom:none}
  .summary-row-label{color:#8b949e}
  .summary-row-value{font-weight:600}
  .summary-pass-bar{background:#21262d;border-radius:4px;height:6px;overflow:hidden;margin-top:4px}
  .summary-pass-fill{background:#3fb950;height:6px;border-radius:4px}
  .summary-fail-fill{background:#f85149;height:6px;border-radius:4px;margin-left:auto}

  .no-tests-box{text-align:center;padding:40px 20px;color:#8b949e}
  .no-tests-box .no-tests-icon{font-size:40px;margin-bottom:12px}
  .no-tests-box p{font-size:14px}

  /* ── Failures tab ────────────────────────────────────────── */
  .fail-entry{border:1px solid #f8514940;border-radius:8px;margin-bottom:10px;overflow:hidden;background:#0d1117}
  .fail-entry-link{display:block;text-decoration:none;color:inherit}
  .fail-entry-link:hover .fail-entry-header{background:#2d1518}
  .fail-entry-header{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#1c0f12;flex-wrap:wrap}
  .fail-count-badge{font-size:11px;font-weight:700;color:#f85149;background:#4d1f2460;
                    padding:1px 7px;border-radius:10px;margin-left:auto}
  .skip-count-badge{font-size:11px;font-weight:700;color:#d29922;background:#3d280060;
                    padding:1px 7px;border-radius:10px;margin-left:auto}
  .fail-toggle{font-size:10px;color:#8b949e;flex-shrink:0}

  .fail-assertions-block{border-top:1px solid #f8514930}
  .fail-assertions-toggle{display:flex;align-items:center;gap:8px;padding:7px 14px;cursor:pointer;
                          background:#161b22;list-style:none;user-select:none}
  .fail-assertions-toggle::-webkit-details-marker{display:none}
  .fail-toggle-icon{font-size:9px;color:#8b949e;transition:transform .15s;flex-shrink:0}
  details.fail-assertions-block[open]>.fail-assertions-toggle .fail-toggle-icon{transform:rotate(90deg)}
  .fail-assertions-label{font-size:11px;color:#f85149;font-weight:600}
  .fail-assertions-body{padding:10px 14px;background:#0d1117}
  .fail-assert-list{list-style:none}
  .fail-assert-list li{display:flex;align-items:flex-start;gap:8px;padding:5px 0;
                        border-bottom:1px solid #21262d;font-size:12px}
  .fail-assert-list li:last-child{border-bottom:none}
  .fail-assert-detail{flex:1;min-width:0}
  .fail-assert-name{color:#e6edf3;font-weight:500;word-break:break-word}
  .fail-assert-msg{color:#8b949e;font-size:11px;margin-top:2px;word-break:break-word;font-family:monospace}
  .fail-assert-error{background:#4d1f2480;border:1px solid #f8514940;border-radius:4px;
                      padding:6px 10px;color:#f85149;font-family:monospace;font-size:11px;margin-bottom:8px}
</style>
</head>
<body>
<div class="container">

  <!-- ── Header ───────────────────────────────────────────── -->
  <div class="header">
    <div class="header-top">
      <div>
        <div class="suite-name">${escapeHtml(m.suiteName)}</div>
        <div class="meta">
          Environment: <strong>${escapeHtml(m.environment)}</strong> &nbsp;·&nbsp;
          Run ID: <code>${escapeHtml(m.runId)}</code> &nbsp;·&nbsp;
          ${fmtDate(m.startTime)}${m.endTime ? ` → ${fmtDate(m.endTime)}` : ''}
          &nbsp;·&nbsp; Iterations: ${m.config.iterations}
        </div>
      </div>
      <span class="badge ${allPassed ? 'badge-pass' : 'badge-fail'}">
        ${allPassed ? 'PASSED' : 'FAILED'}
      </span>
    </div>
  </div>

  <!-- ── Tabs ─────────────────────────────────────────────── -->
  <div class="tabs">
    <button class="tab active" onclick="showTab('summary',this)">Summary</button>
    <button class="tab" onclick="showTab('requests',this)">Total Requests <span style="background:#21262d;padding:1px 6px;border-radius:8px;margin-left:4px">${summaries.length}</span></button>
    <button class="tab ${m.stats.failed > 0 ? '' : ''}" onclick="showTab('failures',this)">Failed Tests <span style="background:${m.stats.failed > 0 ? '#4d1f24' : '#21262d'};padding:1px 6px;border-radius:8px;margin-left:4px">${m.stats.failed}</span></button>
    <button class="tab" onclick="showTab('skipped',this)">Skipped Tests <span style="background:#21262d;padding:1px 6px;border-radius:8px;margin-left:4px">${skippedCount}</span></button>
    <button class="tab" onclick="showTab('stats',this)">Per-Request Stats</button>
    <button class="tab" onclick="showTab('timeline',this)">Timeline</button>
  </div>

  <!-- ══════════════════════════════════════════════════════ -->
  <!-- Tab: Summary                                          -->
  <!-- ══════════════════════════════════════════════════════ -->
  <div id="tab-summary" class="tab-content active">
    <!-- Summary cards -->
    <div class="cards" style="margin-bottom:16px">
      <div class="card">
        <div class="card-value">${m.stats.totalRequests}</div>
        <div class="card-label">Total Requests</div>
      </div>
      <div class="card card-pass">
        <div class="card-value">${m.stats.passed}</div>
        <div class="card-label">Passed</div>
      </div>
      <div class="card ${m.stats.failed > 0 ? 'card-fail' : ''}">
        <div class="card-value">${m.stats.failed}</div>
        <div class="card-label">Failed</div>
      </div>
      <div class="card">
        <div class="card-value">${duration}</div>
        <div class="card-label">Total Duration</div>
      </div>
    </div>

    <div class="summary-grid">
      <!-- Assertions -->
      <div class="summary-section">
        <h3>Assertions</h3>
        <div class="summary-row">
          <span class="summary-row-label">Total</span>
          <span class="summary-row-value">${totalAssertions}</span>
        </div>
        <div class="summary-row">
          <span class="summary-row-label">Passed</span>
          <span class="summary-row-value pass">${totalAssertionsPassed}</span>
        </div>
        <div class="summary-row">
          <span class="summary-row-label">Failed</span>
          <span class="summary-row-value ${totalAssertionsFailed > 0 ? 'fail' : ''}">${totalAssertionsFailed}</span>
        </div>
        <div class="summary-row">
          <span class="summary-row-label">Skipped</span>
          <span class="summary-row-value dim">${totalAssertionsSkipped}</span>
        </div>
        <div class="summary-row">
          <span class="summary-row-label">Pass Rate</span>
          <span class="summary-row-value ${totalAssertionsFailed > 0 ? 'fail' : 'pass'}">${assertPassRate}</span>
        </div>
        ${(totalAssertionsPassed + totalAssertionsFailed) > 0 ? `
        <div style="margin-top:10px">
          <div class="summary-pass-bar">
            <div class="summary-pass-fill" style="width:${Math.round(totalAssertionsPassed/(totalAssertionsPassed+totalAssertionsFailed)*100)}%"></div>
          </div>
        </div>` : ''}
      </div>

      <!-- Requests -->
      <div class="summary-section">
        <h3>Requests</h3>
        <div class="summary-row">
          <span class="summary-row-label">Total Executed</span>
          <span class="summary-row-value">${m.stats.totalRequests}</span>
        </div>
        <div class="summary-row">
          <span class="summary-row-label">Passed</span>
          <span class="summary-row-value pass">${m.stats.passed}</span>
        </div>
        <div class="summary-row">
          <span class="summary-row-label">Failed</span>
          <span class="summary-row-value ${m.stats.failed > 0 ? 'fail' : ''}">${m.stats.failed}</span>
        </div>
        <div class="summary-row">
          <span class="summary-row-label">Pass Rate</span>
          <span class="summary-row-value ${m.stats.failed > 0 ? 'fail' : 'pass'}">${reqPassRate}</span>
        </div>
        <div class="summary-row">
          <span class="summary-row-label">Iterations</span>
          <span class="summary-row-value">${m.config.iterations}</span>
        </div>
      </div>

      <!-- Timings -->
      <div class="summary-section">
        <h3>Timings</h3>
        <div class="summary-row">
          <span class="summary-row-label">Total Duration</span>
          <span class="summary-row-value">${fmtMs(m.stats.totalDuration)}</span>
        </div>
        <div class="summary-row">
          <span class="summary-row-label">Average Response</span>
          <span class="summary-row-value">${avgRespTime}</span>
        </div>
        ${m.stats.p50 !== undefined ? `<div class="summary-row"><span class="summary-row-label">P50</span><span class="summary-row-value">${fmtMs(m.stats.p50)}</span></div>` : ''}
        ${m.stats.p95 !== undefined ? `<div class="summary-row"><span class="summary-row-label">P95</span><span class="summary-row-value">${fmtMs(m.stats.p95)}</span></div>` : ''}
        ${m.stats.p99 !== undefined ? `<div class="summary-row"><span class="summary-row-label">P99</span><span class="summary-row-value">${fmtMs(m.stats.p99)}</span></div>` : ''}
        <div class="summary-row">
          <span class="summary-row-label">Min Response</span>
          <span class="summary-row-value">${fmtMs(m.stats.minDuration)}</span>
        </div>
        <div class="summary-row">
          <span class="summary-row-label">Max Response</span>
          <span class="summary-row-value">${fmtMs(m.stats.maxDuration)}</span>
        </div>
      </div>

      <!-- Environment -->
      <div class="summary-section">
        <h3>Run Info</h3>
        <div class="summary-row">
          <span class="summary-row-label">Suite</span>
          <span class="summary-row-value" style="text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis">${escapeHtml(m.suiteName)}</span>
        </div>
        <div class="summary-row">
          <span class="summary-row-label">Environment</span>
          <span class="summary-row-value" style="text-align:right">${escapeHtml(m.environment)}</span>
        </div>
        <div class="summary-row">
          <span class="summary-row-label">Status</span>
          <span class="summary-row-value"><span class="badge ${allPassed ? 'badge-pass' : 'badge-fail'}" style="font-size:11px">${allPassed ? 'PASSED' : 'FAILED'}</span></span>
        </div>
        <div class="summary-row">
          <span class="summary-row-label">Start Time</span>
          <span class="summary-row-value dim" style="text-align:right;font-size:11px">${fmtDate(m.startTime)}</span>
        </div>
        ${m.endTime ? `<div class="summary-row"><span class="summary-row-label">End Time</span><span class="summary-row-value dim" style="text-align:right;font-size:11px">${fmtDate(m.endTime)}</span></div>` : ''}
        <div class="summary-row">
          <span class="summary-row-label">Run ID</span>
          <span class="summary-row-value dim" style="font-family:monospace;font-size:10px">${escapeHtml(m.runId)}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- ══════════════════════════════════════════════════════ -->
  <!-- Tab: All Requests (detailed panels)                   -->
  <!-- ══════════════════════════════════════════════════════ -->
  <div id="tab-requests" class="tab-content">
    <div class="filter-bar">
      <input id="req-search" type="text" placeholder="Filter by name or URL…" oninput="filterRequests()">
      <button class="filter-btn active" id="btn-all"    onclick="setFilter('all',this)">All</button>
      <button class="filter-btn"        id="btn-pass"   onclick="setFilter('pass',this)">Passed</button>
      <button class="filter-btn"        id="btn-fail"   onclick="setFilter('fail',this)">Failed</button>
      <span class="result-count" id="req-count">${summaries.length} requests</span>
    </div>
    <div id="requests-list">
      ${requestDetails}
    </div>
  </div>

  <!-- ══════════════════════════════════════════════════════ -->
  <!-- Tab: Failed Tests                                     -->
  <!-- ══════════════════════════════════════════════════════ -->
  <div id="tab-failures" class="tab-content">
    ${failedSummaries.length === 0
      ? `<div class="no-tests-box">
           <div class="no-tests-icon">🎉</div>
           <p style="color:#3fb950;font-weight:600">No failed tests!</p>
           <p style="margin-top:6px">All ${totalAssertions} assertion${totalAssertions !== 1 ? 's' : ''} passed.</p>
         </div>`
      : `<p class="dim" style="margin-bottom:12px">
           ${totalAssertionsFailed} failed assertion${totalAssertionsFailed !== 1 ? 's' : ''} across ${failedSummaries.length} request${failedSummaries.length !== 1 ? 's' : ''} —
           click ▶ to expand assertions, or the request header to jump to full details.
         </p>
         ${failureDetails}`}
  </div>

  <!-- ══════════════════════════════════════════════════════ -->
  <!-- Tab: Skipped Tests                                    -->
  <!-- ══════════════════════════════════════════════════════ -->
  <div id="tab-skipped" class="tab-content">
    ${skippedCount === 0
      ? `<div class="no-tests-box">
           <div class="no-tests-icon">👍</div>
           <p style="font-weight:600">There are no skipped tests</p>
         </div>`
      : `<p class="dim" style="margin-bottom:12px">
           ${totalAssertionsSkipped > 0 ? `${totalAssertionsSkipped} skipped assertion${totalAssertionsSkipped !== 1 ? 's' : ''} (via pm.test.skip())` : ''}
           ${totalAssertionsSkipped > 0 && skippedRequestSummaries.length > 0 ? ' and ' : ''}
           ${skippedRequestSummaries.length > 0 ? `${skippedRequestSummaries.length} bypassed request${skippedRequestSummaries.length !== 1 ? 's' : ''} (via setNextRequest())` : ''}
           — click ▶ to expand details, or the request header to jump to full details.
         </p>
         ${this.renderGroupedDetails(skippedSummaries, m, skippedDetailFor)}`}
  </div>

  <!-- ══════════════════════════════════════════════════════ -->
  <!-- Tab: Per-request stats (assertion-based, grouped)    -->
  <!-- ══════════════════════════════════════════════════════ -->
  <div id="tab-stats" class="tab-content section">
    <p class="dim" style="margin-bottom:10px;font-size:11px">
      Pass/Fail/Pass% are based on <strong>assertions</strong>, not requests.
      Grouped by folder/block, same as the All Requests tab.
    </p>
    <table>
      <thead>
        <tr>
          <th style="width:60px">Method</th>
          <th>Request</th>
          <th style="width:80px">Assertions</th>
          <th style="width:60px">Pass</th>
          <th style="width:60px">Fail</th>
          <th style="width:70px">Avg</th>
          <th style="width:70px">Pass%</th>
        </tr>
      </thead>
      <tbody>${statsRows}</tbody>
    </table>
  </div>

  <!-- ══════════════════════════════════════════════════════ -->
  <!-- Tab: Timeline                                         -->
  <!-- ══════════════════════════════════════════════════════ -->
  <div id="tab-timeline" class="tab-content section">
    <table>
      <thead>
        <tr>
          <th>#</th><th>Iter</th><th>Method</th><th>Name</th>
          <th>Status</th><th>Duration</th><th style="width:160px">Timeline</th><th></th>
        </tr>
      </thead>
      <tbody>${timelineRows}</tbody>
    </table>
  </div>

  <p class="dim" style="margin-top:20px;text-align:center">
    Generated by HTTP Forge &nbsp;·&nbsp; ${fmtDate(new Date().toISOString())}
  </p>
</div>
<script id="hf-details" type="application/json">${detailsJson}</script>
<script>${CLIENT_RENDER_SCRIPT}</script>
<script>
  // ── Tab switching ────────────────────────────────────────
  function showTab(name, btn) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
    const content = document.getElementById('tab-' + name);
    if (content) content.classList.add('active');
    if (btn) btn.classList.add('active');
  }

  // ── Request filter / search ──────────────────────────────
  let activeFilter = 'all';

  function setFilter(f, btn) {
    activeFilter = f;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterRequests();
  }

  function filterRequests() {
    const q = (document.getElementById('req-search').value || '').toLowerCase();
    const items = document.querySelectorAll('#requests-list .req-detail');
    let visible = 0;
    items.forEach(el => {
      const isPassed = el.classList.contains('req-pass');
      const text = (el.getAttribute('data-search') || '');
      const matchFilter = activeFilter === 'all'
        || (activeFilter === 'pass' && isPassed)
        || (activeFilter === 'fail' && !isPassed);
      const matchSearch = !q || text.includes(q);
      const show = matchFilter && matchSearch;
      el.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    const cnt = document.getElementById('req-count');
    if (cnt) cnt.textContent = visible + ' request' + (visible !== 1 ? 's' : '');
  }

  // ── Jump to request (opens accordion then scrolls) ───────
  function openAncestorDetails(el) {
    let p = el.parentElement;
    while (p) {
      if (p.tagName === 'DETAILS') p.open = true;
      p = p.parentElement;
    }
  }

  function jumpToRequest(id) {
    // Switch to All Requests tab
    const reqTab = document.querySelector('.tab:nth-child(2)');
    showTab('requests', reqTab);
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        openAncestorDetails(el);
        el.open = true;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
  }

  // ── Smooth scroll for timeline links ────────────────────
  document.addEventListener('click', function(e) {
    const a = e.target.closest('a.req-link');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('#')) return;
    e.preventDefault();
    const reqTab = document.querySelector('.tab:nth-child(2)');
    showTab('requests', reqTab);
    setTimeout(() => {
      const id = href.slice(1);
      const el = document.getElementById(id);
      if (el) {
        openAncestorDetails(el);
        el.open = true;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
  });
</script>
</body>
</html>`;
    }
}
