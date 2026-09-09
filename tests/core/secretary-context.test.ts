import type { Db } from '@/db/client';
import { organizations, personalContexts } from '@/db/schema';
import { createTestDb } from '../helpers/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, clerkClientMock, dbHolder } = vi.hoisted(() => ({
  authMock: vi.fn(),
  clerkClientMock: vi.fn(),
  dbHolder: { current: undefined as Db | undefined },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: authMock,
  clerkClient: clerkClientMock,
}));

vi.mock('@/db/client', () => ({
  getDb: vi.fn(() => {
    if (!dbHolder.current) throw new Error('Test database is not ready.');
    return dbHolder.current;
  }),
}));

import {
  ensureActiveClerkOrganization,
  requireSecretaryContext,
  requireStudioWriteContext,
} from '@/core/secretary-context';

async function seedMappedOrganization(
  db: Db,
  input: {
    clerkOrganizationId: string;
    ownerClerkUserId: string;
    slug: string;
  },
) {
  const [organization] = await db
    .insert(organizations)
    .values({
      name: `Organization ${input.slug}`,
      ...input,
    })
    .returning();
  return organization;
}

beforeEach(async () => {
  dbHolder.current = await createTestDb();
  authMock.mockReset();
  clerkClientMock.mockReset();
});

describe('trusted Secretary contexts', () => {
  it('requires an authenticated Clerk user', async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null, orgRole: null });

    await expect(requireSecretaryContext('personal')).rejects.toThrow(
      'Authentication required',
    );
  });

  it('does not use a requested organization ID when Clerk active organization differs', async () => {
    const db = dbHolder.current!;
    const seededA = await seedMappedOrganization(db, {
      clerkOrganizationId: 'org_clerk_a',
      ownerClerkUserId: 'user_owner',
      slug: 'trusted-a',
    });
    await seedMappedOrganization(db, {
      clerkOrganizationId: 'org_requested_b',
      ownerClerkUserId: 'user_owner',
      slug: 'forged-b',
    });
    authMock.mockResolvedValue({
      userId: 'user_owner',
      orgId: 'org_clerk_a',
      orgRole: 'org:admin',
    });

    await expect(requireSecretaryContext('organization')).resolves.toEqual({
      kind: 'organization',
      userId: 'user_owner',
      organizationId: seededA.id,
      role: 'owner',
    });
  });

  it('accepts a Clerk organization admin who is not the stored owner', async () => {
    const organization = await seedMappedOrganization(dbHolder.current!, {
      clerkOrganizationId: 'org_clerk_a',
      ownerClerkUserId: 'user_owner',
      slug: 'trusted-a',
    });
    authMock.mockResolvedValue({
      userId: 'user_admin',
      orgId: 'org_clerk_a',
      orgRole: 'org:admin',
    });

    await expect(requireStudioWriteContext('organization')).resolves.toEqual({
      kind: 'organization',
      userId: 'user_admin',
      organizationId: organization.id,
      role: 'admin',
    });
  });

  it('rejects an organization member from Studio writes', async () => {
    await seedMappedOrganization(dbHolder.current!, {
      clerkOrganizationId: 'org_clerk_a',
      ownerClerkUserId: 'user_owner',
      slug: 'trusted-a',
    });
    authMock.mockResolvedValue({
      userId: 'user_member',
      orgId: 'org_clerk_a',
      orgRole: 'org:member',
    });

    await expect(requireStudioWriteContext('organization')).rejects.toThrow(
      'Studio access denied',
    );
  });

  it('creates a Personal context from the authenticated user only', async () => {
    authMock.mockResolvedValue({
      userId: 'user_trusted',
      orgId: 'org_other',
      orgRole: 'org:member',
    });

    const context = await requireSecretaryContext('personal');
    const rows = await dbHolder.current!.select().from(personalContexts);

    expect(context).toMatchObject({ kind: 'personal', userId: 'user_trusted' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: context.kind === 'personal' ? context.personalContextId : undefined,
      clerkUserId: 'user_trusted',
    });
  });

  it('requires an active mapped organization before resolving its context', async () => {
    authMock.mockResolvedValue({
      userId: 'user_admin',
      orgId: 'org_not_onboarded',
      orgRole: 'org:admin',
    });

    await expect(requireSecretaryContext('organization')).rejects.toThrow(
      'Open organization onboarding first.',
    );
  });

  it('onboards only the active Clerk admin organization from server-returned fields', async () => {
    authMock.mockResolvedValue({
      userId: 'user_admin',
      orgId: 'org_server',
      orgRole: 'org:admin',
    });
    const getOrganization = vi.fn().mockResolvedValue({
      id: 'org_server',
      name: 'Server Organization',
      slug: null,
      imageUrl: 'https://img.clerk.com/org.png',
      hasImage: true,
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_100,
      publicMetadata: null,
      privateMetadata: {},
      maxAllowedMemberships: 5,
      adminDeleteEnabled: false,
      membersCount: 1,
      createdBy: 'user_owner_from_clerk',
    });
    clerkClientMock.mockResolvedValue({ organizations: { getOrganization } });

    const organization = await ensureActiveClerkOrganization(dbHolder.current!);

    expect(getOrganization).toHaveBeenCalledWith({ organizationId: 'org_server' });
    expect(organization).toMatchObject({
      clerkOrganizationId: 'org_server',
      name: 'Server Organization',
      slug: 'org-org_server',
      ownerClerkUserId: 'user_owner_from_clerk',
    });
  });

  it('does not call Clerk organization APIs for a non-admin member', async () => {
    authMock.mockResolvedValue({
      userId: 'user_member',
      orgId: 'org_server',
      orgRole: 'org:member',
    });

    await expect(
      ensureActiveClerkOrganization(dbHolder.current!),
    ).rejects.toThrow('Studio access denied');
    expect(clerkClientMock).not.toHaveBeenCalled();
  });
});
