/* ═══════════════════════════════════════════════════════════════
   vja-defs.js — 状態管理・ウィジェット定義
   ─────────────────────────────────────────────────────────────
   【読み込み順序】1番目（最も依存される側、最初に読み込むこと）。
   【依存】なし（init-params.js / prompt-def.js / vja-runtime.js /
            bridge.ts が読み込み済みであることだけを前提とする）。
   【提供するもの】
     - _CTX（状態管理オブジェクト本体）と getDesignerState() 等のgetter群
     - 機能別ローカル状態オブジェクト（_CLOUD_MODAL, _TABLE_MODAL 等）
     - WIDGET_DEFS（全ウィジェットの定義: label/icon/def/events/pdefs/preview。
       themeSync: ["font","color"]等でフォームテーマ連動対象を明示。
       未指定＝連動対象外。"font"未指定でも"color"のみのタグもある）
     - POINTER_TOOL, getToolById()
     - PP_POS / PP_FONT / PP_BORDER / PP_TAIL（プロパティ定義の共通パーツ）
     - esc(), $(), fb(), evtAttr(), pvRegister()/pvCall(), showToast()
       等の共通ユーティリティ
     - getFormTheme()（フォームのテーマ設定取得、旧プロジェクトは規定値補完）
     - darkenColor()（#rrggbb を指定比率で暗くする共通色計算）
     - makeFormData()（フォーム1枚分のデータ構造生成。cfgにtheme*項目を含む）
   このファイルは他のどのファイルにも依存しない。
   他の全ファイルがこのファイルの中身に依存する。
═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
   【プロジェクト全体の設計ルール — AIへの引き継ぎメモ】
   このコメントは、記憶を持たない別セッションのAIが本プロジェクトを
   扱う際に必ず読むべきルールである。チャット履歴やメモリに依存せず、
   ソースコード自体にルールを埋め込むことで、セッションが切り替わっても
   一貫した判断ができるようにしている。
   ─────────────────────────────────────────────────────────────
   ① 環境について
   - これはローカル実行のデスクトップアプリ（Electrobun）であり、
     Webアプリではない。ファイルサイズ・読み込み速度は懸念事項では
     ない。ファイル分割・関数分割の目的は常に「AIが構造を誤認しに
     くくすること」のみであり、「サイズを小さくする」目的は含めない。

   ② ファイル構成と読み込み順序
   index.html は機能別に9ファイルに分割されている。
   読み込み順序（この並びを変更しないこと）:
     1. vja-defs.js（このファイル。最も依存される。ここでの
        typo・エクスポート漏れは全機能に波及する）
     2. vja-designer.js（描画・選択・プロパティパネル）
     3. vja-modal.js（モーダル基盤・Undo/Redo・削除/複製）
     4. vja-yaml-editor.js（YAML/JSエディタ・AI生成）
     5. vja-editor-utils.js（エディタ共通ユーティリティ）
     6. vja-save.js（保存・開く・実行・マルチフォーム管理）
     7. vja-table-validation.js（定数・テーブル・バリデーション編集）
     8. vja-app-config.js（フォーム定数・アプリイベント・クラウド設定等）
     9. vja-ui.js（キーボード・ルーラー・INIT実行。必ず最後）

   ③ ファイル間の値共有について（重要）
   Electrobun(Bun)が各 <script> タグを独立モジュールとしてバンドル
   するため、ファイルをまたいで関数・変数を共有するには、各ファイル
   末尾で Object.assign(window, {...}) による明示公開が必須。
   1行ずつの window.xxx = xxx; ではなく、この一括代入形式に統一する。
   新しい関数・定数を追加したら、必ずこのエクスポートブロックに追加
   すること。確認時は function 宣言だけでなく const/let の定義も
   機械的に洗い出すこと（過去に WIDGET_FONTS 等9個の定数エクスポート
   を見落とした実例がある）。

   ④ 新しい状態・値を追加する際の置き場所の判断基準
   - 状態（変化する・複数ファイルで共有される値）
     → _CTX（getDesignerState() / getProjectData() 等のgetter経由）
   - 一時的なモーダル編集状態
     → 機能別ローカルオブジェクト（_CLOUD_MODAL, _TABLE_MODAL 等。
        _CTX に何でも入れると第二のグローバル化になるため意図的に分離）
   - 静的な定義値（一度作ったら変わらないマスターデータ）
     → init-params.js に window.XXXX の形で直接展開
        （_INIT_PARAMS という間接的な名前空間は撤廃済み。使わない）
   - 関数・純粋なロジック
     → 各機能別ファイル
   - 特定ドメインに属さない汎用UI部品（トースト通知・モーダル共通
     パーツ等、ほぼ全ファイルから呼ばれるもの）
     → vja-defs.js（基盤ヘルパー）または vja-modal.js（モーダル
       共通土台）。「純粋関数だから」という理由だけでドメイン横断
       的な新規ファイル（例: vja-logic.js）を作るのは禁止。ドメイン
       別ファイル分割の原則（②）を崩すため。
   - フォームテーマ連動の対象タグ判定
     → WIDGET_DEFS[tag].themeSync（例: ["font","color"]）に必ず
       明示する。"borderColor" in props のような、propsの中身から
       間接的に対象タグを推測するコードは書かないこと（過去に
       datagrid/picture等が意図せず連動対象に混入した原因）。

   ⑤ HTML文字列内のイベント属性について（重要・必須ルール）
   HTML文字列の中に oninput / onmousedown / onchange 等のイベント
   ハンドラーを埋め込む場合は、必ず evtAttr() ヘルパー（このファイル
   内で定義）を経由すること。直接の文字列連結は、クォート崩れを
   引き起こす100%のリスク要因である。
   makePvSel() のような「HTML生成系の共通関数」自体に evtAttr 未適用
   の生クォートが残っていないか、新しい共通コンポーネントを追加・
   修正する際は横断的に確認すること。

   ⑥ 作業上の絶対ルール
   コード変更前には必ず該当箇所を確認してから対応し、変更してよいか
   ユーザーに確認を取ってから実施する。これは例外なく厳守する。

   ⑦ ファイルコピーの整合性について
   index.html・各 vja-*.js ファイルは複数の作業ディレクトリ・出力
   履歴にコピーが分散しうる。設計変更（特に init-params.js や
   script読み込み順序に関わるもの）を行った際は、対応するファイル
   全てに反映されているか、出力直前に再確認すること。

   ⑨ モーダル内のドロップダウンについて（重要・再発防止）
   モーダル内のプルダウンUIは、素の<select>タグではなく
   makePvSel()/pvSelOpen()/pvSelPick()（vja-table-validation.js定義）
   という専用部品で統一されている（AI接続設定の推論モードON/OFF、
   フォント選択等で使用実績あり）。新しいドロップダウンを追加する際は
   必ずこれを使うこと。<select>タグを使うと見た目がVJAのダークテーマ
   から浮いてしまう不具合を過去に繰り返しているため、モーダル内へ
   ドロップダウンを追加・修正する前に、既存のmakePvSel使用例を
   横断的に確認すること。
   【制約】表示ラベルと内部値が異なる場合（例: 表示"ウィジェット"/
   値"widget"）、選択中の値はボタンの表示テキストからは復元できない
   （pvSelPickは表示ラベルしかDOMに残さないため）。この場合は
   onPickCode経由のコールバックで data-* 属性に値を保存し、保存時は
   DOMの表示テキストではなくdata-*属性から読み取ること
   （vja-yaml-editor.js の _mockEditorOnTypeChange() が実装例）。

   ⑧ 既知の制約（実行時プレビュー・Electrobun起因、修正不可）
   プロジェクト実行ウィンドウの「起動直後の最初のフォーム」でのみ、
   Form.Load イベント内から vja.trigger.focus() 等で入力欄へ
   プログラム的にフォーカスを当てても実際のキー入力を受け付けない
   （document.activeElement は正しく更新されるがOS/WebView側が
   キーボード入力を受理しない）。原因はElectrobunのWebView側の
   制約と推定され、Windows/Linux両方で再現、BrowserWindow.activate()
   でも解消しなかった。一方、vja.project.navigate() 等でフォーム間を
   遷移した後のフォームでは同じ処理が正常に動作する。この問題は
   VJA側のコード修正では解決できないため、Load内でのフォーカス
   指定はドキュメント上の既知の制約として扱い、再調査・再実装は
   不要（Electrobun本体側の問題のため）。
═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════
    WIDGET_DEFS 定義
═══════════════════════════════════════════ */
// ── プロパティ定義の共通パーツ（WIDGET_DEFS.pdefs内でスプレッドして使う）──
const PP_POS = [
    { k: "name", lb: "Name", t: "text", sp: "name" },
    { k: "x", lb: "Left", t: "num", sp: "x" },
    { k: "y", lb: "Top", t: "num", sp: "y" },
    { k: "w", lb: "Width", t: "num", sp: "w" },
    { k: "h", lb: "Height", t: "num", sp: "h" },
];
// フォントセット（fontSize を持つウィジェット共通）
const PP_FONT = [
    { k: "fontSize", lb: "FontSize", t: "num" },
    { k: "fontFamily", lb: "FontFamily", t: "fontsel" },
    { k: "fontBold", lb: "Bold", t: "bool" },
];
// ボーダー（border持ちウィジェット共通）
const PP_BORDER = [
    { k: "borderSize", lb: "BorderSize", t: "num" },
    { k: "borderColor", lb: "BorderColor", t: "color" },
    { k: "baseColor", lb: "ベースカラー", t: "themeReset" },
];
// 表示・説明（全ウィジェット共通）
const PP_TAIL = [
    { k: "visible", lb: "Visible", t: "bool" },
    { sep: "説明" },
    { k: "description", lb: "説明（任意）", t: "area" },
];

