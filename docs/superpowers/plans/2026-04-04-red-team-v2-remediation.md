# Red Team V2 Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex Red Team V2で発見された8件の新規脆弱性(#3〜#10)を修正し、WarsClaw agentのセキュリティを強化する

**Architecture:** 各修正は独立しており並行実装可能。既存のZodバリデーション・Docker hardening等のパターンに従い、最小限の変更で防御層を追加する。テストはvitestで、property-basedテスト(fast-check)を活用する。

**Tech Stack:** TypeScript, Vitest, fast-check, Zod, Node.js fs, Docker

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/config.ts` | Modify | allowedSenders/allowedChannels設定追加, workspaceDir検証, dataDir権限 |
| `src/types.ts` | Modify | schedule_value refinement, AllowlistSchema追加 |
| `src/index.ts` | Modify | sender allowlistフィルタ追加 |
| `src/container-runner.ts` | Modify | stdout/stderrバイト上限, HOME固定化 |
| `src/ipc.ts` | Modify | HMAC署名検証, アトミックファイル処理 |
| `src/task-scheduler.ts` | Modify | interval/once バリデーション |
| `src/db.ts` | Modify | dataDir パーミッション設定 |
| `container/agent-runner/src/index.ts` | Modify | HOME を /home/agent に固定 |
| `src/__tests__/config.test.ts` | Create | Config allowlist・workspaceDir検証テスト |
| `src/__tests__/ipc.test.ts` | Create | IPC署名検証・アトミック処理テスト |
| `src/__tests__/security.test.ts` | Create | sender filtering, stdout cap, scheduler validationテスト |

---

### Task 1: スケジューラ入力バリデーション強化 (Issue #7)

**Files:**
- Modify: `src/types.ts:140-164`
- Modify: `src/task-scheduler.ts:78-96`
- Modify: `src/__tests__/validation.test.ts`
- Modify: `src/__tests__/task-scheduler.test.ts`

- [ ] **Step 1: types.tsにschedule_valueのrefinementを追加するテストを書く**

`src/__tests__/validation.test.ts` の `IpcTaskSchema` セクションに追加:

```typescript
it('rejects interval < 60000', () => {
  const result = IpcTaskSchema.safeParse({
    type: 'schedule_task',
    prompt: 'test',
    schedule_type: 'interval',
    schedule_value: '0',
    targetJid: 'discord_123',
    group_folder: 'dev-team',
  });
  expect(result.success).toBe(false);
});

it('rejects negative interval', () => {
  const result = IpcTaskSchema.safeParse({
    type: 'schedule_task',
    prompt: 'test',
    schedule_type: 'interval',
    schedule_value: '-1000',
    targetJid: 'discord_123',
    group_folder: 'dev-team',
  });
  expect(result.success).toBe(false);
});

it('accepts valid interval >= 60000', () => {
  const result = IpcTaskSchema.safeParse({
    type: 'schedule_task',
    prompt: 'test',
    schedule_type: 'interval',
    schedule_value: '60000',
    targetJid: 'discord_123',
    group_folder: 'dev-team',
  });
  expect(result.success).toBe(true);
});
```

- [ ] **Step 2: テストがFAILすることを確認**

Run: `npx vitest run src/__tests__/validation.test.ts`
Expected: interval=0 と negative interval のテストがFAIL (現在バリデーションなし)

- [ ] **Step 3: types.tsのschedule_taskスキーマにrefinementを追加**

`src/types.ts` の schedule_task スキーマを修正:

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
}).refine((data) => {
  if (data.schedule_type === 'interval') {
    const ms = parseInt(data.schedule_value, 10);
    return !isNaN(ms) && ms >= 60000;
  }
  if (data.schedule_type === 'once') {
    const ts = new Date(data.schedule_value).getTime();
    return !isNaN(ts) && ts > Date.now();
  }
  return true;
}, { message: 'Invalid schedule_value for the given schedule_type' }),
```

