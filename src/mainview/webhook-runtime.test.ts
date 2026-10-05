// src/mainview/webhook-runtime.test.ts
// webhook-runtime.ts（vja.webhook.post）のユニットテスト。偽のクラウド設定・クレデンシャル・fetchで検証する。
import { describe, test, expect } from "bun:test";
import { makeWebhookRuntime, WEBHOOK_INFRA, WEBHOOK_SERVICE } from "./webhook-runtime";

const entry = { id: "w", name: WEBHOOK_INFRA, service: WEBHOOK_SERVICE, enabled: true };
const jsonRes = (body: string, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => body });
const setup = (cred: any, res: any = jsonRes('{"ok":true}'), infras: any[] = [entry]) => {
    const calls: { url: string; options: any }[] = [];
    const credCalls: [string, string][] = [];
    const rt = makeWebhookRuntime({
        listCloudInfras: async () => infras,
        getCredential: async (i, s) => { credCalls.push([i, s]); return cred; },
        fetch: async (url, options) => { calls.push({ url, options }); return res; },
    });
    return { rt, calls, credCalls };
};
const cred = { WEBHOOK_URL: "https://hooks.example.com/abc" };

describe("vja.webhook.post", () => {
    test("オブジェクトはJSONで、設定の送信URLへPOSTする", async () => {
        const { rt, calls, credCalls } = setup(cred);
        const r = await rt.post({ name: "山田", items: [1, 2] });
        expect(credCalls).toEqual([["汎用Webhook", "POST"]]);
        expect(calls[0].url).toBe("https://hooks.example.com/abc");
        expect(calls[0].options.method).toBe("POST");
        expect(calls[0].options.headers["Content-Type"]).toBe("application/json");
        expect(JSON.parse(calls[0].options.body)).toEqual({ name: "山田", items: [1, 2] });
        expect(r).toEqual({ ok: true });
    });
    test("文字列はそのまま(text/plain)、配列はJSONで送る", async () => {
        const { rt, calls } = setup(cred);
        await rt.post("プレーンな文字列");
        await rt.post([1, 2]);
        expect(calls[0].options.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
        expect(calls[0].options.body).toBe("プレーンな文字列");
        expect(calls[1].options.headers["Content-Type"]).toBe("application/json");
        expect(calls[1].options.body).toBe("[1,2]");
    });
    test("認証ヘッダーが設定されていればAuthorizationに付ける。無ければ付けない", async () => {
        const a = setup({ ...cred, WEBHOOK_AUTHORIZATION: "Bearer xyz" });
        await a.rt.post({});
        expect(a.calls[0].options.headers.Authorization).toBe("Bearer xyz");
        const b = setup(cred);
        await b.rt.post({});
        expect("Authorization" in b.calls[0].options.headers).toBe(false);
    });
    test("応答: JSONならオブジェクト、JSONでなければ文字列、空ならnull", async () => {
        expect(await setup(cred, jsonRes('{"id":1}')).rt.post({})).toEqual({ id: 1 });
        expect(await setup(cred, jsonRes("accepted")).rt.post({})).toBe("accepted");
        expect(await setup(cred, jsonRes("")).rt.post({})).toBeNull();
    });
    test("2xx以外は状態と本文を含む例外", async () => {
        const ng = setup(cred, jsonRes("bad request", 400));
        await expect(ng.rt.post({})).rejects.toThrow("400");
        await expect(ng.rt.post({})).rejects.toThrow("bad request");
    });
    test("登録なし/無効、送信URLが無い、payloadなしは、わかりやすいエラー", async () => {
        await expect(setup(cred, undefined, []).rt.post({})).rejects.toThrow("登録されていません");
        await expect(setup(cred, undefined, [{ ...entry, enabled: false }]).rt.post({})).rejects.toThrow("登録されていません");
        await expect(setup(null).rt.post({})).rejects.toThrow("送信URL");
        await expect(setup({}).rt.post({})).rejects.toThrow("送信URL");
        await expect(setup(cred).rt.post(undefined)).rejects.toThrow(TypeError);
    });
});