// ポインタツール（WIDGET_DEFSとは別の特殊ツール。配置可能なウィジェットではない）
const POINTER_TOOL = { id: "pointer", label: "ポインタ", icon: "🖱️" };

/* ═══════════════════════════════════════════
    WIDGET_DEFS — ウィジェット定義の統合オブジェクト
    1タグにつき1エントリで、ラベル・アイコン・デフォルト値
    （旧TOOLS）・発火可能イベント一覧（旧EVENTS）・
    プロパティパネル定義（旧PDEFS）を集約する。
    新しいウィジェットを追加する場合は、ここに1エントリ
    追加するだけでよい（以前のように複数箇所への追記は不要）。
═══════════════════════════════════════════ */
const WIDGET_DEFS = {
    button: {
        label: "button", icon: "⬜",
        themeSync: ["font", "color"],
        def: {
            w: 96, h: 28,
            text: "Button1",
            bg: "#e0e0e0", fg: "#000",
            fontSize: 12, fontFamily: "", fontBold: false,
            borderSize: 1, borderColor: "#cccccc", borderRadius: 2,
            disabled: false, visible: true, description: "",
        },
        events: ["Click", "MouseDown", "MouseUp", "MouseEnter", "MouseLeave", "GotFocus", "LostFocus"],
        pdefs: [
            ...PP_POS,
            { sep: "外観" },
            { k: "text", lb: "Text", t: "text" },
            { k: "bg", lb: "BackColor", t: "color" },
            { k: "fg", lb: "ForeColor", t: "color" },
            ...PP_FONT,
            ...PP_BORDER,
            { k: "borderRadius", lb: "Radius", t: "num" },
            { sep: "動作" },
            { k: "disabled", lb: "Disabled", t: "bool" },
            ...PP_TAIL,
        ],
        preview: (p, base, vis) => `<button style="${base}background:${p.bg};color:${p.fg};font-size:${p.fontSize}px;font-family:${p.fontFamily || ""};font-weight:${p.fontBold ? "bold" : "normal"};border:${(p.borderSize || 0) + "px solid " + (p.borderColor || "#cccccc")};border-radius:${p.borderRadius || 2}px;cursor:default;pointer-events:none;${vis}">${esc(p.text)}</button>`,
    },
    label: {
        label: "label", icon: "🏷️",
        themeSync: ["font"],
        def: {
            w: 100, h: 24,
            text: "Label1",
            bg: "transparent", fg: "#000",
            fontSize: 12, fontFamily: "", fontBold: false,
            align: "left",
            visible: true, description: "",
        },
        events: ["Click", "MouseEnter", "MouseLeave"],
        pdefs: [
            ...PP_POS,
            { sep: "外観" },
            { k: "text", lb: "Text", t: "text" },
            { k: "fg", lb: "ForeColor", t: "color" },
            { k: "bg", lb: "BackColor", t: "color" },
            ...PP_FONT,
            { k: "baseColor", lb: "テーマ", t: "themeReset" },
            { k: "align", lb: "Align", t: "sel", opts: ["left", "center", "right"] },
            ...PP_TAIL,
        ],
        preview: (p, base, vis) => `<div style="${base}background:${p.bg};color:${p.fg};font-size:${p.fontSize}px;font-family:${p.fontFamily || ""};font-weight:${p.fontBold ? "bold" : "normal"};text-align:${p.align || "left"};display:flex;align-items:center;overflow:hidden;padding:0 2px;${vis}">${esc(p.text)}</div>`,
    },
    inputtype: {
        label: "text", icon: "📝",
        themeSync: ["font", "color"],
        def: {
            w: 140, h: 28,
            inputType: "text", text: "", placeholder: "",
            bg: "#fff", fg: "#000",
            fontSize: 12, fontFamily: "", fontBold: false,
            borderSize: 1, borderColor: "#cccccc",
            maxLength: 0, required: false, readonly: false, disabled: false,
            visible: true, description: "",
        },
        events: ["TextChanged", "KeyDown", "KeyUp", "GotFocus", "LostFocus", "Click"],
        pdefs: [
            ...PP_POS,
            { sep: "入力タイプ" },
            {
                k: "inputType", lb: "InputType", t: "sel",
                opts: ["text", "password", "number", "email", "tel", "date", "time", "datetime-local", "url", "search"]
            },
            { sep: "外観" },
            { k: "text", lb: "Text", t: "text" },
            { k: "placeholder", lb: "Placeholder", t: "text" },
            { k: "maxLength", lb: "MaxLength", t: "num" },
            { k: "bg", lb: "BackColor", t: "color" },
            { k: "fg", lb: "ForeColor", t: "color" },
            ...PP_FONT,
            ...PP_BORDER,
            { sep: "動作" },
            { k: "disabled", lb: "Disabled", t: "bool" },
            { k: "readonly", lb: "ReadOnly", t: "bool" },
            { k: "required", lb: "Required", t: "bool" },
            ...PP_TAIL,
        ],
        preview: (p, base, vis) => {
            const itype = p.inputType || "text";
            const typeIcons = {
                password: "🔒 password",
                email: "📧 email",
                number: "🔢 number",
                tel: "📞 tel",
                url: "🌐 url",
                search: "🔍 search",
                date: "📅 date",
                time: "⏰ time",
                month: "📆 month",
                week: "🗓 week",
                "datetime-local": "📅🕐 datetime",
                color: "🎨 color",
                range: "↔ range",
                file: "📁 file",
                text: "📝 text",
            };
            const needsPreview = [
                "date", "time", "month", "week", "datetime-local", "color", "range", "file",
            ].includes(itype);
            if (needsPreview) {
                return `<div style="${base}background:${p.bg};color:${p.fg};font-size:${p.fontSize}px;font-family:${p.fontFamily || ""};font-weight:${p.fontBold ? "bold" : "normal"};border:${(p.borderSize || 0) + "px solid " + (p.borderColor || "#cccccc")};display:flex;align-items:center;padding:0 6px;gap:6px;pointer-events:none;${vis}"><span style="font-size:11px;opacity:.7">${typeIcons[itype] || itype}</span></div>`;
            }
            return `<input type="${itype}" value="${esc(p.text)}" placeholder="${esc(p.placeholder || "")}" ${p.maxLength ? `maxlength="${p.maxLength}"` : ""}  style="${base}background:${p.bg};color:${p.fg};font-size:${p.fontSize}px;font-family:${p.fontFamily || ""};font-weight:${p.fontBold ? "bold" : "normal"};border:${(p.borderSize || 0) + "px solid " + (p.borderColor || "#cccccc")};padding:0 4px;pointer-events:none;${vis}">`;
        },
    },
    textarea: {
        label: "textarea", icon: "📄",
        themeSync: ["font", "color"],
        def: {
            w: 200, h: 80,
            text: "", placeholder: "",
            bg: "#fff", fg: "#000",
            fontSize: 12, fontFamily: "", fontBold: false,
            borderSize: 1, borderColor: "#cccccc",
            disabled: false, readonly: false,
            visible: true, description: "",
        },
        events: ["TextChanged", "KeyDown", "KeyUp", "GotFocus", "LostFocus", "Click"],
        pdefs: [
            ...PP_POS,
            { sep: "外観" },
            { k: "text", lb: "Text", t: "area" },
            { k: "placeholder", lb: "Placeholder", t: "text" },
            { k: "bg", lb: "BackColor", t: "color" },
            { k: "fg", lb: "ForeColor", t: "color" },
            ...PP_FONT,
            ...PP_BORDER,
            { sep: "動作" },
            { k: "disabled", lb: "Disabled", t: "bool" },
            { k: "readonly", lb: "ReadOnly", t: "bool" },
            ...PP_TAIL,
        ],
        preview: (p, base, vis) => `<textarea style="${base}background:${p.bg || "#fff"};color:${p.fg || "#000"};font-size:${p.fontSize || 12}px;font-family:${p.fontFamily || ""};font-weight:${p.fontBold ? "bold" : "normal"};border:${(p.borderSize || 1) + "px solid " + (p.borderColor || "#cccccc")};resize:none;padding:4px;box-sizing:border-box;pointer-events:none;${vis}" placeholder="${esc(p.placeholder || "")}">${esc(p.text || "")}</textarea>`,
    },
    checkbox: {
        label: "checkbox", icon: "☑️",
        themeSync: ["font"],
        def: {
            w: 100, h: 22,
            text: "CheckBox1", checked: false,
            fg: "#000",
            fontSize: 12, fontFamily: "", fontBold: false,
            visible: true, description: "",
        },
        events: ["Click", "CheckedChanged"],
        pdefs: [
            ...PP_POS,
            { sep: "外観" },
            { k: "text", lb: "Text", t: "text" },
            { k: "fg", lb: "ForeColor", t: "color" },
            ...PP_FONT,
            { k: "baseColor", lb: "テーマ", t: "themeReset" },
            { sep: "状態" },
            { k: "checked", lb: "Checked", t: "bool" },
            ...PP_TAIL,
        ],
        preview: (p, base, vis) => `<label style="${base}display:flex;align-items:center;gap:4px;color:${p.fg};font-size:${p.fontSize}px;font-family:${p.fontFamily || ""};font-weight:${p.fontBold ? "bold" : "normal"};pointer-events:none;${vis}"><input type="checkbox" ${p.checked ? "checked" : ""}>${esc(p.text)}</label>`,
    },
    radio: {
        label: "radioButton", icon: "🔘",
        themeSync: ["font"],
        def: {
            w: 100, h: 22,
            text: "RadioButton1", checked: false, group: "Group1",
            fg: "#000",
            fontSize: 12, fontFamily: "", fontBold: false,
            visible: true, description: "",
        },
        events: ["Click", "CheckedChanged"],
        pdefs: [
            ...PP_POS,
            { sep: "外観" },
            { k: "text", lb: "Text", t: "text" },
            { k: "group", lb: "GroupName", t: "text" },
            { k: "fg", lb: "ForeColor", t: "color" },
            ...PP_FONT,
            { k: "baseColor", lb: "テーマ", t: "themeReset" },
            { sep: "状態" },
            { k: "checked", lb: "Checked", t: "bool" },
            ...PP_TAIL,
        ],
        preview: (p, base, vis) => `<label style="${base}display:flex;align-items:center;gap:4px;color:${p.fg};font-size:${p.fontSize}px;font-family:${p.fontFamily || ""};font-weight:${p.fontBold ? "bold" : "normal"};pointer-events:none;${vis}"><input type="radio" name="${esc(p.group || "g")}" ${p.checked ? "checked" : ""}>${esc(p.text)}</label>`,
    },
    selectBox: {
        label: "selectBox", icon: "🔽",
        themeSync: ["font", "color"],
        def: {
            w: 120, h: 24,
            items: "項目1\n項目2\n項目3",
            bg: "#fff", fg: "#000",
            fontSize: 12, fontFamily: "", fontBold: false,
            borderSize: 1, borderColor: "#cccccc",
            visible: true, description: "",
        },
        events: ["SelectedIndexChanged", "TextChanged", "DropDown"],
        pdefs: [
            ...PP_POS,
            { sep: "外観" },
            { k: "items", lb: "Items", t: "itemsdef" },
            { k: "bg", lb: "BackColor", t: "color" },
            { k: "fg", lb: "ForeColor", t: "color" },
            ...PP_FONT,
            ...PP_BORDER,
            ...PP_TAIL,
        ],
        preview: (p, base, vis) => `<select style="${base}background:${p.bg};color:${p.fg};font-size:${p.fontSize}px;font-family:${p.fontFamily || ""};font-weight:${p.fontBold ? "bold" : "normal"};border:${(p.borderSize || 0) + "px solid " + (p.borderColor || "#cccccc")};pointer-events:none;${vis}">${(
            p.items || ""
        )
            .split("\n")
            .map((s) => { const idx = s.indexOf("="); const label = idx > 0 ? s.slice(0, idx).trim() : s.trim(); const val = idx > 0 ? s.slice(idx + 1).trim() : s.trim(); return `<option value="${esc(val)}">${esc(label)}</option>`; })
            .join("")}</select>`,
    },
    listbox: {
        label: "listBox", icon: "📋",
        themeSync: ["font", "color"],
        def: {
            w: 120, h: 80,
            items: "項目1\n項目2\n項目3",
            bg: "#fff", fg: "#000",
            fontSize: 12, fontFamily: "", fontBold: false,
            borderSize: 1, borderColor: "#cccccc",
            visible: true, description: "",
        },
        events: ["SelectedIndexChanged", "Click", "MouseDown"],
        pdefs: [
            ...PP_POS,
            { sep: "外観" },
            { k: "items", lb: "Items", t: "itemsdef" },
            { k: "bg", lb: "BackColor", t: "color" },
            { k: "fg", lb: "ForeColor", t: "color" },
            ...PP_FONT,
            ...PP_BORDER,
            ...PP_TAIL,
        ],
        preview: (p, base, vis) => `<select multiple style="${base}background:${p.bg};color:${p.fg};font-size:${p.fontSize}px;font-family:${p.fontFamily || ""};font-weight:${p.fontBold ? "bold" : "normal"};border:${(p.borderSize || 0) + "px solid " + (p.borderColor || "#cccccc")};pointer-events:none;${vis}">${(
            p.items || ""
        )
            .split("\n")
            .map((s) => { const idx = s.indexOf("="); const label = idx > 0 ? s.slice(0, idx).trim() : s.trim(); const val = idx > 0 ? s.slice(idx + 1).trim() : s.trim(); return `<option value="${esc(val)}">${esc(label)}</option>`; })
            .join("")}</select>`,
    },
    datagrid: {
        label: "テーブル", icon: "🗃️",
        themeSync: ["font", "color"],
        def: {
            w: 320, h: 160,
            columns: "ID:20\n名前:50\n値:30",
            maxRows: 10,
            headerBg: "#4a4a6a", headerFg: "#ffffff",
            rowBg: "#ffffff", rowAltBg: "#f5f5f5", rowFg: "#000000",
            borderSize: 1, borderColor: "#cccccc",
            fontSize: 12, fontFamily: "", fontBold: false,
            rowHeight: 24, headerHeight: 28,
            visible: true, description: "",
        },
        events: ["Click", "RowClick", "HeaderClick"],
        pdefs: [
            ...PP_POS,
            { sep: "外観" },
            { k: "columns", lb: "Columns", t: "coldef" },
            { k: "headerBg", lb: "HeaderBg", t: "color" },
            { k: "headerFg", lb: "HeaderFg", t: "color" },
            { k: "rowBg", lb: "RowBackColor", t: "color" },
            { k: "rowAltBg", lb: "AltRowBackColor", t: "color" },
            { k: "rowFg", lb: "RowForeColor", t: "color" },
            ...PP_FONT,
            ...PP_BORDER,
            { k: "maxRows", lb: "MaxRows", t: "num" },
            { k: "rowHeight", lb: "RowHeight", t: "num" },
            { k: "headerHeight", lb: "HeaderHeight", t: "num" },
            ...PP_TAIL,
        ],
        preview: (p) => {
            const cols = (p.columns || "ID:20\n名前:50\n値:30").split(/[;\n]/).filter(s => s.trim()).map((c, ci) => {
                const parts = c.trim().split(":");
                const label = parts[0] || ("列" + (ci + 1));
                const width = parseInt(parts[1]) || 20;
                const displayName = parts[2] || "";
                return { key: "col" + ci, label, width, displayName };
            });
            const maxR = p.maxRows || 5;
            const hbg = p.headerBg || "#4a4a6a";
            const hfg = p.headerFg || "#ffffff";
            const rbg = p.rowBg || "#ffffff";
            const rabg = p.rowAltBg || "#f5f5f5";
            const rfg = p.rowFg || "#000000";
            const bc = p.borderColor || "#cccccc";
            const fs = p.fontSize || 12;
            const vis2 = p.visible === false ? "visibility:hidden" : "";
            const ff = p.fontFamily || "";
            const fw = p.fontBold ? "bold" : "normal";
            const fontStyle = (ff ? `font-family:${ff};` : "") + `font-weight:${fw};`;
            let html = `<div style="width:100%;height:100%;overflow:auto;border:1px solid ${bc};box-sizing:border-box;font-size:${fs}px;${fontStyle}${vis2}">`;
            html += `<table style="width:100%;border-collapse:collapse;table-layout:fixed">`;
            html += `<thead><tr style="background:${hbg};color:${hfg}">`;
            cols.forEach(c => {
                html += `<th style="width:${c.width}%;padding:3px 6px;border:1px solid ${bc};text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${fontStyle}">${esc(c.displayName || c.label)}</th>`;
            });
            html += `</tr></thead><tbody>`;
            for (let r = 0; r < Math.min(maxR, 5); r++) {
                const bg2 = r % 2 === 0 ? rbg : rabg;
                html += `<tr style="background:${bg2};color:${rfg}">`;
                cols.forEach(c => {
                    html += `<td style="padding:2px 6px;border:1px solid ${bc};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${fontStyle}">${r === 0 ? "(データ)" : ""}</td>`;
                });
                html += `</tr>`;
            }
            html += `</tbody></table></div>`;
            return html;
        },
    },
    progressbar: {
        label: "progress", icon: "📊",
        themeSync: ["color"],
        def: {
            w: 200, h: 20,
            value: 50, min: 0, max: 100,
            bg: "#e0e0e0", fg: "#5b7bfa",
            borderSize: 1, borderColor: "#cccccc",
            visible: true, description: "",
        },
        events: ["Click"],
        pdefs: [
            ...PP_POS,
            { sep: "値" },
            { k: "value", lb: "Value", t: "num" },
            { k: "min", lb: "Min", t: "num" },
            { k: "max", lb: "Max", t: "num" },
            { sep: "外観" },
            { k: "bg", lb: "BackColor", t: "color" },
            { k: "fg", lb: "BarColor", t: "color" },
            ...PP_BORDER,
            ...PP_TAIL,
        ],
        preview: (p, base, vis) => {
            const pval = Math.min(100, Math.max(0, ((p.value || 0) - (p.min || 0)) / ((p.max || 100) - (p.min || 0)) * 100));
            return `<div style="${base}background:${p.bg || "#e0e0e0"};border:${(p.borderSize || 1) + "px solid " + (p.borderColor || "#cccccc")};border-radius:3px;overflow:hidden;${vis}"><div style="width:${pval}%;height:100%;background:${p.fg || "#5b7bfa"};transition:width 0.2s;border-radius:3px"></div></div>`;
        },
    },
    groupbox: {
        label: "groupBox", icon: "🗂️",
        themeSync: ["font", "color"],
        def: {
            w: 160, h: 100,
            text: "GroupBox1",
            bg: "transparent", fg: "#000",
            fontSize: 12, fontFamily: "", fontBold: false,
            borderSize: 1, borderColor: "#cccccc",
            visible: true, description: "",
        },
        events: ["Click"],
        pdefs: [
            ...PP_POS,
            { sep: "外観" },
            { k: "text", lb: "Text", t: "text" },
            { k: "fg", lb: "ForeColor", t: "color" },
            { k: "bg", lb: "BackColor", t: "color" },
            ...PP_FONT,
            ...PP_BORDER,
            ...PP_TAIL,
        ],
        preview: (p, base, vis) => `<fieldset style="${base}background:${p.bg};color:${p.fg};font-size:${p.fontSize}px;font-family:${p.fontFamily || ""};font-weight:${p.fontBold ? "bold" : "normal"};border:${(p.borderSize || 0) + "px solid " + (p.borderColor || "#cccccc")};${vis}"><legend style="padding:0 4px;font-size:${p.fontSize}px;font-family:${p.fontFamily || ""};font-weight:${p.fontBold ? "bold" : "normal"}">${esc(p.text)}</legend></fieldset>`,
    },
    picture: {
        label: "image", icon: "🖼️",
        themeSync: ["color"],
        def: {
            w: 100, h: 80,
            src: "", bg: "#ddd", objectFit: "contain",
            borderSize: 1, borderColor: "#cccccc",
            visible: true, description: "",
        },
        events: ["Click", "MouseDown", "MouseUp"],
        pdefs: [
            ...PP_POS,
            { sep: "画像" },
            { k: "src", lb: "Image", t: "img" },
            { k: "objectFit", lb: "ObjectFit", t: "sel", opts: ["contain", "cover", "fill", "none"] },
            { k: "bg", lb: "BackColor", t: "color" },
            ...PP_BORDER,
            ...PP_TAIL,
        ],
        preview: (p, base, vis) => `<div style="${base}background:${p.bg};border:${(p.borderSize || 0) + "px solid " + (p.borderColor || "#cccccc")};display:flex;align-items:center;justify-content:center;color:#888;font-size:11px;${vis}">${p.src ? `<img src="${esc(p.src)}" style="max-width:100%;max-height:100%;object-fit:${p.objectFit || "contain"}">` : "📷"}</div>`,
    },
    datepicker: {
        label: "日付/時刻", icon: "📅",
        themeSync: ["font", "color"],
        def: {
            w: 160, h: 28,
            inputType: "date", value: "", min: "", max: "",
            bg: "#fff", fg: "#000",
            fontSize: 12, fontFamily: "", fontBold: false,
            borderSize: 1, borderColor: "#cccccc",
            disabled: false, readonly: false, visible: true, description: "",
        },
        events: ["TextChanged", "GotFocus", "LostFocus", "Click"],
        pdefs: [
            ...PP_POS,
            { sep: "外観" },
            { k: "bg", lb: "BackColor", t: "color" },
            { k: "fg", lb: "ForeColor", t: "color" },
            ...PP_FONT,
            ...PP_BORDER,
            { sep: "種別" },
            { k: "inputType", lb: "InputType", t: "select", opts: ["date", "time", "datetime-local", "month"] },
            { sep: "値" },
            { k: "value", lb: "Value", t: "text" },
            { k: "min", lb: "Min", t: "text" },
            { k: "max", lb: "Max", t: "text" },
            { sep: "動作" },
            { k: "disabled", lb: "Disabled", t: "bool" },
            { k: "readonly", lb: "ReadOnly", t: "bool" },
            ...PP_TAIL,
        ],
        preview: (p, base, vis) => {
            const _itype = p.inputType || "date";
            return `<input type="${_itype}" value="${esc(p.value || "")}" ${p.min ? `min="${esc(p.min)}"` : ""}  ${p.max ? `max="${esc(p.max)}"` : ""}  style="${base}background:${p.bg};color:${p.fg};font-size:${p.fontSize}px;font-family:${p.fontFamily || ""};font-weight:${p.fontBold ? "bold" : "normal"};border:${(p.borderSize || 0) + "px solid " + (p.borderColor || "#cccccc")};padding:0 4px;pointer-events:none;${vis}">`;
        },
    },
    slider: {
        label: "スライダー", icon: "🎚️",
        def: {
            w: 160, h: 28,
            min: 0, max: 100, value: 0, step: 1,
            orient: "horizontal", bg: "transparent",
            disabled: false, visible: true, description: "",
        },
        events: ["ValueChanged", "MouseDown", "MouseUp"],
        pdefs: [
            ...PP_POS,
            { sep: "値" },
            { k: "min", lb: "Min", t: "num" },
            { k: "max", lb: "Max", t: "num" },
            { k: "value", lb: "Value", t: "num" },
            { k: "step", lb: "Step", t: "num" },
            { sep: "外観" },
            { k: "orient", lb: "Orient", t: "select", opts: ["horizontal", "vertical"] },
            { k: "bg", lb: "BackColor", t: "color" },
            { sep: "動作" },
            { k: "disabled", lb: "Disabled", t: "bool" },
            ...PP_TAIL,
        ],
        preview: (p, base, vis) => `<div style="${base}display:flex;align-items:center;${vis}"><input type="range" min="${p.min || 0}" max="${p.max || 100}" value="${p.value || 0}" step="${p.step || 1}" style="width:100%;pointer-events:none;accent-color:#5b7bfa"></div>`,
    },
    hscroll: {
        label: "水平scroll", icon: "↔️",
        def: {
            w: 120, h: 18,
            min: 0, max: 100, val: 0,
            visible: true, description: "",
        },
        events: ["Scroll", "ValueChanged"],
        pdefs: [
            ...PP_POS,
            { sep: "値" },
            { k: "min", lb: "Min", t: "num" },
            { k: "max", lb: "Max", t: "num" },
            { k: "val", lb: "Value", t: "num" },
            ...PP_TAIL,
        ],
        preview: (p, base, vis) => `<div style="${base}background:${p.bg || "#ddd"};border:1px solid #999;border-radius:2px;display:flex;align-items:center;justify-content:space-between;padding:0 2px;${vis}"><span style="font-size:9px">◀</span><div style="flex:1;height:50%;background:#999;margin:0 3px;border-radius:1px"></div><span style="font-size:9px">▶</span></div>`,
    },
    vscroll: {
        label: "垂直scroll", icon: "↕️",
        def: {
            w: 18, h: 80,
            min: 0, max: 100, val: 0,
            visible: true, description: "",
        },
        events: ["Scroll", "ValueChanged"],
        pdefs: [
            ...PP_POS,
            { sep: "値" },
            { k: "min", lb: "Min", t: "num" },
            { k: "max", lb: "Max", t: "num" },
            { k: "val", lb: "Value", t: "num" },
            ...PP_TAIL,
        ],
        preview: (p, base, vis) => `<div style="${base}background:${p.bg || "#ddd"};border:1px solid #999;border-radius:2px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:2px 0;${vis}"><span style="font-size:9px">▲</span><div style="width:50%;flex:1;background:#999;margin:3px 0;border-radius:1px"></div><span style="font-size:9px">▼</span></div>`,
    },
    // フォーム自体（ツールボックスには表示されないため label/icon/def は持たない）
    form: {
        events: ["Load", "Resize", "Click", "KeyDown", "KeyUp", "Closing"],
        pdefs: [
            { k: "name", lb: "name", t: "text", sp: "formName" },
            { k: "title", lb: "title", t: "text", sp: "formTitle" },
            { k: "w", lb: "Width", t: "num", sp: "formW" },
            { k: "h", lb: "Height", t: "num", sp: "formH" },
            { k: "bg", lb: "背景色", t: "color", sp: "formBg" },
            { k: "description", lb: "説明（任意）", t: "area", sp: "formDesc" },
            { sep: "AI" },
            { k: "_aiDesign", lb: "画面デザイン", t: "formAiDesign" },
            { sep: "テーマ（新規配置ウィジェットの初期値）" },
            { k: "themeFontFamily", lb: "フォント", t: "fontsel", sp: "formThemeFontFamily" },
            { k: "themeFontSize", lb: "文字サイズ", t: "num", sp: "formThemeFontSize" },
            { k: "themeFg", lb: "文字色", t: "color", sp: "formThemeFg" },
            { k: "themeBaseColor", lb: "ベースカラー", t: "color", sp: "formThemeBaseColor" },
        ],
    },
};

