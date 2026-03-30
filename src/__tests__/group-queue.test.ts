import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { getBackoffMs } from '../group-queue.js';

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
