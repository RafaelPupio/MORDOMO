import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { reports } from '@/db/schema';

/**
 * Writes a report for `(organizationId, periodStart)`, replacing any existing row for that
 * same period instead of duplicating it. Keyed on the `reports_church_period_key`
 * unique constraint (see schema.ts), so a re-run of the same week's digest overwrites
 * `findings`, `body`, and `periodEnd` in place.
 */
export async function upsertReport(
  db: Db,
  input: {
    organizationId: string;
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
      target: [reports.organizationId, reports.periodStart],
      set: {
        periodEnd: input.periodEnd,
        findings: input.findings,
        body: input.body,
      },
    })
    .returning();
  return row;
}

export async function listReports(db: Db, organizationId: string, limit?: number) {
  const query = db
    .select()
    .from(reports)
    .where(eq(reports.organizationId, organizationId))
    .orderBy(desc(reports.periodStart));
  return limit === undefined ? query : query.limit(limit);
}

export async function getReport(db: Db, organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.organizationId, organizationId), eq(reports.id, id)));
  return row;
}

export async function getReportForPeriod(db: Db, organizationId: string, periodStart: Date) {
  const [row] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.organizationId, organizationId), eq(reports.periodStart, periodStart)));
  return row;
}