// ツールボックスのid（タグ名と同一、ただし"pointer"のみ特殊）からツール情報を取得する。
// 旧 TOOLS.find(t => t.id === id) の置き換え。
function getToolById(id) {
    if (id === "pointer") return POINTER_TOOL;
    const d = WIDGET_DEFS[id];
    return d ? { id, tag: id, label: d.label, icon: d.icon, def: d.def } : null;
}

/* ═══════════════════════════════════════════
    STATE  （マルチフォーム対応）
═══════════════════════════════════════════ */

// フォーム1枚分のデータ構造を生成
function makeFormData(title = "Form1") {
    return {
        id:
            "f" +
            Date.now() +
            Math.random().toString(36).slice(2, 6),
        cfg: {
            title, name: title, w: 640, h: 420, bg: "#ececec", description: "",
            // フォーム共通テーマ（新規ウィジェット作成時の初期値として使用。
            // 既存プロジェクトはこの値が無いため getFormTheme() 側で規定値を補完する）
            themeFontFamily: "", themeFontSize: 12, themeFg: "#000", themeBaseColor: "#e0e0e0",
        },
        widgets: [],
        idCnt: 1,
        constants: [], // フォーム単位の定数
        events: {},    // フォームイベント
        // ── バリデーション定義 ──────────────────────────────
        // テーブル管理と同じ構成。validationsは定義の配列。
        // 各定義: { name, toastDuration, rules: [{ name, type, arg1, arg2, arg3, message }] }
        //   name: 定義名（vja.validate.run('定義名') で呼び出す）
        //   toastDuration: トースト表示時間（ms）省略時5000ms
        //   rules[].name: 対象ウィジェット名
        //   rules[].type: required/maxLength/minLength/range/numeric/integer/
        //                 email/tel/zipcode/url/date/alphanumeric/alpha/
        //                 hiragana/katakana/pattern
        //   rules[].arg1〜arg3: バリデーションタイプに応じた引数
        //   rules[].message: エラー時のトースト表示メッセージ
        validations: [],
    };
}

