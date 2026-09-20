// src/mainview/bridge.ts
// Electrobun RPC ブリッジ + window.vja.* API

import { Electroview } from "electrobun/view";
import {
    makeFetchMaps, makeVjaFetch, makeFetchResultHandlers,
    makeDbWrappers, makeFileWrappers, makeDirWrappers, makeDialogHelpers,
} from "./bridge-common";

// fetch は複数同時リクエスト対応のため fetchId ベースのMapで管理（bridge-common）
const { fetchPendingMap: _fetchPendingMap, fetchAbortPendingMap: _fetchAbortPendingMap } = makeFetchMaps();

// ── プロジェクト停止（stopProject）専用の待機キュー ───────
// stopProjectRequest/stopProjectResultは「明示的な停止呼び出しの応答」と
// 「プロジェクトウィンドウが×ボタン等で予期せず閉じられた場合の通知」を
// 兼ねており、1回のrequestに対し1回のresponseが返るという関係にならない
// ため、electrobunの`requests`機構には乗せられずmessagesのまま扱う。
// 以前は単一スロット（pending.stopProject）で管理しており、連続呼び出しで
// 上書きされるとハングするバグがあったため、待機者を配列で保持し、
// stopProjectResultを受け取った時点で待っている全員を解決する
// （タイムアウトは設けない方針のため、応答が来るまで待ち続ける）。
let _stopProjectWaiters: Array<(v: { ok: boolean }) => void> = [];
const _waitStopProject = (): Promise<{ ok: boolean }> => new Promise((resolve) => {
    _stopProjectWaiters.push(resolve);
});

