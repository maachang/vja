// src/shared/types.ts
// Bun ↔ Webview 間の RPC 型定義

import type { RPCSchema } from "electrobun/bun";

// ── DB 関連型 ────────────────────────────────────────
export type DbRow = Record<string, string | number | boolean | null>;
export type DbResult = { changes: number; lastInsertRowid: number };

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
export type VjaRPCType = {
    // ════════════════════════════════════════════════
    // Bun 側で実行される関数
    // ════════════════════════════════════════════════
    bun: RPCSchema<{
        requests: {};
        messages: {
            // ── プロジェクトファイル操作 ──────────────────
            openFileRequest: { filter: string; lastPath: string | null };
            saveFileRequest: {
                content: string;
                defaultName: string;
                lastPath: string | null;
            };
            // 汎用ファイル保存（マスターCSVダウンロード等）
            saveGenericFileRequest: {
                content: string;
                defaultName: string;
                ext?: string;
            };
            closeAppRequest: { _?: never };

            // ── DB: SELECT ───────────────────────────────
            // result: DbRow[] を dbQueryResult で返す
            dbQueryRequest: {
                sql: string;
                params?: (string | number | boolean | null)[];
            };

            // ── DB: INSERT / UPDATE / DELETE ─────────────
            dbExecuteRequest: {
                sql: string;
                params?: (string | number | boolean | null)[];
            };

            // ── DB: トランザクション ──────────────────────
            // statements を順番に execute する
            dbTransactionRequest: {
                statements: {
                    sql: string;
                    params?: (string | number | boolean | null)[];
                }[];
            };

            // ── DB: 初期化（テーブル作成） ────────────────
            dbInitRequest: {
                ddlStatements: string[]; // CREATE TABLE IF NOT EXISTS ...
            };

            // ── ファイル: テキスト読み込み ─────────────────
            fileReadRequest: { path: string };

            // ── ファイル: テキスト書き込み ─────────────────
            fileWriteRequest: { path: string; content: string };

            // ── ファイル: バイナリ読み込み ─────────────────
            fileReadBytesRequest: { path: string };

            // ── ファイル: バイナリ書き込み ─────────────────
            fileWriteBytesRequest: { path: string; data: number[] }; // Uint8Array → number[]

            // ── ファイル: 存在確認 ────────────────────────
            fileExistsRequest: { path: string };

            // ── ファイル: 削除 ────────────────────────────
            fileDeleteRequest: { path: string };

            // ── ファイル: コピー ──────────────────────────
            fileCopyRequest: { src: string; dest: string };

            // ── ディレクトリ: 作成 ────────────────────────
            dirCreateRequest: { path: string };

            // ── ディレクトリ: 削除 ────────────────────────
            dirDeleteRequest: { path: string };

            // ── ディレクトリ: 一覧 ────────────────────────
            dirListRequest: { path: string };

            // ── ディレクトリ: 存在確認 ────────────────────
            dirExistsRequest: { path: string };

            // ── ログ ──────────────────────────────────────
            logRequest: {
                level: "info" | "warn" | "error" | "debug" | "trace" | "log";
                message: string;
            };

            // ── アプリ情報取得 ────────────────────────────
            appInfoRequest: { _?: never };

            // ── ダイアログ ────────────────────────────────
            appDialogRequest: {
                type: "alert" | "confirm";
                message: string;
            };

            // ── プロジェクト実行 ──────────────────────────
            runProjectRequest: { projectData: string };

            // ── プロジェクト停止 ──────────────────────────
            stopProjectRequest: { _?: never };

            // ── DBデータクリア ────────────────────────────
            clearProjectDbRequest: { _?: never };

            // ── フォーム切り替え（プロジェクト実行中） ────
            navigateFormRequest: { formName: string };
            pageLoadedRequest: { _?: never };

            // ── DevTools ─────────────────────────────────
            toggleDevToolsRequest: { _?: never };

            // ── クラウドインフラ設定 ──────────────────────
            getCloudInfrasRequest: { _?: never };
            saveCloudInfrasRequest: { infras: any[] };
            getDecryptedCredentialRequest: { infraId: string; key: string };
            loadScriptRequest: { url: string };

            // ── セッション取得 ────────────────────────────
            sessionGetRequest: { key: string };

            // ── セッション設定 ────────────────────────────
            sessionSetRequest: { key: string; value: string | null };

            // ── プロジェクトコンパイル ────────────────────
            compileProjectRequest: { _?: never };

            // ── フォルダを開く ────────────────────────────
            openFolderRequest: { path: string };

            // ── バージョン情報取得 ────────────────────────
            getVersionRequest: { _?: never };

            // ── UI設定 ───────────────────────────────────
            saveUiConfigRequest: { uiFontSize: number; uiFontFamily: string; editorFontSize: number; editorFontFamily: string; leftPanelW: number; rightPanelW: number };
            loadUiConfigRequest: { _?: never };

            // ── 汎用fetch ─────────────────────────────────
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
            // ── プロジェクトファイル操作結果 ──────────────
            openFileResult: { content: string | null; path: string | null };
            saveFileResult: {
                ok: boolean;
                path: string | null;
                cancelled: boolean;
            };
            saveGenericFileResult: {
                ok: boolean;
                path: string | null;
                cancelled: boolean;
            };

            // ── DB 結果 ───────────────────────────────────
            dbQueryResult: { ok: boolean; rows: DbRow[]; error?: string };
            dbExecuteResult: { ok: boolean; result: DbResult; error?: string };
            dbTransactionResult: { ok: boolean; error?: string };
            dbInitResult: { ok: boolean; error?: string };

            // ── ファイル結果 ──────────────────────────────
            fileReadResult: FileReadResult;
            fileWriteResult: FileWriteResult;
            fileReadBytesResult: {
                ok: boolean;
                data: number[] | null;
                error?: string;
            };
            fileWriteBytesResult: FileWriteResult;
            fileExistsResult: BoolResult;
            fileDeleteResult: FileWriteResult;
            fileCopyResult: FileWriteResult;

            // ── ディレクトリ結果 ──────────────────────────
            dirCreateResult: FileWriteResult;
            dirDeleteResult: FileWriteResult;
            dirListResult: DirListResult;
            dirExistsResult: BoolResult;

            // ── ログ結果 ──────────────────────────────────
            logResult: { ok: boolean };

            // ── アプリ情報結果 ────────────────────────────
            appInfoResult: { ok: boolean; info: AppInfo };

            // ── ダイアログ結果 ────────────────────────────
            appDialogResult: { ok: boolean; confirmed?: boolean };

            // ── プロジェクト実行結果 ──────────────────────
            runProjectResult: { ok: boolean; error?: string };

            // ── プロジェクト停止結果 ──────────────────────
            stopProjectResult: { ok: boolean };

            // ── DBデータクリア結果 ────────────────────────
            clearProjectDbResult: { ok: boolean; error?: string };

            // ── フォーム切り替え結果 ──────────────────────
            navigateFormResult: { ok: boolean; error?: string };

            // ── クラウドインフラ設定結果 ──────────────────
            getCloudInfrasResult: { infras: any[] };
            saveCloudInfrasResult: { ok: boolean; error?: string };
            getDecryptedCredentialResult: { ok: boolean; value: string };
            loadScriptResult: { url: string };

            // ── セッション取得結果 ────────────────────────
            sessionGetResult: { ok: boolean; value: string | null };

            // ── セッション設定結果 ────────────────────────
            sessionSetResult: { ok: boolean };

            // ── プロジェクトコンパイル結果 ────────────────
            compileProjectResult: { ok: boolean; error?: string; distPath?: string };

            // ── バージョン情報結果 ────────────────────────
            getVersionResult: { version: string; runMode: string };

            // ── UI設定結果 ───────────────────────────────
            loadUiConfigResult: { uiFontSize: number; uiFontFamily: string; editorFontSize: number; editorFontFamily: string; leftPanelW: number; rightPanelW: number };

            // ── 汎用fetch結果 ─────────────────────────────
            fetchResult: { fetchId: string; ok: boolean; status: number; headers: Record<string, string>; body: string; error?: string };
            fetchAbortResult: { fetchId: string };
        };
    }>;
};