/* ═══════════════════════════════════════════
    _CTX — 状態管理オブジェクト
    デザイナー全体の状態をグループごとに管理する。
    各グループへのアクセスは getter 関数経由で行う。
═══════════════════════════════════════════ */
var _CTX = {
    // デザイナーのUI操作状態
    _state: {
        selIds: [],
        activeTool: "pointer",
        snapOn: true,
        showGrid: false,
        curTab: "p",
        ctxId: null,
    },
    // プロジェクトデータ
    _project: {
        forms: [],
        curFormIdx: 0,
        startFormId: "",
        constants: [],
        tables: [],
        cloudInfras: [],
        extRuntime: { js: "", doc: "" },
        formDesignDraft: "",
        // 現在編集中フォームへのショートカット（syncCurForm()で都度更新される）
        widgets: [],
        formCfg: {},
        idCnt: 1,
        // イベントJS生成・検証まわりの「wid_evName」キー付きオーバーライド保存先。
        // 以前はvja-modal.jsのsnapshot()/applyProjectData()にだけ後付けされ、
        // _project本体には定義がなかった（新規フィールド追加時の保存/復元漏れの
        // 温床になっていたため、単一情報源としてここにも定義する）。
        mockOverrides: {},
        apiOptOverrides: {},
        tableOptOverrides: {},
        validationOverrides: {},
        mockCheckOverrides: {},
        learnedFixes: {},
        aiConfig: {
            endpoint: "http://localhost:8080",
            apiKey: "",
            model: "",
            models: [],
            enabled: false,
            routerMode: false,
            maxTokens: "",
            temperature: "",
            thinking: true,
        },
        projectInfo: {
            name: "",
            description: "",
            version: "1.0.0",
            author: "",
            company: "",
            appEvents: { onStart: "", onExit: "", onStart_yaml: "", onExit_yaml: "" },
        },
    },
    // 編集履歴・保存パス
    _history: {
        undoStack: [],
        redoStack: [],
        savedSnapshot: null,
        lastSavePath: null,
        lastOpenPath: null,
    },
    // YAMLエディタの入力状態
    _editor: {
        searchLast: { taId: null, word: "", pos: 0 },
        clickPos: -1,
        lastMouseDown: 0,
        dblPending: false,
        yu: { stack: [], idx: -1, busy: false },
        ju: { stack: [], idx: -1, busy: false },
    },
    // AI生成リクエストの状態
    _ai: {
        fetchId: null,
        loadingTimer: null,
    },
    // フォント・パネル幅等のUI設定
    _ui: {
        config: {
            uiFontSize: 13,
            uiFontFamily: "",
            editorFontSize: 16,
            editorFontFamily: "'Courier New', Courier, monospace",
            leftPanelW: 110,
            rightPanelW: 420,
        },
    },
};

