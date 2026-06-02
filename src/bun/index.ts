// src/bun/index.ts
// VJA Form Designer - Electrobun メインプロセス

import { BrowserWindow, BrowserView, Utils } from "electrobun/bun";
import { homedir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { dirname, join } from "path";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { type VjaRPCType } from "../shared/types";

const _TITLE = "VJA Form Designer";
const execFileAsync = promisify(execFile);

// コマンド実行.
const execCmd = async (cmd: string[]): Promise<string> => {
    try {
        const [bin, ...args] = cmd;
        const { stdout } = await execFileAsync(bin, args);
        return (stdout ?? "").trim();
    } catch {
        return "";
    }
};

// browserWindowのrpcを取得.
const getBrowserWindowRpc = (): any => {
    if (browserWindow.webview.rpc == undefined) {
        throw new Error("browserWindow.webview.rpc is undefined");
    }
    return browserWindow.webview.rpc;
};

// ── 前回のフォルダを永続化 ────────────────────────────
// ~/.vja-designer/last-dir.txt に保存する
const _configDir = join(homedir(), ".vja-designer");
const _lastDirFile = join(_configDir, "last-dir.txt");

const loadLastDir = (): string => {
    try {
        if (existsSync(_lastDirFile)) {
            const saved = readFileSync(_lastDirFile, "utf-8").trim();
            if (saved && existsSync(saved)) {
                console.log("[lastDir] loaded:", saved);
                return saved;
            }
        }
    } catch (e: any) {
        console.warn("[lastDir] load failed:", e.message);
    }
    return homedir();
};

const saveLastDir = async (filePath: string): Promise<void> => {
    try {
        const dir = dirname(filePath);
        if (!existsSync(_configDir)) mkdirSync(_configDir, { recursive: true });
        await Bun.write(_lastDirFile, dir);
        console.log("[lastDir] saved:", dir);
    } catch (e: any) {
        console.warn("[lastDir] save failed:", e.message);
    }
};

let _lastDir: string = loadLastDir();

// ── 保存ダイアログ ────────────────────────────────────
const saveFileDialog = async (
    defaultName: string,
    ext: string,
): Promise<string | null> => {
    // フルパスで渡すことでダイアログが前回のフォルダから開く
    const defaultPath = join(_lastDir, defaultName);

    if (process.platform === "darwin") {
        const script = `choose file name default name "${defaultName}" with prompt "保存先を選択"`;
        const out = await execCmd(["osascript", "-e", script]);
        if (!out) return null;
        let p = out
            .replace(/^alias [^:]+:/, "/")
            .replace(/:/g, "/")
            .replace(/\n/g, "");
        return p && !p.endsWith("." + ext) ? p + "." + ext : p || null;
    } else if (process.platform === "linux") {
        const hasZenity = (await execCmd(["which", "zenity"])).length > 0;
        const hasKdialog =
            !hasZenity && (await execCmd(["which", "kdialog"])).length > 0;
        if (hasZenity) {
            const out = await execCmd([
                "zenity",
                "--file-selection",
                "--save",
                "--confirm-overwrite",
                `--filename=${defaultPath}`, // フルパスで指定
                "--title=保存先を選択",
                `--file-filter=*.${ext}`,
            ]);
            return out
                ? out.endsWith("." + ext)
                    ? out
                    : out + "." + ext
                : null;
        } else if (hasKdialog) {
            const out = await execCmd([
                "kdialog",
                "--getsavefilename",
                defaultPath, // フルパスで指定
                `*.${ext}`,
            ]);
            return out
                ? out.endsWith("." + ext)
                    ? out
                    : out + "." + ext
                : null;
        }
        return null;
    } else if (process.platform === "win32") {
        const ps = `Add-Type -AssemblyName System.Windows.Forms\n$d = New-Object System.Windows.Forms.SaveFileDialog\n$d.Filter = "${ext} files (*.${ext})|*.${ext}"\n$d.FileName = "${defaultPath}"\n$d.Title = "保存先を選択"\nif($d.ShowDialog() -eq 'OK'){ $d.FileName }`;
        return (await execCmd(["powershell", "-Command", ps])) || null;
    }
    return null;
};

// ── RPC 定義（message ベース = タイムアウトなし）────────
const vjaRPC = BrowserView.defineRPC<VjaRPCType>({
    maxRequestTime: 5000,
    handlers: {
        requests: {},
        messages: {
            // ファイルを開く: ダイアログ表示して結果を webview に送り返す
            openFileRequest: async ({ filter, lastPath }) => {
                const ext = filter === "html" ? "html" : "vjaproj";
                const startingFolder = lastPath ? dirname(lastPath) : _lastDir;
                console.log(
                    "[open] startingFolder:",
                    startingFolder,
                    "ext:",
                    ext,
                );
                const paths = await Utils.openFileDialog({
                    startingFolder,
                    allowedFileTypes:
                        (ext as string) === "*" ? "*" : `*.${ext}`,
                    canChooseFiles: true,
                    canChooseDirectory: false,
                    allowsMultipleSelection: false,
                });
                const path = paths?.length ? paths[0] : null;
                if (!path) {
                    getBrowserWindowRpc().send.openFileResult({
                        content: null,
                        path: null,
                    });
                    return;
                }
                try {
                    const content = await Bun.file(path).text();
                    _lastDir = dirname(path);
                    await saveLastDir(path); // 永続化
                    console.log("[open]", path);
                    getBrowserWindowRpc().send.openFileResult({
                        content,
                        path,
                    });
                } catch (e: any) {
                    console.error("[open error]", e.message);
                    getBrowserWindowRpc().send.openFileResult({
                        content: null,
                        path: null,
                    });
                }
            },

            // 保存: ダイアログ表示→書き込みして結果を webview に送り返す
            saveFileRequest: async ({ content, defaultName, lastPath }) => {
                let savePath = lastPath ?? null;
                if (!savePath) {
                    savePath = await saveFileDialog(
                        defaultName ?? "project.vjaproj",
                        "vjaproj",
                    );
                }
                if (!savePath) {
                    console.log("[save] cancelled");
                    getBrowserWindowRpc().send.saveFileResult({
                        ok: false,
                        path: null,
                        cancelled: true,
                    });
                    return;
                }
                try {
                    await Bun.write(savePath, content);
                    _lastDir = dirname(savePath);
                    await saveLastDir(savePath); // 永続化
                    console.log("[saved]", savePath);
                    getBrowserWindowRpc().send.saveFileResult({
                        ok: true,
                        path: savePath,
                        cancelled: false,
                    });
                } catch (e: any) {
                    console.error("[save error]", e.message);
                    getBrowserWindowRpc().send.saveFileResult({
                        ok: false,
                        path: null,
                        cancelled: false,
                    });
                }
            },

            // アプリを終了する
            closeAppRequest: () => {
                console.log("[close]");
                browserWindow.close();
            },
        },
    },
});

// ── BrowserWindow 生成 ────────────────────────────────
const browserWindow = new BrowserWindow({
    title: _TITLE,
    url: "views://mainview/index.html",
    frame: { x: 0, y: 0, width: 1280, height: 800 },
    rpc: vjaRPC,
});

// 起動時最大表示.
browserWindow.maximize();
