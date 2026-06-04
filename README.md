# VJA Form Designer — Electrobun 版

## 概要

このプロジェクトは基本ノーコードで ClaudeCode で作成(細かな部分は手動で修正している)。

VB スタイルのフォームデザイナー(vja = visual js for AI)。Electrobun + Bun で動作するローカル GUI アプリ。

最終的には ローカルLLM や OpenAIのAPIと連携して、ソースコード生成をAIで自動生成する。

これによって「ノーエンジニア」がローカルアプリを、VBライクに作成する事を目標としている。

- 2026/06/02 時点では、AIでソースコード作成は出来ない状態.

## 動作環境

| 項目       | バージョン              |
| ---------- | ----------------------- |
| Bun        | 1.3.14 以上             |
| Electrobun | latest                  |
| OS         | macOS / Linux / Windows |

## セットアップ

まず初めに「bun.js」をインストールする。

https://bun.com/

上のURLから、OSやCPUに合わせてダウンロード.

ダウンロード後以下を実行する.

```bash
# 1. glt clone(https)
git clone https://github.com/maachang/vja.git
# または glt clone(ssh)
git clone git@github.com:maachang/vja.git

# ディレクトリ移動.
cd vja

# 2. 依存パッケージをインストール
bun install

# 3. 開発モードで起動
bun run dev

```

コンパイルして、実行ファイルを作成.

```bash
# ビルド（配布用）
bun run build
```

これにより、VB風の画面(vja)が起動することができる.

※ ただ windows for snapdragon x (ARM64 の Windows）の場合、electrobunが対応していないので、x86 用のbun.js をインストールしてエミュレーション実行で対応する必要があるので、注意が必要。

## ファイル構成

```
vja-electrobun/
├── README.md                      # このファイル
├── electrobun.config.ts           # Electrobun ビルド設定
├── package.json                   # 依存パッケージ定義
└── src/
    ├── bun/
    │   └── index.ts               # メインプロセス（ウィンドウ生成・RPC定義）
    ├── mainview/
    │   ├── bridge.ts              # Electroview RPC ブリッジ
    │   └── index.html             # フォームデザイナー本体 HTML
    └── shared/
        └── types.ts               # Bun ↔ Webview 共有 RPC 型定義
```

## RPC 設計（message ベース）

Electrobun の RPC `request` はダイアログ表示中にタイムアウトするため、
ファイル操作はすべて **`message`（タイムアウトなし）** で実装しています。

```
HTML側                        Bun側
─────────────────────────────────────────────────
bunOpenFile()   --[message]--> openFileRequest
                               ↓ Utils.openFileDialog()
bunOpenFile()   <-[message]--  openFileResult

bunSaveProject() -[message]--> saveFileRequest
                               ↓ saveFileDialog() + Bun.write()
bunSaveProject() <-[message]-- saveFileResult

bunCloseApp()   --[message]--> closeAppRequest
                               ↓ win.close()
```

`bridge.ts` 内で Promise に変換しているので、
HTML 側は `await window.bunOpenFile()` / `await window.bunSaveProject()` と
通常の非同期関数として呼び出せます。

## 主な機能

- **フォームデザイナー** — VB スタイルのドラッグ＆ドロップでウィジェット配置
- **マルチフォーム** — 複数画面をプロジェクト内で管理・切り替え
- **プロジェクト保存・読み込み** — `.vjaproj`（JSON）形式
- **HTML エクスポート** — 全フォームを1つの HTML に出力（画面遷移 JS 付き）
- **YAML イベント定義** — 各ウィジェットのイベントを YAML 形式で記述（将来の AI 連携用）

## ウィジェット一覧

button / label / text（multiline対応）/ inputType / checkbox / radioButton /
listBox / selectBox / groupBox / picture / 水平線 / 垂直線 / テーブル

## Linux 環境での保存ダイアログ

保存ダイアログに `zenity`（GNOME）または `kdialog`（KDE）を使用します。
インストールされていない場合はダイアログが開きません。

```bash
# GNOME 環境
sudo apt install zenity

# KDE 環境
sudo apt install kdialog
```
