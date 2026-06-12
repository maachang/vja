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
import { copyCompileAssets } from "./copy-compile-assets";
import { initProjectDb, clearProjectDb, getProjectDb, closeProjectDb } from "./db-manager";
import type { TableDef } from "./db-manager";

const _TITLE = "VJA Form Designer";
const _VERSION = "0.1.0";
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

// ── 暗号化基盤 ────────────────────────────────────────
// vja共通パスフレーズ（ソースに埋め込み・難読化レベル）
const _VJA_PASSPHRASE = "vja-form-designer-2024-xK9mPqR7nL2wT5vY";

const _strToKey = async (passphrase: string): Promise<CryptoKey> => {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: enc.encode("vja-salt-2024"), iterations: 100000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
};

const _encrypt = async (plain: string, passphrase: string): Promise<string> => {
    const key = await _strToKey(passphrase);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
    const combined = new Uint8Array(12 + cipherBuf.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuf), 12);
    return Buffer.from(combined).toString("base64");
};

const _decrypt = async (b64: string, passphrase: string): Promise<string> => {
    const key = await _strToKey(passphrase);
    const combined = Buffer.from(b64, "base64");
    const iv = combined.slice(0, 12);
    const cipher = combined.slice(12);
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    return new TextDecoder().decode(plainBuf);
};

// vjaPass: プロジェクトごとのパスフレーズ（共通パスフレーズで暗号化して保存）
let _vjaPass: string = "";

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

// クレデンシャルの暗号化・復号
const encryptCredential = async (plain: string): Promise<string> => {
    if (!_vjaPass) _vjaPass = _generateVjaPass();
    return _encrypt(plain, _vjaPass);
};
const decryptCredential = async (b64: string): Promise<string> => {
    if (!_vjaPass) return "";
    try { return await _decrypt(b64, _vjaPass); } catch (e) { console.debug("[vja] decryptCredential failed:", e); return ""; }
};

