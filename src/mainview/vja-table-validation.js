/* ═══════════════════════════════════════════════════════════════
   vja-table-validation.js — 閉じる確認・定数編集・テーブル管理・バリデーション編集
   ─────────────────────────────────────────────────────────────
   【読み込み順序】7番目（vja-save.js の直後）。
   【依存】vja-defs.js, vja-designer.js, vja-modal.js, vja-yaml-editor.js
   【提供するもの】
     - isDirty() / showCloseConfirm() / hideCloseConfirm()（閉じる確認）
     - openConstEditor() / renderConstModal() / renderRowListModal()
       （定数編集・行リストモーダル共通テンプレート）
     - openTableManager() / renderTableEditModal() / tblXxx 系
       （SQLiteテーブル定義の管理）
     - openValidationEditor() / renderValidationEditModal()
       （バリデーション定義の管理）
     - openColDefEditor() / openItemsDefEditor()（カラム定義・項目定義）
   このファイルは vja-defs.js / vja-designer.js / vja-modal.js /
   vja-yaml-editor.js に依存する。
═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════
  MISC
═══════════════════════════════════════════ */

/* ── ウィンドウを閉じる確認 ── */
// 未保存の変更があるか判定する。getEditHistory().savedSnapshot と現在の状態を比較する。
// フォーカス中の入力値を確定してからisDirtyを返す
function commitCurrentInput() {
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) {
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
    }
}

function isDirty() {
    commitCurrentInput();
    if (getEditHistory().savedSnapshot === null) return false;
    return !deepEqual(snapshot(), JSON.parse(getEditHistory().savedSnapshot));
}
// クローズボタン押下時の処理。未保存の変更がある場合は確認ダイアログを表示する。
function confirmClose() {
    if (isDirty()) {
        showCloseConfirm(
            "VJA Form Designer を閉じますか？",
            "保存していない変更は失われます。",
            "閉じる",
            doClose
        );
    } else {
        doClose();
    }
}

// 汎用警告ダイアログを表示する。
// mainMsg: 主メッセージ、subMsg: 補足メッセージ、okLabel: OKボタンのラベル、onOk: OK時のコールバック
function showCloseConfirm(mainMsg, subMsg, okLabel, onOk) {
    const m = document.getElementById("confirm-msg-main");
    const s = document.getElementById("confirm-msg-sub");
    const b = document.getElementById("confirm-btn-ok");
    if (m) m.textContent = mainMsg || "VJA Form Designer を閉じますか？";
    if (s) s.textContent = subMsg || "保存していない変更は失われます。";
    if (b) b.textContent = okLabel || "閉じる";
    CONFIRM_MODAL.okCb = onOk || null;
    document.getElementById("close-confirm").classList.add("show");
}
function hideCloseConfirm() {
    document.getElementById("close-confirm").classList.remove("show");
    CONFIRM_MODAL.okCb = null;
}
function onConfirmOk() {
    const cb = CONFIRM_MODAL.okCb;
    hideCloseConfirm();
    if (cb) cb();
}
async function doClose() {
    try {
        await window.bunCloseApp();
    } catch (e) {
        // バインドがない環境（ブラウザ等）ではwindow.closeを試みる
        window.close();
    }
}
// Escキーで確認ダイアログを閉じる

/* ── 定数エディタ ── */
function openConstEditor() {
    CONST_MODAL.rows = getProjectData().constants.map(c => ({ name: c.name || "", value: c.value || "" }));
    if (CONST_MODAL.rows.length === 0) CONST_MODAL.rows.push({ name: "", value: "" });
    renderConstModal();
}

function renderConstModal() {
    renderConstModalBase(
        "📌 定数エディタ",
        "イベントのYAMLから参照できる定数を定義します。プロジェクトファイルに保存されます。",
        "constAddRow()",
        "constSave()",
        "renderConstModal"
    );
}

function renderConstModalBase(title, infoText, addAction, saveAction, delRenderFn) {
    const rows = CONST_MODAL.rows || [];
    const tbody = rows.map((r, i) => render("tv-tpl-const-row", {
        no: i + 1,
        name: r.name,
        attrName: evtAttr("oninput", "constUpdate(" + i + ",'name',this.value)"),
        value: r.value,
        attrValue: evtAttr("oninput", "constUpdate(" + i + ",'value',this.value)"),
        attrDel: evtAttr("onmousedown", "constDelRow(" + i + ",'" + delRenderFn + "')"),
    })).join("");
    showModal(render("tv-tpl-const-modal", {
        header: mhdrHTML(title),
        infoText,
        tbody,
        attrAdd: evtAttr("onmousedown", addAction),
        footBtns: mfootHTML([{ label: "キャンセル", action: "closeModal()" }]),
        attrSave: evtAttr("onmousedown", saveAction),
    }));
}

// DOM から現在の入力値を CONST_MODAL.rows に同期する
function syncConstFromDOM() {
    const tbody = document.querySelector("#const-modal .const-table tbody");
    if (!tbody || !CONST_MODAL.rows) return;
    const rows = tbody.querySelectorAll("tr");
    rows.forEach((tr, i) => {
        const inputs = tr.querySelectorAll("input");
        if (inputs.length >= 2 && CONST_MODAL.rows[i]) {
            CONST_MODAL.rows[i].name = inputs[0].value;
            CONST_MODAL.rows[i].value = inputs[1].value;
        }
    });
}

function constUpdate(idx, key, val) {
    if (CONST_MODAL.rows) CONST_MODAL.rows[idx][key] = val;
}

function constAddRow() {
    if (!CONST_MODAL.rows) return;
    syncConstFromDOM(); // 現在の入力値を先に保存
    CONST_MODAL.rows.push({ name: "", value: "" });
    renderConstModal();
}

function constDelRow(idx, renderFnName) {
    if (!CONST_MODAL.rows) return;
    syncConstFromDOM(); // 現在の入力値を先に保存
    CONST_MODAL.rows.splice(idx, 1);
    if (CONST_MODAL.rows.length === 0) CONST_MODAL.rows.push({ name: "", value: "" });
    (renderFnName ? window[renderFnName] : renderConstModal)();
}

// ── 定数保存共通ヘルパー ──────────────────────────────────
// target=null → グローバル定数、target=フォームオブジェクト → フォーム定数
function constSaveBase(target) {
    syncConstFromDOM();
    const valid = (CONST_MODAL.rows || []).filter(r => r.name.trim());
    const names = valid.map(r => r.name.trim());
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) { showVjaAlert("定数名「" + dup + "」が重複しています"); return; }
    const saved = valid.map(r => ({ name: r.name.trim(), value: r.value }));
    if (target === null) {
        getProjectData().constants = saved;
    } else {
        target.constants = saved;
        showToast("フォーム定数を保存しました（" + saved.length + "件）");
    }
    closeModal();
    pushUndo();
}
function constSave() { constSaveBase(null); }

