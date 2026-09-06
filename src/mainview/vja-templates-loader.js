/**
 * vja-templates-loader.js
 * src/mainview/templates/ 配下のテンプレートHTMLファイルを起動時に読み込み、
 * DOM上の非表示コンテナへ挿入するローダー (VJA本体の開発ツール実装専用)
 *
 * AIメモ:
 * - vja-html.js の render(id, params) は document.getElementById(id) でテンプレートを
 *   探すため、後続の <script> （vja-defs.js 以降）が実行される前に、必ずこのローダーで
 *   テンプレートDOMを用意しておく必要がある。
 * - VJA側の呼び出し元（renderProps→makeProw→pinput等）が同期呼び出し前提のため、
 *   fetch（非同期）ではなく同期XHR（XMLHttpRequest, async:false）で読み込む。
 * - 新しいテンプレートファイルを templates/ 配下に追加した場合、必ず下の
 *   TEMPLATE_FILES 配列にも追記すること（追記を忘れると render() が
 *   「テンプレートが見つからない」エラーになる）。
 */

(function (global) {
    "use strict";

    const TEMPLATE_FILES = [
        "templates/pinput.html",
        "templates/status.html",
        "templates/events.html",
        "templates/modal.html",
        "templates/cloud-modal.html",
        "templates/app-config.html",
        "templates/yaml-editor.html",
        "templates/table-validation.html",
    ];

    function loadTemplateFileSync(path) {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", path, false);
        xhr.send(null);
        if (xhr.status !== 0 && xhr.status !== 200) {
            console.error("[vja-templates-loader] テンプレート読み込み失敗:", path, xhr.status);
            return "";
        }
        return xhr.responseText || "";
    }

    function initVjaTemplates() {
        let container = document.getElementById("vja-templates");
        if (!container) {
            container = document.createElement("div");
            container.id = "vja-templates";
            container.style.display = "none";
            document.body.appendChild(container);
        }
        TEMPLATE_FILES.forEach((path) => {
            const html = loadTemplateFileSync(path);
            if (html) container.insertAdjacentHTML("beforeend", html);
        });
    }

    initVjaTemplates();

    /* ═══════════════════════════════════════════
        window へのエクスポート
    ═══════════════════════════════════════════ */
    Object.assign(global, { initVjaTemplates });
})(window);
