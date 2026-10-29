import { describe, expect, it } from 'vitest';
import {
  ReviewRequestResult,
  reviewSuiteRun,
  toReviewRequestResults,
} from '../../infrastructure/review/review-engine';
import type { TestSuite } from '../../infrastructure/test-suite/interfaces';

describe('reviewSuiteRun — rule engine', () => {
  it('flags response bodies that leak secrets (JWT/bearer/PEM)', () => {
    const findings = reviewSuiteRun(undefined, [
      {
        name: 'getProfile',
        method: 'GET',
        status: 200,
        body: { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123' },
      },
    ]).findings;
    const leak = findings.find((f) => f.rule === 'response-leaks-secrets');
    expect(leak).toBeDefined();
    expect(leak!.severity).toBe('error');
    expect(leak!.requestName).toBe('getProfile');
  });

  it('flags 5xx server errors at error severity', () => {
    const report = reviewSuiteRun(undefined, [
      { name: 'createOrder', method: 'POST', status: 500, body: 'oops' },
    ]);
    const finding = report.findings.find((f) => f.rule === 'server-error');
    expect(finding).toBeDefined();
    expect(finding!.title).toBe('Unexpected 500 server error');
    expect(report.summary.errors).toBe(1);
    expect(report.summary.pass).toBe(false);
  });

  it('flags transport/script errors', () => {
    const findings = reviewSuiteRun(undefined, [
      { name: 'ping', error: 'ECONNREFUSED 127.0.0.1:3000' },
    ]).findings;
    const finding = findings.find((f) => f.rule === 'request-error');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('error');
    expect(finding!.message).toContain('ECONNREFUSED');
  });

  it('flags failed assertions', () => {
    const findings = reviewSuiteRun(undefined, [
      {
        name: 'getUser',
        method: 'GET',
        status: 200,
        assertions: [
          { name: 'status is 200', passed: true },
          { name: 'has id', passed: false, message: 'expected body.id to exist' },
        ],
      },
    ]).findings;
    const finding = findings.find((f) => f.rule === 'failed-assertions');
    expect(finding).toBeDefined();
    expect(finding!.title).toBe('1 assertion failed');
  });

  it('flags DELETE returning 200 (not 204) as a warn', () => {
    const findings = reviewSuiteRun(undefined, [
      { name: 'deleteUser', method: 'DELETE', status: 200 },
    ]).findings;
    const finding = findings.find((f) => f.rule === 'delete-not-204');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warn');
    expect(finding!.title).toBe('DELETE returned a non-204 success');
  });

  it('does not flag DELETE returning 204', () => {
    const findings = reviewSuiteRun(undefined, [
      { name: 'deleteUser', method: 'DELETE', status: 204 },
    ]).findings;
    expect(findings.find((f) => f.rule === 'delete-not-204')).toBeUndefined();
  });

  it('warns on missing assertions unless allowNoAssertions', () => {
    const result: ReviewRequestResult = { name: 'getHealth', method: 'GET', status: 200 };
    expect(reviewSuiteRun(undefined, [result]).findings.some((f) => f.rule === 'missing-assertions')).toBe(true);
    const report = reviewSuiteRun(undefined, [result], { allowNoAssertions: true });
    expect(report.findings.some((f) => f.rule === 'missing-assertions')).toBe(false);
  });

  it('flags an unhandled 401/403 but not one that is asserted', () => {
    const unhandled = reviewSuiteRun(undefined, [
      { name: 'getAdmin', method: 'GET', status: 401 },
    ]).findings;
    expect(unhandled.some((f) => f.rule === 'auth-failure-unhandled')).toBe(true);

    const handled = reviewSuiteRun(undefined, [
      {
        name: 'getAdmin',
        method: 'GET',
        status: 401,
        assertions: [{ name: 'rejects unauthenticated', passed: true, message: 'status is 401' }],
      },
    ]).findings;
    expect(handled.some((f) => f.rule === 'auth-failure-unhandled')).toBe(false);
  });

  it('flags slow responses over the threshold', () => {
    const findings = reviewSuiteRun(undefined, [
      { name: 'slowEndpoint', method: 'GET', status: 200, duration: 3500 },
    ]).findings;
    const finding = findings.find((f) => f.rule === 'slow-response');
    expect(finding).toBeDefined();
    expect(finding!.title).toBe('Slow response (3500ms)');

    const fast = reviewSuiteRun(undefined, [
      { name: 'fastEndpoint', method: 'GET', status: 200, duration: 100 },
    ]).findings;
    expect(fast.find((f) => f.rule === 'slow-response')).toBeUndefined();
  });

  it('sorts findings by severity then rule, and runs all 8 rules', () => {
    const report = reviewSuiteRun(undefined, [
      { name: 'r1', method: 'GET', status: 200 },
      { name: 'r2', method: 'DELETE', status: 200, duration: 5000 },
    ]);
    expect(report.rulesRun).toEqual([
      'response-leaks-secrets',
      'server-error',
      'request-error',
      'failed-assertions',
      'delete-not-204',
      'missing-assertions',
      'auth-failure-unhandled',
      'slow-response',
    ]);
    const severities = report.findings.map((f) => f.severity);
    expect(severities).toEqual([...severities].sort((a, b) => rank(a) - rank(b)));
  });

  it('annotates suite coverage for never-ran requests without assertions', () => {
    const suite: TestSuite = {
      id: 's1',
      name: 'Smoke',
      createdAt: 0,
      updatedAt: 0,
      config: { iterations: 1, delayBetweenRequests: 0, stopOnError: false, readFromSharedSession: false, writeToSharedSession: false },
      nodes: [
        {
          type: 'request',
          request: { collectionId: 'c1', collectionName: 'C', requestId: 'r1', name: 'Executed', method: 'GET', folderPath: '' },
          postResponseScript: ['pm.test("status is 200", () => pm.response.to.have.status(200));'],
        },
        {
          type: 'request',
          request: { collectionId: 'c1', collectionName: 'C', requestId: 'r2', name: 'Never Ran', method: 'GET', folderPath: '' },
        },
      ],
    };
    const report = reviewSuiteRun(suite, [{ name: 'Executed', method: 'GET', status: 200 }]);
    const coverage = report.findings.find((f) => f.title === 'Suite request never ran');
    expect(coverage).toBeDefined();
    expect(coverage!.requestName).toBe('Never Ran');
  });
});

describe('toReviewRequestResults — normalization', () => {
  it('accepts a bare array', () => {
    const arr = [{ name: 'a', status: 200 }];
    expect(toReviewRequestResults(arr)).toEqual(arr);
  });

  it('accepts an McpRunRecord-style { allResults } object', () => {
    const results = [{ name: 'a', status: 200 }];
    expect(toReviewRequestResults({ status: 'completed', allResults: results })).toEqual(results);
  });

  it('returns [] for anything else', () => {
    expect(toReviewRequestResults({ status: 'running' })).toEqual([]);
    expect(toReviewRequestResults(null)).toEqual([]);
    expect(toReviewRequestResults(undefined)).toEqual([]);
  });
});

function rank(s: string): number {
  return s === 'error' ? 0 : s === 'warn' ? 1 : 2;
}
