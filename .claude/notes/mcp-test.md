<!-- CLAUDE.md から分離したノート（2026-09-29）。内容は分離前の記述をそのまま移したもの。 -->

# MCPによるテスト自動化

- 目視確認頼みだった「画面関連（ウィジェット配置・削除のデータ整合性）」「YAML関連（保存・削除時のオーバーライドpurge）」を自動テストするため、`mcp/vja-mcp-server.ts`（MCPサーバー、stdioトランスポート）を用意している
- 使い方: `bun run mcp`（`package.json`に定義済み。実体は`VJA_TEST_MODE=1 bun x electrobun dev`）でvjaを起動すると、`src/bun/index.ts`内にテスト用HTTPサーバー（デフォルトポート4570、`VJA_TEST_PORT`で変更可）が起動する。このサーバーが`browserWindow.webview.rpc.request.testXxx(...)`経由で`src/mainview/bridge.ts`のテスト用ハンドラを呼び出す
- MCPサーバー（`mcp/vja-mcp-server.ts`）はこのHTTPサーバーを叩くtoolを公開する。Claude Code等のMCPクライアントに`{ "command": "bun", "args": ["run", "mcp/vja-mcp-server.ts"] }`として登録して使う（プロジェクト直下の`.mcp.json`に登録済み。ただしMCPサーバーの追加は既存セッションには反映されないため、Claude Codeの再起動/MCP再接続が必要）
  - 画面関連: `vja_add_widget`/`vja_delete_widget`/`vja_get_widgets`/`vja_select_widget`/`vja_get_props_html`（後者2つはプロパティパネル・イベントタブの描画結果HTMLを取得し、画面を目視しなくても構造検証できるようにするためのもの）
  - YAML関連: `vja_save_yaml`/`vja_delete_yaml`/`vja_get_overrides`/`vja_format_js`（Prettier整形機能の検証用、`formatJsCode()`を直接呼び出す）
  - Validate関連: `vja_get_validations`/`vja_save_validation`/`vja_delete_validation`/`vja_get_tables`/`vja_save_table`/`vja_delete_table`/`vja_generate_ddl`
  - AI生成フロー関連（2026-09-18実装）: `vja_wizard_set_ai_mock`/`vja_wizard_decompose_forms`/`vja_wizard_generate_form_yaml`/`vja_wizard_generate_form_layout`/`vja_table_ai_generate_schema`/`vja_validation_ai_generate_rules`。詳細は下記「AI生成フローの自動テスト化」節参照
- `VJA_TEST_MODE`未設定時はテスト用HTTPサーバー自体が起動しないため、通常起動には影響しない
- テスト用ハンドラは、確認ダイアログやDOM読み取りを伴う既存のUI関数（`deleteYaml`/`validSave`/`tblSave`等）は自動化に不向きなため使わず、データ検証・操作ロジックのみを`src/mainview/bridge.ts`側に直接再実装している（`_testAddWidget`等）
- 2026-08-01時点でPhase 1（画面関連・YAML関連）・Phase 2（Validate関連: バリデーション定義・テーブル/カラム定義・DDL生成）まで実装済み
- 以下1点は「現状テストで必要ない」との理由で対応見送り（詳細は`.claudeWork/mcp-webview-test-idea.md`参照）
  - 保存・オープン・実行・コンパイルフロー全体の自動テスト化（ネイティブファイルダイアログが絡み、バイパス用の専用ルート設計が必要になる）
- AI生成フローの自動テスト化は、当初「ローカルLLM前提・生成結果が非決定的なため判定基準の設計自体が未確定」として見送っていたが、2026-09-18にAI応答をモックする方式で解消し、一部関数に実装済み（下記節参照）

## AI生成フローの自動テスト化（2026-09-18実装）

