// AIプロンプト定義.
//  AIに条件を渡して「プログラムなど」を生成するための定義.
// index.htmlから切り離す事で「手動で修正対応」が行える.
//
(function () {
    "use strict";

    // ### [AIP説明で利用]
    // [フロントエンド]利用可能なjavascript関数の説明.
    // 「vja ランタイムの追加・変更・削除がある場合は、反映が必要」
    // AI以外に、js利用者向けのvjaランタイム説明等に利用を想定.
    const VJA_USE_FRONT_JS_INFO =
        `
## DB操作 (vja.db.*)

- 関数名: await vja.db.query(sql, params?):
  - 説明: SQLのSELECT文を実行して結果行を返す
  - 引数:
    - sql: string - 実行するSQL文（プレースホルダー ? を使用）
    - params?: (string|number|boolean|null)[] - プレースホルダーに渡す値の配列（省略可）
  - 戻り値: "Record<string, any>[] - 結果行の配列（エラー時は例外をスロー）"
  - 使用例: "const result = await vja.db.query('SELECT * FROM users WHERE id = ?', [1]);"
  - 使用例説明: usersテーブルからid=1のレコードを取得する

- 関数名: await vja.db.execute(sql, params?):
  - 説明: SQLのINSERT/UPDATE/DELETE文を実行する
  - 引数:
    - sql: string - 実行するSQL文（プレースホルダー ? を使用）
    - params?: (string|number|boolean|null)[] - プレースホルダーに渡す値の配列（省略可）
  - 戻り値: "{ changes: number, lastInsertRowid: number } | null - 実行結果。失敗時はnull"
  - 使用例: "await vja.db.execute('INSERT INTO users (name, age) VALUES (?, ?)', ['山田', 30]);"
  - 使用例説明: usersテーブルに新しいレコードを挿入する

- 関数名: await vja.db.transaction(statements[]):
  - 説明: 複数のSQL文をトランザクションとして実行する。複数SQLの実行では、これを利用する事で「高速化」が図れる。
  - 引数:
    - statements: "{ sql: string, params?: any[] }[] - 実行するSQL文と引数のペアの配列"
  - 戻り値: boolean - 全文実行成功でtrue、失敗時はロールバックしてfalse
  - 使用例: |
      await vja.db.transaction([
        { sql: 'INSERT INTO orders (item) VALUES (?)', params: ['商品A'] },
        { sql: 'UPDATE stock SET qty = qty - 1 WHERE item = ?', params: ['商品A'] }
      ]);
  - 使用例説明: 注文登録と在庫更新を1つのトランザクションで実行する

## ウィジェット操作 (vja.widget.*)

- 関数名: vja.widget.get(name):
- 関数名: vja.widget.getValue(name):
  - 説明: 指定名のウィジェットの現在値を取得する
  - 引数:
    - name: string - ウィジェット名
  - 戻り値: "string | number | boolean | null - ウィジェットの値"
  - 使用例: "const name = vja.widget.getValue('txtName');"
  - 使用例説明: txtNameウィジェットの入力値を取得する

- 関数名: vja.widget.set(name, value, options?):
- 関数名: vja.widget.setValue(name, value, options?):
  - 説明: 指定名のウィジェットに値をセットする。ウィジェットの種類に応じて自動的に適切な処理を行う
  - 引数:
    - name: string - ウィジェット名
    - value: string|number|boolean|array|object[] - セットする値
      - テキスト系（text/label等）: string/number
      - checkbox/radio: boolean
      - selectBox/listBox（選択）: string（value値を指定）
      - selectBox/listBox（項目更新）: array（例: ['項目1', '項目2'] または [{label:'表示名', value:'値'}]）
      - datagrid（テーブル）: object[]（行データの配列）
    - options?: object - オプション（datagrid時のみ有効）
      - startNo?: number - No列の自動採番開始値（省略時は1）
  - 戻り値: なし
  - 使用例: "vja.widget.setValue('txtResult', '処理完了');"
  - 使用例（テーブル）: "vja.widget.setValue('tblUsers', rows, { startNo: 1 });"
  - 使用例（選択肢更新）: "vja.widget.setValue('selCategory', ['食品', '電化製品', '衣類']);"
  - 使用例説明: ウィジェットの種類に応じて値・データ・選択肢をセットする

- 関数名: vja.widget.setItems(name, items[]):
  - 説明: selectBoxまたはlistBoxのアイテムをセットする
  - 引数:
    - name: string - ウィジェット名
    - "items: string[] | { label: string, value: string }[] - アイテムの配列"
  - 戻り値: なし
  - 使用例: "vja.widget.setItems('selCategory', ['食品', '電化製品', '衣類']);"
  - 使用例説明: カテゴリー選択ボックスにアイテムをセットする

- 関数名: vja.widget.setTableData(name, rows[], options?):
  - 説明: テーブルウィジェットにデータをセットする
  - 引数:
    - name: string - テーブルウィジェット名
    - rows: Record<string, any>[] - 行データの配列
    - options?: object - オプション（省略可）
      - startNo?: number - No列の自動採番開始値（省略時は1）。ページング時に使用
  - 戻り値: なし
  - 使用例: |
      vja.widget.setTableData('tblUsers', [
        { name: '山田', age: 30 },
        { name: '鈴木', age: 25 }
      ]);
  - 使用例（ページング）: |
      // 101件目から表示する場合
      vja.widget.setTableData('tblUsers', rows, { startNo: 101 });
  - 使用例説明: ユーザーテーブルに2行のデータをセットする

- 関数名: vja.widget.getAllInputs():
  - 説明: フォーム内の全入力ウィジェットの値を取得する
  - 引数: なし
  - 戻り値: "Record<string, any> - { ウィジェット名: 値 } の形式"
  - 使用例: "const inputs = vja.widget.getAllInputs();"
  - 使用例説明: フォーム内の全入力値を一括取得する

  - 関数名: vja.widget.setVisible(name, visible):
    - 説明: 指定名のウィジェットの表示/非表示を切り替える
    - 引数:
      - name: string - ウィジェット名
      - visible: boolean - trueで表示、falseで非表示
    - 戻り値: なし
    - 使用例: "vja.widget.setVisible('btnDelete', isAdmin);"
    - 使用例説明: isAdminがtrueの場合のみ削除ボタンを表示する

  - 関数名: vja.widget.show(name):
    - 説明: 指定名のウィジェットを表示する
  - 関数名: vja.widget.hide(name):
    - 説明: 指定名のウィジェットを非表示にする
  - 関数名: vja.widget.enable(name):
    - 説明: 指定名のウィジェットを有効にする
  - 関数名: vja.widget.disable(name):
    - 説明: 指定名のウィジェットを無効にする

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
    - options?: { save?: boolean } - save=falseで入力値を保存しない（省略時はtrue）
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
  - 戻り値: boolean - 成功時true
  - 使用例: "await vja.session.set('loginUser', { id: 1, name: '山田' });"
  - 使用例説明: ログインユーザー情報をセッションに保存する

- 関数名: await vja.session.delete(key):
  - 説明: セッションから指定キーを削除する
  - 引数:
    - key: string - セッションキー
  - 戻り値: boolean - 成功時true
  - 使用例: "await vja.session.delete('loginUser');"
  - 使用例説明: セッションからログインユーザー情報を削除する

- 関数名: await vja.session.clear():
  - 説明: セッションの全データを削除する
  - 引数: なし
  - 戻り値: boolean - 成功時true
  - 使用例: "await vja.session.clear();"
  - 使用例説明: セッションを全クリアする

- 関数名: await vja.session.get(key, default?):
  - 説明: セッションからキーに対応する値を取得する
  - 引数:
    - key: string - セッションキー
    - default?: any - 存在しない場合のデフォルト値（省略可）
  - 戻り値: any - セッション値またはデフォルト値
  - 使用例: "const user = await vja.session.get('loginUser', null);"
  - 使用例説明: セッションからログインユーザー情報を取得する

## バリデーション (vja.validate.*)

- 関数名: vja.validate.run(name):
  - 説明: GUIで定義したバリデーションルールを実行する。YAMLに「検証: 定義名」と記載すると、AIコード生成時にJSの先頭へ自動挿入される。AIが直接呼び出すことは不要。
  - 引数:
    - name: string - バリデーション定義名（GUIのバリデーション管理で設定した名前）
  - 戻り値: boolean - true=合格 / false=エラー（エラー時はトーストメッセージを表示）
  - 使用例: "if (!await vja.validate.run('入力チェック')) return;"
  - 使用例説明: 「入力チェック」定義のバリデーションを実行し、エラーなら処理を中断する

## ユーティリティ (vja.util.*)

- 関数名: vja.util.uuid():
  - 説明: UUID v4形式の一意な文字列を生成する
  - 引数: なし
  - 戻り値: string UUID形式の文字列が返却されます.
  - 使用例: "const id = vja.util.uuid();"
  - 使用例説明: 新しいレコードのIDとして使用するUUIDを生成する

- 関数名: vja.util.today():
  - 説明: 今日の日付をYYYY-MM-DD形式で返す
  - 引数: なし
  - 戻り値: string - "YYYY-MM-DD" 形式の文字列
  - 使用例: "vja.widget.setValue('txtDate', vja.util.today());"
  - 使用例説明: 日付入力欄に今日の日付をセットする

- 関数名: vja.util.formatDate(date, format?):
  - 説明: 日付をフォーマットして文字列で返す
  - 引数:
    - date: Date|string - 日付文字列及びDateオブジェクト.
    - "format?: string - フォーマット文字列（デフォルト: 'YYYY-MM-DD'）
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

## ファイル操作 (vja.file.*)

- 関数名: await vja.file.read(path):
  - 説明: 指定パスのファイルをテキストとして読み込む
  - 引数:
    - path: string - ファイルの絶対パス
  - 戻り値: string | null - 成功時はファイル内容、失敗時はnull

- 関数名: await vja.file.write(path, content):
  - 説明: 指定パスにテキストを書き込む（ファイルが存在しない場合は作成）
  - 引数:
    - path: string - ファイルの絶対パス
    - content: string - 書き込む内容
  - 戻り値: boolean - 成功時true

- 関数名: await vja.file.readBytes(path):
  - 説明: 指定パスのファイルをバイナリ（Uint8Array）で読み込む
  - 引数:
    - path: string - ファイルの絶対パス
  - 戻り値: Uint8Array | null

- 関数名: await vja.file.writeBytes(path, data):
  - 説明: バイナリデータを指定パスのファイルに書き込む
  - 引数:
    - path: string - ファイルの絶対パス
    - data: Uint8Array - 書き込むバイナリデータ
  - 戻り値: boolean - 成功時true

- 関数名: await vja.file.exists(path):
  - 説明: 指定パスのファイルが存在するか確認する
  - 引数:
    - path: string - ファイルの絶対パス
  - 戻り値: boolean

- 関数名: await vja.file.delete(path):
  - 説明: 指定パスのファイルを削除する
  - 引数:
    - path: string - ファイルの絶対パス
  - 戻り値: boolean - 成功時true

- 関数名: await vja.file.copy(src, dest):
  - 説明: ファイルをコピーする
  - 引数:
    - src: string - コピー元パス
    - dest: string - コピー先パス
  - 戻り値: boolean - 成功時true

## ディレクトリ操作 (vja.dir.*)

- 関数名: await vja.dir.create(path):
  - 説明: ディレクトリを作成する（再帰的に作成）
  - 引数:
    - path: string - 作成するディレクトリパス
  - 戻り値: boolean - 成功時true

- 関数名: await vja.dir.delete(path):
  - 説明: ディレクトリを削除する（再帰的に削除）
  - 引数:
    - path: string - 削除するディレクトリパス
  - 戻り値: boolean - 成功時true

- 関数名: await vja.dir.list(path):
  - 説明: ディレクトリ内のファイル/フォルダ名一覧を取得する
  - 引数:
    - path: string - 対象ディレクトリパス
  - 戻り値: string[]

- 関数名: await vja.dir.exists(path):
  - 説明: ディレクトリが存在するか確認する
  - 引数:
    - path: string - 対象ディレクトリパス
  - 戻り値: boolean

## イベントトリガー実行 (vja.trigger.*)

指定したウィジェットのイベントを発火させる。

- 関数名: vja.trigger.click(name):
  - 説明: 指定ウィジェットのクリックイベントを発火する
  - 使用例: "vja.trigger.click('btnSearch');"

- 関数名: vja.trigger.focus(name):
  - 説明: 指定ウィジェットにフォーカスを当てる

- 関数名: vja.trigger.blur(name):
  - 説明: 指定ウィジェットのフォーカスを外す

- 関数名: vja.trigger.change(name):
  - 説明: 指定ウィジェットの値変更イベントを発火する

- 関数名: vja.trigger.mouseDown(name):
  - 説明: マウス押下イベントを発火する

- 関数名: vja.trigger.mouseUp(name):
  - 説明: マウス離すイベントを発火する

- 関数名: vja.trigger.mouseEnter(name):
  - 説明: マウス進入イベントを発火する

- 関数名: vja.trigger.mouseLeave(name):
  - 説明: マウス離脱イベントを発火する

- 関数名: vja.trigger.scroll(name):
  - 説明: スクロールイベントを発火する

## イベント情報 (vja.event.*)

KeyDown / KeyUp イベント専用。それ以外のイベントでは null を返す。

- 関数名: vja.event.getKey():
  - 説明: 押されたキー名を返す（例: "Enter", "Escape", "ArrowUp"）
  - 戻り値: string | null
  - 使用例: "if (vja.event.getKey() === 'Enter') { /* 処理 */ }"

- 関数名: vja.event.getKeyCode():
  - 説明: 押されたキーコードを返す（例: 13, 27, 38）
  - 戻り値: number | null
  - 使用例: "if (vja.event.getKeyCode() === 13) { /* 処理 */ }"

- 関数名: vja.event.isEnter():
  - 説明: Enterキーが押されたか
  - 戻り値: boolean
  - 使用例: "if (vja.event.isEnter()) { /* 処理 */ }"

- 関数名: vja.event.isEscape():
  - 説明: Escapeキーが押されたか
  - 戻り値: boolean

- 関数名: vja.event.isShift():
  - 説明: Shiftキーが押されているか
  - 戻り値: boolean

- 関数名: vja.event.isCtrl():
  - 説明: Ctrlキーが押されているか
  - 戻り値: boolean

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

- 関数名: await vja.fetch(url, options?):
  - 説明: Bun経由でHTTPリクエストを送信する低レベルAPI（vja.http.*の内部でも使用）
  - 引数:
    - url: string - リクエスト先URL
    - options?: { method?, headers?, body? } - リクエストオプション（省略可）
  - 戻り値: { ok, status, headers, text(), json() } - fetchライクなレスポンスオブジェクト
  - 例外: ネットワークエラー時はエラーをスロー
  - 使用例: "const res = await vja.fetch('https://api.example.com/data', { method: 'GET' }); const data = await res.json();"
  - 備考: vja.http.* で対応できない場合（独自ヘッダー等）に使用する

- 関数名: await vja.http.get(url, headers?):
  - 説明: HTTP GETリクエストを送信する
  - 引数:
    - url: string - リクエスト先URL
    - headers?: Record<string, string> - リクエストヘッダー（省略可）
  - 戻り値: any - レスポンスのJSONオブジェクトまたはテキスト
  - 例外: HTTPエラー時はエラーをスロー
  - 使用例: "const data = await vja.http.get('https://api.example.com/users');"
  - 使用例説明: ユーザー一覧をAPIから取得する
  - 類似関数:
    - await vja.http.delete(url, headers?):
      - 説明: HTTP DELETEリクエストを送信する

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
  - 類似関数:
    - await vja.http.put(url, body, headers?):
      - 説明: HTTP PUTリクエストを送信する

## UI (vja.ui.*)

- 関数名: vja.ui.loading(show, message?):
  - 説明: ローディングオーバーレイを表示/非表示にする。エラー発生対策として try/ finally 機構を入れ、finally で ローディングのOFFを行う必要がある。
  - 引数:
    - show: boolean - trueで表示、falseで非表示
    - message?: string - 表示するメッセージ（デフォルト: 「処理中…」）
  - 戻り値: なし
  - 使用例: |
      vja.ui.loading(true, 'データを取得中...');
      try {
        const rows = await vja.db.query('SELECT * FROM users');
      } finally {
        vja.ui.loading(false);
      }
  - 使用例説明: DB取得中にローディングを表示し try/finally で確実に完了後に非表示にする

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

## ログ出力 (vja.log.*)

- 関数名: await vja.log.info(message):
  - 説明: INFOレベルのログをBun側に記録する
  - 引数:
    - message: string - ログメッセージ
  - 戻り値: なし
  - 使用例: "await vja.log.info('処理が完了しました');"
  - 使用例説明: 処理完了をログに記録する
  - 類似関数:
    - await vja.log.warn(message):
      - 説明: WARNレベルのログをBun側に記録する
    - await vja.log.error(message):
      - 説明: ERRORレベルのログをBun側に記録する

## ダイアログ出力 (vja.app.*)

- 関数名: await vja.app.showDialog(message):
  - 説明: アラートダイアログを表示する
  - 引数:
    - message: string - 表示するメッセージ
  - 戻り値: なし
  - 使用例: "await vja.app.showDialog('処理が完了しました');"
  - 使用例説明: 完了メッセージをアラートで表示する

- 関数名: await vja.app.showConfirm(message):
  - 説明: 確認ダイアログを表示する
  - 引数:
    - message: string - 表示するメッセージ
  - 戻り値: boolean - OKを押した場合true、キャンセルの場合false
  - 使用例: |
      const ok = await vja.app.showConfirm('削除しますか？');
      if (!ok) return;
  - 使用例説明: 削除確認ダイアログを表示し、キャンセル時は処理を中断する
`.trim() + "\n\n\n\n\n\n\n\n\n\n\n";


    // ### [systemPromptで利用]
    // [英語版][フロントエンド]利用可能なjavascript関数の説明.
    // ※使わなそうなものは削除.
    // 「vja ランタイムの追加・変更・削除がある場合は、反映が必要」
    // ※必須条件: 英語版は使用例、使用例説明は不要.
    const VJA_USE_FRONT_JS_INFO_ENG = `
await vja.db.query: { scope: DB_SELECT, args: [sql:string, params?:any[]], return: "Record<string,any>[]", desc: "SQL SELECT. Use ? placeholder." }
await vja.db.execute: { scope: DB_WRITE, args: [sql:string, params?:any[]], return: "{changes:number, lastInsertRowid:number}|null", desc: "SQL INSERT/UPDATE/DELETE." }
await vja.db.transaction: { scope: DB_TRANSACTION, args: [statements:object[]], return: "boolean", desc: "Multiple SQLs. Rollback and returns false on failure." }

vja.widget.get: { scope: UI_WIDGET_GET, args: [name:string], return: "string|number|boolean|null", desc: "Gets current value from UI Widget. Alias: getValue" }
vja.widget.getValue: { scope: UI_WIDGET_GET, args: [name:string], return: "string|number|boolean|null", desc: "Gets current value from UI Widget." }
vja.widget.set: { scope: UI_WIDGET_SET, args: [name:string, value:any, options?:object], return: "void", desc: "Sets value to UI Widget (text:str, checkbox:bool, select:array, datagrid:object[]). Alias: setValue" }
vja.widget.setValue: { scope: UI_WIDGET_SET, args: [name:string, value:any, options?:object], return: "void", desc: "Sets value to UI Widget." }
vja.widget.getAllInputs: { scope: UI_WIDGET_ALL, args: [], return: "Record<string,any>", desc: "Gets all active UI inputs in a form as {name: value}." }
vja.widget.setVisible: { scope: UI_WIDGET_VISIBILITY, args: [name:string, visible:boolean], return: "void", desc: "Toggles UI display (true=show, false=hide)." }
vja.widget.show: { scope: UI_WIDGET_STATE, args: [name:string], return: "void" }
vja.widget.hide: { scope: UI_WIDGET_STATE, args: [name:string], return: "void" }
vja.widget.enable: { scope: UI_WIDGET_STATE, args: [name:string], return: "void" }
vja.widget.disable: { scope: UI_WIDGET_STATE, args: [name:string], return: "void" }

vja.const.get: { scope: CONFIG_CONSTANT, args: [key:string, default?:any], return: "any", desc: "Retrieves constant value. Form priority, then global." }
vja.const.getAll: { scope: CONFIG_CONSTANT, args: [], return: "Record<string,any>", desc: "Retrieves all active config constants." }

vja.form.navigate: { scope: SCREEN_TRANSITION, args: [formName:string, options?:object], return: "void", desc: "Navigates to form. options.save defaults to true." }
vja.form.back: { scope: SCREEN_TRANSITION, args: [], return: "void" }
vja.form.setParam: { scope: SCREEN_PARAMETER, args: [key:string, value:any], return: "void", desc: "Sets data parameter to pass to the next screen." }
vja.form.getParam: { scope: SCREEN_PARAMETER, args: [key:string, default?:any], return: "any", desc: "Retrieves parameter passed from previous screen." }

await vja.session.get: { scope: SESSION_STORAGE, args: [key:string, default?:any], return: "any" }
await vja.session.set: { scope: SESSION_STORAGE, args: [key:string, value:any], return: "boolean", desc: "Saves persistent session data (JSON)." }
await vja.session.delete: { scope: SESSION_STORAGE, args: [key:string], return: "boolean" }
await vja.session.clear: { scope: SESSION_STORAGE, args: [], return: "boolean" }

vja.util.today: { scope: UTIL_DATE, args: [], return: "string", desc: "Returns current date in YYYY-MM-DD format." }
vja.util.formatDate: { scope: UTIL_DATE, args: [date:any, format?:string], return: "string", desc: "Formats Date object or string (default: YYYY-MM-DD)." }
vja.util.formatNumber: { scope: UTIL_NUMBER, args: [n:number, decimals?:number], return: "string", desc: "Formats number with thousands separators." }

await vja.io.openCsv: { scope: FILE_DIALOG_READ, args: [], return: "Record<string,string>[]|null", desc: "Reads CSV via dialog. Returns null if canceled." }
await vja.io.openJson: { scope: FILE_DIALOG_READ, args: [], return: "Promise<any|null>", desc: "Reads JSON via dialog. Throws on parse error." }
await vja.io.saveCsv: { scope: FILE_DIALOG_WRITE, args: [csvRows:object[], filename:string], return: "void" }
await vja.io.saveJson: { scope: FILE_DIALOG_WRITE, args: [data:any, filename:string], return: "void" }

await vja.file.read: { scope: LOCAL_FILE_IO, args: [path:string], return: "string|null" }
await vja.file.write: { scope: LOCAL_FILE_IO, args: [path:string, content:string], return: "boolean" }
await vja.file.readBytes: { scope: LOCAL_FILE_IO, args: [path:string], return: "Uint8Array|null" }
await vja.file.writeBytes: { scope: LOCAL_FILE_IO, args: [path:string, data:Uint8Array], return: "boolean" }
await vja.file.exists: { scope: LOCAL_FILE_IO, args: [path:string], return: "boolean" }
await vja.file.delete: { scope: LOCAL_FILE_IO, args: [path:string], return: "boolean" }
await vja.file.copy: { scope: LOCAL_FILE_IO, args: [src:string, dest:string], return: "boolean" }

await vja.dir.create: { scope: LOCAL_DIR_IO, args: [path:string], return: "boolean" }
await vja.dir.delete: { scope: LOCAL_DIR_IO, args: [path:string], return: "boolean" }
await vja.dir.list: { scope: LOCAL_DIR_IO, args: [path:string], return: "string[]" }
await vja.dir.exists: { scope: LOCAL_DIR_IO, args: [path:string], return: "boolean" }

vja.notify.toast: { scope: UI_NOTIFICATION, args: [message:string, duration?:number], return: "void", desc: "Displays a bottom toast notification." }

vja.trigger.click: { scope: UI_TRIGGER, args: [name:string], return: "void", desc: "Triggers click on widget. For other events use same pattern: vja.trigger.focus(name), vja.trigger.blur(name), vja.trigger.change(name), vja.trigger.mouseDown(name), vja.trigger.mouseUp(name), vja.trigger.mouseEnter(name), vja.trigger.mouseLeave(name), vja.trigger.scroll(name)" }

vja.event.getKey: { scope: EVENT_KEY, args: [], return: "string|null", desc: "KeyDown/KeyUp event ONLY. Returns key name ('Enter','Escape','ArrowUp' etc). Returns null in other events." }
vja.event.isEnter: { scope: EVENT_KEY, args: [], return: "boolean", desc: "KeyDown/KeyUp ONLY. Returns true if Enter key." }
vja.event.isEscape: { scope: EVENT_KEY, args: [], return: "boolean", desc: "KeyDown/KeyUp ONLY. Returns true if Escape key." }
vja.event.isShift: { scope: EVENT_KEY, args: [], return: "boolean", desc: "KeyDown/KeyUp ONLY. Returns true if Shift key is held." }
vja.event.isCtrl: { scope: EVENT_KEY, args: [], return: "boolean", desc: "KeyDown/KeyUp ONLY. Returns true if Ctrl key is held." }

await vja.http.get: { scope: NETWORK_REST_API, args: [url:string, headers?:object], return: "any", desc: "HTTP GET request. Alias: delete" }
await vja.http.delete: { scope: NETWORK_REST_API, args: [url:string, headers?:object], return: "any" }
await vja.http.post: { scope: NETWORK_REST_API, args: [url:string, body:any, headers?:object], return: "any", desc: "HTTP POST request (body auto JSON). Alias: put" }
await vja.http.put: { scope: NETWORK_REST_API, args: [url:string, body:any, headers?:object], return: "any" }
await vja.fetch: { scope: NETWORK_LOW_LEVEL, args: [url:string, options?:object], return: "any", desc: "Low-level fetch alternative for custom options." }

vja.ui.loading: { scope: UI_OVERLAY, args: [show:boolean, message?:string], return: "void", desc: "Toggle loading overlay screen. MUST wrap the actual code in try{} finally{ vja.ui.loading(false); } structure to ensure turn off on errors." }

await vja.app.showDialog: { scope: UI_DIALOG, args: [message:string], return: "void" }
await vja.app.showConfirm: { scope: UI_DIALOG, args: [message:string], return: "boolean", desc: "Confirm dialog. OK=true, Cancel=false." }

console.info: { scope: LOG_SYSTEM, args: [message:any], return: "void" }
console.warn: { scope: LOG_SYSTEM, args: [message:any], return: "void" }
console.error: { scope: LOG_SYSTEM, args: [message:any], return: "void" }
`.trim();

    // ### [AIP説明で利用]
    // [バックエンド]利用可能なjavascript関数の説明.
    // AI以外に、js利用者向けのvjaランタイム説明等に利用を想定.
    // 「vja ランタイムの追加・変更・削除がある場合は、反映が必要」
    const VJA_USE_BACK_JS_INFO =
        `
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
  - 戻り値: なし
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
  - 戻り値: boolean - 成功時true
  - 使用例: "vja.session.set('appStartTime', new Date().toISOString());"
  - 使用例説明: アプリ起動時刻をセッションに保存する

- 関数名: vja.session.delete(key):
  - 説明: セッションから指定キーを削除する
  - 引数:
    - key: string - セッションキー
  - 戻り値: boolean - 成功時true
  - 使用例: "vja.session.delete('tempKey');"
  - 使用例説明: 不要なセッションキーを削除する

- 関数名: vja.session.clear():
  - 説明: セッションの全データを削除する
  - 引数: なし
  - 戻り値: boolean - 成功時true
  - 使用例: "vja.session.clear();"
  - 使用例説明: セッションを全クリアする

## ログ (vja.log.*)

- 関数名: vja.log.info(message):
  - 説明: INFOレベルのログをファイルとターミナルに出力する
  - 引数:
    - message: string - ログメッセージ
  - 戻り値: なし
  - 使用例: "vja.log.info('アプリを起動しました');"
  - 使用例説明: アプリ起動をログに記録する
  - 類似関数:
    - vja.log.warn(message):
      - 説明: WARNレベルのログをファイルとターミナルに出力する
    - vja.log.error(message):
      - 説明: ERRORレベルのログをファイルとターミナルに出力する

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
`.trim() + "\n\n\n\n\n\n\n\n\n\n\n";

    // ### [systemPromptで利用]
    // [英語版][バックエンド]利用可能なjavascript関数の説明.
    // ※必須条件: 英語版は使用例、使用例説明は不要.
    // 「vja ランタイムの追加・変更・削除がある場合は、反映が必要」
    const VJA_USE_BACK_JS_INFO_ENG = `
vja.db.query: { scope: DB_BACK_SELECT, args: [sql:string, params?:any[]], return: "Record<string,any>[]", desc: "SQL SELECT statement. Returns empty array [] on error. Use ? placeholder. NEVER use await." }
vja.db.execute: { scope: DB_BACK_WRITE, args: [sql:string, params?:any[]], return: "{changes:number, lastInsertRowid:number}|null", desc: "SQL INSERT/UPDATE/DELETE. Returns null on error. NEVER use await." }
vja.db.clearTable: { scope: DB_BACK_CLEAR, args: [tableName:string], return: "void" }
await vja.db.importCsv: { scope: DB_BACK_IMPORT, args: [tableName:string, filePath:string], return: "void", desc: "Bulk import CSV file using first row as header. Throws error on failure. MUST use await." }
await vja.db.importJson: { scope: DB_BACK_IMPORT, args: [tableName:string, filePath:string], return: "void", desc: "Bulk import JSON array file. Throws error on failure. MUST use await." }

vja.session.get: { scope: SESSION_BACK_STORAGE, args: [key:string], return: "string|null" }
vja.session.set: { scope: SESSION_BACK_STORAGE, args: [key:string, value:string], return: "boolean" }
vja.session.delete: { scope: SESSION_BACK_STORAGE, args: [key:string], return: "boolean" }
vja.session.clear: { scope: SESSION_BACK_STORAGE, args: [], return: "boolean" }

vja.log.info: { scope: LOG_BACK_SYSTEM, args: [message:string], return: "void" }
vja.log.warn: { scope: LOG_BACK_SYSTEM, args: [message:string], return: "void" }
vja.log.error: { scope: LOG_BACK_SYSTEM, args: [message:string], return: "void" }
    `.trim();

    // 英語promptの最後に日本語で表記としてつける文字
    const ENG_TO_LAST_PHRASE_JP = "\nRespond in Japanese.\n";

    // 英語promptの最後に英語で表記としてつける文字
    const ENG_TO_LAST_PHRASE_ENG = "\nRespond in English.\n";

    // プログラムタイプを取得.
    const _program_type = function (isAppEvent) {
        return isAppEvent
            ? "TypeScript"
            : "JavaScript";
    }

    // プログラム出力ルールを出力.
    const _program_rule = function (eng, isAppEvent) {
        const programType = _program_type(isAppEvent);
        if (eng == true) {
            // 英語.
            return "- The AI's output must strictly consist solely of the `raw code` for " + programType + ".\n" +
                "- Explanatory text, introductory remarks, and concluding statements are all prohibited.\n" +
                "- Completely exclude any Markdown formatting, such as code blocks (```" + programType.toLowerCase() + " ... ```).\n" +
                "- Just before outputting the code, mentally verify edge cases, type definitions, and exception handling in a single step, and output bug-free, complete code on the first attempt."
        }
        // 日本語.
        return "- AIの出力結果は「" + programType + " の生コードのみ」を厳守。\n" +
            "- 説明文、前置き、結びの言葉はすべて出力禁止。\n" +
            "- コードブロック（```" + programType.toLowerCase() + " ... ```）などのマークダウン装飾も完全に排除すること。\n" +
            "- コードを出力する直前に、頭の中で「エッジケース」「型定義」「例外処理」を1ステップで検証し、バグのない完成されたコードを一発で出力してください。"
    }

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
        {
            formName,
            eventName,
            wname,
            wtag,
            wdescription,
            inputParamsCtx,
            allWidgetsCtx,
            formsCtx,
            globalConstCtx,
            formConstCtx,
            tablesCtx,
            extRuntimeDoc,
        },
    ) {
        // isAppEvent で、フロントとバックのランタイム説明の切替を行う.
        //   - true の場合、アプリイベント(bunネイティブ実行).
        //   - falseの場合、ウィジットイベント(js).
        const vjaUseJsInfo = isAppEvent
            ? VJA_USE_BACK_JS_INFO
            : VJA_USE_FRONT_JS_INFO;

        // ルールをバックエンド、フロントエンドで記載.
        const rule = isAppEvent
            ? // バックエンド.
            `
## 構造
- コードは必ずインラインで記述。
- 変数は if/else・try/catch・その他あらゆるブロック（{ }）の外で宣言することを厳守する
  - 悪い例: if (cond) { const params = [...]; } vja.db.query(sql, params);
  - 良い例: let params = []; if (cond) { params = [...]; } vja.db.query(sql, params);
- 原則 "const" 利用禁止で "let" のみを利用する
- ソースコードの1インデントは4スペース
- ソースコードは "見やすく改行を入れる"

## vja API
- 全ての vja.* 呼び出しは await を付ける
- 画面遷移は vja.form.navigate('画面name') のみ使用（location禁止）
- navigate() は別画面移動専用。現在画面の更新目的での使用は絶対禁止

## SQL
- プレースホルダー(?) 必須（SQLインジェクション対策）
- sqlite3専用のSQLで実装。必ず実行可能なSQL文で定義する
- SQLの LIKE 検索では「部分一致: %カラム名%」「前方一致: カラム名%」「後方一致: %カラム名」で定義する

## YAMLへの忠実性
- YAMLに記載のない処理（navigate・setVisible・show/hide等）の追加は絶対禁止
- YAMLの指示内容に従い実装を厳守

## その他
- コメントは日本語で記述
`.trim()
            : // フロントエンド.
            `
## 構造
- 生成するコードは必ず "インライン" で記述。ヘルパー関数の記載は絶対禁止で（例: handleXxx, doXxx, addEventListener 等の関数定義は絶対に禁止）
  - 悪い例: async function handleButtonClick() { ... }
  - 良い例: const result = await vja.app.showConfirm("...");
- 変数は if/else・try/catch・その他あらゆるブロック（{ }）の外で宣言することを厳守する
  - 悪い例: if (cond) { const params = [...]; } vja.db.query(sql, params);
  - 良い例: let params = []; if (cond) { params = [...]; } vja.db.query(sql, params);
- 原則 "const" や "let" の利用禁止。"var" のみを利用する
- ソースコードの1インデントは4スペース
- ソースコードは "見やすく改行を入れる"

## vja API
- 全ての vja.* 呼び出しは await を付ける
- 画面遷移は vja.form.navigate('画面name') のみ使用（location禁止）
- navigate() は別画面移動専用。現在画面の更新目的での使用は絶対禁止
- window.confirm/alert禁止（vja.app.showDialog/showConfirmを使用）

## SQL
- プレースホルダー(?) 必須（SQLインジェクション対策）
- sqlite3専用のSQLで実装。必ず実行可能なSQL文で定義する
- SQLの LIKE 検索では「部分一致: %カラム名%」「前方一致: カラム名%」「後方一致: %カラム名」で定義する

## YAMLへの忠実性
- YAMLに記載のない処理（navigate・setVisible・show/hide等）の追加は絶対禁止
- 「YAML仕様」の指示内容に従い実装を厳守
- 「エラー終了」などで "エラーログ出力を行う" 指示がある場合「try {} catch(e)」のErrorオブジェクトのmessageを出力する実装を行うが、この時必ず「第２引数にErrorオブジェクトを設定= console.error(e.message, e)」としてください。

## その他
- コメントは日本語で記述
`.trim();

        return (`
あなたは日本語を専門とするVJAフォームデザイナーのイベント処理コード生成AIです。
あなたは超高速かつ正確なシニアソフトウェアエンジニアです。
ユーザーが書いたYAMLを元に、JavaScriptの実装コードを生成します。

[AI出力ルール]
---
${_program_rule(false, isAppEvent)}
---

[コード生成ルール]
---
${rule}
---

[vjaランタイム(yaml)]
---
~~~yaml
${vjaUseJsInfo}
~~~
---
`.trim() + "\n");
    };

    // [英語]YAMLからjsに変換する場合のシステムプロンプトを生成.
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
    const ENG_YAML_TO_JS_SYS_PROMPT = function (
        isAppEvent,
        {
            formName,
            eventName,
            wname,
            wtag,
            wdescription,
            inputParamsCtx,
            allWidgetsCtx,
            formsCtx,
            globalConstCtx,
            formConstCtx,
            tablesCtx,
            extRuntimeDoc,
        },
    ) {
        // [英語]isAppEvent で、フロントとバックのランタイム説明の切替を行う.
        //   - true の場合、アプリイベント(bunネイティブ実行).
        //   - falseの場合、ウィジットイベント(js).
        const vjaUseJsInfo = isAppEvent
            ? VJA_USE_BACK_JS_INFO_ENG
            : VJA_USE_FRONT_JS_INFO_ENG;

        // コードタイプ.
        const codeType = isAppEvent ? "TypeScript" : "JavaScript";

        // 出力基本ルール
        //const baseRule = _program_rule(true, isAppEvent);

        // ルールをバックエンド、フロントエンドで記載.
        const rule = isAppEvent
            ? // バックエンド.
            `
## Structure
- Code must always be written inline.
- Strictly adhere to the rule of declaring variables outside of if/else, try/catch, and any other blocks ({ }).
  - Bad: if (cond) { const params = [...]; } vja.db.query(sql, params);
  - Good: let params = []; if (cond) { params = [...]; } vja.db.query(sql, params);
- As a general rule, do not use "const"; use only "let".
- One indentation level in the source code is four spaces.
- Insert line breaks in the source code to make it easier to read.

## vja API
- All vja.* calls must use await.
- Screen navigation must use vja.form.navigate('screen name') only. (location is prohibited)
- navigate() is exclusively for navigating to a different screen. Using it to refresh or update the current screen is absolutely prohibited.

## SQL
- Placeholders (?) are mandatory. (SQL injection prevention)
- Implemented using SQL specific to sqlite3. Must be defined using executable SQL statements.
- In SQL LIKE searches, patterns are defined as follows: "partial match: %column_name%", "prefix match: column_name%", and "suffix match: %column_name".

## Fidelity to YAML
- Adding operations not specified in the YAML (such as navigate, setVisible, show/hide, etc.) is strictly prohibited.
- Strictly adhere to the implementation requirements specified in "the YAML specification".

## Other
- All comments must be written in Japanese.
`.trim()
            : // フロントエンド.
            `
## Structure
- All generated code must be written "inline." The use of helper functions is strictly prohibited (e.g., defining functions such as "handleXxx", "doXxx", "addEventListener", etc., is absolutely forbidden).
  - Bad example: async function handleButtonClick() { ... }
  - Good example: const result = await vja.app.showConfirm("...");
- Strictly adhere to the rule of declaring variables outside of if/else, try/catch, and any other blocks ({ }).
  - Bad: if (cond) { const params = [...]; } vja.db.query(sql, params);
  - Good: let params = []; if (cond) { params = [...]; } vja.db.query(sql, params);
- As a general rule, the use of "const" and "let" is prohibited; use only "var".
- One indentation level in the source code is four spaces.
- Insert line breaks in the source code to make it easier to read.

## vja API
- All vja.* calls must use await.
- Screen navigation must use vja.form.navigate('screen name') only. (location is prohibited)
- navigate() is exclusively for navigating to a different screen. Using it to refresh or update the current screen is absolutely prohibited.
- window.confirm/alert are prohibited. Use vja.app.showDialog/showConfirm instead.

## SQL
- Placeholders (?) are mandatory. (SQL injection prevention)
- Implemented using SQL specific to sqlite3. Must be defined using executable SQL statements.
- In SQL LIKE searches, patterns are defined as follows: "partial match: %column_name%", "prefix match: column_name%", and "suffix match: %column_name".

## Fidelity to YAML
- Adding operations not specified in the YAML (such as navigate, setVisible, show/hide, etc.) is strictly prohibited.
- When implementing logic to output an error log upon "error termination" (or similar events) using the "message" property of an "Error" object from a "try { } catch (e)" block, you must always set the "Error" object itself as the second argument—specifically, "console.error(e.message, e)".

## Other
- All comments must be written in Japanese.
`.trim();

        return (`
You are a VJA form designer and event handling code generation AI specializing in Japanese.
You are a lightning-fast and accurate senior software engineer.
You generate ${codeType} implementation code based on the YAML specification written by the user.

[AI Output Rules]
---
${_program_rule(true, isAppEvent)}
---

[Code Generation Rules]
---
${rule}
---

[vja Runtime(yaml)]
---
~~~yaml
${vjaUseJsInfo}
~~~
---
`.trim() + "\n");
    }

    // yamlのコメントを削除(AIによっては、コメントが逆に影響を及ぼす事になるため)
    const _removeYamlShComments = function (sourceCode) {
        // 行頭コメント行のみ削除する方針:
        // - インラインコメントは残す（URLの#等の誤削除を防ぐ）
        // - ブロックスカラー（|, >）内の#を誤って消さない
        // - 空行の連続を圧縮してトークン削減
        return sourceCode
            .split("\n")
            .filter((line) => !/^\s*#/.test(line)) // 行頭コメント行のみ削除
            .join("\n")
            .replace(/\n{3,}/g, "\n\n") // 空行の連続を最大2行に圧縮
            .trim();
    };

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
    const YAML_TO_JS_USER_PROMPT = function (
        isAppEvent,
        yamlDef,
        addPrompt,
        {
            formName,
            eventName,
            wname,
            wtag,
            wdescription,
            inputParamsCtx,
            allWidgetsCtx,
            formsCtx,
            globalConstCtx,
            formConstCtx,
            tablesCtx,
            extRuntimeDoc,
        },
    ) {
        let ret;

        // フロント条件.
        const frontInfo = isAppEvent
            ? ""
            : `
### プロジェクト情報
---
- 現在のフォーム: ${formName}
---

### ウィジェット一覧（${formName}）
---
${allWidgetsCtx}
---

### フォーム定数（${formName}）
---
${formConstCtx}
---

### 入力パラメータ（${formName}）
---
${inputParamsCtx}
---

### 画面一覧
---
${formsCtx}
---

### グローバル定数
---
${globalConstCtx}
---

### テーブル定義
---
${tablesCtx}
---

### 拡張ランタイム(yaml)
---
~~~yaml
${extRuntimeDoc}
~~~
---
  `.trim();

        // yaml定義が設定されている場合.
        if (yamlDef.trim()) {
            // isAppEvent: true の場合、アプリイベント(bunネイティブ実行).
            if (isAppEvent) {
                // アプリイベント: bun(rpc実行先）の生成処理(ts).
                ret =
                    "アプリイベントをBun.jsで実行するTypeScriptコードとして、以下の `YAML仕様` に基づいて生成してください。\n" +
                    "vja.db.query() / vja.session.get()等のAPIが利用可能です。";
            } else {
                // ウィジットイベント(js).
                ret =
                    frontInfo +
                    "\n\n\nイベント処理に対するインライン実装を、以下の `YAML仕様` に基づいてJavaScriptコードを生成してください。";
            }
            // yaml仕様をセット
            ret =
                ret +
                "\n[YAML仕様]" +
                "---\n~~~yaml\n" +
                _removeYamlShComments(yamlDef) + // yamlのコメントを除去.
                "\n~~~\n---\n";
        }
        // yaml定義が存在しない場合.
        else {
            // isAppEvent: true の場合、アプリイベント(bunネイティブ実行).
            if (isAppEvent) {
                // アプリイベント: bun(rpc実行先）の生成処理.(ts).
                ret =
                    "アプリイベントをBun.jsで実行されるTypeScriptコードとして生成してください。\n" +
                    "vja.db.query() / vja.session.get()等のAPIが利用可能です。";
            } else {
                // ウィジットイベント(js).
                ret =
                    frontInfo +
                    "\n\n\nイベント処理に対するインライン実装の、JavaScriptコードを生成してください。";
            }
        }
        // 追加指示がある場合はセット.
        return ret +
            // 一旦最後にもAI出力厳守条件をセット.
            (addPrompt ? "\n\n追加指示: " + addPrompt + "\n" : "") +
            //"\n\n[AI出力厳守]\n---\n" +
            //_program_rule(false, isAppEvent) +
            //"\n---";
            "";
    };

    // [英語]YAMLからjsに変換する場合のユーザプロンプトを生成.
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
    const ENG_YAML_TO_JS_USER_PROMPT = function (
        isAppEvent,
        yamlDef,
        addPrompt,
        {
            formName,
            eventName,
            wname,
            wtag,
            wdescription,
            inputParamsCtx,
            allWidgetsCtx,
            formsCtx,
            globalConstCtx,
            formConstCtx,
            tablesCtx,
            extRuntimeDoc,
        },
    ) {
        let ret;

        // フロント条件.
        const frontInfo = isAppEvent
            ? ""
            : `
### Project Information
---
- Current Form: ${formName}
---

### Widget List (${formName})
---
${allWidgetsCtx}
---

### Form Constants (${formName})
---
${formConstCtx}
---

### Input Parameters (${formName})
---
${inputParamsCtx}
---

### Screen List
---
${formsCtx}
---

### Global Constants
---
${globalConstCtx}
---

### Table Definitions
---
${tablesCtx}
---

### Extended Runtime(yaml)
---
~~~yaml
${extRuntimeDoc}
~~~
---
`.trim();

        // yaml定義が設定されている場合.
        if (yamlDef.trim()) {
            // isAppEvent: true の場合、アプリイベント(bunネイティブ実行).
            if (isAppEvent) {
                // アプリイベント: bun(rpc実行先）の生成処理(ts).
                ret =
                    "Please generate TypeScript code to execute the app event using Bun.js, based on `the following YAML` specification.\n" +
                    "APIs such as vja.db.query() / vja.session.get() are available.";
            } else {
                // ウィジットイベント(js).
                ret =
                    frontInfo +
                    "\n\n\nGenerate JavaScript code for inline implementation of event handling based on `the following YAML` specification.";
            }
            // yaml仕様をセット
            ret =
                ret +
                "\n[The Following YAML]\n" +
                "---\n~~~yaml\n" +
                _removeYamlShComments(yamlDef) + // yamlのコメントを除去.
                "\n~~~\n---\n";
        }
        // 「利用テーブル」定義が存在しない場合.
        else {
            // isAppEvent: true の場合、アプリイベント(bunネイティブ実行).
            if (isAppEvent) {
                // アプリイベント: bun(rpc実行先）の生成処理.(ts).
                ret =
                    "Please generate the app event as TypeScript code to be executed with Bun.js.\n" +
                    "APIs such as vja.db.query() / vja.session.get() are available.";
            } else {
                // ウィジットイベント(js).
                ret =
                    frontInfo +
                    "\n\n\nGenerate JavaScript code for inline implementation of event handling.";
            }
        }
        // 追加指示がある場合はセット.
        return (
            ret +
            // 一旦最後にもAI出力厳守条件をセット.
            (addPrompt
                ? "\n\nAdditional instructions: " + addPrompt + "\n"
                : "") +
            //"\n\n[Strict adherence to AI output]\n---\n" +
            //_program_rule(true, isAppEvent) +
            //"- " + ENG_TO_LAST_PHRASE_JP +
            //"\n---\n"
            "\n" + ENG_TO_LAST_PHRASE_JP
        );
    };

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
    };

    // 拡張ランタイム用システムプロンプト.
    const ENG_EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT = function () {
        // システムプロンプト.
        // これに対して出力は英語で行う(この方がAIとして都合が良いため).
        return (
            `
You are a JavaScript code documentation generation assistant specializing in English.
Please create a list of available functions for the target JavaScript, following the YAML rules below.
~~~YAML
# Extended Runtime Description
- Function Name: await function name(args1, args2, args3, ....):
  - Description: Briefly describe the function's purpose and usage.
  - Arguments:
    - Type and description of args1
    - Type and description of args2
    - Type and description of args3
  - Return Value: Type and description of the return value
  - Exceptions: Description of any exceptions that may occur (not required if none)
~~~
*Please be sure to include "await" for functions that require it.

## YAML Generation Rules (Principles)
- Explanation in English
- Return only YAML (no explanation, Markdown, or source code required)
`.trim() +
            "\n\n" +
            ENG_TO_LAST_PHRASE_ENG
        );
    };

    // 拡張ランタイム用ユーザプロンプト.
    const EXT_RUNTIME_JS_TO_YAML_USER_PROMPT = function (js) {
        // ユーザプロンプト.
        const ret = `
以下のJavaScriptコード（vja拡張ランタイム）の使い方をYAML形式で説明してください。
関数名・説明・引数・戻り値・例外・使用例を含めてください。
`;
        // 最後に対象とするJSファイル内容をセット.
        return ret.trim() + "\n\n---\n~~~javascript\n" + js + "~~~\n---\n";
    };

    // 拡張ランタイム用ユーザプロンプト.
    const ENG_EXT_RUNTIME_JS_TO_YAML_USER_PROMPT = function (js) {
        // ユーザプロンプト.
        const ret = `
Please explain how to use the following JavaScript code (vja extended runtime) in YAML format.
Include the function name, description, arguments, return value, and exceptions.
`;
        // 最後に対象とするJSファイル内容をセット.
        return (
            ret.trim() +
            "\n\n---\n~~~javascript\n" +
            js +
            "~~~\n---\n\n" +
            ENG_TO_LAST_PHRASE_ENG
        );
    };

    // プログラム生成におけるYAMLが存在しない場合にセット
    const DEFAULT_YAML_VALUE = function (eventName, wname) {
        return (
            `
# イベント: ${eventName} (${wname})
説明:
#利用テーブル:
#検証:
アクション:
  -

正常終了: なし
`.trim() + "\n\n\n\n\n"
        );
    };

    //////////////////
    // グローバル展開.
    //////////////////
    const o = {};
    window._PROMPT_DEF = o;

    // [日本語]利用可能関数一覧: js利用者向けのvjaランタイム説明等.
    o.VJA_USE_BACK_JS_INFO = VJA_USE_BACK_JS_INFO; // バックエンド.
    o.VJA_USE_FRONT_JS_INFO = VJA_USE_FRONT_JS_INFO; // フロントエンド.

    // [プロンプト]yamlから js AI生成依頼.
    // 日本語版.
    //o.YAML_TO_JS_SYS_PROMPT = YAML_TO_JS_SYS_PROMPT;
    //o.YAML_TO_JS_USER_PROMPT = YAML_TO_JS_USER_PROMPT;
    // 英語版.
    o.YAML_TO_JS_SYS_PROMPT = ENG_YAML_TO_JS_SYS_PROMPT;
    o.YAML_TO_JS_USER_PROMPT = ENG_YAML_TO_JS_USER_PROMPT;

    // [プロンプト]拡張ランタイムyamlから js AI生成依頼.
    // 日本語版
    //o.EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT = EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT;
    //o.EXT_RUNTIME_JS_TO_YAML_USER_PROMPT = EXT_RUNTIME_JS_TO_YAML_USER_PROMPT;
    // 英語版.
    o.EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT = ENG_EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT;
    o.EXT_RUNTIME_JS_TO_YAML_USER_PROMPT =
        ENG_EXT_RUNTIME_JS_TO_YAML_USER_PROMPT;

    // イベント用yamlエディタ初期値.
    o.DEFAULT_YAML_VALUE = DEFAULT_YAML_VALUE;
})();
