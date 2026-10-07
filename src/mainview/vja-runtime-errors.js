/* ═══════════════════════════════════════════════════════════════
   vja-runtime-errors.js — 実行時エラーの一覧（デザイナー側）
   ─────────────────────────────────────────────────────────────
   【読み込み順序】vja-mock-check.js の後、vja-ui.js より前。
   【依存】vja-defs.js（getProjectData/esc/showToast）、vja-modal.js（showModal等）、
   vja-yaml-editor.js（openYaml/yamlTabSwitch）、vja-save.js（switchForm）、
   bridge.ts（window.vjaAddRuntimeError／window.onRuntimeErrorReported呼び出し元）
   【提供するもの】
     - onRuntimeErrorReported(report) : bridge.tsから呼ばれる受信口（検証済みの報告）
     - clearRuntimeErrors() : 「実行」開始時に一覧を消す
     - openRuntimeErrors() / openRuntimeErrorEvent(i) : 一覧モーダルと、イベントへの移動
     - aiFixRuntimeError(i) : 「AIで修正」。vja-mock-check.js の manualRetryAiFix へ実行時エラーを渡す（フェーズ2）
     - getRuntimeErrors() : 現在の一覧（テスト用MCPからも使う）
   【AIメモ】
     - 一覧はメモリのみ（保存しない）。次の実行開始でクリアする。
     - 実行ウィンドウ→Bun→bridge.ts→ここ、の経路。報告の生成は src/bun/runtime-error-snippet.ts、
       検証・同一エラーの集約は src/mainview/bridge-common.ts（normalizeRuntimeError/addRuntimeError）。
     - 実際の入力値は報告に含めない（メッセージ・stack・コード抜粋のみ）。
   2026-10-07、実行時エラーをAIが修正対応できる形にする作業のフェーズ1として追加。
═══════════════════════════════════════════════════════════════ */

let _runtimeErrors = [];

function getRuntimeErrors() {
    return _runtimeErrors;
}

// ツールバーのバッジ表示を一覧の件数に合わせる（0件なら非表示）
function _updateRuntimeErrorBadge() {
    const btn = $("btn-runtime-errors");
    if (!btn) return;
    btn.style.display = _runtimeErrors.length ? "" : "none";
    btn.textContent = "⚠ 実行エラー(" + _runtimeErrors.length + ")";
}

// bridge.ts から呼ばれる。報告は検証・整形済み
function onRuntimeErrorReported(report) {
    _runtimeErrors = window.vjaAddRuntimeError(_runtimeErrors, report);
    _updateRuntimeErrorBadge();
}

function clearRuntimeErrors() {
    _runtimeErrors = [];
    _updateRuntimeErrorBadge();
}

function openRuntimeErrors() {
    let rowsHtml = "";
    _runtimeErrors.forEach((e, i) => {
        rowsHtml += render("re-tpl-row", {
            kindLabel: e.kind === "swallowed" ? "握りつぶし" : "例外",
            kindColor: e.kind === "swallowed" ? "#e0a030" : "#ff5f56",
            formName: e.formName, widgetName: e.widgetName, eventName: e.eventName,
            lineLabel: e.line != null ? e.line + "行目" : "",
            countLabel: e.count > 1 ? " ・" + e.count + "回" : "",
            message: e.message,
            excerpt: e.excerpt || "（コード抜粋なし）",
            attrOpen: evtAttr("onclick", "openRuntimeErrorEvent(" + i + ")"),
            attrFix: evtAttr("onclick", "aiFixRuntimeError(" + i + ")"),
        });
    });
    if (!rowsHtml) rowsHtml = render("re-tpl-empty", {});
    showModal(
        mhdrHTML("⚠ 実行時エラー") +
        render("re-tpl-body", { rowsHtml }) +
        mfootHTML([{ label: "一覧をクリア", action: "clearRuntimeErrors();closeModal()" }, { label: "閉じる", action: "closeModal()" }])
    );
}

// 一覧の行から、該当フォーム・ウィジェットのイベントを開き、JavaScriptタブのエラー行へ移動する
function openRuntimeErrorEvent(i, thenAiFix) {
    const e = _runtimeErrors[i];
    if (!e) return;
    const forms = getProjectData().forms;
    let fi = forms.findIndex((f) => f.cfg?.name === e.formName && (f.widgets || []).some((w) => w.name === e.widgetName));
    if (fi < 0) fi = forms.findIndex((f) => (f.widgets || []).some((w) => w.name === e.widgetName));
    if (fi < 0) { showToast("該当するウィジェット「" + e.widgetName + "」が見つかりません", 4000); return; }
    const w = forms[fi].widgets.find((x) => x.name === e.widgetName);
    closeModal();
    switchForm(fi);
    openYaml(w.id, e.eventName);
    yamlTabSwitch("js");
    const ta = $("js-ta");
    if (ta && e.line != null) {
        const lines = ta.value.split("\n");
        const ln = Math.min(Math.max(e.line, 1), lines.length);
        const pos = lines.slice(0, ln - 1).reduce((n, l) => n + l.length + 1, 0);
        ta.focus();
        ta.setSelectionRange(pos, pos + lines[ln - 1].length);
        ta.scrollTop = Math.max(0, (ln - 3)) * parseFloat(getComputedStyle(ta).lineHeight || 18);
    }
    // 「AIで修正」: イベントを開いた状態で、実行時エラーを添えて既存のAI修正を実行する（結果はエディタ欄へ入るだけで、保存は利用者が行う）
    if (thenAiFix) manualRetryAiFix(w.id, e.eventName, false, false, e);
}

function aiFixRuntimeError(i) {
    openRuntimeErrorEvent(i, true);
}

Object.assign(window, {
    getRuntimeErrors, onRuntimeErrorReported, clearRuntimeErrors,
    openRuntimeErrors, openRuntimeErrorEvent, aiFixRuntimeError,
});
