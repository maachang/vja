/* ═══════════════════════════════════════════════════════════════
   vja-editor-search.js — YAML/JSエディタの検索・置換
   ─────────────────────────────────────────────────────────────
   【読み込み順序】vja-yaml-editor.js より後（依存関数はいずれも
   実行時にしか呼ばれないため、スクリプトの読み込み順序そのものは
   厳密である必要はない）。
   【依存】vja-defs.js（$/showToast等）、vja-editor-utils.js
   （ensureCursorVisible/editorUndoPush）、vja-yaml-editor.js
   （editorHlUpdate、getEditorContext）
   【提供するもの】
     - editorSearch() / editorReplace() / editorReplaceAll()
   2026-09-21、肥大化したvja-yaml-editor.js（当時4915行）から
   検索・置換機能のみを切り出した（AIメモ: 分割はリスクの低い箇所から
   1ファイルずつ行う方針。詳細はCLAUDE.md参照）。
═══════════════════════════════════════════════════════════════ */

// ── エディタ内検索 ────────────────────────────────────
// 現在アクティブなエディタ（yaml-ta / js-ta）から検索ワードを探す。
// 現在のカーソル位置から次の一致箇所へ移動し、末尾まで行ったら先頭から再検索。
function editorSearch() {
    const word = $("editor-search-in")?.value || "";
    if (!word) return;

    // 現在表示中のタブ（YAML/JS）でエディタを判定
    const isJs = $("pane-js")?.classList.contains("active");
    const ta = isJs ? $("js-ta") : $("yaml-ta");
    if (!ta) { showToast("エディタが見つかりません"); return; }

    const text = ta.value;
    const lower = text.toLowerCase();
    const lword = word.toLowerCase();

    // 検索開始位置：前回と同じエディタ・同じワードなら前回の終端から、それ以外はカーソル位置から
    let startPos = 0;
    if (getEditorContext().searchLast.taId === ta.id && getEditorContext().searchLast.word === word) {
        startPos = getEditorContext().searchLast.pos;
    } else {
        startPos = ta.selectionEnd || 0;
    }

    // 現在位置から前方検索
    let idx = lower.indexOf(lword, startPos);
    let wrapped = false;

    // 末尾まで行ったら先頭から再検索（ループ）
    if (idx < 0 && startPos > 0) {
        idx = lower.indexOf(lword, 0);
        wrapped = true;
    }

    if (idx < 0) {
        showToast("「" + word + "」は見つかりません");
        getEditorContext().searchLast = { taId: ta.id, word, pos: 0 };
        return;
    }

    if (wrapped) showToast("先頭に戻りました");

    // カーソルを一致箇所に移動してフォーカス
    ta.focus();
    ta.selectionStart = idx;
    ta.selectionEnd = idx + word.length;
    ensureCursorVisible(ta);
    editorHlUpdate(ta.id);

    // 次回検索のために終端位置を記録
    getEditorContext().searchLast = { taId: ta.id, word, pos: idx + word.length };
}

// 大文字小文字を無視した単純文字列置換（正規表現は使わない）。戻り値: { result, count }
function _literalReplaceAllCI(text, word, repl) {
    if (!word) return { result: text, count: 0 };
    const lower = text.toLowerCase();
    const lword = word.toLowerCase();
    let result = "";
    let pos = 0;
    let count = 0;
    let idx;
    while ((idx = lower.indexOf(lword, pos)) >= 0) {
        result += text.slice(pos, idx) + repl;
        pos = idx + word.length;
        count++;
    }
    result += text.slice(pos);
    return { result, count };
}

// taId から対応するUndo状態を取得する（editorSearch/editorReplaceで使用するyaml-ta/js-ta限定）
function _editorUndoStateFor(taId) {
    return taId === "js-ta" ? getEditorContext().ju : getEditorContext().yu;
}

// 現在選択中の箇所が検索ワードと一致していれば置換して次の一致箇所を検索する。
// 一致していなければ（まだ検索していない場合）次の一致箇所を検索するだけ。
function editorReplace() {
    const word = $("editor-search-in")?.value || "";
    const repl = $("editor-replace-in")?.value || "";
    if (!word) return;

    const isJs = $("pane-js")?.classList.contains("active");
    const ta = isJs ? $("js-ta") : $("yaml-ta");
    if (!ta) { showToast("エディタが見つかりません"); return; }

    const s = ta.selectionStart, en = ta.selectionEnd;
    const selected = ta.value.slice(s, en);

    if (en > s && selected.toLowerCase() === word.toLowerCase()) {
        const state = _editorUndoStateFor(ta.id);
        editorUndoPush(state, ta.value, { start: s, end: en });
        ta.value = ta.value.slice(0, s) + repl + ta.value.slice(en);
        ta.selectionStart = ta.selectionEnd = s + repl.length;
        editorHlUpdate(ta.id);
        getEditorContext().searchLast = { taId: ta.id, word, pos: s + repl.length };
        editorSearch();
    } else {
        editorSearch();
    }
}

// 現在のエディタ内の検索ワードを全て置換する。
function editorReplaceAll() {
    const word = $("editor-search-in")?.value || "";
    const repl = $("editor-replace-in")?.value || "";
    if (!word) return;

    const isJs = $("pane-js")?.classList.contains("active");
    const ta = isJs ? $("js-ta") : $("yaml-ta");
    if (!ta) { showToast("エディタが見つかりません"); return; }

    const { result, count } = _literalReplaceAllCI(ta.value, word, repl);
    if (count === 0) { showToast("「" + word + "」は見つかりません"); return; }

    const state = _editorUndoStateFor(ta.id);
    editorUndoPush(state, ta.value, { start: ta.selectionStart, end: ta.selectionEnd });
    ta.value = result;
    editorHlUpdate(ta.id);
    getEditorContext().searchLast = { taId: null, word: "", pos: 0 };
    showToast(count + "件を置換しました");
}

Object.assign(window, {
    editorSearch, editorReplace, editorReplaceAll,
});
