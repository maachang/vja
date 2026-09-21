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

- 関数名: await vja.db.backup(destPath):
  - 説明: 現在のプロジェクトDBを指定パスへバックアップする
  - 引数:
    - destPath: string - バックアップ先のファイルパス（vja.dir.create()等で事前にフォルダを用意しておくこと）
  - 戻り値: なし（失敗時は例外をスロー）
  - 使用例: |
      await vja.dir.create('backups');
      await vja.db.backup('backups/backup_' + vja.util.today() + '.db');
  - 使用例説明: backupsフォルダに、今日の日付を付けたバックアップファイルを作成する

- 関数名: await vja.db.restore(srcPath):
  - 説明: 指定パスのバックアップファイルから現在のプロジェクトDBを復元する（現在のDBは上書きされる）
  - 引数:
    - srcPath: string - 復元元のバックアップファイルパス
  - 戻り値: なし（失敗時は例外をスロー）
  - 使用例: "await vja.db.restore('backups/backup_2026-01-01.db');"
  - 使用例説明: 指定したバックアップファイルの内容でDBを復元する

## ウィジェット操作 (vja.widget.*)

- 関数名: vja.widget.get(name):
- 関数名: vja.widget.getValue(name):
  - 説明: 指定名のウィジェットの現在値を、既に展開済みの生の値として直接返す（オブジェクトではない。ウィジェットの種類によって戻り値の型は変わるが、いずれの場合も value のようなプロパティで包まれてはいない）
  - 引数:
    - name: string - ウィジェット名
  - 戻り値: "ウィジェットの種類によって以下のいずれかの型がそのまま返る（すべてプリミティブ値または配列であり、プロパティアクセスは不要）:
      - datagrid（データグリッド）: Record<string, any>[] - 行データの配列
      - checkbox / radioButton: boolean
      - progressbar / slider / hscroll / vscroll: number
      - inputType(number): number
      - 上記以外（text / textarea / selectBox / listBox / label 等）: string"
  - 使用例: "const name = vja.widget.getValue('txtName'); const checked = vja.widget.getValue('chkAgree'); const rows = vja.widget.getValue('tableView');"
  - 使用例説明: txtNameウィジェットの入力値（string）、chkAgreeの状態（boolean）、tableViewの行データ（配列）をそれぞれ取得する
  - 誤った使用例（絶対にしないこと）: "const v = vja.widget.getValue('txtName'); if (v.value) { ... }"
  - 誤りの説明: 戻り値は既に生の値そのものであり、DOM要素のようにvalueプロパティで包まれていない。v.valueのようなアクセスは誤り（vが文字列ならv.valueはundefinedになり、実行時エラーにはならず静かに意図と異なる挙動になる）。正しくはvをそのまま使う

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
      - datagrid（データグリッド）: object[]（行データの配列）
    - options?: object - オプション（datagrid時のみ有効）
      - startNo?: number - No列の自動採番開始値（省略時は1）
  - 戻り値: なし
  - 使用例: "vja.widget.setValue('txtResult', '処理完了');"
  - 使用例（データグリッド）: "vja.widget.setValue('tblUsers', rows, { startNo: 1 });"
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
  - 説明: データグリッドウィジェットにデータをセットする
  - 引数:
    - name: string - データグリッドウィジェット名
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
  - 使用例説明: ユーザーデータグリッドに2行のデータをセットする

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

  - 関数名: vja.widget.setSuggestions(name, list):
    - 説明: テキストボックス(inputtype)のサジェスト候補を表示する。対象ウィジェットのプロパティ「SuggestEnabled」がtrueの場合のみ有効（falseの場合は何も起きない）。呼び出し元は必ず対象ウィジェットのSuggestイベント内であること（Suggestイベントは入力の度に自動発火する）
    - 引数:
      - name: string - ウィジェット名（Suggestイベントが発火した対象と同じ名前を指定する）
      - list: (string|{label:string, value:string})[] - サジェスト候補のリスト。プロパティ「SuggestMaxCount」（デフォルト3）を超える件数を渡した場合は先頭からその件数だけが表示される
    - 戻り値: なし
    - 使用例: "vja.widget.setSuggestions('txtName', ['山田太郎', '山田花子', '山田次郎']);"
    - 使用例説明: txtNameのSuggestイベント内で、入力中の文字列に応じたDB検索結果などをサジェスト候補として表示する
    - 注意: SuggestイベントとTextChangedイベントはどちらも入力の度に発火する。サジェスト候補の生成にはSuggestイベントのみを使うこと（TextChangedと重複定義した場合、両方が独立に実行される）

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

