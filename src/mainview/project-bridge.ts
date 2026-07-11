// src/mainview/project-bridge.ts
// プロジェクト実行ウィンドウ用 RPC ブリッジ
// vja-runtime.js と統合してプロジェクトウィンドウの全APIを提供する

import { Electroview } from "electrobun/view";
import "./vja-runtime.js";
import type { VjaRPCType } from "../shared/types";
import { makeFetchMaps, makeVjaFetch, makeFetchResultHandlers } from "./bridge-common";

// fetch は複数同時リクエスト対応のため fetchId ベースのMapで管理（bridge-common）
const { fetchPendingMap: _fetchPendingMap, fetchAbortPendingMap: _fetchAbortPendingMap } = makeFetchMaps();

// ── RPC 定義 ──────────────────────────────────────────
// 【重要】requests/messagesの使い分けの方針はsrc/shared/types.tsのコメント
// 参照。以前は全RPCをmessages（一方向・相関ID無し）で自前実装しており、
// 同種のRPCを連続で呼ぶと先の呼び出しのPromiseが上書きされ永久にハングする
// バグがあった。requestsに統一することでこの問題自体が発生しなくなる。
// maxRequestTime: Infinity（タイムアウト無し）。理由はsrc/bun/index.tsの
// 同項目コメント参照（openFileRequest等ユーザー操作待ちのrequestと、
// dbQuery等の高速なrequestが同一RPCインスタンス上に混在するため）。
const rpc = Electroview.defineRPC<VjaRPCType>({
    maxRequestTime: Infinity,
    handlers: {
        requests: {},
        messages: {
            ...makeFetchResultHandlers(_fetchPendingMap, _fetchAbortPendingMap),
            loadScriptResult: () => { },
        },
    },
});

const _ev = new Electroview({ rpc });
const s = _ev.rpc.send;
const r = _ev.rpc.request;
const w = window as any;

