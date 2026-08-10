/* ═══════════════════════════════════════════════════════════════
   vja-wizard.js — プロジェクト新規作成ウィザード
   ─────────────────────────────────────────────────────────────
   【読み込み順序】10番目（vja-app-config.js の直後、vja-ui.js の前）。
   【依存】vja-defs.js, vja-modal.js, vja-save.js, vja-table-validation.js,
           vja-app-config.js, vja-yaml-editor.js
   【提供するもの】
     - actWizard()（ファイルメニューからの起動導線）
     - 新規プロジェクト作成確認 → AI接続設定確認 → プロジェクト設定確認
       → ウィザード本体（未実装、次フェーズで対応）という前提チェックの連鎖
   【AIメモ】
     - AI接続設定/プロジェクト設定モーダルは、保存完了時にWIZARD_STATEの
       該当コールバックを呼んでウィザードへ処理を戻す（aiCfgConfirm/
       saveProjectInfo側にフックを追加済み）。キャンセル時は該当コールバックを
       破棄する（aiCfgCancel/piCancel）。ウィザード経由でない通常のAI設定/
       プロジェクト設定の保存では、これらのコールバックは常にnullなので
       何も起きない。
   このファイルは vja-defs.js / vja-modal.js / vja-save.js /
   vja-table-validation.js / vja-app-config.js / vja-yaml-editor.js に依存する。
═══════════════════════════════════════════════════════════════ */

// ウィザードの前提チェック（AI接続設定・プロジェクト設定）から、保存完了後に
// ウィザードの次ステップへ処理を戻すためのコールバックを保持する一時状態。
// ウィザード経由でない通常の保存では常にnullのままなので影響しない。
// qaHistory/qaIndex/qaStatusはウィザード本体（Q&A）の状態。
const WIZARD_STATE = {
    resumeAfterAiConfig: null,
    resumeAfterProjectInfo: null,
    resumeAfterTableEdit: null, // ウィザード内「✏️ 編集」からテーブル編集モーダルを開いた際、保存/一覧に戻る操作で呼び戻すコールバック
    qaHistory: [], // [{ question, answer, answerType, options }]
    qaIndex: 0,
    qaStatus: [], // [{ label, done }]
    formPlan: [], // [{ formName, formTitle, description, docDraft }]
    tableCandidates: [], // [{ name, description, selected }]
    step: 1, // 現在のステップ番号（ステップインジケーター表示用）
};

// ステップインジケーターに表示するステップ一覧。
const WIZARD_STEPS = [
    "Q&A",
    "テーブル候補",
    "カラム確認",
    "画面構成",
    "生成",
];

// 現在ステップ（WIZARD_STATE.step）を元に、ステップインジケーターのHTMLを生成する。
// 完了済み=塗りつぶし、現在地=強調枠、未到達=薄色で表示する。
function _wizardRenderStepIndicator() {
    const cur = WIZARD_STATE.step;
    return "<div style='display:flex;align-items:center;gap:4px;margin-bottom:10px;flex-wrap:wrap'>" +
        WIZARD_STEPS.map((label, i) => {
            const n = i + 1;
            const done = n < cur;
            const active = n === cur;
            const circleStyle = "display:inline-flex;align-items:center;justify-content:center;" +
                "width:20px;height:20px;border-radius:50%;font-size:11px;flex:none;" +
                (done ? "background:var(--accent2, #2a6);color:#fff;"
                    : active ? "background:var(--bg1);color:var(--text1);border:2px solid var(--accent2, #2a6);"
                        : "background:var(--bg2);color:var(--text3);border:1px solid var(--border);");
            const labelStyle = "font-size:11px;" + (active ? "color:var(--text1);font-weight:bold;" : "color:var(--text3);");
            const sep = i < WIZARD_STEPS.length - 1
                ? "<span style='flex:1;height:1px;min-width:10px;background:" + (done ? "var(--accent2, #2a6)" : "var(--border)") + "'></span>"
                : "";
            return "<span style='display:flex;align-items:center;gap:4px'>" +
                "<span style='" + circleStyle + "'>" + (done ? "✓" : n) + "</span>" +
                "<span style='" + labelStyle + "'>" + esc(label) + "</span>" +
                "</span>" + sep;
        }).join("") +
        "</div>";
}

