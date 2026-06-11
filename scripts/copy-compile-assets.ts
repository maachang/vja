// scripts/copy-compile-assets.ts
// vja コンパイル機能で必要なソースファイルを
// ~/.vja-apps/VJAFormDesigner/compile-assets/ にコピーする。
// vja 起動時に毎回実行することで最新状態を維持する。

import { copyFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const ROOT   = join(import.meta.dir, "..");
const DEST   = join(homedir(), ".vja-apps", "VJAFormDesigner", "compile-assets", "src");

// コピー対象ファイル（ソース相対パス → compile-assets/src/ 以下の相対パス）
const FILES: [string, string][] = [
    ["src/bun/logger.ts",              "bun/logger.ts"],
    ["src/bun/db-manager.ts",          "bun/db-manager.ts"],
    ["src/bun/standalone-index.ts",    "bun/standalone-index.ts"],
    ["src/shared/types.ts",            "shared/types.ts"],
    ["src/mainview/project-bridge.ts", "mainview/project-bridge.ts"],
    ["src/mainview/vja-runtime.js",    "mainview/vja-runtime.js"],
];

let copied = 0;
for (const [srcRel, dstRel] of FILES) {
    const src = join(ROOT, srcRel);
    const dst = join(DEST, dstRel);
    if (!existsSync(src)) {
        console.warn(`[copy-compile-assets] スキップ（ソースなし）: ${srcRel}`);
        continue;
    }
    const dstDir = dirname(dst);
    if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
    copyFileSync(src, dst);
    copied++;
}
console.log(`[copy-compile-assets] ${copied} ファイルをコピーしました → ${DEST}`);
