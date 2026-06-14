# 🎨 VJA Form Designer

> **ノーエンジニアでも、ローカルGUIアプリが作れる。**
> VB スタイルのフォームデザイナー × ローカル AI コード生成。

<p align="center">
  <img src="docs/screenshot.png" alt="VJA Form Designer Screenshot" width="800"/>
</p>

---

## ✨ VJA とは？

**VJA（Visual JavaScript for AI）** は、VB6 や Excel マクロの現代的な後継として設計された、デスクトップ GUI アプリ開発ツールです。

- 🖱️ **ドラッグ＆ドロップ** でウィジェットを配置するだけ
- 🤖 **ローカル LLM / OpenAI API** と連携し、イベント処理コードを AI が自動生成
- 🏗️ **コンパイルして配布** — ユーザーの環境に Bun すら不要な単体アプリを生成
- 🗄️ **SQLite 内蔵** — データベース操作も YAML で指示するだけ

エンジニアでなくても、業務アプリが作れる時代へ。

---

## 🚀 主な機能

### 🎨 フォームデザイナー
- VB スタイルのドラッグ＆ドロップ UI
- 複数フォーム（画面）管理・切り替え
- リアルタイムプレビュー

### 🤖 AI コード生成
- YAML でイベント処理の指示を記述 → AI が JavaScript を生成
- ローカル LLM（llama.cpp）対応 — データがクラウドに出ない
- OpenAI 互換 API にも対応
- 拡張ランタイムの AI 向けドキュメント自動生成

### 📦 コンパイル・配布
- ワンクリックで Electrobun ネイティブアプリを生成
- Linux / macOS / Windows 向けインストーラーを出力
- 配布先に Bun のインストールは不要

### 🗄️ データ管理
- SQLite データベース内蔵
- テーブル定義をビジュアルエディタで管理
- マスターデータを CSV でインポート（gzip 圧縮してプロジェクトに同梱）
- テーブルが空の場合に自動 INSERT

### ☁️ クラウドインフラ連携
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

生成されたコードはそのまま実行可能・また修正対応など微調整も可能です。

---

## 📖 vja.* API（抜粋）

```javascript
// DB 操作
const result = await vja.db.query('SELECT * FROM users WHERE id = ?', [id]);
await vja.db.execute('INSERT INTO users (name, age) VALUES (?, ?)', [name, age]);

// ウィジェット操作
const name = vja.widget.getValue('txtName');
vja.widget.setValue('lblResult', '処理完了');

// 画面遷移
vja.form.navigate('Form2');

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
    └── プロジェクト実行ウィンドウ (WebView)
            ↕ RPC
        vja-runtime.js (vja.* API)
```

Electrobun の RPC は `request` がダイアログ表示中にタイムアウトするため、
ファイル操作はすべて **`message`（タイムアウトなし）** で実装しています。

---

## ユーザガイド

- [ユーザガイド](docs/user-guide.md)

この内容を理解することで、vjaの世界へようこそとなるでしょう。

## 📝 ライセンス

MIT License

---

<p align="center">
  <b>VJA Form Designer</b> — ノーエンジニアのためのローカル GUI アプリ開発環境<br/>
  Built with ❤️ using Electrobun + Bun.js + Claude Code
</p>
