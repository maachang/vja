/* ═══════════════════════════════════════════════════════════════
   vja-editor-completion.js — YAML/JSエディタの入力補完・対応括弧ハイライト・
   キーハンドラ（Tab/Enter自動インデント・括弧自動補完・Undo/Redo等）
   ─────────────────────────────────────────────────────────────
   【読み込み順序】vja-yaml-editor.js より後（依存関数はいずれも
   実行時にしか呼ばれないため、スクリプトの読み込み順序そのものは
   厳密である必要はない）。
   【依存】vja-defs.js（$/getEditorContext/getProjectData等）、
   vja-editor-utils.js（editorUndo/editorRedo/editorUndoPush/
   ensureCursorVisible/editorUpdateGutter）、vja-yaml-editor.js
   （getVjaApiWhitelist/yamlHlUpdate/jsHlUpdate/hlUpdate等）
   【提供するもの】
     - editorKeyHandler() / editorMouseDownHandler2() / editorDblClickHandler()
     - editorHlUpdate()（ハイライト更新の共通ディスパッチャ）
     - closeCompletionPopup() / acceptCompletionAt()
     - clearBracketMatch() / updateBracketMatch()
   入力補完（vja API名/ウィジェット名の候補表示）と対応括弧ハイライトは、
   どちらもtextarea上の文字位置を画面/親要素基準の座標に変換する
   ミラーdiv計測ロジック（_createEditorMirrorDiv/_getCharScreenRect等）を
   共有しているため、1ファイルにまとめている。
   2026-09-21、肥大化したvja-yaml-editor.js（当時4915行）から分割した
   4つ目のファイル（1つ目: vja-editor-search.js、2つ目:
   vja-learned-fixes-ui.js、3つ目: vja-ai-config.js）。この移動に伴い、
   vja-yaml-editor.js側の_getVjaApiWhitelist()は、ファイルをまたいで
   呼び出す必要が生じたためgetVjaApiWhitelist()（`_`無し）へリネームした。
═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════
   JSペイン入力補完（vja API名 / ウィジェット名）
═══════════════════════════════════════════ */

