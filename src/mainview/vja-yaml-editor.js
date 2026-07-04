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
     - yamlBuildRightPanel() と _rpBuildXxxSection() 系（通常YAML/JSエディタ
       右パネルの5セクション）
     - yamlBuildFormDesignRightPanel() / _rpBuildWidgetTagSection()（フォーム
       デザインエディタ専用の右パネル。定数・テーブル一覧・ウィジェット種別
       （FORM_DESIGN_TAGS）の3セクションを表示。buildYamlEditorHTML()の
       tabConfig.rightPanel==="formDesign" のときのみ有効化される）
     - openAiConfig() / yamlAiGenerate() / runAiGenerate()（AI生成）
     - buildTablesCtxText()（テーブルのカラム定義をAI向けテキスト化。
       yamlAiGenerate()とformDesignAiGenerate()で共有）
     - openFormDesignAi() / formDesignAiGenerate()（AIによる画面デザイン
       自動生成。ウィジェット構成JSON配列を生成しapplyAiFormDesign()
       ［vja-designer.js］へ渡して現在フォームに一括反映する）
     - validateGeneratedJs() / annotateUnknownApis() / manualRetryAiFix()
       （yamlAiGenerate()生成結果の検証。以下を検出する:
       1. 構文エラー
       2. 未知API（prompt-def.js の VJA_USE_FRONT_JS_INFO/VJA_USE_BACK_JS_INFO
          から自動抽出したホワイトリストに無い vja系/console系 の呼び出し）
       3. 禁止パターン（require/ヘルパー関数定義/.then/.catch/
          window.alert・confirm・prompt/window.location/new Promise/
          addEventListener 等）
       4. await漏れ（同ドキュメントで「await付き」と明記されているAPIが
          await無しで呼ばれている）
       5. 未知のウィジェット名（vja.widget.get/set等に、現在のフォームに
          存在しないウィジェット名が文字列リテラルで渡されている）
       フロント/バックエンドのAPI一覧は必ず分離して扱うこと＝混在させると
       誤検知の方向を誤る。
       上記1〜5は検証NGとして扱い、1回だけ自動修正を再試行、それでもNGなら
       生成は止めずに警告バナー［showAiValidationWarningBanner()］を表示して
       人間の判断に委ねる。
       別枠として styleWarnings（var/let/const の使い分けルール違反）も
       検出するが、こちらは検証NG・自動リトライの対象に含めない
       （生成コードは毎回新規スコープで実行されるため実害が無く、小型
       モデルは指摘してもvarに直しきれないことが多いため）。行コメントの
       挿入のみ行い、人間の目視修正に委ねる。）
     - _runMockSmokeTest() / _augmentWithMockCheck()
       （モック実行スモークテスト。生成コードを vja-mock-runtime.js の
       ダミー実装と一緒に実際に1回実行し、構文・API・await漏れ等の
       静的チェックでは拾えない実行時例外を検出する。AI接続設定の
       「モック実行検証」がOFFの場合は実施しない。分岐(if/else)の全経路は
       検証できない点に注意（1回の実行では1パターンの値しか通らない）。
       拡張ランタイム関数は _buildExtRuntimeMock() でプロジェクトの
       extRuntime.docから動的にモック生成する）
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
    pvRegister("yamlAiGenRandom", () => yamlAiGenerate(wid, evName, _getBoostedTemperature()));
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

