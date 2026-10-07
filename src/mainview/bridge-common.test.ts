// src/mainview/bridge-common.test.ts
// bridge-common.ts の純粋ロジック部分（RPC requestsプロキシへの薄いラッパー群）の
// ユニットテスト。実際のElectrobun/webviewは使わず、rpc.request相当を模した
// フェイク関数を注入して、呼び出しメソッド名・引数・戻り値の展開ロジックを検証する。
import { describe, test, expect } from "bun:test";
import {
    makeFetchMaps,
    makeVjaFetch,
    makeFetchResultHandlers,
    makeDbWrappers,
    makeFileWrappers,
    makeDirWrappers,
    makeDialogHelpers,
    bytesToBase64,
    base64ToBytes,
    makeFetchProxy,
    AWS_HOST_REGEX,
    normalizeRuntimeError,
    addRuntimeError,
    RUNTIME_ERRORS_MAX,
} from "./bridge-common";

describe("makeDbWrappers", () => {
    test("query: dbQueryRequestを呼び、rowsを返す", async () => {
        const calls: any[] = [];
        const r = {
            dbQueryRequest: async (p: any) => { calls.push(p); return { ok: true, rows: [{ id: 1 }] }; },
        };
        const db = makeDbWrappers(r);
        const rows = await db.query("SELECT 1", [1]);
        expect(calls).toEqual([{ sql: "SELECT 1", params: [1] }]);
        expect(rows).toEqual([{ id: 1 }]);
    });

    test("execute: ok=falseの場合はnullを返す", async () => {
        const r = { dbExecuteRequest: async () => ({ ok: false }) };
        const db = makeDbWrappers(r);
        expect(await db.execute("DELETE FROM t")).toBeNull();
    });

    test("execute: ok=trueの場合はresultを返す", async () => {
        const r = { dbExecuteRequest: async () => ({ ok: true, result: { changes: 1, lastInsertRowid: 5 } }) };
        const db = makeDbWrappers(r);
        expect(await db.execute("INSERT INTO t VALUES (1)")).toEqual({ changes: 1, lastInsertRowid: 5 });
    });

    test("transaction: okを返す", async () => {
        const r = { dbTransactionRequest: async (p: any) => { expect(p.statements.length).toBe(2); return { ok: true }; } };
        const db = makeDbWrappers(r);
        expect(await db.transaction([{ sql: "a" }, { sql: "b" }])).toBe(true);
    });
});

describe("makeFileWrappers", () => {
    test("read: ok=trueならcontentを返す", async () => {
        const r = { fileReadRequest: async ({ path }: any) => ({ ok: true, content: "hello:" + path }) };
        const file = makeFileWrappers(r);
        expect(await file.read("/tmp/a.txt")).toBe("hello:/tmp/a.txt");
    });

    test("read: ok=falseならnullを返す", async () => {
        const r = { fileReadRequest: async () => ({ ok: false, content: null }) };
        const file = makeFileWrappers(r);
        expect(await file.read("/no/such/file")).toBeNull();
    });

    test("write/exists/delete/copy: res.okをそのまま返す", async () => {
        const r = {
            fileWriteRequest: async () => ({ ok: true }),
            fileExistsRequest: async () => ({ ok: true, value: true }),
            fileDeleteRequest: async () => ({ ok: false }),
            fileCopyRequest: async () => ({ ok: true }),
        };
        const file = makeFileWrappers(r);
        expect(await file.write("/a", "content")).toBe(true);
        expect(await file.exists("/a")).toBe(true);
        expect(await file.delete("/a")).toBe(false);
        expect(await file.copy("/a", "/b")).toBe(true);
    });

    test("readBytes: dataがあればUint8Arrayを返す", async () => {
        const r = { fileReadBytesRequest: async () => ({ ok: true, data: [1, 2, 3] }) };
        const file = makeFileWrappers(r);
        const bytes = await file.readBytes("/a.bin");
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(Array.from(bytes as Uint8Array)).toEqual([1, 2, 3]);
    });

    test("readBytes: dataがnullならnullを返す", async () => {
        const r = { fileReadBytesRequest: async () => ({ ok: false, data: null }) };
        const file = makeFileWrappers(r);
        expect(await file.readBytes("/a.bin")).toBeNull();
    });

    test("writeBytes: Uint8Array/number[]どちらでも同じペイロードで送信できる", async () => {
        const payloads: any[] = [];
        const r = { fileWriteBytesRequest: async (p: any) => { payloads.push(p.data); return { ok: true }; } };
        const file = makeFileWrappers(r);
        await file.writeBytes("/a", new Uint8Array([1, 2, 3]));
        await file.writeBytes("/a", [1, 2, 3]);
        expect(payloads[0]).toEqual([1, 2, 3]);
        expect(payloads[1]).toEqual([1, 2, 3]);
    });
});

