// ═══════════════════════════════════════════
// FORM LAYOUT PATTERNS
// 画面レイアウトイメージ選択機能の定義ファイル
// ─────────────────────────────────────────────
// 【役割】
// 「入力エリア」「表示エリア」「ボタンエリア」の大まかな配置構造を、
// 言葉ではなく箱型の簡易ダイアグラム（イメージ）として提示し、選択させる機能。
//
// 【重要・設計方針】
// これは「検索一覧」「マスタ保守」のような業務テンプレートではない。
// テンプレート的な発想にすると、YAML側にテーブルウィジェット等の定義が
// 無いのに「一覧を選んだから一覧(datagrid)が表示される」といった、
// レイアウト選択のはずがウィジェット種別・有無まで決めてしまう問題が起きる。
// そのため、各パターンの label/desc/boxesラベルは「入力」「表示」「ボタン」
// という役割名にとどめ、具体的なウィジェット種別（datagrid等）や
// 業務シーン名（検索・マスタ・伝票等）を一切含めないこと。
// 実際にどんなウィジェットを配置するかはYAML側の入力項目定義に委ねる。
//
// 既存の form-design-templates.js（YAML依頼文のひな形を直接エディタに
// 挿入する機能）とは独立しており、こちらは選択結果をYAMLテキストには
// 一切書き込まない。選択中のパターンは getProjectData().formLayoutPattern
// （フォームごとに syncCurForm()/commitFormDesignDraft() と同じ考え方で
// 同期）に保持し、formDesignAiGenerate() がAIへ渡すプロンプトに
// 追加情報として付与するためだけに使う。
// ═══════════════════════════════════════════
(function () {
    const FORM_LAYOUT_PATTERNS = [
        {
            id: "topInputBottomDisplay",
            label: "⬆⬇ 上:入力+ボタン / 下:表示",
            desc: "画面上部に入力エリアを横並びで複数配置し、その右側にボタンエリアを配置する。画面下部には表示エリアを画面幅いっぱいに配置する。一覧・検索結果等を表示する必要がある画面向け。",
            boxes: [
                { x: 2, y: 4, w: 26, h: 14, label: "入力" },
                { x: 30, y: 4, w: 26, h: 14, label: "入力" },
                { x: 78, y: 4, w: 20, h: 14, label: "ボタン" },
                { x: 2, y: 22, w: 96, h: 44, label: "表示" },
            ],
        },
        {
            id: "leftInputRightDisplay",
            label: "◀▶ 左:入力 / 右:表示",
            desc: "画面左側に入力エリアを縦に複数配置し、その下にボタンエリアを配置する。画面右側には表示エリアを縦幅いっぱいに配置する。一覧・詳細等を表示する必要がある画面向け。",
            boxes: [
                { x: 2, y: 4, w: 28, h: 12, label: "入力" },
                { x: 2, y: 18, w: 28, h: 12, label: "入力" },
                { x: 2, y: 32, w: 28, h: 12, label: "入力" },
                { x: 2, y: 48, w: 28, h: 12, label: "ボタン" },
                { x: 34, y: 4, w: 64, h: 62, label: "表示" },
            ],
        },
        {
            id: "stackedInputBottomButtons",
            label: "📥 縦並び入力 + 右下ボタン",
            desc: "画面上部から縦に入力エリアの行を複数並べる。画面下部の右寄せにボタンエリアを横並びで配置する。表示エリアは持たない構成。ログイン画面・設定画面等、一覧や表示欄を必要としない、入力とボタンのみのシンプルな画面向け。",
            boxes: [
                { x: 2, y: 4, w: 20, h: 10, label: "入力" }, { x: 24, y: 4, w: 74, h: 10, label: "" },
                { x: 2, y: 16, w: 20, h: 10, label: "入力" }, { x: 24, y: 16, w: 74, h: 10, label: "" },
                { x: 2, y: 28, w: 20, h: 10, label: "入力" }, { x: 24, y: 28, w: 74, h: 10, label: "" },
                { x: 58, y: 54, w: 18, h: 12, label: "ボタン" }, { x: 78, y: 54, w: 18, h: 12, label: "ボタン" },
            ],
        },
        {
            id: "centerInputBottomButtons",
            label: "🔲 中央:入力 + 下部中央ボタン",
            desc: "画面中央にコンパクトな表示・入力エリアを配置し、画面下部中央にボタンエリアを横並びで配置する、小さめの構成。確認内容の表示を伴う小さな確認ダイアログ画面向け（表示欄が不要な場合はこれではなく「縦並び入力+右下ボタン」を選ぶこと）。",
            boxes: [
                { x: 15, y: 8, w: 70, h: 16, label: "表示" },
                { x: 15, y: 28, w: 70, h: 14, label: "入力" },
                { x: 30, y: 48, w: 18, h: 12, label: "ボタン" }, { x: 52, y: 48, w: 18, h: 12, label: "ボタン" },
            ],
        },
        {
            id: "topMultiDisplayBottomDisplay",
            label: "🔳 上部:複数表示 + 下部:表示",
            desc: "画面上部に表示エリアを複数横並びで配置する。画面下部には表示エリアを画面幅いっぱいに配置する。入力エリアは持たない構成。集計指標や履歴等、閲覧のみで入力操作が不要な画面向け。",
            boxes: [
                { x: 2, y: 4, w: 22, h: 14, label: "表示" }, { x: 26, y: 4, w: 22, h: 14, label: "表示" },
                { x: 50, y: 4, w: 22, h: 14, label: "表示" }, { x: 74, y: 4, w: 24, h: 14, label: "表示" },
                { x: 2, y: 22, w: 96, h: 44, label: "表示" },
            ],
        },
        {
            id: "topInputMidMultiDisplayBottomDisplay",
            label: "🧩 上:入力+ボタン / 中:複数表示 / 下:表示",
            desc: "画面上部に入力エリアとボタンエリアを横並びで配置する。その下に表示エリアを複数横並びで配置し、画面下部には表示エリアを画面幅いっぱいに配置する。条件指定+集計指標+詳細一覧のような、複数の表示エリアを必要とする画面向け。",
            boxes: [
                { x: 2, y: 4, w: 40, h: 10, label: "入力" }, { x: 44, y: 4, w: 20, h: 10, label: "ボタン" },
                { x: 2, y: 18, w: 22, h: 14, label: "表示" }, { x: 26, y: 18, w: 22, h: 14, label: "表示" },
                { x: 50, y: 18, w: 22, h: 14, label: "表示" }, { x: 74, y: 18, w: 24, h: 14, label: "表示" },
                { x: 2, y: 36, w: 96, h: 30, label: "表示" },
            ],
        },
        {
            id: "stackedButtonsOnly",
            label: "📋 縦並びボタンのみ",
            desc: "画面中央にボタンエリアを縦に複数並べる。入力エリア・表示エリアは持たない構成。各画面への遷移ボタンのみが並ぶメニュー画面向け。",
            boxes: [
                { x: 25, y: 6, w: 50, h: 12, label: "ボタン" },
                { x: 25, y: 22, w: 50, h: 12, label: "ボタン" },
                { x: 25, y: 38, w: 50, h: 12, label: "ボタン" },
                { x: 25, y: 54, w: 50, h: 12, label: "ボタン" },
            ],
        },
    ];

    // レイアウトパターン1件分の箱型ダイアグラム(SVG)を生成する
    function buildLayoutPatternDiagramSvg(pattern) {
        const rects = (pattern.boxes || []).map((b) =>
            `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="1.2" fill="#3a3a5a" stroke="#5577ff" stroke-width="0.6"/>` +
            (b.label ? `<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + 2}" font-size="5.4" fill="#cfd3ff" text-anchor="middle">${esc(b.label)}</text>` : "")
        ).join("");
        return `<svg viewBox="0 0 100 70" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:143px;display:block;background:#22222e;border-radius:4px">${rects}</svg>`;
    }

    // 全レイアウトパターン一覧を取得
    function getFormLayoutPatterns() {
        return FORM_LAYOUT_PATTERNS;
    }

    // ID指定でレイアウトパターン1件を取得（AIプロンプトへの付与用）
    function getFormLayoutPatternById(id) {
        return FORM_LAYOUT_PATTERNS.find((p) => p.id === id) || null;
    }

    // pattern.boxes（0-100の割合値、role名=入力/表示/ボタン）を、実フォームサイズ
    // (formW, formH)に対する絶対px座標のバウンディングボックスへ変換する。
    // labelが空のboxは「直前に出現した非空labelの続き（値欄側）」とみなし、
    // その領域へ併合する（例: stackedInputBottomButtonsパターンの
    // [{label:"入力", w:20}, {label:"", w:74}] は、ラベル欄+値欄で1つの
    // 「入力」行を表しているため、union bounding boxとしては1つの幅広い領域になる）。
    function _buildLayoutRegionsFromPattern(pattern, formW, formH) {
        const regions = {};
        let lastLabel = null;
        (pattern.boxes || []).forEach((b) => {
            const px = {
                x1: (b.x / 100) * formW, y1: (b.y / 100) * formH,
                x2: ((b.x + b.w) / 100) * formW, y2: ((b.y + b.h) / 100) * formH,
            };
            const label = b.label || lastLabel;
            if (!label) return;
            if (!regions[label]) {
                regions[label] = px;
            } else {
                regions[label].x1 = Math.min(regions[label].x1, px.x1);
                regions[label].y1 = Math.min(regions[label].y1, px.y1);
                regions[label].x2 = Math.max(regions[label].x2, px.x2);
                regions[label].y2 = Math.max(regions[label].y2, px.y2);
            }
            if (b.label) lastLabel = b.label;
        });
        return regions;
    }

    // 行ごとの領域を持つパターンの下端（0-100の割合値）。この下に収まるよう行間を詰める。
    // 上端の余白（y=4）と同じ4を下端にも確保する。
    const ROW_BOTTOM_LIMIT = 96;

    // 「ラベル欄(入力) + 値欄(labelが空)」が同じyで続く組を行として検出する。
    // 2行以上ある場合のみ行ごとの領域を持つパターンとみなす（stackedInputBottomButtons等）。
    function _detectPairRows(pattern) {
        const boxes = pattern.boxes || [];
        const pairs = [];
        for (let i = 0; i + 1 < boxes.length; i++) {
            const l = boxes[i], v = boxes[i + 1];
            if (l.label === "入力" && !v.label && l.y === v.y) { pairs.push({ l, v }); i++; }
        }
        return pairs.length >= 2 ? pairs : null;
    }

    // 行ごとの領域を持つパターンを、入力項目数(fieldCount)に合わせて行数を延長した
    // boxesへ展開する。fieldCountが0/未指定（「入力項目:」が無い）、または
    // パターンの行数以下ならパターン本来の行数のまま。
    // 行が増えた分、入力行以外(ボタン等)は下へ押し下げ、ROW_BOTTOM_LIMITを超える場合は
    // 行間を詰める（0未満にはしない。それでも超える分はapplyAiFormDesignの画面内収めに任せる）。
    // 戻り値: { boxes, rowCount }。行を持たないパターンはnull。
    function _expandPairRows(pattern, fieldCount) {
        const pairs = _detectPairRows(pattern);
        if (!pairs) return null;
        const baseN = pairs.length;
        const n = fieldCount > baseN ? fieldCount : baseN;
        const rowH = pairs[0].l.h, y0 = pairs[0].l.y;
        const baseGap = pairs[1].l.y - (y0 + rowH);
        const others = (pattern.boxes || []).filter((b) => !pairs.some((p) => p.l === b || p.v === b));
        let gap = baseGap;
        let shift = 0;
        if (n > baseN) {
            const lastBottom = pairs[baseN - 1].l.y + rowH;
            const oTop = others.length ? Math.min(...others.map((b) => b.y)) : lastBottom;
            const oBottom = others.length ? Math.max(...others.map((b) => b.y + b.h)) : lastBottom;
            const btnGap = oTop - lastBottom, btnH = oBottom - oTop;
            if (y0 + n * rowH + (n - 1) * gap + btnGap + btnH > ROW_BOTTOM_LIMIT) {
                gap = Math.max(0, (ROW_BOTTOM_LIMIT - y0 - n * rowH - btnGap - btnH) / (n - 1));
            }
            shift = (y0 + n * rowH + (n - 1) * gap + btnGap) - oTop;
        }
        const boxes = [];
        for (let i = 0; i < n; i++) {
            const y = y0 + i * (rowH + gap);
            boxes.push({ ...pairs[0].l, y }, { ...pairs[0].v, y });
        }
        others.forEach((b) => boxes.push({ ...b, y: b.y + shift }));
        return { boxes, rowCount: n };
    }

    // 選択中のレイアウトパターンを、AIへ渡す「厳格な配置エリア（px座標）」の
    // プロンプト断片へ変換する。従来は「配置構造を言葉で説明した1文」を
    // addPromptに足すだけで、AIの解釈に配置の正確さが左右されていた
    // （2026-09-14: ユーザーから「設定しても反映が微妙」との指摘）。
    // pattern.boxesは元々SVGダイアグラム描画用の座標データだが、これを
    // 実フォームサイズのpx座標バウンディングボックスに変換し、「役割ごとの
    // ウィジェットは必ずこの矩形内に収めよ」という具体的な数値制約として
    // 渡すことで、AIの解釈に頼らず配置を強制する。
    // patternIdが未選択、または該当パターンが見つからない場合は空文字を返す。
    // fieldCount: YAMLの「入力項目:」の項目数（省略可）。行ごとの領域を持つパターンで、
    // 行数をこの数に合わせて延長する。
    // 2026-10-02: 従来は役割ごとに1つの外接矩形へ併合していたため、「入力は縦に1行ずつ
    // 積む」という構造が失われ、AIが1行に複数組の「ラベル+入力欄」を横並びに置く不具合が
    // あった。行を持つパターンは、行ごとの領域も合わせて渡す。
    function buildLayoutRegionsPromptText(patternId, formW, formH, fieldCount) {
        const pattern = getFormLayoutPatternById(patternId);
        if (!pattern) return "";
        const expanded = _expandPairRows(pattern, fieldCount);
        const regions = _buildLayoutRegionsFromPattern(expanded ? { boxes: expanded.boxes } : pattern, formW, formH);
        const roleDesc = {
            "入力": "input-role widgets (labels + their inputtype/selectBox/checkbox/etc., i.e. everything EXCEPT buttons and display areas)",
            "表示": "display-role widgets (datagrid, read-only summary/list areas)",
            "ボタン": "button-role widgets",
        };
        const lines = Object.keys(regions).map((label) => {
            const r = regions[label];
            return "- " + (roleDesc[label] || label) + ": x=" + Math.round(r.x1) + "-" + Math.round(r.x2) +
                ", y=" + Math.round(r.y1) + "-" + Math.round(r.y2) +
                " (STRICT bounding box — every widget of this role MUST be placed fully inside these bounds, not merely near them)";
        });
        if (lines.length === 0) return "";
        if (expanded) {
            const px = (v, total) => Math.round((v / 100) * total);
            lines.push("- input rows (stacked top to bottom, one row per input item in the YAML 入力項目 order; unused rows are simply left empty):");
            for (let i = 0; i < expanded.rowCount; i++) {
                const l = expanded.boxes[i * 2], v = expanded.boxes[i * 2 + 1];
                lines.push("  row" + (i + 1) + ": y=" + px(l.y, formH) + "-" + px(l.y + l.h, formH) +
                    ", label x=" + px(l.x, formW) + "-" + px(l.x + l.w, formW) +
                    ", input x=" + px(v.x, formW) + "-" + px(v.x + v.w, formW));
            }
            lines.push("  Each row holds exactly ONE label + its ONE input widget side by side. NEVER put two label/input pairs in the same row, and NEVER place a second pair to the right of the first.");
        }
        return "\n\n[Strict Layout Regions — user-selected layout image, MUST be followed exactly]\n" +
            "The user selected the layout image \"" + pattern.label + "\" (" + pattern.desc + "). It has been converted into the following strict pixel regions for THIS form's actual size (" + formW + "x" + formH + "px). Place each widget according to its role into the matching region below:\n" +
            lines.join("\n") +
            "\n[IMPORTANT] These regions define WHERE each role of widget goes — they do NOT define WHICH widgets to create. Widget types/count still come only from the YAML's 入力項目/参照テーブル/アクション項目 as usual. If a region above has no matching widgets to place (e.g. no button was requested), simply ignore that region. Widgets must still obey the form's overall width/height bounds and the no-overlap rule even when placed inside these regions.";
    }

    // グローバル展開
    Object.assign(window, {
        FORM_LAYOUT_PATTERNS,
        buildLayoutPatternDiagramSvg,
        getFormLayoutPatterns,
        getFormLayoutPatternById,
        buildLayoutRegionsPromptText,
    });
})();
