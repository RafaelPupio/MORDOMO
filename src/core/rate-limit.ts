import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { rateLimits } from '@/db/schema';

export type RateLimitResult = { allowed: boolean; remaining: number };

// Fixed-window counter in Postgres. Read-modify-write: a concurrent race can
// undercount slightly, which is acceptable for demo-scale abuse control.
export async function checkRateLimit(
  db: Db,
  key: string,
  opts: { limit: number; windowSeconds: number; now?: Date },
): Promise<RateLimitResult> {
  const now = opts.now ?? new Date();
  const windowMs = opts.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

  const [existing] = await db.select().from(rateLimits).where(eq(rateLimits.key, key));
  const count =
    existing && existing.windowStart.getTime() === windowStart.getTime() ? existing.count + 1 : 1;

  await db
    .insert(rateLimits)
    .values({ key, windowStart, count })
    .onConflictDoUpdate({ target: rateLimits.key, set: { windowStart, count } });

  return { allowed: count <= opts.limit, remaining: Math.max(0, opts.limit - count) };
}
