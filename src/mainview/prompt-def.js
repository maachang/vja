// AIプロンプト定義.
//  AIに条件を渡して「プログラムなど」を生成するための定義.
// index.htmlから切り離す事で「手動で修正対応」が行える.
//
(function () {
    "use strict";

    // [フロントエンド]利用可能なjavascript関数の説明.
    // AI以外に、js利用者向けのvjaランタイム説明等に利用を想定.
    const VJA_USE_FRONT_JS_INFO = `
## 実行環境
- フロントエンド: HTML/JavaScript（WebView）

## 関数説明.
~~~yaml
# VJA Runtime API 関数一覧
# window.vja.* / vja.* で利用可能なAPI定義
# ※ await が必要な関数には必ず await を付けること

## DB操作 (window.vja.db.*)

- 関数名: await window.vja.db.query(sql, params?):
  - 説明: SQLのSELECT文を実行して結果行を返す
  - 引数:
    - sql: string - 実行するSQL文（プレースホルダー ? を使用）
    - params?: (string|number|boolean|null)[] - プレースホルダーに渡す値の配列（省略可）
  - 戻り値: "{ ok: boolean, rows: Record<string, any>[] } - ok=trueの場合rows に結果行の配列"
  - 使用例: "const result = await window.vja.db.query('SELECT * FROM users WHERE id = ?', [1]);"
  - 使用例説明: usersテーブルからid=1のレコードを取得する

- 関数名: await window.vja.db.execute(sql, params?):
  - 説明: SQLのINSERT/UPDATE/DELETE文を実行する
  - 引数:
    - sql: string - 実行するSQL文（プレースホルダー ? を使用）
    - params?: (string|number|boolean|null)[] - プレースホルダーに渡す値の配列（省略可）
  - 戻り値: "{ ok: boolean, result: { changes: number, lastInsertRowid: number } }"
  - 使用例: "await window.vja.db.execute('INSERT INTO users (name, age) VALUES (?, ?)', ['山田', 30]);"
  - 使用例説明: usersテーブルに新しいレコードを挿入する

- 関数名: await window.vja.db.transaction(statements[]):
  - 説明: 複数のSQL文をトランザクションとして実行する
  - 引数:
    - statements: "{ sql: string, params?: any[] }[] - 実行するSQL文と引数のペアの配列"
  - 戻り値: "{ ok: boolean } - 全文実行成功でok=true、失敗時はロールバック"
  - 使用例: |
      await window.vja.db.transaction([
        { sql: 'INSERT INTO orders (item) VALUES (?)', params: ['商品A'] },
        { sql: 'UPDATE stock SET qty = qty - 1 WHERE item = ?', params: ['商品A'] }
      ]);
  - 使用例説明: 注文登録と在庫更新を1つのトランザクションで実行する

- 関数名: await window.vja.db.init(ddlStatements[]):
  - 説明: テーブル作成（CREATE TABLE IF NOT EXISTS）を実行する
  - 引数:
    - ddlStatements: string[] - DDL文の配列
  - 戻り値: "{ ok: boolean }"
  - 使用例: "await window.vja.db.init(['CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)']);"
  - 使用例説明: usersテーブルが存在しない場合に作成する

## ウィジェット操作 (vja.widget.*)

- 関数名: vja.widget.getValue(name):
  - 説明: 指定名のウィジェットの現在値を取得する
  - 引数:
    - name: string - ウィジェット名
  - 戻り値: "string | number | boolean | null - ウィジェットの値"
  - 使用例: "const name = vja.widget.getValue('txtName');"
  - 使用例説明: txtNameウィジェットの入力値を取得する

- 関数名: vja.widget.setValue(name, value):
  - 説明: 指定名のウィジェットに値をセットする
  - 引数:
    - name: string - ウィジェット名
    - value: string|number|boolean - セットする値
  - 戻り値: なし
  - 使用例: "vja.widget.setValue('txtResult', '処理完了');"
  - 使用例説明: txtResultウィジェットに「処理完了」をセットする

- 関数名: vja.widget.show(name):
  - 説明: 指定名のウィジェットを表示する
  - 引数:
    - name: string - ウィジェット名
  - 戻り値: なし
  - 使用例: "vja.widget.show('btnSubmit');"
  - 使用例説明: btnSubmitを表示する

- 関数名: vja.widget.hide(name):
  - 説明: 指定名のウィジェットを非表示にする
  - 引数:
    - name: string - ウィジェット名
  - 戻り値: なし
  - 使用例: "vja.widget.hide('btnSubmit');"
  - 使用例説明: btnSubmitを非表示にする

- 関数名: vja.widget.setVisible(name, visible):
  - 説明: 指定名のウィジェットの表示/非表示を切り替える
  - 引数:
    - name: string - ウィジェット名
    - visible: boolean - trueで表示、falseで非表示
  - 戻り値: なし
  - 使用例: "vja.widget.setVisible('btnDelete', isAdmin);"
  - 使用例説明: isAdminがtrueの場合のみ削除ボタンを表示する

- 関数名: vja.widget.enable(name):
  - 説明: 指定名のウィジェットを有効にする
  - 引数:
    - name: string - ウィジェット名
  - 戻り値: なし
  - 使用例: "vja.widget.enable('btnSubmit');"
  - 使用例説明: 送信ボタンを有効にする

- 関数名: vja.widget.disable(name):
  - 説明: 指定名のウィジェットを無効にする
  - 引数:
    - name: string - ウィジェット名
  - 戻り値: なし
  - 使用例: "vja.widget.disable('btnSubmit');"
  - 使用例説明: 送信ボタンを無効にする

- 関数名: vja.widget.setItems(name, items[]):
  - 説明: selectBoxまたはlistBoxのアイテムをセットする
  - 引数:
    - name: string - ウィジェット名
    - "items: string[] | { label: string, value: string }[] - アイテムの配列"
  - 戻り値: なし
  - 使用例: "vja.widget.setItems('selCategory', ['食品', '電化製品', '衣類']);"
  - 使用例説明: カテゴリー選択ボックスにアイテムをセットする

- 関数名: vja.widget.setTableData(name, rows[]):
  - 説明: テーブルウィジェットにデータをセットする
  - 引数:
    - name: string - テーブルウィジェット名
    - rows: Record<string, any>[] - 行データの配列
  - 戻り値: なし
  - 使用例: |
      vja.widget.setTableData('tblUsers', [
        { name: '山田', age: 30 },
        { name: '鈴木', age: 25 }
      ]);
  - 使用例説明: ユーザーテーブルに2行のデータをセットする

- 関数名: vja.widget.getAllInputs():
  - 説明: フォーム内の全入力ウィジェットの値を取得する
  - 引数: なし
  - 戻り値: "Record<string, any> - { ウィジェット名: 値 } の形式"
  - 使用例: "const inputs = vja.widget.getAllInputs();"
  - 使用例説明: フォーム内の全入力値を一括取得する

## 定数 (vja.const.*)

- 関数名: vja.const.get(key, default?):
  - 説明: 定数を取得する。フォーム定数が優先され、なければグローバル定数を返す
  - 引数:
    - key: string - 定数名
    - default?: any - 定数が存在しない場合のデフォルト値（省略可）
  - 戻り値: any - 定数値またはデフォルト値
  - 使用例: "const apiUrl = vja.const.get('API_URL', 'http://localhost:3000');"
  - 使用例説明: API_URL定数を取得し、未定義の場合はデフォルト値を返す

- 関数名: vja.const.getAll():
  - 説明: 全定数を取得する（フォーム定数がグローバル定数を上書き）
  - 引数: なし
  - 戻り値: "Record<string, any> - { 定数名: 値 } の形式"
  - 使用例: "const allConst = vja.const.getAll();"
  - 使用例説明: 全定数をまとめて取得する

## 画面遷移 (vja.form.*)

- 関数名: vja.form.navigate(formName, options?):
  - 説明: 指定した画面に遷移する。デフォルトで現在の入力値を保存する
  - 引数:
    - formName: string - 遷移先のフォーム名
    - "options?: { save?: boolean } - save=falseで入力値を保存しない（省略時はtrue）"
  - 戻り値: なし
  - 例外: showFormが未定義の場合は警告を出力
  - 使用例: "vja.form.navigate('Form2');"
  - 使用例説明: 現在の入力を保存してForm2に遷移する

- 関数名: vja.form.back():
  - 説明: 前の画面に戻り、入力内容を復元する
  - 引数: なし
  - 戻り値: なし
  - 使用例: "vja.form.back();"
  - 使用例説明: 前の画面に戻り、その時点の入力値を復元する

- 関数名: vja.form.setParam(key, value):
  - 説明: 次の画面に渡すパラメータをセットする
  - 引数:
    - key: string - パラメータ名
    - value: any - パラメータ値
  - 戻り値: なし
  - 使用例: |
      vja.form.setParam('userId', 123);
      vja.form.navigate('Form2');
  - 使用例説明: userIdパラメータをセットしてForm2に遷移する

- 関数名: vja.form.getParam(key, default?):
  - 説明: 前の画面から渡されたパラメータを取得する
  - 引数:
    - key: string - パラメータ名
    - default?: any - パラメータが存在しない場合のデフォルト値（省略可）
  - 戻り値: any - パラメータ値またはデフォルト値
  - 使用例: "const userId = vja.form.getParam('userId', null);"
  - 使用例説明: 前の画面からuserIdパラメータを取得する

## セッション (vja.session.*)

- 関数名: await vja.session.set(key, value):
  - 説明: セッションにキーと値を保存する（永続化）
  - 引数:
    - key: string - セッションキー
    - value: any - 保存する値（JSON変換される）
  - 戻り値: なし
  - 使用例: "await vja.session.set('loginUser', { id: 1, name: '山田' });"
  - 使用例説明: ログインユーザー情報をセッションに保存する

- 関数名: await vja.session.get(key, default?):
  - 説明: セッションからキーに対応する値を取得する
  - 引数:
    - key: string - セッションキー
    - default?: any - 存在しない場合のデフォルト値（省略可）
  - 戻り値: any - セッション値またはデフォルト値
  - 使用例: "const user = await vja.session.get('loginUser', null);"
  - 使用例説明: セッションからログインユーザー情報を取得する

## バリデーション (vja.validate.*)

- 関数名: vja.validate.check(rules):
  - 説明: 複数ウィジェットの入力値をルールに従って一括バリデーションする
  - 引数:
    - "rules: Record<string, { required?: boolean, maxLength?: number, ... }> - バリデーションルール"
  - 戻り値: "{ valid: boolean, errors: Record<string, string> } - validがfalseの場合errorsにエラーメッセージ"
  - 使用例: |
      const { valid, errors } = vja.validate.check({
        txtName: { required: true },
        txtEmail: { required: true, isEmail: true }
      });
      if (!valid) { vja.widget.setValue('lblError', Object.values(errors).join('\n')); return; }
  - 使用例説明: 名前とメールアドレスの入力チェックを行い、エラーがあれば表示する

- 関数名: vja.validate.required(value):
  - 説明: 値が空でないかチェックする
  - 引数:
    - value: any - チェックする値
  - 戻り値: boolean - 空でなければtrue
  - 使用例: "if (!vja.validate.required(vja.widget.getValue('txtName'))) return;"
  - 使用例説明: 名前が未入力の場合は処理を中断する

- 関数名: vja.validate.isNumber(value):
  - 説明: 値が数値かチェックする
  - 引数:
    - value: any - チェックする値
  - 戻り値: boolean - 数値であればtrue
  - 使用例: "if (!vja.validate.isNumber(vja.widget.getValue('txtAge'))) return;"
  - 使用例説明: 年齢が数値でない場合は処理を中断する

- 関数名: vja.validate.isEmail(value):
  - 説明: 値がメールアドレス形式かチェックする
  - 引数:
    - value: any - チェックする値
  - 戻り値: boolean - メールアドレス形式であればtrue
  - 使用例: "if (!vja.validate.isEmail(vja.widget.getValue('txtEmail'))) return;"
  - 使用例説明: メールアドレスの形式チェックを行う

## ユーティリティ (vja.util.*)

- 関数名: vja.util.uuid():
  - 説明: UUID v4形式の一意な文字列を生成する
  - 引数: なし
  - 戻り値: string - "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx" 形式のUUID
  - 使用例: "const id = vja.util.uuid();"
  - 使用例説明: 新しいレコードのIDとして使用するUUIDを生成する

- 関数名: vja.util.today():
  - 説明: 今日の日付をYYYY-MM-DD形式で返す
  - 引数: なし
  - 戻り値: string - "YYYY-MM-DD" 形式の日付文字列
  - 使用例: "vja.widget.setValue('txtDate', vja.util.today());"
  - 使用例説明: 日付入力欄に今日の日付をセットする

- 関数名: vja.util.formatDate(date, format?):
  - 説明: 日付をフォーマットして文字列で返す
  - 引数:
    - date: Date|string - フォーマットする日付
    - "format?: string - フォーマット文字列（デフォルト: 'YYYY-MM-DD'）。YYYY/MM/DD/HH/mm/ss が使用可"
  - 戻り値: string - フォーマットされた日付文字列
  - 使用例: "const str = vja.util.formatDate(new Date(), 'YYYY年MM月DD日');"
  - 使用例説明: 今日の日付を「2026年06月11日」形式にフォーマットする

- 関数名: vja.util.formatNumber(n, decimals?):
  - 説明: 数値を桁区切り付きの文字列にフォーマットする
  - 引数:
    - n: number - フォーマットする数値
    - decimals?: number - 小数点以下の桁数（省略可）
  - 戻り値: string - フォーマットされた数値文字列
  - 使用例: "vja.widget.setValue('lblPrice', vja.util.formatNumber(1234567));"
  - 使用例説明: 価格を「1,234,567」形式で表示する

- 関数名: await vja.util.copyToClipboard(text):
  - 説明: テキストをクリップボードにコピーする
  - 引数:
    - text: string - コピーするテキスト
  - 戻り値: boolean - コピー成功でtrue
  - 使用例: "await vja.util.copyToClipboard(vja.widget.getValue('txtCode'));"
  - 使用例説明: 入力コードをクリップボードにコピーする

## ファイルI/O (vja.io.*)

- 関数名: await vja.io.openCsv():
  - 説明: ファイル選択ダイアログでCSVファイルを選択して読み込む
  - 引数: なし
  - 戻り値: "Record<string, string>[] | null - CSVの各行をオブジェクトにした配列"
  - 例外: ファイル選択をキャンセルした場合はnullを返す
  - 使用例: |
      const rows = await vja.io.openCsv();
      if (rows) vja.widget.setTableData('tblData', rows);
  - 使用例説明: CSVを読み込んでテーブルに表示する

- 関数名: await vja.io.openJson():
  - 説明: ファイル選択ダイアログでJSONファイルを選択して読み込む
  - 引数: なし
  - 戻り値: "any | null - パースされたJSONデータ"
  - 例外: JSON解析失敗時はエラーをスロー
  - 使用例: |
      const data = await vja.io.openJson();
      if (data) vja.widget.setValue('txtData', JSON.stringify(data));
  - 使用例説明: JSONファイルを読み込んで内容を表示する

- 関数名: vja.io.saveCsv(rows, filename):
  - 説明: データをCSV形式でダウンロードする
  - 引数:
    - rows: Record<string, any>[] - 保存する行データの配列
    - filename: string - ダウンロードするファイル名
  - 戻り値: なし
  - 使用例: "vja.io.saveCsv(rows, 'users.csv');"
  - 使用例説明: ユーザーデータをCSVファイルとしてダウンロードする

- 関数名: vja.io.saveJson(data, filename):
  - 説明: データをJSON形式でダウンロードする
  - 引数:
    - data: any - 保存するデータ
    - filename: string - ダウンロードするファイル名
  - 戻り値: なし
  - 使用例: "vja.io.saveJson({ users: rows }, 'backup.json');"
  - 使用例説明: データをJSONファイルとしてダウンロードする

## 通知 (vja.notify.*)

- 関数名: vja.notify.toast(message, duration?):
  - 説明: 画面下部にトースト通知を表示する
  - 引数:
    - message: string - 表示するメッセージ
    - duration?: number - 表示時間ミリ秒（デフォルト: 2500）
  - 戻り値: なし
  - 使用例: "vja.notify.toast('保存しました');"
  - 使用例説明: 保存完了のトースト通知を表示する

## 外部API (vja.http.*)

- 関数名: await vja.http.get(url, headers?):
  - 説明: HTTP GETリクエストを送信する
  - 引数:
    - url: string - リクエスト先URL
    - headers?: Record<string, string> - リクエストヘッダー（省略可）
  - 戻り値: any - レスポンスのJSONオブジェクトまたはテキスト
  - 例外: HTTPエラー時はエラーをスロー
  - 使用例: "const data = await vja.http.get('https://api.example.com/users');"
  - 使用例説明: ユーザー一覧をAPIから取得する

- 関数名: await vja.http.post(url, body, headers?):
  - 説明: HTTP POSTリクエストを送信する
  - 引数:
    - url: string - リクエスト先URL
    - body: object|string - リクエストボディ（オブジェクトはJSON変換される）
    - headers?: Record<string, string> - リクエストヘッダー（省略可）
  - 戻り値: any - レスポンスのJSONオブジェクトまたはテキスト
  - 例外: HTTPエラー時はエラーをスロー
  - 使用例: "const res = await vja.http.post('https://api.example.com/users', { name: '山田', age: 30 });"
  - 使用例説明: 新しいユーザーをAPIに登録する

- 関数名: await vja.http.put(url, body, headers?):
  - 説明: HTTP PUTリクエストを送信する
  - 引数:
    - url: string - リクエスト先URL
    - body: object|string - リクエストボディ
    - headers?: Record<string, string> - リクエストヘッダー（省略可）
  - 戻り値: any - レスポンスのJSONオブジェクトまたはテキスト
  - 例外: HTTPエラー時はエラーをスロー
  - 使用例: "await vja.http.put('https://api.example.com/users/1', { name: '山田太郎' });"
  - 使用例説明: ユーザー情報を更新する

- 関数名: await vja.http.delete(url, headers?):
  - 説明: HTTP DELETEリクエストを送信する
  - 引数:
    - url: string - リクエスト先URL
    - headers?: Record<string, string> - リクエストヘッダー（省略可）
  - 戻り値: any - レスポンスのJSONオブジェクトまたはテキスト
  - 例外: HTTPエラー時はエラーをスロー
  - 使用例: "await vja.http.delete('https://api.example.com/users/1');"
  - 使用例説明: ユーザーを削除する

## UI (vja.ui.*)

- 関数名: vja.ui.loading(show, message?):
  - 説明: ローディングオーバーレイを表示/非表示にする
  - 引数:
    - show: boolean - trueで表示、falseで非表示
    - message?: string - 表示するメッセージ（デフォルト: 「処理中…」）
  - 戻り値: なし
  - 使用例: |
      vja.ui.loading(true, 'データを取得中...');
      const rows = await window.vja.db.query('SELECT * FROM users');
      vja.ui.loading(false);
  - 使用例説明: DB取得中にローディングを表示し、完了後に非表示にする

## 暗号化 (vja.crypto.*)

- 関数名: await vja.crypto.encrypt(text, key):
  - 説明: テキストをAES-GCMで暗号化してBase64文字列で返す
  - 引数:
    - text: string - 暗号化するテキスト
    - key: string - 暗号化キー（32文字以内）
  - 戻り値: string - Base64形式の暗号化文字列
  - 使用例: "const encrypted = await vja.crypto.encrypt('秘密情報', 'mySecretKey');"
  - 使用例説明: テキストを暗号化して保存用の文字列を生成する

- 関数名: await vja.crypto.decrypt(b64, key):
  - 説明: Base64形式の暗号化文字列を復号する
  - 引数:
    - b64: string - Base64形式の暗号化文字列
    - key: string - 復号キー（暗号化時と同じキー）
  - 戻り値: string - 復号されたテキスト
  - 例外: キーが異なる場合はエラーをスロー
  - 使用例: "const text = await vja.crypto.decrypt(encrypted, 'mySecretKey');"
  - 使用例説明: 暗号化されたテキストを元の内容に復号する

## クラウドインフラ (vja.getCloudInfraCredential)

- 関数名: await vja.getCloudInfraCredential(infra, service?):
  - 説明: |
      クラウドインフラのクレデンシャル（認証情報）を取得する。
      vja側で定義したクレデンシャルが最優先となり、appInput=ONのキーはアプリ側入力ファイル（~/vja/credential.json等）から取得する
  - 引数:
    - "infra: string - インフラ名（例: 'AWS', 'GCP (Firebase)', 'Azure (Standard)'）"
    - "service?: string - サービス名（例: 's3', 'dynamodb'）。省略時はinfraの最初のクレデンシャルを使用"
  - 戻り値: "Record<string, string> | null - クレデンシャルのキーと値のオブジェクト。取得できない場合はnull"
  - 使用例: |
      const cred = await vja.getCloudInfraCredential('AWS', 's3');
      if (!cred) { vja.notify.toast('クレデンシャルが取得できません'); return; }
      // cred = { AWS_ACCESS_KEY_ID: 'xxx', AWS_SECRET_ACCESS_KEY: 'yyy', AWS_REGION: 'ap-northeast-1' }
  - 使用例説明: AWSのS3サービス向けクレデンシャルを取得する

## ログ・ダイアログ

- 関数名: await window.vja.log.info(message):
  - 説明: INFOレベルのログをBun側に記録する
  - 引数:
    - message: string - ログメッセージ
  - 戻り値: なし
  - 使用例: "await window.vja.log.info('処理が完了しました');"
  - 使用例説明: 処理完了をログに記録する

- 関数名: await window.vja.log.warn(message):
  - 説明: WARNレベルのログをBun側に記録する
  - 引数:
    - message: string - ログメッセージ
  - 戻り値: なし
  - 使用例: "await window.vja.log.warn('データが空です');"
  - 使用例説明: 警告をログに記録する

- 関数名: await window.vja.log.error(message):
  - 説明: ERRORレベルのログをBun側に記録する
  - 引数:
    - message: string - ログメッセージ
  - 戻り値: なし
  - 使用例: "await window.vja.log.error('DB接続エラー: ' + e.message);"
  - 使用例説明: エラーをログに記録する

- 関数名: await window.vja.app.showDialog(message):
  - 説明: アラートダイアログを表示する
  - 引数:
    - message: string - 表示するメッセージ
  - 戻り値: "{ ok: boolean }"
  - 使用例: "await window.vja.app.showDialog('処理が完了しました');"
  - 使用例説明: 完了メッセージをアラートで表示する

- 関数名: await window.vja.app.showConfirm(message):
  - 説明: 確認ダイアログを表示する
  - 引数:
    - message: string - 表示するメッセージ
  - 戻り値: "{ ok: boolean, confirmed: boolean } - OKを押した場合confirmed=true"
  - 使用例: |
      const result = await window.vja.app.showConfirm('削除しますか？');
      if (!result?.confirmed) return;
  - 使用例説明: 削除確認ダイアログを表示し、キャンセル時は処理を中断する
~~~
`.trim();


    // [バックエンド]利用可能なjavascript関数の説明.
    // AI以外に、js利用者向けのvjaランタイム説明等に利用を想定.
    const VJA_USE_BACK_JS_INFO = `
## 実行環境
- バックエンド: Bun.js（SQLite, ファイルI/O）

## 関数説明.
~~~yaml
## DB操作 (vja.db.*)

- 関数名: vja.db.query(sql, params?):
  - 説明: SQLのSELECT文を実行して結果行の配列を返す
  - 引数:
    - sql: string - 実行するSQL文（プレースホルダー ? を使用）
    - params?: (string|number|boolean|null)[] - プレースホルダーに渡す値の配列（省略可）
  - 戻り値: "Record<string, any>[] - 結果行の配列。エラー時は空配列"
  - 使用例: "const rows = vja.db.query('SELECT * FROM users WHERE status = ?', ['active']);"
  - 使用例説明: statusがactiveのユーザー一覧を取得する

- 関数名: vja.db.execute(sql, params?):
  - 説明: SQLのINSERT/UPDATE/DELETE文を実行する
  - 引数:
    - sql: string - 実行するSQL文（プレースホルダー ? を使用）
    - params?: (string|number|boolean|null)[] - プレースホルダーに渡す値の配列（省略可）
  - 戻り値: "{ changes: number, lastInsertRowid: number } | null - 実行結果。エラー時はnull"
  - 使用例: "vja.db.execute('UPDATE settings SET value = ? WHERE key = ?', ['initialized', 'status']);"
  - 使用例説明: 設定テーブルのstatusをinitializedに更新する

- 関数名: vja.db.clearTable(tableName):
  - 説明: 指定テーブルの全データを削除する
  - 引数:
    - tableName: string - クリアするテーブル名
  - 戻り値: "{ changes: number, lastInsertRowid: number } | null"
  - 使用例: "vja.db.clearTable('temp_data');"
  - 使用例説明: 一時データテーブルを全削除する

- 関数名: await vja.db.importCsv(tableName, filePath):
  - 説明: CSVファイルを読み込んで指定テーブルに一括インポートする。CSVの1行目をヘッダーとして使用する
  - 引数:
    - tableName: string - インポート先テーブル名
    - filePath: string - CSVファイルの絶対パス
  - 戻り値: なし
  - 例外: ファイルが存在しない場合やSQLエラー時はエラーをスロー
  - 使用例: "await vja.db.importCsv('users', '/home/user/data/users.csv');"
  - 使用例説明: usersテーブルにCSVファイルのデータを一括インポートする

- 関数名: await vja.db.importJson(tableName, filePath):
  - 説明: JSONファイルを読み込んで指定テーブルに一括インポートする。JSONは配列形式である必要がある
  - 引数:
    - tableName: string - インポート先テーブル名
    - filePath: string - JSONファイルの絶対パス
  - 戻り値: なし
  - 例外: ファイルが存在しない場合・JSON解析エラー・SQLエラー時はエラーをスロー
  - 使用例: "await vja.db.importJson('products', '/home/user/data/products.json');"
  - 使用例説明: productsテーブルにJSONファイルのデータを一括インポートする

## セッション (vja.session.*)

- 関数名: vja.session.get(key):
  - 説明: セッションからキーに対応する値を取得する
  - 引数:
    - key: string - セッションキー
  - 戻り値: "string | null - セッション値。存在しない場合はnull"
  - 使用例: "const lastLogin = vja.session.get('lastLogin');"
  - 使用例説明: 前回ログイン日時をセッションから取得する

- 関数名: vja.session.set(key, value):
  - 説明: セッションにキーと値を保存する
  - 引数:
    - key: string - セッションキー
    - value: string - 保存する値
  - 戻り値: なし
  - 使用例: "vja.session.set('appStartTime', new Date().toISOString());"
  - 使用例説明: アプリ起動時刻をセッションに保存する

- 関数名: vja.session.delete(key):
  - 説明: セッションから指定キーを削除する
  - 引数:
    - key: string - 削除するセッションキー
  - 戻り値: なし
  - 使用例: "vja.session.delete('tempData');"
  - 使用例説明: 終了時に一時データをセッションから削除する

## ログ (vja.log.*)

- 関数名: vja.log.info(message):
  - 説明: INFOレベルのログをファイルとターミナルに出力する
  - 引数:
    - message: string - ログメッセージ
  - 戻り値: なし
  - 使用例: "vja.log.info('アプリを起動しました');"
  - 使用例説明: アプリ起動をログに記録する

- 関数名: vja.log.warn(message):
  - 説明: WARNレベルのログをファイルとターミナルに出力する
  - 引数:
    - message: string - ログメッセージ
  - 戻り値: なし
  - 使用例: "vja.log.warn('設定ファイルが見つかりません');"
  - 使用例説明: 警告をログに記録する

- 関数名: vja.log.error(message):
  - 説明: ERRORレベルのログをファイルとターミナルに出力する
  - 引数:
    - message: string - ログメッセージ
  - 戻り値: なし
  - 使用例: "vja.log.error('DB初期化エラー: ' + e.message);"
  - 使用例説明: エラーをログに記録する

- 使用例（onStart）: |
    // アプリ起動時の初期化処理例
    const startTime = new Date().toISOString();
    vja.session.set('appStartTime', startTime);
    vja.log.info('アプリ起動: ' + startTime);

    // マスタデータの初期インポート（初回のみ）
    const rows = vja.db.query('SELECT COUNT(*) as cnt FROM master');
    if (rows[0]?.cnt === 0) {
        await vja.db.importCsv('master', '/home/user/data/master.csv');
        vja.log.info('マスタデータをインポートしました');
    }

    // 前回の起動日時を記録
    const lastLogin = vja.session.get('lastLogin');
    if (lastLogin) {
        vja.db.execute('UPDATE settings SET value = ? WHERE key = ?', [lastLogin, 'lastLogin']);
    }
    vja.session.set('lastLogin', startTime);

- 使用例（onExit）: |
    // アプリ終了時のクリーンアップ処理例
    const startTime = vja.session.get('appStartTime');
    const endTime = new Date().toISOString();
    vja.log.info('アプリ終了: ' + endTime + ' (起動: ' + startTime + ')');

    // 一時データを削除
    vja.db.clearTable('temp_data');
    vja.session.delete('tempData');

    // 終了ログをDBに記録
    vja.db.execute(
        'INSERT INTO app_log (start_time, end_time) VALUES (?, ?)',
        [startTime, endTime]
    );
~~~
`.trim();

    // YAMLからjsに変換する場合のシステムプロンプトを生成.
    // - isAppEvent: [必須]定義されている場合はアプリイベント(bunネイティブ実行)で、存在しない場合はイベント系(js)で実行.
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
    // - extRuntimeDoc: [任意]拡張ランタイムのyaml定義を設定します.
    const YAML_TO_JS_SYS_PROMPT = function (
        isAppEvent,
        { formName, eventName, wname, wtag, wdescription,
            inputParamsCtx, allWidgetsCtx, formsCtx, globalConstCtx,
            formConstCtx, tablesCtx, extRuntimeDoc }) {

        // isAppEvent で、フロントとバックのランタイム説明の切替を行う.
        //   - true の場合、アプリイベント(bunネイティブ実行).
        //   - falseの場合、ウィジットイベント(js).
        const vjaUseJsInfo = isAppEvent ?
            VJA_USE_BACK_JS_INFO :
            VJA_USE_FRONT_JS_INFO;

        return `
あなたは日本語を専門とするVJAフォームデザイナーのイベント処理コード生成AIです。
ユーザーが書いたYAML仕様をもとに、JavaScriptの実装コードを生成します。

${vjaUseJsInfo}

## コード生成ルール(原則)
- コメント等は日本語で
- 必ず _vjaRun(async () => { ... }) でラップする（エラー自動処理）
- SQLはプレースホルダー (?) を必ず使用する（SQLインジェクション対策）
- 全ての window.vja.* / vja.* 呼び出しは await を付ける
- 画面遷移は vja.form.navigate('画面名') を使う(※ window.location は絶対に使っては駄目)
- コードのみを返す（説明文・マークダウン不要）

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

### 拡張ランタイムYAML
~~~yaml
${extRuntimeDoc}
~~~
`.trim() + "\n";
    }

    // YAMLからjsに変換する場合のユーザプロンプトを生成.
    // - isAppEvent: [必須]定義されている場合はアプリイベント(bunネイティブ実行)で、存在しない場合はイベント系(js)で実行.
    // - yamlDef: [必須]プログラム変換対象のyaml情報が設定されます.
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
    // - extRuntimeDoc: [任意]拡張ランタイムのyaml定義を設定します.
    // 戻り値: ユーザプロンプトが返却されます.
    const YAML_TO_JS_USER_PROMPT = function (isAppEvent, yamlDef, addPrompt,
        { formName, eventName, wname, wtag, wdescription,
            inputParamsCtx, allWidgetsCtx, formsCtx, globalConstCtx,
            formConstCtx, tablesCtx, extRuntimeDoc }) {
        let ret;
        // yaml定義が設定されている場合.
        if (yamlDef.trim()) {
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
                "~~~yaml\n" +
                yamlDef +
                "\n~~~";
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
        return `
あなたは日本語を専門とするJavaScriptコードのドキュメント生成アシスタントです。
以下の yamlルールに則って、対象javascriptの利用可能な関数一覧を作成してください。

~~~yaml
# 拡張ランタイム説明

- 関数名: await 関数名(args1, args2, args3, .... ):
  - 説明: 関数の目的や利用用途を簡潔に説明
  - 引数:
    - args1 の型や説明
    - args2 の型や説明
    - args3 の型や説明
  - 戻り値: 戻り値の型や説明
  - 例外: 発生する例外に関する説明(無ければ不要)
  - 使用例: 簡単な使用例を記載.
  - 使用例説明: 使用例に対する簡単な説明.
~~~
※ await が必要な function は必ず await をつけて下さい。

## yaml生成ルール(原則)
- 日本語で説明
- yamlのみを返す（説明文・マークダウン・ソースコード不要）
`.trim();
    }

    // 拡張ランタイム用ユーザプロンプト.
    const EXT_RUNTIME_JS_TO_YAML_USER_PROMPT = function (js) {
        // ユーザプロンプト.
        const ret = `
以下のJavaScriptコード（vja拡張ランタイム）の使い方をYAML形式で説明してください。
関数名・説明・引数・戻り値・例外・使用例を含めてください。
`
        // 最後に対象とするJSファイル内容をセット.
        return ret.trim() + "\n\n~~~javascript\n" + js + "~~~\n";
    }

    // プログラム生成におけるYAMLが存在しない場合にセット
    const DEFAULT_YAML_VALUE = function (eventName, wname) {
        return `
# YAML形式でAIへの指示を記述します.

# --- 定義サンプル説明 ---
# 処理:
# - [YES, NO]のダイアログを「テストです」の内容で表示する:
#   - [YES]が押された場合、ダイアログで「OKです」と表示して「トースト」にも同じ文字を出力.
#   - [NO]が押された場合、ダイアログで「NGです」と表示して「トースト」にも同じ文字を出力.
# 正常終了: 「正常に終了しました」とログを出す.
#
# --- 規定ワード ---
# 利用テーブル: table1, table2, table3, ...
#   今回の処理で利用するデータベーステーブル名を設定することで、AIがテーブル内容を理解してくれる。
#   テーブルのI/Oを行う場合は必須。
# 説明: 処理に対する概要説明
#   これを行う事で、AIに処理全体の意図を伝えることができる。
# 処理: 具体的に行う処理を記載する場合に、AIに理解しやすい形として、このように記載する.
#

# ここから記載してください。
イベント: ${eventName} (${wname})
説明:
利用テーブル:



`.trim();
    }

    //////////////////
    // グローバル展開.
    //////////////////
    const o = {};
    window._PROMPT_DEF = o;

    // 利用可能関数一覧: js利用者向けのvjaランタイム説明等.
    o.VJA_USE_BACK_JS_INFO = VJA_USE_BACK_JS_INFO; // バックエンド.
    o.VJA_USE_FRONT_JS_INFO = VJA_USE_FRONT_JS_INFO // フロントエンド.

    // [プロンプト]yamlから js AI生成依頼.
    o.YAML_TO_JS_SYS_PROMPT = YAML_TO_JS_SYS_PROMPT;
    o.YAML_TO_JS_USER_PROMPT = YAML_TO_JS_USER_PROMPT;

    // [プロンプト]拡張ランタイムyamlから js AI生成依頼.
    o.EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT = EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT;
    o.EXT_RUNTIME_JS_TO_YAML_USER_PROMPT = EXT_RUNTIME_JS_TO_YAML_USER_PROMPT;

    // イベント用yamlエディタ初期値.
    o.DEFAULT_YAML_VALUE = DEFAULT_YAML_VALUE;

})();
