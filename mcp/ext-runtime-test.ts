// 拡張ランタイムの「JS→AI向け説明YAML→イベントコード生成」テスト（Claude専用。画面/Electrobun不要）
//
// 【目的】
// 拡張ランタイム（プロジェクト共通の独自関数）が、①JS→説明YAMLに正しく変換されるか、
// ②そのYAMLを渡したイベントコード生成で、拡張関数が正しく呼ばれるか（関数名・await・引数個数・再実装しない）を、
// 実ローカルLLMに対して画面なしで走らせて自動チェックする。精度改善の前後比較用（--runsで複数回）。
//
// 【使い方】
//   bun run mcp/ext-runtime-test.ts [--runs N] [--part doc|event] [--out <json出力先>]
//   - 接続先は mcp/fixtures/test-llm.local.json（wizard-scenario-testと共通。無ければユーザーに確認）
//   - 題材は mcp/fixtures/ext-runtime/scenarios.json
//   - bun testには含めない（実LLMが必要で非決定的なため）
//
// 【AIメモ】
// - イベント生成はbuildGenPromptContext(DOM依存)を使わず、YAML_TO_JS_SYS/USER_PROMPTを最小コンテキストで直接呼ぶ。
//   よって「拡張ランタイム説明の渡し方・プロンプト文言」の検証が対象で、ウィジェット絞り込み等の周辺は対象外。
// - runAiGenerateの再現・環境スタブはwizard-scenario-test.tsと同じ（後処理を変えたら両方揃えること）。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

const ROOT = join(import.meta.dir, "..");
const g: any = globalThis;
const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const RUNS = Math.max(1, parseInt(opt("runs", "1"), 10) || 1);
const PART = opt("part", "all");
const OUT = opt("out", join(ROOT, ".claudeWork", "ext-runtime-result.json"));

const cfgPath = join(ROOT, "mcp/fixtures/test-llm.local.json");
if (!existsSync(cfgPath)) { console.error("接続先設定が無い: " + cfgPath); process.exit(2); }
const LLM = JSON.parse(readFileSync(cfgPath, "utf-8"));
const SC = JSON.parse(readFileSync(join(ROOT, "mcp/fixtures/ext-runtime/scenarios.json"), "utf-8"));

g.window = g;
const lenient = (): any => new Proxy(function () { }, { get: (_t, p) => (p === Symbol.toPrimitive ? () => "" : lenient()), apply: () => lenient(), set: () => true });
g.document = lenient();
g.navigator = { userAgent: "bun" };
g.localStorage = { getItem: () => null, setItem() { } };
g.XMLHttpRequest = class { status = 200; responseText = ""; u = ""; open(_m: string, u: string) { this.u = u; } send() {
        const t = readFileSync(join(ROOT, "src/mainview", this.u), "utf-8");
        this.responseText = t;
    } };
g.showToast = () => { };

