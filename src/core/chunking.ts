export type Chunk = { seq: number; content: string };

const MAX_CHUNK_CHARS = 1500;

// Heading-aware chunking: split on h2 boundaries so a chunk stays a coherent topic
// (a schedule, an address), then split oversized sections by paragraph groups.
// Every chunk produced from a heading section carries that section's heading, and
// no chunk ever exceeds MAX_CHUNK_CHARS, even when a single paragraph alone does.
export function chunkMarkdown(text: string): Chunk[] {
  const sections = text.split(/\n(?=## )/);
  const pieces: string[] = [];

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    if (trimmed.length <= MAX_CHUNK_CHARS) {
      pieces.push(trimmed);
      continue;
    }

    // Pull the heading line (if any) off the front so it can be reattached to
    // every sub-chunk this oversized section gets split into.
    const headingMatch = trimmed.match(/^(## .*)\n?/);
    const heading = headingMatch ? headingMatch[1] : '';
    const body = headingMatch ? trimmed.slice(headingMatch[0].length).trim() : trimmed;

    pieces.push(...packParagraphs(body, heading));
  }

  return pieces.map((content, seq) => ({ seq, content }));
}

// Pack a section's body into chunks no larger than MAX_CHUNK_CHARS, prepending
// `heading` (when present) to every chunk so each one stands alone as a
// retrieval unit. Oversized paragraphs are hard-split before packing so a
// single paragraph can never itself exceed the cap.
function packParagraphs(body: string, heading: string): string[] {
  const prefix = heading ? `${heading}\n\n` : '';
  // Leave room for the prefix so re-attaching the heading can't push a chunk over the cap.
  const budget = Math.max(1, MAX_CHUNK_CHARS - prefix.length);

  const out: string[] = [];
  let current = '';

  const flush = () => {
    if (current) {
      out.push(`${prefix}${current}`);
      current = '';
    }
  };

  for (const para of body.split(/\n\n+/)) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    for (const part of splitOversizedText(trimmedPara, budget)) {
      const candidateLength = current ? current.length + 2 + part.length : part.length;
      if (current && candidateLength > budget) {
        flush();
      }
      current = current ? `${current}\n\n${part}` : part;
    }
  }
  flush();

  return out;
}

// Hard-split text that alone exceeds `limit` into pieces that fit. Prefers
// cutting at whitespace near the limit so words survive intact; only cuts
// mid-token when a single token is itself longer than the limit.
function splitOversizedText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(' ', limit);
    if (cut <= 0) cut = limit; // no whitespace boundary in reach: hard cut mid-token
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);

  return parts;
}
