<!-- summary: アプリの起動時(OnStart)・終了時(OnExit)に自動実行される処理の定義、バックエンド側で使えるAPI（vja.db・vja.session・vja.log） -->
# アプリイベント（起動・終了処理）

アプリの起動時と終了時に、自動で実行される処理を定義できます。

## 開き方

メニュー［ファイル］→「アプリイベント…」を選びます。上部のタブで次の2つを切り替えます。YAML/JavaScriptの編集とAI生成は、通常のイベントエディタと同じように使えます（→「イベントエディタ」「JSコード生成」）。

| イベント | 実行されるタイミング |
|----------|---------------------|
| 🚀 起動時（OnStart） | アプリ起動時に1度だけ（マスターCSVの投入後） |
| 🔚 終了時（OnExit） | アプリ終了時 |

## 画面のイベントとの違い

アプリイベントのコードは、画面ではなく **Bun側（バックエンド）でTypeScriptとして実行**されます。画面のウィジェット操作はできません。

## 使えるAPI

| API | 説明 |
|-----|------|
| `vja.db.query(sql, params?)` | SELECT（配列が返る） |
| `vja.db.execute(sql, params?)` | INSERT/UPDATE/DELETE |
| `vja.db.clearTable(テーブル名)` | テーブルの全削除 |
| `await vja.db.importCsv(テーブル名, パス)` | CSVを一括取り込み |
| `await vja.db.importJson(テーブル名, パス)` | JSON配列を一括取り込み |
| `vja.session.get/set/delete/clear` | セッション値の取得・保存・削除・全削除 |
| `vja.log.info/warn/error(メッセージ)` | ログ出力 |

**`await` の付け方が画面のイベントと違います。** `query` / `execute` / `clearTable` などは `await` を付けず、`importCsv` / `importJson` だけ `await` が必要です。

## 例

```typescript
// 起動時: 初期設定を1度だけ入れる
const rows = vja.db.query('SELECT * FROM settings WHERE key = ?', ['initialized']);
if (rows.length === 0) {
    vja.db.execute('INSERT INTO settings (key, value) VALUES (?, ?)', ['initialized', '1']);
    vja.log.info('初期設定を行いました');
}
```

```typescript
// 終了時: 一時データを消す
vja.db.clearTable('temp_data');
```
