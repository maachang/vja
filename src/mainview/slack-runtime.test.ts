// src/mainview/slack-runtime.test.ts
// slack-runtime.ts（vja.slack.send）のユニットテスト。実際のSlack/webviewは使わず、
// 偽のクラウド設定・クレデンシャル・fetchを注入して検証する。
// 方式は、クラウド設定の「サービス」（Webhook / Slack Web API）で決まる。
import { describe, test, expect } from "bun:test";
import { makeSlackRuntime, SLACK_WEB_API_DEFAULT_URL } from "./slack-runtime";

const webhookEntry = { id: "w", name: "Slack", service: "Webhook", enabled: true };
const apiEntry = { id: "a", name: "Slack", service: "Slack Web API", enabled: true };
const okRes = { ok: true, status: 200, text: async () => "ok", json: async () => ({ ok: true }) };

const setup = (infras: any[], cred: any, res: any = okRes) => {
    const calls: { url: string; options: any }[] = [];
    const credCalls: [string, string][] = [];
    const rt = makeSlackRuntime({
        listCloudInfras: async () => infras,
        getCredential: async (infra, service) => { credCalls.push([infra, service]); return cred; },
        fetch: async (url, options) => { calls.push({ url, options }); return res; },
    });
    return { rt, calls, credCalls };
};

describe("vja.slack.send 設定", () => {
    test("Slackが無い/無効/別のインフラは、登録を促すエラー", async () => {
        await expect(setup([], {}).rt.send("a")).rejects.toThrow("登録されていません");
        await expect(setup([{ ...webhookEntry, enabled: false }], {}).rt.send("a")).rejects.toThrow("登録されていません");
        await expect(setup([{ ...webhookEntry, name: "AWS" }], {}).rt.send("a")).rejects.toThrow("登録されていません");
    });
    test("クレデンシャルが取れない場合はエラー", async () => {
        await expect(setup([webhookEntry], null).rt.send("a")).rejects.toThrow("クレデンシャルが取得できません");
    });
    test("textが空/文字列以外は例外", async () => {
        const { rt } = setup([webhookEntry], { SLACK_URL: "https://hooks.slack.com/x" });
        await expect(rt.send("")).rejects.toThrow(TypeError);
        await expect(rt.send(123 as any)).rejects.toThrow(TypeError);
    });
    test("登録されたサービスの名前で、クレデンシャルを取得する", async () => {
        const w = setup([webhookEntry], { SLACK_URL: "https://hooks.slack.com/x" });
        await w.rt.send("a");
        expect(w.credCalls).toEqual([["Slack", "Webhook"]]);
        const a = setup([apiEntry], { SLACK_TOKEN: "t", SLACK_CHANNEL: "#c" });
        await a.rt.send("a");
        expect(a.credCalls).toEqual([["Slack", "Slack Web API"]]);
    });
    test("両方登録されている場合は、有効な最初のものを使う（先頭が無効なら次）", async () => {
        const both = setup([{ ...webhookEntry, enabled: false }, apiEntry, webhookEntry], { SLACK_TOKEN: "t", SLACK_CHANNEL: "#c" });
        await both.rt.send("a");
        expect(both.credCalls).toEqual([["Slack", "Slack Web API"]]);
        expect(both.calls[0].url).toBe(SLACK_WEB_API_DEFAULT_URL);
    });
});

describe("vja.slack.send Webhook（サービス: Webhook）", () => {
    const cred = { SLACK_URL: "https://hooks.slack.com/services/T/B/X" };
    test("送信URLへ {text} をJSONでPOSTする", async () => {
        const { rt, calls } = setup([webhookEntry], cred);
        await rt.send("完了しました");
        expect(calls.length).toBe(1);
        expect(calls[0].url).toBe("https://hooks.slack.com/services/T/B/X");
        expect(calls[0].options.method).toBe("POST");
        expect(calls[0].options.headers["Content-Type"]).toBe("application/json");
        expect(JSON.parse(calls[0].options.body)).toEqual({ text: "完了しました" });
    });
    test("channelを指定するとエラー（送信もしない）", async () => {
        const { rt, calls } = setup([webhookEntry], cred);
        await expect(rt.send("a", { channel: "#x" })).rejects.toThrow("チャンネルを変更できません");
        expect(calls.length).toBe(0);
    });
    test("送信URLが未設定ならエラー。送信失敗(HTTPエラー)は状態と本文を含む例外", async () => {
        await expect(setup([webhookEntry], {}).rt.send("a")).rejects.toThrow("送信URL");
        const ng = setup([webhookEntry], cred, { ok: false, status: 404, text: async () => "no_service" });
        await expect(ng.rt.send("a")).rejects.toThrow("404");
        await expect(ng.rt.send("a")).rejects.toThrow("no_service");
    });
});

describe("vja.slack.send Slack Web API（サービス: Slack Web API）", () => {
    const cred = { SLACK_TOKEN: "xoxb-1", SLACK_CHANNEL: "#general" };
    test("既定の送信URL(chat.postMessage)へBearerトークンでPOSTし、既定のチャンネルを使う", async () => {
        const { rt, calls } = setup([apiEntry], cred);
        await rt.send("こんにちは");
        expect(calls[0].url).toBe(SLACK_WEB_API_DEFAULT_URL);
        expect(calls[0].options.headers.Authorization).toBe("Bearer xoxb-1");
        expect(JSON.parse(calls[0].options.body)).toEqual({ channel: "#general", text: "こんにちは" });
    });
    test("送信URLが設定されていれば、そのURLへ送る", async () => {
        const { rt, calls } = setup([apiEntry], { ...cred, SLACK_URL: "https://example.com/slack-proxy" });
        await rt.send("a");
        expect(calls[0].url).toBe("https://example.com/slack-proxy");
    });
    test("options.channelが既定より優先される", async () => {
        const { rt, calls } = setup([apiEntry], cred);
        await rt.send("a", { channel: "#alerts" });
        expect(JSON.parse(calls[0].options.body).channel).toBe("#alerts");
    });
    test("チャンネルが無い/トークンが無い場合はエラー", async () => {
        await expect(setup([apiEntry], { SLACK_TOKEN: "t" }).rt.send("a")).rejects.toThrow("チャンネルがありません");
        await expect(setup([apiEntry], { SLACK_CHANNEL: "#c" }).rt.send("a")).rejects.toThrow("トークンが設定されていません");
    });
    test("HTTP 200でも本文が ok:false ならエラー（error名を含む）", async () => {
        const ng = setup([apiEntry], cred, { ok: true, status: 200, json: async () => ({ ok: false, error: "channel_not_found" }) });
        await expect(ng.rt.send("a")).rejects.toThrow("channel_not_found");
    });
    test("HTTPエラー自体もエラー", async () => {
        const ng = setup([apiEntry], cred, { ok: false, status: 500, json: async () => ({}) });
        await expect(ng.rt.send("a")).rejects.toThrow("500");
    });
});
