# AI-DLC タスクライフサイクル管理機能 設計書

**日付:** 2026-04-04
**ステータス:** Draft
**対象:** WarsClaw - Slack タスク実行ライフサイクル

## 概要

スケジュールタスクの実行に「計画→承認→実行→レポート→フィードバック」のライフサイクルを導入する。信頼スコアに基づいて承認やレポートの粒度を適応的に調整し、繰り返し成功するタスクのふりかえりを段階的に削減する。

## 要件

1. タスク実行前にエージェントが「実行計画」を生成し、Slack Block Kit で承認を求める
2. 実行後に結果サマリー + 改善提案 + 計画との差分をレポートとして投稿
3. ユーザーが1-5のスコアとコメントでフィードバックを返せる
4. 成功回数とフィードバック評価のハイブリッドで信頼スコアを算出
5. 信頼スコアに応じて承認フロー・レポート粒度を段階的に簡略化
6. Slack Block Kit (ボタン・セレクト・モーダル) によるリッチUI
7. チャンネルメンバー全員が承認・フィードバック可能

## アーキテクチャ

### アプローチ: 独立ライフサイクルマネージャ型

既存の `TaskScheduler` はスケジュール管理（いつ実行するか）に専念し、新設の `TaskLifecycleManager` がライフサイクル制御（どう進めるか）を担う。

```
TaskScheduler (いつ実行するか)
    ↓ タスクdue時にコールバック
TaskLifecycleManager (どう進めるか)
    ├── ContainerRunner (計画生成 / 本実行)
    ├── SlackInteraction (Block Kit 投稿 / アクション受信)
    ├── TrustScorer (信頼スコア算出)
    └── Database (task_runs 管理)
```

### ステートマシン

```
scheduled (スケジューラ管理)
    ↓ タスクdue時
planning → awaiting_approval → executing → reporting → awaiting_feedback → completed
    ↓           ↓                  ↓                                          ↓
  error      rejected           error                                    (次サイクルへ)
```

| ステート | 説明 |
|----------|------|
| `planning` | コンテナに計画生成プロンプトを送信中 |
| `awaiting_approval` | Slack に Block Kit で計画を投稿、承認待ち |
| `rejected` | ユーザーが却下。理由をDBに記録し、次回の計画生成に反映 |
| `executing` | 承認済み、コンテナで本実行中 |
| `reporting` | 実行結果からレポート + 改善提案を生成中 |
| `awaiting_feedback` | Slack にレポート投稿、フィードバック待ち |
| `completed` | フィードバック受領 or タイムアウトで完了 |
| `error` | planning または executing でエラー発生 |

## データモデル

### 新テーブル: `task_runs`

| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT PK | UUID |
| task_id | TEXT FK | scheduled_tasks.id |
| state | TEXT NOT NULL | 現在のステート |
| plan | TEXT | エージェントが生成した実行計画 |
| plan_slack_ts | TEXT | 計画メッセージの Slack ts（ボタン紐付け用）|
| plan_channel_id | TEXT | 計画メッセージの Slack channel ID |
| approval_by | TEXT | 承認者の Slack user ID |
| approval_at | INTEGER | 承認タイムスタンプ (ms) |
| rejection_reason | TEXT | 却下理由 |
| result | TEXT | 実行結果 |
| report | TEXT | 生成されたレポート |
| report_slack_ts | TEXT | レポートメッセージの Slack ts |
| feedback_score | INTEGER | 1-5 評価 |
| feedback_comment | TEXT | 自由記述フィードバック |
| started_at | INTEGER NOT NULL | 実行開始時刻 (ms) |
| finished_at | INTEGER | 完了時刻 (ms) |
| created_at | INTEGER NOT NULL | レコード作成時刻 (ms) |

インデックス: `idx_task_runs_task_id`, `idx_task_runs_state`

### `scheduled_tasks` への追加カラム

| カラム | 型 | 説明 |
|--------|-----|------|
| trust_score | REAL DEFAULT 0.0 | 信頼スコア (0.0 - 1.0) |
| consecutive_successes | INTEGER DEFAULT 0 | 連続成功数 |
| total_positive_feedback | INTEGER DEFAULT 0 | 累計ポジティブ評価数 |
| total_runs | INTEGER DEFAULT 0 | 累計実行数 |
| approval_mode | TEXT DEFAULT 'required' | 'required' / 'auto' / 'notify_only' |
| approval_mode_locked | INTEGER DEFAULT 0 | 1ならユーザー手動設定、信頼スコアによる自動変更を抑止 |

## コンポーネント設計

### TaskLifecycleManager (`src/task-lifecycle.ts`)

