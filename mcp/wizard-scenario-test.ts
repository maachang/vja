// ウィザード生成の「シナリオ＋実ローカルLLM」テスト（Claude専用。画面/Electrobun不要）
//
// 【目的】
// ウィザードのAI生成パイプライン（画面構成の分解 → 画面YAML生成 → 必須ボタン補完 → レイアウト生成）を、
// 実際のウィザード関数（vja-wizard.js等）そのままで、実LLMに対して画面なしで走らせ、
// 結果を自動チェックする。人が実機で毎回ウィザードを通す代わりに、Claudeが回帰確認に使う。
//
// 【使い方】（Claude向け。詳細は.claude/notes/mcp-test.md）
//   bun run mcp/wizard-scenario-test.ts [--runs N] [--scenario <名前の一部>] [--out <json出力先>]
//   - 接続先は mcp/fixtures/test-llm.local.json（.gitignore済み。無ければユーザーに確認すること。推測しない）
//   - シナリオは mcp/fixtures/wizard-scenarios/*.json（appOverview/tables/formSize）
//   - 結果の詳細JSONは既定で .claudeWork/wizard-scenario-result.json（Git管理外）へ出る
//   - bun testには含めない（実LLMが必要で遅く、結果が非決定的なため。*.test.tsの名前にしないこと）
//
// 【AIメモ】
// - 本物の関数を読み込む都合上、document等は何でも受け付けるスタブ。DOMに依存する処理（showToast等）は
//   呼ばれても無害。アプリ側にDOM依存の新処理を足してこのテストが落ちたら、まずスタブで足りるか確認する。
// - runAiGenerateだけはvja-modal.js（DOM依存）を読み込まずここで再現している。応答の後処理
//   （<think>除去・特殊トークン除去・コードブロック抽出）はvja-modal.jsと同じ内容を維持すること。
// - レイアウト反映(applyAiFormDesign)は呼ばず、座標是正(arrangeAiFormItems)までを検証する
//   （フォーム外へのはみ出し補正はapplyAiFormDesign側にあるため、このテストの結果はその前の値）。
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

const ROOT = join(import.meta.dir, "..");
const g: any = globalThis;

// ---- 引数 ----
const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const RUNS = Math.max(1, parseInt(opt("runs", "1"), 10) || 1);
const ONLY = opt("scenario", "");
const OUT = opt("out", join(ROOT, ".claudeWork", "wizard-scenario-result.json"));

// ---- LLM接続先（個人環境依存のためコミットしない設定ファイル） ----
const cfgPath = join(ROOT, "mcp/fixtures/test-llm.local.json");
if (!existsSync(cfgPath)) {
    console.error("接続先設定が無い: " + cfgPath + "（mcp/fixtures/test-llm.local.json.example を参照。ユーザーに接続先を確認すること）");
    process.exit(2);
}
const LLM = JSON.parse(readFileSync(cfgPath, "utf-8"));

// ---- 本物のウィザード関連コードを読み込むための環境スタブ ----
g.window = g;
const lenient = (): any => new Proxy(function () { }, { get: (_t, p) => (p === Symbol.toPrimitive ? () => "" : lenient()), apply: () => lenient(), set: () => true });
g.document = lenient();
g.navigator = { userAgent: "bun" };
g.localStorage = { getItem: () => null, setItem() { } };
g.XMLHttpRequest = class { status = 200; responseText = ""; u = ""; open(_m: string, u: string) { this.u = u; } send() { this.responseText = readFileSync(join(ROOT, "src/mainview", this.u), "utf-8"); } };
const projectData: any = { tables: [], formCfg: { w: 640, h: 420 }, aiConfig: {}, forms: [], curFormIdx: 0 };
g.getProjectData = () => projectData;
g.showToast = () => { };
g.closeModal = () => { };

// runAiGenerate（vja-modal.js）の再現: 実LLMへ送り、後処理してonSuccessへ渡す
let _temperature = LLM.temperature ?? 0;
g.runAiGenerate = async (o: any) => {
    const res = await fetch(LLM.endpoint + "/v1/chat/completions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: LLM.model, temperature: o.temperatureOverride ?? _temperature, stream: false, messages: [{ role: "system", content: o.systemPrompt }, { role: "user", content: o.userPrompt }] }),
    });
    if (!res.ok) { if (o.onError) await o.onError(new Error("HTTP " + res.status)); return; }
    const data: any = await res.json();
    const msg = data.choices?.[0]?.message || {};
    let text = (msg.content || msg.reasoning_content || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\|[a-zA-Z0-9_]+\|>/g, "");
    const m = text.match(/```(?:javascript|json|yaml|js)?\n?([\s\S]*?)```/i);
    if (o.onSuccess) await o.onSuccess(m ? m[1].trim() : text.trim());
};

for (const f of ["prompt-def.js", "form-layout-patterns.js", "vja-form-layout-fix.js", "vja-wizard-actions.js", "vja-form-design-ai.js", "vja-ai-gen-core.js", "vja-wizard.js"]) {
    (0, eval)(readFileSync(join(ROOT, "src/mainview", f), "utf-8"));
}

