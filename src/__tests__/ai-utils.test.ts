/**
 * AI Utility Helper Tests
 *
 * Covers extractJsonFromLlm (fences, prose, stray brackets, malformed input)
 * and withAiRetry (backoff, non-retryable errors, attempts).
 */

import { describe, expect, it, vi } from 'vitest';
import { extractJsonFromLlm, withAiRetry } from '../infrastructure/ai/ai-utils';

describe('extractJsonFromLlm', () => {
  it('parses a plain JSON array', () => {
    expect(extractJsonFromLlm('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('parses a plain JSON object', () => {
    expect(extractJsonFromLlm('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a fenced JSON block', () => {
    const raw = 'Here is the result:\n```json\n[{"value":"abc","name":"ABC"}]\n```\nHope that helps!';
    expect(extractJsonFromLlm(raw)).toEqual([{ value: 'abc', name: 'ABC' }]);
  });

  it('parses a fenced block without a language tag', () => {
    const raw = '```\n[1,2,3]\n```';
    expect(extractJsonFromLlm(raw)).toEqual([1, 2, 3]);
  });

  it('parses JSON followed by trailing prose', () => {
    const raw = '[{"value":"x"}]\n\nThere are 1 replacement(s). Let me know if you need more.';
    expect(extractJsonFromLlm(raw)).toEqual([{ value: 'x' }]);
  });

  it('parses JSON preceded by prose containing stray brackets', () => {
    const raw = 'I found these [candidates]: [{"value":"y"}] -- done';
    expect(extractJsonFromLlm(raw)).toEqual([{ value: 'y' }]);
  });

  it('respects brackets and strings inside the JSON', () => {
    const raw = '[{"msg":"a [ b ] { c } \\"d\\"","nested":[1,{"z":2}]}]';
    expect(extractJsonFromLlm(raw)).toEqual([{ msg: 'a [ b ] { c } "d"', nested: [1, { z: 2 }] }]);
  });

  it('returns null for non-JSON text', () => {
    expect(extractJsonFromLlm('Sorry, I could not find anything.')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractJsonFromLlm('')).toBeNull();
    expect(extractJsonFromLlm('   ')).toBeNull();
  });

  it('returns null when a bracket never balances', () => {
    expect(extractJsonFromLlm('[1,2')).toBeNull();
  });
});

describe('withAiRetry', () => {
  it('returns the first successful result', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withAiRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValue('recovered');
    await expect(withAiRetry(fn, { baseDelayMs: 1 })).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after the configured number of attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(withAiRetry(fn, { attempts: 2, baseDelayMs: 1 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('propagates non-retryable errors immediately', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('bad input'));
    const isRetryable = vi.fn().mockReturnValue(false);
    await expect(withAiRetry(fn, { isRetryable })).rejects.toThrow('bad input');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
