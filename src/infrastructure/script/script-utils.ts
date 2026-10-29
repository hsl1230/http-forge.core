/**
 * Script Utilities
 * 
 * Single Responsibility: Pure utility functions for script execution
 * These are stateless helper functions with no side effects
 */

import { TestAssertion } from '../../types/types';
import { CookieUtils } from '../cookie/cookie-utils';
import { Cookie } from '../cookie/interfaces';

/**
 * Console message structure for script output
 */
export interface ConsoleMessage {
    level: 'log' | 'info' | 'warn' | 'error';
    args: any[];
}

/**
 * Concatenate multiple scripts into one program.
 *
 * - shared (default): scripts are joined into one scope, so variables/functions declared
 *   in an earlier script are visible to later scripts (and, via var/function hoisting onto
 *   the shared VM global, to the post-response phase).
 * - isolated: each script unit is wrapped in its own async IIFE, so its var/const/let/function
 *   declarations cannot collide within a phase or leak across phases (Postman parity). The
 *   whole batch is wrapped in one outer async IIFE so top-level `await` inside any unit works
 *   and the program resolves to an awaitable promise.
 */
export function concatenateScripts(scripts: string | string[], isolate = false): string {
    const list = (typeof scripts === 'string' ? [scripts] : scripts).filter(s => s && s.trim());
    if (list.length === 0) {
        return '';
    }

    if (!isolate) {
        return list.join('\n\n// --- Next Script ---\n\n');
    }

    const wrapped = list
        .map((s, i) => `await (async () => {\n/* --- script unit ${i + 1} --- */\n${s}\n})();`)
        .join('\n');
    return `(async () => {\n${wrapped}\n})();`;
}

/**
 * Check if an object has changed from its original value
 * Uses JSON serialization for deep comparison
 */
export function hasChanged(current: any, original: any): boolean {
    return JSON.stringify(current) !== JSON.stringify(original);
}

/**
 * Format console messages into output strings
 */
export function formatConsoleOutput(messages: ConsoleMessage[]): string[] {
    return messages.map(msg => {
        const formatted = msg.args.map(arg => {
            if (typeof arg === 'object') {
                try { 
                    return JSON.stringify(arg, null, 2); 
                } catch { 
                    return String(arg); 
                }
            }
            return String(arg);
        }).join(' ');
        return `[${msg.level}] ${formatted}`;
    });
}

/**
 * Create a script console that captures output
 */
export function createScriptConsole(messages: ConsoleMessage[]): Console {
    return {
        log: (...args: any[]) => messages.push({ level: 'log', args }),
        info: (...args: any[]) => messages.push({ level: 'info', args }),
        warn: (...args: any[]) => messages.push({ level: 'warn', args }),
        error: (...args: any[]) => messages.push({ level: 'error', args })
    } as unknown as Console;
}

/**
 * Create a test function that records assertions
 * Supports both sync and async test functions (Postman-compatible)
 */
export function createTestFunction(assertions: TestAssertion[]) {
    const pendingTests: Promise<void>[] = [];

    const testFn: any = (name: string, fn: () => void | Promise<void>) => {
        try {
            const result = fn();
            // Handle async test functions — track promise for later awaiting
            if (result && typeof (result as any).then === 'function') {
                const promise = (result as Promise<void>).then(
                    () => { assertions.push({ name, passed: true }); },
                    (error: any) => { assertions.push({ name, passed: false, message: error.message || String(error) }); }
                );
                pendingTests.push(promise);
            } else {
                assertions.push({ name, passed: true });
            }
        } catch (error: any) {
            assertions.push({ 
                name, 
                passed: false, 
                message: error.message 
            });
        }
    };

    // Postman-compatible pm.test.skip(name, fn?) — records a skipped result without running fn
    testFn.skip = (name: string, _fn?: () => void | Promise<void>) => {
        assertions.push({ name, passed: true, skipped: true });
    };

    // Postman-compatible pm.test.fail(name) — records an immediate failed assertion
    testFn.fail = (name: string) => {
        assertions.push({ name: name || 'Failed test', passed: false, message: name || 'pm.test.fail()' });
    };

    // Postman-compatible pm.test.index() — index of the next test in execution order
    testFn.index = () => assertions.length;

    // Expose pending tests for awaiting after script execution
    testFn._pendingTests = pendingTests;
    return testFn;
}

/**
 * Normalize HTTP headers to Record<string, string>
 * Converts multi-value headers (string[]) to comma-separated strings
 */
export function normalizeHeaders(headers: Record<string, string | string[]>): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        normalized[key] = Array.isArray(value) ? value.join(', ') : value;
    }
    return normalized;
}

/**
 * Build rich response cookie metadata for the legacy Postman sandbox.
 *
 * Prefers parsing the raw `Set-Cookie` response headers via CookieUtils, which
 * captures full metadata (domain, path, expires, maxAge, httpOnly, secure,
 * sameSite). Falls back to the HTTP client's already-parsed cookie array when
 * the raw headers are unavailable (e.g. some fetch-based transports).
 *
 * @param headers - Raw response headers (Set-Cookie may be a string[])
 * @param parsedCookies - Cookie objects already parsed by the HTTP client
 * @param requestUrl - URL used to derive the default cookie domain
 */
export function parseResponseCookieDetails(
    headers: Record<string, string | string[]> | undefined,
    parsedCookies: any[] | undefined,
    requestUrl?: string
): Cookie[] {
    let defaultDomain: string | undefined;
    if (requestUrl) {
        try {
            defaultDomain = new URL(requestUrl).hostname;
        } catch {
            defaultDomain = undefined;
        }
    }

    const fromHeaders = CookieUtils.parseCookieHeaders(headers || {}, defaultDomain);
    if (fromHeaders.length > 0) {
        return fromHeaders;
    }

    // Fallback: map the HTTP client's parsed cookies into the rich Cookie shape.
    if (Array.isArray(parsedCookies) && parsedCookies.length > 0) {
        return parsedCookies
            .filter(c => c && c.name)
            .map(c => ({
                name: c.name,
                value: c.value,
                domain: c.domain ?? defaultDomain,
                path: c.path,
                expires: c.expires,
                maxAge: c.maxAge,
                httpOnly: c.httpOnly,
                secure: c.secure,
                sameSite: c.sameSite,
            }));
    }

    return [];
}
