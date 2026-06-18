# 🎨 VJA Form Designer

> **「日本語で書いたら、アプリが動く。」**
> YAML で仕様を書く → ローカル AI が JavaScript を生成 → デスクトップアプリが完成。

<p align="center">
  <img src="docs/screenshot.png" alt="VJA Form Designer Screenshot" width="800"/>
</p>

---

## 💡 VJA とは？

**VJA（Visual JavaScript for AI）** は、VB6 や Excel マクロの現代的な後継として設計された、デスクトップ GUI アプリ開発ツールです。

### ノーコードではありません。でも、あなたにも作れます。

「AIがあればノーコードで誰でもアプリが作れる」というのは神話（正しくは数万行規模のプロジェクトは困難）です。  
しかし **VBA 経験者・元エンジニア・IT 好きな社内 SE** なら、VJA で普通にアプリが作れます。

その理由は設計にあります。

- **YAML で仕様を書く** — 自然言語(yaml)により構造化されているので、誰が書いても一定の品質になる
- **AI が JavaScript を生成する** — 1 イベント = 1 回の LLM 呼び出し = 短いコード。ローカル LLM でも十分
- **動かして確認する** — 失敗したら AI に修正を頼む。これを繰り返すうちに、プログラムが読めるようになる（今後AIアシスタント機能を予定）

YAML は「人間とAIの共通言語」です。昔のフローチャートや COBOL の仕様書のように、**YAML が仕様書であり、AI への命令書でもある**という設計思想に基づいています。

---

## 🤖 なぜローカル LLM なのか？

Claude Code や Cursor は優秀ですが、**月 $100〜$200** のコストがかかります。  
また、数万行のコードベースを扱う複雑なタスクでは、クラウド AI でも「しくじる」ことがあります。

VJA のイベント JS は **1 イベント = 数十〜数百行** の小規模コードです。  
これはローカル LLM の得意領域であり、以下の環境で実際に動作確認済みです。

| 環境 | モデル | 生成時間 |
|------|--------|----------|
| M1 Mac 16GB | Qwen3.5 9B（mlx-lm） | キャッシュ有: 約30秒 |
| Snapdragon X（Windows） | Qwen2.5-7B（Foundry Local / NPU） | 実用速度 |
| Linux（llama.cpp） | 各種モデル | 環境依存 |

**完全ローカル = データがクラウドに出ない。月額コスト 0 円。**

---

## ✨ 主な機能

### 🎨 フォームデザイナー
- VB スタイルのドラッグ＆ドロップ UI
- 複数フォーム（画面）管理・切り替え
- リアルタイムプレビュー

### 🤖 AI コード生成
- YAML でイベント処理の指示を記述 → AI が JavaScript を生成
- ローカル LLM（llama.cpp / mlx-lm / Foundry Local）対応
- OpenAI 互換 API であればクラウド API にも対応
- 拡張ランタイムの AI 向けドキュメント自動生成

### 📦 コンパイル・配布
- ワンクリックで Electrobun ネイティブアプリを生成
- Linux / macOS / Windows 向けに配布可能
- 配布先に Bun のインストールは不要

### 🗄️ データ管理
- SQLite データベース内蔵
- テーブル定義をビジュアルエディタで管理
- マスターデータを CSV でインポート（gzip 圧縮してプロジェクトに同梱）

### 🗄️ ローカル SQLite — クラウド無料枠の「RDBMS なし問題」を解決

GAS や AWS Lambda などの無料・低価格クラウドサービスは便利ですが、**RDBMS が使えない**という制約があります。

VJA の実行環境は **Bun（Node.js 互換）** のため、SQLite3 がそのまま利用できます。

| | GAS / AWS Lambda 無料枠 | VJA |
|---|---|---|
| RDBMS | ❌ 利用不可 | ✅ SQLite3 内蔵 |
| テーブル定義 | 手動実装が必要 | ✅ ビジュアルエディタで管理 |
| マスターデータ | 手動実装が必要 | ✅ CSV インポート対応 |
| コスト | 無料〜 | ✅ 無料（ローカル実行） |

SQLite3 は「サーバー用途には向かない」一方で、**ローカルアプリ用途では圧倒的に高速かつ適切**な選択肢です。VJA のローカル実行環境と相性が抜群です。

YAML でやりたいことを書くだけで、AI が SQLite3 アクセスコードを生成します。VBA に近い感覚で、RDBMS を GUI から扱える環境が手に入ります。

```yaml
# テーブルからデータを取得して表示する
アクション:
    - users テーブルから全件取得して、listBox1 に名前一覧を表示して下さい。
正常終了: ログで「取得完了」として下さい。
```

※また、クラウドインフラと連動すれば、外部連携によりローカルを超えたアプリ作成が可能。

- AWS / GCP / Azure のクレデンシャルを安全に管理（AES-GCM 暗号化）
- `vja.getCloudInfraCredential("AWS", "s3")` で取得、AI 生成コードでもそのまま使える

### ⚙️ 拡張ランタイム
- プロジェクト固有の JavaScript ライブラリを定義
- AI がその API を理解してコード生成に活用

---

## 🛠️ ウィジェット一覧

| カテゴリ | ウィジェット |
|---------|-------------|
| 入力 | text / inputType / checkbox / radioButton |
| 表示 | label / picture / 水平線 / 垂直線 |
| 選択 | listBox / selectBox |
| レイアウト | groupBox / テーブル |
| アクション | button |

