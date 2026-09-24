#!/bin/bash
# vja ローカルLLM環境セットアップスクリプト（Apple Silicon Mac専用）
#
# 背景:
#   docs/localLlm/mac-mlx-lm-setup.md に記載の手順（Homebrew→pipx→mlx-lm導入、
#   モデル選定、起動スクリプト作成）を対話式で自動化するもの。
#   vja本体のセットアップ（setup-mac.sh）とは独立した、ローカルLLM実行環境専用のスクリプト。
#
# 注意:
#   - mlx-lmはpipx経由でグローバルインストールされ、モデルは~/.cache/huggingface/に
#     保存されるため、vjaプロジェクトディレクトリとは独立した場所にセットアップする。
#     どこに起動スクリプトを置くかは、このスクリプト実行時にユーザーへ確認する。
#   - Homebrewは前提条件（インストール済みであること）とし、このスクリプトはHomebrewの
#     自動インストールは行わない（無ければエラーで案内して終了する）。
#   - mlx_lm serverはフォアグラウンドでターミナルを1つ占有し続けるプロセスのため、
#     フォアグラウンド起動用（start-llm.sh）とバックグラウンド起動用（start-llm-bg.sh）の
#     両方を生成する。
set -e

if [ "$(uname)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
    echo "エラー: このスクリプトはApple Silicon Mac（M1以降）専用です"
    exit 1
fi

if ! command -v brew > /dev/null 2>&1; then
    echo "エラー: Homebrewがインストールされていません"
    echo "先に https://brew.sh/ の手順に従ってHomebrewをインストールしてから、再度このスクリプトを実行してください"
    exit 1
fi

echo "=== vja ローカルLLM環境セットアップ（mlx-lm） ==="
echo ""

# セットアップ先ディレクトリ
DEFAULT_SETUP_DIR="$HOME/vja-local-llm"
read -r -p "セットアップ先ディレクトリ [${DEFAULT_SETUP_DIR}]: " SETUP_DIR
SETUP_DIR="${SETUP_DIR:-$DEFAULT_SETUP_DIR}"
mkdir -p "$SETUP_DIR"
echo "セットアップ先: $SETUP_DIR"
echo ""

# pipx導入
if ! command -v pipx > /dev/null 2>&1; then
    echo "pipxをインストールします..."
    brew install pipx
    pipx ensurepath
else
    echo "pipxは導入済みです（スキップ）"
fi

# mlx-lm導入
if ! pipx list 2>/dev/null | grep -q "package mlx-lm"; then
    echo "mlx-lmをインストールします..."
    pipx install mlx-lm
else
    echo "mlx-lmは導入済みです（スキップ）"
fi
echo ""

# モデルはQwen2.5-Coder-7B-Instruct-4bit固定
MODEL="Qwen2.5-Coder-7B-Instruct-4bit"
echo "使用モデル: mlx-community/${MODEL}（固定）"
echo ""

# 起動パラメータ
DEFAULT_PORT=8080
DEFAULT_MAX_TOKEN=16384
DEFAULT_TEMP=0

read -r -p "ポート番号 [${DEFAULT_PORT}]: " PORT
PORT="${PORT:-$DEFAULT_PORT}"

read -r -p "max-tokens [${DEFAULT_MAX_TOKEN}]: " MAX_TOKEN
MAX_TOKEN="${MAX_TOKEN:-$DEFAULT_MAX_TOKEN}"

read -r -p "temperature [${DEFAULT_TEMP}]: " TEMP
TEMP="${TEMP:-$DEFAULT_TEMP}"
echo ""

# start-llm.sh（フォアグラウンド起動用）
START_SH="$SETUP_DIR/start-llm.sh"
cat > "$START_SH" <<EOF
#!/bin/bash
# vja ローカルLLM 起動スクリプト（フォアグラウンド）
# 実行するとこのターミナルを占有し続けます（Ctrl+Cで停止）。
MODEL=${MODEL}
PORT=${PORT}
MAX_TOKEN=${MAX_TOKEN}
TEMP=${TEMP}

mlx_lm server \\
  --model mlx-community/\${MODEL} \\
  --port \${PORT} \\
  --max-tokens \${MAX_TOKEN} \\
  --temp \${TEMP}
EOF
chmod +x "$START_SH"

# start-llm-bg.sh（バックグラウンド起動用）
START_BG_SH="$SETUP_DIR/start-llm-bg.sh"
LOG_FILE="$SETUP_DIR/mlx_lm.log"
PID_FILE="$SETUP_DIR/mlx_lm.pid"
cat > "$START_BG_SH" <<EOF
#!/bin/bash
# vja ローカルLLM 起動スクリプト（バックグラウンド）
# ログは ${LOG_FILE} に出力されます。
# 停止するには: kill \$(cat ${PID_FILE})
cd "\$(dirname "\$0")"
nohup ./start-llm.sh > "${LOG_FILE}" 2>&1 &
echo \$! > "${PID_FILE}"
echo "バックグラウンドで起動しました（PID: \$(cat "${PID_FILE}")）"
echo "ログ: ${LOG_FILE}"
echo "停止するには: kill \$(cat "${PID_FILE}")"
EOF
chmod +x "$START_BG_SH"

echo "セットアップ完了"
echo ""
echo "=== 起動方法 ==="
echo "フォアグラウンド起動（専用ターミナルを1つ占有します）:"
echo "  $START_SH"
echo ""
echo "バックグラウンド起動（ログ: $LOG_FILE）:"
echo "  $START_BG_SH"
echo ""
echo "※ 初回起動時はモデル(mlx-community/${MODEL})のダウンロードが発生し、数GBあるため時間がかかります"
echo ""
echo "=== VJA側のAI接続設定 ==="
echo "  エンドポイント: http://localhost:${PORT}"
echo "  モデル名        : ${MODEL}"
echo "  APIキー         : 不要（空欄のまま）"
echo "  ※ルーターモードはOFFにしてください"
