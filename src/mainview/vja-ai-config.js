/* ═══════════════════════════════════════════════════════════════
   vja-ai-config.js — AI接続設定モーダル（プリセット管理含む）
   ─────────────────────────────────────────────────────────────
   【読み込み順序】vja-yaml-editor.js より後（依存関数はいずれも
   実行時にしか呼ばれないため、スクリプトの読み込み順序そのものは
   厳密である必要はない）。
   【依存】vja-defs.js（getProjectData/deepEqual等）、
   vja-modal.js（showModal/closeModal/pushUndo）、vja-html.js（render/evtAttr/makePvSel）
   【提供するもの】
     - openAiConfig() / aiCfgCancel() / aiCfgConfirm()
     - aiCfgSelectPreset() / aiCfgSaveAsPreset() / aiCfgDoSaveAsPreset() / aiCfgDeletePreset()
     - aiCfgModelListHtml() / aiCfgToggleRouter() / aiCfgToggleEnabled() / aiCfgFetchModels()
   2026-09-21、肥大化したvja-yaml-editor.js（当時4915行）から分割した
   3つ目のファイル（1つ目: vja-editor-search.js、2つ目: vja-learned-fixes-ui.js）。
   この移動と合わせて、_initAiPresets()がvja-yaml-editor.js側にも
   完全に同一内容で重複定義されていた（実行時には後勝ちでこちら側の
   定義のみが有効な、無害だが死んだコード）ため、あわせて削除した。
═══════════════════════════════════════════════════════════════ */

// AIプリセットの初期化保証
function _initAiPresets() {
    if (!Array.isArray(getProjectData().aiPresets) || getProjectData().aiPresets.length === 0) {
        getProjectData().aiPresets = [
            {
                id: "preset-default-local",
                name: "ローカル (localhost:8080)",
                config: {
                    endpoint: "http://localhost:8080",
                    apiKey: "",
                    enabled: false,
                    routerMode: false,
                    model: "",
                    models: [],
                    maxTokens: "",
                    temperature: "",
                    thinking: true,
                    mockCheckEnabled: true,
                }
            },
            {
                id: "preset-default-openai",
                name: "OpenAI (gpt-4o-mini)",
                config: {
                    endpoint: "https://api.openai.com",
                    apiKey: "",
                    enabled: false,
                    routerMode: true,
                    model: "gpt-4o-mini",
                    models: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"],
                    maxTokens: "",
                    temperature: "",
                    thinking: true,
                    mockCheckEnabled: true,
                }
            }
        ];
    }
    if (!getProjectData().currentAiPresetId) {
        getProjectData().currentAiPresetId = getProjectData().aiPresets[0]?.id || "preset-default-local";
    }
}

// プロジェクト固有プリセット（getProjectData().aiPresets）と、
// プロジェクト共通プリセット（window._aiGlobalPresets、~/.vja-designer/ai-global-presets.json 由来）を
// 1つの一覧にまとめて返す。各要素にはどちらの区分かを示す scope（"project" / "global"）を必ず付与する
function _getAllAiPresets() {
    const projectPresets = (getProjectData().aiPresets || []).map(p => ({ ...p, scope: "project" }));
    const globalPresets = (window._aiGlobalPresets || []).map(p => ({ ...p, scope: "global" }));
    return [...projectPresets, ...globalPresets];
}

