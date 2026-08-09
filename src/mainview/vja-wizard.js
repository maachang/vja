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
    qaHistory: [], // [{ question, answer }]
    qaIndex: 0,
    qaStatus: [], // [{ label, done }]
};

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

// 「完了」: 常時押せる。Q&Aを終了し次フェーズ（フォーム分解、次フェーズで実装予定）へ進む
function wizardQaComplete() {
    _wizardCommitCurrentAnswer();
    closeModal();
    showToast("フォーム分解・一括生成は次のフェーズで実装予定です");
}

Object.assign(window, {
    actWizard, wizardStartNewProject, wizardCheckAiConfig, wizardCheckProjectInfo, wizardStepBody,
    wizardQaBack, wizardQaNext, wizardQaComplete, wizardQaPickOption,
    WIZARD_STATE,
});
