// 実行時エラー→「AIで修正」の実機(Electrobun)E2Eテスト（Claude専用）
//
// 【目的】一覧の「AIで修正」が呼ぶ retryAiFix(…, runtimeError) が、実LLMで実行時エラーを適切に直せるかを測る。
// バグ入りコード＋実行時エラー報告を渡し、修正後コードを機械判定する。
//   S1 コードの誤り(thrown)   : 戻り値(配列)を誤ったプロパティで読んでいる → 修正されること
//   S2 握りつぶし(swallowed)  : 存在しないテーブル名でqueryしcatchでconsole.errorのみ → テーブル名が直ること
//   S4 アプリイベント(thrown) : OnStart(Bun側実行)で存在しないAPIを呼んでいる → 実在のAPIへ直ること
//   S3 外部要因(thrown)       : vja.fetchの失敗 → 通信呼び出し(vja.fetchまたは同じhttpカテゴリのvja.http.get)は残し、失敗時の処理(try/catch)が加わること
//
// 【使い方】
//   1. `bun run mcp`（VJA_TEST_MODE=1でvjaが起動し、4570でテストサーバーが立つ）。旧プロセスが4570を握っていると新規起動が失敗する
//   2. bun run mcp/runtime-error-fix-e2e.ts [--runs N] [--preset <共通AIプリセット名の一部>]
//   接続先は mcp/fixtures/test-llm.local.json（--presetでアプリの共通プリセット。OpenAI系はキー付き）
// 【AIメモ】題材は prompt-integrity-test.vjaproj.json（TestForm: testResultGrid/testSearchButton(id=2)/testSearchInput/testSearchSelect、表test_items(id,name,category)）。
//   APIキーは表示しない。判定は正規表現による機械判定（修正の質の全てではなく、目的の直しが入ったかの確認）。
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

const RT = (kind: string, message: string, line: number, excerpt: string) =>
    ({ kind, formName: "TestForm", widgetName: "testSearchButton", eventName: "Click", message, line, column: 1, excerpt });
