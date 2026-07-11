// src/bun/bun-utils.test.ts
// parseCsvLine / decompressGzip の純粋ロジックに対するユニットテスト。
import { describe, test, expect } from "bun:test";
import { parseCsvLine, decompressGzip } from "./bun-utils";

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
