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
const WIZARD_STATE = {
    resumeAfterAiConfig: null,
    resumeAfterProjectInfo: null,
};

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

// ④ ウィザード本体（Q&A・フォーム分解・一括生成）。次フェーズで実装予定。
function wizardStepBody() {
    showToast("ウィザード本体は次のフェーズで実装予定です");
}

Object.assign(window, {
    actWizard, wizardStartNewProject, wizardCheckAiConfig, wizardCheckProjectInfo, wizardStepBody,
    WIZARD_STATE,
});