/* ── プロパティパネル カスタムセレクト ── */
// ── pv-sel 生成共通ヘルパー ─────────────────────────────
// id: 要素ID
// options: string[] または {value, label}[] の選択肢
// currentVal: 現在の選択値
// onPickCode: 選択時に実行するJSコード。{value}でプレースホルダー置換
//   例: "setProp('key','',{value},123)"
function makePvSel(id, options, currentVal, onPickCode) {
    const opts = options.map(o => {
        const val = typeof o === "object" ? o.value : o;
        const lbl = typeof o === "object" ? (o.label || o.value) : o;
        const code = onPickCode.replace(/\{value\}/g, "'" + String(val).replace(/'/g, "\\'") + "'");
        const isActive = currentVal === val;
        const pickCode = "pvSelPick('" + id + "','" + String(val).replace(/'/g, "\\'") + "','" + String(lbl).replace(/'/g, "\\'") + "',event);" + code;
        return render("tv-tpl-sel-opt", {
            active: isActive ? "active" : "",
            attr: evtAttr("onmousedown", pickCode),
            label: lbl,
        });
    }).join("");
    const curLabel = (() => {
        const found = options.find(o => (typeof o === "object" ? o.value : o) === currentVal);
        if (found) return typeof found === "object" ? (found.label || found.value) : found;
        return currentVal || (options.length > 0 ? (typeof options[0] === "object" ? options[0].label : options[0]) : "");
    })();
    return render("tv-tpl-sel", {
        id, curLabel,
        attrOpen: evtAttr("onmousedown", "pvSelOpen('" + id + "',event)"),
        opts,
    });
}

function pvSelOpen(id, e) {
    if (e) e.stopPropagation();
    const wrap = document.getElementById(id);
    if (!wrap) return;
    const list = wrap.querySelector(".pv-sel-list");
    if (!list) return;
    const isOpen = list.classList.contains("open");
    document.querySelectorAll(".pv-sel-list.open").forEach(el => el.classList.remove("open"));
    if (!isOpen) {
        list.classList.add("open");
        const btn = wrap.querySelector(".pv-sel-btn");
        const r = btn.getBoundingClientRect();
        list.style.left = r.left + "px";
        list.style.top = (r.bottom + 2) + "px";
        list.style.minWidth = r.width + "px";
    }
}
// val: 保存値、disp: 表示名（省略時は val をそのまま表示）
// 後方互換のため dispOrEvent が Event の場合は旧来通り val を表示名に使う
function pvSelPick(id, val, dispOrEvent, e) {
    const isOldStyle = !e && (dispOrEvent instanceof Event || (dispOrEvent && typeof dispOrEvent === "object" && dispOrEvent.stopPropagation));
    const ev = isOldStyle ? dispOrEvent : e;
    const disp = isOldStyle ? String(val) : (dispOrEvent !== undefined ? String(dispOrEvent) : String(val));
    if (ev) ev.stopPropagation();
    const wrap = document.getElementById(id);
    if (!wrap) return;
    const list = wrap.querySelector(".pv-sel-list");
    const btn = wrap.querySelector(".pv-sel-btn span:first-child");
    if (btn) btn.textContent = disp;
    list?.classList.remove("open");
    wrap.querySelectorAll(".pv-sel-opt").forEach(el => {
        el.classList.toggle("active",
            el.textContent === String(val) || el.getAttribute("data-v") === String(val));
    });
}

/* ═══════════════════════════════════════════
   テーブル管理
═══════════════════════════════════════════ */

// SQLITE_TYPES（SQLite型リスト）は init-params.js で window.SQLITE_TYPES として定義済み

// テーブル管理モーダルを開く
function openTableManager() {
    // ウィザードの「✏️ 編集」からテーブル編集モーダルに入っている場合、
    // 「← 一覧に戻る」操作はウィザードのカラム確認モーダルへ戻す
    // （AI接続設定/プロジェクト設定と同じresumeAfterXxxフック方式、wizardEditTableColumns参照）
    if (typeof WIZARD_STATE !== "undefined" && WIZARD_STATE.resumeAfterTableEdit) {
        const resume = WIZARD_STATE.resumeAfterTableEdit;
        WIZARD_STATE.resumeAfterTableEdit = null;
        resume();
        return;
    }
    renderTableManagerModal();
}

function renderTableManagerModal() {
    renderListManagerModal({
        title: "🗄 テーブル管理",
        items: getProjectData().tables,
        colCount: 6,
        emptyText: "テーブルが未登録です。「＋ テーブル追加」から追加してください。",
        countLabel: (n) => "SQLiteテーブル定義（全" + n + "件）",
        addAction: "openTableEdit(-1)",
        addLabel: "＋ テーブル追加",
        headerHtml: "<th style='width:36px'>No</th><th>テーブル名</th><th style='width:72px;text-align:center'>カラム数</th><th style='width:90px;text-align:center'>インデックス数</th><th style='width:80px;text-align:center'>編集</th><th style='width:80px;text-align:center'>削除</th>",
        rowHtmlFn: (t, i) => render("tv-tpl-table-row", {
            no: i + 1,
            name: t.name,
            colCount: t.columns ? t.columns.length : 0,
            idxCount: t.columns ? t.columns.filter(c => c.index).length : 0,
            attrEdit: evtAttr("onmousedown", "openTableEdit(" + i + ")"),
            attrDel: evtAttr("onmousedown", "deleteTable(" + i + ")"),
        }),
    });
}

// テーブル削除
async function deleteTable(idx) {
    const t = getProjectData().tables[idx];
    if (!t) return;
    if (!(await vja.app.showConfirm("テーブル「" + t.name + "」を削除しますか？この操作は元に戻せません。"))) return;
    getProjectData().tables.splice(idx, 1);
    pushUndo();
    renderTableManagerModal();
}

// テーブル新規作成 / 編集モーダル
function openTableEdit(idx) {
    // idx=-1 → 新規, それ以外 → 編集
    const isNew = idx < 0;
    const tbl = isNew
        ? { name: "", description: "", columns: [defaultColumn()] }
        : JSON.parse(JSON.stringify(getProjectData().tables[idx])); // ディープコピー
    if (!tbl.columns || tbl.columns.length === 0) tbl.columns = [defaultColumn()];
    TABLE_MODAL.editIdx = idx;
    TABLE_MODAL.edit = tbl;
    renderTableEditModal();
}

function defaultColumn() {
    // labelJa: カラム名（英語のDBカラム名）に併記する日本語名。DDLには影響しない表示用の項目。
    return { name: "", labelJa: "", type: "TEXT", notNull: false, pk: false, index: false, useDefault: false, default: "" };
}

function renderTableEditModal() {
    const tbl = TABLE_MODAL.edit;
    const isNew = TABLE_MODAL.editIdx < 0;
    const cols = tbl.columns || [];

    const tbody = cols.map((c, i) => {
        const defCell = render("tv-tpl-col-default-cell", {
            useDefaultChecked: c.useDefault ? "checked" : "",
            attrUseDefault: evtAttr("onchange", "tblColUpdate(" + i + ",'useDefault',this.checked)"),
            defaultVal: c.default || "",
            attrDefault: evtAttr("oninput", "tblColUpdate(" + i + ",'default',this.value)"),
            placeholder: defaultValueForType(c.type),
        });
        return render("tv-tpl-col-row", {
            i, no: i + 1,
            name: c.name,
            attrName: evtAttr("oninput", "tblColUpdate(" + i + ",'name',this.value)"),
            labelJa: c.labelJa || "",
            attrLabelJa: evtAttr("oninput", "tblColUpdate(" + i + ",'labelJa',this.value)"),
            type: c.type || "TEXT",
            notNullChecked: c.notNull ? "checked" : "",
            attrNotNull: evtAttr("onchange", "tblColUpdate(" + i + ",'notNull',this.checked)"),
            pkChecked: c.pk ? "checked" : "",
            attrPk: evtAttr("onchange", "tblColUpdatePk(" + i + ",this.checked)"),
            indexChecked: c.index ? "checked" : "",
            attrIndex: evtAttr("onchange", "tblColUpdate(" + i + ",'index',this.checked)"),
            defCell,
            attrInsert: evtAttr("onmousedown", "tblColInsert(" + i + ")"),
            attrDelete: evtAttr("onmousedown", "tblColDelete(" + i + ")"),
        });
    }).join("");

    showModal(
        mhdrHTML(isNew ? "➕ テーブル新規作成" : "✏ テーブル編集") +
        render("tv-tpl-table-edit-body", {
            name: tbl.name,
            attrName: evtAttr("oninput", "TABLE_MODAL.edit.name=this.value"),
            description: tbl.description || "",
            attrDesc: evtAttr("oninput", "TABLE_MODAL.edit.description=this.value"),
            attrAiGen: evtAttr("onmousedown", "tblAiGenerateSchema()"),
            masterCsvArea: renderMasterCsvArea(tbl),
            colCount: cols.length,
            attrColAdd: evtAttr("onmousedown", "tblColAdd()"),
            tbody,
            attrDdl: evtAttr("onmousedown", "tblShowDdl()"),
            attrBack: evtAttr("onmousedown", "openTableManager()"),
            attrSave: evtAttr("onmousedown", "tblSave()"),
        })
    );
    // showModal後にイベントデリゲーション登録
    requestAnimationFrame(() => {
        const modalEl = document.querySelector("#modal-root .modal");
        if (modalEl) {
            modalEl.addEventListener("click", function handler(e) {
                const btn = e.target.closest(".col-type-btn");
                if (!btn) return;
                e.stopPropagation();
                const idx = parseInt(btn.dataset.colidx);
                tblTypeOpen(idx, btn);
            }, { capture: false });
        }
    });
}

// ── マスターCSV管理 ──────────────────────────────────

// マスターCSVエリアのHTMLを生成する
function renderMasterCsvArea(tbl) {
    const csv = tbl.masterCsv;
    if (csv && csv.data) {
        const origKb = csv.originalSize ? (csv.originalSize / 1024).toFixed(1) + " KB" : "不明";
        const compKb = csv.compressedSize ? (csv.compressedSize / 1024).toFixed(1) + " KB" : "不明";
        return render("tv-tpl-csv-area-has", {
            filename: csv.filename || "master.csv",
            rows: csv.rows, origKb, compKb,
            attrDownload: evtAttr("onmousedown", "tblDownloadMasterCsv()"),
            attrReupload: evtAttr("onmousedown", "tblReuploadMasterCsv()"),
            attrDelete: evtAttr("onmousedown", "tblDeleteMasterCsv()"),
        });
    } else {
        return render("tv-tpl-csv-area-none", {
            attrUpload: evtAttr("onmousedown", "tblUploadMasterCsv()"),
            attrChange: evtAttr("onchange", "tblOnCsvSelected(event)"),
        });
    }
}

// CSVアップロードボタン押下
function tblUploadMasterCsv() {
    const inp = $("tbl-csv-file");
    if (inp) inp.click();
}

// 再アップロードボタン押下（既存削除して再アップロード）
function tblReuploadMasterCsv() {
    // 一時的にfileInputを追加してクリック
    let inp = $("tbl-csv-file-re");
    if (!inp) {
        inp = document.createElement("input");
        inp.type = "file";
        inp.id = "tbl-csv-file-re";
        inp.accept = ".csv";
        inp.style.display = "none";
        inp.onchange = tblOnCsvSelected;
        document.body.appendChild(inp);
    }
    inp.click();
}

// CSVファイル選択時の処理
async function tblOnCsvSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const MAX_SIZE = 20 * 1024 * 1024; // 20MB
    if (file.size > MAX_SIZE) {
        showVjaAlert("CSVファイルが20MBを超えています（" + (file.size / 1024 / 1024).toFixed(1) + " MB）\nアップロード可能なサイズは20MB以内です。");
        return;
    }

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
        showVjaAlert("CSVにデータが含まれていません（ヘッダー行のみ、または空）。");
        return;
    }

    // ヘッダー解析
    const headers = parseCsvLine(lines[0]);
    const tbl = TABLE_MODAL.edit;
    const cols = tbl.columns || [];

    // 必須カラムチェック（NOT NULL + DEFAULTなし + PKでない）
    const requiredCols = cols.filter(c => c.notNull && !c.pk && (!c.useDefault || !c.default));
    const missingRequired = requiredCols.filter(c => !headers.includes(c.name));
    if (missingRequired.length > 0) {
        showVjaAlert("以下の必須カラムがCSVに存在しません：\n" + missingRequired.map(c => "・" + c.name).join("\n"));
        return;
    }

    // 必須カラムの空欄チェック（全行）
    const dataLines = lines.slice(1);
    for (let i = 0; i < dataLines.length; i++) {
        const vals = parseCsvLine(dataLines[i]);
        for (const rc of requiredCols) {
            const idx = headers.indexOf(rc.name);
            if (idx >= 0 && (!vals[idx] || vals[idx].trim() === "")) {
                showVjaAlert("必須カラム「" + rc.name + "」が " + (i + 2) + " 行目で空欄です。");
                return;
            }
        }
    }

    // gzip圧縮 → Base64
    try {
        const compressed = await compressCsv(text);
        TABLE_MODAL.edit.masterCsv = {
            filename: file.name,
            data: compressed,
            rows: dataLines.length,
            originalSize: file.size,
            compressedSize: Math.round(compressed.length * 0.75), // Base64 → bytes概算
        };
        renderTableEditModal();
        showToast("CSVをアップロードしました（" + dataLines.length + " 行）");
    } catch (e) {
        showVjaAlert("CSVの圧縮処理に失敗しました: " + e.message);
    }
}

