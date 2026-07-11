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

// ── db/file/dir RPCラッパー生成ヘルパー ──────────────
// bridge.ts（デザイナー本体）/ project-bridge.ts（プロジェクト実行）の両方で、
// requestsプロキシ(r = _ev.rpc.request)への薄いラッパーの中身まで完全に
// 重複していたため、ここに共通化する。
// 【注意】dbはquery/execute/transactionの3つのみ共通化している。initや、
// project-bridge.ts固有のclearTable/tables/exportCsv等の派生ヘルパーは
// dbの土台が違う（プロジェクト実行専用のテーブル操作）ため、
// 呼び出し元でそれぞれ個別に組み立てる。
export const makeDbWrappers = (r: any) => ({
    query: (sql: string, params?: any[]) =>
        r.dbQueryRequest({ sql, params }).then((res: any) => res.rows),
    execute: (sql: string, params?: any[]) =>
        r.dbExecuteRequest({ sql, params }).then((res: any) => res.ok ? res.result : null),
    transaction: (statements: { sql: string; params?: any[] }[]) =>
        r.dbTransactionRequest({ statements }).then((res: any) => res.ok),
});

export const makeFileWrappers = (r: any) => ({
    read: (path: string) =>
        r.fileReadRequest({ path }).then((res: any) => res.ok ? res.content : null),
    write: (path: string, content: string) =>
        r.fileWriteRequest({ path, content }).then((res: any) => res.ok),
    readBytes: (path: string) =>
        r.fileReadBytesRequest({ path }).then((res: any) => res.data ? new Uint8Array(res.data) : null),
    // Uint8Array/number[]のどちらで渡されても送信できるようArray.fromで正規化する
    writeBytes: (path: string, data: Uint8Array | number[]) =>
        r.fileWriteBytesRequest({ path, data: Array.from(data) }).then((res: any) => res.ok),
    exists: (path: string) =>
        r.fileExistsRequest({ path }).then((res: any) => res.value),
    delete: (path: string) =>
        r.fileDeleteRequest({ path }).then((res: any) => res.ok),
    copy: (src: string, dest: string) =>
        r.fileCopyRequest({ src, dest }).then((res: any) => res.ok),
});

export const makeDirWrappers = (r: any) => ({
    create: (path: string) =>
        r.dirCreateRequest({ path }).then((res: any) => res.ok),
    delete: (path: string) =>
        r.dirDeleteRequest({ path }).then((res: any) => res.ok),
    list: (path: string) =>
        r.dirListRequest({ path }).then((res: any) => res.entries),
    exists: (path: string) =>
        r.dirExistsRequest({ path }).then((res: any) => res.value),
});

// ── ダイアログ（showDialog/showConfirm）生成ヘルパー ──
// bridge.ts / project-bridge.ts の両方で、フロント側 #dialog-root を使った
// ダイアログ表示ロジックが重複していたため共通化する。
export const makeDialogHelpers = (w: any) => ({
    showDialog: (message: string) =>
        new Promise<void>((resolve) => {
            // ダイアログ表示中にローディングオーバーレイが重なって見えなく
            // なる問題があったため、ダイアログ表示前に自動的にローディングを
            // OFFにする。必要であれば呼び出し側（生成コード）が再度ONにする。
            w.vja?.ui?.loading?.(false);
            w.showVjaAlert?.(message, () => resolve());
        }),
    showConfirm: (message: string) =>
        new Promise<boolean>((resolve) => {
            w.vja?.ui?.loading?.(false);
            w.showVjaDialog?.(message, (confirmed: boolean) => resolve(confirmed));
        }),
});


