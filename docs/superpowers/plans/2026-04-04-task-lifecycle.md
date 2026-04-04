# AI-DLC タスクライフサイクル管理 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** スケジュールタスクに「計画→承認→実行→レポート→フィードバック」のライフサイクルを導入し、信頼スコアで適応的にふりかえりを削減する

**Architecture:** 既存 TaskScheduler はスケジュール管理に専念し、新設 TaskLifecycleManager がライフサイクル制御を担う。SlackInteraction が Block Kit UI を分離管理し、TrustScorer が信頼度を算出する。

**Tech Stack:** TypeScript, better-sqlite3, @slack/bolt (Block Kit + Socket Mode), Vitest, fast-check

**Spec:** `docs/superpowers/specs/2026-04-04-task-lifecycle-design.md`

---

## ファイル構成

| ファイル | 操作 | 責務 |
|---------|------|------|
| `src/types.ts` | 変更 | TaskRun, ApprovalMode, ReportData, TrustFields 型追加 |
| `src/db.ts` | 変更 | task_runs テーブル追加、scheduled_tasks カラム追加、CRUD メソッド追加 |
| `src/trust-scorer.ts` | 新規 | 信頼スコア算出・適応レベル判定 |
| `src/task-lifecycle.ts` | 新規 | TaskLifecycleManager ステートマシン |
| `src/channels/slack-interaction.ts` | 新規 | Block Kit メッセージ投稿・アクションハンドラ |
| `src/channels/slack.ts` | 変更 | app インスタンスの外部公開 |
| `src/task-scheduler.ts` | 変更 | checkDueTasks を lifecycleManager に委譲 |
| `src/index.ts` | 変更 | 新コンポーネントの初期化・接続 |
| `src/__tests__/trust-scorer.test.ts` | 新規 | TrustScorer ユニットテスト |
| `src/__tests__/task-lifecycle.test.ts` | 新規 | TaskLifecycleManager ユニットテスト |
| `src/__tests__/slack-interaction.test.ts` | 新規 | SlackInteraction ユニットテスト |

---

## Task 1: 型定義の追加 (types.ts)

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: TaskRun・ApprovalMode・ReportData 型を追加**

`src/types.ts` の `ScheduledTask` インターフェースの直後（L85付近）に追加:

```typescript
// --- Task Lifecycle Types ---

export type ApprovalMode = 'required' | 'notify_only' | 'auto';

export type TaskRunState =
  | 'planning'
  | 'awaiting_approval'
  | 'rejected'
  | 'executing'
  | 'reporting'
  | 'awaiting_feedback'
  | 'completed'
  | 'error';

export interface TaskRun {
  id: string;
  task_id: string;
  state: TaskRunState;
  plan: string | null;
  plan_slack_ts: string | null;
  plan_channel_id: string | null;
  approval_by: string | null;
  approval_at: number | null;
  rejection_reason: string | null;
  result: string | null;
  report: string | null;
  report_slack_ts: string | null;
  feedback_score: number | null;
  feedback_comment: string | null;
  started_at: number;
  finished_at: number | null;
  created_at: number;
}

export interface TaskTrustFields {
  trust_score: number;
  consecutive_successes: number;
  total_positive_feedback: number;
  total_runs: number;
  approval_mode: ApprovalMode;
  approval_mode_locked: boolean;
}

export interface ReportData {
  summary: string;
  planDiff: string | null;
  suggestions: string[];
}
```

また、`ScheduledTask` インターフェースに信頼フィールドを追加:

```typescript
export interface ScheduledTask {
  // ... 既存フィールド ...
  created_at: string;
  // 信頼スコア関連
  trust_score: number;
  consecutive_successes: number;
  total_positive_feedback: number;
  total_runs: number;
  approval_mode: ApprovalMode;
  approval_mode_locked: boolean;
}
```

- [ ] **Step 2: ビルドが通ることを確認**

Run: `npx tsc --noEmit`
Expected: エラーが発生する（DBメソッドや参照先がまだ未実装のため）。types.ts 自体にエラーがないことを確認。

- [ ] **Step 3: コミット**

```bash
git add src/types.ts
git commit -m "feat(types): add TaskRun, ApprovalMode, TrustFields types for task lifecycle"
```

---

## Task 2: TrustScorer の TDD 実装

**Files:**
- Create: `src/__tests__/trust-scorer.test.ts`
- Create: `src/trust-scorer.ts`

- [ ] **Step 1: テストファイルを作成**

`src/__tests__/trust-scorer.test.ts` を作成:

```typescript
import { describe, it, expect } from 'vitest';
import { fc } from '@fast-check/vitest';
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

    it('returns "auto" for score >= 0.8', () => {
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/__tests__/trust-scorer.test.ts`
Expected: FAIL — `Cannot find module '../trust-scorer.js'`

