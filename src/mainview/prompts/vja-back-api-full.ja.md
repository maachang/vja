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
