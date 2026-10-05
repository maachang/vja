// src/mainview/chatwork-runtime.ts
// vja.chatwork.* ランタイム（クラウド設定に登録したChatworkのルームへメッセージを送る）。
// Chatwork API（POST https://api.chatwork.com/v2/rooms/{room_id}/messages、ヘッダー X-ChatWorkToken）を
// vja.fetch（Bun経由）で呼ぶ。SDKは使わない。
//
// 依存（クラウド設定の取得・クレデンシャル取得・HTTP送信）は引数で注入する（単体テストのため）。

export type ChatworkRuntimeDeps = {
    listCloudInfras: () => Promise<any[]>;
    getCredential: (infra: string, service: string) => Promise<Record<string, string> | null>;
    // vja.fetch相当。{ ok, status, text() } を返す
    fetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<any>;
};

export const CHATWORK_API_BASE = "https://api.chatwork.com/v2";

export const makeChatworkRuntime = (deps: ChatworkRuntimeDeps) => {
    const load = async (): Promise<Record<string, string>> => {
        const infras = await deps.listCloudInfras();
        const entry = (infras || []).find((i: any) =>
            i.enabled && String(i.name || "").toLowerCase() === "chatwork" && String(i.service || "").toLowerCase() === "chatwork");
        if (!entry) throw new Error("クラウド設定に Chatwork が登録されていません（クラウド設定で登録して、有効にしてください）");
        const cred = await deps.getCredential("Chatwork", "chatwork");
        if (!cred || !cred.CHATWORK_TOKEN) throw new Error("Chatwork のAPIトークンが取得できません（クラウド設定で入れ直して保存してください）");
        return cred;
    };

    return {
        // メッセージ送信。options: { roomId }（省略時はクラウド設定の既定のルームID）。戻り値なし
        send: async (text: string, options: { roomId?: string | number } = {}): Promise<void> => {
            if (typeof text !== "string" || text === "") throw new TypeError("text は空でない文字列で指定してください");
            const cred = await load();
            const roomId = String(options.roomId ?? cred.CHATWORK_ROOM_ID ?? "");
            if (roomId === "") throw new Error("送信先のルームIDがありません（options.roomId で指定するか、クラウド設定で既定のルームIDを設定してください）");
            const res = await deps.fetch(`${CHATWORK_API_BASE}/rooms/${encodeURIComponent(roomId)}/messages`, {
                method: "POST",
                headers: { "X-ChatWorkToken": cred.CHATWORK_TOKEN, "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ body: text }).toString(),
            });
            if (!res.ok) throw new Error(`Chatworkへの送信に失敗しました (${res.status}): ${await res.text()}`);
        },
    };
};