async function callLlm(system: string, user: string): Promise<string | null> {
    const res = await fetch(LLM.endpoint + "/v1/chat/completions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: LLM.model, temperature: LLM.temperature ?? 0, stream: false, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const msg = data.choices?.[0]?.message || {};
    // vja-modal.jsのrunAiGenerateと同じ後処理
    const text = (msg.content || msg.reasoning_content || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\|[a-zA-Z0-9_]+\|>/g, "");
    const m = text.match(/```(?:javascript|json|yaml|js)?\n?([\s\S]*?)```/i);
    return m ? m[1].trim() : text.trim();
}
// 拡張ランタイム変換は後処理(コードブロック除去)を通す前の生応答も見たいが、本物はrunAiGenerate経由なので同じ後処理で評価する
g.runAiGenerate = async (o: any) => { const t = await callLlm(o.systemPrompt, o.userPrompt); if (t === null) { await o.onError?.(new Error("HTTP")); return; } await o.onSuccess?.(t); };

for (const f of ["prompt-def.js", "vja-ai-gen-core.js", "vja-app-config.js"]) {
    try { (0, eval)(readFileSync(join(ROOT, "src/mainview", f), "utf-8")); } catch (e) { console.error("読み込み失敗 " + f + ": " + e); process.exit(2); }
}

// ---- ① JS→YAML ----
function checkDoc(doc: string | null): string[] {
    const ng: string[] = [];
    if (!doc) return ["生成失敗(null)"];
    if (!doc.startsWith("-")) ng.push("先頭が「-」でない");
    if (/```/.test(doc)) ng.push("コードブロックが残っている");
    const heads = [...doc.matchAll(/^-\s*function:\s*(.+)$/gm)].map((m) => m[1].trim());
    for (const fn of SC.extFunctions) {
        const h = heads.find((x: string) => new RegExp("(^|\\s)" + fn.name + "\\s*\\(").test(x));
        if (!h) { ng.push("関数 " + fn.name + " が抽出されていない"); continue; }
        if (/^await\s/.test(h) !== fn.async) ng.push(fn.name + ": await " + (fn.async ? "が無い" : "が付いている"));
        const args = h.replace(/^await\s+/, "").replace(/^\w+\s*\(/, "").replace(/\).*$/, "").split(",").map((s: string) => s.trim()).filter(Boolean);
        if (args.join(",") !== fn.args.join(",")) ng.push(fn.name + ": 引数が違う(" + args.join(",") + ")");
    }
    if (heads.length !== SC.extFunctions.length) ng.push("関数数が違う(" + heads.length + ")");
    // 値が日本語か（description行に日本語文字があるか）
    const descs = [...doc.matchAll(/^\s+description:\s*(.+)$/gm)].map((m) => m[1]);
    if (descs.length === 0 || descs.some((d) => !/[぀-ヿ一-鿿]/.test(d))) ng.push("descriptionが日本語でない/欠落");
    try {
        const parsed = (Bun as any).YAML ? (Bun as any).YAML.parse(doc) : null;
        if ((Bun as any).YAML && !Array.isArray(parsed)) ng.push("YAMLが配列でない");
    } catch (e: any) { ng.push("YAMLパース失敗: " + String(e.message || e).slice(0, 80)); }
    return ng;
}

// ---- ② YAML→イベントコード ----
// 基準となる説明YAML（①の生成結果ではなく固定。①の揺らぎを②へ持ち込まないため）
const FIXED_DOC = SC.extFunctions.map((f: any) => {
    const sig = (f.async ? "await " : "") + f.name + "(" + f.args.join(", ") + ")";
    return "- function: " + sig + "\n  description: \"" + f.description + "\"\n  arguments:\n" + f.args.map((a: string, i: number) => "    - " + a + ": \"" + f.argDescs[i] + "\"").join("\n") + "\n  returns: \"" + f.returns + "\"\n";
}).join("\n");

function checkEvent(ev: any, code: string | null): string[] {
    const ng: string[] = [];
    if (!code) return ["生成失敗(null)"];
    try { new Function("vja", "return (async()=>{" + code + "\n})"); } catch (e: any) { ng.push("構文エラー: " + String(e.message).slice(0, 80)); }
    for (const name of ev.expectCalls) {
        const fn = SC.extFunctions.find((f: any) => f.name === name);
        const re = new RegExp("(await\\s+)?\\b" + name + "\\s*\\(([^)]*)\\)", "g");
        const calls = [...code.matchAll(re)];
        if (calls.length === 0) { ng.push("拡張関数 " + name + " を呼んでいない"); continue; }
        if (new RegExp("function\\s+" + name + "\\b|(const|let|var)\\s+" + name + "\\b").test(code)) ng.push(name + " を自前で再定義している");
        if (/vja\.\w+/.test(calls[0][0].replace(/^await\s+/, "")) === false && /\bvja\.(ext|runtime)\.\w*\b/.test(code.slice(calls[0].index! - 20, calls[0].index!))) ng.push(name + " をvja.配下で呼んでいる");
        for (const c of calls) {
            if (!!c[1] !== fn.async) ng.push(name + ": await " + (fn.async ? "が無い" : "が付いている"));
            const argc = c[2].trim() ? c[2].split(",").length : 0;
            if (argc !== fn.args.length) ng.push(name + ": 引数の個数が違う(" + argc + ")");
        }
    }
    // 未定義の関数呼び出し（架空の拡張関数）
    const known = new Set(SC.extFunctions.map((f: any) => f.name));
    for (const m of code.matchAll(/(?<![.\w])(?:await\s+)?([a-z][A-Za-z0-9]*)\s*\(/g)) {
        const n = m[1];
        if (["if", "for", "while", "switch", "catch", "function", "return", "typeof", "parseInt", "parseFloat", "Number", "String", "Math", "Date", "isNaN", "async"].includes(n)) continue;
        if (!known.has(n) && !new RegExp("(function|const|let|var)\\s+" + n + "\\b").test(code)) ng.push("未定義の関数を呼んでいる: " + n);
    }
    return ng;
}

const results: any[] = [];
let totalNg = 0;
const tally: Record<string, { ok: number; n: number }> = {};
const note = (k: string, bad: boolean) => { (tally[k] ||= { ok: 0, n: 0 }).n++; if (!bad) tally[k].ok++; };

for (let run = 1; run <= RUNS; run++) {
    if (PART === "all" || PART === "doc") {
        g.getProjectData = () => ({ aiConfig: {}, extRuntime: { js: SC.extJs, doc: "" } });
        const doc = await g.generateExtRuntimeDoc(SC.extJs);
        const ng = checkDoc(doc);
        note("doc", ng.length > 0); totalNg += ng.length;
        results.push({ part: "doc", run, doc, ng });
        console.log("[doc #" + run + "] " + (ng.length ? "NG " + ng.length + "件" : "OK")); ng.forEach((m) => console.log("   - " + m));
    }
    if (PART === "all" || PART === "event") {
        for (const ev of SC.events) {
            const ctx = { formName: "Form1", eventName: ev.eventName, wname: ev.wname, wtag: ev.wtag, wdescription: "", inputParamsCtx: "  (none)", allWidgetsCtx: ev.widgets.map((w: string) => "  - " + w).join("\n"), formsCtx: "  - Form1", globalConstCtx: "  (none)", formConstCtx: "  (none)", tablesCtx: "  (none)", extRuntimeDoc: FIXED_DOC, yamlDef: ev.yaml };
            const sys = g._PROMPT_DEF.YAML_TO_JS_SYS_PROMPT(false, ctx);
            const user = g._PROMPT_DEF.YAML_TO_JS_USER_PROMPT(false, ev.yaml, "", { ...ctx, optionalApiDocCtx: "", learnedFixesCtx: "" });
            const raw = await callLlm(sys, user);
            const code = raw === null ? null : g.fixMissingAwaits(g.stripWidgetValueAccess ? g.stripWidgetValueAccess(g._unwrapAiFunctionWrapper(raw)) : g._unwrapAiFunctionWrapper(raw), false);
            const ng = checkEvent(ev, code);
            note("event:" + ev.name, ng.length > 0); totalNg += ng.length;
            results.push({ part: "event", scenario: ev.name, run, code, ng });
            console.log("[event " + ev.name + " #" + run + "] " + (ng.length ? "NG " + ng.length + "件" : "OK")); ng.forEach((m) => console.log("   - " + m));
        }
    }
}
console.log("\n--- 成功率 ---");
for (const [k, v] of Object.entries(tally)) console.log(k + ": " + v.ok + "/" + v.n);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(results, null, 1));
console.log("詳細: " + OUT);
process.exit(totalNg > 0 ? 1 : 0);
