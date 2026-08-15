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

    // グローバル展開
    Object.assign(window, {
        FORM_LAYOUT_PATTERNS,
        buildLayoutPatternDiagramSvg,
        getFormLayoutPatterns,
        getFormLayoutPatternById,
    });
})();
