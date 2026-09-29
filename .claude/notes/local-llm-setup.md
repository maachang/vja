<!-- CLAUDE.md から分離したノート（2026-09-29）。内容は分離前の記述をそのまま移したもの。 -->

# Mac（Apple Silicon）向けローカルLLM環境セットアップ支援（2026-09-24追加）

- **概要**: `docs/localLlm/mac-mlx-lm-setup.md`に記載のmlx-lmセットアップ手順（Homebrew→pipx→mlx-lm導入、モデル選定、起動スクリプト作成）を対話式で自動化する`setup-mac-llm.sh`をプロジェクト直下に用意した。VJA本体のセットアップ用`setup-mac.sh`（Electrobun CLI署名破損対策）とは独立したスクリプトで、対象もvjaプロジェクト自体ではなく「Apple Silicon Mac上のローカルLLM実行環境」である
- **設計上のポイント**:
  - mlx-lmはpipx経由でグローバルインストールされ、モデルも`~/.cache/huggingface/`に保存されるため、vjaプロジェクトディレクトリとは独立した場所（デフォルト`~/vja-local-llm`、対話式で変更可）にセットアップする
  - Homebrewは前提条件とし、自動インストールは行わない（未導入時はエラーで案内して終了）
  - モデルは`Qwen2.5-Coder-7B-Instruct-4bit`固定（`docs/localLlm/mac-mlx-lm-setup.md`の「メモリ別おすすめモデル」のうち、実運用で安定して動くと確認済みの1択に絞った。ユーザー判断）
  - `mlx_lm server`はフォアグラウンドでターミナルを1つ占有し続けるプロセスのため、フォアグラウンド起動用（`start-llm.sh`）とバックグラウンド起動用（`start-llm-bg.sh`、ログ・PIDファイル・停止方法付き）の両方を生成する
  - 初回起動はモデルダウンロードで時間がかかるため、スクリプト自身はサーバーを自動起動しない（案内のみ行い、起動は任意のタイミングでユーザーが行う）
- ドキュメント側（`docs/localLlm/mac-mlx-lm-setup.md`）にも、冒頭にこのスクリプトの案内を追加し、手動手順は「別モデルを使いたい場合」向けとして残した
- 併せて、README.md内でリンク切れになっていた`docs/mac-mlx-lm-setup.md`/`docs/windows-foundry-local-setup.md`（実際は`docs/localLlm/`配下）を修正した
