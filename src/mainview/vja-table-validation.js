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
                el.dispatchEvent(new Event("change", {bubbles: true}));
                el.dispatchEvent(new Event("blur", {bubbles: true}));
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
            _CONFIRM_MODAL.okCb = onOk || null;
            document.getElementById("close-confirm").classList.add("show");
        }
        function hideCloseConfirm() {
            document.getElementById("close-confirm").classList.remove("show");
            _CONFIRM_MODAL.okCb = null;
        }
        function _onConfirmOk() {
            const cb = _CONFIRM_MODAL.okCb;
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
            _CONST_MODAL.rows = getProjectData().constants.map(c => ({name: c.name || "", value: c.value || ""}));
            if (_CONST_MODAL.rows.length === 0) _CONST_MODAL.rows.push({name: "", value: ""});
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
            const rows = _CONST_MODAL.rows || [];
            let tbody = "";
            rows.forEach((r, i) => {
                const oi_n = "constUpdate(" + i + ",'name',this.value)";
                const oi_v = "constUpdate(" + i + ",'value',this.value)";
                tbody += "<tr>"
                    + "<td>" + (i + 1) + "</td>"
                    + "<td><input type='text' value='" + esc(r.name) + "'" + evtAttr("oninput", oi_n) + " placeholder='定数名'></td>"
                    + "<td><input type='text' value='" + esc(r.value) + "'" + evtAttr("oninput", oi_v) + " placeholder='値'></td>"
                    + "<td><button class='del-btn'" + evtAttr("onmousedown", "constDelRow(" + i + ",'" + delRenderFn + "')") + " title='削除'>✕</button></td>"
                    + "</tr>";
            });
            showModal("<div id='const-modal'>"
                + mhdrHTML(title)
                + "<div class='mbody' style='gap:6px'>"
                + "<div class='infobox'>" + infoText + "</div>"
                + "<div class='const-scroll'>"
                + "<table class='const-table'>"
                + "<thead><tr><th style='width:36px'>No</th><th>定数名</th><th>値</th><th style='width:30px'></th></tr></thead>"
                + "<tbody>" + tbody + "</tbody>"
                + "</table>"
                + "</div>"
                + "<button class='add-row-btn'" + evtAttr("onmousedown", addAction) + ">＋ 行を追加</button>"
                + "</div>"
                + "<div class='mfoot'>"
                + mfootHTML([{label: "キャンセル", action: "closeModal()"}])
                + "<button class='pri'" + evtAttr("onmousedown", saveAction) + ">保存</button>"
                + "</div>"
                + "</div>");
        }

        // DOM から現在の入力値を _CONST_MODAL.rows に同期する
        function syncConstFromDOM() {
            const tbody = document.querySelector("#const-modal .const-table tbody");
            if (!tbody || !_CONST_MODAL.rows) return;
            const rows = tbody.querySelectorAll("tr");
            rows.forEach((tr, i) => {
                const inputs = tr.querySelectorAll("input");
                if (inputs.length >= 2 && _CONST_MODAL.rows[i]) {
                    _CONST_MODAL.rows[i].name = inputs[0].value;
                    _CONST_MODAL.rows[i].value = inputs[1].value;
                }
            });
        }

        function constUpdate(idx, key, val) {
            if (_CONST_MODAL.rows) _CONST_MODAL.rows[idx][key] = val;
        }

        function constAddRow() {
            if (!_CONST_MODAL.rows) return;
            syncConstFromDOM(); // 現在の入力値を先に保存
            _CONST_MODAL.rows.push({name: "", value: ""});
            renderConstModal();
        }

        function constDelRow(idx, renderFnName) {
            if (!_CONST_MODAL.rows) return;
            syncConstFromDOM(); // 現在の入力値を先に保存
            _CONST_MODAL.rows.splice(idx, 1);
            if (_CONST_MODAL.rows.length === 0) _CONST_MODAL.rows.push({name: "", value: ""});
            (renderFnName ? window[renderFnName] : renderConstModal)();
        }

        // ── 定数保存共通ヘルパー ──────────────────────────────────
        // target=null → グローバル定数、target=フォームオブジェクト → フォーム定数
        function _constSaveBase(target) {
            syncConstFromDOM();
            const valid = (_CONST_MODAL.rows || []).filter(r => r.name.trim());
            const names = valid.map(r => r.name.trim());
            const dup = names.find((n, i) => names.indexOf(n) !== i);
            if (dup) {showVjaAlert("定数名「" + dup + "」が重複しています"); return;}
            const saved = valid.map(r => ({name: r.name.trim(), value: r.value}));
            if (target === null) {
                getProjectData().constants = saved;
            } else {
                target.constants = saved;
                showToast("フォーム定数を保存しました（" + saved.length + "件）");
            }
            closeModal();
            pushUndo();
        }
        function constSave() {_constSaveBase(null);}

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
                return "<div class='pv-sel-opt" + (isActive ? " active" : "") + "' " +
                    "onmousedown=\"pvSelPick('" + id + "','" + String(val).replace(/'/g, "\\'") + "','" + String(lbl).replace(/'/g, "\\'") + "',event);" + code + "\">" + esc(lbl) + "</div>";
            }).join("");
            const curLabel = (() => {
                const found = options.find(o => (typeof o === "object" ? o.value : o) === currentVal);
                if (found) return typeof found === "object" ? (found.label || found.value) : found;
                return currentVal || (options.length > 0 ? (typeof options[0] === "object" ? options[0].label : options[0]) : "");
            })();
            return "<div class='pv-sel' id='" + id + "'>" +
                "<div class='pv-sel-btn' onmousedown=\"pvSelOpen('" + id + "',event)\">" +
                "<span>" + esc(curLabel) + "</span><span class='arr'>▼</span>" +
                "</div>" +
                "<div class='pv-sel-list'>" + opts + "</div>" +
                "</div>";
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
                rowHtmlFn: (t, i) => {
                    const colCount = t.columns ? t.columns.length : 0;
                    const idxCount = t.columns ? t.columns.filter(c => c.index).length : 0;
                    return "<tr>" +
                        "<td>" + (i + 1) + "</td>" +
                        "<td style='font-weight:bold'>" + esc(t.name) + "</td>" +
                        "<td style='text-align:center'>" + colCount + "</td>" +
                        "<td style='text-align:center'>" + idxCount + "</td>" +
                        "<td style='text-align:center'>" +
                        "<button class='tbl-action-btn'" + evtAttr("onmousedown", "openTableEdit(" + i + ")") + ">編集</button>" +
                        "</td>" +
                        "<td style='text-align:center'>" +
                        "<button class='tbl-action-btn del'" + evtAttr("onmousedown", "deleteTable(" + i + ")") + ">削除</button>" +
                        "</td>" +
                        "</tr>";
                },
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
                ? {name: "", description: "", columns: [defaultColumn()]}
                : JSON.parse(JSON.stringify(getProjectData().tables[idx])); // ディープコピー
            if (!tbl.columns || tbl.columns.length === 0) tbl.columns = [defaultColumn()];
            _TABLE_MODAL.editIdx = idx;
            _TABLE_MODAL.edit = tbl;
            renderTableEditModal();
        }

        function defaultColumn() {
            return {name: "", type: "TEXT", notNull: false, pk: false, index: false, useDefault: false, default: ""};
        }

        function renderTableEditModal() {
            const tbl = _TABLE_MODAL.edit;
            const isNew = _TABLE_MODAL.editIdx < 0;
            const cols = tbl.columns || [];

            let tbody = cols.map((c, i) => {
                const oi_name = "tblColUpdate(" + i + ",'name',this.value)";
                const oi_notNull = "tblColUpdate(" + i + ",'notNull',this.checked)";
                const oi_pk = "tblColUpdatePk(" + i + ",this.checked)";
                const oi_index = "tblColUpdate(" + i + ",'index',this.checked)";
                const oi_default = "tblColUpdate(" + i + ",'default',this.value)";
                const oi_useDefault = "tblColUpdate(" + i + ",'useDefault',this.checked)";
                const defCell =
                    "<input class='col-check' type='checkbox' " + (c.useDefault ? "checked" : "") + evtAttr("onchange", oi_useDefault) + " style='margin-right:6px'>" +
                    "<input class='col-input' type='text' value='" + esc(c.default || "") + "' " +
                    evtAttr("oninput", oi_default) + " placeholder='" + esc(defaultValueForType(c.type)) + "' style='width:72px'>";
                return "<tr id='col-row-" + i + "'>" +
                    "<td>" + (i + 1) + "</td>" +
                    "<td><input class='col-input' type='text' value='" + esc(c.name) + "' " +
                    evtAttr("oninput", oi_name) + " placeholder='カラム名'></td>" +
                    "<td>" +
                    "<button type='button' class='col-type-btn' data-colidx='" + i + "'>" +
                    "<span class='col-type-lbl'>" + esc(c.type || "TEXT") + "</span>" +
                    "<span class='arr'>▼</span></button>" +
                    "</td>" +
                    "<td><input class='col-check' type='checkbox' " + (c.notNull ? "checked" : "") + " " +
                    evtAttr("onchange", oi_notNull) + "></td>" +
                    "<td><input class='col-check' type='checkbox' " + (c.pk ? "checked" : "") + " " +
                    evtAttr("onchange", oi_pk) + "></td>" +
                    "<td><input class='col-check' type='checkbox' " + (c.index ? "checked" : "") + " " +
                    evtAttr("onchange", oi_index) + "></td>" +
                    "<td style='white-space:nowrap'>" + defCell + "</td>" +
                    "<td style='white-space:nowrap'><button class='tbl-action-btn'" + evtAttr("onmousedown", "tblColInsert(" + i + ")") + " style='margin-right:2px'>＋</button><button class='tbl-action-btn del'" + evtAttr("onmousedown", "tblColDelete(" + i + ")") + ">✕</button></td>" +
                    "</tr>";
            }).join("");

            showModal(
                mhdrHTML(isNew ? "➕ テーブル新規作成" : "✏ テーブル編集") +
                "<div class='mbody tbl-edit-wrap'>" +
                // テーブル名
                "<div class='tbl-name-row'><label>テーブル名</label>" +
                "<input id='tbl-name-in' value='" + esc(tbl.name) + "' placeholder='例: users' " +
                evtAttr("oninput", "_TABLE_MODAL.edit.name=this.value") + "></div>" +
                // 説明
                "<div class='tbl-desc-row'><label>説明（任意）</label>" +
                "<textarea id='tbl-desc-in'" + evtAttr("oninput", "_TABLE_MODAL.edit.description=this.value") + ">" + esc(tbl.description || "") + "</textarea></div>" +
                // マスターCSV
                _renderMasterCsvArea(tbl) +
                // カラム一覧
                "<div style='display:flex;justify-content:space-between;align-items:center'>" +
                "<span style='font-size:12px;color:var(--text2)'>カラム定義（" + cols.length + "列）</span>" +
                "<button class='col-add-btn'" + evtAttr("onmousedown", "tblColAdd()") + ">＋ カラム追加</button>" +
                "</div>" +
                "<div class='col-list-scroll'>" +
                "<table class='col-list-table'>" +
                "<thead><tr>" +
                "<th style='width:32px'>No</th>" +
                "<th style='text-align:left;min-width:120px'>カラム名</th>" +
                "<th style='width:100px'>型</th>" +
                "<th style='width:64px'>NOT NULL</th>" +
                "<th style='width:48px'>KEY</th>" +
                "<th style='width:72px'>インデックス</th>" +
                "<th style='min-width:90px'>DEFAULT</th>" +
                "<th style='width:40px'>削除</th>" +
                "</tr></thead>" +
                "<tbody id='col-tbody'>" + tbody + "</tbody>" +
                "</table></div>" +
                // DDL プレビュー
                "<div style='font-size:11px;color:var(--text3);margin-top:2px'>" +
                "<span" + evtAttr("onmousedown", "tblShowDdl()") + " style='cursor:pointer;text-decoration:underline'>DDLプレビューを表示</span>" +
                "</div>" +
                "<pre id='tbl-ddl-preview' style='display:none;background:var(--bg3);border:1px solid var(--border);" +
                "border-radius:3px;padding:8px;font-size:11px;color:#98d982;overflow-x:auto;white-space:pre-wrap'></pre>" +
                "</div>" +
                "<div class='mfoot'>" +
                "<button" + evtAttr("onmousedown", "openTableManager()") + ">← 一覧に戻る</button>" +
                "<button class='pri'" + evtAttr("onmousedown", "tblSave()") + ">保存</button>" +
                "</div>"
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
                    }, {capture: false});
                }
            });
        }

        // ── マスターCSV管理 ──────────────────────────────────

        // マスターCSVエリアのHTMLを生成する
        function _renderMasterCsvArea(tbl) {
            const csv = tbl.masterCsv;
            if (csv && csv.data) {
                const origKb = csv.originalSize ? (csv.originalSize / 1024).toFixed(1) + " KB" : "不明";
                const compKb = csv.compressedSize ? (csv.compressedSize / 1024).toFixed(1) + " KB" : "不明";
                return "<div class='tbl-csv-area'>" +
                    "<label>マスターCSV</label>" +
                    "<div class='tbl-csv-info'>" +
                    "<span>📄 " + esc(csv.filename || "master.csv") + "</span>" +
                    "<span style='color:var(--text2);font-size:11px'>" +
                    csv.rows + " 行 / 元サイズ: " + origKb + " / 圧縮後: " + compKb +
                    "</span>" +
                    "<div style='display:flex;gap:6px;margin-top:4px'>" +
                    "<button class='modal-btn'" + evtAttr("onmousedown", "tblDownloadMasterCsv()") + ">⬇ ダウンロード</button>" +
                    "<button class='modal-btn'" + evtAttr("onmousedown", "tblReuploadMasterCsv()") + ">🔄 再アップロード</button>" +
                    "<button class='modal-btn' style='color:#ff6b6b'" + evtAttr("onmousedown", "tblDeleteMasterCsv()") + ">🗑 削除</button>" +
                    "</div></div></div>";
            } else {
                return "<div class='tbl-csv-area'>" +
                    "<label>マスターCSV <span style='font-size:11px;color:var(--text2)'>（テーブルが空の場合に自動INSERT）</span></label>" +
                    "<button class='modal-btn'" + evtAttr("onmousedown", "tblUploadMasterCsv()") + ">📂 CSVをアップロード</button>" +
                    "<input type='file' id='tbl-csv-file' accept='.csv' style='display:none'" + evtAttr("onchange", "tblOnCsvSelected(event)") + ">" +
                    "</div>";
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
            const headers = _parseCsvLine(lines[0]);
            const tbl = _TABLE_MODAL.edit;
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
                const vals = _parseCsvLine(dataLines[i]);
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
                const compressed = await _compressCsv(text);
                _TABLE_MODAL.edit.masterCsv = {
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
        async function _compressCsv(text) {
            const enc = new TextEncoder();
            const input = enc.encode(text);
            const cs = new CompressionStream("gzip");
            const writer = cs.writable.getWriter();
            writer.write(input);
            writer.close();
            const chunks = [];
            const reader = cs.readable.getReader();
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            const total = chunks.reduce((s, c) => s + c.length, 0);
            const result = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) {result.set(chunk, offset); offset += chunk.length;}
            return btoa(String.fromCharCode(...result));
        }

        // Base64+gzip → 元のCSVテキストに展開
        async function _decompressCsv(b64) {
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
                const {done, value} = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            const total = chunks.reduce((s, c) => s + c.length, 0);
            const result = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) {result.set(chunk, offset); offset += chunk.length;}
            return new TextDecoder().decode(result);
        }

        // CSV1行をパースする（ダブルクォート対応）
        function _parseCsvLine(line) {
            const result = [];
            let cur = "", inQ = false;
            for (let i = 0; i < line.length; i++) {
                const c = line[i];
                if (inQ) {
                    if (c === '"' && line[i + 1] === '"') {cur += '"'; i++;}
                    else if (c === '"') inQ = false;
                    else cur += c;
                } else {
                    if (c === '"') inQ = true;
                    else if (c === ',') {result.push(cur); cur = "";}
                    else cur += c;
                }
            }
            result.push(cur);
            return result;
        }

        // マスターCSVをダウンロードする
        async function tblDownloadMasterCsv() {
            const csv = _TABLE_MODAL.edit.masterCsv;
            if (!csv?.data) return;
            try {
                const text = await _decompressCsv(csv.data);
                const defaultName = csv.filename || (_TABLE_MODAL.edit.name + "_master.csv");
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
            delete _TABLE_MODAL.edit.masterCsv;
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

        // デフォルト値が型に合っているか検証（空＝デフォルト値を使用、入力あり＝バリデート）
        function validateDefaultValue(type, value) {
            if (!value || value === "") return true;
            var v = value.trim();
            var t = (type || "TEXT").toUpperCase();
            if (v.toUpperCase() === "NULL") return true;
            if (t === "INTEGER") return /^-?[0-9]+$/.test(v);
            if (t === "REAL" || t === "NUMERIC") return /^-?[0-9]+([.][0-9]+)?$/.test(v);
            if (t === "TEXT" || t === "BLOB") {
                return (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")
                    || /^-?[0-9]+$/.test(v)
                    || v === "''";
            }
            return true;
        }

        function tblColUpdate(idx, key, val) {
            if (!_TABLE_MODAL.edit || !_TABLE_MODAL.edit.columns[idx]) return;
            _TABLE_MODAL.edit.columns[idx][key] = val;
            if (key === "pk" && val) {
                // PKの場合はNOT NULLも自動ON
                _TABLE_MODAL.edit.columns[idx].notNull = true;
            }
        }

        // PK設定（1つのみ許可）
        function tblColUpdatePk(idx, val) {
            if (!_TABLE_MODAL.edit) return;
            _TABLE_MODAL.edit.columns.forEach((c, i) => {c.pk = (i === idx && val);});
            // 再描画
            renderTableEditModal();
        }

        // カラム追加
        function tblColAdd() {
            if (!_TABLE_MODAL.edit) return;
            // 現在のDOMから値を同期
            tblSyncFromDOM();
            _TABLE_MODAL.edit.columns.push(defaultColumn());
            renderTableEditModal();
        }

        // カラム挿入（指定行の前に追加）
        function tblColInsert(idx) {
            if (!_TABLE_MODAL.edit) return;
            tblSyncFromDOM();
            _TABLE_MODAL.edit.columns.splice(idx, 0, defaultColumn());
            renderTableEditModal();
        }

        // カラム削除
        function tblColDelete(idx) {
            if (!_TABLE_MODAL.edit) return;
            tblSyncFromDOM();
            _TABLE_MODAL.edit.columns.splice(idx, 1);
            if (_TABLE_MODAL.edit.columns.length === 0) _TABLE_MODAL.edit.columns.push(defaultColumn());
            renderTableEditModal();
        }

        // DOMから現在の入力値を同期
        function tblSyncFromDOM() {
            const tbl = _TABLE_MODAL.edit;
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
                // DEFAULT: 4番目のcheckboxがuseDefault、2番目のtextがdefault値
                if (cbs[3] !== undefined) tbl.columns[i].useDefault = cbs[3].checked;
                const txts = tr.querySelectorAll("input[type=text]");
                if (txts[1]) tbl.columns[i].default = txts[1].value;
            });
        }

        // DDLプレビュー表示
        function tblShowDdl() {
            tblSyncFromDOM();
            const tbl = _TABLE_MODAL.edit;
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
                    const dv = (c.default && c.default.trim() !== "") ? c.default.trim() : defaultValueForType(c.type);
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
            if (!float) {return;}
            if (!_TABLE_MODAL.edit || !_TABLE_MODAL.edit.columns[idx]) return;
            const curType = _TABLE_MODAL.edit.columns[idx].type || "TEXT";
            // 既に開いていて同じインデックスならclose
            if (float.classList.contains("open") && float.dataset.colidx == idx) {
                float.classList.remove("open");
                return;
            }
            // ドロップダウン内容を構築
            float.innerHTML = SQLITE_TYPES.map(t =>
                "<div class='col-type-opt " + (t === curType ? "active" : "") + "' " +
                "data-type='" + t + "'>" + t + "</div>"
            ).join("");
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
            if (!_TABLE_MODAL.edit || !_TABLE_MODAL.edit.columns[idx]) return;
            _TABLE_MODAL.edit.columns[idx].type = t;
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
            const tbl = _TABLE_MODAL.edit;
            if (!tbl.name.trim()) {showVjaAlert("テーブル名を入力してください"); return;}
            // テーブル名重複チェック（自分自身は除外）
            const dupIdx = getProjectData().tables.findIndex((t, i) => t.name === tbl.name.trim() && i !== _TABLE_MODAL.editIdx);
            if (dupIdx >= 0) {showVjaAlert("テーブル名「" + tbl.name + "」は既に存在します"); return;}
            // 空カラムを除去（バリデーション用。_TABLE_MODAL.edit.columnsはまだ書き換えない）
            const validCols = (tbl.columns || []).filter(c => c.name.trim());
            if (validCols.length === 0) {showVjaAlert("カラムを1つ以上定義してください"); return;}
            // DEFAULTバリデーション
            for (const c of validCols) {
                if (!c.useDefault) continue;
                // チェックON＋空 → 型別デフォルト値を自動セット
                if (!c.default || c.default.trim() === "") {
                    c.default = defaultValueForType(c.type);
                } else if (!validateDefaultValue(c.type, c.default.trim())) {
                    const hints = {
                        "INTEGER": "整数値（例: 0, -1）またはNULL",
                        "REAL": "実数値（例: 0.0, 3.14）またはNULL",
                        "NUMERIC": "数値（例: 0, 1.5）またはNULL",
                        "TEXT": "シングルクォート囲み（例: '' 、'default'）または数値、NULL",
                        "BLOB": "シングルクォート囲み（例: ''）またはNULL",
                    };
                    const hint = hints[(c.type || "TEXT").toUpperCase()] || "型に合った値";
                    showVjaAlert("カラム「" + c.name + "」のDEFAULT値が不正です。\n型: " + c.type + "\n期待する形式: " + hint);
                    return;
                }
            }
            tbl.name = tbl.name.trim();
            tbl.columns = validCols; // バリデーション通過後に空カラムを除去して代入
            tbl.updatedAt = new Date().toISOString(); // テーブル更新時刻を記録
            if (_TABLE_MODAL.editIdx < 0) {
                getProjectData().tables.push(tbl);
            } else {
                getProjectData().tables[_TABLE_MODAL.editIdx] = tbl;
            }
            pushUndo();
            showToast("テーブル「" + tbl.name + "」を保存しました");
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
            _VALID_MODAL.edit = idx < 0
                ? {name: "", toastDuration: 5000, rules: []}
                : JSON.parse(JSON.stringify(f.validations[idx]));
            _VALID_MODAL.edit._idx = idx;
            // 初期表示で3件の空ルールを用意（既存ルールが3件未満の場合）
            while (_VALID_MODAL.edit.rules.length < 3) {
                _VALID_MODAL.edit.rules.push({name: "", type: "required", not: false, arg1: "", arg2: "", arg3: "", message: ""});
            }
            renderValidationEditModal();
        }

        function renderValidationEditModal() {
            const v = _VALID_MODAL.edit;
            const rules = v.rules || [];
            let tbody = "";
            rules.forEach((r, i) => {
                const sid = "valid-type-" + i;
                const nid = "valid-name-" + i;
                const notid = "valid-not-" + i;
                const INPUT_TAGS = ["inputtype", "textarea", "checkbox", "radiobutton", "selectBox", "listbox", "slider"];
                const widgetNames = ["", ...(getProjectData().forms[getProjectData().curFormIdx]?.widgets || [])
                    .filter(w => INPUT_TAGS.includes(w.tag))
                    .map(w => w.name)
                    .filter(Boolean)];
                const nameOpts = widgetNames.map(n => ({value: n, label: n === "" ? "（未選択）" : n}));
                tbody += "<tr>" +
                    "<td>" + (i + 1) + "</td>" +
                    "<td>" + makePvSel(nid, nameOpts, r.name || "", "_VALID_MODAL.edit.rules[" + i + "].name={value}") + "</td>" +
                    "<td>" + makePvSel(sid, VALIDATION_TYPES, r.type || "required", "_VALID_MODAL.edit.rules[" + i + "].type={value}") + "</td>" +
                    "<td>" + makePvSel(notid, [{value: "false", label: "OFF"}, {value: "true", label: "ON"}], r.not ? "true" : "false", "_VALID_MODAL.edit.rules[" + i + "].not=({value}==='true')") + "</td>" +
                    "<td><input type='text' class='pv-input' value='" + esc(r.arg1 || "") + "'" + evtAttr("oninput", "_VALID_MODAL.edit.rules[" + i + "].arg1=this.value") + " placeholder='arg1'></td>" +
                    "<td><input type='text' class='pv-input' value='" + esc(r.arg2 || "") + "'" + evtAttr("oninput", "_VALID_MODAL.edit.rules[" + i + "].arg2=this.value") + " placeholder='arg2'></td>" +
                    "<td><input type='text' class='pv-input' value='" + esc(r.arg3 || "") + "'" + evtAttr("oninput", "_VALID_MODAL.edit.rules[" + i + "].arg3=this.value") + " placeholder='arg3'></td>" +
                    "<td><input type='text' class='pv-input' value='" + esc(r.message || "") + "'" + evtAttr("oninput", "_VALID_MODAL.edit.rules[" + i + "].message=this.value") + " placeholder='エラーメッセージ'></td>" +
                    "<td style='white-space:nowrap'>" +
                    "<button class='del-btn'" + evtAttr("onmousedown", "validInsertRow(" + i + ")") + " title='この行の前に挿入' style='margin-right:2px'>＋</button>" +
                    "<button class='del-btn'" + evtAttr("onmousedown", "validDelRow(" + i + ")") + " title='削除'>✕</button>" +
                    "</td>" +
                    "</tr>";
            });
            showModal("<div id='valid-edit-modal'>" +
                mhdrHTML("✅ バリデーション編集") +
                "<div class='mbody tbl-edit-wrap' style='gap:6px'>" +
                "<div class='tbl-name-row'><label>定義名</label>" +
                "<input id='valid-name' class='pv-input' value='" + esc(v.name || "") + "' placeholder='定義名'></div>" +
                "<div class='tbl-name-row'><label>説明（任意）</label>" +
                "<input id='valid-desc' class='pv-input' value='" + esc(v.description || "") + "' placeholder='バリデーションの説明（任意）'></div>" +
                "<div style='display:flex;align-items:center;gap:8px;padding:4px 0'>" +
                "<label style='font-size:12px;color:var(--text2);white-space:nowrap'>トースト表示時間（ms）:</label>" +
                "<input type='number' id='valid-toast-dur' class='pv-input' value='" + (v.toastDuration || 5000) + "' min='1000' max='30000' style='width:100px'>" +
                "</div>" +
                "<div style='display:flex;justify-content:space-between;align-items:center'>" +
                "<span style='font-size:12px;color:var(--text2)'>ルール定義（" + rules.length + "件）</span>" +
                "<button class='col-add-btn'" + evtAttr("onmousedown", "validAddRow()") + ">＋ ルール追加</button>" +
                "</div>" +
                "<div class='coldef-scroll'>" +
                "<table class='coldef-table'>" +
                "<thead><tr>" +
                "<th style='width:36px'>No</th>" +
                "<th>ウィジェット名</th>" +
                "<th style='width:130px'>タイプ</th>" +
                "<th style='width:60px'>NOT</th>" +
                "<th style='width:65px'>arg1</th>" +
                "<th style='width:65px'>arg2</th>" +
                "<th style='width:65px'>arg3</th>" +
                "<th>メッセージ</th>" +
                "<th style='width:56px'></th>" +
                "</tr></thead>" +
                "<tbody>" + tbody + "</tbody>" +
                "</table>" +
                "</div>" +
                "</div>" +
                "<div class='mfoot'>" +
                mfootHTML([{label: "← 一覧に戻る", action: "renderValidationListModal()"}]) +
                "<button class='pri'" + evtAttr("onmousedown", "validSave()") + ">保存</button>" +
                "</div>" +
                "</div>", "", "modal-root");
        }

        // ── 行操作共通ヘルパー ────────────────────────────────────
        // AddRow/InsertRow/DelRow の push/splice+render パターンを共通化。
        // getRows: 対象配列を返す関数、defaultRow: 新規行オブジェクトを返す関数
        // fallback: DelRow時に配列が空になった場合の補填行（nullなら補填しない）
        function _rowAdd(getRows, defaultRow, renderFn, maxLen = Infinity) {
            const rows = getRows();
            if (!rows || rows.length >= maxLen) return;
            rows.push(defaultRow());
            renderFn();
        }
        function _rowInsert(getRows, idx, defaultRow, renderFn, maxLen = Infinity) {
            const rows = getRows();
            if (!rows || rows.length >= maxLen) return;
            rows.splice(idx, 0, defaultRow());
            renderFn();
        }
        function _rowDel(getRows, idx, fallback, renderFn) {
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
            showModal("<div id='" + opts.modalId + "'>"
                + mhdrHTML(opts.title)
                + "<div class='mbody' style='gap:6px'>"
                + "<div class='infobox'>" + opts.infoText + "</div>"
                + (opts.extraHtml || "")
                + "<div class='coldef-scroll'>"
                + "<table class='coldef-table'>"
                + "<thead><tr>" + opts.headerHtml + "</tr></thead>"
                + "<tbody>" + tbody + "</tbody>"
                + "</table>"
                + "</div>"
                + (!opts.maxLen || rows.length < opts.maxLen ? "<button class='add-row-btn'" + evtAttr("onmousedown", opts.addAction) + ">＋ 行を追加</button>" : "")
                + "</div>"
                + "<div class='mfoot'>"
                + mfootHTML([{label: "キャンセル", action: "closeModal()"}])
                + "<button class='pri'" + evtAttr("onmousedown", opts.saveAction) + ">保存</button>"
                + "</div>"
                + "</div>");
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
                : "<tr><td colspan='" + opts.colCount + "' class='tbl-empty'>" + opts.emptyText + "</td></tr>";
            showModal(
                mhdrHTML(opts.title) +
                "<div class='mbody tbl-mgr-wrap'>" +
                "<div class='tbl-mgr-header'>" +
                "<span style='font-size:12px;color:var(--text2)'>" + opts.countLabel(items.length) + "</span>" +
                "<button class='tbl-add-btn'" + evtAttr("onmousedown", opts.addAction) + ">" + opts.addLabel + "</button>" +
                "</div>" +
                "<div class='tbl-list-scroll'>" +
                "<table class='tbl-list-table'>" +
                "<thead><tr>" + opts.headerHtml + "</tr></thead>" +
                "<tbody>" + rows + "</tbody>" +
                "</table></div>" +
                "</div>" +
                "<div class='mfoot'>" +
                "<button" + evtAttr("onmousedown", "closeModal()") + ">閉じる</button>" +
                "</div>"
            );
        }

        function validAddRow() {
            if (!_VALID_MODAL.edit) return;
            _rowAdd(() => _VALID_MODAL.edit.rules, () => ({name: "", type: "required", not: false, arg1: "", arg2: "", arg3: "", message: ""}), renderValidationEditModal);
        }
        function validInsertRow(idx) {
            if (!_VALID_MODAL.edit) return;
            _rowInsert(() => _VALID_MODAL.edit.rules, idx, () => ({name: "", type: "required", not: false, arg1: "", arg2: "", arg3: "", message: ""}), renderValidationEditModal);
        }
        function validDelRow(idx) {
            if (!_VALID_MODAL.edit) return;
            _rowDel(() => _VALID_MODAL.edit.rules, idx, null, renderValidationEditModal);
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
            if (!f || !_VALID_MODAL.edit) return;
            const name = $("valid-name")?.value?.trim();
            if (!name) {showVjaAlert("定義名を入力してください"); return;}
            _VALID_MODAL.edit.name = name;
            _VALID_MODAL.edit.description = $("valid-desc")?.value?.trim() || "";
            _VALID_MODAL.edit.toastDuration = parseInt($("valid-toast-dur")?.value) || 5000;
            // 空ルールを除去（バリデーション用。_VALID_MODAL.edit.rulesはまだ書き換えない）
            const validRules = (_VALID_MODAL.edit.rules || []).filter(r => r.name.trim() && r.type);
            if (!Array.isArray(f.validations)) f.validations = [];
            const saveData = {name: _VALID_MODAL.edit.name, description: _VALID_MODAL.edit.description, toastDuration: _VALID_MODAL.edit.toastDuration, rules: validRules};
            if (_VALID_MODAL.edit._idx < 0) {
                f.validations.push(saveData);
            } else {
                f.validations[_VALID_MODAL.edit._idx] = saveData;
            }
            pushUndo();
            showToast("バリデーション定義を保存しました");
            renderValidationListModal();
        }

        /* ═══════════════════════════════════════════
           window へのエクスポート（他ファイルから参照される関数のみ）
        ═══════════════════════════════════════════ */
        window.commitCurrentInput = commitCurrentInput;
        window.isDirty = isDirty;
        window.confirmClose = confirmClose;
        window.showCloseConfirm = showCloseConfirm;
        window.hideCloseConfirm = hideCloseConfirm;
        window._onConfirmOk = _onConfirmOk;
        window.doClose = doClose;
        window.openConstEditor = openConstEditor;
        window.renderConstModal = renderConstModal;
        window.renderConstModalBase = renderConstModalBase;
        window.syncConstFromDOM = syncConstFromDOM;
        window.constUpdate = constUpdate;
        window.constAddRow = constAddRow;
        window.constDelRow = constDelRow;
        window._constSaveBase = _constSaveBase;
        window.constSave = constSave;
        window.makePvSel = makePvSel;
        window.pvSelOpen = pvSelOpen;
        window.pvSelPick = pvSelPick;
        window.openTableManager = openTableManager;
        window.renderTableManagerModal = renderTableManagerModal;
        window.deleteTable = deleteTable;
        window.openTableEdit = openTableEdit;
        window.defaultColumn = defaultColumn;
        window.renderTableEditModal = renderTableEditModal;
        window._renderMasterCsvArea = _renderMasterCsvArea;
        window.tblUploadMasterCsv = tblUploadMasterCsv;
        window.tblReuploadMasterCsv = tblReuploadMasterCsv;
        window.tblOnCsvSelected = tblOnCsvSelected;
        window._compressCsv = _compressCsv;
        window._decompressCsv = _decompressCsv;
        window._parseCsvLine = _parseCsvLine;
        window.tblDownloadMasterCsv = tblDownloadMasterCsv;
        window.tblDeleteMasterCsv = tblDeleteMasterCsv;
        window.defaultValueForType = defaultValueForType;
        window.validateDefaultValue = validateDefaultValue;
        window.tblColUpdate = tblColUpdate;
        window.tblColUpdatePk = tblColUpdatePk;
        window.tblColAdd = tblColAdd;
        window.tblColInsert = tblColInsert;
        window.tblColDelete = tblColDelete;
        window.tblSyncFromDOM = tblSyncFromDOM;
        window.tblShowDdl = tblShowDdl;
        window.generateDDL = generateDDL;
        window.tblTypeOpen = tblTypeOpen;
        window.tblTypeSelect = tblTypeSelect;
        window.tblSave = tblSave;
        window.openValidationEditor = openValidationEditor;
        window.renderValidationListModal = renderValidationListModal;
        window.openValidationEdit = openValidationEdit;
        window.renderValidationEditModal = renderValidationEditModal;
        window._rowAdd = _rowAdd;
        window._rowInsert = _rowInsert;
        window._rowDel = _rowDel;
        window.renderRowListModal = renderRowListModal;
        window.renderListManagerModal = renderListManagerModal;
        window.validAddRow = validAddRow;
        window.validInsertRow = validInsertRow;
        window.validDelRow = validDelRow;
        window.deleteValidation = deleteValidation;
        window.validSave = validSave;