- [ ] **Step 3: TrustScorer を実装**

`src/trust-scorer.ts` を作成:

```typescript
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

  determineApprovalMode(score: number): ApprovalMode {
    if (score >= 0.8) return 'auto';
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
      update.approval_mode = this.determineApprovalMode(update.trust_score);
    }

    return update;
  }
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `npx vitest run src/__tests__/trust-scorer.test.ts`
Expected: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add src/trust-scorer.ts src/__tests__/trust-scorer.test.ts
git commit -m "feat: add TrustScorer with property-based tests"
```

---

## Task 3: DB スキーマ拡張

**Files:**
- Modify: `src/db.ts`

- [ ] **Step 1: scheduled_tasks テーブルに信頼スコアカラムを追加**

`src/db.ts` の `init()` メソッド内、`scheduled_tasks` テーブル作成の直後（L61 `CREATE INDEX` の後）に ALTER 文を追加:

```typescript
      -- Trust score columns (idempotent migration)
      ALTER TABLE scheduled_tasks ADD COLUMN trust_score REAL NOT NULL DEFAULT 0.0;
      ALTER TABLE scheduled_tasks ADD COLUMN consecutive_successes INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE scheduled_tasks ADD COLUMN total_positive_feedback INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE scheduled_tasks ADD COLUMN total_runs INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE scheduled_tasks ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'required';
      ALTER TABLE scheduled_tasks ADD COLUMN approval_mode_locked INTEGER NOT NULL DEFAULT 0;
```

SQLite では `ALTER TABLE ADD COLUMN` はカラムが既に存在するとエラーになるため、`try/catch` でラップするかプラグマで存在チェックする。推奨: 個別の `try/catch` でラップ:

```typescript
  private migrateSchema(): void {
    const migrations = [
      `ALTER TABLE scheduled_tasks ADD COLUMN trust_score REAL NOT NULL DEFAULT 0.0`,
      `ALTER TABLE scheduled_tasks ADD COLUMN consecutive_successes INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE scheduled_tasks ADD COLUMN total_positive_feedback INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE scheduled_tasks ADD COLUMN total_runs INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE scheduled_tasks ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'required'`,
      `ALTER TABLE scheduled_tasks ADD COLUMN approval_mode_locked INTEGER NOT NULL DEFAULT 0`,
    ];
    for (const sql of migrations) {
      try { this.db.exec(sql); } catch { /* column already exists */ }
    }
  }
```

`init()` の末尾で `this.migrateSchema()` を呼ぶ。

- [ ] **Step 2: task_runs テーブルを追加**

`init()` の CREATE TABLE セクションに追加:

```typescript
      CREATE TABLE IF NOT EXISTS task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        state TEXT NOT NULL,
        plan TEXT,
        plan_slack_ts TEXT,
        plan_channel_id TEXT,
        approval_by TEXT,
        approval_at INTEGER,
        rejection_reason TEXT,
        result TEXT,
        report TEXT,
        report_slack_ts TEXT,
        feedback_score INTEGER,
        feedback_comment TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_runs_state ON task_runs(state);
```

- [ ] **Step 3: task_runs の CRUD メソッドを追加**

`db.ts` に以下のメソッドを追加:

```typescript
  // --- Task Runs ---
  createTaskRun(run: TaskRun): void {
    this.db.prepare(`INSERT INTO task_runs (id, task_id, state, plan, plan_slack_ts, plan_channel_id,
      approval_by, approval_at, rejection_reason, result, report, report_slack_ts,
      feedback_score, feedback_comment, started_at, finished_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(run.id, run.task_id, run.state, run.plan, run.plan_slack_ts, run.plan_channel_id,
        run.approval_by, run.approval_at, run.rejection_reason, run.result, run.report,
        run.report_slack_ts, run.feedback_score, run.feedback_comment,
        run.started_at, run.finished_at, run.created_at);
  }

  getTaskRun(runId: string): TaskRun | null {
    return (this.db.prepare(`SELECT * FROM task_runs WHERE id = ?`).get(runId) as TaskRun) ?? null;
  }

  getTaskRunsByState(...states: string[]): TaskRun[] {
    const placeholders = states.map(() => '?').join(',');
    return this.db.prepare(`SELECT * FROM task_runs WHERE state IN (${placeholders})`).all(...states) as TaskRun[];
  }

  getLastTaskRun(taskId: string): TaskRun | null {
    return (this.db.prepare(`SELECT * FROM task_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`).get(taskId) as TaskRun) ?? null;
  }

  updateTaskRun(runId: string, updates: Partial<TaskRun>): void {
    const allowed = ['state', 'plan', 'plan_slack_ts', 'plan_channel_id', 'approval_by',
      'approval_at', 'rejection_reason', 'result', 'report', 'report_slack_ts',
      'feedback_score', 'feedback_comment', 'finished_at'] as const;
    for (const key of allowed) {
      if (updates[key] === undefined) continue;
      this.db.prepare(`UPDATE task_runs SET ${key} = ? WHERE id = ?`).run(updates[key], runId);
    }
  }
