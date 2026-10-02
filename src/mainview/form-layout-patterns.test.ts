import { describe, expect, it, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("buildLayoutRegionsPromptText（行ごとの領域）", () => {
    let build: (id: string, w: number, h: number, n?: number) => string;
    beforeAll(() => {
        (globalThis as any).window = globalThis;
        eval(readFileSync(join(import.meta.dir, "form-layout-patterns.js"), "utf-8"));
        build = (globalThis as any).buildLayoutRegionsPromptText;
    });

    const rowLines = (t: string) => t.split("\n").filter((l) => /^ {2}row\d+:/.test(l));
    // "y=a-b" の組を取り出す
    const ys = (l: string) => l.match(/y=(\d+)-(\d+)/)!.slice(1).map(Number);
    const btnY = (t: string) => t.split("\n").find((l) => l.startsWith("- button-role"))!.match(/y=(\d+)-(\d+)/)!.slice(1).map(Number);

    it("項目数が3以下・未指定ならパターン本来の3行", () => {
        expect(rowLines(build("stackedInputBottomButtons", 800, 600)).length).toBe(3);
        expect(rowLines(build("stackedInputBottomButtons", 800, 600, 2)).length).toBe(3);
        expect(rowLines(build("stackedInputBottomButtons", 800, 600, 0)).length).toBe(3);
    });

    it("行はx/yが重ならず、1行に1組（labelとinputのx範囲）", () => {
        const rows = rowLines(build("stackedInputBottomButtons", 800, 600, 3));
        expect(rows[0]).toContain("label x=16-176, input x=192-784");
        expect(ys(rows[0])).toEqual([24, 84]);
        expect(ys(rows[1])).toEqual([96, 156]);
    });

    it("項目数が多い場合は行を延長し、ボタンが最終行より下へ押し下げられる", () => {
        const t = build("stackedInputBottomButtons", 800, 1000, 4);
        const rows = rowLines(t);
        expect(rows.length).toBe(4);
        expect(btnY(t)[0]).toBeGreaterThan(ys(rows[3])[1]);
    });

    it("はみ出す場合は行間を詰め、ボタン下端が下限(96%)に収まる", () => {
        const t = build("stackedInputBottomButtons", 800, 1000, 6);
        const rows = rowLines(t);
        expect(rows.length).toBe(6);
        expect(btnY(t)[1]).toBeLessThanOrEqual(960);
        for (let i = 1; i < rows.length; i++) expect(ys(rows[i])[0]).toBeGreaterThanOrEqual(ys(rows[i - 1])[1]);
    });

    it("行を持たないパターンは行指定を出さない", () => {
        const t = build("leftInputRightDisplay", 800, 600, 5);
        expect(rowLines(t).length).toBe(0);
        expect(t).toContain("input-role widgets");
    });
    const slotRows = (t: string, role: string) => t.split("\n").filter((l) => new RegExp("^ {2}" + role + "-row\\d+:").test(l));

    it("同じ役割が複数段に並ぶパターンは段ごとの領域を出す（ボタン縦4段）", () => {
        const rows = slotRows(build("stackedButtonsOnly", 640, 420), "ボタン");
        expect(rows.length).toBe(4);
        expect(rows[0]).toContain("slot x=160-480");
        expect(ys(rows[1])[0]).toBeGreaterThanOrEqual(ys(rows[0])[1]);
    });

    it("上段に横4つ+下段に全幅1つの表示は、段ごとに枠を分ける", () => {
        const rows = slotRows(build("topInputMidMultiDisplayBottomDisplay", 640, 420), "表示");
        expect(rows.length).toBe(2);
        expect(rows[0].match(/x=\d+-\d+/g)!.length).toBe(4);
        expect(rows[1].match(/x=\d+-\d+/g)!.length).toBe(1);
    });

    it("1段だけの役割・単一boxの役割は段指定を出さない", () => {
        expect(slotRows(build("topInputBottomDisplay", 640, 420), "入力").length).toBe(0);
        expect(slotRows(build("centerInputBottomButtons", 640, 420), "入力").length).toBe(0);
    });
});
