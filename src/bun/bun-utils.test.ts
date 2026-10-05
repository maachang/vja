// src/bun/bun-utils.test.ts
// parseCsvLine / decompressGzip の純粋ロジックに対するユニットテスト。
import { describe, test, expect } from "bun:test";
import { parseCsvLine, decompressGzip, execFetch } from "./bun-utils";

describe("parseCsvLine", () => {
    test("単純なカンマ区切り", () => {
        expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
    });

    test("ダブルクォートで囲まれたカンマを1フィールドとして扱う", () => {
        expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
    });

    test('""はダブルクォートのエスケープとして1文字の"になる', () => {
        expect(parseCsvLine('a,"say ""hi""",c')).toEqual(["a", 'say "hi"', "c"]);
    });

    test("空文字列は1件の空フィールドとして扱う", () => {
        expect(parseCsvLine("")).toEqual([""]);
    });

    test("末尾がカンマの場合、末尾に空フィールドが付く", () => {
        expect(parseCsvLine("a,b,")).toEqual(["a", "b", ""]);
    });
});

describe("decompressGzip", () => {
    test("gzip圧縮したテキストをbase64経由で正しく復元できる", async () => {
        const original = "こんにちは、VJA！";
        const cs = new CompressionStream("gzip");
        const writer = cs.writable.getWriter();
        writer.write(new TextEncoder().encode(original));
        writer.close();
        const chunks: Uint8Array[] = [];
        const reader = cs.readable.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
        const total = chunks.reduce((s, c) => s + c.length, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) { merged.set(c, offset); offset += c.length; }
        const b64 = btoa(String.fromCharCode(...merged));

        expect(await decompressGzip(b64)).toBe(original);
    });
});

describe("execFetch", () => {
    // 受け取ったリクエストの内容(メソッド・ヘッダー・本文)をそのまま返すローカルサーバー
    const startServer = () => Bun.serve({
        port: 0,
        async fetch(req) {
            const url = new URL(req.url);
            if (url.pathname === "/bin") {
                // 全バイト値を含むバイナリ(UTF-8として不正な並びを含む)を返す
                return new Response(new Uint8Array(256).map((_, i) => i), { headers: { "content-type": "application/octet-stream" } });
            }
            if (url.pathname === "/echo") {
                const buf = new Uint8Array(await req.arrayBuffer());
                return new Response(buf, { headers: { "x-method": req.method, "x-custom": req.headers.get("x-custom") || "" } });
            }
            return new Response("テキスト応答", { status: 201 });
        },
    });

    test("既定(text): 本文を文字列で返す", async () => {
        const server = startServer();
        try {
            const r = await execFetch({ url: `http://localhost:${server.port}/` });
            expect(r.status).toBe(201);
            expect(r.ok).toBe(true);
            expect(r.body).toBe("テキスト応答");
            expect(r.bodyBase64).toBeUndefined();
        } finally { server.stop(true); }
    });

    test("responseType:binary: バイナリがbase64で壊れずに返る", async () => {
        const server = startServer();
        try {
            const r = await execFetch({ url: `http://localhost:${server.port}/bin`, responseType: "binary" });
            const bytes = Buffer.from(r.bodyBase64 as string, "base64");
            expect(Array.from(bytes)).toEqual(Array.from(new Uint8Array(256).map((_, i) => i)));
            expect(r.body).toBe("");
        } finally { server.stop(true); }
    });

    test("bodyBase64: バイナリ本文がそのまま送られる(ヘッダー・メソッドも)", async () => {
        const server = startServer();
        try {
            const src = Buffer.from([0, 255, 128, 13, 10, 200]);
            const r = await execFetch({
                url: `http://localhost:${server.port}/echo`, method: "PUT",
                headers: { "x-custom": "abc" }, bodyBase64: src.toString("base64"), responseType: "binary",
            });
            expect(r.headers["x-method"]).toBe("PUT");
            expect(r.headers["x-custom"]).toBe("abc");
            expect(Buffer.from(r.bodyBase64 as string, "base64").equals(src)).toBe(true);
        } finally { server.stop(true); }
    });

    test("body(テキスト)も従来どおり送られる", async () => {
        const server = startServer();
        try {
            const r = await execFetch({ url: `http://localhost:${server.port}/echo`, method: "POST", body: "日本語" });
            expect(r.body).toBe("日本語");
        } finally { server.stop(true); }
    });

    test("AbortSignalで中断するとAbortErrorになる", async () => {
        const server = Bun.serve({ port: 0, async fetch() { await Bun.sleep(2000); return new Response("late"); } });
        try {
            const ctrl = new AbortController();
            const p = execFetch({ url: `http://localhost:${server.port}/` }, ctrl.signal);
            ctrl.abort();
            await expect(p).rejects.toMatchObject({ name: "AbortError" });
        } finally { server.stop(true); }
    });
});
