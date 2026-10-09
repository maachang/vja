<!-- summary: 拡張ランタイム。プロジェクト共通の自作JavaScript関数（金額整形など）を定義して全フォームで使い回す。AI向け説明の生成 -->
# 拡張ランタイム

プロジェクト専用のJavaScript関数を定義し、全フォームのイベントから呼び出せる機能です。金額の整形のように、あちこちで使う処理をまとめておくのに便利です。

## 開き方

メニュー［プロジェクト］→「拡張ランタイム…」を選びます。

## タブ

| タブ | 内容 |
|------|------|
| 📜 JavaScript | 拡張関数のコードを書く |
| 📋 AI向け説明 | AIがこの関数を使うための、YAML形式の説明 |

JavaScriptタブにコードを書いたあと、**「🤖 AI向け説明を生成」** を押すと、AIが説明を自動で作ります。

## 例

```javascript
// 拡張ランタイムに書く
function formatYen(amount) {
    return '¥' + Number(amount).toLocaleString('ja-JP');
}

async function getUserById(id) {
    const rows = await vja.db.query('SELECT * FROM users WHERE id = ?', [id]);
    return rows[0] || null;
}
```

イベントのコードから、`formatYen(1234)` や `await getUserById(1)` のように呼び出せます。
