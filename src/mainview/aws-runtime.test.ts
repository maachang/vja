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

// ════════════════════════════════════════════════
// S3以外のサービス
// ════════════════════════════════════════════════
import {
    makeAwsDynamoDbRuntime, makeAwsSqsRuntime, makeAwsSnsRuntime, makeAwsLambdaRuntime,
    makeAwsSesRuntime, makeAwsStsRuntime, makeAwsSecretsManagerRuntime, makeAwsCloudWatchRuntime,
    makeAwsRuntimes, ddbMarshal, ddbUnmarshal, ddbMarshalValue,
} from "./aws-runtime";

// 汎用の偽SDK: clientName のクライアントと、名前が Command で終わるクラスを何でも返す
const makeSvcSdk = (clientName: string, handler: (name: string, input: any) => any) => {
    const sent: { name: string; input: any }[] = [];
    const classes = new Map<string, any>();
    const state: any = { lastConfig: null };
    const sdk: any = new Proxy({}, {
        get(_t, prop: string) {
            if (prop === "lastConfig") return state.lastConfig;
            if (prop === clientName) {
                return class { constructor(c: any) { state.lastConfig = c; } async send(cmd: any) { sent.push({ name: cmd.cmdName, input: cmd.input }); return handler(cmd.cmdName, cmd.input); } };
            }
            if (typeof prop === "string" && prop.endsWith("Command")) {
                if (!classes.has(prop)) classes.set(prop, class { cmdName = prop; input: any; constructor(i: any) { this.input = i; } });
                return classes.get(prop);
            }
            return undefined;
        },
    });
    return { sdk, sent };
};
const svcSetup = (service: string, clientName: string, handler: (n: string, i: any) => any = () => ({})) => {
    const { sdk, sent } = makeSvcSdk(clientName, handler);
    const deps = {
        listCloudInfras: async () => [{ id: "x", name: "AWS", service, enabled: true, sdkUrl: "https://cdn.example/" + service + ".js" }],
        getCredential: async () => goodCred,
        loadSdk: async () => sdk,
    };
    return { deps, sent, sdk };
};

describe("DynamoDB の変換（普通のJSオブジェクト ⇄ DynamoDB形式）", () => {
    test("文字列/数値/真偽/null/配列/入れ子オブジェクト/バイナリ/日付を変換し、undefinedは省く", () => {
        const m = ddbMarshal({ s: "a", n: 1.5, b: true, z: null, u: undefined, l: [1, "x"], o: { k: "v" }, bin: new Uint8Array([1]), d: new Date("2026-10-05T00:00:00Z") });
        expect(m.s).toEqual({ S: "a" });
        expect(m.n).toEqual({ N: "1.5" });
        expect(m.b).toEqual({ BOOL: true });
        expect(m.z).toEqual({ NULL: true });
        expect("u" in m).toBe(false);
        expect(m.l).toEqual({ L: [{ N: "1" }, { S: "x" }] });
        expect(m.o).toEqual({ M: { k: { S: "v" } } });
        expect(m.bin).toEqual({ B: new Uint8Array([1]) });
        expect(m.d).toEqual({ S: "2026-10-05T00:00:00.000Z" });
    });
    test("往復で元の値に戻る（日本語、入れ子、配列）", () => {
        const src = { id: "u1", name: "山田", age: 30, tags: ["a", "b"], addr: { city: "東京", zip: "100" }, ok: false, none: null };
        expect(ddbUnmarshal(ddbMarshal(src))).toEqual(src);
    });
    test("読み取り専用の形式（セットSS/NS/BS）も配列で返す", () => {
        expect(ddbUnmarshal({ a: { SS: ["x", "y"] }, b: { NS: ["1", "2"] } })).toEqual({ a: ["x", "y"], b: [1, 2] });
    });
    test("保存できない型は例外", () => {
        expect(() => ddbMarshalValue(() => 1)).toThrow(TypeError);
    });
});