- 関数名: vja.util.parseDate(str, format?):
  - 説明: formatDate()で作られた形式の文字列をDateオブジェクトに変換する（逆変換）
  - 引数:
    - str: string - 変換する日付文字列
    - "format?: string - strのフォーマット（デフォルト: 'YYYY-MM-DD'）。formatDate()に渡したものと同じ形式を指定する"
  - 戻り値: Date|null - 変換できた場合はDate、失敗時はnull
  - 使用例: "const d = vja.util.parseDate('2026年06月11日', 'YYYY年MM月DD日');"
  - 使用例説明: 「2026年06月11日」形式の文字列をDateオブジェクトに変換する

- 関数名: vja.util.parseNumber(str):
  - 説明: formatNumber()で作られたようなカンマ区切りの数値文字列を数値に変換する（逆変換）
  - 引数:
    - str: string - 変換する数値文字列（カンマ区切り可）
  - 戻り値: number|null - 変換できた場合は数値、失敗時はnull
  - 使用例: "const n = vja.util.parseNumber(vja.widget.getValue('txtPrice'));"
  - 使用例説明: 「1,234,567」のようなカンマ区切り入力を数値に変換する

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
  - 使用例説明: CSVを読み込んでデータグリッドに表示する

- 関数名: await vja.io.openJson():
  - 説明: ファイル選択ダイアログでJSONファイルを選択して読み込む
  - 引数: なし
  - 戻り値: "any | null - パースされたJSONデータ"
  - 例外: JSON解析失敗時はエラーをスロー
  - 使用例: |
      const data = await vja.io.openJson();
      if (data) vja.widget.setValue('txtData', JSON.stringify(data));
  - 使用例説明: JSONファイルを読み込んで内容を表示する

- 関数名: vja.io.parseCsv(csvText, hasHeader):
  - 説明: 既に取得済みのCSV文字列をパースする（ファイル選択ダイアログは開かない）
  - 引数:
    - csvText: string - パース対象のCSV文字列
    - hasHeader: boolean - 省略可（既定true）。trueなら1行目をヘッダーとして扱いオブジェクトのキーにする。falseなら「col1」「col2」...という自動採番のキー名を使う
  - 戻り値: "Record<string, string>[] - 常に配列オブジェクト形式（vja.widget.setのdatagrid等と同じ形式）"
  - 使用例: |
      const res = await vja.http.get('https://example.com/data.csv');
      const rows = vja.io.parseCsv(res);
  - 使用例説明: HTTP経由で取得したCSV文字列をその場でパースする

- 関数名: vja.io.toCsv(rows, headers):
  - 説明: 行データ配列をCSV文字列に変換する（ダウンロードはしない。vja.io.parseCsvと対になるAPI）
  - 引数:
    - rows: "Record<string, any>[] | any[][]" - 変換対象の行データ配列（配列オブジェクト形式・配列の配列形式どちらも可）
    - headers: string[] - 省略可。配列オブジェクト形式の場合、省略時はrows[0]のキーから自動生成される。配列の配列形式の場合、省略するとヘッダー行なしのCSVになる（キーが無く自動生成できないため）
  - 戻り値: string - CSV文字列
  - 使用例: |
      const csv = vja.io.toCsv(rows);
      await vja.http.post('https://example.com/upload', csv);
  - 使用例説明: 行データをCSV文字列に変換してHTTPでアップロードする

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

- 重要: 「name」にはウィジェット名の文字列そのもの（例: 'btnSearch'）を指定してください。

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

get() は全イベントで必ずオブジェクトを返す（nullにはならない）。
getKey()/getKeyCode()/isEnter()等はKeyDown/KeyUpイベント専用で、それ以外では null/false を返す。

