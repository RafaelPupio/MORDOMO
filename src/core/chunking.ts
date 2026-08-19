export type Chunk = { seq: number; content: string };

const MAX_CHUNK_CHARS = 1500;

// Heading-aware chunking: split on h2 boundaries so a chunk stays a coherent topic
// (a schedule, an address), then split oversized sections by paragraph groups.
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
    let current = '';
    for (const para of trimmed.split(/\n\n+/)) {
      if (current && current.length + para.length + 2 > MAX_CHUNK_CHARS) {
        pieces.push(current.trim());
        current = para;
      } else {
        current = current ? `${current}\n\n${para}` : para;
      }
    }
    if (current.trim()) pieces.push(current.trim());
  }

  return pieces.map((content, seq) => ({ seq, content }));
}
