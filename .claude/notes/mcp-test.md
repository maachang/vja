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
- **実LLMへの実接続テスト**（2026-09-19〜20実施）: 上記のモック方式とは別に、`_testSetAiConfig({endpoint, model, apiKey, temperature})`（`bridge.ts`）で`aiConfig`を実LLM（例: `ローカルのllama-server（開発用LLMサーバー））へ差し替えた上で、モックキューを積まずに`_testWizardDecomposeForms`等をそのまま呼ぶことで、実際のAI応答に対する動作検証ができる。この方法で`wizardDecomposeForms`/`wizardGenerateFormYaml`/`wizardGenerateFormLayout`のパイプライン全体を実LLM(qwen2.5-coder-7b)で検証し、「画面デザインYAMLの参照テーブル欠落の機械的補完」（`ai-generation.md`の「AI生成コードの機械的な後処理」の節を参照）の不具合発見・修正確認に使った。**組織のエンタープライズポリシーでMCPサーバー(`vja-test`)自体が`/mcp`に接続できない環境では、HTTPテストサーバー（`bun run mcp`、ポート4570）へ直接curlでリクエストする方式で代替できる**（下記「実行手順」参照）

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
- バックグラウンド実行の完了判定: 完了通知の対象は起動コマンド（即終了する）であり、テスト本体の終了ではない。本体の終了は、プロセス（`ps`でPIDを確認。`pgrep -f`は自分のシェルに一致しうる）か、完了時にDONEファイルを作るラッパースクリプトで判定する。Monitorの期限は見込みの2倍以上にする。所要時間は「前回は約◯分」と実績で伝え、結果が出るまで成否は断言しない（実際に約24分かかり、断言した所要時間より大幅に長く、監視も期限切れになった）。進捗は件数（`grep -c "^\["`）で確認する。待ち用のwhileループをBashの前景に置かない（10分で打ち切られ、残骸プロセスが残る）
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

## 実行時エラー→「AIで修正」のテスト（2026-10-07）

- `mcp/runtime-error-fix-e2e.ts`（`bun run mcp`で起動したvjaの4570へ接続。`--runs N --preset <共通AIプリセット名の一部>`）。`testManualRetryAiFix`に`runtimeError`を渡し、S1コードの誤り／S2握りつぶし／S3外部要因（通信失敗）を機械判定する。
- 結果（各10回）: qwen2.5-coder-7b 30/30、gpt-6-luna 29/30（残り1件は通信先URLを変数に入れた書き方を判定が拾えなかっただけ）、gpt-5.6-luna 30/30。
- 【教訓】テスト題材の作り方で結果が大きく変わった。
  - AI修正のプロンプトは、YAMLを**エディタ欄(DOM `#yaml-ta`)から読む**。修正実行中のローディングでエディタが閉じるため、**実行ごとに`testOpenYamlEditor`で開き直す**こと（1回目だけ効いて2回目以降が空になる）。
  - 任意API（`vja.fetch`等）を使うシナリオは`apiOptOverrides["<wid>_<ev>"]=["http"]`で有効化しておく。無効だと「無効化されたAPI」として回避され、別の実装に書き換えられる。
  - gpt系は、バグ箇所だけでなくYAMLに沿ってイベント全体を書き直すことがある。判定は「バグの除去」を見て、特定の書き方（`rows.length`等）まで要求しない。
- 一覧のボタン操作（`openRuntimeErrorEvent`/`aiFixRuntimeError`）と、実行ウィンドウからの実際の通知経路は、自動テスト未対応。手元で1回確認すること。
- フェーズ4（アプリイベント＝Bun側のOnStart/OnExit）: 報告は`widgetName="appev"`、`eventName=onStart/onExit`。Bun側の行補正は3（`"use strict";\n`を足した AsyncFunction、Bun(JSC)実測）。S4（OnStartで存在しないAPIを呼ぶ）は qwen 10/10、gpt-6-luna 10/10。握りつぶし（swallowed）はBun側では未対応（`_vjaLastError`相当が無い）。

# JSからYAML化の実機E2E（2026-10-08）

