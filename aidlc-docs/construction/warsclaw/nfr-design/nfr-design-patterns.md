# NFR Design Patterns - WarsClaw

## Pattern 1: Container Sandbox (Security)

**NFR**: NFR-01.1 Container Isolation

**Pattern**: 各エージェント実行を使い捨てDockerコンテナで隔離。

```
┌─────────────────────────────────┐
│ Host (WarsClaw Main Process)      │
│  ┌───────────────────────────┐  │
│  │ Docker Container (--rm)   │  │
│  │  /workspace (RO)          │  │
│  │  /workspace/groups/X (RW) │  │
│  │  /workspace/ipc (RW)      │  │
│  │  .env → /dev/null         │  │
│  │  claude CLI execution     │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

**実装**:
```typescript
const dockerArgs = [
  'run', '--rm',
  '-v', `${projectRoot}:/workspace:ro`,
  '-v', `${groupFolder}:/workspace/groups/${name}:rw`,
  '-v', `${ipcDir}:/workspace/ipc:rw`,
  '-v', '/dev/null:/workspace/.env:ro',
  '-e', `ANTHROPIC_API_KEY=${apiKey}`,
  '--memory=512m',
  '--cpus=1',
  config.dockerImage
];
```

**Security Controls**:
- `--rm`: コンテナ自動削除
- `:ro` / `:rw`: 最小権限マウント
- `.env` シャドウイング: シークレット漏洩防止
- `--memory` / `--cpus`: リソース制限
- 環境変数最小化: ANTHROPIC_API_KEY のみ

---

## Pattern 2: Exponential Backoff Retry (Reliability)

**NFR**: NFR-03.1 Fault Tolerance

**Pattern**: コンテナ失敗時の段階的リトライ。

```
Attempt 1 → fail → wait 5s
Attempt 2 → fail → wait 10s
Attempt 3 → fail → wait 20s
Attempt 4 → fail → wait 40s
Attempt 5 → fail → give up → error message to channel
```

**実装**:
```typescript
function getBackoffMs(retryCount: number): number {
  return 5000 * Math.pow(2, retryCount - 1);
}
```

---

## Pattern 3: Per-Group FIFO with Global Semaphore (Performance/Reliability)

**NFR**: NFR-02.2 Concurrency

**Pattern**: グループ内直列 + グループ間並列 + グローバル上限。

```
Global Semaphore (max=5)
  ├── Group A Queue: [msg1] → [msg2] → [msg3]  (serial)
  ├── Group B Queue: [msg1] → [msg2]            (serial)
  ├── Group C Queue: [msg1]                      (serial)
  └── (parallel across groups, up to 5 total)
```

**実装**:
```typescript
class GroupQueue {
  private queues = new Map<string, QueueTask[]>();
  private activeCount = 0;
  private readonly maxConcurrent: number;

  async processNext(): Promise<void> {
    if (this.activeCount >= this.maxConcurrent) return;
    // find group with pending tasks and no active container
    // increment activeCount, spawn container
    // on complete: decrement, process next
  }
}
```

---

## Pattern 4: Marker-Based Output Extraction (Reliability)

**NFR**: NFR-03.1 Fault Tolerance

**Pattern**: コンソールノイズの中からエージェント出力を確実に抽出。

```
[container stdout]
npm WARN deprecated ...
Loading claude...
<<<OUTPUT_START>>>
{"status":"success","result":"Hello!","newSessionId":"abc123"}
<<<OUTPUT_END>>>
```

**実装**:
```typescript
const OUTPUT_START = '<<<OUTPUT_START>>>';
const OUTPUT_END = '<<<OUTPUT_END>>>';

function parseOutput(stdout: string): ContainerOutput {
  const startIdx = stdout.indexOf(OUTPUT_START);
  const endIdx = stdout.indexOf(OUTPUT_END);
  if (startIdx === -1 || endIdx === -1) throw new Error('Missing markers');
  const json = stdout.slice(startIdx + OUTPUT_START.length, endIdx).trim();
  return JSON.parse(json);
}
```

---

## Pattern 5: Cursor-Based Message Recovery (Reliability)

**NFR**: NFR-03.2 Recovery

**Pattern**: RouterState のカーソルで再起動後にメッセージ処理を再開。

```
RouterState: { chat_jid: "discord_123", last_processed: 1711700000 }
                                                          ↑
Restart → poll messages since this timestamp → no duplicates
```

**実装**:
- 各 chat_jid ごとに `last_processed_timestamp` を保持
- ポーリング時に `WHERE timestamp > last_processed` で取得
- 処理完了後にカーソル更新

---

## Pattern 6: Error Quarantine (Reliability)

**NFR**: NFR-03.1 Fault Tolerance

**Pattern**: IPC処理失敗時にファイルをエラーディレクトリに隔離。データ消失を防ぎ、事後調査を可能にする。

```
/workspace/ipc/
├── messages/     # 正常待ちファイル
├── tasks/        # 正常待ちファイル
└── errors/       # 処理失敗ファイル (手動確認用)
    ├── msg_001.json
    └── task_002.json
```

---

## Pattern 7: Input Validation Gateway (Security)

**NFR**: NFR-01.3 Input Validation (SECURITY-05)

**Pattern**: Zod スキーマで全入力ポイントをバリデーション。

```typescript
// IPC task schema
const IpcTaskSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('schedule_task'),
    prompt: z.string().min(1).max(10000),
    schedule_type: z.enum(['cron', 'interval', 'once']),
    schedule_value: z.string().min(1),
    targetJid: z.string().min(1),
  }),
  z.object({
    type: z.literal('pause_task'),
    taskId: z.string().uuid(),
  }),
  // ...
]);

// Group folder name schema
const GroupFolderSchema = z.string()
  .regex(/^[a-zA-Z0-9_-]+$/)
  .max(64)
  .refine(name => !['main', 'global', '.', '..'].includes(name));
```

---

## Pattern 8: Structured Context Logging (Observability)

**NFR**: NFR-01.5 / NFR-05.3 / SECURITY-03

**Pattern**: 全ログエントリにコンテキストオブジェクトを付与。

```typescript
logger.info({ groupFolder: 'dev-team', chatJid: 'discord_123', taskId: 'abc' },
  'Container started');

// Output: {"timestamp":"2026-03-29T16:00:00Z","level":"info",
//          "groupFolder":"dev-team","chatJid":"discord_123",
//          "taskId":"abc","message":"Container started"}
```

**Secret Masking**:
```typescript
function maskSecret(value: string): string {
  if (value.length <= 8) return '***';
  return value.slice(0, 4) + '...' + value.slice(-4);
}
```

---

## Pattern 9: Graceful Shutdown Orchestration (Reliability)

**NFR**: NFR-03.2 / BR-07

**Pattern**: シグナルハンドリングによる段階的停止。

```
SIGTERM received
  → Set running = false (stop polling loop)
  → Stop accepting new queue items
  → Wait for active containers (with timeout)
  → Stop IPC watcher
  → Disconnect channels
  → Close database
  → Exit 0

Second SIGTERM
  → Force exit (containers auto-cleaned by --rm)
```