describe("makeDirWrappers", () => {
    test("create/delete/exists: res.okまたはres.valueを返す", async () => {
        const r = {
            dirCreateRequest: async () => ({ ok: true }),
            dirDeleteRequest: async () => ({ ok: false }),
            dirExistsRequest: async () => ({ ok: true, value: true }),
        };
        const dir = makeDirWrappers(r);
        expect(await dir.create("/d")).toBe(true);
        expect(await dir.delete("/d")).toBe(false);
        expect(await dir.exists("/d")).toBe(true);
    });

    test("list: entriesを返す", async () => {
        const r = { dirListRequest: async () => ({ ok: true, entries: ["a.txt", "b.txt"] }) };
        const dir = makeDirWrappers(r);
        expect(await dir.list("/d")).toEqual(["a.txt", "b.txt"]);
    });
});

describe("makeDialogHelpers", () => {
    test("showDialog: loadingをOFFにしてからshowVjaAlertを呼び、コールバックでresolveする", async () => {
        const calls: string[] = [];
        const w: any = {
            vja: { ui: { loading: (v: boolean) => calls.push("loading:" + v) } },
            showVjaAlert: (message: string, cb: () => void) => { calls.push("alert:" + message); cb(); },
        };
        const dialog = makeDialogHelpers(w);
        await dialog.showDialog("hello");
        expect(calls).toEqual(["loading:false", "alert:hello"]);
    });

    test("showConfirm: コールバックのconfirmed値でresolveする", async () => {
        const w: any = {
            vja: { ui: { loading: () => {} } },
            showVjaDialog: (message: string, cb: (confirmed: boolean) => void) => cb(true),
        };
        const dialog = makeDialogHelpers(w);
        expect(await dialog.showConfirm("sure?")).toBe(true);
    });

    test("showDialog: vja/showVjaAlertが未定義でも例外にならず、Promiseは残る（呼び出し側の実装意図の確認）", () => {
        const w: any = {};
        const dialog = makeDialogHelpers(w);
        // showVjaAlertが無い環境では resolve が呼ばれないため、
        // ここでは「例外を投げずにPromiseを返すこと」だけを確認する
        // （実際のUIでは必ずshowVjaAlertが用意されている前提）。
        expect(dialog.showDialog("x")).toBeInstanceOf(Promise);
    });
});

describe("makeFetchMaps / makeVjaFetch / makeFetchResultHandlers", () => {
    test("fetch: fetchResultが返ってくるとPromiseが解決し、text()/json()が使える", async () => {
        const { fetchPendingMap, fetchAbortPendingMap } = makeFetchMaps();
        const resultHandlers = makeFetchResultHandlers(fetchPendingMap, fetchAbortPendingMap);
        // sendFetchRequestは「送信と同時に、対応するfetchResultが返ってきた」ことを模す
        const sendFetchRequest = (args: any) => {
            resultHandlers.fetchResult({
                fetchId: args.fetchId, ok: true, status: 200,
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ hello: "world" }),
            });
        };
        const sendFetchAbortRequest = () => {};
        const { fetch } = makeVjaFetch(fetchPendingMap, fetchAbortPendingMap, sendFetchRequest, sendFetchAbortRequest);
        const res = await fetch("https://example.com/api");
        expect(res.ok).toBe(true);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(JSON.stringify({ hello: "world" }));
        expect(await res.json()).toEqual({ hello: "world" });
    });

    test("fetch: error付きの結果はthrowされる", async () => {
        const { fetchPendingMap, fetchAbortPendingMap } = makeFetchMaps();
        const resultHandlers = makeFetchResultHandlers(fetchPendingMap, fetchAbortPendingMap);
        const sendFetchRequest = (args: any) => {
            resultHandlers.fetchResult({ fetchId: args.fetchId, ok: false, status: 0, headers: {}, body: "", error: "network down" });
        };
        const { fetch } = makeVjaFetch(fetchPendingMap, fetchAbortPendingMap, sendFetchRequest, () => {});
        await expect(fetch("https://example.com")).rejects.toThrow("network down");
    });

    test("fetch: AbortErrorの場合、name=AbortErrorで例外化される", async () => {
        const { fetchPendingMap, fetchAbortPendingMap } = makeFetchMaps();
        const resultHandlers = makeFetchResultHandlers(fetchPendingMap, fetchAbortPendingMap);
        const sendFetchRequest = (args: any) => {
            resultHandlers.fetchResult({ fetchId: args.fetchId, ok: false, status: 0, headers: {}, body: "", error: "AbortError" });
        };
        const { fetch } = makeVjaFetch(fetchPendingMap, fetchAbortPendingMap, sendFetchRequest, () => {});
        try {
            await fetch("https://example.com");
            throw new Error("should have thrown");
        } catch (e: any) {
            expect(e.name).toBe("AbortError");
        }
    });
});

