import { describe, expect, it, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("arrangeAiFormItems", () => {
    let arrange: (items: any[], w: number, h: number) => any[];
    beforeAll(() => {
        (globalThis as any).window = globalThis;
        eval(readFileSync(join(import.meta.dir, "vja-form-layout-fix.js"), "utf-8"));
        arrange = (globalThis as any).arrangeAiFormItems;
    });

    const btn = (name: string, x: number, y = 400) => ({ tag: "button", name, x, y, w: 85, h: 28 });

    it("同じ行の複数ボタンを右端から10px間隔で詰め直す", () => {
        const r = arrange([btn("a", 20), btn("b", 30), btn("c", 40)], 768, 600);
        expect(r.map((b) => b.x)).toEqual([768 - 20 - 85 * 3 - 20, 768 - 20 - 85 * 2 - 10, 768 - 20 - 85]);
    });

    it("単独ボタンは動かさない", () => {
        expect(arrange([btn("a", 100)], 768, 600)[0].x).toBe(100);
    });

    it("幅が足りない場合はボタン幅を縮め、左端が余白を割らない", () => {
        const r = arrange([btn("a", 0), btn("b", 0), btn("c", 0)], 200, 600);
        expect(r[0].x).toBeGreaterThanOrEqual(20);
        expect(r[2].x + r[2].w).toBe(180);
    });

    it("重なったウィジェットを下へずらす", () => {
        const a = { tag: "inputtype", name: "a", x: 20, y: 20, w: 100, h: 28 };
        const b = { tag: "inputtype", name: "b", x: 20, y: 30, w: 100, h: 28 };
        const r = arrange([a, b], 768, 600);
        expect(r[0].y).toBe(20);
        expect(r[1].y).toBe(48);
    });

    it("ずらすとフォームから出る場合は動かさない", () => {
        const a = { tag: "inputtype", name: "a", x: 20, y: 20, w: 100, h: 28 };
        const b = { tag: "inputtype", name: "b", x: 20, y: 30, w: 100, h: 28 };
        expect(arrange([a, b], 768, 60)[1].y).toBe(30);
    });

    it("datagridは動かさず、他が避ける", () => {
        const b = { tag: "inputtype", name: "b", x: 20, y: 60, w: 100, h: 28 };
        const g = { tag: "datagrid", name: "g", x: 20, y: 50, w: 700, h: 100 };
        const r = arrange([b, g], 768, 600);
        expect(r[1].y).toBe(50);
        expect(r[0].y).toBe(150);
    });

    it("ラベル+入力のペアは同じ行なら垂直中央揃えされ、ずれる時は一緒に動く", () => {
        const l = { tag: "label", name: "l", x: 20, y: 20, w: 90, h: 24 };
        const i = { tag: "inputtype", name: "i", x: 115, y: 16, w: 160, h: 28 };
        const r = arrange([l, i], 768, 600);
        expect(r[0].y).toBe(18);
        const blocker = { tag: "datagrid", name: "g", x: 0, y: 0, w: 768, h: 40 };
        const r2 = arrange([l, i, blocker], 768, 600);
        expect(r2[1].y - r2[0].y).toBe(-2); // 相対位置が保たれる
        expect(r2[1].y).toBeGreaterThanOrEqual(40);
    });

    it("数値でない要素は触らず、入力配列は破壊しない", () => {
        const bad = { tag: "button", name: "x", x: "abc" };
        const src = [bad, btn("a", 1), btn("b", 2)];
        const r = arrange(src, 768, 600);
        expect(r[0].x).toBe("abc");
        expect(src[1].x).toBe(1);
    });
});