- **狙い**: 従来「AI生成結果が非決定的で判定基準が未確定」として見送っていたAI生成フローの自動テスト化を、AI応答自体をモックすることで実現。実AIの生成品質評価ではなく、「固定のAI応答に対しパース・反映ロジックが正しく動くか」を検証する回帰テストとして構成した
- **モック機構**: `runAiGenerate()`（`vja-modal.js`、AI生成の全関数が経由する共通実行関数）の冒頭で`window.__vjaTestAiMockQueue`（配列）を確認し、モック応答が積まれていればFIFOで1件消費して実際の`window.vja.fetch`呼び出しをスキップする。キューが空なら従来通り実AI APIを呼ぶため、通常起動時（`VJA_TEST_MODE`未設定時含む）には一切影響しない。このフックは`runAiGenerate()`共通部にあるため、対応済みの関数以外にも理論上は効くが、テストハンドラ（`bridge.ts`の`_testXxx`）が無い関数はMCP経由では呼び出せない
- **テストハンドラ追加済みの関数（`bridge.ts`）**:
  - `_testSetAiMockQueue({responses})`: モック応答キューをセット（他の全テストハンドラの前提として必須）
  - ウィザード系: `_testWizardDecomposeForms`/`_testWizardGenerateFormYaml`/`_testWizardGenerateFormLayout`（対象関数は`wizardDecomposeForms()`/`wizardGenerateFormYaml()`/`wizardGenerateFormLayout()`。後二者は旧`_wizardGenerateFormYaml`/`_wizardGenerateFormLayout`から命名規約に沿ってリネーム・グローバル展開）
  - テーブル/バリデーション系: `_testTblAiGenerateSchema`/`_testValidAiGenerateRules`（対象関数は`tblAiGenerateSchema()`/`validAiGenerateRules()`、`vja-table-validation.js`）。両関数は編集中データがDOM要素ではなく`TABLE_MODAL.edit`/`VALID_MODAL.edit`というJSオブジェクトに集約されているため、元関数を直接呼ばずテストハンドラ側で同等ロジック（プロンプト生成→`runAiGenerate`→JSON.parse→サニタイズ）を再現する設計にした。`_testValidAiGenerateRules`は元関数にある「UI編集用にrulesを最低3件までpaddingする」処理は意図的に含めていない（テストの関心事はAI生成結果のパース・サニタイズ検証であり、UI表示用の空行埋めではないため）
- **利用時の注意**: `wizardDecomposeForms()`は成功時に確認モーダルを描画する副作用が残っている（テストでは無視して良い）。`wizardGenerateFormLayout()`は実際にウィジェットを配置するため、テスト時は事前に状態をクリーンにしておくこと
- **元は未対応だった6関数も、2026-09-20〜21にすべて対応済み**: DOM読み書き（textarea・ボタン状態・モーダル再描画等）とAI呼び出し・パース・データ反映ロジックを分離し、後者を単独の関数として切り出してテストハンドラ（`bridge.ts`の`_testXxx`、`src/bun/index.ts`の`testXxx`）を追加した
  | 元の関数 | 切り出した関数 | テストハンドラ |
  |---|---|---|
  | `extRtGenDoc()` | `generateExtRuntimeDoc(js)` | `_testExtRtGenDoc` |
  | `textToYamlGenerate()` | `generateTextToYaml(wid, evName, inputText)`（widは対象ウィジェットID/`"form"`/`"appev"`） | `_testTextToYamlGenerate` |
  | `manualRetryAiFix()` | `retryAiFix(wid, evName, isAppEvent, isFormEvent, currentCode)` | `_testManualRetryAiFix` |
  | `formDesignTextToYamlGenerate()` | `generateFormDesignYaml(inputText, allTables)`（ウィザード版`wizardGenerateFormYaml()`と重複していた実装を共通化） | `_testFormDesignTextToYamlGenerate` |
  | `yamlAiGenerate()` | `generateEventJs(wid, evName, isAppEvent, isFormEvent, temperatureOverride)`（検証NGなら内部リトライを1回行う） | `_testYamlAiGenerate` |
  | `formDesignAiGenerate()` | `generateFormDesignAiLayout(rawText, addPromptExtra)` ＋ 共有`generateFormLayoutRaw(designText, extraPrompt, allTables)`（ウィザード版`wizardGenerateFormLayout()`と共通化。既存ウィジェット全削除＋`fullRedraw()`を伴う） | `_testFormDesignAiGenerate` |
  - `textToYamlGenerate`/`manualRetryAiFix`/`yamlAiGenerate`は内部で`$("yaml-ta")`等を読むため、意味のある入力で検証する場合は事前に`testSaveYaml`→`testOpenYamlEditor`でエディタへYAMLを読み込ませておく（`showLoadingModal()`を経由する実フローの検証は、下記「AI生成フローのテスト基盤」の`testVerifyPromptIntegrity`を使う）
