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