// CSVをgzip圧縮してBase64文字列で返す
async function compressCsv(text) {
    const enc = new TextEncoder();
    const input = enc.encode(text);
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    writer.write(input);
    writer.close();
    const chunks = [];
    const reader = cs.readable.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return btoa(String.fromCharCode(...result));
}

// Base64+gzip → 元のCSVテキストに展開
async function decompressCsv(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const chunks = [];
    const reader = ds.readable.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(result);
}

// CSV1行のパースは vja-runtime.js の window.parseCsvLine() を使用する
// （同一ウィンドウ内で読み込まれているため、共通化してある）。

// マスターCSVをダウンロードする
async function tblDownloadMasterCsv() {
    const csv = TABLE_MODAL.edit.masterCsv;
    if (!csv?.data) return;
    try {
        const text = await decompressCsv(csv.data);
        const defaultName = csv.filename || (TABLE_MODAL.edit.name + "_master.csv");
        const result = await window.bunSaveGenericFile({
            content: text,
            defaultName: defaultName,
            ext: "csv",
        });
        if (result && result.ok && result.path) {
            showToast("ダウンロードしました: " + result.path);
        }
        // result.cancelled === true の場合は何もしない（エラーなし）
    } catch (e) {
        showVjaAlert("ダウンロードに失敗しました: " + e.message);
    }
}

