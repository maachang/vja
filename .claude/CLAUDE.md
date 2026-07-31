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
- 対象は「Electrobunのウィンドウ/DOMに依存しない純粋なロジック」のみ（`src/mainview/bridge-common.ts`、`src/bun/bun-utils.ts`、`src/bun/fs-rpc-handlers.ts`、`src/bun/db-manager.ts`が対象。各ファイルと同じディレクトリに`*.test.ts`を置く）
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
- 関数名の頭に`_`を付けるのは「他ファイルからグローバル参照させない（そのファイル内限定）」という意味。`_`始まりの関数・定数は`Object.assign(window, {...})`によるグローバル展開の対象にしてはならない。他ファイルから呼び出す必要がある場合は、`_`を外した名前にした上でグローバル展開すること
  - 違反すると、Electrobunのビルド時バンドル処理で「未参照」と誤判定されて関数ごと削除され、実行時に`ReferenceError`が発生する不具合の原因になる（実例: `_purgeOverridesForWid`が参照する`_OVERRIDE_MAP_NAMES`/`_purgeOverridesForKey`をグローバル展開し忘れていたため、削除処理が例外で中断し、削除したはずのウィジェットが実行時に復活する不具合が発生した）
  - 現状、既存コードには`_`始まりのままグローバル展開されている関数が多数残っている（例: `_hlSync`、`_mockEditorAddRow`等）。これらは新規のルール違反として即座に是正が必要というわけではないが、新規追加分では必ずこのルールに従うこと

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
| src/bun/project-runner.ts | プロジェクト実行ウィンドウの共通処理（RPC・DB等）。index.ts・standalone-index.tsの両方で使用 |
| src/bun/standalone-index.ts | コンパイル済みプロジェクトのスタンドアロン実行エントリポイント |
| src/bun/fs-rpc-handlers.ts | ファイル/ディレクトリ操作RPCハンドラの共通実装（index.ts・project-runner.tsで共有） |
| src/bun/db-manager.ts | プロジェクト実行時のSQLite DB管理 |
| src/bun/bun-utils.ts | CSVパース・gzip展開等の共通ユーティリティ |
| src/bun/logger.ts | ログ出力初期化・ファイル書き込み |
| src/bun/copy-compile-assets.ts | コンパイル時に同梱するファイル一覧（COPY_BUILD_FILES）・コピー処理 |
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
| src/shared/csv-utils.ts | CSVパース共通処理（Bun側・webview側・project-bridge.tsで共有） |
| *.test.ts | 各対象ファイルと同じディレクトリに置くユニットテスト（bun test）。対象はユニットテスト（bun test）節を参照 |
| docs/ | ドキュメント関連(mdファイルなど) |
| mcp/vja-mcp-server.ts | VJAデザイナーのテスト自動化用MCPサーバー（stdio）。詳細は下記「MCPによるテスト自動化」節参照 |
| icon/ | electrobun で利用する vja のアイコンファイル(windows, mac, linux用) |
| artifacts | bun.js が vja をコンパイルした時に作成されるディレクトリ(閲覧不要) |
| build | bun.js が vja を起動する時に作成されるディレクトリ(閲覧不要) |
| node_modules | bun.js が vja を起動する時に作成されるディレクトリ(閲覧不要) |
| electrobun.config.ts | electrobun のコンフィグ実行定義(tsファイル) |
| package.json | bun.js が利用するプロジェクト定義 |
| README.md | vjaドキュメントトップ(md) |
| bun.lock | bun.js が vja を起動する時に作成されるファイル(閲覧不要) |
| .gitignore | githubリポジトリで利用するファイル(閲覧不要) |
| .claudeWork/ | Claude Code専用の作業領域（Gitにコミットしない）。詳細は作業領域（.claudeWork）節を参照 |

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

# MCPによるテスト自動化

- 目視確認頼みだった「画面関連（ウィジェット配置・削除のデータ整合性）」「YAML関連（保存・削除時のオーバーライドpurge）」を自動テストするため、`mcp/vja-mcp-server.ts`（MCPサーバー、stdioトランスポート）を用意している
- 使い方: `VJA_TEST_MODE=1 bun run dev` でvjaを起動すると、`src/bun/index.ts`内にテスト用HTTPサーバー（デフォルトポート4570、`VJA_TEST_PORT`で変更可）が起動する。このサーバーが`browserWindow.webview.rpc.request.testXxx(...)`経由で`src/mainview/bridge.ts`のテスト用ハンドラを呼び出す
- MCPサーバー（`mcp/vja-mcp-server.ts`）はこのHTTPサーバーを叩くtoolを公開する。Claude Code等のMCPクライアントに`{ "command": "bun", "args": ["run", "mcp/vja-mcp-server.ts"] }`として登録して使う（プロジェクト直下の`.mcp.json`に登録済み。ただしMCPサーバーの追加は既存セッションには反映されないため、Claude Codeの再起動/MCP再接続が必要）
  - 画面関連: `vja_add_widget`/`vja_delete_widget`/`vja_get_widgets`
  - YAML関連: `vja_save_yaml`/`vja_delete_yaml`/`vja_get_overrides`
  - Validate関連: `vja_get_validations`/`vja_save_validation`/`vja_delete_validation`/`vja_get_tables`/`vja_save_table`/`vja_delete_table`/`vja_generate_ddl`
