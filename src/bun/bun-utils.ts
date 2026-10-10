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

// 起動フォームを選ぶ。デザイナーの★（startFormId）のフォームを返し、無い・見つからない場合は先頭のフォーム。
// 以前は常に先頭のフォーム（forms[0]）を起動していたため、★の設定が実行時に効いていなかった。
export const pickStartForm = <T extends { id?: string }>(forms: T[], startFormId?: string): T | undefined =>
    (startFormId ? forms.find((f) => f && f.id === startFormId) : undefined) ?? forms[0];


// ── AI接続設定のAPIキーの暗号化・復号・除去 ───────────────────
// .vjaproj（aiConfig / aiPresets[*].config）と、プロジェクト共通プリセットファイル（presets[*].config）の
// apiKeyが対象。保存時は先頭に"enc:"を付けた暗号文にし、読み込み時に平文へ戻す（画面のメモリ上は平文）。
// "enc:"が付いていない値は、以前の版で保存された平文として扱い、次の保存で暗号化される。
export const AI_KEY_PREFIX = "enc:";

const _aiKeyHolders = (proj: any): any[] =>
    [proj?.aiConfig, ...(Array.isArray(proj?.aiPresets) ? proj.aiPresets.map((p: any) => p?.config) : [])]
        .filter((o) => o && typeof o === "object");

export const encryptAiKeys = async (proj: any, encrypt: (plain: string) => Promise<string>): Promise<void> => {
    for (const h of _aiKeyHolders(proj)) {
        if (typeof h.apiKey === "string" && h.apiKey && !h.apiKey.startsWith(AI_KEY_PREFIX)) {
            h.apiKey = AI_KEY_PREFIX + await encrypt(h.apiKey);
        }
    }
};

// 復号に失敗した場合（合言葉が違う等）は、不正な値を画面へ渡さないよう空にする
export const decryptAiKeys = async (proj: any, decrypt: (b64: string) => Promise<string>): Promise<void> => {
    for (const h of _aiKeyHolders(proj)) {
        if (typeof h.apiKey === "string" && h.apiKey.startsWith(AI_KEY_PREFIX)) {
            try { h.apiKey = await decrypt(h.apiKey.slice(AI_KEY_PREFIX.length)); }
            catch { h.apiKey = ""; }
        }
    }
};

// 配布アプリへコピーする.vjaproj用。AIキーを全て空にする
export const stripAiKeys = (proj: any): void => {
    for (const h of _aiKeyHolders(proj)) {
        if (typeof h.apiKey === "string") h.apiKey = "";
    }
};

// ── クラウド認証情報の除去・「アプリ側入力」項目の値の除外 ───────────────
// 「アプリ側入力」がONの項目は、実行時に各PCの credential.json から読むので、プロジェクトには値を残さない
export const omitAppInputCredentials = (
    credentials: Record<string, any> | undefined,
    appInput: Record<string, boolean> | undefined,
): Record<string, any> => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(credentials || {})) {
        if (!appInput?.[k]) out[k] = v;
    }
    return out;
};

// 配布アプリへコピーする.vjaproj用。クラウドの認証情報の値を全て消し、全項目を「アプリ側入力」ONにする
// （配布先PCの credential.json から読む形にする）。credDefsは項目名の文字列か{name,...}のオブジェクト
export const stripCloudCredentials = (proj: any): void => {
    if (!Array.isArray(proj?.cloudInfras)) return;
    for (const inf of proj.cloudInfras) {
        if (!inf || typeof inf !== "object") continue;
        const names = new Set<string>(Object.keys(inf.credentials || {}));
        for (const cd of (Array.isArray(inf.credDefs) ? inf.credDefs : [])) {
            const n = typeof cd === "string" ? cd : cd?.name;
            if (n) names.add(n);
        }
        inf.appInput = { ...(inf.appInput || {}) };
        for (const n of names) inf.appInput[n] = true;
        inf.credentials = {};
        if ("credentialsJson" in inf) inf.credentialsJson = "";
    }
};
