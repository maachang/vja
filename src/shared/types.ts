// src/shared/types.ts
// Bun ↔ Webview 間の RPC 型定義

import type { RPCSchema } from "electrobun/bun";

// ── DB 関連型 ────────────────────────────────────────
export type DbRow = Record<string, string | number | boolean | null>;
export type DbResult = { changes: number; lastInsertRowid: number };

// ── テーブル定義型 ────────────────────────────────────
// vja-table-validation.js のテーブル編集UI・DB初期化(dbInit)で使うテーブル定義。
export type TableColumnDef = {
    name: string;
    type: string;
    notNull: boolean;
    pk: boolean;
    index: boolean;
    useDefault: boolean;
    default: string;
};
export type TableDef = {
    name: string;
    description?: string;
    columns: TableColumnDef[];
};

// ── ファイル関連型 ────────────────────────────────────
export type FileReadResult = {
    ok: boolean;
    content: string | null;
    error?: string;
};
export type FileWriteResult = { ok: boolean; error?: string };
export type DirListResult = { ok: boolean; entries: string[]; error?: string };
export type BoolResult = { ok: boolean; value: boolean; error?: string };

// ── アプリ関連型 ──────────────────────────────────────
export type AppInfo = {
    dataDir: string;
    dbPath: string;
    appName: string;
    version: string;
};