describe("bytesToBase64 / base64ToBytes", () => {
    test("全バイト値(0〜255)が往復で壊れない", () => {
        const src = new Uint8Array(256).map((_, i) => i);
        expect(Array.from(base64ToBytes(bytesToBase64(src)))).toEqual(Array.from(src));
    });

    test("チャンク境界(0x8000)をまたぐ大きさでも往復で壊れない", () => {
        const src = new Uint8Array(0x8000 * 2 + 5).map((_, i) => (i * 7) & 0xff);
        const back = base64ToBytes(bytesToBase64(src));
        expect(back.length).toBe(src.length);
        expect(Buffer.from(back).equals(Buffer.from(src))).toBe(true);
    });

    test("空配列", () => {
        expect(bytesToBase64(new Uint8Array(0))).toBe("");
        expect(base64ToBytes("").length).toBe(0);
    });
});

describe("makeVjaFetch バイナリ対応", () => {
    const setup = (onSend: (args: any, handlers: ReturnType<typeof makeFetchResultHandlers>) => void) => {
        const { fetchPendingMap, fetchAbortPendingMap } = makeFetchMaps();
        const handlers = makeFetchResultHandlers(fetchPendingMap, fetchAbortPendingMap);
        const sent: any[] = [];
        const { fetch } = makeVjaFetch(fetchPendingMap, fetchAbortPendingMap, (args: any) => { sent.push(args); onSend(args, handlers); }, () => {});
        return { fetch, sent };
    };

    test("body:Uint8Array はbodyBase64で送られ、bodyは送られない", async () => {
        const { fetch, sent } = setup((a, h) => h.fetchResult({ fetchId: a.fetchId, ok: true, status: 200, headers: {}, body: "" }));
        await fetch("https://x", { method: "PUT", body: new Uint8Array([0, 255, 128]) });
        expect(sent[0].bodyBase64).toBe(Buffer.from([0, 255, 128]).toString("base64"));
        expect(sent[0].body).toBeUndefined();
    });

    test("body:ArrayBuffer もbodyBase64で送られる", async () => {
        const { fetch, sent } = setup((a, h) => h.fetchResult({ fetchId: a.fetchId, ok: true, status: 200, headers: {}, body: "" }));
        await fetch("https://x", { method: "PUT", body: new Uint8Array([1, 2, 3]).buffer });
        expect(sent[0].bodyBase64).toBe(Buffer.from([1, 2, 3]).toString("base64"));
    });

    test("body:string は従来どおりbodyで送られる", async () => {
        const { fetch, sent } = setup((a, h) => h.fetchResult({ fetchId: a.fetchId, ok: true, status: 200, headers: {}, body: "" }));
        await fetch("https://x", { method: "POST", body: "text" });
        expect(sent[0].body).toBe("text");
        expect(sent[0].bodyBase64).toBeUndefined();
    });

    test("responseTypeがBunへ渡される", async () => {
        const { fetch, sent } = setup((a, h) => h.fetchResult({ fetchId: a.fetchId, ok: true, status: 200, headers: {}, body: "" }));
        await fetch("https://x", { responseType: "binary" });
        expect(sent[0].responseType).toBe("binary");
    });

    test("バイナリ応答: bytes()/arrayBuffer()/blob()で取得でき、バイトが壊れない", async () => {
        const src = new Uint8Array([0, 255, 128, 10, 13]);
        const { fetch } = setup((a, h) => h.fetchResult({ fetchId: a.fetchId, ok: true, status: 200, headers: {}, body: "", bodyBase64: Buffer.from(src).toString("base64") }));
        const res: any = await fetch("https://x", { responseType: "binary" });
        expect(Array.from(await res.bytes())).toEqual(Array.from(src));
        expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(src));
        expect((await res.blob()).size).toBe(src.length);
    });

    test("バイナリ応答でもtext()/json()はUTF-8として読める", async () => {
        const bytes = new TextEncoder().encode(JSON.stringify({ a: "日本語" }));
        const { fetch } = setup((a, h) => h.fetchResult({ fetchId: a.fetchId, ok: true, status: 200, headers: {}, body: "", bodyBase64: Buffer.from(bytes).toString("base64") }));
        const res: any = await fetch("https://x", { responseType: "binary" });
        expect(await res.json()).toEqual({ a: "日本語" });
    });
});