// 現在のクラウドインフラ設定
let _cloudInfras: any[] = [];
let _currentProjectExtRuntime: string = "";

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

            // ── DevTools 開閉 ─────────────────────────
            toggleDevToolsRequest: async () => {
                browserWindow.webview.toggleDevTools();
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
                    _cloudInfras = merged;
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
                    allowedFileTypes: process.platform === "win32" ? ext : `*.${ext}`,
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
                    await openProjectWindow(result.startFormPath!, result.startFormW!, result.startFormH!);
                    browserWindow.webview.rpc.send.runProjectResult({ ok: true });
                } catch (e: any) {
                    browserWindow.webview.rpc.send.runProjectResult({ ok: false, error: e.message });
                }
            },

            // ══ フォルダを開く ════════════════════════════

            openFolderRequest: ({ path }) => {
                Utils.showItemInFolder(path);
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

// セッション管理（メモリのみ・再起動でリセット）
const _session = new Map<string, string>();

// 現在のプロジェクトのDB管理ディレクトリ
let _currentProjectDbDir = "";

// 実行中のプロジェクトウィンドウ
let _projectWindow: BrowserWindow | null = null;

// 現在読み込まれているプロジェクトのフォームデータ（navigateで参照）
let _currentProjectForms: any[] = [];
let _currentProjectName: string = "";
let _currentProjectVersion: string = "1.0.0";
let _currentProjectFilePath: string = "";
let _currentProjectTables: TableDef[] = [];

// プロジェクトデータをメモリに反映する共通関数
const _updateProjectData = (jsonStr: string, filePath?: string): boolean => {
    try {
        const proj = JSON.parse(jsonStr);
        _currentProjectForms = proj.forms || [];
        _currentProjectTables = proj.tables || [];
        _currentProjectName = proj.projectInfo?.name || "";
        _currentProjectVersion = proj.projectInfo?.version || "1.0.0";
        if (filePath) _currentProjectFilePath = filePath;
        _onStartCode = proj.projectInfo?.appEvents?.onStart || "";
        _onExitCode = proj.projectInfo?.appEvents?.onExit || "";
        _currentProjectDbDir = join(_projectWorkDir, _currentProjectName, "db");
        _cloudInfras = proj.cloudInfras || [];
        _currentProjectExtRuntime = proj.extRuntime?.js || "";
        // vjaPass を非同期で読み込み（await不可なので then で）
        _loadVjaPass(proj).then(pass => { _vjaPass = pass; });
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
            await Bun.write(join(outDir, `${form.cfg.title}.html`), html);
        }

        const startForm = _currentProjectForms[0];
        return {
            ok: true,
            startFormPath: join(outDir, `${startForm.cfg.title}.html`),
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
        const projName    = _currentProjectName;
        const projVersion = _currentProjectVersion || "1.0.0";
        const projId      = projName.toLowerCase().replace(/[^a-z0-9]/g, "-");
        const distPath    = join(_distDir, projName);

        // ── ディレクトリ構成を作成 ─────────────────────
        const srcBunDir      = join(distPath, "src", "bun");
        const srcSharedDir   = join(distPath, "src", "shared");
        const srcMainviewDir = join(distPath, "src", "mainview");
        for (const d of [srcBunDir, srcSharedDir, srcMainviewDir]) {
            if (!existsSync(d)) mkdirSync(d, { recursive: true });
        }

        // ── 既存ファイルをコピー ───────────────────────
        // scripts/copy-compile-assets.ts で app/src/ 以下にコピー済みのファイルを使う
        // ビルド後は import.meta.dir/../../../app/src/ 以下に配置される
        // compile-assets は起動時に copy-compile-assets.ts で最新化される
        const _appSrcDir = join(_dataDir, "compile-assets", "src");

        // Bun側
        copyFileSync(join(_appSrcDir, "bun", "logger.ts"),     join(srcBunDir, "logger.ts"));
        copyFileSync(join(_appSrcDir, "bun", "db-manager.ts"), join(srcBunDir, "db-manager.ts"));
        // shared
        copyFileSync(join(_appSrcDir, "shared", "types.ts"), join(srcSharedDir, "types.ts"));
        // mainview
        const bridgeJsSrc = join(import.meta.dir, "..", "views", "projectview", "project-bridge.js");
        if (existsSync(bridgeJsSrc)) {
            copyFileSync(bridgeJsSrc, join(srcMainviewDir, "project-bridge.js"));
        }
        copyFileSync(join(_appSrcDir, "mainview", "project-bridge.ts"), join(srcMainviewDir, "project-bridge.ts"));
        copyFileSync(join(_appSrcDir, "mainview", "vja-runtime.js"),    join(srcMainviewDir, "vja-runtime.js"));

        // ── スタンドアロン版 index.ts をコピー ────────
        copyFileSync(join(_appSrcDir, "bun", "standalone-index.ts"), join(srcBunDir, "index.ts"));

        // ── フォームHTMLを生成 ────────────────────────
        const extRuntimeJs = (_currentProjectExtRuntime || "").trim();
        const copyEntries: Record<string, string> = {
            "src/mainview/vja-runtime.js": "views/mainview/vja-runtime.js",
            "src/project.vjaproj": "project.vjaproj",
        };
        for (const form of _currentProjectForms) {
            const htmlFileName = `${form.cfg.title}.html`;
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
            lines.push(`    el.addEventListener(${JSON.stringify(domEv)}, async function(event) {`);
            lines.push(`      ${js.split("\n").join("\n      ")}`);
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
        lines.push(`  document.addEventListener(${JSON.stringify(domEv)}, async function(event) {`);
        lines.push(`    ${(js as string).split("\n").join("\n    ")}`);
        lines.push(`  });`);
    }
    lines.push("});");
    return lines.join("\n");
};

// ── AppEvents（OnStart/OnExit）Bun側実行 ──────────────

// 現在のプロジェクトのAppEventsコードを保持
let _onStartCode = "";
let _onExitCode = "";

// OnStart を Bun側で実行（TS文字列を一時ファイル経由でimport）
const runOnStart = async (): Promise<void> => {
    // セッションで2度目の実行を阻止
    if (_session.get("__onStart_done__")) return;
    _session.set("__onStart_done__", "1");

    // ① テーブル定義があればDB初期化・マイグレーション
    if (_currentProjectDbDir && _currentProjectTables.length > 0) {
        try {
            await initProjectDb(_currentProjectDbDir, _currentProjectTables);
        } catch (e: any) {
            console.error("[db] DB初期化エラー:", e.message);
        }
    }

    // ② マスターCSVのINSERT処理（テーブルが0件の場合のみ）
    for (const tbl of _currentProjectTables) {
        const csv = (tbl as any).masterCsv;
        if (!csv?.data) continue;
        try {
            const db = getProjectDb(_currentProjectDbDir);
            const countRow = db.query(`SELECT COUNT(*) as cnt FROM ${tbl.name}`).get() as any;
            if (countRow?.cnt !== 0) continue;
            // gzip展開
            const text = await _decompressGzip(csv.data);
            const lines = text.split(/\r?\n/).filter((l: string) => l.trim());
            if (lines.length < 2) continue;
            const headers = _parseCsvLine(lines[0]);
            const tblCols = tbl.columns.map((c: any) => c.name);
            // テーブルに存在するカラムのみ使用
            const validHeaders = headers.filter((h: string) => tblCols.includes(h));
            if (validHeaders.length === 0) continue;
            const colIndices = validHeaders.map((h: string) => headers.indexOf(h));
            const stmt = db.prepare(
                `INSERT INTO ${tbl.name} (${validHeaders.join(",")}) VALUES (${validHeaders.map(() => "?").join(",")})`
            );
            const tx = db.transaction(() => {
                for (let i = 1; i < lines.length; i++) {
                    const vals = _parseCsvLine(lines[i]);
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

    // ③ OnStartコードを実行
    const code = _onStartCode.trim();
    if (code) {
        await _runAppEventCode("onStart", code);
    }
};

// gzip+Base64 → テキストに展開（Bun側）
const _decompressGzip = async (b64: string): Promise<string> => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const chunks: Uint8Array[] = [];
    const reader = ds.readable.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(result);
};

// CSV1行をパース（ダブルクォート対応）
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
            else if (c === ',') { result.push(cur); cur = ""; }
            else cur += c;
        }
    }
    result.push(cur);
    return result;
};

// OnExit を Bun側で実行
const runOnExit = async (): Promise<void> => {
    const code = _onExitCode.trim();
    if (!code) return;
    await _runAppEventCode("onExit", code);
};

// TSコードを一時ファイルに書き出してimport実行
const _runAppEventCode = async (name: string, code: string): Promise<void> => {
    const tmpFile = join(_projectWorkDir, `.vja_${name}_tmp_${Date.now()}.ts`);
    try {
        // Bun側で使えるAPIをvjaオブジェクトとして注入
        const wrapper = `
export const vja = {
    session: {
        get: (key: string) => _getSession(key),
        set: (key: string, val: string) => _setSession(key, val),
        delete: (key: string) => _deleteSession(key),
    },
    db: {
        query: (sql: string, params?: any[]) => _dbQuery(sql, params),
        execute: (sql: string, params?: any[]) => _dbExecute(sql, params),
        clearTable: (tableName: string) => _dbExecute("DELETE FROM " + tableName),
        importCsv: async (tableName: string, filePath: string) => _dbImportCsv(tableName, filePath),
        importJson: async (tableName: string, filePath: string) => _dbImportJson(tableName, filePath),
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
        try { rmSync(tmpFile); } catch (e) { console.debug('[vja] rmSync failed:', e); }
    }
};

// AppEvents用のセッションヘルパー
const _getSession = (key: string): string | null => _session.get(key) ?? null;
const _setSession = (key: string, val: string): void => { _session.set(key, val); };
const _deleteSession = (key: string): void => { _session.delete(key); };
const _dbQuery = (sql: string, params?: any[]): any[] => {
    try {
        const db = _currentProjectDbDir
            ? getProjectDb(_currentProjectDbDir)
            : getDb();
        return db.query(sql).all(...(params || [])) as any[];
    } catch (e) { console.debug('[vja] catch:', e); return []; }
};
const _dbExecute = (sql: string, params?: any[]): any => {
    try {
        const db = _currentProjectDbDir
            ? getProjectDb(_currentProjectDbDir)
            : getDb();
        return db.run(sql, ...(params || []));
    } catch { return null; }
};

// AppEvents用DBインポートヘルパー
const _dbImportCsv = async (tableName: string, filePath: string): Promise<void> => {
    const text = await Bun.file(filePath).text();
    const lines = text.split("\n").filter((l: string) => l.trim());
    if (lines.length < 2) return;
    const parseCsvLine = (line: string): string[] => {
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
    const headers = parseCsvLine(lines[0]);
    const db = _currentProjectDbDir ? getProjectDb(_currentProjectDbDir) : getDb();
    const sql = "INSERT INTO " + tableName + " (" + headers.join(",") + ") VALUES (" + headers.map(() => "?").join(",") + ")";
    const stmt = db.prepare(sql);
    const insertMany = db.transaction((rows: any[]) => { for (const row of rows) stmt.run(...row); });
    const rows = lines.slice(1).map((l: string) => parseCsvLine(l));
    insertMany(rows);
};

const _dbImportJson = async (tableName: string, filePath: string): Promise<void> => {
    const data = await Bun.file(filePath).json();
    if (!Array.isArray(data) || data.length === 0) return;
    const headers = Object.keys(data[0]);
    const db = _currentProjectDbDir ? getProjectDb(_currentProjectDbDir) : getDb();
    const sql = "INSERT INTO " + tableName + " (" + headers.join(",") + ") VALUES (" + headers.map(() => "?").join(",") + ")";
    const stmt = db.prepare(sql);
    const insertMany = db.transaction((rows: any[]) => { for (const row of rows) stmt.run(...headers.map((h: string) => row[h] ?? null)); });
    insertMany(data);
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

// プロジェクトウィンドウ用RPC（vjaデザイナーのRPCとは独立）
let _projectRPC: ReturnType<typeof BrowserView.defineRPC> | null = null;

// プロジェクトウィンドウを開く
// プロジェクトウィンドウのURLを切り替えてリサイズ
// プロジェクトウィンドウのURL読み込みコア（許可→loadURL→deny）
const _loadProjectURL = async (htmlPath: string): Promise<void> => {
    if (!_projectWindow) throw new Error("プロジェクトウィンドウが開いていません");
    const projDir = join(_projectWorkDir, _currentProjectName || "project");
    // 遷移を一時許可
    _projectWindow.webview.setNavigationRules([`file://${projDir}/*`]);
    // file:// が付いていない場合は付ける
    if (!htmlPath.startsWith("file://")) {
        htmlPath = "file://" + htmlPath;
    }
    await _projectWindow.webview.loadURL(htmlPath);
    // ロックはフロント側の DOMContentLoaded 通知（pageLoadedRequest）で行う
};

const navigateProjectWindow = async (htmlPath: string, w: number, h: number): Promise<void> => {
    await _loadProjectURL(htmlPath);
    _projectWindow!.setSize(w, h);
    console.log(`[project] navigate: ${htmlPath} (${w}x${h})`);
};

const openProjectWindow = async (htmlPath: string, w: number, h: number): Promise<void> => {
    closeProjectWindow();
    _session.clear();
    // プロジェクトウィンドウ専用のRPCを作成（vjaRPCと分離）
    _projectRPC = BrowserView.defineRPC<VjaRPCType>({
        maxRequestTime: 5000,
        handlers: {
            requests: {},
            messages: {
                logRequest: ({ level, message }) => {
                    writeLog(level, `[proj] ${message}`);
                },
                pageLoadedRequest: () => {
                    // ページ読み込み完了 → 遷移をロック
                    _projectWindow?.webview.setNavigationRules(["^*"]);
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
                    if (value === null) _session.delete(key);
                    else _session.set(key, value);
                    _projectWindow?.webview.rpc.send.sessionSetResult({ ok: true });
                },
                stopProjectRequest: async () => {
                    closeProjectWindow();
                    browserWindow.webview.rpc.send.stopProjectResult({ ok: true });
                },


                // ── DB操作（プロジェクトウィンドウ → Bun → _projectWindow へ返す） ──
                dbQueryRequest: async ({ sql, params }) => {
                    try {
                        const db = _currentProjectDbDir
                            ? getProjectDb(_currentProjectDbDir)
                            : getDb();
                        const rows = db.query(sql).all(...(params || []));
                        _projectWindow?.webview.rpc.send.dbQueryResult({ ok: true, rows: rows as any });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.dbQueryResult({ ok: false, rows: [], error: e.message });
                    }
                },
                dbExecuteRequest: async ({ sql, params }) => {
                    try {
                        const db = _currentProjectDbDir
                            ? getProjectDb(_currentProjectDbDir)
                            : getDb();
                        const r = db.run(sql, ...(params || []));
                        _projectWindow?.webview.rpc.send.dbExecuteResult({
                            ok: true,
                            result: { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) },
                        });
                    } catch (e: any) {
                        _projectWindow?.webview.rpc.send.dbExecuteResult({
                            ok: false,
                            result: { changes: 0, lastInsertRowid: 0 },
                            error: e.message,
                        });
                    }
                },
                dbTransactionRequest: async ({ statements }) => {
                    try {
                        const db = _currentProjectDbDir
                            ? getProjectDb(_currentProjectDbDir)
                            : getDb();
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
            },
        },
    });
    _projectWindow = new BrowserWindow({
        title: _currentProjectName || "VJA Project",
        frame: { x: 100, y: 100, width: w, height: h },
        titleBarStyle: "hidden",
        rpc: _projectRPC,
    });
    // 初期状態: 全遷移をブロック（vja.navigate()経由のみ許可）
    _projectWindow.webview.setNavigationRules(["^*"]);
    // 最初のフォームを読み込む
    await _loadProjectURL(htmlPath);
    // win.on("close") で確実にクローズ検知
    _projectWindow.on("close", () => {
        _onProjectWindowClosed();
    });
    console.log(`[project] opened: ${htmlPath} (${w}x${h})`);
    // OnStart を Bun側で実行（ウィンドウ表示後）
    setTimeout(async () => {
        try {
            await runOnStart();
        } catch (e: any) {
            console.error("[app] OnStart実行エラー:", e.message);
        }
    }, 300);
};
// プロジェクトウィンドウを閉じる
const closeProjectWindow = (): void => {
    if (_projectWindow) {
        const win = _projectWindow;
        _projectWindow = null;
        _projectRPC = null;
        try {
            _session.clear();
            win.close();
            console.log("[project] closed");
        } catch (e) {
            console.error("[project] closeProjectWindow エラー:", e);
        } finally {
            try { _session.clear(); } catch (e) { console.debug("[vja] session.clear failed:", e); }
        }
    }
};

// プロジェクトウィンドウが閉じられた時の処理
const _onProjectWindowClosed = (): void => {
    // 非同期でOnExitを実行してから終了フラグをON
    (async () => {
        try {
            await runOnExit();
        } catch (err: any) {
            console.error("[close] 終了トリガーでエラーが発生", err);
        } finally {
            try {
                _projectWindow = null;
                _projectRPC = null;
                _session.clear();
                // vjaデザイナー側にボタンリセットを通知
                setTimeout(() => {
                    try {
                        browserWindow.webview.rpc.send.stopProjectResult({ ok: true });
                    } catch (e) {
                        console.warn("[project] stopProjectResult送信エラー:", e);
                    }
                }, 100);
            } catch (wn: any) {
                console.warn("プロジェクト終了フラグの設定に失敗しました", wn);
            }
        }
    })();
};

// フォーム名からURL・サイズを取得
const getProjectFormPath = (formName: string): {
    ok: boolean; error?: string; path?: string; w?: number; h?: number;
} => {
    const form = _currentProjectForms.find(f => f.cfg.title === formName);
    if (!form) return { ok: false, error: `フォーム "${formName}" が見つかりません` };
    const projName = _currentProjectName || "project";
    const path = `file://${join(_projectWorkDir, projName, `${formName}.html`)}`;
    const w = form.cfg.w || 640;
    const h = form.cfg.h || 420;
    return { ok: true, path, w, h };
};


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
