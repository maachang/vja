import { describe, expect, it, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("カラム定義の管理系/表示系属性（managed）", () => {
    let defaultColumn: () => any;
    let sanitize: (cols: any[]) => any[];
    beforeAll(() => {
        const g: any = globalThis;
        g.window = g;
        const lenient = (): any => new Proxy(function () { }, { get: (_t, p) => (p === Symbol.toPrimitive ? () => "" : lenient()), apply: () => lenient(), set: () => true });
        g.document = lenient();
        g.SQLITE_TYPES = ["TEXT", "INTEGER", "REAL", "BLOB", "NULL"];
        (0, eval)(readFileSync(join(import.meta.dir, "vja-table-validation.js"), "utf-8"));
        defaultColumn = g.defaultColumn;
        sanitize = g.sanitizeAiTableColumns;
    });

    it("新規カラムの既定は表示系（managed=false）", () => {
        expect(defaultColumn().managed).toBe(false);
    });
    it("AI生成カラムは表示系になり、managedが無くても落ちない", () => {
        const r = sanitize([{ name: "id", type: "INTEGER", pk: true }, { name: "created_at", type: "TEXT", managed: true }]);
        expect(r.map((c) => c.managed)).toEqual([false, false]);
    });
});
