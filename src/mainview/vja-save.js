/* ═══════════════════════════════════════════════════════════════
   vja-save.js — プロジェクトの新規作成・保存・開く・実行・マルチフォーム管理
   ─────────────────────────────────────────────────────────────
   【読み込み順序】6番目（vja-editor-utils.js の直後）。
   【依存】vja-defs.js, vja-designer.js, vja-modal.js
   【提供するもの】
     - actNew() / actSave() / actSaveAs() / actOpen()（ファイル操作）
     - actRunProject() / actStopProject() / actCompileProject()
     - isDirty() / loadProjectData() / applyProjectData()
     - フォームの追加・切替・削除・名前変更（マルチフォーム管理）
   このファイルは vja-defs.js / vja-designer.js / vja-modal.js に依存する。
═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════
  SAVE / OPEN / EXPORT
═══════════════════════════════════════════ */
function actNew() {
    if (isDirty()) {
        showCloseConfirm(
            "未保存の変更があります。",
            "新規プロジェクトを作成すると現在の内容は失われます。続けますか？",
            "新規作成",
            _doActNew
        );
    } else {
        _doActNew();
    }
}
function _doActNew() {
    getProjectData().forms = [makeFormData("Form1")];
    getProjectData().curFormIdx = 0;
    getDesignerState().selIds = [];
    getEditHistory().undoStack = [];
    getEditHistory().redoStack = [];
    getEditHistory().lastSavePath = null;
    getEditHistory().lastOpenPath = null;
    getProjectData().projectInfo = {
        name: "", description: "", version: "1.0.0",
        author: "", company: "",
        appEvents: { onStart: "", onExit: "", onStart_yaml: "", onExit_yaml: "" },
    };
    applyProjectData({});
    refreshAll();
    applyProjectInfo();
    pushUndo();
    getEditHistory().savedSnapshot = JSON.stringify(snapshot());
}

// ── ファイル保存・オープン（Bunネイティブ経由）──
function loadProjectData(jsonStr) {
    try {
        const d = JSON.parse(jsonStr);
        // 旧フォーマット互換（getProjectData().formCfg/getProjectData().widgets のフラット構造）
        if (d.formCfg && !d.forms) {
            getProjectData().forms = [{ id: "f0", cfg: d.formCfg, widgets: d.widgets || [], idCnt: d.idCnt || 1 }];
            getProjectData().curFormIdx = 0;
        } else {
            // 互換: nameがなければtitleをnameとして補完
            getProjectData().forms = (d.forms || []).map(f => ({
                ...f,
                cfg: { ...f.cfg, name: f.cfg.name || f.cfg.title }
            }));
            getProjectData().curFormIdx = d.curFormIdx || 0;
        }
        applyProjectData(d);
        getDesignerState().selIds = [];
        getEditHistory().undoStack = [];
        getEditHistory().redoStack = [];
        refreshAll();
        getEditHistory().savedSnapshot = JSON.stringify(snapshot());
        applyViewSettings();
    } catch (err) {
        showVjaAlert("読み込み失敗: " + err.message);
    }
}

// プロジェクトを開く → Bun側でファイル選択ダイアログ
async function actOpen() {
    if (isDirty()) {
        showCloseConfirm(
            "未保存の変更があります。",
            "プロジェクトを開くと現在の内容は失われます。続けますか？",
            "開く",
            _doActOpen
        );
        return;
    }
    _doActOpen();
}
async function _doActOpen() {
    try {
        const result = await window.bunOpenFile({
            filter: "vjaproj",
            lastPath: getEditHistory().lastOpenPath,  // 前回開いた/保存したパスを渡す
        });
        if (result && result.content) {
            loadProjectData(result.content);
            if (result.path) {
                getEditHistory().lastSavePath = result.path;
                getEditHistory().lastOpenPath = result.path;
            }
        }
    } catch (e) {
        showVjaAlert("ファイルを開けませんでした: " + e.message);
    }
}

// 保存（上書き or 名前を付けて保存）
// Bun側でダイアログ取得→書き込みまで一括処理するので RPC は1回だけ
async function actSave() {
    commitCurrentInput();
    commitIdCnt();
    const snap = snapshot();
    const content = JSON.stringify(snap);
    const projName = getProjectData().projectInfo.name?.trim() || "project";
    // bridge.ts がロードされているか確認
    if (typeof window.bunSaveProject !== "function") {
        showVjaAlert("エラー: bunSaveProject が未定義です。bridge.ts が正しくロードされていません。");
        console.error("[actSave] window.bunSaveProject is", typeof window.bunSaveProject);
        return;
    }
    try {
        const result = await window.bunSaveProject({
            content,
            defaultName: projName + ".vjaproj",
            lastPath: getEditHistory().lastSavePath, // nullなら名前を付けて保存ダイアログ
        });
        if (result && result.ok && result.path) {
            getEditHistory().lastSavePath = result.path;
            getEditHistory().lastOpenPath = result.path;
            getEditHistory().savedSnapshot = JSON.stringify(snap);
            showToast("保存しました: " + result.path);
        }
        // result.cancelled === true の場合は何もしない（エラーなし）
    } catch (e) {
        showVjaAlert("保存に失敗しました: " + e.message);
    }
}

