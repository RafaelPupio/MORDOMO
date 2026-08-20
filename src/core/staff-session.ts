import { createHmac, timingSafeEqual } from 'node:crypto';

export const STAFF_COOKIE_NAME = 'ccb_staff';
export const SESSION_TTL_SECONDS = 60 * 60 * 8;

export type StaffSession = {
  churchId: string;
  issuedAt: number;
  expiresAt: number;
};

/**
 * Constant-time password check that fails CLOSED: an unset or empty configured password
 * means nobody may sign in, never everybody. Compares byte length first so
 * `timingSafeEqual` cannot throw on a length mismatch (including multibyte input).
 * Note: the length pre-check leaks the configured password's byte length via early return,
 * trading constant-time compliance for robustness against attacker-controlled byte sequences.
 */
export function checkStaffPassword(
  presented: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected || !presented) return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function signSession(payload: StaffSession, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${hmac(body, secret)}`;
}

/**
 * Returns the session only when the signature verifies AND it has not expired.
 * Any malformed input returns null rather than throwing — this parses attacker-controlled
 * cookie values.
 */
export function verifySession(
  token: string,
  secret: string,
  now: Date = new Date(),
): StaffSession | null {
  if (!secret || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;

  const expected = hmac(body, secret);
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StaffSession;
    if (typeof parsed?.churchId !== 'string') return null;
    if (!Number.isFinite(parsed?.expiresAt)) return null;
    if (!Number.isFinite(parsed?.issuedAt)) return null;
    if (parsed.expiresAt <= now.getTime()) return null;
    return {
      churchId: parsed.churchId,
      issuedAt: parsed.issuedAt,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function hmac(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}
