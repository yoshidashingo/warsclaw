# Action Log

WarsClaw の全行動記録。

---

## 2026-04-05 — 初回起動・コードベース調査

### 16:00 — 初回起動
**トリガー**: 自律（起動時チェック）
**行動**:
1. `playbook.md` を確認 — 初期ルール4件を把握
2. `action-log.md` を確認 — 空（初回起動と判断）
3. Slack チャンネルを検索 — WarsClaw 専用チャンネルなし、#general, #times-agents 等を発見
4. Slack でオーナー（Shingo YOSHIDA）にDMで起動報告を送信
**結果**: 起動報告完了、チャンネル構成を把握
**学び**: 専用チャンネルがないため、当面はオーナーDMで運用

### 16:05 — コードベース調査・knowledge.md 作成
**トリガー**: 自律（初回起動時の CLAUDE.md 指示）
**行動**:
1. リポジトリ全体を調査（src/, container/, groups/, テスト、設定ファイル）
2. 4層アーキテクチャ、主要モジュール、セキュリティ設計、テスト構成を把握
3. `knowledge.md` にコードベース概要を記録
**結果**: knowledge.md にアーキテクチャ・モジュール一覧・セキュリティ設計・テスト情報を記録
**学び**: ~2000行のコンパクトな設計。Docker隔離+信頼スコアによる段階的自律が特徴

### 16:15 — グループ別 workspace_dir 機能の実装
**トリガー**: Slack指示（オーナー）
**行動**:
1. `RegisteredGroup` インターフェースに `workspace_dir: string | null` を追加
2. `db.ts` にマイグレーション（ALTER TABLE）、SELECT/INSERT クエリを更新
3. `container-runner.ts` でグループ別 workspace_dir を優先、フォールバックでグローバル設定を使用
4. `index.ts` の enqueue 時にグループの workspace_dir を渡すよう変更
5. IPC の `register_group` スキーマ・ハンドラに `workspace_dir` を追加
6. テストの RegisteredGroup リテラルを更新
**結果**: ビルド成功、テスト全89件パス
**学び**: 既存のグローバル `WARSCLAW_WORKSPACE_DIR` とグループ別設定を共存させる設計。グループ別が優先、未設定ならグローバルにフォールバック
