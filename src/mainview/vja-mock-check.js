/* ═══════════════════════════════════════════════════════════════
   vja-mock-check.js — AI生成コードの検証・モック実行エンジン・
   スナップショット履歴・学習履歴の記録
   ─────────────────────────────────────────────────────────────
   【読み込み順序】vja-yaml-editor.js より後（依存関数はいずれも
   実行時にしか呼ばれないため、スクリプトの読み込み順序そのものは
   厳密である必要はない）。
   【依存】vja-defs.js（getProjectData/getWidget等）、
   vja-modal.js（showModal/closeModal/pushUndo/runAiGenerate）、
   vja-html.js（render/evtAttr）、vja-yaml-editor.js
   （getVjaApiWhitelist/findMissingAwaits/fixMissingAwaits/
   findUnknownWidgetNames/getApiOptState/apiOptCategoryOfApiName/
   formatJsCode/_buildGenPromptContext等）
   【提供するもの】
     - validateGeneratedJs() / annotateUnknownApis()（構文・APIホワイトリスト検証）
     - _buildFrontMock() / _buildBackMock() / _runMockSmokeTest()（モック実行エンジン）
     - manualMockCheck() / retryAiFix() / manualRetryAiFix()（手動モック実行・AI修正リトライ）
     - showAiValidationWarningBanner() / openAiValidationDetailModal() / dismissAiValidationBanner()
     - openMockOverrideEditor() / saveMockOverrides()（モック上書き値エディタ）
     - yamlRecordSnapshot() / openSnapshotHistoryModal() / restoreSnapshotHistory()（スナップショット履歴）
     - yamlPinLearnedFix() / yamlDeleteLearnedFix() / _recordLearnedFix()（学習履歴）
     - purgeOverridesForKey() / purgeOverridesForWid()（wid_evNameキー方式の6マップ共通クリーンアップ）
   2026-09-21、肥大化したvja-yaml-editor.js（当時4915行）から分割した
   5つ目のファイル（1つ目: vja-editor-search.js、2つ目:
   vja-learned-fixes-ui.js、3つ目: vja-ai-config.js、4つ目:
   vja-editor-completion.js）。この移動に伴い、検証エンジンから
   呼び出すvja-yaml-editor.js側の内部関数5つ（_findMissingAwaits/
   _fixMissingAwaits/_findUnknownWidgetNames/_getApiOptState/
   _apiOptCategoryOfApiName）を、ファイルをまたいで呼び出す必要が
   生じたため`_`無しの名前へリネームしエクスポートした。
═══════════════════════════════════════════════════════════════ */

/* ── モック上書き値（⚙ モック値を編集） ──
   分岐カバレッジの限界を補うため、ユーザーが明示的に「このウィジェットは
   この値」「このイベントはこの形」等を指定できるようにする。
   保存先: getProjectData().mockOverrides[ "wid_evName" ] = [行の配列]
   1行 = { type: "widget"|"event"|"const"|"session"|"util", target: string, json: string }
   - widget/const: targetはウィジェット名/定数名（select）。重複時は最後を採用。
   - event        : target="*"固定。複数行あれば最後を採用（マージしない）。
   - session/util : target="*"固定。複数行あれば浅くマージ（後勝ち）。
   - db操作は対象外（今回は非対応。プロンプト依存のSQL単位の複雑さを避けるため）。
   - 「その他」枠は設けない（制御が難しいため5種類のみに限定）。 */
function _getMockOverrideKey(wid, evName) {
    return wid + "_" + evName;
}
function _getMockOverrideRows(wid, evName) {
    const all = getProjectData().mockOverrides || {};
    return all[_getMockOverrideKey(wid, evName)] || [];
}
function _saveMockOverrideRows(wid, evName, rows) {
    if (!getProjectData().mockOverrides) getProjectData().mockOverrides = {};
    getProjectData().mockOverrides[_getMockOverrideKey(wid, evName)] = rows;
}

// mockOverrides/apiOptOverrides/tableOptOverrides/validationOverrides/
// mockCheckOverrides/learnedFixesの6種は、いずれも "wid_evName" 形式の
// キーで管理される（キー生成方法は_getMockOverrideKey()等と同一）。
// ウィジェット削除・イベント削除時にこれらのエントリを消し忘れると、
// 二度と参照されないゴミデータとしてプロジェクトJSONに残り続けるため、
// 削除処理側から呼び出す共通クリーンアップ関数をここにまとめる。
const OVERRIDE_MAP_NAMES = [
    "mockOverrides", "apiOptOverrides", "tableOptOverrides",
    "validationOverrides", "mockCheckOverrides", "learnedFixes", "snapshotHistory",
];
// 指定したwid・evNameの組み合わせに完全一致するキーだけを6マップから削除する
// （1イベント単位でのYAML削除時に使用）。
function purgeOverridesForKey(wid, evName) {
    const key = wid + "_" + evName;
    OVERRIDE_MAP_NAMES.forEach((name) => {
        const map = getProjectData()[name];
        if (map) delete map[key];
    });
}
// 指定したwid（ウィジェットid）で始まるキーを全て6マップから削除する
// （ウィジェット自体の削除時に使用。そのウィジェットの全イベント分の
// オーバーライドが対象になるため、evName側は問わずprefix一致で消す）。
function purgeOverridesForWid(wid) {
    const prefix = wid + "_";
    OVERRIDE_MAP_NAMES.forEach((name) => {
        const map = getProjectData()[name];
        if (!map) return;
        Object.keys(map).forEach((key) => {
            if (key.startsWith(prefix)) delete map[key];
        });
    });
}
/* ── イベント単位の「正常版」スナップショット履歴（ロールバック用） ──
   保存先: getProjectData().snapshotHistory["wid_evName"] = [
     { id, createdAt, yaml, jsCode, docCode }, ...
   ]（新しい順、最大5件）
   AI再生成でコードが悪化した場合に、ユーザーが手動で「📌 記録」した
   過去のYAML/JS/依頼文へ手動で戻せるようにするための機能。
   「正常に動作したこと」の自動判定は行わない（既存のmanualMockCheck等は
   静的検証＋浅いモック実行に過ぎず実運用の正常性を保証しないため）。
   記録・復元ともに、ユーザーの明示操作でのみ発生する。
   キー生成方式は_getMockOverrideKey()と同一（wid_evName）。 */
function _snapshotHistoryKey(wid, evName) {
    return wid + "_" + evName;
}
function _getSnapshotHistory(wid, evName) {
    return (getProjectData().snapshotHistory || {})[_snapshotHistoryKey(wid, evName)] || [];
}
function _setSnapshotHistory(wid, evName, arr) {
    if (!getProjectData().snapshotHistory) getProjectData().snapshotHistory = {};
    getProjectData().snapshotHistory[_snapshotHistoryKey(wid, evName)] = arr;
}
// 「📌 記録」ボタン。一言メモ（任意）を入力させるモーダルを開く。
function yamlRecordSnapshot(wid, evName) {
    showModal(
        mhdrHTML("📌 正常版として記録", "modal-layer-1") +
        render("ye-tpl-snapshot-record-body", {}) +
        render("ye-tpl-snapshot-record-footer", {
            footBtns: mfootHTML([{ label: "キャンセル", action: 'closeModal("modal-layer-1")' }]),
            attrSave: evtAttr("onmousedown", "doRecordSnapshot(" + JSON.stringify(wid) + "," + JSON.stringify(evName) + ")"),
        }),
        "modal-snapshot-record", "modal-layer-1"
    );
    setTimeout(() => $("snapshot-record-label")?.focus(), 0);
}
// 「記録」ボタン（メモ入力モーダル内）。現在エディタに表示中の内容
// （保存前の編集中の内容）を、入力されたメモとともに先頭に積む。
// 上限5件を超えた分は末尾（最古）から間引く。
function doRecordSnapshot(wid, evName) {
    const label = ($("snapshot-record-label")?.value || "").trim();
    const yaml = $("yaml-ta")?.value || "";
    const jsCode = $("js-ta")?.value || "";
    // 直前の記録（先頭＝最新）と比べて、YAML/JSのどちらが変わったかを
    // 記録時点で確定させておく（履歴一覧のバッジ表示用）。直前の記録が
    // 無い＝初回記録の場合は、両方とも新規扱いとする。
    const prev = _getSnapshotHistory(wid, evName)[0];
    const entry = {
        id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        createdAt: Date.now(),
        label,
        yaml,
        jsCode,
        docCode: $("prompt-ta")?.value || "",
        yamlChanged: !prev || prev.yaml !== yaml,
        jsChanged: !prev || prev.jsCode !== jsCode,
    };
    const MAX = 5;
    const next = [entry, ..._getSnapshotHistory(wid, evName)].slice(0, MAX);
    _setSnapshotHistory(wid, evName, next);
    closeModal("modal-layer-1");
    showToast("📌 現在の内容を正常版として記録しました（" + next.length + "/" + MAX + "件）");
}
// 「🕐 履歴」ボタン。記録済みの世代一覧を表示する。
function openSnapshotHistoryModal(wid, evName) {
    const list = _getSnapshotHistory(wid, evName);
    const rowsHtml = list.length === 0
        ? "<div style='padding:8px 10px;font-size:12px;color:var(--text3)'>記録された履歴はありません（「📌 記録」ボタンで現在の内容を記録できます）</div>"
        : list.map((e, idx) => render("ye-tpl-snapshot-row", {
            badges: (e.yamlChanged ? render("ye-tpl-snapshot-badge", { label: "YAML" }) : "")
                + (e.jsChanged ? render("ye-tpl-snapshot-badge", { label: "JS" }) : ""),
            label: esc(e.label || "(メモなし)"),
            date: new Date(e.createdAt).toLocaleString("ja-JP"),
            attrRestore: evtAttr("onmousedown", "restoreSnapshotHistory(" + JSON.stringify(wid) + "," + JSON.stringify(evName) + "," + idx + ")"),
            attrDelete: evtAttr("onmousedown", "deleteSnapshotHistory(" + JSON.stringify(wid) + "," + JSON.stringify(evName) + "," + idx + ")"),
        })).join("");
    showModal(
        mhdrHTML("🕐 履歴（" + esc(String(evName)) + "）", "modal-layer-1") +
        render("ye-tpl-snapshot-body", { rowsHtml }) +
        mfootHTML([{ label: "閉じる", action: 'closeModal("modal-layer-1")' }]),
        "modal-snapshot-history", "modal-layer-1"
    );
}
// 「↩ 復元」ボタン。エディタの3ペイン（YAML/JS/依頼文）を選択した世代の
// 内容へ置き換える。プロジェクトデータへの反映は行わず、既存の「保存」
// ボタン操作を経由させる（他の編集操作と同じ確定フローに統一するため）。
async function restoreSnapshotHistory(wid, evName, idx) {
    const list = _getSnapshotHistory(wid, evName);
    const entry = list[idx];
    if (!entry) return;
    const labelPart = entry.label ? "「" + entry.label + "」" : "";
    const dlg = await vja.app.showConfirm(
        labelPart + "（" + new Date(entry.createdAt).toLocaleString("ja-JP") + "）の内容に復元しますか？\n（現在編集中の内容は上書きされます。保存ボタンを押すまでプロジェクトには反映されません）"
    );
    if (!dlg) return;
    if ($("yaml-ta")) $("yaml-ta").value = entry.yaml || "";
    if ($("js-ta")) $("js-ta").value = entry.jsCode || "";
    if ($("prompt-ta")) $("prompt-ta").value = entry.docCode || "";
    yamlHlUpdate();
    jsHlUpdate();
    editorUpdateGutter("yaml-ta", "yaml-gutter");
    editorUpdateGutter("js-ta", "js-gutter");
    editorUpdateGutter("prompt-ta", "prompt-gutter");
    closeModal("modal-layer-1");
    showToast("履歴から復元しました（内容を確認のうえ保存してください）");
}
// 「🗑 削除」ボタン。
function deleteSnapshotHistory(wid, evName, idx) {
    const list = _getSnapshotHistory(wid, evName);
    list.splice(idx, 1);
    _setSnapshotHistory(wid, evName, list);
    openSnapshotHistoryModal(wid, evName);
}

