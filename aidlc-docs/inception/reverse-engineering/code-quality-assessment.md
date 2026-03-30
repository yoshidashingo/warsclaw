# Code Quality Assessment

## Test Coverage

### OpenClaw
- **Overall**: Good (70%閾値を強制)
- **Unit Tests**: Vitest, V8カバレッジ
- **Integration Tests**: フルGatewayテスト (プロセスfork)
- **E2E Tests**: Docker ベース
- **Live Tests**: 実プロバイダ対象
- **Contract Tests**: プラグイン/チャネル境界バリデーション
- **Smoke Tests**: インストール & 基本ワークフロー

### NanoClaw
- **Overall**: Fair (group-queue等のコアにテストあり)
- **Unit Tests**: Vitest (group-queue.test.ts で並行制御・リトライロジック検証)
- **Integration Tests**: 手動
- **E2E Tests**: 未確認

## Code Quality Indicators

### OpenClaw
- **Linting**: Oxlint (Rust製、型認識、高速)
- **Code Style**: Oxfmt で統一
- **Documentation**: 包括的 (README 123KB, AGENTS.md 33KB, VISION.md)
- **Max LOC/file**: 500行 (強制)
- **Duplication検出**: jscpd (min 12行 / 80トークン)
- **Dead Code検出**: knip, ts-prune, ts-unused-exports
- **Import制限**: プラグインSDK境界強制
- **パフォーマンス**: import duration tracking

### NanoClaw
- **Linting**: ESLint
- **Code Style**: Prettier + Huskyフック
- **Documentation**: README.md, CLAUDE.md, CONTRIBUTING.md

## Technical Debt

### OpenClaw
- 92以上のプラグインの維持コスト
- pi-agent-coreへの依存 (サードパーティ)
- ネイティブアプリ3プラットフォーム (Swift/Kotlin)
- 60+ subpath exports の複雑性

### NanoClaw
- Dockerへの強依存 (コンテナなしでは動作しない)
- ファイルシステムIPCのスケーラビリティ
- ポーリング間隔がハードコード (2秒/1秒)

## Patterns and Anti-patterns

### Good Patterns (採用推奨)

**OpenClaw**:
- Plugin SDK境界によるモジュール分離
- 型安全なプラグインコントラクト
- 包括的なテスト戦略 (unit/integration/e2e/live/contract)
- 500行/ファイル制限
- デッドコード検出の自動化

**NanoClaw**:
- シンプルなポーリングアーキテクチャ
- グループ単位のFIFOキュー + グローバル並行制御
- SQLiteによる軽量状態管理
- マーカーベースの出力パース
- 指数バックオフリトライ
- エラーファイルの隔離 (errors/ディレクトリ)
- 構造化ログ
- 設定オブジェクトパターン (長いパラメータリストを避ける)

### Anti-patterns (回避推奨)
- ハードコードされたポーリング間隔
- ファイルシステムIPCの過度な使用
- 過大なプラグインSDKサーフェス (60+ exports)
