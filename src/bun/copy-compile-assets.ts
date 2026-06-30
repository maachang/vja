// src/bun/copy-compile-assets.ts
// vja コンパイル機能で必要なソースファイルを
// ~/.vja-apps/VJAFormDesigner/compile-assets/ にコピーする。
// index.ts の起動時に呼び出すことで最新状態を維持する。

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const DEST = join(homedir(), ".vja-apps", "VJAFormDesigner", "compile-assets", "src");

// コピー対象ファイル定義
// [vjaRoot/src/ からの相対パス, compile-assets/src/ からの相対パス]
// compileProject() でも同じリストを使って一元管理する
export const COPY_BUILD_FILES: [string, string][] = [
    ["bun/logger.ts", "bun/logger.ts"],
    ["bun/db-manager.ts", "bun/db-manager.ts"],
    ["bun/bun-utils.ts", "bun/bun-utils.ts"],
    ["bun/standalone-index.ts", "bun/standalone-index.ts"],
    ["bun/project-runner.ts", "bun/project-runner.ts"],
    ["shared/types.ts", "shared/types.ts"],
    ["mainview/project-bridge.ts", "mainview/project-bridge.ts"],
    ["mainview/bridge-common.ts", "mainview/bridge-common.ts"],
    ["mainview/vja-runtime.js", "mainview/vja-runtime.js"],
];

// build後のsrcパスを取得.
export const BUILD_VJA_SRC_PATH = join(process.env.PWD, "..", "Resources/app");

// vjaRoot: vjaプロジェクトルート（省略時は process.env.PWD を使用）
export const copyCompileAssets = (vjaRoot?: string): void => {
    // 指定引数をを整理.
    let root = vjaRoot || process.env.PWD || "";
    if (existsSync(BUILD_VJA_SRC_PATH)) {
        // build後とみなして root にコンパイル済みでのパスをセット.
        root = BUILD_VJA_SRC_PATH;
    }
    if (!root) {
        console.warn("[copy-compile-assets] vjaプロジェクトルートが取得できません");
        return;
    }
    console.debug("`## [copy-compile-assets] start: " + root);
    let copied = 0;
    for (const [srcRel, dstRel] of COPY_BUILD_FILES) {
        const src = join(root, "src", srcRel);
        const dst = join(DEST, dstRel);
        if (!existsSync(src)) {
            //console.debug(`[copy-compile-assets] スキップ（ソースなし）: ${srcRel}`);
            continue;
        }
        //} else {
        //    console.debug(`[copy-compile-assets] NOスキップ: ${srcRel}`);
        //}
        const dstDir = dirname(dst);
        if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
        copyFileSync(src, dst);
        copied++;
    }
    if (copied > 0) {
        console.log(`[copy-compile-assets] ${copied} ファイルをコピーしました → ${DEST}`);
    }
    console.debug("`## [copy-compile-assets] end");
};

// 実行モジュールのバージョンを返却します.
export const getVersion = (): any => {
    // カレントパス.
    const current = process.env.PWD;
    // モジュール名の名前とバージョンを取得.
    let json = null;
    let runMode = "unknwon"; // 実行モード不明.
    // ビルド後なら、version.jsonを読み込む.
    try {
        json = JSON.parse(
            readFileSync(
                join(current, "..", "Resources", "version.json"), "UTF-8"));
        runMode = "build"; // コンパイル済み実行.
    } catch (e) {
        json = null;
    }
    if (json == null) {
        // ビルド前ならpackage.jsonを読み込む.
        try {
            json = JSON.parse(
                readFileSync(
                    join(current, "package.json"), "UTF-8"));
            runMode = "dev"; // コンパイル済み実行.
        } catch (e) {
            json = {
                name: "unknown",
                version: "unknown"
            }
        }
    }
    return {
        name: json.name,
        version: json.version,
        runMode: runMode
    }
}
