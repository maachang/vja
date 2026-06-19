// src/mainview/project-bridge.ts
// プロジェクト実行ウィンドウ用 RPC ブリッジ
// vja-runtime.js と統合してプロジェクトウィンドウの全APIを提供する

import { Electroview } from "electrobun/view";
import "./vja-runtime.js";
import type { VjaRPCType } from "../shared/types";

type Resolver<T> = (v: T) => void;
type Rejecter = (e: Error) => void;
interface Pending<T> { resolve: Resolver<T>; reject: Rejecter; }

const pending = {
    navigateForm: null as Pending<{ ok: boolean; error?: string }> | null,
    openFile:     null as Pending<{ content: string | null; path: string | null }> | null,
    dbInit:       null as Pending<{ ok: boolean; error?: string }> | null,
    sessionGet:   null as Pending<{ ok: boolean; value: string | null }> | null,
    sessionSet:   null as Pending<{ ok: boolean }> | null,
    dbQuery:      null as Pending<{ ok: boolean; rows: any[]; error?: string }> | null,
    dbExecute:    null as Pending<{ ok: boolean; result: any; error?: string }> | null,
    dbTransaction:null as Pending<{ ok: boolean; error?: string }> | null,
    fileRead:      null as Pending<{ ok: boolean; content: string | null; error?: string }> | null,
    fileWrite:     null as Pending<{ ok: boolean; error?: string }> | null,
    fileReadBytes: null as Pending<{ ok: boolean; data: number[] | null; error?: string }> | null,
    fileWriteBytes:null as Pending<{ ok: boolean; error?: string }> | null,
    fileExists:    null as Pending<{ ok: boolean; value: boolean; error?: string }> | null,
    fileDelete:   null as Pending<{ ok: boolean; error?: string }> | null,
    fileCopy:     null as Pending<{ ok: boolean; error?: string }> | null,
    dirCreate:    null as Pending<{ ok: boolean; error?: string }> | null,
    dirDelete:    null as Pending<{ ok: boolean; error?: string }> | null,
    dirList:      null as Pending<{ ok: boolean; entries: string[]; error?: string }> | null,
    dirExists:    null as Pending<{ ok: boolean; value: boolean; error?: string }> | null,
    getCloudInfras:    null as Pending<{ infras: any[] }> | null,
    getDecryptedCred:  null as Pending<{ ok: boolean; value: string }> | null,
};

// fetch は複数同時リクエスト対応のため fetchId ベースのMapで管理
const _fetchPendingMap = new Map<string, Pending<{ ok: boolean; status: number; headers: Record<string, string>; body: string; error?: string }>>();
const _fetchAbortPendingMap = new Map<string, Pending<{}>>();

const resolve = <K extends keyof typeof pending>(
    key: K,
    val: NonNullable<typeof pending[K]> extends Pending<infer T> ? T : never,
) => {
    const p = pending[key] as Pending<any> | null;
    if (p) { pending[key] = null; p.resolve(val); }
};

const mkPromise = <K extends keyof typeof pending, T>(
    key: K, send: () => void,
): Promise<T> => new Promise<T>((res, rej) => {
    pending[key] = { resolve: res as any, reject: rej } as any;
    send();
});

