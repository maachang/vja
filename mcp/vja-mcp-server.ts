// mcp/vja-mcp-server.ts
// VJAデザイナーのテスト自動化用MCPサーバー（stdioトランスポート）。
//
// 前提: VJA_TEST_MODE=1 でvjaを起動していること
// （src/bun/index.tsのテスト用HTTPサーバーが起動している必要がある）。
// このMCPサーバー自体はvjaのプロセスとは別プロセスで動作し、
// HTTP経由でsrc/bun/index.tsのテスト用サーバーへリクエストを転送する。
//
// 起動方法（Claude Codeの.mcp.json等に登録する場合の例）:
//   { "command": "bun", "args": ["run", "mcp/vja-mcp-server.ts"] }
//
// 環境変数:
//   VJA_TEST_PORT: テスト用HTTPサーバーのポート（省略時 4570、src/bun/index.tsと合わせる）

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const TEST_PORT = Number(process.env.VJA_TEST_PORT || "4570");
const BASE_URL = `http://localhost:${TEST_PORT}`;

// vjaのテスト用HTTPサーバー（src/bun/index.ts）を叩く共通処理
const callVja = async (method: string, params: Record<string, any> = {}): Promise<any> => {
    const res = await fetch(`${BASE_URL}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
    });
    return res.json();
};

const toToolResult = (result: any) => ({
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
});

const server = new McpServer({ name: "vja-test", version: "0.1.0" });

// ── 画面関連 ──────────────────────────────────────────
server.registerTool(
    "vja_add_widget",
    {
        description: "VJAデザイナーの現在フォームにウィジェットを配置する（画面関連の動作確認用）",
        inputSchema: {
            tag: z.string().describe("ウィジェットタグ（例: button, label, inputtype等）"),
            x: z.number(),
            y: z.number(),
            w: z.number(),
            h: z.number(),
        },
    },
    async (args) => toToolResult(await callVja("testAddWidget", args)),
);

server.registerTool(
    "vja_delete_widget",
    {
        description: "VJAデザイナーの現在フォームから指定idのウィジェットを削除する（削除時のデータ整合性確認用）",
        inputSchema: { id: z.number().describe("削除対象ウィジェットのid") },
    },
    async (args) => toToolResult(await callVja("testDeleteWidget", args)),
);

server.registerTool(
    "vja_get_widgets",
    {
        description: "VJAデザイナーの現在フォームに配置されている全ウィジェットのデータを取得する",
        inputSchema: {},
    },
    async () => toToolResult(await callVja("testGetWidgets", {})),
);

// ── YAML関連 ──────────────────────────────────────────
server.registerTool(
    "vja_save_yaml",
    {
        description: "指定ウィジェット・イベントにYAML定義を保存する（YAMLエディタでの保存動作の代替）",
        inputSchema: {
            wid: z.number().describe("対象ウィジェットのid"),
            evName: z.string().describe("イベント名（例: onClick等）"),
            yaml: z.string().describe("保存するYAML本文"),
        },
    },
    async (args) => toToolResult(await callVja("testSaveYaml", args)),
);

server.registerTool(
    "vja_delete_yaml",
    {
        description: "指定ウィジェット・イベントのYAML定義を削除する（確認ダイアログ無しで即削除。オーバーライドpurgeの動作確認用）",
        inputSchema: {
            wid: z.number().describe("対象ウィジェットのid"),
            evName: z.string().describe("イベント名"),
        },
    },
    async (args) => toToolResult(await callVja("testDeleteYaml", args)),
);

server.registerTool(
    "vja_get_overrides",
    {
        description: "指定ウィジェット・イベントに紐づくオーバーライド（モック値・API/テーブル選択・検証定義等6種）の残存状況を取得する（削除時のpurge漏れ検知用）",
        inputSchema: {
            wid: z.number().describe("対象ウィジェットのid"),
            evName: z.string().describe("イベント名"),
        },
    },
    async (args) => toToolResult(await callVja("testGetOverrides", args)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
