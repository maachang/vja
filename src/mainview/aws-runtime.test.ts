// src/mainview/aws-runtime.test.ts
// aws-runtime.ts（vja.aws.s3.*）のユニットテスト。実際のSDK/webviewは使わず、
// 偽のSDK（コマンドの入力を記録するクラス）と偽のクラウド設定・クレデンシャルを注入して検証する。
import { describe, test, expect } from "bun:test";
import { makeAwsS3Runtime } from "./aws-runtime";

// 偽SDK: Commandは入力を保持し、S3Clientは send で記録してから handler の結果を返す
const makeFakeSdk = (handler: (name: string, input: any) => any) => {
    const sent: { name: string; input: any }[] = [];
    const mkCmd = (name: string) => class { input: any; name = name; constructor(input: any) { this.input = input; } };
    const sdk = {
        PutObjectCommand: mkCmd("Put"), GetObjectCommand: mkCmd("Get"),
        ListObjectsV2Command: mkCmd("List"), DeleteObjectCommand: mkCmd("Delete"),
        S3Client: class {
            config: any;
            constructor(config: any) { this.config = config; (sdk as any).lastConfig = config; }
            async send(cmd: any) { sent.push({ name: cmd.name, input: cmd.input }); return handler(cmd.name, cmd.input); }
        },
    } as any;
    return { sdk, sent };
};

const awsEntry = { id: "x", name: "AWS", service: "s3", enabled: true, sdkUrl: "https://cdn.example/s3.js" };
const goodCred = { AWS_ACCESS_KEY_ID: "AK", AWS_SECRET_ACCESS_KEY: "SK", AWS_REGION: "ap-northeast-1" };

const setup = (handler: (n: string, i: any) => any = () => ({}), opts: { infras?: any[]; cred?: any } = {}) => {
    const { sdk, sent } = makeFakeSdk(handler);
    const loaded: string[] = [];
    const rt = makeAwsS3Runtime({
        listCloudInfras: async () => opts.infras ?? [awsEntry],
        getCredential: async () => (opts.cred === undefined ? goodCred : opts.cred),
        loadSdk: async (url: string) => { loaded.push(url); return sdk; },
    });
    return { rt, sent, loaded, sdk };
};

