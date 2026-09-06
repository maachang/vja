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
    _resumeDiscardCb: null, // wizardOfferResume()で「破棄する」を選んだ後に続けたい処理（省略可）
    qaHistory: [], // [{ question, answer, answerType, options }]
    qaIndex: 0,
    qaStatus: [], // [{ label, done }]
    formPlan: [], // [{ formName, formTitle, description, docDraft }]
    tableCandidates: [], // [{ name, description, selected }]
    step: 1, // 現在のステップ番号（ステップインジケーター表示用）
    formSize: null, // { key: 'small'|'medium'|'large', label, w, h } 画面サイズ選択ステップの結果
    systemModelHint: null, // AIがQ&A履歴から選んだシステムモデル（src/wizard-system-models/の<id>.md本文）。
                           // 見えない処理として決定するのみで専用ステップ・画面は持たない。
                           // 選択できなかった場合はnullのままとし、以降のプロンプトへの差し込みも省略する。
};

// ステップインジケーターに表示するステップ一覧。
const WIZARD_STEPS = [
    "画面サイズ",
    "Q&A",
    "テーブル候補",
    "カラム確認",
    "画面構成",
    "生成",
];

// 画面サイズ（大中小）の選択肢を、VJA本体のディスプレイ作業領域サイズに対する
// 比率で定義する（小=40%, 中=60%, 大=85%）。現状のフォーム既定サイズ（640x420）は
// おおむね「小」に相当するため、選択モーダル側でその旨を案内する。
const WIZARD_FORM_SIZE_RATIOS = [
    { key: "small", label: "小", ratio: 0.4 },
    { key: "medium", label: "中", ratio: 0.6 },
    { key: "large", label: "大", ratio: 0.85 },
];

// 現在ステップ（WIZARD_STATE.step）を元に、ステップインジケーターのHTMLを生成する。
// 完了済み=塗りつぶし、現在地=強調枠、未到達=薄色で表示する。
function _wizardRenderStepIndicator() {
    const cur = WIZARD_STATE.step;
    const items = WIZARD_STEPS.map((label, i) => {
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
            ? render("wz-tpl-step-sep", { color: done ? "var(--accent2, #2a6)" : "var(--border)" })
            : "";
        return render("wz-tpl-step-item", {
            circleStyle, circleText: done ? "✓" : n, labelStyle, label, sep,
        });
    }).join("");
    return render("wz-tpl-step-indicator", { items });
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
        formSize: WIZARD_STATE.formSize,
        systemModelHint: WIZARD_STATE.systemModelHint,
    };
}

// プロジェクトを開いた際、中断されたウィザードの進行状況が残っていれば
// 「続きから再開」を提案する（vja-save.jsのloadProjectData()から呼ばれる）。
// onDiscard: 「破棄する」を選んだ後に続けたい処理（省略時は何もせず通常のエディタ画面のまま終える）。
// 「ファイル→ウィザードでプロジェクト作成」から呼ばれた場合は、破棄後に新規作成フローへ
// 続けたいのでコールバックを渡す（wizardCheckAiConfig参照）。ファイルを開いた際の自動提案
// （loadProjectData経由）では省略し、破棄したら単に今の編集画面のままにする。
function wizardOfferResume(onDiscard) {
    const wp = getProjectData().wizardProgress;
    if (!wp || wp.done) return;
    WIZARD_STATE._resumeDiscardCb = onDiscard || null;
    showModal(
        mhdrHTML("🧙 ウィザードの再開") +
        render("wz-tpl-resume-body", {
            attrDiscard: evtAttr("onmousedown", "wizardDiscardProgress()"),
            attrResume: evtAttr("onmousedown", "wizardResumeFromProgress()"),
        })
    );
}

