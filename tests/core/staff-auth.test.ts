import { describe, expect, it } from 'vitest';
import { readStaffSession, staffCookieOptions } from '@/core/staff-auth';
import { SESSION_TTL_SECONDS, signSession } from '@/core/staff-session';

const SECRET = 'a-secret';
const churchId = '11111111-1111-1111-1111-111111111111';
const now = new Date('2026-08-20T12:00:00Z');
const valid = () =>
  signSession(
    { churchId, issuedAt: now.getTime(), expiresAt: now.getTime() + SESSION_TTL_SECONDS * 1000 },
    SECRET,
  );

describe('readStaffSession', () => {
  it('returns the session for a valid cookie', () => {
    expect(readStaffSession(valid(), SECRET, now)?.churchId).toBe(churchId);
  });

  it('returns null when the cookie is absent', () => {
    expect(readStaffSession(undefined, SECRET, now)).toBeNull();
  });

  it('fails closed when the secret is not configured', () => {
    expect(readStaffSession(valid(), undefined, now)).toBeNull();
    expect(readStaffSession(valid(), '', now)).toBeNull();
  });

  it('returns null for a garbage cookie without throwing', () => {
    expect(readStaffSession('garbage', SECRET, now)).toBeNull();
  });
});

describe('staffCookieOptions', () => {
  it('is httpOnly, lax, path-scoped, and carries the given max age', () => {
    const opts = staffCookieOptions(60);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.path).toBe('/');
    expect(opts.maxAge).toBe(60);
  });
});
