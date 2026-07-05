# 📝 VJA YAML プログラム命令ガイド(主にITエンジニア向け)
## ～ エンジニア・社内SE 向けリファレンス ～

---

## 概要

VJA のイベント処理は **YAML** で仕様を記述し、ローカル LLM が JavaScript を生成します。
YAML はAIへの命令書であり、AIが理解しやすい構造化された自然言語として機能します。

生成されたコードは `vja.*` ランタイム API を通じて SQLite・UI・ファイル・外部HTTP等を操作します。
コードは直接編集することも可能です。

---

## YAML の基本構造

```yaml
# イベント: Click (btnSave)     ← 自動入力。編集不要
説明: ユーザー情報を登録する    ← AIへのコンテキスト。処理の目的を明示する
利用テーブル:                   ← 使用するDBテーブルを列挙（カラム情報がAIに渡る）
  - users
アクション:                     ← 処理フローを記述
  - 処理内容を書く

正常終了: トーストで「登録しました」と表示する
エラー終了: ログとトーストにエラーを出力する
```

### キー仕様

| キー | 必須 | 説明 |
|------|------|------|
| `# イベント:` | 自動 | イベント名・ウィジェット名（自動入力） |
| `説明:` | 推奨 | 処理の目的。AIのコンテキスト精度が上がる |
| `利用テーブル:` | 任意 | DB操作するテーブル名のリスト（list形式）。指定するとカラム定義がAIに渡る。右パネル「🗄 テーブル一覧」のON/OFFに連動して自動的に追記・削除される |
| `アクション:` | 必須 | 処理内容（箇条書き・ネスト可） |
| `正常終了:` | 推奨 | 正常系の後処理 |
| `エラー終了:` | 推奨 | `try/catch` の catch 節の処理。記述するとAIが自動で例外処理を生成する |

> **`利用テーブル:` の効果**：指定したテーブルのカラム定義（名前・型・DEFAULT値等）がプロンプトに含まれ、AIが正確なSQL・カラム名を生成できます。右パネル「🗄 テーブル一覧」で対象テーブルをONにすると自動的にこのブロックが追記されるため、通常は手動で書く必要はありません。DB操作を含む処理では必ずONにしてください。
>
> なお、バリデーション（検証）はYAMLには記述せず、右パネルの「✅ 検証」プルダウンから選択します（詳細は本ガイド末尾を参照）。

---

## アクションの記法

### 基本（箇条書き）

```yaml
アクション:
  - txtName と txtEmail の入力値を取得する
  - 入力値を users テーブルに INSERT する
  - listBox1 を空にして最新データを再表示する
```

### 条件分岐

```yaml
アクション:
  - selMode の選択値を取得する
  - 選択値が「新規」の場合: users テーブルに INSERT する
  - 選択値が「更新」の場合: users テーブルの該当レコードを UPDATE する
  - それ以外の場合: 「不正な操作です」とダイアログを表示して処理を終了する
```

### ネスト（詳細条件）

```yaml
アクション:
  - 「削除しますか？」と YES/NO の確認ダイアログを表示する:
      - YES の場合:
          - ローディングを表示する
          - 選択行の id で users テーブルから DELETE する
          - 一覧を再取得して tableView1 に表示する
      - NO の場合: 何もしない
```

### 繰り返し

```yaml
アクション:
  - tableView1 の全行データを取得する
  - 各行に対して以下を繰り返す:
      - status が「未処理」の場合: orders テーブルの該当レコードを「処理済」に UPDATE する
```

---

## サンプル集

### 1. 基本的な CRUD

#### 一覧取得・表示

```yaml
説明: ユーザー一覧を取得して表示する
利用テーブル:
  - users

アクション:
  - ローディングを表示する
  - users テーブルから全件取得して tableView1 に表示する

正常終了: なし
エラー終了: ログとトーストにエラーを出力する
```

#### 条件検索

```yaml
説明: 検索条件でユーザーを絞り込む
利用テーブル:
  - users

アクション:
  - ローディングを表示する
  - txtSearch の入力値を取得する
  - 入力値が空でない場合: users テーブルから name が部分一致するレコードを検索して tableView1 に表示する
  - 入力値が空の場合: users テーブルから全件取得して tableView1 に表示する

正常終了: なし
エラー終了: ログとトーストにエラーを出力する
```

