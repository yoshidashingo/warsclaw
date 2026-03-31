# MyClaw

世界でもっとも小さい [OpenClaw](https://github.com/pjasicek/OpenClaw) / [NanoClaw](https://github.com/nicabar/NanoClaw) クローン。

**[English README](README.md)**

MyClaw は永続稼働する自律オペレーターエージェントです。Slackチャンネルを常時監視し、マウントしたリポジトリを作業スペースとして、**ルール策定→実行→振り返り→提案・理解深化**の自律ループを回し続けます。

チャットボットではありません。自ら考え、ルールを作り、実行し、振り返り、理解を深め続ける — 永遠に動き続けるオペレーターです。

## 動作の仕組み

```
                    ┌─────────────────────────────────────────┐
                    │          自律ループ（永続稼働）            │
                    │                                         │
                    │   playbook.md ──→ 実行 ──→ 振り返り      │
                    │        ↑                      ↓         │
                    │      提案 ←── knowledge.md ←──┘         │
                    └────────────────────┬────────────────────┘
                                        │
Slack ←→ ポーリング ←→ グループキュー ←→ Dockerコンテナ ←→ /workspace/repo
              ↑                                              ↓
       タスクスケジューラ (cron)                        action-log.md
              ↑                                     retrospective.md
           SQLite                                    knowledge.md
```

### 自律ループの4フェーズ

1. **ルール策定 (Rule)** — 作業ルール・手順を `playbook.md` に定義・更新。振り返りから生まれたルールを蓄積。
2. **実行 (Execute)** — playbook のルールに基づいて作業を実行。Slackからの人間の指示も受け取る。すべての行動を `action-log.md` に記録。
3. **振り返り (Reflect)** — 実行結果を分析し、`retrospective.md` に Keep / Problem / Try を記録。パターンや傾向を特定。
4. **提案・理解深化 (Propose & Learn)** — 改善案をSlackで提案。承認されたらplaybookルールを更新。ドメイン知識を `knowledge.md` に蓄積。

### 初回起動時に自動登録される定期タスク

| スケジュール | タスク |
|------------|--------|
| 平日 9:00 | 朝のオペレーション開始 — playbook確認、中断作業の継続 |
| 平日 18:00 | 日次振り返り — Keep/Problem/Try 分析 |
| 金曜 17:00 | 週次まとめ — パターン特定、改善提案 |
| 月曜 10:00 | playbook棚卸し — 形骸化ルールの削除、不足ルールの追加 |

## 特徴

- **~2000行**の極小コードベース（世界最小のOpenClaw/NanoClawクローン）
- **永続稼働する自律オペレーター** — 起動したら永遠に改善ループを回し続ける
- **Slackチャンネル常時監視** — 人間の指示をリアルタイムで受け取り作業
- **リポジトリを作業スペースとしてマウント** — 実際のコードベースで直接作業
- **行動ログの自動記録** — すべての行動を `action-log.md` に記録
- **振り返り（レトロスペクティブ）** — 作業後にKeep/Problem/Tryを自動分析
- **playbook駆動** — 経験から進化する自己管理型ルール集
- **Claude Code CLI** をエージェントランタイムとして使用（Dockerコンテナ内で実行）
- **グループ単位の隔離** — Slackチャンネルごとに独立したコンテキスト・メモリ・ファイル
- **SQLite** による軽量状態管理（自動保持期間ポリシー付き）

## クイックスタート

### 前提条件

- Node.js 22+
- Docker
- Slack Botトークン（[こちらで作成](https://api.slack.com/apps)）
- Anthropic APIキー

### セットアップ

```bash
# 1. クローンと設定
git clone <repo> && cd myclaw
cp .env.example .env
```

`.env` を編集:
```bash
ANTHROPIC_API_KEY=sk-ant-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
MYCLAW_WORKSPACE_DIR=/path/to/your/repo   # MyClawが作業するリポジトリ
MYCLAW_TIMEZONE=Asia/Tokyo                 # タイムゾーン
```

```bash
# 2. インストールとビルド
npm install
npm run build

# 3. エージェントコンテナイメージのビルド
docker build -t myclaw-agent -f container/Dockerfile container/

# 4. 起動
npm start
```

### Docker Compose

```bash
docker compose up -d --build
```

## 環境変数

| 変数 | 必須 | デフォルト | 説明 |
|------|------|-----------|------|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic APIキー |
| `SLACK_BOT_TOKEN` | Yes | — | Slack Botトークン |
| `SLACK_APP_TOKEN` | Yes | — | Slackアプリレベルトークン (Socket Mode) |
| `MYCLAW_WORKSPACE_DIR` | Yes | — | 作業対象リポジトリのパス |
| `DISCORD_BOT_TOKEN` | No | — | Discord Botトークン（Discord使用時） |
| `MYCLAW_POLLING_INTERVAL` | No | `2000` | メッセージポーリング間隔 (ms) |
| `MYCLAW_MAX_CONTAINERS` | No | `5` | 最大同時実行コンテナ数 |
| `MYCLAW_TIMEZONE` | No | `UTC` | IANAタイムゾーン |
| `MYCLAW_ASSISTANT_NAME` | No | `MyClaw` | Bot表示名 |
| `MYCLAW_LOG_LEVEL` | No | `info` | ログレベル (debug/info/warn/error) |

## アーキテクチャ

### コンポーネント構成 (~1250行)

| コンポーネント | ファイル | 役割 |
|-------------|---------|------|
| Orchestrator | `src/index.ts` | メインループ、初期化、グレースフルシャットダウン |
| Config | `src/config.ts` | 環境設定 |
| Logger | `src/logger.ts` | JSON構造化ログ、シークレットマスキング |
| Database | `src/db.ts` | SQLite WAL — メッセージ、タスク、セッション、グループ |
| Router | `src/router.ts` | メッセージフォーマットとチャネルルーティング |
| ContainerRunner | `src/container-runner.ts` | Dockerコンテナライフサイクル、マーカーベース出力パース |
| GroupQueue | `src/group-queue.ts` | グループ単位FIFOキュー、グローバル並行制限 |
| IpcWatcher | `src/ipc.ts` | ファイルシステムIPC監視 |
| TaskScheduler | `src/task-scheduler.ts` | cron/interval/once スケジュール管理 |
| ChannelRegistry | `src/channels/registry.ts` | チャネルファクトリパターン |
| DiscordChannel | `src/channels/discord.ts` | Discord統合 |
| SlackChannel | `src/channels/slack.ts` | Slack統合 |
| SkillLoader | `src/skills/loader.ts` | ファイルベースのスキルシステム |

### データフロー

1. **Slackメッセージ** → ポーリングループが新着メッセージを検出
2. **グループマッチング** → JIDに基づいて登録済みグループにマッチ
3. **キュー** → グループ単位FIFOにエンキュー（最大5コンテナ並行）
4. **コンテナ** → Claude Code CLI入りDockerコンテナを起動
5. **作業スペース** → エージェントが `/workspace/repo`（マウント済みリポ）で作業
6. **レスポンス** → マーカーで出力をパース、Slackにルーティング
7. **IPC** → エージェントはファイルシステムJSON経由でフォローアップメッセージやタスク作成が可能

### ファイル管理（グループごと）

```
groups/{グループ名}/
├── playbook.md        # 自己管理型の作業ルール集
├── action-log.md      # 時系列の行動記録
├── retrospective.md   # Keep/Problem/Try 分析
└── knowledge.md       # 蓄積されたドメイン知識
```

### セキュリティ

- エージェントコンテナは `--rm` で自動クリーンアップ
- プロジェクトルートは読み取り専用マウント、グループフォルダのみ書き込み可能
- `.env` はコンテナ内で `/dev/null` にシャドウイング
- Zodスキーマで全IPC入力をバリデーション
- SQLフィールドホワイトリストでインジェクション防止
- コンテナごとのメモリ・CPU制限 (512MB / 1 CPU)

## 開発

```bash
npm run dev          # tsx ウォッチモード
npm run test         # テスト実行 (Vitest + fast-check PBT)
npm run typecheck    # TypeScript strict mode チェック
npm run lint         # ESLint
npm run format       # Prettier
```

## 参考プロジェクト

- [OpenClaw](https://github.com/pjasicek/OpenClaw) — フル機能のオープンソースパーソナルエージェント（23以上のチャネル、92以上のプラグイン）
- [NanoClaw](https://github.com/nicabar/NanoClaw) — OpenClawの軽量版クローン（Docker隔離）

MyClaw は両プロジェクトのベストパターン — NanoClawのポーリングアーキテクチャとDocker隔離、OpenClawのチャネルプラグインコントラクト — を取り込み、~2000行に凝縮しています。

## ライセンス

TBD
