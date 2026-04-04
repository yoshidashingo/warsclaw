import type { ApprovalMode, TaskTrustFields } from './types.js';

export interface TrustInput {
  consecutive_successes: number;
  total_positive_feedback: number;
  total_runs: number;
}

export class TrustScorer {
  calculate(input: TrustInput): number {
    const { consecutive_successes, total_positive_feedback, total_runs } = input;
    if (total_runs === 0) return 0;

    const successRate = consecutive_successes / total_runs;
    const feedbackRate = total_positive_feedback / total_runs;
    const streakBonus = Math.min(consecutive_successes / 10, 1.0);

    return Math.min(successRate * 0.4 + feedbackRate * 0.4 + streakBonus * 0.2, 1.0);
  }

  determineApprovalMode(score: number, totalRuns?: number): ApprovalMode {
    if (score >= 0.8 && (totalRuns === undefined || totalRuns >= 20)) return 'auto';
    if (score >= 0.5) return 'notify_only';
    return 'required';
  }

  updateAfterRun(
    current: TaskTrustFields,
    success: boolean,
    feedbackScore: number | undefined,
  ): TaskTrustFields {
    const update: TaskTrustFields = { ...current };

    if (success) {
      update.consecutive_successes += 1;
    } else {
      update.consecutive_successes = 0;
    }

    update.total_runs += 1;

    if (feedbackScore !== undefined && feedbackScore >= 4) {
      update.total_positive_feedback += 1;
    }

    update.trust_score = this.calculate(update);

    if (!update.approval_mode_locked) {
      update.approval_mode = this.determineApprovalMode(update.trust_score, update.total_runs);
    }

    return update;
  }
}
