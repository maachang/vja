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
- **LLM利用方針**: 完全無料のローカルLLM（Qwen2.5 / Gemma等）を主軸としつつ、ローカルLLM環境がないPCでもOpenAIの超低コストモデル（`gpt-5.6-luna` / `gpt-4o-mini` 等）を活用可能な設計。1イベント単位の細分化リクエストによりトークン消費が極小であり、クラウドAPIでも実質数円レベル（ほぼ無償感覚）で利用できる強みをドキュメント等で積極推進している

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
| src/mainview/form-design-templates.js | 画面デザイン依頼（YAML）テンプレート定義一覧・取得共通モジュール |
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
- 使い方: `bun run mcp`（`package.json`に定義済み。実体は`VJA_TEST_MODE=1 bun x electrobun dev`）でvjaを起動すると、`src/bun/index.ts`内にテスト用HTTPサーバー（デフォルトポート4570、`VJA_TEST_PORT`で変更可）が起動する。このサーバーが`browserWindow.webview.rpc.request.testXxx(...)`経由で`src/mainview/bridge.ts`のテスト用ハンドラを呼び出す
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

## 実行手順

1. `bun run mcp` でvjaをテストモード起動する（テスト用HTTPサーバーがポート4570で立ち上がる）
2. Claude Code側でMCPサーバー`vja-test`が接続済みか`/mcp`で確認する（プロジェクト直下の`.mcp.json`に登録済み）
   - 初回登録時・`.mcp.json`変更時はClaude Codeの再起動/MCP再接続が必要
   - 組織のエンタープライズポリシーでローカル（stdio）MCPサーバーの追加自体がブロックされる環境では、`.mcp.json`の設定が正しくても`vja-test`が`/mcp`に出てこない（`claude mcp add-json`も`not allowed by enterprise policy`で拒否される）。この場合はプロジェクト側の設定不備ではないため、ポリシー制約のない環境で試す
3. 接続済みなら、各tool（`vja_add_widget`等）をClaude Codeから呼び出してテストを行う
# 学習履歴機能（AIプロンプト記憶）

- AIコード生成時の過去修正・注意事項を学習・蓄積する機能
- **保存スコープ・単位**: プロジェクト単位（`getProjectData().learnedFixes`）。`.vjaproj` ファイルに同梱保存される
- **スコープ階層**:
  - `wid_evName`: イベント個別ルール
  - `tag_<tagName>`: ウィジェットタグ共有ルール（同一タグで2回以上類似エラーが修正された場合に自動昇格）
  - `global`: プロジェクト全体共通ルール（手動追加・ピン留め可能）
- **プロンプト生成 (`_buildLearnedFixesCtx`)**: AIコード生成時、該当イベントの個別学習、タグ共通注意点、プロジェクト共通ルールを統合しプロンプトに自動挿入
- **UI（学習ノウハウ管理）**: メニューバーの [表示] ➔ [学習ノウハウ…] (`openLearnedFixesModal`) から一覧確認・ピン留め（固定）・手動ルール追加・削除が可能
- **テスト**: `src/mainview/learned-fixes.test.ts` でユニットテスト実装・検証済み

# 画面デザイン自動生成機能 (AI Form Design & Templates)

- **概要**: ユーザーがYAML形式で記述した画面目的・項目・レイアウト指示から、AIがウィジェットの配置座標（x, y, w, h）を含んだJSONを生成・自動配置する機能
- **レイアウトテンプレート分離構造**: `src/mainview/form-design-templates.js` にテンプレート定義（`FORM_DESIGN_TEMPLATES`）を独立管理。検索一覧、登録フォーム、ダイアログ、マスタ保守、伝票・明細入力、ダッシュボード等に対応
- **テンプレート選択UI**: 「🤖 AIでフォーム設計」モーダル上から `openFormDesignTemplateModal()` を呼び出し、`modal-layer-1` を用いたダイアログ形式でテンプレートを選択。既存記述がある場合は `vja.app.showConfirm` で上書き確認を実施
- **レイアウト自動生成プロンプト & 整列エンジン**:
  - `prompt-def.js`: パターン（検索一覧、登録、ダイアログ等）および YAMLパラメータ（`カラム数`, `ラベル位置`, `ボタン位置`, `密度`）の明確な解釈ルールを記述
  - `vja-designer.js` (`applyAiFormDesign`): 4px単位のグリッドスナップ、同一行のラベル・入力コントロールの垂直中央自動揃え、フッター領域の複数ボタンのきれいな右寄せ横一列整列（`gap: 10px`）、同一グループのラジオボタン整列を自動実行
