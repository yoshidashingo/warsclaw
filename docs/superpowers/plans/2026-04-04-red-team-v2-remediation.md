# Red Team v2 Remediation — 完了報告 (2026-04-04)

## PRs (全てマージ済み)

| PR | Title | Status |
|----|-------|--------|
| #12 | fix(security): remediate Red Team v2 findings | MERGED |
| #14 | fix(security): Red Team v2 followup — task authz, rate limiting, AWS masking | MERGED |

## 修正一覧

| ID | Severity | Issue | Fix | File |
|----|----------|-------|-----|------|
| C-1 | CRITICAL | ContainerRunner groupFolder パストラバーサル | SafeFolderSchema.parse() | src/container-runner.ts |
| C-2 | CRITICAL | IPC admin操作に認可チェックなし | source_group + isFromMainGroup() | src/ipc.ts, src/types.ts |
| C-2b | CRITICAL | IPC register_group パス構築が `..` 使用 | groupsDir 直接参照 | src/ipc.ts |
| H-1 | HIGH | SQL列名の動的補間 | 静的SQLマップ (TASK_COLUMN_SQL) | src/db.ts |
| H-2 | HIGH | agent-runner 入力バリデーションなし | validateInput() | container/agent-runner/src/index.ts |
| H-3 | HIGH | シークレットマスクパターン不足 | AWS/GitHub/GitLab/Bearer追加 | src/logger.ts |
| M-2 | MEDIUM | envファイルの例外時リーク | spawn前 try-catch + cleanupEnv | src/container-runner.ts |
| M-3 | MEDIUM | メッセージレート制限なし | 10msg/min スライディングウィンドウ | src/index.ts |
| M10 | MEDIUM | ESLint未インストール | npm install | - |
| - | MEDIUM | schedule_value バリデーション不足 | superRefine interval>=60000 | src/types.ts |
| - | MEDIUM | stdout/stderr 無制限 | MAX_OUTPUT_BYTES 10MB | src/container-runner.ts |
| NEW-M1 | MEDIUM | タスク管理操作に認可なし | source_group + canManageTask() | src/ipc.ts, src/types.ts |
| NEW-M2 | MEDIUM | AWS secret key マスクなし | aws_secret_access_key パターン | src/logger.ts |

## スキーマ変更

- `SafeFolderSchema` — パストラバーサル防止用（main/global許可）
- `GroupFolderSchema` — SafeFolderSchema + 予約名チェック
- `source_group` — register_group, refresh_groups, pause/resume/cancel/update_task に追加

## テスト

- security.test.ts: 15テスト新規（PBT含む）
- validation.test.ts: pause_task source_group テスト追加
- 全79テスト pass

## 残存リスク (LOW, accepted)

- コンテナ内 prompt サイズ上限なし（Docker隔離で軽減）
- SIGKILL 時の一時envファイル残存（OS制約）
- カスタム .env パーサー（dotenv置換は別タスク）
- Discord channelCache 無制限（パーソナル規模で実害なし）

## Red Team Review

- Security Reviewer Agent: CONDITIONAL PASS
- 全 CRITICAL/HIGH resolved
