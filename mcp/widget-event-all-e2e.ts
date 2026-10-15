// 全ウィジェット種別の「イベント→書き込み系API」記録型モックE2E（Claude専用）
//
// 【目的】widget-event-e2e.ts(1ウィジェット)を、全ウィジェット種別へ広げる。実LLMでイベントJSを生成し、
//   記録型モックの呼び出し履歴で判定する。画面が実際に変わるか（描画）は対象外。picture(画像)の差し替えも対象外。
//   E: 各ウィジェットの各イベント(WIDGET_DEFS.events)で「msgLabelへ目印文字列を設定」するJSが生成されるか
//   T: ボタンClickで、各ウィジェット種別へ値を反映するJSが生成されるか（パラメータ反映）
// 【使い方】`bun run mcp`で起動後、bun run mcp/widget-event-all-e2e.ts [--part E|T] [--only <名前の一部>] [--runs N]
//   接続先はmcp/fixtures/test-llm.local.json。結果は.claudeWork/widget-event-all-result.json
// 【AIメモ】widgetsはスクリプト内で組み立てる（各tagにw_<tag>、ほかにmsgLabel/btn）。イベントYAMLはwidget.eventsへ直接入れる
//   （testApplyProjectDataが置き換えるaiConfigは、適用の後にtestSetAiConfigで再設定する）。判定は呼び出しの有無・宛先・値の形のみ。
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const PORT = process.env.VJA_TEST_PORT || "4570";
const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const PART = opt("part", "ET");
const ONLY = opt("only", "");
const RUNS = Math.max(1, parseInt(opt("runs", "1"), 10) || 1);
const base = JSON.parse(readFileSync(join(ROOT, "mcp/fixtures/prompt-integrity-test.vjaproj.json"), "utf-8"));
const LLM = JSON.parse(readFileSync(join(ROOT, "mcp/fixtures/test-llm.local.json"), "utf-8"));
const call = async (m: string, p: any = {}) => {
    const r = await fetch("http://localhost:" + PORT + "/" + m, { method: "POST", body: JSON.stringify(p) });
    return await r.json() as any;
};

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

const EVENTS: Record<string, string[]> = {
    button: ["Click", "MouseDown", "MouseUp", "MouseEnter", "MouseLeave", "GotFocus", "LostFocus"],
    label: ["Load", "Click", "MouseEnter", "MouseLeave"],
    inputtype: ["Load", "TextChanged", "KeyDown", "KeyUp", "GotFocus", "LostFocus", "Click", "Suggest"],
    textarea: ["Load", "TextChanged", "KeyDown", "KeyUp", "GotFocus", "LostFocus", "Click"],
    checkbox: ["Click", "CheckedChanged"],
    radio: ["Click", "CheckedChanged"],
    selectBox: ["Load", "SelectedIndexChanged", "TextChanged", "DropDown"],
    listbox: ["Load", "SelectedIndexChanged", "Click", "MouseDown"],
    datagrid: ["Load", "Click", "RowClick", "HeaderClick"],
    progressbar: ["Click"],
    groupbox: ["Click"],
    picture: ["Click", "MouseDown", "MouseUp"],
    qrcode: ["Load", "Click"],
    markdown: ["Load", "Click"],
    datepicker: ["TextChanged", "GotFocus", "LostFocus", "Click"],
    slider: ["ValueChanged", "MouseDown", "MouseUp"],
    hscroll: ["Scroll", "ValueChanged"],
    vscroll: ["Scroll", "ValueChanged"],
};
const TAGS = Object.keys(EVENTS);

const yamlOf = (desc: string, action: string) =>
    `説明: ${desc}\n入力チェック: なし\nアクション:\n  - ${action}\n正常終了: なし\nエラー終了: ログにエラーを出力`;

type Call = [string, ...any[]];
const WRITE_APIS = ["widget.set", "widget.setValue", "widget.setItems", "widget.setTableData", "widget.setSuggestions", "widget.setVisible", "widget.show", "widget.hide", "widget.enable", "widget.disable"];
const on = (c: Call[], name: string, apis = WRITE_APIS) => c.filter((x) => apis.includes(x[0]) && x[1] === name);
const flat = (x: any): string => JSON.stringify(x);