// 名前を付けて保存（_lastSavePath を null にして actSave を呼ぶ）
async function actSaveAs() {
    const prevPath = getEditHistory().lastSavePath;
    getEditHistory().lastSavePath = null;
    await actSave();
    // キャンセルされた場合は元のパスに戻す
    if (!getEditHistory().lastSavePath) getEditHistory().lastSavePath = prevPath;
}

/* ── プロジェクト実行 ── */
// Bun側に渡す現在のプロジェクトデータを返す
window._getProjectData = function () {
    var p = getProjectData();
    return {
        projectInfo: p.projectInfo,
        forms: p.forms,
        constants: p.constants,
        tables: p.tables,
        extRuntime: p.extRuntime,
    };
};

// プロジェクトをコンパイルして配布可能なElectrobunアプリを生成する
async function actCompileProject() {
    if (!window.bunCompileProject) {
        showVjaAlert("bridge が読み込まれていません");
        return;
    }
    // 未保存チェック
    if (!getEditHistory().lastSavePath) {
        showVjaAlert("プロジェクトを保存してからコンパイルしてください。");
        return;
    }
    if (isDirty()) {
        showVjaAlert("未保存の変更があります。保存してからコンパイルしてください。");
        return;
    }
    // コンパイル前の確認
    const confirmCompile = await vja.app.showConfirm("コンパイルを開始しますか？\nコンパイルには数分かかる場合があります。");
    if (!confirmCompile) return;
    const btn = $("btn-compile");
    if (btn) { btn.disabled = true; }
    showLoadingModal("コンパイル中...");
    try {
        const result = await window.bunCompileProject();
        closeModal();
        if (result?.ok) {
            const openFolder = await vja.app.showConfirm(`コンパイル完了！
出力先: ${result.distPath}

出力先フォルダを開きますか？`);
            if (openFolder) window.bunOpenFolder(result.distPath);
        } else {
            showVjaAlert(`コンパイル失敗: ${result?.error || "不明なエラー"}`);
        }
    } catch (e) {
        closeModal();
        showVjaAlert("コンパイルに失敗しました: " + e.message);
    } finally {
        if (btn) { btn.disabled = false; }
    }
}

async function actRunProject() {
    if (!bunSaveProject) { showVjaAlert("bridge が読み込まれていません"); return; }
    const runBtn = $("btn-run-project");
    const stopBtn = $("btn-stop-project");
    if (runBtn) runBtn.disabled = true;
    showToast("プロジェクトをビルド中…");
    try {
        const result = await vja.project.run();
        if (result.ok) {
            if (runBtn) runBtn.style.display = "none";
            if (stopBtn) stopBtn.style.display = "";
            showToast("プロジェクトを起動しました");
        } else {
            if (result.error === "already running") {
                showVjaAlert("プロジェクトは既に実行中です");
            } else {
                showVjaAlert("実行エラー: " + (result.error || "不明なエラー"));
            }
        }
    } catch (e) {
        showVjaAlert("実行に失敗しました: " + e.message);
    } finally {
        // 実行ボタンが非表示でない場合は必ずdisabledを解除
        if (runBtn && runBtn.style.display !== "none") {
            runBtn.disabled = false;
        }
    }
}

async function actClearProjectDb() {
    closeAllMenus();
    const confirmed = await vja.app.showConfirm(
        "このプロジェクトのDBデータを全て削除します。\nこの操作は元に戻せません。よろしいですか？"
    );
    if (!confirmed) return;
    try {
        await vja.project.clearDb();
        showToast("DBデータをクリアしました");
    } catch (e) {
        showVjaAlert("DBクリアに失敗しました: " + (e.message || "不明なエラー"));
    }
}

async function actShowVersion() {
    closeAllMenus();
    const result = await window.bunGetVersion();
    showVjaAlert(`vja  v${result.version}  (${result.runMode})`);
}

async function actStopProject() {
    const runBtn = $("btn-run-project");
    const stopBtn = $("btn-stop-project");
    try {
        await vja.project.stop();
    } catch (e) { console.error("[vja] saveProject error:", e); }
    if (runBtn) { runBtn.style.display = ""; runBtn.disabled = false; }
    if (stopBtn) stopBtn.style.display = "none";
    showToast("プロジェクトを停止しました");
}

/* ═══════════════════════════════════════════
  マルチフォーム管理
═══════════════════════════════════════════ */

// 初期フォームを設定
function setStartForm() {
    const f = getProjectData().forms[getProjectData().curFormIdx];
    if (!f) return;
    getProjectData().startFormId = f.id;
    updateStartBtn();
    pushUndo();
    showToast("「" + f.cfg.title + "」を初期表示フォームに設定しました");
}