- [ ] **Step 4: テストがPASSすることを確認**

Run: `npx vitest run src/__tests__/validation.test.ts`
Expected: ALL PASS

- [ ] **Step 5: task-scheduler.tsにガードを追加するテストを書く**

`src/__tests__/task-scheduler.test.ts` に追加:

```typescript
it('computeNextRun returns null for interval < 60000', () => {
  const next = scheduler.computeNextRun({ schedule_type: 'interval', schedule_value: '0', last_run: null });
  expect(next).toBeNull();
});

it('computeNextRun returns null for negative interval', () => {
  const next = scheduler.computeNextRun({ schedule_type: 'interval', schedule_value: '-5000', last_run: null });
  expect(next).toBeNull();
});
```

- [ ] **Step 6: task-scheduler.tsのcomputeNextRunにガードを追加**

`src/task-scheduler.ts` の `computeNextRun` メソッド内 `case 'interval'` を修正:

```typescript
case 'interval': {
  const ms = parseInt(task.schedule_value, 10);
  if (isNaN(ms) || ms < 60000) return null;
  const base = task.last_run ? new Date(task.last_run).getTime() : Date.now();
  return new Date(base + ms).toISOString();
}
```

- [ ] **Step 7: 全テスト実行**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 8: コミット**

```bash
git add src/types.ts src/task-scheduler.ts src/__tests__/validation.test.ts src/__tests__/task-scheduler.test.ts
git commit -m "fix(security): validate schedule_value to prevent interval=0 DoS (#7)"
```

---

### Task 2: コンテナ stdout/stderr バイト上限 (Issue #6)

**Files:**
- Modify: `src/container-runner.ts:69-77`
- Modify: `src/__tests__/container-runner.test.ts`

- [ ] **Step 1: parseContainerOutputの大量入力テストを書く**

`src/__tests__/container-runner.test.ts` に追加:

```typescript
import { MAX_OUTPUT_BYTES } from '../container-runner.js';

it('MAX_OUTPUT_BYTES is defined and reasonable', () => {
  expect(MAX_OUTPUT_BYTES).toBe(10 * 1024 * 1024); // 10MB
});
```

- [ ] **Step 2: container-runner.tsにMAX_OUTPUT_BYTESをexport追加**

`src/container-runner.ts` の先頭に追加:

```typescript
export const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10MB
```

- [ ] **Step 3: stdout/stderrバッファリングにバイト上限を追加**

`src/container-runner.ts` の `run()` メソッド内を修正:

```typescript
let stdout = '';
let stderr = '';
let stdoutBytes = 0;
let stderrBytes = 0;
let killed = false;

// ... (timeout setup) ...

proc.stdout?.on('data', (chunk: Buffer) => {
  stdoutBytes += chunk.length;
  if (stdoutBytes > MAX_OUTPUT_BYTES) {
    if (!killed) {
      killed = true;
      proc.kill('SIGTERM');
      reject(new Error(`Container stdout exceeded ${MAX_OUTPUT_BYTES} bytes, killed`));
    }
    return;
  }
  stdout += chunk.toString();
});
proc.stderr?.on('data', (chunk: Buffer) => {
  stderrBytes += chunk.length;
  if (stderrBytes > MAX_OUTPUT_BYTES) {
    if (!killed) {
      killed = true;
      proc.kill('SIGTERM');
      reject(new Error(`Container stderr exceeded ${MAX_OUTPUT_BYTES} bytes, killed`));
    }
    return;
  }
  stderr += chunk.toString();
});
```

- [ ] **Step 4: テスト実行**

Run: `npx vitest run src/__tests__/container-runner.test.ts`
Expected: ALL PASS

- [ ] **Step 5: コミット**

```bash
git add src/container-runner.ts src/__tests__/container-runner.test.ts
git commit -m "fix(security): cap container stdout/stderr to prevent OOM (#6)"
```

