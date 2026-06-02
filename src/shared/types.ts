// src/shared/types.ts
// Bun ↔ Webview 間の RPC 型定義

import type { RPCSchema } from "electrobun/bun";

export type VjaRPCType = {
    // ── Bun 側で実行される関数 ──
    bun: RPCSchema<{
        requests: {};
        messages: {
            // fire-and-forget: ダイアログはタイムアウトなし
            // 結果は Bun → Webview の request で返す
            openFileRequest: { filter: string; lastPath: string | null };
            saveFileRequest: {
                content: string;
                defaultName: string;
                lastPath: string | null;
            };
            closeAppRequest: { _?: never };
        };
    }>;

    // ── Webview 側で実行される関数（Bun から結果をコールバック）──
    webview: RPCSchema<{
        requests: {};
        messages: {
            // Bun → Webview へのコールバック結果
            openFileResult: { content: string | null; path: string | null };
            saveFileResult: {
                ok: boolean;
                path: string | null;
                cancelled: boolean;
            };
        };
    }>;
};
