// イベントJS生成（YAML→JS）の失敗パターン集計E2E（Claude専用）
//
// 【目的】業務寄りの依頼（DB検索/登録/更新/削除、入力チェック、複数ウィジェット連携、条件分岐、繰り返し、
//   確認ダイアログ、画面遷移）を実LLMでYAML→JS生成し、「どの種類の失敗がどれだけ出るか」を数える。
//   測るだけで、製品コードは変えない。改善（機械検証・後処理の追加）の優先順位を決める材料にする。
//   YAMLは固定（ドラフト生成の揺らぎを混ぜない）。判定は次の3段:
//     1) 生成成否(GENFAIL)  2) 本番の検証validateGeneratedJs（種別: syntax/unknownApi/forbidden/missingAwait/unknownWidget/eventType）
//     3) 記録型モックの実行エラー(mockError)と、依頼の意図（宛先・値・API）との一致(intent)
// 【使い方】
//   1. `bun run mcp`（VJA_TEST_MODE=1でvjaが起動し、4570でテストサーバーが立つ）
//   2. bun run mcp/js-gen-e2e.ts [--runs N] [--only <idの一部,...>] [--out <結果JSONのパス>] [--preset <共通AIプリセット名の一部>]
//   接続先は mcp/fixtures/test-llm.local.json。結果は既定で.claudeWork/js-gen-result.json
// 【AIメモ】題材はprompt-integrity-test.vjaproj.jsonのテーブルtest_items(id,name,category)。ウィジェットはスクリプト内で組み立てる。
//   モックのdb.queryは固定のダミー値([{}])を返すため、DBの結果に依存する分岐の判定は「呼び出しの有無・SQLの形」に限る。
//   testApplyProjectDataはaiConfigも置き換えるので、適用の後にtestSetAiConfigを呼ぶ。起動中のvjaはprompts/*.mdを起動時のコピーで使う。
//   生成時の自動リトライを通った最終コードを検証するため、「検証NG」＝リトライしても直らなかったもの。
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const PORT = process.env.VJA_TEST_PORT || "4570";
const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const RUNS = Math.max(1, parseInt(opt("runs", "5"), 10) || 5);
const ONLY = opt("only", "").split(",").filter(Boolean);
const OUT = opt("out", join(ROOT, ".claudeWork/js-gen-result.json"));
const base = JSON.parse(readFileSync(join(ROOT, "mcp/fixtures/prompt-integrity-test.vjaproj.json"), "utf-8"));
const LLM = JSON.parse(readFileSync(join(ROOT, "mcp/fixtures/test-llm.local.json"), "utf-8"));
// --preset <共通AIプリセット名の一部>: アプリの共通プリセット(~/.vja-designer/ai-global-presets.json)で接続先を上書きする
// （APIキーありならOpenAI公式APIとして扱い、temperatureは送らない。キーは表示しない）
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
const call = async (m: string, p: any = {}) => {
    const r = await fetch("http://localhost:" + PORT + "/" + m, { method: "POST", body: JSON.stringify(p) });
    return await r.json() as any;
};

// widget-event-e2e.tsと同じ生成経路（エディタを開いてから本物のボタン操作フローで生成し、jsCodeを取り出す）
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

// ── 題材のウィジェット（名前→id、タグ） ──
const WIDGETS: [string, string][] = [
    ["testResultGrid", "datagrid"], ["testSearchButton", "button"], ["testSearchInput", "inputtype"], ["testSearchSelect", "selectBox"],
    ["edtName", "inputtype"], ["edtCategory", "inputtype"], ["chkAll", "checkbox"], ["msgLabel", "label"],
    ["btnSave", "button"], ["btnDelete", "button"], ["btnBack", "button"],
];
const mkWidgets = () => WIDGETS.map(([name, tag], i) => ({
    id: i + 1, name, tag, x: 10, y: 10 + i * 28, w: 120, h: 24, z: i + 2, props: {}, events: {}, jsCode: {}, docCode: {},
}));

type Call = [string, ...any[]];
const flat = (x: any) => JSON.stringify(x);
const toW = (c: Call[], name: string, apis = ["widget.set", "widget.setValue", "widget.setItems", "widget.setTableData"]) =>
    c.filter((x) => apis.includes(x[0]) && x[1] === name);

