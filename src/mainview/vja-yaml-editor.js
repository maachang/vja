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
        enabledSet = new Set(_ensureTableOptInitialized(wid, evName, curYaml || ""));
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
                let def = "    - " + c.name + (c.labelJa ? "（" + c.labelJa + "）" : "") + " (" + c.type + ")";
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
// 他ファイル（vja-editor-completion.js）からも呼び出すため、CLAUDE.mdの規約に従い
// `_`無しの名前でグローバル展開する（`_`始まりはファイル内限定の意味のため）。
function getVjaApiWhitelist() {
    if (!_vjaApiWhitelistCache) {
        _vjaApiWhitelistCache = {
            front: _extractVjaApiSet(_PROMPT_DEF.VJA_USE_FRONT_JS_INFO),
            back: _extractVjaApiSet(_PROMPT_DEF.VJA_USE_BACK_JS_INFO),
        };
    }
    return _vjaApiWhitelistCache;
}

// JSペイン入力補完（_getCompletionPartial等）は
// 2026-09-21にvja-editor-completion.jsへ切り出した。

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
function findMissingAwaits(code, isAppEvent) {
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

// findMissingAwaits() で検出したawait漏れを機械的に補完する
// （awaitの付け忘れは小型ローカルLLMで頻出のミスであり、AIへの再修正依頼を
//   挟まず、その場でawaitを挿入するだけで解消できるため）。
// 判定ロジックは_findMissingAwaits()と同一の正規表現・必須APIセットを使う
// （検出と補完の判定基準がずれるとawait漏れの見逃し/誤挿入につながるため）。
function fixMissingAwaits(code, isAppEvent) {
    const required = isAppEvent ? _getVjaAwaitRequiredSet().back : _getVjaAwaitRequiredSet().front;
    const re = /(await\s+)?\b(vja(?:\.\w+)+)\s*\(/g;
    return code.replace(re, (match, hasAwait, api) => {
        if (hasAwait || !required.has(api)) return match;
        return "await " + match;
    });
}

// AI生成コード（1行べた書き・インデント不揃い等）をPrettier(bun側)で整形する。
// Prettierが構文エラー等で失敗した場合は、整形前のコードをそのまま返す
// （整形は品質向上のための後処理であり、失敗しても検証フロー自体は止めない）。
async function formatJsCode(code) {
    try {
        const res = await vja.editor.formatJs(code);
        return res?.ok ? res.code : code;
    } catch (e) {
        window.vja?.log?.debug?.("[JS整形] Prettier呼び出し失敗: " + e.message);
        return code;
    }
}

// 第1引数にウィジェット名（文字列リテラル）を取るAPIの一覧。
// ここに列挙したAPIについて、指定されたウィジェット名が現在のフォームに
// 実在するかを検証する。変数で渡されている場合（文字列リテラルでない場合）は
// 判定不能なため対象外とする。
const _WIDGET_NAME_ARG_APIS = [
    "vja.widget.get", "vja.widget.set", "vja.widget.setSuggestions",
    "vja.form.setParam", "vja.form.getParam",
];
// コード内で、上記API群に対して「現在のフォームに存在しないウィジェット名」が
// 文字列リテラルで渡されている箇所を検出する。vja.trigger.* も対象に含める
// （引数無し呼び出し＝全ウィジェット対象は除外）。
// 戻り値: [{ line, api, name }, ...]
function findUnknownWidgetNames(code) {
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

// 検証・モック実行エンジン・スナップショット履歴・学習履歴の記録は
// 2026-09-21にvja-mock-check.jsへ切り出した。

// 正規表現の特殊文字をエスケープする。
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// text（YAML定義本文＋追加指示）中に、ウィジェット名が単語境界つきで
// 文字として出現するものだけを機械的に抽出する。LLMに推測させるのではなく、
// 純粋な文字列マッチで「このイベントが触れていそうな対象（ウィジェット/定数等）」を
// 絞り込むための処理。items は { name: string, ... } の配列であれば何でも使える
// （ウィジェット一覧・グローバル定数・フォーム定数のいずれにも共通で使用する）。
// （前後が識別子文字[A-Za-z0-9_$]でないことを境界条件とする。日本語の助詞等は
//   識別子文字ではないため、"txtNameの値" のような埋め込みでも問題なくマッチする）
function _extractMentionedByName(text, items) {
    if (!text) return [];
    return items.filter((it) => {
        if (!it.name) return false;
        const re = new RegExp("(?<![A-Za-z0-9_$])" + escapeRegExp(it.name) + "(?![A-Za-z0-9_$])");
        return re.test(text);
    });
}

// テーブル一覧を、依頼文との関連度で絞り込む。
// - 依頼文にテーブル名そのものが出現するものがあれば、それらを採用。
// - 無ければ、各テーブル自身のカラム名が依頼文中に何件出現するかをスコアリングし、
//   最多スコアのテーブルのみ採用する（意味の重複した別テーブルが紛れ込むのを防ぐ。
//   例: 「id,task_name,priority,due_date,status」という依頼文に対し、
//   tasksテーブル(5件一致)を選び、一部カラムが被るだけのdeadlines(4件一致)等は除外する）。
// - どちらも0件なら絞り込まず全件を返す（絞り込みが原因で必要なテーブルが
//   消えてしまうより、無関係テーブルが混ざる方を安全側とする）。
function narrowTablesByRequest(text, allTables) {
    if (!text || allTables.length === 0) return allTables;
    const byName = _extractMentionedByName(text, allTables);
    if (byName.length > 0) return byName;
    const scored = allTables.map((t) => ({
        t,
        score: _extractMentionedByName(text, t.columns || []).length,
    })).filter((x) => x.score > 0);
    if (scored.length === 0) return allTables;
    const maxScore = Math.max(...scored.map((x) => x.score));
    return scored.filter((x) => x.score === maxScore).map((x) => x.t);
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
//
// narrowContext: true（既定）の場合、YAML本文＋追加指示に名前が出現する
// ウィジェット/定数のみに一覧を絞り込み、ローカルLLMに渡すコンテキストを削減する
// （小型モデルほど無関係な名前に惑わされやすいため）。
// 絞り込みが原因で生成コードが未知のウィジェット名を参照してしまった場合の
// 救済策として、AI自動修正リトライ時にはfalseを渡し、全件のまま再構築する
// （呼び出し側 yamlAiGenerate を参照）。
// ※定数側には「未知の定数キー検出」バリデーションが無いため、絞り込みで必要な
//   定数が漏れても自動検知はできない（マッチ0件時は全件表示にフォールバックする
//   ことで、大外しは防いでいる）。
// domOverride: { yamlCur, addPrompt } を渡すと、$("yaml-ta")/$("ai-prompt-in")を
// 読まずにこの値を使う。runAiGenerate()はAPIリクエスト中に#modal-root（YAMLエディタの
// モーダルもここに含まれる）をローディング表示へ差し替えるため、生成中（AI応答を
// 受け取ったonSuccessコールバック内、自動修正リトライ時のコンテキスト再構築等）に
// このDOM要素を読もうとすると、既に存在しない＝空文字列になってしまう
// （2026-09-21、yamlAiGenerateのリファクタで顕在化したuserPrompt欠落バグの原因）。
// DOM読み取りが安全なタイミング（モーダルがまだ生きている、showLoadingModal呼び出し前）
// で一度だけ読み取り、以降の呼び出しにはdomOverrideとして渡すことでこれを回避する。
function buildGenPromptContext(wid, evName, isAppEvent, isFormEvent, narrowContext = true, domOverride = null) {
    const w = (isAppEvent || isFormEvent) ? null : getWidget(wid);
    const yamlCur = domOverride ? (domOverride.yamlCur || "") : ($("yaml-ta")?.value || "");

    // ── ⓪ 検証（バリデーション）定義の取得 ──
    // 以前はYAML本文の「検証:」行から正規表現で抽出していたが、
    // タイポ防止のため右パネルでの単一選択方式に変更した。
    // YAML自体には書き込まない。vja.validate.run('定義名') はonSuccess時に先頭挿入。
    const validationName = _getValidationOverride(wid, evName) || null;
    const yamlForAi = yamlCur;

    const addPrompt = domOverride ? (domOverride.addPrompt || "") : ($("ai-prompt-in")?.value || "");
    const curForm = getProjectData().forms[getProjectData().curFormIdx];

    const scanText = yamlCur + "\n" + addPrompt;

    // ── ①② ウィジェット一覧の絞り込み ──
    // narrowContext=trueの場合、YAML本文＋追加指示に名前が出現するウィジェットのみに
    // 一覧を絞る（絞り込んだ結果0件＝手がかりが無い場合は絞り込まず全件のままにする）。
    // 現在編集中のウィジェット自身は、本文中で自分の名前を書かないケースが多いため、
    // マッチ結果に関わらず無条件で含める。
    const allWidgetsFull = getProjectData().widgets;
    let widgetsForCtx = allWidgetsFull;
    if (narrowContext) {
        const mentioned = _extractMentionedByName(scanText, allWidgetsFull);
        const mentionedSet = new Set(mentioned.map(ww => ww.name));
        if (w?.name) mentionedSet.add(w.name);
        if (mentionedSet.size > 0) {
            widgetsForCtx = allWidgetsFull.filter(ww => mentionedSet.has(ww.name));
        }
    }
    window.vja?.log?.debug?.(
        "[AI生成] ウィジェット一覧の絞り込み: " + widgetsForCtx.length + "/" + allWidgetsFull.length + "件"
        + (narrowContext ? "" : "（絞り込み無効・全件使用）")
    );

    // ── ① 入力系ウィジェット一覧（フォームの入力パラメータ） ──
    const INPUT_TAGS = ["inputtype", "checkbox", "radiobutton", "listbox", "selectbox"];
    const inputWidgets = widgetsForCtx.filter(ww => INPUT_TAGS.includes(ww.tag.toLowerCase()));
    const inputParamsCtx = inputWidgets.length > 0
        ? inputWidgets.map(ww => {
            const desc = ww.props?.description ? " // " + ww.props.description : "";
            return "  - " + ww.name + " (" + ww.tag + ")" + desc;
        }).join("\n")
        : "  (none)";

    // ── ② 全ウィジェット一覧 ──
    const allWidgetsCtx = widgetsForCtx.map(ww => "  - " + ww.name + " (" + ww.tag + ")").join("\n") || "  (none)";

    // ── ③ 画面一覧 ──
    const formsCtx = getProjectData().forms.map((f, i) => {
        const star = f.id === getProjectData().startFormId ? "★" : "";
        return "  - " + f.cfg.name + (star ? " [初期画面]" : "") + (f.cfg.description ? " // " + f.cfg.description : "");
    }).join("\n");

    // ── ④ 定数（グローバル＋フォーム単位） ──
    // ウィジェットと同様、YAML本文＋追加指示に名前が出現する定数のみに絞り込む
    // （定数自体が0件なら絞り込み判定不要でそのまま「なし」、1件以上ある場合のみ
    //   マッチ判定を行い、マッチ0件＝手がかりが無い場合は絞り込まず全件のままにする）。
    const globalConstsFull = getProjectData().constants;
    const globalConstsForCtx = (narrowContext && globalConstsFull.length > 0)
        ? (() => { const m = _extractMentionedByName(scanText, globalConstsFull); return m.length > 0 ? m : globalConstsFull; })()
        : globalConstsFull;
    const globalConstCtx = globalConstsForCtx.length > 0
        ? globalConstsForCtx.map(c => "  - " + c.name + " = " + c.value).join("\n")
        : "  (none)";
    const formConstsFull = curForm?.constants || [];
    const formConstsForCtx = (narrowContext && formConstsFull.length > 0)
        ? (() => { const m = _extractMentionedByName(scanText, formConstsFull); return m.length > 0 ? m : formConstsFull; })()
        : formConstsFull;
    const formConstCtx = formConstsForCtx.length > 0
        ? formConstsForCtx.map(c => "  - " + c.name + " = " + c.value).join("\n")
        : "  (none)";

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
        const arr = getApiOptState(wid, evName) || [];
        // 保険: 右パネルを一度も開かず生成した場合でも、ロック対象イベントでは
        // 必ずeventカテゴリを有効に含める。
        if (isEventCategoryLocked(evName) && !arr.includes("event")) return [...arr, "event"];
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
    const learnedFixesCtx = buildLearnedFixesCtx(wid, evName);

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

// async function handleXxx() { ... } のラッパーを自動除去
// 3Bモデル等が関数ラッパーを生成してしまう場合の後処理
function _unwrapAiFunctionWrapper(code) {
    return code.replace(
        /^\s*async\s+function\s+\w+\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/,
        (_, inner) => inner.trim()
    );
}

// イベントJS自動生成（yamlAiGenerate）のロジック本体（DOM非依存）。
// 自動テスト用（bridge.tsのtestYamlAiGenerateハンドラ）に、DOM読み書き
// （ボタン活性制御・ステータステキスト・タブ切替・モーダル再描画）と
// 分離してある。1回検証NGなら自動修正リトライを1回だけ行う内部ロジックも
// 含む（元の実装と同一）。データモデル（イベントJS）への書き込み・
// モーダル描画（openFormYaml/openAppEvents/openYaml）の呼び出しは、
// 他の対応済み関数と同様、テスト時の副作用として許容する設計にした。
// domOverride: 呼び出し元（yamlAiGenerate）が、モーダルを破壊するrunAiGenerate()の
// showLoadingModal()呼び出しより前に取得した{yamlCur, addPrompt}。省略時は
// $("yaml-ta")等から直接読む（テストハンドラ等、モーダルの生死を気にしなくてよい
// 呼び出し元向け）。
// 戻り値: { finalCode, validation }（失敗時はnull）。
async function generateEventJs(wid, evName, isAppEvent, isFormEvent, temperatureOverride, domOverride = null) {
    const w = (isAppEvent || isFormEvent) ? null : getWidget(wid);
    const { sysPrompt, userPrompt, validationName } = buildGenPromptContext(wid, evName, isAppEvent, isFormEvent, true, domOverride);

    let result = null;
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        temperatureOverride: temperatureOverride,
        onSuccess: async (clean) => {
            let unwrapped = fixMissingAwaits(stripWidgetValueAccess(_unwrapAiFunctionWrapper(clean)), isAppEvent);
            // 1行べた書き・インデント不揃いを、検証（行番号ベース）の前に整形しておく
            unwrapped = await formatJsCode(unwrapped);

            // ── 生成結果の自動検証（構文チェック・APIホワイトリスト） ──
            // 問題があれば1回だけAIに自動修正を依頼し、それでも解消しない場合は
            // 警告バナーで人間に判断を委ねる（生成自体は止めない）。
            // ※temperatureの自動引き上げは行わない（通常のtemperature設定を
            //   そのまま使う）。ランダム性を上げて試したい場合は、エディタの
            //   「🎲 ランダム性を上げて再生成」ボタンを使う。
            let validation = validateGeneratedJs(unwrapped, isAppEvent, evName, w?.tag, wid);
            if (_isAutoMockCheckEnabled(wid, evName)) {
                validation = await augmentWithMockCheck(validation, unwrapped, isAppEvent, evName, w?.tag, wid);
                if (validation.code) unwrapped = validation.code;
            }
            if (!validation.ok) {
                const issueLog = formatValidationIssuesForLog(validation);
                window.vja?.log?.debug?.("[AI検証] 自動修正リトライを実行します。検出内容: " + issueLog);
                // 自動修正リトライ時は、ウィジェット一覧の絞り込みを解除した
                // userPromptを使う（絞り込みが原因で未知のウィジェット名を
                // 参照してしまった可能性の救済策。narrowContext=falseで再構築）。
                const wideCtx = buildGenPromptContext(wid, evName, isAppEvent, isFormEvent, false, domOverride);
                const fixUserPrompt = buildAiFixPrompt(wideCtx.userPrompt, unwrapped, validation);
                let retryCode = null;
                await runAiGenerate({
                    systemPrompt: sysPrompt,
                    userPrompt: fixUserPrompt,
                    loadingMsg: "検出した問題を自動修正中…",
                    temperatureOverride: temperatureOverride,
                    onSuccess: async (fixed) => {
                        retryCode = await formatJsCode(fixMissingAwaits(stripWidgetValueAccess(_unwrapAiFunctionWrapper(fixed)), isAppEvent));
                    },
                    onCancel: async () => { },
                    onError: async () => { },
                });
                if (retryCode) {
                    unwrapped = retryCode;
                    validation = validateGeneratedJs(unwrapped, isAppEvent, evName, w?.tag, wid);
                    if (_isAutoMockCheckEnabled(wid, evName)) {
                        validation = await augmentWithMockCheck(validation, unwrapped, isAppEvent, evName, w?.tag, wid);
                        if (validation.code) unwrapped = validation.code;
                    }
                    window.vja?.log?.debug?.(validation.ok
                        ? "[AI検証] 自動修正リトライで解消しました。"
                        : "[AI検証] 自動修正リトライ後も未解消: " + formatValidationIssuesForLog(validation));
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
                const f = getProjectData().forms[getProjectData().curFormIdx];
                if (!f.events) f.events = {};
                f.events["_js_" + evName] = finalCode;
                openFormYaml(evName);
            } else if (isAppEvent) {
                if (!getProjectData().projectInfo.appEvents) getProjectData().projectInfo.appEvents = {};
                getProjectData().projectInfo.appEvents[evName] = finalCode;
                openAppEvents(evName);
            } else {
                const w2 = getWidget(wid);
                if (!w2) return;
                if (!w2.jsCode) w2.jsCode = {};
                w2.jsCode[evName] = finalCode;
                openYaml(wid, evName);
            }
            if (!validation.ok) {
                trackLearnedFixRecurrence(wid, evName, formatValidationIssuesForLog(validation));
            }
            result = { ok: true, finalCode, validation };
        },
        onCancel: async () => { result = { ok: false, reason: "cancel" }; },
        onError: async () => { result = { ok: false, reason: "error" }; },
    });
    return result;
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

    // YAML本文が空のままAI生成を実行すると、依頼内容が丸ごとAIに渡らず
    // （ENG_YAML_TO_JS_USER_PROMPTは"[The Following YAML]"ブロック自体を省略する）、
    // 文脈の無い最小限のコードしか生成されない事故につながる。生成前に必ず検知して止める。
    const yamlTaEl = $("yaml-ta");
    if (!yamlTaEl?.value?.trim()) {
        showToast("YAML本文が空です。先に📋YAMLタブに内容を入力してください", 5000);
        return;
    }
    // この後のrunAiGenerate()（内部でshowLoadingModal()を呼び#modal-rootを
    // ローディング表示へ差し替える＝YAMLエディタのDOMがここで消える）より前に、
    // 必要なDOM値を確保しておく（詳細はgenerateEventJs()のAIメモ参照）。
    const domOverride = { yamlCur: yamlTaEl.value, addPrompt: $("ai-prompt-in")?.value || "" };

    const btn = $("ai-gen-btn");
    const randomBtn = $("ai-gen-random-btn");
    const status = $("ai-status");
    const aiStartTime = Date.now(); // AI実行開始時刻を記録

    // AI生成操作の前に現在のエディタ内容（依頼・YAML・JS）を即時保存
    await saveYamlData(wid, evName);

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
    if (btn) btn.disabled = true;
    if (randomBtn) randomBtn.disabled = true;
    if (status) status.textContent = "⏳ コンテキスト収集中…";
    showLoadingModal("AI生成中…");

    const result = await generateEventJs(wid, evName, isAppEvent, isFormEvent, temperatureOverride, domOverride);
    if (result?.ok) {
        const { finalCode, validation } = result;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const jsTa = $("js-ta");
            if (jsTa) jsTa.value = finalCode;
            if (typeof saveYamlData === "function") saveYamlData(wid, evName);
            yamlTabSwitch("js");
            jsHlUpdate();
            editorUpdateGutter("js-ta", "js-gutter");
            if (status) status.textContent = "✅ 生成完了 (JavaScriptタブを確認)";
            const elapsed = Math.round((Date.now() - aiStartTime) / 1000);
            showToast("✅ AI生成完了（" + elapsed + "秒）", 5000);
            if (!validation.ok) {
                showAiValidationWarningBanner(validation, wid, evName, isAppEvent, isFormEvent);
            }
        }));
    } else if (status) {
        status.textContent = result?.reason === "error" ? "❌ 生成エラー" : "";
    }
    if (btn) btn.disabled = false;
    if (randomBtn) randomBtn.disabled = false;
}

/* ═══════════════════════════════════════════
  AIによる画面デザイン自動生成
  「説明/入力項目/参照テーブル」を書いた依頼テキストをAIに渡し、
  ウィジェット構成JSON配列を生成→applyAiFormDesign()で現在フォームへ反映する。
═══════════════════════════════════════════ */
function insertFormDesignTemplate(id) {
    const ta = $("ta-fd");
    if (!ta) return;
    const template = getFormDesignTemplateYaml(id);
    if (template) {
        ta.value = template;
        hlUpdate("ta-fd", "hl-fd", yamlTokenize);
        editorUpdateGutter("ta-fd", "gutter-fd");

        // テンプレートの配置構造は、YAML本文（フォームレイアウト:）ではなく
        // "🖼 レイアウト"タブの選択状態（getProjectData().formLayoutPattern）に反映する。
        const layoutId = typeof getFormDesignTemplateLayoutPatternId === "function" ? getFormDesignTemplateLayoutPatternId(id) : "";
        getProjectData().formLayoutPattern = getFormLayoutPatternById(layoutId) ? layoutId : "";
        const layoutPane = $("pane-fd-layout");
        if (layoutPane) layoutPane.innerHTML = buildFormLayoutPickerHtml();

        showToast("テンプレートを反映しました");
    }
}

function openFormDesignTemplateModal() {
    const templates = typeof FORM_DESIGN_TEMPLATES !== "undefined" ? FORM_DESIGN_TEMPLATES : [];
    const itemsHtml = templates.map((t, idx) => {
        const descMatch = (t.yaml || "").match(/説明:\s*(.+)/);
        return render("ye-tpl-fd-item", {
            id: t.id,
            checked: idx === 0 ? "checked" : "",
            label: t.label,
            desc: descMatch ? descMatch[1].trim() : "",
        });
    }).join("");

    showModal(
        render("ye-tpl-fd-select-modal", {
            header: mhdrHTML("📋 画面デザインテンプレート選択", "modal-layer-1"),
            itemsHtml,
            attrCancel: evtAttr("onclick", 'closeModal("modal-layer-1")'),
            attrConfirm: evtAttr("onclick", "confirmApplyFormDesignTemplate()"),
        }),
        "",
        "modal-layer-1"
    );
}

async function confirmApplyFormDesignTemplate() {
    const checkedRadio = document.querySelector("input[name='fd-tmpl-radio']:checked");
    const id = checkedRadio ? checkedRadio.value : "search";
    closeModal("modal-layer-1");

    const ta = $("ta-fd");
    if (ta) {
        const curVal = ta.value?.trim() || "";
        // 元のYAML定義が存在する場合、確認ダイアログを出す
        if (curVal.length > 0) {
            const ok = await vja.app.showConfirm(
                "現在の依頼テキストが存在します。\n" +
                "選択したテンプレートで置き換えますか？\n" +
                "（編集中のテキストは上書きされます）"
            );
            if (!ok) return;
        }
        insertFormDesignTemplate(id);
    }
}

// イベントYAMLドラフト生成AIへは、出力キー名を英語表記（description/tables/
// validation/actions/on_success/on_error）で指示している（日本語キー名だと
// 一部ローカルLLM＋llama-server環境で応答パースエラー(peg-native format)が
// 発生する事象が確認されたため）。ここでその英語キーを、VJAイベントYAMLの
// 正式仕様である日本語キー（説明/利用テーブル/入力チェック/アクション/
// 正常終了/エラー終了）へ変換する。日本語キーは「利用テーブル」連動機能
// （vja-yaml-editor.js内の正規表現抽出）やYAML→JS生成AIのプロンプトが
// 前提としているため、変換せず英語キーのまま使うと他機能が壊れる。
const _TEXT_TO_YAML_EN_TO_JP_KEYS = [
    ["description", "説明"],
    ["tables", "利用テーブル"],
    ["validation", "入力チェック"],
    ["actions", "アクション"],
    ["on_success", "正常終了"],
    ["on_error", "エラー終了"],
];
function _convertTextToYamlEngKeysToJp(yamlText) {
    let result = yamlText;
    _TEXT_TO_YAML_EN_TO_JP_KEYS.forEach(([en, jp]) => {
        result = result.replace(new RegExp("^([ \\t]*)" + en + "[ \\t]*:", "gm"), "$1" + jp + ":");
    });
    return result;
}

// イベントYAMLドラフト自動生成（Text to YAML）のロジック本体（DOM非依存）。
// 自動テスト用（bridge.tsのtestTextToYamlGenerateハンドラ）に、DOM読み書きと
// 分離してある。プロンプト生成→AI呼び出し→マークダウン除去・キー変換→
// データモデル（イベントYAML/依頼文）への書き込みまでを行う（モーダル描画である
// openFormYaml/openAppEvents/openYamlの呼び出しは、wizardDecomposeForms()等の
// 既存の自動テスト対応関数と同様、テスト時の副作用として許容する）。
// domOverride: 呼び出し元（textToYamlGenerate）が、モーダルを破壊するrunAiGenerate()の
// showLoadingModal()呼び出しより前に取得した{yamlCur, addPrompt}（詳細はgenerateEventJs()の
// AIメモ参照）。省略時は$("yaml-ta")等から直接読む。
// 戻り値: 生成されたYAML文字列（失敗時はnull）。
async function generateTextToYaml(wid, evName, inputText, domOverride = null) {
    const isAppEvent = (wid === "appev");
    const isFormEvent = (wid === "form");
    // YAMLドラフト生成時は依頼文にウィジェット名が出てこないケースが多いため、
    // 絞り込みを行わず常にフォーム全体のウィジェット一覧をAIへ渡す
    const { allWidgetsCtx, tablesCtx } = buildGenPromptContext(wid, evName, isAppEvent, isFormEvent, false, domOverride);

    const sysPrompt = _PROMPT_DEF.TEXT_TO_YAML_SYS_PROMPT({ widgetsCtx: allWidgetsCtx, tablesCtx: tablesCtx });
    const userPrompt = _PROMPT_DEF.TEXT_TO_YAML_USER_PROMPT(inputText);

    let result = null;
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        loadingMsg: "YAMLドラフト作成中…",
        onSuccess: async (cleanYaml) => {
            // マークダウンコードブロック (```yaml) を除去
            const stripped0 = cleanYaml.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
            // AIへの出力キー指示は英語表記（description/tables等）にしているため
            // （日本語キーだと一部ローカルLLM＋サーバー環境で応答パースエラーが
            // 発生する事象への対策）、実際のVJAイベントYAML仕様（日本語キー）へ変換する
            const stripped = _convertTextToYamlEngKeysToJp(stripped0);

            // モーダルを再表示する前にデータモデルに新YAMLと依頼テキストを書き込み
            if (isFormEvent) {
                const f = getProjectData().forms[getProjectData().curFormIdx];
                if (!f.events) f.events = {};
                f.events[evName] = stripped;
                f.events["_doc_" + evName] = inputText;
                openFormYaml(evName);
            } else if (isAppEvent) {
                if (!getProjectData().projectInfo.appEvents) getProjectData().projectInfo.appEvents = {};
                getProjectData().projectInfo.appEvents[evName + "_yaml"] = stripped;
                getProjectData().projectInfo.appEvents[evName + "_doc"] = inputText;
                openAppEvents(evName);
            } else {
                const w = getWidget(wid);
                if (w) {
                    if (!w.events) w.events = {};
                    if (!w.docCode) w.docCode = {};
                    w.events[evName] = stripped;
                    w.docCode[evName] = inputText;
                }
                openYaml(wid, evName);
            }
            result = stripped;
        },
        onCancel: async () => {},
        onError: async () => {},
    });
    return result;
}

