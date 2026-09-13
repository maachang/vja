/* ═══════════════════════════════════════════════════════════════
   vja-wizard.js — プロジェクト新規作成ウィザード
   ─────────────────────────────────────────────────────────────
   【読み込み順序】10番目（vja-app-config.js の直後、vja-ui.js の前）。
   【依存】vja-defs.js, vja-modal.js, vja-save.js, vja-table-validation.js,
           vja-app-config.js, vja-yaml-editor.js
   【提供するもの】
     - actWizard()（ファイルメニューからの起動導線）
     - 前提チェック（新規プロジェクト作成確認 → AI接続設定確認 → プロジェクト設定確認）
       に続けて、以下6ステップのウィザード本体（WIZARD_STEPS / WIZARD_STATE.step、
       1始まり）を進める。ステップ番号は各ステップ名と1:1で対応させること
       （後から間に挿入した場合、以降の番号を全て振り直す必要がある）。
       1. 画面サイズ（大中小）選択
       2. アプリ概要（自由記述。AIには聞かせず、ユーザーがそのまま記入するだけ）
       3. システムモデル選択（8パターンからユーザーが直接1つ選ぶ。もしくはスキップ）
       4. テーブル管理（vjaに既存の「テーブル管理」モーダルをそのまま開き、
          ユーザー自身がテーブル・カラムを直接作成する）
       5. 画面構成（確定テーブルからコード側で機械的に画面数・テーブル割当を確定し、
          AIには各画面の日本語文言だけを埋めさせる。確認モーダル表示）
       6. 生成（フォーム雛形作成→画面ごとにYAMLドラフト→レイアウト一括生成）
   【AIメモ】
     - AI接続設定/プロジェクト設定モーダルは、保存完了時にWIZARD_STATEの
       該当コールバックを呼んでウィザードへ処理を戻す（aiCfgConfirm/
       saveProjectInfo側にフックを追加済み）。キャンセル時は該当コールバックを
       破棄する（aiCfgCancel/piCancel）。ウィザード経由でない通常のAI設定/
       プロジェクト設定の保存では、これらのコールバックは常にnullなので
       何も起きない。
     - 2026-09-13: 各ステップの見出しコメントに「ウィザード①」「ウィザード②」の
       ような丸数字の通し番号を振っていたが、機能追加のたびに番号が振り直されずに
       増改築された結果、②③④⑤等が複数箇所で衝突し矛盾していた。WIZARD_STATE.step
       という実体のある番号と紛らわしいため、丸数字の通し番号は全廃し、ステップ名を
       直接書く形に統一した。
     - 2026-09-13（続報3）: 当初の「Q&A（AIが1問ずつ動的に質問を生成）→テーブル候補
       抽出（AI）→カラム確認（AI生成）」という3ステップを丸ごと廃止し、「アプリ概要
       （自由記述）→システムモデル選択→テーブル管理（既存UIをそのまま使う）」に
       置き換えた。理由: 動的Q&Aは「4段階完了後は新しい話題を発明するな」
       「業務ロジック・処理手順は聞くな」という禁止文言をプロンプトに明記していても、
       実際には話題を使い切ったAIが業務ロジックの質問（例:「締め処理にはどのような
       手順が含まれていますか？」）を発明してしまう事例が実機で確認された。また
       「商品マスターの登録もしたいが、その内容が動的Q&Aの流れに出てこない」という
       抜け漏れも起きた。テーブル・カラムの作成はvjaに既にある「テーブル管理」
       モーダル（カラムの「✨ AI生成」ボタンも既存のまま使える）を直接使わせる方が、
       AIに新規の仕組みを作らせるより確実という判断（詳細はCLAUDE.md「ウィザードの
       既知バグ修正」節の続報3参照）。
   このファイルは vja-defs.js / vja-modal.js / vja-save.js /
   vja-table-validation.js / vja-app-config.js / vja-yaml-editor.js に依存する。
═══════════════════════════════════════════════════════════════ */

