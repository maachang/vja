// src/bun/runtime-error-snippet.ts
// 実行ウィンドウ（生成HTML）へ埋め込む、実行時エラー報告用のJSコード（文字列）。
// index.ts のフォームHTML生成（_vjaRun）が lines.push して埋め込む。
// electrobun を読み込まないので、単体で bun test できる（runtime-error-snippet.test.ts）。
//
// 【AIメモ】
// - String.raw で書いているので、正規表現のバックスラッシュは二重にしない。
//   また、この文字列中にバッククォートと「${」を書いてはならない（テンプレートリテラルが壊れる）。
// - AsyncFunctionは先頭に2行足すため、行番号は-2する（JSCのe.lineもV8のstackも同じ。
//   Bun(JSC)で実測: コード3行目の例外 → e.line=5, stackは vja://key:5:5）。
//   Windows(V8)/Macの実機は未確認。
// - JSCは非標準のe.line/e.columnを持つ。無ければstackの「vja://<key>:行:列」を読む。
// - kind: "thrown"（例外で止まった）/ "swallowed"（コード側のcatchでErrorをログ出力して続行した。
//   window._vjaLastError は最後の1件だけが残る）。
export const RUNTIME_ERROR_SNIPPET = String.raw`
function _vjaErrLocation(e) {
  var line = null, col = null;
  if (e && typeof e.line === "number") {
    line = e.line; col = typeof e.column === "number" ? e.column : null;
  } else if (e && typeof e.stack === "string") {
    var m = e.stack.match(/vja:\/\/[^\s:)]+:(\d+):(\d+)/);
    if (m) { line = parseInt(m[1], 10); col = parseInt(m[2], 10); }
  }
  if (line === null) return { line: null, column: null };
  line -= 2;
  return { line: line >= 1 ? line : null, column: col };
}
function _vjaBuildErrReport(widgetName, eventName, e, kind, code) {
  var loc = _vjaErrLocation(e);
  var lines = String(code || "").split("\n");
  var excerpt = "";
  if (loc.line) {
    var s = Math.max(0, loc.line - 4), t = Math.min(lines.length - 1, loc.line);
    excerpt = lines.slice(s, t + 1).map(function (l, i) {
      var no = s + i + 1;
      return (no === loc.line ? " > " : "   ") + String(no).padStart(3) + ": " + l;
    }).join("\n");
  }
  return {
    kind: kind, formName: window._vjaFormName || "", widgetName: widgetName, eventName: eventName,
    name: (e && e.name) || "", message: String((e && e.message) || e),
    line: loc.line, column: loc.column,
    stack: String((e && e.stack) || "").slice(0, 2000), excerpt: excerpt, time: Date.now()
  };
}
`;

// Bun側（アプリイベント OnStart/OnExit。project-runner.ts の _runAppEventCode）で実行時エラーを報告形式にする。
// 上の RUNTIME_ERROR_SNIPPET（実行ウィンドウ側の文字列JS）と同じロジックの純粋関数版。両者の出力が一致することは
// runtime-error-snippet.test.ts で確認している（片方を直したらもう片方も直すこと）。
// 【AIメモ】行補正lineOffsetは、実行コードの先頭に足した行数＋AsyncFunction自身の2行。Bun(JSC)で実測:
//   `"use strict";\n` + コード のとき、コード3行目の例外 → e.line=6（補正3）。実行ウィンドウ側は先頭2行足しなので補正2。
export const buildRuntimeErrorReport = (o: {
    formName?: string; widgetName: string; eventName: string; e: any; kind: "thrown" | "swallowed"; code: string; lineOffset: number;
}): Record<string, any> => {
    const e = o.e;
    let line: number | null = null, col: number | null = null;
    if (e && typeof e.line === "number") { line = e.line; col = typeof e.column === "number" ? e.column : null; }
    else if (e && typeof e.stack === "string") {
        const m = e.stack.match(/vja:\/\/[^\s:)]+:(\d+):(\d+)/);
        if (m) { line = parseInt(m[1], 10); col = parseInt(m[2], 10); }
    }
    if (line !== null) { line -= o.lineOffset; if (line < 1) line = null; }
    const lines = String(o.code || "").split("\n");
    let excerpt = "";
    if (line) {
        const s = Math.max(0, line - 4), t = Math.min(lines.length - 1, line);
        excerpt = lines.slice(s, t + 1).map((l, i) => {
            const no = s + i + 1;
            return (no === line ? " > " : "   ") + String(no).padStart(3) + ": " + l;
        }).join("\n");
    }
    return {
        kind: o.kind, formName: o.formName || "", widgetName: o.widgetName, eventName: o.eventName,
        name: (e && e.name) || "", message: String((e && e.message) || e),
        line, column: col,
        stack: String((e && e.stack) || "").slice(0, 2000), excerpt, time: Date.now(),
    };
};
