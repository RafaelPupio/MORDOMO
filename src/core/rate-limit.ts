import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { rateLimits } from '@/db/schema';

export type RateLimitResult = { allowed: boolean; remaining: number };

// Atomic fixed-window counter in Postgres: increment is computed by the database,
// so concurrent calls increment correctly without read-modify-write race conditions.
export async function checkRateLimit(
  db: Db,
  key: string,
  opts: { limit: number; windowSeconds: number; now?: Date },
): Promise<RateLimitResult> {
  const now = opts.now ?? new Date();
  const windowMs = opts.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

  const [result] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.windowStart} = ${windowStart} THEN ${rateLimits.count} + 1 ELSE 1 END`,
        windowStart,
      },
    })
    .returning({ count: rateLimits.count });

  const count = result.count;
  return { allowed: count <= opts.limit, remaining: Math.max(0, opts.limit - count) };
}
