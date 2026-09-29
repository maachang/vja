<!-- CLAUDE.md から分離したノート（2026-09-29）。内容は分離前の記述をそのまま移したもの。 -->

# 学習履歴機能（AIプロンプト記憶）

- AIコード生成時の過去修正・注意事項を学習・蓄積する機能
- **保存スコープ・単位**: プロジェクト単位（`getProjectData().learnedFixes`）。`.vjaproj` ファイルに同梱保存される
- **スコープ階層**:
  - `wid_evName`: イベント個別ルール
  - `tag_<tagName>`: ウィジェットタグ共有ルール（同一タグで2回以上類似エラーが修正された場合に自動昇格）
  - `global`: プロジェクト全体共通ルール（手動追加・ピン留め可能）
- **プロンプト生成 (`buildLearnedFixesCtx`)**: AIコード生成時、該当イベントの個別学習、タグ共通注意点、プロジェクト共通ルールを統合しプロンプトに自動挿入
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
  - **`参照テーブル:`（YAML中の`tables:`）は必須項目**（2026-09-13明記）: 以前は「関係があれば含める」という任意扱いの文言だったため、フィールドはテーブルのカラムから正しく導出されているのに`tables:`が空のまま生成されるケースがあった。`tables:`が無いと、後工程（画面レイアウト生成・実際のウィジェット配置）で「その画面がどのテーブルを読み書きする入力画面なのか、単なるテーブル一覧表示なのか」の区別があいまいになる。`ENG_FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT`に`[What Goes In "tables"]`節を追加し、「fieldsのいずれかがテーブルのカラムに由来する場合、tablesにそのテーブル名を含めるのは必須（省略可能な飾りではない）」と明記した
  - プロンプト定義: `prompt-def.js` の `ENG_FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT` / `ENG_FORM_DESIGN_TEXT_TO_YAML_USER_PROMPT`
- **「🖼 レイアウト」タブ（レイアウトイメージ選択）を厳格なpx座標制約として反映**（2026-09-14）: 従来、選択したレイアウトパターン（`form-layout-patterns.js`の`FORM_LAYOUT_PATTERNS`）は「配置構造を言葉で説明した1文」をAIへの補足指示に足すだけで、実際の反映精度がAIの解釈に左右され「設定しても反映が微妙」という指摘があった。各パターンが元々持つ`boxes`（SVGダイアグラム描画用の0-100割合座標、役割=入力/表示/ボタン）を、`buildLayoutRegionsPromptText(patternId, formW, formH)`（`form-layout-patterns.js`）でフォーム実サイズのpx座標バウンディングボックスへ変換し、「この役割のウィジェットは必ずこの矩形内に収めよ」という具体的な数値制約として渡すよう変更した（UI手動操作版`formDesignAiGenerate()`・ウィザード版`_wizardGenerateFormLayout()`の両方に適用。ウィザード側は従来この指示自体を一切渡していなかった実装漏れもあわせて修正）。実LLM(192.168.0.235)で検証し、全ウィジェットが指定領域内に正確に収まることを確認済み

# イベントYAMLドラフト自動生成機能 (Text to YAML)

