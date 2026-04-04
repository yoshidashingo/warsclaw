import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { TrustScorer } from '../trust-scorer.js';
import type { ApprovalMode } from '../types.js';

describe('TrustScorer', () => {
  const scorer = new TrustScorer();

  describe('calculate', () => {
    it('returns 0 for a brand new task with no runs', () => {
      const score = scorer.calculate({
        consecutive_successes: 0,
        total_positive_feedback: 0,
        total_runs: 0,
      });
      expect(score).toBe(0);
    });

    it('returns 1.0 for a perfect task (10+ consecutive successes, all positive)', () => {
      const score = scorer.calculate({
        consecutive_successes: 10,
        total_positive_feedback: 10,
        total_runs: 10,
      });
      expect(score).toBe(1.0);
    });

    it('returns a mid-range score for mixed results', () => {
      const score = scorer.calculate({
        consecutive_successes: 3,
        total_positive_feedback: 5,
        total_runs: 10,
      });
      // successRate = 3/10 = 0.3, feedbackRate = 5/10 = 0.5, streakBonus = 3/10 = 0.3
      // 0.3*0.4 + 0.5*0.4 + 0.3*0.2 = 0.12 + 0.20 + 0.06 = 0.38
      expect(score).toBeCloseTo(0.38, 2);
    });

    it('score is always between 0 and 1', () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 100 }),
          fc.nat({ max: 100 }),
          fc.nat({ max: 100 }),
          (consecutive, positive, total) => {
            const runs = Math.max(total, Math.max(consecutive, positive));
            const score = scorer.calculate({
              consecutive_successes: consecutive,
              total_positive_feedback: Math.min(positive, runs),
              total_runs: runs,
            });
            return score >= 0 && score <= 1;
          },
        ),
      );
    });
  });

  describe('determineApprovalMode', () => {
    it('returns "required" for score < 0.5', () => {
      expect(scorer.determineApprovalMode(0.0)).toBe('required');
      expect(scorer.determineApprovalMode(0.49)).toBe('required');
    });

    it('returns "notify_only" for score 0.5 - 0.79', () => {
      expect(scorer.determineApprovalMode(0.5)).toBe('notify_only');
      expect(scorer.determineApprovalMode(0.79)).toBe('notify_only');
    });

    it('returns "auto" for score >= 0.8 with >= 20 total runs', () => {
      expect(scorer.determineApprovalMode(0.8, 20)).toBe('auto');
      expect(scorer.determineApprovalMode(1.0, 20)).toBe('auto');
      expect(scorer.determineApprovalMode(1.0, 100)).toBe('auto');
    });

    it('returns "notify_only" for score >= 0.8 with < 20 total runs', () => {
      expect(scorer.determineApprovalMode(0.8, 0)).toBe('notify_only');
      expect(scorer.determineApprovalMode(1.0, 19)).toBe('notify_only');
    });

    it('returns "auto" for score >= 0.8 when totalRuns is undefined (backward compat)', () => {
      expect(scorer.determineApprovalMode(0.8)).toBe('auto');
      expect(scorer.determineApprovalMode(1.0)).toBe('auto');
    });
  });

  describe('updateAfterRun', () => {
    it('increments consecutive_successes on success', () => {
      const result = scorer.updateAfterRun(
        { consecutive_successes: 2, total_positive_feedback: 1, total_runs: 3, trust_score: 0, approval_mode: 'required', approval_mode_locked: false },
        true,
        undefined,
      );
      expect(result.consecutive_successes).toBe(3);
      expect(result.total_runs).toBe(4);
    });

    it('resets consecutive_successes to 0 on failure', () => {
      const result = scorer.updateAfterRun(
        { consecutive_successes: 5, total_positive_feedback: 3, total_runs: 5, trust_score: 0.8, approval_mode: 'auto', approval_mode_locked: false },
        false,
        undefined,
      );
      expect(result.consecutive_successes).toBe(0);
    });

    it('increments total_positive_feedback for score >= 4', () => {
      const result = scorer.updateAfterRun(
        { consecutive_successes: 1, total_positive_feedback: 0, total_runs: 1, trust_score: 0, approval_mode: 'required', approval_mode_locked: false },
        true,
        4,
      );
      expect(result.total_positive_feedback).toBe(1);
    });

    it('does not increment total_positive_feedback for score < 4', () => {
      const result = scorer.updateAfterRun(
        { consecutive_successes: 1, total_positive_feedback: 0, total_runs: 1, trust_score: 0, approval_mode: 'required', approval_mode_locked: false },
        true,
        3,
      );
      expect(result.total_positive_feedback).toBe(0);
    });

    it('does not change approval_mode when locked', () => {
      const result = scorer.updateAfterRun(
        { consecutive_successes: 10, total_positive_feedback: 10, total_runs: 10, trust_score: 1.0, approval_mode: 'required', approval_mode_locked: true },
        true,
        5,
      );
      expect(result.approval_mode).toBe('required');
    });

    it('recalculates trust_score after update', () => {
      const result = scorer.updateAfterRun(
        { consecutive_successes: 0, total_positive_feedback: 0, total_runs: 0, trust_score: 0, approval_mode: 'required', approval_mode_locked: false },
        true,
        5,
      );
      expect(result.trust_score).toBeGreaterThan(0);
    });
  });
});