const yamlOf = (desc: string, check: string, actions: string[], ok = "なし", ng = "ログにエラーを出力") =>
    `説明: ${desc}\n入力チェック: ${check}\nアクション:\n${actions.map((a) => "  - " + a).join("\n")}\n正常終了: ${ok}\nエラー終了: ${ng}`;

interface Scenario {
    id: string; widget: string; evName: string; yaml: string; marker: string;
    tables: boolean;                                   // 利用テーブル(test_items)を指定するか
    apis?: string[];                                   // 有効にする任意APIカテゴリ（form/session/io/file等。既定は全て無効）
    intent: (code: string, calls: Call[]) => string;   // 空文字ならOK。NGなら理由
}
const S = (s: Scenario) => s;
const hasDb = (code: string, re: RegExp) => /vja\.db\.(query|execute)\s*\(/.test(code) && re.test(code);

const SCENARIOS: Scenario[] = [
    S({ id: "D1-全件検索", widget: "testSearchButton", evName: "Click", tables: true, marker: "全件",
        yaml: yamlOf("テーブルの全件を検索して一覧に表示する", "なし", ["test_itemsの全件を取得する", "取得結果をtestResultGridに表示する"]),
        intent: (code, c) => !hasDb(code, /SELECT[\s\S]*FROM\s+test_items/i) ? "SELECTが無い" : toW(c, "testResultGrid").length ? "" : "testResultGridへ渡していない" }),
    S({ id: "D2-条件検索", widget: "testSearchButton", evName: "Click", tables: true, marker: "testSearchInput",
        yaml: yamlOf("入力した名前で検索する", "なし", ["testSearchInputの値を取得する", "test_itemsのnameが入力値を含むレコードを検索する", "検索結果をtestResultGridに表示する"]),
        intent: (code, c) => !hasDb(code, /LIKE/i) ? "LIKE検索が無い" : toW(c, "testResultGrid").length ? "" : "testResultGridへ渡していない" }),
    S({ id: "D3-登録", widget: "btnSave", evName: "Click", tables: true, marker: "edtName",
        yaml: yamlOf("入力内容をテーブルへ登録する", "なし", ["edtNameとedtCategoryの値を取得する", "test_itemsへname,categoryを登録する", "「登録しました」とトースト表示する"]),
        intent: (code) => !hasDb(code, /INSERT\s+INTO\s+test_items/i) ? "INSERTが無い" : /登録しました/.test(code) ? "" : "トースト文言が無い" }),
    S({ id: "D4-更新", widget: "btnSave", evName: "Click", tables: true, marker: "edtCategory",
        yaml: yamlOf("名前が一致する行の分類を更新する", "なし", ["edtNameの値を取得する", "test_itemsのcategoryをedtCategoryの値に更新する(nameがedtNameの値と一致する行)", "更新後に「更新しました」とトースト表示する"]),
        intent: (code) => !hasDb(code, /UPDATE\s+test_items/i) ? "UPDATEが無い" : /WHERE/i.test(code) ? "" : "WHEREが無い" }),
    S({ id: "D5-削除確認", widget: "btnDelete", evName: "Click", tables: true, marker: "削除",
        yaml: yamlOf("確認してから名前が一致する行を削除する", "なし", ["「削除しますか?」と確認ダイアログを出す", "キャンセルなら何もしない", "OKならnameがedtNameの値と一致するレコードをtest_itemsから削除する"]),
        intent: (code) => !/vja\.app\.showConfirm/.test(code) ? "showConfirmが無い" : hasDb(code, /DELETE\s+FROM\s+test_items/i) ? "" : "DELETEが無い" }),
    S({ id: "D6-件数表示", widget: "testSearchButton", evName: "Click", tables: true, marker: "件数",
        yaml: yamlOf("テーブルの件数をラベルに表示する", "なし", ["test_itemsの件数を取得する", "msgLabelに「N件」の形式で表示する"]),
        intent: (code, c) => !hasDb(code, /COUNT/i) ? "COUNTが無い" : toW(c, "msgLabel").length ? "" : "msgLabelへ渡していない" }),
    S({ id: "C1-空入力チェック", widget: "btnSave", evName: "Click", tables: false, marker: "edtName",
        yaml: yamlOf("名前が空なら警告する", "edtNameが空でないこと", ["edtNameの値を取得する", "空の場合: 「名前を入力してください」とダイアログを表示して終了する", "それ以外の場合: msgLabelに「OK」と表示する"]),
        intent: (code, c) => !/名前を入力してください/.test(code) ? "警告文言が無い" : toW(c, "msgLabel").length || /msgLabel/.test(code) ? "" : "msgLabelが無い" }),
    S({ id: "C2-数値チェック", widget: "btnSave", evName: "Click", tables: false, marker: "数値",
        yaml: yamlOf("入力が数値か判定する", "なし", ["edtNameの値を取得する", "数値でない場合: msgLabelに「数値ではありません」と表示する", "それ以外の場合: msgLabelに「数値です」と表示する"]),
        intent: (code) => /数値ではありません/.test(code) && /数値です/.test(code) && /msgLabel/.test(code) ? "" : "分岐の文言またはmsgLabelが無い" }),
    S({ id: "W1-コピー", widget: "btnSave", evName: "Click", tables: false, marker: "edtCategory",
        yaml: yamlOf("名前の入力値を分類欄へコピーする", "なし", ["edtNameの値を取得する", "その値をedtCategoryに設定する"]),
        intent: (_c, c) => toW(c, "edtCategory").length ? "" : "edtCategoryへ設定していない" }),
    S({ id: "W2-連結", widget: "btnSave", evName: "Click", tables: false, marker: "連結",
        yaml: yamlOf("名前と分類を連結して表示する", "なし", ["edtNameとedtCategoryの値を取得する", "「名前(分類)」の形式で連結する", "msgLabelに表示する"]),
        intent: (_c, c) => toW(c, "msgLabel").length ? "" : "msgLabelへ設定していない" }),
    S({ id: "W3-表示切替", widget: "chkAll", evName: "CheckedChanged", tables: false, marker: "testResultGrid",
        yaml: yamlOf("チェックに応じて一覧の表示を切り替える", "なし", ["チェックされた場合: testResultGridを表示する", "それ以外の場合: testResultGridを非表示にする"]),
        intent: (code, c) => c.some((x) => /^widget\.(setVisible|show|hide)$/.test(x[0]) && x[1] === "testResultGrid") ? (/\bif\b|\?/.test(code) ? "" : "分岐が無い") : "表示切替を呼んでいない" }),
    S({ id: "W4-クリア", widget: "btnBack", evName: "Click", tables: false, marker: "クリア",
        yaml: yamlOf("入力欄をクリアする", "なし", ["edtNameとedtCategoryを空にする", "msgLabelを空にする"]),
        intent: (_c, c) => ["edtName", "edtCategory", "msgLabel"].every((n) => toW(c, n).length) ? "" : "クリア対象の一部へ設定していない" }),
    S({ id: "W5-選択肢", widget: "testSearchButton", evName: "Click", tables: true, marker: "testSearchSelect",
        yaml: yamlOf("テーブルの分類の一覧を選択ボックスへ設定する", "なし", ["test_itemsのcategoryの重複を除いた一覧を取得する", "testSearchSelectの選択肢に設定する"]),
        intent: (code, c) => !hasDb(code, /DISTINCT|GROUP\s+BY/i) ? "重複除去が無い" : toW(c, "testSearchSelect").length ? "" : "testSearchSelectへ設定していない" }),
    S({ id: "L1-繰り返し集計", widget: "testSearchButton", evName: "Click", tables: false, marker: "繰り返し",
        yaml: yamlOf("一覧の行数を数えてラベルに表示する", "なし", ["testResultGridの全行を取得する", "全行に対して繰り返し: 行数をカウントする", "msgLabelに件数を表示する"]),
        intent: (code, c) => !/\b(for|forEach|while|\.length)\b/.test(code) ? "繰り返し/lengthが無い" : toW(c, "msgLabel").length ? "" : "msgLabelへ渡していない" }),
    S({ id: "L2-行ごと更新", widget: "btnSave", evName: "Click", tables: true, marker: "全行",
        yaml: yamlOf("一覧の全行の分類を「済」に更新する", "なし", ["testResultGridの全行を取得する", "全行に対して繰り返し: test_itemsのcategoryを「済」に更新する(idが一致する行)", "「完了」とトースト表示する"]),
        intent: (code) => !/\b(for|forEach)\b/.test(code) ? "繰り返しが無い" : hasDb(code, /UPDATE\s+test_items/i) ? "" : "UPDATEが無い" }),
    S({ id: "N1-画面遷移", apis: ["form"], widget: "btnBack", evName: "Click", tables: false, marker: "戻る",
        yaml: yamlOf("前の画面へ戻る", "なし", ["前の画面へ戻る"]),
        intent: (code) => /vja\.form\.back\s*\(/.test(code) ? "" : "form.backが無い" }),
    S({ id: "N2-画面遷移パラメータ", apis: ["form"], widget: "testSearchButton", evName: "Click", tables: false, marker: "MenuForm",
        yaml: yamlOf("MenuForm画面へ、選択行のidを渡して遷移する", "なし", ["testResultGridの選択行のidを取得する", "idをパラメータ「itemId」として設定する", "MenuForm画面へ遷移する"]),
        intent: (code) => /vja\.form\.setParam\s*\(/.test(code) && /vja\.form\.navigate\s*\(/.test(code) ? "" : "setParam/navigateのどちらかが無い" }),
    S({ id: "M1-確認ダイアログ", widget: "btnSave", evName: "Click", tables: false, marker: "確認",
        yaml: yamlOf("確認してからメッセージを表示する", "なし", ["「実行しますか?」と確認ダイアログを出す", "OKなら msgLabelに「実行しました」と表示する"]),
        intent: (code, c) => !/await\s+vja\.app\.showConfirm/.test(code) ? "awaitつきのshowConfirmが無い" : toW(c, "msgLabel").length ? "" : "msgLabelへ設定していない" }),
    S({ id: "M2-セッション保存", apis: ["session"], widget: "testSearchButton", evName: "Click", tables: false, marker: "lastKeyword",
        yaml: yamlOf("検索語を覚えておく", "なし", ["testSearchInputの値を取得する", "セッションに「lastKeyword」として保存する"]),
        intent: (code) => /vja\.session\.set\s*\(\s*['"]lastKeyword['"]/.test(code) ? "" : "session.set('lastKeyword')が無い" }),
    S({ id: "M3-セッション読込", apis: ["session"], widget: "testSearchButton", evName: "Click", tables: false, marker: "lastKeyword",
        yaml: yamlOf("覚えておいた検索語を入力欄へ戻す", "なし", ["セッションから「lastKeyword」を取得する", "testSearchInputに設定する"]),
        intent: (code, c) => !/vja\.session\.get\s*\(\s*['"]lastKeyword['"]/.test(code) ? "session.get('lastKeyword')が無い" : toW(c, "testSearchInput").length ? "" : "testSearchInputへ設定していない" }),
    S({ id: "X1-CSV出力", apis: ["io","file"], widget: "btnSave", evName: "Click", tables: true, marker: "CSV",
        yaml: yamlOf("テーブルの内容をCSVで保存する", "なし", ["test_itemsの全件を取得する", "CSV形式に変換する", "ファイル保存ダイアログを出してCSVを保存する"]),
        intent: (code) => hasDb(code, /FROM\s+test_items/i) && /toCsv/.test(code) ? "" : "SELECTまたはtoCsvが無い" }),
    S({ id: "X2-日付", widget: "btnSave", evName: "Click", tables: false, marker: "今日",
        yaml: yamlOf("今日の日付をラベルに表示する", "なし", ["今日の日付を「yyyy-MM-dd」形式で取得する", "msgLabelに表示する"]),
        intent: (_c, c) => toW(c, "msgLabel").length ? "" : "msgLabelへ設定していない" }),
    S({ id: "X3-ローディング", widget: "testSearchButton", evName: "Click", tables: true, marker: "ローディング",
        yaml: yamlOf("ローディングを出しながら全件検索する", "なし", ["ローディング表示を開始する", "test_itemsの全件を取得してtestResultGridに表示する", "ローディング表示を終了する"]),
        intent: (code, c) => !/vja\.ui\.loading\s*\(\s*true/.test(code) || !/vja\.ui\.loading\s*\(\s*false/.test(code) ? "ui.loading(true/false)が揃っていない" : toW(c, "testResultGrid").length ? "" : "testResultGridへ渡していない" }),
    S({ id: "X4-エラー処理", widget: "testSearchButton", evName: "Click", tables: true, marker: "失敗",
        yaml: yamlOf("検索に失敗したら通知する", "なし", ["test_itemsの全件を取得する", "testResultGridに表示する"], "なし", "「検索に失敗しました」とダイアログ表示する"),
        intent: (code) => /try\b/.test(code) && /catch/.test(code) && /検索に失敗しました/.test(code) ? "" : "try/catchまたは失敗文言が無い" }),
];

// 検証結果から失敗種別へ（1つのコードが複数種別に当たることがあるので配列で返す）
const classify = (v: any): string[] => {
    if (!v) return ["validateError"];
    const k: string[] = [];
    if (v.syntaxError) k.push("syntax");
    for (const u of v.unknownApis || []) k.push("unknownApi" + (u.reason ? ":" + u.reason : ""));
    if ((v.forbiddenPatterns || []).length) k.push("forbidden");
    if ((v.missingAwaits || []).length) k.push("missingAwait");
    if ((v.unknownWidgets || []).length) k.push("unknownWidget");
    if ((v.eventTypeMismatches || []).length) k.push("eventType");
    return k;
};

const results: any[] = [];
const kindCount: Record<string, number> = {};
const perScn: Record<string, { ok: number; total: number }> = {};

await call("testSetAutoConfirm", { value: true });
for (const sc of SCENARIOS) {
    if (ONLY.length && !ONLY.some((o) => sc.id.includes(o))) continue;
    perScn[sc.id] = { ok: 0, total: 0 };
    for (let i = 1; i <= RUNS; i++) {
        const data = JSON.parse(JSON.stringify(base));
        const ws = mkWidgets();
        const src = ws.find((w) => w.name === sc.widget)!;
        src.events[sc.evName] = sc.yaml;
        data.forms[0].widgets = ws;
        data.forms[0].idCnt = ws.length + 1;
        data.tableOptOverrides = { ...(data.tableOptOverrides || {}), [src.id + "_" + sc.evName]: sc.tables ? ["test_items"] : [] };
        data.apiOptOverrides = { ...(data.apiOptOverrides || {}), [src.id + "_" + sc.evName]: sc.apis || [] };
        await call("testApplyProjectData", { data });
        await call("testSetAiConfig", { endpoint: LLM.endpoint, model: LLM.model, apiKey: API_KEY || undefined, temperature: LLM.temperature ?? undefined });
        const g = await generateViaEditor(src.id, sc.evName, sc.marker);
        let res: any = { id: sc.id, run: i };
        const kinds: string[] = [];
        if (!g.ok) { kinds.push("GENFAIL"); res.error = g.error; }
        else {
            res.code = g.code;
            const v = await call("testValidateJs", { code: g.code, evName: sc.evName, wtag: src.tag, wid: src.id });
            res.validation = v.result || null;
            kinds.push(...classify(v.ok ? v.result : null));
            const r = await call("testMockRunRecord", { code: g.code, evName: sc.evName, wtag: src.tag, wid: src.id });
            res.calls = r.calls || [];
            if (r.error) { kinds.push("mockError"); res.mockError = r.error; }
            const why = sc.intent(g.code, res.calls);
            if (why) { kinds.push("intent"); res.intent = why; }
        }
        res.kinds = kinds;
        res.status = kinds.length ? "NG" : "OK";
        perScn[sc.id].total++;
        if (!kinds.length) perScn[sc.id].ok++;
        for (const k of kinds) kindCount[k] = (kindCount[k] || 0) + 1;
        console.log(`${res.status.padEnd(3)} ${sc.id}#${i}` + (kinds.length ? "  [" + kinds.join(",") + "] " + (res.intent || res.mockError || res.error || "") : ""));
        results.push(res);
    }
}
await call("testSetAutoConfirm", { value: null });

const tot = results.length, okN = results.filter((r) => r.status === "OK").length;
console.log(`\n=== 合計 ${okN}/${tot} OK ===`);
console.log("--- 依頼別 ---");
for (const [id, v] of Object.entries(perScn)) console.log(`${id.padEnd(22)} ${v.ok}/${v.total}`);
console.log("--- 失敗種別（件数。1件が複数種別に当たることがある） ---");
for (const [k, n] of Object.entries(kindCount).sort((a, b) => b[1] - a[1])) console.log(`${k.padEnd(28)} ${n}`);
writeFileSync(OUT, JSON.stringify({ model: LLM.model, runs: RUNS, summary: { ok: okN, total: tot, perScn, kindCount }, results }, null, 2));
console.log("結果: " + OUT);
process.exit(0);