```

- [ ] **Step 4: TASK_COLUMN_SQL に信頼スコアカラムを追加**

`db.ts` の `TASK_COLUMN_SQL` Map に以下を追加:

```typescript
    ['trust_score', 'UPDATE scheduled_tasks SET trust_score = ? WHERE id = ?'],
    ['consecutive_successes', 'UPDATE scheduled_tasks SET consecutive_successes = ? WHERE id = ?'],
    ['total_positive_feedback', 'UPDATE scheduled_tasks SET total_positive_feedback = ? WHERE id = ?'],
    ['total_runs', 'UPDATE scheduled_tasks SET total_runs = ? WHERE id = ?'],
    ['approval_mode', 'UPDATE scheduled_tasks SET approval_mode = ? WHERE id = ?'],
    ['approval_mode_locked', 'UPDATE scheduled_tasks SET approval_mode_locked = ? WHERE id = ?'],
```

- [ ] **Step 5: getTask メソッドを追加**

`db.ts` に単一タスク取得メソッドを追加（`getAllTasks` の直後）:

```typescript
  getTask(taskId: string): ScheduledTask | null {
    return (this.db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`).get(taskId) as ScheduledTask) ?? null;
  }
```

- [ ] **Step 6: import に TaskRun を追加**

`db.ts` の L2 の import を更新:

```typescript
import type { NewMessage, ScheduledTask, TaskRunLog, RegisteredGroup, TaskRun } from './types.js';
```

- [ ] **Step 7: ビルドが通ることを確認**

Run: `npx tsc --noEmit`
Expected: PASS（または types.ts の新フィールドが他ファイルで参照されていないだけの状態）

- [ ] **Step 8: コミット**

```bash
git add src/db.ts
git commit -m "feat(db): add task_runs table and trust score columns to scheduled_tasks"
```

---

## Task 4: SlackInteraction モジュール

**Files:**
- Create: `src/channels/slack-interaction.ts`
- Create: `src/__tests__/slack-interaction.test.ts`
- Modify: `src/channels/slack.ts`

- [ ] **Step 1: slack.ts を変更して app インスタンスを外部公開**

`src/channels/slack.ts` の戻り値に `getApp` メソッドを追加。`Channel` インターフェースは変更しない。代わりに `createSlackChannel` の戻り値の型を拡張:

```typescript
export interface SlackChannel extends Channel {
  getApp(): import('@slack/bolt').App;
}

export function createSlackChannel(opts: ChannelOpts): SlackChannel | null {
```

return オブジェクトに追加:

```typescript
    getApp: () => app,
```

- [ ] **Step 2: テストファイルを作成**

`src/__tests__/slack-interaction.test.ts` を作成:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildApprovalBlocks, buildReportBlocks } from '../channels/slack-interaction.js';
import type { ReportData } from '../types.js';

describe('SlackInteraction', () => {
  describe('buildApprovalBlocks', () => {
    it('contains header, plan text, and 3 action buttons', () => {
      const blocks = buildApprovalBlocks({
        runId: 'run-1',
        taskName: 'Daily Report',
        schedule: '0 9 * * *',
        trustLabel: '学習中',
        plan: 'Step 1: Check logs\nStep 2: Summarize',
      });

      const header = blocks.find((b: any) => b.type === 'header');
      expect(header).toBeDefined();

      const actions = blocks.find((b: any) => b.type === 'actions');
      expect(actions).toBeDefined();
      expect(actions.elements).toHaveLength(3);

      const actionIds = actions.elements.map((e: any) => e.action_id);
      expect(actionIds).toContain('wc_approve');
      expect(actionIds).toContain('wc_reject');
      expect(actionIds).toContain('wc_revise');
    });

    it('encodes runId in button values', () => {
      const blocks = buildApprovalBlocks({
        runId: 'run-abc',
        taskName: 'Test',
        schedule: 'once',
        trustLabel: '安定',
        plan: 'Plan text',
      });

      const actions = blocks.find((b: any) => b.type === 'actions');
      for (const el of actions.elements) {
        expect(el.value).toBe('run-abc');
      }
    });
  });

  describe('buildReportBlocks', () => {
    it('includes summary and suggestions', () => {
      const report: ReportData = {
        summary: 'Task completed successfully',
        planDiff: null,
        suggestions: ['Optimize query', 'Add caching'],
      };

      const blocks = buildReportBlocks({
        runId: 'run-2',
        taskName: 'Weekly Summary',
        report,
      });

      const texts = blocks
        .filter((b: any) => b.type === 'section')
        .map((b: any) => b.text?.text ?? '');
      const allText = texts.join('\n');

      expect(allText).toContain('Task completed successfully');
      expect(allText).toContain('Optimize query');
      expect(allText).toContain('Add caching');
    });

    it('includes plan diff section when provided', () => {
      const report: ReportData = {
        summary: 'Done',
        planDiff: 'Skipped step 2 due to timeout',
        suggestions: [],
      };

      const blocks = buildReportBlocks({
        runId: 'run-3',
        taskName: 'Test',
        report,
      });

      const texts = blocks
        .filter((b: any) => b.type === 'section')
        .map((b: any) => b.text?.text ?? '');
      expect(texts.some((t: string) => t.includes('Skipped step 2'))).toBe(true);
    });

    it('has feedback actions with score select and comment button', () => {
      const blocks = buildReportBlocks({
        runId: 'run-4',
        taskName: 'Test',
        report: { summary: 'OK', planDiff: null, suggestions: [] },
      });

      const actions = blocks.find((b: any) => b.type === 'actions');
      expect(actions).toBeDefined();
      const actionIds = actions.elements.map((e: any) => e.action_id);
      expect(actionIds).toContain('wc_feedback_score');
      expect(actionIds).toContain('wc_feedback_comment');
    });
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run src/__tests__/slack-interaction.test.ts`
Expected: FAIL — `Cannot find module`

- [ ] **Step 4: SlackInteraction モジュールを実装**

`src/channels/slack-interaction.ts` を作成:

```typescript
import type { App } from '@slack/bolt';
import type { Logger } from '../logger.js';
import type { ReportData } from '../types.js';

// --- Block Kit builders (pure functions, easy to test) ---

export interface ApprovalBlockInput {
  runId: string;
  taskName: string;
  schedule: string;
  trustLabel: string;
  plan: string;
}

export function buildApprovalBlocks(input: ApprovalBlockInput): any[] {
  return [
    { type: 'header', text: { type: 'plain_text', text: `Task Plan: ${input.taskName}` } },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Schedule:* ${input.schedule}\n*Trust:* ${input.trustLabel}` },
    },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: input.plan } },
    {
      type: 'actions',
      block_id: `wc_approval_${input.runId}`,
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Approve' }, action_id: 'wc_approve', style: 'primary', value: input.runId },
        { type: 'button', text: { type: 'plain_text', text: 'Reject' }, action_id: 'wc_reject', style: 'danger', value: input.runId },
        { type: 'button', text: { type: 'plain_text', text: 'Revise' }, action_id: 'wc_revise', value: input.runId },
      ],
    },
  ];
}

export interface ReportBlockInput {
  runId: string;
  taskName: string;
  report: ReportData;
}

export function buildReportBlocks(input: ReportBlockInput): any[] {
  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: `Execution Report: ${input.taskName}` } },
    { type: 'section', text: { type: 'mrkdwn', text: input.report.summary } },
  ];

  if (input.report.planDiff) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Plan vs Actual*\n${input.report.planDiff}` } });
  }

  if (input.report.suggestions.length > 0) {
    const sugText = input.report.suggestions.map((s) => `• ${s}`).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Suggestions*\n${sugText}` } });
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'actions',
      block_id: `wc_feedback_${input.runId}`,
      elements: [
        {
          type: 'static_select',
          action_id: 'wc_feedback_score',
          placeholder: { type: 'plain_text', text: 'Rate this run' },
          options: [1, 2, 3, 4, 5].map((n) => ({
            text: { type: 'plain_text', text: `${'★'.repeat(n)}${'☆'.repeat(5 - n)}` },
            value: String(n),
          })),
        },
        { type: 'button', text: { type: 'plain_text', text: 'Add Comment' }, action_id: 'wc_feedback_comment', value: input.runId },
      ],
    },
  );

  return blocks;
}

// --- Slack interaction handler ---

export interface LifecycleCallbacks {
  onApprove(runId: string, userId: string): Promise<void>;
  onReject(runId: string, userId: string, reason: string): Promise<void>;
  onRevise(runId: string, userId: string, instruction: string): Promise<void>;
  onFeedbackScore(runId: string, score: number): Promise<void>;
  onFeedbackComment(runId: string, comment: string): Promise<void>;
}

export class SlackInteraction {
  constructor(
    private readonly app: App,
    private readonly logger: Logger,
  ) {}

  registerHandlers(callbacks: LifecycleCallbacks): void {
    this.app.action('wc_approve', async ({ ack, body }) => {
      await ack();
      const runId = (body as any).actions[0].value;
      const userId = body.user.id;
      await callbacks.onApprove(runId, userId);
    });

    this.app.action('wc_reject', async ({ ack, body, client }) => {
      await ack();
      const runId = (body as any).actions[0].value;
      await client.views.open({
        trigger_id: (body as any).trigger_id,
        view: {
          type: 'modal',
          callback_id: 'wc_reject_modal',
          private_metadata: runId,
          title: { type: 'plain_text', text: 'Reject Task' },
          submit: { type: 'plain_text', text: 'Submit' },
          blocks: [
            {
              type: 'input',
              block_id: 'reason_block',
              element: { type: 'plain_text_input', action_id: 'reason_input', multiline: true, placeholder: { type: 'plain_text', text: '却下理由を入力...' } },
              label: { type: 'plain_text', text: '却下理由' },
            },
          ],
        },
      });
    });

    this.app.action('wc_revise', async ({ ack, body, client }) => {
      await ack();
      const runId = (body as any).actions[0].value;
      await client.views.open({
        trigger_id: (body as any).trigger_id,
        view: {
          type: 'modal',
          callback_id: 'wc_revise_modal',
          private_metadata: runId,
          title: { type: 'plain_text', text: 'Revise Plan' },
          submit: { type: 'plain_text', text: 'Submit' },
          blocks: [
            {
              type: 'input',
              block_id: 'instruction_block',
              element: { type: 'plain_text_input', action_id: 'instruction_input', multiline: true, placeholder: { type: 'plain_text', text: '修正指示を入力...' } },
              label: { type: 'plain_text', text: '修正内容' },
            },
          ],
        },
      });
    });

    this.app.action('wc_feedback_score', async ({ ack, body }) => {
      await ack();
      const action = (body as any).actions[0];
      const runId = action.block_id.replace('wc_feedback_', '');
      const score = parseInt(action.selected_option.value, 10);
      await callbacks.onFeedbackScore(runId, score);
    });

    this.app.action('wc_feedback_comment', async ({ ack, body, client }) => {
      await ack();
      const runId = (body as any).actions[0].value;
      await client.views.open({
        trigger_id: (body as any).trigger_id,
        view: {
          type: 'modal',
          callback_id: 'wc_comment_modal',
          private_metadata: runId,
          title: { type: 'plain_text', text: 'Add Comment' },
          submit: { type: 'plain_text', text: 'Submit' },
          blocks: [
            {
              type: 'input',
              block_id: 'comment_block',
              element: { type: 'plain_text_input', action_id: 'comment_input', multiline: true, placeholder: { type: 'plain_text', text: 'コメントを入力...' } },
              label: { type: 'plain_text', text: 'コメント' },
            },
          ],
        },
      });
    });

    // Modal submissions
    this.app.view('wc_reject_modal', async ({ ack, body, view }) => {
      await ack();
      const runId = view.private_metadata;
      const reason = view.state.values.reason_block.reason_input.value ?? '';
      await callbacks.onReject(runId, body.user.id, reason);
    });

    this.app.view('wc_revise_modal', async ({ ack, body, view }) => {
      await ack();
      const runId = view.private_metadata;
      const instruction = view.state.values.instruction_block.instruction_input.value ?? '';
      await callbacks.onRevise(runId, body.user.id, instruction);
    });

    this.app.view('wc_comment_modal', async ({ ack, body, view }) => {
      await ack();
      const runId = view.private_metadata;
      const comment = view.state.values.comment_block.comment_input.value ?? '';
      await callbacks.onFeedbackComment(runId, comment);
    });
  }

  async postApprovalRequest(token: string, channelId: string, runId: string, taskName: string, schedule: string, trustLabel: string, plan: string): Promise<string> {
    const blocks = buildApprovalBlocks({ runId, taskName, schedule, trustLabel, plan });
    const res = await this.app.client.chat.postMessage({ token, channel: channelId, text: `Task Plan: ${taskName}`, blocks });
    return res.ts!;
  }

  async postReport(token: string, channelId: string, runId: string, taskName: string, report: ReportData): Promise<string> {
    const blocks = buildReportBlocks({ runId, taskName, report });
    const res = await this.app.client.chat.postMessage({ token, channel: channelId, text: `Execution Report: ${taskName}`, blocks });
    return res.ts!;
  }

  async updateMessageWithResult(token: string, channelId: string, ts: string, text: string): Promise<void> {
    await this.app.client.chat.update({ token, channel: channelId, ts, text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] });
  }
}
```

- [ ] **Step 5: テストがパスすることを確認**

Run: `npx vitest run src/__tests__/slack-interaction.test.ts`
Expected: 全テスト PASS（Block Kit ビルダーのピュア関数テストのみ）

- [ ] **Step 6: コミット**

```bash
git add src/channels/slack-interaction.ts src/__tests__/slack-interaction.test.ts src/channels/slack.ts
git commit -m "feat: add SlackInteraction module with Block Kit builders and action handlers"
```

---

## Task 5: TaskLifecycleManager 実装

**Files:**
- Create: `src/__tests__/task-lifecycle.test.ts`
- Create: `src/task-lifecycle.ts`

- [ ] **Step 1: テストファイルを作成**

`src/__tests__/task-lifecycle.test.ts` を作成:

```typescript
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
  return {
    enqueue: vi.fn(),
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
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
      db as any,
      queue as any,
      slack as any,
      new TrustScorer(),
      logger as any,
      { slackBotToken: 'xoxb-test', approvalTimeoutMs: 3600000, feedbackTimeoutMs: 86400000 },
    );
  });

  describe('startRun', () => {
    it('creates a task_run record in planning state for required approval_mode', async () => {
      const task = makeTask({ approval_mode: 'required' });
      // Mock the container execution for plan generation
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

      // Should go directly to executing without posting approval
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
      queue.enqueue.mockImplementation(({ onComplete }: any) => {
        onComplete({ status: 'success', result: 'Executed' });
      });

      await manager.handleApproval('run-1', 'U123');

      expect(db.updateTaskRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
        state: 'executing',
        approval_by: 'U123',
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
        state: 'rejected',
        rejection_reason: 'Not ready',
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

      await manager.handleFeedback('run-1', 5, 'Great job');

      expect(db.updateTaskRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
        state: 'completed',
        feedback_score: 5,
        feedback_comment: 'Great job',
      }));
      expect(db.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
        trust_score: expect.any(Number),
      }));
    });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/__tests__/task-lifecycle.test.ts`
Expected: FAIL — `Cannot find module '../task-lifecycle.js'`

- [ ] **Step 3: TaskLifecycleManager を実装**

`src/task-lifecycle.ts` を作成:

```typescript
import { randomUUID } from 'node:crypto';
import type { Database } from './db.js';
import type { GroupQueue } from './group-queue.js';
import type { SlackInteraction } from './channels/slack-interaction.js';
import type { TrustScorer } from './trust-scorer.js';
import type { Logger } from './logger.js';
import type { ScheduledTask, TaskRun, ReportData } from './types.js';

export interface LifecycleConfig {
  slackBotToken: string;
  approvalTimeoutMs: number;   // default: 3600000 (1h)
  feedbackTimeoutMs: number;   // default: 86400000 (24h)
  notifyOnlyDelayMs?: number;  // default: 1800000 (30min)
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
    this.db.createTaskRun(run);

    if (task.approval_mode === 'auto') {
      this.db.updateTaskRun(run.id, { state: 'executing' });
      run.state = 'executing';
      await this.executeTask(run, task);
      return;
    }

    // Generate plan via container
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
      this.config.slackBotToken,
      channelId,
      run.id,
      task.prompt.slice(0, 80),
      `${task.schedule_type}: ${task.schedule_value}`,
      trustLabel,
      run.plan ?? '',
    );

    this.db.updateTaskRun(run.id, { plan_slack_ts: ts, plan_channel_id: channelId });

    // Start timeout
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
        this.config.slackBotToken,
        run.plan_channel_id,
        run.plan_slack_ts,
        `✅ Approved by <@${userId}>`,
      ).catch((e) => this.logger.warn({ runId }, `Failed to update approval message: ${e}`));
    }

    // Find the original task to execute
    const task = this.db.getTask(run.task_id);
    if (task) {
      await this.executeTask(run, task);
    }
  }

  async handleRejection(runId: string, userId: string, reason: string): Promise<void> {
    this.clearTimer(runId);
    const run = this.db.getTaskRun(runId);
    if (!run || run.state !== 'awaiting_approval') return;

    this.db.updateTaskRun(runId, { state: 'rejected', rejection_reason: reason, finished_at: Date.now() });

    if (run.plan_channel_id && run.plan_slack_ts) {
      await this.slack.updateMessageWithResult(
        this.config.slackBotToken,
        run.plan_channel_id,
        run.plan_slack_ts,
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
      // Re-generate plan with revision instruction appended
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

    // Update trust score
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
        true,
        score,
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

        // Log to existing task_run_logs for backwards compat
        const now = new Date().toISOString();
        this.db.logTaskRun({ task_id: task.id, started_at: now, finished_at: now, status: 'success', result: output.result.slice(0, 1000), error: null });

        await this.generateReport(run, task);
      },
      onError: (error) => {
        this.db.updateTaskRun(run.id, { state: 'error', result: error.message, finished_at: Date.now() });
        const now = new Date().toISOString();
        this.db.logTaskRun({ task_id: task.id, started_at: now, finished_at: now, status: 'error', result: null, error: error.message.slice(0, 1000) });
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
      this.config.slackBotToken,
      channelId,
      run.id,
      task.prompt.slice(0, 80),
      report,
    );
    this.db.updateTaskRun(run.id, { report_slack_ts: ts });

    // Feedback timeout
    this.startTimer(run.id, this.config.feedbackTimeoutMs, () => {
      this.logger.info({ runId: run.id }, 'Feedback timed out, completing run');
      this.db.updateTaskRun(run.id, { state: 'completed', finished_at: Date.now() });

      // Still update trust score (no feedback = neutral)
      const updated = this.trustScorer.updateAfterRun(
        { trust_score: task.trust_score, consecutive_successes: task.consecutive_successes, total_positive_feedback: task.total_positive_feedback, total_runs: task.total_runs, approval_mode: task.approval_mode, approval_mode_locked: task.approval_mode_locked },
        true,
        undefined,
      );
      this.db.updateTask(task.id, updated as any);

      // Update next_run for scheduler
      this.db.updateTask(task.id, { last_run: new Date().toISOString(), status: task.schedule_type === 'once' ? 'completed' : 'active' });
    });
  }

  private parseReport(run: TaskRun): ReportData {
    const result = run.result ?? '';
    const plan = run.plan ?? '';

    return {
      summary: result.slice(0, 1000),
      planDiff: plan && result ? `Planned: ${plan.slice(0, 200)}\nActual: ${result.slice(0, 200)}` : null,
      suggestions: [],  // Suggestions are extracted from the agent's output if structured
    };
  }

  async recoverPendingRuns(): Promise<void> {
    const pending = this.db.getTaskRunsByState('awaiting_approval', 'awaiting_feedback');
    for (const run of pending) {
      this.logger.info({ runId: run.id, state: run.state }, 'Recovering pending run');
      // For now, time out stale runs
      const age = Date.now() - run.created_at;
      if (run.state === 'awaiting_approval' && age > this.config.approvalTimeoutMs) {
        this.db.updateTaskRun(run.id, { state: 'rejected', rejection_reason: 'Approval timeout (recovery)', finished_at: Date.now() });
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
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `npx vitest run src/__tests__/task-lifecycle.test.ts`
Expected: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add src/task-lifecycle.ts src/__tests__/task-lifecycle.test.ts
git commit -m "feat: add TaskLifecycleManager with state machine and tests"
```

---

## Task 6: TaskScheduler の接続変更

**Files:**
- Modify: `src/task-scheduler.ts`

- [ ] **Step 1: TaskScheduler にライフサイクルマネージャ連携を追加**

`src/task-scheduler.ts` を変更。コンストラクタにオプショナルな `lifecycleManager` を追加し、存在する場合はそちらに委譲:

```typescript
import { CronExpressionParser } from 'cron-parser';
import type { Database } from './db.js';
import type { GroupQueue } from './group-queue.js';
import type { TaskLifecycleManager } from './task-lifecycle.js';
import type { Logger } from './logger.js';
import type { ScheduledTask } from './types.js';

export class TaskScheduler {
  private lifecycleManager: TaskLifecycleManager | null = null;

  constructor(
    private readonly db: Database,
    private readonly queue: GroupQueue,
    private readonly logger: Logger,
    private readonly timezone: string,
  ) {}

  setLifecycleManager(manager: TaskLifecycleManager): void {
    this.lifecycleManager = manager;
  }

  checkDueTasks(): void {
    const tasks = this.db.getDueTasks();
    for (const task of tasks) {
      this.logger.info({ taskId: task.id, groupFolder: task.group_folder }, 'Executing due task');

      // Update next_run immediately to prevent re-triggering
      this.db.updateTask(task.id, { next_run: this.computeNextRun(task) });

      if (this.lifecycleManager) {
        this.lifecycleManager.startRun(task).catch((err) => {
          this.logger.error({ taskId: task.id }, `Lifecycle start failed: ${(err as Error).message}`);
        });
        continue;
      }

      // Fallback: direct execution (original behavior)
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
          const now = new Date().toISOString();
          this.db.logTaskRun({ task_id: task.id, started_at: now, finished_at: now, status: 'success', result: output.result.slice(0, 1000), error: null });
          this.db.updateTask(task.id, {
            last_run: now,
            last_result: output.result.slice(0, 1000),
            status: task.schedule_type === 'once' ? 'completed' : 'active',
          });
        },
        onError: (error) => {
          const now = new Date().toISOString();
          this.db.logTaskRun({ task_id: task.id, started_at: now, finished_at: now, status: 'error', result: null, error: error.message.slice(0, 1000) });
          this.db.updateTask(task.id, { last_run: now });
        },
      });
    }
  }

  // createTask, pauseTask, resumeTask, cancelTask, computeNextRun は変更なし

  updateTask(taskId: string, updates: Partial<ScheduledTask>): void {
    // prompt/script 変更時は信頼スコアをリセット
    if (updates.prompt !== undefined || updates.script !== undefined) {
      this.db.updateTask(taskId, {
        trust_score: 0,
        consecutive_successes: 0,
        total_positive_feedback: 0,
        total_runs: 0,
        approval_mode: 'required',
      } as any);
      this.logger.info({ taskId }, 'Trust score reset due to prompt/script change');
    }
    this.db.updateTask(taskId, updates);
    this.logger.info({ taskId }, 'Task updated');
  }
}
```

主な変更点:
- `import type { TaskLifecycleManager }` を追加
- `lifecycleManager` プロパティとセッターを追加
- `checkDueTasks` 内で `lifecycleManager` があれば `startRun` に委譲
- `next_run` をループ先頭で更新して再トリガー防止

- [ ] **Step 2: ビルドが通ることを確認**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 既存テストがパスすることを確認**

Run: `npx vitest run`
Expected: 全テスト PASS

- [ ] **Step 4: コミット**

```bash
git add src/task-scheduler.ts
git commit -m "feat(scheduler): delegate to TaskLifecycleManager when available"
```

---

## Task 7: index.ts の配線

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: 新コンポーネントの import と初期化を追加**

`src/index.ts` に以下を追加:

import セクション（L1-15付近）に追加:
```typescript
import { TrustScorer } from './trust-scorer.js';
import { TaskLifecycleManager } from './task-lifecycle.js';
import { SlackInteraction } from './channels/slack-interaction.js';
import type { SlackChannel } from './channels/slack.js';
```

コンポーネント初期化セクション（L40: `const scheduler = ...` の後）に追加:

```typescript
  // 2b. Initialize lifecycle components
  const trustScorer = new TrustScorer();

  // Find Slack channel for interaction features
  const slackChannel = registry.getAll().find((c) => c.name === 'slack') as SlackChannel | undefined;
  let lifecycleManager: TaskLifecycleManager | null = null;

  if (slackChannel) {
    const slackInteraction = new SlackInteraction(slackChannel.getApp(), logger);
    lifecycleManager = new TaskLifecycleManager(db, queue, slackInteraction, trustScorer, logger, {
      slackBotToken: config.slackBotToken!,
      approvalTimeoutMs: 3600000,
      feedbackTimeoutMs: 86400000,
    });
    scheduler.setLifecycleManager(lifecycleManager);

    // Register Slack action handlers
    slackInteraction.registerHandlers({
      onApprove: (runId, userId) => lifecycleManager!.handleApproval(runId, userId),
      onReject: (runId, userId, reason) => lifecycleManager!.handleRejection(runId, userId, reason),
      onRevise: (runId, userId, instruction) => lifecycleManager!.handleRevisionRequest(runId, userId, instruction),
      onFeedbackScore: (runId, score) => lifecycleManager!.handleFeedback(runId, score),
      onFeedbackComment: (runId, comment) => lifecycleManager!.handleFeedback(runId, 0, comment),
    });

    logger.info({}, 'Task lifecycle manager initialized with Slack interaction');
  }
```

チャンネル接続後（`await registry.connectAll()` の後）に追加:

```typescript
  // Recover any pending runs from previous session
  if (lifecycleManager) {
    await lifecycleManager.recoverPendingRuns();
  }
```

shutdown セクションに追加:

```typescript
    if (lifecycleManager) lifecycleManager.shutdown();
```

注意: `registry.initialize()` と `registry.connectAll()` の間にライフサイクルマネージャの初期化を入れる必要がある。`registry.initialize()` で Slack チャネルが生成された後に `getAll()` でアクセスできるため、L47 の `registry.initialize(...)` の直後に配置する。

- [ ] **Step 2: ビルドが通ることを確認**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/index.ts
git commit -m "feat: wire TaskLifecycleManager into application bootstrap"
```

---

## Task 8: 全体テスト・型チェック

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェック**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: 全テスト実行**

Run: `npx vitest run`
Expected: 全テスト PASS

- [ ] **Step 3: リント**

Run: `npm run lint`
Expected: PASS (or only pre-existing warnings)

- [ ] **Step 4: 最終コミット（必要な場合のみ）**

lint やテスト修正が必要であれば修正してコミット:

```bash
git add -A
git commit -m "fix: resolve lint and type errors in task lifecycle feature"
```

---

## Task 9: GitHub イシュー作成

**Files:** なし

- [ ] **Step 1: feature ラベルを作成**

```bash
gh label create feature --color 0E8A16 --description "New feature" --repo yoshidashingo/warsclaw
```

- [ ] **Step 2: イシューを作成**

```bash
gh issue create --repo yoshidashingo/warsclaw \
  --title "feat: AI-DLC タスクライフサイクル管理（計画承認・レポート・フィードバック・適応的ふりかえり）" \
  --label "feature,enhancement" \
  --body "$(cat docs/superpowers/specs/2026-04-04-task-lifecycle-design.md)"
```

- [ ] **Step 3: イシュー番号を確認**

作成されたイシュー番号をメモし、今後のコミットで参照。
