import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readStaffSession, type StaffContext } from '@/core/staff-auth';
import { STAFF_COOKIE_NAME } from '@/core/staff-session';
import { getDb } from '@/db/client';
import { getChurchBySlug, DEMO_CHURCH_SLUG } from '@/db/repo/churches';

/**
 * The ONLY way a staff page or action learns which church it is acting for. Deriving the
 * tenant from the signed session — never from a form field or query parameter — is what
 * keeps every staff mutation tenant-scoped by construction.
 *
 * The `church.id !== session.churchId` check below is load-bearing, not defensive
 * boilerplate: a session signed for a church that was later re-seeded (a fresh
 * `churches` row with a new id, same demo slug) must not be silently admitted just
 * because the cookie still verifies. Comparing against the freshly loaded church — not
 * trusting the session's claim on its own — is what makes a stale session fail closed.
 */
export async function requireStaffContext(): Promise<StaffContext> {
  const cookieStore = await cookies();
  const session = readStaffSession(
    cookieStore.get(STAFF_COOKIE_NAME)?.value,
    process.env.STAFF_SESSION_SECRET,
  );
  if (!session) redirect('/staff/login');

  const church = await getChurchBySlug(getDb(), DEMO_CHURCH_SLUG);
  if (!church || church.id !== session.churchId) redirect('/staff/login');

  return { churchId: church.id, churchName: church.name };
}