// WIZARD_STATEの主要な内容をgetProjectData().wizardProgressへ保存する。
// これによりウィザードの進行状況が.vjaprojファイルに永続化され、
// アプリ再起動後や別セッションでも「続きから再開」できるようになる。
// 各ステップのモーダルを表示する直前に呼び出す。
function _wizardSaveProgress() {
    getProjectData().wizardProgress = {
        done: false,
        step: WIZARD_STATE.step,
        qaHistory: WIZARD_STATE.qaHistory,
        qaIndex: WIZARD_STATE.qaIndex,
        qaStatus: WIZARD_STATE.qaStatus,
        tableCandidates: WIZARD_STATE.tableCandidates,
        formPlan: WIZARD_STATE.formPlan,
    };
}

// プロジェクトを開いた際、中断されたウィザードの進行状況が残っていれば
// 「続きから再開」を提案する（vja-save.jsのloadProjectData()から呼ばれる）。
function wizardOfferResume() {
    const wp = getProjectData().wizardProgress;
    if (!wp || wp.done) return;
    showModal(
        mhdrHTML("🧙 ウィザードの再開") +
        "<div class='mbody' style='gap:10px'>" +
        "<div class='infobox'>前回、プロジェクト作成ウィザードが完了する前に中断されたようです。続きから再開しますか？</div>" +
        "</div>" +
        "<div class='mfoot'>" +
        "<button" + evtAttr("onmousedown", "wizardDiscardProgress()") + ">破棄する</button>" +
        "<button class='pri'" + evtAttr("onmousedown", "wizardResumeFromProgress()") + ">続きから再開</button>" +
        "</div>"
    );
}

// 「破棄する」: 保存済みの進行状況を削除し、通常のエディタ画面のまま終える
function wizardDiscardProgress() {
    getProjectData().wizardProgress = null;
    closeModal();
}

// 「続きから再開」: 保存済みの進行状況をWIZARD_STATEへ復元し、該当ステップのモーダルを再表示する
function wizardResumeFromProgress() {
    const wp = getProjectData().wizardProgress;
    closeModal();
    if (!wp) return;
    WIZARD_STATE.qaHistory = wp.qaHistory || [];
    WIZARD_STATE.qaIndex = wp.qaIndex || 0;
    WIZARD_STATE.qaStatus = wp.qaStatus || [];
    WIZARD_STATE.tableCandidates = wp.tableCandidates || [];
    WIZARD_STATE.formPlan = wp.formPlan || [];
    WIZARD_STATE.step = wp.step || 1;
    switch (WIZARD_STATE.step) {
        case 2: _wizardRenderTableCandidatesModal(); break;
        case 3: _wizardRenderColumnsReviewModal(); break;
        case 4: _wizardRenderFormReviewModal(); break;
        default: _wizardRenderQaModal(); break;
    }
}

// 「← 戻る」（テーブル候補ステップへ）: カラム確認/画面構成から戻る際に使う
function wizardGoBackToTableCandidates() {
    closeModal();
    WIZARD_STATE.step = 2;
    _wizardRenderTableCandidatesModal();
}

// 「← 戻る」（カラム確認ステップへ）: 画面構成から戻る際に使う
function wizardGoBackToColumnsReview() {
    closeModal();
    WIZARD_STATE.step = 3;
    _wizardRenderColumnsReviewModal();
}

// この件数を超えたら「完了で進めることもできます」とトーストで軽く促す目安値
// （ブロックはしない。質問数が本当に必要なプロジェクトもあるため上限としては強制しない）
const WIZARD_QA_SUGGEST_COMPLETE_AT = 6

// ファイルメニュー「ウィザードでプロジェクト作成…」から呼ばれる起点。
function actWizard() {
    if (isDirty()) {
        showCloseConfirm(
            "未保存の変更があります。",
            "ウィザードで新規プロジェクトを作成すると、現在の内容は失われます。続けますか？",
            "新規作成してウィザードを開始",
            wizardStartNewProject
        );
    } else {
        wizardStartNewProject();
    }
}

// ① 新規プロジェクトを作成し、②AI接続設定の確認へ進む
function wizardStartNewProject() {
    doActNew();
    wizardCheckAiConfig();
}

// ② AI接続設定が有効でなければ設定を促し、保存完了後に③へ進む
function wizardCheckAiConfig() {
    if (!getProjectData().aiConfig.enabled) {
        showToast("ウィザードを開始するには、まずAI接続設定を行ってください");
        WIZARD_STATE.resumeAfterAiConfig = wizardCheckProjectInfo;
        openAiConfig();
        return;
    }
    wizardCheckProjectInfo();
}

// ③ プロジェクト情報（名前）が未入力なら入力を促し、保存完了後に④へ進む
function wizardCheckProjectInfo() {
    if (!getProjectData().projectInfo.name?.trim()) {
        showToast("続いて、プロジェクト情報（プロジェクト名）を入力してください");
        WIZARD_STATE.resumeAfterProjectInfo = wizardStepBody;
        openProjectInfo();
        return;
    }
    wizardStepBody();
}

