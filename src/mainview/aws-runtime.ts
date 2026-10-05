// src/mainview/aws-runtime.ts
// vja.aws.* ランタイム（クラウド設定に登録したAWSサービスを、イベントから簡単に使うための関数群）。
// webview内で、クラウド設定に登録したSDKのURL（CDN）からAWS SDK v3を読み込んで実行する。
// 通信はwebviewのfetchで行われるが、AWS宛ては project-bridge.ts の makeFetchProxy により
// vja.fetch（Bun経由）へ自動で差し替わるため、バケット側などのCORS設定は不要。
//
// 依存（クラウド設定の取得・クレデンシャル取得・SDK読み込み）は引数で注入する
// （単体テストでSDKやwebviewを使わずに検証できるようにするため）。
//
// 対応サービス: s3 / dynamodb / sqs / sns / lambda / ses(sesv2) / sts / secretsmanager / cloudwatch(logs)。
// Cognitoは、認証まわりでクライアント側に面倒な実装が必要なため対象外（クラウド設定の定義からも外している）。

export type AwsRuntimeDeps = {
    // クラウド設定（vja.cloud.list）。サービス定義（sdkUrl等）の取得に使う
    listCloudInfras: () => Promise<any[]>;
    // クレデンシャル取得（vja.getCloudInfraCredential）。AWS_ACCESS_KEY_ID等のキーのオブジェクト、無ければnull
    getCredential: (infra: string, service: string) => Promise<Record<string, string> | null>;
    // SDKのモジュール読み込み（import(url)）
    loadSdk: (url: string) => Promise<any>;
};

const _need = (v: any, name: string): void => {
    if (typeof v !== "string" || v === "") throw new TypeError(`${name} は空でない文字列で指定してください`);
};

// ── サービス共通: SDKの読み込みとクライアント生成（初回だけ行って使い回す。失敗した場合は次回やり直す） ──
// service: クラウド設定のサービス名（s3 等）、clientName: SDKのクライアントクラス名（S3Client 等）
const _makeLoader = (deps: AwsRuntimeDeps, service: string, clientName: string) => {
    let cached: Promise<{ sdk: any; client: any }> | null = null;
    return (): Promise<{ sdk: any; client: any }> => {
        if (cached) return cached;
        cached = (async () => {
            const infras = await deps.listCloudInfras();
            const entry = (infras || []).find((i: any) =>
                i.enabled && String(i.name || "").toLowerCase() === "aws" && String(i.service || "").toLowerCase() === service);
            if (!entry) throw new Error(`クラウド設定に AWS の ${service} が登録されていません（クラウド設定で登録して、有効にしてください）`);
            if (!entry.sdkUrl) throw new Error(`クラウド設定の AWS ${service} に SDK の URL が設定されていません`);
            const cred = await deps.getCredential("AWS", service);
            if (!cred || !cred.AWS_ACCESS_KEY_ID || !cred.AWS_SECRET_ACCESS_KEY) {
                throw new Error(`AWS ${service} のクレデンシャルが取得できません（クラウド設定でアクセスキーとシークレットを入れ直して保存してください）`);
            }
            if (!cred.AWS_REGION) throw new Error(`AWS ${service} のリージョン（AWS_REGION）が設定されていません`);
            const sdk = await deps.loadSdk(entry.sdkUrl);
            const client = new sdk[clientName]({
                region: cred.AWS_REGION,
                credentials: { accessKeyId: cred.AWS_ACCESS_KEY_ID, secretAccessKey: cred.AWS_SECRET_ACCESS_KEY },
                // 追加のチェックサム計算（ストリーム/トレーラー）を避ける。実機で動作確認済みの設定
                requestChecksumCalculation: "WHEN_REQUIRED",
                responseChecksumValidation: "WHEN_REQUIRED",
            });
            return { sdk, client };
        })();
        cached.catch(() => { cached = null; });
        return cached;
    };
};

// ════════════════════════════════════════════════
// S3
// ════════════════════════════════════════════════

