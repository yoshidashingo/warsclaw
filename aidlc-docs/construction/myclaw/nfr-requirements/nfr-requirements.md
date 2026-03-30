# NFR Requirements - MyClaw

## NFR-01: Security

### NFR-01.1: Container Isolation (SECURITY-01 関連)
- エージェントはDockerコンテナ内で実行し、ホストシステムから完全に隔離する
- プロジェクトルートは読み取り専用マウント
- グループフォルダのみ読み書きマウント
- `.env` ファイルはコンテナ内で `/dev/null` にシャドウイング
- コンテナは `--rm` で自動削除、`--network=none` は設定可能

### NFR-01.2: Encryption (SECURITY-01)
- SQLite データベースはホストファイルシステムの暗号化に依存
- チャネル API 通信は TLS 1.2+ を強制 (discord.js, @slack/bolt のデフォルト)
- Docker API 通信はローカルソケット (暗号化不要)
- **N/A**: 外部データストアなし、全データローカル保存

### NFR-01.3: Input Validation (SECURITY-05)
- グループフォルダ名: `/^[a-zA-Z0-9_-]+$/`, 最大64文字
- cron式: cron-parser によるパース検証
- interval値: 正の整数、最小60000ms
- once日時: ISO 8601形式、未来の日時
- IPC JSONファイル: スキーマバリデーション (必須フィールド検証)
- JID: 空文字列チェック
- prompt: 空文字列チェック、最大長制限

### NFR-01.4: Authorization (SECURITY-05 関連)
- メイングループのみ管理操作 (`register_group`, `refresh_groups`)
- 非メイングループは自グループのタスクのみ操作可能
- 認可チェックは IPC 処理時に実施

### NFR-01.5: Application Logging (SECURITY-03)
- 構造化ログ: timestamp, level, context, message
- PII/トークン/パスワードをログに出力しない
- チャネルAPIトークンはログマスキング
- Discordメッセージ内容のログは debug レベルのみ

### NFR-01.6: Secret Management
- APIキー/トークンは環境変数で管理 (.env)
- `.env` は `.gitignore` に含める
- コンテナへの環境変数は最小限 (ANTHROPIC_API_KEY のみ)

## NFR-02: Performance

### NFR-02.1: Message Processing Latency
- ポーリング間隔: 設定可能、デフォルト2秒
- メッセージ受信からキュー投入まで: < 100ms (ローカル処理)
- コンテナ起動オーバーヘッド: ~2-5秒 (Docker start)
- エージェント応答時間: Claude Code の処理時間に依存 (制御外)

### NFR-02.2: Concurrency
- グローバル並行コンテナ上限: 設定可能、デフォルト5
- グループ内処理: 直列 (1コンテナ/グループ)
- メモリ使用量目標: メインプロセス < 100MB、コンテナあたり < 500MB

### NFR-02.3: Database Performance
- SQLite WALモード有効化 (並行読み取り性能)
- メッセージテーブルの chat_jid + timestamp にインデックス
- タスクテーブルの next_run + status にインデックス

## NFR-03: Reliability

### NFR-03.1: Fault Tolerance
- コンテナ失敗時: 指数バックオフリトライ (最大5回)
- チャネルポーリング失敗: ログ記録、次サイクルで再試行
- IPC処理失敗: エラーファイル隔離 (errors/)
- DB障害: クリティカルログ、プロセス終了

### NFR-03.2: Recovery
- メッセージカーソルによるリカバリ (RouterState)
- セッションIDによるエージェントコンテキスト復元
- Graceful shutdown: 実行中コンテナ完了待機

### NFR-03.3: Data Durability
- SQLite の journal_mode=WAL で書き込み耐久性
- PRAGMA synchronous=NORMAL (バランス型)

## NFR-04: Portability

### NFR-04.1: Container Deployment
- Docker イメージで配布 (docker-compose.yml 付属)
- macOS, Linux 対応
- ARM64 + AMD64 マルチアーキテクチャ

### NFR-04.2: Service Management
- launchd (macOS) / systemd (Linux) のサービスファイル提供
- `docker compose up -d` でのデーモン起動

## NFR-05: Maintainability

### NFR-05.1: Code Quality
- TypeScript strict mode
- ESLint + Prettier でコードスタイル統一
- コアコード ~2000行以下

### NFR-05.2: Testing
- Vitest でユニットテスト
- Property-Based Testing (fast-check) でビジネスロジック検証
- PBT対象: cron式パース、入力バリデーション、キュー並行制御、メッセージフォーマット

### NFR-05.3: Observability
- 構造化ログ (JSON形式対応)
- タスク実行ログの永続化 (TaskRunLog)
- エラーファイル保存 (ipc/errors/)

## NFR-06: Scalability
- **想定規模**: 単一ユーザー、5-20グループ、並行5コンテナ
- **水平スケーリング**: 対象外 (パーソナルエージェント)
- **垂直スケーリング**: maxConcurrentContainers 増加で対応

## Security Baseline Compliance Summary

| Rule | Status | Rationale |
|------|--------|-----------|
| SECURITY-01: Encryption at Rest/Transit | Compliant | TLS for channel APIs, local SQLite (host encryption) |
| SECURITY-02: Access Logging | N/A | No load balancers, API gateways, or CDNs |
| SECURITY-03: Application Logging | Compliant | Structured logger with no PII/secrets |
| SECURITY-04: HTTP Security Headers | N/A | No web-serving endpoints |
| SECURITY-05: Input Validation | Compliant | Zod/custom validation on all inputs |