// ④ ウィザード本体開始。Q&Aの状態を初期化し、AIに最初の質問を生成させる。
function wizardStepBody() {
    WIZARD_STATE.qaHistory = [];
    WIZARD_STATE.qaIndex = 0;
    WIZARD_STATE.qaStatus = [];
    WIZARD_STATE.step = 1;
    wizardQaFetchNext();
}

// Q&A履歴を「Q1: ...\nA1: ...」形式のテキストに整形する（AIプロンプト用）
function _wizardBuildQaHistoryCtx() {
    return WIZARD_STATE.qaHistory
        .map((qa, i) => "Q" + (i + 1) + ": " + qa.question + "\nA" + (i + 1) + ": " + (qa.answer || "(未回答)"))
        .join("\n");
}

// AI出力テキストをJSONオブジェクトとしてパースする（既存のparseFormDesignJsonと同様の方式）。
// 1. まずそのままJSON.parseを試みる。2. 失敗時は最初の"{"〜最後の"}"を抜き出して再試行する。
function _wizardParseQuestionJson(text) {
    const tryParse = (s) => {
        try {
            const v = JSON.parse(s);
            return (v && typeof v === "object" && !Array.isArray(v)) ? v : null;
        } catch (e) {
            return null;
        }
    };
    const direct = tryParse(text);
    if (direct) return direct;
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s !== -1 && e !== -1 && e > s) {
        const extracted = tryParse(text.slice(s, e + 1));
        if (extracted) return extracted;
    }
    return null;
}

// AIに次の質問を生成させ、履歴に追加してQ&Aモーダルを表示する。
async function wizardQaFetchNext() {
    const sysPrompt = _PROMPT_DEF.WIZARD_NEXT_QUESTION_SYS_PROMPT();
    const userPrompt = _PROMPT_DEF.WIZARD_NEXT_QUESTION_USER_PROMPT(_wizardBuildQaHistoryCtx());

    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        loadingMsg: "次の質問を考えています…",
        onSuccess: async (raw) => {
            const parsed = _wizardParseQuestionJson(raw);
            if (!parsed || !parsed.question) {
                showToast("質問の生成に失敗しました。もう一度お試しください");
                _wizardRenderQaModal();
                return;
            }
            WIZARD_STATE.qaHistory.push({
                question: parsed.question,
                answer: "",
                answerType: (parsed.answerType === "choice" || parsed.answerType === "multi_choice") ? parsed.answerType : "text",
                options: Array.isArray(parsed.options) ? parsed.options : [],
            });
            WIZARD_STATE.qaIndex = WIZARD_STATE.qaHistory.length - 1;
            WIZARD_STATE.qaStatus = Array.isArray(parsed.status) ? parsed.status : [];
            _wizardRenderQaModal();
        },
        onCancel: async () => { _wizardRenderQaModal(); },
        onError: async () => {
            showToast("質問の生成に失敗しました。もう一度お試しください");
            _wizardRenderQaModal();
        },
    });
}

