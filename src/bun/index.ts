// src/bun/index.ts
// VJA Form Designer - Electrobun メインプロセス

import { BrowserWindow, BrowserView, Utils, Screen, ApplicationMenu } from "electrobun/bun";
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
import { copyCompileAssets, getVersion, COPY_BUILD_FILES, BUILD_VJA_SRC_PATH } from "./copy-compile-assets";
import { clearProjectDb, closeProjectDb } from "./db-manager";
import {
    _VJA_PASSPHRASE, _decrypt, _deriveKey,
    setProjectData, setFormHtmlPathResolver, setCloudInfras,
    openProjectWindow, closeProjectWindow, navigateProjectWindow, getProjectFormPath,
    _currentProjectForms, _currentProjectName,
    _cloudInfras, _session, _projectWindow,
} from "./project-runner";

// vja の名前とバージョンを取得.
const _VJA_VERION = getVersion();

// jsonからタイトルとバージョンを取得.
const _TITLE = _VJA_VERION.name;
const _VERSION = _VJA_VERION.version;
const _VJA_RUN_MODE = _VJA_VERION.runMode;

// 一旦コンソール出力.
process.stdout.write("### run index.ts: " + _TITLE + "(" + _VERSION + "): " + _VJA_RUN_MODE + "\n");

// 非同ファイル実行用.
const execFileAsync = promisify(execFile);

// ── コマンド実行ヘルパー ──────────────────────────────
const execCmd = async (cmd: string[]): Promise<string> => {
    try {
        const [bin, ...args] = cmd;
        const { stdout } = await execFileAsync(bin, args);
        return (stdout ?? "").trim();
    } catch (e) {
        console.debug("[vja] loadLastDir failed:", e);
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

// ── コンパイルアセットを最新化 ──────────────────────
copyCompileAssets();


// ── 前回フォルダ永続化 ────────────────────────────────
const _configDir = join(homedir(), ".vja-designer");
const _lastDirFile = join(_configDir, "last-dir.txt");

// ── 暗号化基盤（index.ts固有: 暗号化のみ。復号・パスフレーズはproject-runner.tsから使用） ──
let _vjaPass: string = "";

const _encrypt = async (plain: string, passphrase: string): Promise<string> => {
    const key = await _deriveKey(passphrase);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
    const combined = new Uint8Array(12 + cipherBuf.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuf), 12);
    return Buffer.from(combined).toString("base64");
};

const _generateVjaPass = (): string => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    const arr = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(arr).map(b => chars[b % chars.length]).join("");
};

// プロジェクトJSONからvjaPassを取得（なければ生成）
const _loadVjaPass = async (proj: any): Promise<string> => {
    if (proj._vjaPass) {
        try {
            return await _decrypt(proj._vjaPass, _VJA_PASSPHRASE);
        } catch (e) { console.debug("[vja] decrypt failed, generating new pass:", e); }
    }
    return _generateVjaPass();
};

// vjaPassをプロジェクトJSONに埋め込む（保存前に呼ぶ）
const _injectVjaPass = async (jsonStr: string): Promise<string> => {
    const proj = JSON.parse(jsonStr);
    if (!_vjaPass) _vjaPass = _generateVjaPass();
    proj._vjaPass = await _encrypt(_vjaPass, _VJA_PASSPHRASE);
    return JSON.stringify(proj);
};

// クレデンシャルの暗号化
const encryptCredential = async (plain: string): Promise<string> => {
    if (!_vjaPass) _vjaPass = _generateVjaPass();
    return _encrypt(plain, _vjaPass);
};

// 現在のプロジェクト拡張ランタイム
let _currentProjectExtRuntime: string = "";
let _devToolsOpen: boolean = false;
let _fetchAbortMap = new Map<string, AbortController>();

