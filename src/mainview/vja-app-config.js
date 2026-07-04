/* ═══════════════════════════════════════════════════════════════
   vja-app-config.js — フォーム定数・アプリイベント・拡張ランタイム・
                       プロジェクト情報・クラウド設定・フォント設定
   ─────────────────────────────────────────────────────────────
   【読み込み順序】8番目（vja-table-validation.js の直後）。
   【依存】vja-defs.js, vja-designer.js, vja-modal.js, vja-yaml-editor.js,
           vja-table-validation.js（renderRowListModal等）
   【提供するもの】
     - openFormConstEditor() / renderFormConstModal()（フォーム定数）
     - openAppEvents() / saveAppEvent()（OnStart/OnExit）
     - openProjectInfo()（プロジェクト情報モーダル）
     - openExtRuntime()（拡張ランタイムJS）
     - openCloudInfraConfig() / _cloudInfraRow() 系
       （クラウドインフラ設定、5関数に分割済み）
     - openColDefEditor() / openItemsDefEditor()（再掲・項目定義系）
     - openFontConfig()（フォント設定）
   このファイルは vja-defs.js / vja-designer.js / vja-modal.js /
   vja-yaml-editor.js / vja-table-validation.js に依存する。
═══════════════════════════════════════════════════════════════ */

function openFormConstEditor() {
    const f = getProjectData().forms[getProjectData().curFormIdx];
    if (!f) return;
    if (!f.constants) f.constants = [];
    _CONST_MODAL.rows = f.constants.map(c => ({ name: c.name || "", value: c.value || "" }));
    if (_CONST_MODAL.rows.length === 0) _CONST_MODAL.rows.push({ name: "", value: "" });
    renderFormConstModal();
}

function renderFormConstModal() {
    const f = getProjectData().forms[getProjectData().curFormIdx];
    const formTitle = f?.cfg?.title || "フォーム";
    renderConstModalBase(
        "📌 フォーム定数 — " + esc(formTitle),
        "このフォーム（" + esc(formTitle) + "）専用の定数を定義します。グローバル定数と合わせてYAMLから参照できます。",
        "formConstAddRow()",
        "saveFormConst()",
        "renderFormConstModal"
    );
}

function formConstAddRow() {
    if (!_CONST_MODAL.rows) return;
    syncConstFromDOM(); // 現在の入力値を先に保存
    _CONST_MODAL.rows.push({ name: "", value: "" });
    renderFormConstModal();
}

function saveFormConst() {
    const f = getProjectData().forms[getProjectData().curFormIdx];
    if (!f) return;
    _constSaveBase(f);
}


/* ── アプリイベント（OnStart / OnExit） ── */
// APP_EV_TYPES（アプリイベント種類一覧）は init-params.js で window.APP_EV_TYPES として定義済み

function openAppEvents(evKey) {
    evKey = evKey || "onStart";
    _APPEVENT_MODAL.curKey = evKey;
    const ae = getProjectData().projectInfo.appEvents || {};
    const cur = ae[evKey + "_yaml"] || "# アプリイベント: " + evKey + "\n# YAML形式でAIへの指示を記述します\n";
    // OnStart/OnExitはBun側でTypeScriptとして実行される
    const _tsHint = evKey === "onStart"
        ? "// ⚠️ このコードはBun側でTypeScriptとして実行されます\n// vja.db.query() / vja.session.get() 等が使用できます\n\n"
        : "// ⚠️ このコードはBun側でTypeScriptとして実行されます（アプリ終了時）\n// vja.db / vja.session 等が使用できます\n\n";
    const curJs = ae[evKey] || _tsHint;
    const evTabs = APP_EV_TYPES.map(t =>
        "<div class='yaml-tab " + (t.key === evKey ? "active" : "") + "' " +
        "id='appev-tab-" + t.key + "'>" + t.label + "</div>"
    ).join("");
    pvRegister("yamlSave", saveAppEvent);
    pvRegister("yamlAiGen", () => yamlAiGenerate("appev", evKey));
    pvRegister("yamlAiGenRandom", () => yamlAiGenerate("appev", evKey, _getBoostedTemperature()));
    pvRegister("yamlMockCheck", () => manualMockCheck(true, evKey, undefined));
    const appEvHeader =
        "<div class='mhdr' style='flex-shrink:0'>" +
        "<div style='display:flex;align-items:center;gap:0;flex:1'>" +
        "<h4 style='margin:0 12px 0 0'>⚡ アプリイベント</h4>" +
        "<div class='yaml-tab-bar' style='border-bottom:none;flex:1'>" + evTabs + "</div>" +
        "</div>" +
        "<button class='mclose'" + evtAttr("onmousedown", "closeModal()") + ">✕</button>" +
        "</div>";
    showModal(buildYamlEditorHTML(cur, curJs, false, appEvHeader));
    initYamlEditorModal(cur, curJs, () => {
        APP_EV_TYPES.forEach(t => {
            const tabEl = $("appev-tab-" + t.key);
            if (tabEl) tabEl.addEventListener("click", () => openAppEvents(t.key));
        });
    });
}

function saveAppEvent() {
    if (!getProjectData().projectInfo.appEvents) getProjectData().projectInfo.appEvents = {};
    getProjectData().projectInfo.appEvents[_APPEVENT_MODAL.curKey + "_yaml"] = $("yaml-ta")?.value || "";
    getProjectData().projectInfo.appEvents[_APPEVENT_MODAL.curKey] = $("js-ta")?.value || "";
    closeModal();
    pushUndo();
    showToast("アプリイベントを保存しました");
}