const SCENARIOS = [
    {
        id: "S1-コードの誤り",
        code: "var kw = vja.widget.getValue('testSearchInput');\nvar rows = await vja.db.query('SELECT * FROM test_items WHERE name LIKE ?', ['%' + kw + '%']);\nvja.widget.setValue('testResultGrid', rows.items);\nvja.notify.toast(rows.items.length + '件見つかりました');",
        rt: RT("thrown", "undefined is not an object (evaluating 'rows.items.length')", 4,
            "1 var kw = vja.widget.getValue('testSearchInput');\n2 var rows = await vja.db.query('SELECT * FROM test_items WHERE name LIKE ?', ['%' + kw + '%']);\n3 vja.widget.setValue('testResultGrid', rows.items);\n4 vja.notify.toast(rows.items.length + '件見つかりました');"),
        // 誤ったプロパティ(rows.items)が消え、表test_itemsを使っていること（AIはYAMLに沿ってイベント全体を書き直す場合があるため、rows.lengthまでは要求しない）
        ok: (c: string) => !/\.items\b/.test(c) && /test_items/.test(c),
    },
    {
        id: "S2-握りつぶし(表名違い)",
        code: "var rows = [];\ntry {\n    rows = await vja.db.query('SELECT * FROM testitems');\n} catch (e) {\n    console.error(e);\n}\nvja.widget.setValue('testResultGrid', rows);",
        rt: RT("swallowed", "no such table: testitems", 3,
            "1 var rows = [];\n2 try {\n3     rows = await vja.db.query('SELECT * FROM testitems');\n4 } catch (e) {\n5     console.error(e);"),
        ok: (c: string) => /FROM\s+test_items/i.test(c) && !/FROM\s+testitems/i.test(c),
    },
    {
        id: "S3-外部要因(通信失敗)",
        code: "var res = await vja.fetch('https://api.example.com/items');\nvar items = JSON.parse(res.body);\nvja.widget.setValue('testResultGrid', items);",
        rt: RT("thrown", "fetch failed: ConnectionRefused", 1, "1 var res = await vja.fetch('https://api.example.com/items');\n2 var items = JSON.parse(res.body);\n3 vja.widget.setValue('testResultGrid', items);"),
        yaml: "説明: https://api.example.com/items から項目一覧(JSON配列)を取得し、testResultGridに表示する\n入力チェック: なし\nアクション:\n  - https://api.example.com/items をGETする\n  - 応答のJSONをtestResultGridに表示する\n正常終了: なし\nエラー終了: ログに出力",
        apiOpt: ["http"], // 実際にvja.fetchを使うイベントでは、任意API「http」が有効化されている
        ok: (c: string) => /vja\.(fetch|http\.get)\s*\(\s*['"]https:\/\/api\.example\.com\/items['"]/.test(c) && /\btry\b/.test(c) && /\bcatch\b/.test(c),
    },
    {
        // アプリイベント(OnStart。Bun側で実行)。報告はwidgetName="appev"
        id: "S4-アプリイベント(存在しないAPI)",
        isApp: true,
        code: "var rows = vja.db.queryAll('SELECT COUNT(*) AS cnt FROM test_items');\nvja.session.set('itemCount', String(rows[0].cnt));",
        yaml: "説明: 起動時にtest_itemsテーブルの件数を数え、セッションの itemCount に文字列で保存する\n入力チェック: なし\nアクション:\n  - test_itemsの件数をSELECT COUNTで取得する\n  - 件数を文字列にしてセッション itemCount へ保存する\n正常終了: なし\nエラー終了: ログに出力",
        rt: { kind: "thrown", formName: "", widgetName: "appev", eventName: "onStart", message: "vja.db.queryAll is not a function. (In 'vja.db.queryAll(\"SELECT COUNT(*) AS cnt FROM test_items\")', 'vja.db.queryAll' is undefined)", line: 1, column: 12, excerpt: " >   1: var rows = vja.db.queryAll('SELECT COUNT(*) AS cnt FROM test_items');\n     2: vja.session.set('itemCount', String(rows[0].cnt));" },
        ok: (c: string) => !/queryAll/.test(c) && /vja\.db\.query\s*\(/.test(c) && /session\.set\s*\(\s*['"]itemCount['"]/.test(c),
    },
];

const setup = async (apiOpt: string[] | undefined, appYaml?: string) => {
    const d = JSON.parse(JSON.stringify(base));
    if (appYaml) d.projectInfo = { ...(d.projectInfo || {}), appEvents: { onStart_yaml: appYaml } };
    d.apiOptOverrides = apiOpt ? { "2_Click": apiOpt } : {};
    let r = await call("testApplyProjectData", { data: d });
    if (!r.ok) throw new Error("applyProjectData: " + r.error);
    r = await call("testSetAiConfig", { endpoint: LLM.endpoint, model: LLM.model, apiKey: API_KEY || undefined, temperature: LLM.temperature ?? undefined });
    if (!r.ok) throw new Error("setAiConfig: " + r.error);
    await call("testSetAutoConfirm", { value: true });
};

const stat: Record<string, number> = {};
for (const sc of SCENARIOS) {
    stat[sc.id] = 0;
    await setup((sc as any).apiOpt, (sc as any).isApp ? (sc as any).yaml : undefined);
    // 説明(YAML)はAI修正プロンプトの元になるため、シナリオごとにコードと整合したものへ差し替える（指定が無ければ題材のまま）
    const ev = (base.forms[0].widgets.find((w: any) => w.id === 2).events || {}).Click;
    if (!(sc as any).isApp) await call("testSaveYaml", { wid: 2, evName: "Click", yaml: (sc as any).yaml || ev });
    for (let i = 1; i <= RUNS; i++) {
        // AI修正のプロンプトはYAMLをエディタ欄(DOM)から読む。修正実行中のローディング表示でエディタが閉じるため、毎回開き直す（実際の「AIで修正」と同じ状態）
        if ((sc as any).isApp) await call("testOpenModal", { fn: "openAppEvents" });
        else await call("testOpenYamlEditor", { wid: 2, evName: "Click" });
        const res = await call("testManualRetryAiFix", (sc as any).isApp
            ? { wid: "appev", evName: "onStart", isAppEvent: true, currentCode: sc.code, runtimeError: sc.rt }
            : { wid: 2, evName: "Click", currentCode: sc.code, runtimeError: sc.rt });
        const code: string = res.normalizedCode && res.code ? res.code : "";
        const judged = res.ok && !res.alreadyOk && sc.ok(code);
        if (judged) stat[sc.id]++;
        console.log("[" + sc.id + " #" + i + "] " + (judged ? "OK" : "NG") + (judged ? "" : " — " + (res.error || (res.alreadyOk ? "alreadyOk(修正依頼されず)" : code.replace(/\n/g, " / ").slice(0, Number(process.env.RTFIX_DETAIL || 200))))));
    }
}
await call("testSetAutoConfirm", { value: null });
console.log("\n--- 成功率 ---");
for (const [k, v] of Object.entries(stat)) console.log(k + ": " + v + "/" + RUNS);
