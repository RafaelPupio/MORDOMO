import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { GatewayEmbedder, HashEmbedder, type Embedder } from '@/ai/embedder';
import { chunkMarkdown } from '@/core/chunking';
import { searchKnowledgeBase } from '@/core/retrieval';
import type { Db } from '@/db/client';
import { chunks, churches, documents } from '@/db/schema';

config({ path: '.env.local' });

const SEED_DIR = path.join(process.cwd(), 'content', 'seed');

// Ten Portuguese visitor questions, each paired with a substring that appears in exactly one
// seed chunk — the chunk that actually answers it. "Correct" below means the top-ranked
// chunk (by cosine similarity, via the same searchKnowledgeBase() the chat agent calls)
// contains that substring: checked programmatically against real chunked content, not
// eyeballed. `assertUniqueMatch` (below) fails the run, before anything touches a database,
// if a substring ever stops uniquely identifying one chunk in the corpus — so a future seed
// edit can't silently make the benchmark grade against the wrong (or an accidental) target.
const QUESTIONS: { question: string; expectedContains: string }[] = [
  { question: 'que horas é o culto de domingo?', expectedContains: 'Culto de Celebração acontece aos domingos' },
  { question: 'qual o endereço da igreja?', expectedContains: 'Rua das Palmeiras' },
  { question: 'qual o endereço?', expectedContains: 'Rua das Palmeiras' },
  { question: 'tem atividade para crianças?', expectedContains: 'Há atividades para crianças?' },
  { question: 'quando é o encontro dos jovens?', expectedContains: 'O encontro de jovens acontece no dia 10/10' },
  { question: 'como faço para ser membro?', expectedContains: 'Como me tornar membro?' },
  { question: 'tem grupo de jovens?', expectedContains: 'Grupo de adolescentes e jovens' },
  { question: 'qual o telefone da secretaria?', expectedContains: '(11) 90000-0000' },
  { question: 'como faço para contribuir com o dízimo?', expectedContains: 'gazofilácios' },
  { question: 'tem culto durante a semana?', expectedContains: 'Culto de Oração reúne a igreja' },
];

async function createBenchmarkDb(): Promise<Db> {
  // A throwaway in-memory Postgres (same engine tests use), so this script needs no running
  // database and makes no network call beyond the embedder itself.
  const client = new PGlite({ extensions: { vector } });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: 'drizzle' });
  return db as unknown as Db;
}

function assertUniqueMatch(question: string, expectedContains: string, corpus: string[]): void {
  const matchCount = corpus.filter((chunk) => chunk.includes(expectedContains)).length;
  if (matchCount !== 1) {
    throw new Error(
      `Benchmark fixture error: expectedContains ${JSON.stringify(expectedContains)} for question ` +
        `${JSON.stringify(question)} matches ${matchCount} chunks in the seed corpus (must match ` +
        'exactly 1). Update the benchmark question or the seed corpus.',
    );
  }
}

async function main() {
  const useRealEmbedder = process.env.BENCHMARK_REAL_EMBEDDER === '1';
  const embedder: Embedder = useRealEmbedder ? new GatewayEmbedder() : new HashEmbedder();
  console.log(
    useRealEmbedder
      ? `Benchmarking against the REAL embedder (${embedder.model}) — calls the AI Gateway, requires AI_GATEWAY_API_KEY.`
      : `Benchmarking against the offline HashEmbedder (${embedder.model}, bag-of-words) — no network call.\n` +
          'Set BENCHMARK_REAL_EMBEDDER=1 to score the real production embedding model instead.',
  );

  const files = readdirSync(SEED_DIR).filter((f) => f.endsWith('.md'));
  const perFile = files.map((file) => {
    const markdown = readFileSync(path.join(SEED_DIR, file), 'utf8');
    return { file, markdown, pieces: chunkMarkdown(markdown) };
  });
  const allChunkContents = perFile.flatMap((f) => f.pieces.map((p) => p.content));
  for (const { question, expectedContains } of QUESTIONS) assertUniqueMatch(question, expectedContains, allChunkContents);

  const db = await createBenchmarkDb();
  const [church] = await db.insert(churches).values({ slug: 'benchmark', name: 'Igreja da Colina (benchmark)' }).returning();
  for (const { file, markdown, pieces } of perFile) {
    const title = markdown.split('\n')[0].replace(/^#\s*/, '');
    const [doc] = await db
      .insert(documents)
      .values({ churchId: church.id, title, kind: 'bulletin', sourcePath: `content/seed/${file}` })
      .returning();
    const { embeddings } = await embedder.embed(pieces.map((p) => p.content));
    await db.insert(chunks).values(
      pieces.map((p, i) => ({ churchId: church.id, documentId: doc.id, seq: p.seq, content: p.content, embedding: embeddings[i] })),
    );
  }

  type Row = { question: string; topDocument: string; score: number; correct: boolean };
  const rows: Row[] = [];
  for (const { question, expectedContains } of QUESTIONS) {
    // k: 1, minScore: 0 — always surface the single top-ranked chunk, even one that would
    // fall under the production minScore threshold, so a bad match shows up as a visible
    // failure row instead of silently vanishing as "no sources".
    const { sources } = await searchKnowledgeBase(db, embedder, church.id, question, { k: 1, minScore: 0 });
    const top = sources[0];
    rows.push({
      question,
      topDocument: top?.documentTitle ?? '(no match)',
      score: top?.score ?? 0,
      correct: top ? top.excerpt.includes(expectedContains) : false,
    });
  }

  const qWidth = Math.max(...rows.map((r) => r.question.length), 'question'.length);
  const docWidth = Math.max(...rows.map((r) => r.topDocument.length), 'top document'.length);
  const header = `${'question'.padEnd(qWidth)}  ${'top document'.padEnd(docWidth)}  score   correct`;
  console.log(`\n${header}`);
  console.log('-'.repeat(header.length));
  for (const r of rows) {
    console.log(
      `${r.question.padEnd(qWidth)}  ${r.topDocument.padEnd(docWidth)}  ${r.score.toFixed(3).padStart(5)}   ${r.correct ? 'yes' : 'NO'}`,
    );
  }

  const correctCount = rows.filter((r) => r.correct).length;
  console.log(`\n${correctCount}/${rows.length} questions retrieved the correct chunk first (embedder: ${embedder.model}).`);

  if (correctCount !== rows.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
