import type { LanguageModel } from 'ai';
import { analyzeWeek } from '@/agent/analyst';
import { writeReport } from '@/agent/report-writer';
import type { Db } from '@/db/client';
import { upsertReport } from '@/db/repo/reports';
import { gatherWeekActivity } from '@/core/week-activity';

export type WeeklyReportDeps = {
  db: Db;
  /** Omit to fall back to analyzeWeek's own default (FAST_MODEL). */
  analystModel?: LanguageModel;
  /** Omit to fall back to writeReport's own default (CHAT_MODEL). */
  writerModel?: LanguageModel;
};

export type WeeklyReportInput = {
  churchId: string;
  churchName: string;
  periodStart: Date;
  periodEnd: Date;
};

export type WeeklyReportResult = {
  status: 'published' | 'skipped-no-activity' | 'failed';
  reportId?: string;
  reason?: string;
};

/**
 * Orchestrates the whole weekly digest for one church, one week: gather this church's
 * real activity, hand it to the analyst (what is TRUE), hand the analyst's findings to
 * the writer (how to SAY it), then store the result — never any other order, and never a
 * shortcut around a failed stage.
 *
 * The sequence is deliberately fail-STOP, not fail-open, at every stage:
 *   gather -> (no activity? skip, zero model calls) -> analyse -> (null? fail, publish nothing)
 *   -> write -> (empty? fail, publish nothing) -> upsert
 *
 * A report is NEVER published from a failed analysis (that would be fabricated findings
 * reaching a church office) and NEVER published with an empty body (that would be a
 * "successful" digest nobody can read) — both failure branches return before
 * `upsertReport` is ever called, so there is no code path that writes a partial row.
 *
 * `upsertReport` itself replaces any existing row for `(churchId, periodStart)` rather
 * than duplicating it, so re-running the same week (a retry, or a manual "generate now"
 * after a scheduled run) always converges on one row per week, not a growing pile.
 */
export async function generateWeeklyReport(
  deps: WeeklyReportDeps,
  input: WeeklyReportInput,
): Promise<WeeklyReportResult> {
  const activity = await gatherWeekActivity(deps.db, input.churchId, input.periodStart, input.periodEnd);

  // A week where nothing happened costs nothing to report: skip before either agent is
  // ever invoked, so this path makes ZERO model calls, not merely a cheap one. Mirrors
  // the same guard analyzeWeek keeps as a backstop (src/agent/analyst.ts) — this is the
  // primary mechanism, that one is defense in depth.
  const hasActivity = activity.counts.conversations > 0
    || activity.counts.visitorMessages > 0
    || activity.counts.prayerRequests > 0
    || activity.counts.tickets > 0;
  if (!hasActivity) {
    console.log('report.generate: skipped, no activity this week', {
      churchId: input.churchId, periodStart: input.periodStart,
    });
    return { status: 'skipped-no-activity' };
  }

  const findings = await analyzeWeek(
    { db: deps.db, model: deps.analystModel },
    { churchId: input.churchId, activity },
  );
  if (!findings) {
    console.error('report.generate: analysis failed, declining to publish a report for this week', {
      churchId: input.churchId, periodStart: input.periodStart,
    });
    return { status: 'failed', reason: 'analysis-failed' };
  }

  const body = await writeReport(
    { db: deps.db, model: deps.writerModel },
    { churchId: input.churchId, churchName: input.churchName, findings, activity },
  );
  if (!body) {
    console.error('report.generate: writing failed, declining to publish a report for this week', {
      churchId: input.churchId, periodStart: input.periodStart,
    });
    return { status: 'failed', reason: 'writer-failed' };
  }

  const row = await upsertReport(deps.db, {
    churchId: input.churchId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    findings,
    body,
  });

  console.log('report.generate: published', {
    churchId: input.churchId, periodStart: input.periodStart, reportId: row.id,
  });
  return { status: 'published', reportId: row.id };
}

/**
 * The UTC Monday 00:00:00.000 boundary of the week `weeksAgo` full weeks before the week
 * containing `now` (default `weeksAgo = 1`: "last week"). Exported so a cron job and a
 * manual "generate now" both compute the same boundary from the same `now` — if they
 * disagreed even by one day, they would write two different `reports` rows for what a
 * human calls "the same week" (see `upsertReport`'s replace-by-`(churchId, periodStart)`
 * key), instead of one row that a re-run correctly replaces.
 *
 * The week is Monday-through-Sunday: `now` first snaps DOWN to the Monday of its own
 * ISO week (a Sunday snaps back 6 days, to the Monday that STARTS its week, not forward —
 * a Sunday is the LAST day of a week, never the first), and only then steps back
 * `weeksAgo` more full weeks. That first snap is what makes the result independent of
 * which day of the week `now` happens to be: a cron firing Monday morning and a staff
 * member clicking "generate" on Thursday afternoon of the same week both resolve
 * `weekStart(now)` to the identical Monday.
 */
export function weekStart(now: Date, weeksAgo = 1): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0 (Sunday) .. 6 (Saturday)
  const daysSinceMonday = (day + 6) % 7; // Monday -> 0, Tuesday -> 1, ..., Sunday -> 6
  d.setUTCDate(d.getUTCDate() - daysSinceMonday - weeksAgo * 7);
  return d;
}
