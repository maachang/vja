<!-- CLAUDE.md から分離したノート（2026-09-29）。内容は分離前の記述をそのまま移したもの。 -->

# ウィザードのシステムモデル定義（用語の参考ヒント）

- **概要**: 新規プロジェクト作成ウィザードのステップ3「システムモデル」で、ユーザー自身が8パターンの「業務システムの骨格」から1つ選ぶ（または「わからない/スキップ」）。選ばれた骨格の詳細mdは`WIZARD_STATE.systemModelHint`に保持され、画面構成分解のAIプロンプトへ**用語・言い回しの参考としてのみ**渡される。画面数・テーブル割当はこのヒントに左右されず、コード側で機械的に確定する（`_wizardBuildScreenSkeleton()`。経緯は下記「ウィザードの現行設計と、そこに至った経緯」を参照）
  - 当初（2026-08-30）はAIがQ&A内容から骨格を自動選択する方式だったが、「向いていないケース」の除外条件を無視して誤選択する事象が出たため、ユーザー選択制に変更した（下記「ウィザードの現行設計と、そこに至った経緯」を参照）
- **データ配置**: `src/wizard-system-models/<id>.md`（詳細: 概要・テーブル構成の型・画面構成の骨格・AIが陥りやすい失敗）＋`src/wizard-system-models/<id>.summary.md`（要約: 「名称/想定システムタイプ例/向いているケース/向いていないケース」の4見出し固定）のペアで管理する
  - `id`は英語kebab-case（例: `master-management`, `transaction-entry`）で、**ファイル名がそのままID**。一覧の集約は動的なディレクトリスキャンで組み立てるため、パターンの追加・削除はこのペアのファイルを置く/消すだけで完結し、別途「一覧管理ファイル」は存在しない
  - 2026-08-30時点で8パターン用意済み: マスタ管理系/伝票・トランザクション登録系/在庫・数量推移管理系/予約・スケジュール管理系/申請・承認ワークフロー系/会員・対応履歴管理系/検索・照会・レポート系/設定・パラメータ管理系
- **実行時の配置**: このディレクトリは`docs/`（人間向けドキュメント）とは別物で、VJA自身が実行時に読み込む必要があるデータのため`src/`配下に置いている。Electrobunは`electrobun.config.ts`の`build.copy`に明示登録したものしかdev/build時に`Resources/app/...`へコピーしないため（`WEBVIEW_RUNTIME_LIBS`と同じ制約）、`electrobun.config.ts`側で`src/wizard-system-models`をディレクトリ単位（`cpSync`の`recursive:true`）で登録済み。ディレクトリ単位登録のため、ペアファイルの追加・削除時に`electrobun.config.ts`の変更は不要
  - コンパイル済みユーザーアプリには同梱しない（VJA自身のウィザード専用データのため、`copy-compile-assets.ts`の`COPY_BUILD_FILES`には含めていない）
- **実装**:
  - bun側: `src/bun/index.ts`の`_wizardSystemModelsDir()`（dev時は`process.cwd()`、パッケージ時は`BUILD_VJA_SRC_PATH`から解決）、RPC `wizardSystemModelSummariesRequest`（`*.summary.md`をファイル名昇順で列挙・読込）/`wizardSystemModelDetailRequest`（指定idの詳細md読込）
  - webview側: `src/mainview/bridge.ts`の`window.vja.wizard.getSystemModelSummaries()`/`getSystemModelDetail(id)`
  - ウィザード側: `src/mainview/vja-wizard.js`の`wizardShowSystemModelStep()`（ステップ3の表示）/`wizardPickSystemModel(id)`（選択確定。詳細mdを取得して`systemModelHint`へ保持）/`wizardSkipSystemModel()`（スキップ。ヒント無しで後続へ進む）。一覧取得失敗時もヒント無しで進む
  - `WIZARD_STATE.systemModelHint`は`_wizardSaveProgress()`/`wizardResumeFromProgress()`にも組み込み済み（中断・再開時も保持される）
- **プロンプト定義**: `prompt-def.js`の`ENG_WIZARD_DECOMPOSE_FORMS_SYS_PROMPT`のみが`systemModelHint`を受け取り、「用語・言い回しの参考（Terminology Reference）」節として差し込む（骨格例のテーブル名・画面名・カラム名は出力に使わせない、と明記済み）。旧「AIによる骨格の自動選択用プロンプト」（`ENG_WIZARD_SYSTEM_MODEL_*`）とテーブル候補抽出へのヒント受け渡しは廃止済み
- **未対応（スコープ外）**: カラム構成生成（`ENG_TABLE_SCHEMA_GEN_SYS_PROMPT`）には`systemModelHint`を渡していない。このプロンプトはウィザード専用ではなく「テーブル管理」の「✨ AI生成」機能と共有されているため、今回はスコープ外とした（テーブル構成の型もヒントに含めたい場合は共有プロンプトの改修が別途必要）