// マスターCSVを削除する
async function tblDeleteMasterCsv() {
    const confirmed = await vja.app.showConfirm("マスターCSVを削除しますか？");
    if (!confirmed) return;
    delete TABLE_MODAL.edit.masterCsv;
    renderTableEditModal();
    showToast("マスターCSVを削除しました");
}

// カラム値を更新
// 型に合わせたデフォルト値を返す
function defaultValueForType(type) {
    switch ((type || "TEXT").toUpperCase()) {
        case "INTEGER": return "0";
        case "REAL": return "0.0";
        case "NUMERIC": return "0";
        case "BLOB": return "''";
        default: return "''";  // TEXT等
    }
}

// デフォルト値が型に合っているか検証（空＝デフォルト値を使用、入力あり＝バリデート）。
// TEXT/BLOBはDDL生成時（sqlLiteralForDefault()）に自動でシングルクォートを
// 付与するため、ユーザーに手動でクォートさせる必要が無く、常にtrueを返す。
function validateDefaultValue(type, value) {
    if (!value || value === "") return true;
    var v = value.trim();
    var t = (type || "TEXT").toUpperCase();
    if (v.toUpperCase() === "NULL") return true;
    if (t === "INTEGER") return /^-?[0-9]+$/.test(v);
    if (t === "REAL" || t === "NUMERIC") return /^-?[0-9]+([.][0-9]+)?$/.test(v);
    return true;
}

