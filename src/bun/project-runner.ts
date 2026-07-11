// src/bun/project-runner.ts
// プロジェクト実行ウィンドウの共通処理
// index.ts（デザイナー）と standalone-index.ts（スタンドアロン）の両方で使用する

import { BrowserWindow, BrowserView, Utils } from "electrobun/bun";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { writeLog } from "./logger";
import { decompressGzip, parseCsvLine } from "./bun-utils";
import { initProjectDb, clearProjectDb, getProjectDb, closeProjectDb } from "./db-manager";
import type { VjaRPCType, TableDef } from "../shared/types";
import {
    fileReadHandler, fileWriteHandler, fileReadBytesHandler, fileWriteBytesHandler,
    fileExistsHandler, fileDeleteHandler, fileCopyHandler,
    dirCreateHandler, dirDeleteHandler, dirListHandler, dirExistsHandler,
} from "./fs-rpc-handlers";

// ── 暗号化基盤 ────────────────────────────────────────
export const _VJA_PASSPHRASE = "vja-form-designer-2024-xK9mPqR7nL2wT5vY";

export const _deriveKey = async (passphrase: string): Promise<CryptoKey> => {
    const keyMaterial = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: new TextEncoder().encode("vja-salt-2024"), iterations: 100000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
};

export const _decrypt = async (b64: string, passphrase: string): Promise<string> => {
    const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv = buf.slice(0, 12);
    const cipher = buf.slice(12);
    const key = await _deriveKey(passphrase);
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    return new TextDecoder().decode(plainBuf);
};

export const decryptCredential = async (b64: string): Promise<string> => {
    if (!_vjaPass) return "";
    try { return await _decrypt(b64, _vjaPass); }
    catch (e) { console.debug("[vja] decryptCredential failed:", e); return ""; }
};

// ── プロジェクトデータ ────────────────────────────────
export let _currentProjectForms: any[] = [];
export let _currentProjectTables: TableDef[] = [];
export let _currentProjectName: string = "";
export let _currentProjectDbDir: string = "";
export let _currentProjectExtRuntime: string = "";
export let _cloudInfras: any[] = [];
export let _onStartCode: string = "";
export let _onExitCode: string = "";
export let _vjaPass: string = "";
export let _vjaProject: boolean = false;

export const setProjectData = (data: {
    forms: any[];
    tables: TableDef[];
    name: string;
    dbDir: string;
    extRuntime: string;
    cloudInfras: any[];
    onStartCode: string;
    onExitCode: string;
    vjaPass: string;
}): void => {
    _currentProjectForms = data.forms;
    _currentProjectTables = data.tables;
    _currentProjectName = data.name;
    _currentProjectDbDir = data.dbDir;
    _currentProjectExtRuntime = data.extRuntime;
    _cloudInfras = data.cloudInfras;
    _onStartCode = data.onStartCode;
    _onExitCode = data.onExitCode;
    _vjaPass = data.vjaPass;
};

export const setCloudInfras = (infras: any[]): void => {
    _cloudInfras = infras;
};

// ── セッション管理 ────────────────────────────────────
export const _session = new Map<string, string>();

// ── プロジェクトウィンドウ ────────────────────────────
export let _projectWindow: BrowserWindow | null = null;
let _projectRPC: ReturnType<typeof BrowserView.defineRPC> | null = null;
let _fetchAbortMap = new Map<string, AbortController>();

// ── フォームパス取得（外部から設定可能） ──────────────
// デザイナー版・スタンドアロン版でパスが異なるため、外部から設定する
let _getFormHtmlPath: (formTitle: string) => string = (title) => title;

export const setFormHtmlPathResolver = (fn: (formTitle: string) => string): void => {
    _getFormHtmlPath = fn;
};

export const getProjectFormPath = (formName: string): {
    ok: boolean; path?: string; w?: number; h?: number; error?: string;
} => {
    const form = _currentProjectForms.find((f: any) => (f.cfg.name || f.cfg.title) === formName);
    if (!form) return { ok: false, error: `フォーム "${formName}" が見つかりません` };
    return { ok: true, path: _getFormHtmlPath(form.cfg.name || form.cfg.title), w: form.cfg.w, h: form.cfg.h };
};

// ── AppEvents ─────────────────────────────────────────
const _dbQuery = (sql: string, params?: any[]): any[] => {
    try { return getProjectDb(_currentProjectDbDir).query(sql).all(...(params || [])) as any[]; }
    catch (e) { console.debug("[vja] _dbQuery failed:", e); return []; }
};
const _dbExecute = (sql: string, params?: any[]): any => {
    try { return getProjectDb(_currentProjectDbDir).run(sql, ...(params || [])); }
    catch (e: any) { console.error("[db] execute failed:", e.message); return null; }
};

