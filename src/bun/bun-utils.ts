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