function openProjectInfo() {
    showModal(
        mhdrHTML("📁 プロジェクト情報") +
        "<div class='mbody' style='gap:10px'>" +
        "<div class='ai-cfg-row'><label>プロジェクト名</label>" +
        "<input id='pi-name' class='pv-input' style='height:28px;font-size:13px' value='" + esc(getProjectData().projectInfo.name) + "' placeholder='マイプロジェクト'>" +
        "</div>" +
        "<div class='ai-cfg-row'><label>説明</label>" +
        "<textarea id='pi-desc' class='pv-textarea' style='height:60px;font-size:13px'>" + esc(getProjectData().projectInfo.description) + "</textarea>" +
        "</div>" +
        "<div class='ai-cfg-row'><label>バージョン</label>" +
        "<div style='display:flex;align-items:center;gap:4px;flex:1'>" +
        "<input id='pi-ver' class='pv-input' style='height:28px;font-size:13px;flex:1' value='" + esc(getProjectData().projectInfo.version) + "' placeholder='1.0.0'>" +
        "<button" + evtAttr("onmousedown", "piVerStep(1)") + " style='width:24px;height:28px;background:var(--bg3);border:1px solid var(--border);border-radius:2px;color:var(--text);cursor:pointer;font-size:11px;flex-shrink:0'>▲</button>" +
        "<button" + evtAttr("onmousedown", "piVerStep(-1)") + " style='width:24px;height:28px;background:var(--bg3);border:1px solid var(--border);border-radius:2px;color:var(--text);cursor:pointer;font-size:11px;flex-shrink:0'>▼</button>" +
        "</div>" +
        "</div>" +
        "<div class='ai-cfg-row'><label>作成者</label>" +
        "<input id='pi-author' class='pv-input' style='height:28px;font-size:13px' value='" + esc(getProjectData().projectInfo.author) + "' placeholder='作成者名'>" +
        "</div>" +
        "<div class='ai-cfg-row'><label>会社名</label>" +
        "<input id='pi-company' class='pv-input' style='height:28px;font-size:13px' value='" + esc(getProjectData().projectInfo.company) + "' placeholder='会社・組織名'>" +
        "</div>" +
        "</div>" +
        "<div class='mfoot'>" +
        "<button" + evtAttr("onmousedown", "closeModal()") + ">キャンセル</button>" +
        "<button class='pri' id='pi-save-btn'>保存</button>" +
        "</div>"
    );
    rAfBind("#pi-save-btn", "click", saveProjectInfo);
}

function piVerStep(dir) {
    const inp = $("pi-ver");
    if (!inp) return;
    const parts = inp.value.split(".");
    // 最後の数字をdir分増減
    const last = parseInt(parts[parts.length - 1]) || 0;
    const next = Math.max(0, last + dir);
    parts[parts.length - 1] = String(next);
    inp.value = parts.join(".");
}

function saveProjectInfo() {
    getProjectData().projectInfo = {
        name: $("pi-name")?.value || "",
        description: $("pi-desc")?.value || "",
        version: $("pi-ver")?.value || "1.0.0",
        author: $("pi-author")?.value || "",
        company: $("pi-company")?.value || "",
    };
    applyProjectInfo();
    closeModal();
    pushUndo();
    showToast("プロジェクト情報を保存しました");
}

/* ── 拡張ランタイム ── */
// vja ランタイムに追加する JavaScript コードと AI向け説明（YAML）を管理する。
// getProjectData().extRuntime.js  : 実行時に注入されるカスタム JS コード
// getProjectData().extRuntime.doc : AI向けの関数説明（YAML形式）。runAiGenerate で自動生成可能。

// 拡張ランタイムダイアログを開く。
// JavaScript タブと AI向け説明タブの2タブ構成。
function openExtRuntime() {
    const tabConfig = {
        tabs: [
            { id: "extrt-js", label: "📜 JavaScript", type: "js", val: getProjectData().extRuntime.js || "" },
            { id: "extrt-doc", label: "📋 AI向け説明", type: "yaml", val: getProjectData().extRuntime.doc || "" },
        ],
        aiBar: "<button class='yaml-ai-btn'" + evtAttr("onmousedown", "extRtGenDoc()") + ">🤖 AI向け説明を生成</button>",
        saveAction: "saveExtRuntime()",
    };
    showModal(buildYamlEditorHTML("", "", false, mhdrHTML("⚡ 拡張ランタイム"), "", tabConfig));
    requestAnimationFrame(() => {
        applyEditorConfig();
        [
            { id: "ta-extrt-js", hlId: "hl-extrt-js", gutId: "gutter-extrt-js", tokenFn: jsTokenize, state: _EXTRT_EDITOR.jsUndo },
            { id: "ta-extrt-doc", hlId: "hl-extrt-doc", gutId: "gutter-extrt-doc", tokenFn: yamlTokenize, state: _EXTRT_EDITOR.docUndo },
        ].forEach(({ id, hlId, gutId, tokenFn, state }) => {
            const ta = $(id);
            if (!ta) return;
            _hlUpdate(id, hlId, tokenFn);
            editorUpdateGutter(id, gutId);
            ta.addEventListener("keydown", editorKeyHandler);
            ta.addEventListener("mousedown", editorMouseDownHandler2);
            ta.addEventListener("dblclick", editorDblClickHandler);
            ta.addEventListener("input", () => { _hlUpdate(id, hlId, tokenFn); editorUpdateGutter(id, gutId); });
            ta.addEventListener("scroll", () => _hlSync(id, hlId));
            editorUndoInit(id, state, ta.value);
        });
        rAfBind("#tab-extrt-js", "click", () => {
            ["extrt-js", "extrt-doc"].forEach(t => {
                $("tab-" + t)?.classList.toggle("active", t === "extrt-js");
                $("pane-" + t)?.classList.toggle("active", t === "extrt-js");
            });
            editorHlUpdate("ta-extrt-js");
        });
        rAfBind("#tab-extrt-doc", "click", () => {
            ["extrt-js", "extrt-doc"].forEach(t => {
                $("tab-" + t)?.classList.toggle("active", t === "extrt-doc");
                $("pane-" + t)?.classList.toggle("active", t === "extrt-doc");
            });
            editorHlUpdate("ta-extrt-doc");
        });
    });
}

// 拡張ランタイムの内容を getProjectData().extRuntime 変数に保存して Undo に積む。
function saveExtRuntime() {
    getProjectData().extRuntime.js = $("ta-extrt-js")?.value || "";
    getProjectData().extRuntime.doc = $("ta-extrt-doc")?.value || "";
    closeModal();
    showToast("拡張ランタイムを保存しました");
    pushUndo();
}

// 拡張ランタイムの JavaScript コードを元に AI向け説明（YAML）を生成する。
// runAiGenerate を使用し、生成結果を getProjectData().extRuntime.doc にセットして再表示する。
async function extRtGenDoc() {
    if (!getProjectData().aiConfig.enabled) {
        showToast("AI接続設定が有効になっていません");
        return;
    }
    const js = $("ta-extrt-js")?.value || "";
    if (!js.trim()) { showToast("JavaScriptコードを入力してください"); return; }
    const existsDoc = (getProjectData().extRuntime.doc || $("ta-extrt-doc")?.value || "").trim();
    const confirmMsg = existsDoc
        ? "既に内容が登録されています。\n上書きしますか？\n※実行前に現在の内容を保存します。"
        : "AI向け説明を生成しますか？\n※実行前に現在の内容を保存します。";
    if (!(await vja.app.showConfirm(confirmMsg))) return;
    // AI生成前に保存
    saveExtRuntime();
    await runAiGenerate({
        systemPrompt: _PROMPT_DEF.EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT(),
        userPrompt: _PROMPT_DEF.EXT_RUNTIME_JS_TO_YAML_USER_PROMPT(js),
        onSuccess: async (result) => {
            getProjectData().extRuntime.doc = result;
            openExtRuntime();
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const taDock = $("ta-extrt-doc");
                ["extrt-js", "extrt-doc"].forEach(t => {
                    $("tab-" + t)?.classList.toggle("active", t === "extrt-doc");
                    $("pane-" + t)?.classList.toggle("active", t === "extrt-doc");
                });
                const hlDoc = $("hl-extrt-doc");
                if (hlDoc) hlDoc.style.height = "";
                editorHlUpdate("ta-extrt-doc");
            }));
            showToast("AI生成完了");
        },
    });
}

