// 「📖 JSからYAML化」(jsToYamlGenerate)の実機(Electrobun)E2Eテスト（Claude専用）
//
// 【目的】イベントのJSからイベントYAMLを書き起こす機能が、実LLMで妥当なYAMLを返し、
// ボタン操作フロー全体（確認ダイアログ→ローディング→データモデル反映→エディタ再描画）が通ることを測る。
//   S1 条件分岐   : if/elseを持つ検索 → 「〜の場合:」「それ以外の場合:」が出ること
//   S2 繰り返し   : 全行ループ → 「繰り返し:」が出ること
//   S3 単純        : 1行トースト → 余計な手順が増えないこと
// 共通判定: コードブロック/英語キーが残っていない、「説明:」「アクション:」がある、
//   JS由来の識別子(vja./await/function等)をYAMLへ書いていない、ウィジェット名・表名が出る、依頼文(docCode)が説明で補われる
//
// 【使い方】
//   1. `bun run mcp`（VJA_TEST_MODE=1でvjaが起動し、4570でテストサーバーが立つ）
//   2. bun run mcp/js-to-yaml-e2e.ts [--runs N] [--preset <共通AIプリセット名の一部>]
//   接続先は mcp/fixtures/test-llm.local.json（--presetでアプリの共通プリセット）
// 【AIメモ】題材は prompt-integrity-test.vjaproj.json（TestForm: testResultGrid/testSearchButton(id=2)/testSearchInput/testSearchSelect、表test_items）。
//   APIキーは表示しない。判定は正規表現による機械判定（YAMLの質の全てではなく、必要な構造が出たかの確認）。
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const PORT = process.env.VJA_TEST_PORT || "4570";
const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const RUNS = Math.max(1, parseInt(opt("runs", "1"), 10) || 1);
const LLM = JSON.parse(readFileSync(join(ROOT, "mcp/fixtures/test-llm.local.json"), "utf-8"));
let API_KEY = "";
const PRESET = opt("preset", "");
if (PRESET) {
    const pf = join(process.env.HOME || "", ".vja-designer/ai-global-presets.json");
    const list: any[] = existsSync(pf) ? (JSON.parse(readFileSync(pf, "utf-8")).presets || []) : [];
    const hit = list.filter((p) => (p.name || "").includes(PRESET));
    if (hit.length !== 1) { console.error("共通プリセットが一意に決まらない: " + PRESET); process.exit(2); }
    const c = hit[0].config || {};
    if (c.apiKey) { API_KEY = c.apiKey; LLM.endpoint = "https://api.openai.com"; LLM.model = c.model || "gpt-4o-mini"; LLM.temperature = undefined; }
    else { LLM.endpoint = c.endpoint; LLM.model = c.model || ""; LLM.temperature = c.temperature; }
    console.log("接続: プリセット「" + hit[0].name + "」 model=" + LLM.model + (API_KEY ? " (APIキーあり)" : ""));
}
const base = JSON.parse(readFileSync(join(ROOT, "mcp/fixtures/prompt-integrity-test.vjaproj.json"), "utf-8"));
const call = async (m: string, p: any = {}) => {
    const r = await fetch("http://localhost:" + PORT + "/" + m, { method: "POST", body: JSON.stringify(p) });
    return await r.json() as any;
};

const SCENARIOS = [
    {
        id: "S1-条件分岐",
        names: ["testSearchInput", "testSearchSelect", "testResultGrid"],
        js: "vja.notify.showLoading();\nvar kw = vja.widget.getValue('testSearchInput');\nvar rows;\nif (kw !== '') {\n    var col = vja.widget.getValue('testSearchSelect');\n    rows = await vja.db.query('SELECT * FROM test_items WHERE ' + col + ' LIKE ?', ['%' + kw + '%']);\n} else {\n    rows = await vja.db.query('SELECT * FROM test_items');\n}\nvja.widget.setValue('testResultGrid', rows);\nvja.notify.hideLoading();",
        ok: (y: string) => (y.match(/場合\s*:/g) || []).length >= 2 && /testSearchInput/.test(y) && /test_items/.test(y),
    },
    {
        id: "S2-繰り返し",
        names: ["testResultGrid"],
        js: "var rows = vja.widget.getValue('testResultGrid');\nfor (const row of rows) {\n    if (row.category === '未分類') {\n        await vja.db.query('UPDATE test_items SET category = ? WHERE id = ?', ['その他', row.id]);\n    }\n}\nvja.notify.toast('更新しました');",
        ok: (y: string) => /繰り返(し|す)\s*:/.test(y) && /の場合\s*:/.test(y) && /test_items/.test(y) && /testResultGrid/.test(y),
    },
    {
        id: "S3-単純",
        names: [] as string[],
        js: "vja.notify.toast('こんにちは');",
        // 単純なコードに、分岐など存在しない手順が足されていないこと（利用テーブルは右パネルの状態で入るため判定しない）
        ok: (y: string) => /こんにちは/.test(y) && !/の場合\s*:/.test(y),
    },
];

// 全シナリオ共通の判定。NGの理由を返す（OKなら空文字）
const commonNg = (y: string, doc: string): string => {
    if (/```/.test(y)) return "コードブロックが残っている";
    if (!/^説明\s*:/m.test(y)) return "「説明:」が無い";
    if (!/^アクション\s*:/m.test(y)) return "「アクション:」が無い";
    if (/^(description|actions|tables|validation|on_success|on_error)\s*:/m.test(y)) return "英語キーが残っている";
    if (/\bvja\.|\bawait\b|\bfunction\b|=>/.test(y)) return "JS由来の識別子がYAMLに出ている";
    if (!doc.trim()) return "依頼文(docCode)が補われていない";
    return "";
};

const setup = async () => {
    let r = await call("testApplyProjectData", { data: JSON.parse(JSON.stringify(base)) });
    if (!r.ok) throw new Error("applyProjectData: " + r.error);
    r = await call("testSetAiConfig", { endpoint: LLM.endpoint, model: LLM.model, apiKey: API_KEY || undefined, temperature: LLM.temperature ?? undefined });
    if (!r.ok) throw new Error("setAiConfig: " + r.error);
    await call("testSetAutoConfirm", { value: true });
};

const stat: Record<string, number> = {};
for (const sc of SCENARIOS) {
    stat[sc.id] = 0;
    for (let i = 1; i <= RUNS; i++) {
        await setup(); // 毎回、題材を初期状態（依頼文が空）へ戻す
        const res = await call("testJsToYamlGenerateFull", { wid: 2, evName: "Click", js: sc.js });
        const y: string = res.ok ? res.yaml : "";
        const why = !res.ok ? res.error : (commonNg(y, res.doc || "") || ((sc as any).names as string[]).filter((n) => !y.includes(n)).map((n) => "ウィジェット名が言い換えられた: " + n).join(",") || (sc.ok(y) ? "" : "シナリオ固有の判定NG"));
        const synced = res.ok && res.yamlTa === y;
        const judged = !why && synced;
        if (judged) stat[sc.id]++;
        console.log("[" + sc.id + " #" + i + "] " + (judged ? "OK" : "NG") + (judged ? "" : " — " + (why || "エディタ表示とデータモデルが不一致"))
            + (judged && process.env.J2Y_SHOW ? "\n" + y : ""));
        if (!judged && res.ok) console.log(y.split("\n").map((l: string) => "    | " + l).join("\n"));
    }
}
await call("testSetAutoConfirm", { value: null });
console.log("\n--- 成功率 ---");
for (const [k, v] of Object.entries(stat)) console.log(k + ": " + v + "/" + RUNS);
