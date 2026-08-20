export type Chunk = { seq: number; content: string };

const MAX_CHUNK_CHARS = 1500;

// A heading is reattached to every sub-chunk of an oversized section so each
// chunk stands alone as a retrieval unit -- but that reattachment must never be
// the reason a chunk exceeds the cap. If prepending the heading would leave less
// than this many characters of room for actual body text, the heading is too
// long to usefully repeat on every chunk (a chunk that's 97% duplicated heading
// carries almost no retrievable content), so it is folded into the content
// stream once instead of being reattached. 200 chars is an arbitrary but
// generous floor: real church-document headings ("## Horários de Missa") are a
// few dozen characters at most, so this only ever engages for oversized or
// malformed headings.
const MIN_BODY_BUDGET = 200;

// Heading-aware chunking: split on h2 boundaries so a chunk stays a coherent topic
// (a schedule, an address), then split oversized sections by paragraph groups.
// Every chunk produced from a heading section carries that section's heading
// when there's room to, and no chunk ever exceeds MAX_CHUNK_CHARS, even when a
// single paragraph -- or the heading line itself -- alone exceeds it. No section
// is ever silently dropped, including a heading with no body at all.
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

// Pack a section's body into chunks no larger than MAX_CHUNK_CHARS. When the
// heading leaves a usable budget for body text, it's prepended to every chunk
// so each one stands alone as a retrieval unit (packWithPrefix does the work).
// When it doesn't -- an oversized or malformed heading line -- the heading is
// folded into the content once and packed like ordinary text instead of being
// reattached to every sub-chunk. This same fallback is what carries a
// heading-only section (empty body) through: with no body, `content` is just
// the heading text, so it still gets emitted rather than silently dropped.
function packParagraphs(body: string, heading: string): string[] {
  const rawPrefix = heading ? `${heading}\n\n` : '';
  const usePrefix = rawPrefix.length <= MAX_CHUNK_CHARS - MIN_BODY_BUDGET;

  if (usePrefix) {
    return packWithPrefix(body, rawPrefix);
  }

  const content = body ? `${heading}\n\n${body}` : heading;
  return packWithPrefix(content, '');
}

// Split `body` on paragraph breaks and greedily pack paragraphs into chunks no
// larger than `MAX_CHUNK_CHARS - prefix.length`, prepending `prefix` to every
// emitted chunk. Oversized paragraphs are hard-split before packing so a single
// paragraph can never itself exceed the budget.
function packWithPrefix(body: string, prefix: string): string[] {
  const budget = MAX_CHUNK_CHARS - prefix.length;

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
