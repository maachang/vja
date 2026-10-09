<!-- summary: Slack(Webhook/Web API)・Chatwork・汎用Webhookへメッセージを送る vja.slack.send / vja.chatwork.send / vja.webhook.post の設定と使い方 -->
# 通知の送信（Slack・Chatwork・Webhook）

「クラウド」設定に登録すると、外部サービスへメッセージを送れます。どれもSDKは使わず、通信はVJAが代わりに送ります。AIに使わせるときは、イベントの右パネル「🧩 拡張API（任意）」でそのサービスをONにします。

## Slack（`vja.slack.send`）

クラウド種別に **Slack** を選び、サービスに次のどちらかを選んで登録します。

| サービス | 設定項目 |
|----------|----------|
| Webhook | url（Webhookの送信先URL。必須） |
| Slack Web API | token（`xoxb-...`）、channel（既定の送信先）、username・icon_emoji（任意） |

```javascript
await vja.slack.send('処理が完了しました');
await vja.slack.send('在庫が少なくなりました', { channel: '#alerts' });  // Slack Web APIのみ
```

- **Webhook**: URLを1つ入れるだけで使えます。送信先・表示名・アイコンはWebhookを作るときに決まるので、`channel` などを指定するとエラーになります。
- **Slack Web API**: 送信時に `channel`・`username`・`icon_emoji` を指定できます。省略すると、クラウド設定の既定値を使います。Slackアプリに `chat:write` の権限が必要です。`username` や `icon_emoji` を変えるには `chat:write.customize` も必要です。送信先のチャンネルへ、アプリを招待しておきます。
- 両方を登録した場合は、有効で先に登録した方を使います。
- 送れるのはテキストだけです。

**Webhookの用意（Slack側）**: Slackの「Create New App」でアプリを作り、「Incoming Webhooks」を有効にして、投稿先のチャンネルを選ぶとURLが発行されます。このURLは秘密の値です。他人に見せたり、公開リポジトリに載せたりしないでください。

## Chatwork（`vja.chatwork.send`）

クラウド種別に **Chatwork** を選んで登録します。

| 設定項目 | 内容 |
|----------|------|
| token | ChatworkのAPIトークン |
| roomId | 既定の送信先ルームID |

```javascript
await vja.chatwork.send('処理が完了しました');
await vja.chatwork.send('在庫が少なくなりました', { roomId: 987654321 });
```

- ルームごとに、10秒間に10リクエストまでの制限があります（Chatworkの仕様）。
- 送れるのはテキストだけです。
- 最新の画面での確認方法は、Chatworkの公式ヘルプを見てください。

## 汎用Webhook（`vja.webhook.post`）

クラウド種別に **汎用Webhook**、サービスに **POST** を選んで登録します。Zapier・Make・n8nなど、URLにPOSTすると動くサービスへの橋渡しに使えます。

| 設定項目 | 内容 |
|----------|------|
| url | 送信先URL |
| authorization | `Authorization` ヘッダーの値（任意。例: `Bearer xxxx`） |

```javascript
const result = await vja.webhook.post({ event: 'order', id: 123 });
```

- オブジェクト・配列はJSONで、文字列はそのまま（`text/plain`）送ります。
- 戻り値は応答の本文です。JSONならオブジェクト、JSONでなければ文字列、空なら `null` です。2xx以外は例外になります。
- 登録できるのは1つです。複数登録した場合は、有効で先に登録したものを使います。
