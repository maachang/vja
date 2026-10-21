// src/mainview/project-bridge.test.ts
// 実行ウィンドウのvja.*（vja-runtime.js + project-bridge.ts + aws/slack/chatwork/webhook-runtime）に、
// フロント側のプロンプト（prompts/vja-front-api-*.eng.md）に載っている全API名が存在するかを確認する。
// 【背景】2026-10-21、バック側でプロンプトとモックにだけ残り実行環境に無いAPI（db.importCsv等）が見つかった
//   （project-runner.test.tsの同種のテスト）。フロント側も同じズレが無いかを機械的に確認する。
// 【AIメモ】project-bridge.tsは`electrobun/view`をトップレベルでimportし、window/documentを使うため、
//   importの前にmock.moduleとwindow/documentのスタブを用意してから動的importする（staticなimportにしない）。
//   project-bridgeはconsole.*を差し替えるので、読み込み後に元へ戻す。
import { describe, test, expect, mock } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

mock.module("electrobun/view", () => ({
    Electroview: class {
        static defineRPC() { return {}; }
        rpc = {
            send: new Proxy({}, { get: () => () => { } }),
            request: new Proxy({}, { get: () => async () => ({}) }),
        };
        constructor(_o?: any) { }
    },
}));

const _origConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
(globalThis as any).window = globalThis;
(globalThis as any).document = { querySelector: () => null, getElementById: () => null, addEventListener() { }, body: {}, head: {} };
await import("./project-bridge");
Object.assign(console, _origConsole);

// window.vja の関数を、名前空間付き（aws.s3.put のような3階層も）で列挙する
const listNames = (obj: any, prefix = ""): string[] => {
    const out: string[] = [];
    for (const k of Object.keys(obj || {})) {
        const v = obj[k];
        const name = prefix ? prefix + "." + k : k;
        if (typeof v === "function") out.push(name);
        else if (v && typeof v === "object") out.push(...listNames(v, name));
    }
    return out;
};

describe("ドキュメント(プロンプト)と実行ウィンドウのvja.*のズレ防止（フロント）", () => {
    test("プロンプトに載っているフロント側のAPIは、実行ウィンドウのvjaに全て存在する", () => {
        const dir = join(import.meta.dir, "prompts");
        const documented = new Set<string>();
        for (const f of readdirSync(dir).filter((f) => /^vja-front-api-(mandatory|db|optional\..*)\.eng\.md$/.test(f))) {
            for (const m of readFileSync(join(dir, f), "utf-8").matchAll(/^(?:await )?vja\.([\w.]+?):/gm)) documented.add(m[1]);
        }
        expect(documented.size).toBeGreaterThan(50);
        const actual = new Set(listNames((globalThis as any).vja));
        const missing = [...documented].filter((n) => !actual.has(n)).sort();
        expect(missing).toEqual([]);
    });
});