const loadLastDir = (): string => {
    try {
        if (existsSync(_lastDirFile)) {
            const saved = readFileSync(_lastDirFile, "utf-8").trim();
            if (saved && existsSync(saved)) return saved;
        }
    } catch (e) { console.debug("[vja] loadLastDir failed:", e); }
    return homedir();
};
const saveLastDir = async (filePath: string): Promise<void> => {
    try {
        const dir = dirname(filePath);
        if (!existsSync(_configDir)) mkdirSync(_configDir, { recursive: true });
        await Bun.write(_lastDirFile, dir);
    } catch (e) { console.debug("[vja] saveLastDir failed:", e); }
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
        const script = `POSIX path of (choose file name default name "${defaultName}" with prompt "保存先を選択" default location (path to home folder))`;
        const out = await execCmd(["osascript", "-e", script]);
        if (!out) return null;
        const p = out.trim();
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

            // ── DevTools 開閉 ─────────────────────────
            toggleDevToolsRequest: async () => {
                if (_devToolsOpen) {
                    browserWindow.webview.closeDevTools();
                    _devToolsOpen = false;
                } else {
                    browserWindow.webview.openDevTools();
                    _devToolsOpen = true;
                }
            },

            // ── プロジェクト停止（デザイナーウィンドウから） ──
            stopProjectRequest: async () => {
                closeProjectWindow();
                browserWindow.webview.rpc.send.stopProjectResult({ ok: true });
            },

            // ── クラウドインフラ設定 ──────────────────────

            getCloudInfrasRequest: async () => {
                // 復号済みクレデンシャルを含むインフラ一覧を返す
                try {
                    const decrypted = await Promise.all(_cloudInfras.map(async (inf: any) => {
                        const creds: Record<string, string> = {};
                        for (const [k, v] of Object.entries(inf.credentials || {})) {
                            creds[k] = v ? await decryptCredential(v as string) : "";
                        }
                        return { ...inf, credentials: creds };
                    }));
                    browserWindow.webview.rpc.send.getCloudInfrasResult({ infras: decrypted });
                } catch (e: any) {
                    browserWindow.webview.rpc.send.getCloudInfrasResult({ infras: [] });
                }
            },

            getDecryptedCredentialRequest: async ({ infraId, key }: { infraId: string; key: string }) => {
                try {
                    const inf = _cloudInfras.find((c: any) => c.id === infraId);
                    if (!inf) {
                        browserWindow.webview.rpc.send.getDecryptedCredentialResult({ ok: false, value: "" });
                        return;
                    }
                    const raw = inf.credentials?.[key] || "";
                    const value = raw ? await decryptCredential(raw) : "";
                    browserWindow.webview.rpc.send.getDecryptedCredentialResult({ ok: true, value });
                } catch (e: any) {
                    browserWindow.webview.rpc.send.getDecryptedCredentialResult({ ok: false, value: "" });
                }
            },

            loadScriptRequest: async ({ url }: { url: string }) => {
                browserWindow.webview.rpc.send.loadScriptResult({ url });
            },

            saveCloudInfrasRequest: async ({ infras }: { infras: any[] }) => {
                try {
                    const merged = await Promise.all(infras.map(async (inf) => {
                        const existing = _cloudInfras.find((c: any) => c.id === inf.id);
                        const encCreds: Record<string, string> = {};
                        for (const [k, v] of Object.entries(inf.credentials || {})) {
                            if (v === "****" && existing?.credentials?.[k]) {
                                encCreds[k] = existing.credentials[k];
                            } else if (typeof v === "string" && v !== "****") {
                                encCreds[k] = await encryptCredential(v);
                            }
                        }
                        return { ...inf, credentials: encCreds };
                    }));
                    setCloudInfras(merged);
                    browserWindow.webview.rpc.send.saveCloudInfrasResult({ ok: true });
                } catch (e: any) {
                    browserWindow.webview.rpc.send.saveCloudInfrasResult({ ok: false, error: e.message });
                }
            },

            openFileRequest: async ({ filter, lastPath }) => {
                const ext = filter === "html" ? "html" : "vjaproj";
                const startingFolder = lastPath ? dirname(lastPath) : _lastDir;
                console.log("[open] startingFolder:", startingFolder, "ext:", ext);
                const paths = await Utils.openFileDialog({
                    startingFolder,
                    allowedFileTypes: process.platform === "win32" || process.platform === "darwin" ? ext : `*.${ext}`,
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
                    _updateProjectData(content, path);
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
                    const contentWithPass = await _injectVjaPass(content);
                    await Bun.write(savePath, contentWithPass);
                    _lastDir = dirname(savePath);
                    await saveLastDir(savePath);
                    console.log("[saved]", savePath);
                    _updateProjectData(contentWithPass, savePath);
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

            // ══ 汎用fetch（WebKitタイムアウト回避） ══════════════════════════

            fetchRequest: async ({ fetchId, url, method, headers, body }: { fetchId: string; url: string; method?: string; headers?: Record<string, string>; body?: string }) => {
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
                    browserWindow.webview.rpc.send.fetchResult({ fetchId, ok: res.ok, status: res.status, headers: Object.fromEntries(res.headers), body: text });
                } catch (e: any) {
                    if (e.name === "AbortError") {
                        browserWindow.webview.rpc.send.fetchResult({ fetchId, ok: false, status: 0, headers: {}, body: "", error: "AbortError" });
                    } else {
                        browserWindow.webview.rpc.send.fetchResult({ fetchId, ok: false, status: 0, headers: {}, body: "", error: e.message });
                    }
                } finally {
                    _fetchAbortMap.delete(fetchId);
                }
            },

            fetchAbortRequest: async ({ fetchId }: { fetchId: string }) => {
                const ctrl = _fetchAbortMap.get(fetchId);
                if (ctrl) {
                    ctrl.abort();
                    _fetchAbortMap.delete(fetchId);
                }
                browserWindow.webview.rpc.send.fetchAbortResult({ fetchId });
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



            // ══ プロジェクト実行 ══════════════════════

            runProjectRequest: async ({ projectData }) => {
                try {
                    if (_projectWindow) {
                        await Utils.showMessageBox({
                            type: "info", title: _TITLE,
                            message: "プロジェクトは既に実行中です。",
                            buttons: ["OK"],
                        });
                        browserWindow.webview.rpc.send.runProjectResult({ ok: false, error: "already running" });
                        return;
                    }
                    // フロントから受け取った最新データを使用
                    if (!_updateProjectData(projectData)) {
                        browserWindow.webview.rpc.send.runProjectResult({ ok: false, error: "プロジェクトデータの解析に失敗しました" });
                        return;
                    }
                    const result = await buildProjectFiles();
                    if (!result.ok) {
                        browserWindow.webview.rpc.send.runProjectResult({ ok: false, error: result.error });
                        return;
                    }
                    await openProjectWindow(result.startFormPath!, result.startFormW!, result.startFormH!, () => {
                        browserWindow.webview.rpc.send.stopProjectResult({ ok: true });
                    });
                    browserWindow.webview.rpc.send.runProjectResult({ ok: true });
                } catch (e: any) {
                    browserWindow.webview.rpc.send.runProjectResult({ ok: false, error: e.message });
                }
            },

            // ══ フォルダを開く ════════════════════════════

            openFolderRequest: ({ path }) => {
                Utils.showItemInFolder(path);
            },

            // ── バージョン情報取得 ────────────────────────
            getVersionRequest: () => {
                browserWindow.webview.rpc.send.getVersionResult({
                    version: _VERSION,
                    runMode: _VJA_RUN_MODE,
                });
            },

            // ── UI設定 ───────────────────────────────────
            saveUiConfigRequest: async ({ uiFontSize, uiFontFamily, editorFontSize, editorFontFamily, leftPanelW, rightPanelW }) => {
                try {
                    const configPath = join(_configDir, "ui-config.json");
                    if (!existsSync(_configDir)) mkdirSync(_configDir, { recursive: true });
                    await Bun.write(configPath, JSON.stringify({ uiFontSize, uiFontFamily, editorFontSize, editorFontFamily, leftPanelW, rightPanelW }, null, 2));
                } catch (e) { console.error("[vja] saveUiConfig failed:", e); }
            },
            loadUiConfigRequest: () => {
                try {
                    const configPath = join(_configDir, "ui-config.json");
                    if (existsSync(configPath)) {
                        const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
                        browserWindow.webview.rpc.send.loadUiConfigResult({
                            uiFontSize:       cfg.uiFontSize       || 13,
                            uiFontFamily:     cfg.uiFontFamily     || "",
                            editorFontSize:   cfg.editorFontSize   || 16,
                            editorFontFamily: cfg.editorFontFamily || "'Courier New', Courier, monospace",
                            leftPanelW:       cfg.leftPanelW       || 110,
                            rightPanelW:      cfg.rightPanelW      || 420,
                        });
                        return;
                    }
                } catch (e) { console.error("[vja] loadUiConfig failed:", e); }
                browserWindow.webview.rpc.send.loadUiConfigResult({
                    uiFontSize: 13, uiFontFamily: "",
                    editorFontSize: 16, editorFontFamily: "'Courier New', Courier, monospace",
                    leftPanelW: 110, rightPanelW: 420,
                });
            },

            // ══ コンパイル ════════════════════════════════

            compileProjectRequest: async () => {
                try {
                    const result = await compileProject();
                    browserWindow.webview.rpc.send.compileProjectResult(result);
                } catch (e: any) {
                    browserWindow.webview.rpc.send.compileProjectResult({ ok: false, error: e.message });
                }
            },

            // ══ DBデータクリア ════════════════════════════

            clearProjectDbRequest: async () => {
                try {
                    if (!_currentProjectDbDir) {
                        browserWindow.webview.rpc.send.clearProjectDbResult({ ok: false, error: "プロジェクトが読み込まれていません" });
                        return;
                    }
                    closeProjectDb();
                    clearProjectDb(_currentProjectDbDir);
                    browserWindow.webview.rpc.send.clearProjectDbResult({ ok: true });
                } catch (e: any) {
                    browserWindow.webview.rpc.send.clearProjectDbResult({ ok: false, error: e.message });
                }
            },

            navigateFormRequest: async ({ formName }) => {
                try {
                    const result = getProjectFormPath(formName);
                    if (!result.ok) {
                        browserWindow.webview.rpc.send.navigateFormResult({ ok: false, error: result.error });
                        return;
                    }
                    await navigateProjectWindow(result.path!, result.w!, result.h!);
                    browserWindow.webview.rpc.send.navigateFormResult({ ok: true });
                } catch (e: any) {
                    browserWindow.webview.rpc.send.navigateFormResult({ ok: false, error: e.message });
                }
            },

            // ══ セッション管理 ════════════════════════

            sessionGetRequest: ({ key }) => {
                const value = _session.get(key) ?? null;
                browserWindow.webview.rpc.send.sessionGetResult({ ok: true, value });
            },

            sessionSetRequest: ({ key, value }) => {
                if (value === null) {
                    _session.delete(key);
                } else {
                    _session.set(key, value);
                }
                browserWindow.webview.rpc.send.sessionSetResult({ ok: true });
            },
        },
    },
});