- `bun run mcp/js-to-yaml-e2e.ts [--runs N] [--preset <共通AIプリセット名の一部>]`。テスト用ハンドラ`testJsToYamlGenerateFull`（`bridge.ts`、要`testSetAutoConfirm`）がボタン操作フロー全体を実行する。条件分岐/繰り返し/単純の3シナリオ＋ウィジェット名の保持を判定
- **起動中のアプリはprompts/*.mdを起動時のコピーで使う**。プロンプトを直したら`bun run mcp`を再起動しないと反映されない。停止は`ps`でPIDを取って`kill`（`pkill -f`/`pgrep -f`は自分のシェルに一致して自殺する）

# 記録型モック（書き込み系APIの呼び出し履歴）とwidget-event-e2e（2026-10-15）

- モック(`vja-mock-runtime.js`と、Worker用複製`vja-mock-check.js`の`_MOCK_WORKER_RUNTIME_SRC`部)の書き込み系API（`widget.set/setValue/setItems/setSuggestions/setTableData/setVisible/show/hide/enable/disable`、`form.navigate/setParam`、`session.set`）は、挙動は従来どおり（何もしない）のまま、`["widget.setValue", 引数...]`を`__calls`へ記録する。**2か所は手動同期**（片方だけ直さない）
- Workerは成功時に`postMessage({ok:true, calls})`を返す。本番の検証(`_runMockSmokeTest`)は`recorder`引数を渡さない限り履歴を使わない。テスト入口は`runMockRecord(code, evName, wtag, wid)`（`vja-mock-check.js`）→`_testMockRunRecord`（`bridge.ts`）→`testMockRunRecord`（`src/bun/index.ts`のtestMethods）
- `bun run mcp/widget-event-e2e.ts [--ai --runs N]`: 手書きコードで記録を検証(A)／実LLMで`testSearchButton`のClickを生成し、結果が`testResultGrid`へ渡っているか・宛先が実在するかを判定(B)。2026-10-15、Aは全項目OK、B(qwen2.5-coder-7b)は5回とも`vja.widget.set('testResultGrid', result)`でOK
- 判定できるのは「どのウィジェットへ・どの値を・どのAPIで渡したか」まで。画面が実際に変わるか（描画）は対象外で、実行ウィンドウの目視確認が要る。画像(Image)のような描画依存のものも同様
- 教訓: `testApplyProjectData`は`aiConfig`も置き換える。実LLMで回すときは、適用の**後**に`testSetAiConfig`を呼ぶ（先に呼ぶと既定の`localhost:8080`へ接続して`error`になる）
- **全ウィジェット種別版**（2026-10-15）: `bun run mcp/widget-event-all-e2e.ts [--part E|T] [--only 名前の一部] [--runs N]`。E=18種×全イベント（msgLabelへ目印文字列を設定）、T=ボタンClickで各種別へ値を反映。結果は`.claudeWork/widget-event-all-result.json`。qwen2.5-coder-7b・各1回で77/79 OK。NGの2件: `E:checkbox.CheckedChanged`（YAMLに無い「チェック状態での分岐」をAIが足し、モックのcheckbox既定値falseでelse側へ入った）、`T:textarea`（「複数行に設定」の指示の文字列を使わず、取得値の再設定＋架空のoptionsを書いた）。pictureの差し替えは対象外
- **【教訓・偽OK】`testYamlAiGenerate`はYAMLをエディタ欄(`#yaml-ta`)から読むため、エディタを開かずに呼ぶとYAML本文がプロンプトに入らない**。この状態でも、テーブル定義だけから「それらしいコード」が生成され、判定が偶然通った（widget-event-e2e.tsのBパートが一度偽OKになった）。生成は`testOpenYamlEditor`→`testYamlAiGenerateFull`で行い、生成コードはウィジェットの`jsCode`から取り出す。送信プロンプトにYAMLの要点が入っているかも確認する（`generateViaEditor`）
- **全ウィジェット版の2件のNGの原因調査（2026-10-16）**:
  - `T:textarea`は**題材の不備**。指示の値「複数行」を、AIは設定する文字列ではなくtextareaの性質（改行処理）と読んだ（0/10）。「こんにちは」に変えると8/8。**テストの値は、ウィジェット種別の性質を連想させる語（複数行・数値等）にしない**
  - `E:checkbox.CheckedChanged`（0/10、radioの同構成は10/10）は**モデルの先入観**で、YAMLに無い「チェック状態での分岐（外れたら空）」を足す。直接LLMへ送る切り分けで、Input Parameters欄・説明文・種別名/ウィジェット名/YAML中の語を1つだけradioへ置換しても直らず、checkboxの語を**全部**radioへ置換した時だけ0/8になった。システムプロンプトへの「指示にない分岐・getの禁止」追記や、既存の禁止例へのCheckedChanged追記では、どちらも直らなかった（7B、temperature 0）。既存の「Fidelity to YAML」ルールは、イベント名からの推測を既に禁じている
  - 対応: 既知の制約として記録のみ（製品は変更しない）。実際の利用で条件が必要なら、YAMLに「チェックされた場合:」の見出しを書く。コード側で「見出し無しなのに`if`」を検出する案は、`rows.length`等の正当な`if`で誤検出する恐れがあり、誤検出率を測ってから判断する（未着手）
  - 切り分け方法: `testGetLastPrompt`で実際のプロンプトを保存→要素を1つずつ置換して直接LLMへ送る。システム/ユーザーの置換が効いたか（元の文字列が存在したか）を必ず確認する
- **イベント以外のウィジェット動作**（2026-10-16）: `bun run mcp/widget-props-e2e.ts`（LLM不要・決定的）。P=17種のプロパティ値がデザイナーの描画(`testGetWidgetHtml`)に反映されるか、L=追加→選択→削除でデータ・描画・プロパティパネルが整合するか。34/34 OK。2026-10-16に、以前プレビュー未反映だった`disabled`/`readonly`（button/inputtype/textarea/datepicker/slider）と、hscroll/vscrollのつまみ位置（つまみ長30%固定、位置は(val-min)/(max-min)×70%）をプレビューへ反映し、判定項目へ移した（`templates/widget-preview.html`の`attrs`/`pos`、`vja-defs.js`の`_previewAttrs`/`_scrollThumbPos`）。pictureは対象外
- **【教訓】テスト用vjaの停止**: `bun run mcp`のPID(`.pid`に控えたもの)をkillしても、子のvja本体(`build/dev-linux-x64/.../bin/bun`)が残り、ポート4570を握り続ける。次の起動は`EADDRINUSE`で失敗し、**変更前のコードのvjaへ接続して「直したのに反映されない」ように見える**。停止は`ss -ltnp | grep :4570`でリッスン中のPIDを取ってkillし、`ss -ltn | grep -c :4570`が0になるのを確認する

# イベントJS生成の失敗パターン集計 js-gen-e2e（2026-10-20）

- `bun run mcp/js-gen-e2e.ts [--runs N] [--only id,id] [--out path]`。業務寄りの24依頼（DB検索/登録/更新/削除、入力チェック、ウィジェット連携、繰り返し、確認ダイアログ、画面遷移、セッション、CSV、ローディング、エラー処理）を、YAML固定で実LLMへ生成させ、①生成成否 ②本番の`validateGeneratedJs`の種別 ③モック実行エラー ④意図一致、を集計する。結果は`.claudeWork/js-gen-result.json`。製品側に追加したのはテスト用ハンドラ`testValidateJs`（`bridge.ts`/`src/bun/index.ts`）のみ
- 任意APIカテゴリ（form/session/io/file等）は**既定で無効**。依頼で使うならシナリオの`apis`で有効にする（有効化を忘れると、AIはそのAPIを知らされないまま書かされ、失敗が生成の問題に見える）。判定のAPI名は`prompts/vja-front-api-*.md`で裏取りする（`vja.ui.loading`を`showLoading`と思い込み、判定を誤った）
- 実測（qwen2.5-coder-7b、temperature 0、各5回）。`temperature 0`のため同一依頼は5回ほぼ同じ結果になり、5回は独立な標本ではない（依頼の数が実質の標本数）
  - 判定修正後: 24依頼中、全5回OKが20依頼、残りの失敗は次のとおり
  - 生成の失敗（実際の誤り）: D5=存在しないウィジェット名`testResultGrid.selectedId`を創作、W4=「クリア」に指示のない`if (name || category)`を付けて条件付きにした、W5=selectBoxの選択肢にsetSuggestions（inputtype用）を使用、D4=1/5でUPDATEが無い
  - **検証側の誤検知（2026-10-20修正済み）**: `vja.form.setParam('itemId', ...)`のキー名が`findUnknownWidgetNames`（`vja-ai-gen-core.js`、`_WIDGET_NAME_ARG_APIS`にform.setParam/getParamを含む）でウィジェット名として検査され、正しいコードがNGになる（`_WIDGET_NAME_ARG_APIS`からform.setParam/getParamを外して解消）
  - **モックの欠落（2026-10-20修正済み）**: `vja.io.toCsv`が実ランタイム（`vja-runtime.js`）にはあるのにモック側に無く、正しいコードがmockErrorになる（`vja-mock-runtime.js`と`vja-mock-check.js`のioへparseCsv/toCsvを追加して解消。saveText/print/printElementは未追加）。修正後の再測定でN2・X1とも5/5 OK
  - **D4/D5は依頼の設計ミスだった（修正済み）**: 「選択行のidを取得」は、ボタンClickから取る手段がランタイムに無い（選択行は`RowClick`の`vja.event.get().row`のみ）。AIは正解を書けず誤名を出し続け（リトライでも別の誤名）、原因は7Bでもリトライでもなかった。依頼を「edtNameの値で一致する行」へ直したらD4は5/5。**テスト依頼は、実ランタイムで書ける内容か、APIドキュメントで裏取りしてから作る**。（製品側の論点: 「選択行を使う」操作を書けないことをユーザーに示せていない。必要なら別途検討）
  - **D5（確認ダイアログの欠落）の切り分けと対応（2026-10-20）**: 依頼修正後も0/5。プロンプトを直接LLMへ送る実験（7B、temp0.3×20＋temp0×1）で、原文は15/20（temp0は不合格）、「入力チェック: なし」行を消す・「エラー終了」行を消すと20/20、「正常終了: なし」行を消すのは17/20（効果なし）、入力チェックを「edtNameが空でないこと」にすると4/20、欠落を指摘してリトライすると20/20。原因は、見出し（入力チェック/エラー終了）が付くDB削除の依頼で、7Bが「入力チェック→DB削除→catchでダイアログ」の定型へ戻り、YAMLの確認手順が抜けること（単一のトリガーではない）。システムプロンプトには「入力チェック」の説明が無い。対応は`_findMissingConfirm`（`vja-mock-check.js`）: YAMLに「確認ダイアログ」の語があるのにコードに`vja.app.showConfirm`が無ければ`forbiddenPatterns`へ入れ、既存のリトライに乗せる。YAMLは`validateGeneratedJs`の`opts.yamlText`で渡す（`generateEventJs`のみ。`retryAiFix`/`manualMockCheck`は未指定＝検査しない）。D5は5/5（リトライで解消）。見出し行を送らない前処理は、全イベントのプロンプトが変わるため見送り
  - **`setSuggestions`の誤用を検証に追加（2026-10-20）**: `_findMisusedSetSuggestions`（`vja-mock-check.js`）。inputtype自身のSuggestイベント以外からの呼び出し・自分以外のウィジェット宛を`forbiddenPatterns`へ入れ、リトライ・行コメント・バナーの既存経路に乗せた。W5（Clickからselectboxへ使用）が0/5→5/5（5回とも検出→リトライで解消）

  - **全24依頼の再測定（2026-10-20、上記の修正後、qwen2.5-coder-7b・temp0・各5回）: 115/120 OK**。残りはW4（クリア。指示に無い`if (name || category)`で条件付きにする。機械判定は困難）の0/5のみ
  - **gpt-6-luna との比較（2026-10-20、`--preset gpt6luna`、24依頼×各5回、同じ検証・同じYAML）**: 110/120。落ちたのはW1・W2の10件で、すべて`GENFAIL: プロンプトにYAML本文が入っていない`（生成コードの失敗ではなくテストの前提チェック）。W1・W2だけを再実行すると10/10 OKで、**再現せず原因は未特定**（全体実行中の一時的な事象と思われるが未検証。`__vjaLastPrompt`が古い値のまま残った＝その回は生成が走らなかった可能性）。これを除くと実質120/120。7Bで0/5だったW4（クリア）も5/5で、**7B固有の失敗は、指示に無い`if`を足すW4のみ**。7Bの残り（D5の確認ダイアログ欠落、W5のsetSuggestions誤用）は、lunaは検証・リトライ経由で通った回があるか未記録（結果JSONに初回コードの検証結果は残していない）
  - `js-gen-e2e.ts`は`--preset`で共通プリセットのOpenAI等へ接続できる（APIキーは表示しない）
  - **リトライの記録（2026-10-21）**: `js-gen-e2e.ts`は、アプリのログ（`--applog`、既定`.claudeWork/mcp-run.log`。`bun run mcp > そのファイル`で起動した場合）の`[AI検証]`行から、リトライの有無・初回の検出内容・解消したかを結果JSON（`retry`）と集計に出す。製品コードは変えていない。ログが読めない時は`retry`がnullになり集計から外れる
  - 7B・24依頼×5回: 最終115/120。**初回で検証OK（リトライ無し）かつ最終OKが105/120、リトライしたのは10回（D5の確認ダイアログ欠落5・W5のsetSuggestions誤用5）で全て解消**、残り5回はW4（意図不一致）。つまり今回追加した2つの検証が、初回成功率87.5%を最終95.8%へ引き上げた全て。temp0で同一依頼は同じ結果になるため、実質の標本は24依頼（効いたのは2依頼）
  - **種類を増やした26依頼の追加（2026-10-21、7B・各3回）**: RowClick/HeaderClick（`vja.event.get`）、KeyDown（Enter/Escape）、TextChanged、SelectedIndexChanged、slider/datepicker/progressbar/listbox、Load、DBの応用（トランザクション・0件分岐・GROUP BY・重複チェック）、http/file/crypto/trigger/getAllInputs/closeWindow、複合（登録→クリア→再検索、複数分岐）。結果は75/78（Z4はマーカーを「再検索」としたがYAMLに無い語で、私のテスト誤り→「再表示」へ直し3/3）。**初回成功率も75/78（リトライが働いたのはH1の3回のみで解消せず）**。前の24依頼より広い範囲でも、7Bはほぼ通る
  - **H1（http.get）が0/3: 7Bが`JSON.parse(await vja.http.get(url))`と書く**。実ランタイムの`vja.http.get`は、JSONレスポンスなら解析済みのオブジェクト（それ以外は文字列）を返す（`vja-runtime.js`のhttp.get）ため、このコードは実機でも失敗する（モックは`{}`を返し、同じ失敗をしており、モックの誤検知ではない）。プロンプトの説明（`vja-front-api-optional.http.eng.md`）は`return: "any"`のみで、JSONが自動解析されることを書いていない。リトライ（モックエラーの指摘）でも直らなかった（0/3）
  - **H1の対応（2026-10-21）**: `vja-front-api-optional.http.eng.md`の`vja.http.get/post`の説明へ「JSONレスポンスは解析済みのオブジェクト/配列で返る（`JSON.parse`不要）、それ以外は文字列」を追記し、`return`を`"object|string"`にした。直接LLM（7B）で、原文は temp0.3で9/20・temp0不合格、修正後（get＋post）は20/20・temp0合格（getのみでも同じ）。反映後のE2EでH1は5/5（全てリトライ無しの初回OK）。他のhttp利用の依頼は無いため、他への影響は未測定（httpを有効にしたイベントのプロンプトのみ変わる）。`put`は実ランタイムでも同じ戻り値で、説明は`post`の「同じ引数」の記述に含まれる。`delete`は`res.ok`（真偽値）を返し、今回の文は`get/post`のみ

# アプリイベント（Bun側）のjs-gen-e2e（2026-10-21）

- `js-gen-e2e.ts`にアプリイベント9依頼（A1〜A10、A6は欠番）を追加。シナリオの`app: true`で`openAppEvents`→`yamlAiGenerate("appev", …)`→データモデルからJS取得（`generateAppEvent`）。テスト専用ハンドラ`testOpenAppEvents`/`testGetAppEvent`と、`testMockRunRecord`/`runMockRecord`の任意引数`isAppEvent`（Bun側モックで実行）を追加した
- 判定の誤り2点（修正済み）: ①バック側`vja.*`は同期関数だが、`project-runner.ts`の`_runAppEventCode`は`AsyncFunction`で実行し「awaitを付けても無害」なので、awaitの有無は失敗にしない ②A6（`CREATE TABLE`）は「利用テーブル0件でvja.dbを使うとNG」の規則と矛盾する依頼で、テーブルはプロジェクトで定義する設計なので外した
- 実測（7B、各3回）: 27件中15件OK。**失敗は全て「実行環境に無いAPI」を使うもの（A4・A5・A7）**。実行環境の`vja`（`_runAppEventCode`）は`session.get/set/delete`、`db.query/execute/clearTable`、`log.*`のみで、**プロンプト（`vja-back-api-full.*.md`）とモック（`vja-mock-runtime.js`/`vja-mock-check.js`）に載っている`vja.db.importCsv/importJson`と`vja.session.clear`が実在しない**。AIはドキュメントどおりに書くので、実行すると「is not a function」になる。モックは実装しているため検証をすり抜ける。`importCsv/importJson`は`524451b`（2026-06-15、project runnerへ寄せた整理）まで`index.ts`にあり、そこで失われた。`session.clear`は`_runAppEventCode`のvjaに無い（`_session.clear()`自体は`project-runner.ts`内の別処理にある）
- A1の1回は、モックの`db.query`が`[{}]`を返し`COUNT`の値がundefinedになる誤検知（既知の「Mockのダミーデータ」の教訓）
- **対応（2026-10-21、案1）**: アプリイベントの実行環境（`project-runner.ts`の`_runAppEventCode`）へ`vja.session.clear`・`vja.db.importCsv`・`vja.db.importJson`を実装。取り込み本体は単体テストできる`db-manager.ts`の`importCsvText`/`importJsonData`（`db-manager.test.ts`に6件追加、`bun test`は263件合格）。`session.clear`は`__`始まりの内部キー（`__onStart_done__`）を残す（消すと`runOnStart`の二重実行防止が外れるため）。CSVはCRLFにも対応（以前の実装はLFのみで最終列に`\r`が残った）。取り込みは全件1トランザクションで、失敗時は例外（ロールバック）。**実機（デザイナーでOnStartにimportCsv/session.clearを書いて実行）での確認は未実施**
- **実機相当のテストを自動化（2026-10-21）**: `src/bun/project-runner.test.ts`（5件）。`electrobun/bun`を`mock.module`で空のスタブへ差し替えてから動的importし、`setProjectData`→`runOnStart`で、実際のSQLiteに対して`importCsv`（CRLFのCSV）・`importJson`・存在しないファイル（`[app] onStart 実行エラー`が出て`runOnStart`は落ちない）・`session.clear`（ユーザーキーは消え`__`始まりは残る）・OnStart内の`session.clear`後も二重実行されないこと、を検証。内部キー保持を外すと2件失敗することを確認済み。未確認なのは実ウィンドウ上の動作（実行エラーのバッジ表示など）のみ


# 2026-10-21 続き: アプリイベント再測定・ズレ防止テスト・フォームイベント

- **アプリイベント再測定（`importCsv`/`session.clear`実装後、7B各3回）**: 26/27。「実行環境に無いAPI」の検出（`backMissing`）は実装済みになったため外した。残り1件（A1）は**モックのダミー値による誤検知**: `db.query`が`[{}]`を返すため`COUNT(*) AS count`の値がundefinedになり、正しいコード`itemCount[0].count.toString()`がTypeErrorとしてmockError扱い→リトライ（A1は3回ともリトライ、2回解消）。実運用でも、正しいコードに不要なリトライ・警告が出る恐れがある。対応は未着手（ダミー値の作り方を変える等は要相談）
- **ドキュメントと実行環境のズレ防止**: `project-runner.test.ts`に、`vja-back-api-full.eng.md`の全API名が実行環境のvja（OnStartのコードから列挙）に存在することを確認するテストを追加。`session.clear`を消すと失敗することを確認済み。**フロント側（`vja-runtime.js`）と、モックとの同様の突き合わせは未実施**
- **フォームイベント（Load/KeyDown/Click）のE2E**: テスト専用ハンドラ`testOpenFormYaml`/`testGetFormEvent`を追加（JSは`forms[idx].events["_js_<イベント名>"]`）。依頼6本（FE1〜FE6）、7B各3回で全て合格（FE3は判定の誤り＝「あれば」の分岐の中身を、モックの履歴（空の値）で判定していた→コードの有無で判定に修正）。FE4（F5）は初回に`e`未定義（モック実行例外）が出て、リトライで3回とも解消
- 教訓（再掲）: 条件分岐の中の呼び出しは、モックのダミー値で通らないことがある。判定は呼び出し履歴ではなくコードで行う

# モックの`vja.db.query`をSELECT文からダミー行を作る形に変更（2026-10-21）

- 原因: モックの`db.query`が常に`[{}]`（項目が全てundefined）を返し、`rows[0].count.toString()`のような正しいコードがTypeErrorで失敗扱い→不要なリトライ（実測243回中3回、全てA1。値に対してメソッドを呼ぶコードだけが影響）
- 対応: `buildMockQueryRows(sql, tables)`（`vja-mock-runtime.js`、`window`へグローバル展開）。集計（COUNT/SUM/AVG/MIN/MAX/TOTALを含む式。`COALESCE(SUM(x),0)`も）→1（別名があれば別名のキー、無ければ式の文字列のキー）、`SELECT *`・列名指定→テーブル定義の型（INTEGER=1、REAL=1.5、他="x"）、定義に無い列→"x"、SQLを読めない・項目が作れない→従来の`[{}]`。フロント・Bun側（アプリイベント）のモック両方で使う
- **Workerには関数の文字列(`toString`)を埋め込む**（`_getMockWorkerUrl`）ので、関数の実体は1か所のみ。自己完結にすること（外部の変数を参照させない）。`tables`は`postMessage`で渡す。ユニットテストは`mock-query-rows.test.ts`（11件）
- 検証: A1が3/3リトライ→5/5リトライ無し。全65依頼×各2回で128/130（失敗はW4のみ）、リトライしたのは8回（D5・W5・A5・FE4。全て正当な検出で解消）で、モック変更による新たな失敗は無い
- 既知の限界: `SELECT`の最初の`FROM`先だけを見る（JOINの2つ目のテーブルの列は"x"）。MIN/MAXをTEXT列に使っても1（数値）

# ドキュメントと実行環境・モックのズレ防止テスト（2026-10-21）

- 背景: バック側で、プロンプトとモックにだけ載り実行環境に無いAPI（`vja.db.importCsv/importJson`・`session.clear`）が見つかった。同種のズレを機械的に防ぐ、次の3つのテスト
  - `src/bun/project-runner.test.ts`: バック（アプリイベント）のプロンプトの全API名が、実行環境のvjaに存在する
  - `src/mainview/project-bridge.test.ts`（新規）: フロントのプロンプト（mandatory/db/optional.*）の全API名（74個）が、実行ウィンドウのvja（`vja-runtime.js`＋`project-bridge.ts`＋aws/slack/chatwork/webhook）に存在する。`electrobun/view`を`mock.module`で差し替え、window/documentをスタブして動的importする（importの前に用意すること）。結果: ズレは無かった（`dir`を空にすると失敗することを確認）
  - `src/mainview/vja-mock-runtime.test.ts`（新規）: プロンプトの全API名がモック（フロント・バック）に存在する／`vja-mock-runtime.js`とWorker用の複製（`vja-mock-check.js`の`_MOCK_WORKER_RUNTIME_SRC`、テンプレート文字列を取り出して評価）が同じ名前を持つ（「2か所の手動同期」の確認。値の中身の一致までは見ない）。結果: ズレは無かった（Worker側の`toCsv`を消すと失敗することを確認）
- 限界: 名前の有無のみ。引数や戻り値の形の一致は見ない（`vja.http.get`の戻り値の件のような記述の誤りは検出できない）。モック本体の値の妥当性も対象外

# W4（指示に無い`if`を足して条件付きにする）の対応検討（2026-10-21、結論: 対応しない＝既知の制約として記録）

- 現象: 「edtNameとedtCategoryを空にする」に対し、7Bが`if (name || category)`で囲む（temp0で必ず再現。temp0.3では原文で16/20）。luna（gpt-6-luna）では出ない
- 切り分け（直接LLM、7B、temp0.3×20＋temp0×1）: 原文16/20（temp0不合格）、「エラー終了: ログにエラーを出力」の行を消す20/20（temp0合格）、「入力チェック: なし」の行を消す11/20（悪化）、「正常終了: なし」を消す14/20、動詞を「空文字に設定」に変える17/20（temp0合格）。D5でも同じ行を消すと20/20。単一の原因ではなく、ばらつきが大きい
- **「エラー終了」の行を消す案は全体では得にならない**: 全65依頼×各2回（temp0）で、行あり=初回成功120/130・最終128/130（失敗はW4のみ）、行なし=初回122/130・最終126/130。W4とD5は直るが、**H1（http）とFE4（F5）が新たに0/2になる**（トレードオフ）。`mcp/js-gen-e2e.ts`の`--drop-default-error-line`で再現できる
- **「YAMLに条件語が無いのにコードにifがある」を機械検出する案は不適**: 既存の生成コード（65依頼）で当てはめると、本物はW4だけで、N2・A1・A8（nullガード・件数チェックなど正当な`if`）が誤検出（誤検出3/4）。誤検出すると正しいコードに不要なリトライが走る
- 影響: W4は「クリアが条件付きになる」だけで、入力が空でなければクリアされる。YAMLに「必ず」「無条件で」と書く回避策は、W4単体で効く（2026-10-21、7B・temp0・各5回、`mcp/js-gen-e2e.ts`のW4のYAMLだけを差し替えて実行）: 原文「…を空にする」0/5、「…を必ず空にする」5/5、「…を無条件で空にする」5/5（どちらも`if`が消えて`vja.widget.set`を3回無条件に呼ぶ）。temp0は同一依頼で同じ結果になるため実質1標本。他の依頼に「必ず」を付けた時の副作用は未測定

# クラウド・通知（AWS/Slack/Chatwork/Webhook）のjs-gen-e2e（2026-10-21）

- `js-gen-e2e.ts`にCL1〜CL18（S3 put/get/list/delete、DynamoDB put/get/query、SQS send/receive+delete、SNS、Lambda、SES、Secrets Manager、STS、CloudWatch、Slack、Chatwork、Webhook）を追加。モックでの生成検証のみで、実際のAWS等へは通信しない。任意APIカテゴリはシナリオの`apis`（`aws_s3`等）で有効にする
- 結果（7B、各3回）: 最終54/54。初回成功48/54、リトライ6回（全て解消）
  - **CL7（DynamoDBのquery）**: 7Bが最初`vja.db.query`（SQLite）で書く（「query」の語に引っ張られる）。利用テーブル0件の規則（`noTable`）が検出し、リトライで`vja.aws.dynamodb.query`へ直った
  - **CL13（Secrets Manager）**: 正しいコード`JSON.parse(secret)`が、モックの`getSecret`が`""`を返すため`JSON.parse("")`の例外（`Unexpected EOF`）として失敗扱い→不要なリトライ（3/3回。リトライで通ったが、正しいコードが書き換えられている）。**モックのダミー値による誤検知**（`db.query`と同じ種類）。対応案: モックの`getSecret`を、JSONとして解析できる値（例: `"{}"`）にする。**修正済み（2026-10-21）**: 両方のモックの`getSecret`を`"{}"`にし、`vja-mock-runtime.test.ts`に「JSON.parseできる値」のテストを追加。CL13は3/3リトライ→5/5リトライ無し。他の`""`を返すモック（`s3.get`・`file.read`・`session.get`・`const.get`・`widget.get`）も`JSON.parse`されうるが、`""`のままにしている（`{}`にすると「空なら」の分岐が逆に倒れるため。実測で問題が出ていない限り変えない）
- 拡張ランタイム（ext-runtime）は、上の節のとおり既に doc/event/pipeline/実機E2E/gpt系までの測定が揃っているため、今回は追加していない

# 依頼文→YAMLドラフト→JSの全経路テスト `js-gen-e2e.ts --from-text`（2026-10-22）

- `bun run mcp/js-gen-e2e.ts --from-text [--runs N] [--only id]`。`TEXTS`（人が書きそうな日本語の依頼文。27依頼）を`testTextToYamlGenerate`でYAMLにし、そのまま既存の生成・検証・モック判定（`js-gen-e2e`と同じintent）へ繋ぐ。結果は`.claudeWork/text-to-js-result.json`（各結果に`text`/`draftYaml`を残す）。YAML固定の`js-gen-e2e`では測れない「依頼文→YAML」の段階の失敗が見える
- 初回測定（7B・temp0・各3回）: 65/75。固定YAMLでは全てOKだった依頼でも、YAML段階の失敗で落ちる。その後の修正と結果:
  - **例文のウィジェット名の写し（案1）**: `text-to-yaml.sys.eng.md`の例文の`tableView1`/`selMode`と、ルールの`(e.g. txtName, btnSearch, tblUsers)`を7Bが実在しないウィジェット名として写していた（75件中20件）。例文を`<一覧ウィジェット名>`等のプレースホルダーにし、「例文の名前は写さず、一覧の実名を使う」へ変更→創作名3件、リトライ32→23/75回。W3・S2が0/3→3/3
  - **アプリイベント（案2）**: YAMLドラフトのプロンプトにアプリイベント（Bun側、画面・ダイアログ・トースト無し）の情報が渡っておらず、A9のYAMLが例文の確認ダイアログを写し、JSが存在しないAPIを書いた。`isAppEvent`でウィジェット一覧を外し、環境の制約（`appEventSection`）を渡す→A1・A3・A9・A10が全て3/3
  - **手順の順序（案3）**: 依頼は「渡して→移動」なのにYAMLが「移動→設定」へ入れ替え、JSが`navigate(form, {itemId})`と書いた（第2引数は`save`のみで、パラメータは渡らない）。「手順は依頼の順序を保ち、データ準備は画面遷移より前」のルールを追加→N2が0/3→3/3。以上で合計78/81
  - **Q4（残り）**: 「…登録しない。なければ登録したい」は、YAMLが「登録処理を行う」（INSERT省略）や「登録フォームを表示する」になった。依頼文に「テーブルに」を明記すると3/3（YAMLも`test_items に INSERT`）。依頼文の曖昧さが原因と判断し、依頼文のほうを直した（製品プロンプトは変更していない）
- 教訓: 依頼文は、人も書く語（登録先のテーブル・メッセージ・キー名）をintentの判定対象と揃える。「登録」だけだと7Bはフォーム表示と解釈することがある

# js-to-yaml-e2eへS5〜S7を追加、S5のウィジェット名言い換え（2026-10-22、既知の制約）

- `js-to-yaml-e2e.ts`にS5（分類絞込: ローディング＋空判定の条件分岐＋DB）・S6（件数集計: 繰り返し＋条件）・S7（登録再表示: 入力チェック付きINSERT＋再表示）を追加。S1だけで効いた修正になっていないかを見るため。現行プロンプトで7シナリオ各10回（7B・temp0）: S1・S2・S3・S4・S6・S7は10/10、**S5は0/10**
- S5の現象: 選択ボックス(`testSearchSelect`)の値を取る手順が「分類の値を取得します」になり、ウィジェット名が消える（`testResultGrid`は残る）。トースト文言「分類を選択してください」と`category`列の語が強いためと推測（未検証）。YAMLからJSを再生成しても、このウィジェットを読むコードへ戻らない
- 直接LLM（S5の実プロンプト、temp0.3、各20回）で切り分け: 基準12/20、「値を読む・設定する手順には実名を含める」規則を追加15/20、ユーザー文を「actionsに必ず出す」へ強める15/20、両方16/20。差が誤差の範囲のため**プロンプトは変更しない**（効果の裏付けがない変更は足さない）
- 検知: 生成後にYAMLに無い名前があればトースト警告が出る（自動書き換えはしない、既存の仕組み）。これ以上はコード側の機械処理の設計判断になる
- 教訓: temp0（e2e）とtemp0.3で結果が大きく変わる（S5は0/10と12/20）。温度は利用者設定なので、直接LLMの切り分けはtemp0.3、各20回で行い、e2eの結果だけで効果を判断しない

# widget-event-all-e2eの「プロンプトにYAML本文が入っていない」が不定期に出た原因（2026-10-22、テスト側の競合・修正済み）

- 現象: `widget-event-all-e2e`の`T:`（同じウィジェット`btn`の`Click`を続けて使う依頼）で、65〜78/79と実行ごとに変動し、`GENFAIL 「プロンプトにYAML本文が入っていない」`が0〜13件出た。コード変更の前後で差は無く（変更前のコードでも65/79）、時期・負荷で変わった
- 原因（コードで追える、製品のバグではない）: `generateEventJs`の成功時にデータモデルへ`w.jsCode[evName]`を直接書いて`openYaml`し、その後`yamlAiGenerate`が`requestAnimationFrame`×2待ちで非同期の`saveYamlData`を呼ぶ。これは画面(`#yaml-ta`等)の内容を同じウィジェット/イベントのデータへ書き戻す。テストの`generateViaEditor`は`jsCode`が入った時点で次へ進むため、次のテストの`testApplyProjectData`の**後**にこの遅延保存が走ると、前のテストのYAMLで新しいデータが上書きされ、次の`openYaml`も古いYAMLで画面を作る。`E:`はウィジェットが毎回違うので影響しない。`js-gen-e2e.ts`は生成後に500ms待つので影響しない
- 切り分けの手順（再利用可）: 失敗時に送信プロンプトの`[The Following YAML]`部を出力→「毎回、最初のテストのYAMLが入っている」と判明→`testOpenYamlEditor`が返す`modalRoot`に新YAMLが無いこと（openYaml時点で既にデータが古い）で、画面ではなくデータモデルの上書きと特定
- 対応: `widget-event-all-e2e.ts`と`widget-event-e2e.ts`の`generateViaEditor`に、`jsCode`を見つけた後の500ms待機を追加。修正後は78/79×3回で`GENFAIL`0件（残り1件は既知の`E:checkbox.CheckedChanged`）
- 教訓: **同じウィジェット/イベントを続けて使うテストは、生成後の遅延保存（rAF×2＋非同期`saveYamlData`）の完了を待ってから`testApplyProjectData`で次へ進む**。「コードを変えていないのに結果が変わる」ときは、先に旧コードへ戻して同じ測定をし（git checkoutで`src/mainview`を戻して再起動）、変更起因か環境起因かを切り分ける（今回、旧コードでも落ちて、変更起因でないと分かった）

# S5（ウィジェット名の言い換え）を「欠けたら指摘して1回やり直す」で解消（2026-10-22）

- 上のS5の既知の制約は、プロンプト調整ではなくやり直しで解消した。`generateJsToYaml`（`vja-ai-gen-core.js`）が、生成したYAMLに`findWidgetNamesInCode(jsCode)`の名前が欠けていたら、`js-to-yaml.retry.user.eng.md`（元のユーザー文＋前回の出力＋欠けた名前の指摘）で1回だけやり直す。やり直しで欠けが減った時だけ採用し、減らなければ元の出力を残す（悪化させない）。JS生成の自動修正リトライと同じ型
- 直接LLM（S5の実プロンプト、temp0.3、40回）: 初回25/40 → やり直し後38/40（会話の続きとして渡す形なら40/40だが、`runAiGenerate`が単発のsystem/userのため採用せず）。製品測定（`js-to-yaml-e2e`、7シナリオ各10回、temp0）: S5が0/10→10/10、他6シナリオは10/10のまま（70/70）。やり直しが動いたのはS5の10回のみで、他のシナリオにはLLM呼び出しの増加なし
- 教訓: プロンプト文言の調整（X2〜X4）で誤差程度しか動かない時は、「検出→指摘→1回やり直し」を試す。検出（欠けた名前の機械抽出）が既にあれば、小さな変更で効く。やり直し案は、直接LLMで「欠けた回に、指摘して直る割合」を先に測ってから実装する

# 全83依頼の依頼文→YAML→JS（`js-gen-e2e --from-text`）と、例文プレースホルダーの副作用の修正（2026-10-23）

- `TEXTS`を全83依頼へ拡張。7B・temp0・各2回: **142/166（85.5%）**（27依頼のときは81/81だった。固定YAMLのJS生成は164/166）。失敗12依頼の分類（YAML・コードの実物で確認）: YAML段階で依頼の意図が落ちた9（K1=「Enterが押されたら」の条件消失、Q1=「1つのトランザクションで」消失、Z1=「全入力値」を6ウィジェットの列挙へ展開、Z3=ダイアログがYES/NO確認に変化、T2・P1の誤解釈、CL10〜12=SNS件名の消失/Lambdaが関数呼び出し/SESがフォームを開く）、JS段階1（F2=existsを呼ばない）、判定・モックの誤検知1（H1=Array.isArrayの分岐にモックの戻り値が入らない）、例文プレースホルダーの副作用1（CL3）。**依頼文→YAMLの段階が失敗の主因**
- 副作用: 例文の名前を`<一覧ウィジェット名>`等のプレースホルダーにした（案1）ところ、YAMLに`<testResultGrid>`のように山括弧で実名を囲む出力が増え（0/75→20/166）、日本語プレースホルダーがそのまま出る回も4/166あった（CL3は実在しないウィジェットへ書くJSになった）。一方、プレースホルダー形式は「一覧」を実名へ解決する力が最も高い（直接LLM3依頼×12回: 現行27/36、山括弧なし明記32/36、元の版17/36、名前を外した版21/36）。大文字トークン（LIST_WIDGET）はそのまま出力されて不適（実名1/36）
- 修正（`vja-ai-gen-core.js`の`generateTextToYaml`）: ①山括弧の中身が実在のウィジェット名・テーブル名・画像名に完全一致する時だけ括弧を外す（`_stripBracketsAroundKnownNames`）②プレースホルダー（`_TEXT_TO_YAML_PLACEHOLDERS`。`text-to-yaml.sys.eng.md`の例文と必ず揃える）が出力に残ったら、`text-to-yaml.retry.user.eng.md`で指摘して1回だけやり直し、減った時だけ採用③ルールに「山括弧なしで書く」を明記。結果: 全83依頼143/166、山括弧20→2件、流出4→0件（やり直し4回）、初回成功117→126/166、リトライ33→25回。合計の差(+1)は揺れの範囲。悪化した4件(D5・S2・Z4×2)は、YAMLが山括弧以外同一でJS段階の揺れ（temp0でもllama-serverは同じ入力で出力が揺れる）と判断
- 教訓: 例文の名前を変えると、名前の解決力・写し・記号の混入が同時に動く。変える時は「実名あり・写し・記号混入・流出」の4指標を直接LLMで比べてから決める。また、`bun run mcp`の起動直後に`GLXBadWindow`が出て、webviewのRPCが応答せず`TimeoutError`で測定が即終了することがある（再起動で解消。起動後に`testGetWidgets`で応答を確認してから測定する）

# text-to-yamlへ「有効な任意APIのサービス名」を渡す（提案2、2026-10-23）

- 動機: 全83依頼の失敗のうち、CL10〜12（SNS件名の消失/Lambdaが関数呼び出し/SESがフォームを開く）は、`generateTextToYaml`が有効な任意API（AWS等）の情報を受け取っておらず、そのサービスを使えることを知らないまま依頼文をYAMLにしていた。JS生成には`optionalApiDocCtx`で渡していたが、text-to-yamlには渡していなかった
- **やって悪かったこと（繰り返さない）: API定義文（`vja.aws.sns.publish: { args: [...], desc: "..." }`）をそのまま渡した版**。全83依頼の合計は149/166へ上がったが、YAMLにAPI定義文・コード（`vja.`/`await`）が写る回が0→48/166になった。YAMLは非プログラマが読み書きする自然言語の仕様書で、js-to-yamlのプロンプトも「API名を書かない」としている。N1は`await vja.form.back`（呼び出しなし）がYAMLに出て、JSが`await vja.form.back;`になり2/2→0/2。合計の数字だけでは、この質の低下を見落とすところだった。直接LLM（7依頼×12回、混入をNG判定）: 説明なし46/84・混入0、定義文14/84・混入69、「できること＋入力」の列挙25/84・混入56（見出しの`(vja.x.*)`と型がコード風の出力を誘う）、指針文を足してもV3で9/60・混入46
- 採用: **サービス名だけ**を1行で渡す（有効カテゴリのラベルから`(vja.x.*)`の括弧を除いたもの。`[Enabled Services] These services can be used from this event: AWS SNS, ...`）。直接LLM（同条件）: 70/84・混入0（CL10〜12が全て12/12、N1 12/12、H1 10/12、F2 11/12）。有効カテゴリが無い時は節自体を出さず、プロンプトは従来と同じ。実装は`buildGenPromptContext`の返り値`optionalApiLabels`→`generateTextToYaml`→`TEXT_TO_YAML_SYS_PROMPT({optionalApiServices})`
- 結果（全83依頼×2回、7B・temp0）: 147/166（提案2の前143、定義文版149）、YAMLへの`vja.`/`await`混入0件、初回成功126→130/166、リトライ25→21回。改善はK1・F2・CL10・CL11・Z4・S2、悪化はN2・M3・CL12#2・S2#1。CL12#2は、前回の「OK」が偽物（YAMLがフォームを開く誤りで、判定を偶然通っていた）で、今回はYAMLが正しく`await`の付け忘れだけ。N2（`パラメータ: { itemId: <itemId> }`）とM3（ウィジェット名なし）はYAMLの書き方の揺れで、この節との因果は未特定
- 教訓: ①AIへ渡す情報は、出力の形式（自然言語のYAML）を壊さない形に加工して渡す（定義文をそのまま渡すと写る）②合計の成否だけで判断せず、出力の質を測る指標（API名・コードの混入件数など）を併せて測る③直接LLMの切り分けは、効果と副作用の両方の指標で判定する（今回、混入を判定に入れて初めて定義文版の問題が見えた）

# 他モデルでの検証と、イベント呼び出し・キー入力のtext-to-yaml修正（2026-10-24）

- 動機: 7B（qwen2.5-coder）向けに合わせたプロンプトが、他モデル（Qwen3-Coder-30B-A3B=192.168.0.232、Qwen3.6-35B-A3B=192.168.0.234）で崩れるという指摘。全83依頼（temp0・各1回）では、7B 74/83・Coder-30B 69/83・Qwen3.6 74/83で、YAMLの形（コードフェンス・`description`欠落・コード混入）の崩れは0。**83依頼の判定が甘く、崩れが見えなかった**（ウィジェット名を明示した短文が中心で、判定が目印の語のため意味のすり替えを見分けられない）。
- 実プロジェクト（`work/wja-test/table-test.vjaproj`、`docCode`の依頼文5件）で比べると意味が崩れていた: ①「他ボタンのクリックイベントを呼び出す」を「クリックされた時の処理」と読む（Coder-30B・Qwen3.6）②「改行キーが押された場合のみ」の条件が崩れる（Coder-30Bは「それ以外は何もしない」が消え、条件に別ウィジェット名が混入）③「セル内容」を「行全体の確認ダイアログ」にすり替える（Qwen3.6、**未解決**）。
- 修正: `prompts/text-to-yaml.sys.eng.md`へ、他ウィジェットのイベント呼び出し（`<ウィジェット名> の<イベント名>を呼び出す`）とKeyDown/KeyUpの条件（`<キー名> キーが押された場合:`）のルール2行と例1つを追加（コミット`1390b1e`）。実プロジェクト文脈・temp0.3・各12回: 呼び出し Coder-30B 0→12、Qwen3.6 1→12、7B 10→12／キー入力 Coder-30B 0→12、Qwen3.6 8→12、7B 11→12。回帰（全83依頼×2回、7B）147→151/166、確認ダイアログ系の悪化なし、API名・コードの混入0。
- 切り分けで効いた手順: ①実プロンプトを`testGetLastPrompt`で保存し、直接LLMへ送って1要素ずつ変える（temp0.3・各10〜12回）②確認ダイアログの入れ子の例を**消す**とZ3は直るがD5・M1・CL4が壊れる→例は残し、使い分けルールと通常ダイアログの例を足す（Z3の対策V6は下記の通り採用を見送った）。
- テスト: `js-gen-e2e.ts`に`RP1`〜`RP4`（実プロジェクトの言い回しの依頼。セル内容/ヘッダ列名のダイアログ、イベント呼び出し、改行キー）を追加。`--from-text --only RP`で測る。判定はコードの検査（モックはキー入力・ダイアログを記録しないため、実行結果での判定はできない）。「セル」の特定は`.row`/`.column`の有無で見る粗い判定。7B 12/12、Coder-30B 12/12、Qwen3.6 9/12（RP1のセルのすり替え2回、RP2の`showConfirm`1回）。
- 教訓: ①7Bで通る型が他モデルで崩れる。依頼文は実プロジェクトの言い回し（日本語の呼び名・複数行）でも測る ②他モデルの測定は`mcp/fixtures/test-llm.local.json`を一時的に差し替えて行い、必ず7Bへ戻す（`.claudeWork/run-rp.sh`の形） ③ID絞り込み`--only`は部分一致なので、新しいIDは既存と紛れない接頭辞にする（`P1`は既存の`P1-Load一覧`と衝突し、`RP`にした）。

# Z3（「ダイアログを出す」が確認ダイアログになる）のV6案は採用見送り（2026-10-24）

- 原因: text-to-yamlのシステムプロンプトにある「入れ子の確認ダイアログ」の例（`「削除しますか？」と YES/NO の確認ダイアログを表示する`）に、「ダイアログを出す」依頼が引きずられる。直接LLM（実プロンプト、temp0.3、各10回）: 現行はZ3が10/10失敗。例を**消す**とZ3は0/10だが、確認系（D5・M1・CL4）が0→10/10失敗に壊れる。使い分けルールだけ（V4）は効かない（10/10）。通常ダイアログの例だけ（V5）は2/10。**V4+V5（V6）でZ3 0/10、確認系0/10**（悪化なし）。
- V6の内容: ①`- Use a YES/NO confirmation dialog ONLY when the request asks to confirm (確認して / しますか). "ダイアログを出す" without confirmation is ONE step: 「…」とダイアログを表示する.`をルールへ ②`Example (plain message dialog, no confirmation)`（`「保存しました」とダイアログを表示する`→`画面を閉じる`）をループの例の前へ。
- 全83依頼×2回（7B・temp0）で測ると、**151→144/166に低下**したため戻した（未コミット変更を破棄）。Z3のYAMLは直ったが、Z3は**JS段階（YAML→JS）で`await showDialog`が出ず失敗のまま**（0→0）。D5・Z4は改善（1→2、0→2）、N2・H1・E2・FE4・FE5は2→0（N2は`navigate`が出ない、H1はテーブル保存の手順が増える、E2は手順が1つ落ちる、FE4は「F5」が「Enter」になる、FE5はYAMLは正しいがJSに`isEscape`/`getKey`が出ない）。確認ダイアログと無関係の依頼が動いており、7Bは文字を足すだけで出力が動くため、悪化の個別の原因は切り分けていない。
- 教訓: ①直接LLMで直った型でも、全83依頼の回帰で合計が下がることがある。合計と、動いた依頼の中身の両方を見て判断する ②YAMLが直ってもZ3のようにJS段階で落ちる依頼がある。直す順序は、まずJS段階（なぜ`await showDialog`が出ないか）を切り分けてから ③再開するなら、V6の文面は上記のまま使える（Z3のJS段階を直した後に、再度全83依頼で測る）。
