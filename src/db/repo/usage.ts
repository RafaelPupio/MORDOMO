import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { budgets, usageLedger } from '@/db/schema';

export type UsageSummary = {
  totalUsd: number;
  byFeature: { feature: string; costUsd: number; calls: number }[];
  monthlyUsd: number | null;
};

/** Month-to-date spend for one tenant, grouped by feature, plus its configured cap. */
export async function usageSummary(
  db: Db, organizationId: string, now: Date = new Date(),
): Promise<UsageSummary> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const rows = await db
    .select({
      feature: usageLedger.feature,
      costUsd: sql<number>`coalesce(sum(${usageLedger.costUsd}), 0)`,
      calls: sql<number>`count(*)`,
    })
    .from(usageLedger)
    .where(and(eq(usageLedger.organizationId, organizationId), gte(usageLedger.createdAt, start)))
    .groupBy(usageLedger.feature);

  const byFeature = rows
    .map((r) => ({ feature: r.feature, costUsd: Number(r.costUsd), calls: Number(r.calls) }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const [budget] = await db.select().from(budgets).where(eq(budgets.organizationId, organizationId));

  return {
    totalUsd: byFeature.reduce((sum, f) => sum + f.costUsd, 0),
    byFeature,
    monthlyUsd: budget ? budget.monthlyUsd : null,
  };
}