// 本文（文字列/Uint8Array/ArrayBuffer）をS3へ渡せる形にする。文字列はUTF-8のまま渡す
const _toBody = (body: any): string | Uint8Array => {
    if (typeof body === "string" || body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    throw new TypeError("body は文字列、Uint8Array、ArrayBuffer のいずれかで指定してください");
};

// S3のオブジェクトが存在しない場合のエラー判定
const _isNotFound = (e: any): boolean =>
    e?.name === "NoSuchKey" || e?.Code === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;

export const makeAwsS3Runtime = (deps: AwsRuntimeDeps) => {
    const ready = _makeLoader(deps, "s3", "S3Client");
    return {
        // 登録。本文は文字列（UTF-8）またはバイナリ。戻り値なし
        put: async (bucket: string, key: string, body: any, options: { contentType?: string } = {}): Promise<void> => {
            _need(bucket, "bucket"); _need(key, "key");
            const { sdk, client } = await ready();
            const isText = typeof body === "string";
            await client.send(new sdk.PutObjectCommand({
                Bucket: bucket, Key: key, Body: _toBody(body),
                ContentType: options.contentType ?? (isText ? "text/plain; charset=utf-8" : undefined),
            }));
        },

        // 取得。既定は文字列。{ as: 'bytes' } で Uint8Array。キーが存在しない場合は null
        get: async (bucket: string, key: string, options: { as?: "text" | "bytes" } = {}): Promise<string | Uint8Array | null> => {
            _need(bucket, "bucket"); _need(key, "key");
            const { sdk, client } = await ready();
            try {
                const res = await client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }));
                return options.as === "bytes" ? await res.Body.transformToByteArray() : await res.Body.transformToString();
            } catch (e: any) {
                if (_isNotFound(e)) return null;
                throw e;
            }
        },

        // 一覧。{ prefix, maxKeys（既定1000） }。[{ key, size, lastModified(ISO文字列) }]
        list: async (bucket: string, options: { prefix?: string; maxKeys?: number } = {}): Promise<{ key: string; size: number; lastModified: string }[]> => {
            _need(bucket, "bucket");
            const { sdk, client } = await ready();
            const maxKeys = options.maxKeys && options.maxKeys > 0 ? options.maxKeys : 1000;
            const out: { key: string; size: number; lastModified: string }[] = [];
            let token: string | undefined = undefined;
            while (out.length < maxKeys) {
                const res: any = await client.send(new sdk.ListObjectsV2Command({
                    Bucket: bucket, Prefix: options.prefix || undefined,
                    MaxKeys: Math.min(1000, maxKeys - out.length), ContinuationToken: token,
                }));
                for (const c of (res.Contents || [])) {
                    out.push({
                        key: c.Key, size: c.Size ?? 0,
                        lastModified: c.LastModified ? new Date(c.LastModified).toISOString() : "",
                    });
                }
                if (!res.IsTruncated || !res.NextContinuationToken) break;
                token = res.NextContinuationToken;
            }
            return out;
        },

        // 削除。戻り値なし（存在しないキーを指定してもエラーにならない＝S3の仕様）
        delete: async (bucket: string, key: string): Promise<void> => {
            _need(bucket, "bucket"); _need(key, "key");
            const { sdk, client } = await ready();
            await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: key }));
        },
    };
};

// ════════════════════════════════════════════════
// DynamoDB（普通のJSオブジェクトで読み書きできるよう、DynamoDB独自の形式との変換を行う）
// ════════════════════════════════════════════════

// JSの値 → DynamoDBの属性値。undefinedはオブジェクトのキーごと省く（DynamoDBはundefinedを扱えないため）
export const ddbMarshalValue = (v: any): any => {
    if (v === null || v === undefined) return { NULL: true };
    if (typeof v === "string") return { S: v };
    if (typeof v === "number") return { N: String(v) };
    if (typeof v === "boolean") return { BOOL: v };
    if (v instanceof Uint8Array) return { B: v };
    if (v instanceof ArrayBuffer) return { B: new Uint8Array(v) };
    if (v instanceof Date) return { S: v.toISOString() };
    if (Array.isArray(v)) return { L: v.map(ddbMarshalValue) };
    if (typeof v === "object") return { M: ddbMarshal(v) };
    throw new TypeError("DynamoDBに保存できない型の値です: " + typeof v);
};
export const ddbMarshal = (obj: Record<string, any>): Record<string, any> => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj || {})) {
        if (v !== undefined) out[k] = ddbMarshalValue(v);
    }
    return out;
};

