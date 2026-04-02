import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { GroupQueue, getBackoffMs } from '../group-queue.js';

describe('getBackoffMs', () => {
  it('returns correct backoff values', () => {
    expect(getBackoffMs(1)).toBe(5000);
    expect(getBackoffMs(2)).toBe(10000);
    expect(getBackoffMs(3)).toBe(20000);
    expect(getBackoffMs(4)).toBe(40000);
    expect(getBackoffMs(5)).toBe(80000);
  });

  it('PBT: backoff is always positive and monotonically increasing', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (retryCount) => {
        const ms = getBackoffMs(retryCount);
        expect(ms).toBeGreaterThan(0);
        if (retryCount > 1) {
          expect(ms).toBeGreaterThan(getBackoffMs(retryCount - 1));
        }
      }),
    );
  });

  it('PBT: backoff follows formula 5000 * 2^(n-1)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 15 }), (n) => {
        expect(getBackoffMs(n)).toBe(5000 * Math.pow(2, n - 1));
      }),
    );
  });
});

describe('GroupQueue', () => {
  function createMockRunner(behavior: 'success' | 'fail-then-succeed' | 'always-fail') {
    let callCount = 0;
    return {
      run: vi.fn(async () => {
        callCount++;
        if (behavior === 'success') return { status: 'success' as const, result: 'ok' };
        if (behavior === 'fail-then-succeed') {
          if (callCount <= 2) throw new Error('transient');
          return { status: 'success' as const, result: 'ok' };
        }
        throw new Error('permanent');
      }),
      getActiveCount: () => 0,
      killGroup: vi.fn(),
    };
  }

  function createMockLogger() {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }

  it('activeCount returns to zero after successful processing', async () => {
    const runner = createMockRunner('success');
    const logger = createMockLogger();
    const queue = new GroupQueue(runner as any, logger as any, 5, 3);
    const completed = new Promise<void>((resolve) => {
      queue.enqueue({
        groupFolder: 'test',
        input: { prompt: 'hi', sessionId: '', groupFolder: 'test', chatJid: 'jid', isMain: false, isScheduledTask: false, assistantName: 'Bot' },
        onComplete: async () => { resolve(); },
        onError: () => {},
      });
    });
    await completed;
    await new Promise((r) => setTimeout(r, 50));
    expect(queue.getActiveCount()).toBe(0);
  });

  it('activeCount returns to zero after all retries exhausted', async () => {
    vi.useFakeTimers();
    const runner = createMockRunner('always-fail');
    const logger = createMockLogger();
    const queue = new GroupQueue(runner as any, logger as any, 5, 1);
    const errored = new Promise<void>((resolve) => {
      queue.enqueue({
        groupFolder: 'test',
        input: { prompt: 'hi', sessionId: '', groupFolder: 'test', chatJid: 'jid', isMain: false, isScheduledTask: false, assistantName: 'Bot' },
        onComplete: async () => {},
        onError: () => { resolve(); },
      });
    });
    // Advance timers to cover backoff delays
    await vi.advanceTimersByTimeAsync(10000);
    await errored;
    await vi.advanceTimersByTimeAsync(50);
    expect(queue.getActiveCount()).toBe(0);
    vi.useRealTimers();
  });

  it('rejects when queue is full', () => {
    const runner = createMockRunner('success');
    const logger = createMockLogger();
    const queue = new GroupQueue(runner as any, logger as any, 0, 1); // maxConcurrent=0 so nothing processes
    const errors: Error[] = [];
    for (let i = 0; i < 25; i++) {
      queue.enqueue({
        groupFolder: 'test',
        input: { prompt: 'hi', sessionId: '', groupFolder: 'test', chatJid: 'jid', isMain: false, isScheduledTask: false, assistantName: 'Bot' },
        onComplete: async () => {},
        onError: (err) => { errors.push(err); },
      });
    }
    expect(errors.length).toBe(5); // 20 accepted, 5 rejected
    expect(errors[0].message).toContain('Queue full');
  });
});
