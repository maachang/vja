// src/bun/bun-utils.ts
// index.ts / standalone-index.ts 共通ユーティリティ

// CSVパースは src/shared/csv-utils.ts に統一（webview側と共通）。
// 呼び出し元の互換のためここでも re-export する。
export { parseCsvLine } from "../shared/csv-utils";

// ── gzip+Base64 → テキスト展開 ───────────────────────
export const decompressGzip = async (b64: string): Promise<string> => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const chunks: Uint8Array[] = [];
    const reader = ds.readable.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(result);
};


// ── 汎用fetch（vja.fetchのBun側実体。index.ts / project-runner.ts 共通） ──
// bodyBase64が指定されていればバイナリ本文として送る（bodyより優先）。
// responseType:"binary"の場合、レスポンス本文はテキスト変換せず、そのまま
// base64（bodyBase64）で返す（text()でUTF-8解釈するとバイナリが壊れるため）。
export type ExecFetchArgs = {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    bodyBase64?: string;
    responseType?: "text" | "binary";
};
export type ExecFetchResult = {
    ok: boolean;
    status: number;
    headers: Record<string, string>;
    body: string;
    bodyBase64?: string;
};
export const execFetch = async (args: ExecFetchArgs, signal?: AbortSignal): Promise<ExecFetchResult> => {
    const body = args.bodyBase64 !== undefined
        ? Buffer.from(args.bodyBase64, "base64")
        : (args.body ?? undefined);
    const res = await fetch(args.url, {
        method: args.method || "GET",
        headers: args.headers || {},
        body,
        signal,
    });
    const headers = Object.fromEntries(res.headers);
    if (args.responseType === "binary") {
        const buf = Buffer.from(await res.arrayBuffer());
        return { ok: res.ok, status: res.status, headers, body: "", bodyBase64: buf.toString("base64") };
    }
    return { ok: res.ok, status: res.status, headers, body: await res.text() };
};

// 実行用/コンパイル用のフォームHTMLに埋め込む「定数の初期化」スクリプトの本文を作る。
// 全体の定数とそのフォームの定数を vja.const.init に渡す（呼び出しが無いと vja.const.get が常に既定値を返す）。
// 値に「</script>」や改行コード(U+2028/2029)が含まれてもHTMLが壊れないよう、「<」等をエスケープする。
export const buildConstInitScript = (globalConsts: any, formConsts: any): string => {
    const pick = (list: any): { name: string; value: any }[] =>
        (Array.isArray(list) ? list : [])
            .filter((c: any) => c && typeof c.name === "string" && c.name !== "")
            .map((c: any) => ({ name: c.name, value: c.value ?? "" }));
    const lit = (v: any): string => JSON.stringify(v)
        .replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
    return `window.vja?.const?.init?.(${lit(pick(globalConsts))}, ${lit(pick(formConsts))});`;
};
