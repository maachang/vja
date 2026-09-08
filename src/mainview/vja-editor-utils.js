/* ═══════════════════════════════════════════════════════════════
   vja-editor-utils.js — エディタ共通ユーティリティ（行番号・タブ・Undo/Redo）
   ─────────────────────────────────────────────────────────────
   【読み込み順序】5番目（vja-yaml-editor.js の直後）。
   【依存】vja-defs.js, vja-yaml-editor.js
   【提供するもの】
     - editorUpdateGutter() / editorSyncGutter()（行番号表示）
     - yamlTabSwitch()（YAML/JSタブ切替）
     - editorUndoPush() / editorUndo() / editorRedo()（エディタ内Undo/Redo）
     - editorSearch()（Ctrl+F検索）
     - jsTokenize() / yamlTokenize() 等のシンタックスハイライト
     - saveYamlData()（YAML/JS内容の保存。wid==="form"→フォーム
       イベント、wid==="appev"→アプリイベント、それ以外→ウィジェット
       イベントに分岐。saveYaml()/openFormYaml()/saveFormYaml()/
       deleteFormYaml()も本ファイルで提供）
   このファイルは vja-defs.js / vja-yaml-editor.js に依存する。
═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════
   エディタ共通ユーティリティ（行番号・タブ）
═══════════════════════════════════════════ */

// 行番号を更新
function editorUpdateGutter(taId, gutId) {
    const ta = $(taId);
    const gut = $(gutId);
    if (!ta || !gut) return;
    const lines = ta.value.split("\n").length;
    let html = "";
    for (let i = 1; i <= lines; i++) html += i + "\n";
    gut.textContent = html;
    editorSyncGutter(taId, gutId);
}

// gutterのスクロールをtextareaに同期
function editorSyncGutter(taId, gutId) {
    const ta = $(taId);
    const gut = $(gutId);
    if (!ta || !gut) return;
    gut.scrollTop = ta.scrollTop;
}

// Tab / Shift+Tab 処理

/* ── YAMLエディタ タブ切り替え ──
   任意のタブID（"yaml"/"js"/"prompt"に限らず、buildYamlEditorHTML()の
   汎用tabConfig.tabsで生成される"fd"/"fd-doc"等）に対応するため、
   tab-${id} / pane-${id} という命名規則に沿って全タブ・全ペインを
   走査してactiveクラスを付け替える汎用実装にしている ── */
function yamlTabSwitch(tab) {
    clearBracketMatch(); // 表示中のペインが切り替わるため、対応括弧ハイライトは一旦消す
    closeCompletionPopup(); // JSペイン限定の入力補完ポップアップが表示されたままにならないよう閉じる

    document.querySelectorAll(".yaml-tab").forEach((el) => el.classList.remove("active"));
    document.querySelectorAll(".yaml-pane").forEach((el) => el.classList.remove("active"));

    const targetTab = $("tab-" + tab);
    const targetPane = $("pane-" + tab);
    if (targetTab) targetTab.classList.add("active");
    if (targetPane) {
        targetPane.classList.add("active");
        // タブ切替後、自分でクリックしなくてもすぐ入力できるよう対象のテキストエリアへフォーカスを移す
        // （textarea idの命名規則はタブごとに異なる: "yaml-ta"/"js-ta"/"prompt-ta"や"ta-fd"/"ta-fd-doc"等）。
        // ペインは切替直前まで display:none のため、classList反映直後にfocus()しても
        // WebView側のレイアウト更新が間に合わず効かないことがあり、setTimeoutで1ティック遅らせる
        const ta = targetPane.querySelector("textarea.yaml");
        if (ta) setTimeout(() => ta.focus(), 0);
    }
}

/* ── JavaScript エディタ Undo（ネイティブに委譲） ── */
/* ── エディタ Undo/Redo（YAML・JS共通カスタム実装） ── */

// UNDO_DELIMITERS（区切り文字）は init-params.js で window.UNDO_DELIMITERS として定義済み