// モック値編集の「JSON」欄をできるだけ寛容に解釈する。
// 1. まず厳密なJSONとして解釈を試みる（"文字列"/123/{"a":1}/true 等はこれで通る）
// 2. 失敗した場合、数値として解釈できれば数値として扱う（保険的なケース）
// 3. それでも失敗した場合は、入力された文字列をそのまま値として扱う
//    （クォート無しでの素朴な文字列入力に対応するため）
// 4. 空文字の場合のみ、未入力行として無視する（{ ok: false }）
function _parseMockJsonLenient(str) {
    const trimmed = String(str ?? "").trim();
    if (trimmed === "") return { ok: false };
    try {
        return { ok: true, value: JSON.parse(trimmed) };
    } catch (e) {
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) return { ok: true, value: Number(trimmed) };
        return { ok: true, value: trimmed };
    }
}
// 保存済みの行から、VJA_MOCK_RUNTIME.build()に渡す overrides オブジェクトを
// 組み立てる。不正なJSONの行は無視する（エラーには倒さない＝安全側）。
function _computeMockOverrides(wid, evName) {
    const rows = _getMockOverrideRows(wid, evName);
    const overrides = { widgets: {}, event: undefined, consts: {}, session: {}, util: {} };
    rows.forEach((row) => {
        const result = _parseMockJsonLenient(row.json);
        if (!result.ok) return; // 未入力行はスキップ
        const parsed = result.value;
        if (row.type === "widget" && row.target) {
            overrides.widgets[row.target] = parsed;
        } else if (row.type === "const" && row.target) {
            overrides.consts[row.target] = parsed;
        } else if (row.type === "event") {
            overrides.event = parsed; // 複数あれば最後の行が上書きするのでこれでよい
        } else if (row.type === "session") {
            Object.assign(overrides.session, parsed); // 浅いマージ（後勝ち）
        } else if (row.type === "util") {
            Object.assign(overrides.util, parsed); // 浅いマージ（後勝ち）
        }
    });
    return overrides;
}

// ── 「⚙ モック値を編集」UI ──
// 【重要・再発防止メモ】VJAのモーダル内ドロップダウンは、素の<select>タグでは
// なく makePvSel()/pvSelOpen()（vja-table-validation.js定義）という専用部品で
// 統一されている（AI接続設定の推論モードON/OFF等で使用実績あり）。
// 新しいプルダウンUIを追加する際は、必ずこれを使うこと。<select>を使うと
// 見た目が浮いてしまう不具合を過去に繰り返しているため、次にモーダル内へ
// ドロップダウンを追加する時はまずこのメモと既存のmakePvSel使用例
// （vja-yaml-editor.jsのAI接続設定、vja-app-config.jsのフォント選択等）を
// 確認すること。
// 【makePvSelの制約】表示ラベルと内部値が異なる場合（例: 表示"ウィジェット"/
// 値"widget"）、選択中の値はボタンの表示テキストからは復元できない
// （pvSelPickは表示ラベルしかDOMに残さないため）。そのため、値が必要な
// 箇所ではonPickCode経由のコールバックで data-* 属性に値を保存しておき、
// 保存時はDOMのテキストではなくdata-*属性から読み取ること
// （下記_mockEditorOnTypeChange()のdata-type属性がその実装例）。
const _MOCK_TYPE_LABELS = {
    widget: "ウィジェット", event: "イベント", const: "定数",
    session: "セッション", util: "ユーティリティ",
};
// type（モックタイプ）に応じた「対象名」欄のHTMLを生成する。
// widget/const: 実在する名前をmakePvSelで選ばせる（表示ラベル＝値なので
// 保存時もDOM表示テキストをそのまま使ってよい）。
// event/session/util: 対象名の概念を持たないため "*" 固定（非活性表示）。
function _mockEditorTargetCellHtml(type, selectedTarget, idx) {
    const targetSelId = "mock-target-" + idx;
    if (type === "widget") {
        const names = (getProjectData().widgets || []).map((w) => w.name);
        return makePvSel(targetSelId, names, selectedTarget || (names[0] || ""), "");
    }
    if (type === "const") {
        const curForm = getProjectData().forms[getProjectData().curFormIdx];
        const names = [...getProjectData().constants, ...(curForm?.constants || [])].map((c) => c.name);
        return makePvSel(targetSelId, names, selectedTarget || (names[0] || ""), "");
    }
    // event/session/util: 対象名という概念を持たないため "*" 固定（非活性表示）
    return render("ye-tpl-mock-target-fixed", { id: targetSelId });
}
// 1行分の編集行HTMLを生成する。idxは行を一意に識別するための連番
// （makePvSel等のDOM要素IDの衝突を避けるため、追加・削除しても使い回さない）。
function _mockEditorRowHtml(row, idx) {
    const type = (row && row.type) || "widget";
    const target = (row && row.target) || "";
    const json = (row && row.json) || "";
    const typeOpts = Object.keys(_MOCK_TYPE_LABELS).map((t) => ({ value: t, label: _MOCK_TYPE_LABELS[t] }));
    return render("ye-tpl-mock-row", {
        idx, type,
        typeSel: makePvSel("mock-type-" + idx, typeOpts, type, "mockEditorOnTypeChange(" + idx + ",{value})"),
        targetCell: _mockEditorTargetCellHtml(type, target, idx),
        json,
        attrRemove: evtAttr("onmousedown", "this.closest('.mock-editor-row').remove()"),
    });
}
// モックタイプが変更された時、対象名欄をそのタイプに応じたものに差し替え、
// 選択中の値（英語キー）をdata-type属性に保存する（makePvSelの制約への対応）。
function mockEditorOnTypeChange(idx, newType) {
    const row = document.querySelector(".mock-editor-row[data-idx='" + idx + "']");
    if (!row) return;
    row.dataset.type = newType;
    const wrap = document.getElementById("mock-target-wrap-" + idx);
    if (wrap) wrap.innerHTML = _mockEditorTargetCellHtml(newType, null, idx);
}
// 行を一意に識別するための連番。openMockOverrideEditor()を開く度にリセットする。
let _mockEditorRowSeq = 0;
// 「＋ 行を追加」ボタン用。既存行はそのまま保持し、末尾に空行を1つ追加する。
function mockEditorAddRow() {
    const container = $("mock-editor-rows");
    if (!container) return;
    const idx = _mockEditorRowSeq++;
    container.insertAdjacentHTML("beforeend", _mockEditorRowHtml({ type: "widget", target: "", json: "" }, idx));
}
// 「⚙ モック値を編集」ボタン用。現在保存されている上書き行を一覧表示する
// モーダルを開く。
function openMockOverrideEditor(wid, evName) {
    const rows = _getMockOverrideRows(wid, evName);
    _mockEditorRowSeq = 0;
    const rowsHtml = rows.map((row) => _mockEditorRowHtml(row, _mockEditorRowSeq++)).join("");
    showModal(
        mhdrHTML("⚙ モック値を編集（" + esc(String(evName)) + "）", "modal-layer-1") +
        render("ye-tpl-mock-editor-body", {
            rowsHtml,
            attrAdd: evtAttr("onmousedown", "mockEditorAddRow()"),
        }) +
        render("ye-tpl-mock-editor-footer", {
            footBtns: mfootHTML([{ label: "キャンセル", action: 'closeModal("modal-layer-1")' }]),
            attrSave: evtAttr("onmousedown", "saveMockOverrides(" + JSON.stringify(wid) + "," + JSON.stringify(evName) + ")"),
        }),
        "modal-mock-editor", "modal-layer-1"
    );
}
// モーダル内の全行を読み取り、プロジェクトデータに保存する。
// type: 行のdata-type属性から取得（makePvSelは表示ラベルしか残さないため）。
// target: widget/constの場合はmakePvSelのボタン表示テキスト（＝値そのもの）、
// それ以外は"*"固定。
// JSONが空の行はスキップする（不正なJSONはそのまま保存し、実行時に無視される）。
function saveMockOverrides(wid, evName) {
    const container = $("mock-editor-rows");
    const rows = [];
    container?.querySelectorAll(".mock-editor-row").forEach((rowEl) => {
        const type = rowEl.dataset.type || "widget";
        const target = (type === "widget" || type === "const")
            ? (rowEl.querySelector(".mock-target-wrap .pv-sel-btn span:first-child")?.textContent || "")
            : "*";
        const json = rowEl.querySelector(".mock-json-ta")?.value.trim() || "";
        if (!json) return;
        rows.push({ type, target, json });
    });
    _saveMockOverrideRows(wid, evName, rows);
    closeModal("modal-layer-1");
    showToast("✅ モック値を保存しました");
}

