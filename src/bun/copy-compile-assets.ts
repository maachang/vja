// src/bun/copy-compile-assets.ts
// vja コンパイル機能で必要なソースファイルを
// ~/.vja-apps/VJAFormDesigner/compile-assets/ にコピーする。
// index.ts の起動時に呼び出すことで最新状態を維持する。

import { copyFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const DEST = join(homedir(), ".vja-apps", "VJAFormDesigner", "compile-assets", "src");

// コピー対象ファイル（import.meta.dir基準 → compile-assets/src/ 以下の相対パス）
const FILES: [string, string][] = [
    ["logger.ts",                          "bun/logger.ts"],
    ["db-manager.ts",                      "bun/db-manager.ts"],
    ["standalone-index.ts",               "bun/standalone-index.ts"],
    [join("..", "shared", "types.ts"),     "shared/types.ts"],
    [join("..", "mainview", "project-bridge.ts"), "mainview/project-bridge.ts"],
    [join("..", "mainview", "vja-runtime.js"),    "mainview/vja-runtime.js"],
];

export const copyCompileAssets = (): void => {
    let copied = 0;
    for (const [srcRel, dstRel] of FILES) {
        const src = join(import.meta.dir, srcRel);
        const dst = join(DEST, dstRel);
        if (!existsSync(src)) {
            // コンパイル済みバイナリ環境ではソースが存在しないためスキップ
            console.debug(`[copy-compile-assets] スキップ（ソースなし）: ${srcRel}`);
            continue;
        }
        const dstDir = dirname(dst);
        if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
        copyFileSync(src, dst);
        copied++;
    }
    if (copied > 0) {
        console.log(`[copy-compile-assets] ${copied} ファイルをコピーしました → ${DEST}`);
    }
};