function openDebugTools() {
    closeAllMenus();
    window.bunToggleDevTools?.();
}

function openCloudInfraConfig() {
    closeAllMenus();
    _CLOUD_MODAL.draft = getProjectData().cloudInfras.map(c => JSON.parse(JSON.stringify(c)));
    _renderCloudModal();
}

// クラウドインフラ設定モーダルの内容を再描画する。
// _CLOUD_MODAL.draft（編集中の一時データ）を元に表示を構築する。
function _renderCloudModal() {
    const rows = _CLOUD_MODAL.draft.map((inf, i) => _cloudInfraRow(inf, i)).join("") ||
        "<div style='color:var(--text3);font-size:12px;padding:8px'>登録なし</div>";
    showModal(
        mhdrHTML("☁️ クラウドインフラ設定") +
        "<div class='mbody' style='gap:10px;overflow-y:auto;max-height:60vh'>" +
        "<div class='infobox'>同一クラウドを複数登録した場合、先頭のCredentialが優先されます。</div>" +
        "<div id='cloud-list' style='display:flex;flex-direction:column;gap:8px'>" + rows + "</div>" +
        "<button class='modal-btn' style='margin-top:4px'" + evtAttr("onmousedown", "addCloudInfra()") + ">＋ 追加</button>" +
        "</div>" +
        mfootHTML([
            { label: "保存", cls: "primary", action: "saveCloudInfraConfig()" },
            { label: "キャンセル", action: "closeModal()" },
        ]),
        "modal-cloud"
    );
}

function _cloudSelId(prefix, i) { return prefix + "_" + i; }

// クラウド種別セレクトの選択肢HTML生成
function _cloudOptsHtml(inf, csid, i) {
    return CLOUD_PRESETS.map(p =>
        `<div class="pv-sel-opt ${inf.name === p.name ? "active" : ""}"
                    ${evtAttr("onmousedown", "pvSelPick('" + csid + "','" + esc(p.name) + "',event);selectCloudPreset(" + i + ",'" + esc(p.name) + "')")}>${esc(p.name)}</div>`
    ).join("");
}

// サービスセレクトの選択肢HTML生成
function _cloudSvcOptsHtml(preset, curSvc, ssid, i) {
    return preset.services.map(s =>
        `<div class="pv-sel-opt ${curSvc === s.label ? "active" : ""}"
                    ${evtAttr("onmousedown", "pvSelPick('" + ssid + "','" + esc(s.label) + "',event);selectCloudService(" + i + ",'" + esc(s.label) + "')")}>${esc(s.label)}</div>`
    ).join("");
}

// SDK URL入力欄HTML生成
// service の input:true の場合のみ編集可（カスタム等）。
// baseUrl がある場合は固定prefixとして表示し、続きのみ入力させる。
function _cloudUrlFieldHtml(preset, curSvc, isCustomSvc, inf, i) {
    const curSvcDef = preset.services.find(s => s.label === curSvc);
    const urlEditable = curSvcDef ? curSvcDef.input : isCustomSvc;
    const baseUrl = curSvcDef?.url || "";
    const editVal = urlEditable && baseUrl && inf.sdkUrl?.startsWith(baseUrl)
        ? inf.sdkUrl.slice(baseUrl.length)
        : (urlEditable ? inf.sdkUrl || "" : inf.sdkUrl || "");
    if (!urlEditable) {
        return `<input class="pv-input" style="flex:1;min-width:160px;color:var(--text3)" readonly
                    value="${esc(inf.sdkUrl || "")}" title="サービス選択で自動入力されます">`;
    }
    if (baseUrl) {
        return `<div style="display:flex;align-items:center;flex:1;min-width:160px;background:var(--bg3);border:1px solid var(--border);border-radius:2px;overflow:hidden">
                        <span style="padding:0 4px;font-size:11px;color:var(--text3);white-space:nowrap;border-right:1px solid var(--border)">${esc(baseUrl)}</span>
                        <input class="pv-input" style="flex:1;min-width:80px" placeholder="続きを入力"
                            value="${esc(editVal)}"
                            ${evtAttr("oninput", "updateCloudField(" + i + ",'sdkUrl','" + esc(baseUrl) + "'+this.value)")}>
                       </div>`;
    }
    return `<input class="pv-input" style="flex:1;min-width:160px" placeholder="SDK URL を入力"
                        value="${esc(inf.sdkUrl || "")}"
                        ${evtAttr("oninput", "updateCloudField(" + i + ",'sdkUrl',this.value)")}>`;
}

