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
       実行はWeb Worker内（_getMockWorkerUrl()）で行い、_MOCK_SMOKE_TIMEOUT_MS
       を超えた場合はworker.terminate()で強制終了する（生成コードが無限ループを
       含んでいてもUIをフリーズさせないための対策。単純なsetTimeoutでは
       同期的な無限ループを止められないため、別スレッド実行＋terminate()が必須）。
       Worker内では vja-mock-runtime.js を importScripts で読み込めない
       （electrobunのカスタムスキームがWorkerからのネットワーク読み込みに
       対応しておらず NetworkError: Load failed になる）ため、そのロジックを
       _MOCK_WORKER_RUNTIME_SRC として複製・埋め込みしている。
       vja-mock-runtime.js側を変更した場合はこちらも同期して修正すること。
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
    pvRegister("yamlMockCheck", () => manualMockCheck(false, evName, getWidget(wid)?.tag, wid));
    pvRegister("yamlMockEdit", () => openMockOverrideEditor(wid, evName));
    showModal(buildYamlEditorHTML(cur, curJs, true, mhdrHTML("📋 " + esc(w.name) + " — " + esc(evName)), "", null, isAppEvent, wid, evName));
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
function _rpBuildTableSection(wid, evName, curYaml) {
    if (getProjectData().tables.length === 0) {
        return "<div style='padding:8px 10px;font-size:11px;color:var(--text3)'>テーブルなし</div>";
    }
    const hasCtx = !!(wid && evName);
    let enabledSet = new Set();
    if (hasCtx) {
        // 初期表示時（モーダルHTML構築中）はまだDOMにyaml-taが存在しないため、
        // 引数で渡されたYAML本文（curYaml）を使う。DOM経由の$("yaml-ta")には依存しない。
        enabledSet = new Set(_ensureTableOptInitialized(wid, evName, curYaml || ""));
    }
    return "<div>" + getProjectData().tables.map((t) => {
        const tn = esc(t.name);
        const cols = (t.columns || []).map(c => {
            const flags = [c.pk ? "PK" : "", c.notNull ? "NN" : "", c.useDefault ? "DEF" : "", c.index ? "IDX" : ""].filter(Boolean).join(" ");
            const cn = esc(c.name);
            return "<tr class='rp-insert' data-insert='" + cn + "'>"
                + "<td class='col-name'>" + cn + "</td>"
                + "<td class='col-type'>" + esc(c.type) + "</td>"
                + "<td class='col-flag'>" + flags + "</td></tr>";
        }).join("");
        const toggleHtml = hasCtx
            ? "<div style='width:52px;flex-shrink:0;margin-right:6px'>" + makePvSel(
                "tblopt-" + _sanitizeIdPart(wid) + "-" + _sanitizeIdPart(evName) + "-" + _sanitizeIdPart(t.name),
                ["ON", "OFF"],
                enabledSet.has(t.name) ? "ON" : "OFF",
                "yamlSetTableOpt('" + wid + "','" + evName + "','" + t.name + "',{value})"
            ) + "</div>"
            : "";
        return "<div class='rp-tbl-row'>"
            + "<div class='rp-tbl-header' style='display:flex;align-items:center'>"
            + toggleHtml
            + "<span class='rp-tbl-name rp-insert' data-insert='" + tn + "'>" + tn + "</span>"
            + (cols ? "<button class='rp-tbl-expand' " + evtAttr("onmousedown", "event.stopPropagation();yamlToggleTblCols(this)") + ">▶</button>" : "")
            + "</div>"
            + (cols ? "<div class='rp-tbl-cols'><table>" + cols + "</table></div>" : "")
            + "</div>";
    }).join("") + "</div>";
}

