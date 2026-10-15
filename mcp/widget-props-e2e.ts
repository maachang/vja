// イベント以外のウィジェット動作のE2Eテスト（Claude専用、LLM不要・決定的）
//
// 【目的】全ウィジェット種別について、次をデザイナー上で機械判定する。
//   P: プロパティの値が、デザイナーの描画(WIDGET_DEFS.preview)に反映されるか（testGetWidgetHtml）
//   L: 追加(testAddWidget)→描画・既定プロパティ→選択でプロパティパネルが出る→削除でデータと描画から消える、の整合性
//   画面の見た目（配色の好み等）や、実行ウィンドウでの動作は対象外（目視）。
// 【使い方】`bun run mcp`で起動後、bun run mcp/widget-props-e2e.ts
// 【AIメモ】Pの値は題材側で指定した一部のプロパティのみ（未指定のキーは空のまま描画されるので判定しない）。
//   disabled/readonly/スクロールバーのval等は、プレビューに出ない仕様かどうかが設計判断のため、NGにせず「未反映」として別枠で出す。
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const PORT = process.env.VJA_TEST_PORT || "4570";
const base = JSON.parse(readFileSync(join(ROOT, "mcp/fixtures/prompt-integrity-test.vjaproj.json"), "utf-8"));
const call = async (m: string, p: any = {}) => (await (await fetch("http://localhost:" + PORT + "/" + m, { method: "POST", body: JSON.stringify(p) })).json()) as any;

// [プロパティ, 描画HTMLに含まれるべき文字列[]]。notShown=プレビュー未反映の確認用（NGにしない）
const CASES: Record<string, { props: any; must: string[]; notShown?: string[] }> = {
    button: { props: { text: "押す", bg: "#112233", fg: "#aabbcc", fontSize: 20, fontBold: true, borderRadius: 9, disabled: true }, must: ["押す", "background:#112233", "color:#aabbcc", "font-size:20px", "font-weight:bold", "border-radius:9px"], notShown: ["disabled"] },
    label: { props: { text: "表示文字", fg: "#aabbcc", fontSize: 20, fontBold: true, align: "center" }, must: ["表示文字", "color:#aabbcc", "font-size:20px", "font-weight:bold", "text-align:center"] },
    inputtype: { props: { text: "入力値", placeholder: "ヒント", bg: "#112233", maxLength: 5, readonly: true, disabled: true }, must: ['value="入力値"', 'placeholder="ヒント"', 'maxlength="5"', "background:#112233"], notShown: ["readonly", "disabled"] },
    textarea: { props: { text: "複数\n行", placeholder: "ヒント", bg: "#112233", readonly: true }, must: ["複数", "行</textarea>", 'placeholder="ヒント"', "background:#112233"], notShown: ["readonly"] },
    checkbox: { props: { text: "同意", checked: true, fg: "#aabbcc" }, must: ["同意", "checked", "color:#aabbcc"] },
    radio: { props: { text: "選択", checked: true, group: "G9" }, must: ["選択", "checked", 'name="G9"'] },
    selectBox: { props: { items: "あ\nい\nう", bg: "#112233" }, must: ['<option value="あ">', '<option value="い">', '<option value="う">', "background:#112233"] },
    listbox: { props: { items: "あ\nい\nう", bg: "#112233" }, must: ["multiple", '<option value="あ">', '<option value="う">', "background:#112233"] },
    datagrid: { props: { columns: "ID:20\n名前:50", headerBg: "#112233", headerFg: "#aabbcc" }, must: [">ID<", ">名前<", "width:20%", "width:50%", "background:#112233", "color:#aabbcc"] },
    progressbar: { props: { value: 70, min: 0, max: 200, fg: "#aabbcc" }, must: ["width:35%", "background:#aabbcc"] },
    groupbox: { props: { text: "枠名", fg: "#aabbcc" }, must: ["<legend", "枠名", "color:#aabbcc"] },
    qrcode: { props: { text: "https://example.com/q" }, must: ['title="https://example.com/q"', "<img"] },
    markdown: { props: { text: "# 見出しX\n\n- 項目" }, must: ["<h1>見出しX</h1>", "<li>項目</li>"] },
    datepicker: { props: { value: "2026-02-03", min: "2026-01-01", max: "2026-12-31" }, must: ['value="2026-02-03"', 'min="2026-01-01"', 'max="2026-12-31"'] },
    slider: { props: { min: 0, max: 50, value: 20, step: 5 }, must: ['min="0"', 'max="50"', 'value="20"', 'step="5"'] },
    hscroll: { props: { min: 0, max: 50, val: 20 }, must: ["◀", "▶"], notShown: ["20"] },
    vscroll: { props: { min: 0, max: 50, val: 20 }, must: ["▲", "▼"], notShown: ["20"] },
};
const TAGS = Object.keys(CASES);

