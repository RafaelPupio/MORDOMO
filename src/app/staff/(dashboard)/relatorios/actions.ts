'use server';

import { revalidatePath } from 'next/cache';
import { checkBudget } from '@/ai/usage';
import { parseGlobalCapUsd } from '@/core/config';
import { checkRateLimit } from '@/core/rate-limit';
import { requireStaffContext } from '@/core/staff-context';
import { generateWeeklyReport, weekStart } from '@/core/weekly-report';
import { getDb } from '@/db/client';
import { buildGenerateReportState, type GenerateReportState } from './generate-report-state';

// Local to this route, not shared with any other rate-limit bucket (unlike
// `INGEST_LIMIT`, src/core/config.ts, which two DIFFERENT reachable paths — the staff
// upload form and `POST /api/ingest` — deliberately share): the cron job that runs this
// same `generateWeeklyReport` pipeline (src/app/api/cron/weekly-report/route.ts) is gated
// by `CRON_SECRET`, not the staff session cookie, so it is not a second path an
// authenticated staff session could use to bypass this bucket the way the ingest routes
// could bypass each other.
const REPORT_GENERATE_LIMIT = { limit: 10, windowSeconds: 3600 };

/**
 * Runs the SAME `generateWeeklyReport` pipeline the Monday cron job uses
 * (src/app/api/cron/weekly-report/route.ts), on demand, for LAST week — so staff (and a
 * portfolio viewer) do not have to wait for Monday to see a digest. `churchId`/`churchName`
 * come ONLY from `requireStaffContext()`; there is no id or period in `formData` for a
 * caller to point at another tenant's data or a different week — the only week this action
 * can ever generate is "last week for MY church", the same boundary `weekStart(now)`
 * (src/core/weekly-report.ts) gives the cron job, so a staff click and Monday's cron run
 * converge on the identical `(churchId, periodStart)` row (`upsertReport`'s replace key)
 * rather than ever disagreeing about which week "last week" means.
 *
 * Rate-limited and budget-gated the same way `documentos/actions.ts`'s upload and
 * `atendimentos/actions.ts`'s `suggestReply` are: this spends up to two metered LLM calls
 * per run (the analyst, then the writer — `generateWeeklyReport` skips both entirely for a
 * no-activity week, spending nothing).
 *
 * Everything from the rate-limit check onward is wrapped in one try/catch — same posture as
 * every other AI-spending staff action — so a Neon cold start or any other unexpected DB
 * failure returns the Portuguese error shape instead of an uncaught Server Action
 * rejection. Only `requireStaffContext()` stays outside it: a DB failure inside that call is
 * `src/app/staff/(dashboard)/error.tsx`'s problem, not this action's (see that file's
 * comment for why `redirect()` must not be swallowed by a surrounding catch).
 *
 * Declared with NO parameters even though `useActionState` (generate-button.tsx) calls
 * every action as `(state, payload)`: this action needs neither — there is no form field to
 * read and no previous state to fall back on (unlike, say, `sendReply`'s "keep the stale
 * draft on a failed retry" case) — and TypeScript structurally accepts a function with fewer
 * declared parameters wherever `useActionState`'s two-parameter action type is expected, the
 * same way `Array.prototype.map`'s callback is allowed to ignore `index`/`array`.
 */
export async function generateReportNow(): Promise<GenerateReportState> {
  const { churchId, churchName } = await requireStaffContext();
  const db = getDb();

  const now = new Date();
  const periodStart = weekStart(now);
  const periodEnd = weekStart(now, 0); // start of the CURRENT week = end of last week

  try {
    const rate = await checkRateLimit(db, `report-generate:${churchId}`, REPORT_GENERATE_LIMIT);
    if (!rate.allowed) return { error: 'Muitas gerações nesta hora. Tente novamente mais tarde.' };

    const budget = await checkBudget(db, churchId, parseGlobalCapUsd(process.env.DEMO_GLOBAL_MONTHLY_USD_CAP));
    if (!budget.allowed) return { error: 'O limite de uso do mês foi atingido.' };

    const result = await generateWeeklyReport(
      { db },
      { churchId, churchName, periodStart, periodEnd },
    );

    revalidatePath('/staff/relatorios');
    return buildGenerateReportState(result, periodStart, periodEnd);
  } catch (error) {
    console.error('generateReportNow: unexpected failure', { churchId, error });
    return { error: 'Não foi possível gerar o relatório agora. Tente novamente mais tarde.' };
  }
}