describe("AWS_HOST_REGEX", () => {
    const ok = [
        "s3.ap-northeast-1.amazonaws.com", "test-vja-s3.s3.ap-northeast-1.amazonaws.com",
        "dynamodb.us-east-1.amazonaws.com", "sqs.us-west-2.amazonaws.com", "s3.ap-northeast-3.amazonaws.com",
        "s3.amazonaws.com", "sts.amazonaws.com", "s3.cn-north-1.amazonaws.com.cn",
        "test-vja-s3.s3.dualstack.ap-northeast-1.amazonaws.com",
        "dynamodb.ap-northeast-1.api.aws", "sqs.us-east-1.api.aws",
    ];
    const ng = [
        "amazonaws.com", "api.aws", "evilamazonaws.com", "amazonaws.com.evil.com", "x.api.aws.evil.com",
        "example.com", "maachang.com", "yahoo.co.jp", "localhost", "",
    ];
    for (const h of ok) test("一致: " + h, () => expect(AWS_HOST_REGEX.test(h)).toBe(true));
    for (const h of ng) test("不一致: " + (h || "(空)"), () => expect(AWS_HOST_REGEX.test(h)).toBe(false));
});

describe("makeFetchProxy", () => {
    // 元のfetchと vja.fetch の呼び出しを記録するフェイク
    const setup = (vjaRes: any = { status: 200, headers: { "x-a": "b" }, bytes: new Uint8Array([1, 2, 3]) }) => {
        const orig: any[] = [];
        const vja: any[] = [];
        const origFetch = async (input: any, init?: any) => { orig.push({ input, init }); return new Response("orig"); };
        const vjaFetch = (url: string, opts: any) => {
            vja.push({ url, opts });
            const p: any = Promise.resolve({ status: vjaRes.status, headers: vjaRes.headers, bytes: async () => vjaRes.bytes });
            p.fetchId = "id1";
            return p;
        };
        const f = makeFetchProxy(origFetch, vjaFetch, AWS_HOST_REGEX);
        return { f, orig, vja };
    };

    test("AWS以外のURLは元のfetchへそのまま渡す", async () => {
        const { f, orig, vja } = setup();
        const r = await f("https://maachang.com/api", { method: "POST", body: "x" });
        expect(await r.text()).toBe("orig");
        expect(orig.length).toBe(1);
        expect(vja.length).toBe(0);
    });

    test("相対パス/不正なURLも元のfetchへ渡す（アプリ内部の読み込みを壊さない）", async () => {
        const { f, orig, vja } = setup();
        await f("prompts/a.md");
        await f("views://mainview/index.html");
        expect(orig.length).toBe(2);
        expect(vja.length).toBe(0);
    });

    test("AWS宛て(文字列URL)はvja.fetchへ渡し、応答はResponseで返る", async () => {
        const { f, orig, vja } = setup();
        const r = await f("https://s3.ap-northeast-1.amazonaws.com/b/k", { method: "GET", headers: { a: "1" } });
        expect(orig.length).toBe(0);
        expect(vja[0].url).toBe("https://s3.ap-northeast-1.amazonaws.com/b/k");
        expect(vja[0].opts.method).toBe("GET");
        expect(vja[0].opts.headers).toEqual({ a: "1" });
        expect(vja[0].opts.responseType).toBe("binary");
        expect(r.status).toBe(200);
        expect(r.headers.get("x-a")).toBe("b");
        expect(Array.from(new Uint8Array(await r.arrayBuffer()))).toEqual([1, 2, 3]);
    });

    test("Requestオブジェクト入力: メソッド/ヘッダー/バイナリ本文をRequestから取り出す", async () => {
        const { f, vja } = setup();
        const req = new Request("https://test-vja-s3.s3.ap-northeast-1.amazonaws.com/vja-test/a.bin", {
            method: "PUT", headers: { "x-amz-date": "20261005T000000Z", authorization: "AWS4-HMAC-SHA256 x" },
            body: new Uint8Array([0, 255, 128]),
        });
        await f(req);
        expect(vja[0].opts.method).toBe("PUT");
        expect(vja[0].opts.headers["x-amz-date"]).toBe("20261005T000000Z");
        expect(vja[0].opts.headers["authorization"]).toBe("AWS4-HMAC-SHA256 x");
        expect(Array.from(vja[0].opts.body)).toEqual([0, 255, 128]);
    });

    test("init.bodyが文字列/Uint8Array/Blob/ストリームでもvja.fetchが受け取れる形になる", async () => {
        const { f, vja } = setup();
        const url = "https://s3.us-east-1.amazonaws.com/b/k";
        await f(url, { method: "PUT", body: "テキスト" });
        await f(url, { method: "PUT", body: new Uint8Array([9, 8]) });
        await f(url, { method: "PUT", body: new Blob([new Uint8Array([7, 6])]) });
        await f(url, { method: "PUT", body: new Response(new Uint8Array([5, 4])).body });
        expect(vja[0].opts.body).toBe("テキスト");
        expect(Array.from(vja[1].opts.body)).toEqual([9, 8]);
        expect(Array.from(vja[2].opts.body)).toEqual([7, 6]);
        expect(Array.from(vja[3].opts.body)).toEqual([5, 4]);
    });

    test("204/304/HEADは本文なしのResponseを返す（Response生成で例外にならない）", async () => {
        const a = setup({ status: 204, headers: {}, bytes: new Uint8Array(0) });
        const r1 = await a.f("https://s3.ap-northeast-1.amazonaws.com/b/k", { method: "DELETE" });
        expect(r1.status).toBe(204);
        const b = setup({ status: 200, headers: { "content-length": "3" }, bytes: new Uint8Array(0) });
        const r2 = await b.f("https://s3.ap-northeast-1.amazonaws.com/b/k", { method: "HEAD" });
        expect(r2.status).toBe(200);
    });

    test("ネットワーク失敗はTypeErrorで返す（ブラウザのfetchと同じ）", async () => {
        const f = makeFetchProxy(async () => new Response("o"), () => Promise.reject(new Error("network down")), AWS_HOST_REGEX);
        await expect(f("https://s3.ap-northeast-1.amazonaws.com/b/k")).rejects.toBeInstanceOf(TypeError);
    });

    test("AbortSignal: 中断済みなら即AbortError、実行中に中断するとfetchAbortを呼ぶ", async () => {
        const { f } = setup();
        const ctrl0 = new AbortController(); ctrl0.abort();
        await expect(f("https://s3.ap-northeast-1.amazonaws.com/b/k", { signal: ctrl0.signal })).rejects.toMatchObject({ name: "AbortError" });

        const aborted: string[] = [];
        let resolveP: any;
        const vjaFetch = () => { const p: any = new Promise((res) => { resolveP = res; }); p.fetchId = "idX"; return p; };
        const f2 = makeFetchProxy(async () => new Response("o"), vjaFetch as any, AWS_HOST_REGEX, async (id) => { aborted.push(id); });
        const ctrl = new AbortController();
        const pr = f2("https://s3.ap-northeast-1.amazonaws.com/b/k", { signal: ctrl.signal });
        await Bun.sleep(0);
        ctrl.abort();
        expect(aborted).toEqual(["idX"]);
        resolveP({ status: 200, headers: {}, bytes: async () => new Uint8Array(0) });
        await pr;
    });

    test("FormDataは変換できないため元のfetchへ渡す", async () => {
        const { f, orig, vja } = setup();
        await f("https://s3.ap-northeast-1.amazonaws.com/b/k", { method: "POST", body: new FormData() });
        expect(orig.length).toBe(1);
        expect(vja.length).toBe(0);
    });
});