// クレデンシャル欄HTML生成
// カスタム×カスタムの場合はJSON一括入力欄、それ以外は credDefs の定義に従って
// テキスト入力・パスワード入力・セレクト形式のいずれかを生成する。
function _cloudCredFieldsHtml(inf, credDefs, isCustomCloud, i) {
    if (isCustomCloud) {
        const jsonVal = inf.credentialsJson || JSON.stringify(inf.credentials || {});
        return `<div style="margin-top:6px">
                    <div style="font-size:11px;color:var(--text3);margin-bottom:4px">Credentials (JSON形式: {"key":"value",...})</div>
                    <textarea class="pv-input pv-textarea" style="height:60px;resize:vertical"
                        placeholder='{"accessKeyId":"xxx","secretAccessKey":"yyy"}'
                        ${evtAttr("oninput", "updateCloudCredsJson(" + i + ",this.value)")}>${esc(jsonVal)}</textarea>
                </div>`;
    }
    return credDefs.map((cd, ci) => {
        const k = typeof cd === "string" ? cd : cd.name;
        const isSecret = typeof cd === "object" && cd.secret;
        const appInput = !!(inf.appInput?.[k]);
        const selOpts = typeof cd === "object" && Array.isArray(cd.select) ? cd.select : null;
        const curVal = (inf.credentials && k in inf.credentials) ? inf.credentials[k] : null;
        let inputHtml;
        if (selOpts) {
            const selId = "cloud-cred-sel-" + i + "-" + ci;
            const selDef = selOpts.find(o => o.selected) || selOpts[0];
            // o.value が存在する場合は保存値として使い、o.name は表示名として使う
            const selDefVal = selDef ? (selDef.value ?? selDef.name ?? "") : "";
            // curVal が null（未設定）の場合のみデフォルト値を使う
            const selCur = curVal !== null ? curVal : selDefVal;
            const opts = selOpts.map(o => {
                const optVal = o.value ?? o.name ?? "";
                const optDisp = (o.name !== undefined && o.name !== "") ? o.name : "&nbsp;";
                const pickArg3 = optDisp === "&nbsp;" ? "" : esc(optDisp);
                return `<div class="pv-sel-opt ${(selCur === optVal || selCur === o.name) ? "active" : ""}"
                            ${evtAttr("onmousedown", "pvSelPick('" + selId + "','" + esc(optVal) + "','" + pickArg3 + "',event);updateCloudCred(" + i + ",'" + esc(k) + "','" + esc(optVal) + "')")}>${optDisp === "&nbsp;" ? "&nbsp;" : esc(optDisp)}</div>`;
            }).join("");
            // ボタン表示は現在の保存値に対応する表示名を探す
            const selDispName = (selOpts.find(o => (o.value ?? o.name) === selCur || o.name === selCur) || {}).name ?? selCur;
            inputHtml = `<div class="pv-sel" id="${selId}" style="flex:1">
                        <div class="pv-sel-btn" ${evtAttr("onmousedown", "pvSelOpen('" + selId + "',event)")}>
                            <span>${esc(selDispName)}</span><span class="arr">▼</span>
                        </div>
                        <div class="pv-sel-list">${opts}</div>
                    </div>`;
        } else {
            inputHtml = `<input type="${isSecret ? "password" : "text"}" class="pv-input"
                        style="flex:1;${appInput ? "opacity:0.5" : ""}"
                        placeholder="${appInput ? "（アプリ側で入力）" : esc(k)}"
                        value="${esc(curVal ?? "")}"
                        ${appInput ? "disabled" : ""}
                        ${evtAttr("oninput", "updateCloudCred(" + i + ",'" + esc(k) + "',this.value)")}>`;
        }
        return `<div style="display:flex;align-items:center;gap:6px;margin-top:4px">
                    <span style="width:110px;font-size:11px;color:var(--text3);flex-shrink:0">${esc(k)}${isSecret ? " 🔒" : ""}</span>
                    ${inputHtml}
                    <label style="display:flex;align-items:center;gap:3px;font-size:11px;color:var(--text3);white-space:nowrap;cursor:pointer"
                        title="チェックON: アプリ実行時にウィジェットから入力&#10;チェックOFF: ここで設定した値を使用">
                        <input type="checkbox" ${appInput ? "checked" : ""}
                            ${evtAttr("onchange", "updateCloudAppInput(" + i + ",'" + esc(k) + "',this.checked)")}>アプリ側入力
                    </label>
                </div>`;
    }).join("");
}

function _cloudInfraRow(inf, i) {
    const preset = CLOUD_PRESETS.find(p => p.name === inf.name) || CLOUD_PRESETS[CLOUD_PRESETS.length - 1];
    // creds は {name, key, secret} の配列
    const credDefs = inf.credDefs && inf.credDefs.length ? inf.credDefs
        : (preset.creds || []);
    const curSvc = inf.service || (preset.services[0]?.label || "");
    const isCustomCloud = inf.name === "カスタム";
    const isCustomSvc = curSvc === "カスタム";

    const csid = _cloudSelId("cs", i);
    const ssid = _cloudSelId("ss", i);

    const cloudOpts = _cloudOptsHtml(inf, csid, i);
    const svcOpts = _cloudSvcOptsHtml(preset, curSvc, ssid, i);
    const urlField = _cloudUrlFieldHtml(preset, curSvc, isCustomSvc, inf, i);
    const credFields = _cloudCredFieldsHtml(inf, credDefs, isCustomCloud, i);

    // 有効チェックボックスのラベル
    const enabledLabel = inf.enabled
        ? `<span style="font-size:11px;color:var(--accent)">有効</span>`
        : `<span style="font-size:11px;color:var(--text3)">無効</span>`;

    return `<div style="padding:10px;border:1px solid var(--border);border-radius:4px">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                    <label style="display:flex;align-items:center;gap:3px;cursor:pointer"
                        title="ONにすると対象項目が有効になります">
                        <input type="checkbox" ${inf.enabled ? "checked" : ""}
                            ${evtAttr("onchange", "updateCloudField(" + i + ",'enabled',this.checked);_refreshCloudList()")}>
                        ${enabledLabel}
                    </label>
                    <div class="pv-sel" id="${csid}" style="width:100px;flex-shrink:0">
                        <div class="pv-sel-btn" ${evtAttr("onmousedown", "pvSelOpen('" + csid + "',event)")}>
                            <span>${esc(inf.name || "カスタム")}</span><span class="arr">▼</span>
                        </div>
                        <div class="pv-sel-list">${cloudOpts}</div>
                    </div>
                    <div class="pv-sel" id="${ssid}" style="width:110px;flex-shrink:0">
                        <div class="pv-sel-btn" ${evtAttr("onmousedown", "pvSelOpen('" + ssid + "',event)")}>
                            <span>${esc(curSvc)}</span><span class="arr">▼</span>
                        </div>
                        <div class="pv-sel-list">${svcOpts}</div>
                    </div>
                    ${urlField}
                    <button style="color:#ff6b6b;background:none;border:none;cursor:pointer;font-size:16px;flex-shrink:0"
                        ${evtAttr("onmousedown", "removeCloudInfra(" + i + ")")}>✕</button>
                </div>
                ${credFields ? `<div style="margin-top:6px">${credFields}</div>` : ""}
            </div>`;
}

