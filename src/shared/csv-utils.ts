// src/shared/csv-utils.ts
// Bun側（src/bun/bun-utils.ts）・webview側（src/mainview/vja-runtime.js）・
// コンパイル済みアプリのブリッジ層（src/mainview/project-bridge.ts）で
// 共通利用するCSVパース処理。実行環境（Bun/ブラウザ）に依存しない純粋関数のみを置く。

// ── CSV1行パーサ（ダブルクォート対応） ───────────────────
export const parseCsvLine = (line: string): string[] => {
    const result: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
            if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (c === '"') inQ = false;
            else cur += c;
        } else {
            if (c === '"') inQ = true;
            else if (c === ',') { result.push(cur); cur = ""; }
            else cur += c;
        }
    }
    result.push(cur);
    return result;
};