describe("vja.aws.s3 初期化", () => {
    test("クラウド設定のSDK URLを読み込み、クレデンシャル・リージョンでクライアントを作る", async () => {
        const { rt, loaded, sdk } = setup();
        await rt.list("b");
        expect(loaded).toEqual(["https://cdn.example/s3.js"]);
        expect(sdk.lastConfig.region).toBe("ap-northeast-1");
        expect(sdk.lastConfig.credentials).toEqual({ accessKeyId: "AK", secretAccessKey: "SK" });
        expect(sdk.lastConfig.requestChecksumCalculation).toBe("WHEN_REQUIRED");
    });

    test("SDKの読み込みとクライアント生成は初回だけで、以降は使い回す", async () => {
        const { rt, loaded } = setup();
        await rt.list("b"); await rt.list("b"); await rt.delete("b", "k");
        expect(loaded.length).toBe(1);
    });

    test("クラウド設定に無い/無効な場合は、登録を促すエラー", async () => {
        await expect(setup(() => ({}), { infras: [] }).rt.list("b")).rejects.toThrow("登録されていません");
        await expect(setup(() => ({}), { infras: [{ ...awsEntry, enabled: false }] }).rt.list("b")).rejects.toThrow("登録されていません");
    });

    test("クレデンシャルが取れない/リージョンが無い場合は、わかりやすいエラー", async () => {
        await expect(setup(() => ({}), { cred: null }).rt.list("b")).rejects.toThrow("クレデンシャルが取得できません");
        await expect(setup(() => ({}), { cred: { AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b" } }).rt.list("b")).rejects.toThrow("AWS_REGION");
    });

    test("初期化に失敗した後は、次の呼び出しでやり直す", async () => {
        let calls = 0;
        const { sdk } = makeFakeSdk(() => ({}));
        const rt = makeAwsS3Runtime({
            listCloudInfras: async () => { calls++; return calls === 1 ? [] : [awsEntry]; },
            getCredential: async () => goodCred, loadSdk: async () => sdk,
        });
        await expect(rt.list("b")).rejects.toThrow();
        await rt.list("b"); // 2回目は成功する
        expect(calls).toBe(2);
    });
});

describe("vja.aws.s3.put", () => {
    test("文字列はUTF-8テキストとして登録（Content-Type既定）", async () => {
        const { rt, sent } = setup();
        await rt.put("b", "k.txt", "こんにちは");
        expect(sent[0].input).toEqual({ Bucket: "b", Key: "k.txt", Body: "こんにちは", ContentType: "text/plain; charset=utf-8" });
    });
    test("バイナリ（Uint8Array/ArrayBuffer）はそのまま登録。Content-Typeは指定時のみ", async () => {
        const { rt, sent } = setup();
        await rt.put("b", "a.bin", new Uint8Array([0, 255]));
        await rt.put("b", "b.bin", new Uint8Array([1, 2]).buffer, { contentType: "application/x-test" });
        expect(Array.from(sent[0].input.Body)).toEqual([0, 255]);
        expect(sent[0].input.ContentType).toBeUndefined();
        expect(Array.from(sent[1].input.Body)).toEqual([1, 2]);
        expect(sent[1].input.ContentType).toBe("application/x-test");
    });
    test("不正な引数は例外（bucket/key空、bodyの型違い）", async () => {
        const { rt } = setup();
        await expect(rt.put("", "k", "x")).rejects.toThrow(TypeError);
        await expect(rt.put("b", "", "x")).rejects.toThrow(TypeError);
        await expect(rt.put("b", "k", 123 as any)).rejects.toThrow(TypeError);
    });
});

describe("vja.aws.s3.get", () => {
    const bodyOf = (bytes: number[]) => ({ Body: {
        transformToString: async () => new TextDecoder().decode(new Uint8Array(bytes)),
        transformToByteArray: async () => new Uint8Array(bytes),
    } });
    test("既定は文字列、{as:'bytes'}でUint8Array", async () => {
        const { rt } = setup(() => bodyOf([0x68, 0x69]));
        expect(await rt.get("b", "k")).toBe("hi");
        expect(Array.from((await rt.get("b", "k", { as: "bytes" })) as Uint8Array)).toEqual([0x68, 0x69]);
    });
    test("キーが存在しない(NoSuchKey/404)場合はnull。それ以外のエラーは再送出", async () => {
        const nf = setup(() => { throw Object.assign(new Error("x"), { name: "NoSuchKey" }); });
        expect(await nf.rt.get("b", "k")).toBeNull();
        const nf404 = setup(() => { throw Object.assign(new Error("x"), { $metadata: { httpStatusCode: 404 } }); });
        expect(await nf404.rt.get("b", "k")).toBeNull();
        const denied = setup(() => { throw Object.assign(new Error("denied"), { name: "AccessDenied" }); });
        await expect(denied.rt.get("b", "k")).rejects.toThrow("denied");
    });
});

describe("vja.aws.s3.list", () => {
    test("{key,size,lastModified(ISO)}の配列で返し、prefixを渡す", async () => {
        const { rt, sent } = setup(() => ({ Contents: [{ Key: "a/1", Size: 3, LastModified: new Date("2026-10-05T00:00:00Z") }, { Key: "a/2" }] }));
        const items = await rt.list("b", { prefix: "a/" });
        expect(items).toEqual([
            { key: "a/1", size: 3, lastModified: "2026-10-05T00:00:00.000Z" },
            { key: "a/2", size: 0, lastModified: "" },
        ]);
        expect(sent[0].input.Prefix).toBe("a/");
    });
    test("空のバケットは空配列", async () => {
        expect(await setup(() => ({})).rt.list("b")).toEqual([]);
    });
    test("1000件を超える場合は続きを取得し、maxKeysで打ち切る", async () => {
        let page = 0;
        // 本物のS3と同じく、要求されたMaxKeys件までしか返さない偽の応答（1ページ最大2件）
        const { rt, sent } = setup((_n, input) => {
            page++;
            const all = [{ Key: "k" + page + "-1" }, { Key: "k" + page + "-2" }];
            return { Contents: all.slice(0, input.MaxKeys), IsTruncated: true, NextContinuationToken: "t" + page };
        });
        const items = await rt.list("b", { maxKeys: 5 });
        expect(items.length).toBe(5);
        expect(sent.length).toBe(3);
        expect(sent[1].input.ContinuationToken).toBe("t1");
        expect(sent[2].input.MaxKeys).toBe(1); // 残り1件だけ要求する
    });
});

describe("vja.aws.s3.delete", () => {
    test("DeleteObjectを呼ぶ。空のbucket/keyは例外", async () => {
        const { rt, sent } = setup();
        await rt.delete("b", "k");
        expect(sent[0]).toEqual({ name: "Delete", input: { Bucket: "b", Key: "k" } });
        await expect(rt.delete("b", "")).rejects.toThrow(TypeError);
    });
});
