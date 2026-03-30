# System Architecture

## System Overview

OpenClawとNanoClawは同じドメイン（パーソナルAIエージェント）の異なるアプローチ：

| 特性 | OpenClaw | NanoClaw |
|------|----------|----------|
| アーキテクチャ | WebSocket RPC Gateway | Polling Loop + Docker |
| 規模 | 60,000+ LOC | ~3,000 LOC |
| チャネル数 | 23+ | 5 (Discord, Slack, Gmail, Telegram, WhatsApp) |
| エージェント実行 | pi-agent-core + ACP spawn | Claude Agent SDK in Docker |
| 状態管理 | YAML config + セッション | SQLite |
| ネイティブアプリ | iOS, macOS, Android | なし |
| プラグインシステム | Plugin SDK (60+ exports) | Skill system |

## Architecture Diagram - OpenClaw

```mermaid
graph TB
    subgraph Clients
        CLI[CLI Client]
        WEB[Web UI]
        IOS[iOS App]
        MAC[macOS App]
        AND[Android App]
    end

    subgraph Gateway["Gateway (localhost:18789)"]
        WS[WebSocket RPC Server]
        AUTH[Auth & TLS]
        SESS[Session Manager]
        ROUTE[Message Router]
    end

    subgraph Agents
        SPAWN[ACP Spawn]
        PI[pi-agent-core]
        TOOLS[Tool System]
    end

    subgraph Extensions["Extensions (92+)"]
        CH_D[Discord]
        CH_S[Slack]
        CH_T[Telegram]
        CH_W[WhatsApp]
        CH_MORE[...]
    end

    subgraph Providers
        CLAUDE[Claude]
        GPT[OpenAI]
        LOCAL[Ollama/vLLM]
        BEDROCK[AWS Bedrock]
    end

    CLI & WEB & IOS & MAC & AND --> WS
    WS --> AUTH --> SESS --> ROUTE
    ROUTE --> SPAWN --> PI
    PI --> TOOLS
    PI --> CLAUDE & GPT & LOCAL & BEDROCK
    ROUTE --> CH_D & CH_S & CH_T & CH_W & CH_MORE
```

## Architecture Diagram - NanoClaw

```mermaid
graph TB
    subgraph Channels
        DC[Discord]
        SL[Slack]
        TG[Telegram]
        WA[WhatsApp]
        GM[Gmail]
    end

    subgraph Core["Main Process"]
        POLL[Polling Loop 2s]
        GQ[Group Queue FIFO]
        RT[Router]
        IPC[IPC Watcher]
        SCHED[Task Scheduler]
    end

    subgraph Storage
        DB[(SQLite)]
        FS[Groups Folders]
    end

    subgraph Container["Docker Container"]
        AGENT[Claude Agent SDK]
        BROWSER[Chromium]
        IPC_OUT[IPC Output]
    end

    Channels --> POLL
    POLL --> GQ
    GQ --> Container
    AGENT --> IPC_OUT --> IPC
    IPC --> RT --> Channels
    SCHED --> GQ
    DB --- Core
    FS --- Container
```

## Data Flow

```mermaid
sequenceDiagram
    participant User
    participant Channel as Messaging Channel
    participant Router as Message Router
    participant Queue as Group Queue
    participant Agent as AI Agent
    participant DB as State Store

    User->>Channel: メッセージ送信
    Channel->>Router: ポーリング/Webhook で受信
    Router->>DB: メッセージ保存
    Router->>Queue: グループキューに追加
    Queue->>Agent: エージェント起動 (コンテキスト注入)
    Agent->>Agent: LLM処理 + ツール使用
    Agent->>Router: レスポンス返却
    Router->>DB: レスポンス保存
    Router->>Channel: 送信
    Channel->>User: レスポンス表示
```

## Integration Points

- **External APIs**: 各メッセージングプラットフォームAPI (Discord.js, Slack Bolt, WhatsApp Business API等)
- **AI Providers**: Anthropic Claude, OpenAI, Google Gemini, AWS Bedrock, Ollama, vLLM等
- **Databases**: SQLite (NanoClaw), YAML + ファイルシステム (OpenClaw)
- **Third-party Services**: Edge TTS, Web検索, ブラウザ自動化 (Playwright/Chromium)

## Infrastructure Components

- **OpenClaw**: ローカルデバイス上のNode.jsプロセス、TLS対応WebSocket Gateway
- **NanoClaw**: Node.jsメインプロセス + Docker コンテナ (エージェント隔離)
- **Deployment**: launchd (macOS), systemd (Linux)