// 文字入力を伴わない、カーソル移動のみのキー（初期スナップショットの位置追跡に使用）
const EDITOR_NAV_KEYS = new Set([
    "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown",
]);

// エディタの Undo 履歴にテキスト値を積む。最大1000件保持。
// sel: そのスナップショット時点のカーソル位置 {start,end}（省略時はUndo/Redo時にカーソル位置を復元しない）
function editorUndoPush(state, val, sel) {
    state.stack = state.stack.slice(0, state.idx + 1);
    const top = state.stack[state.idx];
    if (top && top.val === val) return;
    state.stack.push({ val, sel: sel || null });
    if (state.stack.length > 1000) state.stack.shift();
    else state.idx++;
}

// エディタの Undo 状態を初期化する。モーダルオープン時に呼ぶ。
function editorUndoInit(taId, state, initVal) {
    state.stack = [{ val: initVal, sel: { start: 0, end: 0 } }];
    state.idx = 0;
    state.busy = false;
    state.inBackspaceRun = false;
    state.pushOnInput = false;
    const ta = $(taId);
    if (!ta) return;
    // Backspaceは連打（長押しリピート含む）の間は区切りとせず、
    // 連続Backspace区間の最初の1回だけを区切りとして扱う（1文字ごとに履歴が積まれるのを防ぐ）
    ta.addEventListener("keydown", function (e) {
        if (state.busy) return;
        if (e.key === "Backspace") {
            state.pushOnInput = !state.inBackspaceRun;
            state.inBackspaceRun = true;
        } else {
            state.inBackspaceRun = false;
            state.pushOnInput = UNDO_DELIMITERS.has(e.key);
        }
    });
    // 貼り付け（Ctrl+V等）は内容挿入前の状態を区切りとして積む
    // （keydown時点ではまだUNDO_DELIMITERS判定に乗らないため、pasteイベントで個別に扱う）
    ta.addEventListener("paste", function () {
        if (state.busy) return;
        editorUndoPush(state, ta.value, { start: ta.selectionStart, end: ta.selectionEnd });
        state.pushOnInput = false;
    });
    // input時に区切り文字なら保存
    ta.addEventListener("input", function () {
        if (state.busy) return;
        if (state.pushOnInput) {
            editorUndoPush(state, ta.value, { start: ta.selectionStart, end: ta.selectionEnd });
        }
    });
    // まだ一度も編集していない間（履歴が初期スナップショットのみ）は、
    // クリックやカーソル移動キーで動いた位置を初期スナップショットのカーソル位置として更新し続ける。
    // これにより「最初の編集を始める直前の位置」までUndoで正しく戻れるようにする
    // （通常の文字入力によるカーソル移動は、まだ履歴に積まれていない分だけ位置がずれるため対象外）
    const trackInitialSel = () => {
        if (state.stack.length === 1) {
            state.stack[0].sel = { start: ta.selectionStart, end: ta.selectionEnd };
        }
    };
    ta.addEventListener("mouseup", trackInitialSel);
    ta.addEventListener("keyup", function (e) {
        if (EDITOR_NAV_KEYS.has(e.key)) trackInitialSel();
    });
}

// スナップショットのカーソル位置をtextareaへ復元する。
function _editorRestoreSel(ta, entry) {
    if (!entry || !entry.sel) return;
    ta.selectionStart = Math.min(entry.sel.start, entry.val.length);
    ta.selectionEnd = Math.min(entry.sel.end, entry.val.length);
}

// エディタの Undo を実行し、ハイライトを更新する。
function editorUndo(taId, state) {
    const ta = $(taId);
    if (!ta) return;
    if (state.stack[state.idx].val !== ta.value) {
        editorUndoPush(state, ta.value, { start: ta.selectionStart, end: ta.selectionEnd });
    }
    if (state.idx <= 0) return;
    state.busy = true;
    state.idx--;
    const entry = state.stack[state.idx];
    ta.value = entry.val;
    _editorRestoreSel(ta, entry);
    editorHlUpdate(taId);
    ensureCursorVisible(ta);
    setTimeout(() => { state.busy = false; }, 50);
}

