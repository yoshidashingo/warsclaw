# Component Inventory

## OpenClaw

### Application Packages
- **apps/ios/** - iOS ネイティブアプリ (Swift, XcodeGen)
- **apps/macos/** - macOS メニューバーアプリ (Swift)
- **apps/android/** - Android ネイティブアプリ (Kotlin)
- **apps/shared/OpenClawKit/** - 共有ネイティブコード

### Core Source (src/)
- **gateway/** - WebSocket RPC制御プレーン (~200 files)
- **agents/** - AIエージェントランタイム (~650 files)
- **plugin-sdk/** - プラグイン公開API (~325 files)
- **channels/** - チャネル抽象レイヤー
- **sessions/** - セッション管理
- **config/** - YAML設定管理
- **security/** - 認証・ペアリング
- **routing/** - メッセージルーティング
- **mcp/** - Model Context Protocol統合
- **media/** - メディアパイプライン
- **memory/** - 知識永続化
- **context-engine/** - ベクトル埋め込み & RAG
- **flows/** - フロー実行エンジン
- **tts/** - Text-to-Speech
- **image-generation/** - 画像生成
- **web-search/** - Web検索
- **cli/** - CLIエントリポイント
- **daemon/** - デーモンモード
- **infra/** - TLS、デバイスID

### Extension Plugins (92+)
- **メッセージングチャネル (23)**: discord, slack, telegram, signal, whatsapp, imessage, bluebubbles, irc, msteams, matrix, feishu, line, mattermost, nextcloud-talk, nostr, synology-chat, tlon, twitch, zalo, wechat, webchat, googlechat 等
- **AIプロバイダー (20+)**: anthropic, openai, google, aws-bedrock, deepseek, mistral, together, huggingface, ollama, vllm, sglang, litellm, azure, openrouter, xai 等
- **ツール**: web-search, image-generation, speech-to-text, text-to-speech, browser, pdf, file-handling 等

### Shared Packages (packages/)
- 3 内部共有パッケージ

### Skills (skills/)
- バンドルベースラインスキル

---

## NanoClaw

### Application Components
- **src/index.ts** - メインオーケストレータ
- **src/router.ts** - メッセージルーティング
- **src/group-queue.ts** - グループキュー管理
- **src/container-runner.ts** - Docker コンテナ実行

### Channel Integrations
- **src/channels/discord.ts** - Discord (discord.js)
- **src/channels/slack.ts** - Slack (@slack/bolt)
- **skills/** - Gmail, Telegram, WhatsApp

### Infrastructure Components
- **src/db.ts** - SQLiteデータベース
- **src/ipc.ts** - ファイルシステムIPC
- **src/task-scheduler.ts** - タスクスケジューラ
- **src/config.ts** - 環境設定
- **src/logger.ts** - 構造化ログ

### Container
- **container/Dockerfile** - エージェント実行環境
- **container/agent-runner/** - コンテナ内エージェントランナー

### Data & Configuration
- **groups/** - グループごとのフォルダ (CLAUDE.md, sessions)
- **data/** - SQLiteデータベースファイル

---

## Total Count

### OpenClaw
- **Total Packages/Modules**: 130+
- **Application**: 4 (iOS, macOS, Android, SharedKit)
- **Core Source**: 40+ modules
- **Extensions**: 92+
- **Shared**: 3

### NanoClaw
- **Total Modules**: ~15
- **Core**: 10 (index, router, queue, runner, db, ipc, scheduler, config, logger, types)
- **Channels**: 2 built-in + 3 skill-based
- **Container**: 4 (Dockerfile, agent-runner entrypoint, message-stream, session-manager)