- MCPクライアント経由の実疎通テストは実装時点では未実施（ビルド/起動が通ることと`bun test`の通過のみ確認済み）
- **実LLMへの実接続テスト**（2026-09-19〜20実施）: 上記のモック方式とは別に、`_testSetAiConfig({endpoint, model, apiKey, temperature})`（`bridge.ts`）で`aiConfig`を実LLM（例: `http://192.168.0.235:8080`、llama.cpp）へ差し替えた上で、モックキューを積まずに`_testWizardDecomposeForms`等をそのまま呼ぶことで、実際のAI応答に対する動作検証ができる。この方法で`wizardDecomposeForms`/`wizardGenerateFormYaml`/`wizardGenerateFormLayout`のパイプライン全体を実LLM(qwen2.5-coder-7b)で検証し、「画面デザインYAMLの参照テーブル欠落の機械的補完」（`ai-generation.md`の「AI生成コードの機械的な後処理」の節を参照）の不具合発見・修正確認に使った。**組織のエンタープライズポリシーでMCPサーバー(`vja-test`)自体が`/mcp`に接続できない環境では、HTTPテストサーバー（`bun run mcp`、ポート4570）へ直接curlでリクエストする方式で代替できる**（下記「実行手順」参照）

## 実行手順

1. `bun run mcp` でvjaをテストモード起動する（テスト用HTTPサーバーがポート4570で立ち上がる）
2. Claude Code側でMCPサーバー`vja-test`が接続済みか`/mcp`で確認する（プロジェクト直下の`.mcp.json`に登録済み）
   - 初回登録時・`.mcp.json`変更時はClaude Codeの再起動/MCP再接続が必要
   - 組織のエンタープライズポリシーでローカル（stdio）MCPサーバーの追加自体がブロックされる環境では、`.mcp.json`の設定が正しくても`vja-test`が`/mcp`に出てこない（`claude mcp add-json`も`not allowed by enterprise policy`で拒否される）。この場合はプロジェクト側の設定不備ではないため、ポリシー制約のない環境で試す
3. 接続済みなら、各tool（`vja_add_widget`等）をClaude Codeから呼び出してテストを行う

# AI生成フローのテスト基盤と、DOM読み取りタイミングの事故（2026-09-21）