// ウィザードの前提チェック（AI接続設定・プロジェクト設定）から、保存完了後に
// ウィザードの次ステップへ処理を戻すためのコールバックを保持する一時状態。
// ウィザード経由でない通常の保存では常にnullのままなので影響しない。
const WIZARD_STATE = {
    resumeAfterAiConfig: null,
    resumeAfterProjectInfo: null,
    resumeAfterTableEdit: null, // 2026-09-13時点で設定箇所は無い（テーブル管理ステップが既存UIをそのまま使うため不要になった）。将来ウィザード内から個別テーブル編集への遷移を作る場合のために残置。
    _resumeDiscardCb: null, // wizardOfferResume()で「破棄する」を選んだ後に続けたい処理（省略可）
    appOverview: "", // アプリ概要ステップで記入された自由記述テキスト
    formPlan: [], // [{ formName, formTitle, description, docDraft }]
    step: 1, // 現在のステップ番号（ステップインジケーター表示用）
    formSize: null, // { key: 'small'|'medium'|'large', label, w, h } 画面サイズ選択ステップの結果
    systemModelHint: null, // ユーザーがシステムモデル選択ステップで選んだ骨格（src/wizard-system-models/の
                           // <id>.md本文）。2026-09-13からAI自動選択ではなくユーザー自身の選択に変更済み。
                           // 「わからない/スキップ」を選んだ場合はnullのままとし、以降のプロンプトへの
                           // 差し込みも省略する。
    _systemModelItems: [], // システムモデル選択ステップで表示する一覧（[{ id, summary }]）。再開時は都度取得し直す。
    _systemModelExpandedId: null, // システムモデル選択ステップで詳細を展開中の項目id（1件のみ・アコーディオン方式）
    _inTableStep: false, // テーブル管理ステップ表示中フラグ。trueの間、renderTableManagerModal()に
                         // ウィザード用の「← 戻る/次へ →」ボタンを追加表示させる（vja-table-validation.js参照）。
};

// ステップインジケーターに表示するステップ一覧。
const WIZARD_STEPS = [
    "画面サイズ",
    "アプリ概要",
    "システムモデル",
    "テーブル管理",
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
        appOverview: WIZARD_STATE.appOverview,
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
    WIZARD_STATE.appOverview = wp.appOverview || "";
    WIZARD_STATE.formPlan = wp.formPlan || [];
    WIZARD_STATE.formSize = wp.formSize || null;
    WIZARD_STATE.systemModelHint = wp.systemModelHint || null;
    WIZARD_STATE.step = wp.step || 1;
    WIZARD_STATE._inTableStep = false;
    switch (WIZARD_STATE.step) {
        case 2: _wizardRenderOverviewModal(); break;
        case 3: wizardShowSystemModelStep(); break;
        case 4: WIZARD_STATE._inTableStep = true; renderTableManagerModal(); break;
        case 5: _wizardRenderFormReviewModal(); break;
        default: _wizardRenderFormSizeModal(); break;
    }
}

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

// 前提チェック1/3: 新規プロジェクトを作成し、AI接続設定の確認へ進む
function wizardStartNewProject() {
    doActNew();
    wizardCheckAiConfig();
}

// 前提チェック2/3: AI接続設定が有効でなければ設定を促し、保存完了後にプロジェクト情報確認へ進む
function wizardCheckAiConfig() {
    if (!getProjectData().aiConfig.enabled) {
        showToast("ウィザードを開始するには、まずAI接続設定を行ってください");
        WIZARD_STATE.resumeAfterAiConfig = wizardCheckProjectInfo;
        openAiConfig();
        return;
    }
    wizardCheckProjectInfo();
}

// 前提チェック3/3: プロジェクト情報（名前）が未入力なら入力を促し、保存完了後にウィザード本体（ステップ1: 画面サイズ選択）へ進む
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
  画面サイズ（大中小）選択（ウィザード本体 ステップ1）
═══════════════════════════════════════════ */

// ステップ1開始。VJA本体（ディスプレイ作業領域）の
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

// 「次へ」: 画面サイズを確定し、アプリ概要ステップへ進む
function wizardConfirmFormSize() {
    if (!WIZARD_STATE.formSize) {
        // 未選択のまま「次へ」を押した場合は既定（小）を採用する
        const options = _wizardCalcFormSizeOptions();
        WIZARD_STATE.formSize = options.find((o) => o.key === "small") || options[0];
    }
    wizardStartOverviewStep();
}

/* ═══════════════════════════════════════════
  アプリ概要（ウィザード本体 ステップ2）
═══════════════════════════════════════════ */

// ステップ2開始。自由記述のアプリ概要を記入してもらう（AIは使わない）。
function wizardStartOverviewStep() {
    WIZARD_STATE.step = 2;
    _wizardRenderOverviewModal();
}