- **テスト**: `src/mainview/form-design-templates.test.ts` でテンプレート取得ロジックのユニットテスト実装・検証済み
- **画面デザインYAMLドラフト生成（初心者導線）**: 「🤖 AIでフォーム設計」モーダルに **`✨ YAMLドラフト`** タブ（`fd-doc`）と **`📋 YAML`** タブ（`fd`）を用意し、以下の2段階フローで「YAML記法に不慣れな人」でも迷わず使えるようにしている
  1. **`✨ YAMLドラフト`タブ**: 「氏名・メールアドレス・部署の入力欄と保存ボタンが欲しい」のような、AIへの通常の指示と同じ感覚の普通の日本語文章を書く
  2. **`✨ YAMLドラフト生成`ボタン**（`formDesignTextToYamlGenerate()`）: 1の文章とプロジェクトのDBテーブル情報を元に、AIが `📋 YAML`タブへ画面デザインYAML（説明/フォームレイアウト/入力項目/参照テーブル/アクション項目）のドラフトを自動生成する
  3. 生成された `📋 YAML`タブの内容を必要に応じて手直しした上で、**`🤖 画面反映`ボタン**（`formDesignAiGenerate()`、既存のレイアウト自動生成プロンプト & 整列エンジンを利用）を押すと、実際のウィジェット配置に反映される
  - つまり「自然言語での指示 → AIによるYAMLドラフト化 → そのYAMLを土台に実装（画面レイアウト）へ進む」という導線であり、YAMLをいきなり手書きする必要はない
  - `formDesignDraft`/`formDesignDocDraft`は各フォーム（`getProjectData().forms[idx]`）ごとに保持され、他フォームの内容が混入しないよう`syncCurForm()`/`commitFormDesignDraft()`で同期・書き戻しされる
  - プロンプト定義: `prompt-def.js` の `ENG_FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT` / `ENG_FORM_DESIGN_TEXT_TO_YAML_USER_PROMPT`

# イベントYAMLドラフト自動生成機能 (Text to YAML)

- **概要**: ユーザーが「やりたいこと」を普通の一言日本語で入力するだけで、AIがフォーム内のウィジェットやDBテーブル情報を考慮し、イベント用YAML定義のドラフトを自動生成する機能。上記の画面デザインYAMLドラフトと同じ「初心者導線」の考え方（自然言語での指示 → AIによるYAMLドラフト化 → そのYAMLを土台に実装（JS生成）へ進む）をイベント側にも適用したもの
- **アクセス点**: イベントYAMLエディタの **`✨ YAMLドラフト`タブ**（`tab-prompt`、旧称「✨ 依頼」タブ）に日本語のやりたいこと文章を入力し、`textToYamlGenerate(wid, evName)`を実行すると `📋 YAML`タブへドラフトが生成される（旧仕様の別モーダルボタン`openTextToYamlModal`は現在は存在せず、エディタ内タブに統合済み）
- **プロンプト定義**: `prompt-def.js` の `ENG_TEXT_TO_YAML_SYS_PROMPT` / `ENG_TEXT_TO_YAML_USER_PROMPT`
- **テスト**: `src/mainview/text-to-yaml-prompt.test.ts` でユニットテスト実装・検証済み

# 既知の制約

- **Linux開発実行時のタスクバーアイコンが反映されない**: `electrobun.config.ts`の`build.linux.icon`設定・アイコンファイルのコピー自体は正しく行われている（`Resources/appIcon.png`等に反映済み）ことを確認済み。しかしElectrobunが生成する`.desktop`ファイルの`Icon=`指定がファイル名のみ（絶対パスでない）であり、Linuxデスクトップ環境は`.desktop`ファイルが`~/.local/share/applications/`等の標準位置にインストールされ、アイコンもXDGアイコンテーマの検索パス上に見つかる場合のみタスクバー表示に反映する仕様。`bun run dev`（未インストールの開発実行）の`build/dev-linux-x64/`配下に生成される`.desktop`ではこの条件を満たさないため、タスクバーアイコンが変わらないのはVJA側の設定不備ではなくElectrobunのdev実行時の制約と推定される（未確認）。`bun run build`でパッケージング・インストールした状態、または別のLinuxデスクトップ環境で実際に変わるか要確認。

- **Windowsで`.exe`へのアイコン埋め込みが失敗する（Electrobun本体のバグ）**: `bun run dev`実行時、以下の警告が出てアイコンが`launcher.exe`/`bun.exe`に埋め込まれない。
  ```
  Warning: Failed to embed icon into launcher.exe: ResolveMessage: Cannot find module
  'D:\a\electrobun\electrobun\package\node_modules\rcedit\package.json' from 'B:\~BUN\root\electrobun'
  ```
  原因はVJA側の設定ではなく、npm配布されているElectrobun本体（CLIバンドル）が`rcedit`モジュールを、Electrobun本体をビルドしたCIマシン上の絶対パス（`D:\a\electrobun\electrobun\package\node_modules\rcedit`）でrequireするようハードコードしてしまっているバグ。どの環境でインストールしてもこのパスは存在せず解決できない。VJA側での修正は不可能なため、Electrobun側の修正（バージョンアップ）待ち。自前でのワークアラウンド（`rcedit`を後処理で直接呼んで埋め込む等）は今回あえて対応しない。

# 未対応・残課題(随時更新)

- 学習履歴機能のブラッシュアップ対応済み（イベント/タグ/グローバルマルチスコープ、タグ自動昇格、ノウハウ管理ダイアログUI追加済み。`src/mainview/learned-fixes.test.ts` でテスト済み）
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
