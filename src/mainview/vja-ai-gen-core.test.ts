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