// ── 右パネル: 検証（バリデーション定義）一覧セクション ──
// 単一選択（プルダウン）方式。選択内容はYAML本文には書かず、
// getProjectData().validationOverrides["wid_evName"]に保存する。
// 各定義名の下に、参考情報としてルール詳細を展開表示できる。
function _rpBuildValidationSection(wid, evName) {
    const curForm = getProjectData().forms[getProjectData().curFormIdx];
    const validations = curForm?.validations || [];
    if (validations.length === 0) {
        return "<div style='padding:8px 10px;font-size:11px;color:var(--text3)'>検証定義なし</div>";
    }
    const hasCtx = !!(wid && evName);
    const current = hasCtx ? (_getValidationOverride(wid, evName) || "（なし）") : "（なし）";
    const selectorHtml = hasCtx
        ? "<div style='padding:6px 10px'>" + makePvSel(
            "validsel-" + _sanitizeIdPart(wid) + "-" + _sanitizeIdPart(evName),
            ["（なし）", ...validations.map((v) => v.name)],
            current,
            "yamlSetValidationOpt('" + wid + "','" + evName + "',{value})"
        ) + "</div>"
        : "";
    const listHtml = "<div>" + validations.map(v => {
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
            + "<span class='rp-tbl-name'>" + vn + "</span>"
            + (ruleRows ? "<button class='rp-tbl-expand' " + evtAttr("onmousedown", "event.stopPropagation();yamlToggleTblCols(this)") + ">▶</button>" : "")
            + "</div>"
            + (ruleRows ? "<div class='rp-tbl-cols'><table>" + ruleRows + "</table></div>" : "")
            + "</div>";
    }).join("") + "</div>";
    return selectorHtml + listHtml;
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

// ── 任意API有効化: データ管理 ──
// getProjectData().apiOptOverrides["wid_evName"] = ["form","const",...]
// （有効化された任意カテゴリのキー配列。未初期化＝undefined）
function _apiOptStorageKey(wid, evName) { return wid + "_" + evName; }
function _getApiOptState(wid, evName) {
    const store = getProjectData().apiOptOverrides || (getProjectData().apiOptOverrides = {});
    return store[_apiOptStorageKey(wid, evName)];
}
function _setApiOptState(wid, evName, enabledArr) {
    const store = getProjectData().apiOptOverrides || (getProjectData().apiOptOverrides = {});
    store[_apiOptStorageKey(wid, evName)] = enabledArr;
}

// 任意APIカテゴリの検出パターン（コード内で実際に使われているカテゴリを判定）
const _API_OPT_DETECT_PATTERNS = {
    event: /\bvja\.event\./,
    form: /\bvja\.form\./,
    session: /\bvja\.session\./,
    const: /\bvja\.const\./,
    util: /\bvja\.util\./,
    file: /\bvja\.file\./,
    io: /\bvja\.io\./,
    dir: /\bvja\.dir\./,
    http: /\bvja\.http\.|\bvja\.fetch\s*\(/,
};
// 「event」カテゴリを常時有効（OFFにできない）扱いにするイベント名。
// これらのイベントはvja.event.*（ev.type/getKey()等）を使わないと
// イベントの中身自体を判別できないため、実質「必須」として扱う。
const _EVENT_LOCKED_ON_EVENTS = new Set(["KeyDown", "KeyUp", "RowClick", "HeaderClick"]);
function _isEventCategoryLocked(evName) {
    return _EVENT_LOCKED_ON_EVENTS.has(evName);
}
function _detectApiOptCategoriesFromCode(code) {
    const found = new Set();
    if (!code) return found;
    Object.entries(_API_OPT_DETECT_PATTERNS).forEach(([key, re]) => {
        if (re.test(code)) found.add(key);
    });
    return found;
}

// 未初期化（このイベントを一度も開いていない）の場合、既存の生成済みコードを
// 解析して実際に使われているカテゴリを自動でON状態にする。
// 新規イベント（コードが空）の場合は全OFFになる。
// ただし「event」カテゴリがロック対象のイベント（_EVENT_LOCKED_ON_EVENTS）の
// 場合は、検出結果に関わらず常にONを含める。
function _ensureApiOptInitialized(wid, evName, code) {
    let state = _getApiOptState(wid, evName);
    if (state === undefined) {
        const detected = _detectApiOptCategoriesFromCode(code);
        if (_isEventCategoryLocked(evName)) detected.add("event");
        state = Array.from(detected);
        _setApiOptState(wid, evName, state);
    }
    return state;
}

// カテゴリのON/OFF切り替え（pv-selのonPickCodeから呼ばれる）。
// 「event」カテゴリがロック対象のイベントの場合は、OFFへの変更を無視する
// （UI側でもプルダウン自体を出さないが、念のため二重に防御する）。
function yamlSetApiOpt(wid, evName, key, value) {
    if (key === "event" && value === "OFF" && _isEventCategoryLocked(evName)) {
        window.vja?.log?.debug?.("[利用API] event はこのイベント(" + evName + ")では常時有効のためOFFにできません");
        return;
    }
    const state = _getApiOptState(wid, evName) || [];
    const set = new Set(state);
    if (value === "ON") set.add(key); else set.delete(key);
    const newState = Array.from(set);
    _setApiOptState(wid, evName, newState);
    window.vja?.log?.debug?.(
        "[利用API] 切替: wid=" + wid + " evName=" + evName + " key=" + key
        + " value=" + value + " → 保存後の状態=" + JSON.stringify(newState)
    );
}

// vja.xxx.yyy 形式のAPI名から、任意カテゴリのキーを判定する。
// 該当しない（必須カテゴリ・console等）場合はnullを返す。
function _apiOptCategoryOfApiName(api) {
    for (const [key, re] of Object.entries(_API_OPT_DETECT_PATTERNS)) {
        if (re.test(api + "(")) return key; // api文字列に"("を補って既存パターンと一致させる
    }
    return null;
}

// wid（通常ウィジェットID、または擬似ID"form"）とevNameから、
// 既存の生成済みJSコードを取得する（保存済みデータの格納先が異なるため共通化）。
function _getExistingJsCodeFor(wid, evName) {
    if (wid === "form") {
        const f = getProjectData().forms[getProjectData().curFormIdx];
        return f?.events?.["_js_" + evName] || "";
    }
    const w = getWidget(wid);
    return (w?.jsCode && w.jsCode[evName]) || "";
}

// 「利用API」セクションを初期状態でオープン表示すべきか判定する。
// 既に何らかの任意カテゴリが有効化されている（≒既存コードで使用中）場合はtrue。
// ただし「event」がロック対象イベント（KeyDown/KeyUp/RowClick/HeaderClick）で
// 常時有効固定されているだけの状態（ユーザーが操作できるカテゴリは0件）は、
// オープンにする理由にはならないため除外する。
function _hasEnabledApiOpts(wid, evName) {
    const code = _getExistingJsCodeFor(wid, evName);
    const enabled = _ensureApiOptInitialized(wid, evName, code);
    const locked = _isEventCategoryLocked(evName);
    const meaningful = (enabled || []).filter(key => !(key === "event" && locked));
    return meaningful.length > 0;
}

// DOM要素ID等に使うため、wid/evNameを安全な文字列に変換する共通ヘルパー
function _sanitizeIdPart(s) {
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
}

/* ── 利用テーブル（ON/OFF、YAML本文と自動連動） ──
   保存先: getProjectData().tableOptOverrides["wid_evName"] = ["horse_info", ...]
   トグル操作の度に、YAMLエディタ本文の「利用テーブル:」ブロックを自動的に
   追記・更新・削除する（YAML自体を唯一の情報源として保ちつつ、タイポを防ぐ）。 */
function _getTableOptState(wid, evName) {
    return (getProjectData().tableOptOverrides || {})[wid + "_" + evName];
}
function _setTableOptState(wid, evName, arr) {
    if (!getProjectData().tableOptOverrides) getProjectData().tableOptOverrides = {};
    getProjectData().tableOptOverrides[wid + "_" + evName] = arr;
}
// 未初期化の場合、既存のYAML本文の「利用テーブル:」ブロックを解析して初期状態とする。
function _ensureTableOptInitialized(wid, evName, yamlText) {
    let state = _getTableOptState(wid, evName);
    if (state === undefined) {
        const detected = [];
        const m = (yamlText || "").match(/^[ \t]*利用テーブル[ \t]*:[ \t]*\r?\n((?:[ \t]*-[^\n]*\r?\n?)*)/m);
        if (m) {
            m[1].split("\n").forEach((l) => {
                const name = l.replace(/^\s*-\s*/, "").replace(/#.*$/, "").trim();
                if (name) detected.push(name);
            });
        }
        state = detected;
        _setTableOptState(wid, evName, state);
    }
    return state;
}
// 有効化されたテーブル名配列から「利用テーブル:」ブロックのテキストを生成する。
// 0件の場合は空文字（＝ブロック無し）。
function _buildTableYamlBlock(enabledTableNames) {
    if (!enabledTableNames || enabledTableNames.length === 0) return "";
    return "利用テーブル:\n" + enabledTableNames.map((n) => "  - " + n).join("\n");
}
// YAML本文中の既存「利用テーブル:」ブロック（#付きコメントアウトも含む）を
// 検出して置き換える。ブロックが存在しない場合は新規挿入する。
// 挿入位置: 1行目がコメント行なら2行目、空行なら1行目。
function _syncTableYamlBlock(yamlText, enabledTableNames) {
    const lines = yamlText.split("\n");
    const headerRe = /^\s*#?\s*利用テーブル\s*:/;
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (headerRe.test(lines[i])) { headerIdx = i; break; }
    }
    const originalFirstLine = lines[0] || "";
    if (headerIdx !== -1) {
        let endIdx = headerIdx + 1;
        while (endIdx < lines.length && /^\s+-\s/.test(lines[endIdx])) endIdx++;
        lines.splice(headerIdx, endIdx - headerIdx);
    }
    const newBlock = _buildTableYamlBlock(enabledTableNames);
    if (!newBlock) return lines.join("\n");
    let insertAt;
    if (headerIdx === 0) {
        insertAt = 0; // 元々1行目が「利用テーブル:」ブロックだった
    } else {
        insertAt = originalFirstLine.trim().startsWith("#") ? 1 : 0;
    }
    lines.splice(insertAt, 0, newBlock);
    return lines.join("\n");
}
// トグル操作（onPickCodeから呼ばれる）。状態更新＋YAMLエディタへの即時反映を行う。
function yamlSetTableOpt(wid, evName, tableName, value) {
    const state = new Set(_getTableOptState(wid, evName) || []);
    if (value === "ON") state.add(tableName); else state.delete(tableName);
    // プロジェクト内のテーブル定義順に整列して保存（表示・出力の安定化のため）
    const ordered = getProjectData().tables.map((t) => t.name).filter((n) => state.has(n));
    _setTableOptState(wid, evName, ordered);
    _applyTableYamlSync(wid, evName);
}
// 現在の有効化状態を、YAMLエディタ本文（yaml-ta）に即時反映する。
function _applyTableYamlSync(wid, evName) {
    const ta = $("yaml-ta");
    if (!ta) return;
    const enabled = _getTableOptState(wid, evName) || [];
    const updated = _syncTableYamlBlock(ta.value, enabled);
    if (updated !== ta.value) {
        ta.value = updated;
        yamlHlUpdate();
        editorUpdateGutter("yaml-ta", "yaml-gutter");
    }
}

/* ── 検証（バリデーション定義、単一選択・YAMLには書かない） ──
   保存先: getProjectData().validationOverrides["wid_evName"] = "定義名"（未選択は""） */
function _getValidationOverride(wid, evName) {
    return (getProjectData().validationOverrides || {})[wid + "_" + evName] || "";
}
function _setValidationOverride(wid, evName, name) {
    if (!getProjectData().validationOverrides) getProjectData().validationOverrides = {};
    getProjectData().validationOverrides[wid + "_" + evName] = name || "";
}
function yamlSetValidationOpt(wid, evName, value) {
    _setValidationOverride(wid, evName, value === "（なし）" ? "" : value);
}

/* ── 自動モック検証（AI生成直後の自動検証）のイベント単位ON/OFF ──
   保存先: getProjectData().mockCheckOverrides["wid_evName"] = "on"|"off"
   （未設定はグローバル設定＝aiConfig.mockCheckEnabled に従う）。
   「🧪 モック実行」ボタンによる手動実行には適用しない（常に実行可能）。 */
function _getMockCheckOverride(wid, evName) {
    return (getProjectData().mockCheckOverrides || {})[wid + "_" + evName] || "既定";
}
function _setMockCheckOverride(wid, evName, value) {
    if (!getProjectData().mockCheckOverrides) getProjectData().mockCheckOverrides = {};
    const key = wid + "_" + evName;
    if (value === "既定") {
        delete getProjectData().mockCheckOverrides[key];
    } else {
        getProjectData().mockCheckOverrides[key] = value === "ON" ? "on" : "off";
    }
}
function yamlSetMockCheckOpt(wid, evName, value) {
    _setMockCheckOverride(wid, evName, value);
    window.vja?.log?.debug?.("[自動モック検証] wid=" + wid + " evName=" + evName + " → " + value);
}
// AI生成直後の自動検証で、モック実行を行うべきか判定する。
// イベント単位の設定があればそれを優先し、無ければグローバル設定に従う。
function _isAutoMockCheckEnabled(wid, evName) {
    const ov = (getProjectData().mockCheckOverrides || {})[wid + "_" + evName];
    if (ov === "on") return true;
    if (ov === "off") return false;
    return getProjectData().aiConfig.mockCheckEnabled !== false;
}
// ── 右パネル: 自動モック検証セクション ──
function _rpBuildMockCheckSection(wid, evName) {
    if (!wid || !evName) return "<div style='padding:8px 10px;font-size:11px;color:var(--text3)'>-</div>";
    const cur = _getMockCheckOverride(wid, evName);
    const selId = "mockchk-" + _sanitizeIdPart(wid) + "-" + _sanitizeIdPart(evName);
    const onPickCode = "yamlSetMockCheckOpt('" + wid + "','" + evName + "',{value})";
    return "<div style='padding:6px 10px;display:flex;flex-direction:column;gap:6px'>"
        + "<div style='font-size:11px;color:var(--text2)'>AI生成直後の自動モック実行検証（「🧪 モック実行」の手動実行には影響しません）</div>"
        + makePvSel(selId, ["既定", "ON", "OFF"], cur, onPickCode)
        + "</div>";
}


// ── 右パネル: 学習履歴（プロジェクト単位、たたき台版） ──
function _rpBuildLearnedFixesSection(wid, evName) {
    if (!wid || !evName) return "<div style='padding:8px 10px;font-size:11px;color:var(--text3)'>-</div>";
    const list = _getLearnedFixes(wid, evName);
    if (list.length === 0) {
        return "<div style='padding:8px 10px;font-size:11px;color:var(--text3)'>学習履歴なし（「もう一度AIに修正を依頼」が成功すると自動的に記録されます）</div>";
    }
    return "<div>" + list.map(e => {
        const pinLabel = e.pinned ? "👍 固定済み" : "👍 役に立った";
        return "<div class='rp-learned-row' style='padding:6px 10px;border-bottom:1px solid var(--border);font-size:11px'>"
            + "<div style='margin-bottom:4px;color:var(--text2)'>" + esc(e.mistakeSummary) + "</div>"
            + "<div style='display:flex;gap:6px'>"
            + "<button class='yaml-ai-btn' style='font-size:11px;padding:2px 6px'" + (e.pinned ? " disabled" : "")
            + evtAttr("onmousedown", "yamlPinLearnedFix('" + wid + "','" + evName + "','" + e.id + "');this.textContent='👍 固定済み';this.disabled=true;")
            + ">" + pinLabel + "</button>"
            + "<button class='yaml-ai-btn' style='font-size:11px;padding:2px 6px'"
            + evtAttr("onmousedown", "yamlDeleteLearnedFix('" + wid + "','" + evName + "','" + e.id + "');this.closest('.rp-learned-row').remove();")
            + ">🗑 削除</button>"
            + "</div>"
            + "</div>";
    }).join("") + "</div>";
}

// ── 右パネル: 利用API（任意カテゴリ）セクション ──
// フロントエンドイベントのみ表示。バックエンド（isAppEvent）では表示しない。
function _rpBuildApiOptSection(wid, evName) {
    const code = _getExistingJsCodeFor(wid, evName);
    const enabledArr = _ensureApiOptInitialized(wid, evName, code);
    const enabled = new Set(enabledArr);
    const locked = _isEventCategoryLocked(evName);
    const labels = _PROMPT_DEF.VJA_FRONT_API_OPTIONAL_LABELS || {};
    const rows = Object.keys(labels).map(key => {
        // 「event」カテゴリは、ロック対象イベント（KeyDown/KeyUp/RowClick/HeaderClick）
        // では常時有効固定とし、ON/OFF切り替え自体を出さない（vja.dbの注記と同じ扱い）。
        if (key === "event" && locked) {
            return "<div style='padding:4px 10px;font-size:12px;color:var(--text3)'>"
                + "🔒 " + esc(labels[key]) + "：このイベントでは常時有効です（OFF不可）"
                + "</div>";
        }
        const selId = "apiopt-" + String(wid).replace(/[^a-zA-Z0-9_-]/g, "_") + "-" + String(evName).replace(/[^a-zA-Z0-9_-]/g, "_") + "-" + key;
        const curVal = enabled.has(key) ? "ON" : "OFF";
        const onPickCode = "yamlSetApiOpt('" + wid + "','" + evName + "','" + key + "',{value})";
        return "<div style='display:flex;align-items:center;gap:8px;padding:4px 10px;font-size:12px'>"
            + "<div style='width:64px;flex-shrink:0'>" + makePvSel(selId, ["ON", "OFF"], curVal, onPickCode) + "</div>"
            + "<span>" + esc(labels[key]) + "</span>"
            + "</div>";
    }).join("");
    const dbNote = "<div style='padding:6px 10px;font-size:11px;color:var(--text3)'>"
        + "🗄 vja.db.*: YAMLの「利用テーブル:」に記載があれば自動的に利用可能になります（チェック不要）"
        + "</div>";
    return "<div>" + rows + dbNote + "</div>";
}

function yamlBuildRightPanel(showWidgets = true, wid = null, evName = null, isAppEvent = false, curYaml = "") {
    return [
        (!isAppEvent && wid && evName) ? yamlRpSection("🔌 利用API（任意）", _rpBuildApiOptSection(wid, evName), _hasEnabledApiOpts(wid, evName)) : "",
        (!isAppEvent && wid && evName) ? yamlRpSection("🧪 自動モック検証", _rpBuildMockCheckSection(wid, evName), false) : "",
        (wid && evName) ? yamlRpSection("🧠 学習履歴", _rpBuildLearnedFixesSection(wid, evName), false) : "",
        yamlRpSection("📌 定数", _rpBuildConstSection(), false),
        yamlRpSection("📋 画面一覧", _rpBuildFormSection(), false),
        showWidgets ? yamlRpSection("🔲 現在フォームのウィジェット", _rpBuildWidgetSection(), true) : "",
        yamlRpSection("✅ 検証", _rpBuildValidationSection(wid, evName), true),
        yamlRpSection("🗄 テーブル一覧", _rpBuildTableSection(wid, evName, curYaml), true),
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

        // ② 挿入系（最後に判定）
        // 【注記】テーブルカラム展開ボタン（.rp-tbl-expand）は、以前ここでも
        // 判定していたが、ボタン自身がonmousedownで直接yamlToggleTblCols()を
        // 呼んでいるため二重発火（開いた直後に閉じてしまう不具合）していた。
        // ボタン自身のonmousedownハンドラのみに一本化し、ここでの判定は削除済み。
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

/* ── モック上書き値（⚙ モック値を編集） ──
   分岐カバレッジの限界を補うため、ユーザーが明示的に「このウィジェットは
   この値」「このイベントはこの形」等を指定できるようにする。
   保存先: getProjectData().mockOverrides[ "wid_evName" ] = [行の配列]
   1行 = { type: "widget"|"event"|"const"|"session"|"util", target: string, json: string }
   - widget/const: targetはウィジェット名/定数名（select）。重複時は最後を採用。
   - event        : target="*"固定。複数行あれば最後を採用（マージしない）。
   - session/util : target="*"固定。複数行あれば浅くマージ（後勝ち）。
   - db操作は対象外（今回は非対応。プロンプト依存のSQL単位の複雑さを避けるため）。
   - 「その他」枠は設けない（制御が難しいため5種類のみに限定）。 */
function _getMockOverrideKey(wid, evName) {
    return wid + "_" + evName;
}
function _getMockOverrideRows(wid, evName) {
    const all = getProjectData().mockOverrides || {};
    return all[_getMockOverrideKey(wid, evName)] || [];
}
function _saveMockOverrideRows(wid, evName, rows) {
    if (!getProjectData().mockOverrides) getProjectData().mockOverrides = {};
    getProjectData().mockOverrides[_getMockOverrideKey(wid, evName)] = rows;
}
// モック値編集の「JSON」欄をできるだけ寛容に解釈する。
// 1. まず厳密なJSONとして解釈を試みる（"文字列"/123/{"a":1}/true 等はこれで通る）
// 2. 失敗した場合、数値として解釈できれば数値として扱う（保険的なケース）
// 3. それでも失敗した場合は、入力された文字列をそのまま値として扱う
//    （クォート無しでの素朴な文字列入力に対応するため）
// 4. 空文字の場合のみ、未入力行として無視する（{ ok: false }）
function _parseMockJsonLenient(str) {
    const trimmed = String(str ?? "").trim();
    if (trimmed === "") return { ok: false };
    try {
        return { ok: true, value: JSON.parse(trimmed) };
    } catch (e) {
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) return { ok: true, value: Number(trimmed) };
        return { ok: true, value: trimmed };
    }
}
// 保存済みの行から、VJA_MOCK_RUNTIME.build()に渡す overrides オブジェクトを
// 組み立てる。不正なJSONの行は無視する（エラーには倒さない＝安全側）。
function _computeMockOverrides(wid, evName) {
    const rows = _getMockOverrideRows(wid, evName);
    const overrides = { widgets: {}, event: undefined, consts: {}, session: {}, util: {} };
    rows.forEach((row) => {
        const result = _parseMockJsonLenient(row.json);
        if (!result.ok) return; // 未入力行はスキップ
        const parsed = result.value;
        if (row.type === "widget" && row.target) {
            overrides.widgets[row.target] = parsed;
        } else if (row.type === "const" && row.target) {
            overrides.consts[row.target] = parsed;
        } else if (row.type === "event") {
            overrides.event = parsed; // 複数あれば最後の行が上書きするのでこれでよい
        } else if (row.type === "session") {
            Object.assign(overrides.session, parsed); // 浅いマージ（後勝ち）
        } else if (row.type === "util") {
            Object.assign(overrides.util, parsed); // 浅いマージ（後勝ち）
        }
    });
    return overrides;
}

// ── 「⚙ モック値を編集」UI ──
// 【重要・再発防止メモ】VJAのモーダル内ドロップダウンは、素の<select>タグでは
// なく makePvSel()/pvSelOpen()（vja-table-validation.js定義）という専用部品で
// 統一されている（AI接続設定の推論モードON/OFF等で使用実績あり）。
// 新しいプルダウンUIを追加する際は、必ずこれを使うこと。<select>を使うと
// 見た目が浮いてしまう不具合を過去に繰り返しているため、次にモーダル内へ
// ドロップダウンを追加する時はまずこのメモと既存のmakePvSel使用例
// （vja-yaml-editor.jsのAI接続設定、vja-app-config.jsのフォント選択等）を
// 確認すること。
// 【makePvSelの制約】表示ラベルと内部値が異なる場合（例: 表示"ウィジェット"/
// 値"widget"）、選択中の値はボタンの表示テキストからは復元できない
// （pvSelPickは表示ラベルしかDOMに残さないため）。そのため、値が必要な
// 箇所ではonPickCode経由のコールバックで data-* 属性に値を保存しておき、
// 保存時はDOMのテキストではなくdata-*属性から読み取ること
// （下記_mockEditorOnTypeChange()のdata-type属性がその実装例）。
const _MOCK_TYPE_LABELS = {
    widget: "ウィジェット", event: "イベント", const: "定数",
    session: "セッション", util: "ユーティリティ",
};
// type（モックタイプ）に応じた「対象名」欄のHTMLを生成する。
// widget/const: 実在する名前をmakePvSelで選ばせる（表示ラベル＝値なので
// 保存時もDOM表示テキストをそのまま使ってよい）。
// event/session/util: 対象名の概念を持たないため "*" 固定（非活性表示）。
function _mockEditorTargetCellHtml(type, selectedTarget, idx) {
    const targetSelId = "mock-target-" + idx;
    if (type === "widget") {
        const names = (getProjectData().widgets || []).map((w) => w.name);
        return makePvSel(targetSelId, names, selectedTarget || (names[0] || ""), "");
    }
    if (type === "const") {
        const curForm = getProjectData().forms[getProjectData().curFormIdx];
        const names = [...getProjectData().constants, ...(curForm?.constants || [])].map((c) => c.name);
        return makePvSel(targetSelId, names, selectedTarget || (names[0] || ""), "");
    }
    // event/session/util: 対象名という概念を持たないため "*" 固定（非活性表示）
    return "<div class='pv-sel-btn' id='" + targetSelId + "' style='opacity:0.5;cursor:default' onmousedown='event.stopPropagation()'><span>*</span></div>";
}
// 1行分の編集行HTMLを生成する。idxは行を一意に識別するための連番
// （makePvSel等のDOM要素IDの衝突を避けるため、追加・削除しても使い回さない）。
function _mockEditorRowHtml(row, idx) {
    const type = (row && row.type) || "widget";
    const target = (row && row.target) || "";
    const json = (row && row.json) || "";
    const typeOpts = Object.keys(_MOCK_TYPE_LABELS).map((t) => ({ value: t, label: _MOCK_TYPE_LABELS[t] }));
    return "<div class='mock-editor-row' data-idx='" + idx + "' data-type='" + type + "' style='display:flex;gap:6px;margin-bottom:6px;align-items:flex-start'>" +
        "<div style='width:120px;flex-shrink:0'>" +
        makePvSel("mock-type-" + idx, typeOpts, type, "_mockEditorOnTypeChange(" + idx + ",{value})") +
        "</div>" +
        "<div class='mock-target-wrap' id='mock-target-wrap-" + idx + "' style='width:140px;flex-shrink:0'>" +
        _mockEditorTargetCellHtml(type, target, idx) +
        "</div>" +
        "<textarea class='mock-json-ta pv-input' style='flex:1;height:50px;font-family:monospace;font-size:12px;resize:vertical' placeholder='JSON（例: \"検索したい文字\" / {\"type\":\"rowClick\",\"row\":2}）'>" + esc(json) + "</textarea>" +
        "<button class='yaml-ai-btn' style='padding:4px 8px;flex-shrink:0'" + evtAttr("onmousedown", "this.closest('.mock-editor-row').remove()") + ">🗑</button>" +
        "</div>";
}
// モックタイプが変更された時、対象名欄をそのタイプに応じたものに差し替え、
// 選択中の値（英語キー）をdata-type属性に保存する（makePvSelの制約への対応）。
function _mockEditorOnTypeChange(idx, newType) {
    const row = document.querySelector(".mock-editor-row[data-idx='" + idx + "']");
    if (!row) return;
    row.dataset.type = newType;
    const wrap = document.getElementById("mock-target-wrap-" + idx);
    if (wrap) wrap.innerHTML = _mockEditorTargetCellHtml(newType, null, idx);
}
// 行を一意に識別するための連番。openMockOverrideEditor()を開く度にリセットする。
let _mockEditorRowSeq = 0;
// 「＋ 行を追加」ボタン用。既存行はそのまま保持し、末尾に空行を1つ追加する。
function _mockEditorAddRow() {
    const container = $("mock-editor-rows");
    if (!container) return;
    const idx = _mockEditorRowSeq++;
    container.insertAdjacentHTML("beforeend", _mockEditorRowHtml({ type: "widget", target: "", json: "" }, idx));
}
// 「⚙ モック値を編集」ボタン用。現在保存されている上書き行を一覧表示する
// モーダルを開く。
function openMockOverrideEditor(wid, evName) {
    const rows = _getMockOverrideRows(wid, evName);
    _mockEditorRowSeq = 0;
    const rowsHtml = rows.map((row) => _mockEditorRowHtml(row, _mockEditorRowSeq++)).join("");
    showModal(
        mhdrHTML("⚙ モック値を編集（" + esc(String(evName)) + "）", "modal-layer-1") +
        "<div class='mbody' style='display:flex;flex-direction:column;gap:8px'>" +
        "<div style='font-size:12px;color:var(--text2)'>" +
        "「🧪 モック実行」やAI生成後の自動検証で使うダミー値を、明示的に指定できます。" +
        "対応するのはウィジェット・イベント・定数・セッション・ユーティリティの5種類のみです（DB操作は対象外）。" +
        "</div>" +
        "<div id='mock-editor-rows' style='max-height:min(50vh,420px);overflow-y:auto;padding-right:4px'>" + rowsHtml + "</div>" +
        "<button class='yaml-ai-btn'" + evtAttr("onmousedown", "_mockEditorAddRow()") + ">＋ 行を追加</button>" +
        "</div>" +
        "<div class='mfoot'>" +
        mfootHTML([{ label: "キャンセル", action: 'closeModal("modal-layer-1")' }]) +
        "<button class='pri'" + evtAttr("onmousedown", "saveMockOverrides(" + JSON.stringify(wid) + "," + JSON.stringify(evName) + ")") + ">保存</button>" +
        "</div>",
        "modal-mock-editor", "modal-layer-1"
    );
}
// モーダル内の全行を読み取り、プロジェクトデータに保存する。
// type: 行のdata-type属性から取得（makePvSelは表示ラベルしか残さないため）。
// target: widget/constの場合はmakePvSelのボタン表示テキスト（＝値そのもの）、
// それ以外は"*"固定。
// JSONが空の行はスキップする（不正なJSONはそのまま保存し、実行時に無視される）。
function saveMockOverrides(wid, evName) {
    const container = $("mock-editor-rows");
    const rows = [];
    container?.querySelectorAll(".mock-editor-row").forEach((rowEl) => {
        const type = rowEl.dataset.type || "widget";
        const target = (type === "widget" || type === "const")
            ? (rowEl.querySelector(".mock-target-wrap .pv-sel-btn span:first-child")?.textContent || "")
            : "*";
        const json = rowEl.querySelector(".mock-json-ta")?.value.trim() || "";
        if (!json) return;
        rows.push({ type, target, json });
    });
    _saveMockOverrideRows(wid, evName, rows);
    closeModal("modal-layer-1");
    showToast("✅ モック値を保存しました");
}

/* ── モック実行スモークテスト ──
   構文チェック・APIホワイトリスト検証では拾えない「明らかな実行時例外
   （TypeError等）」を検出するため、生成コードをモックランタイム
   （vja-mock-runtime.js）と一緒に実際に1回実行してみる。
   AI接続設定の「モック実行検証」がOFFの場合は実施しない。
   【スコープ】分岐(if/else)の全パターンは検証できない（モックは1パターンの
   値しか返さないため）。あくまで「即座に落ちないか」の浅い確認。
   ユーザーが「⚙ モック値を編集」で上書き値を指定していれば、その値が
   優先して使われるため、意図した分岐を通した確認もある程度可能。 */

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

// new Functionでのラップにより追加される行数のオフセット。
// new Function(...)で生成した関数は、V8/JSC共通の既知の仕様により
// 「引数リストと開き波括弧の間に改行が入る」形でソースが合成される。
// 実際には以下の3行がcode本体の前に挿入される：
//   1行目: function anonymous(vja
//   2行目: ) {
//   3行目: return (async()=>{   ← 自前で追加しているラップ行
// そのため、e.line/e.stackから取れる行番号からはこの3行分を
// 差し引く必要がある。
const _MOCK_WRAP_LINE_OFFSET = 3;

// 実行時例外オブジェクトから、可能な限り「発生行（コード上の1-indexed行番号）」
// を推定する。取得できなければnullを返す（呼び出し側は行番号なしで表示する）。
// - JavaScriptCore系（Electrobun/WKWebViewが使用）は非標準の e.line / e.column
//   プロパティを直接持つことがあるため、まずこちらを優先する。
// - 無ければ e.stack から "<anonymous>:LINE:COL" 等のパターンを正規表現で
//   抽出するフォールバックを試みる（V8系のnew Function実行時のスタック表記）。
// どちらも失敗した場合はnull（＝行番号は表示しない。誤った行番号を出す方が
// 有害なので、確信が持てない場合は出さない方針とする）。
function _extractMockErrorLine(e) {
    if (e && typeof e.line === "number" && Number.isFinite(e.line)) {
        const line = e.line - _MOCK_WRAP_LINE_OFFSET;
        return line >= 1 ? line : null;
    }
    if (e && typeof e.stack === "string") {
        const m = e.stack.match(/<anonymous>:(\d+):(\d+)/) || e.stack.match(/:(\d+):(\d+)\)?$/m);
        if (m) {
            const line = Number(m[1]) - _MOCK_WRAP_LINE_OFFSET;
            if (Number.isFinite(line) && line >= 1) return line;
        }
    }
    return null;
}

// モック実行スモークテストの最大実行時間（ミリ秒）。
// 単純なsetTimeout+Promise.raceによるタイムアウトでは、生成コードが
// while(true){}のような同期的な無限ループを含んでいた場合、UIスレッド
// （メインスレッド）自体がブロックされてタイマーコールバックすら発火せず
// 止められない。そのため実行そのものを別スレッド（Web Worker）に切り出し、
// タイムアウト時はworker.terminate()で強制終了することで確実に止める。
const _MOCK_SMOKE_TIMEOUT_MS = 3000;

// モック実行用Workerに埋め込む、vja-mock-runtime.jsの実行ロジックの複製。
// 【重要・要同期】electrobunのWebViewが使うカスタムスキームは、Worker内からの
// importScripts()によるネットワーク読み込みに対応しておらず「NetworkError: Load
// failed」で失敗するため、外部ファイル読み込みに頼らずWorkerソース文字列に
// ロジックそのものを埋め込んでいる。vja-mock-runtime.jsの_buildFrontMock() /
// _buildBackMock()を変更した場合は、必ずこちらも同じ内容に追従させること。
const _MOCK_WORKER_RUNTIME_SRC = `
function _buildFrontMock(evName, wtag, overrides, widgets) {
    const ov = overrides || {};
    const isRowClickCtx = evName === "RowClick" || (evName === "Click" && wtag === "datagrid");
    const isHeaderClickCtx = evName === "HeaderClick";
    const isKeyCtx = evName === "KeyDown" || evName === "KeyUp";
    function _widgetGetValue(name) {
        if (ov.widgets && Object.prototype.hasOwnProperty.call(ov.widgets, name)) {
            return ov.widgets[name];
        }
        const w = (widgets || []).find((ww) => ww.name === name) || null;
        const tag = w ? w.tag : null;
        if (tag === "datagrid") return [{}];
        if (tag === "checkbox" || tag === "radio") return false;
        if (tag === "progressbar" || tag === "slider" || tag === "hscroll" || tag === "vscroll") return 0;
        if (tag === "inputtype" && w?.props?.inputType === "number") return 0;
        return "";
    }
    function _constGetValue(name) {
        if (ov.consts && Object.prototype.hasOwnProperty.call(ov.consts, name)) {
            return ov.consts[name];
        }
        return "";
    }
    function _sessionGetValue(key) {
        if (ov.session && Object.prototype.hasOwnProperty.call(ov.session, key)) {
            return ov.session[key];
        }
        return "";
    }
    function _utilValue(fnName, fallback) {
        if (ov.util && Object.prototype.hasOwnProperty.call(ov.util, fnName)) {
            return ov.util[fnName];
        }
        return fallback;
    }
    return {
        widget: {
            get: (name) => _widgetGetValue(name),
            set: () => {},
            getValue: (name) => _widgetGetValue(name),
            setValue: () => {},
            setItems: () => {},
            setTableData: () => {},
            getAllInputs: () => ({}),
            setVisible: () => {},
            show: () => {},
            hide: () => {},
            enable: () => {},
            disable: () => {},
        },
        const: {
            get: (name) => _constGetValue(name),
            getAll: () => ({}),
        },
        form: {
            navigate: async () => {},
            back: () => {},
            setParam: () => {},
            getParam: () => "",
        },
        session: {
            get: async (key) => _sessionGetValue(key),
            set: async () => true,
            delete: async () => true,
            clear: async () => true,
        },
        util: {
            today: () => _utilValue("today", "2000-01-01"),
            formatDate: () => _utilValue("formatDate", "2000-01-01"),
            formatNumber: () => _utilValue("formatNumber", "0"),
            uuid: () => _utilValue("uuid", "00000000-0000-0000-0000-000000000000"),
            copyToClipboard: async () => {},
        },
        io: {
            openCsv: async () => [{}],
            openJson: async () => ({}),
            saveCsv: async () => {},
            saveJson: async () => {},
        },
        file: {
            read: async () => "",
            write: async () => true,
            readBytes: async () => new Uint8Array(),
            writeBytes: async () => true,
            exists: async () => true,
            delete: async () => true,
            copy: async () => true,
        },
        dir: {
            create: async () => true,
            delete: async () => true,
            list: async () => [],
            exists: async () => true,
        },
        notify: {
            toast: () => {},
        },
        trigger: {
            click: () => {},
            focus: () => {},
            blur: () => {},
            change: () => {},
            mouseDown: () => {},
            mouseUp: () => {},
            mouseEnter: () => {},
            mouseLeave: () => {},
            scroll: () => {},
        },
        event: {
            get: () => {
                if (ov.event !== undefined) return ov.event;
                if (isRowClickCtx) return { type: "rowClick", row: 0, column: "" };
                if (isHeaderClickCtx) return { type: "headerClick", column: "" };
                const t = evName ? evName.charAt(0).toLowerCase() + evName.slice(1) : "";
                return { type: t };
            },
            getKey: () => (isKeyCtx ? "Enter" : null),
            getKeyCode: () => (isKeyCtx ? 13 : null),
            isEnter: () => isKeyCtx,
            isEscape: () => isKeyCtx,
            isShift: () => isKeyCtx,
            isCtrl: () => isKeyCtx,
        },
        http: {
            get: async () => ({}),
            post: async () => ({}),
            put: async () => ({}),
            delete: async () => ({}),
        },
        fetch: async () => ({}),
        ui: {
            loading: () => {},
        },
        app: {
            showDialog: async () => {},
            showConfirm: async () => true,
        },
        crypto: {
            encrypt: async () => "",
            decrypt: async () => "",
        },
        getCloudInfraCredential: async () => ({}),
        validate: {
            run: async () => true,
        },
        db: {
            query: async () => [{}],
            execute: async () => ({ changes: 0, lastInsertRowid: 0 }),
            transaction: async () => true,
        },
        log: {
            info: () => {},
            warn: () => {},
            error: () => {},
        },
    };
}
function _buildBackMock() {
    return {
        db: {
            query: () => [{}],
            execute: () => ({ changes: 0, lastInsertRowid: 0 }),
            clearTable: () => {},
            importCsv: async () => {},
            importJson: async () => {},
        },
        session: {
            get: () => "",
            set: () => true,
            delete: () => true,
            clear: () => true,
        },
        log: {
            info: () => {},
            warn: () => {},
            error: () => {},
        },
    };
}
self.VJA_MOCK_RUNTIME = {
    build(isAppEvent, evName, wtag, overrides, widgets) {
        return isAppEvent ? _buildBackMock() : _buildFrontMock(evName, wtag, overrides, widgets);
    },
};
`;

// モック実行用Workerのソースを1回だけ生成しBlob URL化してキャッシュする。
let _mockWorkerUrl = null;
function _getMockWorkerUrl() {
    if (_mockWorkerUrl) return _mockWorkerUrl;
    const src = [
        _MOCK_WORKER_RUNTIME_SRC,
        "self.onmessage = async (ev) => {",
        "  const { code, isAppEvent, evName, wtag, overrides, widgets, extNames } = ev.data;",
        "  let capturedError = null;",
        "  const mockConsole = {",
        "    log: () => {}, info: () => {}, warn: () => {},",
        "    error: (...a) => {",
        "      const errArg = a.find((x) => x instanceof Error);",
        "      if (errArg) capturedError = errArg;",
        "    },",
        "  };",
        "  try {",
        "    const vjaMock = self.VJA_MOCK_RUNTIME.build(isAppEvent, evName, wtag, overrides, widgets);",
        // extMockは「関数名だけの一覧から、常に{}を返す非同期関数を生成する」だけの
        // 単純なものなので、関数そのもの(構造化複製不可)ではなく名前のみ受け取り
        // Worker内で組み立て直す。
        "    const extValues = extNames.map(() => (async () => ({})));",
        "    const fn = new Function('vja', ...extNames, 'console', 'return (async()=>{\\n' + code + '\\n})()');",
        "    await fn(vjaMock, ...extValues, mockConsole);",
        "    if (capturedError) {",
        "      postMessage({ ok: false, caught: true, message: capturedError.message || String(capturedError), line: capturedError.line, stack: capturedError.stack });",
        "    } else {",
        "      postMessage({ ok: true });",
        "    }",
        "  } catch (e) {",
        "    postMessage({ ok: false, message: (e && e.message) ? e.message : String(e), line: e && e.line, stack: e && e.stack });",
        "  }",
        "};",
    ].join("\n");
    _mockWorkerUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    return _mockWorkerUrl;
}

// 生成コードをモックランタイムと共に実際に1回実行し、実行時例外が
// 発生しないかを確認する。例外が無ければnull、あれば
// { message: 例外メッセージ, line: 推定行番号（取れない場合はnull） } を返す。
//
// 【try/catchで握りつぶされたエラーの検出について】
// 実プロジェクト実行時（project-bridge.ts / src/bun/index.ts の
// window._vjaLastError 方式）と同じ考え方で、生成コード内で
// 「console.error(e)」のようにErrorオブジェクトがログ出力された場合、
// それを実行スコープ限定のモック用console経由で検知し、たとえ
// try/catchで握りつぶされて例外が外に投げられなくても、エラーとして扱う。
//
// 【実行をWeb Workerに分離している理由】
// 生成コードは実行前提が「未検証のAI生成コード」であり、意図しない無限ループ
// （while(true){}等）を含む可能性がある。メインスレッドで直接new Function()
// 実行すると、そのままUI全体がフリーズし復帰不能になる。Web Worker内で実行すれば、
// タイムアウト時にterminate()でスレッドごと強制終了できるため、無限ループでも
// UIは固まらず、エディタ側にタイムアウトエラーとして通知できる。
async function _runMockSmokeTest(code, isAppEvent, evName, wtag, wid) {
    if (getProjectData().aiConfig.mockCheckEnabled === false) return null;
    if (typeof Worker === "undefined") return null; // Worker非対応環境では検証をスキップ
    const overrides = wid !== undefined ? _computeMockOverrides(wid, evName) : undefined;
    const extMock = _buildExtRuntimeMock();
    const extNames = Object.keys(extMock);
    const widgets = getProjectData().widgets || [];

    let worker;
    try {
        worker = new Worker(_getMockWorkerUrl());
    } catch (e) {
        return null; // Worker生成に失敗した場合は検証をスキップ（既存の構文/API検証は別途行われる）
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            worker.terminate();
            resolve(result);
        };
        const timer = setTimeout(() => {
            finish({ message: "モック実行がタイムアウトしました（無限ループの可能性があります）", line: null, timeout: true });
        }, _MOCK_SMOKE_TIMEOUT_MS);
        worker.onmessage = (ev) => {
            const r = ev.data;
            if (!r || r.ok) {
                finish(null);
                return;
            }
            finish({
                message: r.message,
                line: _extractMockErrorLine({ line: r.line, stack: r.stack }),
                caught: r.caught === true,
            });
        };
        worker.onerror = (ev) => {
            finish({ message: ev.message || "モック実行中に不明なエラーが発生しました", line: null });
        };
        worker.postMessage({ code, isAppEvent, evName, wtag, overrides, widgets, extNames });
    });
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
// 存在しないもの、または「無効化された任意APIカテゴリ」に属するものを
// 行番号付きで検出する。
// 戻り値: [{ line: 1-indexed行番号, api: "vja.xxx.yyy", reason: "unknown"|"disabled" }, ...]
function _findUnknownApis(code, isAppEvent, disabledCategories) {
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
            const key = idx + ":" + api;
            if (seen.has(key)) continue;
            if (!whitelist.has(api)) {
                seen.add(key);
                found.push({ line: idx + 1, api, reason: "unknown" });
                continue;
            }
            // ホワイトリストには存在するが、このイベントで任意カテゴリが
            // 無効化されている場合はエラー扱いにする（フロントのみ対象）
            if (!isAppEvent && disabledCategories && disabledCategories.size > 0) {
                const category = _apiOptCategoryOfApiName(api);
                if (category && disabledCategories.has(category)) {
                    seen.add(key);
                    found.push({ line: idx + 1, api, reason: "disabled", category });
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

// 現在の任意API有効化状態から「無効化されているカテゴリ」の集合を算出する。
// バックエンド（isAppEvent）は対象外（常に空集合＝全カテゴリ利用可能）。
// 「event」カテゴリがロック対象のイベント（KeyDown/KeyUp/RowClick/HeaderClick）の
// 場合は、保存状態に関わらず常に有効（＝無効化対象から除外）として扱う。
function _getDisabledApiCategories(wid, evName, isAppEvent) {
    if (isAppEvent || !wid || !evName) return new Set();
    const labels = _PROMPT_DEF.VJA_FRONT_API_OPTIONAL_LABELS || {};
    const allCategories = Object.keys(labels);
    const enabled = new Set(_getApiOptState(wid, evName) || []);
    const disabled = new Set(allCategories.filter(c => !enabled.has(c)));
    if (_isEventCategoryLocked(evName)) disabled.delete("event");
    return disabled;
}

// 生成コードを検証する。戻り値: { ok, syntaxError, unknownApis, forbiddenPatterns, ... }
function validateGeneratedJs(code, isAppEvent, evName, wtag, wid) {
    const syntaxError = _checkJsSyntax(code);
    const disabledCategories = _getDisabledApiCategories(wid, evName, isAppEvent);
    const unknownApis = _findUnknownApis(code, isAppEvent, disabledCategories);
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
    (unknownApis || []).forEach(({ line, api, reason }) => {
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line).push(
            reason === "disabled"
                ? "無効化されたAPI: " + api + " は、このイベントでは無効化されています（右パネルの「利用API」で有効にしてください）"
                : "未知のAPI: " + api + " は存在しません（VJAランタイムを確認してください）"
        );
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
    validation.unknownApis.forEach(({ line, api, reason }) => parts.push(line + "行目: " + (reason === "disabled" ? "無効化されたAPI " : "未知のAPI ") + api));
    validation.forbiddenPatterns.forEach(({ line, message }) => parts.push(line + "行目: " + message));
    validation.missingAwaits.forEach(({ line, api }) => parts.push(line + "行目: await漏れ " + api));
    validation.unknownWidgets.forEach(({ line, api, name }) => parts.push(line + "行目: 未知のウィジェット名 " + name + "（" + api + "）"));
    if (validation.mockError) parts.push((validation.mockError.caught ? "モック実行(catchで捕捉): " : "モック実行例外: ") + (validation.mockError.line ? validation.mockError.line + "行目: " : "") + validation.mockError.message);
    return parts.length > 0 ? parts.join(" / ") : "(詳細なし)";
}

function _buildAiFixPrompt(originalUserPrompt, code, validation) {
    const issues = [];
    if (validation.syntaxError) issues.push("- 構文エラー: " + validation.syntaxError);
    validation.unknownApis.forEach(({ line, api, reason }) => {
        if (reason === "disabled") {
            issues.push("- " + line + "行目付近: API \"" + api + "\" は、このイベントでは現在無効化されています。このAPIを使用せず、有効化されているAPIの範囲内で実装してください。");
        } else {
            issues.push("- " + line + "行目付近: 存在しないAPI \"" + api + "\" が使用されています。VJAランタイムに実在するAPIのみを使用してください。");
        }
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
        const lineNote = validation.mockError.line ? (validation.mockError.line + "行目付近: ") : "";
        const caughtNote = validation.mockError.caught
            ? "モック実行時、try/catchで捕捉されconsole.error()に渡されたエラーが検出されました: "
            : "モック実行時に例外が発生しました: ";
        issues.push("- " + caughtNote + lineNote + validation.mockError.message + "（ダミー値での試験実行のため、実際の実行結果とは異なる場合がありますが、コードの構造に問題がある可能性が高いです）");
    }
    return originalUserPrompt +
        "\n\n[自動検証で以下の問題が検出されました。問題を修正し、修正後のコードのみを出力してください]\n" +
        issues.join("\n") +
        "\n\n[検出時のコード]\n```javascript\n" + code + "\n```";
}

// 【設計方針】以前はここに「直前のAI生成時のプロンプト」をキャッシュして
// 修正リトライ時に使い回していたが、ローカルLLM実行は高速・単体PC利用が
// 前提のためキャッシュの必要性が薄く、逆に「キャッシュが無いと機能が
// 使えない」「生成後に設定を変えても古いプロンプトのまま」といった問題の
// 元になっていた。そのためキャッシュ自体を廃止し、必要な時に毎回
// _buildGenPromptContext()で最新の状態から組み立て直す方式に統一した。

// 検証NG（構文エラー・未知API・禁止パターン）の内容をまとめた警告バナーを、
// 現在開いているYAMLエディタモーダルの左ペイン上部に表示する。
// トーストと異なり、ユーザーが閉じるまで表示され続ける。
// wid/evName/isAppEvent/isFormEventは、「もう一度AIに修正を依頼」ボタンから
// manualRetryAiFix()を呼ぶ際に必要な情報（プロンプトはその場で組み立て直す
// ため、キャッシュではなくこれらの識別情報だけ渡せばよい）。
function showAiValidationWarningBanner(validation, wid, evName, isAppEvent, isFormEvent) {
    const left = document.querySelector(".yaml-editor-left");
    if (!left) return;
    const old = document.getElementById("ai-validation-banner");
    if (old) old.remove();
    const banner = document.createElement("div");
    banner.id = "ai-validation-banner";
    const retryArgs = "'" + wid + "','" + evName + "'," + !!isAppEvent + "," + !!isFormEvent;
    const retryBtnHtml = "<button class='yaml-ai-btn'" + evtAttr("onmousedown", "manualRetryAiFix(" + retryArgs + ")") + ">🤖 もう一度AIに修正を依頼</button> ";
    if (validation.ok) {
        // 検証OK：バナーは自動で消さず、再修正を依頼できる状態のまま維持する
        banner.style.cssText = "background:#2a4a2e;color:#d8ffe0;padding:10px 14px;font-size:12px;border-bottom:1px solid #3a7a4a;flex-shrink:0";
        banner.innerHTML =
            "<div style='font-weight:bold;margin-bottom:8px'>✅ 検証OKになりました（未知のAPI・構文エラーは検出されていません）</div>" +
            retryBtnHtml +
            "<button class='yaml-ai-btn'" + evtAttr("onmousedown", "dismissAiValidationBanner()") + ">閉じる</button>";
        left.insertBefore(banner, left.firstChild);
        return;
    }
    const items = [];
    if (validation.syntaxError) items.push("・構文エラーの可能性: " + esc(validation.syntaxError));
    validation.unknownApis.forEach(({ line, api, reason }) => {
        items.push(
            reason === "disabled"
                ? "・" + line + "行目付近: 無効化されたAPI「" + esc(api) + "」（右パネルの「利用API」で有効にできます）"
                : "・" + line + "行目付近: 未知のAPI「" + esc(api) + "」"
        );
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
    if (validation.mockError) {
        const lineNote = validation.mockError.line ? (validation.mockError.line + "行目付近: ") : "";
        const label = validation.mockError.caught ? "・catchで捕捉されたエラー" : "・モック実行時に例外が発生";
        items.push(label + ": " + lineNote + esc(validation.mockError.message));
    }
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
        retryBtnHtml +
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
/* ── プロジェクト単位の学習履歴（AI修正で直った過去の間違い） ──
   保存先: getProjectData().learnedFixes["wid_evName"] = [
     { id, createdAt, mistakeSummary, pinned, recurCount }, ...
   ]
   1イベントあたり最大3件。人間への確認は行わず、以下の間接シグナルのみで
   自動的に淘汰する（「👍 役に立った」で明示的にpinしたものは淘汰対象外）。
   - 記録後、同種の問題（mistakeSummary一致）が2回再発 → 自動削除（効いていない）
   - 再発しなければそのまま残る（効いている、とみなす） */
function _learnedFixesKey(wid, evName) { return wid + "_" + evName; }
function _getLearnedFixes(wid, evName) {
    return (getProjectData().learnedFixes || {})[_learnedFixesKey(wid, evName)] || [];
}
function _setLearnedFixes(wid, evName, arr) {
    if (!getProjectData().learnedFixes) getProjectData().learnedFixes = {};
    getProjectData().learnedFixes[_learnedFixesKey(wid, evName)] = arr;
}
// AI修正（manualRetryAiFix）が成功した直後に、修正前の問題内容を1件記録する。
// 同一内容が既にあれば追加しない。上限3件を超える分は、pinned以外の最古から間引く。
function _recordLearnedFix(wid, evName, mistakeSummary) {
    if (!mistakeSummary || mistakeSummary === "(詳細なし)") return;
    let list = _getLearnedFixes(wid, evName);
    if (list.some(e => e.mistakeSummary === mistakeSummary)) return;
    list = [...list, {
        id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        createdAt: Date.now(), mistakeSummary, pinned: false, recurCount: 0,
    }];
    const MAX = 3;
    while (list.length > MAX) {
        const idx = list.findIndex(e => !e.pinned);
        if (idx === -1) break; // 全件pinned済みならMAX超過もやむを得ず残す
        list.splice(idx, 1);
    }
    _setLearnedFixes(wid, evName, list);
    window.vja?.log?.debug?.("[学習履歴] 記録: " + wid + "_" + evName + " → " + mistakeSummary);
}
// 生成・検証のたびに呼び、今回の失敗が過去に記録した「直したはずの間違い」と
// 同じ内容であれば再発とみなしrecurCountを+1する。2回再発したエントリは
// 「効いていない」と判断し、pinned以外は自動的に削除する。
function _trackLearnedFixRecurrence(wid, evName, mistakeSummary) {
    if (!mistakeSummary || mistakeSummary === "(詳細なし)") return;
    let changed = false;
    let list = _getLearnedFixes(wid, evName).map(e => {
        if (e.mistakeSummary !== mistakeSummary) return e;
        changed = true;
        return { ...e, recurCount: (e.recurCount || 0) + 1 };
    });
    if (!changed) return;
    list = list.filter(e => e.pinned || (e.recurCount || 0) < 2);
    _setLearnedFixes(wid, evName, list);
    window.vja?.log?.debug?.("[学習履歴] 再発検知: " + wid + "_" + evName + " → " + mistakeSummary);
}
// 「👍 役に立った」ボタン。以後、再発しても自動削除の対象外にする。
function yamlPinLearnedFix(wid, evName, id) {
    const list = _getLearnedFixes(wid, evName).map(e => e.id === id ? { ...e, pinned: true } : e);
    _setLearnedFixes(wid, evName, list);
}
function yamlDeleteLearnedFix(wid, evName, id) {
    const list = _getLearnedFixes(wid, evName).filter(e => e.id !== id);
    _setLearnedFixes(wid, evName, list);
}
// このイベントの学習履歴を、ユーザープロンプトに追加する文字列に変換する。
// 1件も無ければ空文字（＝プロンプトへの追加なし）。
function _buildLearnedFixesCtx(wid, evName) {
    const list = _getLearnedFixes(wid, evName);
    if (list.length === 0) return "";
    return "## Past mistakes in this project for this event (already fixed once — avoid repeating)\n"
        + list.map(e => "- " + e.mistakeSummary).join("\n");
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

// 「🧪 モック実行」ボタン用。現在js-taに表示されている内容（AI生成直後・
// 人間が手で修正した後のどちらでも可）に対して、AI生成を伴わずに
// 検証（構文・API・await漏れ・ウィジェット名・ev.type・モック実行）だけを行う。
async function manualMockCheck(isAppEvent, evName, wtag, wid) {
    const jsTa = $("js-ta");
    const code = jsTa?.value || "";
    if (!code.trim()) { showToast("JavaScriptが入力されていません"); return; }
    if (!(await vja.app.showConfirm("モックの実行を行います。よろしいですか？"))) return;
    let validation = validateGeneratedJs(code, isAppEvent, evName, wtag, wid);
    validation = await _augmentWithMockCheck(validation, code, isAppEvent, evName, wtag, wid);
    window.vja?.log?.debug?.("[AI検証] 手動モック実行: " + _formatValidationIssuesForLog(validation));
    if (validation.ok) {
        dismissAiValidationBanner();
        showToast("✅ モック実行OK（問題は検出されませんでした）");
        return;
    }
    // プロンプトはmanualRetryAiFix側でその場で組み立て直すため、
    // AI生成を1度も行っていない状態（手書きコードのみ）でも
    // 「もう一度AIに修正を依頼」ボタンを常に表示できる。
    _trackLearnedFixRecurrence(wid, evName, _formatValidationIssuesForLog(validation));
    showAiValidationWarningBanner(validation, wid, evName, isAppEvent, wid === "form");
}

// 警告バナーの「もう一度AIに修正を依頼」ボタン用。
// プロンプトはキャッシュを使い回さず、呼ばれるたびに_buildGenPromptContext()で
// 現在の状態から組み立て直す（生成後に設定を変えていても最新の内容が使われる）。
async function manualRetryAiFix(wid, evName, isAppEvent, isFormEvent) {
    const { sysPrompt, userPrompt, validationName, wtag } = _buildGenPromptContext(wid, evName, isAppEvent, isFormEvent);
    const jsTa = $("js-ta");
    const currentCode = _stripValidationWrapper(jsTa?.value || "", validationName);
    let validation = validateGeneratedJs(currentCode, isAppEvent, evName, wtag, wid);
    validation = await _augmentWithMockCheck(validation, currentCode, isAppEvent, evName, wtag, wid);
    if (validation.ok) { dismissAiValidationBanner(); return; }
    window.vja?.log?.debug?.("[AI検証] 手動での修正依頼を実行します。検出内容: " + _formatValidationIssuesForLog(validation));
    const fixUserPrompt = _buildAiFixPrompt(userPrompt, currentCode, validation);
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: fixUserPrompt,
        loadingMsg: "検出した問題を自動修正中…",
        onSuccess: async (fixed) => {
            let revalidated = validateGeneratedJs(fixed, isAppEvent, evName, wtag, wid);
            revalidated = await _augmentWithMockCheck(revalidated, fixed, isAppEvent, evName, wtag, wid);
            window.vja?.log?.debug?.(revalidated.ok
                ? "[AI検証] 手動修正で解消しました。"
                : "[AI検証] 手動修正後も未解消: " + _formatValidationIssuesForLog(revalidated));
            if (revalidated.ok) {
                // AIが自力で直せた＝「効いた」学習内容として記録する。
                _recordLearnedFix(wid, evName, _formatValidationIssuesForLog(validation));
            }
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
                showAiValidationWarningBanner(revalidated, wid, evName, isAppEvent, isFormEvent);
                if (revalidated.ok) showToast("✅ 修正が完了しました");
            }));
        },
        onCancel: async () => { },
        onError: async () => { },
    });
}

// validateGeneratedJs()の結果に、モック実行スモークテストの結果を
// マージする。mockErrorが検出された場合はokをfalseにする。
// mockErrorは { message: string, line: number|null, caught?: boolean } の形。
// caught=trueは、try/catchで握りつぶされconsole.error()に渡されたエラーを
// 検出したケース（例外としては外に投げられていない）であることを示す。
async function _augmentWithMockCheck(validation, code, isAppEvent, evName, wtag, wid) {
    const mockError = await _runMockSmokeTest(code, isAppEvent, evName, wtag, wid);
    if (!mockError) return validation;
    return { ...validation, ok: false, mockError };
}

// AI生成・修正依頼で使うシステムプロンプト・ユーザープロンプトを、現在の
// プロジェクト状態（ウィジェット一覧・利用テーブル・利用API・検証定義の
// 選択状態等）から都度組み立てる。
// 【設計方針】ローカルLLM実行は高速・単体PCでの利用が前提のため、
// 過去に組み立てたプロンプトをキャッシュして使い回すことはせず、
// 必要になるたびに毎回この関数で最新の状態から組み立て直す。
// こうすることで「キャッシュが無いので機能が使えない」という特殊対応や、
// 「生成後に設定を変えたのに古いプロンプトのまま修正依頼してしまう」
// といった問題を、そもそも起こりようがない形にしている。
function _buildGenPromptContext(wid, evName, isAppEvent, isFormEvent) {
    const w = (isAppEvent || isFormEvent) ? null : getWidget(wid);
    const yamlCur = $("yaml-ta")?.value || "";

    // ── ⓪ 検証（バリデーション）定義の取得 ──
    // 以前はYAML本文の「検証:」行から正規表現で抽出していたが、
    // タイポ防止のため右パネルでの単一選択方式に変更した。
    // YAML自体には書き込まない。vja.validate.run('定義名') はonSuccess時に先頭挿入。
    const validationName = _getValidationOverride(wid, evName) || null;
    const yamlForAi = yamlCur;

    const addPrompt = $("ai-prompt-in")?.value || "";
    const curForm = getProjectData().forms[getProjectData().curFormIdx];

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
    const globalConstCtx = getProjectData().constants.length > 0
        ? getProjectData().constants.map(c => "  - " + c.name + " = " + c.value).join("\n")
        : "  （なし）";
    const formConstCtx = (curForm?.constants || []).length > 0
        ? (curForm.constants || []).map(c => "  - " + c.name + " = " + c.value).join("\n")
        : "  （なし）";

    // ── ⑤ テーブル定義（利用テーブルのカラム情報） ──
    // 以前はYAML本文の「利用テーブル:」から正規表現で抽出していたが、
    // タイポ防止のため右パネルでのON/OFF方式に変更した
    // （ON/OFFの度にYAML本文へも自動反映されるため、YAML自体は変わらず
    //   唯一の情報源として保たれる。ここでは保存済みの状態を直接参照する）。
    const enabledTableNames = _ensureTableOptInitialized(wid, evName, yamlCur);
    const targetTables = enabledTableNames.length > 0
        ? getProjectData().tables.filter(t => enabledTableNames.includes(t.name))
        : []; // 未指定の場合は何も渡さない
    const tablesCtx = buildTablesCtxText(targetTables);

    // ── ⑤-2 任意API有効化: 有効カテゴリの判定・連動コンテキストのゲーティング ──
    // フロントエンドイベントのみ対象（バックエンドは全カテゴリ常時利用可能のため対象外）。
    const enabledApiOpts = isAppEvent ? [] : (() => {
        const arr = _getApiOptState(wid, evName) || [];
        // 保険: 右パネルを一度も開かず生成した場合でも、ロック対象イベントでは
        // 必ずeventカテゴリを有効に含める。
        if (_isEventCategoryLocked(evName) && !arr.includes("event")) return [...arr, "event"];
        return arr;
    })();
    const enabledApiOptSet = new Set(enabledApiOpts);
    // vja.constが無効なら、定数一覧そのものを見せる意味が無いため空にする
    const globalConstCtxGated = (!isAppEvent && !enabledApiOptSet.has("const")) ? "  （vja.constは現在このイベントで無効化されています）" : globalConstCtx;
    const formConstCtxGated = (!isAppEvent && !enabledApiOptSet.has("const")) ? "  （vja.constは現在このイベントで無効化されています）" : formConstCtx;
    // vja.formが無効なら、画面一覧も見せる意味が無いため空にする
    const formsCtxGated = (!isAppEvent && !enabledApiOptSet.has("form")) ? "  （vja.formは現在このイベントで無効化されています）" : formsCtx;
    // 有効化された任意カテゴリ・利用テーブル指定時のvja.dbのAPI説明を、ユーザープロンプト側に追加する
    let optionalApiDocCtx = "";
    if (!isAppEvent) {
        const blocks = [];
        enabledApiOpts.forEach(key => {
            const label = _PROMPT_DEF.VJA_FRONT_API_OPTIONAL_LABELS?.[key];
            const doc = _PROMPT_DEF.VJA_FRONT_API_OPTIONAL_ENG?.[key];
            if (label && doc) blocks.push("## " + label + "\n" + doc);
        });
        if (targetTables.length > 0 && _PROMPT_DEF.VJA_FRONT_API_DB_ENG) {
            blocks.push("## データベース (vja.db.*)\n" + _PROMPT_DEF.VJA_FRONT_API_DB_ENG);
        }
        optionalApiDocCtx = blocks.join("\n\n");
    }
    window.vja?.log?.debug?.(
        "[AI生成] 追加VJAランタイム(任意API) — 有効カテゴリ: "
        + (enabledApiOpts.length > 0 ? enabledApiOpts.join(", ") : "（なし）")
        + (targetTables.length > 0 ? " + db(利用テーブルあり)" : "")
        + "\n" + (optionalApiDocCtx || "（追加なし）")
    );

    // ── ⑤-3 プロジェクト単位の学習履歴（このイベントの過去の間違い） ──
    const learnedFixesCtx = _buildLearnedFixesCtx(wid, evName);

    // ── ⑥ システムプロンプト ──
    const sysPrompt = _PROMPT_DEF.YAML_TO_JS_SYS_PROMPT(
        isAppEvent,
        {
            formName: curForm?.cfg?.name, eventName: evName,
            wname: w?.name, wtag: w?.tag, wdescription: w?.props?.description,
            inputParamsCtx: inputParamsCtx, allWidgetsCtx: allWidgetsCtx,
            formsCtx: formsCtxGated, globalConstCtx: globalConstCtxGated,
            formConstCtx: formConstCtxGated, tablesCtx: tablesCtx,
            extRuntimeDoc: getProjectData().extRuntime.doc
        });

    // ── ⑦ ユーザープロンプト ──
    const userPrompt = _PROMPT_DEF.YAML_TO_JS_USER_PROMPT(
        isAppEvent, yamlForAi, addPrompt,
        {
            formName: curForm?.cfg?.name, eventName: evName,
            wname: w?.name, wtag: w?.tag, wdescription: w?.props?.description,
            inputParamsCtx: inputParamsCtx, allWidgetsCtx: allWidgetsCtx,
            formsCtx: formsCtxGated, globalConstCtx: globalConstCtxGated,
            formConstCtx: formConstCtxGated, tablesCtx: tablesCtx,
            extRuntimeDoc: getProjectData().extRuntime.doc,
            optionalApiDocCtx: optionalApiDocCtx,
            learnedFixesCtx: learnedFixesCtx,
        }
    );

    return { sysPrompt, userPrompt, validationName, wtag: w?.tag };
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

    const { sysPrompt, userPrompt, validationName, wtag } = _buildGenPromptContext(wid, evName, isAppEvent, isFormEvent);
    const btn = $("ai-gen-btn");
    const randomBtn = $("ai-gen-random-btn");
    const status = $("ai-status");
    const aiStartTime = Date.now(); // AI実行開始時刻を記録

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
            let validation = validateGeneratedJs(unwrapped, isAppEvent, evName, w?.tag, wid);
            if (_isAutoMockCheckEnabled(wid, evName)) {
                validation = await _augmentWithMockCheck(validation, unwrapped, isAppEvent, evName, w?.tag, wid);
            }
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
                    validation = validateGeneratedJs(unwrapped, isAppEvent, evName, w?.tag, wid);
                    if (_isAutoMockCheckEnabled(wid, evName)) {
                        validation = await _augmentWithMockCheck(validation, unwrapped, isAppEvent, evName, w?.tag, wid);
                    }
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
                    _trackLearnedFixRecurrence(wid, evName, _formatValidationIssuesForLog(validation));
                    showAiValidationWarningBanner(validation, wid, evName, isAppEvent, isFormEvent);
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
function buildYamlEditorHTML(cur, curJs, showWidgets = true, headerHTML = "", extraTabsHTML = "", tabConfig = null, isAppEvent = false, wid = null, evName = null) {
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
        "<button class='yaml-api-ref-btn' style='margin-left:auto'" + evtAttr("onmousedown", "openApiRef(" + isAppEvent + ")") + ">📖 API</button>" +
        "<button class='yaml-api-ref-btn' id='ai-mock-btn' style='margin-left:0' title='現在JavaScriptタブに表示されている内容を、モックVJAランタイムで試験実行します'" +
        evtAttr("onmousedown", "pvCall(\"yamlMockCheck\")") + ">🧪 モック</button>" +
        "<button class='yaml-api-ref-btn' id='ai-mock-edit-btn' style='margin-left:0' title='モック実行で使うダミー値を上書き設定します'" +
        evtAttr("onmousedown", "pvCall(\"yamlMockEdit\")") + ">⚙ モック編集</button>" +
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
        yamlBuildRightPanel(showWidgets, wid, evName, isAppEvent, cur) +
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
    dismissAiValidationBanner, manualRetryAiFix, manualMockCheck,
    openMockOverrideEditor, saveMockOverrides, _mockEditorAddRow, _mockEditorOnTypeChange,
    yamlSetApiOpt,
    yamlSetTableOpt, yamlSetValidationOpt, _applyTableYamlSync,
    yamlSetMockCheckOpt,
    yamlPinLearnedFix, yamlDeleteLearnedFix,
});
