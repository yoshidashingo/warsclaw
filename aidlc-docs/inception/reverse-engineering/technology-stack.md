# Technology Stack

## Programming Languages

| Language | Version | Usage |
|----------|---------|-------|
| TypeScript | 5.7-6.0+ | メインコードベース (両プロジェクト) |
| Swift | - | OpenClaw iOS/macOS/SharedKit |
| Kotlin | - | OpenClaw Android |

## Frameworks & Libraries

### AI / Agent
| Framework | Version | Purpose | Project |
|-----------|---------|---------|---------|
| @mariozechner/pi-agent-core | 0.63.1 | AIエージェントフレームワーク | OpenClaw |
| @anthropic-ai/claude-code | - | Claude Agent SDK | NanoClaw |
| @modelcontextprotocol/sdk | 1.28.0 | MCP対応 | OpenClaw |
| @agentclientprotocol/sdk | 0.17.0 | ACP (エージェントRPC) | OpenClaw |

### Messaging
| Library | Version | Purpose | Project |
|---------|---------|---------|---------|
| discord.js | - | Discord統合 | 両方 |
| @slack/bolt | - | Slack統合 | 両方 |
| matrix-js-sdk | 41.2.0 | Matrix Protocol | OpenClaw |
| @signalapp/libsignal | - | Signal統合 | OpenClaw |

### Runtime & Server
| Library | Version | Purpose | Project |
|---------|---------|---------|---------|
| ws | 8.20.0 | WebSocket | OpenClaw |
| express | 5.2.1 | HTTPサーバー | OpenClaw |
| hono | 4.12.9 | Edgeランタイム | OpenClaw |
| better-sqlite3 | 11.10.0 | SQLiteドライバ | NanoClaw |

### Utilities
| Library | Version | Purpose | Project |
|---------|---------|---------|---------|
| zod | 4.3.6 | ランタイム型バリデーション | OpenClaw |
| sharp | 0.34.5 | 画像処理 | OpenClaw |
| cron-parser | 5.5.0 | cronパース | NanoClaw |
| playwright-core | 1.58.2 | ブラウザ自動化 | OpenClaw |

## Infrastructure

| Service | Purpose | Project |
|---------|---------|---------|
| Docker | エージェントコンテナ隔離 | NanoClaw |
| Node.js 20-22+ | ランタイム | 両方 |
| launchd / systemd | サービス管理 | 両方 |
| TLS (Node.js native) | Gateway暗号化 | OpenClaw |

## Build Tools

| Tool | Version | Purpose | Project |
|------|---------|---------|---------|
| pnpm | - | パッケージマネージャ (monorepo) | OpenClaw |
| npm | - | パッケージマネージャ | NanoClaw |
| tsc | - | TypeScriptコンパイラ | 両方 |
| tsdown | - | バンドラー | OpenClaw |
| tsx | - | TypeScript直接実行 | NanoClaw |

## Testing Tools

| Tool | Version | Purpose | Project |
|------|---------|---------|---------|
| Vitest | 4.0+ | ユニット/統合テスト | 両方 |
| V8 coverage | - | カバレッジ (70%閾値) | OpenClaw |

## Linting & Formatting

| Tool | Purpose | Project |
|------|---------|---------|
| Oxlint | 型認識lint (Rust製) | OpenClaw |
| Oxfmt | フォーマッタ (Rust製) | OpenClaw |
| ESLint | 静的解析 | NanoClaw |
| Prettier | フォーマッタ | NanoClaw |
| Husky | Gitフック | NanoClaw |

## Code Quality Tools

| Tool | Purpose | Project |
|------|---------|---------|
| knip | デッドコード検出 | OpenClaw |
| ts-prune | 未使用エクスポート検出 | OpenClaw |
| jscpd | コード重複検出 | OpenClaw |
