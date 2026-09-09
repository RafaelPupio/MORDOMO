import { isAuthorizedCron } from '@/core/cron-auth';
import { parseRetentionDays, runRetention } from '@/core/retention';
import { getDb } from '@/db/client';
import { organizations } from '@/db/schema';

export const maxDuration = 60;

/**
 * Daily retention pass (vercel.json: 03:00 UTC), one church at a time. With RETENTION_DAYS
 * unset it is a dry run that logs what it would remove — the demo runs that way until a
 * period is chosen on purpose. See src/core/retention.ts for the policy.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req, process.env.CRON_SECRET)) {
    return Response.json({ code: 'unauthorized' }, { status: 401 });
  }
  const retentionDays = parseRetentionDays(process.env.RETENTION_DAYS);
  try {
    const db = getDb();
    const all = await db.select({ id: organizations.id, slug: organizations.slug }).from(organizations);
    const results = [];
    for (const church of all) {
      const result = await runRetention(db, { organizationId: church.id, retentionDays, previewDays: 90 });
      console.log(result.dryRun ? 'cron/retention: dry run' : 'cron/retention: purged', {
        church: church.slug, retentionDays: result.retentionDays, cutoff: result.cutoff, ...result.counts,
      });
      results.push({ church: church.slug, ...result });
    }
    return Response.json({ dryRun: retentionDays === null, retentionDays, organizations: results });
  } catch (error) {
    console.error('cron/retention: unexpected failure', { error });
    return Response.json({ code: 'internal_error' }, { status: 500 });
  }
}