// T: ボタンClickで各ウィジェットへ値を反映
const TARGETS: { tag: string; action: string; ok: (c: Call[], n: string) => boolean; hint: string }[] = [
    { tag: "label", action: "w_labelのテキストを「完了」に変更する", ok: (c, n) => on(c, n).some((x) => flat(x).includes("完了")), hint: "完了" },
    { tag: "inputtype", action: "w_inputtypeの入力値を「テスト」に設定する", ok: (c, n) => on(c, n).some((x) => flat(x).includes("テスト")), hint: "テスト" },
    { tag: "textarea", action: "w_textareaの内容を「こんにちは」に設定する", ok: (c, n) => on(c, n).some((x) => flat(x).includes("こんにちは")), hint: "こんにちは" },
    { tag: "checkbox", action: "w_checkboxをチェック済み（オン）にする", ok: (c, n) => on(c, n).some((x) => x[2] === true), hint: "true" },
    { tag: "radio", action: "w_radioを選択状態（オン）にする", ok: (c, n) => on(c, n).some((x) => x[2] === true), hint: "true" },
    { tag: "selectBox", action: "w_selectBoxの選択肢を「A」「B」「C」の3つに設定する", ok: (c, n) => on(c, n).some((x) => ["A", "B", "C"].every((v) => flat(x).includes(v))), hint: "A,B,C" },
    { tag: "listbox", action: "w_listboxの項目を「A」「B」「C」の3つに設定する", ok: (c, n) => on(c, n).some((x) => ["A", "B", "C"].every((v) => flat(x).includes(v))), hint: "A,B,C" },
    { tag: "datagrid", action: "w_datagridに、id=1,name=\"りんご\"とid=2,name=\"みかん\"の2行を表示する", ok: (c, n) => on(c, n).some((x) => flat(x).includes("りんご") && flat(x).includes("みかん")), hint: "りんご,みかん" },
    { tag: "progressbar", action: "w_progressbarの値を50にする", ok: (c, n) => on(c, n).some((x) => x[2] === 50 || x[2] === "50"), hint: "50" },
    { tag: "groupbox", action: "w_groupboxを非表示にする", ok: (c, n) => on(c, n, ["widget.setVisible", "widget.hide"]).some((x) => x[0] === "widget.hide" || x[2] === false), hint: "hide/false" },
    { tag: "qrcode", action: "w_qrcodeのテキストを「https://example.com」に設定する", ok: (c, n) => on(c, n).some((x) => flat(x).includes("https://example.com")), hint: "url" },
    { tag: "markdown", action: "w_markdownのテキストを「# 見出し」に設定する", ok: (c, n) => on(c, n).some((x) => flat(x).includes("# 見出し")), hint: "# 見出し" },
    { tag: "datepicker", action: "w_datepickerの日付を「2026-01-01」に設定する", ok: (c, n) => on(c, n).some((x) => flat(x).includes("2026-01-01")), hint: "2026-01-01" },
    { tag: "slider", action: "w_sliderの値を30にする", ok: (c, n) => on(c, n).some((x) => x[2] === 30 || x[2] === "30"), hint: "30" },
    { tag: "hscroll", action: "w_hscrollの値を20にする", ok: (c, n) => on(c, n).some((x) => x[2] === 20 || x[2] === "20"), hint: "20" },
    { tag: "vscroll", action: "w_vscrollの値を10にする", ok: (c, n) => on(c, n).some((x) => x[2] === 10 || x[2] === "10"), hint: "10" },
    { tag: "button", action: "w_buttonを無効（押せない状態）にする", ok: (c, n) => on(c, n).length >= 1, hint: "disable" },
];

const mkWidgets = () => {
    let id = 1;
    const ws: any[] = [];
    let y = 10;
    for (const tag of [...TAGS, "label:msgLabel", "button:btn"]) {
        const [t, nm] = tag.split(":");
        ws.push({ id: id++, name: nm || "w_" + t, tag: t, x: 10, y, w: 120, h: 24, z: id, props: {}, events: {}, jsCode: {}, docCode: {} });
        y += 28;
    }
    return ws;
};

const results: any[] = [];
let ng = 0, total = 0;
const runOne = async (label: string, wname: string, evName: string, yaml: string, judge: (c: Call[]) => boolean, wtag: string, marker: string) => {
    for (let i = 1; i <= RUNS; i++) {
        total++;
        const data = JSON.parse(JSON.stringify(base));
        const ws = mkWidgets();
        const src = ws.find((w) => w.name === wname)!;
        src.events[evName] = yaml;
        data.forms[0].widgets = ws;
        data.forms[0].idCnt = ws.length + 1;
        await call("testApplyProjectData", { data });
        await call("testSetAiConfig", LLM);
        const g = await generateViaEditor(src.id, evName, marker);
        let res: any = { label, run: i, wname, evName };
        if (!g.ok) { res.status = "GENFAIL"; res.error = g.error; }
        else {
            const r = await call("testMockRunRecord", { code: g.code, evName, wtag, wid: src.id });
            const c: Call[] = r.calls || [];
            const ok = !r.error && judge(c);
            res = { ...res, status: ok ? "OK" : "NG", mockError: r.error || null, calls: c, code: g.code };
        }
        if (res.status !== "OK") ng++;
        console.log(`${res.status.padEnd(7)} ${label}#${i}` + (res.status === "OK" ? "" : "  " + JSON.stringify(res.calls ?? res.error).slice(0, 160)));
        results.push(res);
    }
};

await call("testSetAutoConfirm", { value: true });
if (PART.includes("E")) {
    for (const tag of TAGS) for (const ev of EVENTS[tag]) {
        const label = `E:${tag}.${ev}`;
        if (ONLY && !label.includes(ONLY)) continue;
        const mark = `${tag}の${ev}`;
        await runOne(label, "w_" + tag, ev, yamlOf(`${tag}の${ev}イベントでmsgLabelに目印を表示する`, `msgLabelのテキストを「${mark}」に変更する`),
            (c) => on(c, "msgLabel").some((x) => flat(x).includes(mark)), tag, mark);
    }
}
if (PART.includes("T")) {
    for (const t of TARGETS) {
        const label = `T:${t.tag}`;
        if (ONLY && !label.includes(ONLY)) continue;
        const n = "w_" + t.tag;
        await runOne(label, "btn", "Click", yamlOf(`ボタンを押すと${n}へ値を反映する`, t.action), (c) => t.ok(c, n), "button", t.action);
    }
}
await call("testSetAutoConfirm", { value: null });
writeFileSync(join(ROOT, ".claudeWork/widget-event-all-result.json"), JSON.stringify(results, null, 1));
console.log(`\n${total - ng}/${total} OK`);