- **概要**: ユーザーが「やりたいこと」を普通の一言日本語で入力するだけで、AIがフォーム内のウィジェットやDBテーブル情報を考慮し、イベント用YAML定義のドラフトを自動生成する機能。上記の画面デザインYAMLドラフトと同じ「初心者導線」の考え方（自然言語での指示 → AIによるYAMLドラフト化 → そのYAMLを土台に実装（JS生成）へ進む）をイベント側にも適用したもの
- **アクセス点**: イベントYAMLエディタの **`✨ YAMLドラフト`タブ**（`tab-prompt`、旧称「✨ 依頼」タブ）に日本語のやりたいこと文章を入力し、`textToYamlGenerate(wid, evName)`を実行すると `📋 YAML`タブへドラフトが生成される（旧仕様の別モーダルボタン`openTextToYamlModal`は現在は存在せず、エディタ内タブに統合済み）
- **プロンプト定義**: `prompt-def.js` の `ENG_TEXT_TO_YAML_SYS_PROMPT` / `ENG_TEXT_TO_YAML_USER_PROMPT`
- **テスト**: `src/mainview/text-to-yaml-prompt.test.ts` でユニットテスト実装・検証済み
- **条件分岐・繰り返しの見出し記法**（2026-09-11追加）: `アクション:`配下の`〇〇の場合:`/`それ以外の場合:`（if/else相当）、`〇〇に対して繰り返し:`（for/forEach相当）というYAML規約自体はJS変換プロンプト（`ENG_YAML_TO_JS_SYS_PROMPT`）側では以前から仕様化されていたが、ドラフト生成プロンプト（`ENG_TEXT_TO_YAML_SYS_PROMPT`）側には説明もFew-Shot例も無く、AIが条件分岐を使わずフラットな手順列挙しか生成しない問題があった。`docs/yaml-guide-engineer.md`の記法例をFew-Shotとして`ENG_TEXT_TO_YAML_SYS_PROMPT`にも追加し解消した

# イベントYAML/JSロールバック機能（スナップショット履歴）

- **概要**: AI再生成でイベントのYAML/JSコードが悪化した場合に、以前の「正常版」へユーザーが手動で戻せる機能（2026-09-11実装）
- **保存先**: `getProjectData().snapshotHistory["wid_evName"]`（`wid_evName`キー方式は`mockOverrides`等と同一、`OVERRIDE_MAP_NAMES`に追加済みでウィジェット/イベント削除時に自動クリーンアップされる）。`.vjaproj`へ永続化（`snapshot()`/`applyProjectData()`, `vja-modal.js`）
- **記録方式**: 「正常に実行できた」の自動判定はしない（既存の`manualMockCheck`等は静的検証＋浅いモック実行に過ぎず実運用の正常性を保証しないため）。イベントYAMLエディタの**`📌 記録`ボタン**を押した時のみ、その時点のYAML・JS・依頼文（`docCode`）を**常にセットで**（分離せず）記録する。JSはYAMLから生成される関係上、世代がズレる事故を防ぐための設計判断
- **上限・メモ**: 1イベントあたり新しい順で最大5件（超過分は自動間引き）。記録時に一言メモ（Gitのコミットメッセージ的なもの、`label`）を入力可能
- **UI**: `📌 記録`→メモ入力モーダル、`🕐 履歴`→世代一覧モーダル（`↩ 復元`/`🗑 削除`）。復元は直接プロジェクトデータへ反映せずエディタの3ペインを置き換えるのみで、確定は既存の保存ボタン経由。一覧の各行には、直前の記録と比べてYAML/JSどちらが変わったかを示す`[YAML]`/`[JS]`バッジを表示
- **対象範囲**: ウィジェットイベント（`openYaml`）・フォームイベント（`openFormYaml`）・アプリイベント（`openAppEvents`）の3種類すべてに対応
- 学習履歴機能と合わせて設計する、とされていた残課題だが、実装してみると両者はデータの性質（学習履歴＝軽量な文字列サマリ／スナップショット＝YAML+JS全文）が大きく異なるため、独立した機能として実装した

# AI生成コードの機械的な後処理（await漏れ補完・JS整形）