// エディタの Redo を実行し、ハイライトを更新する。
function editorRedo(taId, state) {
    if (state.idx >= state.stack.length - 1) return;
    const ta = $(taId);
    if (!ta) return;
    state.busy = true;
    state.idx++;
    const entry = state.stack[state.idx];
    ta.value = entry.val;
    _editorRestoreSel(ta, entry);
    editorHlUpdate(taId);
    ensureCursorVisible(ta);
    setTimeout(() => { state.busy = false; }, 50);
}


// ── ハイライト共通処理 ───────────────────────────
// textarea の上に重ねた hl（ハイライトレイヤー）を
// スクロール位置・サイズ同期して疑似シンタックスハイライトを実現する。

// カーソル位置が表示範囲に収まるよう textarea をスクロールする。
function ensureCursorVisible(ta) {
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    const cursorLine = ta.value.slice(0, ta.selectionStart).split("\n").length;
    const cursorTop = (cursorLine - 1) * lineHeight;
    const cursorBottom = cursorTop + lineHeight;
    if (cursorBottom > ta.scrollTop + ta.clientHeight) {
        ta.scrollTop = cursorBottom - ta.clientHeight + 8;
    } else if (cursorTop < ta.scrollTop) {
        ta.scrollTop = cursorTop;
    }
}