```typescript
class TaskLifecycleManager {
  constructor(
    private db: Database,
    private groupQueue: GroupQueue,
    private slackInteraction: SlackInteraction,
    private trustScorer: TrustScorer,
    private logger: Logger,
  ) {}

  // スケジューラから呼ばれるエントリポイント
  async startRun(task: ScheduledTask): Promise<void>

  // 各ステート遷移
  private async generatePlan(run: TaskRun): Promise<void>
  private async requestApproval(run: TaskRun): Promise<void>
  private async execute(run: TaskRun): Promise<void>
  private async generateReport(run: TaskRun): Promise<void>
  private async requestFeedback(run: TaskRun): Promise<void>
  private async completeRun(run: TaskRun): Promise<void>

  // Slack アクションから呼ばれるコールバック
  async handleApproval(runId: string, userId: string): Promise<void>
  async handleRejection(runId: string, userId: string, reason: string): Promise<void>
  async handleRevisionRequest(runId: string, userId: string, instruction: string): Promise<void>
  async handleFeedback(runId: string, score: number, comment?: string): Promise<void>

  // 信頼スコアによるスキップ判定
  private shouldSkipApproval(task: ScheduledTask): boolean
  private shouldSimplifyReport(task: ScheduledTask): boolean

  // プロセス再起動時の復元
  async recoverPendingRuns(): Promise<void>
}
```

#### startRun フロー

1. `task_runs` に新レコードを `planning` ステートで作成
2. `shouldSkipApproval(task)` を確認
   - `auto`: 計画生成をスキップし、直接 `executing` へ
   - `notify_only`: 計画を生成し Slack に通知、30分タイマー開始
   - `required`: 計画を生成し Slack に承認ボタン付きで投稿
3. 計画生成はコンテナに専用プロンプトを送信:
   ```
   以下のタスクの実行計画を作成してください。実行は行わないでください。
   タスク: {task.prompt}
   前回の結果: {lastRun.result}
   前回のフィードバック: {lastRun.feedback_comment}
   ```

#### スケジューラとの接続

`TaskScheduler.checkDueTasks()` の変更:

- **変更前**: `groupQueue.enqueue(containerInput)` を直接呼び出し
- **変更後**: `lifecycleManager.startRun(task)` を呼び出し

`startRun` 内部で信頼スコアを確認し、承認が必要ならSlackに投稿して待機、不要なら内部で `groupQueue.enqueue()` に渡す。

#### 非同期フローの管理

- `task_runs.state` をDBに永続化し、プロセス再起動後も `recoverPendingRuns()` で復元
- タイムアウト: 承認は1時間（設定可能）、フィードバックは24時間。超過したら自動進行
- `notify_only` モード: 30分以内に却下がなければ自動実行

### TrustScorer (`src/trust-scorer.ts`)

```typescript
class TrustScorer {
  calculate(task: ScheduledTask): number {
    const successRate = task.consecutive_successes / Math.max(task.total_runs, 1)
    const feedbackRate = task.total_positive_feedback / Math.max(task.total_runs, 1)
    const streakBonus = Math.min(task.consecutive_successes / 10, 1.0)

    // 重み: 成功率 40%, フィードバック率 40%, 連続成功ボーナス 20%
    return successRate * 0.4 + feedbackRate * 0.4 + streakBonus * 0.2
  }

  updateAfterRun(task: ScheduledTask, success: boolean, feedbackScore?: number): TaskTrustUpdate {
    const update = { ...currentValues }

    if (success) {
      update.consecutive_successes += 1
    } else {
      update.consecutive_successes = 0
    }

    update.total_runs += 1

    if (feedbackScore !== undefined && feedbackScore >= 4) {
      update.total_positive_feedback += 1
    }

    update.trust_score = this.calculate(update)
    update.approval_mode = this.determineApprovalMode(update.trust_score)

    return update
  }

  private determineApprovalMode(score: number): ApprovalMode {
    if (score >= 0.8) return 'auto'
    if (score >= 0.5) return 'notify_only'
    return 'required'
  }
}
```

#### 適応レベル

| trust_score | approval_mode | レポート粒度 | ラベル |
|-------------|--------------|-------------|--------|
| 0.0 - 0.5 | `required` | 詳細（結果 + 改善提案 + 計画差分） | 学習中 |
| 0.5 - 0.8 | `notify_only` | 標準（結果 + 改善提案） | 安定 |
| 0.8 - 1.0 | `auto` | 簡略（結果サマリーのみ） | 信頼済み |

#### 信頼リセット条件

- タスクの `prompt` または `script` が変更された → trust_score を 0.0 にリセット
- 3回連続で低評価（スコア2以下） → `required` に強制ダウングレード
- ユーザーが手動で `approval_mode` を変更した場合、`approval_mode_locked = 1` にセットし信頼スコアによる自動変更を抑止

### SlackInteraction (`src/channels/slack-interaction.ts`)

Slack 固有のインタラクション機能を分離したモジュール。`Channel` インターフェースには影響しない。

```typescript
class SlackInteraction {
  constructor(
    private app: SlackApp,
    private lifecycleManager: TaskLifecycleManager,
    private logger: Logger,
  ) {}

  // Block Kit メッセージ投稿
  async postApprovalRequest(channelId: string, run: TaskRun, plan: string): Promise<string>
  async postReport(channelId: string, run: TaskRun, report: ReportData): Promise<string>
  async updateMessageAfterAction(channelId: string, ts: string, newBlocks: Block[]): Promise<void>

  // アクションハンドラ登録（app起動時に呼ばれる）
  registerHandlers(): void
}
```

