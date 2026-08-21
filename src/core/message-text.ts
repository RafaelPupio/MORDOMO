// Shared helper for reading text out of an AI SDK UIMessage `parts` array — the shape
// `messages.parts` (src/db/schema.ts) stores in its jsonb column: a mix of `text` parts,
// tool-call parts, etc. Both the staff area (src/core/staff-operations.ts — ticket reply
// excerpts, recovering what staff actually sent) and the weekly digest gatherer
// (src/core/week-activity.ts) need "what did this message actually say in prose", so the
// extraction rule lives here once instead of being reimplemented per caller.

/**
 * Extracts and joins every `{ type: 'text', text }` entry in `parts`, in order. Anything else
 * (tool calls, tool results, etc.) is dropped — callers want prose, not a transcript of tool
 * plumbing. Returns `''` for anything that isn't a text-bearing parts array (including a
 * message whose parts are ALL non-text, e.g. only a tool part) — never `[object Object]` or
 * `undefined`.
 */
export function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p): p is { type: unknown; text?: unknown } => typeof p === 'object' && p !== null)
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join(' ');
}