// ── 右パネル: ウィジェット種別セクション（フォームデザインエディタ専用） ──
// AIによる画面デザイン自動生成YAMLで指定可能なウィジェットタグ（FORM_DESIGN_TAGS）の
// 一覧を表示する。タグ名クリックでタグ名そのものを挿入。detail情報がある場合は
// 折りたたみを展開すると詳細選択肢（inputType等）が表示され、クリックでその値を挿入する。
function _rpBuildWidgetTagSection() {
    return "<div>" + FORM_DESIGN_TAGS.map(d => {
        const tn = esc(d.tag);
        const optRows = (d.options || []).map(o => {
            const on = esc(o);
            return "<tr class='rp-insert' data-insert='" + on + "'>"
                + "<td class='col-name'>" + on + "</td>"
                + "<td class='col-type'>" + (d.detailLabel ? esc(d.detailLabel) : "") + "</td>"
                + "<td></td></tr>";
        }).join("");
        const noteRow = d.note
            ? "<tr><td colspan='3' style='white-space:normal;color:var(--text3)'>" + esc(d.note) + "</td></tr>"
            : "";
        const hasExtra = optRows || noteRow;
        return "<div class='rp-tbl-row'>"
            + "<div class='rp-tbl-header'>"
            + "<span class='rp-tbl-name rp-insert' data-insert='" + tn + "'>" + tn + "</span>"
            + "<span class='rp-tbl-desc'>" + esc(d.label) + "</span>"
            + (hasExtra ? "<button class='rp-tbl-expand' " + evtAttr("onmousedown", "event.stopPropagation();yamlToggleTblCols(this)") + ">▶</button>" : "")
            + "</div>"
            + (hasExtra ? "<div class='rp-tbl-cols'><table>" + optRows + noteRow + "</table></div>" : "")
            + "</div>";
    }).join("") + "</div>";
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

// フォームデザインエディタ（AIでフォーム設計）専用の右パネル。
// 「定数」「テーブル一覧」に加え、AI画面デザイン生成YAML特有の
// 「ウィジェット種別」セクションを表示する。
function yamlBuildFormDesignRightPanel() {
    return [
        yamlRpSection("📌 定数", _rpBuildConstSection(), true),
        yamlRpSection("🗄 テーブル一覧", _rpBuildTableSection(), true),
        yamlRpSection("🧩 ウィジェット種別", _rpBuildWidgetTagSection(), true),
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
// 通常のYAML/JSエディタ（yaml-ta / js-ta）に加えて、tabConfig構成のエディタ
// （フォームデザインエディタ ta-fd 等）のアクティブなペインにも対応する汎用実装。
// アクティブなペイン（.yaml-pane.active）内のテキストエリアを探して挿入する。
function yamlInsert(text) {
    const activePane = document.querySelector(".yaml-pane.active");
    const ta = activePane ? activePane.querySelector("textarea.yaml") : null;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + text.length;
    ta.focus();
    if (ta.id === "yaml-ta") yamlHlUpdate();
    else if (ta.id === "js-ta") jsHlUpdate();
    else if (ta.id.startsWith("ta-")) _hlUpdate(ta.id, "hl-" + ta.id.slice(3), yamlTokenize);
}

// AI生成（llama-server 経由）
// YAML仕様からイベントの JavaScript コードを AI 生成する。
// プロジェクト情報・ウィジェット・テーブル定義をコンテキストとして渡す。
// 生成完了後に openYaml を再表示し、JS タブにコードをセットする。
// 指定テーブル一覧から、AIへ渡すカラム定義テキストを生成する
// （PK/NOT NULL/DEFAULT/INDEXフラグ付き）。yamlAiGenerate()と
// formDesignAiGenerate()の両方から共有される。
function buildTablesCtxText(targetTables) {
    return targetTables.length > 0
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
}

/* ═══════════════════════════════════════════
  生成JS検証（構文チェック・APIホワイトリスト検証）
  yamlAiGenerate() のAI生成結果に対し、明らかな問題
  （構文エラー・存在しないvja.*API呼び出し）を機械的に検出する。
  ホワイトリストは prompt-def.js の VJA_USE_FRONT_JS_INFO /
  VJA_USE_BACK_JS_INFO（AIに実際渡している説明文と同一ソース）
  から自動抽出するため、APIの追加・変更・削除があっても
  二重管理にならず自動的に追従する。
  フロント/バックエンドで利用可能なAPIが異なるため、
  ホワイトリストは絶対に混在させないこと（isAppEventで出し分ける）。
═══════════════════════════════════════════ */
// パース結果のキャッシュ（セッション中はprompt-def.jsの内容が変化しないため、
// 初回のみ正規表現抽出を行い、以降は再利用する）
let _vjaApiWhitelistCache = null; // { front: Set<string>, back: Set<string> }

// VJA_USE_FRONT_JS_INFO / VJA_USE_BACK_JS_INFO のテキストから
// "vja.xxx.yyy(" / "console.xxx(" のパターンを全て抽出しSetにする。
// 「関数名:」行だけでなく、説明文・使用例中に登場するものも含めて拾う
// （vja.trigger.click の説明文中にある vja.trigger.focus 等のバリエーションも
//   これにより自動的にホワイトリスト対象となる）。
function _extractVjaApiSet(text) {
    const set = new Set();
    const re = /\b((?:vja(?:\.\w+)+)|(?:console\.\w+))\s*\(/g;
    let m;
    while ((m = re.exec(text || "")) !== null) set.add(m[1]);
    return set;
}
function _getVjaApiWhitelist() {
    if (!_vjaApiWhitelistCache) {
        _vjaApiWhitelistCache = {
            front: _extractVjaApiSet(_PROMPT_DEF.VJA_USE_FRONT_JS_INFO),
            back: _extractVjaApiSet(_PROMPT_DEF.VJA_USE_BACK_JS_INFO),
        };
    }
    return _vjaApiWhitelistCache;
}

// VJA_USE_FRONT_JS_INFO / VJA_USE_BACK_JS_INFO 内で「await vja.xxx.yyy(」の
// ように "await " 付きで記載されているAPIを抽出する。
// ドキュメント側は「awaitが必須のAPIは必ずawait付きで記載する」運用のため、
// これも別途ホワイトリストを持たず、既存の説明文から自動抽出できる。
let _vjaAwaitRequiredCache = null; // { front: Set<string>, back: Set<string> }
function _extractAwaitRequiredApiSet(text) {
    const set = new Set();
    const re = /\bawait\s+((?:vja(?:\.\w+)+))\s*\(/g;
    let m;
    while ((m = re.exec(text || "")) !== null) set.add(m[1]);
    return set;
}
function _getVjaAwaitRequiredSet() {
    if (!_vjaAwaitRequiredCache) {
        _vjaAwaitRequiredCache = {
            front: _extractAwaitRequiredApiSet(_PROMPT_DEF.VJA_USE_FRONT_JS_INFO),
            back: _extractAwaitRequiredApiSet(_PROMPT_DEF.VJA_USE_BACK_JS_INFO),
        };
    }
    return _vjaAwaitRequiredCache;
}
// コード内で、await必須のAPIがawait無しで呼び出されている箇所を検出する。
// 戻り値: [{ line: 1-indexed行番号, api: "vja.xxx.yyy" }, ...]
function _findMissingAwaits(code, isAppEvent) {
    const required = isAppEvent ? _getVjaAwaitRequiredSet().back : _getVjaAwaitRequiredSet().front;
    const found = [];
    const seen = new Set();
    const re = /(await\s+)?\b(vja(?:\.\w+)+)\s*\(/g;
    let m;
    while ((m = re.exec(code)) !== null) {
        const hasAwait = !!m[1];
        const api = m[2];
        if (!hasAwait && required.has(api)) {
            const line = code.slice(0, m.index).split("\n").length;
            const key = line + ":" + api;
            if (!seen.has(key)) {
                seen.add(key);
                found.push({ line, api });
            }
        }
    }
    return found;
}

// 第1引数にウィジェット名（文字列リテラル）を取るAPIの一覧。
// ここに列挙したAPIについて、指定されたウィジェット名が現在のフォームに
// 実在するかを検証する。変数で渡されている場合（文字列リテラルでない場合）は
// 判定不能なため対象外とする。
const _WIDGET_NAME_ARG_APIS = [
    "vja.widget.get", "vja.widget.set",
    "vja.form.setParam", "vja.form.getParam",
];
// コード内で、上記API群に対して「現在のフォームに存在しないウィジェット名」が
// 文字列リテラルで渡されている箇所を検出する。vja.trigger.* も対象に含める
// （引数無し呼び出し＝全ウィジェット対象は除外）。
// 戻り値: [{ line, api, name }, ...]
function _findUnknownWidgetNames(code) {
    const widgetNames = new Set((getProjectData().widgets || []).map((w) => w.name));
    const found = [];
    const seen = new Set();
    // vja.widget.get/set, vja.form.setParam/getParam
    _WIDGET_NAME_ARG_APIS.forEach((api) => {
        const re = new RegExp(api.replace(/\./g, "\\.") + "\\s*\\(\\s*['\"]([^'\"]+)['\"]", "g");
        let m;
        while ((m = re.exec(code)) !== null) {
            const name = m[1];
            if (!widgetNames.has(name)) {
                const line = code.slice(0, m.index).split("\n").length;
                const key = line + ":" + api + ":" + name;
                if (!seen.has(key)) {
                    seen.add(key);
                    found.push({ line, api, name });
                }
            }
        }
    });
    // vja.trigger.xxx('ウィジェット名') 形式
    {
        const re = /\bvja\.trigger\.\w+\s*\(\s*['"]([^'"]+)['"]/g;
        let m;
        while ((m = re.exec(code)) !== null) {
            const name = m[1];
            if (!widgetNames.has(name)) {
                const line = code.slice(0, m.index).split("\n").length;
                const key = line + ":vja.trigger:" + name;
                if (!seen.has(key)) {
                    seen.add(key);
                    found.push({ line, api: "vja.trigger.*", name });
                }
            }
        }
    }
    return found;
}

/* ── モック実行スモークテスト ──
   構文チェック・APIホワイトリスト検証では拾えない「明らかな実行時例外
   （TypeError等）」を検出するため、生成コードをモックランタイム
   （vja-mock-runtime.js）と一緒に実際に1回実行してみる。
   AI接続設定の「モック実行検証」がOFFの場合は実施しない。
   【スコープ】分岐(if/else)の全パターンは検証できない（モックは1パターンの
   値しか返さないため）。あくまで「即座に落ちないか」の浅い確認。 */

// 拡張ランタイム（プロジェクト独自関数）のモックを、現在のプロジェクトの
// extRuntime.doc（EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT形式のYAML）から
// 動的に生成する。関数名だけを正規表現で抽出し、常に汎用的な非同期ダミー
// 関数を割り当てる（同期関数として呼ばれても、戻り値のPromiseの未使用
// プロパティアクセスはundefinedになるだけでクラッシュしないため問題ない）。
function _buildExtRuntimeMock() {
    const doc = getProjectData().extRuntime?.doc || "";
    const mock = {};
    const re = /^-\s*function:\s*(?:await\s+)?(\w+)\s*\(/gm;
    let m;
    while ((m = re.exec(doc)) !== null) {
        mock[m[1]] = async () => ({});
    }
    return mock;
}

// 生成コードをモックランタイムと共に実際に1回実行し、実行時例外が
// 発生しないかを確認する。例外が無ければnull、あれば例外メッセージを返す。
async function _runMockSmokeTest(code, isAppEvent, evName, wtag) {
    if (getProjectData().aiConfig.mockCheckEnabled === false) return null;
    if (!window.VJA_MOCK_RUNTIME) return null; // 読み込み失敗時は検証をスキップ
    try {
        const vjaMock = window.VJA_MOCK_RUNTIME.build(isAppEvent, evName, wtag);
        const extMock = _buildExtRuntimeMock();
        const extNames = Object.keys(extMock);
        const extValues = extNames.map((n) => extMock[n]);
        const fn = new Function("vja", ...extNames, "return (async()=>{\n" + code + "\n})()");
        await fn(vjaMock, ...extValues);
        return null;
    } catch (e) {
        return (e && e.message) ? e.message : String(e);
    }
}

// 構文チェックのみ行う（実行はしない）。
// async関数本体として構文解析させることで、トップレベルawaitを許容しつつ
// 実際にコードが実行されることは無い（関数を生成するだけで呼び出さない）。
function _checkJsSyntax(code) {
    try {
        new Function("return async function(){\n" + code + "\n}");
        return null;
    } catch (e) {
        return e.message || String(e);
    }
}

// コード内の vja.*/console.* 呼び出しを走査し、ホワイトリストに
// 存在しないものを行番号付きで検出する。
// 戻り値: [{ line: 1-indexed行番号, api: "vja.xxx.yyy" }, ...]
function _findUnknownApis(code, isAppEvent) {
    const whitelist = isAppEvent ? _getVjaApiWhitelist().back : _getVjaApiWhitelist().front;
    const lines = code.split("\n");
    const found = [];
    const seen = new Set(); // 同一行・同一APIの重複検出を防ぐ
    const re = /\b((?:vja(?:\.\w+)+)|(?:console\.\w+))\s*\(/g;
    lines.forEach((line, idx) => {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(line)) !== null) {
            const api = m[1];
            if (!whitelist.has(api)) {
                const key = idx + ":" + api;
                if (!seen.has(key)) {
                    seen.add(key);
                    found.push({ line: idx + 1, api });
                }
            }
        }
    });
    return found;
}

// VJAのイベント処理コードとして構造的に禁止されているパターンを検出する。
// システムプロンプト（prompt-def.js）で明示的に禁止している構造の中でも、
// 機械的に検出可能なものを対象とする。
// 戻り値: [{ line: 1-indexed行番号, message: string }, ...]
const _FORBIDDEN_PATTERNS = [
    { re: /\brequire\s*\(/, message: "require() の使用（VJAではNode.js形式のrequireは使用できません）" },
    { re: /\bmodule\.exports\b/, message: "module.exports の使用（VJAではモジュール構文は不要です）" },
    { re: /^\s*(?:async\s+)?function\s+\w+\s*\(/, message: "ヘルパー関数の定義（インライン記述ルール違反。関数定義は禁止されています）" },
    { re: /\.then\s*\(/, message: ".then() の使用（Promiseチェーンは禁止。awaitを使用してください）" },
    { re: /\.catch\s*\(/, message: ".catch() の使用（Promiseチェーンは禁止。try/catchとawaitを使用してください）" },
    { re: /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/, message: "window.alert/confirm/prompt の使用（VJAではvja.app.showDialog/showConfirmを使用してください）" },
    { re: /\bwindow\.location\b/, message: "window.location の使用（画面遷移はvja.form.navigate()のみ使用してください）" },
    { re: /\bnew\s+Promise\s*\(/, message: "new Promise() の使用（Promiseの明示的な生成は禁止。awaitを使用してください）" },
    { re: /\baddEventListener\s*\(/, message: "addEventListener() の使用（VJAではイベント登録は不要。処理は直接記述してください）" },
];
function _findForbiddenPatterns(code) {
    const lines = code.split("\n");
    const found = [];
    lines.forEach((line, idx) => {
        _FORBIDDEN_PATTERNS.forEach(({ re, message }) => {
            if (re.test(line)) found.push({ line: idx + 1, message });
        });
    });
    return found;
}

// 変数宣言スタイル（var/let/const）の警告を検出する。
// フロントエンド: varのみ許可（let/constは違反）
// バックエンド: constのみ禁止（letは許可）
// 【注意】これは検出のみを行い、AIへの自動修正リトライ・validation.ok判定には
// 含めない（コメント挿入のみ。理由: 生成コードは毎回新規スコープで実行される
// ため実害が無く、また小型モデルは指摘してもvarに直しきれないことが多く、
// リトライしても改善しないケースがほとんどのため）。
function _findStyleWarnings(code, isAppEvent) {
    const lines = code.split("\n");
    const found = [];
    const re = isAppEvent ? /\bconst\s+\w/ : /\b(?:let|const)\s+\w/;
    lines.forEach((line, idx) => {
        if (re.test(line)) {
            found.push({
                line: idx + 1,
                message: isAppEvent
                    ? "変数宣言スタイル: constの使用（バックエンドではletのみ推奨）"
                    : "変数宣言スタイル: let/constの使用（フロントエンドではvarのみ推奨）",
            });
        }
    });
    return found;
}

// このイベント(evName/wtag)で vja.event.get().type に入り得る「正しい値」を
// 機械的に算出する。不明な場合はnullを返す（チェック対象外）。
function _expectedEventTypes(evName, wtag) {
    if (!evName) return null;
    if (evName === "RowClick") return ["rowClick"];
    if (evName === "HeaderClick") return ["headerClick"];
    if (evName === "Click" && wtag === "datagrid") return ["rowClick", "headerClick"];
    return [evName.charAt(0).toLowerCase() + evName.slice(1)];
}

// vja.event.get()の戻り値の.typeと、実際にはあり得ない値を比較しているケースを
// 検出する（例: KeyUpイベント用のコードなのに ev.type === 'keyDown' と誤記する）。
// 正規表現による2段階抽出:
//   1. "var/let/const 変数名 = vja.event.get()" から代入先変数名を特定
//   2. "変数名.type === '値'" の比較を全て抜き出し、期待値と照合
// 【制約】分割代入や、比較の左右が逆（'値' === 変数名.type）のケースは対象外。
function _findEventTypeMismatch(code, evName, wtag) {
    const expected = _expectedEventTypes(evName, wtag);
    if (!expected) return [];
    const found = [];
    const declRe = /\b(?:var|let|const)\s+(\w+)\s*=\s*vja\.event\.get\s*\(\s*\)/g;
    let dm;
    while ((dm = declRe.exec(code)) !== null) {
        const varName = dm[1];
        const cmpRe = new RegExp("\\b" + varName + "\\.type\\s*(?:===|==)\\s*['\"]([^'\"]+)['\"]", "g");
        let cm;
        while ((cm = cmpRe.exec(code)) !== null) {
            const actual = cm[1];
            if (!expected.includes(actual)) {
                const line = code.slice(0, cm.index).split("\n").length;
                found.push({ line, expected, actual });
            }
        }
    }
    return found;
}

// 生成コードを検証する。戻り値: { ok, syntaxError, unknownApis, forbiddenPatterns, ... }
function validateGeneratedJs(code, isAppEvent, evName, wtag) {
    const syntaxError = _checkJsSyntax(code);
    const unknownApis = _findUnknownApis(code, isAppEvent);
    const forbiddenPatterns = _findForbiddenPatterns(code);
    const missingAwaits = _findMissingAwaits(code, isAppEvent);
    const unknownWidgets = _findUnknownWidgetNames(code);
    const eventTypeMismatches = _findEventTypeMismatch(code, evName, wtag);
    // styleWarnings（変数宣言スタイル）はNG判定・自動リトライの対象に含めない。
    // 実害が無く、リトライしても改善しないことが多いため、
    // 行コメントでの指摘のみに留める。
    const styleWarnings = _findStyleWarnings(code, isAppEvent);
    return {
        ok: !syntaxError && unknownApis.length === 0 && forbiddenPatterns.length === 0
            && missingAwaits.length === 0 && unknownWidgets.length === 0 && eventTypeMismatches.length === 0,
        syntaxError, unknownApis, forbiddenPatterns, missingAwaits, unknownWidgets, eventTypeMismatches, styleWarnings,
    };
}

// 未知API・禁止パターンが検出された行の末尾に、指摘コメントを挿入する。
// （構文エラーは行の特定精度が低いため、行コメント挿入の対象外とする）
function annotateUnknownApis(code, unknownApis, forbiddenPatterns, missingAwaits, unknownWidgets, styleWarnings, eventTypeMismatches) {
    const byLine = new Map();
    (unknownApis || []).forEach(({ line, api }) => {
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line).push("未知のAPI: " + api + " は存在しません（VJAランタイムを確認してください）");
    });
    (forbiddenPatterns || []).forEach(({ line, message }) => {
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line).push(message);
    });
    (missingAwaits || []).forEach(({ line, api }) => {
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line).push("await漏れ: " + api + " はawaitが必要です");
    });
    (unknownWidgets || []).forEach(({ line, api, name }) => {
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line).push("未知のウィジェット名: " + api + "('" + name + "') は現在のフォームに存在しません");
    });
    (eventTypeMismatches || []).forEach(({ line, expected, actual }) => {
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line).push("ev.typeの比較値'" + actual + "'は、このイベントではあり得ません（正しくは" + expected.map((e) => "'" + e + "'").join(" または ") + "）");
    });
    (styleWarnings || []).forEach(({ line, message }) => {
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line).push(message);
    });
    if (byLine.size === 0) return code;
    return code.split("\n").map((lineText, idx) => {
        const msgs = byLine.get(idx + 1);
        if (!msgs) return lineText;
        return lineText + "  // ⚠ " + msgs.join(" / ");
    }).join("\n");
}

// 「🎲 ランダム性を上げて再生成」ボタン用のtemperatureを決定する。
// 現在の設定値に+0.3した値を返す（未設定の場合は0.7固定）。
// 上限は一般的なAPIの上限に合わせ2.0でクランプする。
// プロジェクト設定自体（aiConfig.temperature）は書き換えない、その場限りの上書き。
function _getBoostedTemperature() {
    const t = getProjectData().aiConfig.temperature;
    if (t === "" || t == null) return 0.7;
    const n = Number(t);
    return Number.isFinite(n) ? Math.min(n + 0.3, 2) : 0.7;
}

// 検証NG時、AIに修正を依頼するためのユーザープロンプトを組み立てる。
// 元のユーザープロンプト＋検出した問題点＋直前の生成コードを添えて、
// 修正後のコードのみを出力するよう指示する。
// 検証結果を、デバッグログ出力用の人間可読な文字列に整形する。
// リトライが発生した際、「なぜリトライされたか」を画面のログから
// 確認できるようにするためのもの。
function _formatValidationIssuesForLog(validation) {
    const parts = [];
    if (validation.syntaxError) parts.push("構文エラー: " + validation.syntaxError);
    validation.unknownApis.forEach(({ line, api }) => parts.push(line + "行目: 未知のAPI " + api));
    validation.forbiddenPatterns.forEach(({ line, message }) => parts.push(line + "行目: " + message));
    validation.missingAwaits.forEach(({ line, api }) => parts.push(line + "行目: await漏れ " + api));
    validation.unknownWidgets.forEach(({ line, api, name }) => parts.push(line + "行目: 未知のウィジェット名 " + name + "（" + api + "）"));
    if (validation.mockError) parts.push("モック実行例外: " + validation.mockError);
    return parts.length > 0 ? parts.join(" / ") : "(詳細なし)";
}

function _buildAiFixPrompt(originalUserPrompt, code, validation) {
    const issues = [];
    if (validation.syntaxError) issues.push("- 構文エラー: " + validation.syntaxError);
    validation.unknownApis.forEach(({ line, api }) => {
        issues.push("- " + line + "行目付近: 存在しないAPI \"" + api + "\" が使用されています。VJAランタイムに実在するAPIのみを使用してください。");
    });
    validation.forbiddenPatterns.forEach(({ line, message }) => {
        issues.push("- " + line + "行目付近: " + message);
    });
    validation.missingAwaits.forEach(({ line, api }) => {
        issues.push("- " + line + "行目付近: \"" + api + "\" はawaitを付けて呼び出す必要があります（await漏れ）。");
    });
    validation.unknownWidgets.forEach(({ line, api, name }) => {
        issues.push("- " + line + "行目付近: \"" + api + "('" + name + "')\" のウィジェット名 \"" + name + "\" は現在のフォームに存在しません。実在するウィジェット名に修正してください。");
    });
    (validation.eventTypeMismatches || []).forEach(({ line, expected, actual }) => {
        issues.push("- " + line + "行目付近: ev.type === '" + actual + "' は誤りです。このイベントで実際にあり得る値は " + expected.map((e) => "'" + e + "'").join(" または ") + " のみです。");
    });
    if (validation.mockError) {
        issues.push("- モック実行時に例外が発生しました: " + validation.mockError + "（ダミー値での試験実行のため、実際の実行結果とは異なる場合がありますが、コードの構造に問題がある可能性が高いです）");
    }
    return originalUserPrompt +
        "\n\n[自動検証で以下の問題が検出されました。問題を修正し、修正後のコードのみを出力してください]\n" +
        issues.join("\n") +
        "\n\n[検出時のコード]\n```javascript\n" + code + "\n```";
}

// 検証NGのまま生成が確定した際の警告バナー用コンテキスト
// （手動リトライボタンから参照するため保持しておく）
let _lastAiValidationCtx = null;

// 検証NG（構文エラー・未知API・禁止パターン）の内容をまとめた警告バナーを、
// 現在開いているYAMLエディタモーダルの左ペイン上部に表示する。
// トーストと異なり、ユーザーが閉じるまで表示され続ける。
function showAiValidationWarningBanner(validation) {
    const left = document.querySelector(".yaml-editor-left");
    if (!left) return;
    const old = document.getElementById("ai-validation-banner");
    if (old) old.remove();
    const banner = document.createElement("div");
    banner.id = "ai-validation-banner";
    if (validation.ok) {
        // 検証OK：バナーは自動で消さず、再修正を依頼できる状態のまま維持する
        banner.style.cssText = "background:#2a4a2e;color:#d8ffe0;padding:10px 14px;font-size:12px;border-bottom:1px solid #3a7a4a;flex-shrink:0";
        banner.innerHTML =
            "<div style='font-weight:bold;margin-bottom:8px'>✅ 検証OKになりました（未知のAPI・構文エラーは検出されていません）</div>" +
            "<button class='yaml-ai-btn'" + evtAttr("onmousedown", "manualRetryAiFix()") + ">🤖 もう一度AIに修正を依頼</button> " +
            "<button class='yaml-ai-btn'" + evtAttr("onmousedown", "dismissAiValidationBanner()") + ">閉じる</button>";
        left.insertBefore(banner, left.firstChild);
        return;
    }
    const items = [];
    if (validation.syntaxError) items.push("・構文エラーの可能性: " + esc(validation.syntaxError));
    validation.unknownApis.forEach(({ line, api }) => {
        items.push("・" + line + "行目付近: 未知のAPI「" + esc(api) + "」");
    });
    validation.forbiddenPatterns.forEach(({ line, message }) => {
        items.push("・" + line + "行目付近: " + esc(message));
    });
    validation.missingAwaits.forEach(({ line, api }) => {
        items.push("・" + line + "行目付近: await漏れ「" + esc(api) + "」");
    });
    validation.unknownWidgets.forEach(({ line, api, name }) => {
        items.push("・" + line + "行目付近: 未知のウィジェット名「" + esc(name) + "」（" + esc(api) + "）");
    });
    (validation.eventTypeMismatches || []).forEach(({ line, expected, actual }) => {
        items.push("・" + line + "行目付近: ev.typeの値「" + esc(actual) + "」はあり得ません（正しくは " + expected.map((e) => "「" + esc(e) + "」").join(" または ") + "）");
    });
    if (validation.mockError) items.push("・モック実行時に例外が発生: " + esc(validation.mockError));
    // 検出件数が多い場合、バナーの高さが際限なく伸びてエディタ領域（ガター等）の
    // 表示を崩すことがあるため、一覧部分は最大高さ＋内部スクロールに固定する。
    // さらに、全件を落ち着いて確認したい場合向けに別モーダル表示も用意する。
    _lastAiValidationItems = items;
    const MAX_INLINE_ITEMS = 6;
    const showDetailBtn = items.length > MAX_INLINE_ITEMS
        ? " <button class='yaml-ai-btn'" + evtAttr("onmousedown", "openAiValidationDetailModal()") + ">🔍 全" + items.length + "件を別ウィンドウで見る</button>"
        : "";
    banner.style.cssText = "background:#4a2a2a;color:#ffd8d8;padding:10px 14px;font-size:12px;border-bottom:1px solid #7a3a3a;flex-shrink:0;max-height:220px;display:flex;flex-direction:column";
    banner.innerHTML =
        "<div style='font-weight:bold;margin-bottom:4px;flex-shrink:0'>⚠ 生成コードに問題の可能性があります（自動修正後も検出、" + items.length + "件）" + showDetailBtn + "</div>" +
        "<div style='white-space:pre-line;margin-bottom:8px;overflow-y:auto;flex:1;min-height:0'>" + items.join("\n") + "</div>" +
        "<div style='flex-shrink:0'>" +
        "<button class='yaml-ai-btn'" + evtAttr("onmousedown", "manualRetryAiFix()") + ">🤖 もう一度AIに修正を依頼</button> " +
        "<button class='yaml-ai-btn'" + evtAttr("onmousedown", "dismissAiValidationBanner()") + ">このまま閉じる</button>" +
        "</div>";
    left.insertBefore(banner, left.firstChild);
}
// 警告バナーの一覧が多い場合の、全件確認用モーダル。
// 直前に表示したバナーの内容（_lastAiValidationItems）をそのまま表示する。
let _lastAiValidationItems = [];
function openAiValidationDetailModal() {
    showModal(
        mhdrHTML("⚠ 検出内容（全" + _lastAiValidationItems.length + "件）") +
        "<div class='mbody' style='display:flex;flex-direction:column;gap:8px'>" +
        "<div style='white-space:pre-line;max-height:60vh;overflow-y:auto;font-size:13px'>" +
        _lastAiValidationItems.join("\n") +
        "</div>" +
        "</div>" +
        mfootHTML([{ label: "閉じる", action: "closeModal()" }])
    );
}
function dismissAiValidationBanner() {
    document.getElementById("ai-validation-banner")?.remove();
}
// 警告バナーの「もう一度AIに修正を依頼」ボタン用。
// リトライ実行前に、前回付与済みの検証チェック処理の自動挿入行を取り除く。
// （manualRetryAiFixは複数回呼ばれ得るため、無いと呼ぶたびに二重・三重に
//   挿入されてしまう）
function _stripValidationWrapper(code, validationName) {
    if (!validationName) return code;
    const prefix = "// 検証チェック処理(自動追加).\n" +
        `if (!await vja.validate.run(${JSON.stringify(validationName)})) return;\n\n`;
    return code.startsWith(prefix) ? code.slice(prefix.length) : code;
}

// 現在js-taに表示されている内容を対象に、再検証→修正依頼を1回実行する。
async function manualRetryAiFix() {
    if (!_lastAiValidationCtx) return;
    const { sysPrompt, userPrompt, isAppEvent, wid, evName, isFormEvent, validationName, wtag } = _lastAiValidationCtx;
    const jsTa = $("js-ta");
    const currentCode = _stripValidationWrapper(jsTa?.value || "", validationName);
    let validation = validateGeneratedJs(currentCode, isAppEvent, evName, wtag);
    validation = await _augmentWithMockCheck(validation, currentCode, isAppEvent, evName, wtag);
    if (validation.ok) { dismissAiValidationBanner(); return; }
    window.vja?.log?.debug?.("[AI検証] 手動での修正依頼を実行します。検出内容: " + _formatValidationIssuesForLog(validation));
    const fixUserPrompt = _buildAiFixPrompt(userPrompt, currentCode, validation);
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: fixUserPrompt,
        loadingMsg: "検出した問題を自動修正中…",
        onSuccess: async (fixed) => {
            let revalidated = validateGeneratedJs(fixed, isAppEvent, evName, wtag);
            revalidated = await _augmentWithMockCheck(revalidated, fixed, isAppEvent, evName, wtag);
            window.vja?.log?.debug?.(revalidated.ok
                ? "[AI検証] 手動修正で解消しました。"
                : "[AI検証] 手動修正後も未解消: " + _formatValidationIssuesForLog(revalidated));
            let codeForEditor = annotateUnknownApis(
                fixed, revalidated.unknownApis, revalidated.forbiddenPatterns,
                revalidated.missingAwaits, revalidated.unknownWidgets, revalidated.styleWarnings,
                revalidated.eventTypeMismatches
            );
            if (validationName) {
                codeForEditor = "// 検証チェック処理(自動追加).\n" +
                    `if (!await vja.validate.run(${JSON.stringify(validationName)})) return;\n\n${codeForEditor}`;
            }
            // runAiGenerate() 実行中に modal-root がローディング表示へ差し替えられ、
            // 完了時に closeModal() されるため、YAMLエディタのモーダル自体が
            // 一旦消えている。ここで開き直してから反映する必要がある。
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
                const newJsTa = $("js-ta");
                if (newJsTa) newJsTa.value = codeForEditor;
                yamlTabSwitch("js");
                jsHlUpdate();
                editorUpdateGutter("js-ta", "js-gutter");
                showAiValidationWarningBanner(revalidated);
                if (revalidated.ok) showToast("✅ 修正が完了しました");
            }));
        },
        onCancel: async () => { },
        onError: async () => { },
    });
}

// validateGeneratedJs()の結果に、モック実行スモークテストの結果を
// マージする。mockErrorが検出された場合はokをfalseにする。
async function _augmentWithMockCheck(validation, code, isAppEvent, evName, wtag) {
    const mockError = await _runMockSmokeTest(code, isAppEvent, evName, wtag);
    if (!mockError) return validation;
    return { ...validation, ok: false, mockError };
}

async function yamlAiGenerate(wid, evName, temperatureOverride) {
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
    const randomBtn = $("ai-gen-random-btn");
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
    const tablesCtx = buildTablesCtxText(targetTables);

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
        if (randomBtn) randomBtn.disabled = false;
        if (status) status.textContent = "";
        return;
    }
    // AI生成前にデータを保存（モーダルは閉じない）
    _saveYamlData(wid, evName);
    if (btn) btn.disabled = true;
    if (randomBtn) randomBtn.disabled = true;
    if (status) status.textContent = "⏳ コンテキスト収集中…";
    showLoadingModal("AI生成中…");

    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        temperatureOverride: temperatureOverride,
        onSuccess: async (clean) => {
            // async function handleXxx() { ... } のラッパーを自動除去
            // 3Bモデル等が関数ラッパーを生成してしまう場合の後処理
            const _unwrap = (code) => {
                return code.replace(
                    /^\s*async\s+function\s+\w+\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/,
                    (_, inner) => inner.trim()
                );
            };
            let unwrapped = _unwrap(clean);

            // ── 生成結果の自動検証（構文チェック・APIホワイトリスト） ──
            // 問題があれば1回だけAIに自動修正を依頼し、それでも解消しない場合は
            // 警告バナーで人間に判断を委ねる（生成自体は止めない）。
            // ※temperatureの自動引き上げは行わない（通常のtemperature設定を
            //   そのまま使う）。ランダム性を上げて試したい場合は、エディタの
            //   「🎲 ランダム性を上げて再生成」ボタンを使う。
            let validation = validateGeneratedJs(unwrapped, isAppEvent, evName, w?.tag);
            validation = await _augmentWithMockCheck(validation, unwrapped, isAppEvent, evName, w?.tag);
            if (!validation.ok) {
                const issueLog = _formatValidationIssuesForLog(validation);
                window.vja?.log?.debug?.("[AI検証] 自動修正リトライを実行します。検出内容: " + issueLog);
                if (status) status.textContent = "⏳ 検出した問題を自動修正中…";
                const fixUserPrompt = _buildAiFixPrompt(userPrompt, unwrapped, validation);
                let retryCode = null;
                await runAiGenerate({
                    systemPrompt: sysPrompt,
                    userPrompt: fixUserPrompt,
                    loadingMsg: "検出した問題を自動修正中…",
                    temperatureOverride: temperatureOverride,
                    onSuccess: async (fixed) => { retryCode = _unwrap(fixed); },
                    onCancel: async () => { },
                    onError: async () => { },
                });
                if (retryCode) {
                    unwrapped = retryCode;
                    validation = validateGeneratedJs(unwrapped, isAppEvent, evName, w?.tag);
                    validation = await _augmentWithMockCheck(validation, unwrapped, isAppEvent, evName, w?.tag);
                    window.vja?.log?.debug?.(validation.ok
                        ? "[AI検証] 自動修正リトライで解消しました。"
                        : "[AI検証] 自動修正リトライ後も未解消: " + _formatValidationIssuesForLog(validation));
                } else {
                    window.vja?.log?.debug?.("[AI検証] 自動修正リトライ自体が失敗しました（キャンセル/エラー）。");
                }
                // retryCodeがnull（リトライ自体が失敗）の場合も、元のunwrapped/validationのまま続行し
                // 後段の警告バナーでユーザーに通知する
            }

            // 検出された問題の行にのみ、指摘コメントを挿入する
            // （構文エラーは行特定の精度が低いため行コメント対象外。バナーでのみ通知）
            const codeForEditor = annotateUnknownApis(
                unwrapped, validation.unknownApis, validation.forbiddenPatterns,
                validation.missingAwaits, validation.unknownWidgets, validation.styleWarnings,
                validation.eventTypeMismatches
            );

            // バリデーション定義がある場合、JSの先頭に呼び出しを挿入
            // vja.validate.run('定義名') → false=エラー時はreturnで処理中断
            const finalCode = validationName
                ? "// 検証チェック処理(自動追加).\n" +
                `if (!await vja.validate.run(${JSON.stringify(validationName)})) return;\n\n${codeForEditor}`
                : codeForEditor;
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
                editorUpdateGutter("js-ta", "js-gutter");
                if (status) status.textContent = "✅ 生成完了 (JavaScriptタブを確認)";
                const elapsed = Math.round((Date.now() - aiStartTime) / 1000);
                showToast("✅ AI生成完了（" + elapsed + "秒）", 5000);
                if (!validation.ok) {
                    _lastAiValidationCtx = { sysPrompt, userPrompt, isAppEvent, wid, evName, isFormEvent, validationName, wtag: w?.tag };
                    showAiValidationWarningBanner(validation);
                }
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
    if (randomBtn) randomBtn.disabled = false;
}

/* ═══════════════════════════════════════════
  AIによる画面デザイン自動生成
  「説明/入力項目/参照テーブル」を書いた依頼テキストをAIに渡し、
  ウィジェット構成JSON配列を生成→applyAiFormDesign()で現在フォームへ反映する。
═══════════════════════════════════════════ */
function openFormDesignAi() {
    // 複数選択中にAI設計ボタンを操作した場合は選択を解除する
    // （deselect()でハイライト・ヘッダー表示も含めて更新する）
    if (getDesignerState().selIds.length > 1) deselect();
    if (!getProjectData().aiConfig.enabled) {
        vja.app.showConfirm("AI接続設定が有効になっていません。設定画面を開きますか？").then((yes) => {
            if (yes) openAiConfig();
        });
        return;
    }
    const template = getProjectData().formDesignDraft || _PROMPT_DEF.DEFAULT_FORM_DESIGN_YAML;
    const tabConfig = {
        tabs: [
            { id: "fd", label: "📋 画面デザイン依頼", type: "yaml", val: template },
        ],
        aiBar:
            "<input id='fd-prompt-in' placeholder='追加指示（任意）例：入力欄は必須のものだけにしてほしい' style='flex:1'>" +
            "<button class='yaml-ai-btn'" + evtAttr("onmousedown", "formDesignAiGenerate()") + " id='fd-gen-btn'>🤖 生成</button>",
        saveAction: "saveFormDesignDraft()",
        rightPanel: "formDesign",
    };
    showModal(buildYamlEditorHTML("", "", false, mhdrHTML("🤖 AIでフォーム設計"), "", tabConfig));
    requestAnimationFrame(() => {
        applyEditorConfig();
        _hlUpdate("ta-fd", "hl-fd", yamlTokenize);
        editorUpdateGutter("ta-fd", "gutter-fd");
        const ta = $("ta-fd");
        if (ta) {
            ta.addEventListener("keydown", editorKeyHandler);
            ta.addEventListener("mousedown", editorMouseDownHandler2);
            ta.addEventListener("dblclick", editorDblClickHandler);
            ta.addEventListener("input", () => { _hlUpdate("ta-fd", "hl-fd", yamlTokenize); editorUpdateGutter("ta-fd", "gutter-fd"); });
            ta.addEventListener("scroll", () => _hlSync("ta-fd", "hl-fd"));
            editorUndoInit("ta-fd", _FORMDESIGN_EDITOR.taUndo, ta.value);
        }
        yamlInitResize();
        yamlInitRpanelEvents();
    });
}

// 依頼テキストの下書きを保存して閉じる（既存の拡張ランタイム設定と同じ「保存」の考え方）
function saveFormDesignDraft() {
    getProjectData().formDesignDraft = $("ta-fd")?.value || "";
    closeModal();
}

// 「説明:」「入力項目:」「参照テーブル:」の3セクションを正規表現で抽出する
// （このプロジェクトはYAMLを厳密パースせず、既存の「利用テーブル:」抽出と同じ
//  軽量な正規表現方式に統一している）
function _parseFormDesignYaml(text) {
    const descM = text.match(/説明\s*:\s*(.*)$/m);
    let desc = descM ? descM[1].trim().replace(/^["']|["']$/g, "") : "";
    const tblM = text.match(/参照テーブル\s*:\s*\n([\s\S]*?)(?:\n\S|\n\n|$)/);
    const tables = [];
    if (tblM) {
        tblM[1].split("\n").forEach((l) => {
            const name = l.replace(/^\s*-\s*/, "").replace(/#.*$/, "").trim();
            if (name) tables.push(name);
        });
    }
    return { desc, tables };
}

// AI（フォームデザイン）出力テキストを配列としてパースする。
// 1. まずそのままJSON.parseを試みる
// 2. 失敗した場合、AIが前後に説明文を付けてしまうケースを救うため、
//    最初の "[" ～ 最後の "]" を抜き出して再度パースを試みる
// 成功時はウィジェット配列を、失敗時（配列でない場合含む）はnullを返す。
function parseFormDesignJson(text) {
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

// AI出力の解析に失敗した際、生データを確認できるモーダルを表示する。
// テキストエリアに生データを表示し、コピーして原因調査できるようにする。
function openAiRawOutputModal(rawText) {
    showModal(
        mhdrHTML("⚠ AI出力の解析に失敗しました") +
        "<div class='mbody' style='display:flex;flex-direction:column;gap:8px'>" +
        "<div style='color:var(--text2);font-size:13px'>" +
        "AIの生データ（JSON形式として解釈できませんでした）。内容を確認・コピーできます。" +
        "</div>" +
        "<textarea readonly style='width:100%;height:320px;font-family:monospace;font-size:12px'>" +
        esc(rawText) +
        "</textarea>" +
        "</div>" +
        mfootHTML([{ label: "閉じる", action: "closeModal()" }])
    );
}

async function formDesignAiGenerate() {
    if (getProjectData().widgets.length > 0) {
        const ok = await vja.app.showConfirm(
            "AI生成を実行すると、現在のフォームの\n" +
            "全ウィジェットが削除されます。\n" +
            "設定済みのイベント処理（コード）も\n" +
            "全て失われます。\n" +
            "（Ctrl+Zで元に戻すことは可能です）\n\n" +
            "続行しますか？"
        );
        if (!ok) return;
    }
    const ta = $("ta-fd");
    const rawText = ta?.value || "";
    const { desc, tables } = _parseFormDesignYaml(rawText);
    const curForm = getProjectData().forms[getProjectData().curFormIdx];

    const targetTables = getProjectData().tables.filter((t) => tables.includes(t.name));
    const tablesCtx = buildTablesCtxText(targetTables);

    // 「説明:」が空の場合のみ、その行をフォームの説明で置き換える。
    // それ以外の内容は選別・再構築せず、書かれたテキストをそのままAIへ渡す。
    let designText = rawText;
    if (!desc) {
        const fallbackDesc = curForm?.cfg?.description || "";
        if (fallbackDesc) {
            designText = /説明\s*:.*$/m.test(rawText)
                ? rawText.replace(/説明\s*:.*$/m, "説明: " + fallbackDesc)
                : "説明: " + fallbackDesc + "\n" + rawText;
        }
    }

    const addPrompt = $("fd-prompt-in")?.value || "";
    const btn = $("fd-gen-btn");
    if (btn) btn.disabled = true;

    const sysPrompt = _PROMPT_DEF.FORM_DESIGN_SYS_PROMPT({
        formW: getProjectData().formCfg.w,
        formH: getProjectData().formCfg.h,
        tablesCtx,
    });
    const userPrompt = _PROMPT_DEF.FORM_DESIGN_USER_PROMPT(designText, addPrompt);

    // AI生成前に依頼テキストを下書き保存（モーダルは閉じない）
    getProjectData().formDesignDraft = rawText;

    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        loadingMsg: "画面デザインを生成中…",
        onSuccess: async (generated) => {
            const items2 = parseFormDesignJson(generated);
            if (!items2) {
                showToast("AI出力の解析に失敗しました（JSON形式ではありません）", 5000);
                window.vja?.log?.warn?.("[FormDesignAi] JSON parse failed. raw=" + generated.slice(0, 300));
                openAiRawOutputModal(generated);
                if (btn) btn.disabled = false;
                return;
            }
            // 既存ウィジェットを全削除してからAI結果を配置する
            // （削除前の状態をpushUndo()で退避＝Ctrl+Zで復元可能）
            if (getProjectData().widgets.length > 0) {
                pushUndo();
                getProjectData().widgets = [];
                getProjectData().forms[getProjectData().curFormIdx].widgets = getProjectData().widgets;
                getDesignerState().selIds = [];
                const po = $("prop-obj");
                if (po) po.textContent = getProjectData().formCfg.title;
                fullRedraw();
            }
            applyAiFormDesign(items2);
            closeModal();
        },
        onCancel: async () => { },
        onError: async () => { },
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
                : ta.id === "ta-fd" ? _FORMDESIGN_EDITOR.taUndo
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
    else if (taId === "ta-fd") { _hlUpdate("ta-fd", "hl-fd", yamlTokenize); editorUpdateGutter("ta-fd", "gutter-fd"); }
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
        // rightPanel: tabConfig利用画面のうち、フォームデザインエディタのみ右パネルを表示する
        // （拡張ランタイムエディタ等、他のtabConfig利用箇所には影響させない）
        const rightPanelHtml = tabConfig.rightPanel === "formDesign"
            ? "<div class='yaml-resize-handle' id='yaml-rhandle'></div>" +
              "<div class='yaml-editor-right' id='yaml-rpanel'>" + yamlBuildFormDesignRightPanel() + "</div>"
            : "<div class='yaml-editor-right' style='display:none'></div>";
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
            rightPanelHtml +
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
        "<button class='yaml-ai-btn' id='ai-gen-random-btn' title='temperatureを一時的に上げて再生成します（同じ間違いを繰り返す場合に）'" +
        evtAttr("onmousedown", "pvCall(\"yamlAiGenRandom\")") + ">🎲 ランダム性を上げて再生成</button>" +
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
    if (getProjectData().aiConfig.mockCheckEnabled === undefined) getProjectData().aiConfig.mockCheckEnabled = true;

    const isEnabled = getProjectData().aiConfig.enabled === true;
    const isRouter = getProjectData().aiConfig.routerMode === true;
    const isThinking = getProjectData().aiConfig.thinking !== false;
    const isMockCheckEnabled = getProjectData().aiConfig.mockCheckEnabled !== false;
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

        // モック実行検証（生成JSをモックランタイムで試験実行し、明らかな実行時例外を検出する）
        "<div class='ai-cfg-row'><label>モック実行検証</label>" +
        makePvSel("ai-mockcheck-sel", ["ON", "OFF"], isMockCheckEnabled ? "ON" : "OFF", "") +
        "</div>" +
        "<div class='infobox' style='font-size:11px'>AI生成コードを、ダミー値を返すモックVJAランタイムで試験実行し、構文・APIチェックでは拾えない実行時例外を検出します（分岐網羅までは保証しません）。</div>" +

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
    const mckSel = document.querySelector("#ai-mockcheck-sel .pv-sel-btn span:first-child");
    const modSel = document.querySelector("#ai-model-label");
    const enabled = enaSel?.textContent === "ON";
    const routerMode = rtrSel?.textContent === "ON";
    const thinking = thnSel?.textContent !== "OFF";
    const mockCheckEnabled = mckSel?.textContent !== "OFF";
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
        mockCheckEnabled,
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
    yamlBuildRightPanel, yamlBuildFormDesignRightPanel, yamlRpSection, yamlToggleRpSection, yamlToggleTblCols,
    yamlInitRpanelEvents, yamlInitResize, yamlInsert, yamlAiGenerate,
    editorKeyHandler, editorMouseDownHandler2, editorDblClickHandler, editorHlUpdate,
    buildYamlEditorHTML, initYamlEditorModal,
    openAiConfig, aiCfgModelListHtml, aiCfgToggleRouter, aiCfgToggleEnabled,
    aiCfgFetchModels, saveAiConfig,
    editorSearch, openFormDesignAi, formDesignAiGenerate, saveFormDesignDraft,
    parseFormDesignJson, openAiRawOutputModal,
    validateGeneratedJs, annotateUnknownApis, showAiValidationWarningBanner,
    openAiValidationDetailModal,
    dismissAiValidationBanner, manualRetryAiFix,
});
