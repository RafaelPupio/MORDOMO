import { describe, expect, it } from 'vitest';
import { buildGenerateReportState } from '@/app/staff/(dashboard)/relatorios/generate-report-state';
import type { WeeklyReportResult } from '@/core/weekly-report';

const PERIOD_START = new Date('2026-08-10T00:00:00.000Z');
const PERIOD_END = new Date('2026-08-17T00:00:00.000Z');

describe('buildGenerateReportState', () => {
  it('maps "published" to an ok message naming the week, with no error or notice', () => {
    const result: WeeklyReportResult = { status: 'published', reportId: 'r1' };

    const state = buildGenerateReportState(result, PERIOD_START, PERIOD_END);

    expect(state.ok).toContain('10/08/2026');
    expect(state.ok).toContain('16/08/2026');
    expect(state.error).toBeUndefined();
    expect(state.notice).toBeUndefined();
  });

  // The core requirement this task calls out by name: a quiet week is NOT a failure and
  // must never surface as one.
  it('maps "skipped-no-activity" to a notice, never an error', () => {
    const result: WeeklyReportResult = { status: 'skipped-no-activity' };

    const state = buildGenerateReportState(result, PERIOD_START, PERIOD_END);

    expect(state.notice).toBeTruthy();
    expect(state.notice).toContain('10/08/2026');
    expect(state.error).toBeUndefined();
    expect(state.ok).toBeUndefined();
  });

  it('maps "failed" to an error, with no ok or notice', () => {
    const result: WeeklyReportResult = { status: 'failed', reason: 'analysis-failed' };

    const state = buildGenerateReportState(result, PERIOD_START, PERIOD_END);

    expect(state.error).toBeTruthy();
    expect(state.ok).toBeUndefined();
    expect(state.notice).toBeUndefined();
  });

  it('the three outcomes never collide on the same state key', () => {
    const outcomes: WeeklyReportResult['status'][] = ['published', 'skipped-no-activity', 'failed'];
    const states = outcomes.map((status) => buildGenerateReportState({ status }, PERIOD_START, PERIOD_END));

    const keysUsed = states.map((s) => Object.keys(s)[0]);
    expect(new Set(keysUsed).size).toBe(3);
  });
});
