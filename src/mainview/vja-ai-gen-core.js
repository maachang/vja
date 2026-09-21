/* ═══════════════════════════════════════════════════════════════
   vja-ai-gen-core.js — イベントJS自動生成の中核ロジック
   2026-09-21にvja-yaml-editor.jsから分割した最後（7つ目）。分割方針の
   詳細はCLAUDE.mdの「vja-yaml-editor.jsの分割整理」節を参照。

   【重要: 本ファイルは2026-09-21に発生した実際の回帰事故の現場である】
   yamlAiGenerate()/textToYamlGenerate()を「テスト自動化のためDOM非依存の
   ロジック本体（generateEventJs/generateTextToYaml）とDOM読み書きに分離する」
   リファクタを行った際、runAiGenerate()（vja-modal.js）が実際のAPI呼び出し
   直前に呼ぶshowLoadingModal()（#modal-rootを丸ごとローディング表示へ
   差し替える＝YAMLエディタのDOMを破壊する）より「後」に、$("yaml-ta")等の
   DOM読み取りを誤って移動してしまい、依頼内容（YAML本文）が空のままAIに
   渡ってしまう回帰を発生させた。これを踏まえ、domOverride引数（呼び出し元が
   showLoadingModal()より前に確保した{yamlCur, addPrompt}を明示的に渡す仕組み）
   を導入して修正した。本ファイルを今後変更する際は、「DOM読み取りをこの
   ロジック本体の外（呼び出し元）へ出す・戻す」ような変更をする場合、
   必ず「呼び出し元のどのタイミングでDOM状態が変化しうるか
   （showLoadingModal/closeModal等）」を確認すること。DOM非依存版の
   テストハンドラ（generateEventJsを直接呼ぶ等）だけでは、この種の
   「呼び出し元のタイミング変化」由来の回帰は検出できない
   （実際にtestYamlAiGenerateFullとtestVerifyPromptIntegrityという、
   showLoadingModal()を経由する実際のボタン操作フロー全体を実行する
   テストハンドラを追加している）。

   【提供する機能】
   - AIへ渡すテーブル/API定義コンテキストの構築（buildTablesCtxText/
     getVjaApiWhitelist/narrowTablesByRequest/buildGenPromptContext）
   - AI生成コードの機械的な後処理（findMissingAwaits/fixMissingAwaits/
     findUnknownWidgetNames/formatJsCode/escapeRegExp/_unwrapAiFunctionWrapper）
   - イベントJS自動生成の本体（generateEventJs/yamlAiGenerate）
   - イベントYAMLドラフト自動生成の本体（generateTextToYaml/textToYamlGenerate）

   【依存関係（読み込み順に注意）】
   - vja-defs.js: getProjectData/getWidget等
   - vja-modal.js: showModal/closeModal/pushUndo/runAiGenerate
   - vja-html.js: render/evtAttr
   - prompt-def.js: ENG_YAML_TO_JS_SYS_PROMPT等のプロンプト定義
   - vja-mock-check.js: validateGeneratedJs/augmentWithMockCheck/
     formatValidationIssuesForLog/buildAiFixPrompt/trackLearnedFixRecurrence/
     buildLearnedFixesCtx/annotateUnknownApis
   - vja-yaml-editor.js: $/openYaml/openFormYaml/openAppEvents/saveYamlData/
     applyTableYamlSync/isEventCategoryLocked/getApiOptState/
     apiOptCategoryOfApiName/yamlTabSwitch/editorUpdateGutter

   【切り出し時の検証方法】
   前回（vja-form-design-ai.js分割）で判明した「構文チェックだけでは
   Object.assign(window,{...})内の未定義識別子（実行時ReferenceError）を
   検出できない」という教訓を踏まえ、切り出し後は必ず
   `global.window={}; new Function('window',code)(window)` で両ファイルを
   実際に実行し、cross-file呼び出しの`_`外し忘れ（機械的な集合演算での
   全数チェック）と合わせて検証した。
═══════════════════════════════════════════════════════════════ */

// AI生成（llama-server 経由）
// YAML仕様からイベントの JavaScript コードを AI 生成する。
// プロジェクト情報・ウィジェット・テーブル定義をコンテキストとして渡す。
// 生成完了後に openYaml を再表示し、JS タブにコードをセットする。
// 指定テーブル一覧から、AIへ渡すカラム定義テキストを生成する
// （PK/NOT NULL/DEFAULT/INDEXフラグ付き）。yamlAiGenerate()と
// formDesignAiGenerate()の両方から共有される。
function buildTablesCtxText(targetTables) {
    return targetTables.length > 0
        ? targetTables.map(t => {
            const cols = (t.columns || []).map(c => {
                let def = "    - " + c.name + (c.labelJa ? "（" + c.labelJa + "）" : "") + " (" + c.type + ")";
                if (c.pk) def += " PK";
                if (c.notNull) def += " NOT NULL";
                if (c.useDefault) {
                    const dv = (c.default && c.default.trim() !== "") ? c.default.trim() : defaultValueForType(c.type);
                    def += " DEFAULT " + dv;
                }
                if (c.index) def += " INDEX";
                return def;
            }).join("\n");
            const desc = t.description ? " // " + t.description : "";
            return "  " + t.name + desc + ":\n" + cols;
        }).join("\n")
        : "  （テーブル未定義）";
}

/* ═══════════════════════════════════════════
  生成JS検証（構文チェック・APIホワイトリスト検証）
  yamlAiGenerate() のAI生成結果に対し、明らかな問題
  （構文エラー・存在しないvja.*API呼び出し）を機械的に検出する。
  ホワイトリストは prompt-def.js の VJA_USE_FRONT_JS_INFO /
  VJA_USE_BACK_JS_INFO（AIに実際渡している説明文と同一ソース）
  から自動抽出するため、APIの追加・変更・削除があっても
  二重管理にならず自動的に追従する。
  フロント/バックエンドで利用可能なAPIが異なるため、
  ホワイトリストは絶対に混在させないこと（isAppEventで出し分ける）。
═══════════════════════════════════════════ */
// パース結果のキャッシュ（セッション中はprompt-def.jsの内容が変化しないため、
// 初回のみ正規表現抽出を行い、以降は再利用する）
let _vjaApiWhitelistCache = null; // { front: Set<string>, back: Set<string> }