function addCloudInfra() {
    const preset = CLOUD_PRESETS[0] || { name: "カスタム", services: [{ label: "カスタム", url: "", input: true }], creds: [] };
    _CLOUD_MODAL.draft.push({
        id: "ci_" + Date.now(), name: preset.name,
        service: preset.services[0].label, sdkUrl: preset.services[0].url,
        enabled: true, credDefs: preset.creds, credentials: {}, appInput: {},
    });
    _refreshCloudList();
}
function removeCloudInfra(i) {
    _CLOUD_MODAL.draft.splice(i, 1);
    _refreshCloudList();
}
function updateCloudField(i, key, val) {
    if (_CLOUD_MODAL.draft[i]) _CLOUD_MODAL.draft[i][key] = val;
}
function updateCloudCred(i, key, val) {
    if (!_CLOUD_MODAL.draft[i]) return;
    if (!_CLOUD_MODAL.draft[i].credentials) _CLOUD_MODAL.draft[i].credentials = {};
    _CLOUD_MODAL.draft[i].credentials[key] = val;
}
function updateCloudCredsJson(i, jsonStr) {
    if (!_CLOUD_MODAL.draft[i]) return;
    _CLOUD_MODAL.draft[i].credentialsJson = jsonStr;
    try {
        _CLOUD_MODAL.draft[i].credentials = JSON.parse(jsonStr);
    } catch (e) {
        console.debug("[vja] credentialsJson parse pending:", e.message);
    }
}
function updateCloudAppInput(i, key, checked) {
    if (!_CLOUD_MODAL.draft[i]) return;
    if (!_CLOUD_MODAL.draft[i].appInput) _CLOUD_MODAL.draft[i].appInput = {};
    _CLOUD_MODAL.draft[i].appInput[key] = checked;
    _refreshCloudList();
}
// インフラプリセット（AWS/GCP等）を選択し、サービス・クレデンシャル欄を更新する。
function selectCloudPreset(i, name) {
    if (!_CLOUD_MODAL.draft[i]) return;
    const preset = CLOUD_PRESETS.find(p => p.name === name);
    if (!preset) return;
    _CLOUD_MODAL.draft[i].name = name;
    _CLOUD_MODAL.draft[i].service = preset.services[0].label;
    _CLOUD_MODAL.draft[i].sdkUrl = preset.services[0].url;
    _CLOUD_MODAL.draft[i].credDefs = preset.creds;
    _CLOUD_MODAL.draft[i].credentials = {};
    _CLOUD_MODAL.draft[i].appInput = {};
    _refreshCloudList();
}
function selectCloudService(i, label) {
    if (!_CLOUD_MODAL.draft[i]) return;
    const preset = CLOUD_PRESETS.find(p => p.name === _CLOUD_MODAL.draft[i].name);
    if (!preset) return;
    const svc = preset.services.find(s => s.label === label);
    if (!svc) return;
    _CLOUD_MODAL.draft[i].service = label;
    if (svc.url) _CLOUD_MODAL.draft[i].sdkUrl = svc.url;
    _refreshCloudList();
}
function _refreshCloudList() {
    const el = $("cloud-list");
    if (!el) return;
    el.innerHTML = _CLOUD_MODAL.draft.map((inf, i) => _cloudInfraRow(inf, i)).join("") ||
        "<div style='color:var(--text3);font-size:12px;padding:8px'>登録なし</div>";
}
// クラウドインフラ設定を Bun 側に送信して暗号化保存する。
// AES-GCM 暗号化は Bun プロセス側（bunSaveCloudInfras）で行う。
async function saveCloudInfraConfig() {
    try {
        // Bun側で暗号化して保存
        const result = await window.bunSaveCloudInfras(_CLOUD_MODAL.draft);
        if (!result?.ok) throw new Error(result?.error || "保存失敗");
        // フロント側にも反映（次回モーダルオープン時のベースになる）
        getProjectData().cloudInfras = _CLOUD_MODAL.draft.map(c => JSON.parse(JSON.stringify(c)));
        closeModal();
        showToast("クラウドインフラ設定を保存しました");
        pushUndo();
    } catch (e) {
        showToast("保存エラー: " + e.message);
    }
}

/* ── フォント設定 ── */

// FONT_LIST / WIDGET_FONTS / EDITOR_FONTS は init-params.js で
// window.FONT_LIST / window.WIDGET_FONTS / window.EDITOR_FONTS として定義済み


function openFontConfig() {
    const curFont = getUiConfig().editorFontFamily;
    const curSize = getUiConfig().editorFontSize;
    const curUiSize = getUiConfig().uiFontSize;
    const curUiFont = getUiConfig().uiFontFamily;

    // pv-sel 用オプション：{value, label} 形式
    // value にフォントのCSS値を直接使用し、saveFontConfig で label→value 変換不要にする
    showModal(
        mhdrHTML("🔤 フォント設定") +
        "<div class='mbody' style='gap:14px'>" +

        // ── UIフォント設定 ──
        "<div style='font-size:var(--ui-font-size);font-weight:bold;color:var(--accent);padding-bottom:4px;border-bottom:1px solid var(--border)'>UI全体フォント設定</div>" +
        "<div class='ai-cfg-row'><label>フォントサイズ</label>" +
        "<div style='display:flex;align-items:center;gap:8px'>" +
        "<input id='uf-size' type='number' value='" + curUiSize + "' min='10' max='20' step='1' " +
        "style='width:70px;height:28px;background:var(--bg3);border:1px solid var(--border);border-radius:3px;color:var(--text);font-size:var(--ui-font-size);padding:0 8px;outline:none;text-align:center'>" +
        "<button" + evtAttr("onmousedown", "ufSizeStep(1)") + " style='width:28px;height:28px;background:var(--bg3);border:1px solid var(--border);border-radius:3px;color:var(--text);font-size:var(--ui-font-size);cursor:pointer'>▲</button>" +
        "<button" + evtAttr("onmousedown", "ufSizeStep(-1)") + " style='width:28px;height:28px;background:var(--bg3);border:1px solid var(--border);border-radius:3px;color:var(--text);font-size:var(--ui-font-size);cursor:pointer'>▼</button>" +
        "<span style='color:var(--text2);font-size:var(--ui-font-size)'>px (10〜20)</span>" +
        "</div></div>" +
        "<div class='ai-cfg-row'><label>フォント</label>" +
        makePvSel("uf-font-sel", UI_FONT_LIST, curUiFont, "setTimeout(function(){_updateFontPreview('ui',null)},0)") +
        "</div>" +
        // UIフォントプレビュー
        "<div style='display:flex;flex-direction:column;gap:6px'>" +
        "<label style='font-size:var(--ui-font-size);color:var(--text2)'>UIプレビュー</label>" +
        "<div id='uf-preview' style='background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:10px;" +
        "font-size:" + curUiSize + "px;font-family:" + (curUiFont || "inherit") + ";line-height:1.8;color:var(--text)'>" +
        "保存　キャンセル　閉じる　プロパティ　フォント設定　表示" +
        "</div></div>" +

        // ── エディタフォント設定 ──
        "<div style='font-size:var(--ui-font-size);font-weight:bold;color:var(--accent);padding-bottom:4px;border-bottom:1px solid var(--border);margin-top:6px'>エディタフォント設定</div>" +
        "<div class='ai-cfg-row'><label>フォントサイズ</label>" +
        "<div style='display:flex;align-items:center;gap:8px'>" +
        "<input id='ef-size' type='number' value='" + curSize + "' min='10' max='32' step='1' " +
        "style='width:70px;height:28px;background:var(--bg3);border:1px solid var(--border);border-radius:3px;color:var(--text);font-size:var(--ui-font-size);padding:0 8px;outline:none;text-align:center'>" +
        "<button" + evtAttr("onmousedown", "efSizeStep(1)") + " style='width:28px;height:28px;background:var(--bg3);border:1px solid var(--border);border-radius:3px;color:var(--text);font-size:var(--ui-font-size);cursor:pointer'>▲</button>" +
        "<button" + evtAttr("onmousedown", "efSizeStep(-1)") + " style='width:28px;height:28px;background:var(--bg3);border:1px solid var(--border);border-radius:3px;color:var(--text);font-size:var(--ui-font-size);cursor:pointer'>▼</button>" +
        "<span style='color:var(--text2);font-size:var(--ui-font-size)'>px (10〜32)</span>" +
        "</div></div>" +
        "<div class='ai-cfg-row'><label>フォント</label>" +
        makePvSel("ef-font-sel", EDITOR_FONTS, curFont, "setTimeout(function(){_updateFontPreview('editor',null)},0)") +
        "</div>" +

        // エディタプレビュー
        "<div style='display:flex;flex-direction:column;gap:6px'>" +
        "<label style='font-size:var(--ui-font-size);color:var(--text2)'>エディタプレビュー</label>" +
        "<div id='ef-preview' style='background:#1e1e2e;border:1px solid var(--border);border-radius:4px;padding:12px;" +
        "font-size:" + curSize + "px;font-family:" + curFont + ";line-height:1.6;color:#e8e8f0;white-space:pre'>" +
        "<span style='color:#7ec8ff'>function</span> <span style='color:#ffe080'>hello</span>() {\n" +
        "  <span style='color:#7ec8ff'>const</span> msg = <span style='color:#f0a87a'>&quot;Hello, VJA!&quot;</span>;\n" +
        "  <span style='color:#7ec8ff'>return</span> msg;\n" +
        "}" +
        "</div></div>" +
        "<div class='mfoot'>" +
        mfootHTML([{ label: "キャンセル", action: "closeModal()" }]) +
        "<button class='pri' id='ef-save-btn'>保存</button>" +
        "</div>"
    );
    rAfBind("#ef-save-btn", "click", saveFontConfig);

    // サイズ直接入力時もプレビューを更新
    requestAnimationFrame(function () {
        var ufSize = $("uf-size");
        var efSize = $("ef-size");
        if (ufSize) ufSize.addEventListener("input", function () { _updateFontPreview("ui", null); });
        if (efSize) efSize.addEventListener("input", function () { _updateFontPreview("editor", null); });
    });
}