// 「破棄する」: 保存済みの進行状況を削除する。onDiscardコールバックがあれば続けて実行する
function wizardDiscardProgress() {
    getProjectData().wizardProgress = null;
    closeModal();
    const cb = WIZARD_STATE._resumeDiscardCb;
    WIZARD_STATE._resumeDiscardCb = null;
    if (cb) cb();
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
    WIZARD_STATE.formSize = wp.formSize || null;
    WIZARD_STATE.systemModelHint = wp.systemModelHint || null;
    WIZARD_STATE.step = wp.step || 1;
    switch (WIZARD_STATE.step) {
        case 2: _wizardRenderQaModal(); break;
        case 3: _wizardRenderTableCandidatesModal(); break;
        case 4: _wizardRenderColumnsReviewModal(); break;
        case 5: _wizardRenderFormReviewModal(); break;
        default: _wizardRenderFormSizeModal(); break;
    }
}

// 「← 戻る」（テーブル候補ステップへ）: カラム確認/画面構成から戻る際に使う
function wizardGoBackToTableCandidates() {
    closeModal();
    WIZARD_STATE.step = 3;
    _wizardRenderTableCandidatesModal();
}

// 「← 戻る」（カラム確認ステップへ）: 画面構成から戻る際に使う
function wizardGoBackToColumnsReview() {
    closeModal();
    WIZARD_STATE.step = 4;
    _wizardRenderColumnsReviewModal();
}

// この件数を超えたら「完了で進めることもできます」とトーストで軽く促す目安値
// （ブロックはしない。質問数が本当に必要なプロジェクトもあるため上限としては強制しない）
const WIZARD_QA_SUGGEST_COMPLETE_AT = 6

// ファイルメニュー「ウィザードでプロジェクト作成…」から呼ばれる起点。
function actWizard() {
    // 現在開いているプロジェクトに、完了前に中断されたウィザードの進行状況が
    // 残っている場合は、新規作成ではなく「続きから再開」を提案する
    const wp = getProjectData().wizardProgress;
    if (wp && !wp.done) {
        wizardOfferResume(_wizardConfirmStartNew);
        return;
    }
    _wizardConfirmStartNew();
}

