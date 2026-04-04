# Red Team Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 26 CRITICAL/HIGH/MEDIUM issues found by Red Team review to make WarsClaw production-safe.

**Architecture:** Three logical streams (Security, Reliability, Code Quality) executed sequentially to avoid merge conflicts on shared files. Each task is self-contained and independently testable.

**Tech Stack:** TypeScript, Node.js 22, Vitest, Zod, Docker, better-sqlite3

---

## File Map

| File | Stream | Changes |
|------|--------|---------|
| `container/agent-runner/src/index.ts` | 1+2 | C1: replace execSync with spawnSync; C4: add session ID capture |
| `container/Dockerfile` | 1 | H3: add non-root user |
| `docker-compose.yml` | 1 | C2: remove docker.sock mount |
| `src/container-runner.ts` | 1+3 | H1-H5: security hardening; M7: configurable timeout |
| `src/logger.ts` | 1 | M1: Discord token masking, full JSON masking |
| `src/index.ts` | 1+2 | M2: generic error messages; M5: dynamic groups |
| `src/group-queue.ts` | 2 | C3: fix double-decrement; H8: onComplete isolation; H9: log dropped; M3: queue depth; M9: shutdown timeout |
| `src/types.ts` | 2 | H6: add group_folder to IpcTaskSchema; M7: add timeout to ContainerInput |
| `src/ipc.ts` | 2 | H6: use group_folder; H7: fix floating promise; M6: implement register_group |
| `src/config.ts` | 2+3 | H10: validate API key; M4: quote stripping |
| `src/channels/slack.ts` | 3 | M8: message chunking |
| `eslint.config.js` (new) | 3 | M10: ESLint config |
| `src/__tests__/group-queue.test.ts` | 2 | New tests for C3, M3, M9 |
| `src/__tests__/task-scheduler.test.ts` | 3 | M11: import real implementation |
| `src/__tests__/logger.test.ts` (new) | 1 | Tests for M1 masking |
| `src/__tests__/config.test.ts` (new) | 2 | Tests for H10, M4 |
| `src/__tests__/ipc.test.ts` (new) | 2 | Tests for H7, M6 |

---

## Task 1: C1 — Eliminate Shell Injection in Agent Runner

**Files:**
- Modify: `container/agent-runner/src/index.ts:52-70`

- [ ] **Step 1: Replace `execSync` with `spawnSync` using stdin pipe**

Replace the entire try block in `main()` (lines 52-83) with:

```typescript
  try {
    const { spawnSync } = await import('node:child_process');

    const args = ['--print', '--output-format', 'text'];
    if (input.sessionId) {
      args.push('--resume', input.sessionId);
    }

    const prompt = input.script
      ? `Execute this script:\n${input.script}\n\nContext:\n${input.prompt}`
      : input.prompt;

    const result = spawnSync('claude', args, {
      cwd: workDir,
      encoding: 'utf-8',
      timeout: 300_000,
      input: prompt,
      env: { ...process.env, HOME: workDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.error) {
      writeOutput({
        status: 'error',
        result: '',
        error: result.error.message.slice(0, 1000),
      });
      return;
    }

    const stdout = result.stdout ?? '';
    const sessionId = input.sessionId || `warsclaw-${input.groupFolder}`;

    writeOutput({
      status: result.status === 0 ? 'success' : 'error',
      result: stdout.trim(),
      newSessionId: sessionId,
      error: result.status !== 0 ? (result.stderr ?? '').slice(0, 1000) : undefined,
    });
  } catch (err) {
    const error = err as Error;
    writeOutput({
      status: 'error',
      result: '',
      error: error.message.slice(0, 1000),
    });
  }
```

Also remove the `import { execSync }` at line 1 since it's no longer needed.

- [ ] **Step 2: Verify agent-runner compiles**

Run: `cd container/agent-runner && npx tsc --noEmit --module Node16 --moduleResolution Node16 --target ES2022 --esModuleInterop --strict src/index.ts`
Expected: no errors

