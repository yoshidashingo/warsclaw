# MyClaw

世界でもっとも小さい [OpenClaw](https://github.com/pjasicek/OpenClaw) / [NanoClaw](https://github.com/nicabar/NanoClaw) クローン。

AI-DLC（AI-Driven Learning from Code）を活用し、既存実装のリバースエンジニアリングから良い点を取り込みつつ、ミニマルな実装を目指します。

## 概要

MyClaw はSlackチャンネルを常時監視し、設定でマウントしたリポジトリを作業スペースとして動作するパーソナル開発エージェントです。指示された作業を実行するだけでなく、行動ログの記録・振り返り・業務改善の提案を自律的に行います。

## 特徴

- ~2000行の極小コードベース
- **Slackチャンネル常時監視** — 指示をリアルタイムで受け取り作業
- **リポジトリを作業スペースとしてマウント** — 実際のコードベースで作業
- **行動ログの自動記録** — 何をしたか、なぜしたか、結果を追跡
- **振り返り（レトロスペクティブ）** — 作業完了後にKeep/Problem/Tryを整理
- **業務改善の自律提案・実行** — コード品質、プロセス、ツールの改善
- Claude Code CLI をエージェントランタイムとして使用
- Docker コンテナでエージェント実行を完全隔離
- cron / interval / once のスケジュールタスク
- SQLite による軽量状態管理

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
Slack Channel → Polling → Group Queue → Docker Container → Claude Code CLI
                               ↑              ↓                    ↓
                       Task Scheduler    /workspace/repo     Action Log
                               ↑              ↓              Retrospective
                           SQLite ←── Response Router ←── Improvement Proposals
```

## 参考プロジェクト

- [OpenClaw](https://github.com/pjasicek/OpenClaw) - オープンソースのパーソナルエージェント
- [NanoClaw](https://github.com/nicabar/NanoClaw) - OpenClaw の軽量版クローン

## ライセンス

TBD