// isDirtyな場合は確認の上で、新規プロジェクト作成→ウィザード開始を行う
function _wizardConfirmStartNew() {
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

// ③ プロジェクト情報（名前）が未入力なら入力を促し、保存完了後に④（画面サイズ選択）へ進む
function wizardCheckProjectInfo() {
    if (!getProjectData().projectInfo.name?.trim()) {
        showToast("続いて、プロジェクト情報（プロジェクト名）を入力してください");
        WIZARD_STATE.resumeAfterProjectInfo = wizardCheckFormSize;
        openProjectInfo();
        return;
    }
    wizardCheckFormSize();
}

/* ═══════════════════════════════════════════
  画面サイズ（大中小）選択（ウィザード④）
═══════════════════════════════════════════ */

// ④ 画面サイズ（大中小）選択ステップ開始。VJA本体（ディスプレイ作業領域）の
// サイズを取得し、大中小それぞれの実際のpx値を算出してモーダルを表示する。
async function wizardCheckFormSize() {
    WIZARD_STATE.step = 1;
    let base = { width: 1280, height: 800 };
    try {
        base = await vja.app.getDisplayWorkArea();
    } catch (e) { console.debug("[wizard] getDisplayWorkArea failed:", e); }
    WIZARD_STATE._formSizeBase = base;
    _wizardRenderFormSizeModal();
}

// 画面サイズ（大中小）の選択肢を、基準サイズ（VJA本体の作業領域サイズ）に
// 比率を掛けて算出する。現状のフォーム既定サイズ（640x420）を下回らないよう
// 下限でクランプする（極端に小さい画面になるのを防ぐための安全策）。
function _wizardCalcFormSizeOptions() {
    const base = WIZARD_STATE._formSizeBase || { width: 1280, height: 800 };
    return WIZARD_FORM_SIZE_RATIOS.map((r) => ({
        key: r.key,
        label: r.label,
        w: Math.max(640, Math.round(base.width * r.ratio)),
        h: Math.max(420, Math.round(base.height * r.ratio)),
    }));
}

// 画面サイズ選択モーダルを表示する
function _wizardRenderFormSizeModal() {
    _wizardSaveProgress();
    const options = _wizardCalcFormSizeOptions();
    const curKey = WIZARD_STATE.formSize?.key || "small";
    const optionsHtml = options.map((o) => render("wz-tpl-form-size-opt", {
        checked: o.key === curKey ? "checked" : "",
        attr: evtAttr("onchange", "wizardPickFormSize('" + o.key + "')"),
        label: o.label, w: o.w, h: o.h,
        note: o.key === "small" ? "（現状の初期フォームサイズ相当）" : "",
    })).join("");

    showModal(
        mhdrHTML("🧙 ウィザード（画面サイズ）") +
        render("wz-tpl-form-size-body", {
            stepIndicator: _wizardRenderStepIndicator(),
            optionsHtml,
            attrCancel: evtAttr("onmousedown", "closeModal()"),
            attrNext: evtAttr("onmousedown", "wizardConfirmFormSize()"),
        })
    );
}

// 選択中のサイズを一時保持する（確定は「次へ」押下時）
function wizardPickFormSize(key) {
    const options = _wizardCalcFormSizeOptions();
    const found = options.find((o) => o.key === key);
    if (found) WIZARD_STATE.formSize = found;
}

// 「次へ」: 画面サイズを確定し、Q&Aステップへ進む
function wizardConfirmFormSize() {
    if (!WIZARD_STATE.formSize) {
        // 未選択のまま「次へ」を押した場合は既定（小）を採用する
        const options = _wizardCalcFormSizeOptions();
        WIZARD_STATE.formSize = options.find((o) => o.key === "small") || options[0];
    }
    wizardStepBody();
}

// ⑤ ウィザード本体開始。Q&Aの状態を初期化し、AIに最初の質問を生成させる。
function wizardStepBody() {
    WIZARD_STATE.qaHistory = [];
    WIZARD_STATE.qaIndex = 0;
    WIZARD_STATE.qaStatus = [];
    WIZARD_STATE.step = 2;
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
        ? render("wz-tpl-qa-status-wrap", {
            badges: WIZARD_STATE.qaStatus.map((s) => render("wz-tpl-qa-status-badge", {
                style: s.done ? "background:var(--accent2, #2a6);color:#fff" : "background:var(--bg2);color:var(--text3)",
                checkmark: s.done ? "✓ " : "",
                label: s.label,
            })).join(""),
        })
        : "";

    const hasOptions = Array.isArray(qa.options) && qa.options.length > 0;
    const isMulti = qa.answerType === "multi_choice";
    const optionsHtml = hasOptions
        ? render("wz-tpl-qa-options-wrap", {
            buttons: qa.options.map((opt, i) => render("wz-tpl-qa-option-btn", {
                attr: evtAttr("onmousedown", "wizardQaPickOption(" + i + ")"),
                no: i + 1, label: opt,
            })).join(""),
            hint: isMulti ? "複数選択可。ボタンで選ぶか、番号をカンマ区切りで入力してください（例: 1,3）" : "ボタンで選ぶか、番号を入力してください（例: 2）",
        })
        : "";

    showModal(
        mhdrHTML("🧙 ウィザード（" + (idx + 1) + "問目）") +
        render("wz-tpl-qa-body", {
            stepIndicator: _wizardRenderStepIndicator(),
            statusHtml,
            question: qa.question,
            optionsHtml,
            placeholder: hasOptions ? "番号または自由入力" : "自由に入力してください",
            answer: qa.answer || "",
            attrBack: evtAttr("onmousedown", "wizardQaBack()"),
            backDisabled: isFirst ? "disabled" : "",
            attrComplete: evtAttr("onmousedown", "wizardQaComplete()"),
            attrNext: evtAttr("onmousedown", "wizardQaNext()"),
        })
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
// 「番号＋追加の自由記述」（例: "３で、ここで補足説明"）の場合は、先頭の番号だけを
// ラベルに変換し、残りの自由記述と組み合わせる（番号部分が持つ意味をAIに失わせないため）。
// 番号がどこにも見つからない場合はそのまま自由記述として扱う。
function _wizardResolveAnswerText(qa, rawValue) {
    const value = (rawValue || "").trim();
    if (!Array.isArray(qa.options) || qa.options.length === 0 || !value) return value;
    // 日本語入力モードのまま数字で回答すると全角（０-９，，）になりやすいため、
    // 判定前に半角へ正規化する（全角数字０-９ → 半角0-9、全角カンマ， → 半角,）
    const normalized = value
        .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        .replace(/，/g, ",");
    const resolveTokens = (tokenStr) => {
        const tokens = tokenStr.split(/[、,]/).map((s) => s.trim()).filter(Boolean);
        if (tokens.length === 0 || !tokens.every((t) => /^\d+$/.test(t))) return null;
        const labels = tokens
            .map((t) => qa.options[parseInt(t, 10) - 1])
            .filter((label) => label !== undefined);
        return labels.length > 0 ? labels.join("、") : null;
    };

    // ケース1: 回答全体が番号（区切り可）だけの場合
    const wholeLabel = resolveTokens(normalized);
    if (wholeLabel) return wholeLabel;

    // ケース2: 先頭が番号（区切り可）で、その後に自由記述が続く場合
    const m = normalized.match(/^([\d,、]+)([^\d,、].*)$/s);
    if (m) {
        const headLabel = resolveTokens(m[1]);
        if (headLabel) {
            const rest = m[2].replace(/^(で、|で)/, "").trim();
            return rest ? headLabel + "。" + rest : headLabel;
        }
    }

    return value;
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
    wizardSelectSystemModel();
}

// Q&A履歴から、最も近い「システムモデル」骨格（src/wizard-system-models/）をAIに
// 番号で選ばせ、WIZARD_STATE.systemModelHintへ詳細md本文を保持する（見えない処理。
// 専用ステップ・画面は持たず、ステップインジケーターの番号も増やさない）。
// 一覧取得・AI呼び出しのいずれかに失敗した場合や、番号のパース失敗・範囲外の場合は、
// 他のウィザードAIステップと同様「フォールバックなし」でsystemModelHintをnullのまま
// 次のテーブル候補抽出へ進む。
async function wizardSelectSystemModel() {
    WIZARD_STATE.systemModelHint = null;

    const listRes = await window.vja.wizard.getSystemModelSummaries();
    const items = (listRes && listRes.ok) ? (listRes.items || []) : [];
    if (items.length === 0) {
        wizardExtractTableCandidates();
        return;
    }

    const modelListCtx = items.map((it, i) => (i + 1) + ". " + it.summary.trim()).join("\n\n");
    const historyCtx = _wizardBuildQaHistoryCtx();
    const sysPrompt = _PROMPT_DEF.WIZARD_SYSTEM_MODEL_SYS_PROMPT();
    const userPrompt = _PROMPT_DEF.WIZARD_SYSTEM_MODEL_USER_PROMPT(historyCtx, modelListCtx);

    let picked = null;
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        loadingMsg: "システム系統を検討しています…",
        onSuccess: async (raw) => {
            const m = String(raw || "").match(/\d+/);
            const num = m ? parseInt(m[0], 10) : NaN;
            if (num >= 1 && num <= items.length) picked = items[num - 1];
        },
        onCancel: async () => { },
        onError: async () => { },
    });

    if (picked) {
        const detailRes = await window.vja.wizard.getSystemModelDetail(picked.id);
        if (detailRes && detailRes.ok) WIZARD_STATE.systemModelHint = detailRes.detail;
    }

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
    const userPrompt = _PROMPT_DEF.WIZARD_TABLE_CANDIDATES_USER_PROMPT(historyCtx, WIZARD_STATE.systemModelHint);

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
    WIZARD_STATE.step = 3;
    _wizardRenderTableCandidatesModal();
}

// テーブル候補の選択モーダルを表示する
function _wizardRenderTableCandidatesModal() {
    _wizardSaveProgress();
    const tablesHtml = WIZARD_STATE.tableCandidates.length > 0
        ? WIZARD_STATE.tableCandidates.map((t, i) => render("wz-tpl-table-cand-item", {
            checked: t.selected ? "checked" : "",
            attr: evtAttr("onchange", "wizardToggleTableCandidate(" + i + ")"),
            name: t.name,
            description: t.description || "",
        })).join("")
        : "<div class='infobox' style='font-size:11px'>DBテーブルは不要と判断されました</div>";

    showModal(
        mhdrHTML("🧙 ウィザード（テーブル候補）") +
        render("wz-tpl-table-cand-body", {
            stepIndicator: _wizardRenderStepIndicator(),
            tablesHtml,
            attrCancel: evtAttr("onmousedown", "closeModal()"),
            attrBack: evtAttr("onmousedown", "wizardGoBackToQa()"),
            attrNext: evtAttr("onmousedown", "wizardProceedToColumnGen()"),
        })
    );
}

// 「← 戻る」（Q&Aステップへ）: テーブル候補から戻る際に使う
function wizardGoBackToQa() {
    closeModal();
    WIZARD_STATE.step = 2;
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
            WIZARD_STATE.step = 4;
            _wizardRenderColumnsReviewModal();
            return;
        }
    }

    _wizardCommitSelectedTables();
    WIZARD_STATE.step = 4;

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
                ? (t.columns || []).map((c) => render("wz-tpl-col-preview-tag", {
                    name: c.name,
                    pkMark: c.pk ? " 🔑" : "",
                    type: c.type,
                })).join("")
                : "<span style='font-size:11px;color:var(--text3)'>（カラム生成に失敗しました。編集ボタンから作成してください）</span>";
            return render("wz-tpl-col-review-row", {
                name: t.name,
                description: t.description || "",
                attrEdit: evtAttr("onmousedown", "wizardEditTableColumns(" + idx + ")"),
                colsPreview,
            });
        }).join("")
        : "<div class='infobox' style='font-size:11px'>テーブルはありません</div>";

    showModal(
        mhdrHTML("🧙 ウィザード（カラム確認）") +
        render("wz-tpl-col-review-body", {
            stepIndicator: _wizardRenderStepIndicator(),
            tablesHtml,
            attrCancel: evtAttr("onmousedown", "closeModal()"),
            attrBack: evtAttr("onmousedown", "wizardGoBackToTableCandidates()"),
            attrNext: evtAttr("onmousedown", "wizardProceedToFormDecompose()"),
        })
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
    WIZARD_STATE.step = 5;
    await wizardDecomposeForms();
}

