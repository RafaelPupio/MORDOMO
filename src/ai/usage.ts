import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { budgets, usageLedger } from '@/db/schema';
import { costUsd } from './pricing';

export type UsageInput = {
  churchId: string;
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type BudgetStatus = { allowed: boolean; reason?: 'tenant' | 'global' };

export async function recordUsage(db: Db, input: UsageInput): Promise<void> {
  await db.insert(usageLedger).values({
    ...input,
    costUsd: costUsd(input.model, input.inputTokens, input.outputTokens),
  });
}

export async function monthSpendUsd(db: Db, churchId?: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const conds = [gte(usageLedger.createdAt, start)];
  if (churchId) conds.push(eq(usageLedger.churchId, churchId));
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${usageLedger.costUsd}), 0)` })
    .from(usageLedger)
    .where(and(...conds));
  return Number(row.total);
}

export async function checkBudget(db: Db, churchId: string, globalCapUsd: number): Promise<BudgetStatus> {
  const [budget] = await db.select().from(budgets).where(eq(budgets.churchId, churchId));
  if (!budget) return { allowed: false, reason: 'tenant' }; // fail closed on the public demo
  if ((await monthSpendUsd(db, churchId)) >= budget.monthlyUsd) return { allowed: false, reason: 'tenant' };
  if ((await monthSpendUsd(db)) >= globalCapUsd) return { allowed: false, reason: 'global' };
  return { allowed: true };
}
