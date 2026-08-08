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

const rpc = Electroview.defineRPC({
    maxRequestTime: Infinity,
    handlers: {
        requests: {
            testAddWidget: _testAddWidget,
            testDeleteWidget: _testDeleteWidget,
            testGetWidgets: _testGetWidgets,
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
        ...makeDialogHelpers(w),
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