// ── プロジェクト実行管理 ──────────────────────────────

// プロジェクトの作業ディレクトリ
const _projectWorkDir = join(_dataDir, "projectWork");

// フォームパス解決をproject-runner.tsに登録（デザイナー版: _projectWorkDir配下のHTMLを使用）
setFormHtmlPathResolver((formTitle: string) =>
    join(_projectWorkDir, _currentProjectName || "project", `${formTitle}.html`)
);

// 現在のプロジェクトのDB管理ディレクトリ（index.ts固有）
let _currentProjectDbDir = "";
let _currentProjectVersion: string = "1.0.0";
let _currentProjectFilePath: string = "";

// プロジェクトデータをメモリに反映する共通関数
const _updateProjectData = (jsonStr: string, filePath?: string): boolean => {
    try {
        const proj = JSON.parse(jsonStr);
        const name = proj.projectInfo?.name || "";
        _currentProjectVersion = proj.projectInfo?.version || "1.0.0";
        if (filePath) _currentProjectFilePath = filePath;
        _currentProjectDbDir = join(_projectWorkDir, name, "db");
        _currentProjectExtRuntime = proj.extRuntime?.js || "";
        // vjaPass を非同期で読み込み（await不可なので then で）
        _loadVjaPass(proj).then(pass => { _vjaPass = pass; });
        // project-runner.ts の setProjectData でプロジェクト共通データを設定
        // 互換: nameがなければtitleをnameとして補完
        const forms = (proj.forms || []).map((f: any) => ({
            ...f,
            cfg: { ...f.cfg, name: f.cfg.name || f.cfg.title },
        }));
        setProjectData({
            forms,
            tables: proj.tables || [],
            name,
            dbDir: _currentProjectDbDir,
            extRuntime: proj.extRuntime?.js || "",
            cloudInfras: proj.cloudInfras || [],
            onStartCode: proj.projectInfo?.appEvents?.onStart || "",
            onExitCode: proj.projectInfo?.appEvents?.onExit || "",
            vjaPass: _vjaPass,
        });
        return true;
    } catch (e) {
        console.error("[vja] _updateProjectData failed:", e);
        return false;
    }
};

