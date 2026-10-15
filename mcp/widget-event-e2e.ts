// 記録型モックによる「イベントで書き込み系APIが正しく呼ばれたか」のE2Eテスト（Claude専用）
//
// 【目的】モック実行(Web Worker)が記録した書き込み系API(vja.widget.setValue/set/show等)の呼び出し履歴で、
//   「どのウィジェットへ・どの値を・どのAPIで渡したか」を機械判定する。画面が実際に変わるか（描画）は対象外（実行ウィンドウの目視）。
// 【使い方】
//   1. `bun run mcp`（VJA_TEST_MODE=1でvjaが起動し、4570でテストサーバーが立つ）
//   2. bun run mcp/widget-event-e2e.ts            … 手書きコードで記録の仕組みを検証（LLM不要・決定的）
//      bun run mcp/widget-event-e2e.ts --ai [--runs N]  … 実LLMでイベントJSを生成し、記録で判定
//   接続先は mcp/fixtures/test-llm.local.json
// 【AIメモ】題材は prompt-integrity-test.vjaproj.json（TestForm: testResultGrid/testSearchButton(id=2)/testSearchInput/testSearchSelect）。
//   モックのdb.query等は固定のダミー値を返すため、判定は「呼び出しの有無・宛先・引数の形」に限る。
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const PORT = process.env.VJA_TEST_PORT || "4570";
const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const AI = argv.includes("--ai");
const RUNS = Math.max(1, parseInt(opt("runs", "1"), 10) || 1);
const base = JSON.parse(readFileSync(join(ROOT, "mcp/fixtures/prompt-integrity-test.vjaproj.json"), "utf-8"));
const call = async (m: string, p: any = {}) => {
    const r = await fetch("http://localhost:" + PORT + "/" + m, { method: "POST", body: JSON.stringify(p) });
    return await r.json() as any;
};

type Call = [string, ...any[]];
// 実際のボタン操作フロー(yamlAiGenerate)で生成する。testYamlAiGenerateはYAMLをエディタ欄(#yaml-ta)から
// 読むため、エディタを開かずに呼ぶとYAML本文がプロンプトに入らない（2026-10-15、これで偽OKが出た）。
// 生成後のJSはウィジェットのjsCodeへ保存されるので、それを取り出す。送信プロンプトにYAMLの要点(marker)が
// 入っているかも確認する。戻り値: { ok, code, error }
const generateViaEditor = async (wid: number, evName: string, marker: string) => {
    await call("testOpenYamlEditor", { wid, evName });
    const f = await call("testYamlAiGenerateFull", { wid, evName });
    if (!f.ok) return { ok: false, error: f.error };
    if (!(f.prompt?.userPrompt || "").includes(marker)) return { ok: false, error: "プロンプトにYAML本文が入っていない: " + marker };
    for (let i = 0; i < 40; i++) {
        const ws = (await call("testGetWidgets")).widgets || [];
        const code = ws.find((w: any) => w.id === wid)?.jsCode?.[evName];
        if (code) return { ok: true, code };
        await new Promise((r) => setTimeout(r, 250));
    }
    return { ok: false, error: "生成コードが保存されなかった（タイムアウト）" };
};

let ng = 0;
const check = (label: string, cond: boolean, detail = "") => {
    console.log((cond ? "  OK " : "  NG ") + label + (cond ? "" : "  " + detail));
    if (!cond) ng++;
};
const find = (calls: Call[], api: string, name: string) => calls.filter((c) => c[0] === api && c[1] === name);

await call("testApplyProjectData", { data: base });

// ── A. 手書きコードで記録の仕組みそのものを検証（決定的） ──
console.log("[A] 手書きコード → 記録");
{
    const r = await call("testMockRunRecord", {
        code: "vja.widget.setValue('testSearchInput', 'abc');\nvja.widget.setVisible('testResultGrid', false);\nvja.widget.set('testSearchSelect', 'items', ['a','b']);\nawait vja.session.set('k', 'v');\nvja.form.setParam('p', 1);",
        evName: "Click", wtag: "button", wid: 2,
    });
    check("実行が成功する", r.ok && !r.error, JSON.stringify(r.error));
    const c: Call[] = r.calls || [];
    check("setValueが宛先・値つきで記録される", find(c, "widget.setValue", "testSearchInput")[0]?.[2] === "abc", JSON.stringify(c));
    check("setVisibleが記録される", find(c, "widget.setVisible", "testResultGrid")[0]?.[2] === false);
    check("widget.setの引数が全部残る", JSON.stringify(find(c, "widget.set", "testSearchSelect")[0]) === JSON.stringify(["widget.set", "testSearchSelect", "items", ["a", "b"]]));
    check("session.setが記録される", find(c, "session.set", "k")[0]?.[2] === "v");
    check("form.setParamが記録される", find(c, "form.setParam", "p")[0]?.[2] === 1);
    const r2 = await call("testMockRunRecord", { code: "vja.widget.get('testSearchInput');", evName: "Click", wtag: "button", wid: 2 });
    check("読み取りのみなら履歴は空", (r2.calls || []).length === 0, JSON.stringify(r2.calls));
    const r3 = await call("testMockRunRecord", { code: "vja.widget.setValue('testSearchInput', 'x'); throw new Error('boom');", evName: "Click", wtag: "button", wid: 2 });
    check("例外ならerrorが返る", !!r3.error, JSON.stringify(r3));
}

// ── B. 実LLMでイベントJSを生成し、記録で判定 ──
if (AI) {
    console.log("[B] 実LLM生成 → 記録（testSearchButton Click）");
    const LLM = JSON.parse(readFileSync(join(ROOT, "mcp/fixtures/test-llm.local.json"), "utf-8"));
    await call("testSetAutoConfirm", { value: true });
    for (let i = 1; i <= RUNS; i++) {
        // testApplyProjectDataはaiConfigも置き換えるため、適用の後に接続先を設定する
        await call("testApplyProjectData", { data: base });
        await call("testSetAiConfig", LLM);
        const g = await generateViaEditor(2, "Click", "testSearchInput");
        if (!g.ok) { check(`#${i} 生成`, false, g.error); continue; }
        const r = await call("testMockRunRecord", { code: g.code, evName: "Click", wtag: "button", wid: 2 });
        const c: Call[] = r.calls || [];
        console.log(`#${i} calls=` + JSON.stringify(c).slice(0, 300));
        check(`#${i} モック実行が成功`, r.ok && !r.error, JSON.stringify(r.error));
        check(`#${i} 結果をtestResultGridへ渡している`, ["widget.set", "widget.setValue", "widget.setTableData"].some((api) => find(c, api, "testResultGrid").length >= 1), JSON.stringify(c) + "\n" + g.code);
        const names = new Set(["testSearchInput", "testSearchSelect", "testResultGrid", "testSearchButton"]);
        check(`#${i} 宛先が実在するウィジェットのみ`, c.filter((x) => x[0].startsWith("widget.")).every((x) => names.has(x[1])), JSON.stringify(c));
    }
    await call("testSetAutoConfirm", { value: null });
}

console.log(ng === 0 ? "\n全項目OK" : `\nNG ${ng}件`);
process.exit(ng === 0 ? 0 : 1);
