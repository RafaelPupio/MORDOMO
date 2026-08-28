import { describe, expect, it } from 'vitest';
import { getOrCreatePersonalContext } from '@/db/repo/personal-contexts';
import { createTestDb } from '../helpers/db';

describe('personal contexts repository', () => {
  it('creates an empty Personal root without storing a profile', async () => {
    const db = await createTestDb();

    const personal = await getOrCreatePersonalContext(db, 'user_personal');

    expect(personal.clerkUserId).toBe('user_personal');
    expect(Object.keys(personal).sort()).toEqual(['clerkUserId', 'createdAt', 'id']);
  });

  it('creates exactly one Personal root for a Clerk user', async () => {
    const db = await createTestDb();

    const first = await getOrCreatePersonalContext(db, 'user_42');
    const second = await getOrCreatePersonalContext(db, 'user_42');

    expect(second.id).toBe(first.id);
  });
});