/* ── モック実行スモークテスト ──
   構文チェック・APIホワイトリスト検証では拾えない「明らかな実行時例外
   （TypeError等）」を検出するため、生成コードをモックランタイム
   （vja-mock-runtime.js）と一緒に実際に1回実行してみる。
   AI接続設定の「モック実行検証」がOFFの場合は実施しない。
   【スコープ】分岐(if/else)の全パターンは検証できない（モックは1パターンの
   値しか返さないため）。あくまで「即座に落ちないか」の浅い確認。
   ユーザーが「⚙ モック値を編集」で上書き値を指定していれば、その値が
   優先して使われるため、意図した分岐を通した確認もある程度可能。 */

// 拡張ランタイム（プロジェクト独自関数）のモックを、現在のプロジェクトの
// extRuntime.doc（EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT形式のYAML）から
// 動的に生成する。関数名だけを正規表現で抽出し、常に汎用的な非同期ダミー
// 関数を割り当てる（同期関数として呼ばれても、戻り値のPromiseの未使用
// プロパティアクセスはundefinedになるだけでクラッシュしないため問題ない）。
function _buildExtRuntimeMock() {
    const doc = getProjectData().extRuntime?.doc || "";
    const mock = {};
    const re = /^-\s*function:\s*(?:await\s+)?(\w+)\s*\(/gm;
    let m;
    while ((m = re.exec(doc)) !== null) {
        mock[m[1]] = async () => ({});
    }
    return mock;
}

// new Functionでのラップにより追加される行数のオフセット。
// new Function(...)で生成した関数は、V8/JSC共通の既知の仕様により
// 「引数リストと開き波括弧の間に改行が入る」形でソースが合成される。
// 実際には以下の3行がcode本体の前に挿入される：
//   1行目: function anonymous(vja
//   2行目: ) {
//   3行目: return (async()=>{   ← 自前で追加しているラップ行
// そのため、e.line/e.stackから取れる行番号からはこの3行分を
// 差し引く必要がある。
const _MOCK_WRAP_LINE_OFFSET = 3;

// 実行時例外オブジェクトから、可能な限り「発生行（コード上の1-indexed行番号）」
// を推定する。取得できなければnullを返す（呼び出し側は行番号なしで表示する）。
// - JavaScriptCore系（Electrobun/WKWebViewが使用）は非標準の e.line / e.column
//   プロパティを直接持つことがあるため、まずこちらを優先する。
// - 無ければ e.stack から "<anonymous>:LINE:COL" 等のパターンを正規表現で
//   抽出するフォールバックを試みる（V8系のnew Function実行時のスタック表記）。
// どちらも失敗した場合はnull（＝行番号は表示しない。誤った行番号を出す方が
// 有害なので、確信が持てない場合は出さない方針とする）。
function _extractMockErrorLine(e) {
    if (e && typeof e.line === "number" && Number.isFinite(e.line)) {
        const line = e.line - _MOCK_WRAP_LINE_OFFSET;
        return line >= 1 ? line : null;
    }
    if (e && typeof e.stack === "string") {
        const m = e.stack.match(/<anonymous>:(\d+):(\d+)/) || e.stack.match(/:(\d+):(\d+)\)?$/m);
        if (m) {
            const line = Number(m[1]) - _MOCK_WRAP_LINE_OFFSET;
            if (Number.isFinite(line) && line >= 1) return line;
        }
    }
    return null;
}

// モック実行スモークテストの最大実行時間（ミリ秒）。
// 単純なsetTimeout+Promise.raceによるタイムアウトでは、生成コードが
// while(true){}のような同期的な無限ループを含んでいた場合、UIスレッド
// （メインスレッド）自体がブロックされてタイマーコールバックすら発火せず
// 止められない。そのため実行そのものを別スレッド（Web Worker）に切り出し、
// タイムアウト時はworker.terminate()で強制終了することで確実に止める。
const _MOCK_SMOKE_TIMEOUT_MS = 3000;

// モック実行用Workerに埋め込む、vja-mock-runtime.jsの実行ロジックの複製。
// 【重要・要同期】electrobunのWebViewが使うカスタムスキームは、Worker内からの
// importScripts()によるネットワーク読み込みに対応しておらず「NetworkError: Load
// failed」で失敗するため、外部ファイル読み込みに頼らずWorkerソース文字列に
// ロジックそのものを埋め込んでいる。vja-mock-runtime.jsの_buildFrontMock() /
// _buildBackMock()を変更した場合は、必ずこちらも同じ内容に追従させること。
const _MOCK_WORKER_RUNTIME_SRC = `
function _buildFrontMock(evName, wtag, overrides, widgets) {
    const ov = overrides || {};
    const isRowClickCtx = evName === "RowClick" || (evName === "Click" && wtag === "datagrid");
    const isHeaderClickCtx = evName === "HeaderClick";
    const isKeyCtx = evName === "KeyDown" || evName === "KeyUp";
    function _widgetGetValue(name) {
        if (ov.widgets && Object.prototype.hasOwnProperty.call(ov.widgets, name)) {
            return ov.widgets[name];
        }
        const w = (widgets || []).find((ww) => ww.name === name) || null;
        const tag = w ? w.tag : null;
        if (tag === "datagrid") return [{}];
        if (tag === "checkbox" || tag === "radio") return false;
        if (tag === "progressbar" || tag === "slider" || tag === "hscroll" || tag === "vscroll") return 0;
        if (tag === "inputtype" && w?.props?.inputType === "number") return 0;
        if (tag === "qrcode" || tag === "markdown") return w?.props?.text || "";
        return "";
    }
    function _constGetValue(name) {
        if (ov.consts && Object.prototype.hasOwnProperty.call(ov.consts, name)) {
            return ov.consts[name];
        }
        return "";
    }
    function _sessionGetValue(key) {
        if (ov.session && Object.prototype.hasOwnProperty.call(ov.session, key)) {
            return ov.session[key];
        }
        return "";
    }
    function _utilValue(fnName, fallback) {
        if (ov.util && Object.prototype.hasOwnProperty.call(ov.util, fnName)) {
            return ov.util[fnName];
        }
        return fallback;
    }
    return {
        widget: {
            get: (name) => _widgetGetValue(name),
            set: () => {},
            getValue: (name) => _widgetGetValue(name),
            setValue: () => {},
            setItems: () => {},
            setSuggestions: () => {},
            setTableData: () => {},
            getAllInputs: () => ({}),
            setVisible: () => {},
            show: () => {},
            hide: () => {},
            enable: () => {},
            disable: () => {},
        },
        const: {
            get: (name) => _constGetValue(name),
            getAll: () => ({}),
        },
        form: {
            navigate: async () => {},
            back: () => {},
            setParam: () => {},
            getParam: () => "",
        },
        session: {
            get: async (key) => _sessionGetValue(key),
            set: async () => true,
            delete: async () => true,
            clear: async () => true,
        },
        util: {
            today: () => _utilValue("today", "2000-01-01"),
            formatDate: () => _utilValue("formatDate", "2000-01-01"),
            formatNumber: () => _utilValue("formatNumber", "0"),
            parseDate: () => _utilValue("parseDate", new Date("2000-01-01")),
            parseNumber: () => _utilValue("parseNumber", 0),
            uuid: () => _utilValue("uuid", "00000000-0000-0000-0000-000000000000"),
            copyToClipboard: async () => {},
        },
        io: {
            openCsv: async () => [{}],
            openJson: async () => ({}),
            saveCsv: async () => {},
            saveJson: async () => {},
        },
        file: {
            read: async () => "",
            write: async () => true,
            readBytes: async () => new Uint8Array(),
            writeBytes: async () => true,
            exists: async () => true,
            delete: async () => true,
            copy: async () => true,
        },
        dir: {
            create: async () => true,
            delete: async () => true,
            list: async () => [],
            exists: async () => true,
        },
        notify: {
            toast: () => {},
        },
        trigger: {
            click: () => {},
            focus: () => {},
            blur: () => {},
            change: () => {},
            mouseDown: () => {},
            mouseUp: () => {},
            mouseEnter: () => {},
            mouseLeave: () => {},
            scroll: () => {},
        },
        event: {
            get: () => {
                if (ov.event !== undefined) return ov.event;
                if (isRowClickCtx) return { type: "rowClick", row: 0, column: "" };
                if (isHeaderClickCtx) return { type: "headerClick", column: "" };
                const t = evName ? evName.charAt(0).toLowerCase() + evName.slice(1) : "";
                return { type: t };
            },
            getKey: () => (isKeyCtx ? "Enter" : null),
            getKeyCode: () => (isKeyCtx ? 13 : null),
            isEnter: () => isKeyCtx,
            isEscape: () => isKeyCtx,
            isShift: () => isKeyCtx,
            isCtrl: () => isKeyCtx,
        },
        http: {
            get: async () => ({}),
            post: async () => ({}),
            put: async () => ({}),
            delete: async () => ({}),
        },
        fetch: async () => ({}),
        ui: {
            loading: () => {},
        },
        app: {
            showDialog: async () => {},
            showConfirm: async () => true,
            closeWindow: () => {},
        },
        crypto: {
            encrypt: async () => "",
            decrypt: async () => "",
            sha1: async () => "0".repeat(40),
            sha256: async () => "0".repeat(64),
            sha512: async () => "0".repeat(128),
        },
        getCloudInfraCredential: async () => ({}),
        validate: {
            run: async () => true,
        },
        db: {
            query: async () => [{}],
            execute: async () => ({ changes: 0, lastInsertRowid: 0 }),
            transaction: async () => true,
            backup: async () => {},
            restore: async () => {},
        },
        log: {
            info: () => {},
            warn: () => {},
            error: () => {},
        },
    };
}
function _buildBackMock() {
    return {
        db: {
            query: () => [{}],
            execute: () => ({ changes: 0, lastInsertRowid: 0 }),
            clearTable: () => {},
            importCsv: async () => {},
            importJson: async () => {},
        },
        session: {
            get: () => "",
            set: () => true,
            delete: () => true,
            clear: () => true,
        },
        log: {
            info: () => {},
            warn: () => {},
            error: () => {},
        },
    };
}
self.VJA_MOCK_RUNTIME = {
    build(isAppEvent, evName, wtag, overrides, widgets) {
        return isAppEvent ? _buildBackMock() : _buildFrontMock(evName, wtag, overrides, widgets);
    },
};
`;

