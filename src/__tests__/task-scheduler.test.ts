import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { TaskScheduler } from '../task-scheduler.js';

function createScheduler(): TaskScheduler {
  const mockDb = { getDueTasks: vi.fn(() => []), createTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(), logTaskRun: vi.fn() };
  const mockQueue = { enqueue: vi.fn() };
  const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return new TaskScheduler(mockDb as any, mockQueue as any, mockLogger as any, 'UTC');
}

describe('TaskScheduler.computeNextRun', () => {
  const scheduler = createScheduler();

  it('computes cron next run', () => {
    const next = scheduler.computeNextRun({ schedule_type: 'cron', schedule_value: '*/5 * * * *', last_run: null });
    expect(next).toBeTruthy();
    expect(new Date(next!).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('computes interval next run from last_run', () => {
    const next = scheduler.computeNextRun({ schedule_type: 'interval', schedule_value: '60000', last_run: '2026-01-01T00:00:00.000Z' });
    expect(next).toBe('2026-01-01T00:01:00.000Z');
  });

  it('returns schedule_value for once (not yet run)', () => {
    const next = scheduler.computeNextRun({ schedule_type: 'once', schedule_value: '2026-12-31T00:00:00Z', last_run: null });
    expect(next).toBe('2026-12-31T00:00:00Z');
  });

  it('returns null for once (already run)', () => {
    const next = scheduler.computeNextRun({ schedule_type: 'once', schedule_value: '2026-12-31T00:00:00Z', last_run: '2026-12-31T00:00:01Z' });
    expect(next).toBeNull();
  });

  it('PBT: interval next_run is always after last_run', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 60000, max: 86400000 }),
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
        (intervalMs, lastRunDate) => {
          const lastRun = lastRunDate.toISOString();
          const next = scheduler.computeNextRun({ schedule_type: 'interval', schedule_value: String(intervalMs), last_run: lastRun });
          expect(next).toBeTruthy();
          expect(new Date(next!).getTime()).toBe(lastRunDate.getTime() + intervalMs);
        },
      ),
    );
  });

  it('computeNextRun returns null for interval < 60000', () => {
    const next = scheduler.computeNextRun({ schedule_type: 'interval', schedule_value: '0', last_run: null });
    expect(next).toBeNull();
  });

  it('computeNextRun returns null for negative interval', () => {
    const next = scheduler.computeNextRun({ schedule_type: 'interval', schedule_value: '-5000', last_run: null });
    expect(next).toBeNull();
  });

  it('PBT: cron always returns a future date', () => {
    const cronExprs = ['* * * * *', '*/5 * * * *', '0 * * * *', '0 0 * * *', '0 0 * * 1'];
    fc.assert(
      fc.property(fc.constantFrom(...cronExprs), (expr) => {
        const next = scheduler.computeNextRun({ schedule_type: 'cron', schedule_value: expr, last_run: null });
        expect(next).toBeTruthy();
        const nextTime = new Date(next!).getTime();
        expect(nextTime).toBeGreaterThan(Date.now() - 1000);
      }),
    );
  });
});