async function textToYamlGenerate(wid, evName) {
    if (!getProjectData().aiConfig.enabled) {
        if (await vja.app.showConfirm("AI接続設定が有効になっていません。設定画面を開きますか？")) {
            closeModal();
            openAiConfig();
        }
        return;
    }

    const promptTa = $("prompt-ta");
    const aiPromptIn = $("ai-prompt-in");
    const inputText = promptTa?.value?.trim() || aiPromptIn?.value?.trim() || "";
    if (!inputText) {
        showToast("「✨ YAMLドラフト」タブまたはAI指示欄にやりたい内容を入力してください");
        if (promptTa) promptTa.focus();
        else if (aiPromptIn) aiPromptIn.focus();
        return;
    }

    // AI生成操作の前に現在のエディタ内容（依頼・YAML・JS）を即時保存
    await saveYamlData(wid, evName);

    const yamlTaCur = $("yaml-ta");
    if (yamlTaCur && yamlTaCur.value.trim().length > 0) {
        const ok = await vja.app.showConfirm(
            "YAMLエディタに既存の記述があります。\n" +
            "AIが作成するYAMLで上書きしますか？"
        );
        if (!ok) return;
    }

    // この後のrunAiGenerate()（内部でshowLoadingModal()を呼び#modal-rootを
    // ローディング表示へ差し替える＝YAMLエディタのDOMがここで消える）より前に、
    // 必要なDOM値を確保しておく（詳細はgenerateEventJs()のAIメモ参照）。
    const domOverride = { yamlCur: yamlTaCur?.value || "", addPrompt: $("ai-prompt-in")?.value || "" };

    showLoadingModal("YAMLドラフト作成中…");

    const stripped = await generateTextToYaml(wid, evName, inputText, domOverride);
    if (stripped === null) return;

    requestAnimationFrame(() => requestAnimationFrame(() => {
        const newYamlTa = $("yaml-ta");
        if (newYamlTa) {
            newYamlTa.value = stripped;
            yamlHlUpdate();
            editorUpdateGutter("yaml-ta", "yaml-gutter");
        }
        const newPromptTa = $("prompt-ta");
        if (newPromptTa) {
            newPromptTa.value = inputText;
            editorUpdateGutter("prompt-ta", "prompt-gutter");
        }
        if (typeof saveYamlData === "function") saveYamlData(wid, evName);
        yamlTabSwitch("yaml");
        showToast("✨ YAMLドラフトを作成・反映しました（📋 YAMLタブを確認）");
    }));
}

