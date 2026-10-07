// 拡張ランタイム→イベントYAMLドラフト→イベントJS生成の実機(Electrobun)E2Eテスト（Claude専用）
//
// 【目的】画面なしの mcp/ext-runtime-test.ts では通らない、実アプリ側の経路（generateTextToYaml が
// getProjectData().extRuntime.doc を text-to-yaml のプロンプトへ渡す部分、YAMLエディタを開いた状態での
// イベントJS生成）を、起動中のvjaテストサーバー（HTTP:4570）経由で確認する。
//
// 【使い方】
//   1. 別ターミナルかバックグラウンドで `bun run mcp`（VJA_TEST_MODE=1でvjaが起動し、4570でテストサーバーが立つ）
//   2. bun run mcp/ext-runtime-e2e.ts [--runs N]
//   接続先LLMは mcp/fixtures/test-llm.local.json、題材は prompt-integrity-test.vjaproj.json ＋ ext-runtime/scenarios.json
//
// 【AIメモ】testSetAutoConfirmは{value}が正（{confirm}だと無音で無視されハングする）。
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const PORT = process.env.VJA_TEST_PORT || "4570";
const RUNS = Math.max(1, parseInt((process.argv.indexOf("--runs") >= 0 ? process.argv[process.argv.indexOf("--runs") + 1] : "1"), 10) || 1);
const LLM = JSON.parse(readFileSync(join(ROOT, "mcp/fixtures/test-llm.local.json"), "utf-8"));
const SC = JSON.parse(readFileSync(join(ROOT, "mcp/fixtures/ext-runtime/scenarios.json"), "utf-8"));
const base = JSON.parse(readFileSync(join(ROOT, "mcp/fixtures/prompt-integrity-test.vjaproj.json"), "utf-8"));

const call = async (m: string, p: any = {}) => {
    const r = await fetch("http://localhost:" + PORT + "/" + m, { method: "POST", body: JSON.stringify(p) });
    return await r.json() as any;
};
// 拡張ランタイムの説明YAML（固定。①の生成揺らぎをE2Eへ持ち込まない）
const DOC = SC.extFunctions.map((f: any) => "- function: " + (f.async ? "await " : "") + f.name + "(" + f.args.join(", ") + ")\n  description: \"" + f.description + "\"\n  arguments:\n" + f.args.map((a: string, i: number) => "    - " + a + ": \"" + f.argDescs[i] + "\"").join("\n") + "\n  returns: \"" + f.returns + "\"\n").join("\n");
const REQUEST = "testSearchInput に入力された金額に消費税（税率10%）を加えた支払い総額を求めて、トーストで表示する。1円未満は切り捨てる。";

const load = async (withExt: boolean) => {
    const d = JSON.parse(JSON.stringify(base));
    d.extRuntime = withExt ? { js: SC.extJs, doc: DOC } : { js: "", doc: "" };
    d.forms[0].widgets.find((w: any) => w.id === 2).events = {};
    let r = await call("testApplyProjectData", { data: d });
    if (!r.ok) throw new Error("applyProjectData: " + r.error);
    r = await call("testSetAiConfig", { endpoint: LLM.endpoint, model: LLM.model, temperature: LLM.temperature ?? 0 });
    if (!r.ok) throw new Error("setAiConfig: " + r.error);
};

const results: string[] = [];
const ck = (name: string, ok: boolean, detail = "") => { results.push((ok ? "OK  " : "NG  ") + name + (detail ? " — " + detail : "")); };

// 1) 拡張ランタイムなし: text-to-yamlのプロンプトに拡張関数のセクションが出ない（従来と同一）
await load(false);
await call("testSetAutoConfirm", { value: true });
await call("testOpenYamlEditor", { wid: 2, evName: "Click" });
let r = await call("testTextToYamlGenerate", { wid: 2, evName: "Click", inputText: REQUEST });
let lp = (await call("testGetLastPrompt")).prompt;
ck("[拡張なし] YAMLドラフト生成が成功", r.ok, r.error || "");
ck("[拡張なし] プロンプトに拡張関数セクションが出ない", !!lp && !JSON.stringify(lp).includes("Extended Runtime Functions"));

// 2) 拡張ランタイムあり
for (let run = 1; run <= RUNS; run++) {
    await load(true);
    await call("testOpenYamlEditor", { wid: 2, evName: "Click" });
    r = await call("testTextToYamlGenerate", { wid: 2, evName: "Click", inputText: REQUEST });
    lp = (await call("testGetLastPrompt")).prompt;
    const yaml: string = r.yaml || "";
    ck("[#" + run + "] YAMLドラフト生成が成功", r.ok, r.error || "");
    ck("[#" + run + "] プロンプトに拡張関数セクションが出る", JSON.stringify(lp || "").includes("Extended Runtime Functions") && JSON.stringify(lp || "").includes("calcTax"));
    ck("[#" + run + "] YAMLのアクションに関数名 calcTax が入る", yaml.includes("calcTax"), yaml.includes("calcTax") ? "" : yaml.replace(/\n/g, " / ").slice(0, 200));
    // 実際のボタン操作経路（showLoadingModalを含む）でイベントJSを生成する
    await call("testSaveYaml", { wid: 2, evName: "Click", yaml });
    await call("testOpenYamlEditor", { wid: 2, evName: "Click" });
    const g = await call("testYamlAiGenerate", { wid: 2, evName: "Click" });
    const code: string = g.finalCode || "";
    // 実際に送られたプロンプト（文言比較用。Git管理外の.claudeWorkへ出す）
    mkdirSync(join(ROOT, ".claudeWork"), { recursive: true });
    writeFileSync(join(ROOT, ".claudeWork/ext-runtime-e2e-lastprompt.json"), JSON.stringify({ prompt: (await call("testGetLastPrompt")).prompt, yaml, code }, null, 1));
    ck("[#" + run + "] イベントJS生成が成功", g.ok, g.error || "");
    ck("[#" + run + "] 生成コードが calcTax(税抜, 税率) を呼ぶ", /\bcalcTax\s*\([^)]*,[^)]*\)/.test(code), /\bcalcTax/.test(code) ? "" : code.replace(/\n/g, " ").slice(0, 160));
    ck("[#" + run + "] 生成コードに await が付いていない（同期関数）", !/await\s+calcTax/.test(code), /await\s+calcTax/.test(code) ? code.split("\n").find((l) => /calcTax/.test(l))?.trim() || "" : "");
    ck("[#" + run + "] ユーザープロンプトに拡張ランタイムの説明が含まれる", JSON.stringify((await call("testGetLastPrompt")).prompt || "").includes("Extended Runtime"));
}
await call("testSetAutoConfirm", { value: null });
console.log(results.join("\n"));
const ng = results.filter((x) => x.startsWith("NG")).length;
console.log("\nNG " + ng + "件 / " + results.length + "項目");
process.exit(ng ? 1 : 0);