#### INSERT

```yaml
説明: フォームの入力内容をDBに登録する
利用テーブル:
  - users

アクション:
  - txtName・txtEmail・txtAge の入力値を取得する
  - users テーブルに name・email・age を INSERT する

正常終了: 「登録しました」とトースト表示してフォームを初期化する
エラー終了: ログとトーストにエラーを出力する
```

> 入力チェック（例: 「ユーザー登録チェック」）を行いたい場合は、YAMLには書かず、右パネルの「✅ 検証」プルダウンから該当の定義を選択します（詳細は本ガイド末尾を参照）。

#### UPDATE

```yaml
説明: 選択行のデータを更新する
利用テーブル:
  - users

アクション:
  - tableView1 で選択中の行の id を取得する。未選択なら「行を選択してください」とダイアログを表示して終了する
  - txtName・txtEmail の入力値で users テーブルの id が一致するレコードを UPDATE する

正常終了: 「更新しました」とトースト表示する
エラー終了: ログとトーストにエラーを出力する
```

#### DELETE

```yaml
説明: 選択行を削除する
利用テーブル:
  - users

アクション:
  - tableView1 で選択中の行の id を取得する。未選択なら「行を選択してください」とダイアログを表示して終了する
  - 「削除しますか？」と YES/NO の確認ダイアログを表示する:
      - YES の場合: users テーブルから id が一致するレコードを DELETE する
      - NO の場合: 処理を終了する

正常終了: 「削除しました」とトースト表示して一覧を再取得する
エラー終了: ログとトーストにエラーを出力する
```

---

### 2. 画面遷移とパラメータ受け渡し

#### 遷移元（一覧画面）

```yaml
説明: 選択行の詳細画面に遷移する
アクション:
  - tableView1 で選択中の行の id を取得する。未選択なら「行を選択してください」とダイアログを表示して終了する
  - パラメータ「userId」に id をセットして画面「FormDetail」に遷移する

正常終了: なし
```

#### 遷移先（詳細画面）の初期化処理

```yaml
# イベント: OnStart (FormDetail)
説明: 前画面から渡された userId でユーザー情報を取得して表示する
利用テーブル:
  - users

アクション:
  - パラメータ「userId」を取得する
  - userId で users テーブルから1件取得する
  - 取得したレコードの各フィールドをフォームの各ウィジェットにセットする

正常終了: なし
エラー終了: 「データ取得エラー」とダイアログ表示して前画面に戻る
```

---

### 3. トランザクション処理

```yaml
説明: 注文登録と在庫更新をトランザクションで実行する
利用テーブル:
  - orders
  - stock

アクション:
  - txtItemId・txtQty の入力値を取得する
  - stock テーブルで該当 item_id の在庫数を確認し、不足の場合は「在庫が不足しています」とダイアログ表示して終了する
  - 以下をトランザクションで実行する:
      - orders テーブルに item_id・qty・ordered_at（現在日時）を INSERT する
      - stock テーブルの該当 item_id の qty を入力値分減算する

正常終了: 「注文を受け付けました」とトースト表示する
エラー終了: ログとトーストにエラーを出力する
```

---

### 4. 外部API連携

```yaml
説明: 外部APIからデータを取得して表示する
アクション:
  - ローディング「データを取得中...」を表示する
  - vja.const.get('API_BASE_URL') で基底URLを取得する
  - GET リクエストを {API_BASE_URL}/users に送信する
  - レスポンスの users 配列を tableView1 に表示する

正常終了: なし
エラー終了: ログとトーストにエラーを出力する
```

```yaml
説明: フォームの入力値を外部APIにPOSTする
アクション:
  - txtName・txtEmail の入力値を取得する
  - POST リクエストを https://api.example.com/users に { name, email } をボディとして送信する
  - レスポンスの id を txtId に表示する

正常終了: 「送信しました」とトースト表示する
エラー終了: ログとトーストにエラーを出力する
```

---

### 5. ファイル操作

#### CSVインポート