# ウィザードの現行設計と、そこに至った経緯（2026-09-12〜14の要約）

（各回の詳細な作業ログはgit履歴とコミットメッセージに残っている。ここには現行仕様と教訓のみを記す）

## 現行の設計（6ステップ）
1. 画面サイズ選択 → 2. アプリ概要（自由記述、AI不使用） → 3. システムモデル選択（ユーザーが8パターンから選択/スキップ。用語の参考のみ） → 4. テーブル管理（既存の`openTableManager()`をそのまま開き、ユーザーがテーブル・カラムを作成。`WIZARD_STATE._inTableStep`でヘッダーに「戻る/次へ」を追加表示） → 5. 画面構成 → 6. 生成
- **画面構成の構造判断はコード側で確定する**（`_wizardBuildScreenSkeleton()`、`vja-wizard.js`）: 確定テーブル1つにつき「一覧画面＋入力画面」を1組。確定テーブルが2つ以上ある場合のみ、先頭に`kind:"menu"`の`MenuForm`スロットを追加（各テーブルの一覧画面へ遷移するボタンのみで構成。遷移コード自体は生成せず雛形止まり）。AIは各スロットの日本語文言（formTitle/description/docDraft）を埋めるだけ（`ENG_WIZARD_DECOMPOSE_FORMS_SYS_PROMPT`）。生成後、確定スロットのformNameが全て含まれるかを`wizardDecomposeForms()`が機械的に検証し、欠落があれば失敗として再生成を促す
- **Q&A履歴等の永続化**: `wizardConfirmAndGenerate()`完了時、`getProjectData().wizardHistory`（アプリ概要・テーブル候補・画面構成計画・画面サイズ・システムモデルヒント）を`.vjaproj`に保存する（「なぜこの画面構成になったか」を後から調査するため）

## 経緯から得た教訓（同種の設計をする際に参照）
- **AIに構造を自由に設計させ、長いルール文で誘導する方式は、ローカルLLMのモデル差で大きく揺れる**（2026-09-12〜13）。画面数の下限ルール文や過剰分割禁止ルール、骨格ヒント全文の差し込みでは、確定テーブルを1つも参照しない無関係な画面が生成される事象を防げなかった。vja本来の方針（1リクエスト＝狭い範囲のタスク）に戻し、構造決定をコードへ移して解決した
- **プロンプト文言だけでは別モデルで再発する**。ルールは「文言の強化」ではなく、コード側の機械確定・機械検証を併用する（メモリ「プロンプト文言だけでは再発する」参照）
- **AIに質問を発明させない**: 動的Q&A（`ENG_WIZARD_NEXT_QUESTION_SYS_PROMPT`）は「業務ロジックは聞くな」と明記しても、話題を使い切ると業務ロジックの質問を発明した。動的Q&A・AIによるテーブル候補抽出・AIによる骨格の自動選択は全て廃止し、ユーザー自身の入力/選択（アプリ概要・テーブル管理・システムモデル選択）に置き換えた
- **AIによる骨格の自動選択は「向いていないケース」の除外条件を無視して誤選択した**（例: 伝票登録系の内容を「数量」「履歴」等の表面的なキーワードで在庫管理系に誤選択）。ユーザーは作りたいアプリの性質を把握しているため、ユーザー選択制にした
- **後付けの増改築でウィザードの記述が矛盾しやすい**: ヘッダーコメントの通し番号（丸数字）は全廃しステップ名を直接書く。ステップを巻き戻す処理では`WIZARD_STATE.step`の更新漏れに注意（インジケーター表示がズレる実バグがあった）
- **一覧画面のdatagrid欠落**: 一覧スロットのdocDraft本文に「一覧」という語が入らないと、後工程（`ENG_FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT`のdatagrid必須ルール）が発動しない。docDraftには必ず「一覧」を含める、一覧スロットには「新規登録」ボタン、入力スロットには「戻る」ボタンを含める、と`ENG_WIZARD_DECOMPOSE_FORMS_SYS_PROMPT`に明記している。あわせて`ENG_FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT`に「一覧＋入力」「一覧オンリー」のFew-Shot例（正しい例/誤った例の対比）を追加した
- **`layout_pattern`の同期漏れ**（AI/モデルの問題ではなかった）: `layout_pattern:`行の抽出・`formLayoutPattern`への反映は、UI手動操作版にしか実装されておらず、ウィザード版（`wizardGenerateFormYaml()`）は`{ yaml, layoutPatternId }`を返す形にし、`wizardConfirmAndGenerate()`のループ内でも`formLayoutPattern`を`formDesignDraft`等と同じパターンで同期するよう修正した。モデルのせいにする前に、実データ（生成結果）を確認すること
- 実LLM(192.168.0.235)での検証は、8システムモデル全パターン・3テーブル構成で実施済み（欠落・実在しないカラムの混入なし）。実機（`bun run dev`）でのUI操作込みの全体再テストは、当時は未実施