// 画面レイアウトイメージ選択タブの中身（箱型ダイアグラムのカード一覧）を生成する。
// 選択結果はYAMLテキストには一切書き込まず、getProjectData().formLayoutPattern
// （フォームごとにsyncCurForm()/commitFormDesignDraft()と同じ考え方で同期）にのみ保持し、
// formDesignAiGenerate()がAIへ渡す補足プロンプトに追加するためだけに使う。
function buildFormLayoutPickerHtml() {
    const cur = getProjectData().formLayoutPattern || "";
    // 「指定なし」カード（一番左）: idは空文字。選択するとAIへの補足指示は付与しない。
    const noneCard = render("ye-tpl-layout-card", {
        active: cur === "" ? "active" : "",
        id: "",
        borderColor: cur === "" ? "var(--accent)" : "var(--border)",
        attr: evtAttr("onmousedown", "selectFormLayoutPattern('')"),
        inner: `<div style="width:100%;height:143px;display:flex;align-items:center;justify-content:center;background:#22222e;border-radius:4px;color:var(--text3);font-size:14px">指定なし</div>`,
        label: "指定なし",
    });
    const cards = noneCard + getFormLayoutPatterns().map((p) => {
        const active = p.id === cur;
        return render("ye-tpl-layout-card", {
            active: active ? "active" : "",
            id: p.id,
            borderColor: active ? "var(--accent)" : "var(--border)",
            attr: evtAttr("onmousedown", "selectFormLayoutPattern('" + p.id + "')"),
            inner: buildLayoutPatternDiagramSvg(p),
            label: p.label,
        });
    }).join("");
    return render("ye-tpl-layout-picker", { cards });
}

