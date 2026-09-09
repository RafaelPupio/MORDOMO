import { generateWeeklyReport, weekStart } from '@/core/weekly-report';
import { isAuthorizedCron } from '@/core/cron-auth';
import { checkBudget } from '@/ai/usage';
import { parseGlobalCapUsd } from '@/core/config';
import { getDb } from '@/db/client';
import { DEMO_ORGANIZATION_SLUG, getOrganizationBySlug } from '@/db/repo/organizations';

// Node runtime only: getDb()/Neon and the AI SDK calls the analyst/writer agents make
// are not edge-safe here. Deliberately do NOT export `runtime = 'edge'`.
// Generous: this triggers two model calls (analyst, writer) plus several DB reads —
// matches the ingest route's `maxDuration` (src/app/api/ingest/route.ts) for the same
// "slowest realistic pipeline" reasoning.
export const maxDuration = 300;

/**
 * Vercel Cron hits this every Monday 09:00 UTC (see vercel.json) to generate last week's
 * digest for the demo church. `Authorization: Bearer <CRON_SECRET>` is checked FIRST,
 * before any DB read or model call — `isAuthorizedCron` fails closed (src/core/cron-auth.ts),
 * so an unauthenticated caller can never trigger a paid model call or a DB write, whether
 * `CRON_SECRET` is unset, wrong, or malformed. Everything past that check is wrapped in a
 * single try/catch, matching the house pattern in src/channels/ingest-http.ts: a DB
 * failure (or any other unexpected error) returns a controlled JSON error instead of an
 * uncaught rejection.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req, process.env.CRON_SECRET)) {
    return Response.json({ code: 'unauthorized' }, { status: 401 });
  }

  try {
    const db = getDb();
    const church = await getOrganizationBySlug(db, DEMO_ORGANIZATION_SLUG);
    if (!church) return Response.json({ code: 'not_seeded' }, { status: 500 });

    // The cron has a secret rather than a staff session, but it still spends the same two
    // metered model calls as an on-demand run. A valid cron credential must not become a
    // way around either the tenant or global monthly caps. This is a 200 skip (not a 429)
    // so Vercel does not repeatedly retry a job that cannot become affordable this month.
    const budget = await checkBudget(
      db,
      church.id,
      parseGlobalCapUsd(process.env.DEMO_GLOBAL_MONTHLY_USD_CAP),
    );
    if (!budget.allowed) return Response.json({ code: 'budget_exceeded', reason: budget.reason });

    const now = new Date();
    const periodStart = weekStart(now);
    const periodEnd = weekStart(now, 0); // start of the CURRENT week = end of last week

    const result = await generateWeeklyReport(
      { db },
      {
        organizationId: church.id,
        organizationName: church.name,
        periodStart,
        periodEnd,
      },
    );

    // 'published' and 'skipped-no-activity' are both successful outcomes of running the
    // job (nothing to report is not a failure); only 'failed' — the analyst or writer
    // agent declined to produce output — is a server error.
    return Response.json(result, { status: result.status === 'failed' ? 500 : 200 });
  } catch (error) {
    console.error('cron/weekly-report: unexpected failure', { error });
    return Response.json({ code: 'internal_error' }, { status: 500 });
  }
}
