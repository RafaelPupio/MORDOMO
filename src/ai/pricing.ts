import type { LanguageModel } from 'ai';

export const CHAT_MODEL = 'anthropic/claude-sonnet-5';
export const FAST_MODEL = 'anthropic/claude-haiku-4-5';
export const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
export const TEST_EMBEDDING_MODEL = 'test/hash-embedder';
export const EMBEDDING_DIMENSIONS = 1536;

// USD per 1M tokens. Assumptions recorded in brain/log/decisions.md — adjust when real
// gateway invoices are observed.
const PRICES: Record<string, { inPerM: number; outPerM: number }> = {
  [CHAT_MODEL]: { inPerM: 3, outPerM: 15 },
  [FAST_MODEL]: { inPerM: 1, outPerM: 5 },
  [EMBEDDING_MODEL]: { inPerM: 0.02, outPerM: 0 },
  // Offline fake embedder for tests and seeding, priced at zero since it makes no API call
  [TEST_EMBEDDING_MODEL]: { inPerM: 0, outPerM: 0 },
};

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model];
  if (!p) throw new Error(`No price configured for model ${model}`);
  return (inputTokens * p.inPerM + outputTokens * p.outPerM) / 1_000_000;
}

// `model` can be a plain model-id string (the production default, or a real override) or
// a LanguageModel OBJECT (e.g. MockLanguageModelV3 in tests) — an object has no id to
// look up a price by, so pricing falls back to `fallback` in that case. Without this,
// usage ends up priced under `fallback` even when a string override was in play, silently
// mispricing every call made under the override. Shared here so every agent that calls a
// model (secretary, extractor, verifier, ...) prices usage the same way instead of each
// re-deriving — or hardcoding — its own version of this decision.
export function priceableModelId(model: LanguageModel, fallback: string): string {
  return typeof model === 'string' ? model : fallback;
}
