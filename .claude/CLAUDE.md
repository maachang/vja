# vja（Visual JavaScript for AI）プロジェクト固有の情報

このファイルはClaude Codeがセッション開始時に自動的に読み込みます。 ここにはプロジェクト固有の事実を書く。 汎用的な開発知識（言語仕様・設計原則の教科書的説明など）は書かない。

# プロジェクト概要
vja（Visual JavaScript for AI） と言う 昔の VB6のようにフォームにウィジェット配置でアプリが作れる開発環境を作成する。ここでは「ローカルLLM」を使って「イベント等のコード生成」や「フォームデザイン」を「YAML定義」で実現する。

# 作業領域（.claudeWork）

- プロジェクト直下の `.claudeWork/` はClaude Code専用の作業領域（Gitには一切コミットしない、.gitignore済み）
- セッションが落ちて再起動すると直前の会話内容は失われるため、途中の提案・調査結果・未確定の方針などで残しておきたいものは、このフォルダにファイルとして書いておくこと
- セッション開始時、作業に関連しそうであれば `.claudeWork/` の中身を確認すること
- プロジェクト固有の永続的な事実はここではなく本ファイル（CLAUDE.md）に書く。`.claudeWork`はあくまで一時的な作業メモ置き場

# ユニットテスト（bun test）

- `bun test`（追加設定不要、`package.json`に`test`スクリプトあり）でユニットテストが実行できる
- 対象は「Electrobunのウィンドウ/DOMに依存しない純粋なロジック」のみ（`src/mainview/bridge-common.ts`、`src/bun/bun-utils.ts`、`src/bun/fs-rpc-handlers.ts`が対象。各ファイルと同じディレクトリに`*.test.ts`を置く）
- `src/bun/project-runner.ts`は`electrobun/bun`をトップレベルでimportしており、単体でimportするとハングするため、現状テスト対象外（モック化すればテスト可能だが未対応）
- `src/mainview/*.js`（vja-yaml-editor.js等）はモジュールシステムを使わない素の`<script>`読み込みのため、現状テスト対象外（`export`追加等の小さなリファクタが必要）
- ロジック以外（ウィジェット配置・描画・ダイアログ操作等、DOM/ネイティブウィンドウに依存する部分）は引き続き人の目視確認に頼る

# コーディング規約

- 私の認識が常に正しいとは限らない。言っていることが本当に正しいか常に批判的に検証すること
- 実際の作業（コード生成など）に着手する前に、計画しているアプローチを報告すること
- 場当たり的、あるいは即興的で指示と関係ない狭い範囲を見ての対応を、許可無く行う事は絶対に禁止（必ず承認を得る）
- 実装を任された際「妥当」と思われる自身の判断に基づいて「詳細仕様」（データフィルタリング手法、抽出ロジック、初期値、制限値、除外基準など）を独断で決定・補完することは禁止
- 既存のコメントは、処理が変わって意味が通じなくなる場合以外は消さない
- ただし、一時的なログ出力などの実装については、役割が終わった場合は削除する
- コメントは日本語で書く
- ユーザーへの返答・要約・説明文は常に日本語で書く（英語での応答は禁止）
- バグ・エラーの原因調査を依頼された場合、原因が判明しても即座に修正しない。まず原因内容と修正方針を報告し、ユーザーの承認を得てから修正に着手すること（「原因確認」と「修正」は別の許可が必要な作業として扱う）

# プロジェクトタイプ

- electrobun を利用しているので Typescript / javascript(cjs)を利用している
  - bun.js: https://github.com/oven-sh/bun
  - electrobun: https://github.com/blackboardsh/electrobun
- VB6のような開発環境を実装するので「VJAあら実行＝vjaから起動」と「VJAからコンパイル＝コンパイル」の機能が必要
- bun.js に sqlite3 が入ってるので、このRDBMSを利用する

# ディレクトリ構成 