// プロジェクトのフォームHTMLを生成して出力先に書き出す
const buildProjectFiles = async (): Promise<{
    ok: boolean; error?: string;
    startFormPath?: string; startFormW?: number; startFormH?: number;
}> => {
    try {
        // vjaデザイナーのwebviewからプロジェクトデータをRPCで受け取っているが
        // ここでは既にloadProjectDataで読み込まれた_currentProjectFormsを使う
        if (_currentProjectForms.length === 0) {
            return { ok: false, error: "プロジェクトが読み込まれていません" };
        }
        const projName = _currentProjectName || "project";
        const outDir = join(_projectWorkDir, projName);
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

        // project-bridge.js は electrobun.config.ts の projectview エントリでビルド済み
        const bridgeJsSrc = join(import.meta.dir, "..", "views", "projectview", "project-bridge.js");
        if (existsSync(bridgeJsSrc)) {
            copyFileSync(bridgeJsSrc, join(outDir, "project-bridge.js"));
        }

        // 各フォームのHTMLを生成
        const extRuntimeJs = (_currentProjectExtRuntime || "").trim();
        for (const form of _currentProjectForms) {
            const html = buildFormHtml(form, _currentProjectForms, extRuntimeJs);
            const fileName = (form.cfg.name || form.cfg.title) + ".html";
            await Bun.write(join(outDir, fileName), html);
        }

        const startForm = _currentProjectForms[0];
        const startFileName = (startForm.cfg.name || startForm.cfg.title) + ".html";
        return {
            ok: true,
            startFormPath: join(outDir, startFileName),
            startFormW: startForm.cfg.w,
            startFormH: startForm.cfg.h,
        };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};

// ── プロジェクトコンパイル ────────────────────────────
// コンパイル出力先: ~/.vja-apps/VJAFormDesigner/dist/{project名}/
const _distDir = join(_dataDir, "dist");

const compileProject = async (): Promise<{ ok: boolean; error?: string; distPath?: string }> => {
    try {
        if (_currentProjectForms.length === 0) {
            return { ok: false, error: "プロジェクトが読み込まれていません" };
        }
        // プロジェクト名が未設定の場合はコンパイル不可
        if (!_currentProjectName) {
            return { ok: false, error: "プロジェクト名が設定されていません。\nプロジェクト情報からプロジェクト名を設定してください。" };
        }
        const projName = _currentProjectName;
        const projVersion = _currentProjectVersion || "1.0.0";
        const projId = projName.toLowerCase().replace(/[^a-z0-9]/g, "-");
        const distPath = join(_distDir, projName);

        // ── ディレクトリ構成を作成（既存の場合はクリア） ──
        if (existsSync(distPath)) rmSync(distPath, { recursive: true, force: true });
        const srcBunDir = join(distPath, "src", "bun");
        const srcSharedDir = join(distPath, "src", "shared");
        const srcMainviewDir = join(distPath, "src", "mainview");
        for (const d of [srcBunDir, srcSharedDir, srcMainviewDir]) {
            mkdirSync(d, { recursive: true });
        }

        // ── 既存ファイルをコピー ───────────────────────
        // vjaプロジェクトルートは PWD 環境変数から取得（bun run dev 実行時のカレントディレクトリ）
        let vjaRoot = process.env.PWD || "";
        if (existsSync(BUILD_VJA_SRC_PATH)) {
            // build後とみなして root にコンパイル済みでのパスをセット.
            vjaRoot = BUILD_VJA_SRC_PATH;
        }
        console.info("# compile src vjaRoot: " + vjaRoot);
        if (!vjaRoot) throw new Error("PWD 環境変数が取得できません");

        // COPY_BUILD_FILES リストを使って一元管理（copy-compile-assets.tsと共通）
        const destDirMap: Record<string, string> = {
            "bun": srcBunDir,
            "shared": srcSharedDir,
            "mainview": srcMainviewDir,
        };
        for (const [srcRel, _] of COPY_BUILD_FILES) {
            const topDir = srcRel.split("/")[0];
            const destDir = destDirMap[topDir];
            if (!destDir) continue;
            const fileName = srcRel.split("/").slice(1).join("/");
            copyFileSync(join(vjaRoot, "src", srcRel), join(destDir, fileName));
        }

        // ── project-bridge.js（ビルド済み）をコピー ──
        const bridgeJsSrc = join(import.meta.dir, "..", "views", "projectview", "project-bridge.js");
        if (existsSync(bridgeJsSrc)) {
            copyFileSync(bridgeJsSrc, join(srcMainviewDir, "project-bridge.js"));
        }

        // ── スタンドアロン版 index.ts をコピー ────────
        copyFileSync(join(vjaRoot, "src", "bun", "standalone-index.ts"), join(srcBunDir, "index.ts"));

        // ── フォームHTMLを生成 ────────────────────────
        const extRuntimeJs = (_currentProjectExtRuntime || "").trim();
        const copyEntries: Record<string, string> = {
            "src/mainview/vja-runtime.js": "views/mainview/vja-runtime.js",
            "src/project.vjaproj": "project.vjaproj",
        };
        for (const form of _currentProjectForms) {
            const htmlFileName = `${form.cfg.name || form.cfg.title}.html`;
            const html = buildFormHtml(form, _currentProjectForms, extRuntimeJs);
            await Bun.write(join(srcMainviewDir, htmlFileName), html);
            copyEntries[`src/mainview/${htmlFileName}`] = `views/mainview/${htmlFileName}`;
        }

        // ── .vjaproj を出力先にコピー ─────────────────
        if (_currentProjectFilePath && existsSync(_currentProjectFilePath)) {
            // src/ 直下にコピー → electrobun.config.ts の copy で Resources/app/ に配置される
            copyFileSync(_currentProjectFilePath, join(distPath, "src", "project.vjaproj"));
        }

        // ── package.json を生成 ───────────────────────
        const packageJson = JSON.stringify({
            name: projName,
            version: projVersion,
            scripts: { dev: "electrobun dev", build: "electrobun build --env=stable" },
            dependencies: { electrobun: "latest" },
        }, null, 2);
        await Bun.write(join(distPath, "package.json"), packageJson);

        // ── electrobun.config.ts を生成 ──────────────
        const copyEntriesStr = JSON.stringify(copyEntries, null, 8)
            .split("\n").map((l, i) => i === 0 ? l : "        " + l).join("\n");
        const configTs = `// electrobun.config.ts
import type { ElectrobunConfig } from "electrobun";

export default {
    app: {
        name: ${JSON.stringify(projName)},
        identifier: ${JSON.stringify("com.vja." + projId)},
        version: ${JSON.stringify(projVersion)},
    },
    build: {
        bun: {
            entrypoint: "src/bun/index.ts",
        },
        views: {
            mainview: {
                entrypoint: "src/mainview/project-bridge.ts",
            },
        },
        copy: ${copyEntriesStr},
    },
} satisfies ElectrobunConfig;
`;
        await Bun.write(join(distPath, "electrobun.config.ts"), configTs);

        console.log(`[compile] ファイル生成完了: ${distPath}`);

        // ── bun install ───────────────────────────────
        console.log(`[compile] bun install 実行中...`);
        const installProc = Bun.spawn(["bun", "install"], {
            cwd: distPath,
            stdout: "pipe",
            stderr: "pipe",
        });
        await installProc.exited;
        if (installProc.exitCode !== 0) {
            const errText = await new Response(installProc.stderr).text();
            return { ok: false, error: `bun install 失敗: ${errText}` };
        }

        // ── electrobun build --env=stable ────────────
        console.log(`[compile] electrobun build --env=stable 実行中...`);
        const buildProc = Bun.spawn(["bun", "x", "electrobun", "build", "--env=stable"], {
            cwd: distPath,
            stdout: "pipe",
            stderr: "pipe",
        });
        await buildProc.exited;
        if (buildProc.exitCode !== 0) {
            const errText = await new Response(buildProc.stderr).text();
            return { ok: false, error: `electrobun build 失敗: ${errText}` };
        }

        const artifactsPath = join(distPath, "artifacts");
        console.log(`[compile] ビルド完了: ${artifactsPath}`);
        return { ok: true, distPath: artifactsPath };
    } catch (e: any) {
        console.error("[compile] エラー:", e.message);
        return { ok: false, error: e.message };
    }
};

// フォームのHTMLを生成
const buildFormHtml = (form: any, allForms: any[], extRuntimeJs: string = ""): string => {
    const cfg = form.cfg;
    const widgets = form.widgets || [];
    const events = form.events || {};

    // ウィジェットHTML生成
    const widgetsHtml = widgets.map((w: any) => buildWidgetHtml(w)).join("\n");

    // イベントJS生成
    const eventsJs = buildEventsJs(form, allForms);

    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${esc2(cfg.title)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: "Yu Gothic UI", "Meiryo UI", "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
#vja-custom-titlebar { display:flex; align-items:center; justify-content:space-between; height:28px; padding:0 10px; background:#2a2a3e; user-select:none; }
#vja-titlebar-title { font-size:12px; color:#aaa; }
#vja-titlebar-close { -webkit-app-region:no-drag; background:none; border:none; color:#aaa; font-size:13px; cursor:pointer; padding:2px 8px; border-radius:4px; }
#vja-titlebar-close:hover { background:#ff4444; color:#fff; }
body { overflow: hidden; background: ${esc2(cfg.bg || "#ececec")}; }
#vja-form {
    position: relative;
    width: ${cfg.w}px;
    height: ${cfg.h}px;
    background: ${esc2(cfg.bg || "#ececec")};
    overflow: hidden;
}
/* ── z-index レイヤー管理 ── */
#dialog-root {
    position: fixed;
    z-index: 8000; display: none;
    align-items: center; justify-content: center;
    background: #00000088;
}
#dialog-root.show { display: flex; }
#dialog-root .box {
    background: #2a2a3e; border: 1px solid #444466;
    border-radius: 10px; padding: 28px 32px 20px;
    min-width: 300px; max-width: 480px; max-height: 70vh;
    display: flex; flex-direction: column;
    align-items: center; gap: 12px;
    box-shadow: 0 8px 32px #0006;
}
#dialog-root .box .icon { font-size: 32px; line-height: 1; }
#dialog-root .box p { margin: 0; color: #e0e0f0; font-size: 14px; text-align: center; white-space: pre-wrap; word-break: break-word; overflow-y: auto; max-height: 50vh; }
#dialog-root .box .btns { display: flex; gap: 10px; margin-top: 4px; }
#dialog-root .box .btns button {
    padding: 6px 20px; border-radius: 5px;
    border: 1px solid #444466; background: #3a3a5a;
    color: #e0e0f0; cursor: pointer; font-size: 13px;
}
#dialog-root .box .btns button:hover { background: #4a4a6a; }
#dialog-root .box .btns .btn-ok { background: #5577ff; color: #fff; border-color: #5577ff; }
#dialog-root .box .btns .btn-ok:hover { opacity: 0.85; }
#dialog-root .box input {
    width: 100%; box-sizing: border-box;
    background: #3a3a5a; border: 1px solid #444466;
    border-radius: 4px; color: #e0e0f0;
    padding: 6px 10px; font-size: 13px; outline: none;
}
#dialog-root .box input:focus { border-color: #5577ff; }
#toast-root {
    position: fixed; bottom: 36px; left: 50%;
    transform: translateX(-50%);
    z-index: 9000; pointer-events: none;
    display: flex; flex-direction: column;
    align-items: center; gap: 6px;
}
#toast-root .toast-msg {
    background: #2d2d45; border: 1px solid #5577ff;
    border-radius: 4px; color: #e0e0f0;
    font-size: 12px; padding: 6px 16px;
    opacity: 0; transition: opacity .2s;
}
#toast-root .toast-msg.show { opacity: 1; }
</style>
</head>
<body>
<div id="vja-custom-titlebar" class="electrobun-webkit-app-region-drag">
  <span id="vja-titlebar-title">${cfg.title || _currentProjectName || "Project"}</span>
  <button id="vja-titlebar-close" class="electrobun-webkit-app-region-no-drag" onclick="window._vjaClose()" title="閉じる">✕</button>