describe("vja.aws.dynamodb", () => {
    test("get: キーを変換して取得し、存在しなければnull", async () => {
        const a = svcSetup("dynamodb", "DynamoDBClient", () => ({ Item: { id: { S: "u1" }, age: { N: "30" } } }));
        expect(await makeAwsDynamoDbRuntime(a.deps).get("users", { id: "u1" })).toEqual({ id: "u1", age: 30 });
        expect(a.sent[0].input).toEqual({ TableName: "users", Key: { id: { S: "u1" } } });
        const b = svcSetup("dynamodb", "DynamoDBClient", () => ({}));
        expect(await makeAwsDynamoDbRuntime(b.deps).get("users", { id: "x" })).toBeNull();
    });
    test("put/delete: 普通のオブジェクトを渡せる", async () => {
        const a = svcSetup("dynamodb", "DynamoDBClient");
        const rt = makeAwsDynamoDbRuntime(a.deps);
        await rt.put("users", { id: "u1", name: "山田" });
        await rt.delete("users", { id: "u1" });
        expect(a.sent[0].input).toEqual({ TableName: "users", Item: { id: { S: "u1" }, name: { S: "山田" } } });
        expect(a.sent[1].input).toEqual({ TableName: "users", Key: { id: { S: "u1" } } });
    });
    test("query: パーティションキーの一致検索（インデックス指定可）、limitで打ち切り、続きを取得", async () => {
        let page = 0;
        const a = svcSetup("dynamodb", "DynamoDBClient", (_n, input) => {
            page++;
            const items = [{ id: { S: "a" + page } }, { id: { S: "b" + page } }].slice(0, input.Limit);
            return { Items: items, LastEvaluatedKey: { id: { S: "k" + page } } };
        });
        const rows = await makeAwsDynamoDbRuntime(a.deps).query("orders", "userId", "u1", { index: "idx", limit: 3 });
        expect(rows.length).toBe(3);
        expect(a.sent[0].input).toMatchObject({
            TableName: "orders", IndexName: "idx", KeyConditionExpression: "#k = :v",
            ExpressionAttributeNames: { "#k": "userId" }, ExpressionAttributeValues: { ":v": { S: "u1" } }, Limit: 3,
        });
        expect(a.sent[1].input.ExclusiveStartKey).toEqual({ id: { S: "k1" } });
        expect(a.sent[1].input.Limit).toBe(1);
    });
    test("scan: 既定limit100で、結果を普通のオブジェクトで返す", async () => {
        const a = svcSetup("dynamodb", "DynamoDBClient", () => ({ Items: [{ id: { S: "a" } }] }));
        expect(await makeAwsDynamoDbRuntime(a.deps).scan("users")).toEqual([{ id: "a" }]);
        expect(a.sent[0].input.Limit).toBe(100);
    });
});

describe("vja.aws.sqs", () => {
    test("send: メッセージIDを返す。文字列以外のbodyは例外", async () => {
        const a = svcSetup("sqs", "SQSClient", () => ({ MessageId: "m1" }));
        const rt = makeAwsSqsRuntime(a.deps);
        expect(await rt.send("https://q", "hello")).toBe("m1");
        expect(a.sent[0].input).toEqual({ QueueUrl: "https://q", MessageBody: "hello" });
        await expect(rt.send("https://q", { a: 1 } as any)).rejects.toThrow(TypeError);
    });
    test("receive: {id,body,receiptHandle}で返し、max/waitSecondsを範囲内に丸める", async () => {
        const a = svcSetup("sqs", "SQSClient", () => ({ Messages: [{ MessageId: "m1", Body: "b", ReceiptHandle: "r1" }] }));
        const rt = makeAwsSqsRuntime(a.deps);
        expect(await rt.receive("https://q")).toEqual([{ id: "m1", body: "b", receiptHandle: "r1" }]);
        await rt.receive("https://q", { max: 99, waitSeconds: 99 });
        expect(a.sent[0].input).toMatchObject({ MaxNumberOfMessages: 1, WaitTimeSeconds: 0 });
        expect(a.sent[1].input).toMatchObject({ MaxNumberOfMessages: 10, WaitTimeSeconds: 20 });
        const empty = svcSetup("sqs", "SQSClient", () => ({}));
        expect(await makeAwsSqsRuntime(empty.deps).receive("https://q")).toEqual([]);
    });
    test("delete: receiptHandleを渡す", async () => {
        const a = svcSetup("sqs", "SQSClient");
        await makeAwsSqsRuntime(a.deps).delete("https://q", "r1");
        expect(a.sent[0].input).toEqual({ QueueUrl: "https://q", ReceiptHandle: "r1" });
    });
});

