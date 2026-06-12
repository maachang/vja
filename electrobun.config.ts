// electrobun.config.ts
import type { ElectrobunConfig } from "electrobun";

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
        // 現状アイコンの設定はうまく動かないのでコメントにしておく.
        // [mac]アイコン(icns)
        //mac: {
        //    icons: "icon/vja.icns"
        //},
        // [windows]アイコン(ico)
        //win: {
        //    icon: "icon/vja.ico"
        //},
        // [linux]アイコン(png)
        //linux: {
        //    icon: "icon/vja.png"
        //},
    },
} satisfies ElectrobunConfig;
