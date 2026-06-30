/* ═══════════════════════════════════════════════════════════════
   vja-yaml-editor.js — YAML/JSエディタ本体
   ─────────────────────────────────────────────────────────────
   【読み込み順序】4番目（vja-modal.js の直後）。
   【依存】vja-defs.js, vja-designer.js, vja-modal.js（showModal/closeModal）
   【提供するもの】
     - openYaml() / openFormYaml() / saveYaml() / saveFormYaml()
     - deleteYaml() / deleteFormYaml()
     - openApiRef()（APIリファレンス表示）
     - buildYamlEditorHTML()（エディタモーダルのHTML生成）
     - yamlBuildRightPanel() と _rpBuildXxxSection() 系（右パネルの5セクション）
     - openAiConfig() / yamlAiGenerate() / runAiGenerate()（AI生成）
     - editorKeyHandler() 等のエディタ内キー操作
   このファイルは vja-defs.js / vja-designer.js / vja-modal.js に依存する。
═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════
  YAML EDITOR
═══════════════════════════════════════════ */

// YAMLテキストからナビゲーション項目を解析
function _parseApiRefNav(text) {
    const nav = []; // { type: 'category'|'func', label, anchor }
    let catIdx = 0, fnIdx = 0;
    text.split("\n").forEach(line => {
        if (/^##\s/.test(line)) {
            nav.push({ type: "category", label: line.replace(/^##\s*/, ""), anchor: "cat-" + catIdx++ });
        } else if (/^-\s*関数名:\s*/.test(line) || /^-\s*Function\s*(N|n)ame:\s*/.test(line)) {
            const label = line.replace(/^-\s*(関数名|Function\s*(N|n)ame):\s*/, "").trim();
            nav.push({ type: "func", label, anchor: "fn-" + fnIdx++ });
        }
    });
    return nav;
}

// APIリファレンスモーダルを開く
function openApiRef(isAppEvent) {
    const info = isAppEvent
        ? window._PROMPT_DEF.VJA_USE_BACK_JS_INFO
        : window._PROMPT_DEF.VJA_USE_FRONT_JS_INFO;
    const title = isAppEvent ? "📖 APIリファレンス（バックエンド）" : "📖 APIリファレンス（フロントエンド）";
    const nav = _parseApiRefNav(info);

    // 左パネルのナビゲーションHTML生成（カテゴリのみ）
    const navHtml = nav.filter(item => item.type === "category").map(item => {
        return "<div class='api-ref-cat' data-label='" + esc(item.label) + "'" + evtAttr("onmousedown", "_apiRefJump(this.dataset.label)") + ">" + esc(item.label) + "</div>";
    }).join("");

    showModal(
        mhdrHTML(title, "modal-layer-1") +
        "<div class='mbody' style='flex:1;min-height:0;overflow:hidden;padding:0;flex-direction:row;gap:0'>" +
        "<div id='api-ref-nav' style='width:260px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--border);padding:6px 0;background:var(--bg2);display:flex;flex-direction:column;gap:1px'>" +
        navHtml +
        "</div>" +
        "<div style='flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;padding:8px;overflow:hidden'>" +
        "<input id='api-ref-search' placeholder='🔍 検索...'" + evtAttr("oninput", "_apiRefFilter()") + " " +
        "style='height:30px;background:var(--bg3);border:1px solid var(--border);border-radius:3px;color:var(--text);font-size:13px;padding:0 10px;outline:none;flex-shrink:0;width:100%;box-sizing:border-box'>" +
        "<div id='api-ref-body' style='flex:1;overflow:auto;font-size:18px;line-height:1.7;font-family:monospace;background:var(--bg3);border:1px solid var(--border);border-radius:3px;padding:10px;white-space:pre-wrap;word-break:break-word;width:100%;box-sizing:border-box;user-select:text;-webkit-user-select:text'>" +
        yamlTokenize(info) +
        "</div>" +
        "</div>" +
        "</div>" +
        mfootHTML([{ label: "閉じる", action: 'closeModal("modal-layer-1")' }]),
        "modal-api-ref", "modal-layer-1"
    );

    window._apiRefRaw = info;

    // カテゴリラベルのテキストで該当行を検索してスクロール
    window._apiRefJump = function (label) {
        const body = document.getElementById("api-ref-body");
        if (!body) return;
        // bodyのテキストノードを走査して##行を探す
        const spans = body.querySelectorAll("span");
        for (const span of spans) {
            if (span.textContent.includes(label)) {
                body.scrollTop = span.offsetTop - body.offsetTop - 8;
                return;
            }
        }
    };

    // 検索フィルター
    window._apiRefFilter = function () {
        const q = (document.getElementById("api-ref-search")?.value || "").toLowerCase();
        const body = document.getElementById("api-ref-body");
        if (!body) return;
        if (!q) {
            body.innerHTML = yamlTokenize(window._apiRefRaw);
            return;
        }
        const lines = window._apiRefRaw.split("\n");
        body.innerHTML = lines.map(line => {
            const matched = line.toLowerCase().includes(q);
            const highlighted = yamlTokenize(line);
            return matched
                ? "<span style='background:var(--accent-dim,#2a3a6a);display:block'>" + highlighted + "</span>"
                : "<span style='opacity:0.3;display:block'>" + highlighted + "</span>";
        }).join("");
    };
}

function openYaml(wid, evName) {
    const w = getWidget(wid);
    if (!w) return;
    if (!w.events) w.events = {};
    const cur = w.events[evName] ||
        // 空の場合はデフォルトのYAMLセット.
        _PROMPT_DEF.DEFAULT_YAML_VALUE(evName, w.name);
    const curJs = (w.jsCode && w.jsCode[evName]) || "";
    const isAppEvent = (wid === "appev");
    pvRegister("yamlSave", () => saveYaml(wid, evName));
    pvRegister("yamlAiGen", () => yamlAiGenerate(wid, evName));
    showModal(buildYamlEditorHTML(cur, curJs, true, mhdrHTML("📋 " + esc(w.name) + " — " + esc(evName)), "", null, isAppEvent));
    initYamlEditorModal(cur, curJs);
}

/* ── YAMLエディタ 右パネル ── */

// 右パネルHTML生成
// ── 右パネル: 定数セクション ──
// グローバル定数＋現在フォームのフォーム定数を一覧表示する。
function _rpBuildConstSection() {
    const curForm = getProjectData().forms[getProjectData().curFormIdx];
    const _formConsts = curForm?.constants || [];
    const _allConsts = [...getProjectData().constants, ..._formConsts];
    return _allConsts.length > 0
        ? "<table class='rp-table'>"
        + _allConsts.map(c => {
            const isForm = _formConsts.some(fc => fc.name === c.name);
            const n = esc(c.name), v = esc(c.value);
            return "<tr class='rp-insert' data-insert='" + n + "'>"
                + "<td class='rp-name-col'>" + n + "</td>"
                + "<td class='rp-val-col'>" + v + "</td>"
                + "<td class='rp-tag-col'>" + (isForm ? "[F]" : "[G]") + "</td>"
                + "</tr>";
        }).join("") + "</table>"
        : "<div style='padding:8px 10px;font-size:11px;color:var(--text3)'>定数なし</div>";
}

// ── 右パネル: 画面一覧セクション ──
// 全フォームと、各フォームに含まれるウィジェット名を一覧表示する。
function _rpBuildFormSection() {
    return "<div>" + getProjectData().forms.map((f, fi) => {
        const isCur = fi === getProjectData().curFormIdx;
        const ft = esc(f.cfg.name);
        const wids = (f.widgets || []).map(ww => {
            const wn = esc(ww.name);
            return "<tr class='rp-insert' data-insert='" + wn + "'>"
                + "<td class='col-name'>" + wn + "</td>"
                + "<td class='col-type'>" + esc(ww.tag) + "</td>"
                + "<td></td></tr>";
        }).join("");
        return "<div class='rp-tbl-row'>"
            + "<div class='rp-tbl-header'>"
            + "<span class='rp-tbl-name rp-insert' data-insert='" + ft + "' style='" + (isCur ? "color:var(--accent);font-weight:bold" : "") + "'>"
            + (isCur ? "★ " : "") + ft + "</span>"
            + (wids ? "<button class='rp-tbl-expand' " + evtAttr("onmousedown", "event.stopPropagation();yamlToggleTblCols(this)") + ">▶</button>" : "")
            + "</div>"
            + (wids ? "<div class='rp-tbl-cols'><table>" + wids + "</table></div>" : "")
            + "</div>";
    }).join("") + "</div>";
}

// ── 右パネル: 現在フォームのウィジェット一覧セクション ──
// ウィジェット名・タグ・説明を表示し、種別によって展開可能な
// 追加行（グループ名・選択肢・カラム一覧）を持つ。
function _rpBuildWidgetSection() {
    return getProjectData().widgets.length > 0
        ? "<div>" + getProjectData().widgets.map(ww => {
            try {
                const n = esc(ww.name);
                const tag = (ww.tag || "").toLowerCase();
                const desc = esc(ww.props?.description || "");
                let extraRows = "";
                if (tag === "radio" && ww.props?.group) {
                    extraRows += "<tr class='rp-insert' data-insert='" + esc(ww.props.group) + "'>"
                        + "<td class='col-name'>groupName</td>"
                        + "<td class='col-type'>" + esc(ww.props.group) + "</td>"
                        + "<td></td></tr>";
                }
                if ((tag === "selectbox" || tag === "listbox") && ww.props?.items) {
                    const itemList = String(ww.props.items).split("\n").map(s => s.trim()).filter(Boolean);
                    extraRows += itemList.map(item =>
                        "<tr class='rp-insert' data-insert='" + esc(item) + "'>"
                        + "<td class='col-name'>" + esc(item) + "</td>"
                        + "<td class='col-type'></td><td></td></tr>"
                    ).join("");
                }
                if (tag === "datagrid" && ww.props?.columns) {
                    const colStr = String(ww.props.columns);
                    const colItems = colStr.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
                    extraRows += colItems.map(c => {
                        const label = c.split(":")[0].trim();
                        return "<tr class='rp-insert' data-insert='" + esc(label) + "'>"
                            + "<td class='col-name'>" + esc(label) + "</td>"
                            + "<td class='col-type'></td><td></td></tr>";
                    }).join("");
                }
                const hasExtra = extraRows.length > 0;
                return "<div class='rp-tbl-row'>"
                    + "<div class='rp-tbl-header'>"
                    + "<span class='rp-tbl-name rp-insert' data-insert='" + n + "'>" + n + "</span>"
                    + "<span class='rp-tbl-desc'>" + esc(ww.tag) + "</span>"
                    + (desc ? "<span class='rp-tbl-desc'>" + desc + "</span>" : "")
                    + (hasExtra ? "<button class='rp-tbl-expand' " + evtAttr("onmousedown", "event.stopPropagation();yamlToggleTblCols(this)") + ">▶</button>" : "")
                    + "</div>"
                    + (hasExtra ? "<div class='rp-tbl-cols'><table>" + extraRows + "</table></div>" : "")
                    + "</div>";
            } catch (e) {
                return "<div class='rp-tbl-row'><div class='rp-tbl-header'>"
                    + "<span class='rp-tbl-name'>" + esc(ww.name || "?") + "</span>"
                    + "</div></div>";
            }
        }).join("") + "</div>"
        : "<div style='padding:8px 10px;font-size:11px;color:var(--text3)'>ウィジェットなし</div>";
}

// ── 右パネル: テーブル一覧セクション ──
// SQLiteテーブル定義のカラム一覧（PK/NOT NULL/DEFAULT/INDEXフラグ付き）を表示する。
function _rpBuildTableSection() {
    return getProjectData().tables.length > 0
        ? "<div>" + getProjectData().tables.map((t, ti) => {
            const tn = esc(t.name);
            const cols = (t.columns || []).map(c => {
                const flags = [c.pk ? "PK" : "", c.notNull ? "NN" : "", c.useDefault ? "DEF" : "", c.index ? "IDX" : ""].filter(Boolean).join(" ");
                const cn = esc(c.name);
                return "<tr class='rp-insert' data-insert='" + cn + "'>"
                    + "<td class='col-name'>" + cn + "</td>"
                    + "<td class='col-type'>" + esc(c.type) + "</td>"
                    + "<td class='col-flag'>" + flags + "</td></tr>";
            }).join("");
            return "<div class='rp-tbl-row'>"
                + "<div class='rp-tbl-header'>"
                + "<span class='rp-tbl-name rp-insert' data-insert='" + tn + "'>" + tn + "</span>"

                + (cols ? "<button class='rp-tbl-expand' " + evtAttr("onmousedown", "event.stopPropagation();yamlToggleTblCols(this)") + ">▶</button>" : "")
                + "</div>"
                + (cols ? "<div class='rp-tbl-cols'><table>" + cols + "</table></div>" : "")
                + "</div>";
        }).join("") + "</div>"
        : "<div style='padding:8px 10px;font-size:11px;color:var(--text3)'>\u30c6\u30fc\u30d6\u30eb\u306a\u3057</div>";
}

// ── 右パネル: 検証（バリデーション定義）一覧セクション ──
// ヘッダー: 定義名クリックで「検証: 定義名」をYAMLエディタの現在位置に挿入。
// 展開: ルールのウィジェット名・バリデーション条件をテーブル形式で表示。
function _rpBuildValidationSection() {
    const curForm = getProjectData().forms[getProjectData().curFormIdx];
    const validations = curForm?.validations || [];
    return validations.length > 0
        ? "<div>" + validations.map(v => {
            const vn = esc(v.name);
            const rules = (v.rules || []).filter(r => r.name && r.type);
            const ruleRows = rules.map(r => {
                const typeLabel = (VALIDATION_TYPES.find(t => t.value === r.type)?.label) || r.type;
                return "<tr><td class='col-name'>" + esc(r.name) + "</td>"
                    + "<td class='col-type'>" + esc(typeLabel) + "</td>"
                    + "<td class='col-flag'>" + (r.not ? "NOT" : "") + "</td></tr>";
            }).join("");
            return "<div class='rp-tbl-row'>"
                + "<div class='rp-tbl-header'>"
                + "<span class='rp-tbl-name rp-insert' data-insert='検証: " + vn + "'>" + vn + "</span>"
                + (ruleRows ? "<button class='rp-tbl-expand' " + evtAttr("onmousedown", "event.stopPropagation();yamlToggleTblCols(this)") + ">▶</button>" : "")
                + "</div>"
                + (ruleRows ? "<div class='rp-tbl-cols'><table>" + ruleRows + "</table></div>" : "")
                + "</div>";
        }).join("") + "</div>"
        : "<div style='padding:8px 10px;font-size:11px;color:var(--text3)'>検証定義なし</div>";
}

function yamlBuildRightPanel(showWidgets = true) {
    return [
        yamlRpSection("📌 定数", _rpBuildConstSection(), true),
        yamlRpSection("📋 画面一覧", _rpBuildFormSection(), true),
        showWidgets ? yamlRpSection("🔲 現在フォームのウィジェット", _rpBuildWidgetSection(), true) : "",
        yamlRpSection("✅ 検証", _rpBuildValidationSection(), true),
        yamlRpSection("🗄 テーブル一覧", _rpBuildTableSection(), true),
    ].join("");
}

// アコーディオンセクションHTML
function yamlRpSection(title, body, open = true) {
    return "<div class='yaml-rpanel-section'>"
        + "<div class='yaml-rpanel-hdr " + (open ? "open" : "") + "'>"
        + title + "<span class='rp-arrow'>" + (open ? "▼" : "▶") + "</span></div>"
        + "<div class='yaml-rpanel-body " + (open ? "open" : "") + "'>" + body + "</div>"
        + "</div>";
}

// アコーディオン開閉
function yamlToggleRpSection(hdr) {
    hdr.classList.toggle("open");
    const body = hdr.nextElementSibling;
    if (body) body.classList.toggle("open");
    const arrow = hdr.querySelector(".rp-arrow");
    if (arrow) arrow.textContent = hdr.classList.contains("open") ? "▼" : "▶";
}

// テーブルカラム展開
function yamlToggleTblCols(btn) {
    const cols = btn.parentElement?.nextElementSibling;
    if (!cols) return;
    const open = cols.classList.toggle("open");
    btn.textContent = open ? "▼" : "▶";
}

// 右パネルのイベントデリゲーション登録
function yamlInitRpanelEvents() {
    const rp = $("yaml-rpanel");
    if (!rp) return;
    // 既存ハンドラを削除してから再登録（多重登録防止）
    if (rp._rpHandler) rp.removeEventListener("click", rp._rpHandler);

    const handler = function (e) {
        // ① アコーディオンヘッダー（最優先）
        const hdr = e.target.closest(".yaml-rpanel-hdr");
        if (hdr) {
            if (e.type === "click") yamlToggleRpSection(hdr);
            return;
        }
        if (e.type !== "click") return;

        // ③ テーブルカラム展開ボタン
        const expand = e.target.closest(".rp-tbl-expand");
        if (expand) {
            e.stopPropagation();
            yamlToggleTblCols(expand);
            return;
        }
        // ⑤ 挿入系（最後に判定）
        const insEl = e.target.closest(".rp-insert");
        if (insEl && insEl.dataset.insert !== undefined) {
            e.stopPropagation();
            yamlInsert(insEl.dataset.insert);
            return;
        }
    };
    rp._rpHandler = handler;
    rp.addEventListener("click", handler);
}

// ドラッグリサイズ初期化
function yamlInitResize() {
    const handle = $("yaml-rhandle");
    const rPanel = $("yaml-rpanel");
    const layout = $("yaml-layout");
    if (!handle || !rPanel || !layout) return;
    let startX = 0, startW = 0;
    handle.addEventListener("mousedown", function (e) {
        startX = e.clientX;
        startW = rPanel.offsetWidth;
        handle.classList.add("dragging");
        function onMove(e) {
            const diff = startX - e.clientX;
            const newW = Math.max(140, Math.min(500, startW + diff));
            rPanel.style.width = newW + "px";
        }
        function onUp() {
            handle.classList.remove("dragging");
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        e.preventDefault();
    });
}

// YAMLエリアにテキストを挿入
function yamlInsert(text) {
    // アクティブなタブのテキストエリアに挿入
    const isJs = $("pane-js")?.classList.contains("active");
    const ta = isJs ? $("js-ta") : $("yaml-ta");
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + text.length;
    ta.focus();
    if (isJs) jsHlUpdate();
    else yamlHlUpdate();
}

// AI生成（llama-server 経由）
// YAML仕様からイベントの JavaScript コードを AI 生成する。
// プロジェクト情報・ウィジェット・テーブル定義をコンテキストとして渡す。
// 生成完了後に openYaml を再表示し、JS タブにコードをセットする。
async function yamlAiGenerate(wid, evName) {
    const isAppEvent = (wid === "appev");
    const isFormEvent = (wid === "form");
    const w = (isAppEvent || isFormEvent) ? null : getWidget(wid);
    if (!isAppEvent && !isFormEvent && !w) return;
    if (!getProjectData().aiConfig.enabled) {
        if (await vja.app.showConfirm("AI接続設定が有効になっていません。設定画面を開きますか？")) {
            closeModal();
            openAiConfig();
        }
        return;
    }
    const yamlCur = $("yaml-ta")?.value || "";

    // ── ⓪ バリデーション定義の抽出とYAMLからの削除 ──
    // キー「バリデーション:」「バリデート:」「検証:」が設定されていたら先頭の1つを抽出し、
    // AIに渡すYAMLから該当行を削除する。vja.validate.run('定義名') はonSuccess時に先頭挿入。
    let validationName = null;
    const yamlForAi = yamlCur.replace(/^(バリデーション|バリデート|検証)\s*:\s*(.+)$/mg, (_, _key, val) => {
        if (!validationName) validationName = val.trim(); // 先頭のみ取得
        return ""; // 全該当行を削除（先頭以外も残さない）
    }).replace(/\n{3,}/g, "\n\n"); // 連続空行の整理

    const addPrompt = $("ai-prompt-in")?.value || "";
    const btn = $("ai-gen-btn");
    const status = $("ai-status");
    const aiStartTime = Date.now(); // AI実行開始時刻を記録

    // ── ① 入力系ウィジェット一覧（フォームの入力パラメータ） ──
    const INPUT_TAGS = ["inputtype", "checkbox", "radiobutton", "listbox", "selectbox"];
    const inputWidgets = getProjectData().widgets.filter(ww => INPUT_TAGS.includes(ww.tag.toLowerCase()));
    const inputParamsCtx = inputWidgets.length > 0
        ? inputWidgets.map(ww => {
            const desc = ww.props?.description ? " // " + ww.props.description : "";
            return "  - " + ww.name + " (" + ww.tag + ")" + desc;
        }).join("\n")
        : "  （なし）";

    // ── ② 全ウィジェット一覧 ──
    const allWidgetsCtx = getProjectData().widgets.map(ww => "  - " + ww.name + " (" + ww.tag + ")").join("\n") || "  （なし）";

    // ── ③ 画面一覧 ──
    const formsCtx = getProjectData().forms.map((f, i) => {
        const star = f.id === getProjectData().startFormId ? "★" : "";
        return "  - " + f.cfg.name + (star ? " [初期画面]" : "") + (f.cfg.description ? " // " + f.cfg.description : "");
    }).join("\n");

    // ── ④ 定数（グローバル＋フォーム単位） ──
    const curForm = getProjectData().forms[getProjectData().curFormIdx];
    const globalConstCtx = getProjectData().constants.length > 0
        ? getProjectData().constants.map(c => "  - " + c.name + " = " + c.value).join("\n")
        : "  （なし）";
    const formConstCtx = (curForm?.constants || []).length > 0
        ? (curForm.constants || []).map(c => "  - " + c.name + " = " + c.value).join("\n")
        : "  （なし）";

    // ── ⑤ テーブル定義（利用テーブルのカラム情報） ──
    // YAMLに「利用テーブル:」が書かれていればそれを参照、なければ全テーブル
    const mentionedTables = [];
    if (yamlCur) {
        const m = yamlCur.match(/利用テーブル\s*:\s*\n([\s\S]*?)(?:\n\S|\n\n|$)/);
        if (m) {
            const lines = m[1].split("\n");
            lines.forEach(l => {
                const name = l.replace(/^\s*-\s*/, "").replace(/#.*$/, "").trim();
                if (name) mentionedTables.push(name);
            });
        }
    }
    const targetTables = mentionedTables.length > 0
        ? getProjectData().tables.filter(t => mentionedTables.includes(t.name))
        : []; // 未指定の場合は何も渡さない
    const tablesCtx = targetTables.length > 0
        ? targetTables.map(t => {
            const cols = (t.columns || []).map(c => {
                let def = "    - " + c.name + " (" + c.type + ")";
                if (c.pk) def += " PK";
                if (c.notNull) def += " NOT NULL";
                if (c.useDefault) {
                    const dv = (c.default && c.default.trim() !== "") ? c.default.trim() : defaultValueForType(c.type);
                    def += " DEFAULT " + dv;
                }
                if (c.index) def += " INDEX";
                return def;
            }).join("\n");
            const desc = t.description ? " // " + t.description : "";
            return "  " + t.name + desc + ":\n" + cols;
        }).join("\n")
        : "  （テーブル未定義）";

    // ── ⑥ システムプロンプト ──
    const sysPrompt = _PROMPT_DEF.YAML_TO_JS_SYS_PROMPT(
        isAppEvent,
        {
            formName: curForm?.cfg?.name, eventName: evName,
            wname: w?.name, wtag: w?.tag, wdescription: w?.props?.description,
            inputParamsCtx: inputParamsCtx, allWidgetsCtx: allWidgetsCtx,
            formsCtx: formsCtx, globalConstCtx: globalConstCtx,
            formConstCtx: formConstCtx, tablesCtx: tablesCtx,
            extRuntimeDoc: getProjectData().extRuntime.doc
        });

    // ── ⑦ ユーザープロンプト ──
    const userPrompt = _PROMPT_DEF.YAML_TO_JS_USER_PROMPT(
        isAppEvent, yamlForAi, addPrompt,
        {
            formName: curForm?.cfg?.name, eventName: evName,
            wname: w?.name, wtag: w?.tag, wdescription: w?.props?.description,
            inputParamsCtx: inputParamsCtx, allWidgetsCtx: allWidgetsCtx,
            formsCtx: formsCtx, globalConstCtx: globalConstCtx,
            formConstCtx: formConstCtx, tablesCtx: tablesCtx,
            extRuntimeDoc: getProjectData().extRuntime.doc
        }
    );

    // 確認ダイアログ
    const jsTaCur = $("js-ta")?.value || "";
    const jsTaHasCode = jsTaCur.split("\n")
        .some(l => l.trim() && !l.trim().startsWith("//"));
    const confirmMsg = jsTaHasCode
        ? "JavaScriptタブに既存のコードがあります。\nAI生成で上書きしますか？\n※実行前に現在の内容を保存します。"
        : "JavaScriptコードを生成しますか？\n※実行前に現在の内容を保存します。";
    if (!(await vja.app.showConfirm(confirmMsg))) {
        if (btn) btn.disabled = false;
        if (status) status.textContent = "";
        return;
    }
    // AI生成前にデータを保存（モーダルは閉じない）
    _saveYamlData(wid, evName);
    if (btn) btn.disabled = true;
    if (status) status.textContent = "⏳ コンテキスト収集中…";
    showLoadingModal("AI生成中…");

    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        onSuccess: async (clean) => {
            // async function handleXxx() { ... } のラッパーを自動除去
            // 3Bモデル等が関数ラッパーを生成してしまう場合の後処理
            const _unwrap = (code) => {
                return code.replace(
                    /^\s*async\s+function\s+\w+\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/,
                    (_, inner) => inner.trim()
                );
            };
            const unwrapped = _unwrap(clean);
            // バリデーション定義がある場合、JSの先頭に呼び出しを挿入
            // vja.validate.run('定義名') → false=エラー時はreturnで処理中断
            const finalCode = validationName
                ? "// 検証チェック処理(自動追加).\n" +
                `if (!await vja.validate.run(${JSON.stringify(validationName)})) return;\n\n${unwrapped}`
                : unwrapped;
            // モーダルを再表示してJSタブに切り替え
            // ウィジェット/フォーム/アプリイベントで「開き直す」関数が異なるため出し分ける
            if (isFormEvent) {
                openFormYaml(evName);
            } else if (isAppEvent) {
                openAppEvents(evName);
            } else {
                const w2 = getWidget(wid);
                if (!w2) return;
                openYaml(wid, evName);
            }
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const jsTa = $("js-ta");
                if (jsTa) jsTa.value = finalCode;
                yamlTabSwitch("js");
                jsHlUpdate();
                if (status) status.textContent = "✅ 生成完了 (JavaScriptタブを確認)";
                const elapsed = Math.round((Date.now() - aiStartTime) / 1000);
                showToast("✅ AI生成完了（" + elapsed + "秒）", 5000);
            }));
        },
        onCancel: async () => {
            if (status) status.textContent = "";
        },
        onError: async () => {
            if (status) status.textContent = "❌ 生成エラー";
        },
    });
    if (btn) btn.disabled = false;
}