// VJA_USE_FRONT_JS_INFO / VJA_USE_BACK_JS_INFO のテキストから
// "vja.xxx.yyy(" / "console.xxx(" のパターンを全て抽出しSetにする。
// 「関数名:」行だけでなく、説明文・使用例中に登場するものも含めて拾う
// （vja.trigger.click の説明文中にある vja.trigger.focus 等のバリエーションも
//   これにより自動的にホワイトリスト対象となる）。
function _extractVjaApiSet(text) {
    const set = new Set();
    const re = /\b((?:vja(?:\.\w+)+)|(?:console\.\w+))\s*\(/g;
    let m;
    while ((m = re.exec(text || "")) !== null) set.add(m[1]);
    return set;
}
// 他ファイル（vja-editor-completion.js）からも呼び出すため、CLAUDE.mdの規約に従い
// `_`無しの名前でグローバル展開する（`_`始まりはファイル内限定の意味のため）。
function getVjaApiWhitelist() {
    if (!_vjaApiWhitelistCache) {
        _vjaApiWhitelistCache = {
            front: _extractVjaApiSet(_PROMPT_DEF.VJA_USE_FRONT_JS_INFO),
            back: _extractVjaApiSet(_PROMPT_DEF.VJA_USE_BACK_JS_INFO),
        };
    }
    return _vjaApiWhitelistCache;
}

// JSペイン入力補完（_getCompletionPartial等）は
// 2026-09-21にvja-editor-completion.jsへ切り出した。

// VJA_USE_FRONT_JS_INFO / VJA_USE_BACK_JS_INFO 内で「await vja.xxx.yyy(」の
// ように "await " 付きで記載されているAPIを抽出する。
// ドキュメント側は「awaitが必須のAPIは必ずawait付きで記載する」運用のため、
// これも別途ホワイトリストを持たず、既存の説明文から自動抽出できる。
let _vjaAwaitRequiredCache = null; // { front: Set<string>, back: Set<string> }
function _extractAwaitRequiredApiSet(text) {
    const set = new Set();
    const re = /\bawait\s+((?:vja(?:\.\w+)+))\s*\(/g;
    let m;
    while ((m = re.exec(text || "")) !== null) set.add(m[1]);
    return set;
}
function _getVjaAwaitRequiredSet() {
    if (!_vjaAwaitRequiredCache) {
        _vjaAwaitRequiredCache = {
            front: _extractAwaitRequiredApiSet(_PROMPT_DEF.VJA_USE_FRONT_JS_INFO),
            back: _extractAwaitRequiredApiSet(_PROMPT_DEF.VJA_USE_BACK_JS_INFO),
        };
    }
    return _vjaAwaitRequiredCache;
}
// コード内で、await必須のAPIがawait無しで呼び出されている箇所を検出する。
// 戻り値: [{ line: 1-indexed行番号, api: "vja.xxx.yyy" }, ...]
function findMissingAwaits(code, isAppEvent) {
    const required = isAppEvent ? _getVjaAwaitRequiredSet().back : _getVjaAwaitRequiredSet().front;
    const found = [];
    const seen = new Set();
    const re = /(await\s+)?\b(vja(?:\.\w+)+)\s*\(/g;
    let m;
    while ((m = re.exec(code)) !== null) {
        const hasAwait = !!m[1];
        const api = m[2];
        if (!hasAwait && required.has(api)) {
            const line = code.slice(0, m.index).split("\n").length;
            const key = line + ":" + api;
            if (!seen.has(key)) {
                seen.add(key);
                found.push({ line, api });
            }
        }
    }
    return found;
}

// findMissingAwaits() で検出したawait漏れを機械的に補完する
// （awaitの付け忘れは小型ローカルLLMで頻出のミスであり、AIへの再修正依頼を
//   挟まず、その場でawaitを挿入するだけで解消できるため）。
// 判定ロジックは_findMissingAwaits()と同一の正規表現・必須APIセットを使う
// （検出と補完の判定基準がずれるとawait漏れの見逃し/誤挿入につながるため）。
function fixMissingAwaits(code, isAppEvent) {
    const required = isAppEvent ? _getVjaAwaitRequiredSet().back : _getVjaAwaitRequiredSet().front;
    const re = /(await\s+)?\b(vja(?:\.\w+)+)\s*\(/g;
    return code.replace(re, (match, hasAwait, api) => {
        if (hasAwait || !required.has(api)) return match;
        return "await " + match;
    });
}

// AI生成コード（1行べた書き・インデント不揃い等）をPrettier(bun側)で整形する。
// Prettierが構文エラー等で失敗した場合は、整形前のコードをそのまま返す
// （整形は品質向上のための後処理であり、失敗しても検証フロー自体は止めない）。
async function formatJsCode(code) {
    try {
        const res = await vja.editor.formatJs(code);
        return res?.ok ? res.code : code;
    } catch (e) {
        window.vja?.log?.debug?.("[JS整形] Prettier呼び出し失敗: " + e.message);
        return code;
    }
}

// 第1引数にウィジェット名（文字列リテラル）を取るAPIの一覧。
// ここに列挙したAPIについて、指定されたウィジェット名が現在のフォームに
// 実在するかを検証する。変数で渡されている場合（文字列リテラルでない場合）は
// 判定不能なため対象外とする。
const _WIDGET_NAME_ARG_APIS = [
    "vja.widget.get", "vja.widget.set", "vja.widget.setSuggestions",
    "vja.form.setParam", "vja.form.getParam",
];
// コード内で、上記API群に対して「現在のフォームに存在しないウィジェット名」が
// 文字列リテラルで渡されている箇所を検出する。vja.trigger.* も対象に含める
// （引数無し呼び出し＝全ウィジェット対象は除外）。
// 戻り値: [{ line, api, name }, ...]
function findUnknownWidgetNames(code) {
    const widgetNames = new Set((getProjectData().widgets || []).map((w) => w.name));
    const found = [];
    const seen = new Set();
    // vja.widget.get/set, vja.form.setParam/getParam
    _WIDGET_NAME_ARG_APIS.forEach((api) => {
        const re = new RegExp(api.replace(/\./g, "\\.") + "\\s*\\(\\s*['\"]([^'\"]+)['\"]", "g");
        let m;
        while ((m = re.exec(code)) !== null) {
            const name = m[1];
            if (!widgetNames.has(name)) {
                const line = code.slice(0, m.index).split("\n").length;
                const key = line + ":" + api + ":" + name;
                if (!seen.has(key)) {
                    seen.add(key);
                    found.push({ line, api, name });
                }
            }
        }
    });
    // vja.trigger.xxx('ウィジェット名') 形式
    {
        const re = /\bvja\.trigger\.\w+\s*\(\s*['"]([^'"]+)['"]/g;
        let m;
        while ((m = re.exec(code)) !== null) {
            const name = m[1];
            if (!widgetNames.has(name)) {
                const line = code.slice(0, m.index).split("\n").length;
                const key = line + ":vja.trigger:" + name;
                if (!seen.has(key)) {
                    seen.add(key);
                    found.push({ line, api: "vja.trigger.*", name });
                }
            }
        }
    }
    return found;
}

// 検証・モック実行エンジン・スナップショット履歴・学習履歴の記録は
// 2026-09-21にvja-mock-check.jsへ切り出した。

// 正規表現の特殊文字をエスケープする。
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// text（YAML定義本文＋追加指示）中に、ウィジェット名が単語境界つきで
// 文字として出現するものだけを機械的に抽出する。LLMに推測させるのではなく、
// 純粋な文字列マッチで「このイベントが触れていそうな対象（ウィジェット/定数等）」を
// 絞り込むための処理。items は { name: string, ... } の配列であれば何でも使える
// （ウィジェット一覧・グローバル定数・フォーム定数のいずれにも共通で使用する）。
// （前後が識別子文字[A-Za-z0-9_$]でないことを境界条件とする。日本語の助詞等は
//   識別子文字ではないため、"txtNameの値" のような埋め込みでも問題なくマッチする）
function _extractMentionedByName(text, items) {
    if (!text) return [];
    return items.filter((it) => {
        if (!it.name) return false;
        const re = new RegExp("(?<![A-Za-z0-9_$])" + escapeRegExp(it.name) + "(?![A-Za-z0-9_$])");
        return re.test(text);
    });
}

// テーブル一覧を、依頼文との関連度で絞り込む。
// - 依頼文にテーブル名そのものが出現するものがあれば、それらを採用。
// - 無ければ、各テーブル自身のカラム名が依頼文中に何件出現するかをスコアリングし、
//   最多スコアのテーブルのみ採用する（意味の重複した別テーブルが紛れ込むのを防ぐ。
//   例: 「id,task_name,priority,due_date,status」という依頼文に対し、
//   tasksテーブル(5件一致)を選び、一部カラムが被るだけのdeadlines(4件一致)等は除外する）。
// - どちらも0件なら絞り込まず全件を返す（絞り込みが原因で必要なテーブルが
//   消えてしまうより、無関係テーブルが混ざる方を安全側とする）。
function narrowTablesByRequest(text, allTables) {
    if (!text || allTables.length === 0) return allTables;
    const byName = _extractMentionedByName(text, allTables);
    if (byName.length > 0) return byName;
    const scored = allTables.map((t) => ({
        t,
        score: _extractMentionedByName(text, t.columns || []).length,
    })).filter((x) => x.score > 0);
    if (scored.length === 0) return allTables;
    const maxScore = Math.max(...scored.map((x) => x.score));
    return scored.filter((x) => x.score === maxScore).map((x) => x.t);
}

// AI生成・修正依頼で使うシステムプロンプト・ユーザープロンプトを、現在の
// プロジェクト状態（ウィジェット一覧・利用テーブル・利用API・検証定義の
// 選択状態等）から都度組み立てる。
// 【設計方針】ローカルLLM実行は高速・単体PCでの利用が前提のため、
// 過去に組み立てたプロンプトをキャッシュして使い回すことはせず、
// 必要になるたびに毎回この関数で最新の状態から組み立て直す。
// こうすることで「キャッシュが無いので機能が使えない」という特殊対応や、
// 「生成後に設定を変えたのに古いプロンプトのまま修正依頼してしまう」
// といった問題を、そもそも起こりようがない形にしている。
//
// narrowContext: true（既定）の場合、YAML本文＋追加指示に名前が出現する
// ウィジェット/定数のみに一覧を絞り込み、ローカルLLMに渡すコンテキストを削減する
// （小型モデルほど無関係な名前に惑わされやすいため）。
// 絞り込みが原因で生成コードが未知のウィジェット名を参照してしまった場合の
// 救済策として、AI自動修正リトライ時にはfalseを渡し、全件のまま再構築する
// （呼び出し側 yamlAiGenerate を参照）。
// ※定数側には「未知の定数キー検出」バリデーションが無いため、絞り込みで必要な
//   定数が漏れても自動検知はできない（マッチ0件時は全件表示にフォールバックする
//   ことで、大外しは防いでいる）。
// domOverride: { yamlCur, addPrompt } を渡すと、$("yaml-ta")/$("ai-prompt-in")を
// 読まずにこの値を使う。runAiGenerate()はAPIリクエスト中に#modal-root（YAMLエディタの
// モーダルもここに含まれる）をローディング表示へ差し替えるため、生成中（AI応答を
// 受け取ったonSuccessコールバック内、自動修正リトライ時のコンテキスト再構築等）に
// このDOM要素を読もうとすると、既に存在しない＝空文字列になってしまう
// （2026-09-21、yamlAiGenerateのリファクタで顕在化したuserPrompt欠落バグの原因）。
// DOM読み取りが安全なタイミング（モーダルがまだ生きている、showLoadingModal呼び出し前）
// で一度だけ読み取り、以降の呼び出しにはdomOverrideとして渡すことでこれを回避する。
function buildGenPromptContext(wid, evName, isAppEvent, isFormEvent, narrowContext = true, domOverride = null) {
    const w = (isAppEvent || isFormEvent) ? null : getWidget(wid);
    const yamlCur = domOverride ? (domOverride.yamlCur || "") : ($("yaml-ta")?.value || "");

    // ── ⓪ 検証（バリデーション）定義の取得 ──
    // 以前はYAML本文の「検証:」行から正規表現で抽出していたが、
    // タイポ防止のため右パネルでの単一選択方式に変更した。
    // YAML自体には書き込まない。vja.validate.run('定義名') はonSuccess時に先頭挿入。
    const validationName = getValidationOverride(wid, evName) || null;
    const yamlForAi = yamlCur;

    const addPrompt = domOverride ? (domOverride.addPrompt || "") : ($("ai-prompt-in")?.value || "");
    const curForm = getProjectData().forms[getProjectData().curFormIdx];

    const scanText = yamlCur + "\n" + addPrompt;

    // ── ①② ウィジェット一覧の絞り込み ──
    // narrowContext=trueの場合、YAML本文＋追加指示に名前が出現するウィジェットのみに
    // 一覧を絞る（絞り込んだ結果0件＝手がかりが無い場合は絞り込まず全件のままにする）。
    // 現在編集中のウィジェット自身は、本文中で自分の名前を書かないケースが多いため、
    // マッチ結果に関わらず無条件で含める。
    const allWidgetsFull = getProjectData().widgets;
    let widgetsForCtx = allWidgetsFull;
    if (narrowContext) {
        const mentioned = _extractMentionedByName(scanText, allWidgetsFull);
        const mentionedSet = new Set(mentioned.map(ww => ww.name));
        if (w?.name) mentionedSet.add(w.name);
        if (mentionedSet.size > 0) {
            widgetsForCtx = allWidgetsFull.filter(ww => mentionedSet.has(ww.name));
        }
    }
    window.vja?.log?.debug?.(
        "[AI生成] ウィジェット一覧の絞り込み: " + widgetsForCtx.length + "/" + allWidgetsFull.length + "件"
        + (narrowContext ? "" : "（絞り込み無効・全件使用）")
    );

    // ── ① 入力系ウィジェット一覧（フォームの入力パラメータ） ──
    const INPUT_TAGS = ["inputtype", "checkbox", "radiobutton", "listbox", "selectbox"];
    const inputWidgets = widgetsForCtx.filter(ww => INPUT_TAGS.includes(ww.tag.toLowerCase()));
    const inputParamsCtx = inputWidgets.length > 0
        ? inputWidgets.map(ww => {
            const desc = ww.props?.description ? " // " + ww.props.description : "";
            return "  - " + ww.name + " (" + ww.tag + ")" + desc;
        }).join("\n")
        : "  (none)";

    // ── ② 全ウィジェット一覧 ──
    const allWidgetsCtx = widgetsForCtx.map(ww => "  - " + ww.name + " (" + ww.tag + ")").join("\n") || "  (none)";

    // ── ③ 画面一覧 ──
    const formsCtx = getProjectData().forms.map((f, i) => {
        const star = f.id === getProjectData().startFormId ? "★" : "";
        return "  - " + f.cfg.name + (star ? " [初期画面]" : "") + (f.cfg.description ? " // " + f.cfg.description : "");
    }).join("\n");

    // ── ④ 定数（グローバル＋フォーム単位） ──
    // ウィジェットと同様、YAML本文＋追加指示に名前が出現する定数のみに絞り込む
    // （定数自体が0件なら絞り込み判定不要でそのまま「なし」、1件以上ある場合のみ
    //   マッチ判定を行い、マッチ0件＝手がかりが無い場合は絞り込まず全件のままにする）。
    const globalConstsFull = getProjectData().constants;
    const globalConstsForCtx = (narrowContext && globalConstsFull.length > 0)
        ? (() => { const m = _extractMentionedByName(scanText, globalConstsFull); return m.length > 0 ? m : globalConstsFull; })()
        : globalConstsFull;
    const globalConstCtx = globalConstsForCtx.length > 0
        ? globalConstsForCtx.map(c => "  - " + c.name + " = " + c.value).join("\n")
        : "  (none)";
    const formConstsFull = curForm?.constants || [];
    const formConstsForCtx = (narrowContext && formConstsFull.length > 0)
        ? (() => { const m = _extractMentionedByName(scanText, formConstsFull); return m.length > 0 ? m : formConstsFull; })()
        : formConstsFull;
    const formConstCtx = formConstsForCtx.length > 0
        ? formConstsForCtx.map(c => "  - " + c.name + " = " + c.value).join("\n")
        : "  (none)";

    // ── ⑤ テーブル定義（利用テーブルのカラム情報） ──
    // 以前はYAML本文の「利用テーブル:」から正規表現で抽出していたが、
    // タイポ防止のため右パネルでのON/OFF方式に変更した
    // （ON/OFFの度にYAML本文へも自動反映されるため、YAML自体は変わらず
    //   唯一の情報源として保たれる。ここでは保存済みの状態を直接参照する）。
    const enabledTableNames = ensureTableOptInitialized(wid, evName, yamlCur);
    const targetTables = enabledTableNames.length > 0
        ? getProjectData().tables.filter(t => enabledTableNames.includes(t.name))
        : []; // 未指定の場合は何も渡さない
    const tablesCtx = buildTablesCtxText(targetTables);

    // ── ⑤-2 任意API有効化: 有効カテゴリの判定・連動コンテキストのゲーティング ──
    // フロントエンドイベントのみ対象（バックエンドは全カテゴリ常時利用可能のため対象外）。
    const enabledApiOpts = isAppEvent ? [] : (() => {
        const arr = getApiOptState(wid, evName) || [];
        // 保険: 右パネルを一度も開かず生成した場合でも、ロック対象イベントでは
        // 必ずeventカテゴリを有効に含める。
        if (isEventCategoryLocked(evName) && !arr.includes("event")) return [...arr, "event"];
        return arr;
    })();
    const enabledApiOptSet = new Set(enabledApiOpts);
    // vja.constが無効なら、定数一覧そのものを見せる意味が無いため空にする
    const globalConstCtxGated = (!isAppEvent && !enabledApiOptSet.has("const")) ? "  （vja.constは現在このイベントで無効化されています）" : globalConstCtx;
    const formConstCtxGated = (!isAppEvent && !enabledApiOptSet.has("const")) ? "  （vja.constは現在このイベントで無効化されています）" : formConstCtx;
    // vja.formが無効なら、画面一覧も見せる意味が無いため空にする
    const formsCtxGated = (!isAppEvent && !enabledApiOptSet.has("form")) ? "  （vja.formは現在このイベントで無効化されています）" : formsCtx;
    // 有効化された任意カテゴリ・利用テーブル指定時のvja.dbのAPI説明を、ユーザープロンプト側に追加する
    let optionalApiDocCtx = "";
    if (!isAppEvent) {
        const blocks = [];
        enabledApiOpts.forEach(key => {
            const label = _PROMPT_DEF.VJA_FRONT_API_OPTIONAL_LABELS?.[key];
            const doc = _PROMPT_DEF.VJA_FRONT_API_OPTIONAL_ENG?.[key];
            if (label && doc) blocks.push("## " + label + "\n" + doc);
        });
        if (targetTables.length > 0 && _PROMPT_DEF.VJA_FRONT_API_DB_ENG) {
            blocks.push("## データベース (vja.db.*)\n" + _PROMPT_DEF.VJA_FRONT_API_DB_ENG);
        }
        optionalApiDocCtx = blocks.join("\n\n");
    }
    window.vja?.log?.debug?.(
        "[AI生成] 追加VJAランタイム(任意API) — 有効カテゴリ: "
        + (enabledApiOpts.length > 0 ? enabledApiOpts.join(", ") : "（なし）")
        + (targetTables.length > 0 ? " + db(利用テーブルあり)" : "")
        + "\n" + (optionalApiDocCtx || "（追加なし）")
    );

    // ── ⑤-3 プロジェクト単位の学習履歴（このイベントの過去の間違い） ──
    const learnedFixesCtx = buildLearnedFixesCtx(wid, evName);

    // ── ⑥ システムプロンプト ──
    const sysPrompt = _PROMPT_DEF.YAML_TO_JS_SYS_PROMPT(
        isAppEvent,
        {
            formName: curForm?.cfg?.name, eventName: evName,
            wname: w?.name, wtag: w?.tag, wdescription: w?.props?.description,
            inputParamsCtx: inputParamsCtx, allWidgetsCtx: allWidgetsCtx,
            formsCtx: formsCtxGated, globalConstCtx: globalConstCtxGated,
            formConstCtx: formConstCtxGated, tablesCtx: tablesCtx,
            extRuntimeDoc: getProjectData().extRuntime.doc
        });

    // ── ⑦ ユーザープロンプト ──
    const userPrompt = _PROMPT_DEF.YAML_TO_JS_USER_PROMPT(
        isAppEvent, yamlForAi, addPrompt,
        {
            formName: curForm?.cfg?.name, eventName: evName,
            wname: w?.name, wtag: w?.tag, wdescription: w?.props?.description,
            inputParamsCtx: inputParamsCtx, allWidgetsCtx: allWidgetsCtx,
            formsCtx: formsCtxGated, globalConstCtx: globalConstCtxGated,
            formConstCtx: formConstCtxGated, tablesCtx: tablesCtx,
            extRuntimeDoc: getProjectData().extRuntime.doc,
            optionalApiDocCtx: optionalApiDocCtx,
            learnedFixesCtx: learnedFixesCtx,
        }
    );

    return { sysPrompt, userPrompt, validationName, wtag: w?.tag };
}

// async function handleXxx() { ... } のラッパーを自動除去
// 3Bモデル等が関数ラッパーを生成してしまう場合の後処理
function _unwrapAiFunctionWrapper(code) {
    return code.replace(
        /^\s*async\s+function\s+\w+\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/,
        (_, inner) => inner.trim()
    );
}

// イベントJS自動生成（yamlAiGenerate）のロジック本体（DOM非依存）。
// 自動テスト用（bridge.tsのtestYamlAiGenerateハンドラ）に、DOM読み書き
// （ボタン活性制御・ステータステキスト・タブ切替・モーダル再描画）と
// 分離してある。1回検証NGなら自動修正リトライを1回だけ行う内部ロジックも
// 含む（元の実装と同一）。データモデル（イベントJS）への書き込み・
// モーダル描画（openFormYaml/openAppEvents/openYaml）の呼び出しは、
// 他の対応済み関数と同様、テスト時の副作用として許容する設計にした。
// domOverride: 呼び出し元（yamlAiGenerate）が、モーダルを破壊するrunAiGenerate()の
// showLoadingModal()呼び出しより前に取得した{yamlCur, addPrompt}。省略時は
// $("yaml-ta")等から直接読む（テストハンドラ等、モーダルの生死を気にしなくてよい
// 呼び出し元向け）。
// 戻り値: { finalCode, validation }（失敗時はnull）。
async function generateEventJs(wid, evName, isAppEvent, isFormEvent, temperatureOverride, domOverride = null) {
    const w = (isAppEvent || isFormEvent) ? null : getWidget(wid);
    const { sysPrompt, userPrompt, validationName } = buildGenPromptContext(wid, evName, isAppEvent, isFormEvent, true, domOverride);

    let result = null;
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        temperatureOverride: temperatureOverride,
        onSuccess: async (clean) => {
            let unwrapped = fixMissingAwaits(stripWidgetValueAccess(_unwrapAiFunctionWrapper(clean)), isAppEvent);
            // 1行べた書き・インデント不揃いを、検証（行番号ベース）の前に整形しておく
            unwrapped = await formatJsCode(unwrapped);

            // ── 生成結果の自動検証（構文チェック・APIホワイトリスト） ──
            // 問題があれば1回だけAIに自動修正を依頼し、それでも解消しない場合は
            // 警告バナーで人間に判断を委ねる（生成自体は止めない）。
            // ※temperatureの自動引き上げは行わない（通常のtemperature設定を
            //   そのまま使う）。ランダム性を上げて試したい場合は、エディタの
            //   「🎲 ランダム性を上げて再生成」ボタンを使う。
            let validation = validateGeneratedJs(unwrapped, isAppEvent, evName, w?.tag, wid);
            if (isAutoMockCheckEnabled(wid, evName)) {
                validation = await augmentWithMockCheck(validation, unwrapped, isAppEvent, evName, w?.tag, wid);
                if (validation.code) unwrapped = validation.code;
            }
            if (!validation.ok) {
                const issueLog = formatValidationIssuesForLog(validation);
                window.vja?.log?.debug?.("[AI検証] 自動修正リトライを実行します。検出内容: " + issueLog);
                // 自動修正リトライ時は、ウィジェット一覧の絞り込みを解除した
                // userPromptを使う（絞り込みが原因で未知のウィジェット名を
                // 参照してしまった可能性の救済策。narrowContext=falseで再構築）。
                const wideCtx = buildGenPromptContext(wid, evName, isAppEvent, isFormEvent, false, domOverride);
                const fixUserPrompt = buildAiFixPrompt(wideCtx.userPrompt, unwrapped, validation);
                let retryCode = null;
                await runAiGenerate({
                    systemPrompt: sysPrompt,
                    userPrompt: fixUserPrompt,
                    loadingMsg: "検出した問題を自動修正中…",
                    temperatureOverride: temperatureOverride,
                    onSuccess: async (fixed) => {
                        retryCode = await formatJsCode(fixMissingAwaits(stripWidgetValueAccess(_unwrapAiFunctionWrapper(fixed)), isAppEvent));
                    },
                    onCancel: async () => { },
                    onError: async () => { },
                });
                if (retryCode) {
                    unwrapped = retryCode;
                    validation = validateGeneratedJs(unwrapped, isAppEvent, evName, w?.tag, wid);
                    if (isAutoMockCheckEnabled(wid, evName)) {
                        validation = await augmentWithMockCheck(validation, unwrapped, isAppEvent, evName, w?.tag, wid);
                        if (validation.code) unwrapped = validation.code;
                    }
                    window.vja?.log?.debug?.(validation.ok
                        ? "[AI検証] 自動修正リトライで解消しました。"
                        : "[AI検証] 自動修正リトライ後も未解消: " + formatValidationIssuesForLog(validation));
                } else {
                    window.vja?.log?.debug?.("[AI検証] 自動修正リトライ自体が失敗しました（キャンセル/エラー）。");
                }
                // retryCodeがnull（リトライ自体が失敗）の場合も、元のunwrapped/validationのまま続行し
                // 後段の警告バナーでユーザーに通知する
            }

            // 検出された問題の行にのみ、指摘コメントを挿入する
            // （構文エラーは行特定の精度が低いため行コメント対象外。バナーでのみ通知）
            const codeForEditor = annotateUnknownApis(
                unwrapped, validation.unknownApis, validation.forbiddenPatterns,
                validation.missingAwaits, validation.unknownWidgets, validation.styleWarnings,
                validation.eventTypeMismatches
            );

            // バリデーション定義がある場合、JSの先頭に呼び出しを挿入
            // vja.validate.run('定義名') → false=エラー時はreturnで処理中断
            const finalCode = validationName
                ? "// 検証チェック処理(自動追加).\n" +
                `if (!await vja.validate.run(${JSON.stringify(validationName)})) return;\n\n${codeForEditor}`
                : codeForEditor;
            // モーダルを再表示してJSタブに切り替え
            // ウィジェット/フォーム/アプリイベントで「開き直す」関数が異なるため出し分ける
            if (isFormEvent) {
                const f = getProjectData().forms[getProjectData().curFormIdx];
                if (!f.events) f.events = {};
                f.events["_js_" + evName] = finalCode;
                openFormYaml(evName);
            } else if (isAppEvent) {
                if (!getProjectData().projectInfo.appEvents) getProjectData().projectInfo.appEvents = {};
                getProjectData().projectInfo.appEvents[evName] = finalCode;
                openAppEvents(evName);
            } else {
                const w2 = getWidget(wid);
                if (!w2) return;
                if (!w2.jsCode) w2.jsCode = {};
                w2.jsCode[evName] = finalCode;
                openYaml(wid, evName);
            }
            if (!validation.ok) {
                trackLearnedFixRecurrence(wid, evName, formatValidationIssuesForLog(validation));
            }
            result = { ok: true, finalCode, validation };
        },
        onCancel: async () => { result = { ok: false, reason: "cancel" }; },
        onError: async () => { result = { ok: false, reason: "error" }; },
    });
    return result;
}

async function yamlAiGenerate(wid, evName, temperatureOverride) {
    const isAppEvent = (wid === "appev");
    const isFormEvent = (wid === "form");
    const w = (isAppEvent || isFormEvent) ? null : getWidget(wid);
    if (!isAppEvent && !isFormEvent && !w) return;
    if (!getProjectData().aiConfig.enabled) {
        if (await vja.app.showConfirm("AI接続設定が有効になっていません。設定画面を開きますか？")) {
            closeModal();
            openAiConfig();
        }
        return;
    }

    // YAML本文が空のままAI生成を実行すると、依頼内容が丸ごとAIに渡らず
    // （ENG_YAML_TO_JS_USER_PROMPTは"[The Following YAML]"ブロック自体を省略する）、
    // 文脈の無い最小限のコードしか生成されない事故につながる。生成前に必ず検知して止める。
    const yamlTaEl = $("yaml-ta");
    if (!yamlTaEl?.value?.trim()) {
        showToast("YAML本文が空です。先に📋YAMLタブに内容を入力してください", 5000);
        return;
    }
    // この後のrunAiGenerate()（内部でshowLoadingModal()を呼び#modal-rootを
    // ローディング表示へ差し替える＝YAMLエディタのDOMがここで消える）より前に、
    // 必要なDOM値を確保しておく（詳細はgenerateEventJs()のAIメモ参照）。
    const domOverride = { yamlCur: yamlTaEl.value, addPrompt: $("ai-prompt-in")?.value || "" };

    const btn = $("ai-gen-btn");
    const randomBtn = $("ai-gen-random-btn");
    const status = $("ai-status");
    const aiStartTime = Date.now(); // AI実行開始時刻を記録

    // AI生成操作の前に現在のエディタ内容（依頼・YAML・JS）を即時保存
    await saveYamlData(wid, evName);

    // 確認ダイアログ
    const jsTaCur = $("js-ta")?.value || "";
    const jsTaHasCode = jsTaCur.split("\n")
        .some(l => l.trim() && !l.trim().startsWith("//"));
    const confirmMsg = jsTaHasCode
        ? "JavaScriptタブに既存のコードがあります。\nAI生成で上書きしますか？\n※実行前に現在の内容を保存します。"
        : "JavaScriptコードを生成しますか？\n※実行前に現在の内容を保存します。";
    if (!(await vja.app.showConfirm(confirmMsg))) {
        if (btn) btn.disabled = false;
        if (randomBtn) randomBtn.disabled = false;
        if (status) status.textContent = "";
        return;
    }
    if (btn) btn.disabled = true;
    if (randomBtn) randomBtn.disabled = true;
    if (status) status.textContent = "⏳ コンテキスト収集中…";
    showLoadingModal("AI生成中…");

    const result = await generateEventJs(wid, evName, isAppEvent, isFormEvent, temperatureOverride, domOverride);
    if (result?.ok) {
        const { finalCode, validation } = result;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const jsTa = $("js-ta");
            if (jsTa) jsTa.value = finalCode;
            if (typeof saveYamlData === "function") saveYamlData(wid, evName);
            yamlTabSwitch("js");
            jsHlUpdate();
            editorUpdateGutter("js-ta", "js-gutter");
            if (status) status.textContent = "✅ 生成完了 (JavaScriptタブを確認)";
            const elapsed = Math.round((Date.now() - aiStartTime) / 1000);
            showToast("✅ AI生成完了（" + elapsed + "秒）", 5000);
            if (!validation.ok) {
                showAiValidationWarningBanner(validation, wid, evName, isAppEvent, isFormEvent);
            }
        }));
    } else if (status) {
        status.textContent = result?.reason === "error" ? "❌ 生成エラー" : "";
    }
    if (btn) btn.disabled = false;
    if (randomBtn) randomBtn.disabled = false;
}