- 関数名: vja.event.get():
  - 説明: イベントデータを取得する（同期関数。awaitや.then()は使用禁止）
  - 戻り値: object（nullになることはありません。全てのイベントで必ずオブジェクトを返します）
  - RowClick時: {type:'rowClick', row:行インデックス, column:'カラム名'}
  - HeaderClick時: {type:'headerClick', column:'カラム名'}
  - Click時: データグリッドの行クリックなら rowClick、ヘッダークリックなら headerClick の結果を返す。typeで判別して処理を分岐できる
  - それ以外の全てのイベント（KeyDown/KeyUp/TextChanged/CheckedChanged等）: {type: そのイベント名の先頭文字を小文字にしたもの}（例: KeyDownイベントなら{type:'keyDown'}、TextChangedイベントなら{type:'textChanged'}）
  - 【重要】ev.type の値は、上記のルール（rowClick/headerClick、またはイベント名の先頭を小文字にしたもの）以外には絶対に存在しません。実際のイベント名から機械的に導ける値以外（推測や創作した値）と比較してはいけません。なお、KeyDown/KeyUpイベントで押されたキーそのものを判定したい場合は、vja.event.get()ではなく vja.event.getKey() / vja.event.isEnter() 等を使用してください（下記参照）。
  - 使用例（行データ取得）: "const ev = vja.event.get(); const rows = vja.widget.get('tableView'); const rowData = rows[ev.row];"
  - 使用例（セル単位のデータ取得）: "const ev = vja.event.get(); const rows = vja.widget.get('tableView'); const rowData = rows[ev.row]; const cellValue = rowData[ev.column];"
  - 使用例説明: RowClickイベントで、クリックした行全体のデータ（rowData）だけでなく、クリックした特定のセルの値（cellValue）が必要な場合は ev.column（クリックされたカラム名）でrowDataから絞り込む

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

- 関数名: await vja.crypto.sha1(text) / await vja.crypto.sha256(text) / await vja.crypto.sha512(text):
  - 説明: テキストを一方向ハッシュ化し、16進数文字列で返す（暗号化とは異なり復号は不可能）
  - 引数:
    - text: string - ハッシュ化する文字列
  - 戻り値: string - 16進数文字列のハッシュ値（sha1は40文字、sha256は64文字、sha512は128文字）
  - 【重要】パスワードそのものの保存目的でこれらの単純ハッシュを使うのは非推奨（ソルト・ストレッチングが無いため）。改ざん検知・重複チェック・簡易フィンガープリント等の用途に使用すること
  - 【重要】引数は必ず文字列(string)をそのまま渡すこと。TextEncoder().encode(...)等で事前にUint8Array/ArrayBufferへ変換して渡してはならない（このAPIは文字列を直接受け取り、内部でエンコードまで行う設計であり、変換した値を渡すと正しく動作しない）
  - 【重要】戻り値は最初から16進数文字列（string）であり、ArrayBufferやUint8Arrayではない。Array.from(new Uint8Array(...)).map(b=>b.toString(16))のような変換処理を戻り値に対して行ってはならない
  - 誤った使用例（絶対にしないこと）: |
      const encoder = new TextEncoder();
      const data = encoder.encode('入力テキスト');
      const digest = await vja.crypto.sha256(data); // NG: 文字列でなくUint8Arrayを渡している
  - 使用例: "const digest = await vja.crypto.sha256('入力テキスト');"
  - 使用例説明: テキストのSHA-256ハッシュ値（改ざん検知用など）を取得する

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

- 関数名: vja.app.closeWindow():
  - 説明: 実行中のアプリ（フォームウィンドウ）を終了する。タイトルバーの✕ボタンと同じ終了処理
  - 引数: なし
  - 戻り値: なし
  - 使用例: "vja.app.closeWindow();"
  - 使用例説明: 「終了」ボタン等が押された時にアプリを閉じる

## ログ出力 (console.*)

- 関数名: console.info(message):
  - 説明: INFOレベルのログをブラウザ側のコンソールに出力する
  - 引数:
    - message: any - ログメッセージ
  - 戻り値: なし
  - 使用例: "console.info('処理が完了しました');"
  - 使用例説明: 処理完了をログに出力する
  - 類似関数:
    - console.log(message):
      - 説明: 通常のログを出力する（デバッグ用途）
    - console.warn(message):
      - 説明: WARNレベルのログを出力する
    - console.error(message, error?):
      - 説明: ERRORレベルのログを出力する。エラー終了時は第2引数にErrorオブジェクト自体も渡すこと（例: console.error(e.message, e);）
