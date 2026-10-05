# クラウド（AWS）対応（2026-10-05時点）

正式対応クラウドは**AWSのみ**（加えて、SDKを使わないSlack送信`vja.slack.send`。下記「Slack」節）。GCP/Azure等は今後対応予定（`CLOUD_INFRA_RAW`（init-params.js）のAWS以外はコメントアウトして画面に出していない。戻す時は実機で検証すること）。AWSのうちCognito（認証まわりでクライアント側の実装が面倒）と「カスタム」もコメントアウト済み。

## 全体の仕組み（webview前提）
- イベントは全てwebview（プロジェクト実行ウィンドウ）で動く。AWS SDK v3は、クラウド設定の各サービスの`sdkUrl`（CDN `+esm`）から**webview内**へ動的importする。bun側にSDKは無い。
- webviewの`window.fetch`はCORSで遮断される（バケット側にCORS設定が無いとプリフライトが403）。そのため、**AWS宛て（`*.amazonaws.com`/`*.amazonaws.com.cn`/`*.api.aws`）のfetchだけを`vja.fetch`（Bun経由）へ自動で差し替える**（`bridge-common.ts`の`makeFetchProxy`/`AWS_HOST_REGEX`、`project-bridge.ts`で設置）。AWS以外・相対パス・`views://`は元のfetchのまま。SDKには何も渡さない。
- AWS SDKの`FetchHttpHandler`は`fetch(new Request(url, 設定))`の形で呼ぶ。差し替えは`init`だけでなく`Request`オブジェクトからメソッド・ヘッダー・本文を取り出す（最初に`init`だけ見て全部GETになり署名不一致になった）。
- `vja.fetch`はバイナリ対応済み（`responseType:'binary'`、`body`にUint8Array/ArrayBuffer。base64でRPCを通す。Bun側実体は`bun-utils.ts`の`execFetch`、index.ts/project-runner.tsで共有）。

## vja.aws.*ランタイム（`src/mainview/aws-runtime.ts`、`project-bridge.ts`で`vja.aws`に設置）
- 対応: s3(put/get/list/delete)、dynamodb(get/put/delete/query/scan。普通のJSオブジェクトで読み書き、変換は自前の`ddbMarshal`/`ddbUnmarshal`)、sqs(send/receive/delete)、sns(publish)、lambda(invoke)、ses(sendEmail、sesv2)、sts(getCallerIdentity)、secretsmanager(getSecret)、cloudwatch(putLog)。
- 共通: `_makeLoader`でクラウド設定のサービス定義(`name:'AWS'`+`service`)→`sdkUrl`でSDK読み込み→`getCloudInfraCredential('AWS',service)`でクライアント生成（初回のみ・失敗時は次回やり直し）。`requestChecksumCalculation/responseChecksumValidation:'WHEN_REQUIRED'`（実機で動作確認済みの設定）。
- 仕様の判断: `s3.get`は存在しないキーで`null`、`put/delete`は戻り値なし、`list`の`lastModified`はISO文字列（1000件超は続きを自動取得、`maxKeys`で打ち切り）、`dynamodb.query`はパーティションキーの一致検索のみ（limit既定100）、`cloudwatch.putLog`はストリームが無ければ作る（グループは事前に作る）。
- 依存を引数で注入するので単体テストできる（`aws-runtime.test.ts`、偽SDK）。実AWSで確認済みなのはS3とSTSのみ。他サービスは実機で使う時に確認する。

## イベントごとの選択（右パネルの「🧩 拡張API（任意）」）
- 「🔌 利用API（任意）」（vja本体のAPI）とは別セクション。クラウド設定に登録・有効なサービスだけ行が出る（`_isCloudApiCategoryAvailable`）。
- 既存の任意APIカテゴリの仕組みを共有: キーは`aws_<service>`（`apiOptOverrides`に保存）、`VJA_FRONT_API_OPTIONAL_ENG/LABELS`（prompt-def.js）、`VJA_FRONT_API_EXTENSION_KEYS`（拡張API側に出すキー）、検出パターン`_API_OPT_DETECT_PATTERNS`（vja-yaml-editor.js）。
- AIへの説明は`prompts/vja-front-api-optional.aws_<service>.eng.md`。検証のホワイトリスト/await必須は`vja-front-api-full.ja.md`の記載から自動抽出されるため、**新しいAPIは日本語版にも`await vja.xxx(`形式で書く**（無いと未知のAPI扱いになる）。モックのダミーは`vja-mock-runtime.js`と`vja-mock-check.js`の両方に足す。

## クレデンシャルの保存
- 保存ファイル(.vjaproj)には**暗号化した値**を書く（AES-GCM、プロジェクトの合言葉`_vjaPass`＋固定パスフレーズ）。以前は暗号化前の編集中データが画面側に残り、平文で保存されていた（2026-10-05修正）。旧版で平文保存されたファイルは復号できず、クラウド設定の入れ直しと保存し直しが必要（自動変換はしない）。
- 保存: `saveCloudInfrasRequest`が暗号化済みの一覧を返し、画面側はそれを保持（`credentialsJson`は保存しない）。設定画面を開く時は`getCloudInfrasRequest({infras})`でBunが復号した値を表示。実行時の`getCloudInfraCredential`は`vja.cloud.getCredential(id,key)`で1項目ずつ復号し、1つも取れなければnull（既定値だけの結果は返さない）。
- 実行用データ`_getProjectData`（vja-save.js）に`cloudInfras`を含める（無いとBun側が空リストで上書きし、実行中のアプリからクラウド設定が見えない）。
- 合言葉: 実行時は`_updateProjectData(…, keepPass=true)`で現在の合言葉を使い続ける（読み直すと新しい合言葉が作られ復号できなくなる）。index.tsとproject-runner.tsが別々に持つので`setVjaPass`で同期する。

## 教訓
- `getCloudInfraCredential`は保存データ(`name`)と食い違う`infra`で照合しており、常にnullだった。保存キーは`credDefs`の`name`（accessKeyId）で、利用側は`key`（AWS_ACCESS_KEY_ID）。リージョンは画面で既定表示されても操作しないと保存されない（選択肢の既定値で補う）。
- 「簡略化した条件では動くが実機相当では動かない」ことがある。確認は実機相当のコンテキスト・実際のプロジェクトデータで行う。

## Slack（`src/mainview/slack-runtime.ts`、`vja.slack.send(text, options?)`）
- クラウド設定の「Slack」（infra名`Slack`、service`slack`、URLなし）。クレデンシャルは`method`（選択: webhook/bot、既定webhook）・`webhookUrl`・`botToken`・`channel`（key名は`SLACK_METHOD`/`SLACK_WEBHOOK_URL`/`SLACK_BOT_TOKEN`/`SLACK_CHANNEL`）。SDKは使わず`vja.fetch`でHTTPを送る（CORS無関係）。
- Webhook方式: 送信先はWebhook側で固定のため、`options.channel`指定はエラー。Bot方式: `chat.postMessage`（`Authorization: Bearer`）。Slack APIは失敗してもHTTP 200で本文`ok:false`+`error`を返すので本文を確認する。戻り値なし、テキストのみ。
- Webhookは**Slackアプリ経由**のものは現行サポート。非推奨なのは「レガシーのカスタム連携」で作った旧方式（公式ドキュメントで確認、2026-10-05）。
- 拡張APIのカテゴリキーは`slack`（`aws_<service>`ではない）。`_isCloudApiCategoryAvailable`は、キー→(インフラ名,サービス名)で、クラウド設定に登録・有効な時だけ表示する。実Slackでの確認は未実施（偽fetchの単体テストまで）。