## 画面種別ごとの必須ボタンのコード補完（2026-10-02）

- 症状: ウィザード生成で「登録画面に登録ボタンが無い」「条件入力のある一覧に検索ボタンが無い」「一覧画面があるのにメニューにそのボタンが無い」
- 原因: アクション項目はAIが依頼文（docDraft）から作る。decomposeプロンプトが依頼文へ必ず入れさせるのは一覧=新規登録・入力=戻るだけで、YAML生成プロンプトは「依頼文にないアクションを作るな」としているため、それ以外は生成されなかった
- 対応: プロンプトではなくコードで補完する。`vja-wizard-actions.js`の`ensureWizardFormActions(yaml, kind, listTitles)`を、`wizardConfirmAndGenerate`でYAML生成直後（レイアウト生成の前）に呼ぶ。`kind`は`wizardDecomposeForms`が確定スロット(`_wizardBuildScreenSkeleton`)から`formPlan`の各要素へ持たせる（AI追加の画面はkind無し=補完しない）
  - input: 「登録」（登録/保存/追加/更新/確定が無ければ、戻るの前）、「戻る」
  - list: 「検索」（datagrid以外の入力項目があり検索系が無ければ先頭）、「新規登録」
  - menu: 一覧画面のformTitle（末尾の「一覧」を除く）ごとの遷移ボタン
- 範囲はウィザード生成のみ。手動作成の画面・手書きYAMLは変更しない。kind導入前に保存した再開データはkindが無いため補完されない
- テスト: `vja-wizard-actions.test.ts`（実機/実LLMでの確認は未実施）

## 画面生成の補完・補正と管理系カラム（2026-10-03）

シナリオテスト（`mcp-test.md`参照）で見つけた不具合と、現行の対応。いずれもプロンプト文言ではなくコード側で確定している。

- **レイアウトでアクションのボタンが落ちる**: ボタン領域の無いパターン（`topMultiDisplayBottomDisplay`等）の選択、およびボタン領域があってもLLMが出力を落とす、の2系統があった。`ensureAiFormButtons`（`vja-form-layout-fix.js`）が、YAMLのアクション項目に対応するbuttonが無ければ補う（既存ボタンの左隣、無ければ最下部ウィジェットの下。名前は日本語から英語名への対応表）。ウィザード・手動の画面デザイン生成の両方で`applyAiFormDesign`の直前に呼ぶ
- **表示欄の無い入力画面でYAMLに無いdatagridが出て重なる**: 表示エリア付きパターンが選ばれても、YAMLにdatagridが無ければ`correctLayoutPatternByFields`（`form-layout-patterns.js`）が表示無しの入力パターンへ差し替える。ウィザードの一覧画面は`ensureWizardFormActions`が`一覧: datagrid`を補った後にこの判定をやり直す（`generateFormDesignYaml`が補正前の`originalLayoutPatternId`を返す）
- **多項目で入力行が枠外に出る**: `_expandPairRows`が、行間0でも収まらない場合に行の高さを縮める（下限32px）
- **一覧画面の入力項目に全カラムが入る**: 原因は依頼文でもテーブル情報の規則でもなく、`ENG_FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT`のFew-Shot例2（一覧+登録）が「datagrid＋全カラムの入力欄」を正解として示していたこと。例2の正解をdatagridのみにして解消。切り分けは「依頼文を変える」「疑わしい一文を削る」「例を削る」の順に実験し、一文ずつ原因を潰した（仮説を実験で2回外した。「依頼文にカラム名があるから」は誤りだった）
- **カラムの表示系/管理系**: カラム定義の`managed`（true=管理系。作成日時・更新日時・削除フラグ等）。テーブル編集の「表示系」列のチェックONが表示系で、データは`managed`のまま反転して保持する（属性なしの既存テーブル=表示系でON）。DDLには影響しない。画面生成（YAML・レイアウト・ウィザードの画面構成分解）は`buildTablesCtxText(tables, true)`で管理系を除いて渡す。**イベントJS生成は全カラムのまま**（INSERT/UPDATEで管理系も扱うため）。AI生成のカラムは常に表示系
- 未対応: 依頼文に管理系カラム名が明示された場合の除外、「一覧には出すが入力はさせない」等の3つ目の区別、入力スロット数を超える多項目の一覧用パターン（今のところ不要と判断。`leftInputRightDisplay`は入力3行）
- 単体テスト: `vja-form-layout-fix.test.ts`/`form-layout-patterns.test.ts`/`vja-wizard-actions.test.ts`/`vja-table-validation.test.ts`/`vja-ai-gen-core.test.ts`
