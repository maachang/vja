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

- 関数名: vja.event.get():
  - 説明: イベントデータを取得する（同期関数。awaitや.then()は使用禁止）
  - 戻り値: object | null
  - RowClick時: {type:'rowClick', row:行インデックス, column:'カラム名'}
  - HeaderClick時: {type:'headerClick', column:'カラム名'}
  - Click時: テーブルの行クリックなら rowClick、ヘッダークリックなら headerClick の結果を返す。typeで判別して処理を分岐できる
  - それ以外: null
  - 使用例: "const ev = vja.event.get(); const rows = vja.widget.get('tableView'); const rowData = rows[ev.row];"
  - 使用例説明: RowClickイベントでクリックした行データを取得する

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

## ログ出力 (console.*)

- 関数名: console.info(message):
  - 説明: INFOレベルのログをブラウザ側のコンソールに出力する
  - 引数:
    - message: any - ログメッセージ
  - 戻り値: なし
  - 使用例: "console.info('処理が完了しました');"
  - 使用例説明: 処理完了をログに出力する
  - 類似関数:
    - console.warn(message):
      - 説明: WARNレベルのログを出力する
    - console.error(message, error?):
      - 説明: ERRORレベルのログを出力する。エラー終了時は第2引数にErrorオブジェクト自体も渡すこと（例: console.error(e.message, e);）
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

vja.widget.get: { scope: UI_WIDGET_GET, args: [name:string], return: "string|number|boolean|null", desc: "Gets current value from UI Widget. CRITICAL: The returned value is READ-ONLY. Modifying the returned object/array WILL NOT update the UI. To update, you MUST explicitly use vja.widget.set()." }
vja.widget.set: { scope: UI_WIDGET_SET, args: [name:string, value:any, options?:object], return: "void", desc: "Sets value to UI Widget (text:str, checkbox:bool, select:array, datagrid:object[]). MANDATORY: This is the ONLY way to update UI data. Never mutate objects retrieved from get()." }
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
vja.event.get: { scope: EVENT_DATA, args: [], return: "object|null", desc: "MUST NOT use await or .then(). Synchronous function. Call directly: const ev = vja.event.get(); RowClick={type:'rowClick',row:rowIndex,column:'colName'}, HeaderClick={type:'headerClick',column:'colName'}, Click=returns rowClick or headerClick result based on clicked area (use ev.type to branch), others=null. Example(RowClick): const ev=vja.event.get(); const rows=vja.widget.get('tableView'); const rowData=rows[ev.row];" }

vja.event.isEnter: { scope: EVENT_KEY, args: [], return: "boolean", desc: "KeyDown/KeyUp ONLY. Returns true if Enter key." }
vja.event.isEscape: { scope: EVENT_KEY, args: [], return: "boolean", desc: "KeyDown/KeyUp ONLY. Returns true if Escape key." }
vja.event.isShift: { scope: EVENT_KEY, args: [], return: "boolean", desc: "KeyDown/KeyUp ONLY. Returns true if Shift key is held." }
vja.event.isCtrl: { scope: EVENT_KEY, args: [], return: "boolean", desc: "KeyDown/KeyUp ONLY. Returns true if Ctrl key is held." }