// レイアウトイメージカードのクリック処理（トグル選択）。
// フルHTML再生成はせず、カードのハイライトのみ差し替える軽量処理にしている。
function selectFormLayoutPattern(id) {
    const cur = getProjectData().formLayoutPattern || "";
    getProjectData().formLayoutPattern = cur === id ? "" : id;
    document.querySelectorAll(".form-layout-card").forEach((el) => {
        const isActive = el.dataset.patternId === getProjectData().formLayoutPattern;
        el.classList.toggle("active", isActive);
        el.style.borderColor = isActive ? "var(--accent)" : "var(--border)";
    });
}

function openFormDesignAi() {
    // 複数選択中にAI設計ボタンを操作した場合は選択を解除する
    if (getDesignerState().selIds.length > 1) deselect();
    if (!getProjectData().aiConfig.enabled) {
        vja.app.showConfirm("AI接続設定が有効になっていません。設定画面を開きますか？").then((yes) => {
            if (yes) openAiConfig();
        });
        return;
    }
    const template = getProjectData().formDesignDraft || "";
    const docTemplate = getProjectData().formDesignDocDraft || "";

    const tabConfig = {
        tabs: [
            { id: "fd", label: "📋 YAML", type: "yaml", val: template, ph: _PROMPT_DEF.DEFAULT_FORM_DESIGN_YAML },
            { id: "fd-doc", label: "✨ YAMLドラフト", type: "doc", val: docTemplate, ph: "✨ 作成したい画面デザインの要望を日本語で自由に記述できます（複数行可）\n\n例:\n1. ユーザー情報登録フォーム\n2. 氏名、メールアドレス、部署（セレクトボックス）の入力項目\n3. 保存ボタンとクリアボタンを配置する" },
            { id: "fd-layout", label: "🖼 レイアウト", type: "layout" },
        ],
        aiBar: render("ye-tpl-formdesign-ai-bar", {
            attrYaml: evtAttr("onmousedown", "formDesignTextToYamlGenerate()"),
            attrGen: evtAttr("onmousedown", "formDesignAiGenerate()"),
        }),
        saveAction: "saveFormDesignDraft()",
        rightPanel: "formDesign",
    };
    showModal(buildYamlEditorHTML("", "", false, mhdrHTML("🤖 AIでフォーム設計"), "", tabConfig));
    requestAnimationFrame(() => {
        applyEditorConfig();
        hlUpdate("ta-fd", "hl-fd", yamlTokenize);
        editorUpdateGutter("ta-fd", "gutter-fd");
        editorUpdateGutter("ta-fd-doc", "gutter-fd-doc");

        const taYaml = $("ta-fd");
        if (taYaml) {
            taYaml.addEventListener("keydown", editorKeyHandler);
            taYaml.addEventListener("mousedown", editorMouseDownHandler2);
            taYaml.addEventListener("dblclick", editorDblClickHandler);
            taYaml.addEventListener("input", () => { hlUpdate("ta-fd", "hl-fd", yamlTokenize); editorUpdateGutter("ta-fd", "gutter-fd"); });
            taYaml.addEventListener("scroll", () => hlSync("ta-fd", "hl-fd"));
            editorUndoInit("ta-fd", FORMDESIGN_EDITOR.taUndo, taYaml.value);
        }

        const taDoc = $("ta-fd-doc");
        if (taDoc) {
            taDoc.addEventListener("keydown", editorKeyHandler);
            taDoc.addEventListener("mousedown", editorMouseDownHandler2);
            taDoc.addEventListener("dblclick", editorDblClickHandler);
            taDoc.addEventListener("input", () => editorUpdateGutter("ta-fd-doc", "gutter-fd-doc"));
            taDoc.addEventListener("scroll", () => editorSyncGutter("ta-fd-doc", "gutter-fd-doc"));
            if (!FORMDESIGN_EDITOR.docUndo) FORMDESIGN_EDITOR.docUndo = {};
            editorUndoInit("ta-fd-doc", FORMDESIGN_EDITOR.docUndo, taDoc.value);
        }

        rAfBind("#tab-fd", "click", () => yamlTabSwitch("fd"));
        rAfBind("#tab-fd-doc", "click", () => yamlTabSwitch("fd-doc"));
        rAfBind("#tab-fd-layout", "click", () => yamlTabSwitch("fd-layout"));
        yamlInitResize();
        yamlInitRpanelEvents();
        // 開いた直後から入力できるよう、最初にアクティブな📋YAMLタブへフォーカスする。
        // requestAnimationFrame直後だとWebViewがまだ描画/レイアウトを完了しておらず
        // focus()が効かないことがあるため、setTimeoutで1ティック遅らせて実行する
        setTimeout(() => taYaml?.focus(), 0);
    });
}

