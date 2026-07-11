// src/mainview/bridge.ts
// Electrobun RPC ブリッジ + window.vja.* API

import { Electroview } from "electrobun/view";
import { makeFetchMaps, makeVjaFetch, makeFetchResultHandlers } from "./bridge-common";

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
const rpc = Electroview.defineRPC({
    maxRequestTime: Infinity,
    handlers: {
        requests: {},
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

// vja.db
w.vja = {
    db: {
        query: (sql: string, params?: any[]) =>
            r.dbQueryRequest({ sql, params }).then((res: any) => res.rows),
        execute: (sql: string, params?: any[]) =>
            r.dbExecuteRequest({ sql, params }).then((res: any) => res.ok ? res.result : null),
        transaction: (statements: { sql: string; params?: any[] }[]) =>
            r.dbTransactionRequest({ statements }).then((res: any) => res.ok),
        init: (ddlStatements: string[]) =>
            r.dbInitRequest({ ddlStatements }).then((res: any) => res.ok),
    },
    file: {
        read: (path: string) =>
            r.fileReadRequest({ path }).then((res: any) => res.ok ? res.content : null),
        write: (path: string, content: string) =>
            r.fileWriteRequest({ path, content }).then((res: any) => res.ok),
        readBytes: (path: string) =>
            r.fileReadBytesRequest({ path }).then((res: any) => res.data ? new Uint8Array(res.data) : null),
        writeBytes: (path: string, data: number[]) =>
            r.fileWriteBytesRequest({ path, data }).then((res: any) => res.ok),
        exists: (path: string) =>
            r.fileExistsRequest({ path }).then((res: any) => res.value),
        delete: (path: string) =>
            r.fileDeleteRequest({ path }).then((res: any) => res.ok),
        copy: (src: string, dest: string) =>
            r.fileCopyRequest({ src, dest }).then((res: any) => res.ok),
    },
    dir: {
        create: (path: string) =>
            r.dirCreateRequest({ path }).then((res: any) => res.ok),
        delete: (path: string) =>
            r.dirDeleteRequest({ path }).then((res: any) => res.ok),
        list: (path: string) =>
            r.dirListRequest({ path }).then((res: any) => res.entries),
        exists: (path: string) =>
            r.dirExistsRequest({ path }).then((res: any) => res.value),
    },
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
        showDialog: (message: string) =>
            new Promise<void>((resolve) => {
                // ダイアログ表示中にローディングオーバーレイが重なって見えなく
                // なる問題があったため、ダイアログ表示前に自動的にローディングを
                // OFFにする。必要であれば呼び出し側（生成コード）が再度ONにする。
                (w as any).vja?.ui?.loading?.(false);
                (w as any).showVjaAlert?.(message, () => resolve());
            }),
        showConfirm: (message: string) =>
            new Promise<boolean>((resolve) => {
                (w as any).vja?.ui?.loading?.(false);
                (w as any).showVjaDialog?.(message, (confirmed: boolean) =>
                    resolve(confirmed)
                );
            }),
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
