import type { WeeklyReportResult } from '@/core/weekly-report';
import { formatPeriodLabel } from './period';

// Mirrors `SuggestReplyState` (atendimentos/suggest-reply-state.ts): kept as a plain
// function, not exported from `actions.ts` itself, both because a `'use server'` file may
// only export async Server Actions and because staying pure (no `requireStaffContext` /
// `getDb`) makes mapping each of `generateWeeklyReport`'s three outcomes to the right
// on-screen state directly unit-testable without mocking Next.js request context.
export type GenerateReportState = { ok?: string; notice?: string; error?: string };

/**
 * `'skipped-no-activity'` is a SUCCESSFUL run of the job that simply found nothing worth
 * reporting — it must read as informational, not as a failure, so it lands on `notice`
 * (the same "not wrong, just not a full success" slot `suggest-reply-state.ts` uses), never
 * on `error`. Only `'failed'` — the analyst or writer agent actually declined to produce
 * output — uses `error`. This is the one place that distinction is made for the UI, so a
 * caller can't accidentally show a quiet week as if something had broken.
 */
export function buildGenerateReportState(
  result: WeeklyReportResult,
  periodStart: Date,
  periodEnd: Date,
): GenerateReportState {
  const period = formatPeriodLabel(periodStart, periodEnd);

  if (result.status === 'published') {
    return { ok: `Relatório gerado para a semana de ${period}.` };
  }
  if (result.status === 'skipped-no-activity') {
    return { notice: `Nenhuma atividade registrada na semana de ${period} — não há o que relatar.` };
  }
  return { error: 'Não foi possível gerar o relatório agora. Tente novamente mais tarde.' };
}