// ── _CTX getter 関数 ──────────────────────────
function getDesignerState() { return _CTX._state; }
function getProjectData() { return _CTX._project; }
function getEditHistory() { return _CTX._history; }
function getEditorContext() { return _CTX._editor; }
function getAiContext() { return _CTX._ai; }
function getUiConfig() { return _CTX._ui.config; }

/* ═══════════════════════════════════════════
    機能別ローカル状態オブジェクト
    _CTX とは別に、特定の1モーダル・1エディタの中でしか
    使わない局所的な一時状態をここにまとめる。
═══════════════════════════════════════════ */
// クラウドインフラ設定モーダル専用の一時状態
var _CLOUD_MODAL = {
    draft: [],
};
// アプリイベント編集モーダル専用の一時状態
var _APPEVENT_MODAL = {
    curKey: "onStart",
};
// 拡張ランタイムエディタ専用のUndo状態
var _EXTRT_EDITOR = {
    jsUndo: { stack: [], idx: -1, busy: false },
    docUndo: { stack: [], idx: -1, busy: false },
};
// AIフォーム設計エディタ専用のUndo状態
var _FORMDESIGN_EDITOR = {
    taUndo: { stack: [], idx: -1, busy: false },
};
// 項目定義エディタ専用の一時状態
var _ITEMSDEF_EDITOR = {
    wid: null,
    rows: [],
};
// 確認ダイアログ専用の一時状態
var _CONFIRM_MODAL = {
    okCb: null,
};
// カラム定義エディタ専用の一時状態
var _COLDEF_MODAL = {
    wid: null,
    rows: [],
    maxRows: 0,
};
// 定数編集モーダル専用の一時状態
var _CONST_MODAL = {
    rows: [],
};
// バリデーション編集モーダル専用の一時状態
var _VALID_MODAL = {
    edit: null,
};
// テーブル編集モーダル専用の一時状態
var _TABLE_MODAL = {
    edit: null,
    editIdx: -1,
};