- **await漏れの自動補完**: `vja.app.showDialog`/`showConfirm`等、await必須のvja.*API呼び出しでawaitが抜けているケースを機械的に補完する。`findMissingAwaits()`（`vja-ai-gen-core.js`、ドキュメント`VJA_USE_FRONT_JS_INFO`/`VJA_USE_BACK_JS_INFO`から「await必須API集合」を自動抽出）と同一の判定基準で、`fixMissingAwaits(code, isAppEvent)`がその場でawaitを挿入する。AI生成直後・自動修正リトライ・手動モック実行・手動修正依頼の全経路に組み込み済み（2026-09-07実装）
- **JS整形（Prettier）**: ローカルLLM生成コードにありがちな「1行べた書き」「インデント幅の不揃い（2スペース等）」を、本物のJSフォーマッタ（Prettier）で整形する。正規表現ベースの機械的パッチでは構文木を正しく解釈できず事故りやすいため、Prettierをbun側にのみ依存追加（`package.json`）し、RPC（`formatJsRequest`、`src/shared/types.ts`にスキーマ定義）経由で整形結果を返す方式にした
  - webview側の呼び出し口: `window.vja.editor.formatJs(code, indentSize)`（`bridge.ts`）。`vja-ai-gen-core.js`の`formatJsCode(code)`がラップし、失敗時は整形前のコードをそのまま返す（整形はあくまで品質向上の後処理であり、検証フロー自体は止めない設計）
  - 適用タイミング: **AI生成時**（メイン生成・自動修正リトライ・手動修正依頼の各成功コールバック）と、**イベント保存時**（`saveYamlData`/`saveYaml`/`saveFormYaml`/`vja-app-config.js`の`saveAppEvent`、js-ta内容をPrettierで整形してから格納）。手動モック実行（`manualMockCheck`）単体では整形しない
  - インデント幅は`indentSize`引数で指定可能（デフォルト4）。Prettier本体は`copy-compile-assets.ts`の`COPY_BUILD_FILES`には含めない（VJA編集機能専用でコンパイル済みユーザーアプリには不要なため）
  - これに伴い、YAML→JS変換プロンプト（`ENG_YAML_TO_JS_SYS_PROMPT`）内にあった「インデント4スペース」「読みやすさのための改行」という生成時のコード整形指示は、最終的にPrettierで上書きされ無意味なため削除済み（2026-09-11）
  - テスト用API: `testFormatJs`/`vja_format_js`（`formatJsCode()`を直接呼び出し整形結果を確認できる）