// ── 共通ユーティリティ ────────────────────────────────
const _parseCsvLine = (line: string): string[] => {
    const result: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
            if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
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

// ログ出力処理.
// msgがErrorの場合はvja://sourceURLからユーザーJSの行番号を抽出して周辺行を表示する。
const _logOut = (mode: string, args: any[]) => {
    // ここで一旦複数パラメータ設定されたログ出力情報を整理する.
    const message: string = args.map(a => {
        if (a === null) return "null";
        if (a === undefined) return "undefined";
        if (a instanceof Error) {
            // mode === "error" の場合、Errorオブジェクトを保存（_vjaRun側で詳細出力に使用）
            if (mode === "error") w._vjaLastError = a;
            return `${a.name}: ${a.message}${a.stack ? "\n" + a.stack : ""}`;
        }
        if (typeof a === "object") { try { return JSON.stringify(a); } catch { return String(a); } }
        return String(a);
    }).join(" ");
    s.logRequest({ level: mode as "info" | "warn" | "error" | "debug" | "trace" | "log", message });
}

w.vja.log = {
    trace: (...a: any[]) => { _logOut("trace", a); },
    debug: (...a: any[]) => { _logOut("debug", a); },
    info: (...a: any[]) => { _logOut("info", a); },
    warn: (...a: any[]) => { _logOut("warn", a); },
    error: (...a: any[]) => { _logOut("error", a); },
    log: (...a: any[]) => { _logOut("log", a); },
};

// ダイアログ・ウィンドウ操作
w.vja.app = {
    // showDialog / showConfirm はフロント側 #dialog-root ダイアログで処理
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
w.vja.dialog = (message: string) => w.vja.app.showDialog(message);
w.vja.confirm = (message: string) => w.vja.app.showConfirm(message);

// DB操作
w.vja.db = {
    query: (sql: string, params?: any[]) =>
        r.dbQueryRequest({ sql, params }).then((res: any) => res.rows),
    execute: (sql: string, params?: any[]) =>
        r.dbExecuteRequest({ sql, params }).then((res: any) => res.ok ? res.result : null),
    transaction: (statements: { sql: string; params?: any[] }[]) =>
        r.dbTransactionRequest({ statements }).then((res: any) => res.ok),

    // テーブル全行削除
    clearTable: (tableName: string) =>
        r.dbExecuteRequest({ sql: `DELETE FROM ${tableName}` }).then(() => { }),

    // テーブル一覧取得
    tables: async (): Promise<string[]> => {
        const rows = await r.dbQueryRequest({
            sql: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        }).then((res: any) => res.rows);
        return rows.map((row: any) => row.name);
    },

    // CSV取得（where句省略可）
    exportCsv: async (tableName: string, where?: string): Promise<string> => {
        const sql = where ? `SELECT * FROM ${tableName} WHERE ${where}` : `SELECT * FROM ${tableName}`;
        const rows: any[] = await r.dbQueryRequest({ sql }).then((res: any) => res.rows);
        if (rows.length === 0) return "";
        const headers = Object.keys(rows[0]);
        const esc = (v: any) => {
            const str = v === null || v === undefined ? "" : String(v);
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        };
        const lines = [headers.join(","), ...rows.map(row => headers.map(h => esc(row[h])).join(","))];
        return lines.join("\n");
    },

    // JSON取得（where句省略可）
    exportJson: async (tableName: string, where?: string): Promise<any[]> => {
        const sql = where ? `SELECT * FROM ${tableName} WHERE ${where}` : `SELECT * FROM ${tableName}`;
        return r.dbQueryRequest({ sql }).then((res: any) => res.rows);
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
        await r.dbTransactionRequest({ statements });
    },

    // JSONインポート（既存データに追記）
    importJson: async (tableName: string, data: Record<string, any>[]): Promise<void> => {
        if (!data || data.length === 0) return;
        const headers = Object.keys(data[0]);
        const statements = data.map(row => ({
            sql: `INSERT INTO ${tableName} (${headers.join(",")}) VALUES (${headers.map(() => "?").join(",")})`,
            params: headers.map(h => row[h] ?? null),
        }));
        await r.dbTransactionRequest({ statements });
    },
};

// フォーム切り替え
w.vja.project = {
    navigate: (formName: string) =>
        r.navigateFormRequest({ formName }).then(() => { }),
};

// セッション
w.vja.session = {
    get: (key: string, defaultVal: any = null) =>
        r.sessionGetRequest({ key }).then((res: any) => res.value !== null ? res.value : defaultVal),
    set: (key: string, value: string | null) =>
        r.sessionSetRequest({ key, value }).then((res: any) => res.ok),
    delete: (key: string) =>
        r.sessionSetRequest({ key, value: null }).then((res: any) => res.ok),
    clear: () =>
        r.sessionSetRequest({ key: "__clear_all__", value: "__clear__" }).then((res: any) => res.ok),
};

// ファイル選択（openCsv/openJson用）
// vja._openFile を差し替えることで vja.io.openFile/openCsv/openJson がRPC経由になる
w.vja._openFile = (filter: string = "*") =>
    r.openFileRequest({ filter, lastPath: null });

// ファイル保存（saveCsv/saveJson/saveText用）
// vja._saveFile を差し替えることで vja.io.saveCsv/saveJson/saveText がネイティブ保存ダイアログ経由になる
w.vja._saveFile = (content: string, filename: string, ext: string = "txt") =>
    r.saveGenericFileRequest({ content, defaultName: filename, ext });

// DB init
w.vja.db.init = (ddlStatements: string[]) =>
    r.dbInitRequest({ ddlStatements }).then((res: any) => res.ok);

// ファイル操作
w.vja.file = {
    read: (path: string) =>
        r.fileReadRequest({ path }).then((res: any) => res.ok ? res.content : null),
    write: (path: string, content: string) =>
        r.fileWriteRequest({ path, content }).then((res: any) => res.ok),
    exists: (path: string) =>
        r.fileExistsRequest({ path }).then((res: any) => res.value),
    readBytes: (path: string) =>
        r.fileReadBytesRequest({ path }).then((res: any) => res.data ? new Uint8Array(res.data) : null),
    writeBytes: (path: string, data: Uint8Array) =>
        r.fileWriteBytesRequest({ path, data: Array.from(data) }).then((res: any) => res.ok),
    delete: (path: string) =>
        r.fileDeleteRequest({ path }).then((res: any) => res.ok),
    copy: (src: string, dest: string) =>
        r.fileCopyRequest({ src, dest }).then((res: any) => res.ok),
};

// ディレクトリ操作
w.vja.dir = {
    create: (path: string) =>
        r.dirCreateRequest({ path }).then((res: any) => res.ok),
    delete: (path: string) =>
        r.dirDeleteRequest({ path }).then((res: any) => res.ok),
    list: (path: string) =>
        r.dirListRequest({ path }).then((res: any) => res.entries),
    exists: (path: string) =>
        r.dirExistsRequest({ path }).then((res: any) => res.value),
};

// vja.fetch / vja.fetchAbort（Bun経由の汎用fetch、WebKitタイムアウト回避）
const _vjaFetch = makeVjaFetch(_fetchPendingMap, _fetchAbortPendingMap, s.fetchRequest, s.fetchAbortRequest);
w.vja.fetch = _vjaFetch.fetch;
w.vja.fetchAbort = _vjaFetch.fetchAbort;

w.vja.cloud = w.vja.cloud || {};
w.vja.cloud.list = () =>
    r.getCloudInfrasRequest({}).then((res: any) => res.infras);
w.vja.cloud.getCredential = (infraId: string, key: string) =>
    r.getDecryptedCredentialRequest({ infraId, key }).then((res: any) => res.value);

// console.* を vja.log.* (RPC経由) に差し替え
const _origConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
};
console.log = (...a: any[]) => { _origConsole.log(...a); w.vja.log?.log?.(...a); };
console.info = (...a: any[]) => { _origConsole.info(...a); w.vja.log?.info?.(...a); };
console.warn = (...a: any[]) => { _origConsole.warn(...a); w.vja.log?.warn?.(...a); };
console.error = (...a: any[]) => { _origConsole.error(...a); w.vja.log?.error?.(...a); };
console.debug = (...a: any[]) => { _origConsole.debug(...a); w.vja.log?.debug?.(...a); };

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
