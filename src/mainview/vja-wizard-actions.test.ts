import { describe, expect, it, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("ensureWizardFormActions（ウィザード生成画面の必須ボタン補完）", () => {
    let ensure: (y: string, kind: string, titles?: string[]) => string;
    beforeAll(() => {
        (globalThis as any).window = globalThis;
        eval(readFileSync(join(import.meta.dir, "vja-wizard-actions.js"), "utf-8"));
        ensure = (globalThis as any).ensureWizardFormActions;
    });
    // 「アクション項目:」の項目名一覧
    const acts = (y: string) => {
        const m = y.match(/アクション項目:\n((?:  - .*\n?)*)/);
        return m ? m[1].split("\n").filter(Boolean).map((l) => l.replace(/^  - /, "")) : [];
    };

    const inputYaml = "説明: 商品登録\n\n入力項目:\n  - 商品名: inputtype text\n\n参照テーブル:\n  - items\n\nアクション項目:\n  - 戻る";
    const listYaml = "説明: 一覧\n\n入力項目:\n  - 商品一覧: datagrid\n  - 商品名: inputtype text\n\n参照テーブル:\n  - items\n\nアクション項目:\n  - 新規登録";

    it("入力画面: 登録が無ければ戻るの前へ足す", () => {
        expect(acts(ensure(inputYaml, "input"))).toEqual(["登録", "戻る"]);
    });
    it("入力画面: 保存があれば登録は足さない / 戻るが無ければ足す", () => {
        expect(acts(ensure("入力項目:\n  - a: inputtype text\n\nアクション項目:\n  - 保存", "input"))).toEqual(["保存", "戻る"]);
    });
    it("入力画面: アクション項目が無ければセクションごと新設する", () => {
        const out = ensure("入力項目:\n  - a: inputtype text\n\n参照テーブル:\n  - t", "input");
        expect(acts(out)).toEqual(["登録", "戻る"]);
        expect(out).toContain("参照テーブル:\n  - t");
    });
    it("一覧画面: datagrid以外の入力項目があれば検索を先頭へ足す", () => {
        expect(acts(ensure(listYaml, "list"))).toEqual(["検索", "新規登録"]);
    });
    it("一覧画面: datagridだけなら検索は足さない", () => {
        const y = "入力項目:\n  - 一覧: datagrid\n\nアクション項目:\n  - 新規登録";
        expect(acts(ensure(y, "list"))).toEqual(["新規登録"]);
    });
    it("一覧画面: 検索・新規登録が既にあれば変更しない", () => {
        const y = listYaml.replace("  - 新規登録", "  - 検索ボタン\n  - 新規登録ボタン");
        expect(ensure(y, "list")).toBe(y);
    });
    it("メニュー: 一覧ごとの遷移ボタンが無ければ足す（「一覧」は除く）", () => {
        const y = "説明: メニュー\n\nアクション項目:\n  - 日次入力\n  - 品目マスター\n  - 終了";
        const out = ensure(y, "menu", ["日次入力一覧", "入力履歴一覧", "品目マスター一覧"]);
        expect(acts(out)).toEqual(["日次入力", "品目マスター", "終了", "入力履歴"]);
    });
    it("メニュー: 全て揃っていれば変更しない", () => {
        const y = "アクション項目:\n  - 日次入力\n  - 品目マスター";
        expect(ensure(y, "menu", ["日次入力一覧", "品目マスター一覧"])).toBe(y);
    });
    it("kind不明・未指定は何もしない", () => {
        expect(ensure(inputYaml, "")).toBe(inputYaml);
        expect(ensure(inputYaml, "other")).toBe(inputYaml);
    });
});