// ── RPC 定義 ──────────────────────────────────────────
const rpc = Electroview.defineRPC<VjaRPCType>({
    handlers: {
        requests: {},
        messages: {
            navigateFormResult: (v: any) => resolve("navigateForm", v),
            openFileResult:     (v: any) => resolve("openFile",     v),
            dbInitResult:       (v: any) => resolve("dbInit",       v),
            sessionGetResult:   (v: any) => resolve("sessionGet",   v),
            sessionSetResult:   (v: any) => resolve("sessionSet",   v),
            dbQueryResult:       (v: any) => resolve("dbQuery",       v),
            dbExecuteResult:     (v: any) => resolve("dbExecute",     v),
            dbTransactionResult: (v: any) => resolve("dbTransaction",  v),
            fileReadResult:       (v: any) => resolve("fileRead",       v),
            fileWriteResult:      (v: any) => resolve("fileWrite",      v),
            fileReadBytesResult:  (v: any) => resolve("fileReadBytes",  v),
            fileWriteBytesResult: (v: any) => resolve("fileWriteBytes", v),
            fileExistsResult:    (v: any) => resolve("fileExists",     v),
            fileDeleteResult:    (v: any) => resolve("fileDelete",     v),
            fileCopyResult:      (v: any) => resolve("fileCopy",       v),
            dirCreateResult:     (v: any) => resolve("dirCreate",      v),
            dirDeleteResult:     (v: any) => resolve("dirDelete",      v),
            dirListResult:       (v: any) => resolve("dirList",        v),
            dirExistsResult:     (v: any) => resolve("dirExists",      v),
            getCloudInfrasResult:        (v: any) => resolve("getCloudInfras",   v),
            getDecryptedCredentialResult:(v: any) => resolve("getDecryptedCred", v),
            fetchResult: (v: any) => {
                const p = _fetchPendingMap.get(v.fetchId);
                if (p) { _fetchPendingMap.delete(v.fetchId); p.resolve(v); }
            },
            fetchAbortResult: (v: any) => {
                const p = _fetchAbortPendingMap.get(v.fetchId);
                if (p) { _fetchAbortPendingMap.delete(v.fetchId); p.resolve(v); }
            },
            loadScriptResult:            () => {},
        },
    },
});

const _ev = new Electroview({ rpc });
const s = _ev.rpc.send;
const w = window as any;

// ── 共通ユーティリティ ────────────────────────────────
const _parseCsvLine = (line: string): string[] => {
    const result: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
            if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
            else if (c === '"') inQ = false;
            else cur += c;
        } else {
            if (c === '"') inQ = true;
            else if (c === ",") { result.push(cur); cur = ""; }
            else cur += c;
        }
    }
    result.push(cur);
    return result;
};

// ── vja.* API をプロジェクトウィンドウ用に上書き ─────
w.vja = w.vja || {};

// ログ（fire-and-forget: 結果を待たない）
w.vja.log = {
    trace: (msg: string) => { s.logRequest({ level: "trace", message: msg }); },
    debug: (msg: string) => { s.logRequest({ level: "debug", message: msg }); },
    info:  (msg: string) => { s.logRequest({ level: "info",  message: msg }); },
    warn:  (msg: string) => { s.logRequest({ level: "warn",  message: msg }); },
    error: (msg: string) => { s.logRequest({ level: "error", message: msg }); },
    log:   (msg: string) => { s.logRequest({ level: "log",   message: msg }); },
};

// ダイアログ・ウィンドウ操作
w.vja.app = {
    // showDialog / showConfirm はフロント側 #dialog-root ダイアログで処理
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
    closeWindow: () => s.stopProjectRequest({}),
    loadScript: (url: string) =>
        new Promise<void>((resolve, reject) => {
            if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
            const sc = document.createElement("script");
            sc.src = url;
            sc.onload = () => resolve();
            sc.onerror = () => reject(new Error("Script load failed: " + url));
            document.head.appendChild(sc);
        }),
};
// ショートハンド
w.vja.dialog  = (message: string) => w.vja.app.showDialog(message);
w.vja.confirm = (message: string) => w.vja.app.showConfirm(message);