// アプリ概要入力モーダルを表示する
function _wizardRenderOverviewModal() {
    _wizardSaveProgress();
    showModal(
        mhdrHTML("🧙 ウィザード（アプリ概要）") +
        render("wz-tpl-overview-body", {
            stepIndicator: _wizardRenderStepIndicator(),
            overview: WIZARD_STATE.appOverview || "",
            attrCancel: evtAttr("onmousedown", "closeModal()"),
            attrBack: evtAttr("onmousedown", "wizardBackToFormSizeFromOverview()"),
            attrNext: evtAttr("onmousedown", "wizardConfirmOverview()"),
        })
    );
    setTimeout(() => $("wiz-overview-text")?.focus(), 0);
}

// 「← 戻る」（画面サイズ選択ステップへ）: アプリ概要から戻る際に使う
function wizardBackToFormSizeFromOverview() {
    const ta = $("wiz-overview-text");
    if (ta) WIZARD_STATE.appOverview = ta.value;
    closeModal();
    WIZARD_STATE.step = 1;
    _wizardRenderFormSizeModal();
}

// 「次へ」: アプリ概要を確定し、システムモデル選択ステップへ進む
function wizardConfirmOverview() {
    const ta = $("wiz-overview-text");
    const value = (ta ? ta.value : WIZARD_STATE.appOverview || "").trim();
    if (!value) { showVjaAlert("アプリの概要ややりたいことを入力してください"); return; }
    WIZARD_STATE.appOverview = value;
    wizardShowSystemModelStep();
}

/* ═══════════════════════════════════════════
  システムモデル骨格の選択（ウィザード本体 ステップ3）
═══════════════════════════════════════════ */

// 2026-09-13: 以前はQ&A履歴からAIに番号で自動選択させていたが（見えない処理・
// 専用ステップ無し）、温度0の弱いローカルLLMが「向いていないケース」に明記された
// 除外条件を無視し、表面的なキーワード一致だけで誤った骨格を選ぶ実例が確認された
// （例: 「1件ごとの伝票としての完結性」が本質のケースで、「数量」「履歴」という
// 語の表面一致だけで「在庫・数量推移管理系」を誤選択）。ユーザー自身は自分の
// 作りたいアプリの性質を把握しているため、AIに推測させずここで直接選ばせる。

// システムモデル選択ステップ開始。要約一覧を取得しモーダルを表示する。
// 一覧取得に失敗した場合は、選択の余地が無いためヒント無しのまま次へ進む
// （他のウィザードAIステップと同様「フォールバック無し」の方針を踏襲）。
async function wizardShowSystemModelStep() {
    WIZARD_STATE.step = 3;
    const listRes = await window.vja.wizard.getSystemModelSummaries();
    WIZARD_STATE._systemModelItems = (listRes && listRes.ok) ? (listRes.items || []) : [];
    if (WIZARD_STATE._systemModelItems.length === 0) {
        WIZARD_STATE.systemModelHint = null;
        wizardShowTablesStep();
        return;
    }
    _wizardRenderSystemModelModal();
}

// summary.mdの本文から「## 名称」「## 想定システムタイプ例」の直後の段落だけを
// 抜き出す（一覧表示用の短い見出し・例。抽出に失敗した場合はid・空文字のまま表示）。
function _wizardParseSystemModelSummary(md) {
    const section = (heading) => {
        const m = String(md || "").match(new RegExp("## " + heading + "\\s*\\n([\\s\\S]*?)(?:\\n## |$)"));
        return m ? m[1].trim() : "";
    };
    return {
        title: section("名称"),
        example: section("想定システムタイプ例"),
        good: section("向いているケース"),
    };
}

