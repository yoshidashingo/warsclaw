<h1 align="center">
  <img src="docs/icon.png" alt="MyClaw" width="128">
  <br>
  MyClaw
  <br>
  <br>
</h1>

<p align="center">
  The world's smallest autonomous operator agent — a persistent, self-improving AI that works on your codebase.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-22%2B-green" alt="node">
  <img src="https://img.shields.io/badge/typescript-strict-blue" alt="typescript">
  <img src="https://img.shields.io/badge/core-~1250%20lines-brightgreen" alt="lines">
  <img src="https://img.shields.io/badge/runtime-Claude%20Code%20CLI-purple" alt="runtime">
  <img src="https://img.shields.io/badge/isolation-Docker-blue" alt="docker">
</p>

<p align="center">
  <a href="README.md">English</a> •
  <a href="README-ja.md">日本語</a>
</p>

## What is MyClaw?

MyClaw is a **persistent, autonomous operator** that runs forever. It monitors Slack channels, works on a mounted repository, and continuously cycles through a self-improving loop:

```
    ┌─── Rule ───→ Execute ───→ Reflect ───→ Propose & Learn ───┐
    └───────────────────────────────────────────────────────────┘
```

It is not a chatbot. It is an operator that **creates its own rules, executes work, reflects on results, and deepens its understanding** — all autonomously.

Inspired by [OpenClaw](https://github.com/pjasicek/OpenClaw) (23+ channels, 92+ plugins, 60k+ LOC) and [NanoClaw](https://github.com/nicabar/NanoClaw) (~3k LOC), MyClaw distills the best patterns from both into **~1250 lines**.

## Features

### Autonomous Loop
- **Playbook-driven** — Self-maintained rules in `playbook.md` that evolve from experience
- **Action logging** — Every action tracked in `action-log.md` with trigger, action, result, and learnings
- **Retrospectives** — Automated Keep / Problem / Try analysis in `retrospective.md`
- **Knowledge accumulation** — Domain knowledge stored in `knowledge.md`

### Scheduled Tasks (auto-registered on first boot)

| Schedule | Task |
|----------|------|
| Weekdays 9:00 | Morning operations — review playbook, resume interrupted work |
| Weekdays 18:00 | Daily retrospective — Keep/Problem/Try analysis |
| Fridays 17:00 | Weekly summary — pattern identification, improvement proposals |
| Mondays 10:00 | Playbook review — prune stale rules, identify gaps |

### Infrastructure
- **Slack monitoring** — Receives human instructions in real time
- **Repository workspace** — Works directly on your codebase via Docker mount
- **Docker isolation** — Each agent runs in an ephemeral container with Claude Code CLI
- **Per-group isolation** — Separate context, memory, and files per Slack channel
- **SQLite** state management with automatic retention policies (30-day messages, 10k task logs)

## Quick Start

### Prerequisites

- Node.js 22+
- Docker
- [Slack Bot token](https://api.slack.com/apps)
- [Anthropic API key](https://console.anthropic.com/)

### Setup

```bash
# 1. Clone and configure
git clone https://github.com/yoshidashingo/myclaw.git && cd myclaw
cp .env.example .env
```

Edit `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
MYCLAW_WORKSPACE_DIR=/path/to/your/repo   # The repo MyClaw will work on
MYCLAW_TIMEZONE=Asia/Tokyo                 # Your timezone
```

```bash
# 2. Install and build
npm install
npm run build

# 3. Build the agent container image
docker build -t myclaw-agent -f container/Dockerfile container/

# 4. Start MyClaw
npm start
```

### Docker Compose

```bash
docker compose up -d --build
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key |
| `SLACK_BOT_TOKEN` | Yes | — | Slack bot token |
| `SLACK_APP_TOKEN` | Yes | — | Slack app-level token (Socket Mode) |
| `MYCLAW_WORKSPACE_DIR` | Yes | — | Path to the target repository |
| `DISCORD_BOT_TOKEN` | No | — | Discord bot token |
| `MYCLAW_POLLING_INTERVAL` | No | `2000` | Message poll interval (ms) |
| `MYCLAW_MAX_CONTAINERS` | No | `5` | Max concurrent agent containers |
| `MYCLAW_TIMEZONE` | No | `UTC` | IANA timezone for cron schedules |
| `MYCLAW_ASSISTANT_NAME` | No | `MyClaw` | Bot display name |
| `MYCLAW_LOG_LEVEL` | No | `info` | Log level (debug/info/warn/error) |

## Architecture

### Components (~1250 lines)

| Component | File | Purpose |
|-----------|------|---------|
| Orchestrator | `src/index.ts` | Main loop, initialization, graceful shutdown |
| Config | `src/config.ts` | Environment configuration |
| Logger | `src/logger.ts` | Structured JSON logging with secret masking |
| Database | `src/db.ts` | SQLite WAL — messages, tasks, sessions, groups |
| Router | `src/router.ts` | Message formatting and channel routing |
| ContainerRunner | `src/container-runner.ts` | Docker container lifecycle, marker-based output parsing |
| GroupQueue | `src/group-queue.ts` | Per-group FIFO queue with global concurrency limit |
| IpcWatcher | `src/ipc.ts` | Filesystem-based IPC monitoring |
| TaskScheduler | `src/task-scheduler.ts` | Cron/interval/once schedule management |
| ChannelRegistry | `src/channels/registry.ts` | Channel factory pattern |
| DiscordChannel | `src/channels/discord.ts` | Discord integration |
| SlackChannel | `src/channels/slack.ts` | Slack integration |
| SkillLoader | `src/skills/loader.ts` | File-based skill system |

### Data Flow

```
Slack message → Polling → Group match → FIFO queue → Docker container (Claude Code CLI)
                                                            ↓
                                                     /workspace/repo
                                                            ↓
                                              action-log.md, IPC output
                                                            ↓
                                                  Marker-based parse → Slack response
```

### Per-Group Files

```
groups/{group-name}/
├── playbook.md        # Self-maintained work rules
├── action-log.md      # Chronological action record
├── retrospective.md   # Keep/Problem/Try analysis
└── knowledge.md       # Accumulated domain knowledge
```

### Security

- Containers run with `--rm`, `--memory=512m`, `--cpus=1`
- Project root is read-only; only the group folder is writable
- `.env` shadowed to `/dev/null` inside containers
- Zod validation on all IPC inputs
- SQL field whitelist prevents injection
- 30-day message retention, 10k task log retention

## Development

```bash
npm run dev          # Watch mode (tsx)
npm run test         # Vitest + fast-check PBT (35 tests)
npm run typecheck    # TypeScript strict mode
npm run lint         # ESLint
npm run format       # Prettier
```

## License

TBD