- [ ] **Step 3: Run existing tests**

Run: `cd /Users/shingo/Documents/GitHub/warsclaw && npm test`
Expected: 35 tests pass (agent-runner has no unit tests; container-runner parser tests still pass)

---

## Task 2: C2 — Remove Docker Socket Mount

**Files:**
- Modify: `docker-compose.yml:11`

- [ ] **Step 1: Remove the docker.sock volume mount**

Replace the entire `docker-compose.yml`:

```yaml
services:
  warsclaw:
    build: .
    container_name: warsclaw
    volumes:
      - ./data:/app/data
      - ./groups:/app/groups
      - ./skills:/app/skills
      # NOTE: Docker socket intentionally NOT mounted.
      # Run WarsClaw on the host or use a socket proxy with strict ACLs.
      - ${WARSCLAW_WORKSPACE_DIR:-.}:/app/workspace-repo
    env_file: .env
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

- [ ] **Step 2: Verify YAML is valid**

Run: `python3 -c "import yaml; yaml.safe_load(open('/Users/shingo/Documents/GitHub/warsclaw/docker-compose.yml'))"`
Expected: no error

---

## Task 3: H1-H5 — Container Security Hardening

**Files:**
- Modify: `src/container-runner.ts:29-50`
- Modify: `container/Dockerfile`

- [ ] **Step 1: Add non-root user to Dockerfile**

Replace `container/Dockerfile` with:

```dockerfile
FROM node:22-slim

RUN apt-get update && apt-get install -y \
    chromium \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user
RUN useradd -r -m -s /bin/false agent

# Agent runner
WORKDIR /agent-runner
COPY agent-runner/package*.json ./
RUN npm install
COPY agent-runner/src ./src
RUN npx tsc --outDir dist --module Node16 --moduleResolution Node16 --target ES2022 --esModuleInterop --strict src/index.ts

WORKDIR /workspace
RUN chown -R agent:agent /workspace
USER agent
ENTRYPOINT ["node", "/agent-runner/dist/index.js"]
```

- [ ] **Step 2: Harden container-runner.ts docker run args**

Replace the `run` method in `src/container-runner.ts` (lines 29-92):

```typescript
  async run(input: ContainerInput): Promise<ContainerOutput> {
    const groupFolder = resolve(this.config.groupsDir, input.groupFolder);
    const ipcDir = resolve(this.config.ipcDir);

    // Write API key to temp env-file (not visible in docker inspect)
    const { mkdtempSync, writeFileSync, unlinkSync: unlinkTmp } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const envDir = mkdtempSync(join(tmpdir(), 'warsclaw-env-'));
    const envFile = join(envDir, '.env');
    writeFileSync(envFile, `ANTHROPIC_API_KEY=${this.config.anthropicApiKey}\n`, { mode: 0o600 });

    const timeoutSec = input.timeout ?? (input.isScheduledTask ? 600 : 300);

    const args = [
      'run', '--rm',
      // Security hardening
      '--network=none',
      '--no-new-privileges',
      '--cap-drop', 'ALL',
      '--pids-limit', '100',
      // Resource limits
      '--memory=512m', '--cpus=1',
      // Volumes: only group folder (rw), IPC (ro), workspace repo (rw if configured)
      '-v', `${groupFolder}:/workspace/groups/${input.groupFolder}:rw`,
      '-v', `${ipcDir}:/workspace/ipc:ro`,
      // API key via env-file (not visible in docker inspect args)
      '--env-file', envFile,
    ];

    if (this.config.workspaceDir) {
      args.push('-v', `${this.config.workspaceDir}:/workspace/repo:rw`);
    }

    args.push('-i', this.config.dockerImage);

    return new Promise<ContainerOutput>((resolveP, reject) => {
      const proc = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.activeProcesses.set(input.groupFolder, proc);

      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Container timeout after ${timeoutSec}s`));
      }, timeoutSec * 1000);

      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const cleanup = (): void => {
        clearTimeout(timeout);
        this.activeProcesses.delete(input.groupFolder);
        try { unlinkTmp(envFile); } catch { /* ignore */ }
        try { const { rmdirSync } = require('node:fs'); rmdirSync(envDir); } catch { /* ignore */ }
      };

      proc.on('close', (code) => {
        cleanup();
        if (stderr) this.logger.debug({ groupFolder: input.groupFolder }, `Container stderr: ${stderr.slice(0, 500)}`);
        if (code !== 0) {
          reject(new Error(`Container exited with code ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        try {
          resolveP(parseContainerOutput(stdout));
        } catch (err) {
          reject(new Error(`Failed to parse container output: ${(err as Error).message}`));
        }
      });

      proc.on('error', (err) => {
        cleanup();
        reject(err);
      });

      proc.stdin?.write(JSON.stringify(input));
      proc.stdin?.end();
    });
  }
