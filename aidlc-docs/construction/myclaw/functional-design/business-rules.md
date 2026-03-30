# Business Rules

## BR-01: Message Processing

### BR-01.1: Message Polling
- チャネルは設定可能な間隔 (デフォルト2秒) でポーリングする
- 各チャネルの `getNewMessages()` は RouterState の `last_processed_timestamp` 以降のメッセージのみ返す
- ボット自身のメッセージ (`is_from_me = true`) はキューに追加しない
- ポーリング失敗時はログ記録のみで次のサイクルに進む

### BR-01.2: Message Routing
- 受信メッセージの `chat_jid` で RegisteredGroup を検索
- 未登録グループからのメッセージは無視する
- `requires_trigger = true` のグループでは、トリガーワードを含むメッセージのみ処理
- `requires_trigger = false` (メイングループ等) では全メッセージを処理

### BR-01.3: Message Formatting
- エージェントに渡すコンテキストはXMLフォーマットで構成:
  ```xml
  <messages>
    <message sender="user_name" timestamp="ISO8601">content</message>
    ...
  </messages>
  ```
- メイングループの場合、利用可能なグループ一覧と管理コマンドを追加
- 直近N件のメッセージ履歴をコンテキストに含める (Nは設定可能、デフォルト50)

## BR-02: Group Queue Management

### BR-02.1: Enqueue Rules
- グループごとに独立したFIFOキューを維持
- 同一グループの処理は直列（同時に1コンテナのみ）
- 異なるグループの処理は並列（グローバル上限まで）

### BR-02.2: Concurrency Control
- グローバル並行コンテナ数の上限 = `config.maxConcurrentContainers` (デフォルト5)
- 上限到達時は空きが出るまでキューで待機
- 待機中のタスクは優先度なし（FIFO）

### BR-02.3: Retry Logic
- コンテナ実行失敗時、指数バックオフでリトライ
- バックオフ: `5s * 2^(retryCount - 1)` (5s, 10s, 20s, 40s, 80s)
- 最大リトライ回数 = `config.maxRetries` (デフォルト5)
- 最大リトライ超過時はエラーログ記録し、エラーメッセージをチャネルに返す

## BR-03: Container Execution

### BR-03.1: Container Lifecycle
- メッセージごとに新規Dockerコンテナを起動
- コンテナは処理完了（またはタイムアウト）後に自動削除 (`--rm`)
- タイムアウト = RegisteredGroup.timeout (デフォルト300秒)

### BR-03.2: Volume Mounts
- プロジェクトルート → `/workspace` (読み取り専用)
- グループフォルダ → `/workspace/groups/{name}` (読み書き)
- IPCディレクトリ → `/workspace/ipc` (読み書き)
- グローバルCLAUDE.md → `/workspace/groups/global/CLAUDE.md` (読み取り専用)
- `.env` ファイルは `/dev/null` にシャドウイング

### BR-03.3: Input/Output Protocol
- **Input**: ContainerInput を JSON として stdin に送信
- **Output**: stdout から `<<<OUTPUT_START>>>` と `<<<OUTPUT_END>>>` の間の JSON を抽出
- マーカーが見つからない場合は全stdoutをエラーとして扱う
- stderr は常にログに記録

### BR-03.4: Claude Code CLI Invocation
- コンテナ内の agent-runner が ContainerInput を受け取り `claude` CLI を実行
- 作業ディレクトリ: `/workspace/groups/{groupFolder}`
- CLAUDE.md はグループフォルダ内のものを自動適用
- セッションIDによるコンテキスト継続

## BR-04: IPC Processing

### BR-04.1: File Monitoring
- `/workspace/ipc/messages/` と `/workspace/ipc/tasks/` を1秒間隔でポーリング
- `.json` ファイルのみ処理
- 処理済みファイルは削除
- 処理失敗ファイルは `/workspace/ipc/errors/` に移動

### BR-04.2: Message IPC
- `type: "message"` のファイルは `chatJid` と `text` を読み取り Router 経由で送信
- 送信元グループの認可チェックは不要（自グループへの送信のみ許可）

### BR-04.3: Task IPC
- `type: "schedule_task"` → TaskScheduler.createTask()
- `type: "pause_task"` → TaskScheduler.pauseTask()
- `type: "resume_task"` → TaskScheduler.resumeTask()
- `type: "cancel_task"` → TaskScheduler.cancelTask()
- `type: "update_task"` → TaskScheduler.updateTask()

### BR-04.4: Authorization Rules
- **メイングループ** (`isMain = true`): 全グループのタスクを操作可能
- **非メイングループ**: 自グループのタスクのみ操作可能
- 認可エラーはログ記録し、IPCファイルは errors/ に移動
- `type: "register_group"` と `type: "refresh_groups"` はメイングループのみ

## BR-05: Task Scheduling

### BR-05.1: Schedule Types
- **cron**: cron式で定義。IANAタイムゾーン対応。cron-parser で解析
- **interval**: ミリ秒単位のインターバル。ドリフト防止のため `last_run + interval` で次回計算
- **once**: ISO 8601日時。実行後 status = 'completed'

### BR-05.2: Task Execution
- `checkDueTasks()` で `next_run <= now` かつ `status = 'active'` のタスクを取得
- タスクをGroupQueueにエンキュー（`isScheduledTask = true`）
- 実行後、TaskRunLog を記録
- next_run を再計算して更新 (once の場合は null)

### BR-05.3: Task State Machine
```
created → active ⇄ paused
active → completed (once型の実行後)
active/paused → cancelled (削除)
```

### BR-05.4: Validation Rules
- cron式: cron-parser でパース可能であること
- interval: 正の整数であること、最小値 60000 (1分)
- once: 未来の日時であること
- group_folder: 登録済みグループに存在すること
- prompt: 空でないこと

## BR-06: Group Management

### BR-06.1: Group Registration
- メイングループからの IPC で `register_group` を受信
- `folder` はファイルシステム上の安全なパス（パストラバーサル不可）
- フォルダが存在しない場合は作成
- 初期 CLAUDE.md を生成（テンプレートから）

### BR-06.2: Group Folder Structure
```
groups/{name}/
├── CLAUDE.md         # グループ固有のエージェント指示
└── .claude/
    └── sessions/     # セッション履歴
```

### BR-06.3: Folder Name Validation
- 英数字、ハイフン、アンダースコアのみ許可: `/^[a-zA-Z0-9_-]+$/`
- 最大長: 64文字
- 予約名禁止: `main`, `global`, `.`, `..`

## BR-07: Graceful Shutdown

### BR-07.1: Shutdown Sequence
1. SIGTERM/SIGINT を受信
2. ポーリングループを停止（新規メッセージ取得停止）
3. 新規キューイングを停止
4. 実行中のコンテナの完了を待機（最大タイムアウト）
5. IPC Watcher を停止
6. チャネルを切断
7. Database を閉じる
8. プロセス終了

### BR-07.2: Forced Shutdown
- 2回目の SIGTERM/SIGINT で即座に終了
- 実行中コンテナは Docker により自動クリーンアップ (`--rm`)