// DynamoDBの属性値 → JSの値。数値はNumber、セット(SS/NS/BS)は配列、バイナリはUint8Array
export const ddbUnmarshalValue = (a: any): any => {
    if (a === null || a === undefined) return null;
    if ("S" in a) return a.S;
    if ("N" in a) return Number(a.N);
    if ("BOOL" in a) return a.BOOL;
    if ("NULL" in a) return null;
    if ("B" in a) return a.B;
    if ("L" in a) return a.L.map(ddbUnmarshalValue);
    if ("M" in a) return ddbUnmarshal(a.M);
    if ("SS" in a) return [...a.SS];
    if ("NS" in a) return a.NS.map(Number);
    if ("BS" in a) return [...a.BS];
    throw new TypeError("未対応のDynamoDB属性値です");
};
export const ddbUnmarshal = (item: Record<string, any>): Record<string, any> => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(item || {})) out[k] = ddbUnmarshalValue(v);
    return out;
};

export const makeAwsDynamoDbRuntime = (deps: AwsRuntimeDeps) => {
    const ready = _makeLoader(deps, "dynamodb", "DynamoDBClient");
    // query/scan共通: 1ページずつ取得して、limit件で打ち切る
    const collect = async (client: any, makeCmd: (token: any, remain: number) => any, limit: number): Promise<any[]> => {
        const out: any[] = [];
        let token: any = undefined;
        while (out.length < limit) {
            const res: any = await client.send(makeCmd(token, limit - out.length));
            for (const it of (res.Items || [])) out.push(ddbUnmarshal(it));
            if (!res.LastEvaluatedKey) break;
            token = res.LastEvaluatedKey;
        }
        return out.slice(0, limit);
    };
    return {
        // 取得（プライマリキーの完全一致）。存在しなければ null
        get: async (table: string, key: Record<string, any>): Promise<Record<string, any> | null> => {
            _need(table, "table");
            const { sdk, client } = await ready();
            const res = await client.send(new sdk.GetItemCommand({ TableName: table, Key: ddbMarshal(key) }));
            return res.Item ? ddbUnmarshal(res.Item) : null;
        },
        // 登録（同じキーがあれば置き換え）。戻り値なし
        put: async (table: string, item: Record<string, any>): Promise<void> => {
            _need(table, "table");
            const { sdk, client } = await ready();
            await client.send(new sdk.PutItemCommand({ TableName: table, Item: ddbMarshal(item) }));
        },
        // 削除（プライマリキーの完全一致）。戻り値なし
        delete: async (table: string, key: Record<string, any>): Promise<void> => {
            _need(table, "table");
            const { sdk, client } = await ready();
            await client.send(new sdk.DeleteItemCommand({ TableName: table, Key: ddbMarshal(key) }));
        },
        // 検索（パーティションキーの一致検索のみ）。options: { index（インデックス名）, limit（既定100） }
        query: async (table: string, keyName: string, keyValue: any, options: { index?: string; limit?: number } = {}): Promise<Record<string, any>[]> => {
            _need(table, "table"); _need(keyName, "keyName");
            const { sdk, client } = await ready();
            const limit = options.limit && options.limit > 0 ? options.limit : 100;
            return collect(client, (token, remain) => new sdk.QueryCommand({
                TableName: table, IndexName: options.index || undefined,
                KeyConditionExpression: "#k = :v",
                ExpressionAttributeNames: { "#k": keyName },
                ExpressionAttributeValues: { ":v": ddbMarshalValue(keyValue) },
                Limit: remain, ExclusiveStartKey: token,
            }), limit);
        },
        // 全件走査。options: { limit（既定100） }。件数が多いテーブルでは時間と費用がかかるため、limitで絞ること
        scan: async (table: string, options: { limit?: number } = {}): Promise<Record<string, any>[]> => {
            _need(table, "table");
            const { sdk, client } = await ready();
            const limit = options.limit && options.limit > 0 ? options.limit : 100;
            return collect(client, (token, remain) => new sdk.ScanCommand({
                TableName: table, Limit: remain, ExclusiveStartKey: token,
            }), limit);
        },
    };
};