```

Add import at top of file:

```typescript
import { join } from 'node:path';
```

- [ ] **Step 3: Run tests**

Run: `npm test && npm run typecheck`
Expected: all pass

---

## Task 4: M1 — Logger Secret Masking Enhancement

**Files:**
- Modify: `src/logger.ts`
- Create: `src/__tests__/logger.test.ts`

- [ ] **Step 1: Write tests for enhanced masking**

Create `src/__tests__/logger.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { maskSecrets } from '../logger.js';

describe('maskSecrets', () => {
  it('masks Anthropic API keys', () => {
    const result = maskSecrets('key is sk-ant-api03-abc123xyz');
    expect(result).not.toContain('sk-ant-api03-abc123xyz');
    expect(result).toContain('sk-a');
  });

  it('masks Slack bot tokens', () => {
    const result = maskSecrets('token: xoxb-123-456-abc');
    expect(result).not.toContain('xoxb-123-456-abc');
  });

  it('masks Slack app tokens', () => {
    const result = maskSecrets('token: xapp-1-ABC-123-xyz');
    expect(result).not.toContain('xapp-1-ABC-123-xyz');
  });

  it('masks Discord bot tokens', () => {
    const token = 'MTAxMjM0NTY3ODkwMTIzNDU2.GhAbCd.abcdefghijklmnopqrstuvwxyz1234';
    const result = maskSecrets(`token: ${token}`);
    expect(result).not.toContain(token);
  });

  it('does not alter strings without secrets', () => {
    const input = 'Hello world, no secrets here';
    expect(maskSecrets(input)).toBe(input);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/logger.test.ts`
Expected: FAIL — `maskSecrets` is not exported, Discord pattern missing

- [ ] **Step 3: Update logger.ts**

Replace `src/logger.ts`:

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const SECRET_PATTERNS = [
  /sk-ant-[a-zA-Z0-9-]+/g,
  /xoxb-[a-zA-Z0-9-]+/g,
  /xapp-[a-zA-Z0-9-]+/g,
  /[A-Za-z0-9]{24,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g,  // Discord bot token
];

export function maskSecrets(str: string): string {
  let result = str;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, pattern.flags), (m) =>
      m.length <= 8 ? '***' : m.slice(0, 4) + '...' + m.slice(-4),
    );
  }
  return result;
}

export class Logger {
  private readonly minLevel: number;

  constructor(level: LogLevel = 'info') {
    this.minLevel = LEVELS[level] ?? LEVELS.info;
  }

  debug(context: Record<string, unknown>, message: string): void {
    this.log('debug', context, message);
  }

  info(context: Record<string, unknown>, message: string): void {
    this.log('info', context, message);
  }

  warn(context: Record<string, unknown>, message: string): void {
    this.log('warn', context, message);
  }

  error(context: Record<string, unknown>, message: string): void {
    this.log('error', context, message);
  }

  private log(level: LogLevel, context: Record<string, unknown>, message: string): void {
    if (LEVELS[level] < this.minLevel) return;
    // Mask secrets in the entire serialized output (including context values)
    const raw = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      ...context,
      message,
    });
    const entry = maskSecrets(raw);
    if (level === 'error') {
      process.stderr.write(entry + '\n');
    } else {
      process.stdout.write(entry + '\n');
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/logger.test.ts`
Expected: PASS

---

## Task 5: M2 — Generic Error Messages to Chat

**Files:**
- Modify: `src/index.ts:143-145`

- [ ] **Step 1: Replace raw error with generic message**

In `src/index.ts`, replace lines 143-145:

```typescript
        onError: (error) => {
          logger.error({ groupFolder: group.folder, chatJid: msg.chat_jid }, `Processing failed: ${error.message}`);
          router.routeOutbound(msg.chat_jid, `Error: ${error.message}`).catch(() => {});
        },
```

With:

```typescript
        onError: (error) => {
          logger.error({ groupFolder: group.folder, chatJid: msg.chat_jid }, `Processing failed: ${error.message}`);
          router.routeOutbound(msg.chat_jid, '処理中にエラーが発生しました。しばらく経ってから再度お試しください。').catch(() => {});
        },
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: all pass

---

## Task 6: C3 — Fix activeCount Double-Decrement

**Files:**
- Modify: `src/group-queue.ts:66-87`
- Modify: `src/__tests__/group-queue.test.ts`

- [ ] **Step 1: Write test for activeCount correctness**

Add to `src/__tests__/group-queue.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { GroupQueue, getBackoffMs } from '../group-queue.js';

// ... existing tests ...

describe('GroupQueue', () => {
  function createMockRunner(behavior: 'success' | 'fail-then-succeed' | 'always-fail') {
    let callCount = 0;
    return {
      run: vi.fn(async () => {
        callCount++;
        if (behavior === 'success') return { status: 'success' as const, result: 'ok' };
        if (behavior === 'fail-then-succeed') {
          if (callCount <= 2) throw new Error('transient');
          return { status: 'success' as const, result: 'ok' };
        }
        throw new Error('permanent');
      }),
      getActiveCount: () => 0,
      killGroup: vi.fn(),
    };
  }

  function createMockLogger() {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }

  it('activeCount returns to zero after successful processing', async () => {
    const runner = createMockRunner('success');
    const logger = createMockLogger();
    const queue = new GroupQueue(runner as any, logger as any, 5, 3);

    const completed = new Promise<void>((resolve) => {
      queue.enqueue({
        groupFolder: 'test',
        input: { prompt: 'hi', sessionId: '', groupFolder: 'test', chatJid: 'jid', isMain: false, isScheduledTask: false, assistantName: 'Bot' },
        onComplete: async () => { resolve(); },
        onError: () => {},
      });
    });

    await completed;
    // Small delay for finally block
    await new Promise((r) => setTimeout(r, 50));
    expect(queue.getActiveCount()).toBe(0);
  });

  it('activeCount returns to zero after all retries exhausted', async () => {
    const runner = createMockRunner('always-fail');
    const logger = createMockLogger();
    const queue = new GroupQueue(runner as any, logger as any, 5, 1);

    const errored = new Promise<void>((resolve) => {
      queue.enqueue({
        groupFolder: 'test',
        input: { prompt: 'hi', sessionId: '', groupFolder: 'test', chatJid: 'jid', isMain: false, isScheduledTask: false, assistantName: 'Bot' },
        onComplete: async () => {},
        onError: () => { resolve(); },
      });
    });

    await errored;
    await new Promise((r) => setTimeout(r, 50));
    expect(queue.getActiveCount()).toBe(0);
  });

  it('activeCount never goes negative with retries', async () => {
    const runner = createMockRunner('fail-then-succeed');
    const logger = createMockLogger();
    const queue = new GroupQueue(runner as any, logger as any, 5, 5);

    const completed = new Promise<void>((resolve) => {
      queue.enqueue({
        groupFolder: 'test',
        input: { prompt: 'hi', sessionId: '', groupFolder: 'test', chatJid: 'jid', isMain: false, isScheduledTask: false, assistantName: 'Bot' },
        onComplete: async () => { resolve(); },
        onError: () => {},
      });
    });

    await completed;
    await new Promise((r) => setTimeout(r, 50));
    expect(queue.getActiveCount()).toBe(0);
    expect(queue.getActiveCount()).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/__tests__/group-queue.test.ts`
Expected: tests may pass on the happy path but the retry test exposes the double-decrement

- [ ] **Step 3: Rewrite executeWithRetry as flat loop**

Replace `src/group-queue.ts` entirely:

```typescript
import type { ContainerRunner } from './container-runner.js';
import type { Logger } from './logger.js';
import type { QueueTask } from './types.js';

const MAX_QUEUE_DEPTH = 20;

function getBackoffMs(retryCount: number): number {
  return 5000 * Math.pow(2, retryCount - 1);
}

export class GroupQueue {
  private readonly queues = new Map<string, QueueTask[]>();
  private readonly activeGroups = new Set<string>();
  private activeCount = 0;
  private accepting = true;

  constructor(
    private readonly runner: ContainerRunner,
    private readonly logger: Logger,
    private readonly maxConcurrent: number = 5,
    private readonly maxRetries: number = 5,
  ) {}

  enqueue(task: QueueTask): void {
    if (!this.accepting) return;
    const group = task.groupFolder;
    if (!this.queues.has(group)) this.queues.set(group, []);
    const queue = this.queues.get(group)!;
    if (queue.length >= MAX_QUEUE_DEPTH) {
      task.onError(new Error(`Queue full for group ${group} (max=${MAX_QUEUE_DEPTH})`));
      return;
    }
    queue.push(task);
    this.processNext();
  }

  getQueueLength(group: string): number {
    return this.queues.get(group)?.length ?? 0;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  getTotalQueued(): number {
    let total = 0;
    for (const q of this.queues.values()) total += q.length;
    return total;
  }

  async shutdown(timeoutMs = 30_000): Promise<void> {
    this.accepting = false;

    // Log dropped tasks
    const dropped = this.getTotalQueued();
    if (dropped > 0) {
      this.logger.warn({}, `Shutdown: dropping ${dropped} queued task(s)`);
    }

    // Wait for active containers with timeout
    const deadline = Date.now() + timeoutMs;
    while (this.activeCount > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }

    if (this.activeCount > 0) {
      this.logger.warn({}, `Shutdown timeout: force-killing ${this.activeCount} active container(s)`);
      for (const group of this.activeGroups) {
        this.runner.killGroup(group);
      }
    }
  }

  private processNext(): void {
    if (this.activeCount >= this.maxConcurrent) return;

    for (const [group, queue] of this.queues) {
      if (queue.length === 0 || this.activeGroups.has(group)) continue;
      const task = queue.shift()!;
      this.activeGroups.add(group);
      this.activeCount++;
      this.executeWithRetry(task);
      if (this.activeCount >= this.maxConcurrent) break;
    }
  }

  private async executeWithRetry(task: QueueTask): Promise<void> {
    const group = task.groupFolder;
    try {
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          const output = await this.runner.run(task.input);
          // Isolate onComplete — don't retry on callback failure
          try {
            await task.onComplete(output);
          } catch (cbErr) {
            this.logger.error({ groupFolder: group }, `onComplete callback failed: ${(cbErr as Error).message}`);
          }
          return;
        } catch (err) {
          if (attempt >= this.maxRetries) {
            this.logger.error({ groupFolder: group, attempts: attempt + 1 }, `Container failed after max retries: ${(err as Error).message}`);
            task.onError(err as Error);
            return;
          }
          const backoff = getBackoffMs(attempt + 1);
          this.logger.warn({ groupFolder: group, attempt: attempt + 1, backoffMs: backoff }, `Container failed, retrying: ${(err as Error).message}`);
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    } finally {
      this.activeGroups.delete(group);
      this.activeCount--;
      this.processNext();
    }
  }
}

export { getBackoffMs };
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: all pass, activeCount tests confirm count returns to 0

---

## Task 7: C4 — Fix Session Resumption + H6, H7, H10, M3, M5, M6, M9

These are already covered in the Task 6 rewrite (M3 queue depth, M9 shutdown timeout, H8 onComplete isolation, H9 dropped task logging). The remaining items:

### C4: Session ID in Agent Runner

Already implemented in Task 1 — the `spawnSync` version returns `newSessionId: sessionId`.

### H6: IPC schedule_task group_folder

**Files:**
- Modify: `src/types.ts:139-162`
- Modify: `src/ipc.ts:64-79`

- [ ] **Step 1: Add group_folder to IpcTaskSchema**

In `src/types.ts`, update the `schedule_task` variant (line 141):

```typescript
  z.object({
    type: z.literal('schedule_task'),
    prompt: z.string().min(1).max(10000),
    schedule_type: z.enum(['cron', 'interval', 'once']),
    schedule_value: z.string().min(1),
    targetJid: z.string().min(1),
    group_folder: GroupFolderSchema,
    script: z.string().optional(),
    context_mode: z.enum(['group', 'isolated']).default('group'),
  }),
```

- [ ] **Step 2: Update IPC handler to use group_folder**

In `src/ipc.ts`, replace the `schedule_task` case (lines 64-79):

```typescript
      case 'schedule_task':
        this.deps.scheduler.createTask({
          id: randomUUID(),
          group_folder: task.group_folder,
          chat_jid: task.targetJid,
          prompt: task.prompt,
          script: task.script ?? null,
          schedule_type: task.schedule_type,
          schedule_value: task.schedule_value,
          context_mode: task.context_mode,
          next_run: null,
          last_run: null,
          last_result: null,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        break;
```

- [ ] **Step 3: Update validation test**

In `src/__tests__/validation.test.ts`, update the `schedule_task` test:

```typescript
  it('accepts schedule_task', () => {
    const result = IpcTaskSchema.safeParse({
      type: 'schedule_task',
      prompt: 'test',
      schedule_type: 'cron',
      schedule_value: '* * * * *',
      targetJid: 'discord_123',
      group_folder: 'dev-team',
    });
    expect(result.success).toBe(true);
  });

  it('rejects schedule_task without group_folder', () => {
    const result = IpcTaskSchema.safeParse({
      type: 'schedule_task',
      prompt: 'test',
      schedule_type: 'cron',
      schedule_value: '* * * * *',
      targetJid: 'discord_123',
    });
    expect(result.success).toBe(false);
  });
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass

### H7: Fix Floating Promise in IPC Watcher

- [ ] **Step 5: Rewrite IPC watcher timer**

In `src/ipc.ts`, replace `start` and `stop` methods:

```typescript
  start(intervalMs: number): void {
    this.ensureDirs();
    this.scheduleNext(intervalMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(intervalMs: number): void {
    this.timer = setTimeout(async () => {
      try {
        await this.processFiles();
      } catch (err) {
        this.deps.logger.error({}, `IPC processing error: ${(err as Error).message}`);
      }
      if (this.timer !== null) this.scheduleNext(intervalMs);
    }, intervalMs);
  }
```

### H10: Validate API Key at Startup

- [ ] **Step 6: Add validation in config.ts**

In `src/config.ts`, replace line 40:

```typescript
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required. Set it in .env or as an environment variable.');
    }
    this.anthropicApiKey = apiKey;
```

### M4: .env Quote Stripping

- [ ] **Step 7: Strip quotes in .env parser**

In `src/config.ts`, replace lines 50-53:

```typescript
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        // Strip surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = value;
```

### M5: Dynamic Groups Refresh

- [ ] **Step 8: Add groups refresh in index.ts**

In `src/index.ts`, change `groups` to a mutable reference and refresh in the poll loop. Replace line 99:

```typescript
  let groups = db.getRegisteredGroups();
```

And in the `pollLoop` (after `scheduler.checkDueTasks()`), add:

```typescript
        // Refresh groups list for dynamic registration
        groups = db.getRegisteredGroups();
```

### M6: Implement register_group IPC

- [ ] **Step 9: Implement register_group handler**

In `src/ipc.ts`, replace lines 95-98:

```typescript
      case 'register_group': {
        const { mkdirSync } = await import('node:fs');
        const { join } = await import('node:path');
        this.deps.db.registerGroup({
          name: task.name,
          folder: task.folder,
          trigger: task.trigger,
          added_at: new Date().toISOString(),
          is_main: false,
          requires_trigger: true,
          timeout: 300,
        });
        mkdirSync(join(this.deps.ipcDir, '..', 'groups', task.folder), { recursive: true });
        this.deps.logger.info({ folder: task.folder }, 'Group registered via IPC');
        break;
      }
      case 'refresh_groups':
        this.deps.logger.info({}, 'Groups refresh requested via IPC');
        break;
```

Also update `IpcDeps` — the `db` reference is already available.

- [ ] **Step 10: Fix logLevel type cast in index.ts**

In `src/index.ts`, replace line 20:

```typescript
  const logLevel = (['debug', 'info', 'warn', 'error'].includes(config.logLevel) ? config.logLevel : 'info') as 'debug' | 'info' | 'warn' | 'error';
  const logger = new Logger(logLevel);
```

- [ ] **Step 11: Run all tests**

Run: `npm test && npm run typecheck`
Expected: all pass

---

## Task 8: M7 — Configurable Container Timeout

**Files:**
- Modify: `src/types.ts`
- Modify: `src/container-runner.ts`
- Modify: `src/index.ts`
- Modify: `src/task-scheduler.ts`

- [ ] **Step 1: Add timeout to ContainerInput**

In `src/types.ts`, add to `ContainerInput` interface:

```typescript
export interface ContainerInput {
  prompt: string;
  sessionId: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask: boolean;
  assistantName: string;
  script?: string;
  timeout?: number;  // seconds
}
```

- [ ] **Step 2: Use timeout in index.ts when enqueueing**

In `src/index.ts`, add `timeout: group.timeout` to the `input` object (line 128 area):

```typescript
        input: {
          prompt: formattedContext,
          sessionId,
          groupFolder: group.folder,
          chatJid: msg.chat_jid,
          isMain: group.is_main,
          isScheduledTask: false,
          assistantName: config.assistantName,
          timeout: group.timeout,
        },
```

- [ ] **Step 3: Use timeout in task-scheduler.ts**

In `src/task-scheduler.ts`, line 23 area, add `timeout` to the enqueued input. After `script: task.script ?? undefined,` add:

```typescript
          timeout: 600, // scheduled tasks get extended timeout
```

- [ ] **Step 4: Run tests**

Run: `npm test && npm run typecheck`
Expected: all pass

---

## Task 9: M8 — Slack Message Chunking

**Files:**
- Modify: `src/channels/slack.ts:52-54`

- [ ] **Step 1: Add chunking to Slack sendMessage**

Replace lines 52-54:

```typescript
    async sendMessage(jid: string, text: string) {
      const channel = jid.replace('slack_', '');
      // Slack API limit: 4000 chars per message
      for (let i = 0; i < text.length; i += 4000) {
        await app.client.chat.postMessage({ token: botToken, channel, text: text.slice(i, i + 4000) });
      }
    },
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: all pass

---

## Task 10: M10 — ESLint Configuration

**Files:**
- Create: `eslint.config.js`

- [ ] **Step 1: Install ESLint dependencies**

Run: `cd /Users/shingo/Documents/GitHub/warsclaw && npm install -D @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint`

- [ ] **Step 2: Create eslint.config.js**

```javascript
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'error',
    },
  },
  {
    ignores: ['dist/', 'container/', 'node_modules/'],
  },
];
```

- [ ] **Step 3: Fix any lint errors**

Run: `npx eslint src/`
Fix any reported issues.

---

## Task 11: M11 — Fix Test to Import Real Implementation

**Files:**
- Modify: `src/__tests__/task-scheduler.test.ts`

- [ ] **Step 1: Rewrite test to use real TaskScheduler**

Replace `src/__tests__/task-scheduler.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { TaskScheduler } from '../task-scheduler.js';

function createScheduler(): TaskScheduler {
  const mockDb = { getDueTasks: vi.fn(() => []), createTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(), logTaskRun: vi.fn() };
  const mockQueue = { enqueue: vi.fn() };
  const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return new TaskScheduler(mockDb as any, mockQueue as any, mockLogger as any, 'UTC');
}

describe('TaskScheduler.computeNextRun', () => {
  const scheduler = createScheduler();

  it('computes cron next run', () => {
    const next = scheduler.computeNextRun({ schedule_type: 'cron', schedule_value: '*/5 * * * *', last_run: null });
    expect(next).toBeTruthy();
    expect(new Date(next!).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('computes interval next run from last_run', () => {
    const next = scheduler.computeNextRun({ schedule_type: 'interval', schedule_value: '60000', last_run: '2026-01-01T00:00:00.000Z' });
    expect(next).toBe('2026-01-01T00:01:00.000Z');
  });

  it('returns schedule_value for once (not yet run)', () => {
    const next = scheduler.computeNextRun({ schedule_type: 'once', schedule_value: '2026-12-31T00:00:00Z', last_run: null });
    expect(next).toBe('2026-12-31T00:00:00Z');
  });

  it('returns null for once (already run)', () => {
    const next = scheduler.computeNextRun({ schedule_type: 'once', schedule_value: '2026-12-31T00:00:00Z', last_run: '2026-12-31T00:00:01Z' });
    expect(next).toBeNull();
  });

  it('PBT: interval next_run is always after last_run', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 60000, max: 86400000 }),
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
        (intervalMs, lastRunDate) => {
          const lastRun = lastRunDate.toISOString();
          const next = scheduler.computeNextRun({ schedule_type: 'interval', schedule_value: String(intervalMs), last_run: lastRun });
          expect(next).toBeTruthy();
          expect(new Date(next!).getTime()).toBe(lastRunDate.getTime() + intervalMs);
        },
      ),
    );
  });

  it('PBT: cron always returns a future date', () => {
    const cronExprs = ['* * * * *', '*/5 * * * *', '0 * * * *', '0 0 * * *', '0 0 * * 1'];
    fc.assert(
      fc.property(fc.constantFrom(...cronExprs), (expr) => {
        const next = scheduler.computeNextRun({ schedule_type: 'cron', schedule_value: expr, last_run: null });
        expect(next).toBeTruthy();
        const nextTime = new Date(next!).getTime();
        expect(nextTime).toBeGreaterThan(Date.now() - 1000);
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: all pass

---

## Task 12: H11 — Fix Vulnerable Dependencies

- [ ] **Step 1: Run npm audit fix**

Run: `npm audit fix`

- [ ] **Step 2: Verify no high/critical vulnerabilities remain**

Run: `npm audit --audit-level=high`
Expected: 0 vulnerabilities

---

## Task 13: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Run lint**

Run: `npx eslint src/`
Expected: no errors (or only warnings)

- [ ] **Step 4: Run audit**

Run: `npm audit --audit-level=high`
Expected: 0 high/critical

- [ ] **Step 5: Verify no execSync in agent-runner**

Run: `grep -r 'execSync' container/agent-runner/`
Expected: no matches

- [ ] **Step 6: Verify no docker.sock in compose**

Run: `grep 'docker.sock' docker-compose.yml`
Expected: no matches (only in comment)

---

## Success Criteria

- [ ] All existing + new tests pass
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean (ESLint)
- [ ] `npm audit` — 0 high/critical
- [ ] No `execSync` with shell in agent-runner
- [ ] No docker.sock mount
- [ ] `activeCount` verified by test to never go negative
- [ ] Session ID returned from container
