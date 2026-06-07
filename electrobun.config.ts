// electrobun.config.ts
import type { ElectrobunConfig } from "electrobun";

export default {
    app: {
        name: "VJA Form Designer",
        identifier: "dev.vja.formdesigner",
        version: "0.1.0",
    },
    build: {
        bun: {
            entrypoint: "src/bun/index.ts",
        },
        views: {
            mainview: {
                entrypoint: "src/mainview/index.html",
            },
            projectview: {
                entrypoint: "src/mainview/project-bridge.ts",
            },
        },
    },
} satisfies ElectrobunConfig;
