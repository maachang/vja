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
