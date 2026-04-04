# Deployment Architecture - WarsClaw

## Deployment Models

### Model 1: Docker Compose (Recommended)

```
┌──────────────────────────────────────────┐
│ Host Machine                             │
│                                          │
│  docker-compose.yml                      │
│  ┌────────────────────────────────────┐  │
│  │ warsclaw container                   │  │
│  │  Node.js 22 main process          │  │
│  │  Polls Discord + Slack APIs        │  │
│  │  Manages agent containers          │  │
│  └──────────┬─────────────────────────┘  │
│             │ docker.sock                 │
│  ┌──────────▼─────────────────────────┐  │
│  │ warsclaw-agent containers (0-5)     │  │
│  │  Ephemeral, per-message            │  │
│  │  claude CLI + Chromium             │  │
│  │  Mounts: groups/ (RW), root (RO)  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ./data/warsclaw.db    (persistent)        │
│  ./groups/           (persistent)        │
│  ./.env              (secrets)           │
└──────────────────────────────────────────┘
```

**Pros**: ポータブル、再現可能、secrets管理が容易
**Cons**: Docker-in-Docker パターン (docker.sock マウント)

### Model 2: Bare Metal + Docker Agent

```
┌──────────────────────────────────────────┐
│ Host Machine                             │
│                                          │
│  Node.js 22 (native)                     │
│  WarsClaw main process                     │
│  systemd/launchd service                 │
│             │                             │
│             │ docker CLI                  │
│  ┌──────────▼─────────────────────────┐  │
│  │ warsclaw-agent containers (0-5)     │  │
│  │  Ephemeral, per-message            │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ./data/warsclaw.db                        │
│  ./groups/                               │
└──────────────────────────────────────────┘
```

**Pros**: docker.sock マウント不要、よりシンプル
**Cons**: Node.js のインストールが必要

## Directory Layout (Production)

```
/opt/warsclaw/                    # or ~/warsclaw/
├── dist/                       # Compiled TypeScript
│   ├── index.js
│   ├── types.js
│   ├── config.js
│   ├── db.js
│   ├── router.js
│   ├── group-queue.js
│   ├── container-runner.js
│   ├── ipc.js
│   ├── task-scheduler.js
│   ├── logger.js
│   ├── channels/
│   │   ├── registry.js
│   │   ├── discord.js
│   │   └── slack.js
│   └── skills/
│       └── loader.js
├── container/
│   ├── Dockerfile              # Agent image definition
│   └── agent-runner/
│       ├── package.json
│       ├── src/
│       │   └── index.ts
│       └── dist/
│           └── index.js
├── groups/
│   ├── main/
│   │   └── CLAUDE.md
│   ├── global/
│   │   └── CLAUDE.md
│   └── {registered-groups}/
├── skills/                     # File-based skills
├── data/
│   └── warsclaw.db
├── .env                        # Secrets (not in git)
├── .env.example                # Template
├── package.json
├── tsconfig.json
├── Dockerfile                  # Main image
├── docker-compose.yml
└── README.md
```

## Backup & Recovery

### Data Backup
```bash
# SQLite hot backup (safe while running)
sqlite3 data/warsclaw.db ".backup 'data/warsclaw.db.bak'"

# Full backup
tar czf warsclaw-backup-$(date +%Y%m%d).tar.gz data/ groups/
```

### Recovery
```bash
# Restore from backup
tar xzf warsclaw-backup-YYYYMMDD.tar.gz
docker compose restart
```

### Data Portability
- SQLiteファイル + groups/ フォルダのコピーで完全移行可能
- 環境変数の再設定のみ必要

## Security Considerations

### Docker Socket Access
- `docker.sock` マウントはホストDocker操作権限を付与
- 本番環境では `--userns-remap` やrootlessモードの検討を推奨
- Agent コンテナには `docker.sock` をマウントしない

### Secret Management
- `.env` ファイルは `.gitignore` に含める
- Docker secrets (Swarm mode) の将来的な対応も可能
- Agent コンテナには `ANTHROPIC_API_KEY` のみ渡す

### Network Isolation
- Agent コンテナのデフォルトネットワークは Docker bridge
- Web検索不要の場合は `--network=none` で完全隔離可能
- 設定: `WARSCLAW_AGENT_NETWORK=none` (configurable)