// TEXT/BLOB型のDEFAULT値を、DDLに出力できるSQLリテラルへ変換する。
// - "NULL"（大小文字問わず）→ クォート無しの NULL
// - 既にシングルクォートで囲まれている値 → そのまま使用（手入力での明示指定を尊重）
// - それ以外の生テキスト → 内部のシングルクォートを''にエスケープした上でクォートを付与
//   （これにより、ユーザーはクォートを手入力する必要が無い＝'hoge'ではなくhogeと
//   入力するだけでDEFAULT 'hoge'になる）
function sqlLiteralForDefault(value) {
    const v = (value || "").trim();
    if (v.toUpperCase() === "NULL") return "NULL";
    if (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'" && v.length >= 2) return v;
    return "'" + v.replace(/'/g, "''") + "'";
}

function tblColUpdate(idx, key, val) {
    if (!TABLE_MODAL.edit || !TABLE_MODAL.edit.columns[idx]) return;
    TABLE_MODAL.edit.columns[idx][key] = val;
    if (key === "pk" && val) {
        // PKの場合はNOT NULLも自動ON
        TABLE_MODAL.edit.columns[idx].notNull = true;
    }
}

// PK設定（1つのみ許可）
function tblColUpdatePk(idx, val) {
    if (!TABLE_MODAL.edit) return;
    TABLE_MODAL.edit.columns.forEach((c, i) => { c.pk = (i === idx && val); });
    // 再描画
    renderTableEditModal();
}

// カラム追加
function tblColAdd() {
    if (!TABLE_MODAL.edit) return;
    // 現在のDOMから値を同期
    tblSyncFromDOM();
    TABLE_MODAL.edit.columns.push(defaultColumn());
    renderTableEditModal();
}

// カラム挿入（指定行の前に追加）
function tblColInsert(idx) {
    if (!TABLE_MODAL.edit) return;
    tblSyncFromDOM();
    TABLE_MODAL.edit.columns.splice(idx, 0, defaultColumn());
    renderTableEditModal();
}

// カラム削除
function tblColDelete(idx) {
    if (!TABLE_MODAL.edit) return;
    tblSyncFromDOM();
    TABLE_MODAL.edit.columns.splice(idx, 1);
    if (TABLE_MODAL.edit.columns.length === 0) TABLE_MODAL.edit.columns.push(defaultColumn());
    renderTableEditModal();
}

// DOMから現在の入力値を同期
function tblSyncFromDOM() {
    const tbl = TABLE_MODAL.edit;
    if (!tbl) return;
    const nameIn = $("tbl-name-in");
    const descIn = $("tbl-desc-in");
    if (nameIn) tbl.name = nameIn.value;
    if (descIn) tbl.description = descIn.value;
    const tbody = $("col-tbody");
    if (!tbody) return;
    tbody.querySelectorAll("tr").forEach((tr, i) => {
        if (!tbl.columns[i]) return;
        const inp = tr.querySelector("input[type=text]");
        const sel = tr.querySelector("select");
        const cbs = tr.querySelectorAll("input[type=checkbox]");
        if (inp) tbl.columns[i].name = inp.value;
        if (sel) tbl.columns[i].type = sel.value;
        if (cbs[0]) tbl.columns[i].notNull = cbs[0].checked;
        if (cbs[1]) tbl.columns[i].pk = cbs[1].checked;
        if (cbs[2]) tbl.columns[i].index = cbs[2].checked;
        // DEFAULT: 4番目のcheckboxがuseDefault、3番目のtextがdefault値
        if (cbs[3] !== undefined) tbl.columns[i].useDefault = cbs[3].checked;
        // テキスト入力の並び順: [0]=カラム名, [1]=日本語名, [2]=DEFAULT値
        const txts = tr.querySelectorAll("input[type=text]");
        if (txts[1]) tbl.columns[i].labelJa = txts[1].value;
        if (txts[2]) tbl.columns[i].default = txts[2].value;
    });
}

// AIに依頼して、テーブル名・説明・自由記述の依頼文からカラム構成の雛形を生成する
// AIが生成したカラム定義（JSON配列）をサニタイズする共通処理。
// tblAiGenerateSchema()（テーブル編集モーダルの✨AI生成）と、
// ウィザードの一括カラム生成（vja-wizard.js）の両方で共有する。
function sanitizeAiTableColumns(cols) {
    if (!Array.isArray(cols)) return [];
    const sanitized = cols.map(c => ({
        name: String(c.name || "").trim(),
        labelJa: String(c.labelJa || "").trim(),
        type: SQLITE_TYPES.includes(c.type) ? c.type : "TEXT",
        notNull: !!c.notNull,
        pk: !!c.pk,
        index: !!c.index,
        useDefault: !!(c.default && String(c.default).trim() !== ""),
        default: c.default ? String(c.default) : "",
    })).filter(c => c.name !== "");
    // PKは1つのみ許可（複数trueが返ってきた場合は先頭のみ有効にする）
    let pkFound = false;
    sanitized.forEach(c => {
        if (c.pk) {
            if (pkFound) c.pk = false;
            else pkFound = true;
        }
    });
    return sanitized;
}

async function tblAiGenerateSchema() {
    if (!getProjectData().aiConfig.enabled) {
        if (await vja.app.showConfirm("AI接続設定が有効になっていません。設定画面を開きますか？")) {
            closeModal();
            openAiConfig();
        }
        return;
    }

    tblSyncFromDOM();
    const tbl = TABLE_MODAL.edit;
    if (!tbl) return;
    const reqText = $("tbl-ai-req-in")?.value?.trim() || "";
    if (!reqText && !tbl.name && !tbl.description) {
        showToast("テーブル名・説明・依頼文のいずれかを入力してください");
        $("tbl-ai-req-in")?.focus();
        return;
    }

    // 既に意味のあるカラム定義がある場合は上書き確認
    const hasExistingCols = tbl.columns.some(c => (c.name || "").trim() !== "");
    if (hasExistingCols) {
        const ok = await vja.app.showConfirm(
            "既にカラム定義があります。\nAIが生成する内容で上書きしますか？"
        );
        if (!ok) return;
    }

    const sysPrompt = _PROMPT_DEF.TABLE_SCHEMA_GEN_SYS_PROMPT({ tableName: tbl.name, description: tbl.description });
    const userPrompt = _PROMPT_DEF.TABLE_SCHEMA_GEN_USER_PROMPT(reqText);

    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        loadingMsg: "テーブル構成を生成中…",
        onSuccess: async (generated) => {
            let cols;
            try {
                cols = JSON.parse(generated);
                if (!Array.isArray(cols) || cols.length === 0) throw new Error("empty");
            } catch (e) {
                showToast("AI生成結果の解析に失敗しました");
                return;
            }
            const sanitized = sanitizeAiTableColumns(cols);
            if (sanitized.length === 0) {
                showToast("AI生成結果にカラムがありませんでした");
                return;
            }
            TABLE_MODAL.edit.columns = sanitized;
            renderTableEditModal();
            showToast("✨ AIがテーブル構成を生成しました");
        },
        onCancel: async () => {},
        onError: async () => {},
    });
}

// DDLプレビュー表示
function tblShowDdl() {
    tblSyncFromDOM();
    const tbl = TABLE_MODAL.edit;
    const pre = $("tbl-ddl-preview");
    if (!pre) return;
    pre.style.display = pre.style.display === "none" ? "block" : "none";
    if (pre.style.display === "block") pre.textContent = generateDDL(tbl);
}

// DDL生成
function generateDDL(tbl) {
    if (!tbl.name) return "-- テーブル名を入力してください";
    const cols = (tbl.columns || []).filter(c => c.name.trim());
    if (cols.length === 0) return "-- カラムを1つ以上定義してください";
    const pkCols = cols.filter(c => c.pk);
    const colDefs = cols.map(c => {
        let def = "  " + c.name + " " + c.type;
        if (c.pk && pkCols.length === 1) def += " PRIMARY KEY";
        if (c.notNull && !c.pk) def += " NOT NULL";
        if (c.useDefault) {
            const raw = (c.default && c.default.trim() !== "") ? c.default.trim() : defaultValueForType(c.type);
            const t = (c.type || "TEXT").toUpperCase();
            const dv = (t === "TEXT" || t === "BLOB") ? sqlLiteralForDefault(raw) : raw;
            def += " DEFAULT " + dv;
        }
        return def;
    });
    if (pkCols.length > 1) {
        colDefs.push("  PRIMARY KEY (" + pkCols.map(c => c.name).join(", ") + ")");
    }
    let ddl = "CREATE TABLE IF NOT EXISTS " + tbl.name + " (\n" + colDefs.join(",\n") + "\n);";
    // INDEX
    const idxCols = cols.filter(c => c.index && !c.pk);
    idxCols.forEach(c => {
        ddl += "\nCREATE INDEX IF NOT EXISTS idx_" + tbl.name + "_" + c.name +
            " ON " + tbl.name + " (" + c.name + ");";
    });
    return ddl;
}

function tblTypeOpen(idx, btn) {
    const float = $("col-type-float");
    if (!float) { return; }
    if (!TABLE_MODAL.edit || !TABLE_MODAL.edit.columns[idx]) return;
    const curType = TABLE_MODAL.edit.columns[idx].type || "TEXT";
    // 既に開いていて同じインデックスならclose
    if (float.classList.contains("open") && float.dataset.colidx == idx) {
        float.classList.remove("open");
        return;
    }
    // ドロップダウン内容を構築
    float.innerHTML = SQLITE_TYPES.map(t => render("tv-tpl-col-type-opt", {
        active: t === curType ? "active" : "",
        type: t,
    })).join("");
    // クリックハンドラを追加
    float.querySelectorAll(".col-type-opt").forEach(opt => {
        opt.addEventListener("click", function (e) {
            e.stopPropagation();
            const type = this.dataset.type;
            tblTypeSelect(idx, type);
        });
    });
    // 位置を計算
    const r = btn.getBoundingClientRect();
    float.style.left = r.left + "px";
    float.style.top = (r.bottom + 2) + "px";
    float.style.minWidth = r.width + "px";
    float.dataset.colidx = idx;
    float.classList.add("open");
}