describe("normalizeRuntimeError", () => {
    const base = { widgetName: "btn", eventName: "Click", message: "boom" };
    test("必須項目が無い・オブジェクトでなければnull", () => {
        expect(normalizeRuntimeError(null)).toBeNull();
        expect(normalizeRuntimeError("x")).toBeNull();
        expect(normalizeRuntimeError({ ...base, widgetName: "" })).toBeNull();
        expect(normalizeRuntimeError({ ...base, eventName: undefined })).toBeNull();
        expect(normalizeRuntimeError({ ...base, message: "" })).toBeNull();
    });
    test("既定値: kindはthrown、line/columnはnull、timeは補われる", () => {
        const r = normalizeRuntimeError(base)!;
        expect(r.kind).toBe("thrown");
        expect(r.line).toBeNull();
        expect(r.column).toBeNull();
        expect(typeof r.time).toBe("number");
    });
    test("kind: swallowedのみ許可、不正値はthrown", () => {
        expect(normalizeRuntimeError({ ...base, kind: "swallowed" })!.kind).toBe("swallowed");
        expect(normalizeRuntimeError({ ...base, kind: "evil" })!.kind).toBe("thrown");
    });
    test("長さの上限で切り詰め、数値でないlineはnull", () => {
        const r = normalizeRuntimeError({ ...base, message: "m".repeat(900), stack: "s".repeat(3000), excerpt: "e".repeat(3000), line: "3", column: NaN })!;
        expect(r.message.length).toBe(500);
        expect(r.stack.length).toBe(2000);
        expect(r.excerpt.length).toBe(2000);
        expect(r.line).toBeNull();
        expect(r.column).toBeNull();
    });
});

