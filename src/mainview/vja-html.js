/**
 * vja-html.js
 * HTML文字列組み立て用の安全なテンプレートリテラル (VJA本体の開発ツール実装専用)
 *
 * AIメモ:
 * - 目的は「VJA本体（vja-designer.js等）がinnerHTML用のHTML文字列を組み立てる際の
 *   +連結」を置き換えること。AI（Claude Code）がこの手のコードを保守する際、
 *   閉じタグの対応・クォートのネスト・エスケープ忘れを目視で追う必要があり、
 *   ハルシネーション（構造の誤認識、エスケープ漏れ）が起きやすいための対策。
 * - VJAが生成するユーザーアプリのランタイム（vja-runtime.js）とは無関係。
 *   あくまでVJA本体の開発ツールコード向け。
 * - 参考: ~/project/maachang/public/jhtml.browser.js の html/raw/escapeHtml/
 *   compile/render/renderTo を移植。$/on/state/api等のDOM操作・状態管理系は
 *   既存のvja.widget.*等と役割が重複・競合するため採用していない。
 * - 属性値は必ず " (ダブルクォート) で統一すること。escapeHtml() は ' も &#39; に
 *   エスケープするため、既存コードのように value='...' と ' で囲むと表示が壊れる。
 * - evtAttr()（vja-defs.js）の戻り値は既にエスケープ済みの安全な属性文字列なので、
 *   html`` テンプレート内に埋め込む際は必ず ${raw(evtAttr(...))} のように raw() で
 *   ラップすること（二重エスケープ防止）。
 * - compile/render/renderTo（<% %>系テンプレート構文）は、jhtml本家と異なり
 *   あえて同期版にしている。VJA本体側の呼び出し元（vja-designer.jsのrenderProps→
 *   makeProw→pinput等）が同期呼び出し前提（ネイティブのカラーピッカー等タイミング
 *   に敏感な既存実装がある）のため、AsyncFunctionではなく通常のFunctionでコンパイル
 *   している。$include（別テンプレートの非同期読み込み）のような非同期合成機能は
 *   VJAには不要なため実装していない。
 * - テンプレート文字列は src/mainview/templates/ 配下のHTMLファイルに
 *   <script type="text/vja-tpl" id="..."> で定義し、vja-templates-loader.js が
 *   起動時に同期XHRで読み込みDOMへ挿入する（index.htmlの肥大化を避けるため）。
 */