---

## 📋 動作環境

| 項目 | バージョン |
|------|-----------|
| Bun | 1.3.14 以上 |
| Electrobun | latest |
| OS | macOS / Linux / Windows |

> ⚠️ **Windows on Snapdragon X（ARM64）** の場合、Electrobun が未対応のため x86 版 Bun をインストールしてエミュレーション実行が必要です。

---

## ⚡ セットアップ

```bash
# 1. リポジトリをクローン
git clone https://github.com/maachang/vja.git
cd vja

# 2. 依存パッケージをインストール
bun install

# 3. 開発モードで起動
bun run dev
```

### 配布用ビルド

```bash
bun run build
```

### Linux での保存ダイアログ

`zenity`（GNOME）または `kdialog`（KDE）が必要です。

```bash
# GNOME 環境
sudo apt install zenity

# KDE 環境
sudo apt install kdialog
```

### windows での必要とされるインストール内容

- webview2

※これら vja 実行時に足りない場合は求められる事があります。

---

## 🤖 ローカル LLM のセットアップ

### Mac（Apple Silicon）— mlx-lm

```bash
brew install pipx
pipx ensurepath
pipx install mlx-lm
```

```bash
# 起動スクリプト例
MODEL=Qwen3.5-4B-4bit      # 8GB Mac
# MODEL=Qwen3.5-9B-4bit    # 16GB Mac
mlx_lm server --model mlx-community/${MODEL} --port 8080 --max-tokens 16384 --temp 0
```

モデル一覧: https://huggingface.co/models?search=mlx-community

### Windows 11（Copilot PC / Snapdragon X）— Foundry Local

```powershell
winget install Microsoft.FoundryLocal
foundry service set --port 8080
foundry model run qwen2.5-7b
```

### Linux / その他 — llama.cpp / Ollama

OpenAI API 互換であればどのサーバーでも接続可能です。

---

## 🤖 AI コード生成の使い方

YAML でイベントの指示を書くだけで、AI が JavaScript を生成します。

```yaml
# ボタンクリック時の処理
アクション:
    - 「YES NO」の確認ダイアログで「これでいいですか？」と表示して下さい:
        - YES: この場合「YES!!」と言うダイアログを表示して下さい。
        - NO: この場合「NO・・・」と言うダイアログを表示してください。

正常終了: ログで「終了しました」として下さい。
```

生成されたコードはそのまま実行可能。動かない場合は AI に修正を依頼できます。  
**この「作る → 動かす → 直す」サイクルを繰り返すことで、プログラムが自然に読めるようになります。**

---

## 📖 vja.* API（抜粋）

```javascript
// DB 操作
const rows = await vja.db.query('SELECT * FROM users WHERE id = ?', [id]);
await vja.db.execute('INSERT INTO users (name, age) VALUES (?, ?)', [name, age]);

// ウィジェット操作
const name = vja.widget.getValue('txtName');
vja.widget.setValue('lblResult', '処理完了');

// 画面遷移
vja.form.navigate('Form2');

// 外部 HTTP（Bun 経由 / タイムアウトなし）
const res = await vja.fetch('https://api.example.com/data');
const data = await res.json();

// クラウド認証情報
const cred = await vja.getCloudInfraCredential('AWS', 's3');
```

---

## 🏗️ アーキテクチャ

```
フォームデザイナー (WebView)
    ↕ RPC (message ベース・タイムアウトなし)
Bun.js メインプロセス
    ├── SQLite (データベース)
    ├── ファイル I/O
    ├── vja.fetch（Bun 経由の汎用 HTTP / WebKit タイムアウト回避）
    └── プロジェクト実行ウィンドウ (WebView)
            ↕ RPC
        vja-runtime.js (vja.* API)
```

> Bun 経由の `vja.fetch` を採用することで、Apple Silicon Mac の WebKit 60 秒タイムアウト問題を根本解決しています。

---

## 📁 ファイル構成

```
vja/
├── electrobun.config.ts       # Electrobun ビルド設定
├── package.json
└── src/
    ├── bun/
    │   ├── index.ts           # メインプロセス（ウィンドウ生成・RPC定義）
    │   ├── logger.ts          # ロガー
    │   ├── db-manager.ts      # SQLite 管理
    │   └── standalone-index.ts # コンパイル済みアプリのエントリポイント
    ├── mainview/
    │   ├── index.html         # フォームデザイナー本体
    │   ├── bridge.ts          # Webview RPC ブリッジ
    │   ├── project-bridge.ts  # プロジェクト実行ウィンドウ RPC
    │   ├── vja-runtime.js     # vja.* API ランタイム
    │   └── prompt-def.js      # AI プロンプト定義
    └── shared/
        └── types.ts           # Bun ↔ Webview 共有 RPC 型定義
```

---

## 📖 ドキュメント

- [ユーザーガイド](docs/user-guide.md)
- [Mac ローカル LLM セットアップ（mlx-lm）](docs/mac-mlx-lm-setup.md)
- [Windows ローカル LLM セットアップ（Foundry Local）](docs/windows-foundry-local-setup.md)

---

## 📝 ライセンス

MIT License

---

<p align="center">
  <b>VJA Form Designer</b> — 「日本語で書いたら、アプリが動く。」<br/>
  Built with ❤️ using Electrobun + Bun.js
</p>