// フォントプレビューを即時更新する
// kind: "ui" → UIフォントプレビュー, "editor" → エディタプレビュー
// fontValue: CSS font-family 値。null の場合は現在のpv-sel-btnラベルから逆引き
function _updateFontPreview(kind, fontValue) {
    if (kind === "ui") {
        var prev = $("uf-preview");
        var sizeIn = $("uf-size");
        if (!prev) return;
        var sz = parseInt(sizeIn?.value) || 13;
        if (fontValue === null) {
            var lbl = document.querySelector("#uf-font-sel .pv-sel-btn span:first-child")?.textContent || "";
            var f = UI_FONT_LIST.find(function (x) { return x.label === lbl; }) || UI_FONT_LIST[0];
            fontValue = f.value || "inherit";
        }
        prev.style.setProperty("font-size", sz + "px", "important");
        prev.style.setProperty("font-family", fontValue || "inherit", "important");
    } else {
        var prev2 = $("ef-preview");
        var sizeIn2 = $("ef-size");
        if (!prev2) return;
        var sz2 = parseInt(sizeIn2?.value) || 16;
        if (fontValue === null) {
            var lbl2 = document.querySelector("#ef-font-sel .pv-sel-btn span:first-child")?.textContent || "";
            var f2 = EDITOR_FONTS.find(function (x) { return x.label === lbl2; }) || EDITOR_FONTS[0];
            fontValue = f2.value;
        }
        prev2.style.setProperty("font-size", sz2 + "px", "important");
        prev2.style.setProperty("font-family", fontValue, "important");
    }
}

// フォントサイズ入力の▲▼ステップ共通処理（ステップ後プレビューも更新）
function _fontSizeStep(id, dir, min, max, defaultVal) {
    var el = $(id);
    if (!el) return;
    el.value = Math.max(min, Math.min(max, (parseInt(el.value) || defaultVal) + dir));
}
function efSizeStep(dir) { _fontSizeStep("ef-size", dir, 10, 32, 16); _updateFontPreview("editor", null); }
function ufSizeStep(dir) { _fontSizeStep("uf-size", dir, 10, 20, 13); _updateFontPreview("ui", null); }

function saveFontConfig() {
    // エディタフォント: pv-sel-btn の表示ラベルから value を逆引き
    var editorSize = Math.max(10, Math.min(32, parseInt($("ef-size")?.value) || 16));
    var edLabel = document.querySelector("#ef-font-sel .pv-sel-btn span:first-child")?.textContent || "";
    var edFont = (EDITOR_FONTS.find(function (f) { return f.label === edLabel; }) || EDITOR_FONTS[0]).value;
    // UIフォント: pv-sel-btn の表示ラベルから value を逆引き
    var uiSize = Math.max(10, Math.min(20, parseInt($("uf-size")?.value) || 13));
    var uiLabel = document.querySelector("#uf-font-sel .pv-sel-btn span:first-child")?.textContent || "";
    var uiFont = (UI_FONT_LIST.find(function (f) { return f.label === uiLabel; }) || UI_FONT_LIST[0]).value;
    // uiConfigに統合して保存
    Object.assign(getUiConfig(), { editorFontSize: editorSize, editorFontFamily: edFont, uiFontSize: uiSize, uiFontFamily: uiFont });
    applyEditorConfig();
    applyUiConfig();
    window.bunSaveUiConfig?.(uiSize, uiFont, editorSize, edFont, getUiConfig().leftPanelW, getUiConfig().rightPanelW);
    closeModal();
    pushUndo();
    showToast("フォント設定を保存しました");
}