// ════════════════════════════════════════════════
// SQS
// ════════════════════════════════════════════════
export const makeAwsSqsRuntime = (deps: AwsRuntimeDeps) => {
    const ready = _makeLoader(deps, "sqs", "SQSClient");
    return {
        // 送信。メッセージIDを返す
        send: async (queueUrl: string, body: string): Promise<string> => {
            _need(queueUrl, "queueUrl");
            if (typeof body !== "string") throw new TypeError("body は文字列で指定してください（オブジェクトは JSON.stringify で文字列にする）");
            const { sdk, client } = await ready();
            const res = await client.send(new sdk.SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));
            return res.MessageId;
        },
        // 受信。options: { max（1〜10、既定1）, waitSeconds（0〜20、既定0） }。[{ id, body, receiptHandle }]
        // 処理が終わったメッセージは delete で削除する（削除しないと、一定時間後に再び受信される）
        receive: async (queueUrl: string, options: { max?: number; waitSeconds?: number } = {}): Promise<{ id: string; body: string; receiptHandle: string }[]> => {
            _need(queueUrl, "queueUrl");
            const { sdk, client } = await ready();
            const res = await client.send(new sdk.ReceiveMessageCommand({
                QueueUrl: queueUrl,
                MaxNumberOfMessages: Math.min(10, Math.max(1, options.max || 1)),
                WaitTimeSeconds: Math.min(20, Math.max(0, options.waitSeconds || 0)),
            }));
            return (res.Messages || []).map((m: any) => ({ id: m.MessageId, body: m.Body, receiptHandle: m.ReceiptHandle }));
        },
        // 削除（受信したメッセージの receiptHandle を指定）。戻り値なし
        delete: async (queueUrl: string, receiptHandle: string): Promise<void> => {
            _need(queueUrl, "queueUrl"); _need(receiptHandle, "receiptHandle");
            const { sdk, client } = await ready();
            await client.send(new sdk.DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
        },
    };
};

// ════════════════════════════════════════════════
// SNS
// ════════════════════════════════════════════════
export const makeAwsSnsRuntime = (deps: AwsRuntimeDeps) => {
    const ready = _makeLoader(deps, "sns", "SNSClient");
    return {
        // 発行。options: { subject }。メッセージIDを返す
        publish: async (topicArn: string, message: string, options: { subject?: string } = {}): Promise<string> => {
            _need(topicArn, "topicArn"); _need(message, "message");
            const { sdk, client } = await ready();
            const res = await client.send(new sdk.PublishCommand({ TopicArn: topicArn, Message: message, Subject: options.subject || undefined }));
            return res.MessageId;
        },
    };
};

// ════════════════════════════════════════════════
// Lambda
// ════════════════════════════════════════════════
export const makeAwsLambdaRuntime = (deps: AwsRuntimeDeps) => {
    const ready = _makeLoader(deps, "lambda", "LambdaClient");
    return {
        // 同期呼び出し。payload は JSON.stringify して渡す（省略可）。結果はJSONならオブジェクトに変換して返し、
        // JSONでなければ文字列で返す。関数内でエラーになった場合は例外
        invoke: async (functionName: string, payload?: any): Promise<any> => {
            _need(functionName, "functionName");
            const { sdk, client } = await ready();
            const res = await client.send(new sdk.InvokeCommand({
                FunctionName: functionName,
                Payload: payload === undefined ? undefined : new TextEncoder().encode(JSON.stringify(payload)),
            }));
            const text = res.Payload ? new TextDecoder().decode(res.Payload) : "";
            if (res.FunctionError) throw new Error("Lambda関数内でエラーが発生しました: " + (text || res.FunctionError));
            if (text === "") return null;
            try { return JSON.parse(text); } catch { return text; }
        },
    };
};

// ════════════════════════════════════════════════
// SES（SES v2）
// ════════════════════════════════════════════════
export const makeAwsSesRuntime = (deps: AwsRuntimeDeps) => {
    const ready = _makeLoader(deps, "ses", "SESv2Client");
    const toList = (v: any): string[] | undefined => v === undefined || v === null || v === "" ? undefined : (Array.isArray(v) ? v : [v]);
    return {
        // メール送信。{ from, to, subject, text, html?, cc?, bcc? }。to/cc/bccは文字列または配列。メッセージIDを返す
        // from は SES で確認済み（検証済み）のメールアドレスまたはドメインであること
        sendEmail: async (mail: { from: string; to: string | string[]; subject: string; text?: string; html?: string; cc?: string | string[]; bcc?: string | string[] }): Promise<string> => {
            _need(mail?.from, "from"); _need(mail?.subject, "subject");
            const to = toList(mail.to);
            if (!to || to.length === 0) throw new TypeError("to は空でない文字列または配列で指定してください");
            if (!mail.text && !mail.html) throw new TypeError("text または html のどちらかを指定してください");
            const { sdk, client } = await ready();
            const body: any = {};
            if (mail.text) body.Text = { Data: mail.text, Charset: "UTF-8" };
            if (mail.html) body.Html = { Data: mail.html, Charset: "UTF-8" };
            const res = await client.send(new sdk.SendEmailCommand({
                FromEmailAddress: mail.from,
                Destination: { ToAddresses: to, CcAddresses: toList(mail.cc), BccAddresses: toList(mail.bcc) },
                Content: { Simple: { Subject: { Data: mail.subject, Charset: "UTF-8" }, Body: body } },
            }));
            return res.MessageId;
        },
    };
};

