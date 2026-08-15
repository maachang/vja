// ═══════════════════════════════════════════
// FORM LAYOUT PATTERNS
// 画面レイアウトイメージ選択機能の定義ファイル
// ─────────────────────────────────────────────
// 【役割】
// 「上に検索条件、下に一覧」のような大まかな画面構成を、言葉ではなく
// 箱型の簡易ダイアグラム（イメージ）として提示し、選択させる機能。
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
            id: "search",
            label: "🔍 検索一覧",
            desc: "画面上部に検索条件の入力欄を横並びで複数配置し、その右側に検索ボタンを配置する。画面下部には検索結果一覧(datagrid)を画面幅いっぱいに配置する。",
            boxes: [
                { x: 2, y: 4, w: 26, h: 14, label: "条件" },
                { x: 30, y: 4, w: 26, h: 14, label: "条件" },
                { x: 78, y: 4, w: 20, h: 14, label: "検索" },
                { x: 2, y: 22, w: 96, h: 44, label: "一覧" },
            ],
        },
        {
            id: "form",
            label: "📝 登録フォーム",
            desc: "画面上部から縦に「ラベル＋入力欄」の行を複数並べる。画面下部の右寄せに保存・キャンセル等のボタンを横並びで配置する。",
            boxes: [
                { x: 2, y: 4, w: 20, h: 10, label: "項目" }, { x: 24, y: 4, w: 74, h: 10, label: "" },
                { x: 2, y: 16, w: 20, h: 10, label: "項目" }, { x: 24, y: 16, w: 74, h: 10, label: "" },
                { x: 2, y: 28, w: 20, h: 10, label: "項目" }, { x: 24, y: 28, w: 74, h: 10, label: "" },
                { x: 58, y: 54, w: 18, h: 12, label: "保存" }, { x: 78, y: 54, w: 18, h: 12, label: "戻る" },
            ],
        },
        {
            id: "dialog",
            label: "💬 ダイアログ",
            desc: "画面中央にコンパクトな内容表示・入力欄を配置し、画面下部中央にOK・キャンセル等のボタンを横並びで配置する、小さめのダイアログ画面。",
            boxes: [
                { x: 15, y: 8, w: 70, h: 16, label: "内容" },
                { x: 15, y: 28, w: 70, h: 14, label: "項目" },
                { x: 30, y: 48, w: 18, h: 12, label: "OK" }, { x: 52, y: 48, w: 18, h: 12, label: "キャンセル" },
            ],
        },
        {
            id: "master",
            label: "🗂️ マスタ保守",
            desc: "画面上部に入力欄を横並びで複数配置し、その下に新規作成・更新・削除ボタンを横並びで配置する。画面下部には一覧(datagrid)を画面幅いっぱいに配置し、一覧行の選択で上部の入力欄に値を反映する構成。",
            boxes: [
                { x: 2, y: 4, w: 30, h: 12, label: "項目" }, { x: 34, y: 4, w: 30, h: 12, label: "項目" },
                { x: 2, y: 20, w: 96, h: 8, label: "新規/更新/削除" },
                { x: 2, y: 32, w: 96, h: 34, label: "一覧" },
            ],
        },
        {
            id: "masterDetail",
            label: "📄 伝票・明細",
            desc: "画面上部にヘッダー情報（伝票番号・取引先・日付等）の入力欄を横並びで複数配置する。画面下部には明細行の一覧(datagrid)を画面幅いっぱいに配置する伝票入力画面。",
            boxes: [
                { x: 2, y: 4, w: 22, h: 10, label: "項目" }, { x: 26, y: 4, w: 22, h: 10, label: "項目" }, { x: 50, y: 4, w: 22, h: 10, label: "項目" },
                { x: 2, y: 16, w: 70, h: 10, label: "項目" },
                { x: 2, y: 30, w: 96, h: 36, label: "明細" },
            ],
        },
        {
            id: "dashboard",
            label: "📊 ダッシュボード",
            desc: "画面上部に期間指定等のフィルタ欄と実行ボタンを配置する。その下に複数の集計指標（数値タイル）を横並びで配置し、画面下部には詳細な集計結果一覧(datagrid)や履歴を画面幅いっぱいに配置する。",
            boxes: [
                { x: 2, y: 4, w: 40, h: 10, label: "期間" }, { x: 44, y: 4, w: 20, h: 10, label: "実行" },
                { x: 2, y: 18, w: 22, h: 14, label: "指標" }, { x: 26, y: 18, w: 22, h: 14, label: "指標" },
                { x: 50, y: 18, w: 22, h: 14, label: "指標" }, { x: 74, y: 18, w: 24, h: 14, label: "指標" },
                { x: 2, y: 36, w: 96, h: 30, label: "集計結果" },
            ],
        },
    ];

    // レイアウトパターン1件分の箱型ダイアグラム(SVG)を生成する
    function buildLayoutPatternDiagramSvg(pattern) {
        const rects = (pattern.boxes || []).map((b) =>
            `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="1.2" fill="#3a3a5a" stroke="#5577ff" stroke-width="0.6"/>` +
            (b.label ? `<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + 2}" font-size="4.2" fill="#cfd3ff" text-anchor="middle">${esc(b.label)}</text>` : "")
        ).join("");
        return `<svg viewBox="0 0 100 70" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:76px;display:block;background:#22222e;border-radius:4px">${rects}</svg>`;
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
