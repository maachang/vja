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
- クラウド設定の「Slack」（infra名`Slack`）。**サービスの選択（AWSのS3等にあたる選択）が送信方式**: `Webhook` / `Slack Web API`（URLなし、SDKなし）。クレデンシャルは`url`（送信URL。両方式で共通）・`token`・`channel`（key名は`SLACK_URL`/`SLACK_TOKEN`/`SLACK_CHANNEL`）。`vja.fetch`でHTTPを送る（CORS無関係）。
- **サービスごとに不要な項目は設定画面に出さない**: 定義の`"when": { "$service": サービス名 }`（init-params.js。`$service`は選択中のサービス、通常のキーは他のクレデンシャル項目の値）を、`initCloudInfra`（index.html）が`creds[].when`へ引き継ぎ、`vja-app-config.js`の`_cloudCredVisible`が判定する。サービスの選択を変えると`selectCloudService`が再描画する。保存済みのクラウド設定は`credDefs`の写しを持つため、定義を変えた場合は設定の追加し直しが必要。
- 両方（Webhook/Slack Web API）が登録されている場合、`vja.slack.send`は有効で先頭のものを使う。`getCloudInfraCredential('Slack', entry.service)`でそのサービスの設定を取る。
- Webhook: `url`=WebhookのURL（必須）。送信先はWebhook側で固定のため、`options.channel`指定はエラー。Slack Web API: `url`は省略可（既定`https://slack.com/api/chat.postMessage`）、`token`必須、`Authorization: Bearer`。Slack APIは失敗してもHTTP 200で本文`ok:false`+`error`を返すので本文を確認する。戻り値なし、テキストのみ。
- Webhookは**Slackアプリ経由**のものは現行サポート。非推奨なのは「レガシーのカスタム連携」で作った旧方式（公式ドキュメントで確認、2026-10-05）。
- 拡張APIのカテゴリキーは`slack`（`aws_<service>`ではない）。`_isCloudApiCategoryAvailable`は、キー→(インフラ名,サービス名)で、クラウド設定に登録・有効な時だけ表示する（slackはWebhook/Slack Web APIのどちらかが有効なら表示）。実Slackでの確認は未実施（偽fetchの単体テストまで）。

## Chatwork・汎用Webhook（`chatwork-runtime.ts` / `webhook-runtime.ts`、2026-10-06）
- いずれもSDKなし、`vja.fetch`でHTTPを送る。拡張APIのキーは`chatwork` / `webhook`（`_isCloudApiCategoryAvailable`の対応表`_OTHER`に、キー→(インフラ名,サービス名)を追加する。インフラ名の比較は小文字）。
- Chatwork: infra`Chatwork`/service`chatwork`、クレデンシャル`token`(CHATWORK_TOKEN)・`roomId`(CHATWORK_ROOM_ID、既定のルーム)。`vja.chatwork.send(text, {roomId?})`は`POST https://api.chatwork.com/v2/rooms/{id}/messages`（ヘッダー`X-ChatWorkToken`、本文は`body=…`のフォーム形式）。戻り値なし、テキストのみ。ルームごとに10秒10リクエストの制限（Chatwork仕様）。
- 汎用Webhook: infra`汎用Webhook`（Slackの「Webhook」サービスと紛らわしいため）/service`POST`、クレデンシャル`url`(WEBHOOK_URL)・`authorization`(WEBHOOK_AUTHORIZATION、任意)。`vja.webhook.post(payload)`は、オブジェクト/配列→JSON、文字列→text/plain。応答はJSONならオブジェクト、でなければ文字列、空ならnull、2xx以外は例外。登録は1つだけ（複数なら有効で先頭）。
- 想定する使い手はVB6に近い層（社内の業務ツールを作る中小企業の担当者）。優先して入れた理由は、Chatworkが日本の中小企業向け・設定が少ない、汎用WebhookはZapier/Make/n8n経由で多くのサービスを間接的にカバーできるため。Teams（Workflowsの設定が必要）とLINE（公式アカウントと送信先IDが必要）は必要になってから。実Chatwork・実Webhookでの確認は未実施（偽fetchの単体テストまで）。