// システムモデル選択モーダルを表示する（フラットな一覧から1つを選ぶ、または「わからない/スキップ」）
// 一覧は「大項目（名称+想定システムタイプ例）」のみを表示し、「向いているケース」（詳細）は
// アコーディオン方式（同時に1件のみ展開。他を開くと自動的に閉じる）で必要な時だけ表示する。
// これは8件全部を常時全文表示すると文字が重なり見づらくなる問題への対策（2026-09-13指摘）。
function _wizardRenderSystemModelModal() {
    _wizardSaveProgress();
    const items = WIZARD_STATE._systemModelItems || [];
    const expandedId = WIZARD_STATE._systemModelExpandedId;
    const itemsHtml = items.map((it) => {
        const { title, example, good } = _wizardParseSystemModelSummary(it.summary);
        const expanded = it.id === expandedId;
        return render("wz-tpl-sysmodel-item", {
            title: title || it.id,
            example: example || "",
            good: good ? good.replace(/^-\s*/gm, "").replace(/\n/g, "、") : "",
            expanded,
            toggleLabel: expanded ? "▲ 閉じる" : "▼ 詳細",
            attrSelect: evtAttr("onmousedown", "wizardPickSystemModel('" + it.id + "')"),
            attrToggle: evtAttr("onmousedown", "wizardToggleSystemModelDetail('" + it.id + "',event)"),
        });
    }).join("");

    showModal(
        mhdrHTML("🧙 ウィザード（システムモデル）") +
        render("wz-tpl-sysmodel-body", {
            stepIndicator: _wizardRenderStepIndicator(),
            itemsHtml,
            attrCancel: evtAttr("onmousedown", "closeModal()"),
            attrBack: evtAttr("onmousedown", "wizardGoBackToOverview()"),
            attrSkip: evtAttr("onmousedown", "wizardSkipSystemModel()"),
        })
    );
}

// 「向いているケース」詳細の開閉トグル（アコーディオン方式・同時に1件のみ展開）。
// 選択確定（wizardPickSystemModel）とは別操作のため、行全体のクリックへ伝播しないようstopPropagationする。
function wizardToggleSystemModelDetail(id, event) {
    if (event) event.stopPropagation();
    WIZARD_STATE._systemModelExpandedId = (WIZARD_STATE._systemModelExpandedId === id) ? null : id;
    _wizardRenderSystemModelModal();
}

// 「← 戻る」（アプリ概要ステップへ）: システムモデル選択から戻る際に使う
function wizardGoBackToOverview() {
    closeModal();
    WIZARD_STATE.step = 2;
    _wizardRenderOverviewModal();
}

// パターンを1つ選択: 詳細mdを取得してsystemModelHintへ保持し、テーブル管理ステップへ進む
async function wizardPickSystemModel(id) {
    closeModal();
    WIZARD_STATE.systemModelHint = null;
    WIZARD_STATE._systemModelExpandedId = null;
    const detailRes = await window.vja.wizard.getSystemModelDetail(id);
    if (detailRes && detailRes.ok) WIZARD_STATE.systemModelHint = detailRes.detail;
    wizardShowTablesStep();
}

// 「わからない/どれにも当てはまらない」: ヒント無しのまま次へ進む
function wizardSkipSystemModel() {
    closeModal();
    WIZARD_STATE.systemModelHint = null;
    WIZARD_STATE._systemModelExpandedId = null;
    wizardShowTablesStep();
}

/* ═══════════════════════════════════════════
  テーブル管理（ウィザード本体 ステップ4）
═══════════════════════════════════════════ */

// 2026-09-13（続報3）: 以前はAIにQ&A履歴からテーブル候補を提案させ、カラム構成も
// AIに一括生成させていたが、実際にはユーザーが作りたいデータ（例:「商品マスター」）が
// 動的Q&Aの流れに出てこないまま先に進んでしまう抜け漏れが起きた。vjaには既に
// 「テーブル管理」モーダル（カラムの「✨ AI生成」ボタンも既存のまま使える）がある
// ため、ウィザードから直接それを開き、ユーザー自身にテーブルを作ってもらう方式に
// 変更した。renderTableManagerModal()側（vja-table-validation.js）が
// WIZARD_STATE._inTableStepを見て「← 戻る/次へ →」ボタンを追加表示する。

// テーブル管理ステップ開始
function wizardShowTablesStep() {
    WIZARD_STATE.step = 4;
    WIZARD_STATE._inTableStep = true;
    _wizardSaveProgress();
    renderTableManagerModal();
}

// 「← 戻る」（システムモデル選択ステップへ）: テーブル管理から戻る際に使う
function wizardGoBackToSystemModelFromTables() {
    closeModal();
    WIZARD_STATE._inTableStep = false;
    WIZARD_STATE.step = 3;
    _wizardRenderSystemModelModal();
}

// 「次へ」: テーブルが1件も無ければ確認の上、画面構成ステップへ進む
async function wizardProceedFromTables() {
    const tables = getProjectData().tables || [];
    if (tables.length === 0) {
        const ok = await vja.app.showConfirm("テーブルが1つも登録されていません。テーブル無しのまま次へ進みますか？");
        if (!ok) return;
    }
    closeModal();
    WIZARD_STATE._inTableStep = false;
    WIZARD_STATE.step = 5;
    await wizardDecomposeForms();
}

