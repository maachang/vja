// src/mainview/slack-runtime.test.ts
// slack-runtime.ts（vja.slack.send）のユニットテスト。実際のSlack/webviewは使わず、
// 偽のクラウド設定・クレデンシャル・fetchを注入して検証する。
import { describe, test, expect } from "bun:test";
import { makeSlackRuntime } from "./slack-runtime";

const entry = { id: "s", name: "Slack", service: "slack", enabled: true };
const setup = (cred: any, res: any = { ok: true, status: 200, text: async () => "ok", json: async () => ({ ok: true }) }, infras: any[] = [entry]) => {
    const calls: { url: string; options: any }[] = [];
    const rt = makeSlackRuntime({
        listCloudInfras: async () => infras,
        getCredential: async () => cred,
        fetch: async (url, options) => { calls.push({ url, options }); return res; },
    });
    return { rt, calls };
};

describe("vja.slack.send 設定", () => {
    test("クラウド設定に無い/無効、クレデンシャルが無い、方式が未設定は、わかりやすいエラー", async () => {
        await expect(setup({}, undefined, []).rt.send("a")).rejects.toThrow("登録されていません");
        await expect(setup({}, undefined, [{ ...entry, enabled: false }]).rt.send("a")).rejects.toThrow("登録されていません");
        await expect(setup(null).rt.send("a")).rejects.toThrow("クレデンシャルが取得できません");
        await expect(setup({}).rt.send("a")).rejects.toThrow("方式");
    });
    test("textが空/文字列以外は例外", async () => {
        const { rt } = setup({ SLACK_METHOD: "webhook", SLACK_WEBHOOK_URL: "https://hooks.slack.com/x" });
        await expect(rt.send("")).rejects.toThrow(TypeError);
        await expect(rt.send(123 as any)).rejects.toThrow(TypeError);
    });
});

describe("vja.slack.send Webhook方式", () => {
    const cred = { SLACK_METHOD: "webhook", SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/X" };
    test("WebhookのURLへ {text} をJSONでPOSTする", async () => {
        const { rt, calls } = setup(cred);
        await rt.send("完了しました");
        expect(calls.length).toBe(1);
        expect(calls[0].url).toBe("https://hooks.slack.com/services/T/B/X");
        expect(calls[0].options.method).toBe("POST");
        expect(calls[0].options.headers["Content-Type"]).toBe("application/json");
        expect(JSON.parse(calls[0].options.body)).toEqual({ text: "完了しました" });
    });
    test("channelを指定するとエラー（送信もしない）", async () => {
        const { rt, calls } = setup(cred);
        await expect(rt.send("a", { channel: "#x" })).rejects.toThrow("チャンネルを変更できません");
        expect(calls.length).toBe(0);
    });
    test("URLが未設定ならエラー。送信失敗(HTTPエラー)は状態と本文を含む例外", async () => {
        await expect(setup({ SLACK_METHOD: "webhook" }).rt.send("a")).rejects.toThrow("Webhook URL が設定されていません");
        const ng = setup(cred, { ok: false, status: 404, text: async () => "no_service" });
        await expect(ng.rt.send("a")).rejects.toThrow("404");
        await expect(ng.rt.send("a")).rejects.toThrow("no_service");
    });
});

describe("vja.slack.send Bot方式", () => {
    const cred = { SLACK_METHOD: "bot", SLACK_BOT_TOKEN: "xoxb-1", SLACK_CHANNEL: "#general" };
    test("chat.postMessageへBearerトークンでPOSTし、既定のチャンネルを使う", async () => {
        const { rt, calls } = setup(cred);
        await rt.send("こんにちは");
        expect(calls[0].url).toBe("https://slack.com/api/chat.postMessage");
        expect(calls[0].options.headers.Authorization).toBe("Bearer xoxb-1");
        expect(JSON.parse(calls[0].options.body)).toEqual({ channel: "#general", text: "こんにちは" });
    });
    test("options.channelが既定より優先される", async () => {
        const { rt, calls } = setup(cred);
        await rt.send("a", { channel: "#alerts" });
        expect(JSON.parse(calls[0].options.body).channel).toBe("#alerts");
    });
    test("チャンネルが無い/トークンが無い場合はエラー", async () => {
        await expect(setup({ SLACK_METHOD: "bot", SLACK_BOT_TOKEN: "t" }).rt.send("a")).rejects.toThrow("チャンネルがありません");
        await expect(setup({ SLACK_METHOD: "bot", SLACK_CHANNEL: "#c" }).rt.send("a")).rejects.toThrow("Bot トークンが設定されていません");
    });
    test("HTTP 200でも本文が ok:false ならエラー（error名を含む）", async () => {
        const ng = setup(cred, { ok: true, status: 200, json: async () => ({ ok: false, error: "channel_not_found" }) });
        await expect(ng.rt.send("a")).rejects.toThrow("channel_not_found");
    });
    test("HTTPエラー自体もエラー", async () => {
        const ng = setup(cred, { ok: false, status: 500, json: async () => ({}) });
        await expect(ng.rt.send("a")).rejects.toThrow("500");
    });
});
