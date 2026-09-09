import { describe, expect, it } from 'vitest';
import { parseApprovedPublicUrl, sameApprovedHost } from '@/research/url-policy';

describe('public research URL policy', () => {
  it.each([
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com/?query=private',
    'https://example.com/#fragment',
    'https://127.0.0.1',
    'https://[::1]',
    'https://localhost',
    'https://service.internal',
    'https://example.com:8443',
  ])('rejects unsafe research URL %s', (value) => {
    expect(() => parseApprovedPublicUrl(value)).toThrow('unsafeUrl');
  });

  it('accepts one bounded public HTTPS page and a direct www redirect', () => {
    const requested = parseApprovedPublicUrl('https://EXAMPLE.com:443/about');
    expect(requested.href).toBe('https://example.com/about');
    expect(sameApprovedHost(requested, new URL('https://www.example.com/about'))).toBe(true);
    expect(sameApprovedHost(requested, new URL('https://docs.example.com/about'))).toBe(false);
    expect(sameApprovedHost(requested, new URL('http://example.com/about'))).toBe(false);
    expect(sameApprovedHost(requested, new URL('https://user:pass@example.com/about'))).toBe(false);
    expect(sameApprovedHost(requested, new URL('https://example.com:8443/about'))).toBe(false);
  });

  it('rejects overlong paths and total URLs', () => {
    expect(() => parseApprovedPublicUrl(`https://example.com/${'a'.repeat(1_024)}`)).toThrow('unsafeUrl');
    expect(() => parseApprovedPublicUrl(`https://${'a'.repeat(250)}.example.com/${'b'.repeat(1_790)}`)).toThrow('unsafeUrl');
  });

  it('rejects non-string and single-label inputs without echoing them', () => {
    expect(() => parseApprovedPublicUrl({ url: 'https://example.com' })).toThrow('unsafeUrl');
    expect(() => parseApprovedPublicUrl('not a URL')).toThrowError(new Error('unsafeUrl'));
    expect(() => parseApprovedPublicUrl('https://intranet')).toThrowError(new Error('unsafeUrl'));
  });
});
