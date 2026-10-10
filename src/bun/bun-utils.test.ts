// src/bun/bun-utils.test.ts
// parseCsvLine / decompressGzip の純粋ロジックに対するユニットテスト。
import { describe, test, expect } from "bun:test";
import { parseCsvLine, decompressGzip, execFetch, buildConstInitScript, buildImageInitScript, resolvePictureSrc, pickImages, pickStartForm, encryptAiKeys, decryptAiKeys, stripAiKeys, AI_KEY_PREFIX, stripCloudCredentials, omitAppInputCredentials } from "./bun-utils";

describe("parseCsvLine", () => {
    test("単純なカンマ区切り", () => {
        expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
    });

    test("ダブルクォートで囲まれたカンマを1フィールドとして扱う", () => {
        expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
    });

    test('""はダブルクォートのエスケープとして1文字の"になる', () => {
        expect(parseCsvLine('a,"say ""hi""",c')).toEqual(["a", 'say "hi"', "c"]);
    });

    test("空文字列は1件の空フィールドとして扱う", () => {
        expect(parseCsvLine("")).toEqual([""]);
    });

    test("末尾がカンマの場合、末尾に空フィールドが付く", () => {
        expect(parseCsvLine("a,b,")).toEqual(["a", "b", ""]);
    });
});

describe("decompressGzip", () => {
    test("gzip圧縮したテキストをbase64経由で正しく復元できる", async () => {
        const original = "こんにちは、VJA！";
        const cs = new CompressionStream("gzip");
        const writer = cs.writable.getWriter();
        writer.write(new TextEncoder().encode(original));
        writer.close();
        const chunks: Uint8Array[] = [];
        const reader = cs.readable.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
        const total = chunks.reduce((s, c) => s + c.length, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) { merged.set(c, offset); offset += c.length; }
        const b64 = btoa(String.fromCharCode(...merged));

        expect(await decompressGzip(b64)).toBe(original);
    });
});

describe("execFetch", () => {
    // 受け取ったリクエストの内容(メソッド・ヘッダー・本文)をそのまま返すローカルサーバー
    const startServer = () => Bun.serve({
        port: 0,
        async fetch(req) {
            const url = new URL(req.url);
            if (url.pathname === "/bin") {
                // 全バイト値を含むバイナリ(UTF-8として不正な並びを含む)を返す
                return new Response(new Uint8Array(256).map((_, i) => i), { headers: { "content-type": "application/octet-stream" } });
            }
            if (url.pathname === "/echo") {
                const buf = new Uint8Array(await req.arrayBuffer());
                return new Response(buf, { headers: { "x-method": req.method, "x-custom": req.headers.get("x-custom") || "" } });
            }
            return new Response("テキスト応答", { status: 201 });
        },
    });

    test("既定(text): 本文を文字列で返す", async () => {
        const server = startServer();
        try {
            const r = await execFetch({ url: `http://localhost:${server.port}/` });
            expect(r.status).toBe(201);
            expect(r.ok).toBe(true);
            expect(r.body).toBe("テキスト応答");
            expect(r.bodyBase64).toBeUndefined();
        } finally { server.stop(true); }
    });

    test("responseType:binary: バイナリがbase64で壊れずに返る", async () => {
        const server = startServer();
        try {
            const r = await execFetch({ url: `http://localhost:${server.port}/bin`, responseType: "binary" });
            const bytes = Buffer.from(r.bodyBase64 as string, "base64");
            expect(Array.from(bytes)).toEqual(Array.from(new Uint8Array(256).map((_, i) => i)));
            expect(r.body).toBe("");
        } finally { server.stop(true); }
    });

    test("bodyBase64: バイナリ本文がそのまま送られる(ヘッダー・メソッドも)", async () => {
        const server = startServer();
        try {
            const src = Buffer.from([0, 255, 128, 13, 10, 200]);
            const r = await execFetch({
                url: `http://localhost:${server.port}/echo`, method: "PUT",
                headers: { "x-custom": "abc" }, bodyBase64: src.toString("base64"), responseType: "binary",
            });
            expect(r.headers["x-method"]).toBe("PUT");
            expect(r.headers["x-custom"]).toBe("abc");
            expect(Buffer.from(r.bodyBase64 as string, "base64").equals(src)).toBe(true);
        } finally { server.stop(true); }
    });

    test("body(テキスト)も従来どおり送られる", async () => {
        const server = startServer();
        try {
            const r = await execFetch({ url: `http://localhost:${server.port}/echo`, method: "POST", body: "日本語" });
            expect(r.body).toBe("日本語");
        } finally { server.stop(true); }
    });

    test("AbortSignalで中断するとAbortErrorになる", async () => {
        const server = Bun.serve({ port: 0, async fetch() { await Bun.sleep(2000); return new Response("late"); } });
        try {
            const ctrl = new AbortController();
            const p = execFetch({ url: `http://localhost:${server.port}/` }, ctrl.signal);
            ctrl.abort();
            await expect(p).rejects.toMatchObject({ name: "AbortError" });
        } finally { server.stop(true); }
    });
});