const _runAppEventCode = async (name: string, code: string): Promise<void> => {
    try {
        const vja = {
            session: {
                get: (key: string) => _session.get(key) ?? null,
                set: (key: string, val: string) => { _session.set(key, val); },
                delete: (key: string) => { _session.delete(key); },
            },
            db: {
                query: (sql: string, params?: any[]) => _dbQuery(sql, params),
                execute: (sql: string, params?: any[]) => _dbExecute(sql, params),
                clearTable: (tableName: string) => _dbExecute(`DELETE FROM ${tableName}`),
            },
            log: {
                info: (msg: string) => console.info("[app]", msg),
                warn: (msg: string) => console.warn("[app]", msg),
                error: (msg: string) => console.error("[app]", msg),
            },
        };
        const fn = new Function("vja", `"use strict";\n${code}`);
        await fn(vja);
        console.log(`[app] ${name} 実行完了`);
    } catch (e: any) {
        console.error(`[app] ${name} 実行エラー:`, e.message);
    }
};

export const runOnStart = async (): Promise<void> => {
    if (_session.get("__onStart_done__")) return;
    _session.set("__onStart_done__", "1");

    // テーブル定義があればDB初期化
    if (_currentProjectDbDir && _currentProjectTables.length > 0) {
        if (!existsSync(_currentProjectDbDir)) mkdirSync(_currentProjectDbDir, { recursive: true });
        try { await initProjectDb(_currentProjectDbDir, _currentProjectTables); }
        catch (e: any) { console.error("[db] DB初期化エラー:", e.message); }
    }

    // マスターCSVのINSERT処理（テーブルが0件の場合のみ）
    for (const tbl of _currentProjectTables) {
        const csv = (tbl as any).masterCsv;
        if (!csv?.data) continue;
        try {
            const db = getProjectDb(_currentProjectDbDir);
            const countRow = db.query(`SELECT COUNT(*) as cnt FROM ${tbl.name}`).get() as any;
            if (countRow?.cnt !== 0) continue;
            const text = await decompressGzip(csv.data);
            const lines = text.split(/\r?\n/).filter((l: string) => l.trim());
            if (lines.length < 2) continue;
            const headers = parseCsvLine(lines[0]);
            const tblCols = tbl.columns.map((c: any) => c.name);
            const validHeaders = headers.filter((h: string) => tblCols.includes(h));
            if (validHeaders.length === 0) continue;
            const colIndices = validHeaders.map((h: string) => headers.indexOf(h));
            const stmt = db.prepare(
                `INSERT INTO ${tbl.name} (${validHeaders.join(",")}) VALUES (${validHeaders.map(() => "?").join(",")})`
            );
            const tx = db.transaction(() => {
                for (let i = 1; i < lines.length; i++) {
                    const vals = parseCsvLine(lines[i]);
                    if (vals.length === 0) continue;
                    const row = colIndices.map((idx: number) => vals[idx] ?? null);
                    stmt.run(...row);
                }
            });
            tx();
            console.log(`[db] マスターCSVインポート完了: ${tbl.name} (${lines.length - 1} 行)`);
        } catch (e: any) {
            console.error(`[db] マスターCSVインポートエラー (${tbl.name}):`, e.message);
        }
    }

    const code = _onStartCode.trim();
    if (code) await _runAppEventCode("onStart", code);
};

export const runOnExit = async (): Promise<void> => {
    const code = _onExitCode.trim();
    if (!code) return;
    await _runAppEventCode("onExit", code);
};

// vjaプロジェクト実行設定.
export const setVjaProject = (mode: true): void => {
    _vjaProject = mode;
}

// vjaプロジェクト実行モード取得.
export const getVjaProject = (): boolean => _vjaProject;

// ── URL読み込み ───────────────────────────────────────
export const _loadProjectURL = async (htmlPath: string): Promise<void> => {
    if (!_projectWindow) throw new Error("プロジェクトウィンドウが開いていません");
    const projDir = dirname(htmlPath);
    _projectWindow.webview.setNavigationRules([`file://${projDir}/*`]);
    await _projectWindow.webview.loadURL(`file://${htmlPath}`);
    // ロック解除はpageLoadedRequest（DOMContentLoaded通知）で行う
};