---

### Task 3: agent-runner HOME 固定化 (Issue #8)

**Files:**
- Modify: `container/agent-runner/src/index.ts:47-67`

- [ ] **Step 1: HOMEを/home/agentに固定**

`container/agent-runner/src/index.ts` を修正:

```typescript
const repoDir = '/workspace/repo';
const workDir = existsSync(repoDir) ? repoDir : `/workspace/groups/${input.groupFolder}`;
const agentHome = '/home/agent';

const result = spawnSync('claude', args, {
  cwd: workDir,
  encoding: 'utf-8',
  timeout: (input.timeout ?? 300) * 1000,
  input: prompt,
  env: { ...process.env, HOME: agentHome },
  stdio: ['pipe', 'pipe', 'pipe'],
});
```

- [ ] **Step 2: Dockerfileで/home/agentに書き込み権限があることを確認**

`container/Dockerfile` に追加（USER agent の前）:

```dockerfile
RUN chown -R agent:agent /home/agent
```

- [ ] **Step 3: コミット**

```bash
git add container/agent-runner/src/index.ts container/Dockerfile
git commit -m "fix(security): fix HOME to /home/agent instead of workspace (#8)"
```

---

### Task 4: workspaceDir パス検証 (Issue #5)

**Files:**
- Modify: `src/config.ts:36`
- Create: `src/__tests__/config.test.ts`

- [ ] **Step 1: Config.validateWorkspaceDir のテストを書く**

新規 `src/__tests__/config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateWorkspacePath } from '../config.js';

describe('validateWorkspacePath', () => {
  it('accepts a normal relative path', () => {
    expect(() => validateWorkspacePath('/home/user/projects/repo')).not.toThrow();
  });

  it('rejects root path', () => {
    expect(() => validateWorkspacePath('/')).toThrow('dangerous');
  });

  it('rejects home directory itself', () => {
    expect(() => validateWorkspacePath('/Users/shingo')).toThrow('dangerous');
    expect(() => validateWorkspacePath('/root')).toThrow('dangerous');
  });

  it('rejects /etc', () => {
    expect(() => validateWorkspacePath('/etc')).toThrow('dangerous');
  });

  it('rejects /var', () => {
    expect(() => validateWorkspacePath('/var')).toThrow('dangerous');
  });

  it('accepts subdirectory of home', () => {
    expect(() => validateWorkspacePath('/Users/shingo/projects/warsclaw')).not.toThrow();
  });

  it('accepts undefined (no workspace)', () => {
    expect(() => validateWorkspacePath(undefined)).not.toThrow();
  });
});
```

- [ ] **Step 2: テストがFAILすることを確認**

Run: `npx vitest run src/__tests__/config.test.ts`
Expected: FAIL — `validateWorkspacePath` not exported

- [ ] **Step 3: config.tsにvalidateWorkspacePathを実装**

`src/config.ts` に追加:

```typescript
const DANGEROUS_PATHS = ['/', '/etc', '/var', '/usr', '/bin', '/sbin', '/tmp', '/root'];

export function validateWorkspacePath(p: string | undefined): void {
  if (p === undefined) return;
  const resolved = resolve(p);
  if (DANGEROUS_PATHS.includes(resolved)) {
    throw new Error(`workspaceDir is a dangerous path: ${resolved}`);
  }
  // Reject home directory itself (but allow subdirs)
  const home = process.env.HOME;
  if (home && resolved === resolve(home)) {
    throw new Error(`workspaceDir is a dangerous path: ${resolved} (home directory)`);
  }
  // Must be at least 2 levels deep
  const parts = resolved.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`workspaceDir is a dangerous path: ${resolved} (too shallow)`);
  }
}
```

Configコンストラクタ内で呼び出し:

```typescript
this.workspaceDir = env.WARSCLAW_WORKSPACE_DIR ? resolve(env.WARSCLAW_WORKSPACE_DIR) : undefined;
validateWorkspacePath(this.workspaceDir);
```

