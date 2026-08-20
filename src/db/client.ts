import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

// Driver-agnostic handle: production uses neon-http, tests use PGlite.
export type Db = PgDatabase<PgQueryResultHKT>;

let _db: Db | null = null;

export function getDb(): Db {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _db = drizzle(neon(url)) as unknown as Db;
  }
  return _db;
}