// Q&Aモーダルを描画する。qaHistoryが空（初回AI呼び出し前）の場合は何もしない
// （runAiGenerateのローディングモーダルがそのまま表示され続ける）。
function _wizardRenderQaModal() {
    if (WIZARD_STATE.qaHistory.length === 0) return;
    _wizardSaveProgress();
    const idx = WIZARD_STATE.qaIndex;
    const qa = WIZARD_STATE.qaHistory[idx];
    const isFirst = idx === 0;

    const statusHtml = WIZARD_STATE.qaStatus.length > 0
        ? "<div style='display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px'>" +
        WIZARD_STATE.qaStatus.map((s) =>
            "<span style='font-size:11px;padding:2px 8px;border-radius:10px;border:1px solid var(--border);" +
            (s.done ? "background:var(--accent2, #2a6);color:#fff" : "background:var(--bg2);color:var(--text3)") + "'>" +
            (s.done ? "✓ " : "") + esc(s.label) + "</span>"
        ).join("") + "</div>"
        : "";

    const hasOptions = Array.isArray(qa.options) && qa.options.length > 0;
    const isMulti = qa.answerType === "multi_choice";
    const optionsHtml = hasOptions
        ? "<div style='display:flex;flex-direction:column;gap:6px'>" +
        qa.options.map((opt, i) =>
            "<button class='tb-btn' style='text-align:left;padding:6px 10px'" +
            evtAttr("onmousedown", "wizardQaPickOption(" + i + ")") + ">" + (i + 1) + ". " + esc(opt) + "</button>"
        ).join("") + "</div>" +
        "<div class='infobox' style='font-size:11px'>" +
        (isMulti ? "複数選択可。ボタンで選ぶか、番号をカンマ区切りで入力してください（例: 1,3）" : "ボタンで選ぶか、番号を入力してください（例: 2）") +
        "</div>"
        : "";

    showModal(
        mhdrHTML("🧙 ウィザード（" + (idx + 1) + "問目）") +
        "<div class='mbody' style='gap:10px'>" +
        _wizardRenderStepIndicator() +
        statusHtml +
        "<div class='infobox'>" + esc(qa.question) + "</div>" +
        optionsHtml +
        "<textarea id='wiz-qa-answer' class='pv-textarea' style='height:80px;font-size:13px' placeholder='" + (hasOptions ? "番号または自由入力" : "自由に入力してください") + "'>" + esc(qa.answer || "") + "</textarea>" +
        "</div>" +
        "<div class='mfoot'>" +
        "<button" + evtAttr("onmousedown", "wizardQaBack()") + (isFirst ? " disabled" : "") + ">← 戻る</button>" +
        "<button" + evtAttr("onmousedown", "wizardQaComplete()") + ">完了</button>" +
        "<button class='pri'" + evtAttr("onmousedown", "wizardQaNext()") + ">次へ →</button>" +
        "</div>"
    );
    setTimeout(() => $("wiz-qa-answer")?.focus(), 0);
}

// 選択肢ボタン押下時: 単一選択(choice)は選んだ項目に置き換え、
// 複数選択(multi_choice)は既に選ばれていれば外し、無ければ追記するトグル動作。
function wizardQaPickOption(optIndex) {
    const qa = WIZARD_STATE.qaHistory[WIZARD_STATE.qaIndex];
    const label = qa.options[optIndex];
    const ta = $("wiz-qa-answer");
    if (!ta || label === undefined) return;
    if (qa.answerType !== "multi_choice") {
        ta.value = label;
        return;
    }
    const picked = ta.value.split("、").map((s) => s.trim()).filter(Boolean);
    const i = picked.indexOf(label);
    if (i >= 0) picked.splice(i, 1);
    else picked.push(label);
    ta.value = picked.join("、");
}

// 回答欄の値が「番号（カンマ/読点区切り、複数可）」だけの場合、選択肢の
// テキストに変換する（Claudeの選択肢回答のような、番号入力での回答を許容するため）。
// 番号以外の文字が含まれる場合はそのまま自由記述として扱う。
function _wizardResolveAnswerText(qa, rawValue) {
    const value = (rawValue || "").trim();
    if (!Array.isArray(qa.options) || qa.options.length === 0 || !value) return value;
    const tokens = value.split(/[、,]/).map((s) => s.trim()).filter(Boolean);
    if (tokens.length === 0) return value;
    const isAllNumeric = tokens.every((t) => /^\d+$/.test(t));
    if (!isAllNumeric) return value;
    const labels = tokens
        .map((t) => qa.options[parseInt(t, 10) - 1])
        .filter((label) => label !== undefined);
    return labels.length > 0 ? labels.join("、") : value;
}

// 現在の回答欄の値をqaHistoryへ保存する（選択肢問題は番号入力をテキストへ解釈する）
function _wizardCommitCurrentAnswer() {
    const ta = $("wiz-qa-answer");
    if (!ta) return;
    const qa = WIZARD_STATE.qaHistory[WIZARD_STATE.qaIndex];
    qa.answer = _wizardResolveAnswerText(qa, ta.value);
}

// 「戻る」: AI呼び出しなしで前の質問を再表示する
function wizardQaBack() {
    _wizardCommitCurrentAnswer();
    if (WIZARD_STATE.qaIndex > 0) WIZARD_STATE.qaIndex--;
    _wizardRenderQaModal();
}

// 「次へ」: キャッシュ済みの次ステップがあればAI呼び出しなしで移動、
// 先頭（最新）にいる場合のみAIに新しい質問を生成させる
function wizardQaNext() {
    _wizardCommitCurrentAnswer();
    const atFrontier = WIZARD_STATE.qaIndex === WIZARD_STATE.qaHistory.length - 1;
    if (!atFrontier) {
        WIZARD_STATE.qaIndex++;
        _wizardRenderQaModal();
        return;
    }
    if (WIZARD_STATE.qaHistory.length >= WIZARD_QA_SUGGEST_COMPLETE_AT) {
        showToast("質問数が多くなっています。「完了」で次へ進むこともできます");
    }
    wizardQaFetchNext();
}