// _CTX._project の初期データを設定
getProjectData().forms = [makeFormData("Form1")];
getProjectData().startFormId = getProjectData().forms[0]?.id ?? "";

// UIフォント用フォントリスト
const UI_FONT_LIST = [
    { label: "（システムデフォルト）", value: "" },
    { label: "Yu Gothic UI", value: "'Yu Gothic UI', 'Meiryo UI', sans-serif" },
    { label: "Meiryo", value: "'Meiryo', sans-serif" },
    { label: "Segoe UI", value: "'Segoe UI', sans-serif" },
    { label: "Noto Sans JP", value: "'Noto Sans JP', sans-serif" },
    { label: "sans-serif", value: "sans-serif" },
    { label: "serif", value: "serif" },
];

// 現在フォームへのショートカット（_CTX._project に統合済み）
getProjectData().widgets = getProjectData().forms[0].widgets;
getProjectData().formCfg = getProjectData().forms[0].cfg;
getProjectData().idCnt = getProjectData().forms[0].idCnt;

const SNAP = 8;

// 現在フォームの参照を更新する
// ── UI全更新（フォーム切替・Undo/Redo後など） ──
function refreshAll() {
    syncCurForm();
    buildFormSelect();
    applyForm();
    fullRedraw();
    renderProps();
    updateCount();
}