// 自然言語から画面デザインYAMLを生成する関数
// 画面デザインYAMLドラフト生成AIへも、イベントYAMLドラフト生成と同様の理由
// （一部ローカルLLM＋llama-server環境での応答パースエラー対策）で、出力キー名を
// 英語表記（description/layout/fields/tables/actions、layout配下のcolumns/
// label_position/button_position）で指示している。ここでVJA画面デザインYAML
// の正式仕様である日本語キー（説明/フォームレイアウト/カラム数/ラベル位置/
// ボタン位置/入力項目/参照テーブル/アクション項目）へ変換する。日本語キーは
// 「説明:」「参照テーブル:」の正規表現抽出（parseFormDesignYaml）が前提と
// しているため、変換せず英語キーのまま使うと他機能が壊れる。
const _FORM_DESIGN_EN_TO_JP_KEYS = [
    ["description", "説明"],
    ["layout", "フォームレイアウト"],
    ["columns", "カラム数"],
    ["label_position", "ラベル位置"],
    ["button_position", "ボタン位置"],
    ["fields", "入力項目"],
    ["tables", "参照テーブル"],
    ["actions", "アクション項目"],
];
const _FORM_DESIGN_EN_TO_JP_VALUES = [
    ["bottom_right", "右下"],
    ["top_right", "右"],
    ["bottom_center", "下部中央"],
    ["left", "左"],
    ["top", "上"],
];
function convertFormDesignEngKeysToJp(yamlText) {
    let result = yamlText;
    _FORM_DESIGN_EN_TO_JP_KEYS.forEach(([en, jp]) => {
        // 行頭の空白の後に「- 」（リスト形式のハイフン）が付く場合も、キー名として一致させる.
        result = result.replace(new RegExp("^([ \\t]*(?:- )?)" + en + "[ \\t]*:", "gm"), "$1" + jp + ":");
    });
    _FORM_DESIGN_EN_TO_JP_VALUES.forEach(([en, jp]) => {
        result = result.replace(new RegExp(":([ \\t]*)" + en + "([ \\t]*(?:#.*)?)$", "gm"), ":$1" + jp + "$2");
    });
    return result;
}

