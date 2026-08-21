// A small, dependency-free parser for the ONE shape of markdown the writer agent actually
// emits (src/agent/report-writer.ts's SYSTEM prompt: "Use títulos em markdown e parágrafos
// curtos ou listas"): `#`/`##`/... headings, plain paragraphs, and `-`/`*`/`+` or `1.`
// ordered list items. It is deliberately NOT a general markdown parser — no tables, no
// nested lists, no code fences — because the writer is never asked to produce those, and a
// bigger parser would just be more surface area to get wrong for structures that never
// appear. Kept as plain, dependency-free functions (no React import) so this file can be
// unit-tested without a DOM, per the task's "extract and test the renderer" guidance — the
// house rule against a markdown dependency or `dangerouslySetInnerHTML` (see
// report-body.tsx) means this hand-rolled parser IS the renderer's correctness boundary:
// a bug here shows up as mangled prose in a church office's digest, not a crash.

export type ReportBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UNORDERED_ITEM_RE = /^[-*+]\s+(.*)$/;
const ORDERED_ITEM_RE = /^\d+[.)]\s+(.*)$/;

/**
 * Splits markdown source into block-level elements: consecutive plain-text lines merge into
 * one paragraph (markdown's own "a blank line ends a paragraph" rule), consecutive list
 * markers of the SAME kind (ordered vs. unordered) merge into one list, and a heading or a
 * blank line always ends whatever block was accumulating. A list marker of the OTHER kind
 * ends the current list rather than joining it — two back-to-back `-`/`1.` runs the writer
 * never intentionally produces are shown as two separate lists rather than one merged,
 * wrongly-ordered one.
 */
export function parseReportMarkdown(markdown: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraphLines.join(' ').trim() });
      paragraphLines = [];
    }
  };
  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ type: 'list', ordered: listOrdered, items: listItems });
      listItems = [];
    }
  };

  for (const rawLine of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();

    if (line === '') {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    const unordered = UNORDERED_ITEM_RE.exec(line);
    if (unordered) {
      flushParagraph();
      if (listItems.length > 0 && listOrdered) flushList();
      listOrdered = false;
      listItems.push(unordered[1].trim());
      continue;
    }

    const ordered = ORDERED_ITEM_RE.exec(line);
    if (ordered) {
      flushParagraph();
      if (listItems.length > 0 && !listOrdered) flushList();
      listOrdered = true;
      listItems.push(ordered[1].trim());
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

export type InlineSegment = { text: string; bold: boolean };

const BOLD_RE = /\*\*(.+?)\*\*/g;

/**
 * Splits one line of text on `**bold**` spans. The writer's system prompt does not ask for
 * inline emphasis, but a chat model asked for "warm, clear" prose reaches for `**bold**`
 * often enough in practice that leaving it unhandled would print literal asterisks in a
 * church office's digest — this is the one inline structure handled, nothing else
 * (`_italic_`, links, code spans) because the writer has no reason to emit them.
 */
export function splitInlineBold(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let lastIndex = 0;
  BOLD_RE.lastIndex = 0;
  let match: RegExpExecArray | null = BOLD_RE.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) segments.push({ text: text.slice(lastIndex, match.index), bold: false });
    segments.push({ text: match[1], bold: true });
    lastIndex = BOLD_RE.lastIndex;
    match = BOLD_RE.exec(text);
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), bold: false });
  return segments;
}