describe("buildConstInitScript", () => {
    // 生成したスクリプトを、偽のvja.constに対して実際に実行し、渡る値を確認する
    const run = (g: any, f: any) => {
        const calls: any[] = [];
        const w: any = { vja: { const: { init: (a: any, b: any) => calls.push([a, b]) } } };
        new Function("window", buildConstInitScript(g, f))(w);
        return calls;
    };

    test("全体の定数とフォームの定数がvja.const.initへ渡る", () => {
        const calls = run([{ name: "hoge", value: "1" }], [{ name: "moge", value: "2" }]);
        expect(calls).toEqual([[[{ name: "hoge", value: "1" }], [{ name: "moge", value: "2" }]]]);
    });

    test("配列でない・名前が空の定数は除外し、値が無ければ空文字にする", () => {
        const calls = run(undefined, [{ name: "", value: "x" }, { name: "a" }, null]);
        expect(calls).toEqual([[[], [{ name: "a", value: "" }]]]);
    });

    test("値に</script>や改行コードを含んでもHTMLを壊さず、値は元のまま渡る", () => {
        const v = 'a</script><script>alert(1)</script>  "\\';
        const src = buildConstInitScript([{ name: "k", value: v }], []);
        expect(src.includes("</script>")).toBe(false);
        expect(src.includes("<")).toBe(false);
        expect(run([{ name: "k", value: v }], [])[0][0][0].value).toBe(v);
    });

    test("vja.constが無い環境でも例外を出さない", () => {
        expect(() => new Function("window", buildConstInitScript([{ name: "a", value: "1" }], []))({})).not.toThrow();
    });
});

describe("画像管理（pickImages / resolvePictureSrc / buildImageInitScript）", () => {
    const png = "data:image/png;base64,AAAA";
    const images = [{ name: "ロゴ", data: png }, { name: "", data: png }, { name: "bad", data: "http://x" }, null];

    test("pickImagesは名前が有り、data:image/のデータだけを{名前:data}にまとめる", () => {
        expect(pickImages(images)).toEqual({ "ロゴ": png });
        expect(pickImages(undefined)).toEqual({});
    });

    test("resolvePictureSrcは画像名をdata URIに解決し、無ければ空文字、旧形式(data URI)は素通し", () => {
        expect(resolvePictureSrc("ロゴ", images)).toBe(png);
        expect(resolvePictureSrc("無い", images)).toBe("");
        expect(resolvePictureSrc("", images)).toBe("");
        expect(resolvePictureSrc("data:image/gif;base64,BBBB", [])).toBe("data:image/gif;base64,BBBB");
    });

    test("buildImageInitScriptの結果をvja.image.initへ渡せ、HTMLを壊す文字は含まない", () => {
        const calls: any[] = [];
        const w: any = { vja: { image: { init: (m: any) => calls.push(m) } } };
        const evil = [{ name: "a</script>", data: "data:image/png;base64,</script>" }];
        const src = buildImageInitScript(evil);
        expect(src.includes("<")).toBe(false);
        new Function("window", src)(w);
        expect(calls).toEqual([{ "a</script>": "data:image/png;base64,</script>" }]);
        expect(() => new Function("window", buildImageInitScript(images))({})).not.toThrow();
    });
});

describe("pickStartForm", () => {
    const forms = [{ id: "a", n: 1 }, { id: "b", n: 2 }, { id: "c", n: 3 }];
    test("startFormIdのフォームを返す（先頭ではない）", () => {
        expect(pickStartForm(forms, "c")?.n).toBe(3);
    });
    test("startFormIdが空・未指定・見つからない場合は先頭のフォーム", () => {
        expect(pickStartForm(forms, "")?.n).toBe(1);
        expect(pickStartForm(forms, undefined)?.n).toBe(1);
        expect(pickStartForm(forms, "zzz")?.n).toBe(1);
    });
    test("フォームが無ければundefined", () => {
        expect(pickStartForm([], "a")).toBeUndefined();
    });
});