// ── Electroview RPC 定義 ──────────────────────────────
// maxRequestTime: Infinity（タイムアウト無し）。理由はsrc/bun/index.tsの
// 同項目コメント参照（openFileRequest等ユーザー操作待ちのrequestと、
// dbQuery等の高速なrequestが同一RPCインスタンス上に混在するため）。
// ── テスト自動化用ハンドラ ────────────────────────────
// MCPサーバー（mcp/vja-mcp-server.ts）がsrc/bun/index.tsのテスト用HTTP
// サーバー経由でこれらを呼び出す。呼び出し経路自体がVJA_TEST_MODE=1の時
// しか起動しないため、常時ハンドラを登録していても通常起動時は影響しない
// （詳細はsrc/shared/types.tsのVjaRPCType.webview.requestsコメント参照）。
// ダイアログ確認（vja.app.showConfirm等）を伴う既存関数（deleteYaml等）は
// 自動化に不向きなため使わず、データ操作部分のみを直接再実装している。
const _testAddWidget = (p: { tag: string; x: number; y: number; w: number; h: number }) => {
    const g = window as any;
    try {
        const tool = g.getToolById(p.tag);
        if (!tool) return { ok: false, error: `未知のウィジェットタグ: ${p.tag}` };
        const widget = g.addWidget(tool, p.x, p.y, p.w, p.h);
        return { ok: true, id: widget.id };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
const _testDeleteWidget = (p: { id: number }) => {
    const g = window as any;
    try {
        if (!g.getWidget(p.id)) return { ok: false, error: `ウィジェットが見つかりません: id=${p.id}` };
        g.getDesignerState().selIds = [p.id];
        g.actDelete();
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
const _testGetWidgets = () => {
    const g = window as any;
    try {
        return { ok: true, widgets: g.getProjectData().widgets };
    } catch (e: any) {
        return { ok: false, widgets: [], error: e.message };
    }
};
// JS整形（Prettier）の動作確認用。formatJsCode()（vja-yaml-editor.js）を
// 直接呼び出し、整形結果をそのまま返す。
const _testFormatJs = async (p: { code: string }) => {
    const g = window as any;
    try {
        const formatted = await g.formatJsCode(p.code);
        return { ok: true, code: formatted };
    } catch (e: any) {
        return { ok: false, code: p.code, error: e.message };
    }
};
const _testSaveYaml = (p: { wid: number; evName: string; yaml: string }) => {
    const g = window as any;
    try {
        const w = g.getWidget(p.wid);
        if (!w) return { ok: false, error: `ウィジェットが見つかりません: id=${p.wid}` };
        if (!w.events) w.events = {};
        w.events[p.evName] = p.yaml;
        g.renderEventsAndPush();
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
const _testDeleteYaml = (p: { wid: number; evName: string }) => {
    const g = window as any;
    try {
        const w = g.getWidget(p.wid);
        if (!w) return { ok: false, error: `ウィジェットが見つかりません: id=${p.wid}` };
        if (w.events) delete w.events[p.evName];
        g.purgeOverridesForKey(p.wid, p.evName);
        g.renderEventsAndPush();
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// ウィジェットを選択状態にする（プロパティパネル描画結果の検証用）
const _testSelectWidget = (p: { id: number }) => {
    const g = window as any;
    try {
        if (!g.getWidget(p.id)) return { ok: false, error: `ウィジェットが見つかりません: id=${p.id}` };
        g.select(p.id);
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// プロパティパネルの表示タブを切り替える（"p"=プロパティ, "e"=イベント）
const _testSwitchTab = (p: { tab: "p" | "e" }) => {
    const g = window as any;
    try {
        g.switchTab(p.tab);
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// 指定ウィジェットidのDOM要素（#w{id}）のinnerHTMLをそのまま返す
// （jhtmlテンプレート移行の検証用。WIDGET_DEFS[tag].previewの描画結果を確認する）
const _testGetWidgetHtml = (p: { id: number }) => {
    try {
        const el = document.getElementById("w" + p.id);
        return { ok: true, html: el?.innerHTML ?? "" };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// 現在描画されているプロパティパネル/イベントタブのHTMLをそのまま返す
// （画面を目視しなくても、render()等の描画結果が壊れていないか検証できるようにするため）
const _testGetPropsHtml = () => {
    try {
        return {
            ok: true,
            plist: document.getElementById("plist")?.innerHTML ?? "",
            elist: document.getElementById("elist")?.innerHTML ?? "",
            toolGrid: document.getElementById("tool-grid")?.innerHTML ?? "",
            stTool: document.getElementById("st-tool")?.innerHTML ?? "",
            stPos: document.getElementById("st-pos")?.innerHTML ?? "",
            stSize: document.getElementById("st-size")?.innerHTML ?? "",
            stCnt: document.getElementById("st-cnt")?.innerHTML ?? "",
            stGrid: document.getElementById("st-grid")?.innerHTML ?? "",
            stSnap: document.getElementById("st-snap")?.innerHTML ?? "",
        };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// 指定ウィジェット・イベントのYAMLエディタモーダルを開き、描画結果のHTMLを返す
// （jhtmlテンプレート移行の検証用。右パネル（定数/画面/ウィジェット/テーブル/検証）の確認に使う）
const _testOpenYamlEditor = (p: { wid: number; evName: string }) => {
    const g = window as any;
    try {
        g.openYaml(p.wid, p.evName);
        return { ok: true, modalRoot: document.getElementById("modal-root")?.innerHTML ?? "" };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// テーブル編集モーダル（新規作成/idx指定編集）を開き、描画結果のHTMLを返す
// （jhtmlテンプレート移行の検証用）
const _testOpenTableEdit = (p: { idx: number }) => {
    const g = window as any;
    try {
        g.openTableEdit(p.idx);
        return { ok: true, modalRoot: document.getElementById("modal-root")?.innerHTML ?? "" };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// バリデーション編集モーダル（新規作成/idx指定編集）を開き、描画結果のHTMLを返す
// （jhtmlテンプレート移行の検証用）
const _testOpenValidationEdit = (p: { idx: number }) => {
    const g = window as any;
    try {
        g.openValidationEdit(p.idx);
        return { ok: true, modalRoot: document.getElementById("modal-root")?.innerHTML ?? "" };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// クラウドインフラ設定モーダルを開き、描画結果のHTMLを返す（jhtmlテンプレート移行の検証用）
const _testRenderCloudModal = () => {
    const g = window as any;
    try {
        g.renderCloudModal();
        return { ok: true, modalRoot: document.getElementById("modal-root")?.innerHTML ?? "" };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// 引数無しでモーダルを開く関数を安全に呼び出し、描画結果のHTMLを返す
// （jhtmlテンプレート移行の検証用。任意コード実行を避けるためホワイトリスト方式）
const _TEST_OPEN_MODAL_FNS = [
    "openProjectInfo", "openAppEvents", "openExtRuntime",
    "openFormConstEditor", "openCloudInfraConfig", "openFontConfig",
    "openDebugTools", "openApiRef", "openAiValidationDetailModal", "openFormDesignAi",
    "openAiConfig", "openConstEditor", "openTableManager", "openValidationEditor",
    "openLearnedFixesModal", "openFormDesignTemplateModal",
];
const _testOpenModal = (p: { fn: string }) => {
    const g = window as any;
    try {
        if (!_TEST_OPEN_MODAL_FNS.includes(p.fn)) return { ok: false, error: `許可されていない関数: ${p.fn}` };
        if (typeof g[p.fn] !== "function") return { ok: false, error: `関数が見つかりません: ${p.fn}` };
        g[p.fn]();
        return {
            ok: true,
            modalRoot: document.getElementById("modal-root")?.innerHTML ?? "",
            modalLayer1: document.getElementById("modal-layer-1")?.innerHTML ?? "",
        };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
const _testGetOverrides = (p: { wid: number; evName: string }) => {
    const g = window as any;
    try {
        const key = `${p.wid}_${p.evName}`;
        const overrides: Record<string, any> = {};
        (g.OVERRIDE_MAP_NAMES as string[]).forEach((name) => {
            const map = g.getProjectData()[name];
            if (map && key in map) overrides[name] = map[key];
        });
        return { ok: true, overrides };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};

// ── Validate関連 ──────────────────────────────────────
// validSave()/tblSave()等はDOM（$("valid-name")等）から値を読むため
// 自動化に不向き。データ検証ロジックのみを直接再実装している。
const _curForm = () => {
    const g = window as any;
    return g.getProjectData().forms[g.getProjectData().curFormIdx];
};
const _testGetValidations = () => {
    try {
        return { ok: true, validations: _curForm().validations || [] };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
const _testSaveValidation = (p: { idx: number; name: string; description?: string; toastDuration?: number; rules?: any[] }) => {
    try {
        const f = _curForm();
        if (!p.name?.trim()) return { ok: false, error: "定義名を入力してください" };
        if (!Array.isArray(f.validations)) f.validations = [];
        const validRules = (p.rules || []).filter((r: any) => r.name?.trim() && r.type);
        const saveData = { name: p.name.trim(), description: p.description || "", toastDuration: p.toastDuration || 5000, rules: validRules };
        const idx = p.idx < 0 ? f.validations.length : p.idx;
        if (p.idx < 0) f.validations.push(saveData);
        else f.validations[p.idx] = saveData;
        (window as any).pushUndo();
        return { ok: true, idx };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
const _testDeleteValidation = (p: { idx: number }) => {
    try {
        const f = _curForm();
        if (!f.validations?.[p.idx]) return { ok: false, error: `バリデーション定義が見つかりません: idx=${p.idx}` };
        f.validations.splice(p.idx, 1);
        (window as any).pushUndo();
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
const _testGetTables = () => {
    try {
        return { ok: true, tables: (window as any).getProjectData().tables || [] };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
const _testSaveTable = (p: { idx: number; name: string; description?: string; columns: any[] }) => {
    const g = window as any;
    try {
        const tables = g.getProjectData().tables;
        if (!p.name?.trim()) return { ok: false, error: "テーブル名を入力してください" };
        const name = p.name.trim();
        const dupIdx = tables.findIndex((t: any, i: number) => t.name === name && i !== p.idx);
        if (dupIdx >= 0) return { ok: false, error: `テーブル名「${name}」は既に存在します` };
        const validCols = (p.columns || []).filter((c: any) => c.name?.trim());
        if (validCols.length === 0) return { ok: false, error: "カラムを1つ以上定義してください" };
        for (const c of validCols) {
            if (!c.useDefault) continue;
            if (!c.default || c.default.trim() === "") {
                c.default = g.defaultValueForType(c.type);
            } else if (!g.validateDefaultValue(c.type, c.default.trim())) {
                return { ok: false, error: `カラム「${c.name}」のDEFAULT値が不正です（型: ${c.type}）` };
            }
        }
        const tbl = { name, description: p.description || "", columns: validCols, updatedAt: new Date().toISOString() };
        const idx = p.idx < 0 ? tables.length : p.idx;
        if (p.idx < 0) tables.push(tbl);
        else tables[p.idx] = tbl;
        g.pushUndo();
        return { ok: true, idx };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
const _testDeleteTable = (p: { idx: number }) => {
    const g = window as any;
    try {
        const tables = g.getProjectData().tables;
        if (!tables?.[p.idx]) return { ok: false, error: `テーブルが見つかりません: idx=${p.idx}` };
        tables.splice(p.idx, 1);
        g.pushUndo();
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
const _testGenerateDdl = (p: { name: string; description?: string; columns: any[] }) => {
    try {
        const ddl = (window as any).generateDDL({ name: p.name, description: p.description || "", columns: p.columns || [] });
        return { ok: true, ddl };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};

// ── ウィザードAI呼び出し関連（AI応答をモック化してテストする） ──────
// runAiGenerate()（vja-modal.js）は window.__vjaTestAiMockQueue に応答が
// 積まれている場合、実際のAI API呼び出しをスキップしてそれを1つずつ消費する。
// これを利用し、ウィザードのAI呼び出し部分（wizardDecomposeForms等）を
// 実AI無しで自動テストできるようにする。
const _testSetAiMockQueue = (p: { responses: string[] }) => {
    try {
        (window as any).__vjaTestAiMockQueue = Array.isArray(p.responses) ? [...p.responses] : [];
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// 実AI（ローカルLLM等）へ実際に接続してテストする場合に、AI接続設定
// （getProjectData().aiConfig）を差し替えるためのテスト用ハンドラ。
const _testSetAiConfig = (p: { endpoint?: string; model?: string; apiKey?: string; temperature?: number | string }) => {
    const g = window as any;
    try {
        const ac = g.getProjectData().aiConfig;
        if (p.endpoint !== undefined) ac.endpoint = p.endpoint;
        if (p.model !== undefined) ac.model = p.model;
        if (p.apiKey !== undefined) ac.apiKey = p.apiKey;
        if (p.temperature !== undefined) ac.temperature = p.temperature;
        return { ok: true, aiConfig: ac };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// wizardDecomposeForms()の動作確認用。アプリ概要・確定テーブル・システムモデル
// ヒントをWIZARD_STATE/getProjectData()へ注入した上で呼び出し、結果の
// formPlan（WIZARD_STATE.formPlan）を返す。事前にtestSetAiMockQueueで
// モック応答（画面構成分解結果のJSON文字列）を積んでおく必要がある。
const _testWizardDecomposeForms = async (p: { appOverview: string; tables?: any[]; systemModelHint?: string | null }) => {
    const g = window as any;
    try {
        if (Array.isArray(p.tables)) g.getProjectData().tables = p.tables;
        g.WIZARD_STATE.appOverview = p.appOverview || "";
        g.WIZARD_STATE.systemModelHint = p.systemModelHint ?? null;
        await g.wizardDecomposeForms();
        return { ok: true, formPlan: g.WIZARD_STATE.formPlan };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// wizardGenerateFormYaml()（DOM非依存版、画面デザインYAMLドラフト→YAML生成）の
// 動作確認用。事前にtestSetAiMockQueueでモック応答（YAML文字列）を積んでおく必要がある。
const _testWizardGenerateFormYaml = async (p: { docDraft: string }) => {
    const g = window as any;
    try {
        const result = await g.wizardGenerateFormYaml(p.docDraft);
        if (!result) return { ok: false, error: "生成に失敗しました" };
        return { ok: true, yaml: result.yaml, layoutPatternId: result.layoutPatternId };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// wizardGenerateFormLayout()（DOM非依存版、YAML→画面レイアウト生成）の動作確認用。
// 事前にtestSetAiMockQueueでモック応答（ウィジェット配置JSON文字列）を積んでおく必要がある。
// 成功時は反映結果として現在フォームのウィジェット一覧を返す。
const _testWizardGenerateFormLayout = async (p: { yamlText: string; layoutPatternId?: string }) => {
    const g = window as any;
    try {
        const ok = await g.wizardGenerateFormLayout(p.yamlText, p.layoutPatternId || "");
        if (!ok) return { ok: false, error: "生成に失敗しました" };
        return { ok: true, widgets: g.getProjectData().widgets };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};

// tblAiGenerateSchema()（テーブルスキーマAI生成）の動作確認用。DOM(依頼文textarea)・
// TABLE_MODAL.edit・確認ダイアログを介さず、同等のロジック（プロンプト生成→
// runAiGenerate→JSON.parse→sanitizeAiTableColumns）を直接再現する。
// 事前にtestSetAiMockQueueでモック応答（columns配列のJSON文字列）を積んでおく必要がある。
const _testTblAiGenerateSchema = async (p: { tableName?: string; description?: string; requestText: string }) => {
    const g = window as any;
    try {
        const sysPrompt = g._PROMPT_DEF.TABLE_SCHEMA_GEN_SYS_PROMPT({ tableName: p.tableName || "", description: p.description || "" });
        const userPrompt = g._PROMPT_DEF.TABLE_SCHEMA_GEN_USER_PROMPT(p.requestText || "");
        let result: any = null;
        await g.runAiGenerate({
            systemPrompt: sysPrompt,
            userPrompt: userPrompt,
            loadingMsg: "テーブル構成を生成中…",
            onSuccess: async (generated: string) => {
                const cols = JSON.parse(generated);
                if (!Array.isArray(cols) || cols.length === 0) throw new Error("empty");
                result = g.sanitizeAiTableColumns(cols);
            },
            onCancel: async () => {},
            onError: async () => {},
        });
        if (!result || result.length === 0) return { ok: false, error: "AI生成結果の解析に失敗、またはカラムがありませんでした" };
        return { ok: true, columns: result };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// validAiGenerateRules()（バリデーションルールAI生成）の動作確認用。DOM(依頼文textarea)・
// VALID_MODAL.edit・確認ダイアログを介さず、同等のロジックを直接再現する。
// widgetNames未指定時は現在フォームの入力系ウィジェット名一覧をそのまま使う。
// 事前にtestSetAiMockQueueでモック応答（rules配列のJSON文字列）を積んでおく必要がある。
const _testValidAiGenerateRules = async (p: { name?: string; description?: string; requestText: string; widgetNames?: string[] }) => {
    const g = window as any;
    try {
        const INPUT_TAGS = ["inputtype", "textarea", "checkbox", "radiobutton", "selectBox", "listbox", "slider"];
        const widgetNames: string[] = Array.isArray(p.widgetNames) ? p.widgetNames : (g.getProjectData().forms[g.getProjectData().curFormIdx]?.widgets || [])
            .filter((w: any) => INPUT_TAGS.includes(w.tag))
            .map((w: any) => w.name)
            .filter(Boolean);
        if (widgetNames.length === 0) return { ok: false, error: "フォームに入力系ウィジェットがありません（AI生成の対象がありません）" };

        const sysPrompt = g._PROMPT_DEF.VALIDATION_SCHEMA_GEN_SYS_PROMPT({
            name: p.name || "", description: p.description || "", widgetsCtx: widgetNames.join("\n"),
        });
        const userPrompt = g._PROMPT_DEF.VALIDATION_SCHEMA_GEN_USER_PROMPT(p.requestText || "");
        let result: any = null;
        await g.runAiGenerate({
            systemPrompt: sysPrompt,
            userPrompt: userPrompt,
            loadingMsg: "バリデーションルールを生成中…",
            onSuccess: async (generated: string) => {
                const rules = JSON.parse(generated);
                if (!Array.isArray(rules)) throw new Error("not array");
                result = rules
                    .filter((r: any) => widgetNames.includes(r.name))
                    .map((r: any) => ({
                        name: r.name,
                        type: g.VALIDATION_TYPES.some((t: any) => t.value === r.type) ? r.type : "required",
                        not: !!r.not,
                        arg1: r.arg1 != null ? String(r.arg1) : "",
                        arg2: r.arg2 != null ? String(r.arg2) : "",
                        arg3: r.arg3 != null ? String(r.arg3) : "",
                        message: r.message != null ? String(r.message) : "",
                    }));
            },
            onCancel: async () => {},
            onError: async () => {},
        });
        if (!result || result.length === 0) return { ok: false, error: "AI生成結果の解析に失敗、または有効なルールがありませんでした" };
        return { ok: true, rules: result };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};

// extRtGenDoc()（拡張ランタイムJS→AI向け説明文生成）の動作確認用。DOM(textarea)・
// 確認ダイアログを介さず、DOM非依存版のgenerateExtRuntimeDoc()を直接呼び出す。
// 事前にtestSetAiMockQueueでモック応答（doc文字列）を積んでおく必要がある。
const _testExtRtGenDoc = async (p: { js: string }) => {
    const g = window as any;
    try {
        const doc = await g.generateExtRuntimeDoc(p.js || "");
        if (doc === null) return { ok: false, error: "生成に失敗しました" };
        return { ok: true, doc };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// manualRetryAiFix()（AI生成コードの手動修正依頼）の動作確認用。DOM(js-taへの
// 読み書き・タブ切替・モーダル再描画)を介さず、DOM非依存版のretryAiFix()を直接
// 呼び出す。currentCodeが既存検証に通れば{alreadyOk:true}を返し、AIは呼ばない。
// 通らない場合のみtestSetAiMockQueueでモック応答（修正後のJSコード）を積んでおく必要がある。
const _testManualRetryAiFix = async (p: { wid: number | string; evName: string; isAppEvent?: boolean; isFormEvent?: boolean; currentCode: string }) => {
    const g = window as any;
    try {
        const result = await g.retryAiFix(p.wid, p.evName, !!p.isAppEvent, !!p.isFormEvent, p.currentCode || "");
        if (!result) return { ok: false, error: "生成に失敗しました" };
        return { ok: true, ...result };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// formDesignTextToYamlGenerate()（画面デザインYAMLドラフト自動生成）の動作確認用。
// DOM(textarea)・確認ダイアログを介さず、DOM非依存版のgenerateFormDesignYaml()
// （wizardGenerateFormYaml()と共通のロジック本体）を直接呼び出す。
// 事前にtestSetAiMockQueueでモック応答（画面デザインYAML文字列）を積んでおく必要がある。
const _testFormDesignTextToYamlGenerate = async (p: { inputText: string }) => {
    const g = window as any;
    try {
        const result = await g.generateFormDesignYaml(p.inputText || "", g.getProjectData().tables || []);
        if (!result) return { ok: false, error: "生成に失敗しました" };
        return { ok: true, yaml: result.yaml, layoutPatternId: result.layoutPatternId };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// yamlAiGenerate()（イベントJS自動生成）の動作確認用。DOM(ボタン活性制御・
// ステータステキスト・タブ切替・モーダル再描画)を介さず、DOM非依存版の
// generateEventJs()を直接呼び出す。1回検証NGなら自動修正リトライを1回だけ
// 行う（元の実装と同一）。対象イベントのYAMLは事前にtestSaveYaml等で
// データモデルへ保存しておくこと（$("yaml-ta")経由では読まないため、
// _buildGenPromptContext内の絞り込みはYAML未設定時と同様のフォールバックになる）。
// 検証NG時のリトライも含めAI呼び出しが複数回起きるため、モック使用時は
// testSetAiMockQueueに必要な件数（通常1〜2件）を積んでおくこと。
const _testYamlAiGenerate = async (p: { wid: number | string; evName: string; isAppEvent?: boolean; isFormEvent?: boolean; temperatureOverride?: number }) => {
    const g = window as any;
    try {
        const result = await g.generateEventJs(p.wid, p.evName, !!p.isAppEvent, !!p.isFormEvent, p.temperatureOverride);
        if (!result || !result.ok) return { ok: false, error: result?.reason || "生成に失敗しました" };
        return { ok: true, finalCode: result.finalCode, validation: result.validation };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// formDesignAiGenerate()（画面デザインAI生成、既存ウィジェット全削除＋反映）の
// 動作確認用。DOM(確認ダイアログ・textarea・ボタン活性制御)を介さず、DOM非依存版の
// generateFormDesignAiLayout()を直接呼び出す。既存ウィジェットの全削除という
// 破壊的操作を実際に行うため、テスト対象フォームの状態に注意すること。
// 事前にtestSetAiMockQueueでモック応答（ウィジェット配置JSON文字列）を積んでおく必要がある。
const _testFormDesignAiGenerate = async (p: { rawText: string; addPrompt?: string }) => {
    const g = window as any;
    try {
        const result = await g.generateFormDesignAiLayout(p.rawText || "", p.addPrompt || "");
        return { ok: result.ok, ...result };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
// textToYamlGenerate()（イベントYAMLドラフト自動生成）の動作確認用。DOM(textarea)・
// 確認ダイアログを介さず、DOM非依存版のgenerateTextToYaml()を直接呼び出す。
// wid: ウィジェットID、"form"（フォームイベント）、"appev"（アプリイベント）のいずれか。
// 成功時は生成YAMLに加え、実際にデータモデルへ書き込まれた内容も返す。
// 事前にtestSetAiMockQueueでモック応答（YAML文字列）を積んでおく必要がある。
const _testTextToYamlGenerate = async (p: { wid: string | number; evName: string; inputText: string }) => {
    const g = window as any;
    try {
        const yaml = await g.generateTextToYaml(p.wid, p.evName, p.inputText || "");
        if (yaml === null) return { ok: false, error: "生成に失敗しました" };
        return { ok: true, yaml };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};

const rpc = Electroview.defineRPC({
    maxRequestTime: Infinity,
    handlers: {
        requests: {
            testAddWidget: _testAddWidget,
            testDeleteWidget: _testDeleteWidget,
            testGetWidgets: _testGetWidgets,
            testSelectWidget: _testSelectWidget,
            testSwitchTab: _testSwitchTab,
            testGetWidgetHtml: _testGetWidgetHtml,
            testGetPropsHtml: _testGetPropsHtml,
            testOpenYamlEditor: _testOpenYamlEditor,
            testOpenTableEdit: _testOpenTableEdit,
            testOpenValidationEdit: _testOpenValidationEdit,
            testRenderCloudModal: _testRenderCloudModal,
            testOpenModal: _testOpenModal,
            testFormatJs: _testFormatJs,
            testSaveYaml: _testSaveYaml,
            testDeleteYaml: _testDeleteYaml,
            testGetOverrides: _testGetOverrides,
            testGetValidations: _testGetValidations,
            testSaveValidation: _testSaveValidation,
            testDeleteValidation: _testDeleteValidation,
            testGetTables: _testGetTables,
            testSaveTable: _testSaveTable,
            testDeleteTable: _testDeleteTable,
            testGenerateDdl: _testGenerateDdl,
            testSetAiMockQueue: _testSetAiMockQueue,
            testSetAiConfig: _testSetAiConfig,
            testWizardDecomposeForms: _testWizardDecomposeForms,
            testWizardGenerateFormYaml: _testWizardGenerateFormYaml,
            testWizardGenerateFormLayout: _testWizardGenerateFormLayout,
            testTblAiGenerateSchema: _testTblAiGenerateSchema,
            testValidAiGenerateRules: _testValidAiGenerateRules,
            testExtRtGenDoc: _testExtRtGenDoc,
            testTextToYamlGenerate: _testTextToYamlGenerate,
            testManualRetryAiFix: _testManualRetryAiFix,
            testFormDesignTextToYamlGenerate: _testFormDesignTextToYamlGenerate,
            testYamlAiGenerate: _testYamlAiGenerate,
            testFormDesignAiGenerate: _testFormDesignAiGenerate,
        },
        messages: {
            loadScriptResult: (v: any) => { /* フロント側で処理 */ },
            stopProjectResult: (v: any) => {
                const waiters = _stopProjectWaiters;
                _stopProjectWaiters = [];
                waiters.forEach((resolve) => resolve(v));
                // 常にボタン状態をリセット（×ボタンで閉じた場合も含む）
                try {
                    const runBtn = document.getElementById("btn-run-project") as HTMLButtonElement | null;
                    const stopBtn = document.getElementById("btn-stop-project") as HTMLButtonElement | null;
                    if (runBtn) { runBtn.style.display = ""; runBtn.disabled = false; }
                    if (stopBtn) stopBtn.style.display = "none";
                } catch (e: any) { console.debug("[stopProjectResult] DOM update failed:", e.message); }
            },
            ...makeFetchResultHandlers(_fetchPendingMap, _fetchAbortPendingMap),
        },
    },
});
const _ev = new Electroview({ rpc });
const s = _ev.rpc.send;
const r = _ev.rpc.request;

// ── window.vja.* API ─────────────────────────────────
const w = window as any;

w.bunOpenFile = (a: any) => r.openFileRequest(a);
w.bunSaveProject = (a: any) => r.saveFileRequest(a);
w.bunSaveGenericFile = (a: any) => r.saveGenericFileRequest(a);
w.bunCloseApp = () => s.closeAppRequest({});
w.bunToggleDevTools = () => s.toggleDevToolsRequest({});
w.bunSaveCloudInfras = (infras: any[]) => r.saveCloudInfrasRequest({ infras });
w.bunCompileProject = () => r.compileProjectRequest({});
w.bunGetCloudInfras = () => r.getCloudInfrasRequest({});
w.bunGetDecryptedCredential = (infraId: string, key: string) =>
    r.getDecryptedCredentialRequest({ infraId, key });
w.bunOpenFolder = (path: string) => s.openFolderRequest({ path });
w.bunGetVersion = () => r.getVersionRequest({});
w.bunSaveUiConfig = (uiFontSize: number, uiFontFamily: string, editorFontSize: number, editorFontFamily: string, leftPanelW: number, rightPanelW: number) =>
    s.saveUiConfigRequest({ uiFontSize, uiFontFamily, editorFontSize, editorFontFamily, leftPanelW, rightPanelW });
w.bunLoadUiConfig = () => r.loadUiConfigRequest({});
w.bunLoadAiGlobalPresets = () => r.loadAiGlobalPresetsRequest({});
w.bunSaveAiGlobalPresets = (presets: any[]) => s.saveAiGlobalPresetsRequest({ presets });

// vja.db
w.vja = {
    db: {
        ...makeDbWrappers(r),
        init: (ddlStatements: string[]) =>
            r.dbInitRequest({ ddlStatements }).then((res: any) => res.ok),
    },
    file: makeFileWrappers(r),
    dir: makeDirWrappers(r),
    log: {
        trace: (message: string) => { try { s.logRequest({ level: "trace", message }); } catch(e: any) { console.debug(e.message); } },
        debug: (message: string) => { try { s.logRequest({ level: "debug", message }); } catch(e: any) { console.debug(e.message); } },
        info:  (message: string) => { try { s.logRequest({ level: "info",  message }); } catch(e: any) { console.info(e.message); } },
        warn:  (message: string) => { try { s.logRequest({ level: "warn",  message }); } catch(e: any) { console.warn(e.message); } },
        error: (message: string) => { try { s.logRequest({ level: "error", message }); } catch(e: any) { console.error(e.message); } },
        log:   (message: string) => { try { s.logRequest({ level: "log",   message }); } catch(e: any) { console.log(e.message); } },
    },
    app: {
        getInfo: () => r.appInfoRequest({}),
        // VJA本体（ディスプレイ作業領域）サイズ取得。ウィザードの画面サイズ
        // （大中小）選択で基準値として使う
        getDisplayWorkArea: () => r.getDisplayWorkAreaRequest({}),
        ...makeDialogHelpers(w),
    },
    // ── JS整形（Prettier、AI生成コードの整形用） ──────
    editor: {
        formatJs: (code: string, indentSize?: number) =>
            r.formatJsRequest({ code, indentSize }),
    },
    // ── ウィザード: システムモデル定義（src/wizard-system-models/） ──
    wizard: {
        getSystemModelSummaries: () => r.wizardSystemModelSummariesRequest({}),
        getSystemModelDetail: (id: string) => r.wizardSystemModelDetailRequest({ id }),
    },
    // ── プロジェクト実行 ──────────────────────────────
    project: {
        run: () =>
            r.runProjectRequest({ projectData: JSON.stringify((window as any)._getProjectData?.() || {}) }),
        stop: () => {
            s.stopProjectRequest({});
            return _waitStopProject();
        },
        navigate: (formName: string) =>
            r.navigateFormRequest({ formName }).then(() => { }),
        clearDb: () =>
            r.clearProjectDbRequest({}).then((res: any) => { if (!res.ok) throw new Error(res.error || "clearDb failed"); }),
    },
    // ── セッション管理 ────────────────────────────────
    session: {
        get: (key: string, defaultVal: any = null) =>
            r.sessionGetRequest({ key }).then((res: any) => res.value !== null ? res.value : defaultVal),
        set: (key: string, value: string | null) =>
            r.sessionSetRequest({ key, value }).then((res: any) => res.ok),
        delete: (key: string) =>
            r.sessionSetRequest({ key, value: null }).then((res: any) => res.ok),
        clear: () =>
            r.sessionSetRequest({ key: "__clear_all__", value: "__clear__" }).then((res: any) => res.ok),
    },
};

// vja.fetch / vja.fetchAbort（Bun経由の汎用fetch、WebKitタイムアウト回避）
const _vjaFetch = makeVjaFetch(_fetchPendingMap, _fetchAbortPendingMap, s.fetchRequest, s.fetchAbortRequest);
w.vja.fetch = _vjaFetch.fetch;
w.vja.fetchAbort = _vjaFetch.fetchAbort;

// vja.cloud
w.vja.cloud = w.vja.cloud || {};
w.vja.cloud.list = () =>
    r.getCloudInfrasRequest({}).then((res: any) => res.infras);
w.vja.cloud.getCredential = (infraId: string, key: string) =>
    r.getDecryptedCredentialRequest({ infraId, key }).then((res: any) => res.value);

// bridge.ts 読み込み完了後、コンソールのキューを flush
if (typeof (window as any)._flushLogQueue === "function") {
    (window as any)._flushLogQueue();
}

// bridge.tsロード完了時にUI設定を自動読み込み
r.loadUiConfigRequest({}).then((v: any) => {
    if (typeof (w as any)._onLoadUiConfigResult === "function") {
        (w as any)._onLoadUiConfigResult(v);
    }
});

// bridge.tsロード完了時にAI接続設定「プロジェクト共通」プリセットを自動読み込み
r.loadAiGlobalPresetsRequest({}).then((v: any) => {
    (w as any)._aiGlobalPresets = v.presets || [];
});
