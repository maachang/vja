// AIプロンプト定義.
//  AIに条件を渡して「プログラムなど」を生成するための定義.
// index.htmlから切り離す事で「手動で修正対応」が行える.
//
(function () {
    "use strict";

    // YAMLをMarkdown風フェンス(~~~yaml ... ~~~)でプロンプトに埋め込む際、
    // 埋め込む内容自体に「~~~」という並びが含まれていると、そこでフェンスが
    // 終わったとAIに誤認され、以降の内容が別の指示として解釈される恐れがある
    // （開発者自身が書くYAMLが対象なので発生頻度は低いが、起こり得る）。
    // Markdownのコードフェンスのエスケープ手法にならい、埋め込む内容に含まれる
    // 最長の連続~より1文字長いフェンスを動的に使うことで回避する。
    const _safeYamlFence = function (content) {
        const matches = String(content || "").match(/~{3,}/g) || [];
        const maxLen = matches.reduce((m, s) => Math.max(m, s.length), 3);
        return "~".repeat(maxLen + 1);
    };

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
`.trim() + "\n\n\n\n\n\n\n\n\n\n\n";


    // ### [systemPromptで利用]
    // [英語版][フロントエンド]利用可能なjavascript関数の説明.
    // ※使わなそうなものは削除.
    // 「vja ランタイムの追加・変更・削除がある場合は、反映が必要」
    // ※必須条件: 英語版は使用例、使用例説明は不要.
    // ### [systemPromptで利用]
    // [フロントエンド] 必須API（常時システムプロンプトに含む: widget/trigger/ui.loading/app/console）
    // vja.event.*は任意カテゴリ（event）に分離。ただしKeyDown/KeyUp/RowClick/HeaderClickの
    // 4イベントでは、UI・検証ロジック側でOFFにできない「常時有効」扱いにする
    // （vja-yaml-editor.js の _EVENT_LOCKED_ON_EVENTS を参照）。
    const VJA_FRONT_API_MANDATORY_ENG = `
vja.widget.get: { args: [name:string], return: "string|number|boolean|null", desc: "Gets current value from UI Widget. CRITICAL: The returned value is READ-ONLY. Modifying the returned object/array WILL NOT update the UI. To update, you MUST explicitly use vja.widget.set()." }
vja.widget.set: { args: [name:string, value:any, options?:object], return: "void", desc: "Sets value to UI Widget (text:str, checkbox:bool, select:array, datagrid:object[]). MANDATORY: This is the ONLY way to update UI data. Never mutate objects retrieved from get()." }
vja.widget.getAllInputs: { args: [], return: "Record<string,any>", desc: "Gets all active UI inputs in a form as {name: value}." }
vja.widget.setVisible: { args: [name:string, visible:boolean], return: "void", desc: "Toggles UI display (true=show, false=hide)." }
vja.widget.show: { args: [name:string], return: "void", desc: "Shows the widget. Same argument pattern for vja.widget.hide(name), vja.widget.enable(name), vja.widget.disable(name)." }
vja.widget.setSuggestions: { args: [name:string, list:(string|{label:string,value:string})[]], return: "void", desc: "Shows suggestion dropdown candidates below an inputtype widget whose SuggestEnabled property is true. MUST be called only from that widget's own Suggest event (fires on every keystroke, same timing as TextChanged). List is capped to the widget's SuggestMaxCount property (default 3)." }

vja.trigger.click: { args: [name:string], return: "void", desc: "Triggers click on widget. name is the widget's NAME STRING (e.g. 'btnSearch'). For other events use same pattern: vja.trigger.focus(name), vja.trigger.blur(name), vja.trigger.change(name), vja.trigger.mouseDown(name), vja.trigger.mouseUp(name), vja.trigger.mouseEnter(name), vja.trigger.mouseLeave(name), vja.trigger.scroll(name)" }

vja.ui.loading: { args: [show:boolean, message?:string], return: "void", desc: "Toggle loading overlay screen. MUST wrap the actual code in try{} finally{ vja.ui.loading(false); } structure to ensure turn off on errors." }

await vja.app.showDialog: { args: [message:string], return: "void", desc: "Shows a message dialog. MUST use await, including inside catch blocks (e.g., catch (e) { console.error(e.message, e); await vja.app.showDialog('...'); }). Forgetting await is a common mistake — do not omit it, even in error handling." }
await vja.app.showConfirm: { args: [message:string], return: "boolean", desc: "Confirm dialog. OK=true, Cancel=false." }
vja.app.closeWindow: { args: [], return: "void", desc: "Closes the running app window. Same effect as clicking the titlebar's close (✕) button." }

await vja.crypto.encrypt: { args: [text:string, key:string], return: "string", desc: "Encrypts text, returns a Base64 string. Counterpart: await vja.crypto.decrypt(b64:string, key:string) -> string (throws if key is wrong)." }
await vja.crypto.sha1: { args: [text:string], return: "string", desc: "One-way hash, NOT reversible. Same argument/return pattern for vja.crypto.sha256(text) and vja.crypto.sha512(text). ARG MUST BE A PLAIN STRING — do NOT pass a TextEncoder-encoded Uint8Array/ArrayBuffer, this API takes and encodes the string internally. RETURN IS ALREADY a lowercase hex string (sha1=40 chars, sha256=64 chars, sha512=128 chars) — do NOT convert the return value with Array.from(new Uint8Array(...)) or similar, that produces wrong output. Not recommended alone for password storage (no salt/stretching); use for tamper detection, dedup keys, simple fingerprints." }

vja.notify.toast: { args: [message:string, duration?:number], return: "void", desc: "Displays a bottom toast notification. Use this for lightweight success/status messages (NOT vja.app.showDialog) when the YAML explicitly says \"トースト\" (toast)." }

console.info: { args: [message:any], return: "void" }
console.warn: { args: [message:any], return: "void" }
console.error: { args: [message:any], return: "void" }
`.trim();

    // ### [systemPromptで利用]
    // [フロントエンド] 特殊API（vja.db: YAMLの「利用テーブル:」に記載がある場合のみユーザプロンプト側に付与）
    const VJA_FRONT_API_DB_ENG = `
await vja.db.query: { args: [sql:string, params?:any[]], return: "Record<string,any>[]", desc: "SQL SELECT. Use ? placeholder." }
await vja.db.execute: { args: [sql:string, params?:any[]], return: "{changes:number, lastInsertRowid:number}|null", desc: "SQL INSERT/UPDATE/DELETE." }
await vja.db.transaction: { args: [statements:object[]], return: "boolean", desc: "Multiple SQLs. Rollback and returns false on failure." }
`.trim();

    // ### [systemPromptで利用]
    // [フロントエンド] 任意API（イベントエディタのチェックボックスでON時のみユーザプロンプト側に付与）
    // キー名は、チェックボックスUI・検証ロジック（無効化カテゴリのAPI使用検出）と共通で使用する識別子.
    const VJA_FRONT_API_OPTIONAL_ENG = {
        event: `
vja.event.getKey: { args: [], return: "string|null", desc: "KeyDown/KeyUp event ONLY. Returns key name ('Enter','Escape','ArrowUp' etc). Returns null in other events." }
vja.event.get: { args: [], return: "object", desc: "MUST NOT use await or .then(). Synchronous function. Call directly: const ev = vja.event.get(); NEVER returns null — always returns an object. RowClick={type:'rowClick',row:rowIndex,column:'colName'}, HeaderClick={type:'headerClick',column:'colName'}, Click=returns rowClick or headerClick result based on clicked area (use ev.type to branch), ALL other events (KeyDown/KeyUp/TextChanged/CheckedChanged/etc.)={type: the event name with its first letter lowercased} (e.g. KeyDown->{type:'keyDown'}, TextChanged->{type:'textChanged'}). IMPORTANT: ev.type can ONLY be 'rowClick', 'headerClick', or the mechanically-derived lowerCamel event name — NEVER invent or guess any other value. To detect which key was pressed, use vja.event.getKey()/isEnter()/isEscape() etc. instead, NOT vja.event.get(). Example(RowClick, row data): const ev=vja.event.get(); const rows=vja.widget.get('tableView'); const rowData=rows[ev.row]; Example(RowClick, specific clicked cell value): const ev=vja.event.get(); const rows=vja.widget.get('tableView'); const rowData=rows[ev.row]; const cellValue=rowData[ev.column]; — use ev.column (the clicked column name) to narrow rowData down to the specific cell when the request is about the clicked cell, not the whole row." }
vja.event.isEnter: { args: [], return: "boolean", desc: "KeyDown/KeyUp ONLY. Returns true if Enter key." }
vja.event.isEscape: { args: [], return: "boolean", desc: "KeyDown/KeyUp ONLY. Returns true if Escape key." }
vja.event.isShift: { args: [], return: "boolean", desc: "KeyDown/KeyUp ONLY. Returns true if Shift key is held." }
vja.event.isCtrl: { args: [], return: "boolean", desc: "KeyDown/KeyUp ONLY. Returns true if Ctrl key is held." }
`.trim(),
        form: `
vja.form.navigate: { args: [formName:string, options?:object], return: "void", desc: "Navigates to form. options.save defaults to true." }
vja.form.back: { args: [], return: "void" }
vja.form.setParam: { args: [key:string, value:any], return: "void", desc: "Sets data parameter to pass to the next screen." }
vja.form.getParam: { args: [key:string, default?:any], return: "any", desc: "Retrieves parameter passed from previous screen." }
`.trim(),
        session: `
await vja.session.get: { args: [key:string, default?:any], return: "any", desc: "Retrieves persistent session data. MUST use await." }
await vja.session.set: { args: [key:string, value:any], return: "boolean", desc: "Saves persistent session data (JSON)." }
await vja.session.delete: { args: [key:string], return: "boolean", desc: "Deletes a session data entry. MUST use await." }
await vja.session.clear: { args: [], return: "boolean", desc: "Clears all session data. MUST use await." }
`.trim(),
        const: `
vja.const.get: { args: [key:string, default?:any], return: "any", desc: "Retrieves constant value. Form priority, then global." }
vja.const.getAll: { args: [], return: "Record<string,any>", desc: "Retrieves all active config constants." }
`.trim(),
        util: `
vja.util.today: { args: [], return: "string", desc: "Returns current date in YYYY-MM-DD format." }
vja.util.formatDate: { args: [date:any, format?:string], return: "string", desc: "Formats Date object or string (default: YYYY-MM-DD)." }
vja.util.formatNumber: { args: [n:number, decimals?:number], return: "string", desc: "Formats number with thousands separators." }
`.trim(),
        file: `
await vja.file.read: { args: [path:string], return: "string|null", desc: "Reads a text file. Returns null if not found. MUST use await." }
await vja.file.write: { args: [path:string, content:string], return: "boolean", desc: "Writes text to a file. MUST use await." }
await vja.file.readBytes: { args: [path:string], return: "Uint8Array|null", desc: "Reads a binary file. Returns null if not found. MUST use await." }
await vja.file.writeBytes: { args: [path:string, data:Uint8Array], return: "boolean", desc: "Writes binary data to a file. MUST use await." }
await vja.file.exists: { args: [path:string], return: "boolean", desc: "Checks whether a file exists. Same argument pattern for vja.file.delete(path) [deletes file]. MUST use await." }
await vja.file.copy: { args: [src:string, dest:string], return: "boolean", desc: "Copies a file. MUST use await." }
`.trim(),
        io: `
await vja.io.openCsv: { args: [], return: "Record<string,string>[]|null", desc: "Reads CSV via dialog. Returns null if canceled." }
await vja.io.openJson: { args: [], return: "Promise<any|null>", desc: "Reads JSON via dialog. Throws on parse error." }
vja.io.parseCsv: { args: [csvText:string, hasHeader?:boolean], return: "Record<string,string>[]", desc: "Parses an already-obtained CSV string (NO dialog). Always returns array-of-objects (same shape as datagrid data in vja.widget.set). If hasHeader=false, uses auto-generated keys col1,col2,... instead of header row." }
vja.io.toCsv: { args: [rows:object[]|any[][], headers?:string[]], return: "string", desc: "Converts row data to a CSV string (does NOT download). Counterpart of vja.io.parseCsv. Accepts EITHER array-of-objects OR array-of-arrays as rows. If rows is array-of-objects and headers omitted, headers are auto-derived from rows[0] keys. If rows is array-of-arrays and headers omitted, the CSV has NO header row (arrays have no keys to derive from)." }
await vja.io.saveCsv: { args: [csvRows:object[], filename:string], return: "void", desc: "Saves rows as a CSV file via save dialog. MUST use await." }
await vja.io.saveJson: { args: [data:any, filename:string], return: "void", desc: "Saves data as a JSON file via save dialog. MUST use await." }
`.trim(),
        dir: `
await vja.dir.create: { args: [path:string], return: "boolean", desc: "Creates a directory (including parents). Same argument pattern for vja.dir.delete(path) [deletes directory], vja.dir.exists(path) [checks existence]. MUST use await." }
await vja.dir.list: { args: [path:string], return: "string[]", desc: "Lists entries in a directory. MUST use await." }
`.trim(),
        http: `
await vja.http.get: { args: [url:string, headers?:object], return: "any", desc: "HTTP GET. (vja.http.delete(url, headers) uses same args)" }
await vja.http.post: { args: [url:string, body:any, headers?:object], return: "any", desc: "HTTP POST with JSON body. (vja.http.put(url, body, headers) uses same args)" }
await vja.fetch: { args: [url:string, options?:object], return: "any", desc: "Low-level fetch alternative for custom options." }
`.trim(),
    };

    // 任意カテゴリの表示名（チェックボックスUI用）
    const VJA_FRONT_API_OPTIONAL_LABELS = {
        event: "イベント情報 (vja.event.*)",
        form: "画面遷移 (vja.form.*)",
        session: "セッション (vja.session.*)",
        const: "定数 (vja.const.*)",
        util: "ユーティリティ (vja.util.*)",
        file: "ファイル操作 (vja.file.*)",
        io: "ファイルI/O ダイアログ (vja.io.*)",
        dir: "ディレクトリ操作 (vja.dir.*)",
        http: "外部API (vja.http.*)",
    };

    // 互換用: 上記3つを結合した全量（ドキュメント自動生成・ホワイトリスト系の用途では未使用。
    // AIP説明用の日本語詳細版VJA_USE_FRONT_JS_INFOとは別物）
    // vja.notify.toastはVJA_FRONT_API_MANDATORY_ENGに含まれるためここでの個別追記は不要。
    const VJA_USE_FRONT_JS_INFO_ENG = (
        VJA_FRONT_API_DB_ENG + "\n\n" +
        VJA_FRONT_API_MANDATORY_ENG + "\n\n" +
        Object.values(VJA_FRONT_API_OPTIONAL_ENG).join("\n\n")
    ).trim();

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
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // isAppEvent=true(バックエンド/アプリイベント)とfalse(フロントエンド/イベントJS)で
    // ルール文言が分岐する。それぞれのルール内容（英語部分）の要約は以下の通り:
    // ## Structure: インラインで書く／if・try等のブロック内で変数宣言しない／
    //   バックエンドはconst禁止(letのみ)、フロントエンドはconst/let禁止(varのみ)／
    //   フロントエンドはヘルパー関数(handleXxx等)の定義自体を禁止／インデント4スペース
    // ## vja API: vja.*APIがあれば必ず使う→なければ拡張ランタイム→最後に標準JS、の優先順位。
    //   crypto.subtle等の独自実装禁止。vja.*呼び出しはawait必須(例外あり)。
    //   画面遷移はvja.form.navigate()のみ、window.location禁止。
    //   (フロントエンドのみ)window.confirm/alert禁止、ウィジェット値は.valueで包まれない
    // ## SQL: プレースホルダ(?)必須、LIKE検索は'%'をJS側で結合、値の直接埋め込み禁止
    //   （識別子＝カラム名/テーブル名なら埋め込み可、値は必ず?経由）
    // ## YAML Definition Structure: 「イベント」「説明」は参考情報で実装根拠にしない、
    //   「アクション」だけが実装の根拠。「〇〇の場合/それ以外」→if/else、
    //   「〇〇に対して繰り返し」→for/forEachに変換
    // ## Fidelity to YAML: YAMLに書かれていない処理(navigate/show/hide等)を勝手に追加禁止、
    //   イベント名から典型的な実装を推測して追加することも禁止。
    //   (バックエンドのみ)エラーログはconsole.error(e.message, e)の形式で第2引数にErrorを渡す
    // ## Other: コメントは日本語で書く
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
            : VJA_FRONT_API_MANDATORY_ENG;

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
- API selection priority (always follow this order, do NOT skip a tier): 1) If a vja.* API exists for the operation (see [vja Runtime(yaml)] below), you MUST use it. 2) If no vja.* API covers it, but a function is defined under the "### 拡張ランタイム(yaml)" section in the user message, use that. 3) Only if neither covers it, fall back to a standard/available JavaScript API. Never reimplement something a vja.* API already provides (e.g. do NOT use crypto.subtle directly — use vja.crypto.sha256/sha1/sha512 or vja.crypto.encrypt/decrypt instead).
- All vja.* calls must use "await", except for the following synchronous calls: vja.event.*, vja.trigger.*, vja.widget.get, vja.widget.set, vja.widget.show, vja.widget.hide, vja.widget.enable, and vja.widget.disable.
- Never use Promise, .then(), or .catch() directly. Use await instead.
- Screen navigation must use vja.form.navigate('screen name') only. (window.location is prohibited)
- navigate() is exclusively for navigating to a different screen. Using it to refresh or update the current screen is absolutely prohibited.

## SQL
- Placeholders (?) are mandatory for all variable inputs to prevent SQL injection.
- Implemented using SQL specific to sqlite3. Must be defined using executable SQL statements.
- For SQL LIKE searches, NEVER place the '?' placeholder inside quotes (e.g., LIKE '%?%' is STRICTLY PROHIBITED as it breaks the placeholder). Always concatenate the '%' wildcards to the JavaScript variable side.
  - Example: let pattern = '%' + searchText + '%'; let sql = 'SELECT * FROM t WHERE name LIKE ?'; await vja.db.query(sql, [pattern]);
- NEVER embed a data VALUE into the SQL string using a template literal (\`\${...}\`). Any value (search text, numbers, IDs, JSON.stringify() results, etc.) must always be passed through the \`?\` placeholder and the params array. Embedding a value directly (e.g., \`WHERE id = \${id}\` or \`WHERE data = \${JSON.stringify(obj)}\`) is STRICTLY PROHIBITED.
  - Bad: \`SELECT * FROM users WHERE name = \${name}\`
  - Good: let sql = 'SELECT * FROM users WHERE name = ?'; await vja.db.query(sql, [name]);
  - Embedding a column/table NAME (an identifier, not a data value) via template literal is acceptable when the identifier itself is fixed or comes from a controlled source (e.g., a dropdown of known column names) — e.g., \`SELECT * FROM t WHERE \${columnName} = ?\` is fine as long as columnName is an identifier and the actual searched value still goes through \`?\`.

## YAML Definition Structure
- The YAML specification uses the following keys. Make sure you understand the meaning of each correctly.
  - イベント (Event): Reference information only. NEVER use it as a basis for implementation.
  - 説明 (Description): A summary of the processing. It is not a direct implementation instruction.
  - 利用テーブル (Tables Used): The names of the DB tables referenced.
  - アクション (Action): The actual processing to implement. This is the ONLY basis for implementation.
  - 正常終了 (Normal Completion): The state when the processing has completed successfully.
- When the following heading expressions appear inside "アクション:" (Action), implement them as the corresponding program structure:
  - Headings of the form "〇〇の場合:" (When 〇〇) / "それ以外の場合:" (Otherwise) must be implemented as an if/else conditional branch.
  - Headings of the form "〇〇に対して繰り返し:" (Repeat for each 〇〇) must be implemented as a for/forEach loop.
  - If such headings are further nested beneath one another, implement the corresponding blocks as nested structures accordingly.

## Fidelity to YAML
- Adding operations not specified in the YAML (such as navigate, setVisible, show/hide, etc.) is strictly prohibited.
- Strictly adhere to the implementation requirements specified in "the YAML specification".
- The event name (e.g., KeyUp, SelectedIndexChanged) is merely reference information indicating what triggers the code — it is NOT an instruction. NEVER infer or add a "typical" implementation commonly associated with that event name (e.g., assuming SelectedIndexChanged implies "retrieve the selected value and display it"). The implementation must be based solely on what is explicitly specified under "アクション:" (Action).

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
- API selection priority (always follow this order, do NOT skip a tier): 1) If a vja.* API exists for the operation (see [vja Runtime(yaml)] below), you MUST use it. 2) If no vja.* API covers it, but a function is defined under the "### 拡張ランタイム(yaml)" section in the user message, use that. 3) Only if neither covers it, fall back to a standard/available JavaScript API. Never reimplement something a vja.* API already provides (e.g. do NOT use crypto.subtle directly — use vja.crypto.sha256/sha1/sha512 or vja.crypto.encrypt/decrypt instead).
- All vja.* calls must use "await", except for the following synchronous calls: vja.event.*, vja.trigger.*, vja.widget.get, vja.widget.set, vja.widget.show, vja.widget.hide, vja.widget.enable, and vja.widget.disable.
- Never use Promise, .then(), or .catch() directly. Use await instead.
- Screen navigation must use vja.form.navigate('screen name') only. (window.location is prohibited)
- navigate() is exclusively for navigating to a different screen. Using it to refresh or update the current screen is absolutely prohibited.
- window.confirm/alert are prohibited. Use vja.app.showDialog/showConfirm instead.
- Widgets are NOT accessible via direct DOM-style property access (e.g., searchText.value, document.getElementById('x').value are ALL INVALID). vja.widget.get()'s return value is already the raw unwrapped value (string/number/boolean/array) — it is never wrapped in a \`.value\` property. Accessing \`.value\` on it will NOT throw — it silently becomes undefined and causes subtly wrong behavior. The ONLY way to read a widget's current value is vja.widget.get('widgetName'), and you must use the returned value directly.

## SQL
- Placeholders (?) are mandatory for all variable inputs to prevent SQL injection.
- Implemented using SQL specific to sqlite3. Must be defined using executable SQL statements.
- For SQL LIKE searches, NEVER place the '?' placeholder inside quotes (e.g., LIKE '%?%' is STRICTLY PROHIBITED as it breaks the placeholder). Always concatenate the '%' wildcards to the JavaScript variable side.
  - Example: var searchText = vja.widget.get('txtSearch'); var pattern = '%' + searchText + '%'; var sql = 'SELECT * FROM t WHERE name LIKE ?'; await vja.db.query(sql, [pattern]);
- NEVER embed a data VALUE into the SQL string using a template literal (\`\${...}\`). Any value (search text, numbers, IDs, JSON.stringify() results, etc.) must always be passed through the \`?\` placeholder and the params array. Embedding a value directly (e.g., \`WHERE id = \${id}\` or \`WHERE data = \${JSON.stringify(obj)}\`) is STRICTLY PROHIBITED.
  - Bad: \`SELECT * FROM users WHERE name = \${name}\`
  - Good: var sql = 'SELECT * FROM users WHERE name = ?'; await vja.db.query(sql, [name]);
  - Embedding a column/table NAME (an identifier, not a data value) via template literal is acceptable when the identifier itself is fixed or comes from a controlled source (e.g., a dropdown of known column names) — e.g., \`SELECT * FROM t WHERE \${columnName} = ?\` is fine as long as columnName is an identifier and the actual searched value still goes through \`?\`.

## YAML Definition Structure
- The YAML specification uses the following keys. Make sure you understand the meaning of each correctly.
  - イベント (Event): Reference information only. NEVER use it as a basis for implementation.
  - 説明 (Description): A summary of the processing. It is not a direct implementation instruction.
  - 利用テーブル (Tables Used): The names of the DB tables referenced.
  - アクション (Action): The actual processing to implement. This is the ONLY basis for implementation.
  - 正常終了 (Normal Completion): The state when the processing has completed successfully.
- When the following heading expressions appear inside "アクション:" (Action), implement them as the corresponding program structure:
  - Headings of the form "〇〇の場合:" (When 〇〇) / "それ以外の場合:" (Otherwise) must be implemented as an if/else conditional branch.
  - Headings of the form "〇〇に対して繰り返し:" (Repeat for each 〇〇) must be implemented as a for/forEach loop.
  - If such headings are further nested beneath one another, implement the corresponding blocks as nested structures accordingly.

## Fidelity to YAML
- Adding operations not specified in the YAML (such as navigate, setVisible, show/hide, etc.) is strictly prohibited.
- When implementing logic to output an error log upon "error termination" (or similar events) using the "message" property of an "Error" object from a "try { } catch (e)" block, you must always set the "Error" object itself as the second argument—specifically, "console.error(e.message, e)".
- The event name (e.g., KeyUp, SelectedIndexChanged) is merely reference information indicating what triggers the code — it is NOT an instruction. NEVER infer or add a "typical" implementation commonly associated with that event name (e.g., assuming SelectedIndexChanged implies "retrieve the selected value and display it"). The implementation must be based solely on what is explicitly specified under "アクション:" (Action).

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
${_safeYamlFence(vjaUseJsInfo)}yaml
${vjaUseJsInfo}
${_safeYamlFence(vjaUseJsInfo)}
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
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // 「YAMLに従って実装せよ」という指示文＋各種コンテキスト（ウィジェット一覧・
    // フォーム定数・入力パラメータ・画面一覧・グローバル定数・テーブル定義・
    // 拡張ランタイム・任意API・学習履歴）を英語の見出しで列挙するだけの構成。
    // 特殊なのはeventTypeHint（下記）で、RowClick/HeaderClick/KeyDown/KeyUp等の
    // イベントでは「vja.event.get().type に入る正しい値」をAIが誤って別名を
    // 創作しないよう、その場で具体的に念押しする一文を追加している。
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
            optionalApiDocCtx,
            learnedFixesCtx,
        },
    ) {
        const programType = isAppEvent ? "TypeScript" : "JavaScript";
        const widgetLineEn = wname ? `- Current widget: ${wname}\n` : "";

        // このコード生成が対象とする具体的なイベント名に基づき、
        // vja.event.get().type に入り得る「唯一の正しい値」をその場で計算し、
        // プロンプトに動的に埋め込む。ドキュメント上の一般ルールだけでは、
        // AIが「近い別のイベント名」を創作してしまう事例が実際にあったため
        // （例: KeyUpイベント用のコードなのに ev.type === 'keyDown' と誤記する）、
        // 抽象的なルールに加えて「今回はこの値だけが正しい」と具体的に
        //念押しする形にしている。
        const eventTypeHintEn = (() => {
            if (isAppEvent || !eventName) return "";
            if (eventName === "RowClick") {
                return "\n- IMPORTANT: This code is for the \"RowClick\" event. If you call vja.event.get(), ev.type will ALWAYS be exactly 'rowClick'. Never use any other value.\n";
            }
            if (eventName === "HeaderClick") {
                return "\n- IMPORTANT: This code is for the \"HeaderClick\" event. If you call vja.event.get(), ev.type will ALWAYS be exactly 'headerClick'. Never use any other value.\n";
            }
            if (eventName === "Click" && wtag === "datagrid") {
                return "\n- IMPORTANT: This code is for the \"Click\" event on a datagrid. If you call vja.event.get(), ev.type will be either 'rowClick' or 'headerClick' — no other value is possible.\n";
            }
            if (eventName === "KeyDown" || eventName === "KeyUp") {
                const correct = eventName.charAt(0).toLowerCase() + eventName.slice(1);
                const wrongSibling = eventName === "KeyDown" ? "keyUp" : "keyDown";
                return `\n- IMPORTANT: This code is specifically for the "${eventName}" event (NOT ${eventName === "KeyDown" ? "KeyUp" : "KeyDown"}). If you call vja.event.get(), ev.type will ALWAYS be exactly '${correct}' — NEVER '${wrongSibling}' or any other value. Do not confuse this with the other Key event. To check which key was pressed, use vja.event.getKey()/isEnter()/isEscape() etc. instead of comparing ev.type.\n`;
            }
            return "";
        })();

        // Context information for Frontend/Widget events
        const frontInfo = isAppEvent
            ? ""
            : `
### Project Information
---
- Current Form: ${formName}
${widgetLineEn}- Current Event: ${eventName}
${eventTypeHintEn}---

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
${optionalApiDocCtx ? "\n### Additional Available APIs (enabled for this event)\n---\n" + optionalApiDocCtx + "\n---\n" : ""}
${learnedFixesCtx ? "\n### Project-Specific Notes\n---\n" + learnedFixesCtx + "\n---\n" : ""}
### Extended Runtime(yaml)
---
${_safeYamlFence(extRuntimeDoc)}yaml
${extRuntimeDoc}
${_safeYamlFence(extRuntimeDoc)}
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
${_safeYamlFence(yamlDef)}yaml
${_removeYamlShComments(yamlDef)}
${_safeYamlFence(yamlDef)}
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
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // JavaScriptコードを解析してAPIドキュメントをYAMLで生成させるプロンプト。
    // キー名（function/description/arguments/returns/exception/example/
    // example_description）は英語固定、値（説明文）は日本語で書かせる。
    // 出力は生YAMLのみ、コードブロックや前置き・説明文は禁止。
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

    // [英語]拡張ランタイム用ユーザプロンプト.
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // 「以下のJavaScriptコードを解析してシステム指示のYAML形式でドキュメント化せよ」
    // という指示＋対象コード本文＋「生YAMLのみ出力、コードブロック禁止」の念押し。
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
アクション: 
  - 

正常終了: なし
`.trim() + "\n\n\n\n\n"
        );
    };

    // [英語:プロンプト]画面デザイン自動生成（YAML風の依頼文からウィジェット構成JSONを生成）
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // ユーザーが日本語で書いた「画面デザインYAML」（説明/フォームレイアウト/参照テーブル/
    // 入力項目/アクション項目）を読み取り、重ならない座標(x,y,w,h)付きのウィジェット
    // 配置JSON配列を出力させるプロンプト（＝「🤖 画面反映」ボタンで使用）。
    // 1. フォームレイアウト最優先: カラム数/ラベル位置/ボタン位置/密度の指示に従う。
    //    ボタンが複数ある場合は右端起点で逆算しgap10pxで並べる計算式を明記（重なり防止）。
    // 2. 画面パターン別の配置方針: 検索一覧画面（上部に検索条件＋下部にdatagrid）、
    //    登録・詳細画面（1〜2列＋右下/中央にボタン）。
    // 3. 座標・サイズの基準: フォーム幅高さ内に収める、各ウィジェットの標準高さ、
    //    ウィジェット間は最低6pxの隙間を空け重なり禁止。
    // [出力フォーマット]生JSON配列のみ、コードブロック・説明文禁止。
    // [JSONスキーマ]tag/name/text/inputType/placeholder/group/options/columns/x/y/w/h。
    // ボタンのcaptionは「〇〇ボタン」の「ボタン」を除去して短くする。
    // 参照テーブルにないカラム名を勝手に作らない。ボタン数は依頼のアクション項目数と一致させる。
    // 以降はFew-Shot例（検索一覧画面1個、複数ボタン1個）。
    const ENG_FORM_DESIGN_SYS_PROMPT = function ({ formW, formH, tablesCtx }) {
        return (`
You are an expert business application UI designer specializing in screen layout design for VJA (a form designer for desktop/web business apps).
Your task is to read a Japanese YAML screen definition (including screen purpose, form layout directives, input fields, and action items), determine appropriate widgets, and output a precise layout JSON array with non-overlapping pixel coordinates (x, y, w, h).

[Layout Directives & High-Priority Rules]
1. Highest Priority of "フォームレイアウト" (Form Layout Directives):
   - You MUST strictly follow directives written in "フォームレイアウト" (or formLayout).
   - Recognize layout parameters:
     - Columns ("カラム数" / "columns"): 1 | 2 | 3. Divide inputs into clean columns (e.g., 2 columns: Col 1 x=20, Col 2 x=${Math.floor(formW / 2) + 10}).
     - Label Position ("ラベル位置" / "labelPosition"): "左" (left / label on the left of input, e.g., lbl x=20 w=100, input x=125 w=180, same y) OR "上" (top / label above input, e.g., lbl x=20 y=Y w=180 h=20, input x=20 y=Y+22 w=180 h=26). Default is "left".
     - Button Alignment ("ボタン位置" / "buttonPosition"): "右下" (bottom-right) | "右" (top-right for search buttons) | "下部中央" (bottom-center).
       - **When there are multiple action buttons, you MUST compute each button's x from the form's RIGHT EDGE, not from a single fixed x.** Use this exact formula for N buttons (button width w=85, gap=10px between buttons, right margin=20px):
         - rightmost button: x = ${formW} - 20 - w
         - each button to its left: x = (x of the button to its right) - gap - w
         - i.e. for buttons ordered left-to-right [btn_1 .. btn_N], x(btn_i) = ${formW} - 20 - (N - i + 1) * w - (N - i) * gap
         - All buttons share the same y = ${formH - 45} (bottom-right) and h=28~32.
       - Example for N=3 buttons (w=85, gap=10) in a form of width ${formW}: x(btn_3)=${formW}-20-85, x(btn_2)=x(btn_3)-10-85, x(btn_1)=x(btn_2)-10-85.
       - Verify after computing: the leftmost button's x MUST be >= 20 (left margin). If it is not, reduce button width or wrap to a second row instead of overlapping.
     - Density ("密度" / "density"): "コンパクト" (compact: item height 24px, gapY 28px) | "標準" (normal: item height 28px, gapY 36px).

2. Recognized Screen Layout Patterns:
   - Search & List Screen (検索・一覧画面):
     - Search Condition Area (Top): Place labels and inputs in 1 or 2 rows (y: 20~80). Place Search/Clear buttons to the right of inputs or on the right.
     - Data Grid Area (Bottom): Place a "datagrid" filling the remaining width and height (x: 20, y: searchAreaBottom + 15, w: ${formW - 40}, h: ${formH} - y - 30).
   - Form & Registration Screen (登録・詳細画面):
     - Place labels and inputs structured in 1 or 2 clean columns with uniform row gaps (yDelta: 36~40px).
     - Action buttons (Save, Cancel, Close, etc.) MUST be aligned at the bottom right (y: ${formH - 45}, h: 30) or bottom center. When there are 2 or more buttons, apply the multi-button x formula defined above (rightmost button flush against the right margin, each additional button placed 10px further left) so that buttons never overlap and never exceed the form width.

3. Coordinates & Sizing Guidelines:
   - Form Bounds: Width = ${formW}px, Height = ${formH}px. All widgets MUST fit within x+w <= ${formW} and y+h <= ${formH}.
   - Standard Heights: label=22~24px, inputtype/selectBox=26~28px, textarea=60~100px, button=28~32px, datagrid=200~400px.
   - Strict No-Overlap: No two widgets may intersect or overlap. Leave a minimum 6px gap between widgets.

[Output Format Rules - Strict Adherence Required]
- Output MUST be a raw JSON array only.
- Do NOT wrap the JSON in markdown code blocks (e.g., do not use \`\`\`json). Start directly with [ and end with ].
- Do not include any explanations, introduction, or comments.

[JSON Schema per Element]
Each object in the array must have the following keys:
- "tag": "inputtype" | "textarea" | "checkbox" | "radio" | "selectBox" | "listbox" | "button" | "label" | "datagrid" | "qrcode" | "markdown"
- "name": Unique VB6-style Hungarian notation (e.g., txtUserId, lblUserId, btnSubmit, chkAgree, radMale, cmbCategory, lstItems, txaMemo, tblResult). Unique within array.
- "text": Caption text for "label", "button", "checkbox", "radio" (required). For "qrcode", the raw text/URL. For "markdown", raw Markdown source. Empty "" for others.
  - For "button": strip generic type-indicating suffixes such as "ボタン"/"button" from the action item text before using it as the caption (e.g. アクション項目 "検索ボタン" → caption "検索", "ログインボタン" → "ログイン"). The shape of the widget already conveys it is a button, so repeating "ボタン" in the caption is redundant.
- "inputType": (Required only when tag is "inputtype") "text" | "password" | "number" | "email" | "tel" | "date" | "time" | "url"
- "placeholder": (Optional) Sample text for "inputtype" or "textarea".
- "group": (Required only when tag is "radio") Group name.
- "options": (Required only when tag is "selectBox" or "listbox") Array of options: ["Item1", "Item2"] or [{"label": "馬名", "value": "name"}, ...].
- "columns": (Required only when tag is "datagrid") Array of column definitions: [{"name": "col_name", "displayName": "表示名", "width": 25}, ...].
- "x", "y", "w", "h": Integers (pixels).

- Reference tables: Do not arbitrarily invent column names not in the reference table.
- Number of buttons: Match the number of action items specified in the request.

[Few-Shot Example]
Input YAML Example:
---
説明: horse_info 内容を検索して表示するための画面
フォームレイアウト: 
  - パターン: 検索一覧画面
  - カラム数: 2
  - ラベル位置: 左
  - ボタン位置: 右下
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
  {"tag": "label", "name": "lblSearchWord", "text": "検索ワード", "x": 20, "y": 20, "w": 90, "h": 24},
  {"tag": "inputtype", "name": "txtSearchWord", "text": "", "inputType": "text", "placeholder": "検索ワードを入力", "x": 115, "y": 20, "w": 160, "h": 26},
  {"tag": "label", "name": "lblSearchCol", "text": "検索対象", "x": 295, "y": 20, "w": 75, "h": 24},
  {"tag": "selectBox", "name": "cmbSearchCol", "options": [
    {"label": "馬名", "value": "name"},
    {"label": "父馬", "value": "father"},
    {"label": "母馬", "value": "mother"},
    {"label": "性別", "value": "sex"}
  ], "x": 375, "y": 20, "w": 130, "h": 26},
  {"tag": "button", "name": "btnSearch", "text": "検索", "x": 515, "y": 20, "w": 85, "h": 26},
  {"tag": "datagrid", "name": "tblHorseInfo", "columns": [
    {"name": "name", "displayName": "馬名", "width": 25},
    {"name": "father", "displayName": "父馬", "width": 25},
    {"name": "mother", "displayName": "母馬", "width": 25},
    {"name": "sex", "displayName": "性別", "width": 25}
  ], "x": 20, "y": 60, "w": ${formW - 40}, "h": ${Math.max(180, formH - 90)}}
]

[Few-Shot Example: Multiple Action Buttons]
Input YAML Example (form width ${formW}):
---
説明: タスクの追加・マスキング・編集を行うための画面
アクション項目:
  - 追加ボタン
  - マスキングボタン
  - 編集ボタン
---
Output JSON Example (3 buttons, w=85, gap=10, right margin=20, computed right-to-left from ${formW}):
[
  {"tag": "button", "name": "btnAdd", "text": "追加", "x": ${formW - 20 - 85 - 10 - 85 - 10 - 85}, "y": ${formH - 45}, "w": 85, "h": 28},
  {"tag": "button", "name": "btnMasking", "text": "マスキング", "x": ${formW - 20 - 85 - 10 - 85}, "y": ${formH - 45}, "w": 85, "h": 28},
  {"tag": "button", "name": "btnEdit", "text": "編集", "x": ${formW - 20 - 85}, "y": ${formH - 45}, "w": 85, "h": 28}
]
Note: each button's x is derived from the RIGHT EDGE of the form, not from a fixed left-side offset. Never place multiple buttons at increasing x values without first anchoring the rightmost one to (${formW} - 20 - w).

[Reference Table Definition]
---
${tablesCtx || "(No reference table specified)"}
---
`.trim() + "\n");
    };

    // [英語:プロンプト]画面デザイン自動生成 ユーザープロンプト.
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // 「以下のYAML画面デザイン依頼に基づき配置JSON配列を生成せよ」という指示＋
    // 依頼YAML本文＋（あれば）追加指示＋「生JSON配列のみ出力」の念押し。
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
# フォームデザイン定義

説明: ユーザー情報を検索・登録するための画面
フォームレイアウト:
  - パターン: 検索一覧画面   # 検索一覧画面 / 登録フォーム画面 / ダイアログ
  - カラム数: 2               # 1 / 2 / 3
  - ラベル位置: 左            # 左 / 上
  - ボタン位置: 右下          # 右下 / 右 / 下部中央

#参照テーブル: 
#  - users

入力項目: 
  - 検索ワード: inputtype で text
  - 権限フィルター: selectBox
    - 一般ユーザー: user
    - 管理者: admin
  - 一覧表示: datagrid

アクション項目: 
  - 検索ボタン
  - クリアボタン
`.trim() + "\n\n";

    //////////////////
    // グローバル展開.
    //////////////////
    const o = {};
    window._PROMPT_DEF = o;

    // [日本語]利用可能関数一覧: js利用者向けのvjaランタイム説明等.
    o.VJA_USE_BACK_JS_INFO = VJA_USE_BACK_JS_INFO; // バックエンド.
    o.VJA_USE_FRONT_JS_INFO = VJA_USE_FRONT_JS_INFO; // フロントエンド.

    // [フロントエンド] API定義（カテゴリ分割版・必須/DB専用/任意）.
    // 「任意API有効化（イベントエディタのチェックボックス）」機能で使用.
    o.VJA_FRONT_API_MANDATORY_ENG = VJA_FRONT_API_MANDATORY_ENG;
    o.VJA_FRONT_API_DB_ENG = VJA_FRONT_API_DB_ENG;
    o.VJA_FRONT_API_OPTIONAL_ENG = VJA_FRONT_API_OPTIONAL_ENG;
    o.VJA_FRONT_API_OPTIONAL_LABELS = VJA_FRONT_API_OPTIONAL_LABELS;

    // [プロンプト]yamlから js AI生成依頼.
    // (日本語版は使用実績がなく陳腐化していたため削除済み。英語版のみ使用)
    o.YAML_TO_JS_SYS_PROMPT = ENG_YAML_TO_JS_SYS_PROMPT;
    o.YAML_TO_JS_USER_PROMPT = ENG_YAML_TO_JS_USER_PROMPT;

    // [プロンプト]画面デザイン自動生成（ウィジェット配置JSON生成）.
    o.FORM_DESIGN_SYS_PROMPT = ENG_FORM_DESIGN_SYS_PROMPT;
    o.FORM_DESIGN_USER_PROMPT = ENG_FORM_DESIGN_USER_PROMPT;

    // [プロンプト]拡張ランタイムyamlから js AI生成依頼.
    // (日本語版は使用実績がなく陳腐化していたため削除済み。英語版のみ使用)
    o.EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT = ENG_EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT;
    o.EXT_RUNTIME_JS_TO_YAML_USER_PROMPT =
        ENG_EXT_RUNTIME_JS_TO_YAML_USER_PROMPT;

    // イベント用yamlエディタ初期値.
    o.DEFAULT_YAML_VALUE = DEFAULT_YAML_VALUE;

    // フォームデザイン用yamlエディタ初期値.
    o.DEFAULT_FORM_DESIGN_YAML = DEFAULT_FORM_DESIGN_YAML;

    // [プロンプト]自然言語要求からVJAイベントYAMLを生成
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // 「イベント処理でやりたいこと」の日本語一言依頼文を、イベントYAML定義
    // （description/tables(該当時のみ)/validation/actions(手順の自然文列挙)/
    // on_success/on_error）に変換させるプロンプト（＝イベントYAMLエディタの
    // 「✨ YAMLドラフト」タブ）。actionsは「手順をそのまま列挙する」だけで、
    // 画面デザイン側のfields/actionsのような分類判断が不要な単純な構造。
    // 出力は生YAMLのみ、コードブロック・説明文禁止。
    const ENG_TEXT_TO_YAML_SYS_PROMPT = function ({ widgetsCtx, tablesCtx }) {
        return (`
You are an expert AI assistant for VJA (Visual JavaScript for AI).
Your task is to convert a user's natural language request (written in Japanese) describing what a form event should do into a clean, structured VJA Event Design YAML specification.

[VJA Event YAML Format Specification]
Output strictly formatted YAML with the following keys:

description: <Brief Japanese summary of the event purpose>
tables:
  - <table_name> (Include this section ONLY IF database table access is mentioned or required; otherwise omit this section entirely)
validation: <Validation requirements if mentioned, or "なし">
actions:
  - <Step 1 action description in clear Japanese, referencing exact widget names and DB column names where applicable>
  - <Step 2 action description>
on_success: <Log or toast notification on clean completion, e.g. "トーストで完了を出力" or "なし">
on_error: <Error handling policy, e.g. "ログとトーストにエラーを出力">

[Strict Output Rules]
- Output ONLY the raw YAML text. Do NOT wrap response in markdown code blocks (\`\`\`yaml).
- Do not include any intro, explanations, or conversational text.
- Begin your response immediately with "description:".
- Use actual widget names (e.g. txtName, btnSearch, tblUsers) and reference table columns from the context provided below.

[Available Widgets Context]
${widgetsCtx || "(No widgets)"}

[Available Database Tables Context]
${tablesCtx || "(No DB tables)"}            
`.trim() + "\n");
    };

    // [日本語対訳メモ]（AIには送られない）「以下の依頼文からイベントYAMLを生成せよ」＋依頼文＋出力形式の念押し。
    const ENG_TEXT_TO_YAML_USER_PROMPT = function (userReq) {
        return (
            "Based on the following natural language request, generate a structured VJA Event Design YAML specification:\n\n" +
            "[User Request]\n" + userReq.trim() + "\n\n" +
            "[CRITICAL] Output raw YAML only. Do NOT wrap in markdown code blocks (```yaml). No conversational text."
        );
    };

    o.TEXT_TO_YAML_SYS_PROMPT = ENG_TEXT_TO_YAML_SYS_PROMPT;
    o.TEXT_TO_YAML_USER_PROMPT = ENG_TEXT_TO_YAML_USER_PROMPT;

    // [プロンプト]自然言語要求からフォームデザインYAMLを生成
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // 「画面デザインYAMLドラフト生成」（✨ YAMLドラフト生成ボタン）用プロンプト。
    // 依頼文をdescription/layout/fields/tables/actionsのYAMLに変換させる。
    // ※このプロンプトは「fields/actionsのどちらに何を入れるか」という分類判断を
    // AIに要求する点が、イベントYAML側（単純な手順列挙）と大きく異なり、
    // OpenAI(gpt-5.6-luna)で fields:[]/actions:[] のように該当項目が丸ごと
    // 空で返ってくる不具合の主因となった箇所（2026-08-10調査）。
    // 当初は個別の失敗例に対する例外ルールを都度追記していたが、ルールが密に
    // 絡み合い矛盾含みになったことで逆にAIの判断を混乱させていたと判断し、
    // 2026-08-10に以下のようシンプルな構成へ整理し直した:
    // [Strict Output Rules]基本ルール2点（生YAMLのみ/発明禁止）
    // [Core Principle]大原則「不要だと決めつけるな。空にする前に依頼文を読み返せ。
    //   迷ったらfields/actionsのどちらかに含める側に倒せ、削除ではなく」
    // [What Goes In "fields"]画面上で見る/選ぶ/編集する対象は全部fields。
    //   絞り込み条件が文中の一部として書かれているだけでも対象。項目名が
    //   明示されなくても参照テーブルのカラムから推測してよい。
    // [What Goes In "actions"]ボタンの短い名前だけ。挙動説明文が付いていても
    //   ボタン名部分は残し、挙動の記述だけを削る（丸ごと削除しない）。
    // 以降、上記に対応するFew-Shot例（ボタン+挙動説明文のケース）。
    //
    // 実測検証（2026-08-10、実際にOpenAI gpt-5.6-lunaへ複数回リクエストして確認）:
    // 当初は「参照テーブルが複数あると混同して空になる」と推測したが、テーブル数を
    // 絞ってもfieldsの空・不足は改善しなかった。一方で「[Existing Widgets On This
    // Form]に既存ウィジェットを渡すと、AIは『既にfields相当のウィジェットが置かれて
    // いるので重複させない』というルールに従って正しくfieldsを省略していた」ことが
    // 判明した（何度もテストを繰り返し、既にウィジェットが配置済みの画面に対して
    // 再度ドラフト生成をかけていたための現象）。「YAMLドラフト生成」はウィジェット
    // 配置前の仕様書作成ステップであり、重複回避は後工程の「🤖 画面反映」側の
    // 責務にすべきと判断し、既存ウィジェットのコンテキスト自体をこのプロンプトから
    // 削除した（widgetsCtx削除、以前のwidgetsCtx=空文字での実測は0/18で完全に安定）。
    const ENG_FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT = function ({ tablesCtx }) {
        // 画面レイアウトイメージ（入力/表示/ボタンエリアの配置構造）の選択肢一覧。
        // ここでAIに選ばせた結果はYAML本文には出力させず、専用の
        // "layout_pattern:" 1行だけに出させる。呼び出し元
        // (formDesignTextToYamlGenerate)がその行を抽出・除去した上で、
        // getProjectData().formLayoutPattern（"🖼 レイアウト"タブの選択状態）
        // に反映し、YAML本文（description/fields/tables/actions）には
        // 一切混在させない。
        // ID文字列（camelCase）をそのままAIに選ばせると、ローカルLLMが複数のIDを
        // 混ぜ合わせた実在しない文字列を生成することがあるため、番号選択方式にする
        // （数字は単語のように混ぜ合わせようがなく、ローカルLLMでも取り違えにくい）。
        const layoutPatternList = typeof getFormLayoutPatterns === "function" ? getFormLayoutPatterns() : [];
        const layoutPatternOptions = layoutPatternList
            .map((p, i) => `  ${i + 1}. ${p.desc}`)
            .join("\n");
        return (`
You are an expert AI assistant for VJA (Visual JavaScript for AI).
Your task is to convert a user's natural language request (written in Japanese) describing a desired screen layout and form requirements into a clean, structured VJA Form Design YAML specification.

[VJA Form Design YAML Format Specification]
Output strictly formatted YAML with the following sections:

description: "<Brief Japanese summary of the screen purpose>"

layout_pattern: <number>
[STRICT RULE for layout_pattern] The value MUST be a single digit number, chosen from the numbered list below, that best matches the request's overall input/display/button placement. If none of them clearly fits (or the request gives no layout hint), output 0. Output ONLY the number itself (e.g. "3"), never the description text.
[Selection Guide] First decide: does this screen need ANY list/table/read-only display area (e.g. search results, a data grid, summary figures, a record list)? If NO — e.g. a login screen, a simple settings/registration form with only input fields and buttons and nothing to browse or view — you MUST pick a pattern whose description says it has no display area (currently only one such pattern below). Only if the screen DOES need a display/list area should you pick one of the patterns that includes one, based on where that area should sit (bottom-full-width, side, multiple small tiles, etc).
Available layout patterns (number: structural description — these describe ONLY the rough placement of input/display/button areas, NOT which widget types to use):
${layoutPatternOptions}

fields:
  - <Field Name>: <Widget type (e.g. inputtype with text/number/date, selectBox, datagrid, text, image, checkbox, label, textarea, groupbox, tabs)>

tables:
  - <table_name> (Include if database table integration is mentioned or relevant)

actions:
  - <Button text or action name> (e.g. 検索ボタン, 保存ボタン, キャンセル)

[Strict Output Rules]
- Output ONLY the raw YAML text. Do NOT wrap response in markdown code blocks (\`\`\`yaml). No intro, explanations, or conversational text. Begin your response immediately with "description:".
- Do not invent fields or actions that are not stated or implied by the request (e.g. no generic "保存"/"キャンセル" unless save/cancel is mentioned).

[Core Principle: Never Assume Something Is Unnecessary]
Leaving "fields" or "actions" empty is a strong claim — only do it when the request truly contains nothing for that section. Before outputting an empty array, re-read the request once more for anything you might have dismissed as "just part of a sentence" rather than a concrete item. When unsure whether something belongs in "fields" or "actions", put it in "fields" rather than dropping it.

[What Goes In "fields"]
Anything the user can view, select, or edit on this screen — including a filter/narrowing condition that's only mentioned as part of an action's description (e.g. "優先度で絞り込む" → add a "優先度" field). If the request names no concrete field but references a table whose columns are visible in [Available Database Tables Context] below, derive fields from those columns instead of leaving "fields" empty.

[What Goes In "actions"]
One short label per pressable button (e.g. "追加", "検索"), never a full sentence. If a sentence names a button and also describes its effect (e.g. "追加ボタンを押すとタスクを追加する"), keep the short button label in "actions" and drop only the trailing effect description — do not drop the whole item.

[Few-Shot Example]
Input request: "タスクの詳細情報を入力できるフォームを用意。追加ボタンを押すとタスクを追加。" (with a referenced table "tasks" whose columns are title, priority, due_date, status)
Correct output:
layout_pattern: 3
fields:
  - タイトル: inputtype text
  - 優先度: selectBox
  - 期限: inputtype date
  - ステータス: selectBox
tables:
  - tasks
actions:
  - 追加

[Available Database Tables Context]
${tablesCtx || "(No DB tables)"}
`.trim() + "\n");
    };

    // [日本語対訳メモ]（AIには送られない）「以下の依頼文から画面デザインYAMLを生成せよ」＋依頼文＋出力形式の念押し。
    const ENG_FORM_DESIGN_TEXT_TO_YAML_USER_PROMPT = function (userReq) {
        return (
            "Based on the following natural language request, generate a structured VJA Form Design YAML specification:\n\n" +
            "[User Request]\n" + userReq.trim() + "\n\n" +
            "[CRITICAL] Output raw YAML only. Do NOT wrap in markdown code blocks (```yaml). No conversational text."
        );
    };

    o.FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT = ENG_FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT;
    o.FORM_DESIGN_TEXT_TO_YAML_USER_PROMPT = ENG_FORM_DESIGN_TEXT_TO_YAML_USER_PROMPT;

    // [プロンプト]プロジェクト新規作成ウィザード: それまでのQ&A履歴から次の1問を動的に生成する
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // 非技術者ユーザーに日本語で1問ずつ質問していく対話形式のウィザード。
    // 出力はJSON（question/answerType/options/status）のみ、マークダウン禁止。
    // - questionは1つの話題だけを聞く1問。過去の質問・回答で既に触れた話題は
    //   表現が違っても再度聞くの禁止（迷ったら「既に聞いた」とみなす）
    // - answerType: 自由記述はtext、単一選択はchoice、複数選択可はmulti_choice
    // - optionsはchoice/multi_choiceの時のみ必須（2〜5個の短い日本語ラベル）
    // - statusは「システム概要/主な機能/画面数の目安」の3項目固定、達成済みならdone:true
    // - 3項目すべて達成済みでも、質問を空にせず追加の確認質問を出す（終了はユーザー操作）
    const ENG_WIZARD_NEXT_QUESTION_SYS_PROMPT = function () {
        return (`
You are helping a non-technical user describe, in Japanese, the business application they want to build. This is an interactive interview: you ask ONE question at a time in Japanese, the user answers, and this repeats. The end goal is to gather enough information for a LATER step (not yours) to decompose the description into a list of screens (forms).

Based on the [Q&A History So Far] provided in the user message, decide the single most useful next question to ask.

[Output Rules]
- Output STRICT JSON only. No markdown code fences, no intro, no explanations.
- JSON shape:
{
  "question": "<the single next question, written in natural, polite Japanese, asking about ONE topic only>",
  "answerType": "text" | "choice" | "multi_choice",
  "options": ["<option 1>", "<option 2>", ...],
  "status": [
    { "label": "システム概要", "done": true },
    { "label": "主な機能", "done": false },
    { "label": "画面数の目安", "done": false }
  ]
}
- "question" must be exactly one concrete question in Japanese, answerable in a few sentences. Never ask two things at once.
- Before writing "question", re-read EVERY Q/A pair in [Q&A History So Far] one by one. Your new question is FORBIDDEN if it asks about the same topic/aspect as any prior question — this applies even when the wording is different, it is phrased more specifically/broadly, or it only rephrases something the user already covered in an earlier ANSWER (not just in a prior question). When in doubt about whether a topic is already covered, treat it as covered and move to a genuinely new topic instead.
- "answerType": use "text" for open-ended questions (e.g. describing the system's purpose in free prose). Use "choice" when the question naturally has a small set of concrete alternatives where the user picks exactly ONE (e.g. asking for a rough screen-count scale: 少なめ/標準/多め). Use "multi_choice" when the user may reasonably pick more than one (e.g. asking which of several common features are needed). Default to "text" when unsure.
- "options": REQUIRED (2 to 5 short Japanese labels) when answerType is "choice" or "multi_choice". OMIT this field entirely when answerType is "text".
- "status" always contains exactly these 3 items, in this order, with these exact labels: "システム概要", "主な機能", "画面数の目安". Mark "done": true only when that aspect has been sufficiently covered by the history so far.
- Even if you believe all 3 status items are already "done", still output one more useful clarifying or confirming question (the user has their own "complete" button to stop the interview early — you must never emit an empty question).
`.trim() + "\n");
    };

    // [日本語対訳メモ]（AIには送られない）これまでのQ&A履歴＋「システム指示通りに次の質問とstatusを生成せよ」の指示。
    const ENG_WIZARD_NEXT_QUESTION_USER_PROMPT = function (historyCtx) {
        return (
            "[Q&A History So Far]\n" +
            (historyCtx || "(まだ質問していません。これが最初の質問です)") +
            "\n\nGenerate the next question and status as specified in the system prompt."
        );
    };

    o.WIZARD_NEXT_QUESTION_SYS_PROMPT = ENG_WIZARD_NEXT_QUESTION_SYS_PROMPT;
    o.WIZARD_NEXT_QUESTION_USER_PROMPT = ENG_WIZARD_NEXT_QUESTION_USER_PROMPT;

    // [プロンプト]プロジェクト新規作成ウィザード: Q&A履歴から、最も近い「システムモデル」
    // （src/wizard-system-models/の骨格パターン）を番号で1つ選ばせる。
    // ローカルLLMはID文字列を自由記述させると架空の名前を混ぜて出力する傾向があるため、
    // 既存の番号選択方式（レイアウトイメージ選択等）を踏襲し、回答は番号のみに限定する。
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // Q&A履歴と、番号付きのシステムモデル要約一覧（名称/想定システムタイプ例/
    // 向いているケース/向いていないケース）を渡し、最も適合する番号を1つだけ
    // 数字で答えさせる。番号以外の文字（説明・記号等）は一切出力させない。
    const ENG_WIZARD_SYSTEM_MODEL_SYS_PROMPT = function () {
        return (`
You are an expert VJA (Visual JavaScript for AI) application architect. Based on the [Q&A History] describing a business application the user wants to build, and the [System Model Candidates] list (numbered structural skeletons this tool can use as a scaffold), choose the ONE candidate that best matches the described application.

[Output Rules]
- Output ONLY the number of the chosen candidate (e.g. "3"). No other characters, words, punctuation, markdown, or explanation of any kind.
- Choose exactly one number that appears in [System Model Candidates].
- Use the "向いているケース" (good fit) and "向いていないケース" (bad fit) notes under each candidate to decide. Prefer the candidate whose "向いているケース" most closely matches the history, and avoid one whose "向いていないケース" matches instead.
- If multiple candidates seem plausible, choose the single closest match rather than refusing to answer.
`.trim() + "\n");
    };

    const ENG_WIZARD_SYSTEM_MODEL_USER_PROMPT = function (historyCtx, modelListCtx) {
        return (
            "[Q&A History]\n" + historyCtx + "\n\n" +
            "[System Model Candidates]\n" + modelListCtx + "\n\n" +
            "Output only the number of the best-matching candidate, as specified in the system prompt."
        );
    };

    o.WIZARD_SYSTEM_MODEL_SYS_PROMPT = ENG_WIZARD_SYSTEM_MODEL_SYS_PROMPT;
    o.WIZARD_SYSTEM_MODEL_USER_PROMPT = ENG_WIZARD_SYSTEM_MODEL_USER_PROMPT;

    // [プロンプト]プロジェクト新規作成ウィザード: Q&A履歴から必要そうなDBテーブル候補を切り出す
    // （2026-08-10: フォーム分解より前に実行する順序に変更。フォーム一覧はまだ存在しない
    //   ため、Q&A履歴のみから候補を抽出する）
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // Q&A履歴から、必要になりそうなSQLiteテーブル候補をJSON配列で提案させる。
    // 各要素はname(英語snake_case、配列内で一意)/description(1文の日本語説明)のみ。
    // カラム定義は含めない（次のステップでAIが生成し、ユーザーが確認する）。
    // 履歴から明確に必要と分かるものだけ提案し、無関係なテーブルは発明しない。
    // テーブルが不要なら空配列[]を返す。
    const ENG_WIZARD_TABLE_CANDIDATES_SYS_PROMPT = function () {
        return (`
You are an expert VJA (Visual JavaScript for AI) application architect. Based on the [Q&A History] provided in the user message (a Japanese interview describing a business application the user wants to build), suggest candidate SQLite database tables that this application will likely need.

[Output Rules]
- Output STRICT JSON only (a JSON array). No markdown code fences, no intro, no explanations.
- Array item shape:
{
  "name": "<English snake_case or lowercase table name, e.g. users, products — must be unique across the array>",
  "description": "<one-sentence Japanese description of what this table stores>"
}
- Only suggest tables that are clearly implied by the history (e.g. a mention of user login implies a "users" table). Do not invent unrelated tables.
- Avoid creating multiple tables for what is really a single entity's attributes (e.g. do NOT create separate "priorities"/"deadlines"/"statuses" tables when they are just columns of a single "tasks" table) — this causes confusion in later steps. Prefer one well-designed table per real-world entity.
- Do NOT include column definitions — only table name and description. Columns will be designed in the next step.
- If no database table appears to be needed at all, output an empty array [].
- If [Recommended System Model Skeleton] is provided, treat its "テーブル構成の型" as a structural reference for what kind of tables (and how many) this type of application typically needs — but still base the actual table names/descriptions on what the [Q&A History] specifically describes. Do NOT invent tables that only appear in the skeleton example but are not implied by the history.
`.trim() + "\n");
    };

    // [日本語対訳メモ]（AIには送られない）Q&A履歴＋（あれば）システムモデル骨格＋
    // 「システム指示通りに候補テーブルのJSON配列を生成せよ」の指示。
    const ENG_WIZARD_TABLE_CANDIDATES_USER_PROMPT = function (historyCtx, systemModelHint) {
        return (
            "[Q&A History]\n" + historyCtx + "\n\n" +
            (systemModelHint ? "[Recommended System Model Skeleton]\n" + systemModelHint + "\n\n" : "") +
            "Generate the JSON array of candidate tables as specified in the system prompt."
        );
    };

    o.WIZARD_TABLE_CANDIDATES_SYS_PROMPT = ENG_WIZARD_TABLE_CANDIDATES_SYS_PROMPT;
    o.WIZARD_TABLE_CANDIDATES_USER_PROMPT = ENG_WIZARD_TABLE_CANDIDATES_USER_PROMPT;

    // [プロンプト]プロジェクト新規作成ウィザード: Q&A履歴＋確定済みDBテーブル(カラム込み)から
    // 必要なフォーム一覧に分解する
    // （2026-08-10: テーブルのカラム確定より後に実行する順序に変更。確定済みのカラム情報を
    //   docDraftに具体的に反映させることで、後段の画面デザインYAMLドラフト生成の精度を上げる）
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // Q&A履歴＋確定済みテーブル（カラム込み）から、必要な画面（フォーム）一覧をJSON配列で
    // 分解生成させるプロンプト。各要素: formName(英語PascalCase+Form接尾辞、ASCII限定、
    // 配列内で一意)/formTitle(日本語表示名)/description(1文の日本語説明)/
    // docDraft(その画面に必要な入力欄・ボタン等を自然文で書いた日本語段落。
    // 後段の画面デザインYAMLドラフト生成の入力として使われる)。
    // ※docDraftは、関連テーブルのカラムが分かっている場合、カラム名を日本語ラベルに
    // 変換した上で具体的に書き込むよう指示する（曖昧な「詳細情報を表示」ではなく
    // 「タイトル・優先度・期限・ステータスを表示」のように）。これは実際にAI
    // (OpenAI gpt-5.6-luna)での実測検証で、項目名が明示されない依頼文だと画面デザイン
    // YAMLドラフト生成でfieldsが空になりやすいことが確認されたための対策。
    // 履歴で画面数の目安（少なめ/標準/多め）に言及があれば従う、なければ2〜5画面程度。
    // 履歴にない機能を勝手に発明しない。ログイン機能が言及/暗示されていれば専用画面を作る。
    // ※2026-08-10追記: 「一覧→行クリックで詳細→編集・削除」という定型パターンに対し、
    // 「詳細」「編集」を別々の画面として機械的に分割しないよう指示（同じ項目を表示する
    // 詳細画面と編集画面はほぼ常に同一画面のはず→1つに統合させる）。「削除」も単純な
    // 1件削除なら専用画面を作らず、確認ダイアログ＋一覧へ戻る（イベント処理側の責務）で
    // 済ませるよう指示。同一エンティティの属性ごとに個別の設定画面を作る（優先度設定画面・
    // 期限設定画面…）ことも避け、詳細・編集画面1つにまとめるよう指示。実際にウィザードで
    // TaskDetailForm/TaskEditForm（内容が重複）やTaskDeleteForm（確認ダイアログで済む内容）
    // が個別画面として生成されてしまった実例に基づく対応。
    // ※2026-08-11追記: ウィザードで選択した画面サイズ（大中小）をformW/formH/
    // formSizeLabelとして渡し、「小さい画面サイズなら項目を詰め込みすぎず画面を
    // 分割する」ことを意識させる（ただし上記の「過剰分割を避ける」指示を上書きしない
    // ことを明記し、単なる詰め込み防止のみに限定）。
    const ENG_WIZARD_DECOMPOSE_FORMS_SYS_PROMPT = function ({ tablesCtx, formW, formH, formSizeLabel, systemModelHint }) {
        return (`
You are an expert VJA (Visual JavaScript for AI) application architect. Based on the [Q&A History] and [Confirmed Database Tables] provided in the user message (a Japanese interview describing a business application the user wants to build, plus the DB tables/columns already finalized for it), decompose the application into a list of screens (forms).
${systemModelHint ? `
[Recommended System Model Skeleton]
This application was judged to be closest to the following structural pattern. Use its "画面構成の骨格" (screen structure) as your primary guide for how to group fields into screens and how many screens to create — it is written specifically to prevent over-splitting screens that a human developer would normally keep together. Still base concrete field names/screen titles on the actual [Q&A History] and [Confirmed Database Tables], not on the example table/column names shown in the skeleton.

${systemModelHint}
` : ""}

[Target Screen Size]
The user has chosen a "${formSizeLabel || "小"}" (${formW || 640}x${formH || 420}px) screen size for every generated form. Keep this in mind when deciding how much a single screen should try to show:
- A smaller screen size holds noticeably fewer fields/widgets comfortably. When an entity has many attributes (many DB columns) or a screen's docDraft would otherwise list a long, dense set of fields, prefer splitting that entity's fields across multiple purpose-specific screens (e.g. separate "basic info" and "detailed info" tabs/screens) rather than cramming everything into one screen.
- A larger screen size can comfortably hold more fields on a single screen, so there is less need to split for that reason alone.
- This size-based splitting guidance is about avoiding an overcrowded single screen — it does NOT override the "Avoid Over-Splitting" rule below (do not split a screen into multiple screens for reasons unrelated to available space, such as one screen per verb).

[Output Rules]
- Output STRICT JSON only (a JSON array). No markdown code fences, no intro, no explanations.
- Array item shape:
{
  "formName": "<English PascalCase identifier ending in \"Form\", e.g. LoginForm, RegUserForm, CustomerListForm — must be unique across the array, ASCII letters/digits only>",
  "formTitle": "<short Japanese display title for this screen, e.g. ログイン>",
  "description": "<one-sentence Japanese description of this screen's purpose>",
  "docDraft": "<a Japanese free-text paragraph describing what widgets/inputs/buttons this screen should have, written in the same natural style a user would type when requesting a screen design — this becomes the input to a LATER screen-layout-generation step>"
}
- "docDraft" MUST be concrete, not vague. If this screen relates to a table in [Confirmed Database Tables], explicitly name the relevant columns (translated to natural Japanese labels, e.g. due_date → 期限) as the fields this screen shows/edits — do NOT write a vague summary like "タスクの詳細情報を表示する" alone; instead write "タスク名・優先度・期限・ステータスを表示する" naming the actual columns. This concreteness is required because a later AI step derives screen fields from this text and performs poorly on vague descriptions.
- Respect the requested screen-count scale if the history mentions one (少なめ/標準/多め). When not mentioned, default to a small, coherent set of screens that covers what was described (typically 2-5).
- Do not invent major features that were never mentioned in the history.
- If a login/authentication flow was mentioned or implied, include it as its own screen.

[Avoid Over-Splitting: Consolidate the Common List → Detail/Edit → Delete Pattern]
A common request shape is "show a list, click a row to see details, then edit or delete it." Do NOT mechanically create one screen per verb mentioned (詳細/編集/削除など). Instead:
- "詳細表示"(view detail) and "編集"(edit) of the SAME entity are almost always the SAME screen — a single form that displays the record's fields in editable inputs with an "編集"/"保存" button. Do NOT create two separate near-identical screens (e.g. "TaskDetailForm" and "TaskEditForm" showing the same fields) — merge them into one (e.g. "TaskDetailForm" alone, its docDraft mentioning both viewing and editing).
- "削除"(delete) of a single record normally does NOT need its own screen. It is a confirmation dialog (a Yes/No confirm shown from the list or detail screen) that, on confirmation, deletes the record and returns to the list — this belongs to a LATER event-processing step, not a separate screen in this list. Only give delete its own screen if the request describes something beyond a simple single-record confirm (e.g. a dedicated bulk-delete screen with checkboxes, or an audit/trash-bin screen).
- Similarly, do not split what is really ONE entity's several attributes into multiple single-purpose screens (e.g. a separate "priority-setting screen", "deadline-setting screen", and "status-update screen" for the same "task" entity) — these belong together in the ONE detail/edit screen for that entity, edited as normal fields with a single save action.

[Confirmed Database Tables]
${tablesCtx || "(No DB tables)"}
`.trim() + "\n");
    };

    // [日本語対訳メモ]（AIには送られない）Q&A履歴＋「システム指示通りにフォーム一覧のJSON配列を生成せよ」の指示。
    const ENG_WIZARD_DECOMPOSE_FORMS_USER_PROMPT = function (historyCtx) {
        return (
            "[Q&A History]\n" + historyCtx + "\n\n" +
            "Generate the JSON array of forms as specified in the system prompt."
        );
    };

    o.WIZARD_DECOMPOSE_FORMS_SYS_PROMPT = ENG_WIZARD_DECOMPOSE_FORMS_SYS_PROMPT;
    o.WIZARD_DECOMPOSE_FORMS_USER_PROMPT = ENG_WIZARD_DECOMPOSE_FORMS_USER_PROMPT;

    // [プロンプト]テーブル管理: 自然言語の依頼文からSQLiteテーブルのカラム構成（雛形）を生成
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // テーブル編集モーダルの「✨ AI生成」用。日本語の依頼文＋テーブル名/説明から
    // カラム定義JSON配列（name/labelJa/type(TEXT|INTEGER|REAL|BLOB|NULL)/notNull/pk/index/default）
    // を生成させる。labelJaはnameの日本語名（表示用、DDLには影響しない）。
    // PK列（通常id, INTEGER, pk=true, notNull=true）を先頭に入れる、
    // テーブル名・説明・依頼内容から妥当なカラムを推測、関係ないカラムを発明しない。
    const ENG_TABLE_SCHEMA_GEN_SYS_PROMPT = function ({ tableName, description }) {
        return (`
You are an expert AI assistant for VJA (Visual JavaScript for AI), helping a user design a SQLite table schema.
Your task is to convert the user's natural language request (written in Japanese) into a JSON array of column definitions.

[Output Format — STRICT]
Output ONLY a raw JSON array (starting with [ and ending with ]), where each element is:
{
  "name": "<column name, snake_case, English or romaji, no spaces>",
  "labelJa": "<a natural Japanese label for this column, for display purposes, e.g. name=\"due_date\" → labelJa=\"期限\">",
  "type": "<one of: TEXT, INTEGER, REAL, BLOB, NULL>",
  "notNull": <true|false>,
  "pk": <true|false, at most ONE column should be true>,
  "index": <true|false>,
  "default": "<default value as a string, or empty string \"\" if none>"
}

[Rules]
- Always include a primary key column first (typically "id" INTEGER pk=true notNull=true, labelJa="ID"), unless the user's request clearly implies a different key.
- "labelJa" is REQUIRED for every column — never leave it empty. It is shown next to the English column name in the UI so non-technical users understand what each column is.
- Infer reasonable columns (name/type) from the table name, description, and request content.
- Do NOT invent unrelated columns beyond what is implied by the context.
- Do NOT wrap the response in markdown code blocks (\`\`\`json). Do not include any explanation, introduction, or comments.

[Table Name]
${tableName || "(not specified)"}

[Table Description]
${description || "(not specified)"}
`.trim() + "\n");
    };

    // [日本語対訳メモ]（AIには送られない）依頼文（未入力なら「テーブル名/説明のみから推測せよ」）＋「生JSON配列のみ出力」の念押し。
    const ENG_TABLE_SCHEMA_GEN_USER_PROMPT = function (userReq) {
        return (
            "Based on the following natural language request, generate the JSON array of column definitions for this table:\n\n" +
            "[User Request]\n" + (userReq ? userReq.trim() : "(not specified — infer from the table name/description only)") + "\n\n" +
            "[CRITICAL] Output raw JSON array only. Do NOT wrap in markdown code blocks (```json). No conversational text."
        );
    };

    o.TABLE_SCHEMA_GEN_SYS_PROMPT = ENG_TABLE_SCHEMA_GEN_SYS_PROMPT;
    o.TABLE_SCHEMA_GEN_USER_PROMPT = ENG_TABLE_SCHEMA_GEN_USER_PROMPT;

    // [プロンプト]バリデーション管理: 自然言語の依頼文からバリデーションルール一覧（雛形）を生成
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // バリデーション編集モーダルの「✨ AI生成」用。日本語の依頼文＋定義名/説明＋
    // フォーム内の入力系ウィジェット名一覧から、ルール定義JSON配列
    // （name(対象ウィジェット名、一覧にある名前のみ・発明禁止)/type(required等の種別)/
    // not/arg1-3(typeにより意味が変わる引数)/message(日本語エラー文)）を生成させる。
    // 一覧に無いウィジェット名は使わない・該当ウィジェットが無ければ空配列。
    // 依頼・定義と無関係なルールを発明しない。
    const ENG_VALIDATION_SCHEMA_GEN_SYS_PROMPT = function ({ name, description, widgetsCtx }) {
        return (`
You are an expert AI assistant for VJA (Visual JavaScript for AI), helping a user design a set of input validation rules for a form.
Your task is to convert the user's natural language request (written in Japanese) into a JSON array of validation rule definitions.

[Output Format — STRICT]
Output ONLY a raw JSON array (starting with [ and ending with ]), where each element is:
{
  "name": "<the EXACT widget name from the [Available Input Widgets] list below — never invent a name>",
  "type": "<one of: required, maxLength, minLength, range, numeric, integer, email, tel, zipcode, url, date, alphanumeric, alpha, hiragana, katakana, pattern>",
  "not": <true|false, negates the rule (rarely needed, usually false)>,
  "arg1": "<argument 1 as a string, meaning depends on type (e.g. maxLength=max length, range=min value, pattern=regex), empty string if unused>",
  "arg2": "<argument 2 as a string, e.g. range=max value, empty string if unused>",
  "arg3": "<argument 3 as a string, empty string if unused>",
  "message": "<Japanese error message shown to the user when the rule fails>"
}

[Rules]
- Only use widget names that literally appear in [Available Input Widgets]. If none are available or relevant, output an empty array [].
- Infer reasonable rules from the definition name, description, and request content.
- Do NOT invent rules unrelated to the request/definition context.
- Do NOT wrap the response in markdown code blocks (\`\`\`json). Do not include any explanation, introduction, or comments.

[Validation Definition Name]
${name || "(not specified)"}

[Validation Definition Description]
${description || "(not specified)"}

[Available Input Widgets]
${widgetsCtx || "(none)"}
`.trim() + "\n");
    };

    // [日本語対訳メモ]（AIには送られない）依頼文（未入力なら「定義名/説明のみから推測せよ」）＋「生JSON配列のみ出力」の念押し。
    const ENG_VALIDATION_SCHEMA_GEN_USER_PROMPT = function (userReq) {
        return (
            "Based on the following natural language request, generate the JSON array of validation rule definitions:\n\n" +
            "[User Request]\n" + (userReq ? userReq.trim() : "(not specified — infer from the definition name/description only)") + "\n\n" +
            "[CRITICAL] Output raw JSON array only. Do NOT wrap in markdown code blocks (```json). No conversational text."
        );
    };

    o.VALIDATION_SCHEMA_GEN_SYS_PROMPT = ENG_VALIDATION_SCHEMA_GEN_SYS_PROMPT;
    o.VALIDATION_SCHEMA_GEN_USER_PROMPT = ENG_VALIDATION_SCHEMA_GEN_USER_PROMPT;
})();