- **画面レイアウトJSONの計算式是正**: 画面デザイン自動生成（`ENG_FORM_DESIGN_SYS_PROMPT`）で、x/y/w/h座標にAIが計算式をそのまま出力してしまう問題（例: `"x": 768 - 20 - 85`）が、プロンプト文言の念押し強化だけでは別のローカルLLMで再発した（2026-09-08にqwen2.5-coder-7bで発生・修正、2026-09-13にdeepseek-coder-v2で再発）。`parseFormDesignJson()`（`vja-form-design-ai.js`）に`_fixArithmeticInFormDesignJson()`を追加し、JSON.parse前にx/y/w/hの値が数式（数字・空白・四則演算子・丸カッコのみ）であれば安全に評価し整数へ機械的に是正するようにした（文字が混ざる値は対象外）。プロンプト文言の強化を重ねる対症療法ではなく、コード側の機械的な後処理で恒久対応する方針とした
- **画面デザインYAMLの参照テーブル欠落の機械的補完**（2026-09-20実装）: `ENG_FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT`には「fieldsがテーブル由来ならtablesに含めるのは必須」という明記とFew-Shot例が既にあるが、依頼文がボタン動作の説明中心（例:「〜を入力する。『戻る』ボタンで一覧に戻り、『保存』ボタンで保存する」）だと、`参照テーブル:`セクション自体が丸ごと欠落する不具合が実LLM検証（qwen2.5-coder-7b、temperature=0固定でも3/3再現＝サンプリングの揺らぎではなく決定論的な不具合）で確認された。なお同じ検証で、一覧画面のdatagrid欠落も一度観測されたが、これはtemperature=0では再現しなかったため`aiConfig.temperature`未設定によるサンプリングの揺らぎと判断し、対応不要とした。`vja-form-design-ai.js`に`deriveMissingFormDesignTables(yamlText, allTables)`を追加し、「参照テーブル:」が完全に欠落している場合のみ、「入力項目:」の各フィールド名がテーブルの列名(name/labelJa)と一致するかで該当テーブルを機械的に補完するようにした（`_fixArithmeticInFormDesignJson()`と同じ「コード側の機械的安全網」方針）。列名が重複する複数テーブル（例: `sales_data`/`sales_history`が同じ列を共有）で誤って両方候補になるのを避けるため、「fields全件をカバーし、かつ余分な列が最も少ない（＝形が最も近い）テーブル」を優先するスコアリングにしている。UI手動操作版（`formDesignTextToYamlGenerate()`）・ウィザードDOM非依存版（`wizardGenerateFormYaml()`）の両方に適用済み。AIが既に`参照テーブル:`を1件でも出力しているケースには一切介入しない
- **入力専用画面でのlayout_pattern誤選択（「編集」という語だけで表示エリアありパターンに反転する不具合）**（2026-09-20修正）: 同じ検証で、入力専用画面（表示・一覧要素なし）が誤って「表示エリアあり」のlayout_patternを選んでしまう事象も確認された。当初は温度依存の揺らぎと考えていたが、最小差分比較（他の条件をすべて揃え、docDraft文言だけを変える）で真因を特定した: 「〜を**入力する**。」は正しく「表示エリアなし」パターンを選ぶ一方、同じ文を「〜を**入力または編集する**。」に変えるだけで、temperature=0でも確定的に「表示エリアあり」パターンへ反転する。つまりモデルが「編集する」という言葉から「既存データを表示してから編集する＝表示エリアが要る」と連想してしまうことが原因で、サンプリングの揺らぎではなく決定論的な不具合だった。`ENG_FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT`の[Selection Guide]に「編集する/変更するという言葉があっても、実際に複数レコードを閲覧・検索する要素が無い限り表示エリアは不要」という明記と、正しい例/誤った例を対比させたFew-Shot Example 1bを追加して解消した（`prompt-def.js`）。既存の正常系（一覧+検索画面、actionsに「編集」を含むケース）への回帰が無いことも実LLMで確認済み
  - 検証用に、実LLM（ローカルLLM）へ実際に接続してAI接続設定（`aiConfig`のendpoint/model/temperature等）を差し替えるテスト用ハンドラ`_testSetAiConfig`/`testSetAiConfig`（`bridge.ts`/`src/bun/index.ts`）を追加した。既存の`_testSetAiMockQueue`（AI応答をモック化する方式）と異なり、こちらはモックを使わず実際のAI APIへ本当に接続して検証したい場合に使う
- **画面レイアウト生成で「入力項目の合計件数が少ないとdatagridが消える」不具合**（2026-09-20修正）: 上記2件の修正後、他の依頼パターンでも最終確認を行ったところ、YAMLに`一覧: datagrid`が明記されているのに、レイアウト生成（`ENG_FORM_DESIGN_SYS_PROMPT`）の出力にdatagridウィジェットが1つも含まれないケースを発見した。最小差分比較で調べた結果、テーブル名や列数ではなく**「`入力項目:`の合計エントリ数（datagrid自身を含む）が3件以下だとdatagridが消える」**という、fields件数のしきい値に依存する決定論的な不具合と判明した（4件以上では発生しない。temperature=0・複数の異なるテーブルで100%再現）。既存のFew-Shot例（horse_info、検索ワード+検索条件選択+検索結果表示枠=datagrid込み4エントリ）がこの最小構成をカバーしておらず、モデルが「シンプルな入力フォーム」の型に引きずられてdatagridを取りこぼすことが原因とみられる。`ENG_FORM_DESIGN_SYS_PROMPT`に「`入力項目:`の各エントリは件数によらず必ず1つずつウィジェットとして出力すること（datagridも例外ではない）」という明記と、datagrid+個別2フィールドという最小構成のFew-Shot例（正しい例/誤った例）を追加して解消した。既存の正常系（5列テーブル・4フィールドの一覧画面）への回帰が無いことも実LLMで確認済み

# DBテーブルAI生成機能

