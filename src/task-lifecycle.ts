import { randomUUID } from 'node:crypto';
import type { Database } from './db.js';
import type { GroupQueue } from './group-queue.js';
import type { SlackInteraction } from './channels/slack-interaction.js';
import type { TrustScorer } from './trust-scorer.js';
import type { Logger } from './logger.js';
import type { ScheduledTask, TaskRun, ReportData } from './types.js';

export interface LifecycleConfig {
  slackBotToken: string;
  approvalTimeoutMs: number;
  feedbackTimeoutMs: number;
  notifyOnlyDelayMs?: number;
}

export class TaskLifecycleManager {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly db: Database,
    private readonly queue: GroupQueue,
    private readonly slack: SlackInteraction,
    private readonly trustScorer: TrustScorer,
    private readonly logger: Logger,
    private readonly config: LifecycleConfig,
  ) {}

  async startRun(task: ScheduledTask): Promise<void> {
    const run: TaskRun = {
      id: randomUUID(),
      task_id: task.id,
      state: 'planning',
      plan: null,
      plan_slack_ts: null,
      plan_channel_id: null,
      approval_by: null,
      approval_at: null,
      rejection_reason: null,
      result: null,
      report: null,
      report_slack_ts: null,
      feedback_score: null,
      feedback_comment: null,
      started_at: Date.now(),
      finished_at: null,
      created_at: Date.now(),
    };
    this.db.createTaskRun({ ...run });

    if (task.approval_mode === 'auto') {
      this.db.updateTaskRun(run.id, { state: 'executing' });
      run.state = 'executing';
      await this.executeTask(run, task);
      return;
    }

    await this.generatePlan(run, task);
  }

  private async generatePlan(run: TaskRun, task: ScheduledTask): Promise<void> {
    const lastRun = this.db.getLastTaskRun(task.id);
    const planPrompt = this.buildPlanPrompt(task, lastRun);

    this.queue.enqueue({
      groupFolder: task.group_folder,
      input: {
        prompt: planPrompt,
        sessionId: '',
        groupFolder: task.group_folder,
        chatJid: task.chat_jid,
        isMain: false,
        isScheduledTask: true,
        assistantName: 'WarsClaw',
        script: task.script ?? undefined,
      },
      onComplete: async (output) => {
        const plan = output.result;
        this.db.updateTaskRun(run.id, { plan, state: 'awaiting_approval' });
        run.plan = plan;
        run.state = 'awaiting_approval';
        await this.requestApproval(run, task);
      },
      onError: (error) => {
        this.db.updateTaskRun(run.id, { state: 'error', finished_at: Date.now() });
        this.logger.error({ runId: run.id, taskId: task.id }, `Plan generation failed: ${error.message}`);
      },
    });
  }

  private async requestApproval(run: TaskRun, task: ScheduledTask): Promise<void> {
    const channelId = task.chat_jid.replace('slack_', '');
    const trustLabel = this.getTrustLabel(task.trust_score);

    const ts = await this.slack.postApprovalRequest(
      this.config.slackBotToken, channelId, run.id,
      task.prompt.slice(0, 80),
      `${task.schedule_type}: ${task.schedule_value}`,
      trustLabel, run.plan ?? '',
    );

    this.db.updateTaskRun(run.id, { plan_slack_ts: ts, plan_channel_id: channelId });

    if (task.approval_mode === 'notify_only') {
      const delay = this.config.notifyOnlyDelayMs ?? 1800000;
      this.startTimer(run.id, delay, () => this.handleApproval(run.id, 'system:auto'));
    } else {
      this.startTimer(run.id, this.config.approvalTimeoutMs, () => {
        this.logger.warn({ runId: run.id }, 'Approval timed out');
        this.db.updateTaskRun(run.id, { state: 'rejected', rejection_reason: 'Approval timeout', finished_at: Date.now() });
      });
    }
  }

  async handleApproval(runId: string, userId: string): Promise<void> {
    this.clearTimer(runId);
    const run = this.db.getTaskRun(runId);
    if (!run || run.state !== 'awaiting_approval') return;

    this.db.updateTaskRun(runId, { state: 'executing', approval_by: userId, approval_at: Date.now() });
    run.state = 'executing';
    run.approval_by = userId;

    if (run.plan_channel_id && run.plan_slack_ts) {
      await this.slack.updateMessageWithResult(
        this.config.slackBotToken, run.plan_channel_id, run.plan_slack_ts,
        `✅ Approved by <@${userId}>`,
      ).catch((e) => this.logger.warn({ runId }, `Failed to update approval message: ${e}`));
    }

    const task = this.db.getTask(run.task_id);
    if (task) await this.executeTask(run, task);
  }

  async handleRejection(runId: string, userId: string, reason: string): Promise<void> {
    this.clearTimer(runId);
    const run = this.db.getTaskRun(runId);
    if (!run || run.state !== 'awaiting_approval') return;

    this.db.updateTaskRun(runId, { state: 'rejected', rejection_reason: reason, finished_at: Date.now() });

    if (run.plan_channel_id && run.plan_slack_ts) {
      await this.slack.updateMessageWithResult(
        this.config.slackBotToken, run.plan_channel_id, run.plan_slack_ts,
        `❌ Rejected by <@${userId}>: ${reason}`,
      ).catch((e) => this.logger.warn({ runId }, `Failed to update rejection message: ${e}`));
    }
  }

  async handleRevisionRequest(runId: string, userId: string, instruction: string): Promise<void> {
    this.clearTimer(runId);
    const run = this.db.getTaskRun(runId);
    if (!run || run.state !== 'awaiting_approval') return;

    this.db.updateTaskRun(runId, { state: 'planning' });

    const task = this.db.getTask(run.task_id);
    if (task) {
      const revisedTask = { ...task, prompt: `${task.prompt}\n\n修正指示: ${instruction}` };
      await this.generatePlan(run, revisedTask);
    }
  }

  async handleFeedback(runId: string, score: number, comment?: string): Promise<void> {
    this.clearTimer(runId);
    const run = this.db.getTaskRun(runId);
    if (!run || run.state !== 'awaiting_feedback') return;

    this.db.updateTaskRun(runId, {
      state: 'completed',
      feedback_score: score,
      feedback_comment: comment ?? null,
      finished_at: Date.now(),
    });

    const task = this.db.getTask(run.task_id);
    if (task) {
      const updated = this.trustScorer.updateAfterRun(
        {
          trust_score: task.trust_score,
          consecutive_successes: task.consecutive_successes,
          total_positive_feedback: task.total_positive_feedback,
          total_runs: task.total_runs,
          approval_mode: task.approval_mode,
          approval_mode_locked: task.approval_mode_locked,
        },
        true, score,
      );
      this.db.updateTask(task.id, updated as any);
    }
  }

  private async executeTask(run: TaskRun, task: ScheduledTask): Promise<void> {
    this.queue.enqueue({
      groupFolder: task.group_folder,
      input: {
        prompt: task.prompt,
        sessionId: '',
        groupFolder: task.group_folder,
        chatJid: task.chat_jid,
        isMain: false,
        isScheduledTask: true,
        assistantName: 'WarsClaw',
        script: task.script ?? undefined,
      },
      onComplete: async (output) => {
        this.db.updateTaskRun(run.id, { state: 'reporting', result: output.result });
        run.result = output.result;
        run.state = 'reporting';

        const now = new Date().toISOString();
        this.db.logTaskRun({
          task_id: task.id,
          started_at: now,
          finished_at: now,
          status: 'success',
          result: output.result.slice(0, 1000),
          error: null,
        });

        await this.generateReport(run, task);
      },
      onError: (error) => {
        this.db.updateTaskRun(run.id, { state: 'error', result: error.message, finished_at: Date.now() });
        const now = new Date().toISOString();
        this.db.logTaskRun({
          task_id: task.id,
          started_at: now,
          finished_at: now,
          status: 'error',
          result: null,
          error: error.message.slice(0, 1000),
        });
      },
    });
  }

  private async generateReport(run: TaskRun, task: ScheduledTask): Promise<void> {
    const shouldSimplify = task.trust_score >= 0.8;

    const report: ReportData = shouldSimplify
      ? { summary: run.result?.slice(0, 500) ?? 'No result', planDiff: null, suggestions: [] }
      : this.parseReport(run);

    this.db.updateTaskRun(run.id, { state: 'awaiting_feedback', report: JSON.stringify(report) });

    const channelId = task.chat_jid.replace('slack_', '');
    const ts = await this.slack.postReport(
      this.config.slackBotToken, channelId, run.id,
      task.prompt.slice(0, 80), report,
    );
    this.db.updateTaskRun(run.id, { report_slack_ts: ts });

    this.startTimer(run.id, this.config.feedbackTimeoutMs, () => {
      this.logger.info({ runId: run.id }, 'Feedback timed out, completing run');
      this.db.updateTaskRun(run.id, { state: 'completed', finished_at: Date.now() });

      const updated = this.trustScorer.updateAfterRun(
        {
          trust_score: task.trust_score,
          consecutive_successes: task.consecutive_successes,
          total_positive_feedback: task.total_positive_feedback,
          total_runs: task.total_runs,
          approval_mode: task.approval_mode,
          approval_mode_locked: task.approval_mode_locked,
        },
        true, undefined,
      );
      this.db.updateTask(task.id, updated as any);
      this.db.updateTask(task.id, {
        last_run: new Date().toISOString(),
        status: task.schedule_type === 'once' ? 'completed' : 'active',
      });
    });
  }

  private parseReport(run: TaskRun): ReportData {
    const result = run.result ?? '';
    const plan = run.plan ?? '';
    return {
      summary: result.slice(0, 1000),
      planDiff: plan && result ? `Planned: ${plan.slice(0, 200)}\nActual: ${result.slice(0, 200)}` : null,
      suggestions: [],
    };
  }

  async recoverPendingRuns(): Promise<void> {
    const pending = this.db.getTaskRunsByState('awaiting_approval', 'awaiting_feedback');
    for (const run of pending) {
      this.logger.info({ runId: run.id, state: run.state }, 'Recovering pending run');
      const age = Date.now() - run.created_at;
      if (run.state === 'awaiting_approval' && age > this.config.approvalTimeoutMs) {
        this.db.updateTaskRun(run.id, {
          state: 'rejected',
          rejection_reason: 'Approval timeout (recovery)',
          finished_at: Date.now(),
        });
      } else if (run.state === 'awaiting_feedback' && age > this.config.feedbackTimeoutMs) {
        this.db.updateTaskRun(run.id, { state: 'completed', finished_at: Date.now() });
      }
    }
  }

  private buildPlanPrompt(task: ScheduledTask, lastRun: TaskRun | null): string {
    let prompt = `以下のタスクの実行計画を作成してください。実行は行わないでください。\n\nタスク: ${task.prompt}`;
    if (lastRun?.result) prompt += `\n\n前回の結果: ${lastRun.result.slice(0, 500)}`;
    if (lastRun?.feedback_comment) prompt += `\n\n前回のフィードバック: ${lastRun.feedback_comment}`;
    if (lastRun?.rejection_reason) prompt += `\n\n前回の却下理由: ${lastRun.rejection_reason}`;
    return prompt;
  }

  private getTrustLabel(score: number): string {
    if (score >= 0.8) return '信頼済み';
    if (score >= 0.5) return '安定';
    return '学習中';
  }

  private startTimer(runId: string, ms: number, callback: () => void): void {
    this.clearTimer(runId);
    this.timers.set(runId, setTimeout(callback, ms));
  }

  private clearTimer(runId: string): void {
    const timer = this.timers.get(runId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(runId);
    }
  }

  shutdown(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
