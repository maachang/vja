# 🧪 サンプルウォークスルー: ログイン・ユーザ登録機能をほぼノーコードで作る

このドキュメントは、VJA の「AI雛形生成」機能（画面デザインYAMLドラフト・イベントYAMLドラフト＋JS生成・テーブルAI生成・検証AI生成）を一通り使って、**ログイン画面とユーザ登録画面**を実際に組み上げた実例です。

- 使用した AI: **ローカル LLM（DeepSeek-Coder-V2-Lite）のみ**。クラウド API は使用していません
- コードを直接書いた箇所は無く、すべて自然言語の依頼文からAIが生成したものです（画面上のウィジェット位置の微調整のみ手作業）
- 生成されたJSは、VJAの自動検証（構文チェック・APIホワイトリスト・禁止パターン検出・モック実行スモークテスト）を経て、問題があれば自動で1回だけAIに再修正を依頼する仕組みを通っています

> 各AI雛形生成機能そのものの使い方は、[ユーザーガイド](user-guide.md)・[画面デザインYAMLガイド](yaml-guide-form-design.md)を参照してください。本ドキュメントは「実際に組み合わせて使うとどうなるか」の実例に特化しています。

---

## 全体の流れ

1. **画面デザインYAMLドラフト生成** → LoginForm・RegUserFormのレイアウトを作成
2. **テーブルAI生成** → `users` テーブルのカラム構成を作成
3. **イベントYAMLドラフト生成 → JS生成** → 各ボタンのクリック処理を作成
4. **検証（バリデーション）AI生成** → 入力チェックルールを作成

この順番（画面 → テーブル → イベント → 検証）で進めると、後工程のAIが前工程の情報（ウィジェット名・テーブルのカラム名）を自動的にコンテキストとして参照してくれるため、手戻りが少なくなります。

---

## 1. 画面デザインYAMLドラフト生成

### LoginForm

「🤖 AIでフォーム設計」モーダルの `✨ YAMLドラフト` タブに、次の日本語をそのまま入力しました。

```
ログイン入力画面をつくってほしい。
内容としては「ログイン名＝メールアドレス」で「パスワードもテキスト」で
```

`✨ YAMLドラフト生成` ボタンを押すと、以下の画面デザインYAMLが `📋 YAML` タブに生成されました。

```yaml
説明: ログイン入力画面

フォームレイアウト:
  カラム数: 1
  ラベル位置: 左
  ボタン位置: 右下

入力項目:
  - lblUsername: label
  - txtUsername: inputtype
  - lblPassword: label
  - txtPassword: inputtype

アクション項目:
  - ログインボタン
  - キャンセルボタン
```

`🤖 画面反映` を押すと、ラベル・入力欄・ボタンが実際にキャンバス上へ自動配置されます。この時点でウィジェット名は `lblUsername` / `txtUsername` / `lblPassword` / `txtPassword` / `btnLogin` / `btnCancel` として作成されました（「ログインボタン」という依頼文言から `btnLogin` という英語のHungarian記法名を推測して命名）。

その後、「ユーザ登録画面への導線も欲しい」と思いましたが、ここで**ウィジェットの複製（コピペ）は使わず**、`✨ YAMLドラフト` タブの依頼文の末尾に一文を追記するだけで対応しました。

```
ログイン入力画面をつくってほしい。
内容としては「ログイン名＝メールアドレス」で「パスワードもテキスト」で
あと、ユーザ登録を行うためのボタンも作成して
```

これで再度 `✨ YAMLドラフト生成` → `🤖 画面反映` を実行すると、次のYAMLが生成されました。

```yaml
説明: ログイン入力画面

フォームレイアウト:
  カラム数: 1
  ラベル位置: 左
  ボタン位置: 右下

入力項目:
  - lblUsername: label
  - txtUsername: inputtype
  - lblPassword: label
  - txtPassword: inputtype

アクション項目:
  - btnLogin: button
  - btnCancel: button
  - btnRegUser: button
```