(function (global) {
    "use strict";

    // HTML特殊文字エスケープ (XSS対策)。' も &#39; にエスケープする。
    function escapeHtml(s) {
        if (s === undefined || s === null) return "";
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    // エスケープをスキップして生のHTMLを出力するためのラップオブジェクト
    function raw(value) {
        return {
            __raw: true,
            value: value === undefined || value === null ? "" : String(value),
        };
    }

    // タグ付きテンプレートリテラル: html`...`
    // 埋め込み式 ${...} を自動的に escapeHtml で安全にエスケープする。
    // raw(string) または配列が渡された場合はそのまま展開する。
    function html(strings, ...values) {
        let result = "";
        for (let i = 0; i < strings.length; i++) {
            result += strings[i];
            if (i < values.length) {
                const val = values[i];
                if (val === undefined || val === null) {
                    continue;
                } else if (Array.isArray(val)) {
                    result += val.join("");
                } else if (typeof val === "object" && val.__raw) {
                    result += val.value;
                } else {
                    result += escapeHtml(val);
                }
            }
        }
        return result;
    }

    // ${ ... } -> <%= ... %> への変換 (maachang jhtml.js 互換。DOM非依存の純粋な文字列パース)
    function analysis$braces(jhtml) {
        let ret = "";
        let c, qt, by = false, $pos = -1, braces = 0;
        const len = jhtml.length;

        for (let i = 0; i < len; i++) {
            c = jhtml[i];
            if ($pos !== -1) {
                if (qt !== undefined) {
                    if (!by && qt === c) {
                        qt = undefined;
                    }
                } else if (c === '"' || c === "'") {
                    qt = c;
                } else if (c === "{") {
                    braces++;
                } else if (c === "}") {
                    braces--;
                    if (braces === 0) {
                        ret += "<%=" + jhtml.substring($pos + 2, i) + "%>";
                        $pos = -1;
                    }
                }
            } else if (c === "$" && i + 1 < len && jhtml[i + 1] === "{") {
                if (by) {
                    ret = ret.substring(0, ret.length - 1) + "${";
                    i++;
                } else {
                    $pos = i;
                }
            } else {
                ret += c;
            }
            by = (c === "\\");
        }
        if ($pos !== -1) {
            ret += jhtml.substring($pos);
        }
        return ret;
    }

    // <% ... %> の構文解析 (maachang jhtml.js 互換。DOM非依存の純粋な文字列パース)
    function analysisJHtml(jhtml, out) {
        let c, n, start = -1, bef = 0, ret = "";
        const len = jhtml.length;
        let tagQt = undefined;
        let tagBy = false;

        for (let i = 0; i < len; i++) {
            c = jhtml[i];
            if (start !== -1) {
                if (tagQt !== undefined) {
                    if (!tagBy && c === tagQt) tagQt = undefined;
                    tagBy = (c === "\\");
                    continue;
                }
                if (c === '"' || c === "'" || c === "`") {
                    tagQt = c;
                    tagBy = false;
                    continue;
                }
                if (c === "%" && i + 1 < len && jhtml[i + 1] === ">") {
                    n = jhtml.substring(bef, start);
                    if (n.length > 0) {
                        if (ret.length !== 0) ret += "\n";
                        n = indentEnter(n);
                        n = indentQuote(n, true);
                        ret += out + '("' + n + '");\n';
                    }
                    bef = i + 2;

                    n = jhtml[start + 2];
                    if (n === "=") {
                        // エスケープ出力 <%= ... %>
                        let code = jhtml.substring(start + 3, i).trim();
                        if (code.endsWith(";")) code = code.slice(0, -1).trim();
                        if (ret.length !== 0) ret += "\n";
                        ret += out + "($escape(" + code + "));\n";
                    } else if (n === "-") {
                        // 生HTML出力 <%- ... %>
                        let code = jhtml.substring(start + 3, i).trim();
                        if (code.endsWith(";")) code = code.slice(0, -1).trim();
                        if (ret.length !== 0) ret += "\n";
                        ret += out + "(" + code + ");\n";
                    } else if (n === "#") {
                        // コメント
                    } else {
                        // JSロジック <% ... %>
                        if (ret.length !== 0) ret += "\n";
                        ret += jhtml.substring(start + 2, i).trim() + "\n";
                    }

                    start = -1;
                    tagQt = undefined;
                    tagBy = false;
                    i++; // '>' をスキップ
                }
            } else if (c === "<" && i + 1 < len && jhtml[i + 1] === "%") {
                start = i;
                i++;
            }
        }

        n = jhtml.substring(bef);
        if (n.length > 0) {
            n = indentEnter(n);
            n = indentQuote(n, true);
            if (ret.length !== 0) ret += "\n";
            ret += out + '("' + n + '");\n';
        }

        return ret;
    }

    // クォーテーションのエスケープ処理（analysisJHtmlの生成コード用）
    function indentQuote(string, dc) {
        const len = string.length;
        if (len <= 0) return string;
        const target = dc ? '"' : "'";
        let c, j, yenLen = 0, buf = "";
        for (let i = 0; i < len; i++) {
            c = string[i];
            if (c === target) {
                if (yenLen > 0) {
                    yenLen <<= 1;
                    for (j = 0; j < yenLen; j++) buf += "\\";
                    yenLen = 0;
                }
                buf += "\\" + target;
            } else if (c === "\\") {
                yenLen++;
            } else {
                if (yenLen !== 0) {
                    for (j = 0; j < yenLen; j++) buf += "\\";
                    yenLen = 0;
                }
                buf += c;
            }
        }
        if (yenLen !== 0) {
            for (j = 0; j < yenLen; j++) buf += "\\";
        }
        return buf;
    }

    // 改行のエスケープ処理（analysisJHtmlの生成コード用）
    function indentEnter(s) {
        const len = s.length;
        if (len <= 0) return s;
        let c, ret = "";
        for (let i = 0; i < len; i++) {
            c = s[i];
            if (c === "\n") {
                ret += "\\n";
            } else if (c === "\r") {
                // carriage return はスキップ
            } else {
                ret += c;
            }
        }
        return ret;
    }

    /**
     * JHTML文字列をコンパイルし、function($params) を生成する（同期版）。
     * jhtml本家はAsyncFunctionだが、VJA側の呼び出し元が同期前提のため
     * 通常のFunctionでコンパイルする（$include等の非同期機能は未実装）。
     * @param {string} jhtmlSource
     * @returns {Function} function(params): string
     */
    function compile(jhtmlSource) {
        if (typeof jhtmlSource !== "string") {
            throw new TypeError("[vja-html] compile: expected template source string");
        }
        const outFunc = "$out";
        const jsCode = analysisJHtml(analysis$braces(jhtmlSource), outFunc);

        const fn = new Function(
            "$params",
            "$escape",
            'if ($params === undefined || $params === null) { $params = {}; }\n' +
            'let _$outString = "";\n' +
            "const " + outFunc + ' = function(n) { _$outString += (n !== undefined && n !== null ? n : ""); return ' + outFunc + "; };\n" +
            "with ($params) {\n" +
            jsCode + "\n" +
            "}\n" +
            "return _$outString;\n"
        );

        return function (params) {
            return fn(params || {}, escapeHtml);
        };
    }

    // コンパイル結果キャッシュ（同一テンプレートの再コンパイルを避けるため）
    const _elementCache = new WeakMap();
    const _stringCache = new Map();

    /**
     * テンプレート（DOM要素、Element ID、またはテンプレート文字列）を指定してレンダリングする（同期版）。
     * @param {HTMLElement|string} target テンプレート要素またはID、またはテンプレート文字列
     * @param {Object} [params={}] 渡すデータオブジェクト
     * @returns {string}
     */
    function render(target, params) {
        let compiled = null;

        if (typeof target === "string") {
            const el = typeof document !== "undefined" ? document.getElementById(target) : null;
            if (el) {
                compiled = _elementCache.get(el);
                if (!compiled) {
                    compiled = compile(el.textContent || "");
                    _elementCache.set(el, compiled);
                }
            } else {
                compiled = _stringCache.get(target);
                if (!compiled) {
                    compiled = compile(target);
                    if (_stringCache.size < 500) {
                        _stringCache.set(target, compiled);
                    }
                }
            }
        } else if (target && target.nodeType) {
            compiled = _elementCache.get(target);
            if (!compiled) {
                compiled = compile(target.textContent || "");
                _elementCache.set(target, compiled);
            }
        } else {
            throw new Error("[vja-html] render: invalid target");
        }

        return compiled(params || {});
    }

    /**
     * 指定したDOM要素の innerHTML にレンダリング結果を直接反映するユーティリティ（同期版）。
     * @param {HTMLElement|string} container 表示先の親要素またはID
     * @param {HTMLElement|string} template テンプレート要素、ID、またはテンプレート文字列
     * @param {Object} [params={}]
     */
    function renderTo(container, template, params) {
        const el = typeof container === "string" ? document.getElementById(container) : container;
        if (!el) throw new Error("[vja-html] renderTo: container element not found: " + container);
        const htmlStr = render(template, params);
        el.innerHTML = htmlStr;
        return htmlStr;
    }

    /* ═══════════════════════════════════════════
        window へのエクスポート
        ─────────────────────────────────────────────
        各 <script> タグはElectrobun(Bun)のバンドラーにより
        それぞれ独立したモジュールスコープとして扱われるため、
        ファイルをまたいで関数を共有するには window オブジェクトへ
        明示的に代入する必要がある（vja-defs.js等と同様）。
    ═══════════════════════════════════════════ */
    Object.assign(global, { html, raw, escapeHtml, compile, render, renderTo });
})(window);