// ---- チェック ----
type Item = { tag: string; name?: string; text?: string; x: number; y: number; w: number; h: number };
const inter = (a: Item, b: Item) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const actionsOf = (yaml: string): string[] => {
    const m = yaml.match(/アクション項目:\n((?:[ \t]+-.*\n?)*)/);
    return m ? m[1].split("\n").filter((l) => /^\s+-/.test(l)).map((l) => l.replace(/^\s+-\s*/, "").replace(/:.*$/, "").replace(/ボタン$/, "").trim()) : [];
};
function checkForm(kind: string | undefined, yaml: string, items: Item[] | null, W: number, H: number, listTitles: string[]): string[] {
    const ng: string[] = [];
    const acts = actionsOf(yaml);
    const has = (re: RegExp) => acts.some((a) => re.test(a));
    if (!items || items.length === 0) { ng.push("レイアウト生成失敗/空"); return ng; }
    const btns = items.filter((i) => i.tag === "button");
    const btnText = btns.map((b) => (b.text || "").trim());
    if (kind === "input") {
        if (!has(/登録|保存|追加|更新|確定/)) ng.push("入力画面に確定ボタンが無い(YAML)");
        if (!has(/戻る/)) ng.push("入力画面に戻るが無い(YAML)");
    } else if (kind === "list") {
        if (!items.some((i) => i.tag === "datagrid")) ng.push("一覧にdatagridが無い");
        const hasCond = /入力項目:\n([\s\S]*?)(?:\n\S|$)/.exec(yaml)?.[1].split("\n").some((l) => /^\s{2}-/.test(l) && !/datagrid/i.test(l));
        if (hasCond && !has(/検索|絞り込|フィルタ/)) ng.push("条件入力があるのに検索が無い(YAML)");
        if (!has(/新規|追加|登録/)) ng.push("新規登録が無い(YAML)");
    } else if (kind === "menu") {
        listTitles.forEach((t) => {
            const stem = t.replace(/\s/g, "").replace(/一覧$/, "");
            if (stem && !btnText.some((b) => b.replace(/\s/g, "").includes(stem))) ng.push("メニューに「" + stem + "」ボタンが無い");
        });
    }
    // アクション項目の各ボタンが実際のウィジェットになっているか
    acts.forEach((a) => { if (!btnText.some((b) => b.includes(a) || a.includes(b))) ng.push("アクション「" + a + "」のボタンウィジェットが無い"); });
    items.forEach((w) => { if (w.x < 0 || w.y < 0 || w.x + w.w > W || w.y + w.h > H) ng.push("フォーム枠外:" + (w.name || w.tag)); });
    for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) if (inter(items[a], items[b])) ng.push("重なり:" + (items[a].name || items[a].tag) + "×" + (items[b].name || items[b].tag));
    return ng;
}

// ---- 実行 ----
const dir = join(ROOT, "mcp/fixtures/wizard-scenarios");
const scenarios = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8"))).filter((s) => !ONLY || s.name.includes(ONLY));
if (scenarios.length === 0) { console.error("該当シナリオが無い: " + ONLY); process.exit(2); }

const results: any[] = [];
let totalNg = 0;
for (const sc of scenarios) {
    for (let run = 1; run <= RUNS; run++) {
        projectData.tables = sc.tables;
        projectData.formCfg = { w: sc.formSize.w, h: sc.formSize.h };
        const rec: any = { scenario: sc.name, run, forms: [], error: null };
        const t0 = Date.now();
        try {
            const { forms, missing } = await g.wizardDecomposeFormsCore(sc.tables, sc.appOverview, null);
            if (!forms) { rec.error = "分解失敗 missing=" + (missing || []).map((m: any) => m.formName).join(","); }
            else {
                const listTitles = forms.filter((f: any) => f.kind === "list").map((f: any) => f.formTitle);
                for (const f of forms) {
                    const fr: any = { formName: f.formName, kind: f.kind || null, title: f.formTitle, docDraft: f.docDraft, yaml: null, pattern: null, items: null, ng: [] };
                    const y = await g.wizardGenerateFormYaml(f.docDraft, f.kind, listTitles);
                    if (!y) { fr.ng.push("YAML生成失敗"); rec.forms.push(fr); continue; }
                    fr.yaml = y.yaml; fr.pattern = y.layoutPatternId;
                    const hint = g.buildLayoutRegionsPromptText(y.layoutPatternId, sc.formSize.w, sc.formSize.h, g.countFormDesignInputFields(y.yaml));
                    const raw = await g.generateFormLayoutRaw(y.yaml, hint, sc.tables);
                    const parsed = raw ? g.parseFormDesignJson(raw) : null;
                    fr.items = parsed ? g.arrangeAiFormItems(parsed, sc.formSize.w, sc.formSize.h) : null;
                    fr.ng = checkForm(f.kind, y.yaml, fr.items, sc.formSize.w, sc.formSize.h, listTitles);
                    rec.forms.push(fr);
                }
            }
        } catch (e: any) { rec.error = "例外: " + String(e).slice(0, 200); }
        rec.sec = Math.round((Date.now() - t0) / 100) / 10;
        const ng = rec.forms.flatMap((f: any) => f.ng.map((m: string) => f.formName + ": " + m)).concat(rec.error ? [rec.error] : []);
        totalNg += ng.length;
        console.log("[" + sc.name + " #" + run + "] " + rec.sec + "s 画面" + rec.forms.length + " " + (ng.length ? "NG " + ng.length + "件" : "OK"));
        ng.forEach((m: string) => console.log("   - " + m));
        results.push(rec);
    }
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(results, null, 1));
console.log("詳細: " + OUT + " / NG合計 " + totalNg);
process.exit(totalNg > 0 ? 1 : 0);
