import { verifySession, type StaffSession } from '@/core/staff-session';

export type StaffContext = { organizationId: string; organizationName: string };

/**
 * Reads a staff session from a raw cookie value. Kept free of `next/headers` so it can be
 * unit-tested; the request-bound helpers live in the staff layout and actions.
 */
export function readStaffSession(
  cookieValue: string | undefined,
  secret: string | undefined,
  now: Date = new Date(),
): StaffSession | null {
  if (!cookieValue || !secret) return null;
  return verifySession(cookieValue, secret, now);
}

export function staffCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV !== 'development',
    maxAge: maxAgeSeconds,
  };
}
