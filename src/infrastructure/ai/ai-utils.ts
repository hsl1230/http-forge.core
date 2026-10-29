/**
 * AI Utility Helpers
 *
 * Shared reliability helpers for every AI-backed core utility:
 *  - extractJsonFromLlm: robustly extract a JSON value from a free-form LLM
 *    completion (markdown fences, trailing prose, or stray brackets).
 *  - withAiRetry: retry an IAiProvider.complete() call with exponential backoff
 *    so a single transient provider error doesn't abort a whole batch.
 *
 * Platform-independent — no VS Code or Node.js-specific dependency.
 */

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract the first parseable JSON value (object or array) from an LLM
 * completion. LLMs frequently wrap JSON in json fences or append prose;
 * this scans for the first `[`/`{` and takes its balanced span, respecting
 * strings and escapes, then JSON.parses exactly that region.
 *
 * @param raw  The raw completion text.
 * @returns    The parsed JSON value, or null if nothing parseable was found.
 */
export function extractJsonFromLlm<T = unknown>(raw: string): T | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  const trimmed = raw.trim();

  // Fast paths: the whole text parses directly, or a fenced block does.
  for (const candidate of [trimmed, ...extractFencedBlocks(trimmed)]) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Keep scanning.
    }
  }

  // Slow path: try every `[`/`{` as a candidate start point.
  const starts = /[[{]/g;
  let match: RegExpExecArray | null;
  while ((match = starts.exec(trimmed)) !== null) {
    const end = balancedSpan(trimmed, match.index);
    if (end === -1) continue;
    try {
      return JSON.parse(trimmed.slice(match.index, end)) as T;
    } catch {
      // Try the next candidate start point.
    }
  }

  return null;
}

export interface AiRetryOptions {
  /** Maximum attempts including the first call (default 3). */
  attempts?: number;
  /** Base backoff delay in ms, doubled per retry (default 250). */
  baseDelayMs?: number;
  /** Predicate deciding whether an error is worth retrying (default: all). */
  isRetryable?: (error: unknown) => boolean;
}

/**
 * Retry an async operation (typically an IAiProvider.complete call) with
 * exponential backoff. Non-retryable errors propagate immediately.
 *
 * @param fn      The operation to retry.
 * @param options  Backoff/attempt configuration.
 * @returns       The first successful result.
 */
export async function withAiRetry<T>(
  fn: () => Promise<T>,
  options: AiRetryOptions = {}
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const isRetryable = options.isRetryable ?? (() => true);

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isRetryable(error)) throw error;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractFencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) blocks.push(match[1].trim());
  return blocks;
}

/** Return the index just past the balanced close bracket for `[`/`{` at `start`. */
function balancedSpan(text: string, start: number): number {
  const open = text[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}