// モック実行用Workerのソースを1回だけ生成しBlob URL化してキャッシュする。
let _mockWorkerUrl = null;
function _getMockWorkerUrl() {
    if (_mockWorkerUrl) return _mockWorkerUrl;
    const src = [
        _MOCK_WORKER_RUNTIME_SRC,
        "self.onmessage = async (ev) => {",
        "  const { code, isAppEvent, evName, wtag, overrides, widgets, extNames } = ev.data;",
        "  let capturedError = null;",
        // 生成コードが「業務上想定内のエラー」として自ら throw new Error(...) した
        // ものを、TypeError等の「本当のバグに起因する例外」と区別するため、
        // 生成コードの実行スコープ内だけ Error を専用サブクラスにすり替える。
        // これにより catch(e){ console.error(e.message, e); ... } のような
        // VJA推奨の書き方（prompt-def.js記載）が、Mockのダミーデータにより
        // 必ず異常系分岐を通ってしまう場合でも、誤って失敗判定されなくなる。
        // 一方、catchされずに外へ漏れた例外は（意図的なErrorであっても）
        // 「投げっぱなしで拾っていない」バグとして引き続き失敗扱いにする。
        "  class _VjaMockThrownError extends Error {};",
        "  const mockConsole = {",
        "    log: () => {}, info: () => {}, warn: () => {},",
        "    error: (...a) => {",
        "      const errArg = a.find((x) => x instanceof Error && !(x instanceof _VjaMockThrownError));",
        "      if (errArg) capturedError = errArg;",
        "    },",
        "  };",
        "  try {",
        "    const vjaMock = self.VJA_MOCK_RUNTIME.build(isAppEvent, evName, wtag, overrides, widgets);",
        // extMockは「関数名だけの一覧から、常に{}を返す非同期関数を生成する」だけの
        // 単純なものなので、関数そのもの(構造化複製不可)ではなく名前のみ受け取り
        // Worker内で組み立て直す。
        "    const extValues = extNames.map(() => (async () => ({})));",
        "    const fn = new Function('vja', ...extNames, 'console', 'Error', 'return (async()=>{\\n' + code + '\\n})()');",
        "    await fn(vjaMock, ...extValues, mockConsole, _VjaMockThrownError);",
        "    if (capturedError) {",
        "      postMessage({ ok: false, caught: true, message: capturedError.message || String(capturedError), line: capturedError.line, stack: capturedError.stack });",
        "    } else {",
        "      postMessage({ ok: true });",
        "    }",
        "  } catch (e) {",
        "    postMessage({ ok: false, message: (e && e.message) ? e.message : String(e), line: e && e.line, stack: e && e.stack });",
        "  }",
        "};",
    ].join("\n");
    _mockWorkerUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    return _mockWorkerUrl;
}

// 生成コードをモックランタイムと共に実際に1回実行し、実行時例外が
// 発生しないかを確認する。例外が無ければnull、あれば
// { message: 例外メッセージ, line: 推定行番号（取れない場合はnull） } を返す。
//
// 【try/catchで握りつぶされたエラーの検出について】
// 実プロジェクト実行時（project-bridge.ts / src/bun/index.ts の
// window._vjaLastError 方式）と同じ考え方で、生成コード内で
// 「console.error(e)」のようにErrorオブジェクトがログ出力された場合、
// それを実行スコープ限定のモック用console経由で検知し、たとえ
// try/catchで握りつぶされて例外が外に投げられなくても、エラーとして扱う。
//
// 【実行をWeb Workerに分離している理由】
// 生成コードは実行前提が「未検証のAI生成コード」であり、意図しない無限ループ
// （while(true){}等）を含む可能性がある。メインスレッドで直接new Function()
// 実行すると、そのままUI全体がフリーズし復帰不能になる。Web Worker内で実行すれば、
// タイムアウト時にterminate()でスレッドごと強制終了できるため、無限ループでも
// UIは固まらず、エディタ側にタイムアウトエラーとして通知できる。
async function _runMockSmokeTest(code, isAppEvent, evName, wtag, wid) {
    if (getProjectData().aiConfig.mockCheckEnabled === false) return null;
    if (typeof Worker === "undefined") return null; // Worker非対応環境では検証をスキップ
    const overrides = wid !== undefined ? _computeMockOverrides(wid, evName) : undefined;
    const extMock = _buildExtRuntimeMock();
    const extNames = Object.keys(extMock);
    const widgets = getProjectData().widgets || [];

    let worker;
    try {
        worker = new Worker(_getMockWorkerUrl());
    } catch (e) {
        return null; // Worker生成に失敗した場合は検証をスキップ（既存の構文/API検証は別途行われる）
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            worker.terminate();
            resolve(result);
        };
        const timer = setTimeout(() => {
            finish({ message: "モック実行がタイムアウトしました（無限ループの可能性があります）", line: null, timeout: true });
        }, _MOCK_SMOKE_TIMEOUT_MS);
        worker.onmessage = (ev) => {
            const r = ev.data;
            if (!r || r.ok) {
                finish(null);
                return;
            }
            finish({
                message: r.message,
                line: _extractMockErrorLine({ line: r.line, stack: r.stack }),
                caught: r.caught === true,
            });
        };
        worker.onerror = (ev) => {
            finish({ message: ev.message || "モック実行中に不明なエラーが発生しました", line: null });
        };
        worker.postMessage({ code, isAppEvent, evName, wtag, overrides, widgets, extNames });
    });
}

// 構文チェックのみ行う（実行はしない）。
// async関数本体として構文解析させることで、トップレベルawaitを許容しつつ
// 実際にコードが実行されることは無い（関数を生成するだけで呼び出さない）。
function _checkJsSyntax(code) {
    try {
        new Function("return async function(){\n" + code + "\n}");
        return null;
    } catch (e) {
        return e.message || String(e);
    }
}

// コード内の vja.*/console.* 呼び出しを走査し、ホワイトリストに
// 存在しないもの、または「無効化された任意APIカテゴリ」に属するものを
// 行番号付きで検出する。
// 戻り値: [{ line: 1-indexed行番号, api: "vja.xxx.yyy", reason: "unknown"|"disabled" }, ...]
function _findUnknownApis(code, isAppEvent, disabledCategories) {
    const whitelist = isAppEvent ? getVjaApiWhitelist().back : getVjaApiWhitelist().front;
    const lines = code.split("\n");
    const found = [];
    const seen = new Set(); // 同一行・同一APIの重複検出を防ぐ
    const re = /\b((?:vja(?:\.\w+)+)|(?:console\.\w+))\s*\(/g;
    lines.forEach((line, idx) => {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(line)) !== null) {
            const api = m[1];
            const key = idx + ":" + api;
            if (seen.has(key)) continue;
            if (!whitelist.has(api)) {
                seen.add(key);
                found.push({ line: idx + 1, api, reason: "unknown" });
                continue;
            }
            // ホワイトリストには存在するが、このイベントで任意カテゴリが
            // 無効化されている場合はエラー扱いにする（フロントのみ対象）
            if (!isAppEvent && disabledCategories && disabledCategories.size > 0) {
                const category = apiOptCategoryOfApiName(api);
                if (category && disabledCategories.has(category)) {
                    seen.add(key);
                    found.push({ line: idx + 1, api, reason: "disabled", category });
                }
            }
        }
    });
    return found;
}

