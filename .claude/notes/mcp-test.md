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
- シナリオは9件（2026-10-03時点）: 基本3件に加え、`library-3tables`/`shop-4tables`（多テーブル）、`employee-wide-many-columns`（12カラム・1024×600）、`memo-small-form`（480×360）、`no-label-english`（日本語名なし）、`managed-columns-2tables`（管理系カラム入り）。全9件を1回流すと約45分
- 追加チェック: 管理系カラム（`managed:true`のカラムのnameとlabelJa）が、画面YAMLの入力項目・レイアウトのlabel/datagrid列に出ていないこと。除外を外した対照実験で4件NGになることを確認済み（検査が有効な根拠）
- 長時間実行の注意: Bashの`run_in_background`は既定30分で打ち切られる。全シナリオを流すときは`timeout`を2時間（7200000）にすること。`pkill -f`は自分自身のコマンド行にも一致して自殺するので使わない。結果JSONは完走時にしか書かれない（途中で落ちるとログの`[シナリオ #n]`行しか残らない）
- 初回結果（1回ずつ）: 3シナリオ・14画面で必須ボタンの不足は0件。NGは1画面の重なり（datagridとラベル/textarea）のみ
- 2026-10-03の改善後の結果: 全9シナリオ・各1回でNG 0件（ローカルLLM qwen2.5-coder-7bのみ。複数回の通し・実機での見え方・別モデルは未確認）。結果は`applyAiFormDesign`の補正前の値

# 拡張ランタイムの実LLMテスト（2026-10-06）

- `bun run mcp/ext-runtime-test.ts [--runs N] [--part doc|event]`: 画面/Electrobun不要。接続先は`mcp/fixtures/test-llm.local.json`（wizard-scenario-testと共通）、題材は`mcp/fixtures/ext-runtime/scenarios.json`。結果は`.claudeWork/ext-runtime-result.json`。bun testには含めない
- doc: 拡張ランタイムJS→説明YAML（`generateExtRuntimeDoc`）。関数の抽出漏れ・asyncのawait・引数・日本語・YAMLパースを検査
- event: 固定の説明YAMLを渡したイベントコード生成。拡張関数の呼び出し有無・await・引数個数・自前再実装・架空関数を検査（`buildGenPromptContext`は使わずプロンプト関数を直接呼ぶため、ウィジェット絞り込み等は対象外）
- 教訓: ①asyncのawait指示は「`async`宣言なら必ず先頭にawait」と具体化しないと守られない（0/10→10/10）。②優先順位ルールは「同じ仕事をする拡張関数があれば、ロジックが簡単でも再実装せず必ず呼ぶ」と書かないと、7Bは説明の式を自前で再実装する（0/10→10/10）。③テストの固定YAMLの説明文が空疎だと誤判定の原因になる（題材側の不備を先に疑う）。④プロンプトの実験は、スクリプト内で読み込み文字列を差し替えて比較し、製品側は承認後に変更した
- `--fixture scenarios|scenarios-many|scenarios-paraphrase`で題材を切り替える。many=10関数（async3個）、paraphrase=同じ10関数で依頼文を説明文と語が重ならない言い換えにしたもの
- 結果（qwen2.5-coder-7b）: 3関数=全項目10/10（2026-10-06）。many=5回とも全件OK。paraphrase=6シナリオ中4つは10/10、**「消費税込みの支払い額」(calcTax)と「入力ミスの検出」(isValidEmail)が0/10**。依頼文が計算式・判定条件（「1円未満は切り捨て」「@と.を含むか」）まで書いていると、拡張関数を呼ばず自前で書き、税率0.08など値も創作する
- 教訓: 上記の再実装は、ルール2)に「依頼が手順まで具体的でも呼ぶ」「引数の値を創作しない」を足しても0/10のまま直らなかった（プロンプト文言の追加は限界）。依頼が「何をしたいか」だけなら言い換えても成功する。対策はtext-to-yamlへ拡張関数の説明を渡して、YAMLの段階で関数名を入れさせる方式（下記、取り込み済み）。生成後に再実装を検出する案は未着手
- `--part pipeline`（依頼文→text-to-yaml→イベントコード。paraphraseの`request`を使用）。`--ttyext 1`でtext-to-yamlへ拡張ランタイムの説明を渡す（0=渡さない従来動作との比較用）。結果（qwen2.5-coder-7b、各10回）: 従来30/60（YAMLに関数名が一度も入らずtax/email/rateが0/10）→ 渡すと60/60。**製品へ取り込み済み（2026-10-07、f1ffe43）**: `text-to-yaml.ext-runtime.eng.md`を`TEXT_TO_YAML_SYS_PROMPT`が`extRuntimeDoc`のある時だけ末尾へ足す（空なら従来と完全に同一のプロンプト）。製品の実装経由でも60/60を確認
- 教訓: 引数個数のチェックは入れ子の括弧（`vja.widget.get('x')`）を数え誤りやすい。括弧対応で数えること（notifyが偽NGになった）
- **実機E2E（2026-10-07）**: `mcp/ext-runtime-e2e.ts`。`bun run mcp`でテストモードのvjaを起動→`bun run mcp/ext-runtime-e2e.ts [--runs N]`でHTTP(4570)経由に、拡張ランタイム設定→YAMLドラフト生成→イベントJS生成を実アプリの経路（YAMLエディタを開いた状態）で確認する。実際に送られたプロンプトは`.claudeWork/ext-runtime-e2e-lastprompt.json`へ出る。結果: 拡張なしでは拡張関数のセクションが出ず、ありではYAMLに`calcTax`が入り、生成コードも`calcTax(amount, 0.1)`と呼ぶ（6回とも全項目OK）。依頼文に税率を書かないと、モデルが0.08を創作し同期関数に`await`を付けた（テストの依頼文の不備で、製品の問題ではない。引数の値が依頼に無いと崩れる）
- 教訓: テスト用vjaを止める時、`pkill -f`はそのコマンド自身の文字列にも一致して実行中のシェルごと落ちる。PIDを指定して`kill`すること
- **gpt系の確認（2026-10-07）**: `--preset <共通AIプリセット名の一部>`（例: `--preset gpt6luna`）。`~/.vja-designer/ai-global-presets.json`のプリセットで接続し、apiKeyありはアプリ(vja-modal.js)と同じくapi.openai.comへ送る（temperature/max_tokensは送らない、キーは表示しない）。gpt-6-luna、各5回: doc 5/5、event(言い換え6シナリオ)全5/5、pipeline現行25/30（isValidEmailのみ0/5。YAMLに関数名が入った例は0）→ 案B 30/30。モデルを問わず現行ではYAMLに関数名が入らず、案Bで解消する
- gpt-5.6-luna（同条件、各5回、2026-10-07）: doc 5/5、event全5/5、pipeline現行27/30（isValidEmailのみ2/5、YAMLに関数名が入った例は0）→ 案B 30/30。qwen7b・gpt-6-luna・gpt-5.6-lunaのどれでも、現行はYAMLに関数名が入らず、案Bで解消する
- 未確認: 各シナリオ10回以上の統計
- 実行時間: pipelineの6シナリオ×10回は約24分。`nohup ... &`で動かしログをファイルへ出し、終了は「テスト本体のプロセス」で判定する（起動コマンドの完了通知は本体の終了ではない）。待ち監視の期限は30分以上にする