function openAiConfig() {
    _initAiPresets();

    // getProjectData().aiConfig の初期値保証
    if (!getProjectData().aiConfig.routerMode) getProjectData().aiConfig.routerMode = false;
    if (!getProjectData().aiConfig.apiKey) getProjectData().aiConfig.apiKey = "";
    if (!getProjectData().aiConfig.models) getProjectData().aiConfig.models = [];
    if (!getProjectData().aiConfig.endpoint) getProjectData().aiConfig.endpoint = "http://localhost:8080";
    if (getProjectData().aiConfig.thinking === undefined) getProjectData().aiConfig.thinking = true;
    if (getProjectData().aiConfig.mockCheckEnabled === undefined) getProjectData().aiConfig.mockCheckEnabled = true;

    const presets = _getAllAiPresets();
    let curPresetId = getProjectData().currentAiPresetId || presets[0]?.id;
    let curPreset = presets.find(p => p.id === curPresetId) || presets[0];
    if (curPreset) getProjectData().currentAiPresetId = curPreset.id;

    const presetOpts = presets.map(p => ({ value: p.id, label: (p.scope === "global" ? "🌐 共通: " : "📁 固有: ") + p.name }));

    const isEnabled = getProjectData().aiConfig.enabled === true;
    const isRouter = getProjectData().aiConfig.routerMode === true;
    const isThinking = getProjectData().aiConfig.thinking !== false;
    const isMockCheckEnabled = getProjectData().aiConfig.mockCheckEnabled !== false;
    const modelListHtml = aiCfgModelListHtml(getProjectData().aiConfig.models, getProjectData().aiConfig.model, isRouter);

    showModal(
        mhdrHTML("🤖 AI接続設定") +
        render("ye-tpl-ai-config-body", {
            presetSel: makePvSel("ai-preset-sel", presetOpts, curPresetId, "aiCfgSelectPreset({value})"),
            enaSel: makePvSel("ai-ena-sel", ["ON", "OFF"], isEnabled ? "ON" : "OFF", "aiCfgToggleEnabled({value})"),
            endpoint: getProjectData().aiConfig.endpoint,
            apiKey: getProjectData().aiConfig.apiKey,
            routerSel: makePvSel("ai-router-sel", ["ON", "OFF"], isRouter ? "ON" : "OFF", "aiCfgToggleRouter({value})"),
            modelRowStyle: !isRouter ? "opacity:.4;pointer-events:none" : "",
            attrModelOpen: evtAttr("onmousedown", "pvSelOpen('ai-model-sel',event)"),
            modelLabel: isRouter ? (getProjectData().aiConfig.model || "（モデルを選択）") : "",
            modelListHtml,
            attrFetch: evtAttr("onmousedown", "aiCfgFetchModels()"),
            maxTokens: String(getProjectData().aiConfig.maxTokens || ""),
            temperature: getProjectData().aiConfig.temperature !== "" && getProjectData().aiConfig.temperature != null ? String(getProjectData().aiConfig.temperature) : "",
            thinkingSel: makePvSel("ai-thinking-sel", ["ON", "OFF"], isThinking ? "ON" : "OFF", ""),
            mockCheckSel: makePvSel("ai-mockcheck-sel", ["ON", "OFF"], isMockCheckEnabled ? "ON" : "OFF", ""),
        }) +
        render("ye-tpl-ai-config-footer", {
            footBtns: mfootHTML([{ label: "キャンセル", action: "aiCfgCancel()" }]),
            attrConfirm: evtAttr("onmousedown", "aiCfgConfirm()"),
        })
    );
}
// AI接続設定モーダルのキャンセル。ウィザードから遷移中だった場合は、
// 保留していた次ステップへの継続コールバックも破棄し、ウィザードを中断する
function aiCfgCancel() {
    if (typeof WIZARD_STATE !== "undefined") WIZARD_STATE.resumeAfterAiConfig = null;
    closeModal();
}

async function aiCfgSelectPreset(presetId) {
    _initAiPresets();

    // 切替前に、現在選択中プリセットに対して未保存の変更がないか確認する
    const curId = getProjectData().currentAiPresetId;
    if (curId && curId !== presetId) {
        const curPreset = _getAllAiPresets().find(p => p.id === curId);
        if (curPreset) {
            const editedCfg = _readAiCfgFromForm();
            if (!deepEqual(editedCfg, curPreset.config)) {
                const doSave = await vja.app.showConfirm(
                    "現在の入力内容はプリセット「" + curPreset.name + "」の保存内容と異なります。\n" +
                    "プリセットとして保存しますか？\n（「いいえ」を選ぶと、保存せずに切り替えます）"
                );
                if (doSave) {
                    getProjectData().aiConfig = editedCfg;
                    aiCfgSaveAsPreset();
                    return;
                }
            }
        }
    }

    const p = _getAllAiPresets().find(item => item.id === presetId);
    if (!p) return;
    getProjectData().currentAiPresetId = p.id;
    getProjectData().aiConfig = { ...getProjectData().aiConfig, ...p.config };
    openAiConfig();
}

