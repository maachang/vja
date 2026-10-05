// src/mainview/webhook-runtime.ts
// vja.webhook.* ランタイム（クラウド設定に登録した汎用Webhookへ、データをPOSTする）。
// Zapier / Make / n8n など、URLにPOSTすると動くサービスへの橋渡しに使う。
// vja.fetch（Bun経由）で送るため、相手側のCORSは関係ない。SDKは使わない。
//
// 依存（クラウド設定の取得・クレデンシャル取得・HTTP送信）は引数で注入する（単体テストのため）。

export type WebhookRuntimeDeps = {
    listCloudInfras: () => Promise<any[]>;
    getCredential: (infra: string, service: string) => Promise<Record<string, string> | null>;
    // vja.fetch相当。{ ok, status, text() } を返す
    fetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<any>;
};

// クラウド設定の名前（インフラ名・サービス名）。Slackの「Webhook」サービスと紛らわしいため、インフラ名は「汎用Webhook」にしている
export const WEBHOOK_INFRA = "汎用Webhook";
export const WEBHOOK_SERVICE = "POST";

export const makeWebhookRuntime = (deps: WebhookRuntimeDeps) => ({
    // POST送信。payload がオブジェクト/配列ならJSONで、文字列ならそのまま（text/plain）送る。
    // 応答の本文がJSONならオブジェクトに変換して返し、JSONでなければ文字列、空ならnull。2xx以外は例外
    post: async (payload: any): Promise<any> => {
        if (payload === undefined) throw new TypeError("payload を指定してください");
        const infras = await deps.listCloudInfras();
        const entry = (infras || []).find((i: any) =>
            i.enabled && String(i.name || "").toLowerCase() === WEBHOOK_INFRA.toLowerCase()
            && String(i.service || "").toLowerCase() === WEBHOOK_SERVICE.toLowerCase());
        if (!entry) throw new Error("クラウド設定に 汎用Webhook が登録されていません（クラウド設定で登録して、有効にしてください）");
        const cred = await deps.getCredential(WEBHOOK_INFRA, WEBHOOK_SERVICE);
        if (!cred || !cred.WEBHOOK_URL) throw new Error("汎用Webhook の送信URLが取得できません（クラウド設定で入れ直して保存してください）");

        const isText = typeof payload === "string";
        const headers: Record<string, string> = { "Content-Type": isText ? "text/plain; charset=utf-8" : "application/json" };
        if (cred.WEBHOOK_AUTHORIZATION) headers["Authorization"] = cred.WEBHOOK_AUTHORIZATION;
        const res = await deps.fetch(cred.WEBHOOK_URL, { method: "POST", headers, body: isText ? payload : JSON.stringify(payload) });
        const text = await res.text();
        if (!res.ok) throw new Error(`Webhookへの送信に失敗しました (${res.status}): ${text}`);
        if (text === "") return null;
        try { return JSON.parse(text); } catch { return text; }
    },
});