// 画面デザインYAMLドラフト生成（Text to YAML）のロジック本体（DOM非依存）。
// 自動テスト用（bridge.tsのtestFormDesignTextToYamlGenerateハンドラ）に、
// DOM読み書きと分離してあるほか、ウィザード版wizardGenerateFormYaml()
// （vja-wizard.js）ともロジックを共通化している（元々ほぼ同一の実装が
// 2箇所に重複していたため、2026-09-21にこちらへ統合した）。
// 戻り値: { yaml, layoutPatternId }（失敗時はnull）。
async function generateFormDesignYaml(inputText, allTables) {
    // プロジェクトのDBテーブル情報からコンテキスト生成
    // （イベントJS生成時と同様、依頼文中に名前・カラム名が出現するテーブルのみに
    //   絞り込む。意味の重複した無関係テーブルまで渡すのを避けるための予防措置。
    //   ※2026-08-10の実測では、fields空/不足の主因はテーブル数ではなく別要因
    //   （既存ウィジェットとの重複回避ルール、下記参照）と判明したが、
    //   無関係テーブルを渡さない方が安全なので絞り込み自体は残す）
    const targetTablesForCtx = narrowTablesByRequest(inputText, allTables || []);
    const tablesCtx = buildTablesCtxText(targetTablesForCtx);

    const sysPrompt = _PROMPT_DEF.FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT({ tablesCtx: tablesCtx });
    const userPrompt = _PROMPT_DEF.FORM_DESIGN_TEXT_TO_YAML_USER_PROMPT(inputText);

    let result = null;
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        loadingMsg: "画面YAMLドラフト作成中…",
        onSuccess: async (cleanYaml) => {
            const stripped0 = cleanYaml.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
            const stripped1 = convertFormDesignEngKeysToJp(stripped0);

            // "layout_pattern: <番号>" 行は、YAML本文には残さず抽出のみ行い、
            // "🖼 レイアウト"タブの選択状態（getProjectData().formLayoutPattern）に反映する。
            // ID文字列(camelCase)をそのまま選ばせるとローカルLLMが複数のIDを
            // 混ぜ合わせた実在しない文字列を生成することがあったため、番号(1始まり、
            // 該当なしは0)で選ばせ、ここでgetFormLayoutPatterns()の並び順に対応させる。
            // ここで初めて出現するキーであり、convertFormDesignEngKeysToJp()の対象キー
            // （description/layout/columns等）には含まれないため、別途正規表現で処理する。
            const layoutNumMatch = stripped1.match(/^\s*layout_pattern\s*:\s*"?(\d+)"?\s*$/m);
            const layoutNum = layoutNumMatch ? parseInt(layoutNumMatch[1], 10) : 0;
            const layoutPatternList = getFormLayoutPatterns();
            const matchedPattern = layoutNum >= 1 && layoutNum <= layoutPatternList.length ? layoutPatternList[layoutNum - 1] : null;
            let yaml = stripped1.replace(/^\s*layout_pattern\s*:.*\n?/m, "").trim();

            // 「参照テーブル:」欠落の機械的補完（詳細はderiveMissingFormDesignTables()のAIメモ参照）
            const derivedTables = deriveMissingFormDesignTables(yaml, allTables || []);
            if (derivedTables.length > 0) {
                yaml += "\n参照テーブル:\n" + derivedTables.map((n) => "  - " + n).join("\n");
            }

            result = { yaml, layoutPatternId: matchedPattern ? matchedPattern.id : "" };
        },
        onCancel: async () => { },
        onError: async () => { },
    });
    return result;
}

