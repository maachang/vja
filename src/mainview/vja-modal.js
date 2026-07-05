/* ═══════════════════════════════════════════════════════════════
   vja-modal.js — モーダル基盤・コンテキストメニュー・Undo/Redo・削除/複製
   ─────────────────────────────────────────────────────────────
   【読み込み順序】3番目（vja-designer.js の直後）。
   【依存】vja-defs.js, vja-designer.js
   【提供するもの】
     - showModal() / closeModal() / showLoadingModal()（全モーダル共通の土台）
     - mhdrHTML() / mfootHTML()（モーダル共通ヘッダー/フッターHTML）
     - コンテキストメニュー（右クリックメニュー）
     - pushUndo() / actUndo() / actRedo() / snapshot()（デザイナーのUndo/Redo）
     - actDelete() / actDuplicate()（ウィジェット削除・複製。どちらも
       _state.selIds全件を一括処理しUndoは1回にまとめる。複製後は
       新規に複製された側をまとめて選択状態にする）
   このファイルは vja-defs.js / vja-designer.js に依存する。
   vja-yaml-editor.js 以降の「モーダルを開く」全ての機能が、
   このファイルの showModal/closeModal に依存するため、
   このファイルは vja-yaml-editor.js より前に読み込むこと。
═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════
  MODAL
  モーダルダイアログの表示・非表示を管理する。
  modal-root に innerHTML を差し込む方式で、
  showModal / closeModal / showLoadingModal の3種を使い分ける。
═══════════════════════════════════════════ */
// 汎用モーダルを表示する。yaml系モーダルは外クリックで閉じない制御も兼ねる。
// extraClass: 追加CSSクラス（例: "modal-yaml", "modal-cloud"）
// layer: 表示先のroot要素ID（省略時は"modal-root"）
function showModal(html, extraClass = "", layer = "modal-root") {
    const isYaml = /^\s*<div class=["']modal-yaml["']>/.test(html);
    const cls = isYaml ? " modal-yaml" : (extraClass ? " " + extraClass : "");
    // modal-yaml ラッパーは不要なので中身を取り出す
    const inner = isYaml
        ? html.replace(/^\s*<div class=["']modal-yaml["']>/, "").replace(/<\/div>\s*$/, "")
        : html;
    $(layer).innerHTML =
        `<div class="ov"><div class="modal${cls}">${inner}</div></div>`;
}
// ── vja.app ダイアログ（#dialog-root, z-index:8000）────────────────
// showVjaDialog / showVjaAlert / showVjaPrompt / _onVjaDialog* は
// vja-runtime.js に共通実装済み（デザイナー・プロジェクト実行ウィンドウ共通）

// モーダルを閉じる。AIローディングタイマーが残っていれば合わせてクリアする。
// layer: 閉じる対象のroot要素ID（省略時は"modal-root"）
function closeModal(layer = "modal-root") {
    if (layer === "modal-root" && getAiContext().loadingTimer) { clearInterval(getAiContext().loadingTimer); getAiContext().loadingTimer = null; }
    $(layer).innerHTML = "";
}
// モーダルヘッダー生成ヘルパー
function mhdrHTML(title, layer = "modal-root") {
    return "<div class='mhdr'><h4>" + title + "</h4>" +
        "<button class='mclose'" + evtAttr("onmousedown", "closeModal(\"" + layer + "\")") + ">✕</button></div>";
}
// モーダルフッター生成ヘルパー
function mfootHTML(btns) {
    // btns: [{label, cls, action}]
    return "<div class='mfoot'>" +
        btns.map(b => `<button class='${b.cls || ""}'${evtAttr("onmousedown", b.action)}>${b.label}</button>`).join("") +
        "</div>";
}
// AI生成中のローディングモーダルを表示する。
// 経過秒数タイマーとキャンセルボタンを持つ。getAiContext().loadingTimer で管理。
function showLoadingModal(msg) {
    $("modal-root").innerHTML =
        `<div class="ov"><div class="modal modal-loading" style="padding:32px 40px;display:flex;flex-direction:column;align-items:center;gap:16px;min-width:260px">` +
        `<div style="font-size:28px;animation:spin 1s linear infinite">⏳</div>` +
        `<div style="color:var(--text1);font-size:14px">${msg}</div>` +
        `<div id="loading-timer" style="color:var(--accent,#7eb8f7);font-size:20px;font-weight:bold">0秒</div>` +
        `<button class="modal-btn" onmousedown="cancelAiGenerate()" style="margin-top:12px;padding:8px 28px">キャンセル</button>` +
        `</div></div>`;
    if (getAiContext().loadingTimer) { clearInterval(getAiContext().loadingTimer); getAiContext().loadingTimer = null; }
    let sec = 0;
    getAiContext().loadingTimer = setInterval(() => {
        const el = $("loading-timer");
        if (el) el.textContent = (++sec) + "秒";
    }, 1000);
}
// AI生成をキャンセルする。vja.fetchAbort() でBun側のリクエストを中断する。
function cancelAiGenerate() {
    if (getAiContext().fetchId) { window.vja?.fetchAbort?.(getAiContext().fetchId); getAiContext().fetchId = null; }
}

// AI生成共通実行関数。
// OpenAI互換API（ローカルLLM / OpenAI API）への fetch を共通化する。
// options: { systemPrompt, userPrompt, onSuccess(result), onCancel?, onError?, loadingMsg? }
// - onSuccess: 生成完了時に呼ばれる。引数に生成テキスト（コードブロック除去済み）が渡る。
// - onCancel: キャンセル時のコールバック（省略可）
// - onError: エラー時のコールバック（省略可）
async function runAiGenerate(options) {
    const { systemPrompt, userPrompt, onSuccess, onCancel, onError, loadingMsg, temperatureOverride } = options;
    const hasApiKey = !!getProjectData().aiConfig.apiKey;
    const isRouterOn = !!getProjectData().aiConfig.routerMode;
    const endpoint = hasApiKey ? "https://api.openai.com" : getProjectData().aiConfig.endpoint;
    const modelName = hasApiKey
        ? (getProjectData().aiConfig.model || "gpt-4o-mini")
        : (isRouterOn ? getProjectData().aiConfig.model : undefined);
    const headers = { "Content-Type": "application/json" };
    if (hasApiKey) headers["Authorization"] = "Bearer " + getProjectData().aiConfig.apiKey;
    const body = {
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ],
        stream: false
    };
    // temperatureOverride: リトライ時など、その回だけ一時的にtemperatureを
    // 上書きしたい場合に指定する（プロジェクト設定自体は変更しない）。
    if (temperatureOverride !== undefined) {
        body.temperature = temperatureOverride;
    } else if (getProjectData().aiConfig.temperature !== "" && getProjectData().aiConfig.temperature !== undefined) {
        body.temperature = getProjectData().aiConfig.temperature;
    }
    if (getProjectData().aiConfig.maxTokens) body.max_tokens = getProjectData().aiConfig.maxTokens;
    if (modelName) body.model = modelName;
    // 推論モードOFFの場合、各サーバー向けのパラメータを付与
    // llama.cpp / mlx-lm: chat_template_kwargs, Ollama: think, vLLM: reasoning_effort
    if (getProjectData().aiConfig.thinking === false) {
        body.think = false;
        body.reasoning_effort = "none";
        body.chat_template_kwargs = { enable_thinking: false };
    }
    getAiContext().fetchId = null;
    showLoadingModal(loadingMsg || "AI生成中…");
    let startTime;
    let res = null;
    try {
        // リクエスト送信前ログ
        window.vja?.log?.debug?.("[AI] request: endpoint=" + endpoint + " model=" + (modelName || "none") + " temperature=" + (body.temperature !== undefined ? body.temperature : "(server default)") + " systemLen=" + systemPrompt.length + " userLen=" + userPrompt.length);
        startTime = Date.now(); // 開始時間.
        const fetchReq = window.vja.fetch(endpoint + "/v1/chat/completions", {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
        getAiContext().fetchId = fetchReq.fetchId;
        res = await fetchReq;
        getAiContext().fetchId = null;
        if (!res.ok) {
            const errText = await res.text().catch(() => "");
            throw new Error("HTTP " + res.status + (errText ? " — " + errText.slice(0, 120) : ""));
        }
        const data = await res.json();
        const msg = data.choices?.[0]?.message || {};
        const raw = (msg.content || msg.reasoning_content || "");

        // AI返却結果をデバッグ出力.
        vja.log.debug("# AI返却結果:\n" + raw + "\n---EOF");

        const generated = (() => {
            // <think>ブロックを除去
            let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
            // チャットテンプレートの特殊トークン（<|im_end|> 等）を除去。
            // ローカルLLMサーバー（llama.cpp/mlx-lm等）側でstopトークンとして
            // 正しく扱われず、生成結果にそのまま混入することがあるための対策。
            text = text.replace(/<\|[a-zA-Z0-9_]+\|>/g, "");
            // コードブロック(```js等)が存在すればその中身を抽出
            // 存在しない場合はそのままtrimして使用
            const m = text.match(/```(?:javascript|json|yaml|js)?\n?([\s\S]*?)```/i);
            return m ? m[1].trim() : text.trim();
        })();
        if (!generated) {
            window.vja?.log?.warn?.("[AI] generated is empty. raw=" + raw.slice(0, 200));
        }
        closeModal();
        if (onSuccess) await onSuccess(generated);
    } catch (e) {
        closeModal();
        if (e.name === "AbortError") {
            showToast("AI生成をキャンセルしました");
            if (onCancel) await onCancel();
        } else {
            showToast("AI生成エラー: " + e.message);
            // エラーログ
            window.vja?.log?.error?.("[AI] error: " + e.message + " res.status=" + (res?.status ?? "null"));
            // エラーデバッグ出力
            window.vja?.log?.debug?.("[AI] fetch-response: status=" + (res?.status ?? "null"));
            if (onError) await onError(e);
        }
    } finally {
        getAiContext().fetchId = null;
        // AI処理時間を出力.
        vja.log.debug("# AI処理時間: " + (Date.now() - startTime) + " msec");
    }
}
/* ═══════════════════════════════════════════
  CONTEXT MENU
═══════════════════════════════════════════ */
function showCtx(x, y) {
    const m = $("ctx");
    m.style.cssText = `display:flex;left:${x}px;top:${y}px`;
}
function hideCtx() {
    $("ctx").style.display = "none";
}
function ctxYaml() {
    hideCtx();
    const cid = getDesignerState().ctxId;
    getDesignerState().ctxId = null;
    const w = getWidget(cid);
    if (!w) return;
    openYaml(w.id, (WIDGET_DEFS[w.tag]?.events || ["Click"])[0]);
}
function ctxFront() {
    hideCtx();
    const cid = getDesignerState().ctxId;
    getDesignerState().ctxId = null;
    const w = getWidget(cid);
    if (!w) return;
    w.z = (w.z || 0) + 1;
    applyWPos($("w" + w.id), w);
}
function ctxBack() {
    hideCtx();
    const cid = getDesignerState().ctxId;
    getDesignerState().ctxId = null;
    const w = getWidget(cid);
    if (!w) return;
    w.z = Math.max(0, (w.z || 0) - 1);
    applyWPos($("w" + w.id), w);
}

/* ═══════════════════════════════════════════
  UNDO / REDO
  プロジェクト全体を JSON 文字列としてスナップショットし、
  undoStack / redoStack で管理する。
  最大60件保持。編集確定時に pushUndo() を呼ぶ。
═══════════════════════════════════════════ */
// プロジェクト全体を JSON 文字列にシリアライズして返す。
// 再帰的なキー・バリュー比較
function deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((v, i) => deepEqual(v, b[i]));
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (typeof a === "object" && typeof b === "object") {
        const keysA = Object.keys(a).filter(k => a[k] !== undefined);
        const keysB = Object.keys(b).filter(k => b[k] !== undefined);
        if (keysA.length !== keysB.length) return false;
        if (!keysA.every(k => k in b)) return false;
        return keysA.every(k => deepEqual(a[k], b[k]));
    }
    return a === b;
}

function snapshot() {
    var p = getProjectData();
    return {
        forms: p.forms,
        curFormIdx: p.curFormIdx,
        constants: p.constants,
        startFormId: p.startFormId,
        aiConfig: p.aiConfig,
        cloudInfras: p.cloudInfras,
        tables: p.tables,
        snapOn: getDesignerState().snapOn,
        showGrid: getDesignerState().showGrid,
        projectInfo: p.projectInfo,
        extRuntime: p.extRuntime,
        formDesignDraft: p.formDesignDraft || "",
        mockOverrides: p.mockOverrides || {},
        apiOptOverrides: p.apiOptOverrides || {},
        tableOptOverrides: p.tableOptOverrides || {},
        validationOverrides: p.validationOverrides || {},
        mockCheckOverrides: p.mockCheckOverrides || {},
    };
}
// 現在の状態を undoStack に積む。redoStack はクリアする。
function pushUndo() {
    commitIdCnt();
    getEditHistory().undoStack.push(JSON.stringify(snapshot()));
    if (getEditHistory().undoStack.length > 60) getEditHistory().undoStack.shift();
    getEditHistory().redoStack = [];
}

// commitIdCnt + pushUndo の共通処理
function commitAndPush() {
    commitIdCnt();
    pushUndo();
}

// renderEvents + pushUndo の共通処理
function renderEventsAndPush() {
    renderEvents();
    pushUndo();
}
// ── プロジェクトデータ復元共通処理 ──────────────
// スナップショットや保存データから状態を復元する共通処理。
// getProjectData().forms/getProjectData().curFormIdx 以外の全フィールドをここで復元する。
function applyProjectData(d) {
    getProjectData().cloudInfras = d.cloudInfras || [];
    getProjectData().extRuntime = d.extRuntime || { js: "", doc: "" };
    getProjectData().constants = d.constants || [];
    getProjectData().startFormId = d.startFormId || (d.forms?.[0]?.id ?? "");
    getProjectData().tables = d.tables || [];
    getProjectData().formDesignDraft = d.formDesignDraft || "";
    getProjectData().mockOverrides = d.mockOverrides || {};
    getProjectData().apiOptOverrides = d.apiOptOverrides || {};
    getProjectData().tableOptOverrides = d.tableOptOverrides || {};
    getProjectData().validationOverrides = d.validationOverrides || {};
    getProjectData().mockCheckOverrides = d.mockCheckOverrides || {};
    getDesignerState().snapOn = d.snapOn !== undefined ? d.snapOn : true;
    getDesignerState().showGrid = d.showGrid !== undefined ? d.showGrid : false;
    // editorConfigはvja設定ファイルで管理するためプロジェクトからは読み込まない
    if (d.projectInfo) getProjectData().projectInfo = { ...getProjectData().projectInfo, ...d.projectInfo };
    const _ac = d.aiConfig || {};
    getProjectData().aiConfig = {
        endpoint: _ac.endpoint || "http://localhost:8080",
        apiKey: _ac.apiKey || "",
        model: _ac.model || "",
        models: _ac.models || [],
        enabled: !!_ac.enabled,
        routerMode: !!_ac.routerMode,
        thinking: _ac.thinking !== false, // falseのみOFF、未定義はON
        maxTokens: _ac.maxTokens || "",
        temperature: _ac.temperature !== "" && _ac.temperature != null ? _ac.temperature : "",
    };
}

// JSON 文字列からプロジェクト全体を復元し、画面を再描画する。
function restoreSnap(s) {
    const d = JSON.parse(s);
    getProjectData().forms = d.forms;
    // 古いプロジェクトファイルにはvalidationsがないため補完
    getProjectData().forms.forEach(f => {
        if (!f.validations) f.validations = [];
        // 旧形式（オブジェクト）の場合は配列に変換
        if (!Array.isArray(f.validations)) f.validations = [];
    });
    getProjectData().curFormIdx = d.curFormIdx;
    applyProjectData(d);
    getDesignerState().selIds = [];
    refreshAll();
}
// Undo 実行。現在の状態を getEditHistory().redoStack に退避してから直前のスナップに戻す。
function actUndo() {
    if (!getEditHistory().undoStack.length) return;
    getEditHistory().redoStack.push(JSON.stringify(snapshot()));
    restoreSnap(getEditHistory().undoStack.pop());
}
// Redo 実行。現在の状態を getEditHistory().undoStack に退避してから Redo スタックのスナップに進む。
function actRedo() {
    if (!getEditHistory().redoStack.length) return;
    getEditHistory().undoStack.push(JSON.stringify(snapshot()));
    restoreSnap(getEditHistory().redoStack.pop());
}

/* ═══════════════════════════════════════════
  DELETE / DUPLICATE
═══════════════════════════════════════════ */
function actDelete() {
    const ids = getDesignerState().selIds;
    if (!ids.length) return;
    pushUndo();
    ids.forEach((id) => $("w" + id)?.remove());
    getProjectData().widgets = getProjectData().widgets.filter((x) => !ids.includes(x.id));
    getProjectData().forms[getProjectData().curFormIdx].widgets = getProjectData().widgets;
    getDesignerState().selIds = [];
    $("prop-obj").textContent = getProjectData().formCfg.title;
    renderProps();
    updateCount();
}
function actDuplicate() {
    hideCtx();
    const cid = getDesignerState().ctxId;
    getDesignerState().ctxId = null;
    const srcIds = cid != null ? [cid] : getDesignerState().selIds;
    const srcs = srcIds.map((id) => getWidget(id)).filter(Boolean);
    if (srcs.length === 0) return;
    const newIds = [];
    srcs.forEach((src) => {
        const nw = {
            ...src,
            id: getProjectData().idCnt++,
            x: src.x + SNAP * 2,
            y: src.y + SNAP * 2,
            props: { ...src.props },
            events: { ...src.events },
            name: src.name + "_2",
        };
        getProjectData().widgets.push(nw);
        renderWidget(nw, true);
        newIds.push(nw.id);
    });
    pushUndo();
    selectMultiple(newIds);
    updateCount();
}

/* ═══════════════════════════════════════════
   window へのエクスポート（他ファイルから参照される関数のみ）
═══════════════════════════════════════════ */
Object.assign(window, {
    showModal, closeModal, mhdrHTML, mfootHTML, showLoadingModal, cancelAiGenerate, runAiGenerate,
    showCtx, hideCtx, ctxYaml, ctxFront, ctxBack,
    deepEqual, snapshot, pushUndo, commitAndPush, renderEventsAndPush,
    applyProjectData, restoreSnap, actUndo, actRedo, actDelete, actDuplicate,
});
