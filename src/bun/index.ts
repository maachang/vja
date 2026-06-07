// src/bun/index.ts
// VJA Form Designer - Electrobun メインプロセス

import { BrowserWindow, BrowserView, Utils, Screen } from "electrobun/bun";
import { homedir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { dirname, join } from "path";
import {
    existsSync,
    readFileSync,
    mkdirSync,
    rmSync,
    copyFileSync,
    readdirSync,
} from "fs";
import { Database } from "bun:sqlite";
import { type VjaRPCType, type DbRow, type DbResult } from "../shared/types";
import { initLogger, writeLog } from "./logger";

const _TITLE = "VJA Form Designer";
const _VERSION = "0.1.0";
const execFileAsync = promisify(execFile);

// ── コマンド実行ヘルパー ──────────────────────────────
const execCmd = async (cmd: string[]): Promise<string> => {
    try {
        const [bin, ...args] = cmd;
        const { stdout } = await execFileAsync(bin, args);
        return (stdout ?? "").trim();
    } catch {
        return "";
    }
};

// ── アプリデータディレクトリ ──────────────────────────
const _appName = "VJAFormDesigner";
const _dataDir = join(homedir(), ".vja-apps", _appName);
const _dbPath = join(_dataDir, "app.db");
const _logDir = join(process.cwd(), "logs");

// ── ロガー初期化（console上書き・ファイル出力開始） ──
initLogger({ dir: _logDir, level: "info" });


// ── 前回フォルダ永続化 ────────────────────────────────
const _configDir = join(homedir(), ".vja-designer");
const _lastDirFile = join(_configDir, "last-dir.txt");

const loadLastDir = (): string => {
    try {
        if (existsSync(_lastDirFile)) {
            const saved = readFileSync(_lastDirFile, "utf-8").trim();
            if (saved && existsSync(saved)) return saved;
        }
    } catch { }
    return homedir();
};
const saveLastDir = async (filePath: string): Promise<void> => {
    try {
        const dir = dirname(filePath);
        if (!existsSync(_configDir)) mkdirSync(_configDir, { recursive: true });
        await Bun.write(_lastDirFile, dir);
    } catch { }
};
let _lastDir: string = loadLastDir();

// ── SQLite DB インスタンス（アプリ用） ────────────────
let _db: Database | null = null;

const getDb = (): Database => {
    if (!_db) {
        if (!existsSync(_dataDir)) mkdirSync(_dataDir, { recursive: true });
        _db = new Database(_dbPath);
        _db.run("PRAGMA journal_mode = WAL");
        _db.run("PRAGMA foreign_keys = ON");
    }
    return _db;
};

// ── ログ出力 ──────────────────────────────────────────
// ── 保存ダイアログ ────────────────────────────────────
const saveFileDialog = async (
    defaultName: string,
    ext: string,
): Promise<string | null> => {
    const defaultPath = join(_lastDir, defaultName);
    if (process.platform === "darwin") {
        const script = `choose file name default name "${defaultName}" with prompt "保存先を選択"`;
        const out = await execCmd(["osascript", "-e", script]);
        if (!out) return null;
        let p = out.replace(/^alias [^:]+:/, "/").replace(/:/g, "/").replace(/\n/g, "");
        return p && !p.endsWith("." + ext) ? p + "." + ext : p || null;
    } else if (process.platform === "linux") {
        const hasZenity = (await execCmd(["which", "zenity"])).length > 0;
        const hasKdialog = !hasZenity && (await execCmd(["which", "kdialog"])).length > 0;
        if (hasZenity) {
            const out = await execCmd([
                "zenity", "--file-selection", "--save", "--confirm-overwrite",
                `--filename=${defaultPath}`, "--title=保存先を選択", `--file-filter=*.${ext}`,
            ]);
            return out ? (out.endsWith("." + ext) ? out : out + "." + ext) : null;
        } else if (hasKdialog) {
            const out = await execCmd(["kdialog", "--getsavefilename", defaultPath, `*.${ext}`]);
            return out ? (out.endsWith("." + ext) ? out : out + "." + ext) : null;
        }
        return null;
    } else if (process.platform === "win32") {
        const ps = `Add-Type -AssemblyName System.Windows.Forms\n$d = New-Object System.Windows.Forms.SaveFileDialog\n$d.Filter = "${ext} files (*.${ext})|*.${ext}"\n$d.FileName = "${defaultPath}"\n$d.Title = "保存先を選択"\nif($d.ShowDialog() -eq 'OK'){ $d.FileName }`;
        return (await execCmd(["powershell", "-Command", ps])) || null;
    }
    return null;
};

// ── RPC 定義 ──────────────────────────────────────────
const vjaRPC = BrowserView.defineRPC<VjaRPCType>({
    maxRequestTime: 5000,
    handlers: {
        requests: {},
        messages: {
            // ══ プロジェクトファイル操作 ══════════════

            openFileRequest: async ({ filter, lastPath }) => {
                const ext = filter === "html" ? "html" : "vjaproj";
                const startingFolder = lastPath ? dirname(lastPath) : _lastDir;
                console.log("[open] startingFolder:", startingFolder, "ext:", ext);
                const paths = await Utils.openFileDialog({
                    startingFolder,
                    allowedFileTypes: `*.${ext}`,
                    canChooseFiles: true,
                    canChooseDirectory: false,
                    allowsMultipleSelection: false,
                });
                const path = paths?.length ? paths[0] : null;
                if (!path) {
                    browserWindow.webview.rpc.send.openFileResult({ content: null, path: null });
                    return;
                }
                try {
                    const content = await Bun.file(path).text();
                    _lastDir = dirname(path);
                    await saveLastDir(path);
                    console.log("[open]", path);
                    browserWindow.webview.rpc.send.openFileResult({ content, path });
                } catch (e: any) {
                    console.error("[open error]", e.message);
                    browserWindow.webview.rpc.send.openFileResult({ content: null, path: null });
                }
            },

            saveFileRequest: async ({ content, defaultName, lastPath }) => {
                let savePath = lastPath ?? null;
                if (!savePath) {
                    savePath = await saveFileDialog(defaultName ?? "project.vjaproj", "vjaproj");
                }
                if (!savePath) {
                    console.log("[save] cancelled");
                    browserWindow.webview.rpc.send.saveFileResult({ ok: false, path: null, cancelled: true });
                    return;
                }
                try {
                    await Bun.write(savePath, content);
                    _lastDir = dirname(savePath);
                    await saveLastDir(savePath);
                    console.log("[saved]", savePath);
                    browserWindow.webview.rpc.send.saveFileResult({ ok: true, path: savePath, cancelled: false });
                } catch (e: any) {
                    console.error("[save error]", e.message);
                    browserWindow.webview.rpc.send.saveFileResult({ ok: false, path: null, cancelled: false });
                }
            },

            closeAppRequest: () => {
                console.log("[close]");
                browserWindow.close();
            },

            // ══ DB: SELECT ════════════════════════════

            dbQueryRequest: async ({ sql, params }) => {
                try {
                    const db = getDb();
                    const stmt = db.prepare(sql);
                    const rows = (params ? stmt.all(...params) : stmt.all()) as DbRow[];
                    browserWindow.webview.rpc.send.dbQueryResult({ ok: true, rows });
                } catch (e: any) {
                    writeLog("error", `dbQuery: ${e.message} | sql: ${sql}`);
                    browserWindow.webview.rpc.send.dbQueryResult({ ok: false, rows: [], error: e.message });
                }
            },

            // ══ DB: INSERT/UPDATE/DELETE ══════════════

            dbExecuteRequest: async ({ sql, params }) => {
                try {
                    const db = getDb();
                    const stmt = db.prepare(sql);
                    const res = params ? stmt.run(...params) : stmt.run();
                    const result: DbResult = {
                        changes: res.changes,
                        lastInsertRowid: Number(res.lastInsertRowid),
                    };
                    browserWindow.webview.rpc.send.dbExecuteResult({ ok: true, result });
                } catch (e: any) {
                    writeLog("error", `dbExecute: ${e.message} | sql: ${sql}`);
                    browserWindow.webview.rpc.send.dbExecuteResult({
                        ok: false,
                        result: { changes: 0, lastInsertRowid: 0 },
                        error: e.message,
                    });
                }
            },

            // ══ DB: トランザクション ══════════════════

            dbTransactionRequest: async ({ statements }) => {
                try {
                    const db = getDb();
                    const tx = db.transaction(() => {
                        for (const s of statements) {
                            const stmt = db.prepare(s.sql);
                            s.params ? stmt.run(...s.params) : stmt.run();
                        }
                    });
                    tx();
                    browserWindow.webview.rpc.send.dbTransactionResult({ ok: true });
                } catch (e: any) {
                    writeLog("error", `dbTransaction: ${e.message}`);
                    browserWindow.webview.rpc.send.dbTransactionResult({ ok: false, error: e.message });
                }
            },

            // ══ DB: 初期化 ════════════════════════════

            dbInitRequest: async ({ ddlStatements }) => {
                try {
                    const db = getDb();
                    const tx = db.transaction(() => {
                        for (const ddl of ddlStatements) db.run(ddl);
                    });
                    tx();
                    browserWindow.webview.rpc.send.dbInitResult({ ok: true });
                } catch (e: any) {
                    writeLog("error", `dbInit: ${e.message}`);
                    browserWindow.webview.rpc.send.dbInitResult({ ok: false, error: e.message });
                }
            },

            // ══ ファイル操作 ══════════════════════════

            fileReadRequest: async ({ path }) => {
                try {
                    const content = await Bun.file(path).text();
                    browserWindow.webview.rpc.send.fileReadResult({ ok: true, content });
                } catch (e: any) {
                    browserWindow.webview.rpc.send.fileReadResult({ ok: false, content: null, error: e.message });
                }
            },

            fileWriteRequest: async ({ path, content }) => {
                try {
                    await Bun.write(path, content);
                    browserWindow.webview.rpc.send.fileWriteResult({ ok: true });
                } catch (e: any) {
                    browserWindow.webview.rpc.send.fileWriteResult({ ok: false, error: e.message });
                }
            },

            fileReadBytesRequest: async ({ path }) => {
                try {
                    const buf = await Bun.file(path).arrayBuffer();
                    const data = Array.from(new Uint8Array(buf));
                    browserWindow.webview.rpc.send.fileReadBytesResult({ ok: true, data });
                } catch (e: any) {
                    browserWindow.webview.rpc.send.fileReadBytesResult({ ok: false, data: null, error: e.message });
                }
            },

            fileWriteBytesRequest: async ({ path, data }) => {
                try {
                    await Bun.write(path, new Uint8Array(data));
                    browserWindow.webview.rpc.send.fileWriteBytesResult({ ok: true });
                } catch (e: any) {
                    browserWindow.webview.rpc.send.fileWriteBytesResult({ ok: false, error: e.message });
                }
            },

            fileExistsRequest: async ({ path }) => {
                const value = existsSync(path);
                browserWindow.webview.rpc.send.fileExistsResult({ ok: true, value });
            },

            fileDeleteRequest: async ({ path }) => {
                try {
                    rmSync(path);
                    browserWindow.webview.rpc.send.fileDeleteResult({ ok: true });
                } catch (e: any) {
                    browserWindow.webview.rpc.send.fileDeleteResult({ ok: false, error: e.message });
                }
            },

            fileCopyRequest: async ({ src, dest }) => {
                try {
                    copyFileSync(src, dest);
                    browserWindow.webview.rpc.send.fileCopyResult({ ok: true });
                } catch (e: any) {
                    browserWindow.webview.rpc.send.fileCopyResult({ ok: false, error: e.message });
                }
            },

            // ══ ディレクトリ操作 ══════════════════════

            dirCreateRequest: async ({ path }) => {
                try {
                    mkdirSync(path, { recursive: true });
                    browserWindow.webview.rpc.send.dirCreateResult({ ok: true });
                } catch (e: any) {
                    browserWindow.webview.rpc.send.dirCreateResult({ ok: false, error: e.message });
                }
            },

            dirDeleteRequest: async ({ path }) => {
                try {
                    rmSync(path, { recursive: true, force: true });
                    browserWindow.webview.rpc.send.dirDeleteResult({ ok: true });
                } catch (e: any) {
                    browserWindow.webview.rpc.send.dirDeleteResult({ ok: false, error: e.message });
                }
            },

            dirListRequest: async ({ path }) => {
                try {
                    const entries = readdirSync(path).map(String);
                    browserWindow.webview.rpc.send.dirListResult({ ok: true, entries });
                } catch (e: any) {
                    browserWindow.webview.rpc.send.dirListResult({ ok: false, entries: [], error: e.message });
                }
            },

            dirExistsRequest: async ({ path }) => {
                const value = existsSync(path);
                browserWindow.webview.rpc.send.dirExistsResult({ ok: true, value });
            },

            // ══ ログ ══════════════════════════════════

            logRequest: async ({ level, message }) => {
                writeLog(level, message);
                browserWindow.webview.rpc.send.logResult({ ok: true });
            },

            // ══ アプリ情報 ════════════════════════════

            appInfoRequest: () => {
                browserWindow.webview.rpc.send.appInfoResult({
                    ok: true,
                    info: {
                        dataDir: _dataDir,
                        dbPath: _dbPath,
                        appName: _appName,
                        version: _VERSION,
                    },
                });
            },

            // ══ ダイアログ ════════════════════════════

            appDialogRequest: async ({ type, message }) => {
                try {
                    if (type === "confirm") {
                        const res = await Utils.showMessageBox({
                            type: "question",
                            title: _TITLE,
                            message,
                            buttons: ["キャンセル", "OK"],
                            defaultId: 1,
                            cancelId: 0,
                        });
                        browserWindow.webview.rpc.send.appDialogResult({
                            ok: true,
                            confirmed: res.response === 1,
                        });
                    } else {
                        await Utils.showMessageBox({
                            type: "info",
                            title: _TITLE,
                            message,
                            buttons: ["OK"],
                        });
                        browserWindow.webview.rpc.send.appDialogResult({ ok: true });
                    }
                } catch (e: any) {
                    browserWindow.webview.rpc.send.appDialogResult({ ok: false });
                }
            },
        },
    },
});

// ── BrowserWindow 生成 ────────────────────────────────
const isWin = process.platform === "win32";
let initW = 1280, initH = 800;
if (isWin) {
    // ─────────────────────────────────────────────────────
    // 【暫定対応】Windows フルスクリーン問題
    // Electrobun の maximize() が Windows では WebView のリサイズに
    // 追従しないため、起動時のフレームサイズを作業領域に合わせて設定する。
    // 2環境で動作確認済みだが、DPI設定やマルチモニター環境では
    // 異なる結果になる可能性があるため、暫定対応とする。
    // ─────────────────────────────────────────────────────
    try {
        // OSで設定されている全体サイズを取得
        const ps = `Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width.ToString()+','+[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height.ToString()`;
        const { stdout } = await execFileAsync("powershell", ["-Command", ps]);
        const [w, h] = stdout.trim().split(",").map(Number);

        // ディスプレイの有効領域（タスクバーを除いたサイズ）を取得
        const primaryDisplay = Screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.workArea;
        initW = width;
        initH = height - (((h - height) >> 1) - 1);
    } catch { }
}

const browserWindow = new BrowserWindow({
    title: _TITLE,
    url: "views://mainview/index.html",
    frame: { x: 0, y: 0, width: initW, height: initH },
    rpc: vjaRPC,
});

// フルスクリーン
browserWindow.maximize();