let ng = 0, total = 0;
const check = (label: string, cond: boolean, detail = "") => {
    total++;
    if (!cond) ng++;
    console.log((cond ? "  OK " : "  NG ") + label + (cond ? "" : "  " + detail));
};
const unshown: string[] = [];

console.log("[P] プロパティ→描画");
for (const tag of TAGS) {
    const c = CASES[tag];
    const d = JSON.parse(JSON.stringify(base));
    d.forms[0].widgets = [{ id: 1, name: "t1", tag, x: 10, y: 10, w: 200, h: 80, z: 1, props: c.props, events: {}, jsCode: {}, docCode: {} }];
    d.forms[0].idCnt = 2;
    await call("testApplyProjectData", { data: d });
    const r = await call("testGetWidgetHtml", { id: 1 });
    const html: string = (r.html || "").replace(/\s+/g, " ");
    const miss = c.must.filter((m) => !html.replace(/\n/g, " ").includes(m.replace(/\n/g, " ")));
    check(`${tag}`, r.ok && miss.length === 0, "描画に無い: " + JSON.stringify(miss));
    for (const n of c.notShown || []) {
        const key = n === "20" ? "値20" : n;
        if (n === "20" ? true : !html.includes(n)) unshown.push(`${tag}: ${key}`);
    }
}

console.log("[L] 追加→選択→削除の整合性");
for (const tag of TAGS) {
    await call("testApplyProjectData", { data: JSON.parse(JSON.stringify(base)) });
    const before = (await call("testGetWidgets")).widgets.length;
    const a = await call("testAddWidget", { tag, x: 30, y: 30, w: 140, h: 60 });
    if (!a.ok) { check(`${tag} 追加`, false, a.error); continue; }
    const ws = (await call("testGetWidgets")).widgets;
    const w = ws.find((x: any) => x.id === a.id);
    const h = await call("testGetWidgetHtml", { id: a.id });
    await call("testSelectWidget", { id: a.id });
    const ph = await call("testGetPropsHtml");
    await call("testDeleteWidget", { id: a.id });
    const after = (await call("testGetWidgets")).widgets;
    const h2 = await call("testGetWidgetHtml", { id: a.id });
    const problems: string[] = [];
    if (ws.length !== before + 1) problems.push("追加で件数が増えない");
    if (!w || w.tag !== tag) problems.push("追加したウィジェットがデータに無い/種別違い");
    if (!w?.name) problems.push("名前が空");
    if (!h.html) problems.push("追加後の描画が空");
    if (!ph.plist || ph.plist.length < 50) problems.push("選択してもプロパティパネルが空");
    if (after.length !== before) problems.push("削除で件数が戻らない");
    if (after.some((x: any) => x.id === a.id)) problems.push("削除後もデータに残る");
    if (h2.html) problems.push("削除後も描画が残る");
    check(`${tag}`, problems.length === 0, problems.join(" / "));
}

console.log(`\n${total - ng}/${total} OK`);
if (unshown.length) console.log("プレビュー未反映（NGにしない・仕様かどうかは要判断）: " + unshown.join(", "));
process.exit(ng === 0 ? 0 : 1);