// 「完了」: 常時押せる。Q&Aを終了しテーブル候補抽出ステップへ進む
// （2026-08-10: 以前はここからフォーム分解→テーブル候補の順だったが、画面の
//   docDraftを具体的にする（＝テーブルのカラムを先に確定させる）ため、
//   テーブル候補抽出→カラム確定→フォーム分解の順に変更した）
function wizardQaComplete() {
    _wizardCommitCurrentAnswer();
    wizardExtractTableCandidates();
}

/* ═══════════════════════════════════════════
  テーブル候補抽出・カラム確定・フォーム分解（ウィザード②③④）
═══════════════════════════════════════════ */

// AI出力テキストをJSON配列としてパースする（既存のparseFormDesignJsonと同方式）
function _wizardParseJsonArray(text) {
    const tryParse = (s) => {
        try {
            const v = JSON.parse(s);
            return Array.isArray(v) ? v : null;
        } catch (e) {
            return null;
        }
    };
    const direct = tryParse(text);
    if (direct) return direct;
    const s = text.indexOf("[");
    const e = text.lastIndexOf("]");
    if (s !== -1 && e !== -1 && e > s) {
        const extracted = tryParse(text.slice(s, e + 1));
        if (extracted) return extracted;
    }
    return null;
}

// Q&A履歴からAIにテーブル候補を抽出させ、選択モーダルを表示する
// （フォーム一覧はまだ存在しないため、Q&A履歴のみを材料にする）
async function wizardExtractTableCandidates() {
    const historyCtx = _wizardBuildQaHistoryCtx();
    const sysPrompt = _PROMPT_DEF.WIZARD_TABLE_CANDIDATES_SYS_PROMPT();
    const userPrompt = _PROMPT_DEF.WIZARD_TABLE_CANDIDATES_USER_PROMPT(historyCtx);

    let tables = null;
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        loadingMsg: "必要そうなテーブルを検討しています…",
        onSuccess: async (raw) => { tables = _wizardParseJsonArray(raw); },
        onCancel: async () => { },
        onError: async () => { },
    });

    // テーブル候補抽出に失敗しても、テーブルが無いケースと同様に扱い続行する
    WIZARD_STATE.tableCandidates = (tables || []).map((t) => ({ name: t.name, description: t.description, selected: true }));
    WIZARD_STATE.step = 2;
    _wizardRenderTableCandidatesModal();
}

// テーブル候補の選択モーダルを表示する
function _wizardRenderTableCandidatesModal() {
    _wizardSaveProgress();
    const tablesHtml = WIZARD_STATE.tableCandidates.length > 0
        ? WIZARD_STATE.tableCandidates.map((t, i) =>
            "<label style='display:flex;align-items:center;gap:8px;padding:4px 0'>" +
            "<input type='checkbox'" + (t.selected ? " checked" : "") + evtAttr("onchange", "wizardToggleTableCandidate(" + i + ")") + ">" +
            "<span><b>" + esc(t.name) + "</b> — " + esc(t.description || "") + "</span>" +
            "</label>"
        ).join("")
        : "<div class='infobox' style='font-size:11px'>DBテーブルは不要と判断されました</div>";

    showModal(
        mhdrHTML("🧙 ウィザード（テーブル候補）") +
        "<div class='mbody' style='gap:10px'>" +
        _wizardRenderStepIndicator() +
        "<div class='infobox'>このアプリで使いそうなテーブルの候補です。不要なものはチェックを外してください。</div>" +
        tablesHtml +
        "</div>" +
        "<div class='mfoot'>" +
        "<button" + evtAttr("onmousedown", "closeModal()") + ">キャンセル</button>" +
        "<button" + evtAttr("onmousedown", "wizardGoBackToQa()") + ">← 戻る</button>" +
        "<button class='pri'" + evtAttr("onmousedown", "wizardProceedToColumnGen()") + ">次へ →</button>" +
        "</div>"
    );
}

// 「← 戻る」（Q&Aステップへ）: テーブル候補から戻る際に使う
function wizardGoBackToQa() {
    closeModal();
    WIZARD_STATE.step = 1;
    _wizardRenderQaModal();
}

function wizardToggleTableCandidate(i) {
    WIZARD_STATE.tableCandidates[i].selected = !WIZARD_STATE.tableCandidates[i].selected;
}