| ディレクトリ | 役割 |
|-------------|------|
| src/bun/ | bun.jsで実行されるコード(TSファイル) |
| src/bun/index.ts | メインプロセス（ウィンドウ生成・RPC定義）|
| src/mainview/ | electrobun(webView)で実行されるコード(ts, js, html, cssファイルなど) |
| src/mainview/init-params.js | 静的定義値の集約（全ファイルで最初に読み込む） |
| src/mainview/vja-defs.js | 状態管理・ウィジェット定義・共通ユーティリティ |
| src/mainview/vja-designer.js | デザイナー本体（描画・選択・プロパティパネル） |
| src/mainview/vja-modal.js | モーダル基盤・Undo/Redo・削除/複製 |
| src/mainview/vja-yaml-editor.js | YAML/JSエディタ・AI生成 |
| src/mainview/vja-editor-utils.js | エディタ共通ユーティリティ |
| src/mainview/vja-mock-runtime.js | モック共通ユーティリティ |
| src/mainview/vja-save.js | 保存・開く・実行・マルチフォーム管理 |
| src/mainview/vja-table-validation.js | 定数・テーブル・バリデーション編集 |
| src/mainview/vja-app-config.js | フォーム定数・アプリイベント・クラウド設定等 |
| src/mainview/vja-ui.js | キーボード・ルーラー・INIT（最後に読み込む） |
| src/mainview/bridge.ts | Webview RPC ブリッジ |
| src/mainview/bridge-common.ts | RPC ブリッジ共通処理 |
| src/mainview/project-bridge.ts | プロジェクト実行ウィンドウ RPC |
| src/mainview/vja-runtime.js | vja.* API ランタイム |
| src/mainview/prompt-def.js | AI プロンプト定義 |
| src/shared/types.ts | types.tsファイル |
| docs/ | ドキュメント関連(mdファイルなど) |
| icon/ | electrobun で利用する vja のアイコンファイル(windows, mac, linux用) |
| artifacts | bun.js が vja をコンパイルした時に作成されるディレクトリ(閲覧不要) |
| build | bun.js が vja を起動する時に作成されるディレクトリ(閲覧不要) |
| node_modules | bun.js が vja を起動する時に作成されるディレクトリ(閲覧不要) |
| electrobun.config.ts | electrobun のコンフィグ実行定義(tsファイル) |
| package.json | bun.js が利用するプロジェクト定義 |
| README.md | vjaドキュメントトップ(md) |
| bun.lock | bun.js が vja を起動する時に作成されるファイル(閲覧不要) |
| .gitignore | githubリポジトリで利用するファイル(閲覧不要) |

# 設計原則

- コンポーネントの再利用性を高める: 同じ実装、似たような実装は、共通化を図る
- シンプル化を意識したコーディング: スパゲティコーディングをしない
- ビジネスロジックとUIを分離: index.html をシンプルにして、関連ロジック単位でファイルを分ける
- 各ソースコードに「AIメモ」を作成: 過去のミスや問題が起きてしまう事を繰り返さない対策を行う
  - AIメモは必要なソースコードに対して、先頭部分に記載されているので、そこに追加・新たに必要な場合は新規でセットする

# あえてやってないこと
- SQLインジェクションについては、最低限以外は「ローカルアプリ」なので、考慮していない
- パストラバーサル — src/bun/index.ts の fileReadRequest/fileWriteRequest/fileDeleteRequest/dirDeleteRequest
等が、RPC経由の生パスをルート制限なしでそのまま使用。dirDeleteRequest({path:"/"})のような呼び出しで任意ファイル削除が可能なども、ローカルアプリなので、考慮しない
- ハードコードされた暗号鍵も、これもローカルアプリでの組み込み（主にクラウドインフラ関連のトークン関連で利用）なので問題なしとしている

# 未対応・残課題(随時更新)

- CSVパース処理はproject-bridge.ts（TS/Electrobunブリッジ層）側にまだ重複が残っている（あえて対応見送り）
- 学習履歴機能は「たたき台」段階（UI・淘汰ロジックとも簡易実装のまま）
- 既存プロジェクトの後方互換性（旧検証:記法のマイグレーション）は「今は自分しか使っていない」との理由で対応見送り