</div>
<div id="vja-form">
${widgetsHtml}
</div>
<!-- vja dialog/toast roots -->
<div id="dialog-root"></div>
<div id="toast-root"></div>
<script>window._INIT_PARAMS = window._INIT_PARAMS || {}; window._INIT_PARAMS.PROJECT_NAME = ${JSON.stringify(_currentProjectName || "")};</script>
<script src="./project-bridge.js"></script>
${extRuntimeJs ? `<script>\n${extRuntimeJs}\n</script>` : ""}
<script>
${eventsJs}
</script>
</body>
</html>`;
};

// HTML エスケープ（サーバ側用）
const esc2 = (s: any): string =>
    String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

// ウィジェット1つのHTMLを生成
const buildWidgetHtml = (w: any): string => {
    const p = w.props;
    const vis = p.visible === false ? "visibility:hidden;" : "";
    const base = `position:absolute;left:${w.x}px;top:${w.y}px;width:${w.w}px;height:${w.h}px;box-sizing:border-box;${vis}`;
    const font = `font-size:${p.fontSize || 12}px;font-family:${p.fontFamily || ""};font-weight:${p.fontBold ? "bold" : "normal"}`;
    const border = `border:${(p.borderSize || 0)}px solid ${p.borderColor || "#cccccc"}`;
    const id = `id="${w.name}" data-vja-name="${w.name}"`;
    switch (w.tag) {
        case "button":
            return `<button ${id} style="${base}background:${p.bg};color:${p.fg};${font};${border};border-radius:${p.borderRadius || 2}px;cursor:pointer">${esc2(p.text)}</button>`;
        case "label":
            return `<label ${id} style="${base}background:${p.bg};color:${p.fg};${font};text-align:${p.align || "left"};display:flex;align-items:center">${esc2(p.text)}</label>`;

        case "inputtype": {
            const itype = p.inputType || "text";
            const maxl = p.maxLength ? ` maxlength="${p.maxLength}"` : "";
            const req = p.required ? " required" : "";
            const ro = p.readonly ? " readonly" : "";
            const dis = p.disabled ? " disabled" : "";
            return `<input type="${itype}" ${id} value="${esc2(p.text)}" placeholder="${esc2(p.placeholder || "")}"${maxl}${req}${ro}${dis} style="${base}background:${p.bg};color:${p.fg};${font};${border};padding:0 4px">`;
        }
        case "checkbox":
            return `<label ${id} style="${base}display:flex;align-items:center;gap:4px;color:${p.fg};${font};cursor:pointer"><input type="checkbox" ${p.checked ? "checked" : ""}>${esc2(p.text)}</label>`;
        case "radio":
            return `<label ${id} style="${base}display:flex;align-items:center;gap:4px;color:${p.fg};${font};cursor:pointer"><input type="radio" name="${esc2(p.group || "g")}" ${p.checked ? "checked" : ""}>${esc2(p.text)}</label>`;
        case "listbox":
            return `<select ${id} multiple style="${base}background:${p.bg};color:${p.fg};${font};${border}">${(p.items || "").split("\n").map((i: string) => `<option>${esc2(i)}</option>`).join("")}</select>`;
        case "selectBox":
            return `<select ${id} style="${base}background:${p.bg};color:${p.fg};${font};${border}">${(p.items || "").split("\n").map((i: string) => `<option>${esc2(i)}</option>`).join("")}</select>`;
        case "groupbox":
            return `<fieldset ${id} style="${base}background:${p.bg};color:${p.fg};${font};${border}"><legend>${esc2(p.text)}</legend></fieldset>`;
        case "picture":
            return `<div ${id} style="${base}background:${p.bg};${border};display:flex;align-items:center;justify-content:center">${p.src ? `<img src="${esc2(p.src)}" style="max-width:100%;max-height:100%;object-fit:${p.objectFit || "contain"}">` : ""}</div>`;
        case "datepicker": {
            const _itype = p.inputType || "date";
            return `<input type="${_itype}" ${id} value="${esc2(p.value || "")}" ${p.min ? `min="${esc2(p.min)}"` : ""} ${p.max ? `max="${esc2(p.max)}"` : ""} ${p.disabled ? "disabled" : ""} ${p.readonly ? "readonly" : ""} style="${base}background:${p.bg};color:${p.fg};${font};${border};padding:0 4px">`;
        }
        case "textarea":
            return `<textarea ${id} ${p.disabled ? "disabled" : ""} ${p.readonly ? "readonly" : ""} placeholder="${(p.placeholder || "").replace(/"/g, "&quot;")}" style="${base}background:${p.bg || "#fff"};color:${p.fg || "#000"};font-size:${p.fontSize || 12}px;font-family:${p.fontFamily || ""};font-weight:${p.fontBold ? "bold" : "normal"};border:${(p.borderSize || 1) + "px solid " + (p.borderColor || "#cccccc")};resize:none;padding:4px;box-sizing:border-box">${(p.text || "").replace(/</g, "&lt;")}</textarea>`;
        case "progressbar": {
            const pbval = Math.min(100, Math.max(0, ((p.value || 0) - (p.min || 0)) / ((p.max || 100) - (p.min || 0)) * 100));
            return `<div ${id} data-min="${p.min || 0}" data-max="${p.max || 100}" data-val="${p.value || 0}" style="${base}background:${p.bg || "#e0e0e0"};border:${(p.borderSize || 1) + "px solid " + (p.borderColor || "#cccccc")};border-radius:3px;overflow:hidden"><div style="width:${pbval}%;height:100%;background:${p.fg || "#5b7bfa"};transition:width 0.2s;border-radius:3px"></div></div>`;
        }
        case "treeview": {
            const buildTreeHtml = (items: string): string => {
                const lines = items.split("\n");
                const esc2 = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                let html = "";
                const stack: { indent: number, id: string }[] = [];
                lines.forEach((line, i) => {
                    if (!line.trim()) return;
                    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
                    const text = line.trim();
                    const nodeId = `_tvn${i}`;
                    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
                    const hasParent = stack.length > 0;
                    const isExpandable = lines.some((l, j) => j > i && l.match(/^(\s*)/)?.[1].length > indent && l.trim());
                    html += `<div style="padding-left:${indent * 14}px;line-height:22px;cursor:pointer;white-space:nowrap" id="${nodeId}"
                        onclick="(function(el){
                            const ch=el.nextElementSibling;
                            if(ch&&ch.dataset.children){
                                const open=ch.style.display!=='none';
                                ch.style.display=open?'none':'block';
                                el.querySelector('.tv-arrow').textContent=open?'▶':'▼';
                                el.dispatchEvent(new CustomEvent(open?'tvcollapse':'tvexpand',{detail:{text:el.dataset.text},bubbles:true}));
                            }
                            el.dispatchEvent(new CustomEvent('tvclick',{detail:{text:el.dataset.text},bubbles:true}));
                        })(this)" data-text="${esc2(text)}">
                        <span class="tv-arrow" style="font-size:9px;margin-right:4px">${isExpandable ? "▶" : "•"}</span>${esc2(text)}</div>`;
                    stack.push({ indent, id: nodeId });
                });
                return html;
            };
            return `<div ${id} style="${base}background:${p.bg || "#fff"};color:${p.fg || "#000"};font-size:${p.fontSize || 12}px;font-family:${p.fontFamily || ""};border:${(p.borderSize || 1) + "px solid " + (p.borderColor || "#cccccc")};overflow:auto;padding:4px;box-sizing:border-box">${buildTreeHtml(p.items || "")}</div>`;
        }
        case "slider":
            return `<input type="range" ${id} min="${p.min || 0}" max="${p.max || 100}" value="${p.value || 0}" step="${p.step || 1}" ${p.disabled ? "disabled" : ""} style="${base}accent-color:#5b7bfa">`;
        case "hscroll": {
            const hmin = p.min || 0, hmax = p.max || 100, hval = p.value || 0, hstep = p.step || 1;
            const hbg = p.bg || "#ddd";
            return `<div ${id} data-min="${hmin}" data-max="${hmax}" data-val="${hval}" data-step="${hstep}"
                style="${base}background:${hbg};border:1px solid #999;border-radius:2px;display:flex;align-items:center;justify-content:space-between;padding:0 2px;box-sizing:border-box;user-select:none"
                onclick="(function(el){
                    const min=+el.dataset.min,max=+el.dataset.max,step=+el.dataset.step;
                    const rect=el.getBoundingClientRect(),btnW=14;
                    const x=event.clientX-rect.left;
                    let val=+el.dataset.val;
                    if(x<btnW){val=Math.max(min,val-step);}
                    else if(x>rect.width-btnW){val=Math.min(max,val+step);}
                    else{val=Math.round(min+(max-min)*((x-btnW)/(rect.width-btnW*2))/step)*step;}
                    el.dataset.val=val;
                    el.querySelector('.hs-thumb').style.left=((val-min)/(max-min)*100)+'%';
                    el.dispatchEvent(new CustomEvent('scroll',{detail:{value:val},bubbles:true}));
                })(this)">
                <span style="font-size:9px;flex-shrink:0">◀</span>
                <div style="flex:1;height:6px;background:#bbb;margin:0 3px;border-radius:3px;position:relative">
                    <div class="hs-thumb" style="position:absolute;top:50%;transform:translate(-50%,-50%);width:12px;height:12px;background:#666;border-radius:50%;left:${Math.round((hval - hmin) / (hmax - hmin) * 100)}%"></div>
                </div>
                <span style="font-size:9px;flex-shrink:0">▶</span>
            </div>`;
        }
        case "vscroll": {
            const vmin = p.min || 0, vmax = p.max || 100, vval = p.value || 0, vstep = p.step || 1;
            const vbg = p.bg || "#ddd";
            return `<div ${id} data-min="${vmin}" data-max="${vmax}" data-val="${vval}" data-step="${vstep}"
                style="${base}background:${vbg};border:1px solid #999;border-radius:2px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:2px 0;box-sizing:border-box;user-select:none"
                onclick="(function(el){
                    const min=+el.dataset.min,max=+el.dataset.max,step=+el.dataset.step;
                    const rect=el.getBoundingClientRect(),btnH=14;
                    const y=event.clientY-rect.top;
                    let val=+el.dataset.val;
                    if(y<btnH){val=Math.max(min,val-step);}
                    else if(y>rect.height-btnH){val=Math.min(max,val+step);}
                    else{val=Math.round(min+(max-min)*((y-btnH)/(rect.height-btnH*2))/step)*step;}
                    el.dataset.val=val;
                    el.querySelector('.vs-thumb').style.top=((val-min)/(max-min)*100)+'%';
                    el.dispatchEvent(new CustomEvent('scroll',{detail:{value:val},bubbles:true}));
                })(this)">
                <span style="font-size:9px;flex-shrink:0">▲</span>
                <div style="width:6px;flex:1;background:#bbb;margin:3px 0;border-radius:3px;position:relative">
                    <div class="vs-thumb" style="position:absolute;left:50%;transform:translate(-50%,-50%);width:12px;height:12px;background:#666;border-radius:50%;top:${Math.round((vval - vmin) / (vmax - vmin) * 100)}%"></div>
                </div>
                <span style="font-size:9px;flex-shrink:0">▼</span>
            </div>`;
        }
        case "datagrid": {
            const bc = p.borderColor || "#cccccc";
            const fs = p.fontSize || 12;
            return `<div ${id} style="${base}overflow:auto;border:1px solid ${bc};box-sizing:border-box;font-size:${fs}px" data-columns="${esc2(p.columns || "ID:20\n名前:50\n値:30")}" data-row-bg="${p.rowBg || "#ffffff"}" data-row-alt-bg="${p.rowAltBg || "#f5f5f5"}" data-row-fg="${p.rowFg || "#000000"}" data-border-color="${bc}" data-max-rows="${p.maxRows || 0}" data-header-bg="${p.headerBg || "#4a4a6a"}" data-header-fg="${p.headerFg || "#ffffff"}"><table style="width:100%;border-collapse:collapse;table-layout:fixed"><thead></thead><tbody></tbody></table></div>`;
        }
        default:
            return `<div ${id} style="${base}"></div>`;
    }
};