// 画面デザインテンプレート適用（insertFormDesignTemplate等）は
// 2026-09-21にvja-form-design-ai.jsへ切り出した。

// イベントYAMLドラフト生成AIへは、出力キー名を英語表記（description/tables/
// validation/actions/on_success/on_error）で指示している（日本語キー名だと
// 一部ローカルLLM＋llama-server環境で応答パースエラー(peg-native format)が
// 発生する事象が確認されたため）。ここでその英語キーを、VJAイベントYAMLの
// 正式仕様である日本語キー（説明/利用テーブル/入力チェック/アクション/
// 正常終了/エラー終了）へ変換する。日本語キーは「利用テーブル」連動機能
// （vja-yaml-editor.js内の正規表現抽出）やYAML→JS生成AIのプロンプトが
// 前提としているため、変換せず英語キーのまま使うと他機能が壊れる。
const _TEXT_TO_YAML_EN_TO_JP_KEYS = [
    ["description", "説明"],
    ["tables", "利用テーブル"],
    ["validation", "入力チェック"],
    ["actions", "アクション"],
    ["on_success", "正常終了"],
    ["on_error", "エラー終了"],
];
function _convertTextToYamlEngKeysToJp(yamlText) {
    let result = yamlText;
    _TEXT_TO_YAML_EN_TO_JP_KEYS.forEach(([en, jp]) => {
        result = result.replace(new RegExp("^([ \\t]*)" + en + "[ \\t]*:", "gm"), "$1" + jp + ":");
    });
    return result;
}

