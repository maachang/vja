<!-- summary: データベースのテーブル。テーブル管理、カラム設定（型・NOT NULL・KEY・インデックス・DEFAULT）、表示系と管理系（作成日時・更新日時など）、マスターCSV（初期データ）、vja.db.query / execute / transaction によるSQL操作 -->
# テーブル（データベース）

VJAのアプリには、SQLiteのデータベースを内蔵できます。

## テーブルを管理する

ツールバーの「テーブル」、またはメニュー［プロジェクト］→「テーブル管理…」から、テーブルの追加・編集をします。テーブル名とカラム（列）を設定します。「✨ AI生成」でカラム構成をAIに作らせることもできます（AI接続設定が必要です → 「AI設定」）。

## カラムの設定

| 項目 | 説明 |
|------|------|
| カラム名 | 列の名前 |
| 型 | `TEXT` / `INTEGER` / `REAL` / `BLOB` |
| NOT NULL | 必須項目にする |
| KEY | 主キーにする |
| インデックス | インデックスを作る |
| DEFAULT | 初期値 |
| 表示系 | 画面に出す列か（ON=表示系、OFF=管理系） |

## 表示系と管理系

| 区分 | 内容 | 例 |
|------|------|----|
| 表示系（ONが初期状態） | 画面に表示したり、利用者が入力したりする内容 | 氏名、金額、期限 |
| 管理系（OFF） | アプリが裏側で使う内容。画面には出さない | 作成日時、更新日時、削除フラグ |

- AIによる**画面の自動生成**（ウィザード・「🤖 AIでフォーム設計…」）には、**表示系の列だけ**が渡されます。管理系の列は入力欄や一覧の列になりません。
- **イベントのコード生成**には、INSERT/UPDATEで管理系の列も扱うため、**全ての列**が渡されます。
- テーブルの構造（`CREATE TABLE`）は、表示系/管理系に関係なく全列が作られます。
- 作成日時・更新日時・削除フラグなどは、OFF（管理系）にしてください。
- 既に作ったテーブルや「✨ AI生成」で作った列は、すべて表示系（ON）として扱われます。管理系にしたい列だけ手動でOFFにします。

## マスターデータ（CSV）

テーブル編集画面の「マスターCSV」で、初期データのCSVを登録できます（最大20MB）。

- プロジェクトファイル内に圧縮して保存されます。
- **アプリ起動時にテーブルが空なら**、CSVの内容が自動でINSERTされます。
- 1行目はヘッダー行として扱われます。NOT NULLでDEFAULTの無い列は、CSVに必須です。
- 登録後は、ダウンロード・再アップロード・削除ができます。

## コードからDBを操作する

```javascript
// 取得（配列が返ります）
const rows = await vja.db.query('SELECT * FROM users WHERE id = ?', [1]);

// 追加・更新・削除
await vja.db.execute('INSERT INTO users (name, age) VALUES (?, ?)', ['山田', 30]);
await vja.db.execute('UPDATE users SET name = ? WHERE id = ?', ['鈴木', 1]);
await vja.db.execute('DELETE FROM users WHERE id = ?', [1]);

// 複数のSQLをまとめて実行（失敗したら全て取り消され、falseが返ります）
await vja.db.transaction([
    { sql: 'INSERT INTO orders (item) VALUES (?)', params: ['商品A'] },
    { sql: 'UPDATE stock SET qty = qty - 1 WHERE item = ?', params: ['商品A'] }
]);
```

- 値は `?` に当てはめます（SQLへ値を直接書き込まない）。
- `query` は、失敗すると空の配列を返します。`execute` は、失敗すると `null` を返します。
