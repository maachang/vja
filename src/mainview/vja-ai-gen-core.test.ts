import { describe, expect, it, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("buildTablesCtxText（管理系カラムの除外）", () => {
    let build: (t: any[], ex?: boolean) => string;
    beforeAll(() => {
        const g: any = globalThis;
        g.window = g;
        const lenient = (): any => new Proxy(function () { }, { get: (_t, p) => (p === Symbol.toPrimitive ? () => "" : lenient()), apply: () => lenient(), set: () => true });
        g.document = lenient();
        g.defaultValueForType = () => "''";
        (0, eval)(readFileSync(join(import.meta.dir, "vja-ai-gen-core.js"), "utf-8"));
        build = g.buildTablesCtxText;
    });
    const tables = [{ name: "t", columns: [{ name: "id", type: "INTEGER", pk: true }, { name: "title", type: "TEXT" }, { name: "created_at", type: "TEXT", managed: true }] }];

    it("省略時は管理系も含めて全カラムを出す（イベントJS生成用）", () => {
        expect(build(tables)).toContain("created_at");
    });
    it("excludeManaged=trueなら管理系を除き、表示系は残す（画面生成用）", () => {
        const s = build(tables, true);
        expect(s).not.toContain("created_at");
        expect(s).toContain("title");
        expect(s).toContain("id");
    });
});

describe("stripTsTypeAnnotations（変数宣言の型注釈の除去）", () => {
    let strip: (c: string) => string;
    beforeAll(() => {
        const g: any = globalThis;
        g.window = g;
        const lenient = (): any => new Proxy(function () { }, { get: (_t, p) => (p === Symbol.toPrimitive ? () => "" : lenient()), apply: () => lenient(), set: () => true });
        g.document = lenient();
        g.defaultValueForType = () => "''";
        (0, eval)(readFileSync(join(import.meta.dir, "vja-ai-gen-core.js"), "utf-8"));
        strip = g.stripTsTypeAnnotations;
    });

    it("型注釈付きの宣言から型を取り除く", () => {
        expect(strip("var params: any[] = [];")).toBe("var params = [];");
        expect(strip("let sql: string = 'a';")).toBe("let sql = 'a';");
        expect(strip("const rows: Record<string, any>[] = [];")).toBe("const rows = [];");
    });
    it("名前の後ろの[]を取り除く", () => {
        expect(strip("var params[] = [];")).toBe("var params = [];");
    });
    it("初期値なしの型注釈付き宣言も直す", () => {
        expect(strip("var x: number;")).toBe("var x;");
    });
    it("通常のコード（三項演算子・オブジェクト・配列の添字）は変えない", () => {
        const src = "var a = b ? c : d;\nvar o = { k: 1 };\nvar x = arr[0];\nparams = [];";
        expect(strip(src)).toBe(src);
    });
});