export const navigateProjectWindow = async (htmlPath: string, w: number, h: number): Promise<void> => {
    if (!_projectWindow) return;
    _projectWindow.setSize(w, h);
    await _loadProjectURL(htmlPath);
};

// ── プロジェクトウィンドウを閉じる ────────────────────
export const closeProjectWindow = (): void => {
    if (!_projectWindow) return;
    const win = _projectWindow;
    _projectWindow = null;
    _projectRPC = null;
    try { win.close(); console.log("[project] closed"); }
    catch (e) { console.error("[project] closeProjectWindow エラー:", e); }
};

const _onProjectWindowClosed = (): void => {
    (async () => {
        try { await runOnExit(); }
        catch (err: any) { console.error("[close] 終了トリガーエラー:", err); }
        finally {
            try { closeProjectDb(); } catch (e: any) { console.debug("[close] closeProjectDb failed:", e.message); }
            _session.clear();
            _projectWindow = null;
            _projectRPC = null;
        }
    })();
};

// ── プロジェクトウィンドウを開く ──────────────────────
export const openProjectWindow = async (htmlPath: string, w: number, h: number, onStop?: () => void): Promise<void> => {
    _session.clear();

    _projectRPC = BrowserView.defineRPC<VjaRPCType>({
        // タイムアウト無し（Infinity）。理由はsrc/bun/index.tsの同項目コメント参照。
        maxRequestTime: Infinity,
        handlers: {
            // 【重要】requests/messagesの使い分けの方針はsrc/shared/types.tsの
            // コメントを参照。以前は全RPCをmessages（一方向・相関ID無し）で
            // 自前実装しており、同種のRPCを連続で呼ぶと先の呼び出しのPromiseが
            // 後発呼び出しに上書きされ永久にハングするバグがあった。
            requests: {
                navigateFormRequest: async ({ formName }) => {
                    try {
                        const result = getProjectFormPath(formName);
                        if (!result.ok || !result.path) {
                            return { ok: false, error: result.error };
                        }
                        await navigateProjectWindow(result.path, result.w!, result.h!);
                        return { ok: true };
                    } catch (e: any) {
                        return { ok: false, error: e.message };
                    }
                },

                sessionGetRequest: ({ key }) => {
                    return { ok: true, value: _session.get(key) ?? null };
                },
                sessionSetRequest: ({ key, value }) => {
                    if (key === "__clear_all__" && value === "__clear__") {
                        _session.clear();
                    } else if (value === null) {
                        _session.delete(key);
                    } else {
                        _session.set(key, value);
                    }
                    return { ok: true };
                },

                dbQueryRequest: async ({ sql, params }) => {
                    try {
                        const rows = _dbQuery(sql, params);
                        return { ok: true, rows };
                    } catch (e: any) {
                        return { ok: false, rows: [], error: e.message };
                    }
                },
                dbExecuteRequest: async ({ sql, params }) => {
                    try {
                        const r = _dbExecute(sql, params);
                        return {
                            ok: true, result: { changes: r?.changes ?? 0, lastInsertRowid: Number(r?.lastInsertRowid ?? 0) },
                        };
                    } catch (e: any) {
                        return {
                            ok: false, result: { changes: 0, lastInsertRowid: 0 }, error: e.message,
                        };
                    }
                },
                dbTransactionRequest: async ({ statements }) => {
                    try {
                        const db = getProjectDb(_currentProjectDbDir);
                        db.transaction(() => {
                            for (const { sql, params } of statements) _dbExecute(sql, params);
                        })();
                        return { ok: true };
                    } catch (e: any) {
                        return { ok: false, error: e.message };
                    }
                },
                dbInitRequest: async ({ ddlStatements }) => {
                    try {
                        const db = getProjectDb(_currentProjectDbDir);
                        db.transaction(() => {
                            for (const ddl of ddlStatements) _dbExecute(ddl);
                        })();
                        return { ok: true };
                    } catch (e: any) {
                        return { ok: false, error: e.message };
                    }
                },

                openFileRequest: async ({ filter, lastPath }) => {
                    try {
                        const ext = filter === "vjaproj" ? "vjaproj" : filter;
                        const startingFolder = lastPath ? dirname(lastPath) : import.meta.dir;
                        const paths = await Utils.openFileDialog({
                            allowedFileTypes: process.platform === "win32" || process.platform === "darwin" ? ext : `*.${ext}`,
                            startingFolder,
                        });
                        const path = paths?.[0] ?? null;
                        if (path) {
                            const content = await Bun.file(path).text();
                            return { content, path };
                        }
                        return { content: null, path: null };
                    } catch (e: any) {
                        console.error("[project] openFileRequest failed:", e.message);
                        return { content: null, path: null };
                    }
                },

                clearProjectDbRequest: async () => {
                    try {
                        closeProjectDb();
                        clearProjectDb(_currentProjectDbDir);
                        return { ok: true };
                    } catch (e: any) {
                        return { ok: false, error: e.message };
                    }
                },

                // src/bun/index.tsと処理内容が変わらない純粋な処理のため、
                // fs-rpc-handlers.tsに共通化している
                fileReadRequest: fileReadHandler,
                fileWriteRequest: fileWriteHandler,
                fileReadBytesRequest: fileReadBytesHandler,
                fileWriteBytesRequest: fileWriteBytesHandler,
                fileExistsRequest: fileExistsHandler,
                fileDeleteRequest: fileDeleteHandler,
                fileCopyRequest: fileCopyHandler,
                dirCreateRequest: dirCreateHandler,
                dirDeleteRequest: dirDeleteHandler,
                dirListRequest: dirListHandler,
                dirExistsRequest: dirExistsHandler,

                getCloudInfrasRequest: async () => {
                    // クレデンシャルは getDecryptedCredentialRequest で個別取得するため、ここでは復号しない
                    return { infras: _cloudInfras };
                },
                getDecryptedCredentialRequest: async ({ infraId, key }) => {
                    try {
                        const inf = _cloudInfras.find((c: any) => c.id === infraId);
                        if (!inf) return { ok: false, value: "" };
                        const raw = inf.credentials?.[key] || "";
                        const value = raw ? await decryptCredential(raw) : "";
                        return { ok: true, value };
                    } catch (e: any) {
                        return { ok: false, value: "" };
                    }
                },
            },
            messages: {
                logRequest: ({ level, message }) => {
                    writeLog(level, `[proj] ${message}`);
                },
                pageLoadedRequest: () => {
                    // ページ読み込み完了 → 遷移をロック
                    _projectWindow?.webview.setNavigationRules(["^*"]);
                },

                // 明示的な呼び出しの応答と、予期せず閉じられた場合の通知を
                // 兼ねるためmessagesのまま（詳細はsrc/shared/types.tsのコメント参照）。
                stopProjectRequest: async () => { closeProjectWindow(); onStop?.(); },

                loadScriptRequest: async ({ url }) => {
                    _projectWindow?.webview.rpc.send.loadScriptResult({ url });
                },

                // ── 汎用fetch（WebKitタイムアウト回避） ──────────
                fetchRequest: async ({ fetchId, url, method, headers, body }) => {
                    const ctrl = new AbortController();
                    _fetchAbortMap.set(fetchId, ctrl);
                    try {
                        const res = await fetch(url, {
                            method: method || "GET",
                            headers: headers || {},
                            body: body ?? undefined,
                            signal: ctrl.signal,
                        });
                        const text = await res.text();
                        _projectWindow?.webview.rpc.send.fetchResult({ fetchId, ok: res.ok, status: res.status, headers: Object.fromEntries(res.headers), body: text });
                    } catch (e: any) {
                        if (e.name === "AbortError") {
                            _projectWindow?.webview.rpc.send.fetchResult({ fetchId, ok: false, status: 0, headers: {}, body: "", error: "AbortError" });
                        } else {
                            _projectWindow?.webview.rpc.send.fetchResult({ fetchId, ok: false, status: 0, headers: {}, body: "", error: e.message });
                        }
                    } finally {
                        _fetchAbortMap.delete(fetchId);
                    }
                },

                fetchAbortRequest: async ({ fetchId }) => {
                    const ctrl = _fetchAbortMap.get(fetchId);
                    if (ctrl) {
                        ctrl.abort();
                        _fetchAbortMap.delete(fetchId);
                    }
                    _projectWindow?.webview.rpc.send.fetchAbortResult({ fetchId });
                },
            },
        },
    });

    _projectWindow = new BrowserWindow({
        title: _currentProjectName || "VJA Project",
        frame: { x: 100, y: 100, width: w, height: h },
        titleBarStyle: "hidden",
        rpc: _projectRPC,
    });

    await _loadProjectURL(htmlPath);

    _projectWindow.on("close", () => { _onProjectWindowClosed(); });

    console.log(`[project] opened: ${htmlPath} (${w}x${h})`);

    setTimeout(async () => {
        try { await runOnStart(); }
        catch (e: any) { console.error("[app] OnStart実行エラー:", e.message); }
    }, 300);
};