// イベントYAMLドラフト自動生成（Text to YAML）のロジック本体（DOM非依存）。
// 自動テスト用（bridge.tsのtestTextToYamlGenerateハンドラ）に、DOM読み書きと
// 分離してある。プロンプト生成→AI呼び出し→マークダウン除去・キー変換→
// データモデル（イベントYAML/依頼文）への書き込みまでを行う（モーダル描画である
// openFormYaml/openAppEvents/openYamlの呼び出しは、wizardDecomposeForms()等の
// 既存の自動テスト対応関数と同様、テスト時の副作用として許容する）。
// domOverride: 呼び出し元（textToYamlGenerate）が、モーダルを破壊するrunAiGenerate()の
// showLoadingModal()呼び出しより前に取得した{yamlCur, addPrompt}（詳細はgenerateEventJs()の
// AIメモ参照）。省略時は$("yaml-ta")等から直接読む。
// 戻り値: 生成されたYAML文字列（失敗時はnull）。
async function generateTextToYaml(wid, evName, inputText, domOverride = null) {
    const isAppEvent = (wid === "appev");
    const isFormEvent = (wid === "form");
    // YAMLドラフト生成時は依頼文にウィジェット名が出てこないケースが多いため、
    // 絞り込みを行わず常にフォーム全体のウィジェット一覧をAIへ渡す
    const { allWidgetsCtx, tablesCtx } = buildGenPromptContext(wid, evName, isAppEvent, isFormEvent, false, domOverride);

    const sysPrompt = _PROMPT_DEF.TEXT_TO_YAML_SYS_PROMPT({ widgetsCtx: allWidgetsCtx, tablesCtx: tablesCtx });
    const userPrompt = _PROMPT_DEF.TEXT_TO_YAML_USER_PROMPT(inputText);

    let result = null;
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        loadingMsg: "YAMLドラフト作成中…",
        onSuccess: async (cleanYaml) => {
            // マークダウンコードブロック (```yaml) を除去
            const stripped0 = cleanYaml.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
            // AIへの出力キー指示は英語表記（description/tables等）にしているため
            // （日本語キーだと一部ローカルLLM＋サーバー環境で応答パースエラーが
            // 発生する事象への対策）、実際のVJAイベントYAML仕様（日本語キー）へ変換する
            const stripped = _convertTextToYamlEngKeysToJp(stripped0);

            // モーダルを再表示する前にデータモデルに新YAMLと依頼テキストを書き込み
            if (isFormEvent) {
                const f = getProjectData().forms[getProjectData().curFormIdx];
                if (!f.events) f.events = {};
                f.events[evName] = stripped;
                f.events["_doc_" + evName] = inputText;
                openFormYaml(evName);
            } else if (isAppEvent) {
                if (!getProjectData().projectInfo.appEvents) getProjectData().projectInfo.appEvents = {};
                getProjectData().projectInfo.appEvents[evName + "_yaml"] = stripped;
                getProjectData().projectInfo.appEvents[evName + "_doc"] = inputText;
                openAppEvents(evName);
            } else {
                const w = getWidget(wid);
                if (w) {
                    if (!w.events) w.events = {};
                    if (!w.docCode) w.docCode = {};
                    w.events[evName] = stripped;
                    w.docCode[evName] = inputText;
                }
                openYaml(wid, evName);
            }
            result = stripped;
        },
        onCancel: async () => {},
        onError: async () => {},
    });
    return result;
}

