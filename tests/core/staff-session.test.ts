import { describe, expect, it } from 'vitest';
import {
  checkStaffPassword, SESSION_TTL_SECONDS, signSession, verifySession, type StaffSession,
} from '@/core/staff-session';

const SECRET = 'test-secret-value';
const churchId = '11111111-1111-1111-1111-111111111111';

function session(now = new Date('2026-08-20T12:00:00Z')): StaffSession {
  return {
    churchId,
    issuedAt: now.getTime(),
    expiresAt: now.getTime() + SESSION_TTL_SECONDS * 1000,
  };
}

describe('checkStaffPassword', () => {
  it('fails closed when no password is configured', () => {
    expect(checkStaffPassword('anything', undefined)).toBe(false);
    expect(checkStaffPassword('anything', '')).toBe(false);
    expect(checkStaffPassword(undefined, undefined)).toBe(false);
  });

  it('rejects a wrong password and accepts the right one', () => {
    expect(checkStaffPassword('wrong', 'correct-horse')).toBe(false);
    expect(checkStaffPassword('correct-horse', 'correct-horse')).toBe(true);
  });

  it('rejects without throwing when lengths differ, including multibyte', () => {
    expect(checkStaffPassword('short', 'a-much-longer-password')).toBe(false);
    expect(checkStaffPassword('ééééé', 'aaaaa')).toBe(false);
  });

  it('rejects a missing presented password', () => {
    expect(checkStaffPassword(undefined, 'correct-horse')).toBe(false);
    expect(checkStaffPassword('', 'correct-horse')).toBe(false);
  });
});

describe('session signing', () => {
  it('round-trips a valid session', () => {
    const s = session();
    const verified = verifySession(signSession(s, SECRET), SECRET, new Date('2026-08-20T13:00:00Z'));
    expect(verified).toEqual(s);
  });

  it('rejects a token signed with a different secret', () => {
    expect(verifySession(signSession(session(), SECRET), 'other-secret')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = signSession(session(), SECRET);
    const [payload, sig] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    decoded.churchId = '22222222-2222-2222-2222-222222222222';
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${sig}`;
    expect(verifySession(forged, SECRET)).toBeNull();
  });

  it('rejects an expired session', () => {
    const s = session();
    const token = signSession(s, SECRET);
    expect(verifySession(token, SECRET, new Date('2026-08-21T12:00:00Z'))).toBeNull();
  });

  it('rejects malformed tokens without throwing', () => {
    for (const bad of ['', 'nodot', 'a.b.c', '.', 'x.', '.y', 'not-base64!.sig']) {
      expect(verifySession(bad, SECRET)).toBeNull();
    }
  });

  it('fails closed when the secret is empty', () => {
    expect(verifySession(signSession(session(), SECRET), '')).toBeNull();
  });
});
