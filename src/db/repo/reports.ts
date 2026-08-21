import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { reports } from '@/db/schema';

/**
 * Writes a report for `(churchId, periodStart)`, replacing any existing row for that
 * same period instead of duplicating it. Keyed on the `reports_church_period_key`
 * unique constraint (see schema.ts), so a re-run of the same week's digest overwrites
 * `findings`, `body`, and `periodEnd` in place.
 */
export async function upsertReport(
  db: Db,
  input: {
    churchId: string;
    periodStart: Date;
    periodEnd: Date;
    findings: unknown;
    body: string;
  },
) {
  const [row] = await db
    .insert(reports)
    .values(input)
    .onConflictDoUpdate({
      target: [reports.churchId, reports.periodStart],
      set: {
        periodEnd: input.periodEnd,
        findings: input.findings,
        body: input.body,
      },
    })
    .returning();
  return row;
}

export async function listReports(db: Db, churchId: string, limit?: number) {
  const query = db
    .select()
    .from(reports)
    .where(eq(reports.churchId, churchId))
    .orderBy(desc(reports.periodStart));
  return limit === undefined ? query : query.limit(limit);
}

export async function getReport(db: Db, churchId: string, id: string) {
  const [row] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.churchId, churchId), eq(reports.id, id)));
  return row;
}

export async function getReportForPeriod(db: Db, churchId: string, periodStart: Date) {
  const [row] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.churchId, churchId), eq(reports.periodStart, periodStart)));
  return row;
}
