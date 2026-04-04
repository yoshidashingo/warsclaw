import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskLifecycleManager } from '../task-lifecycle.js';
import { TrustScorer } from '../trust-scorer.js';
import type { ScheduledTask, TaskRun } from '../types.js';

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    group_folder: 'main',
    chat_jid: 'slack_C123',
    prompt: 'Do something',
    script: null,
    schedule_type: 'cron',
    schedule_value: '0 9 * * *',
    context_mode: 'group',
    next_run: null,
    last_run: null,
    last_result: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    trust_score: 0,
    consecutive_successes: 0,
    total_positive_feedback: 0,
    total_runs: 0,
    approval_mode: 'required',
    approval_mode_locked: false,
    ...overrides,
  };
}

function makeDb() {
  return {
    createTaskRun: vi.fn(),
    getTaskRun: vi.fn(),
    updateTaskRun: vi.fn(),
    getLastTaskRun: vi.fn().mockReturnValue(null),
    getTaskRunsByState: vi.fn().mockReturnValue([]),
    updateTask: vi.fn(),
    logTaskRun: vi.fn(),
    getTask: vi.fn(),
  };
}

function makeSlackInteraction() {
  return {
    postApprovalRequest: vi.fn().mockResolvedValue('ts-123'),
    postReport: vi.fn().mockResolvedValue('ts-456'),
    updateMessageWithResult: vi.fn().mockResolvedValue(undefined),
  };
}

function makeQueue() {
  return { enqueue: vi.fn() };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe('TaskLifecycleManager', () => {
  let db: ReturnType<typeof makeDb>;
  let slack: ReturnType<typeof makeSlackInteraction>;
  let queue: ReturnType<typeof makeQueue>;
  let logger: ReturnType<typeof makeLogger>;
  let manager: TaskLifecycleManager;

  beforeEach(() => {
    db = makeDb();
    slack = makeSlackInteraction();
    queue = makeQueue();
    logger = makeLogger();
    manager = new TaskLifecycleManager(
      db as any, queue as any, slack as any, new TrustScorer(), logger as any,
      { slackBotToken: 'xoxb-test', approvalTimeoutMs: 3600000, feedbackTimeoutMs: 86400000 },
    );
  });

  describe('startRun', () => {
    it('creates a task_run record in planning state for required approval_mode', async () => {
      const task = makeTask({ approval_mode: 'required' });
      queue.enqueue.mockImplementation(({ onComplete }: any) => {
        onComplete({ status: 'success', result: 'Plan: step 1, step 2' });
      });
      await manager.startRun(task);
      expect(db.createTaskRun).toHaveBeenCalledWith(
        expect.objectContaining({ task_id: 'task-1', state: 'planning' }),
      );
    });

    it('skips to executing for auto approval_mode', async () => {
      const task = makeTask({ approval_mode: 'auto', trust_score: 0.9 });
      queue.enqueue.mockImplementation(({ onComplete }: any) => {
        onComplete({ status: 'success', result: 'Done' });
      });
      await manager.startRun(task);
      expect(slack.postApprovalRequest).not.toHaveBeenCalled();
      expect(queue.enqueue).toHaveBeenCalled();
    });
  });

  describe('handleApproval', () => {
    it('transitions run from awaiting_approval to executing', async () => {
      const run: TaskRun = {
        id: 'run-1', task_id: 'task-1', state: 'awaiting_approval',
        plan: 'the plan', plan_slack_ts: 'ts-1', plan_channel_id: 'C123',
        approval_by: null, approval_at: null, rejection_reason: null,
        result: null, report: null, report_slack_ts: null,
        feedback_score: null, feedback_comment: null,
        started_at: Date.now(), finished_at: null, created_at: Date.now(),
      };
      db.getTaskRun.mockReturnValue(run);
      db.getTask.mockReturnValue(makeTask());
      queue.enqueue.mockImplementation(({ onComplete }: any) => {
        onComplete({ status: 'success', result: 'Executed' });
      });
      await manager.handleApproval('run-1', 'U123');
      expect(db.updateTaskRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
        state: 'executing', approval_by: 'U123',
      }));
    });
  });

  describe('handleRejection', () => {
    it('transitions run to rejected state with reason', async () => {
      const run: TaskRun = {
        id: 'run-1', task_id: 'task-1', state: 'awaiting_approval',
        plan: 'the plan', plan_slack_ts: 'ts-1', plan_channel_id: 'C123',
        approval_by: null, approval_at: null, rejection_reason: null,
        result: null, report: null, report_slack_ts: null,
        feedback_score: null, feedback_comment: null,
        started_at: Date.now(), finished_at: null, created_at: Date.now(),
      };
      db.getTaskRun.mockReturnValue(run);
      await manager.handleRejection('run-1', 'U123', 'Not ready');
      expect(db.updateTaskRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
        state: 'rejected', rejection_reason: 'Not ready',
      }));
    });
  });

  describe('handleFeedback', () => {
    it('updates trust score after positive feedback', async () => {
      const run: TaskRun = {
        id: 'run-1', task_id: 'task-1', state: 'awaiting_feedback',
        plan: 'plan', plan_slack_ts: 'ts-1', plan_channel_id: 'C123',
        approval_by: 'U1', approval_at: Date.now(), rejection_reason: null,
        result: 'done', report: 'report', report_slack_ts: 'ts-2',
        feedback_score: null, feedback_comment: null,
        started_at: Date.now(), finished_at: Date.now(), created_at: Date.now(),
      };
      db.getTaskRun.mockReturnValue(run);
      db.getTask.mockReturnValue(makeTask());
      await manager.handleFeedback('run-1', 5, 'Great job');
      expect(db.updateTaskRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
        state: 'completed', feedback_score: 5, feedback_comment: 'Great job',
      }));
      expect(db.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
        trust_score: expect.any(Number),
      }));
    });
  });
});
