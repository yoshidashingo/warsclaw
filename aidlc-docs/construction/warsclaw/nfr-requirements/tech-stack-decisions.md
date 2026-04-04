# Tech Stack Decisions - WarsClaw

## Final Tech Stack

| Category | Decision | Rationale |
|----------|----------|-----------|
| **Language** | TypeScript 5.7+ (strict) | 型安全性、OpenClaw/NanoClaw と同一 |
| **Runtime** | Node.js 22 LTS | 最新LTS、Docker公式イメージ利用可能 |
| **Package Manager** | npm | 最小構成、NanoClaw と同一 |
| **Agent Runtime** | Claude Code CLI | claude CLI をDocker内で stdin/stdout 実行 |
| **Container** | Docker (node:22-slim base) | エージェント隔離、Chromium同梱可能 |
| **Database** | SQLite via better-sqlite3 | 同期API、単一ファイル、依存最小 |
| **Channels** | discord.js + @slack/bolt | 実績あるSDK、NanoClaw と同一 |
| **Scheduling** | cron-parser | IANAタイムゾーン対応、NanoClaw と同一 |
| **Validation** | Zod | ランタイム型バリデーション、軽量 |
| **Testing** | Vitest + fast-check | ユニットテスト + PBT |
| **Linting** | ESLint + Prettier | NanoClaw と同一 |
| **Git Hooks** | Husky | pre-commit lint/format |
| **Build** | tsc (TypeScript compiler) | シンプル、追加ツール不要 |
| **Deploy** | Docker + docker-compose | ポータブル、どこでも実行 |
| **Service** | launchd / systemd | OS標準のサービス管理 |

## Dependencies (Production)

| Package | Version | Purpose | License |
|---------|---------|---------|---------|
| better-sqlite3 | ^11.0.0 | SQLite ドライバ | MIT |
| discord.js | ^14.0.0 | Discord 統合 | Apache-2.0 |
| @slack/bolt | ^4.0.0 | Slack 統合 | MIT |
| cron-parser | ^5.0.0 | cron式パース | MIT |
| zod | ^3.23.0 | 入力バリデーション | MIT |

## Dependencies (Development)

| Package | Version | Purpose | License |
|---------|---------|---------|---------|
| typescript | ^5.7.0 | 言語 | Apache-2.0 |
| vitest | ^4.0.0 | テスト | MIT |
| fast-check | ^3.0.0 | PBT | MIT |
| eslint | ^9.0.0 | Lint | MIT |
| prettier | ^3.0.0 | フォーマッタ | MIT |
| husky | ^9.0.0 | Git hooks | MIT |
| @types/better-sqlite3 | latest | 型定義 | MIT |
| tsx | ^4.0.0 | 開発時TypeScript実行 | MIT |

## Key Architecture Decisions

### ADR-01: Claude Code CLI over SDK
- **Decision**: SDK (`@anthropic-ai/claude-code`) ではなく CLI を使用
- **Rationale**: コンテナ内で直接 `claude` コマンド実行。セッション管理やツール利用がCLI組み込み。SDK統合のコード量を削減

### ADR-02: Per-Message Container over Persistent Container
- **Decision**: メッセージごとにコンテナ起動・終了
- **Rationale**: 完全隔離、リソースリーク防止。起動コスト (~2-5秒) はエージェント処理時間と比較して許容範囲

### ADR-03: Filesystem IPC over Socket
- **Decision**: JSON ファイルベースIPC
- **Rationale**: 実装シンプル、デバッグ容易（ファイル直接確認可能）、~2000行制約に適合

### ADR-04: SQLite over File-based Storage
- **Decision**: SQLite (better-sqlite3)
- **Rationale**: 同期API、単一ファイル、SQL による柔軟なクエリ、WALモードで並行読み取り

### ADR-05: Zod for Validation
- **Decision**: Zod をバリデーションライブラリとして採用
- **Rationale**: TypeScript ファースト、軽量、スキーマから型推論可能。Security Baseline SECURITY-05 準拠

### ADR-06: fast-check for PBT
- **Decision**: fast-check を PBT ライブラリとして採用
- **Rationale**: JavaScript/TypeScript で最も成熟した PBT ライブラリ。Vitest との統合が容易
