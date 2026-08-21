import { parseReportMarkdown, splitInlineBold, type InlineSegment } from './markdown';

// RENDERING CHOICE: no markdown dependency, no `dangerouslySetInnerHTML`. `markdown.ts`
// parses the digest body — Portuguese prose from the writer agent (src/agent/report-writer.ts)
// — into a small typed block list (`ReportBlock[]`), and this component maps that list
// straight to React elements. Model-generated text only ever reaches the DOM as `children`
// of a React element (via `{text}` or `<strong>{text}</strong>`), never as an HTML string, so
// there is no path from the writer's output to injected markup — the same guarantee
// `dangerouslySetInnerHTML` would have given up. A "well-styled preformatted prose" fallback
// (one `<pre>` block) was the other option the task offered; a structured renderer was chosen
// instead because the writer is explicitly asked for headings and lists (its SYSTEM prompt:
// "Use títulos em markdown e parágrafos curtos ou listas") specifically so a busy secretary
// can scan the digest, and a monospaced `<pre>` block would defeat that scannability for the
// one piece of AI output in this app that is read as a document rather than a single reply.

function InlineText({ text }: { text: string }) {
  const segments: InlineSegment[] = splitInlineBold(text);
  return (
    <>
      {segments.map((segment, i) => (
        // Index is a safe key here: `segments` is derived fresh from `text` on every render
        // and never reordered, inserted into, or removed from independently of it.
        segment.bold ? <strong key={i}>{segment.text}</strong> : <span key={i}>{segment.text}</span>
      ))}
    </>
  );
}

// Heading levels are clamped into the two sizes this page already uses elsewhere (h3/h4-ish
// weights) — a report body is a subsection of the page, not its own document, so a writer
// that emits `#` (level 1) must not visually outrank the page's own `<h2>Relatórios</h2>`.
function headingClassName(level: number): string {
  return level <= 2 ? 'text-sm font-semibold text-neutral-800' : 'text-sm font-medium text-neutral-700';
}

export function ReportBody({ markdown }: { markdown: string }) {
  const blocks = parseReportMarkdown(markdown);

  if (blocks.length === 0) {
    return <p className="text-sm text-neutral-500">(relatório vazio)</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => {
        // Index is a safe key here for the same reason as `InlineText` above: `blocks` is
        // derived fresh from `markdown` on every render, never reordered independently.
        const key = i;
        if (block.type === 'heading') {
          return (
            <p key={key} className={`mt-1 ${headingClassName(block.level)}`}>
              <InlineText text={block.text} />
            </p>
          );
        }
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={key} className={`pl-5 text-sm text-neutral-700 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}><InlineText text={item} /></li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={key} className="text-sm leading-relaxed text-neutral-700">
            <InlineText text={block.text} />
          </p>
        );
      })}
    </div>
  );
}
