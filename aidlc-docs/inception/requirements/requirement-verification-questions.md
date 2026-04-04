# Requirements Clarification Questions

Please answer the following questions to help clarify the requirements for WarsClaw.
Each question has multiple choice options. Fill in the letter after [Answer]: tag.

---

## Question 1
WarsClawの最初のリリースでサポートするメッセージングチャネルはどれですか？

A) Discord のみ
B) Slack のみ
C) Discord + Slack
D) Discord + Slack + Telegram
E) Other (please describe after [Answer]: tag below)

[Answer]: C

## Question 2
AIモデルプロバイダーはどれを使用しますか？

A) Anthropic Claude のみ (Claude Agent SDK)
B) OpenAI のみ
C) Claude + OpenAI (マルチプロバイダー)
D) Other (please describe after [Answer]: tag below)

[Answer]: D — WarsClawのフォルダ内でclaude codeを実行することで稼働する形にする

## Question 3
エージェント実行の隔離方式はどれを採用しますか？

A) Docker コンテナ (NanoClaw方式: 完全隔離、セキュア、Docker必須)
B) プロセスfork (OpenClaw方式: 軽量、Docker不要)
C) インプロセス実行 (最小構成: 隔離なし、最もシンプル)
D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 4
状態管理（メッセージ履歴、セッション、タスク）のストレージはどれを使いますか？

A) SQLite (NanoClaw方式: 軽量、単一ファイル)
B) ファイルシステム (YAML/JSON: 最小依存)
C) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 5
スケジュールタスク機能（cron実行、定期タスク）は必要ですか？

A) はい — 初期リリースから必要
B) いいえ — 将来的に追加予定だが初期には不要
C) いいえ — 不要
D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 6
グループ/チャネルごとの会話コンテキスト隔離は必要ですか？

A) はい — グループごとに独立したセッションとメモリ (NanoClaw方式)
B) いいえ — 単一セッションで全チャネルを管理
C) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 7
「世界でもっとも小さい」の目標コードサイズはどの程度ですか？

A) ~500行以下 (最小限のメッセージリレーのみ)
B) ~1000行以下 (基本的なエージェント機能 + 1チャネル)
C) ~2000行以下 (複数チャネル + セッション管理)
D) サイズに厳密な制約なし、ただしNanoClaw (~3000行) より小さくする
E) Other (please describe after [Answer]: tag below)

[Answer]: C

## Question 8
デプロイ環境はどこですか？

A) ローカルマシンのみ (macOS)
B) ローカル + クラウド (VPS/EC2等)
C) Docker コンテナとしてどこでも
D) Other (please describe after [Answer]: tag below)

[Answer]: C

## Question 9
プラグイン/スキルの拡張性は必要ですか？

A) はい — OpenClawのようなPlugin SDKを最小限で実装
B) はい — NanoClawのようなスキルシステム (ファイルベース)
C) いいえ — ハードコードで十分、将来的に検討
D) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question 10
Web検索やブラウザ自動化の機能は必要ですか？

A) はい — 初期リリースから必要
B) いいえ — 将来的に追加予定
C) いいえ — 不要
D) Other (please describe after [Answer]: tag below)

[Answer]: A

---

## Extension Questions

## Question 11: Security Extensions
Should security extension rules be enforced for this project?

A) Yes — enforce all SECURITY rules as blocking constraints (recommended for production-grade applications)
B) No — skip all SECURITY rules (suitable for PoCs, prototypes, and experimental projects)
X) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 12: Property-Based Testing Extension
Should property-based testing (PBT) rules be enforced for this project?

A) Yes — enforce all PBT rules as blocking constraints (recommended for projects with business logic, data transformations, serialization, or stateful components)
B) Partial — enforce PBT rules only for pure functions and serialization round-trips (suitable for projects with limited algorithmic complexity)
C) No — skip all PBT rules (suitable for simple CRUD applications, UI-only projects, or thin integration layers with no significant business logic)
X) Other (please describe after [Answer]: tag below)

[Answer]: A