```yaml
説明: CSVファイルを読み込んでDBに一括登録する
利用テーブル:
  - products

アクション:
  - CSVファイルを選択して読み込む
  - 読み込んだ各行を products テーブルに INSERT する（トランザクション使用）
  - 登録件数をトーストで表示する

正常終了: なし
エラー終了: ログとトーストにエラーを出力する
```

#### CSVエクスポート

```yaml
説明: テーブルデータをCSVでエクスポートする
利用テーブル:
  - users

アクション:
  - users テーブルから全件取得する
  - 取得データを「users.csv」としてCSV保存する

正常終了: 「エクスポートしました」とトースト表示する
エラー終了: ログとトーストにエラーを出力する
```

---

### 6. セッション管理（ログイン・ログアウト）

#### ログイン処理

```yaml
説明: ユーザー認証を行いセッションに保存する
利用テーブル:
  - users

アクション:
  - txtLoginId・txtPassword の入力値を取得する
  - users テーブルから login_id と password が一致するレコードを1件取得する
  - 該当レコードが存在しない場合: 「IDまたはパスワードが違います」とダイアログ表示して終了する
  - セッション「loginUser」に取得したユーザー情報を保存する
  - 画面「FormMain」に遷移する

正常終了: なし
エラー終了: ログとトーストにエラーを出力する
```

> 入力チェック（例: 「ログイン入力チェック」）は、右パネルの「✅ 検証」プルダウンから選択します。

#### ログアウト処理

```yaml
説明: セッションをクリアしてログイン画面に戻る
アクション:
  - 「ログアウトしますか？」と YES/NO の確認ダイアログを表示する:
      - YES の場合:
          - セッション「loginUser」を削除する
          - 画面「FormLogin」に遷移する
      - NO の場合: 何もしない

正常終了: なし
```

---

### 7. 定数の活用

```yaml
説明: 定数からAPI URLを取得してリクエストする
アクション:
  - 定数「API_BASE_URL」を取得する（未定義なら「http://localhost:3000」をデフォルトとする）
  - GET リクエストを {API_BASE_URL}/health に送信する
  - レスポンスの status を lblStatus に表示する

正常終了: なし
エラー終了: lblStatus に「接続失敗」と表示する
```

---

### 8. バリデーション定義の活用

バリデーションはGUIの「✅ 検証」メニューで定義します。
イベントエディタの右パネル「✅ 検証」プルダウンで定義名を選択するだけで、AIが生成するコードの先頭に自動挿入されます（YAML本文には何も記述しません）。

```yaml
説明: 入力チェック後にDBに登録する
利用テーブル:
  - users

アクション:
  - フォームの入力値を users テーブルに INSERT する

正常終了: 「登録しました」とトースト表示する
エラー終了: ログとトーストにエラーを出力する
```

（右パネルで「ユーザー登録チェック」を選択した状態）

生成されるJSコードのイメージ：

```javascript
// 検証チェック処理(自動追加).
if (!await vja.validate.run("ユーザー登録チェック")) return;

// AIが生成した処理
vja.ui.loading(true, "処理中...");
try {
    // ... INSERT処理
} catch(e) {
    // ...
} finally {
    vja.ui.loading(false);
}
```

---

## vja.* API リファレンス（概要）

### DB操作

| API | 説明 |
|-----|------|
| `await vja.db.query(sql, params?)` | SELECT。結果行の配列を返す |
| `await vja.db.execute(sql, params?)` | INSERT/UPDATE/DELETE。`{ changes, lastInsertRowid }` を返す |
| `await vja.db.transaction(statements[])` | トランザクション実行。複数SQL高速化にも有効 |

### ウィジェット操作

| API | 説明 |
|-----|------|
| `vja.widget.get(name)` | 値を取得 |
| `vja.widget.set(name, value)` | 値をセット（型に応じて自動処理） |
| `vja.widget.getAllInputs()` | フォーム内全入力値を `{name: value}` で取得 |
| `vja.widget.show/hide(name)` | 表示/非表示 |
| `vja.widget.enable/disable(name)` | 有効/無効 |

### 画面遷移

| API | 説明 |
|-----|------|
| `vja.form.navigate(name)` | 指定フォームに遷移（入力値を保存） |
| `vja.form.back()` | 前画面に戻る（入力値を復元） |
| `vja.form.setParam(key, value)` | 遷移先に渡すパラメータをセット |
| `vja.form.getParam(key, default?)` | 前画面から渡されたパラメータを取得 |

