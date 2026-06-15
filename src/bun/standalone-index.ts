// src/bun/standalone-index.ts
// vjaでコンパイルされたプロジェクトの実行エントリポイント。
// vjaデザイナー機能は含まない。起動時に project.vjaproj を読み込み直接実行する。

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { initLogger } from "./logger";
import {
    setProjectData, setFormHtmlPathResolver, getProjectFormPath,
    openProjectWindow, _VJA_PASSPHRASE, setVjaProject, _decrypt,
    _currentProjectForms
} from "./project-runner";

// 一旦コンソール出力.
process.stdout.write("### run standalone-index.ts\n");
// プロジェクト実行セット.
setVjaProject(true);

// ── パス定義 ──────────────────────────────────────────
const _appDir = process.cwd();
const _logDir = join(_appDir, "logs");
const _dbDir = join(_appDir, "db");

// ── ロガー初期化 ──────────────────────────────────────
initLogger({ dir: _logDir, level: "info" });

// ── フォームパス解決 ──────────────────────────────────
// スタンドアロン版では views/mainview/{formTitle}.html を使う
setFormHtmlPathResolver((formTitle: string) =>
    join(import.meta.dir, "..", "views", "mainview", `${formTitle}.html`)
);

// ── .vjaproj の読み込み ───────────────────────────────
const _projFile = join(import.meta.dir, "..", "project.vjaproj");

const loadProject = async (): Promise<boolean> => {
    try {
        if (!existsSync(_projFile)) {
            console.error(`[app] project.vjaproj が見つかりません: ${_projFile}`);
            return false;
        }
        const proj = JSON.parse(readFileSync(_projFile, "utf-8"));

        let vjaPass = "";
        if (proj._vjaPass) {
            try { vjaPass = await _decrypt(proj._vjaPass, _VJA_PASSPHRASE); }
            catch (e) { console.debug("[vja] vjaPass decrypt failed:", e); }
        }

        // 互換: nameがなければtitleをnameとして補完
        const forms = (proj.forms || []).map((f: any) => ({
            ...f,
            cfg: { ...f.cfg, name: f.cfg.name || f.cfg.title },
        }));
        setProjectData({
            forms,
            tables: proj.tables || [],
            name: proj.projectInfo?.name || "project",
            dbDir: _dbDir,
            extRuntime: proj.extRuntime?.js || "",
            cloudInfras: proj.cloudInfras || [],
            onStartCode: proj.projectInfo?.appEvents?.onStart || "",
            onExitCode: proj.projectInfo?.appEvents?.onExit || "",
            vjaPass,
        });
        return true;
    } catch (e: any) {
        console.error("[app] プロジェクト読み込み失敗:", e.message);
        return false;
    }
};

// ── エントリポイント ──────────────────────────────────
if (!await loadProject()) {
    console.error("[app] プロジェクトの読み込みに失敗しました。終了します。");
    process.exit(1);
}

const startFormTitle = _currentProjectForms[0]?.cfg?.name || _currentProjectForms[0]?.cfg?.title || "";
const startResult = getProjectFormPath(startFormTitle);

if (!startResult.ok || !startResult.path) {
    console.error("[app] 開始フォームが見つかりません。終了します。");
    process.exit(1);
}

if (!existsSync(startResult.path)) {
    console.error(`[app] 開始フォームのHTMLが見つかりません: ${startResult.path}`);
    process.exit(1);
}

await openProjectWindow(startResult.path, startResult.w!, startResult.h!);