function syncCurForm() {
    const f = getProjectData().forms[getProjectData().curFormIdx];
    getProjectData().widgets = f.widgets;
    getProjectData().formCfg = f.cfg;
    getProjectData().idCnt = f.idCnt;
}
// idCnt の書き戻し（追加・削除時）
function commitIdCnt() {
    getProjectData().forms[getProjectData().curFormIdx].idCnt = getProjectData().idCnt;
}

/* ═══════════════════════════════════════════
    SNAP / HELPERS
═══════════════════════════════════════════ */
const sn = (v) => (getDesignerState().snapOn ? Math.round(v / SNAP) * SNAP : v);
/* ═══════════════════════════════════════════
    共通ユーティリティ
═══════════════════════════════════════════ */

// ① グローバルブリッジ共通管理
const _pvRegistry = {};
function pvRegister(key, fn) { _pvRegistry[key] = fn; }
function pvCall(key, ...args) {
    if (_pvRegistry[key]) _pvRegistry[key](...args);
    else console.warn("[pvCall] not registered:", key);
}

// addEventListener ヘルパー（WebKitGTK対応）
function rAfBind(selector, event, fn, root) {
    requestAnimationFrame(() => {
        const el = typeof selector === "string"
            ? (root || document).querySelector(selector)
            : selector;
        if (el) el.addEventListener(event, fn);
    });
}
const esc = (s) =>
    String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