// 選択されたテーブルを仮登録（名前・説明のみ、カラムはこの直後にAIで生成する）する
function _wizardCommitSelectedTables() {
    const existingNames = new Set(getProjectData().tables.map((t) => t.name));
    WIZARD_STATE.tableCandidates
        .filter((t) => t.selected && t.name && !existingNames.has(t.name))
        .forEach((t) => {
            getProjectData().tables.push({
                name: t.name,
                description: t.description || "",
                columns: [],
                updatedAt: new Date().toISOString(),
            });
        });
}

// 「次へ」: 選択されたテーブルを仮登録し、各テーブルのカラム構成をAIで一括生成する
// （戻ってやり直した場合、既にテーブルが確定済みのことがあるため、その場合は
//   「削除して作り直す」か「そのまま次へ進む」かを確認する）
async function wizardProceedToColumnGen() {
    closeModal();

    const existingTables = getProjectData().tables || [];
    if (existingTables.length > 0) {
        const ok = await vja.app.showConfirm(
            "既にテーブル（" + existingTables.map((t) => t.name).join("、") + "）が存在します。\n" +
            "削除してテーブル候補から作り直しますか？\n\n" +
            "「OK」で全て削除して作り直します。「キャンセル」で今のテーブルをそのまま使って次へ進みます。"
        );
        if (ok) {
            getProjectData().tables = [];
        } else {
            WIZARD_STATE.step = 3;
            _wizardRenderColumnsReviewModal();
            return;
        }
    }

    _wizardCommitSelectedTables();
    WIZARD_STATE.step = 3;

    const targetNames = new Set(
        WIZARD_STATE.tableCandidates.filter((t) => t.selected && t.name).map((t) => t.name)
    );
    const targetTables = getProjectData().tables.filter((t) => targetNames.has(t.name));
    if (targetTables.length === 0) {
        _wizardRenderColumnsReviewModal();
        return;
    }

    const historyCtx = _wizardBuildQaHistoryCtx();
    const total = targetTables.length;
    for (let i = 0; i < total; i++) {
        const t = targetTables[i];
        showToast("テーブル" + (i + 1) + "/" + total + ": " + t.name + " のカラム構成を生成中…");
        const sysPrompt = _PROMPT_DEF.TABLE_SCHEMA_GEN_SYS_PROMPT({ tableName: t.name, description: t.description });
        const userPrompt = _PROMPT_DEF.TABLE_SCHEMA_GEN_USER_PROMPT(historyCtx);

        let cols = null;
        await runAiGenerate({
            systemPrompt: sysPrompt,
            userPrompt: userPrompt,
            loadingMsg: "テーブル構成を生成中…（" + (i + 1) + "/" + total + "）",
            onSuccess: async (raw) => { cols = _wizardParseJsonArray(raw); },
            onCancel: async () => { },
            onError: async () => { },
        });
        const sanitized = sanitizeAiTableColumns(cols);
        if (sanitized.length > 0) {
            t.columns = sanitized;
            t.updatedAt = new Date().toISOString();
        }
    }

    _wizardRenderColumnsReviewModal();
}

// 生成されたカラム構成の確認モーダルを表示する。
// 詳細な編集は既存の「テーブル管理」モーダル（openTableEdit）を再利用する。
function _wizardRenderColumnsReviewModal() {
    _wizardSaveProgress();
    const allTables = getProjectData().tables || [];
    const targetNames = new Set(
        WIZARD_STATE.tableCandidates.filter((t) => t.selected && t.name).map((t) => t.name)
    );
    // 選択済みテーブル候補に一致するものが無い場合（既存テーブルをそのまま使う選択をした場合等）は、
    // プロジェクトの全テーブルを表示対象にする
    const matched = allTables.filter((t) => targetNames.has(t.name));
    const targetTables = matched.length > 0 ? matched : allTables;

    const tablesHtml = targetTables.length > 0
        ? targetTables.map((t) => {
            const idx = allTables.indexOf(t);
            const colsPreview = (t.columns || []).length > 0
                ? (t.columns || []).map((c) =>
                    "<span style='display:inline-block;font-size:11px;padding:2px 6px;margin:2px;border-radius:8px;background:var(--bg2);border:1px solid var(--border)'>" +
                    esc(c.name) + (c.pk ? " 🔑" : "") + ": " + esc(c.type) +
                    "</span>"
                ).join("")
                : "<span style='font-size:11px;color:var(--text3)'>（カラム生成に失敗しました。編集ボタンから作成してください）</span>";
            return "<div class='rp-tbl-row'><div class='rp-tbl-header'>" +
                "<span class='rp-tbl-name'><b>" + esc(t.name) + "</b> — " + esc(t.description || "") + "</span>" +
                "<button style='font-size:11px;padding:2px 8px'" + evtAttr("onmousedown", "wizardEditTableColumns(" + idx + ")") + ">✏️ 編集</button>" +
                "</div><div style='padding:4px 0'>" + colsPreview + "</div></div>";
        }).join("")
        : "<div class='infobox' style='font-size:11px'>テーブルはありません</div>";

    showModal(
        mhdrHTML("🧙 ウィザード（カラム確認）") +
        "<div class='mbody' style='gap:10px'>" +
        _wizardRenderStepIndicator() +
        "<div class='infobox'>AIが生成したテーブルのカラム構成です。「✏️ 編集」から修正できます。よければ「次へ」を押してください。</div>" +
        tablesHtml +
        "</div>" +
        "<div class='mfoot'>" +
        "<button" + evtAttr("onmousedown", "closeModal()") + ">キャンセル</button>" +
        "<button" + evtAttr("onmousedown", "wizardGoBackToTableCandidates()") + ">← 戻る</button>" +
        "<button class='pri'" + evtAttr("onmousedown", "wizardProceedToFormDecompose()") + ">次へ →</button>" +
        "</div>"
    );
}