async function textToYamlGenerate(wid, evName) {
    if (!getProjectData().aiConfig.enabled) {
        if (await vja.app.showConfirm("AI接続設定が有効になっていません。設定画面を開きますか？")) {
            closeModal();
            openAiConfig();
        }
        return;
    }

    const promptTa = $("prompt-ta");
    const aiPromptIn = $("ai-prompt-in");
    const inputText = promptTa?.value?.trim() || aiPromptIn?.value?.trim() || "";
    if (!inputText) {
        showToast("「✨ YAMLドラフト」タブまたはAI指示欄にやりたい内容を入力してください");
        if (promptTa) promptTa.focus();
        else if (aiPromptIn) aiPromptIn.focus();
        return;
    }

    // AI生成操作の前に現在のエディタ内容（依頼・YAML・JS）を即時保存
    await saveYamlData(wid, evName);

    const yamlTaCur = $("yaml-ta");
    if (yamlTaCur && yamlTaCur.value.trim().length > 0) {
        const ok = await vja.app.showConfirm(
            "YAMLエディタに既存の記述があります。\n" +
            "AIが作成するYAMLで上書きしますか？"
        );
        if (!ok) return;
    }

    // この後のrunAiGenerate()（内部でshowLoadingModal()を呼び#modal-rootを
    // ローディング表示へ差し替える＝YAMLエディタのDOMがここで消える）より前に、
    // 必要なDOM値を確保しておく（詳細はgenerateEventJs()のAIメモ参照）。
    const domOverride = { yamlCur: yamlTaCur?.value || "", addPrompt: $("ai-prompt-in")?.value || "" };

    showLoadingModal("YAMLドラフト作成中…");

    const stripped = await generateTextToYaml(wid, evName, inputText, domOverride);
    if (stripped === null) return;

    requestAnimationFrame(() => requestAnimationFrame(() => {
        const newYamlTa = $("yaml-ta");
        if (newYamlTa) {
            newYamlTa.value = stripped;
            yamlHlUpdate();
            editorUpdateGutter("yaml-ta", "yaml-gutter");
        }
        const newPromptTa = $("prompt-ta");
        if (newPromptTa) {
            newPromptTa.value = inputText;
            editorUpdateGutter("prompt-ta", "prompt-gutter");
        }
        if (typeof saveYamlData === "function") saveYamlData(wid, evName);
        yamlTabSwitch("yaml");
        showToast("✨ YAMLドラフトを作成・反映しました（📋 YAMLタブを確認）");
    }));
}

Object.assign(window, {
    buildTablesCtxText, getVjaApiWhitelist, narrowTablesByRequest, buildGenPromptContext,
    findMissingAwaits, fixMissingAwaits, findUnknownWidgetNames, formatJsCode, escapeRegExp,
    generateEventJs, yamlAiGenerate,
    generateTextToYaml, textToYamlGenerate,
});
