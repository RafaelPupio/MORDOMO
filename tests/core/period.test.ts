import { describe, expect, it } from 'vitest';
import { formatPeriodLabel } from '@/core/period';

describe('formatPeriodLabel', () => {
  it('formats a Monday-to-Sunday week as an inclusive dd/mm/aaaa range', () => {
    const periodStart = new Date('2026-08-10T00:00:00.000Z'); // Monday
    const periodEnd = new Date('2026-08-17T00:00:00.000Z'); // following Monday, exclusive

    expect(formatPeriodLabel(periodStart, periodEnd)).toBe('10/08/2026 a 16/08/2026');
  });

  it('formats dates in UTC, not the server local timezone — a UTC-midnight boundary must not shift to the previous day', () => {
    // A naive `Intl.DateTimeFormat` with no explicit timeZone (or one using a negative-offset
    // zone like America/Sao_Paulo) would print 2026-08-09 for this instant. UTC formatting
    // keeps it on the day `weekStart` (src/core/weekly-report.ts) actually computed.
    const periodStart = new Date('2026-08-10T00:00:00.000Z');
    const periodEnd = new Date('2026-08-11T00:00:00.000Z');

    expect(formatPeriodLabel(periodStart, periodEnd)).toBe('10/08/2026 a 10/08/2026');
  });

  it('crosses a month boundary correctly', () => {
    const periodStart = new Date('2026-08-31T00:00:00.000Z'); // Monday
    const periodEnd = new Date('2026-09-07T00:00:00.000Z');

    expect(formatPeriodLabel(periodStart, periodEnd)).toBe('31/08/2026 a 06/09/2026');
  });
});
