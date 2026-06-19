// src/mainview/bridge.ts
// Electrobun RPC ブリッジ + window.vja.* API

import { Electroview } from "electrobun/view";
import type { DbRow, DbResult } from "../shared/types";

// ── コールバック待機マップ ────────────────────────────
type Resolver<T> = (v: T) => void;
type Rejecter = (e: Error) => void;

interface Pending<T> { resolve: Resolver<T>; reject: Rejecter; }

const pending = {
    openFile: null as Pending<{ content: string | null; path: string | null }> | null,
    saveFile: null as Pending<{ ok: boolean; path: string | null; cancelled: boolean }> | null,
    dbQuery: null as Pending<{ ok: boolean; rows: DbRow[]; error?: string }> | null,
    dbExecute: null as Pending<{ ok: boolean; result: DbResult; error?: string }> | null,
    dbTransaction: null as Pending<{ ok: boolean; error?: string }> | null,
    dbInit: null as Pending<{ ok: boolean; error?: string }> | null,
    fileRead: null as Pending<{ ok: boolean; content: string | null; error?: string }> | null,
    fileWrite: null as Pending<{ ok: boolean; error?: string }> | null,
    fileReadBytes: null as Pending<{ ok: boolean; data: number[] | null; error?: string }> | null,
    fileWriteBytes: null as Pending<{ ok: boolean; error?: string }> | null,
    fileExists: null as Pending<{ ok: boolean; value: boolean; error?: string }> | null,
    fileDelete: null as Pending<{ ok: boolean; error?: string }> | null,
    fileCopy: null as Pending<{ ok: boolean; error?: string }> | null,
    dirCreate: null as Pending<{ ok: boolean; error?: string }> | null,
    dirDelete: null as Pending<{ ok: boolean; error?: string }> | null,
    dirList: null as Pending<{ ok: boolean; entries: string[]; error?: string }> | null,
    dirExists: null as Pending<{ ok: boolean; value: boolean; error?: string }> | null,
    runProject: null as Pending<{ ok: boolean; error?: string }> | null,
    stopProject: null as Pending<{ ok: boolean }> | null,
    navigateForm: null as Pending<{ ok: boolean; error?: string }> | null,
    sessionGet: null as Pending<{ ok: boolean; value: string | null }> | null,
    sessionSet: null as Pending<{ ok: boolean }> | null,
    clearProjectDb: null as Pending<{ ok: boolean; error?: string }> | null,
    saveCloudInfras: null as Pending<{ ok: boolean; error?: string }> | null,
    getCloudInfras: null as Pending<{ infras: any[] }> | null,
    getDecryptedCred: null as Pending<{ ok: boolean; value: string }> | null,
    compileProject: null as Pending<{ ok: boolean; error?: string; distPath?: string }> | null,
    getVersion: null as Pending<{ version: string; runMode: string }> | null,
    loadUiConfig: null as Pending<{ uiFontSize: number; uiFontFamily: string }> | null,
};

// fetch は複数同時リクエスト対応のため fetchId ベースのMapで管理
const _fetchPendingMap = new Map<string, Pending<{ ok: boolean; status: number; headers: Record<string, string>; body: string; error?: string }>>();
const _fetchAbortPendingMap = new Map<string, Pending<{}>>();

const resolve = <K extends keyof typeof pending>(
    key: K, val: NonNullable<typeof pending[K]> extends Pending<infer T> ? T : never
) => {
    const p = pending[key] as Pending<any> | null;
    if (p) { pending[key] = null; p.resolve(val); }
};

const mkPromise = <K extends keyof typeof pending, T>(
    key: K,
    send: () => void
): Promise<T> => new Promise<T>((res, rej) => {
    pending[key] = { resolve: res as any, reject: rej } as any;
    send();
});

