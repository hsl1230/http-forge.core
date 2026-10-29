/**
 * HTTP AI Providers
 *
 * IAiProvider implementations that talk to OpenAI / Anthropic over plain HTTPS
 * using native `fetch` (Node 20+, browsers, and the VS Code extension host) —
 * no SDK dependency required.
 *
 * Auto-detection (createEnvAiProvider):
 *   1. OPENAI_API_KEY  → OpenAiProvider  (model: gpt-4o-mini by default)
 *   2. ANTHROPIC_API_KEY → AnthropicProvider (model: claude-3-5-haiku-20241022)
 */

import type { IAiProvider } from './ai-provider';

// ─── OpenAI ───────────────────────────────────────────────────────────────────

export class OpenAiProvider implements IAiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = 'gpt-4o-mini'
  ) {}

  async complete(prompt: string): Promise<string> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${body}`);
    }

    const data = await res.json() as any;
    return data.choices[0].message.content as string;
  }
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

export class AnthropicProvider implements IAiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = 'claude-3-5-haiku-20241022'
  ) {}

  async complete(prompt: string): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${body}`);
    }

    const data = await res.json() as any;
    return data.content[0].text as string;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create the best available AI provider from environment variables.
 * Returns null if no provider is configured.
 *
 * Respects:
 *   OPENAI_API_KEY        → OpenAI (override model with OPENAI_MODEL)
 *   ANTHROPIC_API_KEY     → Anthropic (override model with ANTHROPIC_MODEL)
 *   HTTP_FORGE_AI_PROVIDER=openai|anthropic  to force a specific provider
 */
export function createEnvAiProvider(): IAiProvider | null {
  const forced = process.env.HTTP_FORGE_AI_PROVIDER?.toLowerCase();

  if (forced === 'anthropic' || (!forced && process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY)) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return null;
    return new AnthropicProvider(key, process.env.ANTHROPIC_MODEL);
  }

  if (process.env.OPENAI_API_KEY) {
    return new OpenAiProvider(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL);
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider(process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_MODEL);
  }

  return null;
}
