import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { CronExpressionParser } from 'cron-parser';

// Test computeNextRun logic directly
function computeNextRun(scheduleType: string, scheduleValue: string, lastRun: string | null, tz = 'UTC'): string | null {
  switch (scheduleType) {
    case 'cron': {
      const interval = CronExpressionParser.parse(scheduleValue, { tz });
      return interval.next().toISOString();
    }
    case 'interval': {
      const ms = parseInt(scheduleValue, 10);
      const base = lastRun ? new Date(lastRun).getTime() : Date.now();
      return new Date(base + ms).toISOString();
    }
    case 'once': {
      if (lastRun) return null;
      return scheduleValue;
    }
    default:
      return null;
  }
}

describe('computeNextRun', () => {
  it('computes cron next run', () => {
    const next = computeNextRun('cron', '*/5 * * * *', null);
    expect(next).toBeTruthy();
    expect(new Date(next!).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('computes interval next run from last_run', () => {
    const lastRun = '2026-01-01T00:00:00.000Z';
    const next = computeNextRun('interval', '60000', lastRun);
    expect(next).toBe('2026-01-01T00:01:00.000Z');
  });

  it('returns schedule_value for once (not yet run)', () => {
    const next = computeNextRun('once', '2026-12-31T00:00:00Z', null);
    expect(next).toBe('2026-12-31T00:00:00Z');
  });

  it('returns null for once (already run)', () => {
    const next = computeNextRun('once', '2026-12-31T00:00:00Z', '2026-12-31T00:00:01Z');
    expect(next).toBeNull();
  });

  it('PBT: interval next_run is always after last_run', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 60000, max: 86400000 }),
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
        (intervalMs, lastRunDate) => {
          const lastRun = lastRunDate.toISOString();
          const next = computeNextRun('interval', String(intervalMs), lastRun);
          expect(next).toBeTruthy();
          expect(new Date(next!).getTime()).toBe(lastRunDate.getTime() + intervalMs);
        },
      ),
    );
  });

  it('PBT: cron always returns a future date', () => {
    const cronExprs = ['* * * * *', '*/5 * * * *', '0 * * * *', '0 0 * * *', '0 0 * * 1'];
    fc.assert(
      fc.property(fc.constantFrom(...cronExprs), (expr) => {
        const next = computeNextRun('cron', expr, null);
        expect(next).toBeTruthy();
        // cron next should be in the future (within 1 day tolerance)
        const nextTime = new Date(next!).getTime();
        expect(nextTime).toBeGreaterThan(Date.now() - 1000);
      }),
    );
  });
});