/* ═══════════════════════════════════════════
  画面構成（ウィザード本体 ステップ5）
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

// テーブル名（snake_case等）をPascalCase識別子へ変換する（英数字・アンダースコア・
// ハイフン・空白区切りを単語境界とみなす）
function _wizardTableNameToPascal(name) {
    return String(name || "")
        .split(/[_\-\s]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join("") || "Table";
}

// 確定済みテーブル一覧から「1テーブル=一覧画面+入力画面」の画面スロットを機械的に
// 確定する（AIには渡さず、コード側で確定する。理由はprompt-def.jsのAIメモ参照）。
function _wizardBuildScreenSkeleton(tables) {
    const skeleton = [];
    (tables || []).forEach((t) => {
        const pascal = _wizardTableNameToPascal(t.name);
        skeleton.push({ formName: pascal + "ListForm", table: t.name, kind: "list" });
        skeleton.push({ formName: pascal + "Form", table: t.name, kind: "input" });
    });
    return skeleton;
}

// 画面スロット一覧をプロンプト差し込み用のテキストに整形する
function _wizardBuildScreenSkeletonText(skeleton) {
    return skeleton.map((s, i) => (i + 1) + '. formName="' + s.formName + '" — ' +
        (s.kind === "list" ? "list screen" : "input (create+edit) screen") +
        ' for table "' + s.table + '"'
    ).join("\n");
}

// アプリ概要＋確定済みテーブル（カラム込み）からAIにフォーム一覧を分解させ、確認モーダルを表示する。
// 2026-09-13設計変更: 画面数・どのテーブルを使うかという構造判断はAIに委ねず、
// _wizardBuildScreenSkeleton()でコード側が機械的に確定する。AIの仕事は各スロットの
// 日本語文言（formTitle/description/docDraft）を埋めることだけに縮小した
// （詳細はENG_WIZARD_DECOMPOSE_FORMS_SYS_PROMPTのAIメモ参照）。
async function wizardDecomposeForms() {
    const tables = getProjectData().tables || [];
    const tablesCtx = buildTablesCtxText(tables);
    const skeleton = _wizardBuildScreenSkeleton(tables);
    const screenSkeletonText = skeleton.length > 0
        ? _wizardBuildScreenSkeletonText(skeleton)
        : "(確定済みテーブルが無いため、固定スロットはありません。[Application Overview]から必要な画面のみを判断してください)";
    const sysPrompt = _PROMPT_DEF.WIZARD_DECOMPOSE_FORMS_SYS_PROMPT({ tablesCtx, screenSkeletonText, systemModelHint: WIZARD_STATE.systemModelHint });
    const userPrompt = _PROMPT_DEF.WIZARD_DECOMPOSE_FORMS_USER_PROMPT(WIZARD_STATE.appOverview);

    let forms = null;
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        loadingMsg: "画面構成を検討しています…",
        onSuccess: async (raw) => { forms = _wizardParseJsonArray(raw); },
        onCancel: async () => { },
        onError: async () => { },
    });

    // 機械的検証: 確定済みスロットのformNameが全て結果に含まれているかを確認する。
    // AIの言い換え作業で欠落・改変された場合は失敗として扱い、やり直しを促す
    // （プロンプト文言だけに頼らず、コード側で強制する）。
    const returnedNames = new Set((forms || []).map((f) => f.formName));
    const missing = skeleton.filter((s) => !returnedNames.has(s.formName));
    if (!forms || forms.length === 0 || missing.length > 0) {
        showToast(missing.length > 0
            ? "画面構成の生成結果に確定テーブルの画面（" + missing.map((s) => s.formName).join("、") + "）が含まれていません。もう一度お試しください"
            : "画面構成の生成に失敗しました。もう一度お試しください");
        // テーブル管理ステップへ戻す（ステップインジケーターも合わせて戻す）
        WIZARD_STATE.step = 4;
        WIZARD_STATE._inTableStep = true;
        renderTableManagerModal();
        return;
    }
    WIZARD_STATE.formPlan = forms;
    _wizardRenderFormReviewModal();
}

// 「← 戻る」（テーブル管理ステップへ）: 画面構成確認から戻る際に使う
function wizardGoBackToTablesFromFormReview() {
    closeModal();
    WIZARD_STATE.step = 4;
    WIZARD_STATE._inTableStep = true;
    renderTableManagerModal();
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
            attrBack: evtAttr("onmousedown", "wizardGoBackToTablesFromFormReview()"),
            attrGenerate: evtAttr("onmousedown", "wizardConfirmAndGenerate()"),
        })
    );
}

/* ═══════════════════════════════════════════
  一括生成（ウィザード本体 ステップ6）
═══════════════════════════════════════════ */

