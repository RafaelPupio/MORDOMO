import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  checkStaffPassword, SESSION_TTL_SECONDS, signSession, verifySession, type StaffSession,
} from '@/core/staff-session';

const SECRET = 'test-secret-value';
const organizationId = '11111111-1111-1111-1111-111111111111';

function session(now = new Date('2026-08-20T12:00:00Z')): StaffSession {
  return {
    organizationId,
    issuedAt: now.getTime(),
    expiresAt: now.getTime() + SESSION_TTL_SECONDS * 1000,
  };
}

/**
 * Sign an arbitrary payload into a token using the same HMAC construction.
 * Payload should be a Record<string, unknown>.
 */
function signPayload(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
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
    decoded.organizationId = '22222222-2222-2222-2222-222222222222';
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

  it('rejects expiresAt: Infinity even with now far in the past', () => {
    const payload = {
      organizationId,
      issuedAt: new Date('2026-08-20T12:00:00Z').getTime(),
      expiresAt: 1e999, // parses to Infinity
    };
    const token = signPayload(payload, SECRET);
    // Even with now set to year 2099, Infinity should be rejected
    expect(verifySession(token, SECRET, new Date('2099-01-01T00:00:00Z'))).toBeNull();
  });

  it('rejects expiresAt: NaN', () => {
    // JSON cannot directly encode NaN; construct a payload that parses to NaN
    const payload = {
      organizationId,
      issuedAt: new Date('2026-08-20T12:00:00Z').getTime(),
      expiresAt: NaN,
    };
    const token = signPayload(payload, SECRET);
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it('rejects a negative expiresAt', () => {
    const payload = {
      organizationId,
      issuedAt: new Date('2026-08-20T12:00:00Z').getTime(),
      expiresAt: -1000,
    };
    const token = signPayload(payload, SECRET);
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it('rejects issuedAt missing from a correctly-signed token', () => {
    const payload = {
      organizationId,
      expiresAt: new Date('2026-08-20T20:00:00Z').getTime(),
      // issuedAt intentionally omitted
    };
    const token = signPayload(payload, SECRET);
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it('rejects issuedAt as a string in a correctly-signed token', () => {
    const payload = {
      organizationId,
      issuedAt: '2026-08-20T12:00:00Z', // string instead of number
      expiresAt: new Date('2026-08-20T20:00:00Z').getTime(),
    };
    const token = signPayload(payload, SECRET);
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it('rejects issuedAt as an object in a correctly-signed token', () => {
    const payload = {
      organizationId,
      issuedAt: { time: 1234567890 }, // object instead of number
      expiresAt: new Date('2026-08-20T20:00:00Z').getTime(),
    };
    const token = signPayload(payload, SECRET);
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it('returns only the three allowed fields when a token carries extra claims', () => {
    const now = new Date('2026-08-20T12:00:00Z');
    const payload = {
      organizationId,
      issuedAt: now.getTime(),
      expiresAt: now.getTime() + SESSION_TTL_SECONDS * 1000,
      role: 'superadmin', // forged extra claim
      permissions: ['admin', 'write'],
      metadata: { foo: 'bar' },
    };
    const token = signPayload(payload, SECRET);
    const verified = verifySession(token, SECRET, new Date('2026-08-20T13:00:00Z'));

    // Verify that only the three expected fields are present
    expect(verified).not.toBeNull();
    expect(verified).toEqual({
      organizationId,
      issuedAt: now.getTime(),
      expiresAt: now.getTime() + SESSION_TTL_SECONDS * 1000,
    });
    // Explicitly check that forged claims are not present
    expect(Object.keys(verified!)).toEqual(['organizationId', 'issuedAt', 'expiresAt']);
    expect((verified as Record<string, unknown>)?.role).toBeUndefined();
    expect((verified as Record<string, unknown>)?.permissions).toBeUndefined();
  });
});