// VJAのイベント処理コードとして構造的に禁止されているパターンを検出する。
// システムプロンプト（prompt-def.js）で明示的に禁止している構造の中でも、
// 機械的に検出可能なものを対象とする。
// 戻り値: [{ line: 1-indexed行番号, message: string }, ...]
const _FORBIDDEN_PATTERNS = [
    { re: /\brequire\s*\(/, message: "require() の使用（VJAではNode.js形式のrequireは使用できません）" },
    { re: /\bmodule\.exports\b/, message: "module.exports の使用（VJAではモジュール構文は不要です）" },
    { re: /^\s*(?:async\s+)?function\s+\w+\s*\(/, message: "ヘルパー関数の定義（インライン記述ルール違反。関数定義は禁止されています）" },
    { re: /\.then\s*\(/, message: ".then() の使用（Promiseチェーンは禁止。awaitを使用してください）" },
    { re: /\.catch\s*\(/, message: ".catch() の使用（Promiseチェーンは禁止。try/catchとawaitを使用してください）" },
    { re: /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/, message: "window.alert/confirm/prompt の使用（VJAではvja.app.showDialog/showConfirmを使用してください）" },
    { re: /\bwindow\.location\b/, message: "window.location の使用（画面遷移はvja.form.navigate()のみ使用してください）" },
    { re: /\bnew\s+Promise\s*\(/, message: "new Promise() の使用（Promiseの明示的な生成は禁止。awaitを使用してください）" },
    { re: /\baddEventListener\s*\(/, message: "addEventListener() の使用（VJAではイベント登録は不要。処理は直接記述してください）" },
    { re: /\bcrypto\.subtle\b/, message: "crypto.subtle の使用（VJAではハッシュ化にvja.crypto.sha1/sha256/sha512を、暗号化/復号にvja.crypto.encrypt/decryptを使用してください）" },
];
function _findForbiddenPatterns(code) {
    const lines = code.split("\n");
    const found = [];
    lines.forEach((line, idx) => {
        _FORBIDDEN_PATTERNS.forEach(({ re, message }) => {
            if (re.test(line)) found.push({ line: idx + 1, message });
        });
    });
    return found;
}

// ウィジェットのイベント名（GotFocus等）と、それに対応する vja.trigger.* の
// メソッド名（focus等）の対応表。vja.trigger.*は「値変更/クリック/フォーカス」
// 等の限られた種類しか発火できないため、対応の無いイベント名
// （KeyDown/RowClick/Load等）はここに含めない＝自己再発火の判定対象外になる。
const _EVNAME_TO_TRIGGER_NAME = {
    Click: "click",
    MouseDown: "mouseDown",
    MouseUp: "mouseUp",
    MouseEnter: "mouseEnter",
    MouseLeave: "mouseLeave",
    GotFocus: "focus",
    LostFocus: "blur",
    TextChanged: "change",
    CheckedChanged: "change",
    SelectedIndexChanged: "change",
    ValueChanged: "change",
    Scroll: "scroll",
};

// 生成コードが「自分自身と同じウィジェット・同じイベント」を vja.trigger.* で
// 再度発火させていないかを検出する（無限ループの原因になるため）。
// 例: btnLoginのClickイベントJS内で vja.trigger.click('btnLogin') を呼ぶと、
// clickイベントが再度発火→再度JSが実行→再度発火…と無限ループになる。
function _findSelfTriggerRecursion(code, wid, evName) {
    if (!wid || !evName) return [];
    const w = getWidget(wid);
    if (!w) return [];
    const selfTriggerName = _EVNAME_TO_TRIGGER_NAME[evName];
    if (!selfTriggerName) return [];
    const found = [];
    const re = /\bvja\.trigger\.(\w+)\s*\(\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(code)) !== null) {
        const [, triggerEvName, triggerWidgetName] = m;
        if (triggerWidgetName === w.name && triggerEvName === selfTriggerName) {
            const line = code.slice(0, m.index).split("\n").length;
            found.push({
                line,
                message: "無限ループの危険: 自分自身（" + w.name + "の" + evName + "イベント）を vja.trigger." + triggerEvName + "() で再度発火させています",
            });
        }
    }
    return found;
}

// 変数宣言スタイル（var/let/const）の警告を検出する。
// フロントエンド: varのみ許可（let/constは違反）
// バックエンド: constのみ禁止（letは許可）
// 【注意】これは検出のみを行い、AIへの自動修正リトライ・validation.ok判定には
// 含めない（コメント挿入のみ。理由: 生成コードは毎回新規スコープで実行される
// ため実害が無く、また小型モデルは指摘してもvarに直しきれないことが多く、
// リトライしても改善しないケースがほとんどのため）。
function _findStyleWarnings(code, isAppEvent) {
    const lines = code.split("\n");
    const found = [];
    const re = isAppEvent ? /\bconst\s+\w/ : /\b(?:let|const)\s+\w/;
    lines.forEach((line, idx) => {
        if (re.test(line)) {
            found.push({
                line: idx + 1,
                message: isAppEvent
                    ? "変数宣言スタイル: constの使用（バックエンドではletのみ推奨）"
                    : "変数宣言スタイル: let/constの使用（フロントエンドではvarのみ推奨）",
            });
        }
    });
    return found;
}

// let/const を var に機械的に変換する（_findStyleWarnings と対象を揃える）。
// フロントエンドはlet/const両方、バックエンドはconstのみを変換対象とする。
function _convertStyleWarningsToVar(code, isAppEvent) {
    return isAppEvent
        ? code.replace(/\bconst(\s+\w)/g, "var$1")
        : code.replace(/\b(?:let|const)(\s+\w)/g, "var$1");
}

// vja.widget.get()/getValue() で取得した変数への誤った ".value" アクセスを
// 機械的に除去する。vja.widget.get系は常に展開済みの生の値
// （string/number/boolean/配列）を直接返す設計であり、DOM要素のように
// .value プロパティで包まれることは無い（小型ローカルLLMがWebフロントエンド
// 一般の element.value パターンを誤って踏襲してしまうケースの救済策）。
// 対象は「vja.widget.get(Value)()の戻り値を代入した変数」への直接の
// ".value"アクセスのみ（例: 変数[0].value のような添字経由のアクセスは、
// datagridの列名が偶然"value"であるケース等と区別できないため対象外）。
function stripWidgetValueAccess(code) {
    const declRe = /\b(?:var|let|const)\s+(\w+)\s*=\s*vja\.widget\.get(?:Value)?\s*\(/g;
    const names = new Set();
    let m;
    while ((m = declRe.exec(code)) !== null) names.add(m[1]);
    let result = code;
    names.forEach((name) => {
        const valueRe = new RegExp("\\b" + escapeRegExp(name) + "\\.value\\b", "g");
        result = result.replace(valueRe, name);
    });
    return result;
}

// このイベント(evName/wtag)で vja.event.get().type に入り得る「正しい値」を
// 機械的に算出する。不明な場合はnullを返す（チェック対象外）。
function _expectedEventTypes(evName, wtag) {
    if (!evName) return null;
    if (evName === "RowClick") return ["rowClick"];
    if (evName === "HeaderClick") return ["headerClick"];
    if (evName === "Click" && wtag === "datagrid") return ["rowClick", "headerClick"];
    return [evName.charAt(0).toLowerCase() + evName.slice(1)];
}

// vja.event.get()の戻り値の.typeと、実際にはあり得ない値を比較しているケースを
// 検出する（例: KeyUpイベント用のコードなのに ev.type === 'keyDown' と誤記する）。
// 正規表現による2段階抽出:
//   1. "var/let/const 変数名 = vja.event.get()" から代入先変数名を特定
//   2. "変数名.type === '値'" の比較を全て抜き出し、期待値と照合
// 【制約】分割代入や、比較の左右が逆（'値' === 変数名.type）のケースは対象外。
function _findEventTypeMismatch(code, evName, wtag) {
    const expected = _expectedEventTypes(evName, wtag);
    if (!expected) return [];
    const found = [];
    const declRe = /\b(?:var|let|const)\s+(\w+)\s*=\s*vja\.event\.get\s*\(\s*\)/g;
    let dm;
    while ((dm = declRe.exec(code)) !== null) {
        const varName = dm[1];
        const cmpRe = new RegExp("\\b" + varName + "\\.type\\s*(?:===|==)\\s*['\"]([^'\"]+)['\"]", "g");
        let cm;
        while ((cm = cmpRe.exec(code)) !== null) {
            const actual = cm[1];
            if (!expected.includes(actual)) {
                const line = code.slice(0, cm.index).split("\n").length;
                found.push({ line, expected, actual });
            }
        }
    }
    return found;
}

// 現在の任意API有効化状態から「無効化されているカテゴリ」の集合を算出する。
// バックエンド（isAppEvent）は対象外（常に空集合＝全カテゴリ利用可能）。
// 「event」カテゴリがロック対象のイベント（KeyDown/KeyUp/RowClick/HeaderClick）の
// 場合は、保存状態に関わらず常に有効（＝無効化対象から除外）として扱う。
function _getDisabledApiCategories(wid, evName, isAppEvent) {
    if (isAppEvent || !wid || !evName) return new Set();
    const labels = _PROMPT_DEF.VJA_FRONT_API_OPTIONAL_LABELS || {};
    const allCategories = Object.keys(labels);
    const enabled = new Set(getApiOptState(wid, evName) || []);
    const disabled = new Set(allCategories.filter(c => !enabled.has(c)));
    if (isEventCategoryLocked(evName)) disabled.delete("event");
    return disabled;
}

// 生成コードを検証する。戻り値: { ok, syntaxError, unknownApis, forbiddenPatterns, ... }
function validateGeneratedJs(code, isAppEvent, evName, wtag, wid) {
    const syntaxError = _checkJsSyntax(code);
    const disabledCategories = _getDisabledApiCategories(wid, evName, isAppEvent);
    const unknownApis = _findUnknownApis(code, isAppEvent, disabledCategories);
    const forbiddenPatterns = _findForbiddenPatterns(code).concat(_findSelfTriggerRecursion(code, wid, evName));
    const missingAwaits = findMissingAwaits(code, isAppEvent);
    const unknownWidgets = findUnknownWidgetNames(code);
    const eventTypeMismatches = _findEventTypeMismatch(code, evName, wtag);
    // styleWarnings（変数宣言スタイル）はNG判定・自動リトライの対象に含めない。
    // 実害が無く、リトライしても改善しないことが多いため、
    // 行コメントでの指摘のみに留める。
    const styleWarnings = _findStyleWarnings(code, isAppEvent);
    return {
        ok: !syntaxError && unknownApis.length === 0 && forbiddenPatterns.length === 0
            && missingAwaits.length === 0 && unknownWidgets.length === 0 && eventTypeMismatches.length === 0,
        syntaxError, unknownApis, forbiddenPatterns, missingAwaits, unknownWidgets, eventTypeMismatches, styleWarnings,
    };
}

// 未知API・禁止パターンが検出された行の末尾に、指摘コメントを挿入する。
// （構文エラーは行の特定精度が低いため、行コメント挿入の対象外とする）
function annotateUnknownApis(code, unknownApis, forbiddenPatterns, missingAwaits, unknownWidgets, styleWarnings, eventTypeMismatches) {
    const byLine = new Map();
    (unknownApis || []).forEach(({ line, api, reason }) => {
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line).push(
            reason === "disabled"
                ? "無効化されたAPI: " + api + " は、このイベントでは無効化されています（右パネルの「利用API」で有効にしてください）"
                : "未知のAPI: " + api + " は存在しません（VJAランタイムを確認してください）"
        );
    });
    (forbiddenPatterns || []).forEach(({ line, message }) => {
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line).push(message);
    });
    (missingAwaits || []).forEach(({ line, api }) => {
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line).push("await漏れ: " + api + " はawaitが必要です");
    });
    (unknownWidgets || []).forEach(({ line, api, name }) => {
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line).push("未知のウィジェット名: " + api + "('" + name + "') は現在のフォームに存在しません");
    });
    (eventTypeMismatches || []).forEach(({ line, expected, actual }) => {
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line).push("ev.typeの比較値'" + actual + "'は、このイベントではあり得ません（正しくは" + expected.map((e) => "'" + e + "'").join(" または ") + "）");
    });
    (styleWarnings || []).forEach(({ line, message }) => {
        if (!byLine.has(line)) byLine.set(line, []);
        byLine.get(line).push(message);
    });
    if (byLine.size === 0) return code;
    return code.split("\n").map((lineText, idx) => {
        const msgs = byLine.get(idx + 1);
        if (!msgs) return lineText;
        return lineText + "  // ⚠ " + msgs.join(" / ");
    }).join("\n");
}

// 「🎲 ランダム性を上げて再生成」ボタン用のtemperatureを決定する。
// 現在の設定値に+0.3した値を返す（未設定の場合は0.7固定）。
// 上限は一般的なAPIの上限に合わせ2.0でクランプする。
// プロジェクト設定自体（aiConfig.temperature）は書き換えない、その場限りの上書き。
function getBoostedTemperature() {
    const t = getProjectData().aiConfig.temperature;
    if (t === "" || t == null) return 0.7;
    const n = Number(t);
    return Number.isFinite(n) ? Math.min(n + 0.3, 2) : 0.7;
}

// 検証NG時、AIに修正を依頼するためのユーザープロンプトを組み立てる。
// 元のユーザープロンプト＋検出した問題点＋直前の生成コードを添えて、
// 修正後のコードのみを出力するよう指示する。
// 検証結果を、デバッグログ出力用の人間可読な文字列に整形する。
// リトライが発生した際、「なぜリトライされたか」を画面のログから
// 確認できるようにするためのもの。
function formatValidationIssuesForLog(validation) {
    const parts = [];
    if (validation.syntaxError) parts.push("構文エラー: " + validation.syntaxError);
    validation.unknownApis.forEach(({ line, api, reason }) => parts.push(line + "行目: " + (reason === "disabled" ? "無効化されたAPI " : "未知のAPI ") + api));
    validation.forbiddenPatterns.forEach(({ line, message }) => parts.push(line + "行目: " + message));
    validation.missingAwaits.forEach(({ line, api }) => parts.push(line + "行目: await漏れ " + api));
    validation.unknownWidgets.forEach(({ line, api, name }) => parts.push(line + "行目: 未知のウィジェット名 " + name + "（" + api + "）"));
    if (validation.mockError) parts.push((validation.mockError.caught ? "モック実行(catchで捕捉): " : "モック実行例外: ") + (validation.mockError.line ? validation.mockError.line + "行目: " : "") + validation.mockError.message);
    return parts.length > 0 ? parts.join(" / ") : "(詳細なし)";
}

function buildAiFixPrompt(originalUserPrompt, code, validation) {
    const issues = [];
    if (validation.syntaxError) issues.push("- 構文エラー: " + validation.syntaxError);
    validation.unknownApis.forEach(({ line, api, reason }) => {
        if (reason === "disabled") {
            issues.push("- " + line + "行目付近: API \"" + api + "\" は、このイベントでは現在無効化されています。このAPIを使用せず、有効化されているAPIの範囲内で実装してください。");
        } else {
            issues.push("- " + line + "行目付近: 存在しないAPI \"" + api + "\" が使用されています。VJAランタイムに実在するAPIのみを使用してください。");
        }
    });
    validation.forbiddenPatterns.forEach(({ line, message }) => {
        issues.push("- " + line + "行目付近: " + message);
    });
    validation.missingAwaits.forEach(({ line, api }) => {
        issues.push("- " + line + "行目付近: \"" + api + "\" はawaitを付けて呼び出す必要があります（await漏れ）。");
    });
    validation.unknownWidgets.forEach(({ line, api, name }) => {
        issues.push("- " + line + "行目付近: \"" + api + "('" + name + "')\" のウィジェット名 \"" + name + "\" は現在のフォームに存在しません。実在するウィジェット名に修正してください。");
    });
    (validation.eventTypeMismatches || []).forEach(({ line, expected, actual }) => {
        issues.push("- " + line + "行目付近: ev.type === '" + actual + "' は誤りです。このイベントで実際にあり得る値は " + expected.map((e) => "'" + e + "'").join(" または ") + " のみです。");
    });
    if (validation.mockError) {
        const lineNote = validation.mockError.line ? (validation.mockError.line + "行目付近: ") : "";
        const caughtNote = validation.mockError.caught
            ? "モック実行時、try/catchで捕捉されconsole.error()に渡されたエラーが検出されました: "
            : "モック実行時に例外が発生しました: ";
        issues.push("- " + caughtNote + lineNote + validation.mockError.message + "（ダミー値での試験実行のため、実際の実行結果とは異なる場合がありますが、コードの構造に問題がある可能性が高いです）");
    }
    return originalUserPrompt +
        "\n\n[自動検証で以下の問題が検出されました。問題を修正し、修正後のコードのみを出力してください]\n" +
        issues.join("\n") +
        "\n\n[検出時のコード]\n```javascript\n" + code + "\n```";
}

// 【設計方針】以前はここに「直前のAI生成時のプロンプト」をキャッシュして
// 修正リトライ時に使い回していたが、ローカルLLM実行は高速・単体PC利用が
// 前提のためキャッシュの必要性が薄く、逆に「キャッシュが無いと機能が
// 使えない」「生成後に設定を変えても古いプロンプトのまま」といった問題の
// 元になっていた。そのためキャッシュ自体を廃止し、必要な時に毎回
// buildGenPromptContext()で最新の状態から組み立て直す方式に統一した。

// 検証NG（構文エラー・未知API・禁止パターン）の内容をまとめた警告バナーを、
// 現在開いているYAMLエディタモーダルの左ペイン上部に表示する。
// トーストと異なり、ユーザーが閉じるまで表示され続ける。
// wid/evName/isAppEvent/isFormEventは、「もう一度AIに修正を依頼」ボタンから
// manualRetryAiFix()を呼ぶ際に必要な情報（プロンプトはその場で組み立て直す
// ため、キャッシュではなくこれらの識別情報だけ渡せばよい）。
function showAiValidationWarningBanner(validation, wid, evName, isAppEvent, isFormEvent) {
    const left = document.querySelector(".yaml-editor-left");
    if (!left) return;
    const old = document.getElementById("ai-validation-banner");
    if (old) old.remove();
    const banner = document.createElement("div");
    banner.id = "ai-validation-banner";
    const retryArgs = "'" + wid + "','" + evName + "'," + !!isAppEvent + "," + !!isFormEvent;
    const retryBtnHtml = render("ye-tpl-validation-retry-btn", {
        attr: evtAttr("onmousedown", "manualRetryAiFix(" + retryArgs + ")"),
    });
    if (validation.ok) {
        // 検証OK：バナーは自動で消さず、再修正を依頼できる状態のまま維持する
        banner.style.cssText = "background:#2a4a2e;color:#d8ffe0;padding:10px 14px;font-size:12px;border-bottom:1px solid #3a7a4a;flex-shrink:0";
        banner.innerHTML = render("ye-tpl-validation-ok-banner", {
            retryBtnHtml,
            attrDismiss: evtAttr("onmousedown", "dismissAiValidationBanner()"),
        });
        left.insertBefore(banner, left.firstChild);
        return;
    }
    const items = [];
    if (validation.syntaxError) items.push("・構文エラーの可能性: " + esc(validation.syntaxError));
    validation.unknownApis.forEach(({ line, api, reason }) => {
        items.push(
            reason === "disabled"
                ? "・" + line + "行目付近: 無効化されたAPI「" + esc(api) + "」（右パネルの「利用API」で有効にできます）"
                : "・" + line + "行目付近: 未知のAPI「" + esc(api) + "」"
        );
    });
    validation.forbiddenPatterns.forEach(({ line, message }) => {
        items.push("・" + line + "行目付近: " + esc(message));
    });
    validation.missingAwaits.forEach(({ line, api }) => {
        items.push("・" + line + "行目付近: await漏れ「" + esc(api) + "」");
    });
    validation.unknownWidgets.forEach(({ line, api, name }) => {
        items.push("・" + line + "行目付近: 未知のウィジェット名「" + esc(name) + "」（" + esc(api) + "）");
    });
    (validation.eventTypeMismatches || []).forEach(({ line, expected, actual }) => {
        items.push("・" + line + "行目付近: ev.typeの値「" + esc(actual) + "」はあり得ません（正しくは " + expected.map((e) => "「" + esc(e) + "」").join(" または ") + "）");
    });
    if (validation.mockError) {
        const lineNote = validation.mockError.line ? (validation.mockError.line + "行目付近: ") : "";
        const label = validation.mockError.caught ? "・catchで捕捉されたエラー" : "・モック実行時に例外が発生";
        items.push(label + ": " + lineNote + esc(validation.mockError.message));
    }
    // 検出件数が多い場合、バナーの高さが際限なく伸びてエディタ領域（ガター等）の
    // 表示を崩すことがあるため、一覧部分は最大高さ＋内部スクロールに固定する。
    // さらに、全件を落ち着いて確認したい場合向けに別モーダル表示も用意する。
    _lastAiValidationItems = items;
    const MAX_INLINE_ITEMS = 6;
    const showDetailBtn = items.length > MAX_INLINE_ITEMS
        ? render("ye-tpl-validation-detail-btn", {
            attr: evtAttr("onmousedown", "openAiValidationDetailModal()"),
            count: items.length,
        })
        : "";
    banner.style.cssText = "background:#4a2a2a;color:#ffd8d8;padding:10px 14px;font-size:12px;border-bottom:1px solid #7a3a3a;flex-shrink:0;max-height:220px;display:flex;flex-direction:column";
    banner.innerHTML = render("ye-tpl-validation-ng-banner", {
        count: items.length,
        showDetailBtn,
        itemsHtml: items.join("\n"),
        retryBtnHtml,
        attrDismiss: evtAttr("onmousedown", "dismissAiValidationBanner()"),
    });
    left.insertBefore(banner, left.firstChild);
}
// 警告バナーの一覧が多い場合の、全件確認用モーダル。
// 直前に表示したバナーの内容（_lastAiValidationItems）をそのまま表示する。
let _lastAiValidationItems = [];
function openAiValidationDetailModal() {
    showModal(
        mhdrHTML("⚠ 検出内容（全" + _lastAiValidationItems.length + "件）") +
        render("ye-tpl-validation-detail-body", { itemsHtml: _lastAiValidationItems.join("\n") }) +
        mfootHTML([{ label: "閉じる", action: "closeModal()" }])
    );
}
function dismissAiValidationBanner() {
    document.getElementById("ai-validation-banner")?.remove();
}
// 警告バナーの「もう一度AIに修正を依頼」ボタン用。
// リトライ実行前に、前回付与済みの検証チェック処理の自動挿入行を取り除く。
// （manualRetryAiFixは複数回呼ばれ得るため、無いと呼ぶたびに二重・三重に
//   挿入されてしまう）
/* ── プロジェクト単位の学習履歴（AI修正で直った過去の間違い） ──
   保存先: getProjectData().learnedFixes["wid_evName"] = [
     { id, createdAt, mistakeSummary, pinned, recurCount }, ...
   ]
   1イベントあたり最大3件。人間への確認は行わず、以下の間接シグナルのみで
   自動的に淘汰する（「👍 役に立った」で明示的にpinしたものは淘汰対象外）。
   - 記録後、同種の問題（mistakeSummary一致）が2回再発 → 自動削除（効いていない）
   - 再発しなければそのまま残る（効いている、とみなす） */
function _learnedFixesKey(wid, evName) {
    if (wid === "global") return "global";
    if (wid === "tag") return "tag_" + evName;
    return wid + "_" + evName;
}
function getLearnedFixes(wid, evName) {
    return (getProjectData().learnedFixes || {})[_learnedFixesKey(wid, evName)] || [];
}
function _setLearnedFixes(wid, evName, arr) {
    if (!getProjectData().learnedFixes) getProjectData().learnedFixes = {};
    getProjectData().learnedFixes[_learnedFixesKey(wid, evName)] = arr;
}
// AI修正（manualRetryAiFix）が成功した直後に、修正前の問題内容を1件記録する。
// 同一内容が既にあれば追加しない。上限5件を超える分は、pinned以外の最古から間引く。
// また同一タグの複数ウィジェットで同様の修正が記録された場合は、タグ共有ルール(tag_<tagName>)に自動昇格する。
function _recordLearnedFix(wid, evName, mistakeSummary) {
    if (!mistakeSummary || mistakeSummary === "(詳細なし)") return;
    let list = getLearnedFixes(wid, evName);
    if (!list.some(e => e.mistakeSummary === mistakeSummary)) {
        list = [...list, {
            id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
            createdAt: Date.now(), mistakeSummary, pinned: false, recurCount: 0, scope: "event",
        }];
        const MAX = 5;
        while (list.length > MAX) {
            const idx = list.findIndex(e => !e.pinned);
            if (idx === -1) break;
            list.splice(idx, 1);
        }
        _setLearnedFixes(wid, evName, list);
        window.vja?.log?.debug?.("[学習履歴] 記録: " + wid + "_" + evName + " → " + mistakeSummary);
    }

    // タグ単位への自動昇格チェック
    const w = typeof getWidget === "function" ? getWidget(wid) : null;
    if (w && w.tag) {
        const tagKey = "tag_" + w.tag;
        let tagList = getLearnedFixes("tag", w.tag);
        // 他の同一タグで同種エラーが記録されているか判定
        const allFixes = getProjectData().learnedFixes || {};
        let tagOccurrences = 0;
        for (const [k, arr] of Object.entries(allFixes)) {
            if (k.startsWith("tag_")) continue;
            if (arr.some(e => e.mistakeSummary === mistakeSummary)) {
                tagOccurrences++;
            }
        }
        if (tagOccurrences >= 2 && !tagList.some(e => e.mistakeSummary === mistakeSummary)) {
            tagList = [...tagList, {
                id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
                createdAt: Date.now(), mistakeSummary: `[${w.tag}共通] ${mistakeSummary}`, pinned: true, recurCount: 0, scope: "tag",
            }];
            _setLearnedFixes("tag", w.tag, tagList);
            window.vja?.log?.debug?.("[学習履歴] タグ共通ルールへ自動昇格: tag_" + w.tag + " → " + mistakeSummary);
        }
    }
}
// 生成・検証のたびに呼び、今回の失敗が過去に記録した「直したはずの間違い」と
// 同じ内容であれば再発とみなしrecurCountを+1する。3回再発したエントリは
// 「効いていない」と判断し、pinned以外は自動的に削除する。
function trackLearnedFixRecurrence(wid, evName, mistakeSummary) {
    if (!mistakeSummary || mistakeSummary === "(詳細なし)") return;
    const keysToCheck = [_learnedFixesKey(wid, evName)];
    const w = typeof getWidget === "function" ? getWidget(wid) : null;
    if (w && w.tag) keysToCheck.push(_learnedFixesKey("tag", w.tag));
    keysToCheck.push(_learnedFixesKey("global", "all"));

    for (const key of keysToCheck) {
        const allFixes = getProjectData().learnedFixes || {};
        const curArr = allFixes[key];
        if (!curArr || curArr.length === 0) continue;
        let changed = false;
        let list = curArr.map(e => {
            if (!mistakeSummary.includes(e.mistakeSummary) && !e.mistakeSummary.includes(mistakeSummary)) return e;
            changed = true;
            return { ...e, recurCount: (e.recurCount || 0) + 1 };
        });
        if (changed) {
            list = list.filter(e => e.pinned || (e.recurCount || 0) < 3);
            allFixes[key] = list;
            window.vja?.log?.debug?.("[学習履歴] 再発検知: key=" + key + " → " + mistakeSummary);
        }
    }
}
// 「👍 役に立った」ボタン。以後、再発しても自動削除の対象外にする。
function yamlPinLearnedFix(wid, evName, id) {
    const list = getLearnedFixes(wid, evName).map(e => e.id === id ? { ...e, pinned: true } : e);
    _setLearnedFixes(wid, evName, list);
}
function yamlDeleteLearnedFix(wid, evName, id) {
    const list = getLearnedFixes(wid, evName).filter(e => e.id !== id);
    _setLearnedFixes(wid, evName, list);
}
// イベント固有、タグ共通、プロジェクト共通の学習履歴をプロンプト用に統合生成する
function buildLearnedFixesCtx(wid, evName) {
    const w = typeof getWidget === "function" ? getWidget(wid) : null;
    const tag = w?.tag;

    const eventList = getLearnedFixes(wid, evName);
    const tagList = tag ? getLearnedFixes("tag", tag) : [];
    const globalList = getLearnedFixes("global", "all");

    const sections = [];
    if (globalList.length > 0) {
        sections.push("【プロジェクト全体ルール】\n" + globalList.map(e => "- " + e.mistakeSummary).join("\n"));
    }
    if (tagList.length > 0) {
        sections.push(`【${tag} ウィジェット共通の注意点】\n` + tagList.map(e => "- " + e.mistakeSummary).join("\n"));
    }
    if (eventList.length > 0) {
        sections.push(`【${wid}.${evName} の過去の修正箇所】\n` + eventList.map(e => "- " + e.mistakeSummary).join("\n"));
    }

    if (sections.length === 0) return "";
    return "## 過去に学習したプロジェクト固有の注意点（以下を固く遵守し、同じ間違いを繰り返さないこと）\n"
        + sections.join("\n\n");
}


// 警告バナーの「もう一度AIに修正を依頼」ボタン用。
// リトライ実行前に、前回付与済みの検証チェック処理の自動挿入行を取り除く。
// （manualRetryAiFixは複数回呼ばれ得るため、無いと呼ぶたびに二重・三重に
//   挿入されてしまう）
function _stripValidationWrapper(code, validationName) {
    if (!validationName) return code;
    const prefix = "// 検証チェック処理(自動追加).\n" +
        `if (!await vja.validate.run(${JSON.stringify(validationName)})) return;\n\n`;
    return code.startsWith(prefix) ? code.slice(prefix.length) : code;
}

// 「🧪 モック実行」ボタン用。現在js-taに表示されている内容（AI生成直後・
// 人間が手で修正した後のどちらでも可）に対して、AI生成を伴わずに
// 検証（構文・API・await漏れ・ウィジェット名・ev.type・モック実行）だけを行う。
async function manualMockCheck(isAppEvent, evName, wtag, wid) {
    const jsTa = $("js-ta");
    let code = jsTa?.value || "";
    if (!code.trim()) { showToast("JavaScriptが入力されていません"); return; }
    if (!(await vja.app.showConfirm("モックの実行を行います。よろしいですか？"))) return;
    const strippedCode = fixMissingAwaits(stripWidgetValueAccess(code), isAppEvent);
    if (strippedCode !== code && jsTa) {
        code = strippedCode;
        jsTa.value = code;
        jsHlUpdate();
        editorUpdateGutter("js-ta", "js-gutter");
    }
    let validation = validateGeneratedJs(code, isAppEvent, evName, wtag, wid);
    validation = await augmentWithMockCheck(validation, code, isAppEvent, evName, wtag, wid);
    if (validation.code && validation.code !== code && jsTa) {
        jsTa.value = validation.code;
        jsHlUpdate();
        editorUpdateGutter("js-ta", "js-gutter");
    }
    window.vja?.log?.debug?.("[AI検証] 手動モック実行: " + formatValidationIssuesForLog(validation));
    if (validation.ok) {
        dismissAiValidationBanner();
        showToast("✅ モック実行OK（問題は検出されませんでした）");
        return;
    }
    // プロンプトはmanualRetryAiFix側でその場で組み立て直すため、
    // AI生成を1度も行っていない状態（手書きコードのみ）でも
    // 「もう一度AIに修正を依頼」ボタンを常に表示できる。
    trackLearnedFixRecurrence(wid, evName, formatValidationIssuesForLog(validation));
    showAiValidationWarningBanner(validation, wid, evName, isAppEvent, wid === "form");
}

// 警告バナーの「もう一度AIに修正を依頼」ボタン用。
// プロンプトはキャッシュを使い回さず、呼ばれるたびに_buildGenPromptContext()で
// 現在の状態から組み立て直す（生成後に設定を変えていても最新の内容が使われる）。
// 手動修正依頼（manualRetryAiFix）のロジック本体（DOM非依存）。
// 自動テスト用（bridge.tsのtestManualRetryAiFixハンドラ）に、DOM読み書き
// （js-taへの読み書き・タブ切替・モーダル再描画）と分離してある。
// buildGenPromptContext()自体は$("yaml-ta")/$("ai-prompt-in")を読むため、
// 意味のあるコンテキストで検証したい場合は事前にopenYaml等でエディタを開いておく必要がある
// （テスト用: wizardGenerateFormYaml等と同様、この間接的なDOM依存はテスト時も許容する）。
// 戻り値: { alreadyOk, normalizedCode, code, revalidated? }（revalidatedはAI修正を実行した場合のみ）。
async function retryAiFix(wid, evName, isAppEvent, isFormEvent, currentCode) {
    const { sysPrompt, userPrompt, validationName, wtag } = buildGenPromptContext(wid, evName, isAppEvent, isFormEvent);
    let code = _stripValidationWrapper(currentCode || "", validationName);
    code = fixMissingAwaits(stripWidgetValueAccess(code), isAppEvent);

    let validation = validateGeneratedJs(code, isAppEvent, evName, wtag, wid);
    validation = await augmentWithMockCheck(validation, code, isAppEvent, evName, wtag, wid);
    const normalizedCode = validation.code || code;
    if (validation.ok) {
        return { alreadyOk: true, normalizedCode, code: normalizedCode };
    }

    window.vja?.log?.debug?.("[AI検証] 手動での修正依頼を実行します。検出内容: " + formatValidationIssuesForLog(validation));
    // 自動修正リトライ時と同様、ウィジェット一覧の絞り込みを解除して再構築する。
    const wideCtx = buildGenPromptContext(wid, evName, isAppEvent, isFormEvent, false);
    const fixUserPrompt = buildAiFixPrompt(wideCtx.userPrompt, normalizedCode, validation);

    let result = null;
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: fixUserPrompt,
        loadingMsg: "検出した問題を自動修正中…",
        onSuccess: async (fixed) => {
            fixed = await formatJsCode(fixMissingAwaits(stripWidgetValueAccess(fixed), isAppEvent));
            let revalidated = validateGeneratedJs(fixed, isAppEvent, evName, wtag, wid);
            revalidated = await augmentWithMockCheck(revalidated, fixed, isAppEvent, evName, wtag, wid);
            const fixedCode = revalidated.code || fixed;
            window.vja?.log?.debug?.(revalidated.ok
                ? "[AI検証] 手動修正で解消しました。"
                : "[AI検証] 手動修正後も未解消: " + formatValidationIssuesForLog(revalidated));
            if (revalidated.ok) {
                // AIが自力で直せた＝「効いた」学習内容として記録する。
                _recordLearnedFix(wid, evName, formatValidationIssuesForLog(validation));
            }
            let codeForEditor = annotateUnknownApis(
                fixedCode, revalidated.unknownApis, revalidated.forbiddenPatterns,
                revalidated.missingAwaits, revalidated.unknownWidgets, revalidated.styleWarnings,
                revalidated.eventTypeMismatches
            );
            if (validationName) {
                codeForEditor = "// 検証チェック処理(自動追加).\n" +
                    `if (!await vja.validate.run(${JSON.stringify(validationName)})) return;\n\n${codeForEditor}`;
            }
            result = { alreadyOk: false, normalizedCode, code: codeForEditor, revalidated };
        },
        onCancel: async () => { },
        onError: async () => { },
    });
    return result;
}