// 「✏️ 編集」: 既存のテーブル編集モーダルを開く。保存/一覧に戻る操作の完了時、
// AI接続設定等と同じ「resumeAfterXxx」フック方式でウィザードのカラム確認モーダルへ戻す
// （フックの実体は vja-table-validation.js の tblSave()/openTableManager() 側に追加済み）。
function wizardEditTableColumns(idx) {
    if (idx < 0) return;
    WIZARD_STATE.resumeAfterTableEdit = _wizardRenderColumnsReviewModal;
    openTableEdit(idx);
}

// 「次へ」（カラム確認から）: フォーム分解ステップへ進む
async function wizardProceedToFormDecompose() {
    closeModal();
    WIZARD_STATE.step = 4;
    await wizardDecomposeForms();
}

// Q&A履歴＋確定済みテーブル（カラム込み）からAIにフォーム一覧を分解させ、確認モーダルを表示する
async function wizardDecomposeForms() {
    const historyCtx = _wizardBuildQaHistoryCtx();
    const tablesCtx = buildTablesCtxText(getProjectData().tables || []);
    const sysPrompt = _PROMPT_DEF.WIZARD_DECOMPOSE_FORMS_SYS_PROMPT({ tablesCtx });
    const userPrompt = _PROMPT_DEF.WIZARD_DECOMPOSE_FORMS_USER_PROMPT(historyCtx);

    let forms = null;
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        loadingMsg: "画面構成を検討しています…",
        onSuccess: async (raw) => { forms = _wizardParseJsonArray(raw); },
        onCancel: async () => { },
        onError: async () => { },
    });

    if (!forms || forms.length === 0) {
        showToast("画面構成の生成に失敗しました。もう一度お試しください");
        _wizardRenderColumnsReviewModal();
        return;
    }
    WIZARD_STATE.formPlan = forms;
    _wizardRenderFormReviewModal();
}

// フォーム一覧の確認モーダルを表示する（ウィザード最後の確認画面）
function _wizardRenderFormReviewModal() {
    _wizardSaveProgress();
    const formsHtml = WIZARD_STATE.formPlan
        .map((f) => "<div class='rp-tbl-row'><div class='rp-tbl-header'>" +
            "<span class='rp-tbl-name'>" + esc(f.formTitle) + "</span>" +
            "<span class='rp-tbl-desc'>" + esc(f.description || "") + "</span>" +
            "</div></div>")
        .join("");

    showModal(
        mhdrHTML("🧙 ウィザード（画面構成）") +
        "<div class='mbody' style='gap:10px'>" +
        _wizardRenderStepIndicator() +
        "<div class='infobox'>以下の画面を作成します。よければ「生成開始」を押してください。</div>" +
        "<div><b>作成するフォーム</b></div>" +
        formsHtml +
        "</div>" +
        "<div class='mfoot'>" +
        "<button" + evtAttr("onmousedown", "closeModal()") + ">キャンセル</button>" +
        "<button" + evtAttr("onmousedown", "wizardGoBackToColumnsReview()") + ">← 戻る</button>" +
        "<button class='pri'" + evtAttr("onmousedown", "wizardConfirmAndGenerate()") + ">生成開始</button>" +
        "</div>"
    );
}

/* ═══════════════════════════════════════════
  一括生成（ウィザード⑤）
═══════════════════════════════════════════ */

