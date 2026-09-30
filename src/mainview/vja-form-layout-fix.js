// ═══════════════════════════════════════════
// FORM LAYOUT FIX
// AIが出力した画面レイアウトJSON（x/y/w/h）の機械的な座標補正
// ─────────────────────────────────────────────
// 【役割】
// AIはウィジェット座標を自力で計算して出力するが、ボタンの右端計算ミスや
// ウィジェット同士の重なりが起きやすく、プロンプト文言の強化だけでは再発する。
// そのため applyAiFormDesign() の直前にこの関数を通し、コード側で確定的に是正する。
// （_fixArithmeticInFormDesignJson と同じ「コード側の機械的安全網」方針）
//
// 【AIメモ】
// - DOMには一切触れない純粋関数（bun testでevalして検証できる）。
// - x/y/w/hが数値でない要素は触らない（applyAiFormDesign側の既存フォールバックに任せる）。
// - 入力を破壊しない（要素は浅いコピーを返す）。
// - 補正は「ボタンの右端整列」→「ラベル+入力のペア垂直中央揃え」→「重なり解消（下方向のみ）」の順。
// - はみ出し補正は applyAiFormDesign 側に既にあるためここでは行わない。
// ═══════════════════════════════════════════
(function () {
    const BTN_GAP = 10;        // ボタン間隔
    const RIGHT_MARGIN = 20;   // フォーム右端の余白
    const LEFT_MARGIN = 20;    // フォーム左端の余白（ボタン整列時の下限）
    const SAME_ROW_DY = 8;     // 「同じ行」とみなすyの差
    const PAIR_TAGS = ["inputtype", "selectBox", "listbox", "checkbox", "radio", "textarea"];

    function _hasRect(it) {
        return it && [it.x, it.y, it.w, it.h].every((v) => typeof v === "number" && Number.isFinite(v));
    }

    // 同じ行にあるボタンが2個以上ある場合だけ、右端から詰め直す
    function _alignButtons(list, formW) {
        const btns = list.filter((it) => it.tag === "button" && _hasRect(it)).sort((a, b) => a.y - b.y);
        const used = new Set();
        btns.forEach((b0) => {
            if (used.has(b0)) return;
            const group = btns.filter((b) => !used.has(b) && Math.abs(b.y - b0.y) <= SAME_ROW_DY);
            group.forEach((b) => used.add(b));
            if (group.length < 2) return;
            group.sort((a, b) => a.x - b.x);
            const n = group.length;
            const avail = formW - LEFT_MARGIN - RIGHT_MARGIN - BTN_GAP * (n - 1);
            const sumW = group.reduce((s, b) => s + b.w, 0);
            if (sumW > avail) {
                // 幅を均等に縮める（左端が余白を割らないように）
                const w = Math.max(20, Math.floor(avail / n));
                group.forEach((b) => { b.w = w; });
            }
            let right = formW - RIGHT_MARGIN;
            for (let i = n - 1; i >= 0; i--) {
                group[i].x = right - group[i].w;
                right = group[i].x - BTN_GAP;
            }
        });
    }

    // 「ラベルの直後に出力された入力系」をペアとして返す（index の組）
    function _findPairs(list) {
        const pairs = [];
        for (let i = 0; i + 1 < list.length; i++) {
            const lbl = list[i], inp = list[i + 1];
            if (lbl.tag !== "label" || !PAIR_TAGS.includes(inp.tag)) continue;
            if (!_hasRect(lbl) || !_hasRect(inp)) continue;
            if (Math.abs(inp.y - lbl.y) > lbl.h + SAME_ROW_DY) continue; // 離れすぎは別物
            pairs.push([i, i + 1]);
            i++;
        }
        return pairs;
    }

    function _unitRect(members) {
        const x1 = Math.min(...members.map((m) => m.x));
        const y1 = Math.min(...members.map((m) => m.y));
        const x2 = Math.max(...members.map((m) => m.x + m.w));
        const y2 = Math.max(...members.map((m) => m.y + m.h));
        return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }

    function _intersects(a, b) {
        return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    }

    // AI出力のウィジェット配列の座標を機械的に是正して返す
    function arrangeAiFormItems(items, formW, formH) {
        if (!Array.isArray(items)) return items;
        const list = items.map((it) => (it && typeof it === "object" ? { ...it } : it));

        _alignButtons(list, formW);

        // ラベル+入力のペア: 同じ行なら、ラベルを入力の垂直中央へ揃える
        const pairs = _findPairs(list);
        pairs.forEach(([li, ii]) => {
            const lbl = list[li], inp = list[ii];
            if (Math.abs(inp.y - lbl.y) <= SAME_ROW_DY) {
                lbl.y = inp.y + Math.floor((inp.h - lbl.h) / 2);
            }
        });

        // 重なり解消の単位（ペアは1単位として動かす）
        const inPair = new Set();
        const units = [];
        pairs.forEach(([li, ii]) => { inPair.add(li); inPair.add(ii); });
        list.forEach((it, idx) => {
            if (!_hasRect(it)) return;
            if (inPair.has(idx)) {
                const p = pairs.find((pp) => pp[0] === idx);
                if (p) units.push({ members: [list[p[0]], list[p[1]]], fixed: false });
                return;
            }
            units.push({ members: [it], fixed: it.tag === "datagrid" });
        });

        // datagridは動かさず障害物として先に確定し、他は出力順に重ならない位置へ下げる
        const placed = [];
        units.filter((u) => u.fixed).forEach((u) => placed.push(_unitRect(u.members)));
        units.filter((u) => !u.fixed).forEach((u) => {
            const origin = u.members.map((m) => m.y);
            let guard = 0;
            for (;;) {
                const r = _unitRect(u.members);
                const hit = placed.find((p) => _intersects(r, p));
                if (!hit || guard++ > 200) break;
                const dy = hit.y + hit.h - r.y;
                u.members.forEach((m) => { m.y += dy; });
            }
            const after = _unitRect(u.members);
            if (after.y + after.h > formH) {
                // 下げるとフォームから出る場合は何もしない（縮めない）
                u.members.forEach((m, i) => { m.y = origin[i]; });
            }
            placed.push(_unitRect(u.members));
        });

        return list;
    }

    // グローバル展開
    Object.assign(window, {
        arrangeAiFormItems,
    });
})();
