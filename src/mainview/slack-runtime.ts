// src/mainview/slack-runtime.ts
// vja.slack.* ランタイム（クラウド設定に登録したSlackへメッセージを送る）。
// 方式は2つで、クラウド設定の「方式」の選択で切り替える。
//  - webhook: Incoming Webhook（Slackアプリ経由で作ったURL）。送信先のチャンネルはWebhook側で固定。
//  - bot    : Botトークン(chat.postMessage)。送信時にチャンネルを指定できる（要 chat:write 権限、チャンネルへの招待）。
// 通信は vja.fetch（Bun経由）で行うため、Slack側のCORSは関係ない。SDKは使わない。
//
// 依存（クラウド設定の取得・クレデンシャル取得・HTTP送信）は引数で注入する（単体テストのため）。

export type SlackRuntimeDeps = {
    listCloudInfras: () => Promise<any[]>;
    getCredential: (infra: string, service: string) => Promise<Record<string, string> | null>;
    // vja.fetch相当。{ ok, status, text(), json() } を返す
    fetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<any>;
};

export const makeSlackRuntime = (deps: SlackRuntimeDeps) => {
    // 設定とクレデンシャルは毎回取得する（取得は軽く、実行中に設定が変わることも無いが、キャッシュで古い値を持たないため）
    const load = async (): Promise<Record<string, string>> => {
        const infras = await deps.listCloudInfras();
        const entry = (infras || []).find((i: any) =>
            i.enabled && String(i.name || "").toLowerCase() === "slack" && String(i.service || "").toLowerCase() === "slack");
        if (!entry) throw new Error("クラウド設定に Slack が登録されていません（クラウド設定で登録して、有効にしてください）");
        const cred = await deps.getCredential("Slack", "slack");
        if (!cred) throw new Error("Slack のクレデンシャルが取得できません（クラウド設定で入れ直して保存してください）");
        return cred;
    };

    return {
        // メッセージ送信。options: { channel }（Bot方式のみ。省略時はクラウド設定の既定のチャンネル）。戻り値なし
        // Webhook方式では、チャンネルはWebhook側で固定のため、channelを指定するとエラーにする
        send: async (text: string, options: { channel?: string } = {}): Promise<void> => {
            if (typeof text !== "string" || text === "") throw new TypeError("text は空でない文字列で指定してください");
            const cred = await load();
            const method = cred.SLACK_METHOD || "";

            if (method === "webhook") {
                if (options.channel) throw new Error("Webhook方式では送信先のチャンネルを変更できません（Webhookを作るときに決まっています）。チャンネルを指定するには、クラウド設定の方式をBotにしてください");
                if (!cred.SLACK_WEBHOOK_URL) throw new Error("Slack の Webhook URL が設定されていません");
                const res = await deps.fetch(cred.SLACK_WEBHOOK_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text }),
                });
                if (!res.ok) throw new Error(`Slackへの送信に失敗しました (${res.status}): ${await res.text()}`);
                return;
            }

            if (method === "bot") {
                if (!cred.SLACK_BOT_TOKEN) throw new Error("Slack の Bot トークンが設定されていません");
                const channel = options.channel || cred.SLACK_CHANNEL;
                if (!channel) throw new Error("送信先のチャンネルがありません（options.channel で指定するか、クラウド設定で既定のチャンネルを設定してください）");
                const res = await deps.fetch("https://slack.com/api/chat.postMessage", {
                    method: "POST",
                    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: "Bearer " + cred.SLACK_BOT_TOKEN },
                    body: JSON.stringify({ channel, text }),
                });
                if (!res.ok) throw new Error(`Slackへの送信に失敗しました (${res.status})`);
                // Slack APIは、失敗してもHTTPは200で、本文の ok:false と error（channel_not_found 等）で返す
                const body = await res.json();
                if (!body.ok) throw new Error("Slackへの送信に失敗しました: " + (body.error || "unknown"));
                return;
            }

            throw new Error("Slack の方式（Webhook または Bot）が設定されていません");
        },
    };
};