- **事故の概要**: `yamlAiGenerate`/`textToYamlGenerate`のテスト自動化リファクタで、`$("yaml-ta")`等のDOMを読む`buildGenPromptContext()`の呼び出しを、誤って`runAiGenerate()`が呼ぶ`showLoadingModal()`（`#modal-root`を丸ごとローディング表示へ差し替える）**より後**へ移してしまい、生成の瞬間にはYAMLエディタのDOMが既に無く、依頼内容（YAML本文）が丸ごとAIに渡らないまま文脈の無いコードが生成される回帰バグとなった。DOM非依存のテストハンドラ経由の検証だけに頼っていたため見落とした
- **現状の対処**: `buildGenPromptContext()`に`domOverride`引数（`{yamlCur, addPrompt}`）を持たせ、`yamlAiGenerate`/`textToYamlGenerate`側が`showLoadingModal()`より**前**にYAML本文・追加指示を確保して`generateEventJs`/`generateTextToYaml`へ渡す
- **教訓**: DOM読み取りを伴う関数をDOM非依存にリファクタする際は、「呼び出し元のどのタイミングでDOM状態が変化しうるか」を確認する。DOM非依存版のテストハンドラだけでは検出できないため、実際のボタン操作フロー（`showLoadingModal`を経由する経路）でも最低限の動作確認をする。また「AIが書いたコードをAIが書いたテストで確認する」と同じ盲点を共有した自己確認になりがちなので、単一の判定基準（生成が成功したか等）に頼らず、多角的に確認する
- **再発防止用のテスト基盤**:
  - `window.__vjaLastPrompt`（`vja-modal.js`の`runAiGenerate()`が設定）: 実際に送信された`systemPrompt`/`userPrompt`本文を常に記録する
  - `window.__vjaTestAutoConfirm`（`vja-runtime.js`の`showVjaDialog`）: 確認ダイアログを自動テストで通過させ、`showLoadingModal()`を含む実際のボタン操作フロー全体を自動実行可能にする
  - `testVerifyPromptIntegrity`（`bridge.ts`）: `yamlAiGenerate()`を実際に実行し、①保存済みYAML本文が実際のプロンプトに一字一句含まれるか、②現在のウィジェット名、③「利用テーブル:」の各テーブル名、④`### `セクション見出しの数、⑤userLenが保存済みYAML本文の文字数を下回っていないか、を1回で検証する。`testYamlAiGenerateFull`も同様
  - **`testSetAutoConfirm`のパラメータ名は`{value:true}`が正**（`{confirm:true}`だと無音で無視され、`showConfirm()`が本物のダイアログで無期限に待機してハングする）。テスト用RPCハンドラを使う際は、`bridge.ts`側の実際の引数名を必ず確認する
- **テスト題材・接続先は個人環境に依存させない**:
  - 題材は個人のプロジェクトファイルを使わず、`mcp/fixtures/prompt-integrity-test.vjaproj.json`（リポジトリ同梱の固定フィクスチャ）を`testApplyProjectData`で読み込む。ウィジェット名`testSearchButton`/`testSearchInput`/`testSearchSelect`/`testResultGrid`、テーブル`test_items`、対象イベントは`testSearchButton`の`Click`（widget id=2）
  - ローカルLLMの接続先（IPアドレス等）はCLAUDE.md・コード・コミットに書かない。`mcp/fixtures/test-llm.local.json`（`.gitignore`済み、各マシンにのみ置く）に`{"endpoint","model","temperature"}`を定義し、テスト時に読んで`testSetAiConfig`へ渡す。テンプレートは`mcp/fixtures/test-llm.local.json.example`。ファイルが無ければユーザーに接続先を確認し、推測で決め打ちしない

# ウィザード生成のシナリオ＋実LLMテスト（Claude専用、2026-10-02）

- `bun run mcp/wizard-scenario-test.ts [--runs N] [--scenario 名前の一部] [--out 出力JSON]`。画面/Electrobun不要で、本物のウィザード関数（`wizardDecomposeFormsCore`→`wizardGenerateFormYaml`（必須ボタン補完込み）→`generateFormLayoutRaw`→`arrangeAiFormItems`）を実LLMで走らせ、自動チェックする。`bun test`には含めない（実LLM必須で遅く非決定的。`*.test.ts`の名前にしない）
- シナリオ: `mcp/fixtures/wizard-scenarios/*.json`（`name`/`formSize`/`appOverview`/`tables`）。追加はJSONを置くだけ
- 接続先: 既存の`mcp/fixtures/test-llm.local.json`（`.gitignore`済み）。無ければユーザーに確認する
- チェック: 一覧=datagrid/検索（条件入力あり）/新規登録、入力=登録系+戻る、メニュー=全一覧への遷移ボタン、全画面=アクション項目のボタンウィジェット有無・重なり・フォーム枠外。結果の詳細は`.claudeWork/wizard-scenario-result.json`
- 所要時間: qwen2.5-coder-7bで1シナリオ約2〜6分（画面数に比例）
- 注意: `runAiGenerate`の後処理は`vja-modal.js`と同内容を再現している（変更時は両方）。レイアウト結果は`applyAiFormDesign`のはみ出し補正の前の値
- 初回結果（1回ずつ）: 3シナリオ・14画面で必須ボタンの不足は0件。NGは1画面の重なり（datagridとラベル/textarea）のみ
