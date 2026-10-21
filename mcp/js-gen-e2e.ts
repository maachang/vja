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
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const PORT = process.env.VJA_TEST_PORT || "4570";
const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const RUNS = Math.max(1, parseInt(opt("runs", "5"), 10) || 5);
const ONLY = opt("only", "").split(",").filter(Boolean);
const OUT = opt("out", join(ROOT, ".claudeWork/js-gen-result.json"));
// アプリのログ（`bun run mcp > <このファイル>`で起動した場合）から、生成時の自動リトライの有無・初回の検出内容を読む
const APPLOG = opt("applog", join(ROOT, ".claudeWork/mcp-run.log"));
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

// アプリログのサイズ（この位置以降が、その生成で出た行）
const logSize = () => { try { return statSync(APPLOG).size; } catch { return -1; } };
// 位置fromより後の`[AI検証]`行から、リトライの有無・初回の検出内容・解消したかを読む（ログが読めなければnull）
const readRetryInfo = (from: number) => {
    if (from < 0) return null;
    try {
        const buf = readFileSync(APPLOG);
        const lines = buf.subarray(from).toString("utf-8").split("\n").filter((l) => l.includes("[AI検証]"));
        const start = lines.find((l) => l.includes("自動修正リトライを実行します"));
        if (!start) return { retried: false, firstIssues: "", resolved: null as boolean | null };
        const issues = start.split("検出内容: ")[1] || "";
        const resolved = lines.some((l) => l.includes("リトライで解消しました")) ? true : lines.some((l) => l.includes("未解消")) ? false : null;
        return { retried: true, firstIssues: issues, resolved };
    } catch { return null; }
};

// アプリイベント版の生成（エディタを開いてから本物のボタン操作フローで生成し、データモデルのJSを取り出す）
const generateAppEvent = async (evName: string, marker: string) => {
    const o = await call("testOpenAppEvents", { evName });
    if (!o.ok) return { ok: false, error: o.error };
    const f = await call("testYamlAiGenerateFull", { wid: "appev", evName });
    if (!f.ok) return { ok: false, error: f.error };
    if (!(f.prompt?.userPrompt || "").includes(marker)) return { ok: false, error: "プロンプトにYAML本文が入っていない: " + marker };
    for (let i = 0; i < 40; i++) {
        const r = await call("testGetAppEvent", { evName });
        if (r.js) return { ok: true, code: r.js };
        await new Promise((r2) => setTimeout(r2, 250));
    }
    return { ok: false, error: "生成コードが保存されなかった（タイムアウト）" };
};