// AI接続設定モーダルの入力欄から、現在編集中の内容をaiConfig形式で読み取る
// （下部の「確定」ボタンと「💾 プリセット保存」の両方で使う共通処理）
function _readAiCfgFromForm() {
    const ep = $("ai-ep")?.value?.trim() || "http://localhost:8080";
    const apiKey = $("ai-apikey")?.value?.trim() || "";
    const modSel = document.querySelector("#ai-model-label");
    const rtrSel = document.querySelector("#ai-router-sel .pv-sel-btn span:first-child");
    const enaSel = document.querySelector("#ai-ena-sel .pv-sel-btn span:first-child");
    const thnSel = document.querySelector("#ai-thinking-sel .pv-sel-btn span:first-child");
    const mckSel = document.querySelector("#ai-mockcheck-sel .pv-sel-btn span:first-child");
    const routerMode = rtrSel?.textContent === "ON";
    const enabled = enaSel?.textContent === "ON";
    const thinking = thnSel?.textContent !== "OFF";
    const mockCheckEnabled = mckSel?.textContent !== "OFF";
    const model = modSel?.textContent || getProjectData().aiConfig.model || "";
    const maxTokensRaw = $("ai-max-tokens")?.value?.trim() || "";
    const maxTokens = maxTokensRaw !== "" ? parseInt(maxTokensRaw, 10) || "" : "";
    const temperatureRaw = $("ai-temperature")?.value?.trim() || "";
    const temperature = temperatureRaw !== "" ? parseFloat(temperatureRaw) : "";
    return {
        endpoint: ep, apiKey, enabled, routerMode, thinking, mockCheckEnabled,
        model: routerMode ? model : "", models: getProjectData().aiConfig.models || [],
        maxTokens, temperature
    };
}

function aiCfgSaveAsPreset() {
    getProjectData().aiConfig = _readAiCfgFromForm();

    // 現在選択中のプリセットがあれば、その名前・保存先区分を初期値として表示する
    // （同じ名前のまま保存＝上書き更新、という自然な導線にするため）
    const curPreset = _getAllAiPresets().find(p => p.id === getProjectData().currentAiPresetId);
    const curName = curPreset?.name || "";
    const curScope = curPreset?.scope || "project";

    showModal(
        mhdrHTML("💾 AI設定をプリセット保存") +
        render("ye-tpl-ai-preset-save-body", {
            curName,
            scopeSel: makePvSel("ai-preset-scope-sel", _AI_PRESET_SCOPE_OPTS, curScope, ""),
            footBtns: mfootHTML([{ label: "キャンセル", action: "openAiConfig()" }]),
            attrSave: evtAttr("onclick", "aiCfgDoSaveAsPreset()"),
        })
    );
}

// AIプリセットの保存先区分（プロジェクト固有 / プロジェクト共通）の選択肢
const _AI_PRESET_SCOPE_OPTS = [
    { value: "project", label: "📁 このプロジェクト固有" },
    { value: "global", label: "🌐 プロジェクト共通（他のプロジェクトからも選択可）" },
];

// pv-sel（ai-preset-scope-sel）の表示ラベルから、保存先区分の値（"project"/"global"）を逆引きする
function _readAiPresetScopeSel() {
    const label = document.querySelector("#ai-preset-scope-sel .pv-sel-btn span:first-child")?.textContent;
    const found = _AI_PRESET_SCOPE_OPTS.find(o => o.label === label);
    return found ? found.value : "project";
}

function aiCfgDoSaveAsPreset() {
    const name = $("ai-preset-name-in")?.value?.trim();
    if (!name) {
        showToast("プリセット名を入力してください");
        return;
    }
    _initAiPresets();
    const scope = _readAiPresetScopeSel();
    const config = { ...getProjectData().aiConfig };

    let id;
    let toastMsg;
    if (scope === "global") {
        if (!Array.isArray(window._aiGlobalPresets)) window._aiGlobalPresets = [];
        // 同名・同区分（プロジェクト共通）のプリセットが既にあれば新規作成せず上書き更新する
        const existing = window._aiGlobalPresets.find(p => p.name === name);
        if (existing) {
            existing.config = config;
            id = existing.id;
            toastMsg = "プリセット「" + name + "」を上書き保存しました";
        } else {
            id = "preset_" + Date.now();
            window._aiGlobalPresets.push({ id, name, config });
            toastMsg = "プリセット「" + name + "」を保存しました";
        }
        window.bunSaveAiGlobalPresets?.(window._aiGlobalPresets);
    } else {
        // 同名・同区分（プロジェクト固有）のプリセットが既にあれば新規作成せず上書き更新する
        const existing = getProjectData().aiPresets.find(p => p.name === name);
        if (existing) {
            existing.config = config;
            id = existing.id;
            toastMsg = "プリセット「" + name + "」を上書き保存しました";
        } else {
            id = "preset_" + Date.now();
            getProjectData().aiPresets.push({ id, name, config });
            toastMsg = "プリセット「" + name + "」を保存しました";
        }
    }
    getProjectData().currentAiPresetId = id;
    pushUndo();
    showToast(toastMsg);
    openAiConfig();
}

