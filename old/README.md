# bun.js で実行する、以下の webview-bun を使った、VB(visualBasic)開発環境的なものを作成したい。

## webview-bunの実装例.

<testWebView.js>

```js
const { Webview } = await import("webview-bun");
const webview = new Webview();
webview.title = "Bunで書き出した1ファイルGUIアプリ";
webview.size = { width: 800, height: 600 };

// 表示したいHTML（外部のWebサイトのURLでも、ローカルのHTML文字列でもOK）
webview.setHTML(`
  <html>
    <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
      <h1>Hello from Bun!</h1>
      <p>このアプリはたった1つのEXEファイルで動いています。</p>
    </body>
  </html>
`);

webview.run();
```

## 実行.

```cmd
$ bun run testWebView.js
```

このbun.js で提供されている環境を使って、VB的な開発環境を作り、各イベントのjs ファイルは AIでコーディングするみたいなものを作りたい。

## VB開発環境的の具体的な内容

1. プログラム言語は javascript(bun.jsで動くもの)
2. 上のjs ファイルは「ローカル環境で実行できるGUI環境」これを利用したVB開発環境を構築したい。
3. このVB開発環境で作成された画面は「webview-bun」で表示できるものとして作成してほしい。
4. VB開発環境では「各オブジェクト（ボタン、チェックボックスなど）」が設置でき、ここで「設置したオブジェクト」に対してVB開発環境だと「イベント」実行（VBプログラム）が行えるが、これらは「yaml形式」を通じてAI(ローカルAIなら llama-server を経由して、qwen3.5 4B q4k_m レベルのものを使ってコーディングを行う)などを考えている。
5. 項３においては「現状予定なので、対象オブジェクトにイベントとして yaml入力ができる仕組み」にしておいてほしい。
6. また画面を作成した内容をプロジェクトとして保存、オープンができる形にしてほしい。

次に基本的な形ができたら、これに対して以下の対応を行う。

1. 通常アプリを作る場合に考える必要があるのが、画面遷移だが、この開発ツールでは「複数の画面に切り替えて表示する形」としたい
2. そのため「メニュー画面の真ん中あたりに `セレクトボックス` で複数のフォーム切り替えが出来て編集できる」ようにする
3. あとは「対象のフォームの新規作成」や「削除」を行えるようにする
4. そして、これら「プロジェクトとして保存」そして「オープン」できるようにする