/* ── カラム定義エディタ ── */
function openColDefEditor(wid) {
    const w = getWidget(wid);
    if (!w) return;
    const rows = (w.props.columns || "").split(/[;\n]/).filter(s => s.trim()).map((c) => {
        const parts = c.trim().split(":");
        return { label: parts[0] || "", width: parts[1] || "20", displayName: parts[2] || "" };
    });
    if (rows.length === 0) rows.push({ label: "", width: "20", displayName: "" });
    _COLDEF_MODAL.wid = wid;
    _COLDEF_MODAL.rows = rows;
    _COLDEF_MODAL.maxRows = w.props.maxRows || 0;
    renderColDefModal();
}
function renderColDefModal() {
    renderRowListModal({
        modalId: "coldef-modal",
        title: "📊 カラム定義エディタ",
        infoText: "カラム名と幅(%)を定義します。Noは自動採番。",
        rows: _COLDEF_MODAL.rows,
        maxLen: 100,
        headerHtml: "<th style='width:36px'>No</th><th>カラム名</th><th>表示名</th><th style='width:80px'>幅(%)</th><th style='width:56px'></th>",
        rowHtmlFn: (r, i) => "<tr>"
            + "<td>" + (i + 1) + "</td>"
            + "<td><input type='text' value='" + esc(r.label) + "'" + evtAttr("oninput", "coldefUpdate(" + i + ",'label',this.value)") + " placeholder='カラム名'></td>"
            + "<td><input type='text' value='" + esc(r.displayName || "") + "'" + evtAttr("oninput", "coldefUpdate(" + i + ",'displayName',this.value)") + " placeholder='表示名（省略可）'></td>"
            + "<td><input type='number' value='" + esc(r.width) + "'" + evtAttr("oninput", "coldefUpdate(" + i + ",'width',this.value)") + " style='width:70px' min='1' max='100'></td>"
            + "<td style='white-space:nowrap'>"
            + "<button class='del-btn'" + evtAttr("onmousedown", "coldefInsertRow(" + i + ")") + " title='この行の前に挿入' style='margin-right:2px'>＋</button>"
            + "<button class='del-btn'" + evtAttr("onmousedown", "coldefDelRow(" + i + ")") + " title='削除'>✕</button>"
            + "</td></tr>",
        addAction: "coldefAddRow()",
        saveAction: "coldefSave()",
        extraHtml: "<div style='display:flex;align-items:center;gap:8px;padding:4px 0'>"
            + "<label style='font-size:12px;color:var(--text2);white-space:nowrap'>最大表示件数（0=無制限）:</label>"
            + "<input type='number' id='coldef-maxrows' value='" + (_COLDEF_MODAL.maxRows || 0) + "' min='0' class='pv-input' style='width:80px'>"
            + "</div>",
    });
}
function coldefUpdate(idx, key, val) {
    if (_COLDEF_MODAL.rows) _COLDEF_MODAL.rows[idx][key] = val;
}
function coldefAddRow() {
    _rowAdd(() => _COLDEF_MODAL.rows, () => ({ label: "", width: "20", displayName: "" }), renderColDefModal, 100);
}
function coldefInsertRow(idx) {
    _rowInsert(() => _COLDEF_MODAL.rows, idx, () => ({ label: "", width: "20", displayName: "" }), renderColDefModal, 100);
}
function coldefDelRow(idx) {
    _rowDel(() => _COLDEF_MODAL.rows, idx, () => ({ label: "", width: "80" }), renderColDefModal);
}
function coldefSave() {
    const wid = _COLDEF_MODAL.wid;
    const w = getWidget(wid);
    if (!w) return;
    const valid = (_COLDEF_MODAL.rows || []).filter(r => r.label.trim());
    if (valid.length === 0) { showVjaAlert("カラム名を1つ以上入力してください"); return; }
    w.props.columns = valid.map(r => r.label.trim() + ":" + (parseInt(r.width) || 20) + (r.displayName?.trim() ? ":" + r.displayName.trim() : "")).join("\n");
    w.props.maxRows = parseInt($("coldef-maxrows")?.value) || 0;
    closeModal();
    pushUndo();
    renderWidget(w, false);
    applyWPos($("w" + wid), w);
    renderProps();
}

/* ── 項目定義エディタ（SelectBox / ListBox） ── */

function openItemsDefEditor(wid) {
    const w = getWidget(wid);
    if (!w) return;
    const rows = (w.props.items || "").split("\n").filter(s => s.trim()).map(s => {
        const idx = s.indexOf("=");
        if (idx > 0) return { label: s.slice(0, idx).trim(), value: s.slice(idx + 1).trim() };
        return { label: s.trim(), value: "" };
    });
    if (rows.length === 0) rows.push({ label: "", value: "" });
    _ITEMSDEF_EDITOR.wid = wid;
    _ITEMSDEF_EDITOR.rows = rows;
    renderItemsDefModal();
}
function renderItemsDefModal() {
    renderRowListModal({
        modalId: "itemsdef-modal",
        title: "📋 項目定義エディタ",
        infoText: "選択肢を定義します。Value省略時は表示名が使われます。",
        rows: _ITEMSDEF_EDITOR.rows,
        headerHtml: "<th style='width:36px'>No</th><th>表示名</th><th>Value（省略可）</th><th style='width:56px'></th>",
        rowHtmlFn: (r, i) => "<tr>"
            + "<td>" + (i + 1) + "</td>"
            + "<td><input type='text' class='pv-input' value='" + esc(r.label) + "'" + evtAttr("oninput", "_ITEMSDEF_EDITOR.rows[" + i + "].label=this.value") + " placeholder='表示名'></td>"
            + "<td><input type='text' class='pv-input' value='" + esc(r.value || "") + "'" + evtAttr("oninput", "_ITEMSDEF_EDITOR.rows[" + i + "].value=this.value") + " placeholder='Value（省略可）'></td>"
            + "<td style='white-space:nowrap'>"
            + "<button class='del-btn'" + evtAttr("onmousedown", "itemsdefInsertRow(" + i + ")") + " title='この行の前に挿入' style='margin-right:2px'>＋</button>"
            + "<button class='del-btn'" + evtAttr("onmousedown", "itemsdefDelRow(" + i + ")") + " title='削除'>✕</button>"
            + "</td></tr>",
        addAction: "itemsdefAddRow()",
        saveAction: "itemsdefSave()",
    });
}
function itemsdefAddRow() {
    _rowAdd(() => _ITEMSDEF_EDITOR.rows, () => ({ label: "", value: "" }), renderItemsDefModal);
}
function itemsdefInsertRow(idx) {
    _rowInsert(() => _ITEMSDEF_EDITOR.rows, idx, () => ({ label: "", value: "" }), renderItemsDefModal);
}
function itemsdefDelRow(idx) {
    _rowDel(() => _ITEMSDEF_EDITOR.rows, idx, () => ({ label: "", value: "" }), renderItemsDefModal);
}
function itemsdefSave() {
    const wid = _ITEMSDEF_EDITOR.wid;
    const w = getWidget(wid);
    if (!w) return;
    const valid = (_ITEMSDEF_EDITOR.rows || []).filter(r => r.label.trim());
    if (valid.length === 0) { showVjaAlert("表示名を1つ以上入力してください"); return; }
    w.props.items = valid.map(r => r.value?.trim() ? r.label.trim() + "=" + r.value.trim() : r.label.trim()).join("\n");
    closeModal();
    pushUndo();
    renderWidget(w, false);
    applyWPos($("w" + wid), w);
    renderProps();
}