function aiCfgDeletePreset() {
    _initAiPresets();
    const allPresets = _getAllAiPresets();
    if (allPresets.length <= 1) {
        showToast("これ以上プリセットを削除することはできません");
        return;
    }
    const curId = getProjectData().currentAiPresetId;
    const cur = allPresets.find(p => p.id === curId);
    if (!cur) return;
    const deletedName = cur.name;
    if (cur.scope === "global") {
        window._aiGlobalPresets = (window._aiGlobalPresets || []).filter(p => p.id !== curId);
        window.bunSaveAiGlobalPresets?.(window._aiGlobalPresets);
    } else {
        getProjectData().aiPresets = (getProjectData().aiPresets || []).filter(p => p.id !== curId);
    }
    const remaining = _getAllAiPresets();
    getProjectData().currentAiPresetId = remaining[0]?.id || "";
    getProjectData().aiConfig = { ...getProjectData().aiConfig, ...(remaining[0]?.config || {}) };
    pushUndo();
    showToast("プリセット「" + deletedName + "」を削除しました");
    openAiConfig();
}

// モデルリストのHTML生成
function aiCfgModelListHtml(models, current, isRouter) {
    if (!isRouter || !models || models.length === 0) {
        return render("ye-tpl-model-empty", {});
    }
    return models.map(m => render("ye-tpl-model-opt", {
        active: m === current ? "active" : "",
        attr: evtAttr("onmousedown", "pvSelPick('ai-model-sel','" + String(m).replace(/'/g, "\\'") + "',event);$('ai-model-label').textContent='" + String(m).replace(/'/g, "\\'") + "'"),
        label: m,
    })).join("");
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

// 下部「確定」ボタン。あくまで「今編集中の内容を、現在有効なAI設定として反映する」だけの役割で、
// プリセットの中身は書き換えない（プリセットへの保存は常に「💾 プリセット保存」で明示的に行う）。
// 選択中プリセットと内容が異なる場合は「プリセット保存」を促す確認を挟む。
async function aiCfgConfirm() {
    const newCfg = _readAiCfgFromForm();

    _initAiPresets();
    const curPreset = _getAllAiPresets().find(p => p.id === getProjectData().currentAiPresetId);
    if (curPreset && !deepEqual(newCfg, curPreset.config)) {
        const doSave = await vja.app.showConfirm(
            "現在の入力内容はプリセット「" + curPreset.name + "」の保存内容と異なります。\n" +
            "プリセットとして保存しますか？\n（「いいえ」を選ぶと、保存せずにこのまま反映します）"
        );
        if (doSave) {
            getProjectData().aiConfig = newCfg;
            aiCfgSaveAsPreset();
            return;
        }
    }

    getProjectData().aiConfig = newCfg;
    closeModal();
    pushUndo();
    showToast("AI設定を反映しました");
    // ウィザードからの遷移中であれば、保存完了を受けてウィザードの次ステップへ戻る
    if (typeof WIZARD_STATE !== "undefined" && WIZARD_STATE.resumeAfterAiConfig) {
        const resume = WIZARD_STATE.resumeAfterAiConfig;
        WIZARD_STATE.resumeAfterAiConfig = null;
        resume();
    }
}

Object.assign(window, {
    openAiConfig, aiCfgModelListHtml, aiCfgToggleRouter, aiCfgToggleEnabled,
    aiCfgFetchModels, aiCfgConfirm, aiCfgCancel, aiCfgSelectPreset, aiCfgSaveAsPreset, aiCfgDoSaveAsPreset, aiCfgDeletePreset,
});