describe("AI接続設定のAPIキーの暗号化・復号・除去", () => {
    // テスト用の簡易な暗号化（実物はAES-GCM）。往復で元に戻ることだけを見る
    const enc = async (s: string) => "X" + s.split("").reverse().join("");
    const dec = async (s: string) => s.slice(1).split("").reverse().join("");
    const make = () => ({
        aiConfig: { apiKey: "sk-main", endpoint: "http://x" },
        aiPresets: [{ name: "a", config: { apiKey: "sk-a" } }, { name: "b", config: { apiKey: "" } }],
        other: { apiKey: "not-target" },
    });

    test("暗号化すると先頭にenc:が付き、復号で元に戻る", async () => {
        const p = make();
        await encryptAiKeys(p, enc);
        expect(p.aiConfig.apiKey.startsWith(AI_KEY_PREFIX)).toBe(true);
        expect(p.aiConfig.apiKey).not.toContain("sk-main");
        expect(p.aiPresets[0].config.apiKey.startsWith(AI_KEY_PREFIX)).toBe(true);
        await decryptAiKeys(p, dec);
        expect(p.aiConfig.apiKey).toBe("sk-main");
        expect(p.aiPresets[0].config.apiKey).toBe("sk-a");
    });
    test("空のキー・対象外の項目・他のフィールドは変えない", async () => {
        const p = make();
        await encryptAiKeys(p, enc);
        expect(p.aiPresets[1].config.apiKey).toBe("");
        expect(p.other.apiKey).toBe("not-target");
        expect(p.aiConfig.endpoint).toBe("http://x");
    });
    test("二重に暗号化しない（enc:付きはそのまま）", async () => {
        const p = make();
        await encryptAiKeys(p, enc);
        const once = p.aiConfig.apiKey;
        await encryptAiKeys(p, enc);
        expect(p.aiConfig.apiKey).toBe(once);
    });
    test("enc:が付いていない（旧版の平文）値は復号せずそのまま読める", async () => {
        const p = make();
        await decryptAiKeys(p, dec);
        expect(p.aiConfig.apiKey).toBe("sk-main");
    });
    test("復号に失敗したキーは空にする", async () => {
        const p = make();
        await encryptAiKeys(p, enc);
        await decryptAiKeys(p, async () => { throw new Error("bad"); });
        expect(p.aiConfig.apiKey).toBe("");
    });
    test("stripAiKeysは全てのAIキーを空にする（対象外は変えない）", () => {
        const p = make();
        stripAiKeys(p);
        expect(p.aiConfig.apiKey).toBe("");
        expect(p.aiPresets[0].config.apiKey).toBe("");
        expect(p.other.apiKey).toBe("not-target");
    });
});

describe("クラウド認証情報の除去・アプリ側入力項目の除外", () => {
    test("omitAppInputCredentialsは、アプリ側入力ONの項目の値を除く", () => {
        const out = omitAppInputCredentials({ A: "1", B: "2", C: "3" }, { B: true, C: false });
        expect(out).toEqual({ A: "1", C: "3" });
    });
    test("omitAppInputCredentialsは、未定義の入力でも空のオブジェクトを返す", () => {
        expect(omitAppInputCredentials(undefined, undefined)).toEqual({});
        expect(omitAppInputCredentials({ A: "1" }, undefined)).toEqual({ A: "1" });
    });
    test("stripCloudCredentialsは、値を全て消し、全項目をアプリ側入力ONにする", () => {
        const proj: any = {
            aiConfig: { apiKey: "x" },
            cloudInfras: [{
                infra: "AWS", credentials: { AWS_ACCESS_KEY_ID: "enc1", AWS_SECRET_ACCESS_KEY: "enc2" },
                credDefs: ["AWS_REGION", { name: "AWS_SECRET_ACCESS_KEY", secret: true }],
                appInput: { AWS_REGION: false }, credentialsJson: "{\"a\":1}",
            }],
        };
        stripCloudCredentials(proj);
        const inf = proj.cloudInfras[0];
        expect(inf.credentials).toEqual({});
        expect(inf.appInput).toEqual({ AWS_ACCESS_KEY_ID: true, AWS_SECRET_ACCESS_KEY: true, AWS_REGION: true });
        expect(inf.credentialsJson).toBe("");
        expect(proj.aiConfig.apiKey).toBe("x"); // 対象外は変えない
    });
    test("stripCloudCredentialsは、cloudInfrasが無くても例外にならない", () => {
        expect(() => stripCloudCredentials({})).not.toThrow();
    });
});