// ウィジェットのイベントJSを生成
const buildEventsJs = (form: any, allForms: any[]): string => {
    const lines: string[] = ["// ── ウィジェットイベント ──"];
    // タイトルバーのクローズボタン用: vja.app.closeWindow のラッパー
    lines.push('window._vjaClose = function() { window.vja?.app?.closeWindow?.(); };');
    lines.push("document.addEventListener('DOMContentLoaded', function() {");
    // datagrid共通HTML生成関数を定義（初期表示・setData共通）
    const hasDatagrid = (form.widgets || []).some((w: any) => w.tag === "datagrid");
    if (hasDatagrid) {
        lines.push(`  // ── datagrid 設計仕様 ──────────────────────────────────`);
        lines.push(`  // 1. ヘッダー・データは常に colDefs の定義順で生成する`);
        lines.push(`  // 2. カラム名が no/No/NO の場合：`);
        lines.push(`  //    DBに同名キーがあればその値、なければ行番号（i+1）を表示`);
        lines.push(`  // 3. カラム名がそれ以外の場合：`);
        lines.push(`  //    row[カラム名]（大文字小文字を区別しない）で値を取得`);
        lines.push(`  // 4. colDefs に No がない場合：No列は表示しない`);
        lines.push(`  // 5. 表示名が設定されている場合はヘッダーに表示名を使用、`);
        lines.push(`  //    省略時はカラム名を使用`);
        lines.push(`  // ────────────────────────────────────────────────────────`);
        lines.push(`  window._buildDatagridHtml = function(el, rows) {`);
        lines.push(`    const colDefs = (el.dataset.columns || "").split(/[\\n;]/).filter(function(s) { return s.trim(); }).map(function(c) {`);
        lines.push(`      const parts = c.trim().split(":");`);
        lines.push(`      return { label: parts[0] || "", width: parseInt(parts[1]) || 20, displayName: parts[2] || "" };`);
        lines.push(`    });`);
        lines.push(`    const bc = el.dataset.borderColor || "#cccccc";`);
        lines.push(`    const hbg = el.dataset.headerBg || "#4a4a6a";`);
        lines.push(`    const hfg = el.dataset.headerFg || "#ffffff";`);
        lines.push(`    const rowBg = el.dataset.rowBg || "#ffffff";`);
        lines.push(`    const rowAltBg = el.dataset.rowAltBg || "#f5f5f5";`);
        lines.push(`    const rowFg = el.dataset.rowFg || "#000000";`);
        lines.push(`    const maxRows = el.dataset.maxRows ? parseInt(el.dataset.maxRows) : 0;`);
        lines.push(`    const displayRows = maxRows > 0 ? (rows || []).slice(0, maxRows) : (rows || []);`);
        lines.push(`    const thStyle = "padding:3px 6px;border:1px solid " + bc + ";text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";`);
        lines.push(`    const tdStyle = "padding:2px 6px;border:1px solid " + bc + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis";`);
        lines.push(`    // ── ヘッダー生成（colDefsの定義順） ──`);
        lines.push(`    const thead = el.querySelector("thead");`);
        lines.push(`    if (thead) {`);
        lines.push(`      const headerRow = document.createElement("tr");`);
        lines.push(`      headerRow.style.cssText = "background:" + hbg + ";color:" + hfg;`);
        lines.push(`      colDefs.forEach(function(cd) {`);
        lines.push(`        const th = document.createElement("th");`);
        lines.push(`        th.style.cssText = thStyle + ";width:" + cd.width + "%";`);
        lines.push(`        th.textContent = cd.displayName || cd.label;`);
        lines.push(`        headerRow.appendChild(th);`);
        lines.push(`      });`);
        lines.push(`      thead.innerHTML = "";`);
        lines.push(`      thead.appendChild(headerRow);`);
        lines.push(`    }`);
        lines.push(`    // ── ボディ生成（colDefsの定義順） ──`);
        lines.push(`    const tbody = el.querySelector("tbody");`);
        lines.push(`    if (tbody) {`);
        lines.push(`      tbody.innerHTML = "";`);
        lines.push(`      displayRows.forEach(function(row, i) {`);
        lines.push(`        const tr = document.createElement("tr");`);
        lines.push(`        tr.style.background = i % 2 === 0 ? rowBg : rowAltBg;`);
        lines.push(`        tr.style.color = rowFg;`);
        lines.push(`        colDefs.forEach(function(cd) {`);
        lines.push(`          const td = document.createElement("td");`);
        lines.push(`          td.style.cssText = tdStyle;`);
        lines.push(`          if (cd.label.toLowerCase() === "no") {`);
        lines.push(`            // No列: DBに同名キーがあればその値、なければ自動採番`);
        lines.push(`            const dbKey = Object.keys(row).find(function(k) { return k.toLowerCase() === "no"; });`);
        lines.push(`            td.textContent = dbKey != null ? String(row[dbKey]) : String(i + 1);`);
        lines.push(`          } else {`);
        lines.push(`            // 通常列: 大文字小文字を区別しないでキー検索`);
        lines.push(`            const dbKey = Object.keys(row).find(function(k) { return k.toLowerCase() === cd.label.toLowerCase(); });`);
        lines.push(`            const val = dbKey != null ? row[dbKey] : "";`);
        lines.push(`            td.textContent = val == null ? "" : String(val);`);
        lines.push(`          }`);
        lines.push(`          tr.appendChild(td);`);
        lines.push(`        });`);
        lines.push(`        tbody.appendChild(tr);`);
        lines.push(`      });`);
        lines.push(`    }`);
        lines.push(`  };`);
        // 各datagridの初期表示とsetData登録
        for (const w of (form.widgets || [])) {
            if (w.tag !== "datagrid") continue;
            lines.push(`  // ${w.name} 初期表示`);
            lines.push(`  (function() {`);
            lines.push(`    const el = document.getElementById(${JSON.stringify(w.name)});`);
            lines.push(`    if (el) window._buildDatagridHtml(el, []);`);
            lines.push(`  })();`);
            lines.push(`  // ${w.name}.setData`);
            lines.push(`  window[${JSON.stringify(w.name + "_setData")}] = function(rows) {`);
            lines.push(`    const el = document.getElementById(${JSON.stringify(w.name)});`);
            lines.push(`    if (el) window._buildDatagridHtml(el, rows);`);
            lines.push(`  };`);
        }
    }
    for (const w of (form.widgets || [])) {
        const evs = w.events || {};
        const jsCode = w.jsCode || {};
        for (const [evName, yaml] of Object.entries(evs)) {
            if (evName.startsWith("_js_")) continue;
            const js = (jsCode[evName] || "").trim();
            if (!js) continue;
            const domEv = evNameToDom(evName);
            lines.push(`  // ${w.name}.${evName}`);
            lines.push(`  (function() {`);
            lines.push(`    var el = document.getElementById(${JSON.stringify(w.name)});`);
            lines.push(`    if (!el) return;`);
            lines.push(`    el.addEventListener(${JSON.stringify(domEv)}, function(event) {`);
            lines.push(`      _vjaRun(async function() {`);
            lines.push(`        ${js.split("\n").join("\n        ")}`);
            lines.push(`      });`);
            lines.push(`    });`);
            lines.push(`  })();`);
        }
    }
    // フォームイベント
    const formEvs = form.events || {};
    for (const [evName, js] of Object.entries(formEvs)) {
        if (evName.startsWith("_js_") || !js || !(js as string).trim()) continue;
        const domEv = evNameToDom(evName);
        if (!domEv) continue;
        lines.push(`  // form.${evName}`);
        lines.push(`  document.addEventListener(${JSON.stringify(domEv)}, function(event) {`);
        lines.push(`    _vjaRun(async function() {`);
        lines.push(`      ${(js as string).split("\n").join("\n      ")}`);
        lines.push(`    });`);
        lines.push(`  });`);
    }
    lines.push("});");
    return lines.join("\n");
};