ポイントは、アクション項目が「ログインボタン」「キャンセルボタン」のような日本語の言い回しではなく、**既に存在するウィジェット名（`btnLogin`/`btnCancel`）をそのまま使い、新規追加分（`btnRegUser`）だけを増やす形**で出力されていることです。これは、画面デザインYAMLドラフト生成時に「フォームに既に配置済みのウィジェット一覧」がAIへのコンテキストとして渡されており、既存ウィジェットを重複作成せず認識できているためです。`🤖 画面反映` を押すと、既存の `lblUsername` 等はそのままに、新しく `btnRegUser`（表示テキスト「ユーザ登録」）だけが追加配置されました。

> 💡 このように「既存の依頼文に一言足して再生成する」だけで、ウィジェットの複製（コピペ）やAPIリファレンスを見ながらの手作業を挟まずに画面を拡張できます。ボタンをコピペしてリネームする方法でも同じ見た目のボタンは作れますが、**複製したボタンのイベントJSは複製元のものがそのまま残る**ため、別の処理をさせたい場合は結局イベントYAMLドラフトを書き直してJSを再生成する手間が必要になります。素直に画面デザインYAMLドラフトの依頼文を書き足して再生成する方法の方が、複製の手間や複製時の設定漏れリスクが無く、より「ノーコード」の趣旨に沿っています。

### RegUserForm

新規フォームを追加し、同様に `✨ YAMLドラフト` タブへ以下を入力しました。

```
新しいユーザ登録を行います。
- ユーザ名(メールアドレス)
- パスワード(パスワードは SHA256でハッシュ化します)
  - パスワードは確認のため２回入力 
- 登録ボタン
- キャンセルボタン
```

生成されたYAML:

```yaml
説明: 新しいユーザ登録を行います。

フォームレイアウト:
  カラム数: 1
  ラベル位置: 左
  ボタン位置: 右下

入力項目:
  - ユーザ名: inputtype(text)
  - パスワード: inputtype(password)
  - パスワード確認: inputtype(password)

アクション項目:
  - 登録ボタン
  - キャンセルボタン
```

「パスワードはSHA256でハッシュ化します」という一文はレイアウトそのものには直接影響しませんが、後続のイベントJS生成時にAIが参照する重要な手がかりになります（後述）。

**手作業で行ったのはウィジェットの位置・幅の微調整のみ**で、ウィジェットの種類・名前・配置自体はAI生成のままです。

---

## 2. テーブルAI生成

テーブル管理の「テーブル名」欄に `users`、「説明」欄に「ユーザーのログイン情報を管理するテーブル」と入力し、依頼文欄には特に何も書かずに「✨ AI生成」を押したところ、次のカラム構成が生成されました。

| カラム名 | 型 | NOT NULL | PK |
|---|---|---|---|
| id | INTEGER | ✅ | ✅ |
| email | TEXT | ✅ | |
| password_hash | TEXT | ✅ | |

`email` / `password_hash` という名前は、テーブル名・説明だけから一般的なログインテーブルの構成として推測されたものです。パスワードを生の`password`ではなく`password_hash`という名前にしている点も、「パスワードは平文で持たない」という一般的な設計をAIが踏まえた結果と言えます。

---

## 3. イベントYAMLドラフト生成 → JS生成

各ボタンのClickイベントで、`✨ YAMLドラフト` タブに依頼文を書き、`✨ YAMLドラフト生成` → `🤖 JSコード生成` の2段階で処理を作成しました。イベントYAML生成時には、フォームに配置済みのウィジェット一覧・DBテーブル情報が自動的にAIへのコンテキストとして渡されるため、`txtUsername` や `users` テーブルの実際のカラム名をこちらで教える必要はありません。

### btnLogin（LoginForm）