// Q&A履歴＋確定済みテーブル（カラム込み）からAIにフォーム一覧を分解させ、確認モーダルを表示する。
// 選択済みの画面サイズ（formSize）も渡し、サイズが小さいほど1画面に項目を
// 詰め込みすぎないよう画面数の分割を意識させる。
async function wizardDecomposeForms() {
    const historyCtx = _wizardBuildQaHistoryCtx();
    const tablesCtx = buildTablesCtxText(getProjectData().tables || []);
    const size = WIZARD_STATE.formSize || { label: "小", w: 640, h: 420 };
    const sysPrompt = _PROMPT_DEF.WIZARD_DECOMPOSE_FORMS_SYS_PROMPT({ tablesCtx, formW: size.w, formH: size.h, formSizeLabel: size.label, systemModelHint: WIZARD_STATE.systemModelHint });
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
        .map((f) => render("wz-tpl-form-review-row", {
            title: f.formTitle,
            description: f.description || "",
        }))
        .join("");

    showModal(
        mhdrHTML("🧙 ウィザード（画面構成）") +
        render("wz-tpl-form-review-body", {
            stepIndicator: _wizardRenderStepIndicator(),
            formsHtml,
            attrCancel: evtAttr("onmousedown", "closeModal()"),
            attrBack: evtAttr("onmousedown", "wizardGoBackToColumnsReview()"),
            attrGenerate: evtAttr("onmousedown", "wizardConfirmAndGenerate()"),
        })
    );
}

