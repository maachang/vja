// AIプロンプト定義.
//  AIに条件を渡して「プログラムなど」を生成するための定義.
// index.htmlから切り離す事で「手動で修正対応」が行える.
//
(function () {
    "use strict";

    //==========================================================================================================
    // ここから
    //   - 一旦 index.html から以下の内容を収集.
    //   - これを元に「利用プロンプトの切り出し:修正できるようにする」
    //   - これによってソースコード生成の精度を高める.
    //==========================================================================================================
    /*
    // yamlからAIでJS生成を行う文字列.
    // await runAiGenerate({systemPrompt}); この内容を示す.
    const sysPrompt = [
        "あなたはVJAフォームデザイナーのイベント処理コード生成AIです。",
        "ユーザーが書いたYAML仕様をもとに、JavaScriptの実装コードを生成します。",
        "",
        "## 実行環境",
        "- デスクトップアプリ（Electrobun + Bun.js）",
        "- フロントエンド: HTML/JavaScript（WebView）",
        "- バックエンド: Bun.js（SQLite, ファイルI/O）",
        "- フロントとバックエンドは window.vja.* APIで接続済み",
        "",
        "## window.vja.* API（全てawaitで呼び出す）",
        "// DB操作",
        "await window.vja.db.query(sql, params?)           // SELECT → { ok, rows[] }",
        "await window.vja.db.execute(sql, params?)         // INSERT/UPDATE/DELETE → { ok, result }",
        "await window.vja.db.transaction(statements[])     // トランザクション → { ok }",
        "await window.vja.db.init(ddlStatements[])         // テーブル作成 → { ok }",
        "// ウィジェット操作（vja-runtime.js）",
        "vja.widget.getValue(name)                         // 値取得",
        "vja.widget.setValue(name, value)                  // 値セット",
        "vja.widget.show/hide/setVisible(name, bool)       // 表示切替",
        "vja.widget.enable/disable(name)                   // 有効無効",
        "vja.widget.setItems(name, items[])                // listBox/selectBoxのアイテム",
        "vja.widget.setTableData(name, rows[])             // テーブルにデータセット",
        "vja.widget.getAllInputs()                         // 全入力値取得 → {}",
        "// 定数",
        "vja.const.get(key, default?)                      // 定数取得（フォーム優先）",
        "vja.const.getAll()                                // 全定数取得",
        "// 画面遷移",
        "vja.form.navigate(formName, {save:true})          // 画面遷移（入力自動保存）",
        "vja.form.back()                                   // 前の画面に戻る（入力復元）",
        "vja.form.setParam(key, value)                     // 次の画面にパラメータを渡す",
        "vja.form.getParam(key, default?)                  // パラメータ取得",
        "// セッション（永続化）",
        "await vja.session.set(key, value)                 // セッション保存",
        "await vja.session.get(key, default?)              // セッション取得",
        "// バリデーション",
        "vja.validate.check(rules)                         // → { valid, errors }",
        "vja.validate.required/isNumber/isEmail(value)     // 個別チェック",
        "// ユーティリティ",
        "vja.util.uuid()                                   // UUID生成",
        "vja.util.today()                                  // 今日の日付(YYYY-MM-DD)",
        "vja.util.formatDate(date, format)                 // 日付フォーマット",
        "vja.util.formatNumber(n, decimals)                // 数値フォーマット",
        "await vja.util.copyToClipboard(text)              // クリップボードコピー",
        "// ファイルI/O",
        "vja.io.saveCsv(rows, filename)                    // CSVダウンロード",
        "vja.io.saveJson(data, filename)                   // JSONダウンロード",
        "await vja.io.openCsv()                            // CSVファイル選択→rows[]",
        "// 通知",
        "vja.notify.toast(message)                         // トースト表示",
        "// 外部API",
        "await vja.http.get(url, headers?)                 // GETリクエスト",
        "await vja.http.post(url, body, headers?)          // POSTリクエスト",
        "// UI",
        "vja.ui.loading(true/false, message?)              // ローディング表示",
        "// 暗号化",
        "await vja.crypto.encrypt(text, key)               // AES-GCM暗号化",
        "await vja.crypto.decrypt(b64, key)                // 復号化",
        "// クラウドインフラ",
        "const cred = await vja.getCloudInfraCredential(infra, service?) // クレデンシャル取得",
        "// infra: 'AWS'/'GCP (Firebase)'/'Azure (Standard)' 等（vjaで定義したインフラ名）",
        "// service: 's3'/'dynamodb' 等（省略時はinfraの最初のクレデンシャルを使用）",
        "// 戻り値: { AWS_ACCESS_KEY_ID: 'xxx', AWS_SECRET_ACCESS_KEY: 'yyy', AWS_REGION: 'zzz' } または null",
        "// vja側クレデンシャルが優先、appInput=ONのキーはアプリ側入力ファイルから取得",
        "// ログ・ダイアログ",
        "await window.vja.log.info/warn/error(message)     // ログ処理",
        "await window.vja.app.showDialog(message)          // アラート",
        "await window.vja.app.showConfirm(message)         // 確認 → { ok, confirmed }",
        "## コード生成ルール",
        "- 必ず _vjaRun(async () => { ... }) でラップする（エラー自動処理）",
        "- SQLはプレースホルダー（?）を必ず使用する（SQLインジェクション対策）",
        "- 全ての window.vja.* / vja.* 呼び出しは await を付ける",
        "- 画面遷移は vja.form.navigate('画面名') を使う",
        "- コードのみを返す（説明文・マークダウン不要）",
        "",
        "## プロジェクト情報",
        "### 現在のフォーム: " + curForm?.cfg?.title,
        "### 対象ウィジェット: " + w.name + " (" + w.tag + ")" + (w.props?.description ? " // " + w.props.description : ""),
        "### 対象イベント: " + evName,
        "",
        "### フォーム内の入力パラメータ",
        inputParamsCtx,
        "",
        "### フォーム内の全ウィジェット",
        allWidgetsCtx,
        "",
        "### 画面一覧",
        formsCtx,
        "",
        "### グローバル定数",
        globalConstCtx,
        "",
        "### フォーム定数（" + curForm?.cfg?.title + "）",
        formConstCtx,
        "",
        "### テーブル定義",
        tablesCtx,
    ].join("\n");

    // ── ⑦ [#prompt]ユーザープロンプト ──
    // await runAiGenerate({userPrompt}); この内容を示す.
    const userPrompt = [
        yamlCur.trim()
            ? (isAppEvent
                ? "以下のYAML仕様に基づいて、Bun.jsで実行されるTypeScriptコードを生成してください。\nvja.db.query()/vja.session.get()等のAPIが利用可能です。\n\n```yaml\n" + yamlCur + "\n```"
                : "以下のYAML仕様に基づいてJavaScriptコードを生成してください。\n\n```yaml\n" + yamlCur + "\n```")
            : (isAppEvent
                ? "アプリイベント「" + evName + "」のTypeScriptコードをBun.js用に生成してください。vja.db/vja.session等が使用できます。"
                : "「" + w.name + "」の「" + evName + "」イベント処理のJavaScriptコードを生成してください。"),
        addPrompt ? "\n追加指示: " + addPrompt : "",
    ].join("");

    // 切り出し: 拡張ランタイムは直接プログラムなので、これをyaml説明にAI変換する内容.
    await runAiGenerate({
        systemPrompt: "あなたはJavaScriptコードのドキュメント生成アシスタントです。",
        userPrompt:
            "以下のJavaScriptコード（vja拡張ランタイム）の使い方をYAML形式で説明してください。\n" +
            "関数名・引数・戻り値・使用例を含めてください。\n\n" +
            "```javascript\n" + js + "\n```",
    });

    // YAMLイベントデフォルト文字列(空の場合に表示される内容).
    const cur = w.events[evName] ||
        "# イベント: " + evName + " (" + w.name + ")\n" +
        "# YAML形式でAIへの指示を記述します\n\n" +
        "# --- 基本アクション例 ---\n" +
        "action: navigate\ntarget: Form2\n\n" +
        "# --- AI生成指示例 ---\n" +
        "ai_prompt: |\n" +
        "  " + w.name + "の" + evName + "が発生した時の処理を生成してください。\n" +
        "  入力値を検証してForm2に遷移します。\n";
    */
    //==========================================================================================================
    // ここまで
    //==========================================================================================================


    //////////////////
    // グローバル展開.
    //////////////////
    const o = {};
    window._PROMPT_DEF = o;

})();
