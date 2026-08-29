import { auth, clerkClient } from '@clerk/nextjs/server';
import type { SecretaryContextKind } from '@/core/secretary-profile';
import type { Db } from '@/db/client';
import { getDb } from '@/db/client';
import {
  getOrganizationByClerkId,
  type Organization,
  upsertOrganizationFromClerk,
} from '@/db/repo/organizations';
import { getOrCreatePersonalContext } from '@/db/repo/personal-contexts';

export type OrganizationSecretaryContext = {
  kind: 'organization';
  userId: string;
  organizationId: string;
  role: 'owner' | 'admin';
};

export type PersonalSecretaryContext = {
  kind: 'personal';
  userId: string;
  personalContextId: string;
};

export type SecretaryContext =
  | OrganizationSecretaryContext
  | PersonalSecretaryContext;

export async function requireSecretaryContext(
  kind: SecretaryContextKind,
): Promise<SecretaryContext> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) throw new Error('Authentication required');

  if (kind === 'personal') {
    const personalContext = await getOrCreatePersonalContext(getDb(), userId);
    return { kind, userId, personalContextId: personalContext.id };
  }

  if (!orgId || !orgRole) throw new Error('Select an organization first.');

  const organization = await getOrganizationByClerkId(getDb(), orgId);
  if (!organization) throw new Error('Open organization onboarding first.');

  const role = userId === organization.ownerClerkUserId
    ? 'owner'
    : orgRole === 'org:admin'
      ? 'admin'
      : null;
  if (!role) throw new Error('Studio access denied');

  return { kind, userId, organizationId: organization.id, role };
}

export async function requireStudioWriteContext(
  kind: SecretaryContextKind,
): Promise<SecretaryContext> {
  return requireSecretaryContext(kind);
}

export async function ensureActiveClerkOrganization(db: Db): Promise<Organization> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) throw new Error('Authentication required');
  if (!orgId || !orgRole) throw new Error('Select an organization first.');
  if (orgRole !== 'org:admin') throw new Error('Studio access denied');

  const client = await clerkClient();
  const organization = await client.organizations.getOrganization({
    organizationId: orgId,
  });

  return upsertOrganizationFromClerk(db, organization);
}
