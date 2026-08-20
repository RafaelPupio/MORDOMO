import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { eq, inArray } from 'drizzle-orm';
import { GatewayEmbedder, HashEmbedder, type Embedder } from '@/ai/embedder';
import { recordUsage } from '@/ai/usage';
import { chunkMarkdown } from '@/core/chunking';
import { getDb } from '@/db/client';
import { DEMO_CHURCH_SLUG } from '@/db/repo/churches';
import { budgets, chunks, churches, conversations, documents, events, messages, prayerRequests, tickets, usageLedger } from '@/db/schema';

config({ path: '.env.local' });

const SEED_DIR = path.join(process.cwd(), 'content', 'seed');
const DOC_KINDS: Record<string, string> = {
  'horarios-e-contato.md': 'schedule',
  'ministerios.md': 'ministry',
};

async function main() {
  const db = getDb();
  const embedder: Embedder = process.env.SEED_FAKE_EMBEDDER ? new HashEmbedder() : new GatewayEmbedder();
  if (process.env.SEED_FAKE_EMBEDDER) {
    console.warn('WARNING: SEED_FAKE_EMBEDDER is set — using the offline HashEmbedder (word-overlap vectors, not semantic).');
    console.warn('This is for tests and local development only. NEVER use it to seed the public demo.');
  }
  console.log(`Seeding with ${embedder.model}`);

  // Wipe the demo tenant only, children first (idempotent re-seed).
  const [existing] = await db.select().from(churches).where(eq(churches.slug, DEMO_CHURCH_SLUG));
  if (existing) {
    const docIds = (await db.select({ id: documents.id }).from(documents).where(eq(documents.churchId, existing.id))).map((d) => d.id);
    if (docIds.length) await db.delete(chunks).where(inArray(chunks.documentId, docIds));
    for (const table of [events, messages, prayerRequests, tickets, usageLedger, conversations, documents, budgets]) {
      await db.delete(table).where(eq(table.churchId, existing.id));
    }
    await db.delete(churches).where(eq(churches.id, existing.id));
  }

  const [church] = await db.insert(churches).values({ slug: DEMO_CHURCH_SLUG, name: 'Igreja da Colina' }).returning();
  await db.insert(budgets).values({ churchId: church.id, monthlyUsd: 40 });

  for (const file of readdirSync(SEED_DIR).filter((f) => f.endsWith('.md'))) {
    const markdown = readFileSync(path.join(SEED_DIR, file), 'utf8');
    const title = markdown.split('\n')[0].replace(/^#\s*/, '');
    const kind = DOC_KINDS[file] ?? 'bulletin';
    const [doc] = await db.insert(documents).values({ churchId: church.id, title, kind, sourcePath: `content/seed/${file}` }).returning();
    const pieces = chunkMarkdown(markdown);
    const { embeddings, tokens } = await embedder.embed(pieces.map((p) => p.content));
    await db.insert(chunks).values(
      pieces.map((p, i) => ({ churchId: church.id, documentId: doc.id, seq: p.seq, content: p.content, embedding: embeddings[i] })),
    );
    if (tokens > 0) {
      await recordUsage(db, { churchId: church.id, feature: 'ingest.embed', model: embedder.model, inputTokens: tokens, outputTokens: 0 });
    }
    console.log(`  ${file}: ${pieces.length} chunks`);
  }

  const eventsFile = JSON.parse(readFileSync(path.join(SEED_DIR, 'events.json'), 'utf8')) as {
    disclaimer: string;
    events: { title: string; startsAt: string; location?: string; description?: string }[];
  };
  await db.insert(events).values(
    eventsFile.events.map((e) => ({ churchId: church.id, title: e.title, startsAt: new Date(e.startsAt), location: e.location, description: e.description, verified: true })),
  );
  console.log(`  events.json: ${eventsFile.events.length} events`);
  console.log('Seed complete.');
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
