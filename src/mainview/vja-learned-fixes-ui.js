/* ═══════════════════════════════════════════════════════════════
   vja-learned-fixes-ui.js — 学習ノウハウ（AIプロンプト記憶）管理モーダル
   ─────────────────────────────────────────────────────────────
   【読み込み順序】vja-yaml-editor.js より後（依存関数はいずれも
   実行時にしか呼ばれないため、スクリプトの読み込み順序そのものは
   厳密である必要はない）。
   【依存】vja-defs.js（getProjectData/getEditorContext等）、
   vja-modal.js（showModal/closeModal/pushUndo）、vja-html.js（render/evtAttr）
   【提供するもの】
     - openLearnedFixesModal() / renderLearnedFixesModal()
     - togglePinLearnedFixItem() / deleteLearnedFixItem() / addManualLearnedFix()
   学習履歴データ自体の読み書き（_getLearnedFixes/_recordLearnedFix等）や、
   YAML右パネルからのピン留め操作（yamlPinLearnedFix/yamlDeleteLearnedFix）は
   AI生成フロー本体と密結合しているためvja-yaml-editor.js側に残している。
   ここにあるのは「学習ノウハウ管理」モーダルの表示・操作のみ。
   2026-09-21、肥大化したvja-yaml-editor.js（当時4915行）から分割した
   2つ目のファイル（1つ目はvja-editor-search.js）。
═══════════════════════════════════════════════════════════════ */

function openLearnedFixesModal() {
    renderLearnedFixesModal();
}

function renderLearnedFixesModal() {
    const allFixes = getProjectData().learnedFixes || {};
    let rowsHtml = "";
    let count = 0;

    for (const [key, list] of Object.entries(allFixes)) {
        if (!Array.isArray(list) || list.length === 0) continue;
        let label = key;
        if (key === "global") { label = "【共通ルール】"; }
        else if (key.startsWith("tag_")) { label = `【${key.slice(4)} ウィジェット共通】`; }

        list.forEach(item => {
            count++;
            const isPinned = !!item.pinned;
            rowsHtml += render("ye-tpl-lf-row", {
                label, summary: item.mistakeSummary,
                pinBg: isPinned ? "var(--accent)" : "transparent",
                pinColor: isPinned ? "#fff" : "var(--text)",
                attrPin: evtAttr("onclick", "togglePinLearnedFixItem('" + key + "','" + item.id + "')"),
                pinLabel: isPinned ? "📌 固定済" : "📌 固定",
                attrDel: evtAttr("onclick", "deleteLearnedFixItem('" + key + "','" + item.id + "')"),
            });
        });
    }

    if (count === 0) {
        rowsHtml = render("ye-tpl-lf-empty", {});
    }

    const curScope = getEditorContext().lfSelectedScope || "global";
    const scopeOptions = [
        { value: "global", label: "プロジェクト共通ルール" },
        { value: "tag_datagrid", label: "datagrid 共通ルール" },
        { value: "tag_textbox", label: "textbox 共通ルール" },
        { value: "tag_button", label: "button 共通ルール" },
        { value: "tag_combobox", label: "combobox 共通ルール" },
        { value: "tag_checkbox", label: "checkbox 共通ルール" },
    ];
    const scopeSelHtml = makePvSel("lf-new-scope", scopeOptions, curScope, "getEditorContext().lfSelectedScope={value}");

    showModal(
        mhdrHTML("🧠 学習ノウハウ（AIプロンプト記憶）管理") +
        render("ye-tpl-lf-body", {
            scopeSelHtml,
            attrAdd: evtAttr("onclick", "addManualLearnedFix()"),
            rowsHtml,
        }) +
        mfootHTML([{ label: "閉じる", action: "closeModal()" }])
    );
}

function togglePinLearnedFixItem(key, id) {
    const allFixes = getProjectData().learnedFixes || {};
    const list = allFixes[key] || [];
    allFixes[key] = list.map(item => item.id === id ? { ...item, pinned: !item.pinned } : item);
    pushUndo();
    renderLearnedFixesModal();
}

function deleteLearnedFixItem(key, id) {
    const allFixes = getProjectData().learnedFixes || {};
    const list = allFixes[key] || [];
    allFixes[key] = list.filter(item => item.id !== id);
    pushUndo();
    renderLearnedFixesModal();
}

function addManualLearnedFix() {
    const scope = getEditorContext().lfSelectedScope || "global";
    const text = $("lf-new-text")?.value?.trim();
    if (!text) {
        showToast("ルール内容を入力してください");
        return;
    }
    const allFixes = getProjectData().learnedFixes || {};
    if (!allFixes[scope]) allFixes[scope] = [];
    allFixes[scope].push({
        id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        createdAt: Date.now(),
        mistakeSummary: text,
        pinned: true,
        recurCount: 0,
        scope: scope === "global" ? "global" : "tag",
    });
    getProjectData().learnedFixes = allFixes;
    pushUndo();
    showToast("プロジェクトルールを追加しました");
    renderLearnedFixesModal();
}

Object.assign(window, {
    openLearnedFixesModal, renderLearnedFixesModal, togglePinLearnedFixItem, deleteLearnedFixItem, addManualLearnedFix,
});
