// src/mainview/vja-mock-runtime.test.ts
// モックランタイムのズレ防止:
//   1. プロンプト（prompts/vja-*-api-*.eng.md）に載っているAPI名が、モックに全て存在する
//      （例: 2026-10-21、vja.io.toCsvがモックに無く、正しいコードがmockError扱いになっていた）
//   2. vja-mock-runtime.js と、Worker用の複製（vja-mock-check.jsの_MOCK_WORKER_RUNTIME_SRC）が、同じ名前を持つ
//      （「2か所を手動で同期」するルールが守られているかの機械的な確認。値の中身の一致までは見ない）
import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const dir = import.meta.dir;
const listNames = (obj: any, prefix = ""): string[] => {
    const out: string[] = [];
    for (const k of Object.keys(obj || {})) {
        if (k.startsWith("__")) continue; // 内部用（__calls等）
        const v = obj[k];
        const name = prefix ? prefix + "." + k : k;
        if (typeof v === "function") out.push(name);
        else if (v && typeof v === "object") out.push(...listNames(v, name));
    }
    return out;
};
const documented = (re: RegExp): Set<string> => {
    const s = new Set<string>();
    for (const f of readdirSync(join(dir, "prompts")).filter((f) => re.test(f))) {
        for (const m of readFileSync(join(dir, "prompts", f), "utf-8").matchAll(/^(?:await )?vja\.([\w.]+?):/gm)) s.add(m[1]);
    }
    return s;
};

let main: any;       // vja-mock-runtime.js
let worker: any;     // Worker用の複製
beforeAll(() => {
    (globalThis as any).window = globalThis;
    eval(readFileSync(join(dir, "vja-mock-runtime.js"), "utf-8"));
    main = (globalThis as any).VJA_MOCK_RUNTIME;

    // Worker用の複製は、vja-mock-check.jsのテンプレート文字列（_MOCK_WORKER_RUNTIME_SRC）を取り出して評価する
    const check = readFileSync(join(dir, "vja-mock-check.js"), "utf-8");
    const start = check.indexOf("const _MOCK_WORKER_RUNTIME_SRC = `") + "const _MOCK_WORKER_RUNTIME_SRC = ".length;
    const end = check.indexOf("`;\n", start) + 1;
    const src: string = (0, eval)(check.slice(start, end));
    const sandbox: any = { buildMockQueryRows: (globalThis as any).buildMockQueryRows };
    new Function("self", "buildMockQueryRows", src)(sandbox, sandbox.buildMockQueryRows);
    worker = sandbox.VJA_MOCK_RUNTIME;
});

describe("モックランタイムとドキュメント・Worker複製のズレ防止", () => {
    test("フロント: プロンプトに載っているAPIは、モックに全て存在する", () => {
        const names = new Set(listNames(main.build(false, "Click", "button", {}, [], [])));
        const missing = [...documented(/^vja-front-api-(mandatory|db|optional\..*)\.eng\.md$/)].filter((n) => !names.has(n)).sort();
        expect(missing).toEqual([]);
    });

    test("バック（アプリイベント）: プロンプトに載っているAPIは、モックに全て存在する", () => {
        const names = new Set(listNames(main.build(true, "onStart")));
        const missing = [...documented(/^vja-back-api-full\.eng\.md$/)].filter((n) => !names.has(n)).sort();
        expect(missing).toEqual([]);
    });

    test("フロント: Worker用の複製は、本体と同じ名前を持つ", () => {
        const a = listNames(main.build(false, "Click", "button", {}, [], [])).sort();
        const b = listNames(worker.build(false, "Click", "button", {}, [], [])).sort();
        expect(b).toEqual(a);
    });

    test("バック: Worker用の複製は、本体と同じ名前を持つ", () => {
        expect(listNames(worker.build(true, "onStart")).sort()).toEqual(listNames(main.build(true, "onStart")).sort());
    });
});
