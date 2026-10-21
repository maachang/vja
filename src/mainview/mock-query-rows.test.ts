// buildMockQueryRows（vja-mock-runtime.js）のユニットテスト。
// モックのvja.db.queryが返すダミー行を、SELECT文とテーブル定義から作る。
import { describe, expect, it, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const tables = [{
    name: "test_items",
    columns: [
        { name: "id", type: "INTEGER" },
        { name: "name", type: "TEXT" },
        { name: "price", type: "REAL" },
        { name: "category", type: "TEXT" },
    ],
}];

describe("buildMockQueryRows", () => {
    let build: (sql: string, tables?: any[]) => any[];
    beforeAll(() => {
        (globalThis as any).window = globalThis;
        eval(readFileSync(join(import.meta.dir, "vja-mock-runtime.js"), "utf-8"));
        build = (globalThis as any).buildMockQueryRows;
    });

    it("COUNT(*) AS 別名 は、別名のキーに数値1が入る（A1の失敗の原因）", () => {
        const r = build("SELECT COUNT(*) AS count FROM test_items", tables);
        expect(r).toEqual([{ count: 1 }]);
        expect(r[0].count.toString()).toBe("1");
    });

    it("別名なしの集計は、式の文字列がキーになる（SQLiteの列名と同じ）", () => {
        expect(build("SELECT COUNT(*) FROM test_items", tables)).toEqual([{ "COUNT(*)": 1 }]);
    });

    it("SUM/AVG/MIN/MAX/TOTAL も1", () => {
        const r = build("SELECT SUM(price) AS s, AVG(price) AS a, MIN(id) AS mi, MAX(id) AS ma, TOTAL(price) AS t FROM test_items", tables);
        expect(r).toEqual([{ s: 1, a: 1, mi: 1, ma: 1, t: 1 }]);
    });

    it("SELECT * は、テーブル定義の型に応じた値（INTEGER=1、REAL=1.5、TEXT=\"x\"）", () => {
        expect(build("SELECT * FROM test_items WHERE id = ?", tables)).toEqual([{ id: 1, name: "x", price: 1.5, category: "x" }]);
    });

    it("列名の指定（テーブル名接頭辞・別名・DISTINCT）も型に応じる", () => {
        expect(build("SELECT DISTINCT t.category, price, name AS n FROM test_items t", tables)).toEqual([{ category: "x", price: 1.5, n: "x" }]);
    });

    it("カッコ内のカンマで選択リストを割らず、他の関数で包んだ集計も1", () => {
        expect(build("SELECT COALESCE(SUM(price), 0) AS total, id FROM test_items", tables)).toEqual([{ total: 1, id: 1 }]);
        expect(build("SELECT ROUND(AVG(price), 2) AS avg_price FROM test_items", tables)).toEqual([{ avg_price: 1 }]);
    });

    it("小文字のSQL・改行入りも読める", () => {
        expect(build("select count(*) as cnt\nfrom test_items\nwhere id > 1", tables)).toEqual([{ cnt: 1 }]);
    });

    it("テーブル定義に無い列は\"x\"、定義の無いテーブルの列名指定も\"x\"", () => {
        expect(build("SELECT nothing FROM test_items", tables)).toEqual([{ nothing: "x" }]);
        expect(build("SELECT a, b FROM unknown_table", tables)).toEqual([{ a: "x", b: "x" }]);
    });

    it("読み取れないSQL・項目を作れないSQL（定義の無いテーブルの*）は従来どおり[{}]", () => {
        expect(build("PRAGMA table_info(test_items)", tables)).toEqual([{}]);
        expect(build("SELECT * FROM unknown_table", tables)).toEqual([{}]);
        expect(build(undefined as any, tables)).toEqual([{}]);
        expect(build("SELECT 1", tables)).toEqual([{}]);
    });

    it("tablesが未指定でも落ちない", () => {
        expect(build("SELECT COUNT(*) AS c FROM t")).toEqual([{ c: 1 }]);
    });

    it("toStringで取り出した関数だけで動く（Workerへ文字列で埋め込むため。外部の変数に依存しない）", () => {
        const src = "const f = (" + build.toString() + "); return f(\"SELECT COUNT(*) AS c FROM test_items\", tables);";
        expect(new Function("tables", src)(tables)).toEqual([{ c: 1 }]);
    });
});
