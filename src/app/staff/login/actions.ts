'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { staffCookieOptions } from '@/core/staff-auth';
import {
  checkStaffPassword, SESSION_TTL_SECONDS, signSession, STAFF_COOKIE_NAME,
} from '@/core/staff-session';
import { getDb } from '@/db/client';
import { DEMO_ORGANIZATION_SLUG, getOrganizationBySlug } from '@/db/repo/organizations';

export async function signIn(_prev: { error?: string }, formData: FormData) {
  const password = String(formData.get('password') ?? '');
  if (!checkStaffPassword(password, process.env.STAFF_PASSWORD)) {
    // Deliberately vague: do not reveal whether the password is merely wrong or not
    // configured at all.
    return { error: 'Senha inválida.' };
  }

  const secret = process.env.STAFF_SESSION_SECRET;
  if (!secret) return { error: 'Senha inválida.' };

  // This page is outside the dashboard error boundary, so a transient database
  // failure becomes an actionable message instead of an uncaught action rejection.
  let organization: Awaited<ReturnType<typeof getOrganizationBySlug>>;
  try {
    organization = await getOrganizationBySlug(getDb(), DEMO_ORGANIZATION_SLUG);
  } catch (error) {
    console.error('signIn: could not load the demo organization', { error });
    return { error: 'Não foi possível entrar agora. Tente novamente em instantes.' };
  }
  if (!organization) return { error: 'A organização demo ainda não foi carregada.' };

  const issuedAt = Date.now();
  const token = signSession(
    { organizationId: organization.id, issuedAt, expiresAt: issuedAt + SESSION_TTL_SECONDS * 1000 },
    secret,
  );
  (await cookies()).set(STAFF_COOKIE_NAME, token, staffCookieOptions(SESSION_TTL_SECONDS));
  redirect('/staff');
}

export async function signOut() {
  (await cookies()).set(STAFF_COOKIE_NAME, '', staffCookieOptions(0));
  redirect('/staff/login');
}
