export const CHAT_MODEL = 'anthropic/claude-sonnet-5';
export const FAST_MODEL = 'anthropic/claude-haiku-4-5';
export const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

// USD per 1M tokens. Assumptions recorded in brain/log/decisions.md — adjust when real
// gateway invoices are observed.
const PRICES: Record<string, { inPerM: number; outPerM: number }> = {
  [CHAT_MODEL]: { inPerM: 3, outPerM: 15 },
  [FAST_MODEL]: { inPerM: 1, outPerM: 5 },
  [EMBEDDING_MODEL]: { inPerM: 0.02, outPerM: 0 },
};

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model];
  if (!p) throw new Error(`No price configured for model ${model}`);
  return (inputTokens * p.inPerM + outputTokens * p.outPerM) / 1_000_000;
}