function applyProjectInfo() {
    // ステータスバーにプロジェクト名を表示
    const nameEl = $("st-project-name");
    if (nameEl) {
        nameEl.textContent = getProjectData().projectInfo.name
            ? "📁 " + getProjectData().projectInfo.name + (getProjectData().projectInfo.version ? " v" + getProjectData().projectInfo.version : "")
            : "";
    }
    // タイトルバーにプロジェクト名を反映
    const titleEl = $("titlebar-title");
    if (titleEl) {
        titleEl.textContent = getProjectData().projectInfo.name
            ? "VJA Form Designer (" + getProjectData().projectInfo.name + ")"
            : "VJA Form Designer";
    }
}

// bridge.tsからのUI設定読み込み結果を受け取るハンドラー
window._onLoadUiConfigResult = function (cfg) {
    if (!cfg) return;
    Object.assign(getUiConfig(), {
        uiFontSize: cfg.uiFontSize || 13,
        uiFontFamily: cfg.uiFontFamily || "",
        editorFontSize: cfg.editorFontSize || 16,
        editorFontFamily: cfg.editorFontFamily || "'Courier New', Courier, monospace",
        leftPanelW: cfg.leftPanelW || 110,
        rightPanelW: cfg.rightPanelW || 420,
    });
    applyUiConfig();
    applyEditorConfig();
    applyViewSettings();
};

function applyUiConfig() {
    document.documentElement.style.setProperty("--ui-font-size", getUiConfig().uiFontSize + "px");
    if (getUiConfig().uiFontFamily) {
        document.documentElement.style.setProperty("--font", getUiConfig().uiFontFamily);
    }
}

function applyEditorConfig() {
    const fs = getUiConfig().editorFontSize + "px";
    const ff = getUiConfig().editorFontFamily;
    // CSS変数を更新
    document.documentElement.style.setProperty("--editor-font-size", fs);
    document.documentElement.style.setProperty("--editor-font-family", ff);
    // 既に開いているエディタ要素に直接適用
    ["yaml-ta", "js-ta"].forEach(id => {
        const el = $(id);
        if (el) { el.style.fontSize = fs; el.style.fontFamily = ff; }
    });
    // ハイライトオーバーレイにも直接適用
    document.querySelectorAll(".yaml-hl-bg, #yaml-hl, #js-hl").forEach(el => {
        el.style.fontSize = fs;
        el.style.fontFamily = ff;
    });
}

function applyViewSettings() {
    // パネル幅を復元
    const lw = getUiConfig().leftPanelW || 110;
    const rw = getUiConfig().rightPanelW || 420;
    document.documentElement.style.setProperty("--panel", lw + "px");
    document.documentElement.style.setProperty("--prop", rw + "px");
    const tb = $("toolbox"), pp = $("props-panel");
    if (tb) tb.style.width = lw + "px";
    if (pp) pp.style.width = rw + "px";
    applyEditorConfig();
    applyProjectInfo();
    // グリッド
    fb().classList.toggle("show-grid", getDesignerState().showGrid);
    const stg = $("st-grid");
    if (stg) stg.innerHTML = "グリッド: <b style='color:" + (getDesignerState().showGrid ? "var(--accent)" : "#ff6b6b") + "'>" + (getDesignerState().showGrid ? "ON" : "OFF") + "</b>";
    // スナップ
    const sts = $("st-snap");
    if (sts) sts.innerHTML = "スナップ: <b style='color:" + (getDesignerState().snapOn ? "var(--accent)" : "#ff6b6b") + "'>" + (getDesignerState().snapOn ? "ON" : "OFF") + "</b>";
    // メニュー項目
    const mgrid = document.querySelector(".dd-item[onmousedown=\"toggleGrid()\"]");
    if (mgrid) mgrid.textContent = "グリッド表示切替（現在: " + (getDesignerState().showGrid ? "ON" : "OFF") + "）";
    const msnap = document.querySelector(".dd-item[onmousedown=\"toggleSnap()\"]");
    if (msnap) msnap.textContent = "スナップ切替（現在: " + (getDesignerState().snapOn ? "ON" : "OFF") + "）";
}

function toggleGrid() {
    getDesignerState().showGrid = !getDesignerState().showGrid;
    applyViewSettings();
    showToast("グリッド表示: " + (getDesignerState().showGrid ? "ON" : "OFF"));
}
function toggleSnap() {
    getDesignerState().snapOn = !getDesignerState().snapOn;
    applyViewSettings();
    showToast("スナップ: " + (getDesignerState().snapOn ? "ON" : "OFF"));
}
function updateCount() {
    $("st-cnt").innerHTML =
        `ウィジェット: <b>${getProjectData().widgets.length}</b>`;
}

function toggleMenu(id, e) {
    e.stopPropagation();
    const already = $(id).classList.contains("open");
    closeAllMenus();
    if (!already) $(id).classList.add("open");
}
function closeAllMenus() {
    document
        .querySelectorAll(".dropdown")
        .forEach((d) => d.classList.remove("open"));
}

/* ═══════════════════════════════════════════
   window へのエクスポート（他ファイルから参照される関数のみ）
═══════════════════════════════════════════ */
Object.assign(window, {
    // フォーム定数・アプリイベント・プロジェクト情報・拡張ランタイム
    openFormConstEditor, renderFormConstModal, formConstAddRow, saveFormConst,
    openAppEvents, saveAppEvent,
    openProjectInfo, piVerStep, saveProjectInfo,
    openExtRuntime, saveExtRuntime, extRtGenDoc,
    openDebugTools,
    // クラウドインフラ設定
    openCloudInfraConfig, _renderCloudModal, _cloudSelId,
    _cloudOptsHtml, _cloudSvcOptsHtml, _cloudUrlFieldHtml, _cloudCredFieldsHtml,
    _cloudInfraRow, addCloudInfra, removeCloudInfra,
    updateCloudField, updateCloudCred, updateCloudCredsJson, updateCloudAppInput,
    selectCloudPreset, selectCloudService, _refreshCloudList, saveCloudInfraConfig,
    // フォント設定
    openFontConfig, _updateFontPreview, _fontSizeStep, efSizeStep, ufSizeStep, saveFontConfig,
    // カラム定義・項目定義エディタ
    openColDefEditor, renderColDefModal,
    coldefUpdate, coldefAddRow, coldefInsertRow, coldefDelRow, coldefSave,
    openItemsDefEditor, renderItemsDefModal,
    itemsdefAddRow, itemsdefInsertRow, itemsdefDelRow, itemsdefSave,
    // 各種反映・トグル
    applyProjectInfo, applyUiConfig, applyEditorConfig, applyViewSettings,
    toggleGrid, toggleSnap, updateCount, toggleMenu, closeAllMenus,
});