describe("vja.aws.sns", () => {
    test("publish: メッセージIDを返し、subjectを渡す", async () => {
        const a = svcSetup("sns", "SNSClient", () => ({ MessageId: "m1" }));
        const rt = makeAwsSnsRuntime(a.deps);
        expect(await rt.publish("arn:t", "完了", { subject: "通知" })).toBe("m1");
        expect(a.sent[0].input).toEqual({ TopicArn: "arn:t", Message: "完了", Subject: "通知" });
        await expect(rt.publish("arn:t", "")).rejects.toThrow(TypeError);
    });
});

describe("vja.aws.lambda", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    test("invoke: payloadをJSONで送り、結果がJSONならオブジェクト、でなければ文字列", async () => {
        const a = svcSetup("lambda", "LambdaClient", () => ({ Payload: enc('{"ok":true}') }));
        const rt = makeAwsLambdaRuntime(a.deps);
        expect(await rt.invoke("f", { name: "山田" })).toEqual({ ok: true });
        expect(new TextDecoder().decode(a.sent[0].input.Payload)).toBe('{"name":"山田"}');
        const b = svcSetup("lambda", "LambdaClient", () => ({ Payload: enc("plain text") }));
        expect(await makeAwsLambdaRuntime(b.deps).invoke("f")).toBe("plain text");
        expect(b.sent[0].input.Payload).toBeUndefined();
    });
    test("関数内エラー(FunctionError)は例外", async () => {
        const a = svcSetup("lambda", "LambdaClient", () => ({ FunctionError: "Unhandled", Payload: enc('{"errorMessage":"boom"}') }));
        await expect(makeAwsLambdaRuntime(a.deps).invoke("f")).rejects.toThrow("boom");
    });
});

describe("vja.aws.ses", () => {
    test("sendEmail: 本文(text/html)と宛先を組み立て、メッセージIDを返す", async () => {
        const a = svcSetup("ses", "SESv2Client", () => ({ MessageId: "m1" }));
        const rt = makeAwsSesRuntime(a.deps);
        expect(await rt.sendEmail({ from: "f@e.com", to: ["a@e.com", "b@e.com"], cc: "c@e.com", subject: "件名", text: "本文", html: "<b>本文</b>" })).toBe("m1");
        expect(a.sent[0].input).toEqual({
            FromEmailAddress: "f@e.com",
            Destination: { ToAddresses: ["a@e.com", "b@e.com"], CcAddresses: ["c@e.com"], BccAddresses: undefined },
            Content: { Simple: { Subject: { Data: "件名", Charset: "UTF-8" }, Body: { Text: { Data: "本文", Charset: "UTF-8" }, Html: { Data: "<b>本文</b>", Charset: "UTF-8" } } } },
        });
    });
    test("toが文字列でも送れる。不足した引数は例外", async () => {
        const a = svcSetup("ses", "SESv2Client", () => ({ MessageId: "m" }));
        const rt = makeAwsSesRuntime(a.deps);
        await rt.sendEmail({ from: "f@e.com", to: "a@e.com", subject: "s", text: "t" });
        expect(a.sent[0].input.Destination.ToAddresses).toEqual(["a@e.com"]);
        await expect(rt.sendEmail({ from: "f@e.com", to: [], subject: "s", text: "t" })).rejects.toThrow(TypeError);
        await expect(rt.sendEmail({ from: "f@e.com", to: "a@e.com", subject: "s" })).rejects.toThrow(TypeError);
        await expect(rt.sendEmail({ from: "", to: "a@e.com", subject: "s", text: "t" })).rejects.toThrow(TypeError);
    });
});

