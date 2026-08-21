// `periodStart`/`periodEnd` (a `reports` row, or the boundaries this feature's own "Gerar
// agora" action computes via `weekStart`, src/core/weekly-report.ts) are UTC week markers —
// `periodStart` is exactly Monday 00:00:00.000 UTC, `periodEnd` the following Monday,
// half-open. `formatDateTime` (src/core/format.ts) is the wrong tool for these: it renders
// in America/Sao_Paulo (UTC-3), which would print a UTC Monday midnight as "domingo, 21h"
// the PREVIOUS calendar day — the wrong week label for a period whose entire point is which
// week it names. Formatting in UTC instead keeps the printed date exactly the one
// `weekStart` computed, independent of the reader's or server's timezone.
const PERIOD_DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `periodEnd` is the EXCLUSIVE start of the following week (see `gatherWeekActivity`'s
 * `[periodStart, periodEnd)` convention, src/core/week-activity.ts) — the label shows the
 * INCLUSIVE last day of the period (the Sunday), one day before `periodEnd`, so a reader
 * sees "10/08/2026 a 16/08/2026" for a Monday-through-Sunday week, not a period that
 * appears to run through the following Monday.
 */
export function formatPeriodLabel(periodStart: Date, periodEnd: Date): string {
  const inclusiveEnd = new Date(periodEnd.getTime() - DAY_MS);
  return `${PERIOD_DATE_FORMATTER.format(periodStart)} a ${PERIOD_DATE_FORMATTER.format(inclusiveEnd)}`;
}
