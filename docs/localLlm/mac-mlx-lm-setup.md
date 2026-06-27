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

| メモリ     | おすすめモデル       |
|------------|----------------------|
| 8GB(4GB)   | `Qwen2.5-Coder-7B-Instruct-4bit` |
| 16GB(10GB) | `gemma-4-e4b-it-OptiQ-4bit` |

※(XGB) この中が実質ローカルLLMで利用可能なメモリサイズです。

最新のものを中心に利用していたが、少し難解なYAML命令になると、Qwen3.5系だと、300秒を超えてタイムアウトになってしまう問題が発生する。

色々調べた所、昨今のモデルは「非常に優秀な推論モード」で動くが、これが「M1Macだと、逆に重すぎて使い物にならない」結果となってしまっている。

その理由が「 vja の systemPromptが現在 約12KB で userPrompt が 1KB を超えるので、これらを「推論モードONの場合、多くの時間を費やす」ことで、このような結果となってしまう。

なので「逆転の発想」で「これら強力な推論モードが無い時代の Qwen2.5 のコーディング用モデル: Qwen2.5-Coder-7B-Instruct-4bit」これを使うことで「SystemPromptキャッシュ化」された状態だと、大体２０秒程度で、ソースコードが作成され、大体の場合は問題なく動作する結果を確認している。

あと「それ以外に推論モードがONでも、実用化が出来るモデル: gemma-4-e4b-it-OptiQ-4bit」があり、メモリに余裕があるなら、どちらかを利用すれば良さそうだ。

---

## 4. サーバーを起動する

以下のシェルスクリプトを作成しておくと、毎回コマンドを打たずに済みます。

### 起動スクリプト例（`start-llm.sh`）

```sh
#!/bin/bash
MODEL=Qwen2.5-Coder-7B-Instruct-4bit
MAX_TOKEN=16384
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
- **モデル名**: 起動時に指定したモデル名（例: `Qwen2.5-Coder-7B-Instruct-4bit`）
    - ※ルーターモードONで、既にダウンロード済みのモデルを選択可能になる。
    - ただルーターモードONでモデルを切り替えると、環境によっては「うまく動かない」場合もあるので「ルーターモードをOFF」にして、ロード済みのモデルを使う方が良い選択(所有M1Mac=16GBでは、モデル切替で動いてるモデルが、タイムアウトになる問題が多発してるため）。
- **APIキー**: 不要（空欄のまま）

---

## 注意事項

- 初回起動時はモデルのダウンロードが行われるため、時間がかかる（モデルサイズにより数GB）
- モデルはHugging Faceからダウンロードされ、`~/.cache/huggingface/` に保存される
- mlx-lm はOpenAI API互換のため、VJAからそのまま接続できるが、ルーターモードはOFF設定で
