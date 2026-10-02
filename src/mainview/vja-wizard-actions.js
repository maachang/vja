// ═══════════════════════════════════════════
// WIZARD ACTIONS
// ウィザードで生成した画面YAMLの「アクション項目:」へ、画面の種類ごとの必須ボタンを
// コード側で機械的に補完する。
// ─────────────────────────────────────────────
// 【役割】
// 画面の種類（メニュー/一覧/入力）はウィザードがコードで確定している（_wizardBuildScreenSkeleton）。
// 一方、アクション項目はAIが依頼文（docDraft）から作るため、依頼文に書かれなかったボタンは
// 作られない（YAML生成プロンプトは「依頼文にないアクションを作るな」としている）。
// その結果「登録画面に登録ボタンが無い」「条件入力のある一覧に検索ボタンが無い」
// 「一覧画面があるのにメニューにそのボタンが無い」が起きていた（2026-10-02）。
// プロンプト文言だけでは別モデルで再発するため、YAML生成後にここで補完する。
//
// 【AIメモ】
// - DOMには一切触れない純粋関数（bun testでevalして検証できる）。
// - 対象はウィザード生成のみ。手動作成の画面・手書きYAMLには呼ばれない。
// - 既に同等のボタンがある場合は足さない（保存/追加/更新は「登録」の代わりとみなす）。
// - 補完するボタン:
//     input: 確定ボタン「登録」（登録/保存/追加/更新/確定が無ければ）、「戻る」（無ければ）
//     list : 「検索」（datagrid以外の入力項目があり、検索系が無ければ）、「新規登録」（無ければ）
//     menu : listTitles（一覧画面のformTitle）ごとの遷移ボタン。文言は末尾の「一覧」を除いたもの
// - kindが上記以外（AIが追加した画面等）は何もしない。
// ═══════════════════════════════════════════
(function () {
    // 「アクション項目:」の項目名（`- 名前` の名前部分。「ボタン」接尾辞と`:`以降は除く）
    function _actionLabel(line) {
        const m = line.match(/^\s*-\s*(.+?)\s*(?::.*)?$/);
        return m ? m[1].replace(/ボタン$/, "").trim() : "";
    }

    // "  - " で始まるトップレベル項目の行番号を、[start, end) の範囲で返す
    function _itemIdx(lines, start, end) {
        const idx = [];
        for (let i = start; i < end; i++) if (/^ {2}-\s/.test(lines[i])) idx.push(i);
        return idx;
    }

    // `見出し:` で始まる行のセクション範囲 [headerIdx, endIdx) を返す。無ければnull
    function _section(lines, key) {
        const h = lines.findIndex((l) => new RegExp("^" + key + "\\s*:").test(l));
        if (h < 0) return null;
        let end = lines.length;
        for (let i = h + 1; i < lines.length; i++) {
            if (/^\S/.test(lines[i])) { end = i; break; }
        }
        return { h, end };
    }

    // yamlTextの「アクション項目:」へ不足分を補った新しいYAML文字列を返す。
    // kind: "menu" | "list" | "input"。listTitles: 一覧画面のformTitle配列（menuのみ使用）
    function ensureWizardFormActions(yamlText, kind, listTitles) {
        const text = String(yamlText || "");
        if (kind !== "menu" && kind !== "list" && kind !== "input") return text;
        const lines = text.split("\n");

        const inSec = _section(lines, "入力項目");
        const fieldLines = inSec ? _itemIdx(lines, inSec.h + 1, inSec.end).map((i) => lines[i]) : [];
        const hasCondInput = fieldLines.some((l) => !/datagrid/i.test(l));

        const actSec = _section(lines, "アクション項目");
        const actIdx = actSec ? _itemIdx(lines, actSec.h + 1, actSec.end) : [];
        const labels = actIdx.map((i) => _actionLabel(lines[i]));
        const has = (re) => labels.some((t) => re.test(t));

        // 挿入する項目: { label, where: "start" | "end" | "beforeBack" }
        const adds = [];
        if (kind === "input") {
            if (!has(/登録|保存|追加|更新|確定|OK|ＯＫ/i)) adds.push({ label: "登録", where: "beforeBack" });
            if (!has(/戻る/)) adds.push({ label: "戻る", where: "end" });
        } else if (kind === "list") {
            if (hasCondInput && !has(/検索|絞り込|フィルタ/)) adds.push({ label: "検索", where: "start" });
            if (!has(/新規|追加|登録/)) adds.push({ label: "新規登録", where: "end" });
        } else {
            (listTitles || []).forEach((title) => {
                const stem = String(title || "").replace(/\s/g, "").replace(/一覧$/, "");
                if (stem && !labels.some((t) => t.replace(/\s/g, "").includes(stem))) {
                    adds.push({ label: stem, where: "end" });
                }
            });
        }
        if (adds.length === 0) return text;

        // アクション項目セクションが無ければ末尾へ新設する
        if (!actSec) {
            const out = text.replace(/\s+$/, "") + "\n\nアクション項目:\n" + adds.map((a) => "  - " + a.label).join("\n");
            return out + "\n";
        }

        // 既存項目の並びへ挿入位置を決める（行番号が崩れないよう、後ろの位置から挿入する）
        const lastItemEnd = (() => {
            // セクション末尾の空行を除いた「最後の非空行の次」
            let e = actSec.end;
            while (e - 1 > actSec.h && lines[e - 1].trim() === "") e--;
            return e;
        })();
        const firstItem = actIdx.length > 0 ? actIdx[0] : lastItemEnd;
        const backIdx = actIdx.find((i) => /戻る|キャンセル/.test(_actionLabel(lines[i])));
        const pos = (w) => (w === "start" ? firstItem : (w === "beforeBack" && backIdx !== undefined ? backIdx : lastItemEnd));
        const inserts = adds.map((a, k) => ({ at: pos(a.where), k, line: "  - " + a.label }));
        // 同じ位置への複数挿入は追加順を保つ。後ろの位置から挿入して前の行番号を保つ
        inserts.sort((a, b) => (b.at - a.at) || (b.k - a.k));
        inserts.forEach((ins) => lines.splice(ins.at, 0, ins.line));
        return lines.join("\n");
    }

    Object.assign(window, { ensureWizardFormActions });
})();