// カラム型の選択
function tblTypeSelect(idx, type) {
    const t = type.trim();
    if (!TABLE_MODAL.edit || !TABLE_MODAL.edit.columns[idx]) return;
    TABLE_MODAL.edit.columns[idx].type = t;
    // ボタンラベル更新
    const btn = document.querySelector(".col-type-btn[data-colidx='" + idx + "'] .col-type-lbl");
    if (btn) btn.textContent = t;
    // フローティングを閉じる
    const float = $("col-type-float");
    if (float) float.classList.remove("open");
}

// テーブル保存
function tblSave() {
    tblSyncFromDOM();
    const tbl = TABLE_MODAL.edit;
    if (!tbl.name.trim()) { showVjaAlert("テーブル名を入力してください"); return; }
    // テーブル名重複チェック（自分自身は除外）
    const dupIdx = getProjectData().tables.findIndex((t, i) => t.name === tbl.name.trim() && i !== TABLE_MODAL.editIdx);
    if (dupIdx >= 0) { showVjaAlert("テーブル名「" + tbl.name + "」は既に存在します"); return; }
    // 空カラムを除去（バリデーション用。TABLE_MODAL.edit.columnsはまだ書き換えない）
    const validCols = (tbl.columns || []).filter(c => c.name.trim());
    if (validCols.length === 0) { showVjaAlert("カラムを1つ以上定義してください"); return; }
    // DEFAULTバリデーション
    for (const c of validCols) {
        if (!c.useDefault) continue;
        // チェックON＋空 → 型別デフォルト値を自動セット
        if (!c.default || c.default.trim() === "") {
            c.default = defaultValueForType(c.type);
        } else if (!validateDefaultValue(c.type, c.default.trim())) {
            // TEXT/BLOBはsqlLiteralForDefault()が自動でクォートするため、この
            // バリデーションには到達しない（対象はINTEGER/REAL/NUMERICのみ）
            const hints = {
                "INTEGER": "整数値（例: 0, -1）またはNULL",
                "REAL": "実数値（例: 0.0, 3.14）またはNULL",
                "NUMERIC": "数値（例: 0, 1.5）またはNULL",
            };
            const hint = hints[(c.type || "TEXT").toUpperCase()] || "型に合った値";
            showVjaAlert("カラム「" + c.name + "」のDEFAULT値が不正です。\n型: " + c.type + "\n期待する形式: " + hint);
            return;
        }
    }
    tbl.name = tbl.name.trim();
    tbl.columns = validCols; // バリデーション通過後に空カラムを除去して代入
    tbl.updatedAt = new Date().toISOString(); // テーブル更新時刻を記録
    if (TABLE_MODAL.editIdx < 0) {
        getProjectData().tables.push(tbl);
    } else {
        getProjectData().tables[TABLE_MODAL.editIdx] = tbl;
    }
    pushUndo();
    showToast("テーブル「" + tbl.name + "」を保存しました");
    // ウィザードの「✏️ 編集」から来ている場合は、保存後にウィザードのカラム確認モーダルへ戻す
    if (typeof WIZARD_STATE !== "undefined" && WIZARD_STATE.resumeAfterTableEdit) {
        const resume = WIZARD_STATE.resumeAfterTableEdit;
        WIZARD_STATE.resumeAfterTableEdit = null;
        resume();
        return;
    }
    renderTableManagerModal();
}

/* ── フォーム定数エディタ ── */
/* ── バリデーション定義エディタ（テーブル管理と同じ構成） ── */
// バリデーションタイプ一覧
// 基本系: required/maxLength/minLength/range/numeric/integer
// パターン系: email/tel/zipcode/url/date/alphanumeric/alpha/hiragana/katakana
// 上級系: pattern（arg1=正規表現）
// VALIDATION_TYPES（バリデーションルール種類一覧）は
// init-params.js で window.VALIDATION_TYPES として定義済み

function openValidationEditor() {
    const f = getProjectData().forms[getProjectData().curFormIdx];
    if (!f) return;
    if (!Array.isArray(f.validations)) f.validations = [];
    renderValidationListModal();
}

// ── バリデーション一覧モーダル（テーブル管理の一覧と同じ構成） ──
function renderValidationListModal() {
    const f = getProjectData().forms[getProjectData().curFormIdx];
    renderListManagerModal({
        title: "✅ バリデーション管理",
        items: f.validations || [],
        colCount: 6,
        emptyText: "バリデーション定義がありません。「＋ バリデーション追加」から追加してください。",
        countLabel: (n) => "バリデーション定義（全" + n + "件）",
        addAction: "openValidationEdit(-1)",
        addLabel: "＋ バリデーション追加",
        headerHtml: "<th style='width:40px'>No</th><th style='text-align:left'>定義名</th><th style='text-align:left'>説明</th><th style='width:80px'>ルール数</th><th style='width:80px'>編集</th><th style='width:80px'>削除</th>",
        rowHtmlFn: (v, i) => "<tr>" +
            "<td style='text-align:center'>" + (i + 1) + "</td>" +
            "<td>" + esc(v.name || "") + "</td>" +
            "<td style='max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" + esc(v.description || "") + "</td>" +
            "<td style='text-align:center'>" + (v.rules?.length || 0) + "</td>" +
            "<td style='text-align:center'>" +
            "<button class='tbl-action-btn'" + evtAttr("onmousedown", "openValidationEdit(" + i + ")") + ">編集</button>" +
            "</td>" +
            "<td style='text-align:center'>" +
            "<button class='tbl-action-btn del'" + evtAttr("onmousedown", "deleteValidation(" + i + ")") + ">削除</button>" +
            "</td>" +
            "</tr>",
    });
}

// ── バリデーション編集モーダル ──
function openValidationEdit(idx) {
    const f = getProjectData().forms[getProjectData().curFormIdx];
    if (!Array.isArray(f.validations)) f.validations = [];
    VALID_MODAL.edit = idx < 0
        ? { name: "", toastDuration: 5000, rules: [] }
        : JSON.parse(JSON.stringify(f.validations[idx]));
    VALID_MODAL.edit._idx = idx;
    // 初期表示で3件の空ルールを用意（既存ルールが3件未満の場合）
    while (VALID_MODAL.edit.rules.length < 3) {
        VALID_MODAL.edit.rules.push({ name: "", type: "required", not: false, arg1: "", arg2: "", arg3: "", message: "" });
    }
    renderValidationEditModal();
}

