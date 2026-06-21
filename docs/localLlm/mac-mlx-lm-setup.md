# Mac（Apple Silicon）でローカルLLM環境を構築する

Apple Silicon Mac（M1/M2/M3/M4）では、Appleが開発した **MLX フレームワーク**をベースにした **mlx-lm** を使うことで、NPUを活用した高速なローカルLLM実行環境を構築できます。

---

## 前提条件

- Apple Silicon Mac（M1以降）
- [Homebrew](https://brew.sh/) がインストール済みであること

---

## 1. Python を最新にする

```sh
brew install python3
brew update python3
```

---

## 2. mlx-lm をインストールする

最新のPython 3では `pip install` を直接実行しようとすると「仮想環境を作れ」というエラーになります。
これを回避するために、`pipx` 経由でインストールします。

### 2-1. pipx をインストール

```sh
brew install pipx
pipx ensurepath
```

### 2-2. mlx-lm をインストール

```sh
pipx install mlx-lm
```

インストール後は**ターミナルを再起動**してください（PATHを反映させるため）。

---

## 3. モデルを選ぶ

mlx-lm は ollama のようなモデル管理機能を持ちません。
モデルは **Hugging Face の mlx-community** から探して利用します。

- モデル一覧: https://huggingface.co/models?search=mlx-community

モデル指定は以下の形式で行います：

```
mlx-community/gemma-4-e4b-it-qat-OptiQ-4bit
```

### メモリ別おすすめモデル

| おすすめ順 | メモリ     | おすすめモデル       |
|------------|------------|----------------------|
|           1| 8GB(4GB)   | `Qwen3.5-4B-4bit系`  |
|           2| 8GB(4GB)   | `gemma-4-E2B-4bit系` |
|           1| 16GB(10GB) | `gemma-4-E4B-4bit系` |
|           2| 16GB(10GB) | `Qwen3.5-9B-4bit系`  |

※(XGB) この中が実質ローカルLLMで利用可能なメモリサイズです。

基本的に現時点(202606時点)では、`qwen3.5` か `gemma4` が コーディング生成に適しているモデルであると思います。その中で `gemma4` が vja でのコーディングと相性が良さそうです（特に `gemma-4-E4B-4bit系` だと速度的にも正確性など、問題なくコーディングができる）。

- 現時点(202606時点)のおすすめモデル
  - `mlx-community/Qwen3.5-4B-4bit` : メモリが8GB の場合
  - `mlx-community/gemma-4-e4b-it-qat-OptiQ-4bit` : メモリが16GB の場合

あと `Qwen3.5-9B-4bit` は、比較的新しいAppleシリコンだと動くと思う(M1だと、普通にfetchがタイムアウトしてしまうレベル)ので 16GB の場合 `gemma-4-E4B-4bit系` が妥当で堅実な選択であると言えます。

また vja はsystemPromptの量が１万文字ぐらいあるので、最初の実行が遅いですが、キャッシュ課されることで、高速に動作するようになります。

---

## 4. サーバーを起動する

以下のシェルスクリプトを作成しておくと、毎回コマンドを打たずに済みます。

### 起動スクリプト例（`start-llm.sh`）

```sh
#!/bin/bash
MODEL=Qwen3.5-4B-4bit
MAX_TOKEN=8192
TEMP=0

mlx_lm server \
  --model mlx-community/${MODEL} \
  --port 8080 \
  --max-tokens ${MAX_TOKEN} \
  --temp ${TEMP}
```

※上記実行は、サーバプロセス起動を待機する。

### パラメータの説明

| パラメータ | 説明 |
|------------|------|
| `--model` | 使用するモデル（mlx-community/モデル名 の形式） |
| `--port` | サーバーのポート番号（デフォルト: 8080） |
| `--max-tokens` | 生成できる最大トークン数。最小8192程度を推奨 |
| `--temp` | 生成のランダム性（0〜1）。**ソースコード生成時は 0 推奨**。0.7程度にするとランダム性が増す |

### スクリプトの実行方法

```sh
chmod +x start-llm.sh
./start-llm.sh
```

---

## 5. VJA での接続設定

サーバー起動後、VJAのAI設定で以下を入力します：

- **エンドポイント**: `http://localhost:8080`
- **モデル名**: 起動時に指定したモデル名（例: `Qwen3.5-4B-4bit`）
    - ※ルーターモードONで、既にダウンロード済みのモデルを選択可能になる。
    - ただルーターモードONでモデルを切り替えると、環境によっては「うまく動かない」場合もあるので「ルーターモードをOFF」にして、ロード済みのモデルを使う方が良い選択(所有M1Mac=16GBでは、モデル切替で動いてるモデルが、タイムアウトになる問題が多発してるため）。
- **APIキー**: 不要（空欄のまま）

---

## 注意事項

- 初回起動時はモデルのダウンロードが行われるため、時間がかかります（モデルサイズにより数GB）
- モデルはHugging Faceからダウンロードされ、`~/.cache/huggingface/` に保存されます
- mlx-lm はOpenAI API互換のため、VJAからそのまま接続できます
