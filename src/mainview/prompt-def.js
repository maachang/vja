// AIプロンプト定義.
//  AIに条件を渡して「プログラムなど」を生成するための定義.
// index.htmlから切り離す事で「手動で修正対応」が行える.
//
(function () {
    "use strict";

    // 利用可能なjavascript関数の説明.
    // AI以外に、js利用者向けのvjaランタイム説明等に利用を想定.
    const VJA_USE_JS_INFO = `
## 実行環境
- デスクトップアプリ（Electrobun + Bun.js）
- フロントエンド: HTML/JavaScript（WebView）
- バックエンド: Bun.js（SQLite, ファイルI/O）
- フロントとバックエンドは window.vja.* APIで接続済み

## window.vja.* API（全てawaitで呼び出す）
// DB操作
await window.vja.db.query(sql, params?)           // SELECT → { ok, rows[] }
await window.vja.db.execute(sql, params?)         // INSERT/UPDATE/DELETE → { ok, result }
await window.vja.db.transaction(statements[])     // トランザクション → { ok }
await window.vja.db.init(ddlStatements[])         // テーブル作成 → { ok }

// ウィジェット操作（vja-runtime.js）
vja.widget.getValue(name)                         // 値取得
vja.widget.setValue(name, value)                  // 値セット
vja.widget.show/hide/setVisible(name, bool)       // 表示切替
vja.widget.enable/disable(name)                   // 有効無効
vja.widget.setItems(name, items[])                // listBox/selectBoxのアイテム
vja.widget.setTableData(name, rows[])             // テーブルにデータセット
vja.widget.getAllInputs()                         // 全入力値取得 → {}

// 定数
vja.const.get(key, default?)                      // 定数取得（フォーム優先）
vja.const.getAll()                                // 全定数取得

// 画面遷移
vja.form.navigate(formName, {save:true})          // 画面遷移（入力自動保存）
vja.form.back()                                   // 前の画面に戻る（入力復元）
vja.form.setParam(key, value)                     // 次の画面にパラメータを渡す
vja.form.getParam(key, default?)                  // パラメータ取得

// セッション（永続化）
await vja.session.set(key, value)                 // セッション保存
await vja.session.get(key, default?)              // セッション取得

// バリデーション
vja.validate.check(rules)                         // → { valid, errors }
vja.validate.required/isNumber/isEmail(value)     // 個別チェック

// ユーティリティ
vja.util.uuid()                                   // UUID生成
vja.util.today()                                  // 今日の日付(YYYY-MM-DD)
vja.util.formatDate(date, format)                 // 日付フォーマット
vja.util.formatNumber(n, decimals)                // 数値フォーマット
await vja.util.copyToClipboard(text)              // クリップボードコピー

// ファイルI/O
vja.io.saveCsv(rows, filename)                    // CSVダウンロード
vja.io.saveJson(data, filename)                   // JSONダウンロード
await vja.io.openCsv()                            // CSVファイル選択→rows[]

// 通知
vja.notify.toast(message)                         // トースト表示

// 外部API
await vja.http.get(url, headers?)                 // GETリクエスト
await vja.http.post(url, body, headers?)          // POSTリクエスト

// UI
vja.ui.loading(true/false, message?)              // ローディング表示

// 暗号化
await vja.crypto.encrypt(text, key)               // AES-GCM暗号化
await vja.crypto.decrypt(b64, key)                // 復号化

// クラウドインフラ
const cred = await vja.getCloudInfraCredential(infra, service?) // クレデンシャル取得
// ※vja側クレデンシャルが優先、appInput=ONのキーはアプリ側入力ファイルから取得
// - infra: 'AWS'/'GCP (Firebase)'/'Azure (Standard)' 等（vjaで定義したインフラ名）
// - service: 's3'/'dynamodb' 等（省略時はinfraの最初のクレデンシャルを使用）
// - 戻り値: AWSの場合: { AWS_ACCESS_KEY_ID: 'xxx', AWS_SECRET_ACCESS_KEY: 'yyy', AWS_REGION: 'zzz' } または null

// ログ・ダイアログ
await window.vja.log.info/warn/error(message)     // ログ処理
await window.vja.app.showDialog(message)          // アラート
await window.vja.app.showConfirm(message)         // 確認 → { ok, confirmed }

## コード生成ルール(原則)
- 必ず _vjaRun(async () => { ... }) でラップする（エラー自動処理）
- SQLはプレースホルダー (?) を必ず使用する（SQLインジェクション対策）
- 全ての window.vja.* / vja.* 呼び出しは await を付ける
- 画面遷移は vja.form.navigate('画面名') を使う(※ window.location は絶対に使っては駄目)
- コードのみを返す（説明文・マークダウン不要）
`.trim();

    // YAMLからjsに変換する場合のシステムプロンプトを生成.
    // - formName: [任意]form名を設定します.
    // - eventName: [任意]イベント名を設定します.
    // - wname: [任意]ウィジット名を設定します.
    // - wtag: [任意]ウィジットタグ名を設定します.
    // - wdescription: [任意]ウィジット詳細を設定します.
    // - inputParamsCtx: [任意]フォーム内の入力パラメータ情報を設定します.
    // - allWidgetsCtx: [任意]フォーム内の全ウィジェット情報を設定します.
    // - formsCtx: [任意]画面(Form)一覧を設定します.
    // - globalConstCtx: [任意]グローバル定数を設定します.
    // - formConstCtx: [任意]対処ウィジットを設置してるフォーム定数を設定します.
    // - tablesCtx: [任意]テーブル定義内容を設定します.
    const YAML_TO_JS_SYS_PROMPT = function (
        { formName, eventName, wname, wtag, wdescription,
            inputParamsCtx, allWidgetsCtx, formsCtx, globalConstCtx,
            formConstCtx, tablesCtx }) {

        return `
あなたは日本語を専門とするVJAフォームデザイナーのイベント処理コード生成AIです。
ユーザーが書いたYAML仕様をもとに、JavaScriptの実装コードを生成します。

${VJA_USE_JS_INFO}

## プロジェクト情報
### 現在のフォーム: ${formName}
### 対象ウィジェット: ${wname} ${wtag}) ${wdescription ? "//" + wdescription : ""}
### 対象イベント: ${eventName}

### フォーム内の入力パラメータ
${inputParamsCtx}

### フォーム内の全ウィジェット
${allWidgetsCtx}

### 画面一覧
${formsCtx}

### グローバル定数
${globalConstCtx}

### フォーム定数（${formName}）
${formConstCtx}

### テーブル定義
${tablesCtx}
`.trim() + "\n";
    }

    // YAMLからjsに変換する場合のユーザプロンプトを生成.
    // - isAppEvent: [必須]定義されている場合はアプリイベント(bunネイティブ実行)で、存在しない場合はイベント系(js)で実行.
    // - yamlTableDef: [必須]定義されている場合は「テーブルをyamlでセットしてヒント」とする.
    // - addPrompt: [必須]ユーザ設定で追加プロンプトが存在する場合、設定します.
    // - formName: [任意]form名を設定します.
    // - eventName: [任意]イベント名を設定します.
    // - wname: [任意]ウィジット名を設定します.
    // - wtag: [任意]ウィジットタグ名を設定します.
    // - wdescription: [任意]ウィジット詳細を設定します.
    // - inputParamsCtx: [任意]フォーム内の入力パラメータ情報を設定します.
    // - allWidgetsCtx: [任意]フォーム内の全ウィジェット情報を設定します.
    // - formsCtx: [任意]画面(Form)一覧を設定します.
    // - globalConstCtx: [任意]グローバル定数を設定します.
    // - formConstCtx: [任意]対処ウィジットを設置してるフォーム定数を設定します.
    // - tablesCtx: [任意]テーブル定義内容を設定します.
    // 戻り値: ユーザプロンプトが返却されます.
    const YAML_TO_JS_USER_PROMPT = function (isAppEvent, yamlTableDef, addPrompt,
        { formName, eventName, wname, wtag, wdescription,
            inputParamsCtx, allWidgetsCtx, formsCtx, globalConstCtx,
            formConstCtx, tablesCtx }) {
        let ret;
        // yaml定義に「利用テーブル」定義が存在する場合.
        if (yamlTableDef.trim()) {
            // isAppEvent: true の場合、アプリイベント(bunネイティブ実行).
            if (isAppEvent) {
                // アプリイベント: bun(rpc実行先）の生成処理(ts).
                ret = "アプリイベント「" + eventName +
                    "」をBun.jsで実行するTypeScriptコードとして、以下のYAML仕様に基づいて生成してください。\n" +
                    "vja.db.query() / vja.session.get()等のAPIが利用可能です。";
            } else {
                // ウィジットイベント(js).
                ret = "「" + wname + "」の「" + eventName +
                    "」イベント処理に対して、以下のYAML仕様に基づいてJavaScriptコードを生成してください。";
            }
            // [共通]テーブル定義.
            ret = ret +
                "\n" +
                "```yaml\n" +
                yamlTableDef +
                "\n```";
        }
        // 「利用テーブル」定義が存在しない場合.
        else {
            // isAppEvent: true の場合、アプリイベント(bunネイティブ実行).
            if (isAppEvent) {
                // アプリイベント: bun(rpc実行先）の生成処理.(ts).
                ret = "アプリイベント「" + eventName +
                    "」をBun.jsで実行されるTypeScriptコードとして生成してください。\n" +
                    "vja.db.query() / vja.session.get()等のAPIが利用可能です。";
            }
            else {
                // ウィジットイベント(js).
                ret = "「" + wname + "」の「" + eventName +
                    "」イベント処理のJavaScriptコードを生成してください。";
            }
        }
        // 追加指示がある場合はセット.
        return ret + "\n\n" +
            (addPrompt ? "\n追加指示: " + addPrompt : "");
    }

    // 拡張ランタイム用システムプロンプト.
    const EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT = function () {
        // システムプロンプト.
        return "あなたは日本語を専門とするJavaScriptコードのドキュメント生成アシスタントです。";
    }

    // 拡張ランタイム用ユーザプロンプト.
    const EXT_RUNTIME_JS_TO_YAML_USER_PROMPT = function (js) {
        // ユーザプロンプト.
        const ret = `
以下のJavaScriptコード（vja拡張ランタイム）の使い方をYAML形式で説明してください。
関数名・引数・戻り値・使用例を含めてください。
`
        // 最後に対象とするJSファイル内容をセット.
        return ret.trim() + "\n\n```javascript\n" + js + "```\n";
    }

    // プログラム生成におけるYAMLが存在しない場合にセット
    const DEFAULT_YAML_VALUE = function (eventName, wname) {
        return `
# イベント: ${eventName} (${wname})
# YAML形式でAIへの指示を記述します

# --- 基本アクション例 ---
action: navigate
target: Form2

# --- AI生成指示例 ---
ai_prompt: |
  ${wname} の ${eventName} が発生した時の処理を生成してください。
  入力値を検証してForm2に遷移します。
`.trim();
    }

    //////////////////
    // グローバル展開.
    //////////////////
    const o = {};
    window._PROMPT_DEF = o;

    // 利用可能関数一覧: js利用者向けのvjaランタイム説明等.
    o.VJA_USE_JS_INFO = VJA_USE_JS_INFO;

    // [プロンプト]yamlから js AI生成依頼.
    o.YAML_TO_JS_SYS_PROMPT = YAML_TO_JS_SYS_PROMPT;
    o.YAML_TO_JS_USER_PROMPT = YAML_TO_JS_USER_PROMPT;

    // [プロンプト]拡張ランタイムyamlから js AI生成依頼.
    o.EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT = EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT;
    o.EXT_RUNTIME_JS_TO_YAML_USER_PROMPT = EXT_RUNTIME_JS_TO_YAML_USER_PROMPT;

    // イベント用yamlエディタ初期値.
    o.DEFAULT_YAML_VALUE = DEFAULT_YAML_VALUE;

})();