// ── 題材のウィジェット（名前→id、タグ） ──
const WIDGETS: [string, string][] = [
    ["testResultGrid", "datagrid"], ["testSearchButton", "button"], ["testSearchInput", "inputtype"], ["testSearchSelect", "selectBox"],
    ["edtName", "inputtype"], ["edtCategory", "inputtype"], ["chkAll", "checkbox"], ["msgLabel", "label"],
    ["btnSave", "button"], ["btnDelete", "button"], ["btnBack", "button"],
    ["sldQty", "slider"], ["dtpFrom", "datepicker"], ["pbDone", "progressbar"], ["lstItems", "listbox"],
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
    app?: boolean;                                     // アプリイベント(widget="appev"、Bun側で実行)
    apis?: string[];                                   // 有効にする任意APIカテゴリ（form/session/io/file等。既定は全て無効）
    intent: (code: string, calls: Call[]) => string;   // 空文字ならOK。NGなら理由
}
const S = (s: Scenario) => s;
// アプリイベント(Bun側)の実行環境（src/bun/project-runner.tsの_runAppEventCode）に実際は無いAPI。
// プロンプト(vja-back-api-full)にもモックにも載っているが、実行環境のvjaは session.get/set/delete、db.query/execute/clearTable、log.* のみ（2026-10-21確認）。
// ※バック側のvja.*は同期関数だがawaitを付けても無害（AsyncFunctionで実行）なので、awaitの有無は判定しない。
const backMissing = (code: string) => { const m = code.match(/vja\.(db\.(importCsv|importJson)|session\.clear)\s*\(/); return m ? "実行環境に無いAPI: " + m[0].replace(/\s*\($/, "") : ""; };
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

    // ── 種類・パターンを増やした依頼（2026-10-21）。イベント種別・ウィジェット種別・任意APIを広げる ──
    S({ id: "R1-行クリック", widget: "testResultGrid", evName: "RowClick", tables: false, marker: "クリックされた行",
        yaml: yamlOf("クリックした行の名前を入力欄へ入れる", "なし", ["クリックされた行の番号を取得する", "testResultGridの全行から、その行のnameを取り出してedtNameに設定する"]),
        intent: (code, c) => !/vja\.event\.get\s*\(/.test(code) ? "vja.event.getが無い" : /await\s+vja\.event\.get/.test(code) ? "event.getにawaitを付けている" : toW(c, "edtName").length ? "" : "edtNameへ設定していない" }),
    S({ id: "R2-行クリック分類", widget: "testResultGrid", evName: "RowClick", tables: false, marker: "分類",
        yaml: yamlOf("クリックした行の分類をラベルに表示する", "なし", ["クリックされた行の番号を取得する", "testResultGridの全行から、その行のcategoryを取り出す", "msgLabelに「分類: 〇〇」の形式で表示する"]),
        intent: (code, c) => !/vja\.event\.get\s*\(/.test(code) ? "vja.event.getが無い" : toW(c, "msgLabel").length ? "" : "msgLabelへ設定していない" }),
    S({ id: "R3-ヘッダークリック", widget: "testResultGrid", evName: "HeaderClick", tables: false, marker: "列名",
        yaml: yamlOf("クリックした列名をラベルに表示する", "なし", ["クリックされた列名を取得する", "msgLabelに表示する"]),
        intent: (code, c) => !/vja\.event\.get\s*\(/.test(code) ? "vja.event.getが無い" : /\.column\b/.test(code) ? (toW(c, "msgLabel").length ? "" : "msgLabelへ設定していない") : ".columnを使っていない" }),
    S({ id: "K1-Enterで検索", widget: "edtName", evName: "KeyDown", tables: false, marker: "Enter",
        yaml: yamlOf("Enterキーが押されたら検索ボタンをクリックする", "なし", ["Enterキーが押された場合: testSearchButtonをクリックする"]),
        intent: (code) => !/vja\.event\.(isEnter|getKey)\s*\(/.test(code) ? "isEnter/getKeyが無い" : /vja\.trigger\.click\s*\(\s*['"]testSearchButton['"]/.test(code) ? "" : "trigger.click('testSearchButton')が無い" }),
    S({ id: "K2-Escでクリア", widget: "edtName", evName: "KeyDown", tables: false, marker: "Escape",
        yaml: yamlOf("Escapeキーで入力欄を空にする", "なし", ["Escapeキーが押された場合: edtNameを空にする"]),
        intent: (code, c) => !/vja\.event\.(isEscape|getKey)\s*\(/.test(code) ? "isEscape/getKeyが無い" : toW(c, "edtName").length || /edtName/.test(code) ? "" : "edtNameを空にしていない" }),
    S({ id: "T1-文字数表示", widget: "edtName", evName: "TextChanged", tables: false, marker: "文字数",
        yaml: yamlOf("入力された文字数をラベルに表示する", "なし", ["edtNameの値を取得する", "文字数を数える", "msgLabelに「N文字」の形式で表示する"]),
        intent: (code, c) => !/\.length\b/.test(code) ? ".lengthが無い" : toW(c, "msgLabel").length ? "" : "msgLabelへ設定していない" }),
    S({ id: "T2-有効無効", widget: "edtName", evName: "TextChanged", tables: false, marker: "btnSave",
        yaml: yamlOf("名前が入力されている時だけ保存ボタンを押せるようにする", "なし", ["edtNameの値を取得する", "空でない場合: btnSaveを有効にする", "それ以外の場合: btnSaveを無効にする"]),
        intent: (code, c) => c.some((x) => /^widget\.(enable|disable|set|setValue)$/.test(x[0]) && x[1] === "btnSave") ? (/\bif\b|\?/.test(code) ? "" : "分岐が無い") : "btnSaveの有効/無効を切り替えていない" }),
    S({ id: "S1-選択値コピー", widget: "testSearchSelect", evName: "SelectedIndexChanged", tables: false, marker: "選択",
        yaml: yamlOf("選択された値を検索入力欄へ入れる", "なし", ["testSearchSelectの選択値を取得する", "testSearchInputに設定する"]),
        intent: (_c, c) => toW(c, "testSearchInput").length ? "" : "testSearchInputへ設定していない" }),
    S({ id: "S2-分類で絞込", widget: "testSearchSelect", evName: "SelectedIndexChanged", tables: true, marker: "絞り込",
        yaml: yamlOf("選択された分類で一覧を絞り込む", "なし", ["testSearchSelectの選択値を取得する", "test_itemsのcategoryが選択値と一致するレコードを検索する", "検索結果をtestResultGridに表示する"]),
        intent: (code, c) => !hasDb(code, /WHERE[\s\S]*category/i) ? "category条件のSELECTが無い" : toW(c, "testResultGrid").length ? "" : "testResultGridへ渡していない" }),
    S({ id: "V1-スライダ表示", widget: "sldQty", evName: "ValueChanged", tables: false, marker: "数量",
        yaml: yamlOf("スライダの値をラベルに表示する", "なし", ["sldQtyの値を取得する", "msgLabelに「数量: N」の形式で表示する"]),
        intent: (code, c) => /数量/.test(code) && toW(c, "msgLabel").length ? "" : "msgLabelへ「数量」付きで設定していない" }),
    S({ id: "V2-スライダ連動", widget: "sldQty", evName: "ValueChanged", tables: false, marker: "pbDone",
        yaml: yamlOf("スライダの値を進捗バーへ反映する", "なし", ["sldQtyの値を取得する", "pbDoneの値に設定する"]),
        intent: (_c, c) => toW(c, "pbDone").length ? "" : "pbDoneへ設定していない" }),
    S({ id: "P1-Load一覧", widget: "lstItems", evName: "Load", tables: true, marker: "lstItems",
        yaml: yamlOf("画面表示時に名前の一覧をリストボックスへ設定する", "なし", ["test_itemsのnameの一覧を取得する", "lstItemsの項目に設定する"]),
        intent: (code, c) => !hasDb(code, /SELECT[\s\S]*name/i) ? "name取得のSELECTが無い" : toW(c, "lstItems").length ? "" : "lstItemsへ設定していない" }),
    S({ id: "DT1-日付比較", widget: "dtpFrom", evName: "TextChanged", tables: false, marker: "過去",
        yaml: yamlOf("日付が過去かどうかを表示する", "なし", ["dtpFromの値を取得する", "今日の日付と比べる", "今日より前の場合: msgLabelに「過去の日付です」と表示する", "それ以外の場合: msgLabelに「OK」と表示する"]),
        apis: ["util"],
        intent: (code, c) => /過去の日付です/.test(code) && /OK/.test(code) && toW(c, "msgLabel").length ? "" : "分岐の文言またはmsgLabelが無い" }),
    S({ id: "Q1-トランザクション", widget: "btnSave", evName: "Click", tables: true, marker: "トランザクション",
        yaml: yamlOf("2件の登録を1つのトランザクションで行う", "なし", ["test_itemsへ、edtNameの値で1件、「(コピー)」を付けた名前で1件、合わせて2件を1つのトランザクションで登録する", "「登録しました」とトースト表示する"]),
        intent: (code) => /vja\.db\.transaction\s*\(/.test(code) && /INSERT/i.test(code) ? "" : "db.transactionまたはINSERTが無い" }),
    S({ id: "Q2-0件分岐", widget: "testSearchButton", evName: "Click", tables: true, marker: "データがありません",
        yaml: yamlOf("検索結果が0件ならメッセージを出す", "なし", ["test_itemsの全件を取得する", "0件の場合: 「データがありません」とダイアログを表示する", "それ以外の場合: testResultGridに表示する"]),
        intent: (code, c) => !/\.length\b/.test(code) ? ".lengthが無い" : /データがありません/.test(code) && /await\s+vja\.app\.showDialog/.test(code) && toW(c, "testResultGrid").length ? "" : "ダイアログ(await)または一覧設定が無い" }),
    S({ id: "Q3-集計", widget: "testSearchButton", evName: "Click", tables: true, marker: "分類ごと",
        yaml: yamlOf("分類ごとの件数を一覧に表示する", "なし", ["test_itemsを分類ごとに集計して件数を取得する", "結果をtestResultGridに表示する"]),
        intent: (code, c) => !hasDb(code, /GROUP\s+BY[\s\S]*category|category[\s\S]*GROUP\s+BY/i) ? "GROUP BY categoryが無い" : toW(c, "testResultGrid").length ? "" : "testResultGridへ渡していない" }),
    S({ id: "Q4-重複チェック", widget: "btnSave", evName: "Click", tables: true, marker: "重複",
        yaml: yamlOf("同じ名前が既にあれば登録しない", "なし", ["test_itemsにedtNameの値と同じnameのレコードがあるか検索する", "ある場合: 「重複しています」とダイアログを表示して終了する", "ない場合: test_itemsへ登録する"]),
        intent: (code) => hasDb(code, /SELECT/i) && /INSERT\s+INTO\s+test_items/i.test(code) && /重複しています/.test(code) ? "" : "SELECT/INSERT/重複文言のいずれかが無い" }),
    S({ id: "H1-HTTP取得", widget: "testSearchButton", evName: "Click", tables: false, marker: "example.com",
        yaml: yamlOf("Web APIからデータを取得して一覧に表示する", "なし", ["https://example.com/api/items にGETリクエストを送る", "返ってきたJSONの配列をtestResultGridに表示する"]),
        apis: ["http"],
        intent: (code, c) => !/await\s+vja\.(http\.get|fetch)\s*\(/.test(code) ? "awaitつきのhttp.get/fetchが無い" : toW(c, "testResultGrid").length ? "" : "testResultGridへ渡していない" }),
    S({ id: "F1-ファイル書込", widget: "btnSave", evName: "Click", tables: false, marker: "memo.txt",
        yaml: yamlOf("ラベルの内容をテキストファイルへ保存する", "なし", ["msgLabelの内容を取得する", "memo.txtへ書き込む", "「保存しました」とトースト表示する"]),
        apis: ["file"],
        intent: (code) => /await\s+vja\.file\.write\s*\(/.test(code) && /memo\.txt/.test(code) ? "" : "awaitつきのfile.write('memo.txt')が無い" }),
    S({ id: "F2-ファイル読込", widget: "btnSave", evName: "Click", tables: false, marker: "memo.txt",
        yaml: yamlOf("テキストファイルがあれば内容をラベルに表示する", "なし", ["memo.txtが存在するか確認する", "存在する場合: 内容を読み込んでmsgLabelに表示する", "存在しない場合: msgLabelに「ファイルがありません」と表示する"]),
        apis: ["file"],
        intent: (code, c) => /await\s+vja\.file\.exists\s*\(/.test(code) && /await\s+vja\.file\.read\s*\(/.test(code) && toW(c, "msgLabel").length ? "" : "exists/read(await)またはmsgLabel設定が無い" }),
    S({ id: "E1-ハッシュ", widget: "btnSave", evName: "Click", tables: false, marker: "SHA256",
        yaml: yamlOf("名前をSHA256でハッシュ化して表示する", "なし", ["edtNameの値を取得する", "SHA256でハッシュ化する", "msgLabelに表示する"]),
        intent: (code, c) => !/await\s+vja\.crypto\.sha256\s*\(/.test(code) ? "awaitつきのvja.crypto.sha256が無い（独自実装の可能性）" : toW(c, "msgLabel").length ? "" : "msgLabelへ設定していない" }),
    S({ id: "E2-他ボタン発火", widget: "testSearchButton", evName: "Click", tables: false, marker: "btnSave",
        yaml: yamlOf("検索ボタンを押したら保存ボタンのクリックも実行する", "なし", ["btnSaveをクリックする"]),
        intent: (code) => /vja\.trigger\.click\s*\(\s*['"]btnSave['"]/.test(code) ? "" : "trigger.click('btnSave')が無い" }),
    S({ id: "Z1-全入力JSON", widget: "btnSave", evName: "Click", tables: false, marker: "JSON",
        yaml: yamlOf("全ての入力値をまとめてJSON文字列にして表示する", "なし", ["画面の全入力値を取得する", "JSON文字列に変換する", "msgLabelに表示する"]),
        intent: (code, c) => !/vja\.widget\.getAllInputs\s*\(/.test(code) ? "getAllInputsが無い" : !/JSON\.stringify/.test(code) ? "JSON.stringifyが無い" : toW(c, "msgLabel").length ? "" : "msgLabelへ設定していない" }),
    S({ id: "Z3-ダイアログ後閉じる", widget: "btnBack", evName: "Click", tables: false, marker: "終了",
        yaml: yamlOf("メッセージを表示してからアプリを終了する", "なし", ["「終了します」とダイアログを表示する", "ダイアログが閉じられたらアプリの画面を閉じる"]),
        intent: (code) => { const i = code.search(/await\s+vja\.app\.showDialog/), j = code.search(/vja\.app\.closeWindow\s*\(/); return i < 0 ? "awaitつきshowDialogが無い" : j < 0 ? "closeWindowが無い" : i < j ? "" : "closeWindowがダイアログより前"; } }),
    S({ id: "Z4-登録クリア再検索", widget: "btnSave", evName: "Click", tables: true, marker: "再表示",
        yaml: yamlOf("登録したら入力欄を空にして一覧を再表示する", "なし", ["test_itemsへedtNameとedtCategoryの値を登録する", "edtNameとedtCategoryを空にする", "test_itemsの全件を取得してtestResultGridに表示する"]),
        intent: (code, c) => !/INSERT\s+INTO\s+test_items/i.test(code) ? "INSERTが無い" : !["edtName", "edtCategory"].every((n) => toW(c, n).length) ? "入力欄をクリアしていない" : toW(c, "testResultGrid").length ? "" : "testResultGridへ渡していない" }),
    S({ id: "Z5-複数分岐", widget: "btnSave", evName: "Click", tables: false, marker: "ランク",
        yaml: yamlOf("分類の値によってランクを表示する", "なし", ["edtCategoryの値を取得する", "「A」の場合: msgLabelに「ランク1」と表示する", "「B」の場合: msgLabelに「ランク2」と表示する", "それ以外の場合: msgLabelに「ランク3」と表示する"]),
        intent: (code, c) => ["ランク1", "ランク2", "ランク3"].every((v) => code.includes(v)) && toW(c, "msgLabel").length ? "" : "3つの文言またはmsgLabel設定が無い" }),

    // ── アプリイベント（Bun側で実行。vja.db.query/execute/session.*/log.*は同期、importCsv/importJsonのみawait） ──
    S({ id: "A1-起動件数保存", app: true, widget: "appev", evName: "onStart", tables: true, marker: "itemCount",
        yaml: yamlOf("起動時にテーブルの件数をセッションへ保存する", "なし", ["test_itemsの件数を取得する", "セッションに「itemCount」として件数を保存する"]),
        intent: (code) => (!hasDb(code, /COUNT/i) ? "COUNTが無い" : /vja\.session\.set\s*\(\s*['"]itemCount['"]/.test(code) ? "" : "session.set('itemCount')が無い") }),
    S({ id: "A2-初期データ投入", app: true, widget: "appev", evName: "onStart", tables: true, marker: "初期データ",
        yaml: yamlOf("テーブルが空なら初期データを登録する", "なし", ["test_itemsの件数を取得する", "0件の場合: name「サンプル1」「サンプル2」「サンプル3」の3件を登録する"]),
        intent: (code) => (!hasDb(code, /COUNT/i) ? "COUNTが無い" : /INSERT\s+INTO\s+test_items/i.test(code) && /サンプル3/.test(code) ? "" : "INSERTまたはサンプル3が無い") }),
    S({ id: "A3-起動ログ", app: true, widget: "appev", evName: "onStart", tables: false, marker: "起動しました",
        yaml: yamlOf("起動したことをログに残す", "なし", ["「起動しました」を情報ログに出力する"]),
        intent: (code) => (/vja\.log\.info\s*\(/.test(code) && /起動しました/.test(code) ? "" : "log.info('起動しました')が無い") }),
    S({ id: "A4-セッション初期化", app: true, widget: "appev", evName: "onStart", tables: false, marker: "startedAt",
        yaml: yamlOf("前回のセッションを消して、起動時刻を保存する", "なし", ["セッションを全て消す", "セッションに「startedAt」として現在の日時（ISO形式の文字列）を保存する"]),
        intent: (code) => (!/vja\.session\.clear\s*\(/.test(code) ? "session.clearが無い" : /vja\.session\.set\s*\(\s*['"]startedAt['"]/.test(code) ? "" : "session.set('startedAt')が無い") }),
    S({ id: "A5-CSV取込", app: true, widget: "appev", evName: "onStart", tables: true, marker: "items.csv",
        yaml: yamlOf("起動時にCSVファイルをテーブルへ取り込む", "なし", ["/data/items.csvをtest_itemsへ取り込む"]),
        intent: (code) => /await\s+vja\.db\.importCsv\s*\(\s*['"]test_items['"]/.test(code) && /items\.csv/.test(code) ? "" : "awaitつきのdb.importCsv('test_items', …items.csv)が無い" }),
    S({ id: "A7-終了セッション", app: true, widget: "appev", evName: "onExit", tables: false, marker: "セッション",
        yaml: yamlOf("終了時にセッションを全て消す", "なし", ["セッションを全て消す"]),
        intent: (code) => (/vja\.session\.clear\s*\(/.test(code) ? "" : "session.clearが無い") }),
    S({ id: "A8-終了ログ件数", app: true, widget: "appev", evName: "onExit", tables: true, marker: "終了時",
        yaml: yamlOf("終了時の件数をログに残す", "なし", ["test_itemsの件数を取得する", "「終了時の件数: N」の形式で情報ログに出力する"]),
        intent: (code) => (!hasDb(code, /COUNT/i) ? "COUNTが無い" : /vja\.log\.info\s*\(/.test(code) && /終了時の件数/.test(code) ? "" : "log.info('終了時の件数')が無い") }),
    S({ id: "A9-空分類削除", app: true, widget: "appev", evName: "onExit", tables: true, marker: "分類が空",
        yaml: yamlOf("終了時に分類が空のレコードを削除する", "なし", ["test_itemsのうち、categoryが空（NULLまたは空文字）のレコードを削除する"]),
        intent: (code) => (hasDb(code, /DELETE\s+FROM\s+test_items[\s\S]*category/i) ? "" : "category条件のDELETEが無い") }),
    S({ id: "A10-起動時エラーログ", app: true, widget: "appev", evName: "onStart", tables: true, marker: "失敗",
        yaml: yamlOf("件数の取得に失敗したら警告ログを出す", "なし", ["test_itemsの件数を取得する", "取得できなかった場合: 「件数の取得に失敗しました」を警告ログに出力する"]),
        intent: (code) => (/vja\.log\.warn\s*\(/.test(code) && /件数の取得に失敗しました/.test(code) ? "" : "log.warn('件数の取得に失敗しました')が無い") }),
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
const perScnRetry: Record<string, { retried: number; resolved: number }> = {};

await call("testSetAutoConfirm", { value: true });
for (const sc of SCENARIOS) {
    if (ONLY.length && !ONLY.some((o) => sc.id.includes(o))) continue;
    perScn[sc.id] = { ok: 0, total: 0 };
    perScnRetry[sc.id] = { retried: 0, resolved: 0 };
    for (let i = 1; i <= RUNS; i++) {
        const data = JSON.parse(JSON.stringify(base));
        const ws = mkWidgets();
        const src = sc.app ? { id: "appev", tag: undefined as string | undefined } : ws.find((w) => w.name === sc.widget)!;
        if (sc.app) { data.projectInfo = { ...(data.projectInfo || {}), appEvents: { [sc.evName + "_yaml"]: sc.yaml } }; }
        else (src as any).events[sc.evName] = sc.yaml;
        data.forms[0].widgets = ws;
        data.forms[0].idCnt = ws.length + 1;
        data.tableOptOverrides = { ...(data.tableOptOverrides || {}), [src.id + "_" + sc.evName]: sc.tables ? ["test_items"] : [] };
        data.apiOptOverrides = { ...(data.apiOptOverrides || {}), [src.id + "_" + sc.evName]: sc.apis || [] };
        await call("testApplyProjectData", { data });
        await call("testSetAiConfig", { endpoint: LLM.endpoint, model: LLM.model, apiKey: API_KEY || undefined, temperature: LLM.temperature ?? undefined });
        const logFrom = logSize();
        const g = sc.app ? await generateAppEvent(sc.evName, sc.marker) : await generateViaEditor(src.id as number, sc.evName, sc.marker);
        await new Promise((r) => setTimeout(r, 500)); // ログの書き出し待ち
        let res: any = { id: sc.id, run: i, retry: readRetryInfo(logFrom) };
        const kinds: string[] = [];
        if (!g.ok) { kinds.push("GENFAIL"); res.error = g.error; }
        else {
            res.code = g.code;
            const v = await call("testValidateJs", { code: g.code, evName: sc.evName, wtag: src.tag, wid: src.id, isAppEvent: !!sc.app });
            res.validation = v.result || null;
            kinds.push(...classify(v.ok ? v.result : null));
            const r = await call("testMockRunRecord", { code: g.code, evName: sc.evName, wtag: src.tag, wid: src.id, isAppEvent: !!sc.app });
            res.calls = r.calls || [];
            if (r.error) { kinds.push("mockError"); res.mockError = r.error; }
            if (sc.app) { const bm = backMissing(g.code); if (bm) { kinds.push("runtimeMissing"); res.runtimeMissing = bm; } }
            const why = sc.intent(g.code, res.calls);
            if (why) { kinds.push("intent"); res.intent = why; }
        }
        res.kinds = kinds;
        res.status = kinds.length ? "NG" : "OK";
        if (res.retry?.retried) { perScnRetry[sc.id].retried++; if (res.retry.resolved) perScnRetry[sc.id].resolved++; }
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
const withLog = results.filter((r) => r.retry);
if (withLog.length) {
    const retried = withLog.filter((r) => r.retry.retried).length;
    const firstOk = results.filter((r) => r.retry && !r.retry.retried && r.status === "OK").length;
    console.log(`--- リトライ（ログから。ログ有り ${withLog.length}/${tot}回） ---`);
    console.log(`初回で検証OK（リトライ無し）かつ最終OK: ${firstOk}/${withLog.length}  /  リトライした: ${retried}/${withLog.length}（うち解消 ${withLog.filter((r) => r.retry.retried && r.retry.resolved).length}）`);
    for (const [id, v] of Object.entries(perScnRetry)) if (v.retried) console.log(`  ${id.padEnd(22)} リトライ ${v.retried}/${perScn[id].total}（解消 ${v.resolved}）`);
    const byIssue: Record<string, number> = {};
    for (const r of withLog) if (r.retry.retried) { const k = r.retry.firstIssues.replace(/[0-9]+行目/g, "N行目").slice(0, 60); byIssue[k] = (byIssue[k] || 0) + 1; }
    console.log("  初回の検出内容:");
    for (const [k, n] of Object.entries(byIssue).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)}  ${k}`);
}
console.log("--- 失敗種別（件数。1件が複数種別に当たることがある） ---");
for (const [k, n] of Object.entries(kindCount).sort((a, b) => b[1] - a[1])) console.log(`${k.padEnd(28)} ${n}`);
writeFileSync(OUT, JSON.stringify({ model: LLM.model, runs: RUNS, summary: { ok: okN, total: tot, perScn, kindCount, perScnRetry }, results }, null, 2));
console.log("結果: " + OUT);
process.exit(0);