/* ── エディタ共通キーハンドラ ── */
function editorKeyHandler(e) {
    const ta = e.target;
    if (!ta) return;
    // IME変換中のキーイベントは無視（Mac等でのIME確定時の誤改行を防ぐ）
    if (e.isComposing || e.keyCode === 229) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const isJs = ta.id === "js-ta" || ta.id === "ta-extrt-js";
    const state = ta.id === "js-ta" ? getEditorContext().ju
        : ta.id === "ta-extrt-js" ? _EXTRT_EDITOR.jsUndo
            : ta.id === "ta-extrt-doc" ? _EXTRT_EDITOR.docUndo
                : getEditorContext().yu;

    // ── Mac: Ctrl+C / Ctrl+V を無効化（OS側のEmacsキーバインド干渉防止）──
    if (navigator.platform.startsWith("Mac") && e.ctrlKey && !e.metaKey && (e.key === "c" || e.key === "v")) {
        e.preventDefault(); return;
    }

    // ── Undo / Redo ───────────────────────────────────
    if (ctrl && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault(); editorUndo(ta.id, state); return;
    }
    if ((ctrl && e.key.toLowerCase() === "z" && e.shiftKey) ||
        (ctrl && e.key.toLowerCase() === "y")) {
        e.preventDefault(); editorRedo(ta.id, state); return;
    }

    // ── 行ブロック操作の共通変数取得ヘルパー ─────────
    // s/en: カーソル位置, v: テキスト全体
    // ls: 行頭, le: 行末（-1=最終行）
    const getBlock = () => {
        const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
        const ls = v.lastIndexOf("\n", s - 1) + 1;
        const le = v.indexOf("\n", en);
        return { s, en, v, ls, le };
    };
    const applyBlock = (ls, le, v, nb) => {
        ta.value = v.slice(0, ls) + nb + (le === -1 ? "" : v.slice(le));
        ta.selectionStart = ls;
        ta.selectionEnd = ls + nb.length;
    };

    // ── Tab: インデント追加 ───────────────────────────
    if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        editorUndoPush(state, ta.value);
        const { s, en, v, ls, le } = getBlock();
        if (s === en) {
            const ins = isJs ? "    " : "  ";
            ta.value = v.slice(0, s) + ins + v.slice(s);
            ta.selectionStart = ta.selectionEnd = s + ins.length;
        } else {
            const blk = v.slice(ls, le === -1 ? v.length : le);
            const ins = isJs ? "    " : "  ";
            applyBlock(ls, le, v, blk.split("\n").map(l => ins + l).join("\n"));
        }
        editorHlUpdate(ta.id); return;
    }

    // ── Ctrl+[: インデント削除 ────────────────────────
    if (e.key === "[" && ctrl) {
        e.preventDefault();
        editorUndoPush(state, ta.value);
        const { v, ls, le } = getBlock();
        const blk = v.slice(ls, le === -1 ? v.length : le);
        const dedent = isJs ? /^ {1,4}/ : /^ {1,2}/;
        applyBlock(ls, le, v, blk.split("\n").map(l => l.replace(dedent, "")).join("\n"));
        editorHlUpdate(ta.id); return;
    }

    // ── Ctrl+]: インデント追加 ────────────────────────
    if (e.key === "]" && ctrl) {
        e.preventDefault();
        editorUndoPush(state, ta.value);
        const { v, ls, le } = getBlock();
        const blk = v.slice(ls, le === -1 ? v.length : le);
        const ins = isJs ? "    " : "  ";
        applyBlock(ls, le, v, blk.split("\n").map(l => ins + l).join("\n"));
        editorHlUpdate(ta.id); return;
    }

    // ── Ctrl+/: コメントトグル ────────────────────────
    if (e.key === "/" && ctrl) {
        e.preventDefault();
        editorUndoPush(state, ta.value);
        const { v, ls, le } = getBlock();
        const blk = v.slice(ls, le === -1 ? v.length : le);
        const COM = isJs ? "// " : "# ";
        applyBlock(ls, le, v, blk.split("\n").map(l => {
            if (l.trimStart().startsWith(COM.trim())) {
                const i = l.indexOf(COM.trim());
                return l.slice(0, i) + l.slice(i + COM.length);
            }
            return COM + l;
        }).join("\n"));
        editorHlUpdate(ta.id); return;
    }

    // ── Ctrl+D: 行複製 ────────────────────────────────
    if (e.key === "d" && ctrl) {
        e.preventDefault();
        editorUndoPush(state, ta.value);
        const { v, ls, le } = getBlock();
        const line = v.slice(ls, le === -1 ? v.length : le);
        const ins = "\n" + line;
        ta.value = v.slice(0, le === -1 ? v.length : le) + ins + (le === -1 ? "" : v.slice(le));
        ta.selectionStart = ta.selectionEnd = (le === -1 ? v.length : le) + ins.length;
        editorHlUpdate(ta.id); return;
    }

    // ── Ctrl+K: 行削除 ────────────────────────────────
    if (e.key === "k" && ctrl) {
        e.preventDefault();
        editorUndoPush(state, ta.value);
        const { v, ls, le } = getBlock();
        ta.value = v.slice(0, ls) + v.slice(le === -1 ? v.length : le + 1);
        ta.selectionStart = ta.selectionEnd = ls;
        editorHlUpdate(ta.id); return;
    }

    // ── }: JS の自動 dedent ───────────────────────────
    if (e.key === "}" && isJs) {
        const { s, en, v, ls } = getBlock();
        const curLine = v.slice(ls, s);
        if (/^\s+$/.test(curLine) && curLine.length >= 4) {
            e.preventDefault();
            editorUndoPush(state, ta.value);
            const newIndent = curLine.slice(4);
            ta.value = v.slice(0, ls) + newIndent + "}" + v.slice(en);
            ta.selectionStart = ta.selectionEnd = ls + newIndent.length + 1;
            editorHlUpdate(ta.id); return;
        }
    }

    // ── Enter: 自動インデント ─────────────────────────
    if (e.key === "Enter") {
        e.preventDefault();
        editorUndoPush(state, ta.value);
        const { s, en, v, ls } = getBlock();
        const curLine = v.slice(ls, s);
        const baseIndent = curLine.match(/^(\s*)/)[1];
        let extra = "";
        if (isJs) {
            // { で終わる行 → +1段、} で始まる行 → -1段
            // コメント行（// で始まる）はインデント追加しない
            const isJsComment = curLine.trimStart().startsWith("//");
            if (!isJsComment && curLine.trimEnd().endsWith("{")) {
                extra = "    ";
            } else if (!isJsComment && curLine.trimStart().startsWith("}") && baseIndent.length >= 4) {
                const insert = "\n" + baseIndent.slice(4);
                ta.value = v.slice(0, s) + insert + v.slice(en);
                ta.selectionStart = ta.selectionEnd = s + insert.length;
                editorHlUpdate(ta.id); _ensureCursorVisible(ta); return;
            }
        } else {
            // YAML Enter の動作
            const t = curLine.trimStart();
            // コメント行（# で始まる）はインデント追加しない
            const isYamlComment = t.startsWith("#");
            if (!isYamlComment && /^(-\s+)(.+)$/.test(t)) {
                // "- 内容あり" → 次行も "- " を継続
                const bullet = t.match(/^(-\s+)/)[1];
                const insert = "\n" + baseIndent + bullet;
                ta.value = v.slice(0, s) + insert + v.slice(en);
                ta.selectionStart = ta.selectionEnd = s + insert.length;
                editorHlUpdate(ta.id); _ensureCursorVisible(ta); return;
            } else if (!isYamlComment && /^-\s*$/.test(t)) {
                // "- " だけの空行 → リスト終了（行を削除して通常改行）
                ta.value = v.slice(0, ls) + "\n" + v.slice(en);
                ta.selectionStart = ta.selectionEnd = ls + 1;
                editorHlUpdate(ta.id); _ensureCursorVisible(ta); return;
            } else if (!isYamlComment && /:\s*$/.test(t) && !t.startsWith("-")) {
                extra = "  ";
            }
        }
        const insert = "\n" + baseIndent + extra;
        ta.value = v.slice(0, s) + insert + v.slice(en);
        ta.selectionStart = ta.selectionEnd = s + insert.length;
        editorHlUpdate(ta.id); _ensureCursorVisible(ta); return;
    }
}