// ════════════════════════════════════════════════
// STS
// ════════════════════════════════════════════════
export const makeAwsStsRuntime = (deps: AwsRuntimeDeps) => {
    const ready = _makeLoader(deps, "sts", "STSClient");
    return {
        // 今使っているクレデンシャルの持ち主を確認する（接続・認証の確認に使える）
        getCallerIdentity: async (): Promise<{ account: string; arn: string; userId: string }> => {
            const { sdk, client } = await ready();
            const res = await client.send(new sdk.GetCallerIdentityCommand({}));
            return { account: res.Account, arn: res.Arn, userId: res.UserId };
        },
    };
};

// ════════════════════════════════════════════════
// Secrets Manager
// ════════════════════════════════════════════════
export const makeAwsSecretsManagerRuntime = (deps: AwsRuntimeDeps) => {
    const ready = _makeLoader(deps, "secretsmanager", "SecretsManagerClient");
    return {
        // シークレットの値を文字列で取得する（JSONで保存した値は JSON.parse で変換する）。バイナリのシークレットはUTF-8として文字列にする
        getSecret: async (secretId: string): Promise<string> => {
            _need(secretId, "secretId");
            const { sdk, client } = await ready();
            const res = await client.send(new sdk.GetSecretValueCommand({ SecretId: secretId }));
            if (typeof res.SecretString === "string") return res.SecretString;
            if (res.SecretBinary) return new TextDecoder().decode(res.SecretBinary);
            throw new Error("シークレットに値がありません: " + secretId);
        },
    };
};

// ════════════════════════════════════════════════
// CloudWatch Logs
// ════════════════════════════════════════════════
export const makeAwsCloudWatchRuntime = (deps: AwsRuntimeDeps) => {
    const ready = _makeLoader(deps, "cloudwatch", "CloudWatchLogsClient");
    const isMissing = (e: any) => e?.name === "ResourceNotFoundException";
    return {
        // ログを1行書き込む。ログストリームが無ければ作る（ロググループは事前に作っておくこと）。戻り値なし
        putLog: async (logGroup: string, logStream: string, message: string): Promise<void> => {
            _need(logGroup, "logGroup"); _need(logStream, "logStream"); _need(message, "message");
            const { sdk, client } = await ready();
            const put = () => client.send(new sdk.PutLogEventsCommand({
                logGroupName: logGroup, logStreamName: logStream,
                logEvents: [{ timestamp: Date.now(), message }],
            }));
            try {
                await put();
            } catch (e: any) {
                if (!isMissing(e)) throw e;
                // ストリーム（またはグループ）が無い。ストリームを作ってやり直す（グループが無い場合は作成側で例外になる）
                await client.send(new sdk.CreateLogStreamCommand({ logGroupName: logGroup, logStreamName: logStream }));
                await put();
            }
        },
    };
};

// すべてのサービスをまとめて作る（project-bridge.ts から vja.aws として設置する）
export const makeAwsRuntimes = (deps: AwsRuntimeDeps) => ({
    s3: makeAwsS3Runtime(deps),
    dynamodb: makeAwsDynamoDbRuntime(deps),
    sqs: makeAwsSqsRuntime(deps),
    sns: makeAwsSnsRuntime(deps),
    lambda: makeAwsLambdaRuntime(deps),
    ses: makeAwsSesRuntime(deps),
    sts: makeAwsStsRuntime(deps),
    secretsmanager: makeAwsSecretsManagerRuntime(deps),
    cloudwatch: makeAwsCloudWatchRuntime(deps),
});
