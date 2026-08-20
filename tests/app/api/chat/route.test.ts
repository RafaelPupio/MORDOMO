import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_GLOBAL_CAP_USD, parseGlobalCapUsd } from '@/app/api/chat/route';

// `Number(process.env.DEMO_GLOBAL_MONTHLY_USD_CAP ?? '50')` would fail OPEN on a malformed
// value — `Number("abc")` is `NaN`, and `spend >= NaN` is always `false`, so a
// typo in this hand-set dashboard value silently deleted the global budget cap instead of
// misconfiguring it. checkBudget() fails closed when a tenant has no budget row at all; this
// parse must fail closed the same way — a missing OR malformed value both degrade to the
// same conservative default, never to "no cap".
describe('parseGlobalCapUsd', () => {
  it('uses the default when the env var is unset', () => {
    expect(parseGlobalCapUsd(undefined)).toBe(DEFAULT_GLOBAL_CAP_USD);
  });

  it('parses a valid positive numeric string', () => {
    expect(parseGlobalCapUsd('50')).toBe(50);
    expect(parseGlobalCapUsd('0.5')).toBe(0.5);
  });

  it('falls back to the default (not "no cap") for a non-numeric value, and logs it', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(parseGlobalCapUsd('abc')).toBe(DEFAULT_GLOBAL_CAP_USD);
      expect(parseGlobalCapUsd('not-a-number')).toBe(DEFAULT_GLOBAL_CAP_USD);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('falls back to the default for zero, negative, and non-finite values', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // "0" is a real reproduction case: it parses to a legitimate number, but a cap of $0
      // is indistinguishable from "the demo is permanently down" — treat it as malformed
      // input, the same as a typo, rather than a valid (if extreme) budget.
      expect(parseGlobalCapUsd('0')).toBe(DEFAULT_GLOBAL_CAP_USD);
      expect(parseGlobalCapUsd('-10')).toBe(DEFAULT_GLOBAL_CAP_USD);
      expect(parseGlobalCapUsd('Infinity')).toBe(DEFAULT_GLOBAL_CAP_USD);
      expect(parseGlobalCapUsd('NaN')).toBe(DEFAULT_GLOBAL_CAP_USD);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