/* ═══════════════════════════════════════════
  一括生成（ウィザード⑤）
═══════════════════════════════════════════ */

// 「生成開始」: フォームを作成して画面デザイン一括生成を開始する
// （テーブルは②③で既に確定済みのため、ここでは何もしない）
async function wizardConfirmAndGenerate() {
    closeModal();
    WIZARD_STATE.step = 6;

    const size = WIZARD_STATE.formSize;
    getProjectData().forms = WIZARD_STATE.formPlan.map((f) => {
        const nf = makeFormData(f.formName || "Form1");
        nf.cfg.title = f.formTitle || nf.cfg.title;
        nf.cfg.description = f.description || "";
        nf.formDesignDocDraft = f.docDraft || "";
        if (size) { nf.cfg.w = size.w; nf.cfg.h = size.h; } // 選択済みの画面サイズ（大中小）を反映
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
        // switchForm()は内部でcommitFormDesignDraft()を呼び、プロジェクト直下の一時変数
        // (formDesignDraft/formDesignDocDraft、YAMLエディタと連動する値)を「切替前の
        // フォーム」へ上書きする仕様。ウィザードではYAMLエディタを開いていないため
        // 一時変数は空のままで、そのまま進めると次のswitchForm()呼び出し時に
        // このフォームのYAML定義が空文字で消されてしまう。一時変数を現在のフォームの
        // 値と同期させておくことで、この上書きを無害化する。
        getProjectData().formDesignDraft = f.formDesignDraft || "";
        getProjectData().formDesignDocDraft = f.formDesignDocDraft || "";
        showToast("フォーム" + (i + 1) + "/" + total + ": " + f.cfg.title + " を生成中…");
        const yaml = await _wizardGenerateFormYaml(f.formDesignDocDraft);
        if (!yaml) continue; // 失敗した場合はこのフォームは空のまま次へ進む
        f.formDesignDraft = yaml;
        getProjectData().formDesignDraft = yaml; // 同期を保つ（次のswitchForm()呼び出しで消されないように）
        const ok = await _wizardGenerateFormLayout(yaml);
        if (ok) successCount++;
    }

    getProjectData().wizardProgress = null; // ウィザード完了。再開用の進行状況は不要になったため削除

    // pushUndo()内のcommitFormDesignDraft()は、プロジェクト直下の一時変数
    // getProjectData().formDesignDraft（YAMLエディタと連動する値）を現在の
    // フォームへ上書きする処理。ウィザードではYAMLエディタを開いていないため
    // 一時変数は空のままで、そのまま呼ぶと直前にセットした最後のフォームの
    // formDesignDraftが空文字で消されてしまう。上書きが無害になるよう、
    // 一時変数側を現在のフォームの値と同期させてから呼ぶ。
    const curForm = getProjectData().forms[getProjectData().curFormIdx];
    if (curForm) {
        getProjectData().formDesignDraft = curForm.formDesignDraft || "";
        getProjectData().formDesignDocDraft = curForm.formDesignDocDraft || "";
    }

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
    wizardCheckFormSize, wizardPickFormSize, wizardConfirmFormSize,
    wizardQaBack, wizardQaNext, wizardQaComplete, wizardQaPickOption,
    wizardExtractTableCandidates, wizardToggleTableCandidate, wizardProceedToColumnGen,
    wizardEditTableColumns, wizardProceedToFormDecompose, wizardDecomposeForms, wizardConfirmAndGenerate,
    wizardOfferResume, wizardDiscardProgress, wizardResumeFromProgress,
    wizardGoBackToQa, wizardGoBackToTableCandidates, wizardGoBackToColumnsReview,
    WIZARD_STATE,
});
