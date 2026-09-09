import { describe, expect, it } from 'vitest';
import { CHAT_MODEL, costUsd } from '@/ai/pricing';
import { checkBudget, monthSpendUsd, recordUsage } from '@/ai/usage';
import { budgets } from '@/db/schema';
import { createTestDb, seedOrganization } from '../helpers/db';

describe('pricing', () => {
  it('computes cost from the price table', () => {
    // Sonnet assumption: $3/M input, $15/M output
    expect(costUsd(CHAT_MODEL, 1_000_000, 1_000_000)).toBeCloseTo(18);
    expect(costUsd(CHAT_MODEL, 0, 0)).toBe(0);
  });

  it('throws on unknown model', () => {
    expect(() => costUsd('unknown/model', 1, 1)).toThrow(/no price/i);
  });
});

describe('usage ledger + budget', () => {
  it('records usage and sums the month per tenant', async () => {
    const db = await createTestDb();
    const a = await seedOrganization(db, 'A');
    const b = await seedOrganization(db, 'B');
    await recordUsage(db, { organizationId: a.id, feature: 'chat.reply', model: CHAT_MODEL, inputTokens: 1_000_000, outputTokens: 0 });
    await recordUsage(db, { organizationId: b.id, feature: 'chat.reply', model: CHAT_MODEL, inputTokens: 0, outputTokens: 1_000_000 });
    expect(await monthSpendUsd(db, a.id)).toBeCloseTo(3);
    expect(await monthSpendUsd(db)).toBeCloseTo(18); // global = both tenants
  });

  it('uses one supplied UTC clock for ledger writes and month boundaries', async () => {
    const db = await createTestDb();
    const organization = await seedOrganization(db);
    const recordedAt = new Date('2026-09-15T12:00:00.000Z');
    const checkedAt = new Date('2027-01-01T00:05:00.000Z');

    await recordUsage(
      db,
      {
        organizationId: organization.id,
        feature: 'chat.reply',
        model: CHAT_MODEL,
        inputTokens: 1_000_000,
        outputTokens: 0,
      },
      recordedAt,
    );

    expect(await monthSpendUsd(db, organization.id, checkedAt)).toBe(0);
  });

  it('fails closed when the tenant has no budget row', async () => {
    const db = await createTestDb();
    const a = await seedOrganization(db);
    expect(await checkBudget(db, a.id, 50)).toEqual({ allowed: false, reason: 'tenant' });
  });

  it('blocks when tenant budget is spent, allows under budget', async () => {
    const db = await createTestDb();
    const a = await seedOrganization(db);
    await db.insert(budgets).values({ organizationId: a.id, monthlyUsd: 10 });
    expect((await checkBudget(db, a.id, 50)).allowed).toBe(true);
    await recordUsage(db, { organizationId: a.id, feature: 'chat.reply', model: CHAT_MODEL, inputTokens: 0, outputTokens: 1_000_000 }); // $15
    expect(await checkBudget(db, a.id, 50)).toEqual({ allowed: false, reason: 'tenant' });
  });

  it('blocks on the global cap even when the tenant has budget left', async () => {
    const db = await createTestDb();
    const a = await seedOrganization(db, 'A');
    const b = await seedOrganization(db, 'B');
    await db.insert(budgets).values({ organizationId: a.id, monthlyUsd: 100 });
    await recordUsage(db, { organizationId: b.id, feature: 'chat.reply', model: CHAT_MODEL, inputTokens: 0, outputTokens: 1_000_000 }); // $15 global
    expect(await checkBudget(db, a.id, 10)).toEqual({ allowed: false, reason: 'global' });
  });
});