function renderValidationEditModal() {
    const v = VALID_MODAL.edit;
    const rules = v.rules || [];
    const tbody = rules.map((r, i) => {
        const sid = "valid-type-" + i;
        const nid = "valid-name-" + i;
        const notid = "valid-not-" + i;
        const INPUT_TAGS = ["inputtype", "textarea", "checkbox", "radiobutton", "selectBox", "listbox", "slider"];
        const widgetNames = ["", ...(getProjectData().forms[getProjectData().curFormIdx]?.widgets || [])
            .filter(w => INPUT_TAGS.includes(w.tag))
            .map(w => w.name)
            .filter(Boolean)];
        const nameOpts = widgetNames.map(n => ({ value: n, label: n === "" ? "（未選択）" : n }));
        return render("tv-tpl-valid-row", {
            no: i + 1,
            nameSel: makePvSel(nid, nameOpts, r.name || "", "VALID_MODAL.edit.rules[" + i + "].name={value}"),
            typeSel: makePvSel(sid, VALIDATION_TYPES, r.type || "required", "VALID_MODAL.edit.rules[" + i + "].type={value}"),
            notSel: makePvSel(notid, [{ value: "false", label: "OFF" }, { value: "true", label: "ON" }], r.not ? "true" : "false", "VALID_MODAL.edit.rules[" + i + "].not=({value}==='true')"),
            arg1: r.arg1 || "", attrArg1: evtAttr("oninput", "VALID_MODAL.edit.rules[" + i + "].arg1=this.value"),
            arg2: r.arg2 || "", attrArg2: evtAttr("oninput", "VALID_MODAL.edit.rules[" + i + "].arg2=this.value"),
            arg3: r.arg3 || "", attrArg3: evtAttr("oninput", "VALID_MODAL.edit.rules[" + i + "].arg3=this.value"),
            message: r.message || "", attrMessage: evtAttr("oninput", "VALID_MODAL.edit.rules[" + i + "].message=this.value"),
            attrInsert: evtAttr("onmousedown", "validInsertRow(" + i + ")"),
            attrDel: evtAttr("onmousedown", "validDelRow(" + i + ")"),
        });
    }).join("");
    showModal(render("tv-tpl-valid-edit-modal", {
        header: mhdrHTML("✅ バリデーション編集"),
        name: v.name || "",
        attrName: evtAttr("oninput", "VALID_MODAL.edit.name=this.value"),
        description: v.description || "",
        attrDesc: evtAttr("oninput", "VALID_MODAL.edit.description=this.value"),
        attrAiGen: evtAttr("onmousedown", "validAiGenerateRules()"),
        toastDuration: v.toastDuration || 5000,
        attrToast: evtAttr("oninput", "VALID_MODAL.edit.toastDuration=parseInt(this.value)||5000"),
        ruleCount: rules.length,
        attrAddRow: evtAttr("onmousedown", "validAddRow()"),
        tbody,
        footBtns: mfootHTML([{ label: "← 一覧に戻る", action: "renderValidationListModal()" }]),
        attrSave: evtAttr("onmousedown", "validSave()"),
    }), "", "modal-root");
}

// ── 行操作共通ヘルパー ────────────────────────────────────
// AddRow/InsertRow/DelRow の push/splice+render パターンを共通化。
// getRows: 対象配列を返す関数、defaultRow: 新規行オブジェクトを返す関数
// fallback: DelRow時に配列が空になった場合の補填行（nullなら補填しない）
function rowAdd(getRows, defaultRow, renderFn, maxLen = Infinity) {
    const rows = getRows();
    if (!rows || rows.length >= maxLen) return;
    rows.push(defaultRow());
    renderFn();
}
function rowInsert(getRows, idx, defaultRow, renderFn, maxLen = Infinity) {
    const rows = getRows();
    if (!rows || rows.length >= maxLen) return;
    rows.splice(idx, 0, defaultRow());
    renderFn();
}
function rowDel(getRows, idx, fallback, renderFn) {
    const rows = getRows();
    if (!rows) return;
    rows.splice(idx, 1);
    if (rows.length === 0 && fallback) rows.push(fallback());
    renderFn();
}

// ── 行リストモーダル共通テンプレート ──────────────────────
// 「ヘッダー＋行リスト＋行追加ボタン＋保存ボタン」の構造を持つモーダルの共通骨格。
// 行の中身（何列・どんな入力か）は rowHtmlFn コールバックで呼び出し側が自由に定義する。
// opts: {
//   modalId, title, infoText, headerHtml, rows,
//   rowHtmlFn: (row, idx) => "<tr>...</tr>",
//   addAction, saveAction, maxLen, extraHtml
// }
function renderRowListModal(opts) {
    const rows = opts.rows || [];
    const tbody = rows.map((r, i) => opts.rowHtmlFn(r, i)).join("");
    const addBtn = (!opts.maxLen || rows.length < opts.maxLen)
        ? render("tv-tpl-add-row-btn", { attr: evtAttr("onmousedown", opts.addAction) })
        : "";
    showModal(render("tv-tpl-row-list-modal", {
        modalId: opts.modalId,
        header: mhdrHTML(opts.title),
        infoText: opts.infoText,
        extraHtml: opts.extraHtml || "",
        headerHtml: opts.headerHtml,
        tbody,
        addBtn,
        footBtns: mfootHTML([{ label: "キャンセル", action: "closeModal()" }]),
        attrSave: evtAttr("onmousedown", opts.saveAction),
    }));
}

// ── 一覧管理モーダル共通テンプレート ──────────────────────
// 「ヘッダー＋一覧テーブル＋編集/削除ボタン＋追加ボタン＋閉じるボタン」の
// 構造を持つモーダルの共通骨格。行の中身は rowHtmlFn コールバックで
// 呼び出し側が自由に定義する。
// opts: {
//   title, items, colCount, emptyText, countLabel(n),
//   addAction, addLabel, headerHtml,
//   rowHtmlFn: (item, idx) => "<tr>...</tr>",
// }
function renderListManagerModal(opts) {
    const items = opts.items || [];
    const rows = items.length > 0
        ? items.map((item, i) => opts.rowHtmlFn(item, i)).join("")
        : render("tv-tpl-empty-row", { colCount: opts.colCount, emptyText: opts.emptyText });
    showModal(render("tv-tpl-list-manager-modal", {
        header: mhdrHTML(opts.title),
        countLabel: opts.countLabel(items.length),
        attrAdd: evtAttr("onmousedown", opts.addAction),
        addLabel: opts.addLabel,
        headerHtml: opts.headerHtml,
        rows,
        attrClose: evtAttr("onmousedown", "closeModal()"),
    }));
}

function validAddRow() {
    if (!VALID_MODAL.edit) return;
    rowAdd(() => VALID_MODAL.edit.rules, () => ({ name: "", type: "required", not: false, arg1: "", arg2: "", arg3: "", message: "" }), renderValidationEditModal);
}
function validInsertRow(idx) {
    if (!VALID_MODAL.edit) return;
    rowInsert(() => VALID_MODAL.edit.rules, idx, () => ({ name: "", type: "required", not: false, arg1: "", arg2: "", arg3: "", message: "" }), renderValidationEditModal);
}
function validDelRow(idx) {
    if (!VALID_MODAL.edit) return;
    rowDel(() => VALID_MODAL.edit.rules, idx, null, renderValidationEditModal);
}

