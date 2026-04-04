# WarsClaw - Personal AI Agent

## Project Overview
WarsClaw は Discord/Slack から Claude Code CLI を通じて AI アシスタントと対話できるパーソナルエージェント。
グループ単位の会話コンテキスト隔離、スケジュールタスク自動実行に対応。

## Tech Stack
- **Language:** TypeScript (ES2022, Node16 modules)
- **Runtime:** Node.js >= 22.0.0
- **Database:** SQLite (better-sqlite3, WAL mode)
- **Testing:** Vitest + fast-check (property-based)
- **Channels:** Discord.js, @slack/bolt (Socket Mode)
- **Container:** Docker (エージェント実行を隔離)
- **Validation:** Zod

## Commands
```bash
npm run build      # TypeScript コンパイル (tsc)
npm run dev        # 開発モード (tsx watch)
npm start          # 本番実行
npm test           # テスト実行 (vitest run)
npm run test:watch # テスト監視モード
npm run typecheck  # 型チェックのみ
npm run lint       # ESLint
npm run format     # Prettier
```

## Architecture
```
Discord/Slack → Polling Loop → Group Queue → Docker Container → Claude Code CLI
                                    ↑                                    ↓
                            Task Scheduler              IPC (filesystem JSON)
                                    ↑                                    ↓
                                SQLite ←──────────── Response Router ←───┘
```

### Key Components
| File | Role |
|------|------|
| `src/index.ts` | エントリポイント、全コンポーネント初期化 |
| `src/config.ts` | 環境変数からの設定読み込み (.env 対応) |
| `src/db.ts` | SQLite DB (messages, groups, tasks, sessions, router_state) |
| `src/router.ts` | メッセージの XML フォーマットと送信ルーティング |
| `src/group-queue.ts` | グループ単位のジョブキュー (並行数制限、リトライ) |
| `src/container-runner.ts` | Docker コンテナでの Claude Code CLI 実行 |
| `src/task-scheduler.ts` | cron/interval/once のスケジュールタスク |
| `src/ipc.ts` | ファイルベース IPC (messages/, tasks/) |
| `src/channels/` | Discord/Slack チャネル実装 + レジストリ |
| `src/skills/loader.ts` | スキルシステム (skills/ ディレクトリ) |
| `src/types.ts` | 型定義 + Zod スキーマ |
| `src/logger.ts` | JSON ログ (シークレット自動マスク) |

### Container Agent
- `container/Dockerfile` — Chromium + Claude Code CLI 入りのエージェントイメージ
- `container/agent-runner/src/index.ts` — stdin から入力を受け、Claude CLI を実行し、マーカー付き stdout で結果を返す
- 出力マーカー: `<<<OUTPUT_START>>>` / `<<<OUTPUT_END>>>`

### Groups
- `groups/main/CLAUDE.md` — 管理者グループ用指示
- `groups/global/CLAUDE.md` — 全グループ共通指示 (IPC フォーマット等)

## Conventions
- テストは `src/__tests__/` に配置、`*.test.ts` 命名
- JID 形式: `discord_{channelId}`, `slack_{channelId}`
- IPC ファイル: JSON 形式で `ipc/messages/` or `ipc/tasks/` に書き込み
- グループフォルダ名: 英数字・ハイフン・アンダースコアのみ (予約名: main, global)
- ログは構造化 JSON (stdout=info以下, stderr=error)
