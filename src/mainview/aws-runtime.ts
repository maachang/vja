// src/mainview/aws-runtime.ts
// vja.aws.* ランタイム（クラウド設定に登録したAWSサービスを、イベントから簡単に使うための関数群）。
// webview内で、クラウド設定に登録したSDKのURL（CDN）からAWS SDK v3を読み込んで実行する。
// 通信はwebviewのfetchで行われるが、AWS宛ては project-bridge.ts の makeFetchProxy により
// vja.fetch（Bun経由）へ自動で差し替わるため、バケット側のCORS設定は不要。
//
// 依存（クラウド設定の取得・クレデンシャル取得・SDK読み込み）は引数で注入する
// （単体テストでSDKやwebviewを使わずに検証できるようにするため）。

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
    // SDKの読み込みとクライアント生成は、初回だけ行って使い回す（失敗した場合は次回やり直す）
    let _cached: Promise<{ sdk: any; client: any }> | null = null;

    const _ready = (): Promise<{ sdk: any; client: any }> => {
        if (_cached) return _cached;
        _cached = (async () => {
            const infras = await deps.listCloudInfras();
            const entry = (infras || []).find((i: any) =>
                i.enabled && String(i.name || "").toLowerCase() === "aws" && String(i.service || "").toLowerCase() === "s3");
            if (!entry) throw new Error("クラウド設定に AWS の s3 が登録されていません（クラウド設定で登録して、有効にしてください）");
            if (!entry.sdkUrl) throw new Error("クラウド設定の AWS s3 に SDK の URL が設定されていません");
            const cred = await deps.getCredential("AWS", "s3");
            if (!cred || !cred.AWS_ACCESS_KEY_ID || !cred.AWS_SECRET_ACCESS_KEY) {
                throw new Error("AWS s3 のクレデンシャルが取得できません（クラウド設定でアクセスキーとシークレットを入れ直して保存してください）");
            }
            if (!cred.AWS_REGION) throw new Error("AWS s3 のリージョン（AWS_REGION）が設定されていません");
            const sdk = await deps.loadSdk(entry.sdkUrl);
            const client = new sdk.S3Client({
                region: cred.AWS_REGION,
                credentials: { accessKeyId: cred.AWS_ACCESS_KEY_ID, secretAccessKey: cred.AWS_SECRET_ACCESS_KEY },
                // 追加のチェックサム計算（ストリーム/トレーラー）を避ける。実機で動作確認済みの設定
                requestChecksumCalculation: "WHEN_REQUIRED",
                responseChecksumValidation: "WHEN_REQUIRED",
            });
            return { sdk, client };
        })();
        _cached.catch(() => { _cached = null; });
        return _cached;
    };

    return {
        // 登録。本文は文字列（UTF-8）またはバイナリ。戻り値なし
        put: async (bucket: string, key: string, body: any, options: { contentType?: string } = {}): Promise<void> => {
            _need(bucket, "bucket"); _need(key, "key");
            const { sdk, client } = await _ready();
            const isText = typeof body === "string";
            await client.send(new sdk.PutObjectCommand({
                Bucket: bucket, Key: key, Body: _toBody(body),
                ContentType: options.contentType ?? (isText ? "text/plain; charset=utf-8" : undefined),
            }));
        },

        // 取得。既定は文字列。{ as: 'bytes' } で Uint8Array。キーが存在しない場合は null
        get: async (bucket: string, key: string, options: { as?: "text" | "bytes" } = {}): Promise<string | Uint8Array | null> => {
            _need(bucket, "bucket"); _need(key, "key");
            const { sdk, client } = await _ready();
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
            const { sdk, client } = await _ready();
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
            const { sdk, client } = await _ready();
            await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: key }));
        },
    };
};
