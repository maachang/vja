/* ═══════════════════════════════════════════════════════════════
   vja-help.js — ヘルプ画面（デザイナー側）
   ─────────────────────────────────────────────────────────────
   【読み込み順序】vja-runtime-errors.js の後、vja-ui.js より前。
   【依存】vja-defs.js（esc/showToast）、vja-modal.js（showModal/mhdrHTML/mfootHTML/closeModal）、
   marked.umd.js（window.marked）、templates/help.html
   【提供するもの】
     - openHelp(file?) : ヘルプ画面（左=トピック一覧、右=本文）を開く。fileを渡すとそのトピックを表示
     - openHelpTopic(file) : 開いているヘルプ画面で、右の本文を切り替える
   【AIメモ】
     - デザイナーでは index.html の <script src="./marked.umd.js"> がバンドラにCommonJS化され window.marked が
       定義されない（2026-10-09に実機で確認）。そのため _helpEnsureMarked() が素の<script>として動的に読み込む
       （実体は electrobun.config.ts で views/mainview/ へコピー）。
     - ヘルプ本文は src/mainview/help/*.md（1ファイル=1トピック）。help/_list.txt に表示順でファイル名を並べる。
       配信は prompts/・templates/ と同じ（electrobun.config.tsで views/mainview/help へコピー、同期XHR）。
     - 各mdの先頭 `<!-- summary: ... -->` は、将来のAI問い合わせ（目次としてAIへ渡す）用。表示時は無視される。
     - 表示は marked.parse() の出力を innerHTML へ入れる。同梱mdのみを表示し、利用者の入力は混ざらないため
       エスケープしない（vja-defs.js のmarkdownウィジェットと同じ扱い）。
   2026-10-09 追加（最小版: トピック4本）。
═══════════════════════════════════════════════════════════════ */

let _helpTopics = null; // [{file, title}]
const _helpMdCache = {};

function _helpLoadText(path) {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", path, false);
    xhr.send(null);
    if (xhr.status !== 0 && xhr.status !== 200) return "";
    return xhr.responseText || "";
}

// md本文の最初の「# 見出し」をトピック名にする
function _helpTitleOf(md, file) {
    const m = md.match(/^#\s+(.+)$/m);
    return m ? m[1].trim() : file;
}

function _helpGetTopics() {
    if (_helpTopics) return _helpTopics;
    const files = _helpLoadText("help/_list.txt").split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#"));
    _helpTopics = files.map(file => {
        _helpMdCache[file] = _helpLoadText("help/" + file);
        return { file, title: _helpTitleOf(_helpMdCache[file], file) };
    });
    return _helpTopics;
}

// window.markedが無ければ、素の<script>として読み込む（読み込み済みなら即解決）
function _helpEnsureMarked() {
    if (window.marked) return Promise.resolve();
    return new Promise((resolve) => {
        const sc = document.createElement("script");
        sc.src = "./marked.umd.js";
        sc.onload = () => resolve();
        sc.onerror = () => { console.error("[vja-help] marked.umd.js の読み込みに失敗"); resolve(); };
        document.head.appendChild(sc);
    });
}

async function openHelp(file) {
    await _helpEnsureMarked();
    const topics = _helpGetTopics();
    if (topics.length === 0) { showToast("ヘルプ文書を読み込めませんでした"); return; }
    const cur = file || topics[0].file;
    const itemsHtml = topics.map(t => render("hp-tpl-item", {
        title: t.title,
        style: "",
        attrOpen: evtAttr("onclick", "openHelpTopic(" + JSON.stringify(t.file) + ")"),
    })).join("");
    showModal(
        mhdrHTML("❓ ヘルプ") +
        render("hp-tpl-body", { itemsHtml }) +
        mfootHTML([{ label: "閉じる", action: "closeModal()" }]),
        "modal-yaml"
    );
    openHelpTopic(cur);
}

function openHelpTopic(file) {
    const box = $("help-content");
    if (!box) return;
    const md = (_helpMdCache[file] || "").replace(/^<!--[\s\S]*?-->\s*/, "");
    box.innerHTML = window.marked ? window.marked.parse(md) : "<pre>" + esc(md) + "</pre>";
    box.scrollTop = 0;
    // 表示中のトピックを一覧で強調する
    const topics = _helpGetTopics();
    const items = $("help-list")?.children || [];
    topics.forEach((t, i) => {
        if (items[i]) items[i].style.background = (t.file === file) ? "var(--bg3)" : "";
    });
}

Object.assign(window, { openHelp, openHelpTopic });
