# API Documentation

## OpenClaw - Gateway RPC Protocol

### Connection
- **Protocol**: WebSocket (`ws://localhost:18789`)
- **TLS**: 対応（デバイスID証明書）
- **認証**: トークンベース（オペレータースコープ）、パスワード、TLSフィンガープリント

### Method Invocation
```typescript
{
  id: string;
  method: string;           // e.g., "agent.chat", "config.get"
  params?: Record<string, any>;
  mode?: GatewayClientMode; // "cli", "ui", "companion"
}
```

### Streaming Response
```typescript
{
  id: string;
  data: {
    blocks?: Array<ContentBlock>;  // レスポンスチャンク
    tools?: ToolInvocation[];       // 並列ツール呼び出し
    final?: boolean;
  }
}
```

### Key RPC Methods
- `agent.chat` - エージェントにメッセージ送信
- `config.get/set` - 設定管理
- `channel.pair` - チャネルペアリング
- `session.list` - セッション一覧

## NanoClaw - Internal APIs

### Channel Interface
```typescript
interface Channel {
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
  syncGroups?(isForce: boolean): Promise<void>;
  onInboundMessage?(callback: (msg: NewMessage) => void): void;
  onChatMetadata?(callback: (jid: string, name: string, metadata: any) => void): void;
}
```

### Message Model
```typescript
interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: number;
  is_from_me: boolean;
  is_bot_message: boolean;
}
```

### Scheduled Task Model
```typescript
interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  script: string | null;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
}
```

### Container I/O
```typescript
// Input (stdin)
interface ContainerInput {
  prompt: string;
  sessionId: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask: boolean;
  assistantName: string;
  script?: string;
}

// Output (stdout)
interface ContainerOutput {
  status: 'success' | 'error';
  result: string;
  newSessionId?: string;
  error?: string;
}
```

### IPC Task Types
| Type | Purpose | Required Fields |
|------|---------|----------------|
| schedule_task | タスク作成 | prompt, schedule_type, schedule_value, targetJid |
| pause_task | タスク一時停止 | taskId |
| resume_task | タスク再開 | taskId |
| cancel_task | タスク削除 | taskId |
| update_task | タスク更新 | taskId, optional fields |
| refresh_groups | グループメタデータ更新 | (main group only) |
| register_group | グループ登録 | jid, name, folder, trigger |

### Database Query Functions
- `initDatabase()` - スキーマ初期化/マイグレーション
- `storeMessage(msg)` - メッセージ永続化
- `getNewMessages(chatJid, since)` - カーソル以降のメッセージ取得
- `getLastBotMessageTimestamp(chatJid)` - ポーリングカーソル取得
- `getAllTasks()` / `getDueTasks()` - タスク取得
- `createTask(task)` / `updateTask(id, updates)` / `deleteTask(id)` - タスクCRUD
- `logTaskRun(log)` - 実行ログ記録

## Data Models

### OpenClaw Plugin SDK Exports (60+ subpaths)
- `openclaw/plugin-sdk` - メインファサード
- `openclaw/plugin-sdk/core` - チャネル・プラグインインターフェース
- `openclaw/plugin-sdk/runtime` - ランタイムヘルパー
- `openclaw/plugin-sdk/setup` - セットアップワークフロー
- `openclaw/plugin-sdk/config-runtime` - 設定管理
- `openclaw/plugin-sdk/sandbox` - サンドボックス実行

### NanoClaw SQLite Schema
- **messages** - chat_jid, sender, content, timestamp
- **chat_metadata** - JID, name, last_activity
- **scheduled_tasks** - cron/interval/once, next_run, status
- **task_run_logs** - 実行履歴
- **sessions** - エージェント状態スナップショット
- **registered_groups** - メタデータ、コンテナ設定
- **router_state** - 最終処理タイムスタンプ