// DB操作
w.vja.db = {
    query: (sql: string, params?: any[]) =>
        mkPromise("dbQuery", () => s.dbQueryRequest({ sql, params }))
            .then((r: any) => r.rows),
    execute: (sql: string, params?: any[]) =>
        mkPromise("dbExecute", () => s.dbExecuteRequest({ sql, params }))
            .then((r: any) => r.ok ? r.result : null),
    transaction: (statements: { sql: string; params?: any[] }[]) =>
        mkPromise("dbTransaction", () => s.dbTransactionRequest({ statements }))
            .then((r: any) => r.ok),

    // テーブル全行削除
    clearTable: (tableName: string) =>
        mkPromise("dbExecute", () => s.dbExecuteRequest({ sql: `DELETE FROM ${tableName}` }))
            .then(() => {}),

    // テーブル一覧取得
    tables: async (): Promise<string[]> => {
        const rows = await mkPromise<any>("dbQuery", () =>
            s.dbQueryRequest({ sql: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" })
        ).then((r: any) => r.rows);
        return rows.map((r: any) => r.name);
    },

    // CSV取得（where句省略可）
    exportCsv: async (tableName: string, where?: string): Promise<string> => {
        const sql = where ? `SELECT * FROM ${tableName} WHERE ${where}` : `SELECT * FROM ${tableName}`;
        const rows: any[] = await mkPromise<any>("dbQuery", () => s.dbQueryRequest({ sql })).then((r: any) => r.rows);
        if (rows.length === 0) return "";
        const headers = Object.keys(rows[0]);
        const esc = (v: any) => {
            const str = v === null || v === undefined ? "" : String(v);
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        };
        const lines = [headers.join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))];
        return lines.join("\n");
    },

        // JSON取得（where句省略可）
    exportJson: async (tableName: string, where?: string): Promise<any[]> => {
        const sql = where ? `SELECT * FROM ${tableName} WHERE ${where}` : `SELECT * FROM ${tableName}`;
        return mkPromise<any>("dbQuery", () => s.dbQueryRequest({ sql })).then((r: any) => r.rows);
    },

    // CSVインポート（既存データに追記）
    importCsv: async (tableName: string, csv: string): Promise<void> => {
        const lines = csv.split("\n").filter((l: string) => l.trim());
        if (lines.length < 2) return;
        const headers = _parseCsvLine(lines[0]);
        const statements = lines.slice(1).map((line: string) => {
            const vals = _parseCsvLine(line);
            return {
                sql: `INSERT INTO ${tableName} (${headers.join(",")}) VALUES (${headers.map(() => "?").join(",")})`,
                params: vals,
            };
        });
        await mkPromise("dbTransaction", () => s.dbTransactionRequest({ statements }));
    },

        // JSONインポート（既存データに追記）
    importJson: async (tableName: string, data: Record<string, any>[]): Promise<void> => {
        if (!data || data.length === 0) return;
        const headers = Object.keys(data[0]);
        const statements = data.map(row => ({
            sql: `INSERT INTO ${tableName} (${headers.join(",")}) VALUES (${headers.map(() => "?").join(",")})`,
            params: headers.map(h => row[h] ?? null),
        }));
        await mkPromise("dbTransaction", () => s.dbTransactionRequest({ statements }));
    },
};

// フォーム切り替え
w.vja.project = {
    navigate: (formName: string) =>
        mkPromise("navigateForm", () => s.navigateFormRequest({ formName }))
            .then(() => {}),
};

// セッション
w.vja.session = {
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
};

// ファイル選択（openCsv/openJson用）
// vja._openFile を差し替えることで vja.io.openFile/openCsv/openJson がRPC経由になる
w.vja._openFile = (filter: string = "*") =>
    mkPromise("openFile", () => s.openFileRequest({ filter, lastPath: null }));

// DB init
w.vja.db.init = (ddlStatements: string[]) =>
    mkPromise("dbInit", () => s.dbInitRequest({ ddlStatements }))
        .then((r: any) => r.ok);

