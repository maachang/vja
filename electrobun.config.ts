// electrobun.config.ts
import type { ElectrobunConfig } from "electrobun";

// 💡 実行コマンドに "build" が含まれているか判定
const isBuildMode = process.argv.includes("build");

export default {
    app: {
        name: "vja",
        identifier: "vja",
        version: "0.1.0",
    },
    build: {
        // vjaのbun.jsメイン.
        bun: {
            entrypoint: "src/bun/index.ts",
        },
        // webview.
        views: {
            // vjaのview(index.html).
            mainview: {
                entrypoint: "src/mainview/index.html",
            },
            // vjaのプロジェクトのview.
            projectview: {
                entrypoint: "src/mainview/project-bridge.ts",
            },
        },
        // build時のみ実行.
        // ここでプロジェクトコンパイルで必要なファイルをコピー.
        copy: isBuildMode ? {
            "src/bun/logger.ts": "/src/bun/logger.ts",
            "src/bun/db-manager.ts": "src/bun/db-manager.ts",
            "src/bun/bun-utils.ts": "src/bun/bun-utils.ts",
            "src/bun/standalone-index.ts": "src/bun/standalone-index.ts",
            "src/bun/project-runner.ts": "src/bun/project-runner.ts",
            "src/shared/types.ts": "src/shared/types.ts",
            "src/mainview/project-bridge.ts": "src/mainview/project-bridge.ts",
            "src/mainview/vja-runtime.js": "src/mainview/vja-runtime.js",
        } : {},
    },
} satisfies ElectrobunConfig;
