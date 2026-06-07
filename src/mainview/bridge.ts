// src/mainview/bridge.ts
// Electrobun RPC ブリッジ + window.vja.* API

import { Electroview } from "electrobun/view";
import type { DbRow, DbResult } from "../shared/types";

// ── コールバック待機マップ ────────────────────────────
type Resolver<T> = (v: T) => void;
type Rejecter    = (e: Error) => void;

interface Pending<T> { resolve: Resolver<T>; reject: Rejecter; }

const pending = {
    openFile     : null as Pending<{ content: string|null; path: string|null }>   | null,
    saveFile     : null as Pending<{ ok:boolean; path:string|null; cancelled:boolean }> | null,
    dbQuery      : null as Pending<{ ok:boolean; rows:DbRow[]; error?:string }>   | null,
    dbExecute    : null as Pending<{ ok:boolean; result:DbResult; error?:string }> | null,
    dbTransaction: null as Pending<{ ok:boolean; error?:string }>                 | null,
    dbInit       : null as Pending<{ ok:boolean; error?:string }>                 | null,
    fileRead     : null as Pending<{ ok:boolean; content:string|null; error?:string }> | null,
    fileWrite    : null as Pending<{ ok:boolean; error?:string }>                 | null,
    fileReadBytes: null as Pending<{ ok:boolean; data:number[]|null; error?:string }> | null,
    fileWriteBytes:null as Pending<{ ok:boolean; error?:string }>                 | null,
    fileExists   : null as Pending<{ ok:boolean; value:boolean; error?:string }>  | null,
    fileDelete   : null as Pending<{ ok:boolean; error?:string }>                 | null,
    fileCopy     : null as Pending<{ ok:boolean; error?:string }>                 | null,
    dirCreate    : null as Pending<{ ok:boolean; error?:string }>                 | null,
    dirDelete    : null as Pending<{ ok:boolean; error?:string }>                 | null,
    dirList      : null as Pending<{ ok:boolean; entries:string[]; error?:string }> | null,
    dirExists    : null as Pending<{ ok:boolean; value:boolean; error?:string }>  | null,
    log          : null as Pending<{ ok:boolean }>                                | null,
    appInfo      : null as Pending<{ ok:boolean; info:any }>                      | null,
    appDialog    : null as Pending<{ ok:boolean; confirmed?:boolean }>            | null,
};

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
            openFileResult  : (v: any) => resolve("openFile",      v),
            saveFileResult  : (v: any) => resolve("saveFile",      v),
            dbQueryResult   : (v: any) => resolve("dbQuery",       v),
            dbExecuteResult : (v: any) => resolve("dbExecute",     v),
            dbTransactionResult:(v:any) => resolve("dbTransaction", v),
            dbInitResult    : (v: any) => resolve("dbInit",        v),
            fileReadResult  : (v: any) => resolve("fileRead",      v),
            fileWriteResult : (v: any) => resolve("fileWrite",     v),
            fileReadBytesResult :(v:any)=> resolve("fileReadBytes", v),
            fileWriteBytesResult:(v:any)=> resolve("fileWriteBytes",v),
            fileExistsResult: (v: any) => resolve("fileExists",    v),
            fileDeleteResult: (v: any) => resolve("fileDelete",    v),
            fileCopyResult  : (v: any) => resolve("fileCopy",      v),
            dirCreateResult : (v: any) => resolve("dirCreate",     v),
            dirDeleteResult : (v: any) => resolve("dirDelete",     v),
            dirListResult   : (v: any) => resolve("dirList",       v),
            dirExistsResult : (v: any) => resolve("dirExists",     v),
            logResult       : (v: any) => resolve("log",           v),
            appInfoResult   : (v: any) => resolve("appInfo",       v),
            appDialogResult : (v: any) => resolve("appDialog",     v),
        },
    },
});
const _ev = new Electroview({ rpc });
const s = _ev.rpc.send;

// ── window.vja.* API ─────────────────────────────────
const w = window as any;

w.bunOpenFile    = (a: any) => mkPromise("openFile",  () => s.openFileRequest(a));
w.bunSaveProject = (a: any) => mkPromise("saveFile",  () => s.saveFileRequest(a));
w.bunCloseApp    = ()       => s.closeAppRequest({});

// vja.db
w.vja = {
    db: {
        query: (sql: string, params?: any[]) =>
            mkPromise("dbQuery", () => s.dbQueryRequest({ sql, params })),
        execute: (sql: string, params?: any[]) =>
            mkPromise("dbExecute", () => s.dbExecuteRequest({ sql, params })),
        transaction: (statements: { sql: string; params?: any[] }[]) =>
            mkPromise("dbTransaction", () => s.dbTransactionRequest({ statements })),
        init: (ddlStatements: string[]) =>
            mkPromise("dbInit", () => s.dbInitRequest({ ddlStatements })),
    },
    file: {
        read: (path: string) =>
            mkPromise("fileRead", () => s.fileReadRequest({ path })),
        write: (path: string, content: string) =>
            mkPromise("fileWrite", () => s.fileWriteRequest({ path, content })),
        readBytes: (path: string) =>
            mkPromise("fileReadBytes", () => s.fileReadBytesRequest({ path })),
        writeBytes: (path: string, data: number[]) =>
            mkPromise("fileWriteBytes", () => s.fileWriteBytesRequest({ path, data })),
        exists: (path: string) =>
            mkPromise("fileExists", () => s.fileExistsRequest({ path })),
        delete: (path: string) =>
            mkPromise("fileDelete", () => s.fileDeleteRequest({ path })),
        copy: (src: string, dest: string) =>
            mkPromise("fileCopy", () => s.fileCopyRequest({ src, dest })),
    },
    dir: {
        create: (path: string) =>
            mkPromise("dirCreate", () => s.dirCreateRequest({ path })),
        delete: (path: string) =>
            mkPromise("dirDelete", () => s.dirDeleteRequest({ path })),
        list: (path: string) =>
            mkPromise("dirList", () => s.dirListRequest({ path })),
        exists: (path: string) =>
            mkPromise("dirExists", () => s.dirExistsRequest({ path })),
    },
    log: {
        trace: (message: string) => mkPromise("log", () => s.logRequest({ level: "trace", message })),
        debug: (message: string) => mkPromise("log", () => s.logRequest({ level: "debug", message })),
        info:  (message: string) => mkPromise("log", () => s.logRequest({ level: "info",  message })),
        warn:  (message: string) => mkPromise("log", () => s.logRequest({ level: "warn",  message })),
        error: (message: string) => mkPromise("log", () => s.logRequest({ level: "error", message })),
        log:   (message: string) => mkPromise("log", () => s.logRequest({ level: "log",   message })),
    },
    app: {
        getInfo: () =>
            mkPromise("appInfo", () => s.appInfoRequest({})),
        showDialog: (message: string) =>
            mkPromise("appDialog", () => s.appDialogRequest({ type: "alert", message })),
        showConfirm: (message: string) =>
            mkPromise("appDialog", () => s.appDialogRequest({ type: "confirm", message })),
    },
};

// bridge.ts 読み込み完了後、コンソールのキューを flush
if (typeof (window as any)._flushLogQueue === "function") {
    (window as any)._flushLogQueue();
}