// ファイル操作
w.vja.file = {
    read:   (path: string) =>
        mkPromise("fileRead",   () => s.fileReadRequest({ path }))
            .then((r: any) => r.ok ? r.content : null),
    write:  (path: string, content: string) =>
        mkPromise("fileWrite",  () => s.fileWriteRequest({ path, content }))
            .then((r: any) => r.ok),
    exists: (path: string) =>
        mkPromise("fileExists", () => s.fileExistsRequest({ path }))
            .then((r: any) => r.value),
    readBytes: (path: string) =>
        mkPromise("fileReadBytes", () => s.fileReadBytesRequest({ path }))
            .then((r: any) => r.data ? new Uint8Array(r.data) : null),
    writeBytes: (path: string, data: Uint8Array) =>
        mkPromise("fileWriteBytes", () => s.fileWriteBytesRequest({ path, data: Array.from(data) }))
            .then((r: any) => r.ok),
    delete: (path: string) =>
        mkPromise("fileDelete", () => s.fileDeleteRequest({ path }))
            .then((r: any) => r.ok),
    copy:   (src: string, dest: string) =>
        mkPromise("fileCopy",   () => s.fileCopyRequest({ src, dest }))
            .then((r: any) => r.ok),
};

// ディレクトリ操作
w.vja.dir = {
    create: (path: string) =>
        mkPromise("dirCreate", () => s.dirCreateRequest({ path }))
            .then((r: any) => r.ok),
    delete: (path: string) =>
        mkPromise("dirDelete", () => s.dirDeleteRequest({ path }))
            .then((r: any) => r.ok),
    list:   (path: string) =>
        mkPromise("dirList",   () => s.dirListRequest({ path }))
            .then((r: any) => r.entries),
    exists: (path: string) =>
        mkPromise("dirExists", () => s.dirExistsRequest({ path }))
            .then((r: any) => r.value),
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
    (promise as any).fetchId = fetchId;
    return promise;
};

w.vja.fetchAbort = (fetchId: string) => {
    return new Promise<any>((res, rej) => {
        _fetchAbortPendingMap.set(fetchId, { resolve: res, reject: rej });
        s.fetchAbortRequest({ fetchId });
    });
};

w.vja.cloud = w.vja.cloud || {};
w.vja.cloud.list = () =>
    mkPromise("getCloudInfras", () => s.getCloudInfrasRequest({}))
        .then((r: any) => r.infras);
w.vja.cloud.getCredential = (infraId: string, key: string) =>
    mkPromise("getDecryptedCred", () => s.getDecryptedCredentialRequest({ infraId, key }))
        .then((r: any) => r.value);

// console.* を vja.log.* (RPC経由) に差し替え
const _origConsole = {
    log:   console.log.bind(console),
    info:  console.info.bind(console),
    warn:  console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
};
const _fmtArgs = (...args: any[]) => args.map(a => {
    if (a === null) return "null";
    if (a === undefined) return "undefined";
    if (typeof a === "object") { try { return JSON.stringify(a); } catch { return String(a); } }
    return String(a);
}).join(" ");
console.log   = (...a: any[]) => { _origConsole.log(...a);   w.vja.log?.log?.(  _fmtArgs(...a)); };
console.info  = (...a: any[]) => { _origConsole.info(...a);  w.vja.log?.info?.( _fmtArgs(...a)); };
console.warn  = (...a: any[]) => { _origConsole.warn(...a);  w.vja.log?.warn?.( _fmtArgs(...a)); };
console.error = (...a: any[]) => { _origConsole.error(...a); w.vja.log?.error?.(_fmtArgs(...a)); };
console.debug = (...a: any[]) => { _origConsole.debug(...a); w.vja.log?.debug?.(_fmtArgs(...a)); };

// ページ読み込み完了をBun側に通知（Bun側でnavigationをロックする）
document.addEventListener("DOMContentLoaded", () => {
    s.pageLoadedRequest({});
});

// 未捕捉エラー・未処理Rejection もBun側ログに転送
window.addEventListener("error", (e: ErrorEvent) => {
    w.vja.log?.error?.(`[UnhandledError] ${e.message} (${e.filename}:${e.lineno})`);
});
window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    w.vja.log?.error?.(`[UnhandledRejection] ${String(e.reason)}`);
});

console.log("[project-bridge] loaded");
