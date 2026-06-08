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
    log:          null as Pending<{ ok: boolean }> | null,
    appDialog:    null as Pending<{ ok: boolean; confirmed?: boolean }> | null,
    navigateForm: null as Pending<{ ok: boolean; error?: string }> | null,
    sessionGet:   null as Pending<{ ok: boolean; value: string | null }> | null,
    sessionSet:   null as Pending<{ ok: boolean }> | null,
    dbQuery:      null as Pending<{ ok: boolean; rows: any[]; error?: string }> | null,
    dbExecute:    null as Pending<{ ok: boolean; result: any; error?: string }> | null,
    dbTransaction:null as Pending<{ ok: boolean; error?: string }> | null,
};

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
            logResult:          (v: any) => resolve("log",          v),
            appDialogResult:    (v: any) => resolve("appDialog",    v),
            navigateFormResult: (v: any) => resolve("navigateForm", v),
            sessionGetResult:   (v: any) => resolve("sessionGet",   v),
            sessionSetResult:   (v: any) => resolve("sessionSet",   v),
            dbQueryResult:      (v: any) => resolve("dbQuery",      v),
            dbExecuteResult:    (v: any) => resolve("dbExecute",    v),
            dbTransactionResult:(v: any) => resolve("dbTransaction", v),
        },
    },
});

const _ev = new Electroview({ rpc });
const s = _ev.rpc.send;
const w = window as any;

// ── vja.* API をプロジェクトウィンドウ用に上書き ─────
w.vja = w.vja || {};

// ログ
w.vja.log = {
    trace: (msg: string) => mkPromise("log", () => s.logRequest({ level: "trace", message: msg })),
    debug: (msg: string) => mkPromise("log", () => s.logRequest({ level: "debug", message: msg })),
    info:  (msg: string) => mkPromise("log", () => s.logRequest({ level: "info",  message: msg })),
    warn:  (msg: string) => mkPromise("log", () => s.logRequest({ level: "warn",  message: msg })),
    error: (msg: string) => mkPromise("log", () => s.logRequest({ level: "error", message: msg })),
    log:   (msg: string) => mkPromise("log", () => s.logRequest({ level: "log",   message: msg })),
};

// ダイアログ
w.vja.app = {
    showDialog:  (message: string) =>
        mkPromise("appDialog", () => s.appDialogRequest({ type: "alert",   message })),
    showConfirm: (message: string) =>
        mkPromise("appDialog", () => s.appDialogRequest({ type: "confirm", message })),
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
        mkPromise("dbExecute", () => s.dbExecuteRequest({ sql, params })),
    transaction: (statements: { sql: string; params?: any[] }[]) =>
        mkPromise("dbTransaction", () => s.dbTransactionRequest({ statements })),

    // テーブル全行削除
    clearTable: (tableName: string) =>
        mkPromise("dbExecute", () => s.dbExecuteRequest({ sql: `DELETE FROM ${tableName}` })),

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
        const parseCsvLine = (line: string): string[] => {
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
        const headers = parseCsvLine(lines[0]);
        const statements = lines.slice(1).map((line: string) => {
            const vals = parseCsvLine(line);
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
        mkPromise("navigateForm", () => s.navigateFormRequest({ formName })),
};

// セッション
w.vja.session = {
    get: (key: string) =>
        mkPromise("sessionGet", () => s.sessionGetRequest({ key }))
            .then((r: any) => r.value),
    set: (key: string, value: string | null) =>
        mkPromise("sessionSet", () => s.sessionSetRequest({ key, value })),
    delete: (key: string) =>
        mkPromise("sessionSet", () => s.sessionSetRequest({ key, value: null })),
};

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
console.log   = (...a: any[]) => { _origConsole.log(...a);   w.vja.log?.log?.(  _fmtArgs(...a))?.catch(() => {}); };
console.info  = (...a: any[]) => { _origConsole.info(...a);  w.vja.log?.info?.( _fmtArgs(...a))?.catch(() => {}); };
console.warn  = (...a: any[]) => { _origConsole.warn(...a);  w.vja.log?.warn?.( _fmtArgs(...a))?.catch(() => {}); };
console.error = (...a: any[]) => { _origConsole.error(...a); w.vja.log?.error?.(_fmtArgs(...a))?.catch(() => {}); };
console.debug = (...a: any[]) => { _origConsole.debug(...a); w.vja.log?.debug?.(_fmtArgs(...a))?.catch(() => {}); };

// ページ読み込み完了をBun側に通知（Bun側でnavigationをロックする）
document.addEventListener("DOMContentLoaded", () => {
    s.pageLoadedRequest({});
});

// 未捕捉エラー・未処理Rejection もBun側ログに転送
window.addEventListener("error", (e: ErrorEvent) => {
    w.vja.log?.error?.(`[UnhandledError] ${e.message} (${e.filename}:${e.lineno})`)?.catch(() => {});
});
window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    w.vja.log?.error?.(`[UnhandledRejection] ${String(e.reason)}`)?.catch(() => {});
});

console.log("[project-bridge] loaded");
