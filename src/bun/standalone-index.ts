// src/bun/index.ts  (スタンドアロン版)
// vjaでコンパイルされたプロジェクトの実行エントリポイント。
// vjaデザイナー機能は含まない。起動時に .vjaproj を読み込み直接実行する。

import { BrowserWindow, BrowserView } from "electrobun/bun";
import { existsSync, mkdirSync, copyFileSync, rmSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { initLogger, writeLog } from "./logger";
import { decompressGzip, parseCsvLine } from "./bun-utils";
import { initProjectDb, clearProjectDb, getProjectDb, closeProjectDb } from "./db-manager";
import type { VjaRPCType, TableDef } from "../shared/types";

// ── パス定義 ──────────────────────────────────────────
// スタンドアロン版ではログ・DBは実行ファイル直下（process.cwd()）に出力する
const _appDir    = process.cwd();
const _logDir    = join(_appDir, "logs");
const _dbDir     = join(_appDir, "db");

// ── ロガー初期化 ──────────────────────────────────────
initLogger({ dir: _logDir, level: "info" });

// ── 暗号化基盤 ───────────────────────────────────────────
const _VJA_PASSPHRASE = "vja-form-designer-2024-xK9mPqR7nL2wT5vY";

const _deriveKey = async (passphrase: string): Promise<CryptoKey> => {
    const keyMaterial = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: new TextEncoder().encode("vja-salt-2024"), iterations: 100000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
};

const _decrypt = async (b64: string, passphrase: string): Promise<string> => {
    const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv = buf.slice(0, 12);
    const cipher = buf.slice(12);
    const key = await _deriveKey(passphrase);
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    return new TextDecoder().decode(plainBuf);
};

let _vjaPass: string = "";

const decryptCredential = async (b64: string): Promise<string> => {
    if (!_vjaPass) return "";
    try { return await _decrypt(b64, _vjaPass); } catch (e) { console.debug("[vja] decryptCredential failed:", e); return ""; }
};

// ── プロジェクトデータ ────────────────────────────────
let _currentProjectForms:   any[]      = [];
let _currentProjectTables:  TableDef[] = [];
let _currentProjectName:    string     = "";
let _currentProjectDbDir:   string     = _dbDir;
let _currentProjectExtRuntime: string  = "";
let _cloudInfras: any[] = [];
let _onStartCode = "";
let _onExitCode  = "";

// ── セッション管理 ────────────────────────────────────
const _session = new Map<string, string>();

// ── プロジェクトウィンドウ ────────────────────────────
let _projectWindow: BrowserWindow | null = null;
let _projectRPC: ReturnType<typeof BrowserView.defineRPC> | null = null;

// ── .vjaproj の読み込み ───────────────────────────────
// スタンドアロン版では import.meta.dir と同じディレクトリの project.vjaproj を読む
const _projFile = join(import.meta.dir, "..", "project.vjaproj");

const loadProject = (): boolean => {
    try {
        if (!existsSync(_projFile)) {
            console.error(`[app] project.vjaproj が見つかりません: ${_projFile}`);
            return false;
        }
        const json = readFileSync(_projFile, "utf-8");
        const proj = JSON.parse(json);
        _currentProjectForms   = proj.forms   || [];
        _currentProjectTables  = proj.tables  || [];
        _currentProjectName    = proj.projectInfo?.name || "project";
        _onStartCode           = proj.projectInfo?.appEvents?.onStart || "";
        _onExitCode            = proj.projectInfo?.appEvents?.onExit  || "";
        _currentProjectExtRuntime = proj.extRuntime?.js || "";
        _cloudInfras = proj.cloudInfras || [];
        // _vjaPass 復号
        if (proj._vjaPass) {
            try { _vjaPass = await _decrypt(proj._vjaPass, _VJA_PASSPHRASE); } catch (e) { console.debug("[vja] vjaPass decrypt failed:", e); }
        }
        return true;
    } catch (e: any) {
        console.error("[app] プロジェクト読み込み失敗:", e.message);
        return false;
    }
};

// ── HTML生成 ──────────────────────────────────────────
// スタンドアロン版ではビルド時に views/ 以下に生成済みのHTMLを使う
// フォーム名から HTML パスを取得する
const getFormHtmlPath = (formTitle: string): string =>
    join(import.meta.dir, "..", "views", "mainview", `${formTitle}.html`);

// ── フォームパス取得 ──────────────────────────────────
const getProjectFormPath = (formName: string): {
    ok: boolean; path?: string; w?: number; h?: number; error?: string;
} => {
    const form = _currentProjectForms.find(
        (f: any) => f.cfg.title === formName
    );
    if (!form) return { ok: false, error: `フォーム "${formName}" が見つかりません` };
    return { ok: true, path: getFormHtmlPath(form.cfg.title), w: form.cfg.w, h: form.cfg.h };
};

// ── AppEvents 実行 ────────────────────────────────────
const _getSession    = (key: string): string | null => _session.get(key) ?? null;
const _setSession    = (key: string, val: string): void => { _session.set(key, val); };
const _deleteSession = (key: string): void => { _session.delete(key); };

const _dbQuery = (sql: string, params?: any[]): any[] => {
    try {
        return getProjectDb(_currentProjectDbDir).query(sql).all(...(params || [])) as any[];
    } catch (e) { console.debug("[vja] catch:", e); return []; }
};
const _dbExecute = (sql: string, params?: any[]): any => {
    try {
        return getProjectDb(_currentProjectDbDir).run(sql, ...(params || []));
    } catch { return null; }
};

const _runAppEventCode = async (name: string, code: string): Promise<void> => {
    const tmpFile = join(_appDir, `.vja_${name}_tmp_${Date.now()}.ts`);
    try {
        const wrapper = `
export const vja = {
    session: {
        get: (key: string) => _getSession(key),
        set: (key: string, val: string) => _setSession(key, val),
        delete: (key: string) => _deleteSession(key),
    },
    db: {
        query:      (sql: string, params?: any[]) => _dbQuery(sql, params),
        execute:    (sql: string, params?: any[]) => _dbExecute(sql, params),
        clearTable: (tableName: string)           => _dbExecute("DELETE FROM " + tableName),
    },
    log: {
        info:  (msg: string) => console.info("[app]", msg),
        warn:  (msg: string) => console.warn("[app]", msg),
        error: (msg: string) => console.error("[app]", msg),
    },
};
${code}
`;
        await Bun.write(tmpFile, wrapper);
        await import(tmpFile);
        console.log(`[app] ${name} 実行完了`);
    } catch (e: any) {
        console.error(`[app] ${name} 実行エラー:`, e.message);
    } finally {
        try { rmSync(tmpFile); } catch (e) { console.debug("[vja] rmSync failed:", e); }
    }
};

const runOnStart = async (): Promise<void> => {
    if (_session.get("__onStart_done__")) return;
    _session.set("__onStart_done__", "1");

    // テーブル定義があればDB初期化
    if (_currentProjectTables.length > 0) {
        if (!existsSync(_currentProjectDbDir)) mkdirSync(_currentProjectDbDir, { recursive: true });
        try {
            await initProjectDb(_currentProjectDbDir, _currentProjectTables);
        } catch (e: any) {
            console.error("[db] DB初期化エラー:", e.message);
        }
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
            const lines = text.split(/
?
/).filter((l: string) => l.trim());
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



const runOnExit = async (): Promise<void> => {
    const code = _onExitCode.trim();
    if (!code) return;
    await _runAppEventCode("onExit", code);
};

// ── URL読み込み ───────────────────────────────────────
const _loadProjectURL = async (htmlPath: string): Promise<void> => {
    if (!_projectWindow) throw new Error("プロジェクトウィンドウが開いていません");
    await _projectWindow.webview.loadURL(`file://${htmlPath}`);
};

const navigateProjectWindow = async (htmlPath: string, w: number, h: number): Promise<void> => {
    if (!_projectWindow) return;
    _projectWindow.setSize(w, h);
    await _loadProjectURL(htmlPath);
};

// ── プロジェクトウィンドウを開く ──────────────────────
const openProjectWindow = async (htmlPath: string, w: number, h: number): Promise<void> => {
    _session.clear();

    _projectRPC = BrowserView.defineRPC<VjaRPCType>({
        maxRequestTime: 5000,
        handlers: {
            requests: {},
            messages: {
                logRequest: ({ level, message }) => {
                    writeLog(level, `[proj] ${message}`);
                },
                pageLoadedRequest: () => {
                    // スタンドアロン版では遷移制限不要
                },
                navigateFormRequest: async ({ formName }) => {
                    try {
                        const result = getProjectFormPath(formName);
                        if (!result.ok || !_projectWindow) return;
                        await navigateProjectWindow(result.path!, result.w!, result.h!);
                    } catch (e: any) {
                        console.error("[project] navigate error:", e.message);
                    }
                },
                sessionGetRequest: ({ key }) => {
                    const value = _session.get(key) ?? null;
                    _projectWindow?.webview.rpc.send.sessionGetResult({ ok: true, value });
                },
                sessionSetRequest: ({ key, value }) => {
                    if (key === "__clear_all__" && value === "__clear__") {
                        _session.clear();
                    } else if (value === null) {
                        _session.delete(key);
                    } else {
                        _session.set(key, value);
                    }
                    _projectWindow?.webview.rpc.send.sessionSetResult({ ok: true });
                },
                stopProjectRequest: async () => {
                    closeProjectWindow();
                },
                dbQueryRequest: async ({ sql, params }) => {
                    try {
                        const rows = getProjectDb(_currentProjectDbDir).query(sql).all(...(params || []));
                        _projectWindow?.webview.rpc.send.dbQueryResult({ ok: true, rows: rows as any });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.dbQueryResult({ ok: false, rows: [], error: e.message });
                    }
                },
                dbExecuteRequest: async ({ sql, params }) => {
                    try {
                        const r = getProjectDb(_currentProjectDbDir).run(sql, ...(params || []));
                        _projectWindow?.webview.rpc.send.dbExecuteResult({
                            ok: true,
                            result: { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) },
                        });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.dbExecuteResult({
                            ok: false, result: { changes: 0, lastInsertRowid: 0 }, error: e.message,
                        });
                    }
                },
                dbTransactionRequest: async ({ statements }) => {
                    try {
                        const db = getProjectDb(_currentProjectDbDir);
                        const tx = db.transaction(() => {
                            for (const { sql, params } of statements) {
                                db.run(sql, ...(params || []));
                            }
                        });
                        tx();
                        _projectWindow?.webview.rpc.send.dbTransactionResult({ ok: true });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.dbTransactionResult({ ok: false, error: e.message });
                    }
                },

                // ── クラウドインフラ ──────────────────────────
                getCloudInfrasRequest: async () => {
                    try {
                        const decrypted = await Promise.all(_cloudInfras.map(async (inf: any) => {
                            const creds: Record<string, string> = {};
                            for (const [k, v] of Object.entries(inf.credentials || {})) {
                                creds[k] = v ? await decryptCredential(v as string) : "";
                            }
                            return { ...inf, credentials: creds };
                        }));
                        _projectWindow?.webview.rpc.send.getCloudInfrasResult({ infras: decrypted });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.getCloudInfrasResult({ infras: [] });
                    }
                },

                getDecryptedCredentialRequest: async ({ infraId, key }: { infraId: string; key: string }) => {
                    try {
                        const inf = _cloudInfras.find((c: any) => c.id === infraId);
                        if (!inf) {
                            _projectWindow?.webview.rpc.send.getDecryptedCredentialResult({ ok: false, value: "" });
                            return;
                        }
                        const raw = inf.credentials?.[key] || "";
                        const value = raw ? await decryptCredential(raw) : "";
                        _projectWindow?.webview.rpc.send.getDecryptedCredentialResult({ ok: true, value });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.getDecryptedCredentialResult({ ok: false, value: "" });
                    }
                },

                loadScriptRequest: async ({ url }: { url: string }) => {
                    _projectWindow?.webview.rpc.send.loadScriptResult({ url });
                },

                // ── DBクリア ──────────────────────────────────
                clearProjectDbRequest: async () => {
                    try {
                        closeProjectDb();
                        clearProjectDb(_currentProjectDbDir);
                        _projectWindow?.webview.rpc.send.clearProjectDbResult({ ok: true });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.clearProjectDbResult({ ok: false, error: e.message });
                    }
                },

                // ── ファイル操作 ──────────────────────────────
                fileReadRequest: async ({ path }) => {
                    try {
                        const content = await Bun.file(path).text();
                        _projectWindow?.webview.rpc.send.fileReadResult({ ok: true, content });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.fileReadResult({ ok: false, content: null, error: e.message });
                    }
                },
                fileWriteRequest: async ({ path, content }) => {
                    try {
                        await Bun.write(path, content);
                        _projectWindow?.webview.rpc.send.fileWriteResult({ ok: true });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.fileWriteResult({ ok: false, error: e.message });
                    }
                },
                fileReadBytesRequest: async ({ path }) => {
                    try {
                        const buf = await Bun.file(path).arrayBuffer();
                        const data = Array.from(new Uint8Array(buf));
                        _projectWindow?.webview.rpc.send.fileReadBytesResult({ ok: true, data });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.fileReadBytesResult({ ok: false, data: null, error: e.message });
                    }
                },
                fileWriteBytesRequest: async ({ path, data }) => {
                    try {
                        await Bun.write(path, new Uint8Array(data));
                        _projectWindow?.webview.rpc.send.fileWriteBytesResult({ ok: true });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.fileWriteBytesResult({ ok: false, error: e.message });
                    }
                },
                fileExistsRequest: async ({ path }) => {
                    const value = existsSync(path);
                    _projectWindow?.webview.rpc.send.fileExistsResult({ ok: true, value });
                },
                fileDeleteRequest: async ({ path }) => {
                    try {
                        rmSync(path);
                        _projectWindow?.webview.rpc.send.fileDeleteResult({ ok: true });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.fileDeleteResult({ ok: false, error: e.message });
                    }
                },
                fileCopyRequest: async ({ src, dest }) => {
                    try {
                        copyFileSync(src, dest);
                        _projectWindow?.webview.rpc.send.fileCopyResult({ ok: true });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.fileCopyResult({ ok: false, error: e.message });
                    }
                },

                // ── ディレクトリ操作 ──────────────────────────
                dirCreateRequest: async ({ path }) => {
                    try {
                        mkdirSync(path, { recursive: true });
                        _projectWindow?.webview.rpc.send.dirCreateResult({ ok: true });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.dirCreateResult({ ok: false, error: e.message });
                    }
                },
                dirDeleteRequest: async ({ path }) => {
                    try {
                        rmSync(path, { recursive: true, force: true });
                        _projectWindow?.webview.rpc.send.dirDeleteResult({ ok: true });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.dirDeleteResult({ ok: false, error: e.message });
                    }
                },
                dirListRequest: async ({ path }) => {
                    try {
                        const entries = readdirSync(path).map(String);
                        _projectWindow?.webview.rpc.send.dirListResult({ ok: true, entries });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.dirListResult({ ok: false, entries: [], error: e.message });
                    }
                },
                dirExistsRequest: async ({ path }) => {
                    const value = existsSync(path);
                    _projectWindow?.webview.rpc.send.dirExistsResult({ ok: true, value });
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

    _projectWindow.on("close", () => {
        _onProjectWindowClosed();
    });

    console.log(`[project] opened: ${htmlPath} (${w}x${h})`);

    setTimeout(async () => {
        try { await runOnStart(); } catch (e: any) {
            console.error("[app] OnStart実行エラー:", e.message);
        }
    }, 300);
};

// ── プロジェクトウィンドウを閉じる ────────────────────
const closeProjectWindow = (): void => {
    if (_projectWindow) {
        const win = _projectWindow;
        _projectWindow = null;
        _projectRPC    = null;
        try {
            _session.clear();
            win.close();
            console.log("[project] closed");
        } catch (e) {
            console.error("[project] closeProjectWindow エラー:", e);
        }
    }
};

const _onProjectWindowClosed = (): void => {
    (async () => {
        try { await runOnExit(); } catch (err: any) {
            console.error("[close] 終了トリガーでエラーが発生", err);
        } finally {
            try { closeProjectDb(); } catch (e) { console.debug("[vja] closeProjectDb failed:", e); }
            try { _session.clear(); } catch (e) { console.debug("[vja] session.clear failed:", e); }
            _projectWindow = null;
            _projectRPC    = null;
        }
    })();
};

// ── エントリポイント ──────────────────────────────────
if (!loadProject()) {
    console.error("[app] プロジェクトの読み込みに失敗しました。終了します。");
    process.exit(1);
}

const startForm = _currentProjectForms[0];
if (!startForm) {
    console.error("[app] フォームが1つもありません。終了します。");
    process.exit(1);
}

const startFormPath = getFormHtmlPath(startForm.cfg.title);
if (!existsSync(startFormPath)) {
    console.error(`[app] 開始フォームのHTMLが見つかりません: ${startFormPath}`);
    process.exit(1);
}

await openProjectWindow(startFormPath, startForm.cfg.w, startForm.cfg.h);
