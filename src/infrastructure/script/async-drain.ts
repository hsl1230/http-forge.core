/**
 * Async Drain — Postman-compatible event-loop draining for script sandboxes
 *
 * Postman/Newman keep a script's sandbox alive after its synchronous body returns,
 * pumping the event loop until all pending timers (`setTimeout`/`setInterval`) and
 * microtasks (un-awaited Promises) have settled — bounded by a script timeout. Only
 * then does the runner advance, committing any variable mutations made by those late
 * callbacks so the next request can see them.
 *
 * This module provides an instrumented timer set plus a `drain()` loop that replicates
 * that behavior. The timers wrap the real Node timers, track outstanding handles, and
 * swallow errors thrown inside deferred callbacks (reporting them as non-fatal) so a
 * late failure never rejects the surrounding request — matching Postman, where such
 * callbacks run on a later tick outside the script's try/catch.
 */

/** Sandbox-facing timer functions, drop-in replacements for the Node globals. */
export interface SandboxTimers {
    setTimeout: (handler: (...args: any[]) => void, timeout?: number, ...args: any[]) => any;
    clearTimeout: (handle: any) => void;
    setInterval: (handler: (...args: any[]) => void, timeout?: number, ...args: any[]) => any;
    clearInterval: (handle: any) => void;
}

/** Result of a drain operation. */
export interface DrainResult {
    /** True if the timeout cap was hit while timers were still pending. */
    timedOut: boolean;
    /** Approximate wall-clock time spent draining, in milliseconds. */
    elapsedMs: number;
}

/**
 * A registry of instrumented timers bound to a single script session.
 */
export interface TimerRegistry {
    /** Timer functions to expose inside the VM sandbox. */
    readonly timers: SandboxTimers;
    /** Number of timers still pending (not yet fired or cleared, or active intervals). */
    pendingCount(): number;
    /** Cancel every outstanding timer. Used at the drain cap and on dispose. */
    clearAll(): void;
    /**
     * Pump the event loop until no timers are pending (and a final microtask flush
     * yields nothing new) or until `timeoutMs` of wall-clock time elapses, whichever
     * comes first. On timeout, all remaining timers are force-cleared.
     */
    drain(timeoutMs: number): Promise<DrainResult>;
}

/** Poll interval for the drain loop. Small enough to keep latency tight, large
 * enough to avoid a hot spin while waiting on a pending timer. */
const DRAIN_POLL_MS = 15;

/**
 * Create a timer registry whose deferred-callback errors are routed to `onTimerError`.
 *
 * @param onTimerError Invoked (never throws) when a timer callback throws. The error is
 *                     swallowed relative to the request so the run continues.
 */
export function createTimerRegistry(
    onTimerError: (error: unknown) => void
): TimerRegistry {
    // Active one-shot timeout handles and interval handles. We track them so the drain
    // loop knows when the sandbox is idle and so clearAll() can cancel everything.
    const activeTimeouts = new Set<NodeJS.Timeout>();
    const activeIntervals = new Set<NodeJS.Timeout>();

    const safeInvoke = (handler: (...args: any[]) => void, args: any[]): void => {
        try {
            handler(...args);
        } catch (error) {
            // Deferred callbacks run on a later tick; in Postman a throw here does not
            // crash the run. Capture and continue.
            try { onTimerError(error); } catch { /* never let reporting throw */ }
        }
    };

    const timers: SandboxTimers = {
        setTimeout: (handler: (...args: any[]) => void, timeout?: number, ...args: any[]) => {
            if (typeof handler !== 'function') {
                // Match Node's tolerance: a non-function handler is a no-op timer.
                return setTimeout(() => { /* noop */ }, timeout);
            }
            const handle = setTimeout(() => {
                activeTimeouts.delete(handle);
                safeInvoke(handler, args);
            }, timeout);
            activeTimeouts.add(handle);
            return handle;
        },
        clearTimeout: (handle: any) => {
            if (handle !== undefined && handle !== null) {
                activeTimeouts.delete(handle);
                clearTimeout(handle);
            }
        },
        setInterval: (handler: (...args: any[]) => void, timeout?: number, ...args: any[]) => {
            if (typeof handler !== 'function') {
                return setInterval(() => { /* noop */ }, timeout);
            }
            const handle = setInterval(() => {
                safeInvoke(handler, args);
            }, timeout);
            activeIntervals.add(handle);
            return handle;
        },
        clearInterval: (handle: any) => {
            if (handle !== undefined && handle !== null) {
                activeIntervals.delete(handle);
                clearInterval(handle);
            }
        }
    };

    const pendingCount = (): number => activeTimeouts.size + activeIntervals.size;

    const clearAll = (): void => {
        for (const handle of activeTimeouts) { clearTimeout(handle); }
        for (const handle of activeIntervals) { clearInterval(handle); }
        activeTimeouts.clear();
        activeIntervals.clear();
    };

    const sleep = (ms: number): Promise<void> =>
        new Promise<void>((resolve) => setTimeout(resolve, ms));

    const drain = async (timeoutMs: number): Promise<DrainResult> => {
        const start = Date.now();

        // Always yield at least once so already-scheduled microtasks (un-awaited
        // Promises) and zero-delay timers get a chance to run before we inspect state.
        await sleep(0);

        while (pendingCount() > 0) {
            const elapsed = Date.now() - start;
            if (elapsed >= timeoutMs) {
                clearAll();
                return { timedOut: true, elapsedMs: Date.now() - start };
            }
            // Wait a slice, but never overshoot the remaining budget.
            const remaining = timeoutMs - elapsed;
            await sleep(Math.min(DRAIN_POLL_MS, remaining));
        }

        // One final microtask flush to catch a Promise that resolved as the last timer
        // fired and may have scheduled follow-up microtask work.
        await sleep(0);
        if (pendingCount() > 0) {
            // A microtask scheduled a new timer; resume draining within the budget.
            return drainRemaining(start, timeoutMs);
        }

        return { timedOut: false, elapsedMs: Date.now() - start };
    };

    // Continuation used when a final flush revealed newly scheduled timers.
    const drainRemaining = async (start: number, timeoutMs: number): Promise<DrainResult> => {
        while (pendingCount() > 0) {
            const elapsed = Date.now() - start;
            if (elapsed >= timeoutMs) {
                clearAll();
                return { timedOut: true, elapsedMs: Date.now() - start };
            }
            const remaining = timeoutMs - elapsed;
            await sleep(Math.min(DRAIN_POLL_MS, remaining));
        }
        return { timedOut: false, elapsedMs: Date.now() - start };
    };

    return { timers, pendingCount, clearAll, drain };
}