// ── Electroview RPC 定義 ──────────────────────────────
const rpc = Electroview.defineRPC({
    handlers: {
        requests: {},
        messages: {
            openFileResult: (v: any) => resolve("openFile", v),
            saveFileResult: (v: any) => resolve("saveFile", v),
            dbQueryResult: (v: any) => resolve("dbQuery", v),
            dbExecuteResult: (v: any) => resolve("dbExecute", v),
            dbTransactionResult: (v: any) => resolve("dbTransaction", v),
            dbInitResult: (v: any) => resolve("dbInit", v),
            fileReadResult: (v: any) => resolve("fileRead", v),
            fileWriteResult: (v: any) => resolve("fileWrite", v),
            fileReadBytesResult: (v: any) => resolve("fileReadBytes", v),
            fileWriteBytesResult: (v: any) => resolve("fileWriteBytes", v),
            fileExistsResult: (v: any) => resolve("fileExists", v),
            fileDeleteResult: (v: any) => resolve("fileDelete", v),
            fileCopyResult: (v: any) => resolve("fileCopy", v),
            dirCreateResult: (v: any) => resolve("dirCreate", v),
            dirDeleteResult: (v: any) => resolve("dirDelete", v),
            dirListResult: (v: any) => resolve("dirList", v),
            dirExistsResult: (v: any) => resolve("dirExists", v),
            appInfoResult: (v: any) => resolve("appInfo", v),
            runProjectResult: (v: any) => resolve("runProject", v),
            saveCloudInfrasResult: (v: any) => resolve("saveCloudInfras", v),
            getCloudInfrasResult: (v: any) => resolve("getCloudInfras", v),
            getDecryptedCredentialResult: (v: any) => resolve("getDecryptedCred", v),
            loadScriptResult: (v: any) => { /* フロント側で処理 */ },
            compileProjectResult: (v: any) => resolve("compileProject", v),
            getVersionResult: (v: any) => resolve("getVersion", v),
            loadUiConfigResult: (v: any) => {
                resolve("loadUiConfig", v);
                // window関数が定義されていれば呼び出してUI設定を適用
                if (typeof (w as any)._onLoadUiConfigResult === "function") {
                    (w as any)._onLoadUiConfigResult(v);
                }
            },
            stopProjectResult: (v: any) => {
                if (pending.stopProject) {
                    resolve("stopProject", v);
                }
                // 常にボタン状態をリセット（×ボタンで閉じた場合も含む）
                try {
                    const runBtn = document.getElementById("btn-run-project") as HTMLButtonElement | null;
                    const stopBtn = document.getElementById("btn-stop-project") as HTMLButtonElement | null;
                    if (runBtn) { runBtn.style.display = ""; runBtn.disabled = false; }
                    if (stopBtn) stopBtn.style.display = "none";
                } catch { }
            },
            navigateFormResult: (v: any) => resolve("navigateForm", v),
            sessionGetResult: (v: any) => resolve("sessionGet", v),
            sessionSetResult: (v: any) => resolve("sessionSet", v),
            clearProjectDbResult: (v: any) => resolve("clearProjectDb", v),
            fetchResult: (v: any) => {
                const p = _fetchPendingMap.get(v.fetchId);
                if (p) { _fetchPendingMap.delete(v.fetchId); p.resolve(v); }
            },
            fetchAbortResult: (v: any) => {
                const p = _fetchAbortPendingMap.get(v.fetchId);
                if (p) { _fetchAbortPendingMap.delete(v.fetchId); p.resolve(v); }
            },
        },
    },
});
const _ev = new Electroview({ rpc });
const s = _ev.rpc.send;

// ── window.vja.* API ─────────────────────────────────
const w = window as any;

w.bunOpenFile = (a: any) => mkPromise("openFile", () => s.openFileRequest(a));
w.bunSaveProject = (a: any) => mkPromise("saveFile", () => s.saveFileRequest(a));
w.bunCloseApp = () => s.closeAppRequest({});
w.bunToggleDevTools = () => s.toggleDevToolsRequest({});
w.bunSaveCloudInfras = (infras: any[]) => mkPromise("saveCloudInfras", () => s.saveCloudInfrasRequest({ infras }));
w.bunCompileProject = () => mkPromise("compileProject", () => s.compileProjectRequest({}));
w.bunGetCloudInfras = () => mkPromise("getCloudInfras", () => s.getCloudInfrasRequest({}));
w.bunGetDecryptedCredential = (infraId: string, key: string) =>
    mkPromise("getDecryptedCred", () => s.getDecryptedCredentialRequest({ infraId, key }));
w.bunOpenFolder = (path: string) => s.openFolderRequest({ path });
w.bunGetVersion = () => mkPromise("getVersion", () => s.getVersionRequest({}));
w.bunSaveUiConfig = (uiFontSize: number, uiFontFamily: string, editorFontSize: number, editorFontFamily: string, leftPanelW: number, rightPanelW: number) =>
    s.saveUiConfigRequest({ uiFontSize, uiFontFamily, editorFontSize, editorFontFamily, leftPanelW, rightPanelW });
w.bunLoadUiConfig = () => mkPromise("loadUiConfig", () => s.loadUiConfigRequest({}));

