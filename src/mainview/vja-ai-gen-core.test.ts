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

describe("fixByteMojibake（バイトがU+FF00+値で返る文字化けの自動復元）", () => {
    let fix: (t: string) => string;
    beforeAll(() => {
        const g: any = globalThis;
        g.window = g;
        const lenient = (): any => new Proxy(function () { }, { get: (_t, p) => (p === Symbol.toPrimitive ? () => "" : lenient()), apply: () => lenient(), set: () => true });
        g.document = lenient();
        g.defaultValueForType = () => "''";
        (0, eval)(readFileSync(join(import.meta.dir, "vja-ai-gen-core.js"), "utf-8"));
        fix = g.fixByteMojibake;
    });
    // 実機(Foundry Local 0.11.0)で出た化けの例（ASCIIはそのまま、0x80以上のバイトがU+FF00+値）
    it("実際の化けた出力を元に戻す", () => {
        expect(fix("  - ￣ﾃﾭ￣ﾃﾼ￣ﾃﾇ￣ﾂﾣ￣ﾃﾳ￣ﾂﾰ￣ﾂﾒ￨ﾡﾨ￧ﾤﾺ￣ﾁﾙ￣ﾂﾋ")).toBe("  - ローディングを表示する");
        expect(fix("  - tableView ￣ﾁﾮ￥ﾆﾅ￥ﾮﾹ￣ﾂﾒ horse_info ￣ﾃﾆ￣ﾃﾼ￣ﾃﾖ￣ﾃﾫ￣ﾁﾫ￨ﾡﾨ￧ﾤﾺ￣ﾁﾙ￣ﾂﾋ"))
            .toBe("  - tableView の内容を horse_info テーブルに表示する");
    });
    // 返答の化け方を再現する（0x80以上のバイトをU+FF00+値にする）
    const garble = (s: string) => Array.from(Buffer.from(s, "utf-8"), (b) => b < 0x80 ? String.fromCharCode(b) : String.fromCharCode(0xFF00 + b)).join("");
    it("4バイトの文字（絵文字・常用外の漢字）も戻す", () => {
        expect(fix(garble("🤖 AIで修正 ⚠ 実行エラー"))).toBe("🤖 AIで修正 ⚠ 実行エラー");
        expect(fix(garble("𠮷野家の注文"))).toBe("𠮷野家の注文");
    });
    it("全角記号・長音・通常の日本語を戻す", () => {
        const s = "ローディングを表示する。ＡＢＣ１２３ー〜「」\nlet a = 1;";
        expect(fix(garble(s))).toBe(s);
    });
    it("連続の途中が壊れていても、壊れていない部分は戻す", () => {
        // 「表示する」の先頭バイトだけ継続バイト(0x80)に置き換えて壊す
        const broken = garble("表示する").replace(/[\uFF80-\uFFFF]/, "\uFF80");
        const out = fix("A:" + broken + " 次の文を" + garble("確認"));
        expect(out.endsWith("確認")).toBe(true);
        expect(out).toContain("する");
    });
    it("化けていない日本語・ASCIIは変えない", () => {
        const s = "説明: 一覧を表示する\nlet a = 1;";
        expect(fix(s)).toBe(s);
    });
    it("半角カタカナだけの文字列は変えない", () => {
        expect(fix("ﾃﾛﾃｽﾄ ﾊﾟﾗﾒｰﾀ")).toBe("ﾃﾛﾃｽﾄ ﾊﾟﾗﾒｰﾀ");
    });
    it("UTF-8として戻せない連続はそのまま残す", () => {
        expect(fix("a￣b")).toBe("a￣b");
    });
    it("空文字・文字列以外でも例外にならない", () => {
        expect(fix("")).toBe("");
        expect(fix(undefined as any)).toBe(undefined as any);
    });
});