依頼文:
```
ユーザーがログインを試み、ユーザー名とパスワードが正しい場合にログイン成功とし、
不一致の場合にはログイン失敗を表示する。ログイン成功時にはセッションにログインユーザ名を設定する。
```

生成されたJS（抜粋）:
```javascript
var username = vja.widget.get('txtUsername');
var password = vja.widget.get('txtPassword');

try {
  var result = await vja.db.query('SELECT * FROM users WHERE email = ?', [username]);
  if (result.length > 0) {
    var user = result[0];
    var hashedPassword = await vja.crypto.sha256(password);
    if (user.password_hash === hashedPassword) {
      await vja.session.set('loggedInUser', user.email);
      await vja.notify.toast('ログイン成功', 2000);
    } else {
      await vja.app.showDialog('ログインに失敗しました');
    }
  } else {
    await vja.app.showDialog('ログインに失敗しました');
  }
} catch (e) {
  await vja.app.showDialog('エラーが発生しました');
  console.error(e.message, e);
}
```

`vja.crypto.sha256()` の使用や、`users` テーブルの`email`/`password_hash`カラム名を正しく参照できている点がポイントです（テーブルAI生成時に作られたカラム名をそのまま認識しています）。

### btnRegUser（LoginForm）

前述の通り、このボタンは画面デザインYAMLドラフトの依頼文追記だけで新規追加されたものです。あとはイベントYAMLエディタを開き、`✨ YAMLドラフト` タブに次の依頼文を入力するだけで、Clickイベントの処理を作成しました。

依頼文:
```
新しいユーザ登録フォーム(RegUserForm)に移動する
```

生成されたYAML:
```yaml
説明: 新しいユーザ登録フォームに移動する
入力チェック: なし
アクション:
  - RegUserFormという名前のフォームに移動する
正常終了: トーストで完了を出力
エラー終了: ログとトーストにエラーを出力
```

生成されたJS:
```javascript
try {
  await vja.form.navigate('RegUserForm');
  vja.notify.toast('新しいユーザ登録を行います', 3000);
} catch (e) {
  console.error(e.message, e);
  await vja.app.showDialog('エラーが発生しました。再度お試しください。');
  vja.notify.toast('エラーが発生しました。', 3000);
}
```

画面デザイン（ウィジェット追加）からイベント処理（JS生成）まで、ウィジェットのコピペや手作業でのプロパティ設定を一切挟まずに、依頼文の追記・入力だけで一つのボタンを最初から最後まで作り切れています。

### btnRegister（RegUserForm）

依頼文:
```
パスワードの確認とユーザー登録を行い、ユーザーネームの重複チェックとパスワードのハッシュ化を行い、
データベースに保存します。
```

生成されたJS（抜粋）:
```javascript
var userName = vja.widget.get('txtUserName');
var password = vja.widget.get('txtPassword');
var passwordConfirm = vja.widget.get('txtPasswordConfirm');

if (password !== passwordConfirm) {
  vja.notify.toast('パスワードと確認が一致しません', 3000);
  return;
}

var passwordHash = await vja.crypto.sha256(password);

try {
  var existingUser = await vja.db.query('SELECT * FROM users WHERE email = ?', [userName]);
  if (existingUser.length > 0) {
    await vja.db.execute('UPDATE users SET password_hash = ? WHERE email = ?', [passwordHash, userName]);
  } else {
    await vja.db.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', [userName, passwordHash]);
  }
  vja.notify.toast('登録が完了しました');
} catch (e) {
  console.error(e.message, e);
  vja.notify.toast('登録に失敗しました');
}
```

> ⚠️ **注意**: このサンプルの登録処理は「同じユーザー名（メールアドレス）が既に存在する場合は無条件で上書きUPDATEする」という、依頼文をそのまま素直に実装した内容になっています。実運用では、現在のパスワードの確認なしに他人の登録情報を上書きできてしまうため、実際のアプリで使う場合は「同一ユーザー名が既に存在する場合はエラーにする」等、要件を見直すことを推奨します。AIは依頼文に忠実に実装するため、**セキュリティ・業務要件のレビューは人間側の責任**です。