#### Block Kit メッセージ

**計画承認メッセージ:**

```json
{
  "blocks": [
    { "type": "header", "text": { "type": "plain_text", "text": "Task Plan: <タスク名>" } },
    { "type": "section", "text": { "type": "mrkdwn", "text": "Schedule: <cron式等>\nTrust: <信頼レベル>" } },
    { "type": "divider" },
    { "type": "section", "text": { "type": "mrkdwn", "text": "<実行計画本文>" } },
    { "type": "actions", "block_id": "wc_approval_<runId>", "elements": [
      { "type": "button", "text": { "type": "plain_text", "text": "Approve" }, "action_id": "wc_approve", "style": "primary", "value": "<runId>" },
      { "type": "button", "text": { "type": "plain_text", "text": "Reject" }, "action_id": "wc_reject", "style": "danger", "value": "<runId>" },
      { "type": "button", "text": { "type": "plain_text", "text": "Revise" }, "action_id": "wc_revise", "value": "<runId>" }
    ] }
  ]
}
```

**レポート + フィードバックメッセージ:**

```json
{
  "blocks": [
    { "type": "header", "text": { "type": "plain_text", "text": "Execution Report: <タスク名>" } },
    { "type": "section", "text": { "type": "mrkdwn", "text": "<結果サマリー>" } },
    { "type": "section", "text": { "type": "mrkdwn", "text": "*Plan vs Actual*\n<差分>" } },
    { "type": "section", "text": { "type": "mrkdwn", "text": "*Suggestions*\n<改善点リスト>" } },
    { "type": "divider" },
    { "type": "actions", "block_id": "wc_feedback_<runId>", "elements": [
      { "type": "static_select", "action_id": "wc_feedback_score", "placeholder": { "type": "plain_text", "text": "Rate this run" },
        "options": [
          { "text": { "type": "plain_text", "text": "1" }, "value": "1" },
          { "text": { "type": "plain_text", "text": "2" }, "value": "2" },
          { "text": { "type": "plain_text", "text": "3" }, "value": "3" },
          { "text": { "type": "plain_text", "text": "4" }, "value": "4" },
          { "text": { "type": "plain_text", "text": "5" }, "value": "5" }
        ] },
      { "type": "button", "text": { "type": "plain_text", "text": "Add Comment" }, "action_id": "wc_feedback_comment", "value": "<runId>" }
    ] }
  ]
}
```

**アクション後の更新:** 承認/却下/フィードバック後、元メッセージのボタンを無効化し、誰がいつアクションしたかを表示に追加。

#### モーダル

- **却下モーダル** (`wc_reject_modal`): テキスト入力1つ（却下理由）
- **修正依頼モーダル** (`wc_revise_modal`): テキスト入力1つ（修正指示）
- **コメントモーダル** (`wc_comment_modal`): テキスト入力1つ（フリーコメント）

## ファイル構成

| ファイル | 新規/変更 | 内容 |
|---------|----------|------|
| `src/task-lifecycle.ts` | 新規 | TaskLifecycleManager |
| `src/trust-scorer.ts` | 新規 | TrustScorer |
| `src/channels/slack-interaction.ts` | 新規 | SlackInteraction (Block Kit + モーダル) |
| `src/task-scheduler.ts` | 変更 | `startRun` への委譲 |
| `src/db.ts` | 変更 | `task_runs` テーブル追加、`scheduled_tasks` カラム追加 |
| `src/types.ts` | 変更 | TaskRun, ApprovalMode, ReportData 型追加 |
| `src/index.ts` | 変更 | TaskLifecycleManager の初期化と接続 |
| `src/channels/slack.ts` | 変更 | SlackInteraction への app インスタンス共有 |
| `src/__tests__/task-lifecycle.test.ts` | 新規 | ライフサイクルマネージャのユニットテスト |
| `src/__tests__/trust-scorer.test.ts` | 新規 | 信頼スコア算出のユニットテスト |

## エラーハンドリング

- **計画生成失敗**: `error` ステートに遷移、Slackにエラー通知、タスク自体は `active` のまま次回実行に備える
- **実行失敗**: `error` ステートに遷移、エラー内容をレポートに含めてフィードバック要求（何が悪かったか知るため）
- **Slack API エラー**: リトライ (3回, exponential backoff)、全て失敗したらログに記録して `auto` モードで続行
- **タイムアウト**: 承認タイムアウト(1h) → 自動却下してログ記録、フィードバックタイムアウト(24h) → スコアなしで完了

## テスト方針

- **TrustScorer**: プロパティベーステスト (fast-check) でスコア範囲 [0,1] の保証、境界値テスト
- **TaskLifecycleManager**: 各ステート遷移のユニットテスト、DB・Slack をモック
- **SlackInteraction**: Block Kit メッセージ構造の検証、アクションハンドラのコールバック検証
- **統合テスト**: スケジューラ → ライフサイクル → 完了の一連フロー（Slack はモック）
