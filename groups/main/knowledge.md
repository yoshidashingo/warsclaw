# Knowledge Base

WarsClaw が学んだドメイン知識・技術知識の蓄積。

---

## コードベース概要（2026-04-05 初回調査）

### アーキテクチャ
WarsClaw は4層構成の自律エージェントシステム（TypeScript, ~2000行）:

1. **オーケストレーション層** (`src/index.ts`) — イベントポーリング、メッセージルーティング、タスクスケジューリング
2. **状態管理層** (`src/db.ts`) — SQLite (WAL mode) でメッセージ履歴、タスク状態、グループ設定を管理
3. **実行層** (`src/container-runner.ts`, `container/agent-runner/`) — Docker エフェメラルコンテナで Claude Code CLI を実行
4. **通信層** (`src/channels/`, `src/ipc.ts`) — Slack/Discord マルチチャンネル + ファイルシステムベース IPC

### 主要モジュール
| ファイル | 役割 | 行数 |
|---------|------|------|
| `index.ts` | メインループ・初期化 | 272 |
| `db.ts` | SQLite ラッパー（7テーブル） | 290 |
| `container-runner.ts` | Docker コンテナライフサイクル | 160 |
| `group-queue.ts` | グループ別FIFOキュー（最大5並列） | 114 |
| `ipc.ts` | ファイルベース IPC（message/task/error） | 192 |
| `task-scheduler.ts` | cron/interval/once スケジューリング | 125 |
| `task-lifecycle.ts` | 承認ワークフロー（planning→approval→executing→reporting→feedback→completed） | 334 |
| `trust-scorer.ts` | 信頼スコア計算（成功率×0.4 + フィードバック率×0.4 + 連続成功ボーナス×0.2） | 54 |
| `types.ts` | Zod スキーマ + TypeScript 型定義 | 253 |

### セキュリティ設計
- コンテナ: `--network=none`, `--cap-drop=ALL`, メモリ512MB制限
- パス走査防止: `SafeFolderSchema` で英数字+ハイフン+アンダースコアのみ
- SQL インジェクション防止: フィールドホワイトリスト + パラメータ化クエリ
- シークレットマスキング: ログ内のAPIキー・トークンを自動マスク
- IPC認可: 管理操作は main グループのみ

### 自律スケジュール（初期設定）
- 平日 9:00 — 朝のオペレーション開始
- 平日 18:00 — 日次振り返り
- 金曜 17:00 — 週次まとめ
- 月曜 10:00 — playbook 見直し

### テスト
- Vitest + fast-check（プロパティベーステスト）
- 35+ テストケース: db, container-runner, group-queue, task-scheduler, task-lifecycle, trust-scorer, slack-interaction, security, validation, logger

### Slack ワークスペース
- generative-agents ワークスペースで運用
- オーナー: Shingo YOSHIDA (`U06JFJ21USK`)
- WarsClaw 専用チャンネル: 未作成（現在はオーナーへのDMで運用）
