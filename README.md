# MyClaw

世界でもっとも小さい [OpenClaw](https://github.com/pjasicek/OpenClaw) / [NanoClaw](https://github.com/nicabar/NanoClaw) クローン。

AI-DLC（AI-Driven Learning from Code）を活用し、既存実装のリバースエンジニアリングから良い点を取り込みつつ、ミニマルな実装を目指します。

## 概要

MyClaw は永続稼働する統合オペレーターです。Slackで人間とやりとりしながら、マウントしたリポジトリを作業スペースとして、**ルール策定→実行→振り返り→提案・理解深化**の自律ループを回し続けます。

## 特徴

- ~2000行の極小コードベース
- **永続稼働する自律オペレーター** — 起動したら永遠にループを回し続ける
- **自律ループ**: ルール策定(playbook.md) → 実行 → 振り返り(retrospective.md) → 提案・学習(knowledge.md)
- **Slackチャンネル常時監視** — 人間の指示もリアルタイムで受け取り作業
- **リポジトリを作業スペースとしてマウント** — 実際のコードベースで作業
- **行動ログの自動記録** — すべての行動を action-log.md に追跡
- **定期タスクによる自律駆動** — 朝の開始、日次振り返り、週次まとめ、playbook棚卸し
- Claude Code CLI をエージェントランタイムとして使用
- Docker コンテナでエージェント実行を完全隔離

## Quick Start

```bash
# 1. Clone and configure
git clone <repo> && cd myclaw
cp .env.example .env
# Edit .env:
#   ANTHROPIC_API_KEY, SLACK_BOT_TOKEN, SLACK_APP_TOKEN
#   MYCLAW_WORKSPACE_DIR=/path/to/your/repo  ← 作業対象リポジトリ

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
# MYCLAW_WORKSPACE_DIR を .env に設定してから
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
| `MYCLAW_WORKSPACE_DIR` | Yes | 作業対象リポジトリのパス |
| `MYCLAW_TIMEZONE` | No | IANA timezone (default: UTC) |

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │          Autonomous Loop (永続)          │
                    │                                         │
                    │   playbook.md ──→ Execute ──→ Reflect   │
                    │        ↑                        ↓       │
                    │     Propose ←── knowledge.md ←──┘       │
                    └────────────────────┬────────────────────┘
                                         │
Slack ←→ Polling ←→ Group Queue ←→ Docker Container ←→ /workspace/repo
              ↑                                              ↓
       Task Scheduler (cron)                         action-log.md
              ↑                                     retrospective.md
           SQLite                                    knowledge.md
```

## 参考プロジェクト

- [OpenClaw](https://github.com/pjasicek/OpenClaw) - オープンソースのパーソナルエージェント
- [NanoClaw](https://github.com/nicabar/NanoClaw) - OpenClaw の軽量版クローン

## ライセンス

TBD