### セッション

| API | 説明 |
|-----|------|
| `await vja.session.set(key, value)` | セッション保存（永続化） |
| `await vja.session.get(key, default?)` | セッション取得 |
| `await vja.session.delete(key)` | セッション削除 |
| `await vja.session.clear()` | セッション全クリア |

### 外部HTTP

| API | 説明 |
|-----|------|
| `await vja.http.get(url, headers?)` | GET リクエスト |
| `await vja.http.post(url, body, headers?)` | POST リクエスト |
| `await vja.http.put(url, body, headers?)` | PUT リクエスト |
| `await vja.http.delete(url, headers?)` | DELETE リクエスト |
| `await vja.fetch(url, options?)` | 低レベルfetch（独自ヘッダー等） |

### ファイルI/O

| API | 説明 |
|-----|------|
| `await vja.io.openCsv()` | CSVファイルを開いて行配列で返す |
| `await vja.io.openJson()` | JSONファイルを開いてオブジェクトで返す |
| `vja.io.saveCsv(rows, filename)` | CSVとしてダウンロード |
| `vja.io.saveJson(data, filename)` | JSONとしてダウンロード |
| `await vja.file.read/write(path, ...)` | テキストファイルの読み書き |
| `await vja.file.readBytes/writeBytes(path, ...)` | バイナリファイルの読み書き |
| `await vja.file.exists/delete/copy(...)` | ファイル存在確認・削除・コピー |
| `await vja.dir.create/delete/list/exists(...)` | ディレクトリ操作 |

### UI・通知

| API | 説明 |
|-----|------|
| `vja.ui.loading(show, message?)` | ローディング表示/非表示（必ず `try/finally` で使う） |
| `vja.notify.toast(message, duration?)` | トースト通知（デフォルト2500ms） |
| `vja.app.showDialog(message)` | ダイアログ表示 |

### ユーティリティ

| API | 説明 |
|-----|------|
| `vja.util.uuid()` | UUID v4 生成 |
| `vja.util.today()` | 今日の日付（YYYY-MM-DD） |
| `vja.util.formatDate(date, format?)` | 日付フォーマット |
| `vja.util.formatNumber(n, decimals?)` | 数値を桁区切り文字列に変換 |
| `vja.const.get(key, default?)` | 定数取得（フォーム定数優先） |
| `vja.validate.run(name)` | GUI定義のバリデーション実行 |

---

## コードを直接書く場合のポイント

YAMLからAI生成したコードを直接編集することも可能です。

```javascript
// ウィジェット値の取得
var name = vja.widget.get("txtName");

// DB操作（必ず await）
var rows = await vja.db.query("SELECT * FROM users WHERE id = ?", [id]);
await vja.db.execute("INSERT INTO users (name) VALUES (?)", [name]);

// ローディングは try/finally で必ず閉じる
vja.ui.loading(true, "処理中...");
try {
    var result = await vja.db.query("SELECT * FROM users");
    vja.widget.set("tableView1", result);
} catch (e) {
    console.error(e);
    vja.notify.toast("エラーが発生しました");
} finally {
    vja.ui.loading(false);
}
```

> **注意**：VJAのコード生成では `var` を使用します（`const`/`let` は再代入で問題が起きやすいため）。ただモデルによっては、これが対応されない場合もあります: qwen2.5系や推論モードOFFの場合など)。

---

## YAML記述のベストプラクティス

- **テーブル名・ウィジェット名・カラム名は正確に記述する**（AIが正確なコードを生成できる）
- **右パネル「🗄 テーブル一覧」で使うテーブルのみONにする**（プロンプトサイズの削減・AI精度向上）
- **右パネル「🔌 利用API（任意）」も、実際に使うカテゴリのみONにする**（不要なAPI説明を渡さないことで、指示追従性の弱いモデルでの誤生成を減らせる）
- **`エラー終了:` は必ず書く**（try/catch が自動生成される）
- **ローディングが必要な処理には明示する**（AIが `try/finally` パターンで生成する）
- **複雑な処理は箇条書きで細かく分ける**（1ステップ1処理が原則）
