# MyClaw

世界でもっとも小さい [OpenClaw](https://github.com/pjasicek/OpenClaw) / [NanoClaw](https://github.com/nicabar/NanoClaw) クローン。

AI-DLC（AI-Driven Learning from Code）を活用し、既存実装のリバースエンジニアリングから良い点を取り込みつつ、ミニマルな実装を目指します。

## 概要

MyClaw はパーソナルエージェントです。Discord と Slack から Claude Code を通じて AI アシスタントと対話できます。グループごとに会話コンテキストを隔離し、スケジュールタスクの自動実行にも対応します。

## 特徴

- ~2000行の極小コードベース
- Claude Code CLI をエージェントランタイムとして使用
- Docker コンテナでエージェント実行を完全隔離
- Discord + Slack チャネル対応（スキルで拡張可能）
- グループ単位の会話コンテキスト隔離
- cron / interval / once のスケジュールタスク
- Web検索 + Chromium ブラウザ自動化
- ファイルベースのスキルシステム
- SQLite による軽量状態管理

## Quick Start

```bash
# 1. Clone and configure
git clone <repo> && cd myclaw
cp .env.example .env
# Edit .env with your API keys

# 2. Install and build
npm install
npm run build

# 3. Build agent container image
docker build -t myclaw-agent -f container/Dockerfile container/

# 4. Start
npm start
```

### Docker Compose

```bash
docker compose up -d --build
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `DISCORD_BOT_TOKEN` | If Discord | Discord bot token |
| `SLACK_BOT_TOKEN` | If Slack | Slack bot token |
| `SLACK_APP_TOKEN` | If Slack | Slack app-level token |
| `MYCLAW_POLLING_INTERVAL` | No | Message poll interval ms (default: 2000) |
| `MYCLAW_MAX_CONTAINERS` | No | Max concurrent containers (default: 5) |
| `MYCLAW_TIMEZONE` | No | IANA timezone (default: UTC) |

## Architecture

```
Discord/Slack → Polling Loop → Group Queue → Docker Container → Claude Code CLI
                                    ↑                                    ↓
                            Task Scheduler              IPC (filesystem JSON)
                                    ↑                                    ↓
                                SQLite ←──────────── Response Router ←───┘
```

## 参考プロジェクト

- [OpenClaw](https://github.com/pjasicek/OpenClaw) - オープンソースのパーソナルエージェント
- [NanoClaw](https://github.com/nicabar/NanoClaw) - OpenClaw の軽量版クローン

## ライセンス

TBD
