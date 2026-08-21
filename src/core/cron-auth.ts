import { timingSafeEqual } from 'node:crypto';

const BEARER_PREFIX = 'Bearer ';

/**
 * Authorizes Vercel Cron's invocation of `GET /api/cron/weekly-report`, which arrives
 * with an `Authorization: Bearer <CRON_SECRET>` header (Vercel sets this automatically
 * for scheduled invocations — see `.env.example`). Fails CLOSED: an unset or empty
 * configured secret means NOBODY is authorized, never everybody — the same posture as
 * `checkStaffPassword` (src/core/staff-session.ts) and the retired ingest token before
 * it. Compares byte length before `timingSafeEqual` so it cannot throw on a length
 * mismatch, including a multibyte token whose byte length differs from its UTF-16
 * character count. The `Bearer ` prefix must be present and exactly-cased — a bare
 * token with no scheme, or a lowercase `bearer`, is rejected rather than treated as if
 * the token started right after the header name.
 */
export function isAuthorizedCron(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;

  const header = req.headers.get('authorization');
  if (!header || !header.startsWith(BEARER_PREFIX)) return false;

  const presented = Buffer.from(header.slice(BEARER_PREFIX.length), 'utf8');
  const expected = Buffer.from(secret, 'utf8');
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}