// 「生成開始」: フォームを作成して画面デザイン一括生成を開始する
// （テーブルはステップ4で既に確定済みのため、ここでは何もしない）
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
        getProjectData().formLayoutPattern = f.formLayoutPattern || ""; // 同上（レイアウトタブの選択状態も同じ同期が必要）
        showToast("フォーム" + (i + 1) + "/" + total + ": " + f.cfg.title + " を生成中…");
        const genResult = await _wizardGenerateFormYaml(f.formDesignDocDraft);
        if (!genResult) continue; // 失敗した場合はこのフォームは空のまま次へ進む
        const { yaml, layoutPatternId } = genResult;
        f.formDesignDraft = yaml;
        f.formLayoutPattern = layoutPatternId;
        getProjectData().formDesignDraft = yaml; // 同期を保つ（次のswitchForm()呼び出しで消されないように）
        getProjectData().formLayoutPattern = layoutPatternId;
        const ok = await _wizardGenerateFormLayout(yaml);
        if (ok) successCount++;
    }

    // ウィザード完了。「続きから再開」用の進行状況は不要になったため削除するが、
    // アプリ概要・画面構成計画は、後から「なぜこの画面構成になったか」を
    // 調査できるよう完了記録として別途残す（2026-09-12実装）。
    getProjectData().wizardProgress = null;
    getProjectData().wizardHistory = {
        completedAt: new Date().toISOString(),
        appOverview: WIZARD_STATE.appOverview,
        formPlan: WIZARD_STATE.formPlan,
        formSize: WIZARD_STATE.formSize,
        systemModelHint: WIZARD_STATE.systemModelHint,
    };

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
        getProjectData().formLayoutPattern = curForm.formLayoutPattern || "";
    }

    refreshAll();
    pushUndo();
    showToast("ウィザード完了: " + successCount + "/" + total + "件のフォームを生成しました");
    showVjaAlert("画面生成が終わりました。テーブル・画面の内容は、メニューの「テーブル管理」やデザイナー上でいつでも調整できます。");
}

// 1フォーム分の「画面デザインYAMLドラフト → YAML」生成（DOM非依存版）。
// 戻り値は { yaml, layoutPatternId }。
// 2026-09-13追加: "layout_pattern: <番号>" 行の抽出処理が漏れていたため追加した
// （既存UI手動操作版のformDesignTextToYamlGenerate()、vja-yaml-editor.js参照。
//  同じロジックをここにも実装しないと、AIが生成したlayout_pattern値がどこにも
//  保存されず、「🖼 レイアウト」タブが常に「なし」のままになる不具合になる）。
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
            const stripped1 = convertFormDesignEngKeysToJp(stripped0);

            const layoutNumMatch = stripped1.match(/^\s*layout_pattern\s*:\s*"?(\d+)"?\s*$/m);
            const layoutNum = layoutNumMatch ? parseInt(layoutNumMatch[1], 10) : 0;
            const layoutPatternList = getFormLayoutPatterns();
            const matchedPattern = layoutNum >= 1 && layoutNum <= layoutPatternList.length ? layoutPatternList[layoutNum - 1] : null;
            const yaml = stripped1.replace(/^\s*layout_pattern\s*:.*\n?/m, "").trim();
            result = { yaml, layoutPatternId: matchedPattern ? matchedPattern.id : "" };
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
    actWizard, wizardStartNewProject, wizardCheckAiConfig, wizardCheckProjectInfo,
    wizardCheckFormSize, wizardPickFormSize, wizardConfirmFormSize,
    wizardStartOverviewStep, wizardBackToFormSizeFromOverview, wizardConfirmOverview,
    wizardGoBackToOverview, wizardPickSystemModel, wizardSkipSystemModel, wizardToggleSystemModelDetail,
    wizardShowTablesStep, wizardGoBackToSystemModelFromTables, wizardProceedFromTables,
    wizardGoBackToTablesFromFormReview, wizardDecomposeForms, wizardConfirmAndGenerate,
    wizardOfferResume, wizardDiscardProgress, wizardResumeFromProgress,
    WIZARD_STATE,
});
