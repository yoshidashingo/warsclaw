# MyClaw

The world's smallest [OpenClaw](https://github.com/pjasicek/OpenClaw) / [NanoClaw](https://github.com/nicabar/NanoClaw) clone.

**[日本語版 README はこちら](README-ja.md)**

MyClaw is a persistent, autonomous operator agent. It monitors Slack channels, works on a mounted repository as its workspace, and continuously runs an autonomous improvement loop: **Rule → Execute → Reflect → Propose & Learn**.

It is not a chatbot. It is an operator that thinks, creates its own rules, executes work, reflects on results, and deepens its understanding — forever.

## How It Works

```
                    ┌─────────────────────────────────────────┐
                    │          Autonomous Loop (forever)       │
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

### The Autonomous Loop

1. **Rule** — MyClaw defines and maintains work rules in `playbook.md`. Rules are born from retrospectives and refined over time.
2. **Execute** — It executes work in the mounted repository based on playbook rules and Slack instructions. Every action is logged to `action-log.md`.
3. **Reflect** — After completing work, it performs retrospectives (Keep / Problem / Try) in `retrospective.md`, identifying patterns and root causes.
4. **Propose & Learn** — It proposes improvements via Slack, updates playbook rules upon approval, and accumulates domain knowledge in `knowledge.md`.

### Built-in Scheduled Tasks

On first boot, MyClaw auto-registers four cron tasks to drive the autonomous loop:

| Schedule | Task |
|----------|------|
| Weekdays 9:00 | Morning operations — review playbook, resume interrupted work |
| Weekdays 18:00 | Daily retrospective — Keep/Problem/Try analysis |
| Fridays 17:00 | Weekly summary — pattern identification, improvement proposals |
| Mondays 10:00 | Playbook review — prune stale rules, identify gaps |

## Features

- **~2000 lines** of core code (the smallest OpenClaw/NanoClaw clone)
- **Persistent autonomous operator** — runs forever, continuously improving
- **Slack channel monitoring** — receives human instructions in real time
- **Repository as workspace** — works directly on your codebase via Docker mount
- **Action logging** — every action tracked in `action-log.md`
- **Retrospectives** — automated Keep/Problem/Try after each work session
- **Playbook-driven** — self-maintained rules that evolve from experience
- **Claude Code CLI** as agent runtime (runs inside Docker containers)
- **Per-group isolation** — separate context, memory, and files per Slack channel
- **SQLite** state management with automatic retention policies

## Quick Start

### Prerequisites

- Node.js 22+
- Docker
- A Slack Bot token ([create one here](https://api.slack.com/apps))
- An Anthropic API key

### Setup

```bash
# 1. Clone and configure
git clone <repo> && cd myclaw
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
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key for Claude |
| `SLACK_BOT_TOKEN` | Yes | — | Slack bot token |
| `SLACK_APP_TOKEN` | Yes | — | Slack app-level token (Socket Mode) |
| `MYCLAW_WORKSPACE_DIR` | Yes | — | Path to the target repository |
| `DISCORD_BOT_TOKEN` | No | — | Discord bot token (if using Discord) |
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

1. **Slack message** → Polling loop detects new message
2. **Group matching** → Message matched to registered group by JID
3. **Queue** → Enqueued in per-group FIFO (max 5 concurrent containers)
4. **Container** → Docker container spawned with Claude Code CLI
5. **Workspace** → Agent works in `/workspace/repo` (mounted repository)
6. **Response** → Output parsed via markers, routed back to Slack
7. **IPC** → Agent can send follow-up messages or create scheduled tasks via filesystem JSON

### File Management (per group)

```
groups/{group-name}/
├── playbook.md        # Self-maintained work rules
├── action-log.md      # Chronological action record
├── retrospective.md   # Keep/Problem/Try analysis
└── knowledge.md       # Accumulated domain knowledge
```

### Security

- Agent containers run with `--rm` (auto-cleanup)
- Project root mounted read-only; only group folder is writable
- `.env` shadowed to `/dev/null` inside containers
- Input validation via Zod schemas on all IPC inputs
- SQL field whitelist prevents injection in dynamic updates
- Memory and CPU limits per container (512MB / 1 CPU)

## Development

```bash
npm run dev          # Watch mode with tsx
npm run test         # Run tests (Vitest + fast-check PBT)
npm run typecheck    # TypeScript strict mode check
npm run lint         # ESLint
npm run format       # Prettier
```

## Inspired By

- [OpenClaw](https://github.com/pjasicek/OpenClaw) — Full-featured open-source personal agent (23+ channels, 92+ plugins)
- [NanoClaw](https://github.com/nicabar/NanoClaw) — Lightweight OpenClaw clone with Docker isolation

MyClaw takes the best patterns from both — NanoClaw's polling architecture and Docker isolation, OpenClaw's channel plugin contract — and distills them into ~2000 lines.

## License

TBD