// AIに依頼して、定義名・説明・自由記述の依頼文からバリデーションルール一覧の雛形を生成する
async function validAiGenerateRules() {
    if (!getProjectData().aiConfig.enabled) {
        if (await vja.app.showConfirm("AI接続設定が有効になっていません。設定画面を開きますか？")) {
            closeModal();
            openAiConfig();
        }
        return;
    }

    const v = VALID_MODAL.edit;
    if (!v) return;
    const reqText = $("valid-ai-req-in")?.value?.trim() || "";
    if (!reqText && !v.name && !v.description) {
        showToast("定義名・説明・依頼文のいずれかを入力してください");
        $("valid-ai-req-in")?.focus();
        return;
    }

    const INPUT_TAGS = ["inputtype", "textarea", "checkbox", "radiobutton", "selectBox", "listbox", "slider"];
    const widgetNames = (getProjectData().forms[getProjectData().curFormIdx]?.widgets || [])
        .filter(w => INPUT_TAGS.includes(w.tag))
        .map(w => w.name)
        .filter(Boolean);
    if (widgetNames.length === 0) {
        showToast("フォームに入力系ウィジェットがありません（AI生成の対象がありません）");
        return;
    }

    // 既に意味のあるルール定義がある場合は上書き確認
    const hasExistingRules = (v.rules || []).some(r => (r.name || "").trim() !== "");
    if (hasExistingRules) {
        const ok = await vja.app.showConfirm(
            "既にルール定義があります。\nAIが生成する内容で上書きしますか？"
        );
        if (!ok) return;
    }

    const sysPrompt = _PROMPT_DEF.VALIDATION_SCHEMA_GEN_SYS_PROMPT({
        name: v.name, description: v.description, widgetsCtx: widgetNames.join("\n"),
    });
    const userPrompt = _PROMPT_DEF.VALIDATION_SCHEMA_GEN_USER_PROMPT(reqText);

    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        loadingMsg: "バリデーションルールを生成中…",
        onSuccess: async (generated) => {
            let rules;
            try {
                rules = JSON.parse(generated);
                if (!Array.isArray(rules)) throw new Error("not array");
            } catch (e) {
                showToast("AI生成結果の解析に失敗しました");
                return;
            }
            const sanitized = rules
                .filter(r => widgetNames.includes(r.name))
                .map(r => ({
                    name: r.name,
                    type: VALIDATION_TYPES.some(t => t.value === r.type) ? r.type : "required",
                    not: !!r.not,
                    arg1: r.arg1 != null ? String(r.arg1) : "",
                    arg2: r.arg2 != null ? String(r.arg2) : "",
                    arg3: r.arg3 != null ? String(r.arg3) : "",
                    message: r.message != null ? String(r.message) : "",
                }));
            if (sanitized.length === 0) {
                showToast("AI生成結果に有効なルールがありませんでした（対象ウィジェット名が一致しない可能性があります）");
                return;
            }
            while (sanitized.length < 3) {
                sanitized.push({ name: "", type: "required", not: false, arg1: "", arg2: "", arg3: "", message: "" });
            }
            VALID_MODAL.edit.rules = sanitized;
            renderValidationEditModal();
            showToast("✨ AIがバリデーションルールを生成しました");
        },
        onCancel: async () => {},
        onError: async () => {},
    });
}
function deleteValidation(idx) {
    const f = getProjectData().forms[getProjectData().curFormIdx];
    if (!f || !f.validations) return;
    f.validations.splice(idx, 1);
    pushUndo();
    renderValidationListModal();
}
function validSave() {
    const f = getProjectData().forms[getProjectData().curFormIdx];
    if (!f || !VALID_MODAL.edit) return;
    const name = $("valid-name")?.value?.trim();
    if (!name) { showVjaAlert("定義名を入力してください"); return; }
    VALID_MODAL.edit.name = name;
    VALID_MODAL.edit.description = $("valid-desc")?.value?.trim() || "";
    VALID_MODAL.edit.toastDuration = parseInt($("valid-toast-dur")?.value) || 5000;
    // 空ルールを除去（バリデーション用。VALID_MODAL.edit.rulesはまだ書き換えない）
    const validRules = (VALID_MODAL.edit.rules || []).filter(r => r.name.trim() && r.type);
    if (!Array.isArray(f.validations)) f.validations = [];
    const saveData = { name: VALID_MODAL.edit.name, description: VALID_MODAL.edit.description, toastDuration: VALID_MODAL.edit.toastDuration, rules: validRules };
    if (VALID_MODAL.edit._idx < 0) {
        f.validations.push(saveData);
    } else {
        f.validations[VALID_MODAL.edit._idx] = saveData;
    }
    pushUndo();
    showToast("バリデーション定義を保存しました");
    renderValidationListModal();
}

/* ═══════════════════════════════════════════
   window へのエクスポート（他ファイルから参照される関数のみ）
═══════════════════════════════════════════ */
Object.assign(window, {
    // 閉じる確認
    commitCurrentInput, isDirty, confirmClose,
    showCloseConfirm, hideCloseConfirm, onConfirmOk, doClose,
    // 定数編集・行リストモーダル共通テンプレート
    openConstEditor, renderConstModal, renderConstModalBase,
    syncConstFromDOM, constUpdate, constAddRow, constDelRow,
    constSaveBase, constSave,
    makePvSel, pvSelOpen, pvSelPick,
    rowAdd, rowInsert, rowDel, renderRowListModal, renderListManagerModal,
    // テーブル管理
    openTableManager, renderTableManagerModal, deleteTable, openTableEdit,
    defaultColumn, renderTableEditModal, renderMasterCsvArea,
    tblUploadMasterCsv, tblReuploadMasterCsv, tblOnCsvSelected,
    compressCsv, decompressCsv,
    tblDownloadMasterCsv, tblDeleteMasterCsv,
    defaultValueForType, validateDefaultValue,
    tblColUpdate, tblColUpdatePk, tblColAdd, tblColInsert, tblColDelete,
    tblSyncFromDOM, tblShowDdl, generateDDL, tblTypeOpen, tblTypeSelect, tblSave, tblAiGenerateSchema,
    sanitizeAiTableColumns,
    // バリデーション編集
    openValidationEditor, renderValidationListModal, openValidationEdit,
    renderValidationEditModal,
    validAddRow, validInsertRow, validDelRow, deleteValidation, validSave, validAiGenerateRules,
});