- `VJA_TEST_MODE`未設定時はテスト用HTTPサーバー自体が起動しないため、通常起動には影響しない
- テスト用ハンドラは、確認ダイアログやDOM読み取りを伴う既存のUI関数（`deleteYaml`/`validSave`/`tblSave`等）は自動化に不向きなため使わず、データ検証・操作ロジックのみを`src/mainview/bridge.ts`側に直接再実装している（`_testAddWidget`等）
- 2026-08-01時点でPhase 1（画面関連・YAML関連）・Phase 2（Validate関連: バリデーション定義・テーブル/カラム定義・DDL生成）まで実装済み
- 以下2点は「現状テストで必要ない」との理由で対応見送り（詳細は`.claudeWork/mcp-webview-test-idea.md`参照）
  - 保存・オープン・実行・コンパイルフロー全体の自動テスト化（ネイティブファイルダイアログが絡み、バイパス用の専用ルート設計が必要になる）
  - AI生成フロー（`yamlAiGenerate`）の自動テスト化（ローカルLLM前提・生成結果が非決定的なため判定基準の設計自体が未確定）

# 既知の制約

- **Linux開発実行時のタスクバーアイコンが反映されない**: `electrobun.config.ts`の`build.linux.icon`設定・アイコンファイルのコピー自体は正しく行われている（`Resources/appIcon.png`等に反映済み）ことを確認済み。しかしElectrobunが生成する`.desktop`ファイルの`Icon=`指定がファイル名のみ（絶対パスでない）であり、Linuxデスクトップ環境は`.desktop`ファイルが`~/.local/share/applications/`等の標準位置にインストールされ、アイコンもXDGアイコンテーマの検索パス上に見つかる場合のみタスクバー表示に反映する仕様。`bun run dev`（未インストールの開発実行）の`build/dev-linux-x64/`配下に生成される`.desktop`ではこの条件を満たさないため、タスクバーアイコンが変わらないのはVJA側の設定不備ではなくElectrobunのdev実行時の制約と推定される（未確認）。`bun run build`でパッケージング・インストールした状態、または別のLinuxデスクトップ環境で実際に変わるか要確認。

- **Windowsで`.exe`へのアイコン埋め込みが失敗する（Electrobun本体のバグ）**: `bun run dev`実行時、以下の警告が出てアイコンが`launcher.exe`/`bun.exe`に埋め込まれない。
  ```
  Warning: Failed to embed icon into launcher.exe: ResolveMessage: Cannot find module
  'D:\a\electrobun\electrobun\package\node_modules\rcedit\package.json' from 'B:\~BUN\root\electrobun'
  ```
  原因はVJA側の設定ではなく、npm配布されているElectrobun本体（CLIバンドル）が`rcedit`モジュールを、Electrobun本体をビルドしたCIマシン上の絶対パス（`D:\a\electrobun\electrobun\package\node_modules\rcedit`）でrequireするようハードコードしてしまっているバグ。どの環境でインストールしてもこのパスは存在せず解決できない。VJA側での修正は不可能なため、Electrobun側の修正（バージョンアップ）待ち。自前でのワークアラウンド（`rcedit`を後処理で直接呼んで埋め込む等）は今回あえて対応しない。

# 未対応・残課題(随時更新)

- 学習履歴機能は「たたき台」段階（UI・淘汰ロジックとも簡易実装のまま）
- 【AI生成の既知の混同要因・未対応】prompt-def.js内で「テーブル」という言葉が、DBのテーブル（vja.db.*）とdatagridタグのウィジェット（テーブル型ウィジェット、vja.widget.set/setTableData等）の両方を指して使われている。ローカルLLMがYAML定義中の「テーブル」という語からどちらの操作か混同し、意図しない実装（ウィジェット側を触るべき所でDB操作をしようとする等）をするケースが確認されている。対応案は用語の書き分け（datagridウィジェット側を「テーブル」ではなく「データグリッド」等に統一）だが、まだ未着手。
- 既存プロジェクトの後方互換性（旧検証:記法のマイグレーション）は「今は自分しか使っていない」との理由で対応見送り
- 【将来対応検討】YAML/JSのロールバック機能: イベントごとに「正常に実行できた」YAML定義＋生成JSの組を履歴として残し、AI再生成で悪化した場合に以前の正常動作バージョンへ戻せるようにする。学習履歴機能（上記）と合わせて設計する必要がある。まだ未着手・仕様未確定
- 【将来対応検討】生成コードの日本語解説機能: AIがイベント処理コードを生成した後、続けて「このコードは何をしているか」を日本語で解説させる。VBA経験者・初学者向けの学習導線（README記載の「登竜門」コンセプト）に直結する機能。まだ未着手・仕様未確定
- 【将来対応検討】vjaランタイムAPIの拡充候補（優先度低・未着手）:
  - 印刷・帳票機能（vja.io.print/printElementはwindow.print()呼び出しのみで、ページ設定・ヘッダーフッター・複数レコード帳票レイアウトが無い）
  - グローバルホットキー登録（F5=保存等、画面全体のショートカット登録手段が無い。VB6のKeyPreview相当）
  - クリップボードからdatagridへの直接貼り付け（Excel貼り付け的操作）
  - 汎用モーダルダイアログ（alert/confirm以外の、入力付きプロンプトや子ウィンドウ）
  - 外部プログラム起動（生成したPDFを既定アプリで開く等）
  - バーコード/QR対応、画像サムネイル生成、ドラッグ&ドロップファイル入力
    （QR生成用に `src/mainview/qrcode.js` を配置済み。実装時はこれを利用する。
    文字数が多いとQRコードが生成されなくなるため、生成時は
    `correctLevel: QRCode.CorrectLevel.L` を指定する必要がある）
