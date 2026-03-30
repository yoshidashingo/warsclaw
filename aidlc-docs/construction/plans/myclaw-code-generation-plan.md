# Code Generation Plan - MyClaw

## Unit Context
- **Project Type**: Greenfield single unit
- **Code Location**: `src/` in workspace root
- **Target**: ~2000 lines TypeScript (strict)
- **Test Location**: `src/__tests__/`

## Generation Steps

### Phase A: Project Structure Setup

- [ ] **Step 1**: Create `package.json` with production/dev dependencies
- [ ] **Step 2**: Create `tsconfig.json` (strict mode, ESM)
- [ ] **Step 3**: Create `.env.example` with all environment variables
- [ ] **Step 4**: Create `eslint.config.js` + `.prettierrc`

### Phase B: Core Types & Configuration

- [ ] **Step 5**: Create `src/types.ts` — 全インターフェース・型定義 (Channel, NewMessage, ContainerInput/Output, ScheduledTask, RegisteredGroup, QueueTask, IpcDeps, etc.)
- [ ] **Step 6**: Create `src/config.ts` — Config class (fromEnv, バリデーション)
- [ ] **Step 7**: Create `src/logger.ts` — 構造化ログ (JSON, secret masking)

### Phase C: Database Layer

- [ ] **Step 8**: Create `src/db.ts` — Database class (SQLite schema init, CRUD, indexes, WAL mode)
- [ ] **Step 9**: Create `src/__tests__/db.test.ts` — Database ユニットテスト

### Phase D: Channel System

- [ ] **Step 10**: Create `src/channels/registry.ts` — ChannelRegistry (factory pattern)
- [ ] **Step 11**: Create `src/channels/discord.ts` — DiscordChannel (discord.js polling)
- [ ] **Step 12**: Create `src/channels/slack.ts` — SlackChannel (@slack/bolt)

### Phase E: Message Routing

- [ ] **Step 13**: Create `src/router.ts` — Router (message formatting, outbound routing, cursor management)

### Phase F: Container Execution

- [ ] **Step 14**: Create `src/container-runner.ts` — ContainerRunner (Docker exec, volume mounts, marker-based output parsing, timeout)
- [ ] **Step 15**: Create `src/__tests__/container-runner.test.ts` — ContainerRunner ユニットテスト (output parsing)

### Phase G: Group Queue

- [ ] **Step 16**: Create `src/group-queue.ts` — GroupQueue (per-group FIFO, global semaphore, exponential backoff retry)
- [ ] **Step 17**: Create `src/__tests__/group-queue.test.ts` — GroupQueue ユニットテスト + PBT (concurrency, retry)

### Phase H: IPC & Task Scheduling

- [ ] **Step 18**: Create `src/ipc.ts` — IpcWatcher (file monitoring, task/message processing, error quarantine, authorization)
- [ ] **Step 19**: Create `src/task-scheduler.ts` — TaskScheduler (cron/interval/once, next_run computation, due task check)
- [ ] **Step 20**: Create `src/__tests__/task-scheduler.test.ts` — TaskScheduler ユニットテスト + PBT (cron parsing, next_run)

### Phase I: Skill System

- [ ] **Step 21**: Create `src/skills/loader.ts` — SkillLoader (file-based discovery)

### Phase J: Orchestrator

- [ ] **Step 22**: Create `src/index.ts` — Orchestrator (init sequence, main polling loop, graceful shutdown)

### Phase K: Container Agent Runner

- [ ] **Step 23**: Create `container/agent-runner/package.json`
- [ ] **Step 24**: Create `container/agent-runner/src/index.ts` — agent entrypoint (stdin → claude CLI → stdout with markers)

### Phase L: Docker & Deployment

- [ ] **Step 25**: Create `container/Dockerfile` — Agent container image (node:22-slim + chromium + claude CLI)
- [ ] **Step 26**: Create `Dockerfile` — MyClaw main image
- [ ] **Step 27**: Create `docker-compose.yml`

### Phase M: Group Templates & Documentation

- [ ] **Step 28**: Create `groups/main/CLAUDE.md` + `groups/global/CLAUDE.md` — テンプレート
- [ ] **Step 29**: Update `README.md` with setup/usage instructions

### Phase N: Validation Input Schemas

- [ ] **Step 30**: Create `src/__tests__/validation.test.ts` — Zod スキーマ PBT (input validation, folder names, cron expressions)

## Summary

- **30 steps** in 14 phases (A-N)
- **Source files**: 15 (src/ + channels/ + skills/)
- **Test files**: 4 (db, container-runner, group-queue+PBT, validation+PBT)
- **Infrastructure files**: 5 (Dockerfile x2, docker-compose, agent-runner x2)
- **Config files**: 4 (package.json, tsconfig, eslint, .env.example)
- **Template files**: 3 (CLAUDE.md x2, README update)
- **Estimated LOC**: ~1700 core + ~500 tests + ~200 infra = ~2400 total (core within ~2000 target)
