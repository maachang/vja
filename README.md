# VJA Form Designer — Electrobun 版

## 概要

このプロジェクトは基本ノーコードで ClaudeCode で作成しています。

VB スタイルのフォームデザイナー。Electrobun + Bun で動作するローカル GUI アプリ。

最終的には ローカルLLM や OpenAIのAPIと連携して、ソースコード生成をAIで実施する。

これによって「ノーエンジニアがローカルアプリを、VBライクに作成する事を目標としている。

## 動作環境

| 項目       | バージョン              |
| ---------- | ----------------------- |
| Bun        | 1.3.14 以上             |
| Electrobun | latest                  |
| OS         | macOS / Linux / Windows |

## セットアップ

```bash
# 1. 依存パッケージをインストール
bun install

# 2. 開発モードで起動
bun run dev

# 3. ビルド（配布用）
bun run build
```

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
listBox / selectBox / groupBox / picture / 水平線 / 垂直線

## Linux 環境での保存ダイアログ

保存ダイアログに `zenity`（GNOME）または `kdialog`（KDE）を使用します。
インストールされていない場合はダイアログが開きません。

```bash
# GNOME 環境
sudo apt install zenity

# KDE 環境
sudo apt install kdialog
```