// カーソル直前の「補完対象になりうる文字列」を判定する。
// 行内のクォート数が奇数（＝文字列リテラルの中）ならウィジェット名候補、
// それ以外は `vja.xxx.yyy` のようなAPI名候補として扱う。
// 戻り値: null（補完対象外） または { mode, partial, start, end }
function _getCompletionPartial(ta) {
    if (ta.selectionStart !== ta.selectionEnd) return null; // 選択中は補完しない
    const pos = ta.selectionStart;
    const v = ta.value;
    const lineStart = v.lastIndexOf("\n", pos - 1) + 1;
    const lineBefore = v.slice(lineStart, pos);
    const quoteCount = (lineBefore.match(/["']/g) || []).length;
    if (quoteCount % 2 === 1) {
        const qIdx = Math.max(lineBefore.lastIndexOf('"'), lineBefore.lastIndexOf("'"));
        const partial = lineBefore.slice(qIdx + 1);
        if (!partial) return null;
        return { mode: "widget", partial, start: lineStart + qIdx + 1, end: pos };
    }
    const m = lineBefore.match(/[\w$.]*$/);
    const partial = m ? m[0] : "";
    if (!partial || !/[a-zA-Z_$]/.test(partial[0])) return null;
    return { mode: "api", partial, start: pos - partial.length, end: pos };
}

// 現コンテキスト（フロント/バック）のvja API名一覧を取得する。
function _getCompletionApiNames(isAppEvent) {
    const wl = getVjaApiWhitelist();
    return Array.from(isAppEvent ? wl.back : wl.front);
}

// 現在のフォームのウィジェット名一覧を取得する。
function _getCompletionWidgetNames() {
    return (getProjectData().widgets || []).map((w) => w.name).filter(Boolean);
}

// js-ta の input イベントで呼ばれ、候補を絞り込んでポップアップを更新する。
function _editorCompletionOnInput(e) {
    const ta = e.target;
    const info = _getCompletionPartial(ta);
    if (!info || info.partial.length < 1) { closeCompletionPopup(); return; }

    const isAppEvent = !!getEditorContext().isAppEvent;
    const pool = info.mode === "api" ? _getCompletionApiNames(isAppEvent) : _getCompletionWidgetNames();
    const lp = info.partial.toLowerCase();
    const list = pool
        .filter((name) => info.mode === "api" ? name.toLowerCase().startsWith(lp) : name.toLowerCase().includes(lp))
        .filter((name) => name.toLowerCase() !== lp)
        .sort()
        .slice(0, 8);
    if (list.length === 0) { closeCompletionPopup(); return; }

    const comp = getEditorContext().completion;
    comp.active = true;
    comp.list = list;
    comp.sel = 0;
    comp.wordStart = info.start;
    comp.wordEnd = info.end;
    comp.mode = info.mode;
    _renderCompletionPopup(ta);
}

// 補完ポップアップのDOM要素を取得（なければ作成）する。
function _completionPopupEl() {
    let el = document.getElementById("editor-completion-pop");
    if (!el) {
        el = document.createElement("div");
        el.id = "editor-completion-pop";
        el.className = "editor-completion-pop";
        document.body.appendChild(el);
    }
    return el;
}

// カーソル位置（画面座標）を、非表示のミラーdivで文字列を計測して算出する。
// textarea上の文字位置を画面座標で計測するための、非表示のミラーdivを作成する。
// 呼び出し側でtextContent/マーカー設定・計測後、必ずdocument.bodyから除去すること。
function _createEditorMirrorDiv(ta) {
    const div = document.createElement("div");
    const cs = getComputedStyle(ta);
    ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
        "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
        "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textIndent",
    ].forEach((p) => { div.style[p] = cs[p]; });
    div.style.position = "absolute";
    div.style.visibility = "hidden";
    div.style.whiteSpace = "pre-wrap";
    div.style.wordWrap = "break-word";
    div.style.top = "0";
    div.style.left = "-9999px";
    div.style.width = ta.clientWidth + "px";
    document.body.appendChild(div);
    return div;
}

function _getCaretScreenPos(ta) {
    const div = _createEditorMirrorDiv(ta);
    div.textContent = ta.value.slice(0, ta.selectionStart);
    const marker = document.createElement("span");
    marker.textContent = "​";
    div.appendChild(marker);
    const rect = ta.getBoundingClientRect();
    const top = rect.top + marker.offsetTop - ta.scrollTop + marker.offsetHeight;
    const left = rect.left + marker.offsetLeft - ta.scrollLeft;
    document.body.removeChild(div);
    return { top, left };
}

// textarea上の指定インデックスの文字1つ分の矩形を、textareaの親（.yaml-hl-wrap/.js-hl-wrap）基準の相対座標で計測する
// （対応括弧ハイライト用。ハイライト層と同じ親の中に配置するため、画面座標ではなく親要素基準の座標が必要）。
function _getCharScreenRect(ta, idx) {
    const div = _createEditorMirrorDiv(ta);
    div.textContent = ta.value.slice(0, idx);
    const marker = document.createElement("span");
    marker.textContent = ta.value[idx] || " ";
    div.appendChild(marker);
    const top = ta.offsetTop + marker.offsetTop - ta.scrollTop;
    const left = ta.offsetLeft + marker.offsetLeft - ta.scrollLeft;
    const width = marker.offsetWidth;
    const height = marker.offsetHeight;
    document.body.removeChild(div);
    return { top, left, width, height };
}

// 候補一覧をポップアップに描画してカーソル位置の下に表示する。
function _renderCompletionPopup(ta) {
    const comp = getEditorContext().completion;
    const el = _completionPopupEl();
    el.innerHTML = comp.list.map((name, i) => render("ye-tpl-completion-item", {
        sel: i === comp.sel ? "sel" : "",
        attr: evtAttr("onmousedown", "event.preventDefault();acceptCompletionAt(" + i + ")"),
        name,
    })).join("");
    const pos = _getCaretScreenPos(ta);
    // ポップアップがテキストエリアの外（タブバー側等）にはみ出してクリックを
    // 奪わないよう、表示位置をテキストエリアの表示範囲内にクランプする
    const rect = ta.getBoundingClientRect();
    const left = Math.min(Math.max(pos.left, rect.left), rect.right - 20);
    const top = Math.min(Math.max(pos.top, rect.top), rect.bottom - 20);
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.style.display = "block";
}

// 補完ポップアップを閉じる。
function closeCompletionPopup() {
    const comp = getEditorContext().completion;
    comp.active = false;
    comp.list = [];
    const el = document.getElementById("editor-completion-pop");
    if (el) el.style.display = "none";
}

// ポップアップ内の候補をクリックで確定する。
function acceptCompletionAt(i) {
    const comp = getEditorContext().completion;
    if (!comp.active) return;
    comp.sel = i;
    const ta = $("js-ta");
    if (!ta) return;
    _acceptCompletion(ta, getEditorContext().ju);
}

// 選択中の補完候補をテキストへ挿入して確定する。
function _acceptCompletion(ta, state) {
    const comp = getEditorContext().completion;
    if (!comp.active || !comp.list.length) return;
    const name = comp.list[comp.sel];
    const v = ta.value;
    const s = comp.wordStart, en = comp.wordEnd;
    editorUndoPush(state, v, { start: ta.selectionStart, end: ta.selectionEnd });
    ta.value = v.slice(0, s) + name + v.slice(en);
    ta.selectionStart = ta.selectionEnd = s + name.length;
    editorHlUpdate(ta.id);
    closeCompletionPopup();
    ta.focus();
}

/* ── エディタ共通キーハンドラ ── */
function editorKeyHandler(e) {
    const ta = e.target;
    if (!ta) return;
    // IME変換中のキーイベントは無視（Mac等でのIME確定時の誤改行を防ぐ）
    if (e.isComposing || e.keyCode === 229) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const isJs = ta.id === "js-ta" || ta.id === "ta-extrt-js";
    const state = ta.id === "js-ta" ? getEditorContext().ju
        : ta.id === "ta-extrt-js" ? EXTRT_EDITOR.jsUndo
            : ta.id === "ta-extrt-doc" ? EXTRT_EDITOR.docUndo
                : ta.id === "ta-fd" ? FORMDESIGN_EDITOR.taUndo
                    : ta.id === "prompt-ta" ? getEditorContext().pu
                        : ta.id === "ta-fd-doc" ? FORMDESIGN_EDITOR.docUndo
                            : getEditorContext().yu;

    // ── Mac: Ctrl+C / Ctrl+V を無効化（OS側のEmacsキーバインド干渉防止）──
    if (navigator.platform.startsWith("Mac") && e.ctrlKey && !e.metaKey && (e.key === "c" || e.key === "v")) {
        e.preventDefault(); return;
    }

    // ── 入力補完ポップアップの操作（JSペインのみ）─────
    const comp = getEditorContext().completion;
    if (comp.active && ta.id === "js-ta") {
        if (e.key === "ArrowDown") {
            e.preventDefault(); comp.sel = (comp.sel + 1) % comp.list.length; _renderCompletionPopup(ta); return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault(); comp.sel = (comp.sel - 1 + comp.list.length) % comp.list.length; _renderCompletionPopup(ta); return;
        }
        if (e.key === "Tab" || e.key === "Enter") {
            e.preventDefault(); _acceptCompletion(ta, state); return;
        }
        if (e.key === "Escape") {
            e.preventDefault(); closeCompletionPopup(); return;
        }
    }

    // ── Undo / Redo ───────────────────────────────────
    if (ctrl && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault(); editorUndo(ta.id, state); return;
    }
    if ((ctrl && e.key.toLowerCase() === "z" && e.shiftKey) ||
        (ctrl && e.key.toLowerCase() === "y")) {
        e.preventDefault(); editorRedo(ta.id, state); return;
    }

    // ── 括弧/クォートの自動補完 ────────────────────────
    const AUTO_PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
    const isQuoteChar = (ch) => ch === '"' || ch === "'" || ch === "`";
    if (!ctrl && !e.altKey && Object.prototype.hasOwnProperty.call(AUTO_PAIRS, e.key)) {
        const close = AUTO_PAIRS[e.key];
        const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
        // クォートは開き=閉じが同一文字のため、直後に既に閉じ文字がある場合は
        // 新規挿入せずカーソルをその上へ移動するだけにする（スキップオーバー）
        if (isQuoteChar(e.key) && s === en && v[s] === close) {
            e.preventDefault();
            ta.selectionStart = ta.selectionEnd = s + 1;
            return;
        }
        e.preventDefault();
        editorUndoPush(state, v, { start: s, end: en });
        if (s === en) {
            ta.value = v.slice(0, s) + e.key + close + v.slice(en);
            ta.selectionStart = ta.selectionEnd = s + 1;
        } else {
            // 選択ありの場合は選択範囲を括弧/クォートで囲む
            const inner = v.slice(s, en);
            ta.value = v.slice(0, s) + e.key + inner + close + v.slice(en);
            ta.selectionStart = s + 1;
            ta.selectionEnd = s + 1 + inner.length;
        }
        editorHlUpdate(ta.id); return;
    }
    // 閉じ括弧を打った際、直後に同じ閉じ文字があればスキップオーバー
    if (!ctrl && !e.altKey && (e.key === ")" || e.key === "]" || e.key === "}")) {
        const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
        if (s === en && v[s] === e.key) {
            e.preventDefault();
            ta.selectionStart = ta.selectionEnd = s + 1;
            return;
        }
    }
    // Backspace: カーソルが自動補完で挿入した空の括弧/クォートの間にある場合はペアごと削除
    if (e.key === "Backspace" && !ctrl) {
        const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
        if (s === en && s > 0 && AUTO_PAIRS[v[s - 1]] === v[s]) {
            e.preventDefault();
            editorUndoPush(state, v, { start: s, end: en });
            ta.value = v.slice(0, s - 1) + v.slice(s + 1);
            ta.selectionStart = ta.selectionEnd = s - 1;
            editorHlUpdate(ta.id); return;
        }
    }

    // ── 行ブロック操作の共通変数取得ヘルパー ─────────
    // s/en: カーソル位置, v: テキスト全体
    // ls: 行頭, le: 行末（-1=最終行）
    const getBlock = () => {
        const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
        const ls = v.lastIndexOf("\n", s - 1) + 1;
        const le = v.indexOf("\n", en);
        return { s, en, v, ls, le };
    };
    const applyBlock = (ls, le, v, nb) => {
        ta.value = v.slice(0, ls) + nb + (le === -1 ? "" : v.slice(le));
        ta.selectionStart = ls;
        ta.selectionEnd = ls + nb.length;
    };

    // ── Tab: インデント追加 ───────────────────────────
    if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        editorUndoPush(state, ta.value, { start: ta.selectionStart, end: ta.selectionEnd });
        const { s, en, v, ls, le } = getBlock();
        if (s === en) {
            const ins = isJs ? "    " : "  ";
            ta.value = v.slice(0, s) + ins + v.slice(s);
            ta.selectionStart = ta.selectionEnd = s + ins.length;
        } else {
            const blk = v.slice(ls, le === -1 ? v.length : le);
            const ins = isJs ? "    " : "  ";
            applyBlock(ls, le, v, blk.split("\n").map(l => ins + l).join("\n"));
        }
        editorHlUpdate(ta.id); return;
    }

    // ── Ctrl+[: インデント削除 ────────────────────────
    if (e.key === "[" && ctrl) {
        e.preventDefault();
        editorUndoPush(state, ta.value, { start: ta.selectionStart, end: ta.selectionEnd });
        const { v, ls, le } = getBlock();
        const blk = v.slice(ls, le === -1 ? v.length : le);
        const dedent = isJs ? /^ {1,4}/ : /^ {1,2}/;
        applyBlock(ls, le, v, blk.split("\n").map(l => l.replace(dedent, "")).join("\n"));
        editorHlUpdate(ta.id); return;
    }

    // ── Ctrl+]: インデント追加 ────────────────────────
    if (e.key === "]" && ctrl) {
        e.preventDefault();
        editorUndoPush(state, ta.value, { start: ta.selectionStart, end: ta.selectionEnd });
        const { v, ls, le } = getBlock();
        const blk = v.slice(ls, le === -1 ? v.length : le);
        const ins = isJs ? "    " : "  ";
        applyBlock(ls, le, v, blk.split("\n").map(l => ins + l).join("\n"));
        editorHlUpdate(ta.id); return;
    }

    // ── Ctrl+/: コメントトグル ────────────────────────
    if (e.key === "/" && ctrl) {
        e.preventDefault();
        editorUndoPush(state, ta.value, { start: ta.selectionStart, end: ta.selectionEnd });
        const { v, ls, le } = getBlock();
        const blk = v.slice(ls, le === -1 ? v.length : le);
        const COM = isJs ? "// " : "# ";
        applyBlock(ls, le, v, blk.split("\n").map(l => {
            if (l.trimStart().startsWith(COM.trim())) {
                const i = l.indexOf(COM.trim());
                return l.slice(0, i) + l.slice(i + COM.length);
            }
            return COM + l;
        }).join("\n"));
        editorHlUpdate(ta.id); return;
    }

    // ── Ctrl+D: 行複製 ────────────────────────────────
    if (e.key === "d" && ctrl) {
        e.preventDefault();
        editorUndoPush(state, ta.value, { start: ta.selectionStart, end: ta.selectionEnd });
        const { v, ls, le } = getBlock();
        const line = v.slice(ls, le === -1 ? v.length : le);
        const ins = "\n" + line;
        ta.value = v.slice(0, le === -1 ? v.length : le) + ins + (le === -1 ? "" : v.slice(le));
        ta.selectionStart = ta.selectionEnd = (le === -1 ? v.length : le) + ins.length;
        editorHlUpdate(ta.id); return;
    }

    // ── Ctrl+K: 行削除 ────────────────────────────────
    if (e.key === "k" && ctrl) {
        e.preventDefault();
        editorUndoPush(state, ta.value, { start: ta.selectionStart, end: ta.selectionEnd });
        const { v, ls, le } = getBlock();
        ta.value = v.slice(0, ls) + v.slice(le === -1 ? v.length : le + 1);
        ta.selectionStart = ta.selectionEnd = ls;
        editorHlUpdate(ta.id); return;
    }

    // ── }: JS の自動 dedent ───────────────────────────
    if (e.key === "}" && isJs) {
        const { s, en, v, ls } = getBlock();
        const curLine = v.slice(ls, s);
        if (/^\s+$/.test(curLine) && curLine.length >= 4) {
            e.preventDefault();
            editorUndoPush(state, ta.value, { start: ta.selectionStart, end: ta.selectionEnd });
            const newIndent = curLine.slice(4);
            ta.value = v.slice(0, ls) + newIndent + "}" + v.slice(en);
            ta.selectionStart = ta.selectionEnd = ls + newIndent.length + 1;
            editorHlUpdate(ta.id); return;
        }
    }

    // ── Enter: 自動インデント ─────────────────────────
    if (e.key === "Enter") {
        e.preventDefault();
        editorUndoPush(state, ta.value, { start: ta.selectionStart, end: ta.selectionEnd });
        const { s, en, v, ls } = getBlock();
        const curLine = v.slice(ls, s);
        const baseIndent = curLine.match(/^(\s*)/)[1];
        let extra = "";
        if (isJs) {
            // { で終わる行 → +1段、} で始まる行 → -1段
            // コメント行（// で始まる）はインデント追加しない
            const isJsComment = curLine.trimStart().startsWith("//");
            if (!isJsComment && curLine.trimEnd().endsWith("{")) {
                extra = "    ";
            } else if (!isJsComment && curLine.trimStart().startsWith("}") && baseIndent.length >= 4) {
                const insert = "\n" + baseIndent.slice(4);
                ta.value = v.slice(0, s) + insert + v.slice(en);
                ta.selectionStart = ta.selectionEnd = s + insert.length;
                editorHlUpdate(ta.id); ensureCursorVisible(ta); return;
            }
        } else {
            // YAML Enter の動作
            const t = curLine.trimStart();
            // コメント行（# で始まる）はインデント追加しない
            const isYamlComment = t.startsWith("#");
            if (!isYamlComment && /^(-\s+)(.+)$/.test(t)) {
                // "- 内容あり" → 次行も "- " を継続
                const bullet = t.match(/^(-\s+)/)[1];
                const insert = "\n" + baseIndent + bullet;
                ta.value = v.slice(0, s) + insert + v.slice(en);
                ta.selectionStart = ta.selectionEnd = s + insert.length;
                editorHlUpdate(ta.id); ensureCursorVisible(ta); return;
            } else if (!isYamlComment && /^-\s*$/.test(t)) {
                // "- " だけの空行 → リスト終了（行を削除して通常改行）
                ta.value = v.slice(0, ls) + "\n" + v.slice(en);
                ta.selectionStart = ta.selectionEnd = ls + 1;
                editorHlUpdate(ta.id); ensureCursorVisible(ta); return;
            } else if (!isYamlComment && /:\s*$/.test(t) && !t.startsWith("-")) {
                extra = "  ";
            }
        }
        const insert = "\n" + baseIndent + extra;
        ta.value = v.slice(0, s) + insert + v.slice(en);
        ta.selectionStart = ta.selectionEnd = s + insert.length;
        editorHlUpdate(ta.id); ensureCursorVisible(ta); return;
    }
}

// ── ダブルクリック選択: 1回目mousedown後にsetTimeoutで位置確定 ──
function editorMouseDownHandler2(e) {
    const ta = e.target;
    if (!ta) return;
    const now = Date.now();
    const isFirst = (now - getEditorContext().lastMouseDown) > 300;
    getEditorContext().lastMouseDown = now;
    if (isFirst) {
        // 1回目: カーソル確定後に位置を記録
        getEditorContext().clickPos = -1;
        getEditorContext().dblPending = false;
        setTimeout(() => {
            if (!getEditorContext().dblPending) {
                getEditorContext().clickPos = ta.selectionStart;
            }
        }, 0);
    }
    // 2回目はsetTimeoutを実行しない（ブラウザ選択で上書きされるため）
}
function editorDblClickHandler(e) {
    const ta = e.target;
    if (!ta) return;
    getEditorContext().dblPending = true;
    const v = ta.value;
    const pos = getEditorContext().clickPos >= 0 ? getEditorContext().clickPos : ta.selectionStart;
    const SEP = /[\s\.\-\:\/\\,;\(\)\[\]\{\}"'`=+*&|!@#%^~<>?]/;
    let start = pos;
    let end = pos;
    while (start > 0 && !SEP.test(v[start - 1])) start--;
    while (end < v.length && !SEP.test(v[end])) end++;
    if (start === end) {
        start = pos;
        end = Math.min(pos + 1, v.length);
    }
    ta.selectionStart = start;
    ta.selectionEnd = end;
    getEditorContext().clickPos = -1;
}

// taId に対応するハイライト更新を行う共通ディスパッチャ。
// hlUpdate + editorUpdateGutter の組み合わせを ID で振り分ける。
function editorHlUpdate(taId) {
    if (taId === "yaml-ta") { yamlHlUpdate(); editorUpdateGutter("yaml-ta", "yaml-gutter"); }
    else if (taId === "js-ta") { jsHlUpdate(); editorUpdateGutter("js-ta", "js-gutter"); }
    else if (taId === "ta-extrt-js") { hlUpdate("ta-extrt-js", "hl-extrt-js", jsTokenize); editorUpdateGutter("ta-extrt-js", "gutter-extrt-js"); }
    else if (taId === "ta-extrt-doc") { hlUpdate("ta-extrt-doc", "hl-extrt-doc", yamlTokenize); editorUpdateGutter("ta-extrt-doc", "gutter-extrt-doc"); }
    else if (taId === "ta-fd") { hlUpdate("ta-fd", "hl-fd", yamlTokenize); editorUpdateGutter("ta-fd", "gutter-fd"); }
    updateBracketMatch(taId);
}

/* ═══════════════════════════════════════════
   対応括弧のハイライト
═══════════════════════════════════════════ */

// テキスト中の指定インデックスが文字列リテラル（"/'/`）の中かどうかを判定する。
function _isInsideStringLiteral(text, idx) {
    let q = null;
    for (let i = 0; i < idx; i++) {
        const c = text[i];
        if (q) { if (c === q && text[i - 1] !== "\\") q = null; }
        else if (c === '"' || c === "'" || c === "`") q = c;
    }
    return !!q;
}

// カーソル位置に隣接する括弧と、対応する括弧のインデックスを探す。
// 見つからない場合・文字列リテラルの中の場合はnullを返す。
function _findMatchingBracket(text, pos) {
    const OPEN_OF = { ")": "(", "]": "[", "}": "{" };
    const CLOSE_OF = { "(": ")", "[": "]", "{": "}" };
    let idx = -1, ch = null;
    if (CLOSE_OF[text[pos]] || OPEN_OF[text[pos]]) { idx = pos; ch = text[pos]; }
    else if (CLOSE_OF[text[pos - 1]] || OPEN_OF[text[pos - 1]]) { idx = pos - 1; ch = text[pos - 1]; }
    if (idx < 0 || _isInsideStringLiteral(text, idx)) return null;

    if (CLOSE_OF[ch]) {
        // 開き括弧: 後方（右）へ探索
        const close = CLOSE_OF[ch];
        let depth = 0;
        for (let i = idx; i < text.length; i++) {
            if (_isInsideStringLiteral(text, i)) continue;
            if (text[i] === ch) depth++;
            else if (text[i] === close) { depth--; if (depth === 0) return { a: idx, b: i }; }
        }
        return null;
    } else {
        // 閉じ括弧: 前方（左）へ探索
        const open = OPEN_OF[ch];
        let depth = 0;
        for (let i = idx; i >= 0; i--) {
            if (_isInsideStringLiteral(text, i)) continue;
            if (text[i] === ch) depth++;
            else if (text[i] === open) { depth--; if (depth === 0) return { a: i, b: idx }; }
        }
        return null;
    }
}

// ハイライト表示用のDOM要素2つ（対応する2文字分）を取得する（なければ作成）。
// シンタックスハイライト層（.yaml-hl-bg等、z-index:2）より下に表示する必要があるため、
// document.body直下ではなく、textareaと同じ親（.yaml-hl-wrap/.js-hl-wrap）の中に配置する。
function _bracketMatchEls(ta) {
    const wrap = ta.closest(".yaml-hl-wrap, .js-hl-wrap");
    if (!wrap) return null;
    const aId = "editor-bracket-a-" + ta.id;
    const bId = "editor-bracket-b-" + ta.id;
    let a = document.getElementById(aId);
    let b = document.getElementById(bId);
    if (!a) { a = document.createElement("div"); a.id = aId; a.className = "editor-bracket-match"; wrap.appendChild(a); }
    if (!b) { b = document.createElement("div"); b.id = bId; b.className = "editor-bracket-match"; wrap.appendChild(b); }
    return [a, b];
}

function _positionBracketEl(el, r) {
    el.style.top = r.top + "px";
    el.style.left = r.left + "px";
    el.style.width = r.width + "px";
    el.style.height = r.height + "px";
    el.style.display = "block";
}

// 対応括弧のハイライトを消す（存在する全editorペイン分をまとめて消す）。
function clearBracketMatch() {
    document.querySelectorAll(".editor-bracket-match").forEach((el) => { el.style.display = "none"; });
}

// taId のカーソル位置に対応する括弧ハイライトを再計算して表示/非表示を更新する。
function updateBracketMatch(taId) {
    const ta = $(taId);
    if (!ta) return;
    if (ta.selectionStart !== ta.selectionEnd) { clearBracketMatch(); return; }
    const match = _findMatchingBracket(ta.value, ta.selectionStart);
    if (!match) { clearBracketMatch(); return; }
    const els = _bracketMatchEls(ta);
    if (!els) return;
    const [elA, elB] = els;
    _positionBracketEl(elA, _getCharScreenRect(ta, match.a));
    _positionBracketEl(elB, _getCharScreenRect(ta, match.b));
}

Object.assign(window, {
    editorKeyHandler, editorMouseDownHandler2, editorDblClickHandler, editorHlUpdate,
    closeCompletionPopup, acceptCompletionAt, clearBracketMatch, updateBracketMatch,
});
