/**
 * Request diagnostics — pre-AI checklist for explain_failure.
 *
 * Single Responsibility: perform deterministic diagnostic checks on a request,
 * its environment, and its response before handing off to the LLM. This gives
 * the AI concrete findings to work from instead of raw data alone.
 */

export interface DiagnosticCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
}

/**
 * Run diagnostic checks on a failed request result.
 * Returns an array of checks that can be fed into the LLM prompt.
 */
export function diagnoseRequest(result: Record<string, unknown>): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];

  // 1. Execution error
  const requestError = result.error as string | undefined;
  if (requestError) {
    checks.push({
      name: 'Request execution',
      status: 'fail',
      detail: requestError,
    });
  } else {
    checks.push({
      name: 'Request execution',
      status: 'pass',
      detail: 'Request executed without transport errors',
    });
  }

  // 2. Response status
  const status = result.status as number | undefined;
  if (status !== undefined) {
    const ok = status >= 200 && status < 400;
    checks.push({
      name: 'Response status',
      status: ok ? 'pass' : 'fail',
      detail: `${status} ${result.statusText || ''}`.trim(),
    });
  }

  // 3. Failed assertions
  const assertions = result.assertions as Array<{ name: string; passed: boolean; message?: string }> | undefined;
  const failed = (assertions || []).filter((a) => !a.passed);
  if (failed.length > 0) {
    checks.push({
      name: 'Assertions',
      status: 'fail',
      detail: `${failed.length} of ${assertions?.length ?? 0} assertion(s) failed: ${failed.map((a) => a.name).join(', ')}`,
    });
  } else if (assertions && assertions.length > 0) {
    checks.push({
      name: 'Assertions',
      status: 'pass',
      detail: `All ${assertions.length} assertion(s) passed`,
    });
  }

  // 4. Response time
  const duration = result.duration as number | undefined;
  if (duration !== undefined && duration > 5000) {
    checks.push({
      name: 'Response time',
      status: 'warn',
      detail: `${duration}ms — unusually slow`,
    });
  }

  // 5. Environment variable resolution
  const url = (result.url || result.requestUrl || '') as string;
  const headers = (result.requestHeaders || result.headers || {}) as Record<string, string>;
  const varRefs = (url.match(/\{\{([^}]+)\}\}/g) || []).map((m: string) => m.replace(/[{}]/g, '').trim());
  // Also check headers for variable refs
  for (const val of Object.values(headers)) {
    const refs = (val.match(/\{\{([^}]+)\}\}/g) || []).map((m: string) => m.replace(/[{}]/g, '').trim());
    varRefs.push(...refs);
  }
  const uniqueRefs = [...new Set(varRefs)].filter((r) => !r.startsWith('secret:'));
  if (uniqueRefs.length > 0) {
    // Check if any ref still appears unresolved in the URL or headers
    const unresolved = uniqueRefs.filter((ref) => {
      return url.includes(`{{${ref}}}`) || Object.values(headers).some((v) => v.includes(`{{${ref}}}`));
    });
    if (unresolved.length > 0) {
      checks.push({
        name: 'Environment variables',
        status: 'fail',
        detail: `Unresolved variable(s): ${unresolved.join(', ')}. Check that they are defined in the selected environment.`,
      });
    } else {
      checks.push({
        name: 'Environment variables',
        status: 'pass',
        detail: `All ${uniqueRefs.length} variable(s) resolved`,
      });
    }
  }

  // 6. Auth header
  const hasAuth = Object.keys(headers).some((k) => k.toLowerCase() === 'authorization');
  if (!hasAuth && (result.method === 'POST' || result.method === 'PUT' || result.method === 'DELETE')) {
    checks.push({
      name: 'Auth header',
      status: 'warn',
      detail: 'No Authorization header found for a mutating request',
    });
  }

  // 7. Content-Type for body
  const method = (result.method || '') as string;
  const requestBody = result.requestBody ?? result.body;
  if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase()) && requestBody && !headers['Content-Type'] && !headers['content-type']) {
    checks.push({
      name: 'Content-Type header',
      status: 'warn',
      detail: 'Missing Content-Type header for request with body',
    });
  }

  // 8. Empty response
  const body = result.responseBody ?? result.body;
  if (body === undefined || body === null || body === '') {
    checks.push({
      name: 'Response body',
      status: 'warn',
      detail: 'Response body is empty',
    });
  }

  return checks;
}

/**
 * Format diagnostic checks as a text block for inclusion in an LLM prompt.
 */
export function formatDiagnostics(checks: DiagnosticCheck[]): string {
  if (checks.length === 0) return '';
  return 'Diagnostic checks:\n' + checks
    .map((c) => `- [${c.status.toUpperCase()}] ${c.name}: ${c.detail}`)
    .join('\n');
}
