// src/mainview/slack-runtime.ts
// vja.slack.* ランタイム（クラウド設定に登録したSlackへメッセージを送る）。
// 方式は2つで、クラウド設定の「サービス」の選択（AWSのS3等にあたる選択）で切り替える。送信URL（SLACK_URL）は両方式で共通の項目。
//  - Webhook      : Incoming Webhook（Slackアプリ経由で作ったURL）。送信URL=WebhookのURL（必須）。送信先のチャンネルはWebhook側で固定。
//  - Slack Web API: chat.postMessage。送信URL=送信先のURL（省略時は既定の https://slack.com/api/chat.postMessage）、
//                   トークンが必要。送信時にチャンネルを指定できる（要 chat:write 権限、チャンネルへの招待）。
// 通信は vja.fetch（Bun経由）で行うため、Slack側のCORSは関係ない。SDKは使わない。
//
// 依存（クラウド設定の取得・クレデンシャル取得・HTTP送信）は引数で注入する（単体テストのため）。

export type SlackRuntimeDeps = {
    listCloudInfras: () => Promise<any[]>;
    getCredential: (infra: string, service: string) => Promise<Record<string, string> | null>;
    // vja.fetch相当。{ ok, status, text(), json() } を返す
    fetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<any>;
};

// Slack Web API の既定の送信URL（クラウド設定の送信URLが空の場合に使う）
export const SLACK_WEB_API_DEFAULT_URL = "https://slack.com/api/chat.postMessage";

export const makeSlackRuntime = (deps: SlackRuntimeDeps) => {
    // 設定とクレデンシャルは毎回取得する（取得は軽く、キャッシュで古い値を持たないため）。
    // 登録されているSlackのサービス（Webhook / Slack Web API）のうち、有効な最初のものを使う
    const load = async (): Promise<{ method: "webhook" | "webapi"; cred: Record<string, string> }> => {
        const infras = await deps.listCloudInfras();
        const entry = (infras || []).find((i: any) =>
            i.enabled && String(i.name || "").toLowerCase() === "slack"
            && ["webhook", "slack web api"].includes(String(i.service || "").toLowerCase()));
        if (!entry) throw new Error("クラウド設定に Slack（Webhook または Slack Web API）が登録されていません（クラウド設定で登録して、有効にしてください）");
        const method = String(entry.service).toLowerCase() === "webhook" ? "webhook" : "webapi";
        const cred = await deps.getCredential("Slack", entry.service);
        if (!cred) throw new Error("Slack のクレデンシャルが取得できません（クラウド設定で入れ直して保存してください）");
        return { method, cred };
    };

    return {
        // メッセージ送信。options: { channel }（Slack Web API方式のみ。省略時はクラウド設定の既定のチャンネル）。戻り値なし
        // Webhook方式では、チャンネルはWebhook側で固定のため、channelを指定するとエラーにする
        send: async (text: string, options: { channel?: string } = {}): Promise<void> => {
            if (typeof text !== "string" || text === "") throw new TypeError("text は空でない文字列で指定してください");
            const { method, cred } = await load();

            if (method === "webhook") {
                if (options.channel) throw new Error("Webhook方式では送信先のチャンネルを変更できません（Webhookを作るときに決まっています）。チャンネルを指定するには、クラウド設定の方式を Slack Web API にしてください");
                if (!cred.SLACK_URL) throw new Error("Slack の送信URL（Webhook の URL）が設定されていません");
                const res = await deps.fetch(cred.SLACK_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text }),
                });
                if (!res.ok) throw new Error(`Slackへの送信に失敗しました (${res.status}): ${await res.text()}`);
                return;
            }

            if (method === "webapi") {
                if (!cred.SLACK_TOKEN) throw new Error("Slack の トークンが設定されていません");
                const channel = options.channel || cred.SLACK_CHANNEL;
                if (!channel) throw new Error("送信先のチャンネルがありません（options.channel で指定するか、クラウド設定で既定のチャンネルを設定してください）");
                const res = await deps.fetch(cred.SLACK_URL || SLACK_WEB_API_DEFAULT_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: "Bearer " + cred.SLACK_TOKEN },
                    body: JSON.stringify({ channel, text }),
                });
                if (!res.ok) throw new Error(`Slackへの送信に失敗しました (${res.status})`);
                // Slack APIは、失敗してもHTTPは200で、本文の ok:false と error（channel_not_found 等）で返す
                const body = await res.json();
                if (!body.ok) throw new Error("Slackへの送信に失敗しました: " + (body.error || "unknown"));
                return;
            }

        },
    };
};