- [ ] **Step 4: テストがPASSすることを確認**

Run: `npx vitest run src/__tests__/config.test.ts`
Expected: ALL PASS

- [ ] **Step 5: コミット**

```bash
git add src/config.ts src/__tests__/config.test.ts
git commit -m "fix(security): validate workspaceDir to reject dangerous host paths (#5)"
```

---

### Task 5: SQLiteファイルパーミッション (Issue #10)

**Files:**
- Modify: `src/index.ts:25-27`

- [ ] **Step 1: mkdirSyncにmode追加**

`src/index.ts` のディレクトリ作成を修正:

```typescript
// Ensure directories with restricted permissions
for (const dir of [config.dataDir, config.groupsDir, config.ipcDir]) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}
```

- [ ] **Step 2: DB作成後にファイルパーミッションを設定**

`src/index.ts` の `db.init()` の後に追加:

```typescript
import { chmodSync } from 'node:fs';

// ... after db.init():
try { chmodSync(config.dbPath, 0o600); } catch { /* first run, file may not exist yet */ }
```

- [ ] **Step 3: テスト実行**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: コミット**

```bash
git add src/index.ts
git commit -m "fix(security): set restrictive permissions on data dir and SQLite DB (#10)"
```

---

### Task 6: Sender Allowlist によるプロンプトインジェクション緩和 (Issue #3)

**Files:**
- Modify: `src/config.ts`
- Modify: `src/index.ts:102-148`
- Modify: `src/__tests__/validation.test.ts`

- [ ] **Step 1: config.tsにallowedSenders設定を追加**

`src/config.ts` のConfigクラスにフィールド追加:

```typescript
readonly allowedSenders: Set<string>;
readonly allowedChannels: Set<string>;
```

コンストラクタ内:

```typescript
this.allowedSenders = new Set(
  (env.WARSCLAW_ALLOWED_SENDERS ?? '').split(',').map(s => s.trim()).filter(Boolean)
);
this.allowedChannels = new Set(
  (env.WARSCLAW_ALLOWED_CHANNELS ?? '').split(',').map(s => s.trim()).filter(Boolean)
);
```

- [ ] **Step 2: index.tsにsender/channelフィルタを追加**

`src/index.ts` の `onInboundMessage` コールバック内、`db.storeMessage(msg)` の後に追加:

```typescript
// Allowlist check (empty = allow all for backward compat)
if (config.allowedChannels.size > 0 && !config.allowedChannels.has(msg.chat_jid)) {
  logger.debug({ chatJid: msg.chat_jid }, 'Channel not in allowlist, skipping');
  return;
}
if (config.allowedSenders.size > 0 && !config.allowedSenders.has(msg.sender)) {
  logger.debug({ sender: msg.sender }, 'Sender not in allowlist, skipping');
  return;
}
```

- [ ] **Step 3: .env.exampleにドキュメント追加**

```
# Allowlist (comma-separated, empty = allow all)
# WARSCLAW_ALLOWED_SENDERS=U12345678,U87654321
# WARSCLAW_ALLOWED_CHANNELS=slack_C12345678,discord_123456789
```

- [ ] **Step 4: テスト実行**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 5: コミット**

```bash
git add src/config.ts src/index.ts .env.example
git commit -m "feat(security): add sender/channel allowlist for prompt injection mitigation (#3)"
```

---

### Task 7: IPCアトミックファイル処理 (Issue #9)

**Files:**
- Modify: `src/ipc.ts:38-59`
- Create: `src/__tests__/ipc.test.ts`

- [ ] **Step 1: アトミック処理のテストを書く**