// 「生成開始」: フォームを作成して画面デザイン一括生成を開始する
// （テーブルは②③で既に確定済みのため、ここでは何もしない）
async function wizardConfirmAndGenerate() {
    closeModal();
    WIZARD_STATE.step = 5;

    getProjectData().forms = WIZARD_STATE.formPlan.map((f) => {
        const nf = makeFormData(f.formName || "Form1");
        nf.cfg.title = f.formTitle || nf.cfg.title;
        nf.cfg.description = f.description || "";
        nf.formDesignDocDraft = f.docDraft || "";
        return nf;
    });
    getProjectData().curFormIdx = 0;
    refreshAll();

    // 生成ループに入る前に、フォームの雛形が作られたことを一区切り伝える
    // （AI生成にすぐ入ってしまうと「画面が作られた」実感が薄いため、
    //  一瞬待ってからトーストを出し、生成フェーズへ進む）
    const total = getProjectData().forms.length;
    showToast(total + "個の画面の雛形を作成しました。続けて画面デザインを生成します…");
    await new Promise((r) => setTimeout(r, 800));

    let successCount = 0;
    for (let i = 0; i < total; i++) {
        switchForm(i);
        const f = getProjectData().forms[i];
        showToast("フォーム" + (i + 1) + "/" + total + ": " + f.cfg.title + " を生成中…");
        const yaml = await _wizardGenerateFormYaml(f.formDesignDocDraft);
        if (!yaml) continue; // 失敗した場合はこのフォームは空のまま次へ進む
        f.formDesignDraft = yaml;
        const ok = await _wizardGenerateFormLayout(yaml);
        if (ok) successCount++;
    }

    getProjectData().wizardProgress = null; // ウィザード完了。再開用の進行状況は不要になったため削除
    refreshAll();
    pushUndo();
    showToast("ウィザード完了: " + successCount + "/" + total + "件のフォームを生成しました");
    showVjaAlert("画面生成が終わりました。テーブル・画面の内容は、メニューの「テーブル管理」やデザイナー上でいつでも調整できます。");
}

// 1フォーム分の「画面デザインYAMLドラフト → YAML」生成（DOM非依存版）
async function _wizardGenerateFormYaml(docDraft) {
    const allTablesFull = getProjectData().tables || [];
    const targetTablesForCtx = narrowTablesByRequest(docDraft || "", allTablesFull);
    const tablesCtx = buildTablesCtxText(targetTablesForCtx);
    const sysPrompt = _PROMPT_DEF.FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT({ tablesCtx });
    const userPrompt = _PROMPT_DEF.FORM_DESIGN_TEXT_TO_YAML_USER_PROMPT(docDraft || "");

    let result = null;
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        loadingMsg: "画面YAMLドラフトを生成中…",
        onSuccess: async (cleanYaml) => {
            const stripped0 = cleanYaml.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
            result = convertFormDesignEngKeysToJp(stripped0);
        },
        onCancel: async () => { },
        onError: async () => { },
    });
    return result;
}

// 1フォーム分の「YAML → 画面レイアウト（ウィジェット配置）」生成（DOM非依存版）
async function _wizardGenerateFormLayout(yamlText) {
    const { tables } = parseFormDesignYaml(yamlText);
    const targetTables = getProjectData().tables.filter((t) => tables.includes(t.name));
    const tablesCtx = buildTablesCtxText(targetTables);
    const sysPrompt = _PROMPT_DEF.FORM_DESIGN_SYS_PROMPT({
        formW: getProjectData().formCfg.w,
        formH: getProjectData().formCfg.h,
        tablesCtx,
    });
    const userPrompt = _PROMPT_DEF.FORM_DESIGN_USER_PROMPT(yamlText, "");

    let items = null;
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        loadingMsg: "画面レイアウトを生成中…",
        onSuccess: async (generated) => { items = parseFormDesignJson(generated); },
        onCancel: async () => { },
        onError: async () => { },
    });
    if (!items) return false;
    applyAiFormDesign(items);
    return true;
}

Object.assign(window, {
    actWizard, wizardStartNewProject, wizardCheckAiConfig, wizardCheckProjectInfo, wizardStepBody,
    wizardQaBack, wizardQaNext, wizardQaComplete, wizardQaPickOption,
    wizardExtractTableCandidates, wizardToggleTableCandidate, wizardProceedToColumnGen,
    wizardEditTableColumns, wizardProceedToFormDecompose, wizardDecomposeForms, wizardConfirmAndGenerate,
    wizardOfferResume, wizardDiscardProgress, wizardResumeFromProgress,
    wizardGoBackToQa, wizardGoBackToTableCandidates, wizardGoBackToColumnsReview,
    WIZARD_STATE,
});
