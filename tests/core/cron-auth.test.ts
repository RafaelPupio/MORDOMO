import { describe, expect, it } from 'vitest';
import { isAuthorizedCron } from '@/core/cron-auth';

const SECRET = 'test-cron-secret-value';

function req(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set('authorization', authorization);
  return new Request('http://test/api/cron/weekly-report', { headers });
}

describe('isAuthorizedCron', () => {
  it('fails closed when no secret is configured', () => {
    expect(isAuthorizedCron(req(`Bearer ${SECRET}`), undefined)).toBe(false);
  });

  it('fails closed when the configured secret is empty', () => {
    expect(isAuthorizedCron(req(`Bearer ${SECRET}`), '')).toBe(false);
  });

  it('rejects a wrong secret', () => {
    expect(isAuthorizedCron(req('Bearer wrong-secret'), SECRET)).toBe(false);
  });

  it('rejects a missing Authorization header', () => {
    expect(isAuthorizedCron(req(), SECRET)).toBe(false);
  });

  it('rejects a bare token with no Bearer prefix', () => {
    expect(isAuthorizedCron(req(SECRET), SECRET)).toBe(false);
  });

  it('rejects a lowercase "bearer" scheme', () => {
    expect(isAuthorizedCron(req(`bearer ${SECRET}`), SECRET)).toBe(false);
  });

  it('rejects a length-mismatched token without throwing', () => {
    expect(() => isAuthorizedCron(req('Bearer short'), SECRET)).not.toThrow();
    expect(isAuthorizedCron(req('Bearer short'), SECRET)).toBe(false);
  });

  it('rejects without throwing when a multibyte token differs in byte length from the secret', () => {
    // 'é' is 2 bytes in UTF-8 but 1 UTF-16 code unit — a naive .length comparison against
    // the secret's character count would not catch this, but Buffer byte length must.
    const multibyte = 'é'.repeat(SECRET.length);
    expect(() => isAuthorizedCron(req(`Bearer ${multibyte}`), SECRET)).not.toThrow();
    expect(isAuthorizedCron(req(`Bearer ${multibyte}`), SECRET)).toBe(false);
  });

  it('accepts the correct secret', () => {
    expect(isAuthorizedCron(req(`Bearer ${SECRET}`), SECRET)).toBe(true);
  });
});
