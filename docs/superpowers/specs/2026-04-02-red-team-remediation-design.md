# Red Team Remediation Design

**Date:** 2026-04-02
**Status:** Approved
**Scope:** CRITICAL 4 + HIGH 11 + MEDIUM 11 = 26 fixes

## Problem

Red Team review identified 26 issues across security, reliability, and code quality.
The system cannot be trusted for production use until these are resolved.

## Approach

Three parallel streams via git worktree, grouped by concern to minimize merge conflicts.

---

## Stream 1: Security (9 fixes)

**Target files:** `container/agent-runner/src/index.ts`, `docker-compose.yml`, `src/container-runner.ts`, `container/Dockerfile`, `src/logger.ts`, `src/index.ts`

| ID | Issue | Fix |
|----|-------|-----|
| C1 | Shell injection in agent-runner `execSync` | Replace with `spawnSync('claude', args, { input: prompt })` — no shell |
| C2 | Docker socket mounted in docker-compose.yml | Remove `/var/run/docker.sock` mount |
| H1 | No network isolation on agent containers | Add `--network=none` to docker run args |
| H2 | IPC dir writable by containers | Change IPC mount to `:ro` |
| H3 | Container runs as root, no hardening | Add `USER agent` to Dockerfile; add `--no-new-privileges`, `--cap-drop=ALL`, `--pids-limit=100` |
| H4 | Entire project root mounted into container | Remove project root mount; keep only group folder and workspace repo |
| H5 | API key visible in `docker inspect` | Use `--env-file` with temp file created via `mkdtemp`, deleted after container exits |
| M1 | Discord token not masked in logger | Add Discord token regex; apply `maskSecrets` to full serialized JSON string |
| M2 | Raw error details sent to chat users | Replace with generic message; log details server-side only |

## Stream 2: Reliability (11 fixes)

**Target files:** `src/group-queue.ts`, `container/agent-runner/src/index.ts`, `src/types.ts`, `src/ipc.ts`, `src/config.ts`, `src/index.ts`

| ID | Issue | Fix |
|----|-------|-----|
| C3 | `activeCount` double-decrement in recursive retry | Replace recursion with `for` loop; `finally` runs once |
| C4 | Session resumption never works | Use `--resume` with session ID passed via `ContainerInput.sessionId`; after CLI execution, parse session ID from Claude CLI output or use `--session-id` flag with deterministic ID `warsclaw-{groupFolder}`; return used ID in `newSessionId` field |
| H6 | IPC `schedule_task` sets empty `group_folder` | Add `group_folder: GroupFolderSchema` to `IpcTaskSchema`; use in handler |
| H7 | Floating promise in IPC `setInterval` | Replace with recursive `setTimeout` that waits for async completion |
| H8 | `onComplete` error triggers full container retry | Wrap `onComplete` in separate try/catch; don't retry on callback failure |
| H9 | In-flight queue tasks lost on crash | Log dropped task count on shutdown (full persistence out of scope) |
| H10 | `ANTHROPIC_API_KEY` not validated at startup | Throw on empty key in `Config.fromEnv()` |
| M3 | Unbounded in-memory queue | Add `MAX_QUEUE_DEPTH = 20` per group; reject with error when full |
| M5 | Stale `groups` closure in message handler | Refresh groups list periodically in poll loop; handler reads current reference |
| M6 | `register_group` / `refresh_groups` IPC not implemented | Implement: call `db.registerGroup()`, create group folder |
| M9 | Shutdown waits indefinitely for containers | Add 30s timeout; force-kill active containers after timeout |

## Stream 3: Code Quality (6 fixes)

**Target files:** `package.json`, `src/config.ts`, `src/container-runner.ts`, `src/channels/slack.ts`, `eslint.config.js` (new), `src/__tests__/task-scheduler.test.ts`

| ID | Issue | Fix |
|----|-------|-----|
| H11 | Vulnerable dependencies (undici via discord.js) | `npm audit fix`; update discord.js if needed |
| M4 | `.env` parser doesn't handle quotes | Strip surrounding `"` and `'` from values |
| M7 | Container timeout hardcoded, ignores group setting | Add `timeout` to `ContainerInput`; use group's timeout value |
| M8 | Slack has no message length handling | Add chunking at 4000 chars (matching Slack API limit) |
| M10 | ESLint config missing | Create `eslint.config.js` with `@typescript-eslint` and `no-floating-promises` |
| M11 | Tests copy logic instead of importing real implementation | Import and test `TaskScheduler.computeNextRun` directly |

---

## Execution Plan

1. Create feature branch `fix/red-team-remediation`
2. Launch 3 parallel agents in git worktrees (Stream 1, 2, 3)
3. Merge worktree branches sequentially into feature branch
4. Run full test suite + typecheck + lint
5. Code review via `code-reviewer` and `security-reviewer` agents
6. Create PR

## Files Modified (by stream)

### Stream 1 (no overlap with Stream 2/3)
- `container/agent-runner/src/index.ts` (shared with Stream 2 for C4 — coordinate)
- `container/Dockerfile`
- `docker-compose.yml`
- `src/container-runner.ts` (shared with Stream 3 for M7 — coordinate)
- `src/logger.ts`

### Stream 2 (minimal overlap)
- `src/group-queue.ts`
- `src/types.ts` (shared with Stream 2 H6)
- `src/ipc.ts`
- `src/config.ts` (shared with Stream 3 for M4 — coordinate)
- `src/index.ts`

### Stream 3
- `package.json` / `package-lock.json`
- `src/channels/slack.ts`
- `eslint.config.js` (new)
- `src/__tests__/task-scheduler.test.ts`

### Overlap Resolution
- `container/agent-runner/src/index.ts`: Stream 1 handles C1 (spawnSync), Stream 2 handles C4 (session ID). Stream 1 runs first; Stream 2 edits on top.
- `src/container-runner.ts`: Stream 1 handles security mounts (H1-H5), Stream 3 handles M7 timeout. Stream 1 runs first.
- `src/config.ts`: Stream 2 handles H10 (API key validation), Stream 3 handles M4 (.env quotes). Independent sections — no conflict.

## Success Criteria

- [ ] All 35 existing tests pass
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes (new ESLint config)
- [ ] `npm audit` shows 0 high/critical vulnerabilities
- [ ] No `execSync` with shell string in agent-runner
- [ ] No docker.sock mount in docker-compose.yml
- [ ] `activeCount` never goes negative (verified by test)
- [ ] Session ID returned from container output
