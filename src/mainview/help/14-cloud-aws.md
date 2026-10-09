<!-- summary: クラウド設定とAWS。vja.aws.*（S3・DynamoDB・SQS・SNS・Lambda・SES・STS・Secrets Manager・CloudWatch Logs）の使い方、認証情報の暗号化保存、CORS設定が不要な理由 -->
# クラウド設定とAWS

AWSの認証情報と、Slack・Chatwork・汎用Webhookの送信設定を、メニュー［設定］→「クラウドインフラ設定…」で管理します。認証情報などの秘密の値は、暗号化して保存されます。

正式に対応しているクラウドは **AWSのみ** です。Slack・Chatwork・汎用Webhookは、メッセージの送信先として同じ画面から登録します（→「通知の送信」）。

## 設定する

メニュー［設定］→「クラウドインフラ設定…」を開き、使うサービスを登録して「有効」にします。

| 項目 | 内容 |
|------|------|
| 有効 | この設定を使うか |
| クラウド種別 | AWS / Slack / Chatwork / 汎用Webhook |
| サービス | S3、DynamoDBなど |
| エンドポイントURL | AWS SDKを読み込むCDNのURL |
| アクセスキーなど | 各サービスの認証情報（暗号化して保存） |

登録したサービスは、イベントエディタの右パネル「🧩 拡張API（任意）」に表示されます。AIにそのサービスを使ったコードを作らせるときは、ここでONにします。

## `vja.aws.*` で使う

登録して有効にしたサービスは、SDKを自分で読み込まなくても、次の関数で呼び出せます。

```javascript
await vja.aws.s3.put('my-bucket', 'memo/a.txt', 'こんにちは');
const text = await vja.aws.s3.get('my-bucket', 'memo/a.txt');
const items = await vja.aws.s3.list('my-bucket', { prefix: 'memo/' });
await vja.aws.s3.delete('my-bucket', 'memo/a.txt');
```

| サービス | 関数 |
|----------|------|
| S3 | `put(bucket, key, body, options?)` / `get(bucket, key, options?)` / `list(bucket, options?)` / `delete(bucket, key)` |
| DynamoDB | `get(table, key)` / `put(table, item)` / `delete(table, key)` / `query(table, keyName, keyValue, options?)` / `scan(table, options?)` |
| SQS | `send(queueUrl, body)` / `receive(queueUrl, options?)` / `delete(queueUrl, receiptHandle)` |
| SNS | `publish(topicArn, message, options?)` |
| Lambda | `invoke(functionName, payload?)` |
| SES | `sendEmail({ from, to, subject, text, html?, cc?, bcc? })` |
| STS | `getCallerIdentity()` |
| Secrets Manager | `getSecret(secretId)` |
| CloudWatch Logs | `putLog(logGroup, logStream, message)` |

主な戻り値と注意点:

- S3の `get` は、既定では文字列です。`{ as: 'bytes' }` で `Uint8Array` になります。キーが無いと `null` です。
- S3の `list` は `[{ key, size, lastModified }]` を返します。
- S3の `delete` は、存在しないキーを指定してもエラーになりません。
- DynamoDBは、普通のJavaScriptオブジェクトで読み書きできます。`query` はパーティションキーの一致検索だけで、`limit` の既定は100です。
- SQSの受信は `[{ id, body, receiptHandle }]` です。処理後は `delete` で消します。
- SESの `from` は、SESで確認済みのアドレスまたはドメインにします。
- CloudWatch Logsは、ログストリームが無ければ作られます。ロググループは事前に作ってください。
- Cognitoは対象外です。

クラウド設定に登録されていない場合や、認証情報が取れない場合は、その旨のエラーになります。

## CORSの設定は要りません

プロジェクトの実行時、AWS宛て（`*.amazonaws.com` など）の通信は、ブラウザではなくVJAが代わりに送ります。そのため、S3バケット側のCORS設定は不要です。AWS以外への通信は、ふつうのブラウザの動作です。

SDKはCDNから読み込むため、ネットワークへの接続が必要です。
