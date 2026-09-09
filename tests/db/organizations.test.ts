import { describe, expect, it } from 'vitest';
import { getOrganizationBySlug } from '@/db/repo/organizations';
import { organizations } from '@/db/schema';
import { createTestDb } from '../helpers/db';

describe('organization repository', () => {
  it('finds only the organization identified by its public slug', async () => {
    const db = await createTestDb();
    await db.insert(organizations).values({ slug: 'demo', name: 'Igreja da Colina' });

    expect((await getOrganizationBySlug(db, 'demo'))?.name).toBe('Igreja da Colina');
    expect(await getOrganizationBySlug(db, 'missing')).toBeUndefined();
  });
});
