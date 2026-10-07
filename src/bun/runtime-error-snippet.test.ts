// src/bun/runtime-error-snippet.test.ts
// 実行ウィンドウへ埋め込む実行時エラー報告コード（runtime-error-snippet.ts）のテスト。
// 文字列を new Function で読み込み、行番号の補正・抜粋・種別を検証する。
import { describe, test, expect } from "bun:test";
import { RUNTIME_ERROR_SNIPPET, buildRuntimeErrorReport } from "./runtime-error-snippet";

const load = (formName = "Form1") => {
    const win: any = { _vjaFormName: formName };
    const f = new Function("window", RUNTIME_ERROR_SNIPPET + "\nreturn { loc: _vjaErrLocation, build: _vjaBuildErrReport };");
    return f(win) as { loc: (e: any) => { line: number | null; column: number | null }; build: (...a: any[]) => any };
};
const CODE = "var a = 1;\nvar b = 2;\nnull.foo;\nvar c = 3;";

describe("_vjaErrLocation", () => {
    test("JSC形式（e.line/e.column）: AsyncFunctionの先頭2行分を引く", () => {
        expect(load().loc({ line: 5, column: 5 })).toEqual({ line: 3, column: 5 });
    });
    test("V8形式（e.lineなし・stackのvja://key:行:列）", () => {
        const stack = "TypeError: x\n    at eval (vja://btn_Click:5:7)\n    at foo";
        expect(load().loc({ stack })).toEqual({ line: 3, column: 7 });
    });
    test("補正後に1行目未満ならnull（コード外＝ラッパー内で発生）", () => {
        expect(load().loc({ line: 2, column: 1 }).line).toBeNull();
    });
    test("手がかりが無ければnull", () => {
        expect(load().loc({ message: "x" })).toEqual({ line: null, column: null });
        expect(load().loc(null)).toEqual({ line: null, column: null });
    });
});

describe("_vjaBuildErrReport", () => {
    test("thrown: 基本項目・行・抜粋（エラー行に>）", () => {
        const e = { name: "TypeError", message: "null is not an object", line: 5, column: 5, stack: "s" };
        const r = load("Main").build("btn", "Click", e, "thrown", CODE);
        expect(r).toMatchObject({ kind: "thrown", formName: "Main", widgetName: "btn", eventName: "Click", name: "TypeError", line: 3, column: 5 });
        expect(r.excerpt).toContain(" >   3: null.foo;");
        expect(r.excerpt).toContain("    1: var a = 1;");
        expect(r.excerpt).toContain("    4: var c = 3;"); // エラー行の後1行までは含める（既存の_vjaErrDetailと同じ範囲）
    });
    test("抜粋の範囲: エラー行の前3行〜後1行（長いコードでも範囲を超えない）", () => {
        const long = Array.from({ length: 20 }, (_, i) => "l" + (i + 1)).join("\n");
        const r = load().build("btn", "Click", { message: "m", line: 12 }, "thrown", long); // コード10行目
        expect(r.excerpt.split("\n").map((l: string) => l.trim().replace(/^>\s*/, "").split(":")[0].trim())).toEqual(["7", "8", "9", "10", "11"]);
    });
    test("swallowed: 種別が保持される", () => {
        expect(load().build("btn", "Click", new Error("x"), "swallowed", CODE).kind).toBe("swallowed");
    });
    test("行が取れない場合は抜粋が空", () => {
        const r = load().build("btn", "Click", { message: "x" }, "thrown", CODE); // new Error()はBun上でlineを持つため使わない
        expect(r.line).toBeNull();
        expect(r.excerpt).toBe("");
    });
    test("Errorでない値がthrowされても落ちない", () => {
        const r = load().build("btn", "Click", "文字列で投げた", "thrown", CODE);
        expect(r.message).toBe("文字列で投げた");
    });
    test("stackは2000文字で切る", () => {
        const r = load().build("btn", "Click", { message: "m", stack: "x".repeat(5000) }, "thrown", CODE);
        expect(r.stack.length).toBe(2000);
    });
});

describe("buildRuntimeErrorReport（Bun側・アプリイベント用）", () => {
    test("実行ウィンドウ側の文字列JSと同じ入力なら同じ出力になる（補正2）", () => {
        const cases: any[] = [
            { message: "m", name: "TypeError", line: 5, column: 5, stack: "s" },
            { message: "m", stack: "TypeError: x\n    at eval (vja://btn_Click:5:7)" },
            { message: "m", line: 2, column: 1 },
            { message: "m" },
            "文字列で投げた",
        ];
        for (const e of cases) {
            const a = load("F").build("btn", "Click", e, "thrown", CODE);
            const b = buildRuntimeErrorReport({ formName: "F", widgetName: "btn", eventName: "Click", e, kind: "thrown", code: CODE, lineOffset: 2 });
            expect({ ...b, time: 0 }).toEqual({ ...a, time: 0 });
        }
    });
    test("Bun(JSC)で実際にAsyncFunctionを実行して、コード3行目の例外が3行目と報告される（補正3）", async () => {
        const AF = Object.getPrototypeOf(async function () { }).constructor;
        const code = "var a = 1;\nvar b = 2;\nthrow new Error('boom');\nvar c = 3;";
        let err: any;
        try { await new AF("vja", `"use strict";\n${code}`)({}); } catch (e) { err = e; }
        const r = buildRuntimeErrorReport({ widgetName: "appev", eventName: "onStart", e: err, kind: "thrown", code, lineOffset: 3 });
        expect(r).toMatchObject({ widgetName: "appev", eventName: "onStart", message: "boom", line: 3 });
        expect(r.excerpt).toContain(" >   3: throw new Error('boom');");
    });
});