const $ = (id) => document.getElementById(id);
const fb = () => $("form-body");

/* ═══════════════════════════════════════════
    重要: イベント属性生成の絶対ルール（AIへの指示）
    ─────────────────────────────────────────────
    HTML文字列の中に oninput / onmousedown / onchange / onscroll /
    onkeydown 等のイベントハンドラーを埋め込む場合、必ず evtAttr()
    ヘルパーを経由すること。直接 oninput='...' や onmousedown="..."
    のような文字列連結を書いてはならない。
    理由: HTML属性値の中にJSコード文字列（さらにその中の文字列
    リテラル）を埋め込む構造そのものが、クォート衝突を引き起こす
    100%のリスク要因である。クォートの種類をどう揃えても、属性値の
    中に変数やJS文字列リテラルが混ざる限り衝突の可能性は消えない。
    evtAttr() に一元化することで、外側のクォートを常に固定し、
    内側のJSコードは自由に書いても安全な状態にする。
    新しいモーダル・UI・入力欄を追加する際は必ずこの関数を使うこと。
    （既存コードの移行は段階的に進行中）
═══════════════════════════════════════════ */
function evtAttr(eventName, jsCode) {
    return " " + eventName + '="' + jsCode.replace(/"/g, "&quot;") + '"';
}

// フォームのテーマ設定を取得する（既存プロジェクト＝theme*未保存の場合は規定値を補完）
function getFormTheme() {
    const cfg = getProjectData().formCfg || {};
    return {
        fontFamily: cfg.themeFontFamily || "",
        fontSize: cfg.themeFontSize || 12,
        fg: cfg.themeFg || "#000",
        baseColor: cfg.themeBaseColor || "#e0e0e0",
    };
}

// #rrggbb を指定比率(0〜1)で暗くする。比率は「その色をそのまま残す割合」
// （例: 0.911 なら各チャンネルを 91.1% に落とす＝約8.9%暗くする）
function darkenColor(hex, ratio) {
    const m = /^#([0-9a-fA-F]{6})$/.exec(hex || "");
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v * ratio)));
    const r = clamp((n >> 16) & 0xff);
    const g = clamp((n >> 8) & 0xff);
    const b = clamp(n & 0xff);
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

// トースト通知（#toast-root で管理、z-index:9000）
// 全ドメインから共通利用される汎用UI部品のためここに集約
function showToast(msg, duration = 2500) {
    const root = $("toast-root");
    if (!root) return;
    const t = document.createElement("div");
    t.className = "toast-msg";
    t.style.fontSize = "15px";
    t.textContent = msg;
    root.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
        t.classList.remove("show");
        setTimeout(() => t.remove(), 200);
    }, duration);
}

/* ═══════════════════════════════════════════
    window へのエクスポート
    ─────────────────────────────────────────────
    各 <script> タグはElectrobun(Bun)のバンドラーにより
    それぞれ独立したモジュールスコープとして扱われるため、
    ファイルをまたいで関数・変数を共有するには、
    init-params.js と同様に window オブジェクトへ
    明示的に代入する必要がある。
    このファイルが他ファイルへ提供するものを全てここに列挙する。
    （widgets/formCfg/idCnt は _CTX._project に統合済みのため、
    個別の window.widgets 等は不要。getProjectData().widgets の形で参照する）
═══════════════════════════════════════════ */
Object.assign(window, {
    // 状態管理オブジェクト・getter
    _CTX,
    getDesignerState, getProjectData, getEditHistory,
    getEditorContext, getAiContext, getUiConfig,
    // 機能別ローカル状態オブジェクト
    _CLOUD_MODAL, _APPEVENT_MODAL, _EXTRT_EDITOR, _ITEMSDEF_EDITOR, _FORMDESIGN_EDITOR,
    _CONFIRM_MODAL, _COLDEF_MODAL, _CONST_MODAL, _VALID_MODAL, _TABLE_MODAL,
    // ウィジェット定義
    PP_POS, PP_FONT, PP_BORDER, PP_TAIL,
    POINTER_TOOL, WIDGET_DEFS, getToolById,
    // UI定義・定数
    UI_FONT_LIST, SNAP, sn,
    // 共通ユーティリティ
    esc, $, fb, evtAttr, _pvRegistry, pvRegister, pvCall, rAfBind, showToast,
    getFormTheme, darkenColor,
    // フォームデータ生成・現在フォームのショートカット同期関数
    makeFormData, refreshAll, syncCurForm, commitIdCnt,
});
