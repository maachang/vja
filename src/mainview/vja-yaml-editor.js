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
     - _runMockSmokeTest() / augmentWithMockCheck()
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
function parseApiRefNav(text) {
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
    const nav = parseApiRefNav(info);

    // 左パネルのナビゲーションHTML生成（カテゴリのみ）
    const navHtml = nav.filter(item => item.type === "category").map(item => render("ye-tpl-api-ref-cat", {
        label: item.label,
        attr: evtAttr("onmousedown", "_apiRefJump(this.dataset.label)"),
    })).join("");

    showModal(
        mhdrHTML(title, "modal-layer-1") +
        render("ye-tpl-api-ref-body", {
            navHtml,
            attrSearch: evtAttr("oninput", "_apiRefFilter()"),
            bodyHtml: yamlTokenize(info),
        }) +
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
            return render("ye-tpl-api-ref-line", {
                style: matched ? "background:var(--accent-dim,#2a3a6a);display:block" : "opacity:0.3;display:block",
                highlighted: yamlTokenize(line),
            });
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
    const curDoc = (w.docCode && w.docCode[evName]) || "";
    const isAppEvent = (wid === "appev");
    pvRegister("yamlSave", () => saveYaml(wid, evName));
    pvRegister("yamlTextToYaml", () => textToYamlGenerate(wid, evName));
    pvRegister("yamlAiGen", () => yamlAiGenerate(wid, evName));
    pvRegister("yamlAiGenRandom", () => yamlAiGenerate(wid, evName, getBoostedTemperature()));
    pvRegister("yamlMockCheck", () => manualMockCheck(false, evName, getWidget(wid)?.tag, wid));
    pvRegister("yamlMockEdit", () => openMockOverrideEditor(wid, evName));
    pvRegister("yamlRecordSnapshot", () => yamlRecordSnapshot(wid, evName));
    pvRegister("yamlSnapshotHistory", () => openSnapshotHistoryModal(wid, evName));
    showModal(buildYamlEditorHTML(cur, curJs, true, mhdrHTML("📋 " + esc(w.name) + " — " + esc(evName)), "", null, isAppEvent, wid, evName, curDoc));
    initYamlEditorModal(cur, curJs, undefined, isAppEvent, curDoc);
}

/* ── YAMLエディタ 右パネル ── */

// 右パネルHTML生成
// ── 右パネル: 定数セクション ──
// グローバル定数＋現在フォームのフォーム定数を一覧表示する。
// 右パネル共通: rp-tbl-row（ヘッダー＋展開可能な明細テーブル）のラップ
function _rpRowWrap(headerInner, rowsHtml, headerStyle) {
    return render("ye-tpl-rp-row-wrap", {
        headerStyle: headerStyle || "",
        headerInner,
        expandBtn: rowsHtml ? render("ye-tpl-rp-expand-btn", {}) : "",
        cols: rowsHtml ? render("ye-tpl-rp-cols", { rows: rowsHtml }) : "",
    });
}

function _rpBuildConstSection() {
    const curForm = getProjectData().forms[getProjectData().curFormIdx];
    const _formConsts = curForm?.constants || [];
    const _allConsts = [...getProjectData().constants, ..._formConsts];
    if (_allConsts.length === 0) return "<div style='padding:8px 10px;font-size:11px;color:var(--text3)'>定数なし</div>";
    const rows = _allConsts.map(c => {
        const isForm = _formConsts.some(fc => fc.name === c.name);
        return render("ye-tpl-rp-const-row", { n: c.name, v: c.value, tag: isForm ? "[F]" : "[G]" });
    }).join("");
    return render("ye-tpl-rp-const-section", { rows });
}

// ── 右パネル: 画面一覧セクション ──
// 全フォームと、各フォームに含まれるウィジェット名を一覧表示する。
function _rpBuildFormSection() {
    return "<div>" + getProjectData().forms.map((f, fi) => {
        const isCur = fi === getProjectData().curFormIdx;
        const wids = (f.widgets || []).map(ww => render("ye-tpl-rp-tr", {
            insert: ww.name, cls1: "col-name", col1: ww.name, cls2: "col-type", col2: ww.tag, cls3: "", col3: "",
        })).join("");
        const headerInner = render("ye-tpl-rp-form-header-inner", {
            ft: f.cfg.name,
            nameStyle: isCur ? "color:var(--accent);font-weight:bold" : "",
            star: isCur ? "★ " : "",
        });
        return _rpRowWrap(headerInner, wids);
    }).join("") + "</div>";
}

// ── 右パネル: 現在フォームのウィジェット一覧セクション ──
// ウィジェット名・タグ・説明を表示し、種別によって展開可能な
// 追加行（グループ名・選択肢・カラム一覧）を持つ。
function _rpBuildWidgetSection() {
    return getProjectData().widgets.length > 0
        ? "<div>" + getProjectData().widgets.map(ww => {
            try {
                const tag = (ww.tag || "").toLowerCase();
                const desc = ww.props?.description || "";
                let extraRows = "";
                if (tag === "radio" && ww.props?.group) {
                    extraRows += render("ye-tpl-rp-tr", {
                        insert: ww.props.group, cls1: "col-name", col1: "groupName",
                        cls2: "col-type", col2: ww.props.group, cls3: "", col3: "",
                    });
                }
                if ((tag === "selectbox" || tag === "listbox") && ww.props?.items) {
                    const itemList = String(ww.props.items).split("\n").map(s => s.trim()).filter(Boolean);
                    extraRows += itemList.map(item => render("ye-tpl-rp-tr", {
                        insert: item, cls1: "col-name", col1: item, cls2: "col-type", col2: "", cls3: "", col3: "",
                    })).join("");
                }
                if (tag === "datagrid" && ww.props?.columns) {
                    const colStr = String(ww.props.columns);
                    const colItems = colStr.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
                    extraRows += colItems.map(c => {
                        const label = c.split(":")[0].trim();
                        return render("ye-tpl-rp-tr", {
                            insert: label, cls1: "col-name", col1: label, cls2: "col-type", col2: "", cls3: "", col3: "",
                        });
                    }).join("");
                }
                const descSpan = desc ? render("ye-tpl-rp-desc-span", { desc }) : "";
                const headerInner = render("ye-tpl-rp-widget-header-inner", { n: ww.name, tag: ww.tag, descSpan });
                return _rpRowWrap(headerInner, extraRows);
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
        enabledSet = new Set(ensureTableOptInitialized(wid, evName, curYaml || ""));
    }
    return "<div>" + getProjectData().tables.map((t) => {
        const cols = (t.columns || []).map(c => {
            const flags = [c.pk ? "PK" : "", c.notNull ? "NN" : "", c.useDefault ? "DEF" : "", c.index ? "IDX" : ""].filter(Boolean).join(" ");
            return render("ye-tpl-rp-tr", {
                insert: c.name, cls1: "col-name", col1: c.name, cls2: "col-type", col2: c.type, cls3: "col-flag", col3: flags,
            });
        }).join("");
        const toggleHtml = hasCtx
            ? render("ye-tpl-rp-table-toggle-wrap", {
                sel: makePvSel(
                    "tblopt-" + _sanitizeIdPart(wid) + "-" + _sanitizeIdPart(evName) + "-" + _sanitizeIdPart(t.name),
                    ["ON", "OFF"],
                    enabledSet.has(t.name) ? "ON" : "OFF",
                    "yamlSetTableOpt('" + wid + "','" + evName + "','" + t.name + "',{value})"
                ),
            })
            : "";
        const headerInner = render("ye-tpl-rp-table-header-inner", { toggleHtml, tn: t.name });
        return _rpRowWrap(headerInner, cols, "display:flex;align-items:center");
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
    const current = hasCtx ? (getValidationOverride(wid, evName) || "（なし）") : "（なし）";
    const selectorHtml = hasCtx
        ? "<div style='padding:6px 10px'>" + makePvSel(
            "validsel-" + _sanitizeIdPart(wid) + "-" + _sanitizeIdPart(evName),
            ["（なし）", ...validations.map((v) => v.name)],
            current,
            "yamlSetValidationOpt('" + wid + "','" + evName + "',{value})"
        ) + "</div>"
        : "";
    const listHtml = "<div>" + validations.map(v => {
        const rules = (v.rules || []).filter(r => r.name && r.type);
        const ruleRows = rules.map(r => {
            const typeLabel = (VALIDATION_TYPES.find(t => t.value === r.type)?.label) || r.type;
            return render("ye-tpl-rp-validation-tr", { name: r.name, type: typeLabel, flag: r.not ? "NOT" : "" });
        }).join("");
        const headerInner = render("ye-tpl-rp-validation-header-inner", { vn: v.name });
        return _rpRowWrap(headerInner, ruleRows);
    }).join("") + "</div>";
    return selectorHtml + listHtml;
}

// ── 右パネル: ウィジェット種別セクション（フォームデザインエディタ専用） ──
// AIによる画面デザイン自動生成YAMLで指定可能なウィジェットタグ（FORM_DESIGN_TAGS）の
// 一覧を表示する。タグ名クリックでタグ名そのものを挿入。detail情報がある場合は
// 折りたたみを展開すると詳細選択肢（inputType等）が表示され、クリックでその値を挿入する。
function _rpBuildWidgetTagSection() {
    return "<div>" + FORM_DESIGN_TAGS.map(d => {
        const optRows = (d.options || []).map(o => render("ye-tpl-rp-tr", {
            insert: o, cls1: "col-name", col1: o, cls2: "col-type", col2: d.detailLabel || "", cls3: "", col3: "",
        })).join("");
        const noteRow = d.note ? render("ye-tpl-rp-widgettag-note-tr", { note: d.note }) : "";
        const headerInner = render("ye-tpl-rp-widgettag-header-inner", { tn: d.tag, label: d.label });
        return _rpRowWrap(headerInner, optRows + noteRow);
    }).join("") + "</div>";
}

// ── 任意API有効化: データ管理 ──
// getProjectData().apiOptOverrides["wid_evName"] = ["form","const",...]
// （有効化された任意カテゴリのキー配列。未初期化＝undefined）
function _apiOptStorageKey(wid, evName) { return wid + "_" + evName; }
function getApiOptState(wid, evName) {
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
function isEventCategoryLocked(evName) {
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
    let state = getApiOptState(wid, evName);
    if (state === undefined) {
        const detected = _detectApiOptCategoriesFromCode(code);
        if (isEventCategoryLocked(evName)) detected.add("event");
        state = Array.from(detected);
        _setApiOptState(wid, evName, state);
    }
    return state;
}

// カテゴリのON/OFF切り替え（pv-selのonPickCodeから呼ばれる）。
// 「event」カテゴリがロック対象のイベントの場合は、OFFへの変更を無視する
// （UI側でもプルダウン自体を出さないが、念のため二重に防御する）。
function yamlSetApiOpt(wid, evName, key, value) {
    if (key === "event" && value === "OFF" && isEventCategoryLocked(evName)) {
        window.vja?.log?.debug?.("[利用API] event はこのイベント(" + evName + ")では常時有効のためOFFにできません");
        return;
    }
    const state = getApiOptState(wid, evName) || [];
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
function apiOptCategoryOfApiName(api) {
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
    const locked = isEventCategoryLocked(evName);
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
function ensureTableOptInitialized(wid, evName, yamlText) {
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
    applyTableYamlSync(wid, evName);
}
// 現在の有効化状態を、YAMLエディタ本文（yaml-ta）に即時反映する。
function applyTableYamlSync(wid, evName) {
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
function getValidationOverride(wid, evName) {
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
function isAutoMockCheckEnabled(wid, evName) {
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
    return render("ye-tpl-mockcheck-section", { sel: makePvSel(selId, ["既定", "ON", "OFF"], cur, onPickCode) });
}


// ── 右パネル: 学習履歴（プロジェクト単位、たたき台版） ──
function _rpBuildLearnedFixesSection(wid, evName) {
    if (!wid || !evName) return "<div style='padding:8px 10px;font-size:11px;color:var(--text3)'>-</div>";
    const list = getLearnedFixes(wid, evName);
    if (list.length === 0) {
        return "<div style='padding:8px 10px;font-size:11px;color:var(--text3)'>学習履歴なし（「もう一度AIに修正を依頼」が成功すると自動的に記録されます）</div>";
    }
    return "<div>" + list.map(e => render("ye-tpl-learned-row", {
        summary: e.mistakeSummary,
        disabled: e.pinned ? "disabled" : "",
        pinLabel: e.pinned ? "👍 固定済み" : "👍 役に立った",
        attrPin: evtAttr("onmousedown", "yamlPinLearnedFix('" + wid + "','" + evName + "','" + e.id + "');this.textContent='👍 固定済み';this.disabled=true;"),
        attrDel: evtAttr("onmousedown", "yamlDeleteLearnedFix('" + wid + "','" + evName + "','" + e.id + "');this.closest('.rp-learned-row').remove();"),
    })).join("") + "</div>";
}

// ── 右パネル: 利用API（任意カテゴリ）セクション ──
// フロントエンドイベントのみ表示。バックエンド（isAppEvent）では表示しない。
function _rpBuildApiOptSection(wid, evName) {
    const code = _getExistingJsCodeFor(wid, evName);
    const enabledArr = _ensureApiOptInitialized(wid, evName, code);
    const enabled = new Set(enabledArr);
    const locked = isEventCategoryLocked(evName);
    const labels = _PROMPT_DEF.VJA_FRONT_API_OPTIONAL_LABELS || {};
    const rows = Object.keys(labels).map(key => {
        // 「event」カテゴリは、ロック対象イベント（KeyDown/KeyUp/RowClick/HeaderClick）
        // では常時有効固定とし、ON/OFF切り替え自体を出さない（vja.dbの注記と同じ扱い）。
        if (key === "event" && locked) {
            return render("ye-tpl-apiopt-locked", { label: labels[key] });
        }
        const selId = "apiopt-" + String(wid).replace(/[^a-zA-Z0-9_-]/g, "_") + "-" + String(evName).replace(/[^a-zA-Z0-9_-]/g, "_") + "-" + key;
        const curVal = enabled.has(key) ? "ON" : "OFF";
        const onPickCode = "yamlSetApiOpt('" + wid + "','" + evName + "','" + key + "',{value})";
        return render("ye-tpl-apiopt-row", {
            sel: makePvSel(selId, ["ON", "OFF"], curVal, onPickCode),
            label: labels[key],
        });
    }).join("");
    const dbNote = render("ye-tpl-apiopt-dbnote", {});
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
    return render("ye-tpl-rpanel-section", {
        open: open ? "open" : "",
        title,
        arrow: open ? "▼" : "▶",
        body,
    });
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
    else if (ta.id.startsWith("ta-")) hlUpdate(ta.id, "hl-" + ta.id.slice(3), yamlTokenize);
}

// AI生成コアロジック（buildGenPromptContext/yamlAiGenerate/textToYamlGenerate等）は
// 2026-09-21にvja-ai-gen-core.jsへ切り出した。

// 画面デザインAI生成の中核（buildFormLayoutPickerHtml〜formDesignTextToYamlGenerate）は
// 2026-09-21にvja-form-design-ai.jsへ切り出した。

// AI接続設定モーダル一式（_initAiPresets含む）は
// 2026-09-21にvja-ai-config.jsへ切り出した（重複定義だった旧版はここで削除済み）。

// エディタ共通キーハンドラ・入力補完・対応括弧ハイライト（editorKeyHandler等）は
// 2026-09-21にvja-editor-completion.jsへ切り出した。


// 通常構成（✨ YAMLドラフト + 📋 YAML + 📜 JavaScript）
function buildYamlEditorHTML(cur, curJs, showWidgets = true, headerHTML = "", extraTabsHTML = "", tabConfig = null, isAppEvent = false, wid = null, evName = null, curDoc = "") {
    const aiEnabled = getProjectData().aiConfig.enabled;

    // カスタムタブ構成
    if (tabConfig) {
        const tabs = tabConfig.tabs || [];
        const tabBar = tabs.map((t, idx) => render("ye-tpl-custom-tab-item", {
            active: idx === 0 ? "active" : "",
            id: t.id,
            attr: evtAttr("onmousedown", `yamlTabSwitch("${t.id}")`),
            label: t.label,
        })).join("");
        const panes = tabs.map((t, idx) => {
            const isDoc = t.type === "doc";
            const isJs = t.type === "js";
            const isLayout = t.type === "layout";
            if (isLayout) {
                // レイアウトイメージ選択タブ: エディタ(ガター/テキストエリア)ではなく、
                // 箱型ダイアグラムのカード一覧を表示する専用ペイン。
                return render("ye-tpl-custom-pane-layout", {
                    active: idx === 0 ? "active" : "",
                    id: t.id,
                    picker: buildFormLayoutPickerHtml(),
                });
            }
            const hlWrap = isJs ? "js-hl-wrap" : "yaml-hl-wrap";
            const hlBg = isJs ? "js-hl-bg" : "yaml-hl-bg";
            const styleAttr = isDoc
                ? `style='color:var(--text) !important;background:transparent;caret-color:var(--text);width:100%;height:100%;display:block;box-sizing:border-box;resize:none'`
                : `style='height:100%;min-height:300px'`;
            const attrPh = t.ph ? ` placeholder='${esc(t.ph)}'` : "";

            const mainInner = isDoc
                ? render("ye-tpl-custom-main-doc", {
                    id: t.id, styleAttr,
                    attrInput: evtAttr("oninput", `editorUpdateGutter("ta-${t.id}","gutter-${t.id}")`),
                    attrScroll: evtAttr("onscroll", `editorSyncGutter("ta-${t.id}","gutter-${t.id}")`),
                    attrPh, val: t.val || "",
                })
                : render("ye-tpl-custom-main-code", {
                    id: t.id, styleAttr, hlWrap, hlBg,
                    attrInput: evtAttr("oninput", `editorHlUpdate("ta-${t.id}")`),
                    attrScroll: evtAttr("onscroll", `hlSync("ta-${t.id}","hl-${t.id}");editorSyncGutter("ta-${t.id}","gutter-${t.id}")`),
                    attrPh, val: t.val || "",
                });

            return render("ye-tpl-custom-pane-editor", {
                active: idx === 0 ? "active" : "",
                id: t.id,
                mainInner,
            });
        }).join("");
        const aiBar = render("ye-tpl-ai-bar-wrap", { inner: tabConfig.aiBar || "" });
        const saveBtn = tabConfig.saveAction
            ? render("ye-tpl-save-btn", { attr: evtAttr("onmousedown", tabConfig.saveAction) })
            : "";
        const rightPanelHtml = tabConfig.rightPanel === "formDesign"
            ? render("ye-tpl-formdesign-right", { panel: yamlBuildFormDesignRightPanel() })
            : render("ye-tpl-no-right", {});
        return render("ye-tpl-custom-body", {
            headerHTML,
            tabBar,
            panes,
            aiBar,
            rightPanelHtml,
            footBtns: mfootHTML([{ label: "キャンセル", action: "closeModal()" }]),
            saveBtn,
        });
    }

    const tabBar = render("ye-tpl-default-tabbar", {
        attrYaml: evtAttr("onmousedown", "yamlTabSwitch(\"yaml\")"),
        attrPrompt: evtAttr("onmousedown", "yamlTabSwitch(\"prompt\")"),
        attrJs: evtAttr("onmousedown", "yamlTabSwitch(\"js\");jsHlUpdate();"),
        attrApiRef: evtAttr("onmousedown", "openApiRef(" + isAppEvent + ")"),
        attrMockCheck: evtAttr("onmousedown", "pvCall(\"yamlMockCheck\")"),
        attrMockEdit: evtAttr("onmousedown", "pvCall(\"yamlMockEdit\")"),
        attrSnapshotRecord: evtAttr("onmousedown", "pvCall(\"yamlRecordSnapshot\")"),
        attrSnapshotHistory: evtAttr("onmousedown", "pvCall(\"yamlSnapshotHistory\")"),
    });
    const paneYaml = render("ye-tpl-default-pane-yaml", {
        cur,
        attrInput: evtAttr("oninput", "yamlHlUpdate();editorUpdateGutter(\"yaml-ta\",\"yaml-gutter\")"),
        attrScroll: evtAttr("onscroll", "yamlHlSync();editorSyncGutter(\"yaml-ta\",\"yaml-gutter\")"),
    });
    const panePrompt = render("ye-tpl-default-pane-prompt", {
        curDoc,
        attrInput: evtAttr("oninput", "editorUpdateGutter(\"prompt-ta\",\"prompt-gutter\")"),
        attrScroll: evtAttr("onscroll", "editorSyncGutter(\"prompt-ta\",\"prompt-gutter\")"),
    });
    const paneJs = render("ye-tpl-default-pane-js", {
        curJs,
        attrInput: evtAttr("oninput", "jsHlUpdate();editorUpdateGutter(\"js-ta\",\"js-gutter\")"),
        attrScroll: evtAttr("onscroll", "jsHlSync();editorSyncGutter(\"js-ta\",\"js-gutter\")"),
    });
    const aiBar = render("ye-tpl-default-ai-bar", {
        attrGenYaml: evtAttr("onmousedown", "pvCall(\"yamlTextToYaml\")"),
        attrGenRandom: evtAttr("onmousedown", "pvCall(\"yamlAiGenRandom\")"),
        attrGen: evtAttr("onmousedown", "pvCall(\"yamlAiGen\")"),
        genLabel: aiEnabled ? "🤖 JSコード生成" : "🤖 JSコード生成（設定要）",
        attrSearchEnter: evtAttr("onkeydown", "if(event.key===\"Enter\"){event.preventDefault();editorSearch();}"),
        attrSearchInput: evtAttr("oninput", "getEditorContext().searchLast={taId:null,word:\"\",pos:0}"),
        attrSearchClear: evtAttr("onmousedown", "event.preventDefault();$(\"editor-search-in\").value=\"\";$(\"editor-replace-in\").value=\"\";getEditorContext().searchLast={taId:null,word:\"\",pos:0}"),
        attrSearchGo: evtAttr("onmousedown", "event.preventDefault();editorSearch()"),
        attrReplaceEnter: evtAttr("onkeydown", "if(event.key===\"Enter\"){event.preventDefault();editorReplace();}"),
        attrReplace: evtAttr("onmousedown", "event.preventDefault();editorReplace()"),
        attrReplaceAll: evtAttr("onmousedown", "event.preventDefault();editorReplaceAll()"),
    });
    return render("ye-tpl-default-body", {
        headerHTML,
        extraTabs: extraTabsHTML ? render("ye-tpl-ev-tabs-wrap", { inner: extraTabsHTML }) : "",
        tabBar, paneYaml, panePrompt, paneJs, aiBar,
        rightPanel: yamlBuildRightPanel(showWidgets, wid, evName, isAppEvent, cur),
        footBtns: mfootHTML([{ label: "キャンセル", action: "closeModal()" }]),
        attrSave: evtAttr("onmousedown", "pvCall(\"yamlSave\")"),
    });
}

/* ── YAMLエディタ初期化（requestAnimationFrame内の共通処理） ── */
function initYamlEditorModal(cur, curJs, onAfterInit, isAppEvent = false, curDoc = "") {
    getEditorContext().isAppEvent = isAppEvent;
    getEditorContext().completion = { active: false, list: [], sel: 0, wordStart: 0, wordEnd: 0, mode: "api" };
    requestAnimationFrame(() => {
        applyEditorConfig();
        yamlHlUpdate();
        editorUpdateGutter("yaml-ta", "yaml-gutter");
        jsHlUpdate();
        editorUpdateGutter("js-ta", "js-gutter");
        editorUpdateGutter("prompt-ta", "prompt-gutter");
        const pta = $("prompt-ta");
        const yta = $("yaml-ta");
        const jta = $("js-ta");
        if (pta) pta.addEventListener("keydown", editorKeyHandler);
        if (yta) yta.addEventListener("keydown", editorKeyHandler);
        if (jta) jta.addEventListener("keydown", editorKeyHandler);
        if (pta) pta.addEventListener("mousedown", editorMouseDownHandler2);
        if (yta) yta.addEventListener("mousedown", editorMouseDownHandler2);
        if (jta) jta.addEventListener("mousedown", editorMouseDownHandler2);
        if (pta) pta.addEventListener("dblclick", editorDblClickHandler);
        if (yta) yta.addEventListener("dblclick", editorDblClickHandler);
        if (jta) jta.addEventListener("dblclick", editorDblClickHandler);
        // JSペインの入力補完（vja API名/ウィジェット名）
        if (jta) jta.addEventListener("input", _editorCompletionOnInput);
        if (jta) jta.addEventListener("blur", closeCompletionPopup);
        // 対応括弧のハイライト（入力だけでなく、クリック・カーソル移動キーでも再計算する）
        if (yta) yta.addEventListener("input", () => updateBracketMatch("yaml-ta"));
        if (yta) yta.addEventListener("keyup", () => updateBracketMatch("yaml-ta"));
        if (yta) yta.addEventListener("mouseup", () => updateBracketMatch("yaml-ta"));
        if (yta) yta.addEventListener("blur", clearBracketMatch);
        if (jta) jta.addEventListener("input", () => updateBracketMatch("js-ta"));
        if (jta) jta.addEventListener("keyup", () => updateBracketMatch("js-ta"));
        if (jta) jta.addEventListener("mouseup", () => updateBracketMatch("js-ta"));
        if (jta) jta.addEventListener("blur", clearBracketMatch);
        clearBracketMatch();
        if (!getEditorContext().pu) getEditorContext().pu = {};
        editorUndoInit("prompt-ta", getEditorContext().pu, curDoc);
        editorUndoInit("yaml-ta", getEditorContext().yu, cur);
        editorUndoInit("js-ta", getEditorContext().ju, curJs);
        yamlInitResize();
        yamlInitRpanelEvents();
        rAfBind("#tab-yaml", "click", () => yamlTabSwitch("yaml"));
        rAfBind("#tab-js", "click", () => { yamlTabSwitch("js"); jsHlUpdate(); });
        rAfBind("#tab-prompt", "click", () => yamlTabSwitch("prompt"));
        jsHlUpdate();
        // 開いた直後から入力できるよう、最初にアクティブな📋YAMLタブへフォーカスする。
        // requestAnimationFrame直後だとWebViewがまだ描画/レイアウトを完了しておらず
        // focus()が効かないことがあるため、setTimeoutで1ティック遅らせて実行する
        setTimeout(() => yta?.focus(), 0);
        if (onAfterInit) onAfterInit();
    });
}

// 画面デザインAI生成の残り（saveFormDesignDraft〜formDesignAiGenerate）は
// 2026-09-21にvja-form-design-ai.jsへ切り出した。

// エディタ内検索・置換（editorSearch/editorReplace/editorReplaceAll）は
// 2026-09-21にvja-editor-search.jsへ切り出した。

// 学習ノウハウ管理モーダル（openLearnedFixesModal等）は
// 2026-09-21にvja-learned-fixes-ui.jsへ切り出した。

/* ═══════════════════════════════════════════
   window へのエクスポート（他ファイルから参照される関数のみ）
═══════════════════════════════════════════ */
Object.assign(window, {
    parseApiRefNav, openApiRef, openYaml,
    yamlBuildRightPanel, yamlBuildFormDesignRightPanel, yamlRpSection, yamlToggleRpSection, yamlToggleTblCols,
    yamlInitRpanelEvents, yamlInitResize, yamlInsert,
    buildYamlEditorHTML, initYamlEditorModal,
    yamlSetApiOpt,
    yamlSetTableOpt, yamlSetValidationOpt, applyTableYamlSync,
    yamlSetMockCheckOpt,
    // vja-mock-check.js（検証・モック実行エンジン）から呼び出すため、
    // CLAUDE.mdの規約に従い`_`無しの名前でグローバル展開する。
    getApiOptState, apiOptCategoryOfApiName,
    isEventCategoryLocked,
    // vja-ai-gen-core.js（AI生成コアロジック）から呼び出すため、
    // CLAUDE.mdの規約に従い`_`無しの名前でグローバル展開する。
    ensureTableOptInitialized, isAutoMockCheckEnabled, getValidationOverride,
});
