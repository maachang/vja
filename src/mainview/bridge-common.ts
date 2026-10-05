// src/mainview/bridge-common.ts
// bridge.ts / project-bridge.ts 共通ユーティリティ

// ── Pending 型 ───────────────────────────────────────
type Resolver<T> = (v: T) => void;
type Rejecter = (e: Error) => void;
export interface Pending<T> { resolve: Resolver<T>; reject: Rejecter; }

// ── fetch Map 生成ヘルパー ────────────────────────────
export type FetchResult = { ok: boolean; status: number; headers: Record<string, string>; body: string; bodyBase64?: string; error?: string };

export const makeFetchMaps = () => ({
    fetchPendingMap:      new Map<string, Pending<FetchResult>>(),
    fetchAbortPendingMap: new Map<string, Pending<{}>>(),
});

// ── base64 ⇔ バイト列（vja.fetchのバイナリ送受信用） ──
// 大きなバイト列でString.fromCharCode.applyの引数上限に当たらないよう分割して変換する
export const bytesToBase64 = (bytes: Uint8Array): string => {
    let s = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    return btoa(s);
};
export const base64ToBytes = (b64: string): Uint8Array => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
};

// vja.fetchのoptions.body: テキスト、またはバイナリ（Uint8Array/ArrayBuffer）
export type VjaFetchBody = string | Uint8Array | ArrayBuffer;
export type VjaFetchOptions = {
    method?: string;
    headers?: Record<string, string>;
    body?: VjaFetchBody;
    // "binary"でレスポンス本文をバイナリのまま受け取る（省略時"text"）
    responseType?: "text" | "binary";
};

