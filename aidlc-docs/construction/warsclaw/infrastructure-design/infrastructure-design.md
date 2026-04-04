# Infrastructure Design - WarsClaw

## Infrastructure Overview

WarsClaw はクラウドサービスに依存しないローカルファーストのアーキテクチャ。Docker コンテナとしてどこでもデプロイ可能。

```mermaid
graph TB
    subgraph Host["Host Machine (any OS)"]
        subgraph DockerEngine["Docker Engine"]
            subgraph WarsClawContainer["warsclaw container"]
                NODE[Node.js 22<br/>WarsClaw Main Process]
                SQLITE[(SQLite DB<br/>data/warsclaw.db)]
            end

            subgraph AgentContainers["Agent Containers (ephemeral)"]
                A1[warsclaw-agent<br/>Group A]
                A2[warsclaw-agent<br/>Group B]
                A3[warsclaw-agent<br/>Group C]
            end
        end

        DOCKER_SOCK[/var/run/docker.sock]
        DATA[./data/]
        GROUPS[./groups/]
    end

    subgraph External["External APIs"]
        DISCORD[Discord API<br/>wss://gateway.discord.gg]
        SLACK[Slack API<br/>https://slack.com/api]
        ANTHROPIC[Anthropic API<br/>https://api.anthropic.com]
    end

    NODE -->|docker.sock| AgentContainers
    NODE --> SQLITE
    WarsClawContainer ---|volume| DATA
    WarsClawContainer ---|volume| GROUPS
    WarsClawContainer ---|volume| DOCKER_SOCK
    AgentContainers ---|RO mount| GROUPS
    AgentContainers ---|RW mount| GROUPS

    NODE --> DISCORD
    NODE --> SLACK
    AgentContainers --> ANTHROPIC
```

## Compute Infrastructure

### WarsClaw Main Process
- **Runtime**: Node.js 22 LTS in Docker container
- **Image**: `warsclaw:latest` (node:22-slim base)
- **Resources**: ~100MB RAM, minimal CPU
- **Restart Policy**: `unless-stopped`
- **Networking**: Host network (channel API通信)

### Agent Containers
- **Runtime**: Node.js 22 + Chromium in Docker container
- **Image**: `warsclaw-agent:latest` (node:22-slim base + chromium)
- **Resources**: 512MB RAM limit, 1 CPU limit per container
- **Lifecycle**: Ephemeral (`--rm`), created per message
- **Max Concurrent**: 5 (configurable)
- **Timeout**: 300s (configurable per group)

## Storage Infrastructure

### SQLite Database
- **Path**: `data/warsclaw.db`
- **Mode**: WAL (Write-Ahead Logging)
- **Backup**: ファイルコピーで完結 (SQLite hot backup)
- **Size Estimate**: < 100MB for typical usage

### Filesystem Storage
- **Groups**: `groups/` — グループごとのフォルダ、CLAUDE.md、セッション
- **IPC**: Runtime時に作成、ephemeral
- **Logs**: stdout/stderr → Docker logging driver

## Networking

### Outbound Connections
| Destination | Protocol | Port | Purpose |
|-------------|----------|------|---------|
| gateway.discord.gg | WSS | 443 | Discord Gateway |
| discord.com/api | HTTPS | 443 | Discord REST API |
| slack.com/api | HTTPS | 443 | Slack API |
| api.anthropic.com | HTTPS | 443 | Claude API (from agent containers) |

### Internal Communication
| From | To | Protocol | Description |
|------|----|----------|-------------|
| Main Process | Docker Engine | Unix Socket | コンテナ管理 |
| Main Process | Agent Container | stdin/stdout | ContainerInput/Output |
| Agent Container | IPC Directory | Filesystem | JSON files |

### No Inbound Ports Required
- ポーリングベースアーキテクチャのため、インバウンドポートは不要
- Slack Events API を使用する場合は将来的にポート公開が必要

## Service Management

### Docker Compose (Primary)
```yaml
# docker-compose.yml
version: '3.8'
services:
  warsclaw:
    build: .
    container_name: warsclaw
    volumes:
      - ./data:/app/data
      - ./groups:/app/groups
      - /var/run/docker.sock:/var/run/docker.sock
    env_file: .env
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

### launchd (macOS, non-Docker)
```xml
<!-- ~/Library/LaunchAgents/com.warsclaw.agent.plist -->
<plist version="1.0">
<dict>
    <key>Label</key><string>com.warsclaw.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/warsclaw/dist/index.js</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>WorkingDirectory</key><string>/path/to/warsclaw</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key><string>production</string>
    </dict>
</dict>
</plist>
```

### systemd (Linux, non-Docker)
```ini
# /etc/systemd/system/warsclaw.service
[Unit]
Description=WarsClaw Personal Agent
After=network.target docker.service

[Service]
Type=simple
User=warsclaw
WorkingDirectory=/opt/warsclaw
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/warsclaw/.env

[Install]
WantedBy=multi-user.target
```

## Environment Configuration

### Required Environment Variables
```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...       # Claude API key

# Discord (if enabled)
DISCORD_BOT_TOKEN=...              # Discord bot token

# Slack (if enabled)
SLACK_BOT_TOKEN=xoxb-...           # Slack bot token
SLACK_APP_TOKEN=xapp-...           # Slack app-level token
```

### Optional Environment Variables
```bash
WARSCLAW_POLLING_INTERVAL=2000       # Message poll interval (ms)
WARSCLAW_IPC_INTERVAL=1000           # IPC poll interval (ms)
WARSCLAW_MAX_CONTAINERS=5            # Max concurrent containers
WARSCLAW_MAX_RETRIES=5               # Max retry attempts
WARSCLAW_TIMEZONE=Asia/Tokyo         # IANA timezone
WARSCLAW_DOCKER_IMAGE=warsclaw-agent   # Agent container image
WARSCLAW_DATA_DIR=./data             # Data directory
WARSCLAW_GROUPS_DIR=./groups         # Groups directory
WARSCLAW_ASSISTANT_NAME=WarsClaw       # Bot display name
WARSCLAW_LOG_LEVEL=info              # Log level
```

## Build & Deploy Pipeline

### Local Development
```bash
npm install
npm run build
npm run dev                  # tsx watch mode
```

### Docker Build
```bash
# Build agent image
docker build -t warsclaw-agent -f container/Dockerfile .

# Build main image
docker build -t warsclaw .

# Start
docker compose up -d
```

### Production Deploy
```bash
# Clone and configure
git clone <repo> && cd warsclaw
cp .env.example .env
# Edit .env with tokens

# Build and start
docker compose up -d --build

# View logs
docker compose logs -f
```