### btnCancel（LoginForm / RegUserForm）

同じ「キャンセル」という名前のボタンが2画面にありますが、依頼文はそれぞれ別に書いています。

- LoginForm の btnCancel: 「ユーザが入力したユーザ名とパスワードのテキストをクリアする」→ 入力欄を空にするJS
- RegUserForm の btnCancel: 「LoginForm に画面遷移するイベント」→ `vja.form.navigate('LoginForm')`

同じ名前のボタンでも、フォームが違えば独立して別々のJSが生成されます。

> 💡 参考: ウィジェットを複製（コピペ）して使い回す方法も可能ですが、その場合は複製元の生成済みJSがそのまま残るため、別の処理をさせたい場合は依頼文を書き直してJSを再生成する必要があります。前述の`btnRegUser`のように、既存の依頼文へ一言追記して画面デザインYAMLドラフトを再生成する方法の方が、複製・再生成の手間が無く簡潔です。

---

## 4. 検証（バリデーション）AI生成

各フォームのバリデーション編集モーダルで、「定義名」と依頼文を入力して「✨ AI生成」を実行しました。この時、現在のフォームに配置されている入力系ウィジェット名（`txtUsername`/`txtPassword`等）が自動的にAIへ渡されるため、実在するウィジェット名に対して正しくルールが割り当てられます。

### ログインチェック（LoginForm）

| ウィジェット | ルール | メッセージ |
|---|---|---|
| txtUsername | required | ログイン名を入力してください。 |
| txtUsername | email | 有効なメールアドレスを入力してください。 |
| txtPassword | required | パスワードを入力してください。 |
| txtPassword | minLength (8) | パスワードは8文字以上で入力してください。 |

### ユーザ登録バリデーション（RegUserForm）

| ウィジェット | ルール | メッセージ |
|---|---|---|
| txtUserName | required | ユーザ名は必須入力です |
| txtUserName | email | ユーザ名は有効なメールアドレスを入力してください |
| txtPassword | required | パスワードは必須入力です |
| txtPassword | minLength (8) | パスワードは8文字以上で入力してください |
| txtPasswordConfirm | required | パスワード確認は必須入力です |
| txtPasswordConfirm | minLength (8) | パスワード確認は8文字以上で入力してください |

生成されたバリデーションは、YAMLに `検証: 定義名` と1行書くだけで、対応するイベントJSの先頭に自動挿入されます（実際に `btnLogin`/`btnRegister` のJS先頭に `if (!await vja.validate.run("...")) return;` が入っているのはこのためです）。

---

## まとめ

| 作業 | AIに任せた部分 | 人間が行った部分 |
|---|---|---|
| 画面レイアウト | ウィジェット種類・命名・初期配置 | 位置・幅の微調整 |
| DBテーブル | カラム構成（型・PK・NOT NULL） | なし |
| イベント処理 | SQL・ハッシュ化・エラーハンドリングを含むJS全体 | 依頼文の言い回し調整（再生成のたび） |
| 入力チェック | ルールの種類・対象ウィジェット・メッセージ文言 | なし |

書いたのは日本語の依頼文だけで、YAML・JavaScript・SQLのいずれも直接手で書いていません。ローカルLLM（DeepSeek-Coder-V2-Lite）でも、VJAの自動検証＋自動リトライの仕組みと組み合わせることで、実用的な精度でここまで組み上げられることが確認できました。

一方で、「同一ユーザー名なら無条件で上書き」のような、依頼文の曖昧さがそのまま設計の甘さに直結する部分は人間のレビューが必要です。AIに雛形を作らせた後、**生成された内容を読んで妥当性を判断する**というステップは省略できない、というのがこのサンプルからの実感です。
