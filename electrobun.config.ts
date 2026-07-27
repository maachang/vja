// electrobun.config.ts
import type { ElectrobunConfig } from "electrobun";
import { join } from "path";

import { COPY_BUILD_FILES, getVersion } from "./src/bun/copy-compile-assets";

// 基本コンフィグ定義をセット.
const conf = {
    app: {
        name: "vja",
        identifier: "vja",
        version: "unknown",
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
        // アイコン設定.
        // NOTE: WindowsでElectrobun本体側のバグ（rcedit解決失敗）によりアイコン埋め込みが
        // 機能しないため、一旦全OS分をコメントアウトして無効化している。
        // 詳細は .claude/CLAUDE.md の「既知の制約」を参照。Electrobun側修正後に復活させること。
        // mac: {
        //     icons: "icon/icon.iconset",
        // },
        // win: {
        //     icon: "icon/vja.ico",
        // },
        // linux: {
        //     icon: "icon/vja.png",
        // },
        // build時のみ実行.
        // ここでプロジェクトコンパイルで必要なファイルをコピー.
        copy: {},
    },
} satisfies ElectrobunConfig;

// build時のみ実行(実行コマンドに "build" が含まれているか判定).
// ここでプロジェクトコンパイルで必要なファイルをコピー.
// COPY_BUILD_FILES=copy-compile-assets
if (process.argv.includes("build")) {
    const target = conf.build.copy;
    for (const [srcRel, destRel] of COPY_BUILD_FILES) {
        const src = join("src", srcRel);
        const dest = join("src", destRel);
        target[src] = dest;
    }
}

// バージョンを取得して差し替える.
const info = getVersion();
conf.app.name = info.name;
conf.app.version = info.version;
if (!conf.app.identifier) {
    // identifier が設定されていない場合は name をセット.
    conf.app.identifier = info.name;
}

console.debug("# electrobun.config: " + JSON.stringify(conf.app, null, "  "));

// defaultセット.
export default conf;
