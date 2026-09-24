#!/bin/bash
# vja macOS用セットアップスクリプト
#
# 背景:
#   npm配布のElectrobun(v1.18.1時点)のCLIバイナリはコード署名が壊れており、
#   macOS 27ではそのまま実行すると起動直後にOSからSIGKILL(exit 137)される。
#   `bun run dev`は何も出力せずexit 0で終了するため、原因が分かりにくい。
#   このスクリプトでCLIバイナリをad-hoc再署名して回避する（macOSのバージョンによらず実行して害はない）。
#
# 注意:
#   CLIバイナリはnpmパッケージに含まれず、electrobunコマンドの初回実行時に
#   node_modules/electrobun/bin/ と .cache/ へダウンロードされる。
#   node_modules/electrobun が入れ直された場合（bun installでの再インストール、
#   electrobunのバージョン変更等）は再署名が消えるため、このスクリプトを再度実行すること。
set -e

cd "$(dirname "$0")"

if [ "$(uname)" != "Darwin" ]; then
    echo "このスクリプトはmacOS専用です"
    exit 1
fi

EB_DIR="node_modules/electrobun"
EB_BIN="$EB_DIR/bin/electrobun"
EB_CACHE="$EB_DIR/.cache/electrobun"

# 1. 依存パッケージのインストール
bun install

# 2. CLIバイナリが未ダウンロードなら、electrobunを一度実行してダウンロードさせる
#    （署名が壊れているためこの実行自体はkillされるが、ダウンロードは完了する）
if [ ! -f "$EB_BIN" ]; then
    echo "Electrobun CLIバイナリをダウンロードします..."
    node_modules/.bin/electrobun --version > /dev/null 2>&1 || true
fi

if [ ! -f "$EB_BIN" ]; then
    echo "エラー: Electrobun CLIバイナリのダウンロードに失敗しました ($EB_BIN)"
    exit 1
fi

# 3. CLIバイナリのad-hoc再署名（bin/が消えた時は.cache/からコピーされるため両方行う）
for f in "$EB_BIN" "$EB_CACHE"; do
    if [ -f "$f" ]; then
        codesign --force --sign - "$f"
        codesign --verify "$f"
    fi
done

# 4. 起動確認
if ! "$EB_BIN" --version > /dev/null 2>&1; then
    echo "エラー: 再署名後もElectrobun CLIが起動できません ($EB_BIN)"
    exit 1
fi

echo "セットアップ完了: bun run dev で起動できます"
