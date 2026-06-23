# Windows 11（Copilot PC / Snapdragon X）でローカルLLM環境を構築する

Microsoft が提供する **Foundry Local** を使うことで、Windows 11上でNPUを活用したローカルLLM実行環境を構築できます。
OpenAI API互換のため、VJAからそのまま接続できます。

---

## 前提条件

- Windows 11
- PowerShell または Windows Terminal が使える状態であること
- NPU対応モデルを利用する場合は **Snapdragon X（Copilot PC）** を推奨

---

## 1. Foundry Local をインストールする

PowerShell から以下を実行します：

```powershell
winget install Microsoft.FoundryLocal
```

---

## 2. 利用可能なモデル一覧を確認する

```powershell
foundry model list
```

Snapdragon X 環境でのNPU対応モデル例（環境・更新状況により変わります）：

| Alias            | Device | Model ID                               |
| ---------------- | ------ | -------------------------------------- |
| qwen2.5-1.5b     | NPU    | qwen2.5-1.5b-instruct-qnn-npu:2        |
| qwen2.5-7b       | NPU    | qwen2.5-7b-instruct-qnn-npu:2          |
| phi-3-mini-128k  | NPU    | phi-3-mini-128k-instruct-qnn-npu:3     |
| phi-3.5-mini     | NPU    | phi-3.5-mini-instruct-qnn-npu:2        |
| deepseek-r1-7b   | NPU    | deepseek-r1-distill-qwen-7b-qnn-npu:2  |
| phi-3-mini-4k    | NPU    | phi-3-mini-4k-instruct-qnn-npu:3       |
| deepseek-r1-14b  | NPU    | deepseek-r1-distill-qwen-14b-qnn-npu:2 |
| qwen2.5-coder-7b | NPU    | qwen2.5-coder-7b-instruct-qnn-npu:1    |

VJAでのYAMLからJSソースコード生成には **qwen2.5-7b** が適しています。
今後 qwen系・gemma系などの新しいモデルが追加されることが予想されるため、最新状況に合わせて選択してください。

2026/06現在: qwen2.5-coder-7b-instruct-qnn-npu:1 これが追加されているので、現状利用した限りでは、これが良さそう。

それ以外に設定しておくと良さそうな定義（vja の AI設定で行う)

- max-token: 8192
    - 途中でjs生成コードが切れてしまうことがある。
- temperature: 0
    - 0 が一番正解のコードを書いてくれるので、この値にする。

---

## 3. モデルをダウンロードしておく（任意）

```powershell
foundry model run qwen2.5-7b
```

一度ダウンロードしたモデルは以降ダウンロード不要で利用できます。
事前にダウンロードだけしておきたい場合もこのコマンドを実行します。

---

## 4. ポートを固定する（推奨）

デフォルトではサービス起動のたびにポートが変わるため、固定しておくと便利です：

```powershell
foundry service set --port 8080
```

---

## 5. サーバーを起動する

2つの起動方法があります：

### 方法1: 対話モード＋サーバー同時起動

```powershell
foundry model run qwen2.5-7b
```

- ターミナルに対話モードが起動しつつ、バックグラウンドでAPIサーバーも起動する
- `Ctrl+C` で停止できる

### 方法2: バックグラウンド起動

```powershell
foundry model load qwen2.5-7b
```

- サーバーがバックグラウンドで起動する
- 停止する場合は以下を実行：

```powershell
foundry service stop
```

※ 補足として `foundry service start` の単体実行で、サーバ自身は起動するようです。この状態で「vja 側でルーターモードONで、モデル選択で実行」する事ができます（つまり別に１度 model をrun か load で取得した場合、これらは service start で利用ができる」ってことです)。

---

## 6. サーバーのURLを確認する

```powershell
foundry service status
```

出力例：

```
🟢 Model management service is running on http://127.0.0.1:8080/openai/status
EP autoregistration status: Successfully downloaded and registered the following EPs: QNNExecutionProvider.
```

ポートを固定した場合は `http://127.0.0.1:8080` で固定されます。

---

## 7. その他のサービス管理コマンド

| コマンド                          | 説明                          |
| --------------------------------- | ----------------------------- |
| `foundry service start`           | サービスを起動する            |
| `foundry service stop`            | サービスを停止する            |
| `foundry service status`          | サービスの状態・URLを確認する |
| `foundry service set --port 8080` | ポートを固定する              |

---

## 8. VJA での接続設定

サーバー起動後、VJAのAI設定で以下を入力します：

- **エンドポイント**: `http://localhost:8080`
- **モデル名**: 起動時に指定したモデルのAlias（例: `qwen2.5-7b`）
- **APIキー**: 不要（空欄のまま）

---

## 注意事項

- Foundry Local はルーターモード専用のOpenAI API互換サーバーです
- NPU実行はSnapdragon X（Copilot PC）での動作が確認されています。他のCPU/GPUでの動作は環境によります
- 初回起動時はモデルのダウンロードが行われるため、時間がかかります
