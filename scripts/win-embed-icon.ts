// scripts/win-embed-icon.ts
// Windows向けビルドで、launcher.exe / bun.exe へアイコンを埋め込むElectrobunの postBuild フック。
//
// 背景: Electrobun本体(CLIバイナリ)のアイコン埋め込みは、rcedit解決パスがビルド元CIマシンの
// 絶対パスにハードコードされているため失敗する（.claude/CLAUDE.md「既知の制約」参照）。
// CLIバイナリはパッチできないため、CLI側のアイコン設定(build.win.icon)は使わず、
// この postBuild フック（アプリ本体の生成後・圧縮/パッケージング前に実行される）で
// プロジェクトにインストールされたrceditを直接呼んで埋め込む。
//
// 実行: bun <このファイル>（cwd=プロジェクトルート）。Electrobunが以下の環境変数を渡す。
//   ELECTROBUN_OS / ELECTROBUN_BUILD_DIR / ELECTROBUN_APP_NAME
// アイコンは <プロジェクトルート>/icon/vja.ico を使う。
// 失敗してもビルド自体は止めない（Electrobun本来のアイコン埋め込みと同じく警告のみ）。

import { existsSync } from "fs";
import { join, dirname } from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";

// Windows以外のビルドでは何もしない.
if (process.env.ELECTROBUN_OS !== "win") process.exit(0);

const buildDir = process.env.ELECTROBUN_BUILD_DIR;
const appName = process.env.ELECTROBUN_APP_NAME;
if (!buildDir || !appName) {
    console.warn("[win-embed-icon] ELECTROBUN_BUILD_DIR/ELECTROBUN_APP_NAME が未設定のためスキップします");
    process.exit(0);
}

const iconPath = join(process.cwd(), "icon", "vja.ico");
if (!existsSync(iconPath)) {
    console.warn(`[win-embed-icon] アイコンが見つからないためスキップします: ${iconPath}`);
    process.exit(0);
}

try {
    // プロジェクトのnode_modulesにあるrcedit(Electrobunの依存)を解決する.
    const rceditDir = dirname(createRequire(join(process.cwd(), "package.json")).resolve("rcedit/package.json"));
    const rceditX64 = join(rceditDir, "bin", "rcedit-x64.exe");
    const rceditExe = existsSync(rceditX64) ? rceditX64 : join(rceditDir, "bin", "rcedit.exe");

    const binDir = join(buildDir, appName, "bin");
    for (const exe of ["launcher.exe", "bun.exe"]) {
        const target = join(binDir, exe);
        if (!existsSync(target)) {
            console.warn(`[win-embed-icon] 対象が見つかりません: ${target}`);
            continue;
        }
        execFileSync(rceditExe, [target, "--set-icon", iconPath]);
        console.log(`[win-embed-icon] アイコンを埋め込みました: ${target}`);
    }
} catch (e) {
    console.warn(`[win-embed-icon] アイコン埋め込みに失敗しました: ${e}`);
}