新規 `src/__tests__/ipc.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { IpcWatcher } from '../ipc.js';

const TEST_IPC_DIR = join(import.meta.dirname, '../../.test-ipc');

function createTestDeps() {
  return {
    db: { registerGroup: vi.fn() },
    router: { routeOutbound: vi.fn(async () => {}) },
    scheduler: { createTask: vi.fn(), pauseTask: vi.fn(), resumeTask: vi.fn(), cancelTask: vi.fn(), updateTask: vi.fn() },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ipcDir: TEST_IPC_DIR,
  };
}

describe('IpcWatcher', () => {
  beforeEach(() => {
    mkdirSync(join(TEST_IPC_DIR, 'messages'), { recursive: true });
    mkdirSync(join(TEST_IPC_DIR, 'tasks'), { recursive: true });
    mkdirSync(join(TEST_IPC_DIR, 'processing'), { recursive: true });
    mkdirSync(join(TEST_IPC_DIR, 'errors'), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_IPC_DIR, { recursive: true, force: true });
  });

  it('ignores .tmp files (not yet atomically renamed)', async () => {
    const deps = createTestDeps();
    const watcher = new IpcWatcher(deps as any);
    writeFileSync(join(TEST_IPC_DIR, 'messages', 'pending.json.tmp'), JSON.stringify({ type: 'message', chatJid: 'slack_123', text: 'hi' }));
    await watcher.processFiles();
    expect(deps.router.routeOutbound).not.toHaveBeenCalled();
  });

  it('processes valid .json files', async () => {
    const deps = createTestDeps();
    const watcher = new IpcWatcher(deps as any);
    writeFileSync(join(TEST_IPC_DIR, 'messages', 'msg1.json'), JSON.stringify({ type: 'message', chatJid: 'slack_123', text: 'hello' }));
    await watcher.processFiles();
    expect(deps.router.routeOutbound).toHaveBeenCalledWith('slack_123', 'hello');
  });

  it('quarantines invalid JSON', async () => {
    const deps = createTestDeps();
    const watcher = new IpcWatcher(deps as any);
    writeFileSync(join(TEST_IPC_DIR, 'messages', 'bad.json'), 'not json');
    await watcher.processFiles();
    expect(existsSync(join(TEST_IPC_DIR, 'errors', 'bad.json'))).toBe(true);
  });
});
```

- [ ] **Step 2: テストがFAILすることを確認**

Run: `npx vitest run src/__tests__/ipc.test.ts`
Expected: .tmp テストがFAIL（現在は .tmp ファイルを除外していない）

- [ ] **Step 3: ipc.tsにアトミック処理を実装**

`src/ipc.ts` の `processDir` を修正:

```typescript
private async processDir(dir: string, type: 'message' | 'task'): Promise<void> {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    this.deps.logger.error({ dir, type }, `Failed to read IPC dir: ${(err as Error).message}`);
    return;
  }

  await Promise.allSettled(files.map((file) => this.processFile(join(dir, file), file, type)));
}
```

- [ ] **Step 4: テストがPASSすることを確認**

Run: `npx vitest run src/__tests__/ipc.test.ts`
Expected: ALL PASS

- [ ] **Step 5: コミット**

```bash
git add src/ipc.ts src/__tests__/ipc.test.ts
git commit -m "fix(security): atomic IPC file processing, ignore .tmp files (#9)"
```

---

### Task 8: IPC コマンド認証 (Issue #4)

**Files:**
- Modify: `src/ipc.ts`
- Modify: `src/config.ts`
- Modify: `src/types.ts`
- Modify: `src/__tests__/ipc.test.ts`

- [ ] **Step 1: HMAC署名検証のテストを書く**

`src/__tests__/ipc.test.ts` に追加:

```typescript
import { createHmac } from 'node:crypto';
import { verifyIpcSignature } from '../ipc.js';

describe('IPC signature verification', () => {
  const secret = 'test-secret-key-32chars-minimum!';

  it('accepts valid HMAC signature', () => {
    const payload = JSON.stringify({ type: 'pause_task', taskId: 'abc' });
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifyIpcSignature(payload, sig, secret)).toBe(true);
  });

  it('rejects invalid signature', () => {
    const payload = JSON.stringify({ type: 'pause_task', taskId: 'abc' });
    expect(verifyIpcSignature(payload, 'invalid', secret)).toBe(false);
  });

  it('rejects tampered payload', () => {
    const payload = JSON.stringify({ type: 'pause_task', taskId: 'abc' });
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    const tampered = JSON.stringify({ type: 'cancel_task', taskId: 'abc' });
    expect(verifyIpcSignature(tampered, sig, secret)).toBe(false);
  });
});
```

- [ ] **Step 2: ipc.tsに署名検証をexport**

`src/ipc.ts` に追加:

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyIpcSignature(payload: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature, 'utf-8'), Buffer.from(expected, 'utf-8'));
}
```

- [ ] **Step 3: processFileに署名検証を組み込み**

`src/ipc.ts` の `processFile` を修正:

```typescript
private async processFile(filePath: string, fileName: string, type: 'message' | 'task'): Promise<void> {
  try {
    const rawContent = readFileSync(filePath, 'utf-8');
    const raw = JSON.parse(rawContent);

    // Signature verification (if IPC secret is configured)
    if (this.deps.ipcSecret) {
      const sig = raw.__sig;
      if (!sig || typeof sig !== 'string') {
        throw new Error('Missing IPC signature');
      }
      const { __sig: _, ...payload } = raw;
      if (!verifyIpcSignature(JSON.stringify(payload), sig, this.deps.ipcSecret)) {
        throw new Error('Invalid IPC signature');
      }
      if (type === 'message') {
        await this.handleMessage(payload);
      } else {
        await this.handleTask(payload);
      }
    } else {
      if (type === 'message') {
        await this.handleMessage(raw);
      } else {
        await this.handleTask(raw);
      }
    }
    unlinkSync(filePath);
  } catch (err) {
    this.deps.logger.error({ file: fileName, type }, `IPC processing failed: ${(err as Error).message}`);
    this.quarantine(filePath, fileName);
  }
}
```

- [ ] **Step 4: IpcDepsにipcSecretを追加**

`src/types.ts` の `IpcDeps` を修正:

```typescript
export interface IpcDeps {
  db: import('./db.js').Database;
  router: import('./router.js').Router;
  scheduler: import('./task-scheduler.js').TaskScheduler;
  logger: import('./logger.js').Logger;
  ipcDir: string;
  ipcSecret?: string;
}
```

- [ ] **Step 5: config.tsにWARSCLAW_IPC_SECRETを追加**

`src/config.ts` に追加:

```typescript
readonly ipcSecret: string | undefined;
```

コンストラクタ内:

```typescript
this.ipcSecret = env.WARSCLAW_IPC_SECRET || undefined;
```

- [ ] **Step 6: index.tsでipcSecretを渡す**

`src/index.ts` の IpcWatcher 初期化を修正:

```typescript
const ipcWatcher = new IpcWatcher({ db, router, scheduler, logger, ipcDir: config.ipcDir, ipcSecret: config.ipcSecret });
```

- [ ] **Step 7: .env.exampleにドキュメント追加**

```
# IPC command signing (optional, recommended for production)
# WARSCLAW_IPC_SECRET=your-32-char-secret-here
```

- [ ] **Step 8: テスト実行**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 9: コミット**

```bash
git add src/ipc.ts src/types.ts src/config.ts src/index.ts src/__tests__/ipc.test.ts .env.example
git commit -m "feat(security): add HMAC signature verification for IPC commands (#4)"
```

---

## Verification

全タスク完了後に実施:

- [ ] `npx vitest run` — 全テストPASS
- [ ] `npx tsc --noEmit` — 型チェックPASS
- [ ] `npm run lint` — lint PASS (設定済みの場合)
- [ ] 各Issueに修正コミットのSHAをコメント
