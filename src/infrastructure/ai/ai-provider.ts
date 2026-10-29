/**
 * AI Provider Interface
 *
 * Platform-agnostic abstraction for text-completion AI.
 * Implementations:
 *   - http-providers.ts: OpenAiProvider / AnthropicProvider (plain HTTP fetch)
 *   - VS Code extension: CopilotAiProvider (wraps vscode.lm)
 */

/** Minimal interface required by all AI-powered core utilities. */
export interface IAiProvider {
  /**
   * Send a single user prompt and return the full completion text.
   * Implementations should throw on hard failures; the caller handles retries.
   */
  complete(prompt: string): Promise<string>;
}
