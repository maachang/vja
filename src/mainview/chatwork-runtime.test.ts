// src/mainview/chatwork-runtime.test.ts
// chatwork-runtime.ts（vja.chatwork.send）のユニットテスト。偽のクラウド設定・クレデンシャル・fetchで検証する。
import { describe, test, expect } from "bun:test";
import { makeChatworkRuntime, CHATWORK_API_BASE } from "./chatwork-runtime";

const entry = { id: "c", name: "Chatwork", service: "chatwork", enabled: true };
const okRes = { ok: true, status: 200, text: async () => '{"message_id":"1"}' };
const setup = (cred: any, res: any = okRes, infras: any[] = [entry]) => {
    const calls: { url: string; options: any }[] = [];
    const credCalls: [string, string][] = [];
    const rt = makeChatworkRuntime({
        listCloudInfras: async () => infras,
        getCredential: async (i, s) => { credCalls.push([i, s]); return cred; },
        fetch: async (url, options) => { calls.push({ url, options }); return res; },
    });
    return { rt, calls, credCalls };
};
const cred = { CHATWORK_TOKEN: "tok", CHATWORK_ROOM_ID: "12345" };

describe("vja.chatwork.send", () => {
    test("既定のルームへ、X-ChatWorkTokenとフォーム形式(body=...)でPOSTする", async () => {
        const { rt, calls, credCalls } = setup(cred);
        await rt.send("こんにちは & 完了");
        expect(credCalls).toEqual([["Chatwork", "chatwork"]]);
        expect(calls[0].url).toBe(`${CHATWORK_API_BASE}/rooms/12345/messages`);
        expect(calls[0].options.method).toBe("POST");
        expect(calls[0].options.headers["X-ChatWorkToken"]).toBe("tok");
        expect(calls[0].options.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
        // 日本語や&が正しくエンコードされ、デコードすると元の本文に戻る
        expect(new URLSearchParams(calls[0].options.body).get("body")).toBe("こんにちは & 完了");
    });
    test("options.roomIdが既定より優先される（数値も可）", async () => {
        const { rt, calls } = setup(cred);
        await rt.send("a", { roomId: 999 });
        expect(calls[0].url).toBe(`${CHATWORK_API_BASE}/rooms/999/messages`);
    });
    test("ルームIDが無い場合はエラー（送信もしない）", async () => {
        const { rt, calls } = setup({ CHATWORK_TOKEN: "tok" });
        await expect(rt.send("a")).rejects.toThrow("ルームID");
        expect(calls.length).toBe(0);
    });
    test("Chatworkが無い/無効/トークンが無い場合は、わかりやすいエラー", async () => {
        await expect(setup(cred, undefined, []).rt.send("a")).rejects.toThrow("登録されていません");
        await expect(setup(cred, undefined, [{ ...entry, enabled: false }]).rt.send("a")).rejects.toThrow("登録されていません");
        await expect(setup(null).rt.send("a")).rejects.toThrow("APIトークン");
        await expect(setup({ CHATWORK_ROOM_ID: "1" }).rt.send("a")).rejects.toThrow("APIトークン");
    });
    test("textが空/文字列以外は例外", async () => {
        const { rt } = setup(cred);
        await expect(rt.send("")).rejects.toThrow(TypeError);
        await expect(rt.send(1 as any)).rejects.toThrow(TypeError);
    });
    test("送信失敗(HTTPエラー)は状態と本文を含む例外", async () => {
        const ng = setup(cred, { ok: false, status: 401, text: async () => '{"errors":["Invalid API Token"]}' });
        await expect(ng.rt.send("a")).rejects.toThrow("401");
        await expect(ng.rt.send("a")).rejects.toThrow("Invalid API Token");
    });
});