await vja.http.get: { scope: NETWORK_REST_API, args: [url:string, headers?:object], return: "any", desc: "HTTP GET. (vja.http.delete(url, headers) uses same args)" }
await vja.http.post: { scope: NETWORK_REST_API, args: [url:string, body:any, headers?:object], return: "any", desc: "HTTP POST with JSON body. (vja.http.put(url, body, headers) uses same args)" }
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
        const langLower = programType.toLowerCase();

        if (eng === true) {
            // 英語.
            return [
                `- The AI's output must strictly consist solely of the raw, executable code for ${programType}.`,
                `- Explanatory text, introductory remarks, and concluding statements are all strictly prohibited.`,
                `- NEVER wrap the output in markdown code blocks (e.g., do not use \`\`\` or \`\`\`${langLower}). Your response MUST start directly with the very first character of the actual code.`,
                `- Before rendering the final code, perform a comprehensive internal check for potential bugs, edge cases, strict type compliance, and appropriate exception handling, then output flawless, production-ready code on the first attempt.`
            ].join('\n');
        }

        // 日本語.
        return [
            `- AIの出力結果は「${programType} の生コードのみ」を厳守してください。`,
            `- 説明文、解説、前置き、結びの言葉はすべて出力禁止です。`,
            `- コードブロック（\`\`\`${langLower} や \`\`\`）などのマークダウン装飾は完全に排除してください。応答は、コードの最初の1文字目から直接開始する必要があります。`,
            `- コードを出力する直前に、頭の中で「潜在的なバグ」「エッジケース」「型定義の整合性」「例外処理」を網羅的に検証し、バグのない完成された実用コードを一発で出力してください。`
        ].join('\n');
    };

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
        const vjaUseJsInfo = isAppEvent
            ? VJA_USE_BACK_JS_INFO
            : VJA_USE_FRONT_JS_INFO;

        const codeType = isAppEvent ? "TypeScript" : "JavaScript";

        const rule = isAppEvent
            ? // バックエンド (isAppEvent = true)
            `
## 構造
- コードは必ずインラインで記述してください。
- 変数は if/else、try/catch、その他あらゆるブロック（{ }）の外で宣言することを厳守してください。
  - 悪い例: if (cond) { let params = [...]; } await vja.db.query(sql, params);
  - 良い例: let params = []; if (cond) { params = [...]; } await vja.db.query(sql, params);
- 原則として "const" の利用は禁止し、"let" のみを利用してください。
- ソースコードの1インデントは4スペースとします。
- ソースコードには見やすく改行を入れてください。

## vja API
- 全ての vja.* 呼び出しには await を付けてください。ただし、同期処理である次の呼び出しは除きます: vja.event.* / vja.trigger.* / vja.widget.get / vja.widget.set / vja.widget.show / vja.widget.hide / vja.widget.enable / vja.widget.disable
- Promise、.then()、.catch() を直接使用しないでください。代わりに await を使用してください。
- 画面遷移は vja.form.navigate('画面name') のみを使用してください。（window.location等は禁止）
- navigate() は別画面への移動専用です。現在画面のリロードや更新目的での使用は絶対禁止です。

## SQL
- SQLインジェクション対策として、プレースホルダー（?）の利用は必須です。
- sqlite3専用のSQLで実装してください。必ず実行可能なSQL文で定義する必要があります。
- SQLの LIKE 検索では、SQL文の中に '?' を直接クォーテーションで囲んで配置してはなりません（悪い例: LIKE '%?%' はプレースホルダーが機能しなくなるため絶対禁止）。必ずJavaScript側の変数に '%' を結合してプレースホルダーに渡してください。
  - 記述例: let pattern = '%' + txtSearch.value + '%'; let sql = 'SELECT * FROM t WHERE name LIKE ?'; await vja.db.query(sql, [pattern]);

## YAMLへの忠実性
- YAMLに記載のない処理（navigate、setVisible、show/hideなど）の追加は絶対禁止です。
- 「YAML仕様」の指示内容に従い実装を厳守してください。

## その他
- コメントはすべて日本語で記述してください。
`.trim()
            : // フロントエンド (isAppEvent = false)
            `
## 構造
- 生成するコードは必ず "インライン"（手続き型）で記述してください。ヘルパー関数の記載は絶対禁止です（例: handleXxx, doXxx, addEventListener などの関数定義は絶対に禁止）。
  - 悪い例: async function handleButtonClick() { ... }
  - 良い例: var result = await vja.app.showConfirm("...");
- 変数は if/else、try/catch、その他あらゆるブロック（{ }）の外で宣言することを厳守してください。
  - 悪い例: if (cond) { var params = [...]; } await vja.db.query(sql, params);
  - 良い例: var params = []; if (cond) { params = [...]; } await vja.db.query(sql, params);
- 原則として "const" や "let" の利用は禁止し、"var" のみを利用してください。
- ソースコードの1インデントは4スペースとします。
- ソースコードには見やすく改行を入れてください。

## vja API
- 全ての vja.* 呼び出しには await を付けてください。ただし、同期処理である次の呼び出しは除きます: vja.event.* / vja.trigger.* / vja.widget.get / vja.widget.set / vja.widget.show / vja.widget.hide / vja.widget.enable / vja.widget.disable
- Promise、.then()、.catch() を直接使用しないでください。代わりに await を使用してください。
- 画面遷移は vja.form.navigate('画面name') のみを使用してください。（window.location等は禁止）
- navigate() は別画面への移動専用です。現在画面のリロードや更新目的での使用は絶対禁止です。
- window.confirm や window.alert の使用は禁止です。代わりに vja.app.showDialog または vja.app.showConfirm を使用してください。

## SQL
- SQLインジェクション対策として、プレースホルダー（?）の利用は必須です。
- sqlite3専用のSQLで実装してください。必ず実行可能なSQL文で定義する必要があります。
- SQLの LIKE 検索では、SQL文の中に '?' を直接クォーテーションで囲んで配置してはなりません（悪い例: LIKE '%?%' はプレースホルダーが機能しなくなるため絶対禁止）。必ずJavaScript側の変数に '%' を結合してプレースホルダーに渡してください。
  - 記述例: var pattern = '%' + txtSearch.value + '%'; var sql = 'SELECT * FROM t WHERE name LIKE ?'; await vja.db.query(sql, [pattern]);

## YAMLへの忠実性
- YAMLに記載のない処理（navigate、setVisible、show/hideなど）の追加は絶対禁止です。
- 「エラー終了」などでエラーログ出力を行う指示がある場合、try {} catch(e) のErrorオブジェクトのmessageを出力する実装を行いますが、この時必ず第2引数にErrorオブジェクトを設定し、「console.error(e.message, e);」としてください。

## その他
- コメントはすべて日本語で記述してください。
`.trim();

        return (`
あなたは日本語を専門とするVJAフォームデザイナーのイベント処理コード生成AIです。
あなたは超高速かつ正確なシニアソフトウェアエンジニアです。
ユーザーが書いたYAMLを元に、${codeType}の実装コードを生成します。

[AI出力ルール]
---
${_program_rule(true, isAppEvent)}
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
        const vjaUseJsInfo = isAppEvent
            ? VJA_USE_BACK_JS_INFO_ENG
            : VJA_USE_FRONT_JS_INFO_ENG;

        const codeType = isAppEvent ? "TypeScript" : "JavaScript";

        const rule = isAppEvent
            ? // バックエンド (isAppEvent = true)
            `
## Structure
- Code must always be written inline.
- Strictly adhere to the rule of declaring variables outside of if/else, try/catch, and any other blocks ({ }).
  - Bad: if (cond) { let params = [...]; } await vja.db.query(sql, params);
  - Good: let params = []; if (cond) { params = [...]; } await vja.db.query(sql, params);
- As a general rule, do not use "const"; use only "let".
- One indentation level in the source code is four spaces.
- Insert line breaks in the source code to make it easier to read.

## vja API
- All vja.* calls must use "await", except for the following synchronous calls: vja.event.*, vja.trigger.*, vja.widget.get, vja.widget.set, vja.widget.show, vja.widget.hide, vja.widget.enable, and vja.widget.disable.
- Never use Promise, .then(), or .catch() directly. Use await instead.
- Screen navigation must use vja.form.navigate('screen name') only. (window.location is prohibited)
- navigate() is exclusively for navigating to a different screen. Using it to refresh or update the current screen is absolutely prohibited.

## SQL
- Placeholders (?) are mandatory for all variable inputs to prevent SQL injection.
- Implemented using SQL specific to sqlite3. Must be defined using executable SQL statements.
- For SQL LIKE searches, NEVER place the '?' placeholder inside quotes (e.g., LIKE '%?%' is STRICTLY PROHIBITED as it breaks the placeholder). Always concatenate the '%' wildcards to the JavaScript variable side.
  - Example: let pattern = '%' + txtSearch.value + '%'; let sql = 'SELECT * FROM t WHERE name LIKE ?'; await vja.db.query(sql, [pattern]);

## Fidelity to YAML
- Adding operations not specified in the YAML (such as navigate, setVisible, show/hide, etc.) is strictly prohibited.
- Strictly adhere to the implementation requirements specified in "the YAML specification".

## Other
- All comments must be written in Japanese.
`.trim()
            : // フロントエンド (isAppEvent = false)
            `
## Structure
- All generated code must be written "inline." The use of helper functions is strictly prohibited (e.g., defining functions such as "handleXxx", "doXxx", "addEventListener", etc., is absolutely forbidden).
  - Bad example: async function handleButtonClick() { ... }
  - Good example: var result = await vja.app.showConfirm("...");
- Strictly adhere to the rule of declaring variables outside of if/else, try/catch, and any other blocks ({ }).
  - Bad: if (cond) { var params = [...]; } await vja.db.query(sql, params);
  - Good: var params = []; if (cond) { params = [...]; } await vja.db.query(sql, params);
- As a general rule, the use of "const" and "let" is prohibited; use only "var".
- One indentation level in the source code is four spaces.
- Insert line breaks in the source code to make it easier to read.

## vja API
- All vja.* calls must use "await", except for the following synchronous calls: vja.event.*, vja.trigger.*, vja.widget.get, vja.widget.set, vja.widget.show, vja.widget.hide, vja.widget.enable, and vja.widget.disable.
- Never use Promise, .then(), or .catch() directly. Use await instead.
- Screen navigation must use vja.form.navigate('screen name') only. (window.location is prohibited)
- navigate() is exclusively for navigating to a different screen. Using it to refresh or update the current screen is absolutely prohibited.
- window.confirm/alert are prohibited. Use vja.app.showDialog/showConfirm instead.

## SQL
- Placeholders (?) are mandatory for all variable inputs to prevent SQL injection.
- Implemented using SQL specific to sqlite3. Must be defined using executable SQL statements.
- For SQL LIKE searches, NEVER place the '?' placeholder inside quotes (e.g., LIKE '%?%' is STRICTLY PROHIBITED as it breaks the placeholder). Always concatenate the '%' wildcards to the JavaScript variable side.
  - Example: var pattern = '%' + txtSearch.value + '%'; var sql = 'SELECT * FROM t WHERE name LIKE ?'; await vja.db.query(sql, [pattern]);

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
    };

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
        const programType = isAppEvent ? "TypeScript" : "JavaScript";
        const widgetLineJa = wname ? `- 対象ウィジェット: ${wname}\n` : "";

        // フロントエンド/ウィジェットイベント用のコンテキスト情報
        const frontInfo = isAppEvent
            ? ""
            : `
### プロジェクト情報
---
- 対象画面: ${formName}
${widgetLineJa}- 対象イベント: ${eventName}
---

### ウィジェット一覧 (${formName})
---
${allWidgetsCtx}
---

### 画面固有定数 (${formName})
---
${formConstCtx}
---

### 入力パラメータ (${formName})
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
---`.trim();

        let instructions = "";
        if (isAppEvent) {
            instructions = `Bun.jsを使用してアプリイベントを実行するための、${programType}の実行コードを生成してください。\nvja.db.query() や vja.session.get() などのAPIが利用可能です。`;
        } else {
            instructions = `${frontInfo}\n\nイベント処理をインラインで実装するための、${programType}コードを生成してください。`;
        }

        // YAML定義が指定されている場合
        if (yamlDef && yamlDef.trim()) {
            instructions += `\n\nロジックの実装にあたっては、以下の[YAML仕様]に記載された内容に必ず従ってください。

[YAML仕様]
---
~~~yaml
${_removeYamlShComments(yamlDef)}
~~~
---`;
        }

        // 追加指示がある場合
        if (addPrompt && addPrompt.trim()) {
            instructions += `\n\n[追加指示]\n${addPrompt.trim()}\n※システム指示の基本ルールに加えて、上記の追加指示も必ず満たすコードにしてください。`;
        }

        // ローカルLLMのコードブロック出力を力技で防ぐための最終厳守ブロック
        const finalEnforcement = `
【最重要要件】
- 出力結果は「${programType} の生コードのみ」としてください。
- 前置き、コードの解説、結びの言葉などは一切出力しないでください。
- マークダウンのコードブロック（\`\`\` や \`\`\`${programType.toLowerCase()}）で絶対に囲まないでください。コードの最初の1文字目から直接出力を開始してください。`;

        // 末尾フレーズ（日本語環境用の定数名、無ければそのままENG用を利用）
        const lastPhrase = typeof TO_LAST_PHRASE_JP !== 'undefined' ? TO_LAST_PHRASE_JP : ENG_TO_LAST_PHRASE_JP;

        return `${instructions.trim()}\n${finalEnforcement.trim()}\n\n${lastPhrase}`;
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
        const programType = isAppEvent ? "TypeScript" : "JavaScript";
        const widgetLineEn = wname ? `- Current widget: ${wname}\n` : "";

        // Context information for Frontend/Widget events
        const frontInfo = isAppEvent
            ? ""
            : `
### Project Information
---
- Current Form: ${formName}
${widgetLineEn}- Current Event: ${eventName}
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
---`.trim();

        let instructions = "";
        if (isAppEvent) {
            instructions = `Please generate execution code for the app event as ${programType} using Bun.js.\nAPIs such as vja.db.query() / vja.session.get() are available.`;
        } else {
            instructions = `${frontInfo}\n\nGenerate ${programType} code for inline implementation of event handling.`;
        }

        // If YAML specification is provided
        if (yamlDef && yamlDef.trim()) {
            instructions += `\n\nFollow the specifications provided in [The Following YAML] to implement the logic.

[The Following YAML]
---
~~~yaml
${_removeYamlShComments(yamlDef)}
~~~
---`;
        }

        // If additional user prompts exist
        if (addPrompt && addPrompt.trim()) {
            instructions += `\n\n[Additional Instructions]\n${addPrompt.trim()}\n*Strictly apply these instructions along with the system rules.`;
        }

        // Final formatting enforcement directly before LLM starts generation
        const finalEnforcement = `
[CRITICAL REQUIREMENT]
- Output MUST consist entirely of the raw ${programType} code.
- Absolutely NO introductory text, NO explanations, and NO concluding remarks.
- Do NOT wrap the code in markdown blocks (e.g., do not use \`\`\` or \`\`\`${programType.toLowerCase()}). Start your response directly with the very first character of the actual code.`;

        return `${instructions.trim()}\n${finalEnforcement.trim()}\n\n${ENG_TO_LAST_PHRASE_JP}`;
    };

    // 拡張ランタイム用システムプロンプト.
    const EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT = function () {
        return `
あなたはJavaScriptコードを解析し、開発者向けのドキュメントを生成する専門のAIアシスタントです。
提示されるJavaScriptコードから外部から利用可能な関数（API）の一覧を抽出し、以下の[YAMLスキーマ]に厳密に準拠したYAML形式のドキュメントを生成してください。

【言語に関する重要ルール】
- YAMLのキー名（項目名）は、以下に定義された英語のキーを完全に維持してください。
- ただし、各キーに対応する値（説明文、引数の詳細など）は、すべて日本語で記述してください。

[YAMLスキーマ]
以下の構造を完全に維持して出力してください。複数関数がある場合は、トップレベルの「- function:」から始まるリストを連続させてください。

- function: await 関数名(args1, args2, ...) # 非同期関数の場合は必ず先頭に await を付与、同期関数の場合は不要
  description: "関数の目的や利用用途の簡潔な日本語説明"
  arguments:
    - args1: "args1の型と日本語説明"
    - args2: "args2の型と日本語説明"
  returns: "戻り値の型と日本語説明"
  exception: "発生する例外（エラー）に関する日本語説明（無ければ項目ごと省略してよい）"
  example: |
    // 実際の実装コードに即した簡単なJavaScriptでの使用例
  example_description: "使用例に対する簡単な補足日本語説明"

【出力フォーマット・厳守事項】
- 出力は生のYAMLデータのみとしてください。
- \`\`\`yaml や \`\`\` のようなマークダウンのコードブロックで絶対に囲まないでください。
- 説明文、解説、前置き、結びの言葉などは一切出力禁止です。応答は、YAMLデータの最初の1文字目（具体的にはハイフン「-」）から直接開始してください。
`.trim() + "\n";
    };


    // 拡張ランタイム用システムプロンプト.
    const ENG_EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT = function () {
        return `
You are an expert AI assistant specializing in JavaScript code analysis and developer documentation generation.
Your task is to analyze the provided JavaScript code, extract all publicly available functions, and generate a documentation in a strict YAML format based on the following schema.

[CRITICAL REQUIREMENT FOR LANGUAGE]
- The keys of the YAML must be in English as defined below.
- However, all the values (such as descriptions, explanations, and arguments details) MUST be written in Japanese based on your understanding of the code.

[YAML Schema]
Strictly follow this structure. If there are multiple functions, repeat the list starting from the top-level "- function:" key.

- function: await functionName(args1, args2, ...) # Include 'await' if the function is asynchronous; omit if synchronous.
  description: "Brief Japanese explanation of the function's purpose and usage."
  arguments:
    - args1: "Type and Japanese description of args1."
    - args2: "Type and Japanese description of args2."
  returns: "Return type and Japanese explanation."
  exception: "Japanese description of potential exceptions or errors thrown. (Omit this entire key if none)"
  example: |
    // A simple, realistic JavaScript example of how to use this function
  example_description: "Brief Japanese explanation corresponding to the usage example."

[Output Format Rules - Strict Adherence Required]
- Output MUST consist entirely of the raw YAML data only.
- Do NOT wrap the output in markdown code blocks (e.g., do not use \`\`\`yaml or \`\`\`).
- Absolutely NO introductory text, NO explanations, and NO concluding remarks. Your response MUST start directly with the very first character of the actual YAML data (the hyphen "-").
`.trim() + "\n";
    };

    // 拡張ランタイム用ユーザプロンプト.
    const EXT_RUNTIME_JS_TO_YAML_USER_PROMPT = function (js) {
        // ユーザプロンプト.
        const instructions = `
以下のJavaScriptコード（VJA拡張ランタイム）を構造解析し、システム指示で定義されたスキーマに従ってAPIドキュメントをYAML形式で生成してください。

YAMLのキー名（項目名）は指定された英語（function, description, arguments, returns, exception, example, example_description）を厳守し、それに対応する各説明文（値）はすべて日本語で記述してください。

[対象JavaScriptコード]
---
\`\`\`javascript
${js.trim()}
\`\`\`
---`.trim();

        // ターゲットコードの直後に最重要ルールを配置することで、出力フォーマットの破綻を防ぐ
        const finalEnforcement = `
【最重要要件】
- 出力は生のYAMLデータのみとしてください。
- マークダウンのコードブロック（\`\`\`yaml や \`\`\`）で絶対に囲まないでください。
- 前置き文や解説、結びの言葉などは一切含めず、YAMLデータの最初の1文字目（ハイフン「-」）から直接出力を開始してください。`;

        return `${instructions}\n${finalEnforcement.trim()}\n`;
    };

    // [英語]拡張ランタイム用ユーザプロンプト.
    const ENG_EXT_RUNTIME_JS_TO_YAML_USER_PROMPT = function (js) {
        // ユーザプロンプト.
        const instructions = `
Please analyze the following JavaScript code (VJA extended runtime) and generate its API documentation in the exact YAML format specified in the system rules.

Ensure that the YAML strictly utilizes the predefined English keys (function, description, arguments, returns, exception, example, example_description) while their respective values and explanations are written in Japanese.

[Target JavaScript Code]
---
\`\`\`javascript
${js.trim()}
\`\`\`
---`.trim();

        // Final reinforcement placed at the absolute end to override LLM's default code block habits.
        const finalEnforcement = `
[CRITICAL REQUIREMENT]
- Output MUST consist entirely of the raw YAML data only.
- Absolutely NO markdown code blocks (do not wrap in \`\`\`yaml or \`\`\`).
- No introductory text, explanations, or commentary. Start your response directly with the first character of the YAML data (the hyphen "-").`;

        return `${instructions}\n${finalEnforcement.trim()}\n`;
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

    // [プロンプト]画面デザイン自動生成（YAML風の依頼文からウィジェット構成JSONを生成）
    // - formW/formH: [必須]対象フォームの幅・高さ（AIが座標をこの範囲内に収めるための基準値）
    // - tablesCtx: [任意]参照テーブルのカラム定義（見出し・型・制約の推測材料）
    // 戻り値: システムプロンプトが返却されます.
    const FORM_DESIGN_SYS_PROMPT = function ({ formW, formH, tablesCtx }) {
        return (`
あなたは業務アプリケーション向けフォームデザイナー（VJA）の画面レイアウト設計を行う専門のAIです。
ユーザーが日本語で記述したYAML形式の画面定義（画面の目的、フォームレイアウト方針、入力項目、アクション項目）を読み取り、配置するウィジェットを決定し、各ウィジェットの具体的な配置座標（x, y, w, h）を含んだレイアウトJSON配列を出力してください。

[レイアウト配置の原則]
- 「フォームレイアウト」指示の最優先: YAML内に「フォームレイアウト」（または formLayout）という項目がある場合、そこに書かれた画面レイアウトのコンセプトやデザイン補助指示（例：「2カラム構成」「ラベルと入力を上下に配置」「ボタンは右下に寄せる」など）を最優先の制約として解釈し、指示に完全に合致する座標計算を行ってください。
- フォームサイズ: 幅 = ${formW}px、高さ = ${formH}px。すべてのウィジェットはこの範囲内に収めてください（x + w <= ${formW}、y + h <= ${formH}）。
- 配置の流れ: 特に「フォームレイアウト」で並び順の指定がない場合は、ユーザーからの要求（YAML）に記載されている項目の順序に従って、原則として上から下へ順番に要素を配置してください。
- 重なりの絶対禁止: 任意の2つのウィジェットにおいて、それぞれの矩形領域（x, y, w, hで定義される範囲）が互いに重なったり交差したりしてはなりません。

[出力フォーマット・厳守事項]
- 出力は生のJSON配列のみとしてください。
- \`\`\`json のようなマークダウンのコードブロックで囲んではいけません。応答の最初の文字を [ 、最後の文字を ] としてください。
- 説明文、導入文、コメント等は一切出力しないでください。

[JSONスキーマ（要素ごとのキー定義）]
各オブジェクトは以下のキーを必ず保持してください。
- "tag": "inputtype" | "textarea" | "checkbox" | "radio" | "selectBox" | "listbox" | "button" | "label" | "datagrid"
- "name": 配列内で重複しないVB6風のハンガリアン記法（例: txtUserId, lblUserId, btnSubmit, chkAgree, radMale, cmbCategory, lstItems, txaMemo, tblResult）
- "text": 表示文言（"label", "button", "checkbox", "radio" の場合は必須。"inputtype", "textarea", "datagrid" の場合は空文字 "" または省略）
- "inputType": "tag" が "inputtype" の場合のみ必須。"text" | "password" | "number" | "email" | "tel" | "date" | "time" | "url"
- "placeholder": （任意）"inputtype" または "textarea" のときの入力例
- "group": "tag" が "radio" の場合のみ必須。同一グループのラジオボタンには同じグループ名（例: "Gender", "MemberType"）を指定
- "options": "tag" が "selectBox" または "listbox" の場合のみ必須。選択肢の配列。以下2種類の書き方が利用できます。
  - 文字列のみ（表示名とValueが同じでよい場合）: 例 ["未処理", "処理中", "完了"]
  - {"label": 表示名, "value": 内部値} オブジェクト（表示名とValueを分けたい場合。例えば依頼文に「馬名: name」のような「表示名: 内部値」の対応が明記されている場合は必ずこの形式を使うこと）: 例 [{"label": "馬名", "value": "name"}, {"label": "父馬", "value": "father"}]
  - ユーザーの依頼文やフォームレイアウト、参照テーブルの内容から具体的な選択肢を推測して埋めてください（不明な場合も空配列にはせず、一般的な選択肢を作成すること）
- "columns": "tag" が "datagrid" の場合のみ必須。表示するカラムの配列。各要素は {"name": 実データのカラム名（DBのカラム名。参照テーブルが指定されている場合はそのカラム名を使用）, "displayName": 画面に表示する見出し文言（省略時はnameがそのまま表示される。日本語の見出しにしたい場合は必ず指定すること）, "width": カラム幅の目安（整数、複数カラムの合計が概ね100になるよう配分）}。参照テーブルが指定されている場合は、そのカラム定義に基づいて作成してください
- "x", "y", "w", "h": 配置座標とサイズ（整数、単位ピクセル）。「フォームレイアウト」のコンセプト指示を満たしつつ、実用的な大きさで決定してください。

- 参照テーブルに記載のない列名を勝手に作成して含めないでください。
- ボタンの数は、ユーザーが指定したアクション項目の数と一致させてください（勝手に追加・削減しないこと）。

[出力例（Few-Shot）]
入力YAMLの例:
---
説明: horse_info 内容を検索して表示するための画面
フォームレイアウト: 検索条件は画面上部、検索結果の一覧は画面下部に表示する。
参照テーブル:
  - horse_info
入力項目:
  - 検索ワード: inputtype で text
  - 検索条件選択項目: selectBox で key=表示名, value=Value
    - 馬名: name
    - 父馬: father
    - 母馬: mother
    - 性別: sex
  - 検索結果表示枠: datagrid
    - horse_info: テーブル項目を表示して、カラム名、表示名を設定する
アクション項目:
  - 検索ボタン
---
出力JSONの例:
[
  {"tag": "label", "name": "lblSearchWord", "text": "検索ワード", "x": 20, "y": 20, "w": 100, "h": 25},
  {"tag": "inputtype", "name": "txtSearchWord", "text": "", "inputType": "text", "x": 130, "y": 20, "w": 150, "h": 25},
  {"tag": "selectBox", "name": "cmbSearchCol", "options": [
    {"label": "馬名", "value": "name"},
    {"label": "父馬", "value": "father"},
    {"label": "母馬", "value": "mother"},
    {"label": "性別", "value": "sex"}
  ], "x": 290, "y": 20, "w": 120, "h": 25},
  {"tag": "button", "name": "btnSearch", "text": "検索ボタン", "x": 420, "y": 20, "w": 90, "h": 25},
  {"tag": "datagrid", "name": "tblHorseInfo", "columns": [
    {"name": "name", "displayName": "馬名", "width": 25},
    {"name": "father", "displayName": "父馬", "width": 25},
    {"name": "mother", "displayName": "母馬", "width": 25},
    {"name": "sex", "displayName": "性別", "width": 25}
  ], "x": 20, "y": 60, "w": 490, "h": 200}
]

[参照テーブル定義]
---
${tablesCtx || "（参照テーブル未指定）"}
---
`.trim() + "\n");
    };

    // [英語:プロンプト]画面デザイン自動生成（YAML風の依頼文からウィジェット構成JSONを生成）
    const ENG_FORM_DESIGN_SYS_PROMPT = function ({ formW, formH, tablesCtx }) {
        return (`
You are an AI specializing in screen layout design for VJA (a form designer for business applications).
Your task is to read a Japanese YAML screen definition (including screen purpose, form layout policy, input fields, and action items) provided by the user, determine the widgets to be placed, and output a layout JSON array containing specific coordinates (x, y, w, h) for each widget.

[Layout Generation Rules]
- Highest Priority of "フォームレイアウト" (Form Layout): If the YAML contains a "フォームレイアウト" (or formLayout) field, you MUST interpret the layout concept or design assistance instructions specified there (e.g., "2-column composition", "place labels above inputs", "align buttons to the bottom right") as the highest priority constraint. Calculate coordinates in strict accordance with these instructions.
- Form Size: Width = ${formW}px, Height = ${formH}px. All widgets must fit within these dimensions (x + w <= ${formW}, y + h <= ${formH}).
- Layout Flow: Unless otherwise specified in the "フォームレイアウト" field, arrange elements sequentially from top to bottom based on the order of fields in the user's request.
- Strict No-Overlap: For any two widgets, their rectangular areas (defined by x, y, w, h) must never intersect or overlap.

[Output Format Rules - Strict Adherence Required]
- Output MUST be a raw JSON array only.
- Do NOT wrap the JSON in markdown code blocks (e.g., do not use \`\`\`json). Start your response directly with [ and end with ].
- Do not include any explanations, introduction, or comments.

[JSON Schema per Element]
Each object in the array must have the following keys:
- "tag": "inputtype" | "textarea" | "checkbox" | "radio" | "selectBox" | "listbox" | "button" | "label" | "datagrid"
- "name": Unique VB6-style Hungarian notation (e.g., txtUserId, lblUserId, btnSubmit, chkAgree, radMale, cmbCategory, lstItems, txaMemo, tblResult). Ensure names are unique within the array.
- "text": Caption text. Required for "label", "button", "checkbox", "radio". Omit or leave empty "" for "inputtype", "textarea", and "datagrid".
- "inputType": (Required only when tag is "inputtype") "text" | "password" | "number" | "email" | "tel" | "date" | "time" | "url"
- "placeholder": (Optional) Sample input text for "inputtype" or "textarea".
- "group": (Required only when tag is "radio") Group name string. Assign the same value to radio buttons belonging to the same selection group (e.g., "Gender", "MemberType").
- "options": (Required only when tag is "selectBox" or "listbox") An array of selectable choices, in either of the following two forms:
  - Plain strings, when the display label and the internal value should be the same (e.g., ["Pending", "In Progress", "Done"])
  - {"label": display text, "value": internal value} objects, when the display label and internal value differ. If the request explicitly maps a display label to an internal value (e.g., a Japanese "表示名: 内部値" style mapping such as "馬名: name"), you MUST use this object form (e.g., [{"label": "馬名", "value": "name"}, {"label": "父馬", "value": "father"}])
  - Infer concrete, realistic options from the request text, form layout, and reference table content. Never leave this an empty array; if the specific options are not stated, create reasonable general-purpose options instead.
- "columns": (Required only when tag is "datagrid") An array of column definitions. Each element is {"name": the actual data column name (use the reference table's column name when a reference table is specified), "displayName": the header caption shown on screen (omit only if it should be identical to "name"; when a Japanese-style caption is expected, you MUST set this), "width": approximate relative width as an integer, with all columns in the same datagrid summing to roughly 100}. If a reference table is specified, base the columns on that table's column definitions.
- "x", "y", "w", "h": Integers (pixels). Determine these values to satisfy the "フォームレイアウト" concept while ensuring practical widget dimensions.

- Reference tables: Do not arbitrarily create column names that are not listed in the reference table definition.
- Number of buttons: Adhere strictly to the number of action items specified in the request (do not arbitrarily add or reduce actions).

[Few-Shot Example]
Input YAML Example:
---
説明: horse_info 内容を検索して表示するための画面
フォームレイアウト: 検索条件は画面上部、検索結果の一覧は画面下部に表示する。
参照テーブル:
  - horse_info
入力項目:
  - 検索ワード: inputtype で text
  - 検索条件選択項目: selectBox で key=表示名, value=Value
    - 馬名: name
    - 父馬: father
    - 母馬: mother
    - 性別: sex
  - 検索結果表示枠: datagrid
    - horse_info: テーブル項目を表示して、カラム名、表示名を設定する
アクション項目:
  - 検索ボタン
---
Output JSON Example:
[
  {"tag": "label", "name": "lblSearchWord", "text": "検索ワード", "x": 20, "y": 20, "w": 100, "h": 25},
  {"tag": "inputtype", "name": "txtSearchWord", "text": "", "inputType": "text", "x": 130, "y": 20, "w": 150, "h": 25},
  {"tag": "selectBox", "name": "cmbSearchCol", "options": [
    {"label": "馬名", "value": "name"},
    {"label": "父馬", "value": "father"},
    {"label": "母馬", "value": "mother"},
    {"label": "性別", "value": "sex"}
  ], "x": 290, "y": 20, "w": 120, "h": 25},
  {"tag": "button", "name": "btnSearch", "text": "検索ボタン", "x": 420, "y": 20, "w": 90, "h": 25},
  {"tag": "datagrid", "name": "tblHorseInfo", "columns": [
    {"name": "name", "displayName": "馬名", "width": 25},
    {"name": "father", "displayName": "父馬", "width": 25},
    {"name": "mother", "displayName": "母馬", "width": 25},
    {"name": "sex", "displayName": "性別", "width": 25}
  ], "x": 20, "y": 60, "w": 490, "h": 200}
]

[Reference Table Definition]
---
${tablesCtx || "(No reference table specified)"}
---
`.trim() + "\n");
    };

    // [プロンプト]画面デザイン自動生成 ユーザープロンプト.
    // - designText: [必須]「説明/入力項目/アクション項目/参照テーブル」を含む依頼テキスト.
    // - addPrompt: [任意]ユーザー設定の追加指示.
    // 戻り値: ユーザープロンプトが返却されます.
    const FORM_DESIGN_USER_PROMPT = function (designText, addPrompt) {
        return (
            "以下のYAML形式の画面デザイン依頼に基づいて、配置するウィジェット構成のJSON配列を生成してください。\n\n" +
            "[画面デザイン依頼 (YAML)]\n---\n" + designText.trim() + "\n---\n" +
            (addPrompt ? "\n[追加指示]\n" + addPrompt.trim() + "\n※上記の依頼内容とシステム指示に加えて、この追加指示も満たすレイアウトを計算してください。\n" : "") +
            "\n" +
            "【重要】応答は、システム指示で定義されたスキーマに従う生のJSON配列（ [ から始まり ] で終わる形式）のみとしてください。\n" +
            "\`\`\`json などのマークダウンのコードブロックや、解説、挨拶、コメントなどは一切含めずに、JSONデータだけを直接出力してください。"
        );
    };

    // [英語:プロンプト]画面デザイン自動生成 ユーザープロンプト.
    const ENG_FORM_DESIGN_USER_PROMPT = function (designText, addPrompt) {
        return (
            "Based on the following screen design request written in YAML, generate the layout JSON array for the widget configuration.\n\n" +
            "[Screen Design Request (YAML)]\n---\n" + designText.trim() + "\n---\n" +
            (addPrompt ? "\n[Additional Instructions]\n" + addPrompt.trim() + "\n*In addition to the request above and the system rules, satisfy these instructions when calculating coordinates.\n" : "") +
            "\n" +
            "[CRITICAL] Output MUST be a raw JSON array only, strictly adhering to the schema defined in the system prompt.\n" +
            "Do NOT wrap the response in markdown code blocks (e.g., \`\`\`json). Do not include any explanations, introduction, or comments. Start directly with [ and end with ]."
        );
    };

    // フォームデザインにおけるYAMLが存在しない場合にセット
    const DEFAULT_FORM_DESIGN_YAML = `
# フォームデザイン定義.

説明: 
フォームレイアウト: 
#参照テーブル: 
入力項目: 
  - 
アクション項目: 
  - 
`.trim() + "\n\n\n\n\n";

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

    // [プロンプト]画面デザイン自動生成（YAML風の依頼文からウィジェット構成JSONを生成）.
    o.FORM_DESIGN_SYS_PROMPT = ENG_FORM_DESIGN_SYS_PROMPT;
    o.FORM_DESIGN_USER_PROMPT = ENG_FORM_DESIGN_USER_PROMPT;

    // フォームデザイン用yamlエディタ初期値.
    o.DEFAULT_FORM_DESIGN_YAML = DEFAULT_FORM_DESIGN_YAML;
})();
