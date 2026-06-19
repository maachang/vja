// src/mainview/bridge-common.ts
// bridge.ts / project-bridge.ts 共通ユーティリティ

// ── Pending 型 ───────────────────────────────────────
type Resolver<T> = (v: T) => void;
type Rejecter = (e: Error) => void;
export interface Pending<T> { resolve: Resolver<T>; reject: Rejecter; }

// ── fetch Map 生成ヘルパー ────────────────────────────
export type FetchResult = { ok: boolean; status: number; headers: Record<string, string>; body: string; error?: string };

export const makeFetchMaps = () => ({
    fetchPendingMap:      new Map<string, Pending<FetchResult>>(),
    fetchAbortPendingMap: new Map<string, Pending<{}>>(),
});

// ── vja.fetch / vja.fetchAbort 生成ヘルパー ──────────
export const makeVjaFetch = (
    fetchPendingMap: Map<string, Pending<FetchResult>>,
    fetchAbortPendingMap: Map<string, Pending<{}>>,
    sendFetchRequest: (args: { fetchId: string; url: string; method?: string; headers?: Record<string, string>; body?: string }) => void,
    sendFetchAbortRequest: (args: { fetchId: string }) => void,
) => ({
    fetch: (url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
        const fetchId = crypto.randomUUID();
        const promise = new Promise<any>((res, rej) => {
            fetchPendingMap.set(fetchId, { resolve: res, reject: rej });
            sendFetchRequest({ fetchId, url, ...options });
        }).then((r: any) => {
            if (r.error === "AbortError") throw Object.assign(new Error("AbortError"), { name: "AbortError" });
            if (r.error) throw new Error(r.error);
            return {
                ok: r.ok,
                status: r.status,
                headers: r.headers,
                text: () => Promise.resolve(r.body),
                json: () => Promise.resolve(JSON.parse(r.body)),
            };
        });
        (promise as any).fetchId = fetchId;
        return promise;
    },
    fetchAbort: (fetchId: string) => new Promise<any>((res, rej) => {
        fetchAbortPendingMap.set(fetchId, { resolve: res, reject: rej });
        sendFetchAbortRequest({ fetchId });
    }),
});

// ── fetchResult / fetchAbortResult ハンドラ生成ヘルパー ──
export const makeFetchResultHandlers = (
    fetchPendingMap: Map<string, Pending<FetchResult>>,
    fetchAbortPendingMap: Map<string, Pending<{}>>,
) => ({
    fetchResult: (v: any) => {
        const p = fetchPendingMap.get(v.fetchId);
        if (p) { fetchPendingMap.delete(v.fetchId); p.resolve(v); }
    },
    fetchAbortResult: (v: any) => {
        const p = fetchAbortPendingMap.get(v.fetchId);
        if (p) { fetchAbortPendingMap.delete(v.fetchId); p.resolve(v); }
    },
});