// vja.db
w.vja = {
    db: {
        query: (sql: string, params?: any[]) =>
            mkPromise("dbQuery", () => s.dbQueryRequest({ sql, params }))
                .then((r: any) => r.rows),
        execute: (sql: string, params?: any[]) =>
            mkPromise("dbExecute", () => s.dbExecuteRequest({ sql, params }))
                .then((r: any) => r.ok ? r.result : null),
        transaction: (statements: { sql: string; params?: any[] }[]) =>
            mkPromise("dbTransaction", () => s.dbTransactionRequest({ statements }))
                .then((r: any) => r.ok),
        init: (ddlStatements: string[]) =>
            mkPromise("dbInit", () => s.dbInitRequest({ ddlStatements }))
                .then((r: any) => r.ok),
    },
    file: {
        read: (path: string) =>
            mkPromise("fileRead", () => s.fileReadRequest({ path }))
                .then((r: any) => r.ok ? r.content : null),
        write: (path: string, content: string) =>
            mkPromise("fileWrite", () => s.fileWriteRequest({ path, content }))
                .then((r: any) => r.ok),
        readBytes: (path: string) =>
            mkPromise("fileReadBytes", () => s.fileReadBytesRequest({ path }))
                .then((r: any) => r.data ? new Uint8Array(r.data) : null),
        writeBytes: (path: string, data: number[]) =>
            mkPromise("fileWriteBytes", () => s.fileWriteBytesRequest({ path, data }))
                .then((r: any) => r.ok),
        exists: (path: string) =>
            mkPromise("fileExists", () => s.fileExistsRequest({ path }))
                .then((r: any) => r.value),
        delete: (path: string) =>
            mkPromise("fileDelete", () => s.fileDeleteRequest({ path }))
                .then((r: any) => r.ok),
        copy: (src: string, dest: string) =>
            mkPromise("fileCopy", () => s.fileCopyRequest({ src, dest }))
                .then((r: any) => r.ok),
    },
    dir: {
        create: (path: string) =>
            mkPromise("dirCreate", () => s.dirCreateRequest({ path }))
                .then((r: any) => r.ok),
        delete: (path: string) =>
            mkPromise("dirDelete", () => s.dirDeleteRequest({ path }))
                .then((r: any) => r.ok),
        list: (path: string) =>
            mkPromise("dirList", () => s.dirListRequest({ path }))
                .then((r: any) => r.entries),
        exists: (path: string) =>
            mkPromise("dirExists", () => s.dirExistsRequest({ path }))
                .then((r: any) => r.value),
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
        getInfo: () =>
            mkPromise("appInfo", () => s.appInfoRequest({})),
        showDialog: (message: string) =>
            new Promise<void>((resolve) => {
                (w as any).showVjaAlert?.(message, () => resolve());
            }),
        showConfirm: (message: string) =>
            new Promise<boolean>((resolve) => {
                (w as any).showVjaDialog?.(message, (confirmed: boolean) =>
                    resolve(confirmed)
                );
            }),
    },
    // ── プロジェクト実行 ──────────────────────────────
    project: {
        run: () =>
            mkPromise("runProject", () => s.runProjectRequest({ projectData: JSON.stringify((window as any)._getProjectData?.() || {}) })),
        stop: () =>
            mkPromise("stopProject", () => s.stopProjectRequest({})),
        navigate: (formName: string) =>
            mkPromise("navigateForm", () => s.navigateFormRequest({ formName }))
                .then(() => { }),
        clearDb: () =>
            mkPromise("clearProjectDb", () => s.clearProjectDbRequest({}))
                .then((r: any) => { if (!r.ok) throw new Error(r.error || "clearDb failed"); }),
    },
    // ── セッション管理 ────────────────────────────────
    session: {
        get: (key: string, defaultVal: any = null) =>
            mkPromise("sessionGet", () => s.sessionGetRequest({ key }))
                .then((r: any) => r.value !== null ? r.value : defaultVal),
        set: (key: string, value: string | null) =>
            mkPromise("sessionSet", () => s.sessionSetRequest({ key, value }))
                .then((r: any) => r.ok),
        delete: (key: string) =>
            mkPromise("sessionSet", () => s.sessionSetRequest({ key, value: null }))
                .then((r: any) => r.ok),
        clear: () =>
            mkPromise("sessionSet", () => s.sessionSetRequest({ key: "__clear_all__", value: "__clear__" }))
                .then((r: any) => r.ok),
    },
};

// vja.fetch（Bun経由の汎用fetch、WebKitタイムアウト回避）
w.vja.fetch = (url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const fetchId = crypto.randomUUID();
    const promise = new Promise<any>((res, rej) => {
        _fetchPendingMap.set(fetchId, { resolve: res, reject: rej });
        s.fetchRequest({ fetchId, url, ...options });
    }).then((r: any) => {
        if (r.error === "AbortError") throw Object.assign(new Error("AbortError"), { name: "AbortError" });
        if (r.error) throw new Error(r.error);
        return {
            ok: r.ok,
            status: r.status,
            headers: r.headers,
            text: () => Promise.resolve(r.body),
            json: () => Promise.resolve(JSON.parse(r.body)),
        };
    });
    // fetchIdをpromiseに付与してキャンセル可能にする
    (promise as any).fetchId = fetchId;
    return promise;
};

w.vja.fetchAbort = (fetchId: string) => {
    return new Promise<any>((res, rej) => {
        _fetchAbortPendingMap.set(fetchId, { resolve: res, reject: rej });
        s.fetchAbortRequest({ fetchId });
    });
};

// vja.cloud
w.vja.cloud = w.vja.cloud || {};
w.vja.cloud.list = () =>
    mkPromise("getCloudInfras", () => s.getCloudInfrasRequest({}))
        .then((r: any) => r.infras);
w.vja.cloud.getCredential = (infraId: string, key: string) =>
    mkPromise("getDecryptedCred", () => s.getDecryptedCredentialRequest({ infraId, key }))
        .then((r: any) => r.value);

// bridge.ts 読み込み完了後、コンソールのキューを flush
if (typeof (window as any)._flushLogQueue === "function") {
    (window as any)._flushLogQueue();
}

// bridge.tsロード完了時にUI設定を自動読み込み
s.loadUiConfigRequest({});