// ── vja.fetch / vja.fetchAbort 生成ヘルパー ──────────
export const makeVjaFetch = (
    fetchPendingMap: Map<string, Pending<FetchResult>>,
    fetchAbortPendingMap: Map<string, Pending<{}>>,
    sendFetchRequest: (args: { fetchId: string; url: string; method?: string; headers?: Record<string, string>; body?: string; bodyBase64?: string; responseType?: "text" | "binary" }) => void,
    sendFetchAbortRequest: (args: { fetchId: string }) => void,
) => ({
    fetch: (url: string, options: VjaFetchOptions = {}) => {
        const fetchId = crypto.randomUUID();
        const { body, ...rest } = options;
        // バイナリ本文はbase64でBunへ渡す（テキストはこれまでどおりbodyで渡す）
        const bodyArgs: { body?: string; bodyBase64?: string } = {};
        if (typeof body === "string") bodyArgs.body = body;
        else if (body instanceof Uint8Array) bodyArgs.bodyBase64 = bytesToBase64(body);
        else if (body instanceof ArrayBuffer) bodyArgs.bodyBase64 = bytesToBase64(new Uint8Array(body));
        const promise = new Promise<any>((res, rej) => {
            fetchPendingMap.set(fetchId, { resolve: res, reject: rej });
            sendFetchRequest({ fetchId, url, ...rest, ...bodyArgs });
        }).then((r: any) => {
            if (r.error === "AbortError") throw Object.assign(new Error("AbortError"), { name: "AbortError" });
            if (r.error) throw new Error(r.error);
            if (r.bodyBase64 !== undefined) {
                // バイナリ応答: bytes()/arrayBuffer()/blob()で取得。text()/json()はUTF-8として解釈する
                const bytes = base64ToBytes(r.bodyBase64);
                const text = () => new TextDecoder().decode(bytes);
                return {
                    ok: r.ok,
                    status: r.status,
                    headers: r.headers,
                    bytes: () => Promise.resolve(bytes),
                    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
                    blob: () => Promise.resolve(new Blob([bytes])),
                    text: () => Promise.resolve(text()),
                    json: () => Promise.resolve(JSON.parse(text())),
                };
            }
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

// ── AWS宛てのwindow.fetchだけをvja.fetch(Bun経由)に差し替える（CORS回避） ──
// webview内のCDN版 AWS SDK は window.fetch で通信するため、バケット側にCORS設定が無いと
// ブラウザに遮断される。送り先がAWSの場合だけ vja.fetch に渡すことで、CORS設定を不要にする。
// AWS以外への通信は元のfetchをそのまま呼ぶ（アプリの他の通信には影響しない）。
// 対象: *.amazonaws.com / *.amazonaws.com.cn / *.api.aws（IPv6対応=デュアルスタック指定時の宛先）。
// 先頭から完全一致のため evilamazonaws.com / amazonaws.com.evil.com は対象外。
export const AWS_HOST_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:amazonaws\.com(?:\.cn)?|api\.aws)$/;

export const makeFetchProxy = (
    origFetch: (input: any, init?: any) => Promise<any>,
    vjaFetch: (url: string, options?: VjaFetchOptions) => Promise<any>,
    hostRegex: RegExp,
    vjaFetchAbort?: (fetchId: string) => Promise<any>,
) => async (input: any, init: any = {}): Promise<any> => {
    // SDK(FetchHttpHandler)は fetch(new Request(url, 設定)) の形で呼ぶため、
    // メソッド/ヘッダー/本文は init ではなく Request オブジェクトからも取り出す
    const isReq = typeof input === "object" && input !== null && typeof input.arrayBuffer === "function";
    const url = typeof input === "string" ? input : (isReq ? input.url : String(input));
    let hostname = "";
    try { hostname = new URL(url).hostname; } catch { return origFetch(input, init); }
    if (!hostRegex.test(hostname)) return origFetch(input, init);

    const method: string = init.method || (isReq ? input.method : "GET");
    const headers: Record<string, string> = {};
    const h = init.headers || (isReq ? input.headers : undefined) || {};
    if (typeof h.forEach === "function") h.forEach((v: string, k: string) => { headers[k] = v; });
    else if (Array.isArray(h)) h.forEach(([k, v]: [string, string]) => { headers[k] = v; });
    else Object.assign(headers, h);

    // 本文: 文字列/バイナリ/Blob/ストリームをvja.fetchが受け取れる形(文字列またはバイト列)へ
    let body: any = init.body;
    if (body === undefined && isReq && method !== "GET" && method !== "HEAD") {
        const ab = await input.clone().arrayBuffer();
        body = ab.byteLength ? new Uint8Array(ab) : undefined;
    } else if (body !== undefined && body !== null && typeof body !== "string"
        && !(body instanceof Uint8Array) && !(body instanceof ArrayBuffer)) {
        if (typeof body.getReader === "function") body = new Uint8Array(await new Response(body).arrayBuffer());
        else if (typeof Blob !== "undefined" && body instanceof Blob) body = new Uint8Array(await body.arrayBuffer());
        else if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) body = body.toString();
        else return origFetch(input, init); // FormData等は変換できないため差し替えない
    }
    if (body === null) body = undefined;

    const signal = init.signal || (isReq ? input.signal : undefined);
    if (signal?.aborted) throw Object.assign(new Error("AbortError"), { name: "AbortError" });

    const p: any = vjaFetch(url, { method, headers, body, responseType: "binary" });
    if (signal && vjaFetchAbort && p.fetchId) {
        signal.addEventListener("abort", () => { vjaFetchAbort(p.fetchId); }, { once: true });
    }
    let res: any;
    try {
        res = await p;
    } catch (e: any) {
        if (e?.name === "AbortError") throw e;
        // ブラウザのfetchはネットワーク失敗をTypeErrorで返す
        throw new TypeError(e?.message || "Failed to fetch");
    }
    const bytes = await res.bytes();
    const noBody = [101, 204, 205, 304].includes(res.status) || method === "HEAD";
    return new Response(noBody ? null : bytes, { status: res.status, headers: res.headers });
};

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


