// vja-luncher.js
// 前提:     bun add webview-bun
// 実行方法: bun run vja-luncher.js
(async function () {
    "use strict";
    const { readFileSync, writeFileSync } = require("fs");
    const { join } = require("path");
    const { Webview, SizeHint } = await import("webview-bun");

    // ── 設定 ──────────────────────────────────
    const _DEBUG = true;
    const _TITLE = "VJA Form Designer";
    const _HTML_FILE = "vja-designer.html";
    const _WINDOW_STYLE_MAX = {
        width: 16384,
        height: 16384,
    };
    // ─────────────────────────────────────────

    // ── OS別ファイルダイアログ表示 ────────────────
    const openFileDialog = async function (filter) {
        // filter: 'vjaproj' | 'html'
        const filterMap = {
            vjaproj: { desc: "VJA Project", ext: "vjaproj" },
            html: { desc: "HTML File", ext: "html" },
        };
        const f = filterMap[filter] || { desc: "All Files", ext: "*" };

        if (process.platform === "darwin") {
            // macOS: osascript
            const script = `choose file of type {"${f.ext}"} with prompt "ファイルを開く"`;
            const proc = Bun.spawnSync(["osascript", "-e", script]);
            const out = proc.stdout.toString().trim();
            // "alias Macintosh HD:Users:..." → "/Users/..."
            if (!out) return null;
            const path = out
                .replace(/^alias [^:]+:/, "/")
                .replace(/:/g, "/")
                .replace(/\n/g, "");
            return path || null;
        } else if (process.platform === "linux") {
            // zenity優先、なければkdialog
            const hasZenity = Bun.spawnSync(["which", "zenity"])
                .stdout.toString()
                .trim();
            const hasKdialog = Bun.spawnSync(["which", "kdialog"])
                .stdout.toString()
                .trim();

            if (hasZenity) {
                const proc = Bun.spawnSync([
                    "zenity",
                    "--file-selection",
                    "--title=ファイルを開く",
                    `--file-filter=*.${f.ext}`,
                ]);
                const path = proc.stdout.toString().trim();
                return path || null;
            } else if (hasKdialog) {
                const proc = Bun.spawnSync([
                    "kdialog",
                    "--getopenfilename",
                    ".",
                    `*.${f.ext}`,
                ]);
                const path = proc.stdout.toString().trim();
                return path || null;
            }
            return null;
        } else if (process.platform === "win32") {
            // PowerShell の OpenFileDialog
            const ps = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Filter = "${f.desc} (*.${f.ext})|*.${f.ext}"
$d.Title = "ファイルを開く"
if($d.ShowDialog() -eq 'OK'){ $d.FileName }
`.trim();
            const proc = Bun.spawnSync(["powershell", "-Command", ps]);
            const path = proc.stdout.toString().trim();
            return path || null;
        }
        return null;
    };

    // ── ファイル保存のダイアログ表示 ────────────────
    const saveFileDialog = async function (defaultName, filter) {
        const filterMap = {
            vjaproj: { desc: "VJA Project", ext: "vjaproj" },
            html: { desc: "HTML File", ext: "html" },
        };
        const f = filterMap[filter] || { desc: "All Files", ext: "*" };

        if (process.platform === "darwin") {
            const script = `choose file name default name "${defaultName}" with prompt "保存先を選択"`;
            const proc = Bun.spawnSync(["osascript", "-e", script]);
            const out = proc.stdout.toString().trim();
            if (!out) return null;
            const path = out
                .replace(/^alias [^:]+:/, "/")
                .replace(/:/g, "/")
                .replace(/\n/g, "");
            // 拡張子がなければ付加
            return path && !path.endsWith("." + f.ext)
                ? path + "." + f.ext
                : path || null;
        } else if (process.platform === "linux") {
            const hasZenity = Bun.spawnSync(["which", "zenity"])
                .stdout.toString()
                .trim();
            const hasKdialog = Bun.spawnSync(["which", "kdialog"])
                .stdout.toString()
                .trim();

            if (hasZenity) {
                const proc = Bun.spawnSync([
                    "zenity",
                    "--file-selection",
                    "--save",
                    "--confirm-overwrite",
                    `--filename=${defaultName}`,
                    "--title=保存先を選択",
                    `--file-filter=*.${f.ext}`,
                ]);
                let path = proc.stdout.toString().trim();
                if (!path) return null;
                if (!path.endsWith("." + f.ext)) path += "." + f.ext;
                return path;
            } else if (hasKdialog) {
                const proc = Bun.spawnSync([
                    "kdialog",
                    "--getsavefilename",
                    defaultName,
                    `*.${f.ext}`,
                ]);
                let path = proc.stdout.toString().trim();
                if (!path) return null;
                if (!path.endsWith("." + f.ext)) path += "." + f.ext;
                return path;
            }
            return null;
        } else if (process.platform === "win32") {
            const ps = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.SaveFileDialog
$d.Filter = "${f.desc} (*.${f.ext})|*.${f.ext}"
$d.FileName = "${defaultName}"
$d.Title = "保存先を選択"
if($d.ShowDialog() -eq 'OK'){ $d.FileName }
`.trim();
            const proc = Bun.spawnSync(["powershell", "-Command", ps]);
            const path = proc.stdout.toString().trim();
            return path || null;
        }
        return null;
    };

    ///////////////////////////////////////////////////////////////////////////////
    // Webview 生成.
    ///////////////////////////////////////////////////////////////////////////////

    // 表示用WebView生成+設定.
    const webview = new Webview(_DEBUG, _WINDOW_STYLE_MAX);
    webview.title = _TITLE;

    // ── Bun ↔ WebView バインド ────────────────

    // ファイルを開く
    webview.bind("bunOpenFile", async ({ filter }) => {
        const path = await openFileDialog(filter || "vjaproj");
        if (!path) return { content: null, path: null };
        try {
            const content = readFileSync(path, "utf-8");
            console.log("[open]", path);
            return { content, path };
        } catch (e) {
            console.error("[open error]", e.message);
            throw new Error("ファイルを読み込めませんでした: " + e.message);
        }
    });

    // 保存先ダイアログ（パスだけ返す）
    webview.bind("bunSaveDialog", async ({ defaultName, filter }) => {
        const path = await saveFileDialog(
            defaultName || "project.vjaproj",
            filter || "vjaproj",
        );
        if (!path) return { path: null };
        console.log("[save-dialog]", path);
        return { path };
    });

    // ファイルに書き込む
    webview.bind("bunSaveFile", async ({ path, content }) => {
        if (!path || !content) throw new Error("path または content が空です");
        try {
            writeFileSync(path, content, "utf-8");
            console.log("[saved]", path);
            return { ok: true, path };
        } catch (e) {
            console.error("[save error]", e.message);
            throw new Error("保存に失敗しました: " + e.message);
        }
    });

    // アプリを終了する（HTML側の doClose() から呼ばれる）
    webview.bind("bunCloseApp", async () => {
        console.log("[close] アプリを終了します");
        webview.terminate();
        return { ok: true };
    });

    // ウィンドウの×ボタン押下を横取りして確認ダイアログを表示する
    // webview.init() はページロード前に実行されるJSを注入する
    webview.init(`
        window.addEventListener('DOMContentLoaded', function() {
            // ネイティブの beforeunload を使って×ボタンを横取り
            window.addEventListener('beforeunload', function(e) {
                e.preventDefault();
                e.returnValue = '';
                if(typeof showCloseConfirm === 'function') showCloseConfirm();
                return false;
            });
        });
    `);

    // vja開発画面用の HTML 読み込み
    const vjaHtml = (function () {
        const htmlPath = join(__dirname, _HTML_FILE);
        try {
            return readFileSync(htmlPath, "utf-8");
        } catch (e) {
            console.error(_HTML_FILE + " が見つかりません:", htmlPath);
            process.exit(1);
        }
    })();

    // 実行処理.
    webview.setHTML(vjaHtml);
    webview.run();
})();