- **概要**: テーブル編集モーダル（`openTableEdit`）の「テーブル名」「説明」欄の下に依頼文入力欄＋「✨ AI生成」ボタンを配置。依頼文＋テーブル名/説明（入力済みなら）をAIへ渡し、カラム定義（name/type/notNull/pk/index/default）のJSON配列を生成、カラム一覧を置き換える
- **実装**: `vja-table-validation.js` の `tblAiGenerateSchema()`。既にカラム定義がある場合は上書き確認。AI生成結果は`SQLITE_TYPES`（TEXT/INTEGER/REAL/BLOB/NULL）でサニタイズし、PKは1件のみに強制補正
- **プロンプト定義**: `prompt-def.js` の `ENG_TABLE_SCHEMA_GEN_SYS_PROMPT` / `ENG_TABLE_SCHEMA_GEN_USER_PROMPT`

# 検証（バリデーション）AI生成機能

- **概要**: バリデーション編集モーダル（`openValidationEdit`）の「定義名」「説明」欄の下に依頼文入力欄＋「✨ AI生成」ボタンを配置。依頼文＋定義名/説明＋現在フォームの入力系ウィジェット名一覧（`inputtype`/`textarea`/`checkbox`/`radiobutton`/`selectBox`/`listbox`/`slider`）をAIへ渡し、ルール定義（対象ウィジェット名/type/not/arg1-3/message）のJSON配列を生成する
- **実装**: `vja-table-validation.js` の `validAiGenerateRules()`。AIが返したウィジェット名は**現在フォームに実在するものだけ**採用し（存在しない名前は破棄）、typeも`VALIDATION_TYPES`に無ければ`required`へ補正
- **プロンプト定義**: `prompt-def.js` の `ENG_VALIDATION_SCHEMA_GEN_SYS_PROMPT` / `ENG_VALIDATION_SCHEMA_GEN_USER_PROMPT`

# AI雛形生成機能 総覧（2026-08-08時点でカバーする主要対象）

vjaの中核コンセプトである「AIに雛形を作ってもらい、それを土台に人間が仕上げる」という導線が、アプリ開発に必要な主要な構成要素すべてに行き渡った状態（2026-08-08時点）。各詳細はこのファイル内の対応する節を参照。

| 対象 | 機能名 | アクセス点 |
|------|--------|-----------|
| 画面（フォームレイアウト） | 画面デザインYAMLドラフト生成 | 「🤖 AIでフォーム設計」モーダルの`✨ YAMLドラフト`タブ |
| イベント処理（YAML→JS） | イベントYAMLドラフト自動生成 + AI JSコード生成 | イベントYAMLエディタの`✨ YAMLドラフト`タブ |
| DBテーブル定義 | テーブルスキーマAI生成 | テーブル編集モーダルの「✨ AI生成」 |
| 検証（バリデーション）定義 | バリデーションルールAI生成 | バリデーション編集モーダルの「✨ AI生成」 |

いずれも「依頼文（自由記述の日本語） + 既に入力済みの関連情報（名前・説明・対象ウィジェット等）」をAIへのコンテキストとして渡し、JSON/YAML形式の雛形を生成 → 人間が確認・調整、という同じ設計パターンに統一されている。

- **AI接続設定のプリセット**: 「🤖 AI接続設定」モーダルの「💾 プリセット保存」で、AI接続設定（エンドポイント/モデル/APIキー等）を「📁 プロジェクト固有」（`.vjaproj`に同梱保存）または「🌐 プロジェクト共通」（`~/.vja-designer/ai-global-presets.json`、`loadAiGlobalPresetsRequest`/`saveAiGlobalPresetsRequest`経由、他プロジェクトからも選択可能）のどちらかに保存先を選んで保存できる。同名・同区分のプリセットへ保存すると上書き更新される
- **無限ループ対策**: AI生成コードが自分自身と同じウィジェット・同じイベントを`vja.trigger.*`で再度発火させる「自己再発火」を、AI生成直後の検証（`_findSelfTriggerRecursion`、生成時にAIへ再生成を促す）と、実行時ランタイム（`src/bun/index.ts`の`_vjaRun`内の`_vjaRunningKeys`による再入検知、検知時はエラーで処理を中断）の二段構えで防止している