// ── RPC 型定義 ────────────────────────────────────────
// 【重要】1回のリクエストに対して1回の応答が返る種類のRPCは、すべて
// `requests`（electrobun組み込みのrequest/response機構）で定義する。
// `requests`は呼び出しごとに自動でIDを採番し、応答を個別に対応付け、
// maxRequestTime（BrowserView.defineRPC側で指定）でタイムアウムする。
// 以前は全RPCを`messages`（一方向・相関ID無し）で自前実装しており、
// 同種のRPCを連続で呼ぶと先の呼び出しのPromiseが後発呼び出しに上書きされ
// 永久にハングするバグがあった（`pending`が種別ごとに1スロットしか
// 持てない構造だったため）。`requests`に統一することでこの問題自体が
// 構造的に発生しなくなる。
//
// `messages`に残すのは、以下のような「1回の呼び出しに対し1回の応答が
// 返る」という関係が成り立たないもの、または応答を必要としない一方向の
// 通知のみ：
// - stopProjectRequest/stopProjectResult: 明示的な停止呼び出しの応答と、
//   プロジェクトウィンドウが×ボタン等で予期せず閉じられた際の非同期通知
//   （呼び出し無しで発生しうる）の両方を兼ねるため、request/responseの
//   1:1関係にならない。
// - fetchRequest/fetchResult, fetchAbortRequest/fetchAbortResult:
//   既にfetchIdベースの相関の仕組み（bridge-common.ts）で複数同時呼び出し
//   に対応済みのため、変更不要。
// - closeAppRequest/toggleDevToolsRequest/openFolderRequest/
//   saveUiConfigRequest/logRequest/pageLoadedRequest/appDialogRequest/
//   loadScriptRequest: 応答を必要としない一方向の通知。
export type VjaRPCType = {
    // ════════════════════════════════════════════════
    // Bun 側で実行される関数
    // ════════════════════════════════════════════════
    bun: RPCSchema<{
        requests: {
            // ── プロジェクトファイル操作 ──────────────────
            openFileRequest: {
                params: { filter: string; lastPath: string | null };
                response: { content: string | null; path: string | null };
            };
            saveFileRequest: {
                params: { content: string; defaultName: string; lastPath: string | null };
                response: { ok: boolean; path: string | null; cancelled: boolean };
            };
            // 汎用ファイル保存（マスターCSVダウンロード等）
            saveGenericFileRequest: {
                params: { content: string; defaultName: string; ext?: string };
                response: { ok: boolean; path: string | null; cancelled: boolean };
            };

            // ── DB: SELECT ───────────────────────────────
            dbQueryRequest: {
                params: { sql: string; params?: (string | number | boolean | null)[] };
                response: { ok: boolean; rows: DbRow[]; error?: string };
            };

            // ── DB: INSERT / UPDATE / DELETE ─────────────
            dbExecuteRequest: {
                params: { sql: string; params?: (string | number | boolean | null)[] };
                response: { ok: boolean; result: DbResult; error?: string };
            };

            // ── DB: トランザクション ──────────────────────
            // statements を順番に execute する
            dbTransactionRequest: {
                params: {
                    statements: {
                        sql: string;
                        params?: (string | number | boolean | null)[];
                    }[];
                };
                response: { ok: boolean; error?: string };
            };

            // ── DB: 初期化（テーブル作成） ────────────────
            dbInitRequest: {
                params: { ddlStatements: string[] }; // CREATE TABLE IF NOT EXISTS ...
                response: { ok: boolean; error?: string };
            };

            // ── ファイル: テキスト読み込み ─────────────────
            fileReadRequest: { params: { path: string }; response: FileReadResult };

            // ── ファイル: テキスト書き込み ─────────────────
            fileWriteRequest: { params: { path: string; content: string }; response: FileWriteResult };

            // ── ファイル: バイナリ読み込み ─────────────────
            fileReadBytesRequest: {
                params: { path: string };
                response: { ok: boolean; data: number[] | null; error?: string };
            };

            // ── ファイル: バイナリ書き込み ─────────────────
            fileWriteBytesRequest: {
                params: { path: string; data: number[] }; // Uint8Array → number[]
                response: FileWriteResult;
            };

            // ── ファイル: 存在確認 ────────────────────────
            fileExistsRequest: { params: { path: string }; response: BoolResult };

            // ── ファイル: 削除 ────────────────────────────
            fileDeleteRequest: { params: { path: string }; response: FileWriteResult };

            // ── ファイル: コピー ──────────────────────────
            fileCopyRequest: { params: { src: string; dest: string }; response: FileWriteResult };

            // ── ディレクトリ: 作成 ────────────────────────
            dirCreateRequest: { params: { path: string }; response: FileWriteResult };

            // ── ディレクトリ: 削除 ────────────────────────
            dirDeleteRequest: { params: { path: string }; response: FileWriteResult };

            // ── ディレクトリ: 一覧 ────────────────────────
            dirListRequest: { params: { path: string }; response: DirListResult };

            // ── ディレクトリ: 存在確認 ────────────────────
            dirExistsRequest: { params: { path: string }; response: BoolResult };

            // ── アプリ情報取得 ────────────────────────────
            appInfoRequest: { params: { _?: never }; response: { ok: boolean; info: AppInfo } };

            // ── プロジェクト実行 ──────────────────────────
            runProjectRequest: { params: { projectData: string }; response: { ok: boolean; error?: string } };

            // ── DBデータクリア ────────────────────────────
            clearProjectDbRequest: { params: { _?: never }; response: { ok: boolean; error?: string } };

            // ── DBバックアップ/リストア ────────────────────
            backupDbRequest: { params: { destPath: string }; response: { ok: boolean; error?: string } };
            restoreDbRequest: { params: { srcPath: string }; response: { ok: boolean; error?: string } };

            // ── フォーム切り替え（プロジェクト実行中） ────
            navigateFormRequest: { params: { formName: string }; response: { ok: boolean; error?: string } };

            // ── クラウドインフラ設定 ──────────────────────
            getCloudInfrasRequest: { params: { _?: never }; response: { infras: any[] } };
            saveCloudInfrasRequest: { params: { infras: any[] }; response: { ok: boolean; error?: string } };
            getDecryptedCredentialRequest: {
                params: { infraId: string; key: string };
                response: { ok: boolean; value: string };
            };

            // ── セッション取得 ────────────────────────────
            sessionGetRequest: { params: { key: string }; response: { ok: boolean; value: string | null } };

            // ── セッション設定 ────────────────────────────
            sessionSetRequest: { params: { key: string; value: string | null }; response: { ok: boolean } };

            // ── プロジェクトコンパイル ────────────────────
            compileProjectRequest: {
                params: { _?: never };
                response: { ok: boolean; error?: string; distPath?: string };
            };

            // ── バージョン情報取得 ────────────────────────
            getVersionRequest: { params: { _?: never }; response: { version: string; runMode: string } };

            // ── UI設定読み込み ────────────────────────────
            loadUiConfigRequest: {
                params: { _?: never };
                response: {
                    uiFontSize: number; uiFontFamily: string;
                    editorFontSize: number; editorFontFamily: string;
                    leftPanelW: number; rightPanelW: number;
                };
            };
        };
        messages: {
            closeAppRequest: { _?: never };

            // ── プロジェクト停止（デザイナーウィンドウから） ──
            // 明示的な呼び出しの応答と、プロジェクトウィンドウが予期せず
            // 閉じられた場合の非同期通知を兼ねるため、request/responseの
            // 1:1関係にならず、messagesのままとしている（詳細は上部コメント）。
            stopProjectRequest: { _?: never };

            pageLoadedRequest: { _?: never };

            // ── DevTools ─────────────────────────────────
            toggleDevToolsRequest: { _?: never };

            // ── ログ ──────────────────────────────────────
            logRequest: {
                level: "info" | "warn" | "error" | "debug" | "trace" | "log";
                message: string;
            };

            // ── ダイアログ ────────────────────────────────
            appDialogRequest: {
                type: "alert" | "confirm";
                message: string;
            };

            loadScriptRequest: { url: string };

            // ── フォルダを開く ────────────────────────────
            openFolderRequest: { path: string };

            // ── UI設定保存 ───────────────────────────────
            saveUiConfigRequest: { uiFontSize: number; uiFontFamily: string; editorFontSize: number; editorFontFamily: string; leftPanelW: number; rightPanelW: number };

            // ── 汎用fetch（fetchIdで独自に相関管理済み） ──
            fetchRequest: { fetchId: string; url: string; method?: string; headers?: Record<string, string>; body?: string };
            fetchAbortRequest: { fetchId: string };
        };
    }>;

    // ════════════════════════════════════════════════
    // Webview 側で実行される関数（Bun からのコールバック）
    // ════════════════════════════════════════════════
    webview: RPCSchema<{
        requests: {};
        messages: {
            // ── プロジェクト停止結果（詳細はbun.messagesのコメント参照） ──
            stopProjectResult: { ok: boolean };

            // ── ログ結果 ──────────────────────────────────
            logResult: { ok: boolean };

            // ── ダイアログ結果 ────────────────────────────
            appDialogResult: { ok: boolean; confirmed?: boolean };

            loadScriptResult: { url: string };

            // ── 汎用fetch結果 ─────────────────────────────
            fetchResult: { fetchId: string; ok: boolean; status: number; headers: Record<string, string>; body: string; error?: string };
            fetchAbortResult: { fetchId: string };
        };
    }>;
};
