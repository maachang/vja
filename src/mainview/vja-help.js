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
       定義されない（2026-10-09に実機で確認）。そのため ensureWebviewLib()（vja-defs.js）で素の<script>として
       動的に読み込む（実体は electrobun.config.ts で views/mainview/ へコピー）。
     - ヘルプ本文は src/mainview/help/*.md（1ファイル=1トピック）。help/_list.txt に表示順でファイル名を並べる。
       配信は prompts/・templates/ と同じ（electrobun.config.tsで views/mainview/help へコピー、同期XHR）。
     - 各mdの先頭 `<!-- summary: ... -->` は、将来のAI問い合わせ（目次としてAIへ渡す）用。表示時は無視される。
     - 表示は marked.parse() の出力を innerHTML へ入れる。同梱mdのみを表示し、利用者の入力は混ざらないため
       エスケープしない（vja-defs.js のmarkdownウィジェットと同じ扱い）。
     - AI質問応答（helpAsk等）: 全トピックを1つずつ0〜10で採点→最高点の本文だけで回答。経緯・測定結果・やって効果が
       無かったことは .claude/notes/remaining-issues.md のヘルプ節。採点プロンプト（prompts/help-score.sys.ja.md）と
       各mdのsummary（採点のキーワード）の文言を変えると精度が変わるため、変える時は測り直すこと。
       AI呼び出しは aiChatOnce（vja-modal.js）。runAiGenerate はローディングモーダルがヘルプ画面を閉じるため使えない。
   2026-10-09 追加。
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

// mdの先頭 `<!-- summary: ... -->` の内容（AI質問応答がトピックの採点に使うキーワード）
function _helpSummaryOf(md) {
    const m = md.match(/^<!--\s*summary:\s*([\s\S]*?)-->/);
    return m ? m[1].trim() : "";
}

// 表示・AIへの資料用に、先頭の `<!-- ... -->` コメントを除いた本文を返す
function _helpBodyOf(md) {
    return md.replace(/^<!--[\s\S]*?-->\s*/, "");
}

function _helpGetTopics() {
    if (_helpTopics) return _helpTopics;
    const files = _helpLoadText("help/_list.txt").split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#"));
    _helpTopics = files.map(file => {
        _helpMdCache[file] = _helpLoadText("help/" + file);
        return { file, title: _helpTitleOf(_helpMdCache[file], file), keywords: _helpSummaryOf(_helpMdCache[file]) };
    });
    return _helpTopics;
}

async function openHelp(file) {
    await ensureWebviewLib("./marked.umd.js", "marked");
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
        render("hp-tpl-body", { itemsHtml, attrAsk: evtAttr("onclick", "helpAsk()") }) +
        mfootHTML([{ label: "閉じる", action: "closeModal()" }]),
        "modal-yaml"
    );
    openHelpTopic(cur);
    // IME変換中のEnter（変換確定）では送信しない
    $("help-q")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); helpAsk(); }
    });
}

function openHelpTopic(file) {
    const box = $("help-content");
    if (!box) return;
    _helpAskSeq++; // 処理中の質問応答があっても、あとから本文を上書きさせない
    const md = _helpBodyOf(_helpMdCache[file] || "");
    box.innerHTML = window.marked ? window.marked.parse(md) : "<pre>" + esc(md) + "</pre>";
    box.scrollTop = 0;
    _helpHighlight(file);
}

// 表示中のトピックを一覧で強調する（fileがnullなら強調なし）
function _helpHighlight(file) {
    const topics = _helpGetTopics();
    const items = $("help-list")?.children || [];
    topics.forEach((t, i) => {
        if (items[i]) items[i].style.background = (t.file === file) ? "var(--bg3)" : "";
    });
}

/* ── AI質問応答（2026-10-09） ──
   方式: 全トピックを1つずつ「質問がどれだけ答えられるか」0〜10で採点させ（キーワード=各mdのsummary）、
   最高点のトピック（同点は最大3つ）の本文だけを資料にして回答させる。最高点が0なら「見つからない」。
   採用理由: 一覧から番号を選ばせる方式はqwen2.5-coder-7bで約60%、この採点方式は約89%（質問63問で測定）。 */