// イベント名 → DOM イベント名
const evNameToDom = (evName: string): string => {
    const map: Record<string, string> = {
        Click: "click", MouseDown: "mousedown", MouseUp: "mouseup",
        MouseEnter: "mouseenter", MouseLeave: "mouseleave",
        TextChanged: "input", KeyDown: "keydown", KeyUp: "keyup",
        GotFocus: "focus", LostFocus: "blur",
        CheckedChanged: "change",
        SelectedIndexChanged: "change", DropDown: "focus",
        Scroll: "scroll", ValueChanged: "change",
        RowClick: "click", HeaderClick: "click",
        NodeClick: "tvclick", NodeExpand: "tvexpand", NodeCollapse: "tvcollapse",
        Load: "DOMContentLoaded", Resize: "resize",
        Closing: "beforeunload",
    };
    return map[evName] || evName.toLowerCase();
};

// ── macOS向け Editメニュー設定（Cmd+C/V を有効化）────────
if (process.platform === "darwin") {
    ApplicationMenu.setApplicationMenu([
        {
            submenu: [{ label: "Quit", role: "quit" }],
        },
        {
            label: "Edit",
            submenu: [
                { role: "undo" },
                { role: "redo" },
                { type: "separator" },
                { role: "cut" },
                { role: "copy" },
                { role: "paste" },
                { role: "selectAll" },
            ],
        },
    ]);
}

// ── BrowserWindow 生成 ────────────────────────────────
const isWin = process.platform === "win32";
let initW = 1280, initH = 800;
if (isWin) {
    // ─────────────────────────────────────────────────────
    // Windows フルスクリーン問題
    // 一旦タイトルバーは自前で描画対応
    // これにより、ディスプレイの有効領域を元にwindowを作成
    // して、browserWindow.maximize()を呼ばない事で、擬似的な
    // フルスクリーンが実現できるようになる.
    // ─────────────────────────────────────────────────────
    try {
        // ディスプレイの有効領域（タスクバーを除いたサイズ）を取得
        const primaryDisplay = Screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.workArea;
        initW = width;
        initH = height;
    } catch (e) { console.debug("[vja] screen size detection failed:", e); }
}

const browserWindow = new BrowserWindow({
    title: _TITLE,
    url: "views://mainview/index.html",
    frame: { x: 0, y: 0, width: initW, height: initH },
    titleBarStyle: "hidden",
    rpc: vjaRPC,
});

// windows以外はフルスクリーン.
if (!isWin) {
    browserWindow.maximize();
}
