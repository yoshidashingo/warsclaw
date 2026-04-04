# WarsClaw Requirements

## Intent Analysis

- **User Request**: OpenClaw/NanoClawの良い点を取り込んだ、世界でもっとも小さいパーソナルエージェントクローンの構築
- **Request Type**: New Project (Greenfield, referencing brownfield projects)
- **Scope**: System-wide — マルチチャネルAIエージェントシステム全体
- **Complexity**: Moderate — 既存プロジェクトを参考に新規構築、~2000行以下の制約
- **Requirements Depth**: Standard

---

## Functional Requirements

### FR-01: メッセージングチャネル統合
- **FR-01.1**: Discord チャネルをサポートする (discord.js)
- **FR-01.2**: Slack チャネルをサポートする (@slack/bolt)
- **FR-01.3**: チャネルはポーリングベースでメッセージを取得する
- **FR-01.4**: 受信メッセージをエージェントにルーティングし、レスポンスを元のチャネルに返す
- **FR-01.5**: チャネルはファイルベースのスキルシステムで追加可能とする

### FR-02: エージェント実行
- **FR-02.1**: Claude Code をエージェントランタイムとして使用する (WarsClawフォルダ内で実行)
- **FR-02.2**: Docker コンテナ内でエージェントを隔離実行する
- **FR-02.3**: グループごとに独立したコンテキスト (CLAUDE.md, セッション, ファイル) をマウントする
- **FR-02.4**: エージェント出力をマーカーベースで確実にパースする
- **FR-02.5**: グローバル並行制御でコンテナ数を制限する

### FR-03: 状態管理
- **FR-03.1**: SQLite でメッセージ履歴を永続化する
- **FR-03.2**: SQLite でセッション状態を管理する
- **FR-03.3**: SQLite でスケジュールタスクを管理する
- **FR-03.4**: チャットメタデータ (グループ名, JID, 最終アクティビティ) を保持する

### FR-04: グループ隔離
- **FR-04.1**: グループ/チャネルごとに独立した会話コンテキストを維持する
- **FR-04.2**: グループごとのフォルダ (groups/{name}/) でファイルを隔離する
- **FR-04.3**: グループごとの CLAUDE.md でエージェント指示をカスタマイズ可能にする
- **FR-04.4**: グローバル CLAUDE.md で全グループ共通の指示を定義できる
- **FR-04.5**: メイングループに管理者特権を付与する

### FR-05: スケジュールタスク
- **FR-05.1**: cron 式によるスケジュール実行をサポートする
- **FR-05.2**: インターバルベースの定期実行をサポートする
- **FR-05.3**: ワンタイム実行をサポートする
- **FR-05.4**: タイムゾーン対応 (IANA timezone)
- **FR-05.5**: タスクの作成・一時停止・再開・削除をサポートする
- **FR-05.6**: 実行ログを記録する

### FR-06: Web検索 & ブラウザ自動化
- **FR-06.1**: エージェントコンテナ内でWeb検索を実行可能にする
- **FR-06.2**: Chromium によるブラウザ自動化を提供する
- **FR-06.3**: Web スクレイピング、フォーム操作、API呼び出しをサポートする

### FR-07: スキルシステム
- **FR-07.1**: ファイルベースのスキルシステムで拡張機能を追加可能にする
- **FR-07.2**: 新しいチャネル実装をスキルとして追加可能にする
- **FR-07.3**: ユーティリティスキル (ヘルパー関数) をサポートする
- **FR-07.4**: コンテナスキル (エージェント環境内ツール) をサポートする

### FR-08: メッセージルーティング
- **FR-08.1**: 受信メッセージを正しいグループキューにルーティングする
- **FR-08.2**: グループごとのFIFOキューでメッセージを処理する
- **FR-08.3**: エージェントからのフォローアップメッセージをIPCで受信し配信する
- **FR-08.4**: メッセージカーソル管理で重複処理を防止する

---

## Non-Functional Requirements

### NFR-01: コードサイズ
- コアコードベースを ~2000行以下に抑える (テスト・設定ファイル除外)
- NanoClaw (~3000行) より小さくする

### NFR-02: セキュリティ
- Docker コンテナによるエージェント実行の完全隔離
- プロジェクトルートはコンテナ内で読み取り専用マウント
- グループフォルダのみ書き込み可能マウント
- 環境変数のシャドウイング (.env → コンテナ内は /dev/null)
- マウントパスのallow list管理
- メイングループ以外からの管理操作のブロック
- cron式・フォルダ名の入力バリデーション
- OWASP Top 10 脆弱性の防止

### NFR-03: パフォーマンス
- ポーリング間隔は設定可能 (デフォルト2秒)
- グローバルコンテナ並行制限 (デフォルト5)
- 指数バックオフリトライ (最大5回)

### NFR-04: 可搬性
- Docker コンテナとしてどこでもデプロイ可能
- macOS, Linux 対応
- launchd (macOS) / systemd (Linux) でサービス化可能

### NFR-05: 拡張性
- ファイルベースのスキルシステムでコア変更なしに拡張
- チャネルはファクトリパターンで登録

### NFR-06: テスタビリティ
- Vitest によるユニットテスト
- Property-Based Testing (PBT) の適用
- TypeScript strict mode

### NFR-07: 可観測性
- 構造化ログ (コンテキスト付きオブジェクトログ)
- タスク実行ログの永続化
- エラーファイルの隔離 (errors/ ディレクトリ)

### NFR-08: 信頼性
- メッセージカーソルによるリカバリ機構
- コンテナ障害時の指数バックオフリトライ
- IPC処理失敗時のエラーファイル保存
- Graceful shutdown (実行中コンテナを終了まで待機)

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript (strict) | OpenClaw/NanoClaw と同じ、型安全性 |
| Runtime | Node.js 22+ | LTS、Docker base image利用可能 |
| Agent | Claude Code | WarsClawフォルダ内でclaude code実行 |
| Isolation | Docker container | NanoClaw方式、完全隔離 |
| Storage | SQLite (better-sqlite3) | 軽量、単一ファイル、同期API |
| Channels | Discord + Slack | discord.js + @slack/bolt |
| Architecture | Polling loop + per-group queue | NanoClaw方式、シンプル |
| IPC | Filesystem JSON | NanoClaw方式、デバッグ容易 |
| Skills | File-based | NanoClaw方式、コア変更不要 |
| Build | tsc + npm | 最小構成 |
| Testing | Vitest + PBT | 品質保証 |
| Linting | ESLint + Prettier | NanoClaw方式 |
| Deploy | Docker | どこでも実行可能 |

---

## Extension Configuration

| Extension | Enabled | Decided At |
|---|---|---|
| Security Baseline | Yes | Requirements Analysis |
| Property-Based Testing | Yes | Requirements Analysis |

---

## Summary

WarsClaw は ~2000行以下で構築するパーソナルAIエージェントで、以下の特徴を持つ:

- **Claude Code** をエージェントランタイムとして使用
- **Docker コンテナ** でエージェント実行を隔離
- **Discord + Slack** の2チャネルをサポート (スキルで拡張可能)
- **グループ単位の隔離** でコンテキスト・メモリ・ファイルを分離
- **SQLite** で状態管理 (メッセージ、セッション、タスク)
- **cron/interval/once** のスケジュールタスク
- **Web検索 + ブラウザ自動化** (Chromium)
- **ファイルベースのスキルシステム** で拡張
- **セキュリティ**: コンテナ隔離、入力バリデーション、権限管理
- **PBT**: ビジネスロジック・データ変換に対するProperty-Based Testing