// ── ダブルクリック選択: 1回目mousedown後にsetTimeoutで位置確定 ──
function editorMouseDownHandler2(e) {
    const ta = e.target;
    if (!ta) return;
    const now = Date.now();
    const isFirst = (now - getEditorContext().lastMouseDown) > 300;
    getEditorContext().lastMouseDown = now;
    if (isFirst) {
        // 1回目: カーソル確定後に位置を記録
        getEditorContext().clickPos = -1;
        getEditorContext().dblPending = false;
        setTimeout(() => {
            if (!getEditorContext().dblPending) {
                getEditorContext().clickPos = ta.selectionStart;
            }
        }, 0);
    }
    // 2回目はsetTimeoutを実行しない（ブラウザ選択で上書きされるため）
}
function editorDblClickHandler(e) {
    const ta = e.target;
    if (!ta) return;
    getEditorContext().dblPending = true;
    const v = ta.value;
    const pos = getEditorContext().clickPos >= 0 ? getEditorContext().clickPos : ta.selectionStart;
    const SEP = /[\s\.\-\:\/\\,;\(\)\[\]\{\}"'`=+*&|!@#%^~<>?]/;
    let start = pos;
    let end = pos;
    while (start > 0 && !SEP.test(v[start - 1])) start--;
    while (end < v.length && !SEP.test(v[end])) end++;
    if (start === end) {
        start = pos;
        end = Math.min(pos + 1, v.length);
    }
    ta.selectionStart = start;
    ta.selectionEnd = end;
    getEditorContext().clickPos = -1;
}

// taId に対応するハイライト更新を行う共通ディスパッチャ。
// _hlUpdate + editorUpdateGutter の組み合わせを ID で振り分ける。
function editorHlUpdate(taId) {
    if (taId === "yaml-ta") { yamlHlUpdate(); editorUpdateGutter("yaml-ta", "yaml-gutter"); }
    else if (taId === "js-ta") { jsHlUpdate(); editorUpdateGutter("js-ta", "js-gutter"); }
    else if (taId === "ta-extrt-js") { _hlUpdate("ta-extrt-js", "hl-extrt-js", jsTokenize); editorUpdateGutter("ta-extrt-js", "gutter-extrt-js"); }
    else if (taId === "ta-extrt-doc") { _hlUpdate("ta-extrt-doc", "hl-extrt-doc", yamlTokenize); editorUpdateGutter("ta-extrt-doc", "gutter-extrt-doc"); }
}


/* ── YAMLエディタ共通HTML生成 ── */
// tabConfig: null=通常(YAML+JS), {tabs:[{id,label,type:'yaml'|'js',val,ph}], aiBar, saveAction}
function buildYamlEditorHTML(cur, curJs, showWidgets = true, headerHTML = "", extraTabsHTML = "", tabConfig = null, isAppEvent = false) {
    const aiEnabled = getProjectData().aiConfig.enabled;

    // カスタムタブ構成
    if (tabConfig) {
        const tabs = tabConfig.tabs || [];
        const tabBar = tabs.map((t, idx) =>
            `<div class='yaml-tab ${idx === 0 ? "active" : ""}' id='tab-${t.id}'>${t.label}</div>`
        ).join("");
        const panes = tabs.map((t, idx) => {
            const isJs = t.type === "js";
            const hlWrap = isJs ? "js-hl-wrap" : "yaml-hl-wrap";
            const hlBg = isJs ? "js-hl-bg" : "yaml-hl-bg";
            return `<div class='yaml-pane ${idx === 0 ? "active" : ""}' id='pane-${t.id}'>` +
                `<div class='editor-wrap'>` +
                `<div class='editor-gutter' id='gutter-${t.id}'></div>` +
                `<div class='editor-main'>` +
                `<div class='${hlWrap}'>` +
                `<div class='${hlBg}' id='hl-${t.id}'></div>` +
                `<textarea class='yaml' id='ta-${t.id}' autocorrect='off' autocapitalize='off' spellcheck='false' style='height:100%;min-height:300px'` +
                evtAttr("oninput", `editorHlUpdate("ta-${t.id}")`) +
                evtAttr("onscroll", `_hlSync("ta-${t.id}","hl-${t.id}");editorSyncGutter("ta-${t.id}","gutter-${t.id}")`) +
                (t.ph ? ` placeholder='${esc(t.ph)}'` : "") + `>` + esc(t.val || "") + `</textarea>` +
                `</div></div></div></div>`;
        }).join("");
        const aiBar = tabConfig.aiBar
            ? `<div class='yaml-ai-bar'>${tabConfig.aiBar}</div>`
            : "";
        const saveBtn = tabConfig.saveAction
            ? `<button class='pri'${evtAttr("onmousedown", tabConfig.saveAction)}>保存</button>`
            : "";
        return (
            "<div class='modal-yaml'>" +
            headerHTML +
            "<div class='mbody' style='padding:0;gap:0;overflow:hidden;display:flex;flex-direction:column'>" +
            "<div class='yaml-editor-layout' id='yaml-layout'>" +
            "<div class='yaml-editor-left'>" +
            "<div class='yaml-tab-bar'>" + tabBar + "</div>" +
            panes +
            (aiBar ? aiBar : "<div class='yaml-ai-bar'></div>") +
            "</div>" +
            "<div class='yaml-editor-right' style='display:none'></div>" +
            "</div>" +
            "</div>" +
            "<div class='mfoot'>" +
            mfootHTML([{ label: "キャンセル", action: "closeModal()" }]) +
            saveBtn +
            "</div>" +
            "</div>"
        );
    }

    // 通常構成（YAML + JS）
    return (
        "<div class='modal-yaml'>" +
        headerHTML +
        "<div class='mbody' style='padding:0;gap:0;overflow:hidden;display:flex;flex-direction:column'>" +
        (extraTabsHTML ? "<div class='yaml-ev-tabs'>" + extraTabsHTML + "</div>" : "") +
        "<div class='yaml-editor-layout' id='yaml-layout'>" +
        "<div class='yaml-editor-left'>" +
        "<div class='yaml-tab-bar'>" +
        "<div class='yaml-tab active' id='tab-yaml'>📋 YAML</div>" +
        "<div class='yaml-tab' id='tab-js'>📜 JavaScript</div>" +
        "<button class='yaml-api-ref-btn'" + evtAttr("onmousedown", "openApiRef(" + isAppEvent + ")") + ">📖 API</button>" +
        "</div>" +
        "<div class='yaml-pane active' id='pane-yaml'>" +
        "<div class='editor-wrap'>" +
        "<div class='editor-gutter' id='yaml-gutter'></div>" +
        "<div class='editor-main'>" +
        "<div class='yaml-hl-wrap'>" +
        "<div class='yaml-hl-bg' id='yaml-hl'></div>" +
        "<textarea class='yaml' id='yaml-ta' autocorrect='off' autocapitalize='off' spellcheck='false' " +
        evtAttr("oninput", "yamlHlUpdate();editorUpdateGutter(\"yaml-ta\",\"yaml-gutter\")") + " " +
        evtAttr("onscroll", "yamlHlSync();editorSyncGutter(\"yaml-ta\",\"yaml-gutter\")") + " " +
        ">" + esc(cur) + "</textarea>" +
        "</div></div></div></div>" +
        "<div class='yaml-pane' id='pane-js'>" +
        "<div class='editor-wrap'>" +
        "<div class='editor-gutter' id='js-gutter'></div>" +
        "<div class='editor-main'>" +
        "<div class='js-hl-wrap'>" +
        "<div class='js-hl-bg' id='js-hl'></div>" +
        "<textarea class='yaml' id='js-ta' autocorrect='off' autocapitalize='off' spellcheck='false' " +
        evtAttr("oninput", "jsHlUpdate();editorUpdateGutter(\"js-ta\",\"js-gutter\")") + " " +
        evtAttr("onscroll", "jsHlSync();editorSyncGutter(\"js-ta\",\"js-gutter\")") + " " +
        "placeholder='// AIでJavaScriptを生成、または直接編集できます'>" + esc(curJs) + "</textarea>" +
        "</div></div></div></div>" +
        "<div class='yaml-ai-bar' style='padding-bottom:8px;flex-direction:column;align-items:stretch;gap:4px'>" +
        "<div style='display:flex;align-items:center;gap:4px'>" +
        "<input id='ai-prompt-in' placeholder='AIへの追加指示（任意）' style='flex:1'>" +
        "<button class='yaml-ai-btn' id='ai-gen-btn'" + evtAttr("onmousedown", "pvCall(\"yamlAiGen\")") + ">" +
        (aiEnabled ? "🤖 AI生成" : "🤖 AI生成（設定要）") + "</button>" +
        "<span class='yaml-ai-right-spacer' id='ai-status'></span>" +
        "</div>" +
        "<div style='display:flex;align-items:center;gap:4px'>" +
        "<input id='editor-search-in' placeholder='検索ワード（Ctrl+F）' style='flex:1' " +
        evtAttr("onkeydown", "if(event.key===\"Enter\"){event.preventDefault();editorSearch();}") + " " +
        evtAttr("oninput", "getEditorContext().searchLast={taId:null,word:\"\",pos:0}") + ">" +
        "<button class='yaml-ai-btn'" + evtAttr("onmousedown", "event.preventDefault();$(\"editor-search-in\").value=\"\";getEditorContext().searchLast={taId:null,word:\"\",pos:0}") + ">✕</button>" +
        "<button class='yaml-ai-btn'" + evtAttr("onmousedown", "event.preventDefault();editorSearch()") + ">🔍 検索</button>" +
        "<span class='yaml-ai-right-spacer'></span>" +
        "</div>" +
        "</div>" +
        "</div>" +
        "<div class='yaml-resize-handle' id='yaml-rhandle'></div>" +
        "<div class='yaml-editor-right' id='yaml-rpanel'>" +
        yamlBuildRightPanel(showWidgets) +
        "</div>" +
        "</div>" +
        "</div>" +
        "<div class='mfoot'>" +
        mfootHTML([{ label: "キャンセル", action: "closeModal()" }]) +
        "<button class='pri'" + evtAttr("onmousedown", "pvCall(\"yamlSave\")") + ">保存</button>" +
        "</div>" +
        "</div>"
    );
}

/* ── YAMLエディタ初期化（requestAnimationFrame内の共通処理） ── */
function initYamlEditorModal(cur, curJs, onAfterInit) {
    requestAnimationFrame(() => {
        applyEditorConfig();
        yamlHlUpdate();
        editorUpdateGutter("yaml-ta", "yaml-gutter");
        jsHlUpdate();
        editorUpdateGutter("js-ta", "js-gutter");
        const yta = $("yaml-ta");
        const jta = $("js-ta");
        if (yta) yta.addEventListener("keydown", editorKeyHandler);
        if (jta) jta.addEventListener("keydown", editorKeyHandler);
        if (yta) yta.addEventListener("mousedown", editorMouseDownHandler2);
        if (jta) jta.addEventListener("mousedown", editorMouseDownHandler2);
        if (yta) yta.addEventListener("dblclick", editorDblClickHandler);
        if (jta) jta.addEventListener("dblclick", editorDblClickHandler);
        editorUndoInit("yaml-ta", getEditorContext().yu, cur);
        editorUndoInit("js-ta", getEditorContext().ju, curJs);
        yamlInitResize();
        yamlInitRpanelEvents();
        rAfBind("#tab-yaml", "click", () => yamlTabSwitch("yaml"));
        rAfBind("#tab-js", "click", () => { yamlTabSwitch("js"); jsHlUpdate(); });
        jsHlUpdate();
        if (onAfterInit) onAfterInit();
    });
}

// AI接続設定モーダル
function openAiConfig() {
    // getProjectData().aiConfig の初期値保証
    if (!getProjectData().aiConfig.routerMode) getProjectData().aiConfig.routerMode = false;
    if (!getProjectData().aiConfig.apiKey) getProjectData().aiConfig.apiKey = "";
    if (!getProjectData().aiConfig.models) getProjectData().aiConfig.models = [];
    if (!getProjectData().aiConfig.endpoint) getProjectData().aiConfig.endpoint = "http://localhost:8080";
    if (getProjectData().aiConfig.thinking === undefined) getProjectData().aiConfig.thinking = true;

    const isEnabled = getProjectData().aiConfig.enabled === true;
    const isRouter = getProjectData().aiConfig.routerMode === true;
    const isThinking = getProjectData().aiConfig.thinking !== false;
    const modelListHtml = aiCfgModelListHtml(getProjectData().aiConfig.models, getProjectData().aiConfig.model, isRouter);

    showModal(
        mhdrHTML("🤖 AI接続設定") +
        "<div class='mbody' style='gap:12px'>" +
        "<div class='infobox'>llama-server（またはOpenAI互換API）の接続設定を行います。</div>" +

        // AI生成を有効
        "<div class='ai-cfg-row'><label>AI生成を有効</label>" +
        makePvSel("ai-ena-sel", ["ON", "OFF"], isEnabled ? "ON" : "OFF", "aiCfgToggleEnabled({value})") +
        "</div>" +

        // エンドポイント
        "<div class='ai-cfg-row'><label>エンドポイント</label>" +
        "<input id='ai-ep' value='" + esc(getProjectData().aiConfig.endpoint) + "' placeholder='http://localhost:8080'></div>" +

        // API Key
        "<div class='ai-cfg-row'><label>API Key</label>" +
        "<input id='ai-apikey' type='password' value='" + esc(getProjectData().aiConfig.apiKey) + "' placeholder='OpenAI等のAPIキー（任意）'></div>" +

        // ルーターモード
        "<div class='ai-cfg-row'><label>ルーターモード</label>" +
        makePvSel("ai-router-sel", ["ON", "OFF"], isRouter ? "ON" : "OFF", "aiCfgToggleRouter({value})") +
        "</div>" +

        // モデル名（ルーターモードONのみ）
        "<div class='ai-cfg-row' id='ai-model-row' style='" + (!isRouter ? "opacity:.4;pointer-events:none" : "") + "'>" +
        "<label>モデル名</label>" +
        "<div style='display:flex;gap:6px;align-items:center'>" +
        "<div class='pv-sel' id='ai-model-sel' style='flex:1'>" +
        "<div class='pv-sel-btn'" + evtAttr("onmousedown", "pvSelOpen('ai-model-sel',event)") + ">" +
        "<span id='ai-model-label'>" + (isRouter ? (getProjectData().aiConfig.model || "（モデルを選択）") : "") + "</span>" +
        "<span class='arr'>▼</span></div>" +
        "<div class='pv-sel-list' id='ai-model-list'>" + modelListHtml + "</div>" +
        "</div>" +
        "<button" + evtAttr("onmousedown", "aiCfgFetchModels()") + " style='height:28px;padding:0 10px;background:var(--bg3);border:1px solid var(--border);border-radius:3px;color:var(--text);cursor:pointer;font-size:12px;white-space:nowrap;flex-shrink:0'>🔄 更新</button>" +
        "</div></div>" +

        // max tokens
        "<div class='ai-cfg-row'><label>Max Tokens</label>" +
        "<input id='ai-max-tokens' value='" + esc(String(getProjectData().aiConfig.maxTokens || "")) + "' placeholder='空の場合はサーバー側に依存' style='width:100%'></div>" +
        "<div class='ai-cfg-row'><label>temperature</label>" +
        "<input id='ai-temperature' class='pv-input' value='" + esc(getProjectData().aiConfig.temperature !== "" && getProjectData().aiConfig.temperature != null ? String(getProjectData().aiConfig.temperature) : "") + "' placeholder='空の場合はサーバー側に依存' style='width:100%'></div>" +

        // 推論モード
        "<div class='ai-cfg-row'><label>推論モード</label>" +
        makePvSel("ai-thinking-sel", ["ON", "OFF"], isThinking ? "ON" : "OFF", "") +
        "</div>" +
        "<div class='infobox' style='font-size:11px'>推論モードOFFは llama.cpp / mlx-lm / Ollama / vLLM に対応。Foundry Local は非対応。</div>" +

        "</div>" +
        "<div class='mfoot'>" +
        mfootHTML([{ label: "キャンセル", action: "closeModal()" }]) + "" +
        "<button class='pri'" + evtAttr("onmousedown", "saveAiConfig()") + ">保存</button>" +
        "</div>"
    );
}

// モデルリストのHTML生成
function aiCfgModelListHtml(models, current, isRouter) {
    if (!isRouter || !models || models.length === 0) {
        return "<div class='pv-sel-opt'>（ルーターモードONで更新）</div>";
    }
    return models.map(m =>
        "<div class='pv-sel-opt " + (m === current ? "active" : "") + "'" +
        evtAttr("onmousedown", "pvSelPick('ai-model-sel','" + String(m).replace(/'/g, "\\'") + "',event);$('ai-model-label').textContent='" + String(m).replace(/'/g, "\\'") + "'") + ">" + esc(m) + "</div>"
    ).join("");
}

// ルーターモード切り替え
function aiCfgToggleRouter(val) {
    const row = $("ai-model-row");
    if (!row) return;
    const on = val === "ON";
    row.style.opacity = on ? "1" : "0.4";
    row.style.pointerEvents = on ? "auto" : "none";
}

// 有効/無効切り替え（将来の動的UI用）
function aiCfgToggleEnabled(val) { /* 現状はpvSelPickのみで処理 */ }

// モデル一覧をllamaサーバーから取得
async function aiCfgFetchModels() {
    const ep = $("ai-ep")?.value?.trim() || getProjectData().aiConfig.endpoint;
    const apiKey = $("ai-apikey")?.value?.trim() || "";
    const btn = document.querySelector("#ai-model-row button");
    if (btn) { btn.textContent = "⏳"; btn.disabled = true; }
    try {
        // API Key あり → OpenAI /v1/models
        // API Key なし → ローカル llama-server /v1/models
        const fetchEp = apiKey ? "https://api.openai.com" : ep;
        const headers = { "Content-Type": "application/json" };
        if (apiKey) headers["Authorization"] = "Bearer " + apiKey;
        const res = await window.vja.fetch(fetchEp + "/v1/models", { headers });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        const models = (data.data || []).map(m => m.id || m).filter(Boolean).sort();
        if (models.length === 0) throw new Error("モデルが見つかりません");
        getProjectData().aiConfig.models = models;
        const list = $("ai-model-list");
        if (list) list.innerHTML = aiCfgModelListHtml(models, getProjectData().aiConfig.model, true);
        showToast((apiKey ? "OpenAI" : "ローカル") + "からモデルを" + models.length + "件取得しました");
    } catch (e) {
        showToast("取得失敗: " + e.message);
    } finally {
        if (btn) { btn.textContent = "🔄 更新"; btn.disabled = false; }
    }
}

function saveAiConfig() {
    const ep = $("ai-ep")?.value?.trim() || "http://localhost:8080";
    const apiKey = $("ai-apikey")?.value?.trim() || "";
    const enaSel = document.querySelector("#ai-ena-sel    .pv-sel-btn span:first-child");
    const rtrSel = document.querySelector("#ai-router-sel .pv-sel-btn span:first-child");
    const thnSel = document.querySelector("#ai-thinking-sel .pv-sel-btn span:first-child");
    const modSel = document.querySelector("#ai-model-label");
    const enabled = enaSel?.textContent === "ON";
    const routerMode = rtrSel?.textContent === "ON";
    const thinking = thnSel?.textContent !== "OFF";
    const model = modSel?.textContent || getProjectData().aiConfig.model || "";
    const maxTokensRaw = $("ai-max-tokens")?.value?.trim() || "";
    const maxTokens = maxTokensRaw !== "" ? parseInt(maxTokensRaw, 10) || "" : "";
    const temperatureRaw = $("ai-temperature")?.value?.trim() || "";
    const temperature = temperatureRaw !== "" ? parseFloat(temperatureRaw) : "";
    getProjectData().aiConfig = {
        endpoint: ep,
        apiKey,
        enabled,
        routerMode,
        thinking,
        model: routerMode ? model : "",
        models: getProjectData().aiConfig.models || [],
        maxTokens,
        temperature,
    };
    closeModal();
    pushUndo();
    showToast("AI設定を保存しました");
}

// ── エディタ内検索 ────────────────────────────────────
// 現在アクティブなエディタ（yaml-ta / js-ta）から検索ワードを探す。
// 現在のカーソル位置から次の一致箇所へ移動し、末尾まで行ったら先頭から再検索。
function editorSearch() {
    const word = $("editor-search-in")?.value || "";
    if (!word) return;

    // 現在表示中のタブ（YAML/JS）でエディタを判定
    const isJs = $("pane-js")?.classList.contains("active");
    const ta = isJs ? $("js-ta") : $("yaml-ta");
    if (!ta) { showToast("エディタが見つかりません"); return; }

    const text = ta.value;
    const lower = text.toLowerCase();
    const lword = word.toLowerCase();

    // 検索開始位置：前回と同じエディタ・同じワードなら前回の終端から、それ以外はカーソル位置から
    let startPos = 0;
    if (getEditorContext().searchLast.taId === ta.id && getEditorContext().searchLast.word === word) {
        startPos = getEditorContext().searchLast.pos;
    } else {
        startPos = ta.selectionEnd || 0;
    }

    // 現在位置から前方検索
    let idx = lower.indexOf(lword, startPos);
    let wrapped = false;

    // 末尾まで行ったら先頭から再検索（ループ）
    if (idx < 0 && startPos > 0) {
        idx = lower.indexOf(lword, 0);
        wrapped = true;
    }

    if (idx < 0) {
        showToast("「" + word + "」は見つかりません");
        getEditorContext().searchLast = { taId: ta.id, word, pos: 0 };
        return;
    }

    if (wrapped) showToast("先頭に戻りました");

    // カーソルを一致箇所に移動してフォーカス
    ta.focus();
    ta.selectionStart = idx;
    ta.selectionEnd = idx + word.length;
    _ensureCursorVisible(ta);
    editorHlUpdate(ta.id);

    // 次回検索のために終端位置を記録
    getEditorContext().searchLast = { taId: ta.id, word, pos: idx + word.length };
}

/* ═══════════════════════════════════════════
   window へのエクスポート（他ファイルから参照される関数のみ）
═══════════════════════════════════════════ */
Object.assign(window, {
    _parseApiRefNav, openApiRef, openYaml,
    yamlBuildRightPanel, yamlRpSection, yamlToggleRpSection, yamlToggleTblCols,
    yamlInitRpanelEvents, yamlInitResize, yamlInsert, yamlAiGenerate,
    editorKeyHandler, editorMouseDownHandler2, editorDblClickHandler, editorHlUpdate,
    buildYamlEditorHTML, initYamlEditorModal,
    openAiConfig, aiCfgModelListHtml, aiCfgToggleRouter, aiCfgToggleEnabled,
    aiCfgFetchModels, saveAiConfig,
    editorSearch,
});
