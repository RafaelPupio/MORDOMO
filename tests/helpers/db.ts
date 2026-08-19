import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Db } from '@/db/client';
import { churches } from '@/db/schema';

export async function createTestDb(): Promise<Db> {
  const client = new PGlite({ extensions: { vector } });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: 'drizzle' });
  return db as unknown as Db;
}

export async function seedChurch(db: Db, name = 'Igreja Teste') {
  const [row] = await db
    .insert(churches)
    .values({ slug: `t-${crypto.randomUUID().slice(0, 8)}`, name })
    .returning();
  return row;
}