// textarea と hl のスクロール位置を transform で同期する。
// nowrap前提: hl は scrollWidth/scrollHeight サイズで固定し
// transform で textarea のスクロール量だけずらす。
function hlSync(taId, hlId) {
    const ta = $(taId), hl = $(hlId);
    if (!ta || !hl) return;
    hl.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
}
// hl の innerHTML をトークナイズ結果で更新し、サイズを同期する。
// tokenizeFn には yamlTokenize / jsTokenize を渡す。
function hlUpdate(taId, hlId, tokenizeFn) {
    const ta = $(taId), hl = $(hlId);
    if (!ta || !hl) return;
    hl.innerHTML = tokenizeFn(ta.value);
    // nowrap前提: 横幅のみscrollWidthに合わせる（縦はflexで固定）
    hl.style.width = ta.scrollWidth + "px";
    hlSync(taId, hlId);
}
function yamlHlUpdate() { hlUpdate("yaml-ta", "yaml-hl", yamlTokenize); }
function yamlHlSync() { hlSync("yaml-ta", "yaml-hl"); }
// シンタックスハイライト用の<span class="...">生成ヘルパー（yamlTokenize/jsTokenize共通）。
// escapeHtml()は' と "もエスケープするが、既存のescHl()（&<>のみ）と違いが出るのは
// 引用符を含むテキストのみで、表示上は&#39;/&quot;として同じ文字に描画されるため実害はない。
function _hlSpan(cls, text) {
    return render("eu-tpl-hl-span", { cls, text });
}
function yamlTokenize(text) {
    return text.split("\n").map(line => {
        // コメント行
        if (/^\s*#/.test(line)) {
            return _hlSpan("yc", line);
        }
        // キー: 値 の行
        const kvMatch = line.match(/^(\s*-?\s*)([^:\s][^:]*)(:)(\s*)(.*)?$/);
        if (kvMatch) {
            const indent = escapeHtml(kvMatch[1]);
            const key = _hlSpan("yk", kvMatch[2]);
            const colon = '<span class="yk">:</span>';
            const space = escapeHtml(kvMatch[4]);
            const val = kvMatch[5] !== undefined ? colorVal(kvMatch[5]) : '';
            return indent + key + colon + space + val;
        }
        // リスト項目 (- value)
        const listMatch = line.match(/^(\s*-\s+)(.*)?$/);
        if (listMatch) {
            return _hlSpan("ys", listMatch[1]) + colorVal(listMatch[2] || '');
        }
        // ブロックスカラー継続行（インデントのみ）
        return _hlSpan("yv", line);
    }).join("\n");
}
function colorVal(v) {
    if (!v) return '';
    if (/^#/.test(v)) return _hlSpan("yc", v);
    if (/^[|>]/.test(v)) return _hlSpan("yp", v);
    if (/^(true|false|yes|no|on|off)$/i.test(v.trim())) return _hlSpan("yd", v);
    if (/^null$/i.test(v.trim())) return _hlSpan("yd", v);
    if (/^-?[0-9]+(\.?[0-9]*)$/.test(v.trim())) return _hlSpan("yn", v);
    if (/^["']/.test(v.trim())) return _hlSpan("yv", v);
    return _hlSpan("yv", v);
}

/* ── JavaScript シンタックスハイライト ── */
function jsHlUpdate() { hlUpdate("js-ta", "js-hl", jsTokenize); }
function jsHlSync() { hlSync("js-ta", "js-hl"); }
function jsTokenize(code) {
    const KW = /^(function|return|if|else|for|while|do|switch|case|break|continue|const|let|var|new|this|typeof|instanceof|try|catch|finally|throw|await|async|of|in|class|extends|import|export|default|void|delete|yield)$/;
    const BOOL = /^(true|false|null|undefined|NaN|Infinity)$/;
    return code.split("\n").map(line => {
        // 行コメント
        if (/^\s*\/\//.test(line)) return _hlSpan("jc", line);
        let out = ""; let i = 0;
        while (i < line.length) {
            // 行コメント（途中）
            if (line[i] === "/" && line[i + 1] === "/") {
                out += _hlSpan("jc", line.slice(i));
                break;
            }
            // 文字列
            if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
                const q = line[i]; let j = i + 1;
                while (j < line.length) { if (line[j] === "\\") { j += 2; continue; } if (line[j] === q) { j++; break; } j++; }
                out += _hlSpan("js", line.slice(i, j));
                i = j; continue;
            }
            // 数値
            if (/[0-9]/.test(line[i]) && (i === 0 || !/\w/.test(line[i - 1]))) {
                let j = i; while (j < line.length && /[0-9._xXa-fA-F]/.test(line[j])) j++;
                out += _hlSpan("jn", line.slice(i, j));
                i = j; continue;
            }
            // 識別子・キーワード
            if (/[a-zA-Z_$]/.test(line[i])) {
                let j = i; while (j < line.length && /[\w$]/.test(line[j])) j++;
                const word = line.slice(i, j);
                const next = line[j];
                if (KW.test(word)) out += _hlSpan("jk", word);
                else if (BOOL.test(word)) out += _hlSpan("jb", word);
                else if (next === "(") out += _hlSpan("jf", word);
                else out += _hlSpan("jp", word);
                i = j; continue;
            }
            out += escapeHtml(line[i]); i++;
        }
        return out;
    }).join("\n");
}

// YAMLデータをウィジェットに保存する（モーダルは閉じない）。
// 保存時にjs-taの内容をPrettierで整形してから格納する（1行べた書き・
// インデント不揃いの救済。formatJsCode()はAI生成が絡まない手動編集後の
// 保存でも安全に呼べるよう、失敗時は整形前のコードをそのまま返す設計）。
async function saveYamlData(wid, evName) {
    // 保存直前に、有効化されている「利用テーブル」の状態をYAML本文へ再同期する。
    // （手動でブロックを消してしまっていても、保存時に補完される）
    if (typeof applyTableYamlSync === "function") applyTableYamlSync(wid, evName);
    const jsCode = await formatJsCode($("js-ta")?.value || "");
    if (wid === "form") {
        const f = getProjectData().forms[getProjectData().curFormIdx];
        if (!f.events) f.events = {};
        f.events[evName] = $("yaml-ta")?.value || "";
        f.events["_js_" + evName] = jsCode;
        f.events["_doc_" + evName] = $("prompt-ta")?.value || "";
        return;
    }
    if (wid === "appev") {
        if (!getProjectData().projectInfo.appEvents) getProjectData().projectInfo.appEvents = {};
        getProjectData().projectInfo.appEvents[evName + "_yaml"] = $("yaml-ta")?.value || "";
        getProjectData().projectInfo.appEvents[evName] = jsCode;
        getProjectData().projectInfo.appEvents[evName + "_doc"] = $("prompt-ta")?.value || "";
        return;
    }
    const w = getWidget(wid);
    if (!w) return;
    if (!w.events) w.events = {};
    if (!w.jsCode) w.jsCode = {};
    if (!w.docCode) w.docCode = {};
    w.events[evName] = $("yaml-ta")?.value || "";
    w.jsCode[evName] = jsCode;
    w.docCode[evName] = $("prompt-ta")?.value || "";
    renderEventsAndPush();
}
async function saveYaml(wid, evName) {
    await saveYamlData(wid, evName);
    closeModal();
}

/* ── フォームイベント編集 ── */
function openFormYaml(evName) {
    const f = getProjectData().forms[getProjectData().curFormIdx];
    if (!f.events) f.events = {};
    const cur = f.events[evName] ||
        // 空の場合はデフォルトのYAMLセット.
        _PROMPT_DEF.DEFAULT_YAML_VALUE(evName, "form");
    const curJs = f.events["_js_" + evName] || "";
    const curDoc = f.events["_doc_" + evName] || "";
    pvRegister("yamlSave", () => saveFormYaml(evName));
    pvRegister("yamlTextToYaml", () => textToYamlGenerate("form", evName));
    pvRegister("yamlAiGen", () => yamlAiGenerate("form", evName));
    pvRegister("yamlAiGenRandom", () => yamlAiGenerate("form", evName, _getBoostedTemperature()));
    pvRegister("yamlMockCheck", () => manualMockCheck(false, evName, undefined, "form"));
    pvRegister("yamlMockEdit", () => openMockOverrideEditor("form", evName));
    showModal(buildYamlEditorHTML(cur, curJs, true, mhdrHTML("📋 フォーム — " + esc(evName)), "", null, false, "form", evName, curDoc));
    initYamlEditorModal(cur, curJs, undefined, false, curDoc);
}

async function saveFormYaml(evName) {
    const f = getProjectData().forms[getProjectData().curFormIdx];
    if (!f.events) f.events = {};
    f.events[evName] = $("yaml-ta")?.value || "";
    f.events["_js_" + evName] = await formatJsCode($("js-ta")?.value || "");
    f.events["_doc_" + evName] = $("prompt-ta")?.value || "";
    closeModal();
    renderEventsAndPush();
    showToast("フォームイベントを保存しました");
}

async function deleteFormYaml(evName) {
    const f = getProjectData().forms[getProjectData().curFormIdx];
    const hasY = f.events?.[evName]?.trim().length > 0;
    if (!hasY) return;
    const dlg = await vja.app.showConfirm("「" + evName + "」のイベント定義を削除してよろしいですか？");
    if (!dlg) return;
    if (f.events) { delete f.events[evName]; delete f.events["_js_" + evName]; }
    // フォームイベントのオーバーライド（wid="form"固定）もあわせて削除する
    // （残すと二度と参照されないゴミデータになるため）。
    purgeOverridesForKey("form", evName);
    renderEventsAndPush();
}

/* ═══════════════════════════════════════════
   window へのエクスポート（他ファイルから参照される関数のみ）
═══════════════════════════════════════════ */
Object.assign(window, {
    editorUpdateGutter, editorSyncGutter, yamlTabSwitch,
    editorUndoPush, editorUndoInit, editorUndo, editorRedo,
    hlSync, hlUpdate, yamlHlUpdate, yamlHlSync, yamlTokenize,
    jsHlUpdate, jsHlSync, jsTokenize,
    colorVal, ensureCursorVisible,
    saveYamlData, saveYaml, openFormYaml, saveFormYaml, deleteFormYaml,
});