async function manualRetryAiFix(wid, evName, isAppEvent, isFormEvent) {
    const jsTa = $("js-ta");
    const currentCode = jsTa?.value || "";
    const result = await retryAiFix(wid, evName, isAppEvent, isFormEvent, currentCode);
    if (!result) return;

    if (result.normalizedCode !== currentCode && jsTa) {
        jsTa.value = result.normalizedCode;
        jsHlUpdate();
        editorUpdateGutter("js-ta", "js-gutter");
    }
    if (result.alreadyOk) { dismissAiValidationBanner(); return; }

    // runAiGenerate() 実行中に modal-root がローディング表示へ差し替えられ、
    // 完了時に closeModal() されるため、YAMLエディタのモーダル自体が
    // 一旦消えている。ここで開き直してから反映する必要がある。
    if (isFormEvent) {
        openFormYaml(evName);
    } else if (isAppEvent) {
        openAppEvents(evName);
    } else {
        const w2 = getWidget(wid);
        if (!w2) return;
        openYaml(wid, evName);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const newJsTa = $("js-ta");
        if (newJsTa) newJsTa.value = result.code;
        yamlTabSwitch("js");
        jsHlUpdate();
        editorUpdateGutter("js-ta", "js-gutter");
        showAiValidationWarningBanner(result.revalidated, wid, evName, isAppEvent, isFormEvent);
        if (result.revalidated.ok) showToast("✅ 修正が完了しました");
    }));
}