describe("addRuntimeError", () => {
    const mk = (over: any = {}) => normalizeRuntimeError({ widgetName: "btn", eventName: "Click", message: "boom", line: 3, ...over })!;
    test("新規は先頭に追加され、count=1", () => {
        const l = addRuntimeError(addRuntimeError([], mk({ message: "a" })), mk({ message: "b" }));
        expect(l.map((x) => x.message)).toEqual(["b", "a"]);
        expect(l[0].count).toBe(1);
    });
    test("同じ（ウィジェット・イベント・種別・メッセージ・行）は件数を増やして先頭へ移す", () => {
        let l = addRuntimeError([], mk({ message: "a" }));
        l = addRuntimeError(l, mk({ message: "b" }));
        l = addRuntimeError(l, mk({ message: "a" }));
        expect(l.map((x) => x.message)).toEqual(["a", "b"]);
        expect(l[0].count).toBe(2);
        expect(l).toHaveLength(2);
    });
    test("行・種別が違えば別のエントリ", () => {
        let l = addRuntimeError([], mk());
        l = addRuntimeError(l, mk({ line: 4 }));
        l = addRuntimeError(l, mk({ kind: "swallowed" }));
        expect(l).toHaveLength(3);
    });
    test(`上限(${RUNTIME_ERRORS_MAX})を超えたら古いものから捨てる`, () => {
        let l: any[] = [];
        for (let i = 0; i < RUNTIME_ERRORS_MAX + 5; i++) l = addRuntimeError(l, mk({ message: "m" + i }));
        expect(l).toHaveLength(RUNTIME_ERRORS_MAX);
        expect(l[0].message).toBe("m" + (RUNTIME_ERRORS_MAX + 4));
        expect(l.some((x) => x.message === "m0")).toBe(false);
    });
    test("元の配列は変更しない", () => {
        const orig = addRuntimeError([], mk());
        const copy = JSON.stringify(orig);
        addRuntimeError(orig, mk({ message: "other" }));
        expect(JSON.stringify(orig)).toBe(copy);
    });
});