async function formDesignTextToYamlGenerate() {
    if (!getProjectData().aiConfig.enabled) {
        if (await vja.app.showConfirm("AI接続設定が有効になっていません。設定画面を開きますか？")) {
            closeModal();
            openAiConfig();
        }
        return;
    }

    const docEl = $("ta-fd-doc");
    const promptInEl = $("fd-prompt-in");
    const inputText = docEl?.value?.trim() || promptInEl?.value?.trim() || "";
    if (!inputText) {
        showToast("「✨ YAMLドラフト」タブまたはAI指示欄にやりたい画面の概要を入力してください");
        if (docEl) docEl.focus();
        else if (promptInEl) promptInEl.focus();
        return;
    }

    // AI実行前に現在のドラフト（YAML・依頼）を保存
    getProjectData().formDesignDraft = $("ta-fd")?.value || "";
    getProjectData().formDesignDocDraft = docEl?.value || "";

    const curYaml = $("ta-fd")?.value || "";
    if (curYaml.trim().length > 0) {
        const ok = await vja.app.showConfirm(
            "画面デザインYAMLエディタに既存の記述があります。\n" +
            "AIが作成するYAMLで上書きしますか？"
        );
        if (!ok) return;
    }

    showLoadingModal("画面YAMLドラフト作成中…");

    const genResult = await generateFormDesignYaml(inputText, getProjectData().tables || []);
    if (!genResult) return;
    const { yaml: stripped } = genResult;

    getProjectData().formLayoutPattern = genResult.layoutPatternId || "";
    getProjectData().formDesignDraft = stripped;
    getProjectData().formDesignDocDraft = inputText;

    openFormDesignAi();

    requestAnimationFrame(() => requestAnimationFrame(() => {
        const taFd = $("ta-fd");
        if (taFd) {
            taFd.value = stripped;
            hlUpdate("ta-fd", "hl-fd", yamlTokenize);
            editorUpdateGutter("ta-fd", "gutter-fd");
        }
        const taDoc = $("ta-fd-doc");
        if (taDoc) {
            taDoc.value = inputText;
            editorUpdateGutter("ta-fd-doc", "gutter-fd-doc");
        }
        yamlTabSwitch("fd");
        showToast("✨ 画面デザインYAMLを作成しました（📋 YAMLタブを確認）");
    }));
}

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

// 依頼テキストの下書きを保存して閉じる（既存の拡張ランタイム設定と同じ「保存」の考え方）
function saveFormDesignDraft() {
    if ($("ta-fd")) getProjectData().formDesignDraft = $("ta-fd").value;
    if ($("ta-fd-doc")) getProjectData().formDesignDocDraft = $("ta-fd-doc").value;
    closeModal();
}

// 「説明:」「入力項目:」「参照テーブル:」の3セクションを正規表現で抽出する
// （このプロジェクトはYAMLを厳密パースせず、既存の「利用テーブル:」抽出と同じ
//  軽量な正規表現方式に統一している）
function parseFormDesignYaml(text) {
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

// 「入力項目:」の各フィールド名がテーブルの列名(name/labelJa)と一致する場合、
// 「参照テーブル:」が完全に欠落していても機械的に補完する。
// Why: ENG_FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPTには「fieldsがテーブル由来なら
// tablesに含めるのは必須」という明記とFew-Shot例が既にあるが、依頼文がボタン動作の
// 説明中心（例:「〜を入力する。『戻る』ボタンで一覧に戻り、『保存』ボタンで保存する」）
// だと、temperature=0（サンプリングの揺らぎを排除した状態）でも100%再現する形で
// 「参照テーブル:」セクション自体が丸ごと欠落する不具合が2026-09-20の実LLM検証
// (qwen2.5-coder-7b)で確認された。プロンプト文言の強化だけに頼ると際限ない
// もぐら叩きになるため（CLAUDE.md「プロンプト文言だけでは再発する」参照）、
// _fixArithmeticInFormDesignJson()と同じ方針でコード側の機械的な安全網を追加する。
// 戻り値: 補完すべきテーブル名の配列（既に「参照テーブル:」が1件でもあれば空配列＝何もしない）。
// 他ファイル（vja-wizard.js）からも呼び出すため、CLAUDE.mdの規約に従い`_`無しの名前で
// グローバル展開する（`_`始まりはファイル内限定の意味のため）。
function deriveMissingFormDesignTables(yamlText, allTables) {
    const { tables: existingTables } = parseFormDesignYaml(yamlText);
    if (existingTables.length > 0) return [];
    const fieldsM = yamlText.match(/入力項目\s*:\s*\n([\s\S]*?)(?:\n\S|\n\n|$)/);
    if (!fieldsM) return [];
    const fieldLabels = [];
    fieldsM[1].split("\n").forEach((l) => {
        const m = l.match(/^\s*-\s*([^:]+):/);
        if (m) fieldLabels.push(m[1].trim());
    });
    if (fieldLabels.length === 0) return [];
    // 単純な「1列でも一致したら候補」だと、sales_data/sales_historyのように
    // 列名が重なる複数テーブルが同時にヒットしてしまう（実際に2026-09-20の
    // 検証で確認）。fields全件を包含し、かつ余分な列が最も少ない（＝形が
    // 最も近い）テーブルを優先することで、この誤爆を減らす。
    const scored = (allTables || []).map((t) => {
        const cols = t.columns || [];
        const matchedCount = fieldLabels.filter((label) => cols.some((c) => c.name === label || c.labelJa === label)).length;
        return { name: t.name, matchedCount, extraCount: cols.length - matchedCount };
    }).filter((s) => s.matchedCount === fieldLabels.length); // fields全件をカバーするテーブルのみ候補にする
    if (scored.length === 0) return [];
    const minExtra = Math.min(...scored.map((s) => s.extraCount));
    return scored.filter((s) => s.extraCount === minExtra).map((s) => s.name);
}

// AI（フォームデザイン）出力のx/y/w/hに、計算式（例: "x": 768 - 20 - 85）が
// そのまま出力されてしまうケースを機械的に是正する。ENG_FORM_DESIGN_SYS_PROMPT側で
// 「計算結果の整数のみ出力せよ、式を書くな」と複数箇所で明記しているにもかかわらず、
// ローカルLLMが右寄せボタン等のx計算で式をそのままJSONに書いてしまう事例が
// 2026-09-08に一度確認・修正済み（Few-Shot強化）だったが、2026-09-13に別の
// ローカルLLM（deepseek-coder-v2）で同種の再発が確認された。プロンプト文言の
// 強化だけに頼ると際限なく「もぐら叩き」になるため、ここでコード側の機械的な
// 安全網を追加する: x/y/w/hの値部分が単純な数値でない場合、数字・空白・
// 四則演算子・丸カッコのみで構成されているか検証した上で（英字や記号が
// 混ざる文字列値等を誤って評価しないための安全策）計算し、結果の整数に
// 置き換えてからJSON.parseする。
function _fixArithmeticInFormDesignJson(text) {
    return String(text || "").replace(/("(?:x|y|w|h)"\s*:\s*)([^,}\]]+)/g, (whole, prefix, valuePart) => {
        const trimmed = valuePart.trim();
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) return whole; // 既にプレーンな数値ならそのまま
        if (!/^[\d\s+\-*/().]+$/.test(trimmed)) return whole; // 数式以外の文字が混ざる値（文字列等）はそのまま
        try {
            const computed = Function("\"use strict\"; return (" + trimmed + ")")();
            if (typeof computed === "number" && Number.isFinite(computed)) {
                return prefix + Math.round(computed);
            }
        } catch (e) { /* 評価失敗時は元の文字列のまま返し、後続のJSON.parseで通常通り失敗させる */ }
        return whole;
    });
}