// 返答テキストから点数（0〜10）を取り出す。数字が無ければ-1
function helpParseScore(text) {
    const m = String(text || "").match(/\d+/);
    return m ? Math.min(10, parseInt(m[0], 10)) : -1;
}

// 採点結果 [{file, score}] から、回答に使うトピックのfile配列を返す。最高点が0以下なら空
function helpPickTopics(scores) {
    const max = Math.max(...scores.map(x => x.score));
    if (!(max > 0)) return [];
    return scores.filter(x => x.score === max).slice(0, 3).map(x => x.file);
}

// 質問に答える。onProgress(i, n) で採点の進み具合を通知する。
// 戻り値: { files: 回答に使ったトピックのfile配列（空=見つからない）, answer: 回答テキスト }
async function helpAnswerQuestion(question, onProgress) {
    const topics = _helpGetTopics();
    const scores = [];
    for (let i = 0; i < topics.length; i++) {
        if (onProgress) onProgress(i + 1, topics.length);
        const sys = _PROMPT_DEF.HELP_SCORE_SYS_PROMPT({ keywords: topics[i].keywords });
        const text = await aiChatOnce(sys, "質問: " + question, 0);
        scores.push({ file: topics[i].file, score: helpParseScore(text) });
    }
    const files = helpPickTopics(scores);
    if (files.length === 0) return { files: [], answer: "" };
    const docs = files.map(f => {
        const t = topics.find(x => x.file === f);
        return "■ " + t.title + "\n" + _helpBodyOf(_helpMdCache[f] || "");
    }).join("\n\n");
    const answer = await aiChatOnce(_PROMPT_DEF.HELP_ANSWER_SYS_PROMPT({ docs }), "質問: " + question, 0);
    return { files, answer };
}

let _helpAskSeq = 0; // 質問応答の世代番号（古い処理の結果で、新しい表示を上書きしないための印）
let _helpAsking = false; // 質問応答の処理中（二重送信を防ぐ。世代番号とは別に管理する）

// 質問欄の内容をAIに質問し、結果を右側の本文エリアに表示する
async function helpAsk() {
    const input = $("help-q");
    const q = (input?.value || "").trim();
    if (!q || _helpAsking) return;
    if (getProjectData().aiConfig.enabled !== true) {
        showToast("AI設定が無効です。ツールバーの「AI設定」で有効にしてください");
        return;
    }
    const seq = ++_helpAskSeq;
    _helpAsking = true;
    const btn = $("help-ask-btn"), status = $("help-status");
    if (btn) btn.disabled = true;
    try {
        const r = await helpAnswerQuestion(q, (i, n) => {
            if (seq === _helpAskSeq && status) status.textContent = "調べています… " + i + "/" + n;
        });
        if (seq !== _helpAskSeq || !$("help-content")) return; // 途中で別の操作があった/画面が閉じられた
        const box = $("help-content");
        if (r.files.length === 0) {
            box.innerHTML = render("hp-tpl-notfound", { question: q });
        } else {
            const topics = _helpGetTopics();
            const srcHtml = r.files.map(f => render("hp-tpl-src", {
                title: topics.find(t => t.file === f)?.title || f,
                attrOpen: evtAttr("onclick", "openHelpTopic(" + JSON.stringify(f) + "); return false;"),
            })).join("");
            box.innerHTML = render("hp-tpl-answer", {
                question: q,
                answerHtml: window.marked ? window.marked.parse(r.answer) : "<pre>" + esc(r.answer) + "</pre>",
                srcHtml,
            });
        }
        box.scrollTop = 0;
        _helpHighlight(null);
    } catch (e) {
        if (seq === _helpAskSeq) showToast("AI質問エラー: " + e.message);
    } finally {
        _helpAsking = false;
        if (btn) btn.disabled = false;
        if (status) status.textContent = "";
    }
}

Object.assign(window, { openHelp, openHelpTopic, helpAsk, helpParseScore, helpPickTopics, helpAnswerQuestion });