describe("vja.aws.sts / secretsmanager", () => {
    test("sts.getCallerIdentity: {account,arn,userId}", async () => {
        const a = svcSetup("sts", "STSClient", () => ({ Account: "123", Arn: "arn:u", UserId: "AID" }));
        expect(await makeAwsStsRuntime(a.deps).getCallerIdentity()).toEqual({ account: "123", arn: "arn:u", userId: "AID" });
    });
    test("secretsmanager.getSecret: 文字列を返す。バイナリはUTF-8、値が無ければ例外", async () => {
        const a = svcSetup("secretsmanager", "SecretsManagerClient", () => ({ SecretString: '{"k":"v"}' }));
        expect(await makeAwsSecretsManagerRuntime(a.deps).getSecret("s")).toBe('{"k":"v"}');
        expect(a.sent[0].input).toEqual({ SecretId: "s" });
        const b = svcSetup("secretsmanager", "SecretsManagerClient", () => ({ SecretBinary: new TextEncoder().encode("秘密") }));
        expect(await makeAwsSecretsManagerRuntime(b.deps).getSecret("s")).toBe("秘密");
        const c = svcSetup("secretsmanager", "SecretsManagerClient", () => ({}));
        await expect(makeAwsSecretsManagerRuntime(c.deps).getSecret("s")).rejects.toThrow("値がありません");
    });
});

describe("vja.aws.cloudwatch", () => {
    test("putLog: 1行書き込む", async () => {
        const a = svcSetup("cloudwatch", "CloudWatchLogsClient");
        await makeAwsCloudWatchRuntime(a.deps).putLog("/vja/app", "main", "開始");
        expect(a.sent.length).toBe(1);
        expect(a.sent[0].input.logGroupName).toBe("/vja/app");
        expect(a.sent[0].input.logStreamName).toBe("main");
        expect(a.sent[0].input.logEvents[0].message).toBe("開始");
        expect(typeof a.sent[0].input.logEvents[0].timestamp).toBe("number");
    });
    test("ログストリームが無ければ作ってやり直す。作成も失敗(グループ無し)なら例外", async () => {
        let n = 0;
        const a = svcSetup("cloudwatch", "CloudWatchLogsClient", (name) => {
            if (name === "PutLogEventsCommand" && n++ === 0) throw Object.assign(new Error("x"), { name: "ResourceNotFoundException" });
            return {};
        });
        await makeAwsCloudWatchRuntime(a.deps).putLog("g", "s", "m");
        expect(a.sent.map(s => s.name)).toEqual(["PutLogEventsCommand", "CreateLogStreamCommand", "PutLogEventsCommand"]);
        const b = svcSetup("cloudwatch", "CloudWatchLogsClient", () => { throw Object.assign(new Error("no group"), { name: "ResourceNotFoundException" }); });
        await expect(makeAwsCloudWatchRuntime(b.deps).putLog("g", "s", "m")).rejects.toThrow("no group");
        const c = svcSetup("cloudwatch", "CloudWatchLogsClient", () => { throw Object.assign(new Error("denied"), { name: "AccessDeniedException" }); });
        await expect(makeAwsCloudWatchRuntime(c.deps).putLog("g", "s", "m")).rejects.toThrow("denied");
    });
});

describe("makeAwsRuntimes / サービス共通の初期化", () => {
    test("全サービスの名前空間が揃っている（Cognitoは含まない）", () => {
        const { deps } = svcSetup("s3", "S3Client");
        const rts: any = makeAwsRuntimes(deps);
        expect(Object.keys(rts).sort()).toEqual(["cloudwatch", "dynamodb", "lambda", "s3", "secretsmanager", "ses", "sns", "sqs", "sts"]);
        expect("cognito" in rts).toBe(false);
    });
    test("サービスごとに、そのサービスのクラウド設定を使う（別サービスの設定は使わない）", async () => {
        const { sdk } = makeSvcSdk("SQSClient", () => ({}));
        const loaded: string[] = [];
        const rts = makeAwsRuntimes({
            listCloudInfras: async () => [{ id: "a", name: "AWS", service: "s3", enabled: true, sdkUrl: "s3-url" }],
            getCredential: async () => goodCred,
            loadSdk: async (u: string) => { loaded.push(u); return sdk; },
        });
        await expect(rts.sqs.delete("https://q", "r")).rejects.toThrow("AWS の sqs が登録されていません");
        expect(loaded).toEqual([]);
    });
});