// AI（フォームデザイン）出力テキストを配列としてパースする。
// 1. まずそのままJSON.parseを試みる
// 2. 失敗した場合、AIが前後に説明文を付けてしまうケースを救うため、
//    最初の "[" ～ 最後の "]" を抜き出して再度パースを試みる
// どちらの試行でも、_fixArithmeticInFormDesignJson()で計算式を先に整数へ
// 是正してからパースする。成功時はウィジェット配列を、失敗時
// （配列でない場合含む）はnullを返す。
function parseFormDesignJson(text) {
    const tryParse = (s) => {
        try {
            const v = JSON.parse(_fixArithmeticInFormDesignJson(s));
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
        render("ye-tpl-ai-raw-output", { rawText }) +
        mfootHTML([{ label: "閉じる", action: "closeModal()" }])
    );
}

// 画面レイアウト生成（YAML→ウィジェット配置JSON）のAI呼び出し部分のみを
// 切り出した共有ロジック（DOM非依存）。formDesignAiGenerate()（UI手動操作版）
// とwizardGenerateFormLayout()（ウィザード版、vja-wizard.js）で共通利用する
// （元々ほぼ同一の実装が2箇所に重複していたため、2026-09-21にこちらへ統合した）。
// 戻り値: AI生成結果の生テキスト（失敗/キャンセル時はnull）。パース
// （parseFormDesignJson）は呼び出し側の責務とする（呼び出し元ごとに
// パース失敗時の扱い＝UI表示の有無が異なるため）。
async function generateFormLayoutRaw(designText, extraPrompt, allTables) {
    const { tables } = parseFormDesignYaml(designText);
    const targetTables = (allTables || []).filter((t) => tables.includes(t.name));
    const tablesCtx = buildTablesCtxText(targetTables);
    const sysPrompt = _PROMPT_DEF.FORM_DESIGN_SYS_PROMPT({
        formW: getProjectData().formCfg.w,
        formH: getProjectData().formCfg.h,
        tablesCtx,
    });
    const userPrompt = _PROMPT_DEF.FORM_DESIGN_USER_PROMPT(designText, extraPrompt);

    let result = null;
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        loadingMsg: "画面デザインを生成中…",
        onSuccess: async (generated) => { result = generated; },
        onCancel: async () => { },
        onError: async () => { },
    });
    return result;
}

// formDesignAiGenerate()（画面デザインAI生成、既存ウィジェットの全削除＋反映）の
// ロジック本体（DOM非依存）。自動テスト用（bridge.tsのtestFormDesignAiGenerateハンドラ）に、
// DOM読み書き（確認ダイアログ・テキストエリア読取・ボタン活性制御・モーダル閉じる）と
// 分離してある。既存ウィジェットの全削除＋pushUndo()＋fullRedraw()という破壊的操作を
// 含むため、呼び出し前に対象フォームの状態が意図通りか十分注意すること。
// 戻り値: { ok: true, widgets } | { ok: false, reason: "parse_failed", raw } | { ok: false, reason: "cancelled_or_error" }
async function generateFormDesignAiLayout(rawText, addPromptExtra) {
    const { desc } = parseFormDesignYaml(rawText);
    const curForm = getProjectData().forms[getProjectData().curFormIdx];

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

    // 選択中のレイアウトイメージがあれば、YAMLテキストには含めず、
    // AIへの補足指示としてのみ追加する（"🖼 レイアウト"タブでの選択）。
    // 2026-09-14: 従来は「配置構造を言葉で説明した1文」を渡すだけで、実際の
    // 反映精度がAIの解釈に左右され「設定しても微妙」という指摘があったため、
    // buildLayoutRegionsPromptText()でpx座標の厳格な配置エリアへ変換して渡すよう変更した。
    const layoutHint = buildLayoutRegionsPromptText(
        getProjectData().formLayoutPattern,
        getProjectData().formCfg.w,
        getProjectData().formCfg.h
    );
    const extraPrompt = (addPromptExtra || "") + layoutHint;

    // AI生成前に依頼テキストを下書き保存
    getProjectData().formDesignDraft = rawText;

    const generated = await generateFormLayoutRaw(designText, extraPrompt, getProjectData().tables || []);
    if (generated === null) return { ok: false, reason: "cancelled_or_error" };

    const items = parseFormDesignJson(generated);
    if (!items) {
        window.vja?.log?.warn?.("[FormDesignAi] JSON parse failed. raw=" + generated.slice(0, 300));
        return { ok: false, reason: "parse_failed", raw: generated };
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
    applyAiFormDesign(items);
    return { ok: true, widgets: getProjectData().widgets };
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
    const addPrompt = $("fd-prompt-in")?.value || "";
    const btn = $("fd-gen-btn");
    if (btn) btn.disabled = true;

    const result = await generateFormDesignAiLayout(rawText, addPrompt);

    if (result.ok) {
        closeModal();
    } else if (result.reason === "parse_failed") {
        showToast("AI出力の解析に失敗しました（JSON形式ではありません）", 5000);
        openAiRawOutputModal(result.raw);
    }
    if (btn) btn.disabled = false;
}

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
    yamlInitRpanelEvents, yamlInitResize, yamlInsert, yamlAiGenerate, generateEventJs,
    buildYamlEditorHTML, initYamlEditorModal, getVjaApiWhitelist,
    openFormDesignAi, insertFormDesignTemplate, openFormDesignTemplateModal, confirmApplyFormDesignTemplate, textToYamlGenerate, generateTextToYaml, formDesignTextToYamlGenerate, formDesignAiGenerate, generateFormLayoutRaw, generateFormDesignAiLayout, saveFormDesignDraft,
    buildFormLayoutPickerHtml, selectFormLayoutPattern,
    parseFormDesignJson, parseFormDesignYaml, convertFormDesignEngKeysToJp, openAiRawOutputModal,
    narrowTablesByRequest, buildTablesCtxText, deriveMissingFormDesignTables, generateFormDesignYaml,
    yamlSetApiOpt,
    yamlSetTableOpt, yamlSetValidationOpt, applyTableYamlSync,
    yamlSetMockCheckOpt,
    formatJsCode,
    // vja-mock-check.js（検証・モック実行エンジン）から呼び出すため、
    // CLAUDE.mdの規約に従い`_`無しの名前でグローバル展開する。
    findMissingAwaits, fixMissingAwaits, findUnknownWidgetNames, getApiOptState, apiOptCategoryOfApiName,
    isEventCategoryLocked, escapeRegExp, buildGenPromptContext,
});
