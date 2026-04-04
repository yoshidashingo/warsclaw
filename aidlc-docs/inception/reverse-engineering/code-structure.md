# Code Structure

## Build System

### OpenClaw
- **Type**: pnpm workspaces (monorepo)
- **Configuration**: package.json, pnpm-workspace.yaml, tsconfig.json, tsdown.config.ts
- **Build**: TypeScript compiler (tsc) + tsdown bundler
- **Key scripts**: pnpm build, pnpm dev, pnpm test, pnpm lint

### NanoClaw
- **Type**: npm (single package)
- **Configuration**: package.json, tsconfig.json
- **Build**: TypeScript compiler (tsc)
- **Key scripts**: npm run build, npm run dev, npm run test

## Key Classes/Modules

### OpenClaw Module Hierarchy

```
src/
├── gateway/          # WebSocket RPC制御プレーン (~200 files)
│   ├── call.ts       # RPC呼び出しハンドラ
│   ├── server.ts     # WebSocketサーバー
│   └── methods/      # RPCメソッド定義
├── agents/           # AIエージェントランタイム (~650 files)
│   ├── agent-command.ts  # エージェント起動
│   └── acp-spawn/    # Agent Client Protocol
├── plugin-sdk/       # プラグイン公開API (~325 files)
│   ├── core.ts       # コア型定義
│   ├── channel-contract.ts  # チャネルインターフェース
│   └── index.ts      # 60+ subpath exports
├── channels/         # チャネル抽象レイヤー
├── sessions/         # セッションライフサイクル
├── config/           # YAML設定管理
├── security/         # 認証・ペアリング
├── routing/          # メッセージルーティング
├── mcp/              # Model Context Protocol統合
├── media/            # メディアパイプライン
├── memory/           # 知識永続化
├── context-engine/   # ベクトル埋め込み & RAG
└── flows/            # フロー実行エンジン
```

### NanoClaw Module Hierarchy

```
src/
├── index.ts              # オーケストレータ (メインループ)
├── types.ts              # 全型定義
├── config.ts             # 環境設定
├── db.ts                 # SQLiteスキーマ & クエリ
├── router.ts             # メッセージフォーマット & ルーティング
├── container-runner.ts   # Docker コンテナ実行
├── group-queue.ts        # グループ単位FIFOキュー
├── ipc.ts                # ファイルシステムIPC
├── task-scheduler.ts     # スケジュール管理
├── group-folder.ts       # フォルダバリデーション
├── logger.ts             # 構造化ログ
├── channels/
│   ├── registry.ts       # チャネルファクトリ
│   ├── discord.ts        # Discord実装
│   └── slack.ts          # Slack実装
└── skills/               # 拡張スキル
```

### Existing Files Inventory (NanoClaw - WarsClaw参考用)

- `src/index.ts` - メインオーケストレータ、チャネル初期化、ポーリングループ
- `src/types.ts` - Channel, NewMessage, ScheduledTask等の型定義
- `src/config.ts` - 環境変数、パス、デフォルト値
- `src/db.ts` - SQLiteスキーマ初期化、CRUD操作
- `src/router.ts` - XMLエンコード、チャネルルーティング
- `src/container-runner.ts` - Docker spawn、ボリュームマウント、出力パース
- `src/group-queue.ts` - FIFO + グローバル並行制御
- `src/ipc.ts` - JSON ファイル監視、タスク/メッセージ処理
- `src/task-scheduler.ts` - cron解析、next_run計算
- `src/channels/registry.ts` - チャネルファクトリパターン
- `src/channels/discord.ts` - Discord.js統合
- `src/channels/slack.ts` - @slack/bolt統合

## Design Patterns

### Plugin/Channel Contract Pattern (OpenClaw)
- **Location**: src/plugin-sdk/channel-contract.ts
- **Purpose**: チャネル統合の標準化
- **Implementation**: TypeScriptインターフェースで60+のサブパスエクスポート

### Factory Pattern (NanoClaw)
- **Location**: src/channels/registry.ts
- **Purpose**: プラグイン可能なチャネル登録
- **Implementation**: `ChannelFactory = (opts) => Channel | null`

### Polling Loop Pattern (NanoClaw)
- **Location**: src/index.ts
- **Purpose**: イベント駆動の代わりにシンプルなポーリング
- **Implementation**: 2秒間隔でチャネルをポーリング

### Per-Group Queue with Global Concurrency (NanoClaw)
- **Location**: src/group-queue.ts
- **Purpose**: リソース枯渇防止
- **Implementation**: グループごとFIFO + グローバル最大5並行

### Marker-Based Output Parsing (NanoClaw)
- **Location**: src/container-runner.ts
- **Purpose**: コンソールノイズの中からエージェント出力を確実に抽出
- **Implementation**: `<<<OUTPUT_START>>>` / `<<<OUTPUT_END>>>` マーカー

### Filesystem IPC (NanoClaw)
- **Location**: src/ipc.ts
- **Purpose**: コンテナとメインプロセス間の通信
- **Implementation**: /workspace/ipc/ にJSONファイルを書き込み、1秒ポーリング

## Critical Dependencies

### OpenClaw
- **@mariozechner/pi-agent-core** (0.63.1) - AIエージェントフレームワーク
- **@modelcontextprotocol/sdk** (1.28.0) - MCP対応
- **@agentclientprotocol/sdk** (0.17.0) - ACP (エージェントRPC)
- **ws** (8.20.0) - WebSocket
- **zod** (4.3.6) - ランタイム型バリデーション
- **sharp** (0.34.5) - 画像処理

### NanoClaw
- **@anthropic-ai/claude-code** - Claude Agent SDK
- **better-sqlite3** (11.10.0) - SQLiteドライバ
- **cron-parser** (5.5.0) - cronパース
- **discord.js** - Discord統合
- **@slack/bolt** - Slack統合