// validateGeneratedJs()の結果に、モック実行スモークテストの結果を
// マージする。mockErrorが検出された場合はokをfalseにする。
// mockErrorは { message: string, line: number|null, caught?: boolean } の形。
// caught=trueは、try/catchで握りつぶされconsole.error()に渡されたエラーを
// 検出したケース（例外としては外に投げられていない）であることを示す。
// 【var変換フォールバック】モックが成功した場合、let/constのスタイル警告
// （styleWarnings）は実害なしと確認できたことになるため、クリアして
// annotateUnknownApisでのコメント挿入対象から外す。
// モックが失敗し、かつlet/const使用が検出されている場合は、機械的にvarへ
// 変換した上で再度モック実行する。それで通れば「let/constが原因で発生していた
// 問題」とみなし、変換後コードをvalidation.codeとして返す（呼び出し元は
// 以後この値を採用コードとして使う）。3B以下の小型モデルはAIに指摘しても
// varへ直しきれないことが多いため、この機械的な変換で救済する。
async function augmentWithMockCheck(validation, code, isAppEvent, evName, wtag, wid) {
    const mockError = await _runMockSmokeTest(code, isAppEvent, evName, wtag, wid);
    if (!mockError) return { ...validation, styleWarnings: [] };
    if ((validation.styleWarnings || []).length > 0) {
        const varCode = _convertStyleWarningsToVar(code, isAppEvent);
        const varMockError = await _runMockSmokeTest(varCode, isAppEvent, evName, wtag, wid);
        if (!varMockError) {
            const revalidated = validateGeneratedJs(varCode, isAppEvent, evName, wtag, wid);
            return { ...revalidated, styleWarnings: [], code: varCode };
        }
    }
    return { ...validation, ok: false, mockError };
}

Object.assign(window, {
    validateGeneratedJs, annotateUnknownApis, showAiValidationWarningBanner,
    openAiValidationDetailModal,
    dismissAiValidationBanner, manualRetryAiFix, retryAiFix, manualMockCheck,
    openMockOverrideEditor, saveMockOverrides, mockEditorAddRow, mockEditorOnTypeChange,
    yamlPinLearnedFix, yamlDeleteLearnedFix, getLearnedFixes,
    purgeOverridesForWid,
    OVERRIDE_MAP_NAMES, purgeOverridesForKey,
    yamlRecordSnapshot, doRecordSnapshot, openSnapshotHistoryModal, restoreSnapshotHistory, deleteSnapshotHistory,
    // vja-yaml-editor.js（YAML/JSエディタ本体）から呼び出すため、
    // CLAUDE.mdの規約に従い`_`無しの名前でグローバル展開する。
    getBoostedTemperature, trackLearnedFixRecurrence, buildLearnedFixesCtx, stripWidgetValueAccess,
    augmentWithMockCheck, formatValidationIssuesForLog, buildAiFixPrompt,
});