// ★ボタンの状態を更新
function updateStartBtn() {
    const btn = $("btn-set-start");
    if (!btn) return;
    const f = getProjectData().forms[getProjectData().curFormIdx];
    const isStart = f && f.id === getProjectData().startFormId;
    btn.classList.toggle("is-start", isStart);
    btn.title = isStart ? "この画面が初期表示フォームです" : "初期表示フォームに設定";
    btn.style.color = isStart ? "#f5a623" : "";
    btn.style.borderColor = isStart ? "#f5a623" : "";
}

// カスタムドロップダウンを再構築
function buildFormSelect() {
    const list = $("fdd-list");
    list.innerHTML = "";
    getProjectData().forms.forEach((f, i) => {
        const item = document.createElement("div");
        item.className =
            "fdd-item" + (i === getProjectData().curFormIdx ? " fdd-active" : "");
        // 初期フォームに★マークを付ける
        item.textContent = (f.id === getProjectData().startFormId ? "★ " : "") + `[${i + 1}] ${f.cfg.name || f.cfg.title}`;
        item.onclick = (e) => {
            e.stopPropagation();
            switchForm(i);
            closeFdd();
        };
        list.appendChild(item);
    });
    // ボタンラベル更新
    const cur = getProjectData().forms[getProjectData().curFormIdx];
    $("fdd-label").textContent = cur
        ? `[${getProjectData().curFormIdx + 1}] ${cur.cfg.name || cur.cfg.title}`
        : "";
    updateStartBtn();
}

function toggleFdd(e) {
    e.stopPropagation();
    $("fdd-list").classList.toggle("open");
}
function closeFdd() {
    $("fdd-list").classList.remove("open");
}

// フォームを切り替え
function switchForm(idx) {
    idx = parseInt(idx);
    if (idx === getProjectData().curFormIdx) return;
    commitIdCnt();
    getProjectData().curFormIdx = idx;
    getDesignerState().selIds = [];
    refreshAll();
    requestAnimationFrame(drawRulers);
}

// 新しい画面を追加
function formNew() {
    commitCurrentInput();
    showVjaPrompt("新しい画面の名前を入力してください", "Form" + (getProjectData().forms.length + 1), (title) => {
        if (!title) return;
        if (!/^[a-zA-Z0-9_\-\.]+$/.test(title)) {
            showToast("画面名は英数字・アンダースコア・ハイフン・ドットのみ使用できます", 5000);
            return;
        }
        commitAndPush();
        const f = makeFormData(title);
        getProjectData().forms.push(f);
        getProjectData().curFormIdx = getProjectData().forms.length - 1;
        getDesignerState().selIds = [];
        refreshAll();
    });
}

// 現在の画面を削除
async function formDelete() {
    commitCurrentInput();
    if (getProjectData().forms.length <= 1) {
        showVjaAlert("最後の画面は削除できません");
        return;
    }
    if (!(await vja.app.showConfirm(`"${getProjectData().formCfg.title}" を削除しますか？`))) return;
    commitAndPush();
    getProjectData().forms.splice(getProjectData().curFormIdx, 1);
    getProjectData().curFormIdx = Math.min(getProjectData().curFormIdx, getProjectData().forms.length - 1);
    getDesignerState().selIds = [];
    refreshAll();
}

// 現在の画面名を変更
function formRename() {
    commitCurrentInput();
    showVjaPrompt("画面名を変更してください", getProjectData().formCfg.name || getProjectData().formCfg.title, (newName) => {
        if (!newName || newName === (getProjectData().formCfg.name || getProjectData().formCfg.title)) return;
        if (!/^[a-zA-Z0-9_\-\.]+$/.test(newName)) {
            showToast("画面名は英数字・アンダースコア・ハイフン・ドットのみ使用できます", 5000);
            return;
        }
        pushUndo();
        getProjectData().formCfg.name = newName;
        getProjectData().forms[getProjectData().curFormIdx].cfg.name = newName;
        // titleが未設定または同じだった場合はtitleも更新
        if (!getProjectData().formCfg.title || getProjectData().formCfg.title === getProjectData().formCfg.name) {
            getProjectData().formCfg.title = newName;
            getProjectData().forms[getProjectData().curFormIdx].cfg.title = newName;
        }
        applyForm();
        buildFormSelect();
    });
}

/* ═══════════════════════════════════════════
   window へのエクスポート（他ファイルから参照される関数のみ）
═══════════════════════════════════════════ */
Object.assign(window, {
    actNew, loadProjectData, actOpen, actSave, actSaveAs,
    actCompileProject, actRunProject, actClearProjectDb,
    actShowVersion, actStopProject,
    setStartForm, updateStartBtn, buildFormSelect,
    toggleFdd, closeFdd, switchForm, formNew, formDelete, formRename,
});
