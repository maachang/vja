// electrobun.config.ts
import type { ElectrobunConfig } from "electrobun";
import { join } from "path";

import { COPY_BUILD_FILES, getVersion, ELECTROBUN_BUN_VERSION, ELECTROBUN_PATCH_FILE } from "./src/bun/copy-compile-assets";

// 基本コンフィグ定義をセット.
const conf = {
    app: {
        name: "vja",
        identifier: "vja",
        version: "unknown",
    },
    build: {
        // 同梱bunのバージョン（Electrobun 1.18.1の既定は1.3.13。bun 1.4系対応パッチとセット）.
        bunVersion: ELECTROBUN_BUN_VERSION,
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
        // Mac: Electrobun本体が.iconsetを.icnsへ変換して埋め込む（macOS上のビルド時のみ。iconutil使用）.
        // NOTE: WindowsでElectrobun本体側のバグ（rcedit解決失敗）によりアイコン埋め込みが
        // 機能しないため、win/linuxはコメントアウトして無効化している（Windowsはpostビルドフック
        // scripts/win-embed-icon.tsで回避済み）。
        // 詳細は .claude/notes/known-constraints.md を参照。Electrobun側修正後に復活させること。
        mac: {
            icons: "icon/icon.iconset",
        },
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
    // Windows向けビルドでlauncher.exe/bun.exeへアイコンを埋め込むフック（Electrobun本体のrcedit解決バグの回避）.
    // Windows以外では何もしない。詳細は scripts/win-embed-icon.ts を参照。
    scripts: {
        postBuild: "scripts/win-embed-icon.ts",
    },
} satisfies ElectrobunConfig;

// build時・dev時に実行(実行コマンドに "build" または "dev" が含まれているか判定).
// dev実行時もWEBVIEW_RUNTIME_LIBS（qrcode.js/marked.umd.js等）がResources/app/src/mainview配下に
// 存在しないと、プロジェクト実行時のライブラリコピー（index.tsのbuildProjectFiles）が失敗するため対象に含める。
// ここでプロジェクトコンパイルで必要なファイルをコピー.
// COPY_BUILD_FILES=copy-compile-assets
if (process.argv.includes("build") || process.argv.includes("dev")) {
    const target = conf.build.copy;
    for (const [srcRel, destRel] of COPY_BUILD_FILES) {
        const src = join("src", srcRel);
        const dest = join("src", destRel);
        target[src] = dest;
    }
    // 新規プロジェクト作成ウィザードが参照する「システムモデル」定義（マークダウン）。
    // ディレクトリ単位でコピーされるため、中身のmd/summary.mdファイルを追加・削除
    // するだけでよく、このファイルの変更は不要（copyCompileAssetsとは別枠。
    // コンパイル済みユーザーアプリには同梱しない、VJA自身の実行時専用データのため）。
    target[join("src", "wizard-system-models")] = join("src", "wizard-system-models");
    // vjaプロジェクトのコンパイル時に、生成先のpackage.jsonへ同じbun 1.4系対応パッチを適用するため、
    // パッチファイルをResources/app/patches/へ同梱する（compileProject()が参照）。
    target[join("patches", ELECTROBUN_PATCH_FILE)] = join("patches", ELECTROBUN_PATCH_FILE);
    // vjaプロジェクトのコンパイル時に、生成先へWindowsアイコン埋め込みフックとアイコンを配置するため
    // Resources/app/ へ同梱する（compileProject()が参照）。
    target[join("scripts", "win-embed-icon.ts")] = join("scripts", "win-embed-icon.ts");
    target[join("icon", "vja.ico")] = join("icon", "vja.ico");
    target[join("icon", "icon.iconset")] = join("icon", "icon.iconset");
    // VJAデザイナー本体（vja-templates-loader.js）が起動時に同期XHRで読み込む
    // HTMLテンプレート定義。index.htmlのentrypointビルドでは<script src>のような
    // 静的参照ではないため自動検出されず、明示的にコピー対象へ加える必要がある。
    // webview側は views://mainview/... で配信されるため、コピー先は
    // src/mainview/ではなくviews/mainview/にする必要がある（Resources/app/views/mainview/
    // 配下をwebviewが直接参照するため。src/wizard-system-models等はbun側からの
    // fsアクセス用でこれとは配信経路が異なる）。
    // ディレクトリ単位でコピーされるため、中身のファイルを追加・削除するだけでよい。
    target[join("src", "mainview", "templates")] = join("views", "mainview", "templates");
    // prompt-def.js（AIプロンプト定義）が起動時に同期XHRで読み込むプロンプト
    // テンプレート（.md）。上のtemplates/ディレクトリと全く同じ理由・配信経路
    // （views://mainview/...）で明示的なコピー登録が必要。
    target[join("src", "mainview", "prompts")] = join("views", "mainview", "prompts");
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
