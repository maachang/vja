/* ═══════════════════════════════════════════════════════════════
   vja-form-design-ai.js — 画面デザインAI生成一式
   2026-09-21にvja-yaml-editor.jsから分割した6つ目（分割方針の詳細は
   CLAUDE.mdの「vja-yaml-editor.jsの分割整理」節を参照）。

   【提供する機能】
   - 画面デザインテンプレート適用（insertFormDesignTemplate/
     openFormDesignTemplateModal/confirmApplyFormDesignTemplate）
   - 画面レイアウトイメージ選択（buildFormLayoutPickerHtml/selectFormLayoutPattern）
   - 「🤖 AIでフォーム設計」モーダル本体（openFormDesignAi）
   - 画面デザインYAMLドラフト生成（generateFormDesignYaml/formDesignTextToYamlGenerate）
   - 画面デザインYAMLのパース・機械的後処理（parseFormDesignYaml/parseFormDesignJson/
     deriveMissingFormDesignTables/_fixArithmeticInFormDesignJson/convertFormDesignEngKeysToJp）
   - 画面デザインAI生成本体（generateFormLayoutRaw/generateFormDesignAiLayout/
     formDesignAiGenerate/openAiRawOutputModal/saveFormDesignDraft）

   【依存関係（読み込み順に注意）】
   - vja-defs.js: getProjectData/getWidget等
   - vja-modal.js: showModal/closeModal/pushUndo/runAiGenerate
   - vja-html.js: render/evtAttr
   - vja-designer.js: applyAiFormDesign/fullRedraw
   - form-design-templates.js: getFormDesignTemplateYaml
   - form-layout-patterns.js: FORM_LAYOUT_PATTERNS/buildLayoutRegionsPromptText
   - vja-yaml-editor.js: buildTablesCtxText/getVjaApiWhitelist/formatJsCode/
     yamlTabSwitch/editorUpdateGutter/buildYamlEditorHTML/initYamlEditorModal

   【本ファイル切り出し時の教訓（vja-mock-check.js分割時の反省を踏まえた対応）】
   移動対象が「buildYamlEditorHTML/initYamlEditorModal（汎用エディタUI構築、
   全イベントYAMLエディタ共通）」を挟んで非連続（3ブロックに分断）だったため、
   各ブロックの開始行直前・終了行直後を必ずRead+grepで目視確認してから
   切り出しを実行した（前回のvja-mock-check.js分割で発生した「行範囲の
   1行ずれによる構文エラー」の再発防止）。切り出し後は機械的な集合演算
   （a.js内の`_`始まり関数呼び出し ∩ b.js内の`_`始まり関数定義、双方向）で
   命名規約違反（`_`外し忘れによるcross-file呼び出し）が無いことも確認済み。
═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════
  AIによる画面デザイン自動生成
  「説明/入力項目/参照テーブル」を書いた依頼テキストをAIに渡し、
  ウィジェット構成JSON配列を生成→applyAiFormDesign()で現在フォームへ反映する。
═══════════════════════════════════════════ */
function insertFormDesignTemplate(id) {
    const ta = $("ta-fd");
    if (!ta) return;
    const template = getFormDesignTemplateYaml(id);
    if (template) {
        ta.value = template;
        hlUpdate("ta-fd", "hl-fd", yamlTokenize);
        editorUpdateGutter("ta-fd", "gutter-fd");

        // テンプレートの配置構造は、YAML本文（フォームレイアウト:）ではなく
        // "🖼 レイアウト"タブの選択状態（getProjectData().formLayoutPattern）に反映する。
        const layoutId = typeof getFormDesignTemplateLayoutPatternId === "function" ? getFormDesignTemplateLayoutPatternId(id) : "";
        getProjectData().formLayoutPattern = getFormLayoutPatternById(layoutId) ? layoutId : "";
        const layoutPane = $("pane-fd-layout");
        if (layoutPane) layoutPane.innerHTML = buildFormLayoutPickerHtml();

        showToast("テンプレートを反映しました");
    }
}

function openFormDesignTemplateModal() {
    const templates = typeof FORM_DESIGN_TEMPLATES !== "undefined" ? FORM_DESIGN_TEMPLATES : [];
    const itemsHtml = templates.map((t, idx) => {
        const descMatch = (t.yaml || "").match(/説明:\s*(.+)/);
        return render("ye-tpl-fd-item", {
            id: t.id,
            checked: idx === 0 ? "checked" : "",
            label: t.label,
            desc: descMatch ? descMatch[1].trim() : "",
        });
    }).join("");

    showModal(
        render("ye-tpl-fd-select-modal", {
            header: mhdrHTML("📋 画面デザインテンプレート選択", "modal-layer-1"),
            itemsHtml,
            attrCancel: evtAttr("onclick", 'closeModal("modal-layer-1")'),
            attrConfirm: evtAttr("onclick", "confirmApplyFormDesignTemplate()"),
        }),
        "",
        "modal-layer-1"
    );
}

async function confirmApplyFormDesignTemplate() {
    const checkedRadio = document.querySelector("input[name='fd-tmpl-radio']:checked");
    const id = checkedRadio ? checkedRadio.value : "search";
    closeModal("modal-layer-1");

    const ta = $("ta-fd");
    if (ta) {
        const curVal = ta.value?.trim() || "";
        // 元のYAML定義が存在する場合、確認ダイアログを出す
        if (curVal.length > 0) {
            const ok = await vja.app.showConfirm(
                "現在の依頼テキストが存在します。\n" +
                "選択したテンプレートで置き換えますか？\n" +
                "（編集中のテキストは上書きされます）"
            );
            if (!ok) return;
        }
        insertFormDesignTemplate(id);
    }
}

// 画面レイアウトイメージ選択タブの中身（箱型ダイアグラムのカード一覧）を生成する。
// 選択結果はYAMLテキストには一切書き込まず、getProjectData().formLayoutPattern
// （フォームごとにsyncCurForm()/commitFormDesignDraft()と同じ考え方で同期）にのみ保持し、
// formDesignAiGenerate()がAIへ渡す補足プロンプトに追加するためだけに使う。
function buildFormLayoutPickerHtml() {
    const cur = getProjectData().formLayoutPattern || "";
    // 「指定なし」カード（一番左）: idは空文字。選択するとAIへの補足指示は付与しない。
    const noneCard = render("ye-tpl-layout-card", {
        active: cur === "" ? "active" : "",
        id: "",
        borderColor: cur === "" ? "var(--accent)" : "var(--border)",
        attr: evtAttr("onmousedown", "selectFormLayoutPattern('')"),
        inner: `<div style="width:100%;height:143px;display:flex;align-items:center;justify-content:center;background:#22222e;border-radius:4px;color:var(--text3);font-size:14px">指定なし</div>`,
        label: "指定なし",
    });
    const cards = noneCard + getFormLayoutPatterns().map((p) => {
        const active = p.id === cur;
        return render("ye-tpl-layout-card", {
            active: active ? "active" : "",
            id: p.id,
            borderColor: active ? "var(--accent)" : "var(--border)",
            attr: evtAttr("onmousedown", "selectFormLayoutPattern('" + p.id + "')"),
            inner: buildLayoutPatternDiagramSvg(p),
            label: p.label,
        });
    }).join("");
    return render("ye-tpl-layout-picker", { cards });
}

// レイアウトイメージカードのクリック処理（トグル選択）。
// フルHTML再生成はせず、カードのハイライトのみ差し替える軽量処理にしている。
function selectFormLayoutPattern(id) {
    const cur = getProjectData().formLayoutPattern || "";
    getProjectData().formLayoutPattern = cur === id ? "" : id;
    document.querySelectorAll(".form-layout-card").forEach((el) => {
        const isActive = el.dataset.patternId === getProjectData().formLayoutPattern;
        el.classList.toggle("active", isActive);
        el.style.borderColor = isActive ? "var(--accent)" : "var(--border)";
    });
}

function openFormDesignAi() {
    // 複数選択中にAI設計ボタンを操作した場合は選択を解除する
    if (getDesignerState().selIds.length > 1) deselect();
    if (!getProjectData().aiConfig.enabled) {
        vja.app.showConfirm("AI接続設定が有効になっていません。設定画面を開きますか？").then((yes) => {
            if (yes) openAiConfig();
        });
        return;
    }
    const template = getProjectData().formDesignDraft || "";
    const docTemplate = getProjectData().formDesignDocDraft || "";

    const tabConfig = {
        tabs: [
            { id: "fd", label: "📋 YAML", type: "yaml", val: template, ph: _PROMPT_DEF.DEFAULT_FORM_DESIGN_YAML },
            { id: "fd-doc", label: "✨ YAMLドラフト", type: "doc", val: docTemplate, ph: "✨ 作成したい画面デザインの要望を日本語で自由に記述できます（複数行可）\n\n例:\n1. ユーザー情報登録フォーム\n2. 氏名、メールアドレス、部署（セレクトボックス）の入力項目\n3. 保存ボタンとクリアボタンを配置する" },
            { id: "fd-layout", label: "🖼 レイアウト", type: "layout" },
        ],
        aiBar: render("ye-tpl-formdesign-ai-bar", {
            attrYaml: evtAttr("onmousedown", "formDesignTextToYamlGenerate()"),
            attrGen: evtAttr("onmousedown", "formDesignAiGenerate()"),
        }),
        saveAction: "saveFormDesignDraft()",
        rightPanel: "formDesign",
    };
    showModal(buildYamlEditorHTML("", "", false, mhdrHTML("🤖 AIでフォーム設計"), "", tabConfig));
    requestAnimationFrame(() => {
        applyEditorConfig();
        hlUpdate("ta-fd", "hl-fd", yamlTokenize);
        editorUpdateGutter("ta-fd", "gutter-fd");
        editorUpdateGutter("ta-fd-doc", "gutter-fd-doc");

        const taYaml = $("ta-fd");
        if (taYaml) {
            taYaml.addEventListener("keydown", editorKeyHandler);
            taYaml.addEventListener("mousedown", editorMouseDownHandler2);
            taYaml.addEventListener("dblclick", editorDblClickHandler);
            taYaml.addEventListener("input", () => { hlUpdate("ta-fd", "hl-fd", yamlTokenize); editorUpdateGutter("ta-fd", "gutter-fd"); });
            taYaml.addEventListener("scroll", () => hlSync("ta-fd", "hl-fd"));
            editorUndoInit("ta-fd", FORMDESIGN_EDITOR.taUndo, taYaml.value);
        }

        const taDoc = $("ta-fd-doc");
        if (taDoc) {
            taDoc.addEventListener("keydown", editorKeyHandler);
            taDoc.addEventListener("mousedown", editorMouseDownHandler2);
            taDoc.addEventListener("dblclick", editorDblClickHandler);
            taDoc.addEventListener("input", () => editorUpdateGutter("ta-fd-doc", "gutter-fd-doc"));
            taDoc.addEventListener("scroll", () => editorSyncGutter("ta-fd-doc", "gutter-fd-doc"));
            if (!FORMDESIGN_EDITOR.docUndo) FORMDESIGN_EDITOR.docUndo = {};
            editorUndoInit("ta-fd-doc", FORMDESIGN_EDITOR.docUndo, taDoc.value);
        }

        rAfBind("#tab-fd", "click", () => yamlTabSwitch("fd"));
        rAfBind("#tab-fd-doc", "click", () => yamlTabSwitch("fd-doc"));
        rAfBind("#tab-fd-layout", "click", () => yamlTabSwitch("fd-layout"));
        yamlInitResize();
        yamlInitRpanelEvents();
        // 開いた直後から入力できるよう、最初にアクティブな📋YAMLタブへフォーカスする。
        // requestAnimationFrame直後だとWebViewがまだ描画/レイアウトを完了しておらず
        // focus()が効かないことがあるため、setTimeoutで1ティック遅らせて実行する
        setTimeout(() => taYaml?.focus(), 0);
    });
}

// 自然言語から画面デザインYAMLを生成する関数
// 画面デザインYAMLドラフト生成AIへも、イベントYAMLドラフト生成と同様の理由
// （一部ローカルLLM＋llama-server環境での応答パースエラー対策）で、出力キー名を
// 英語表記（description/layout/fields/tables/actions、layout配下のcolumns/
// label_position/button_position）で指示している。ここでVJA画面デザインYAML
// の正式仕様である日本語キー（説明/フォームレイアウト/カラム数/ラベル位置/
// ボタン位置/入力項目/参照テーブル/アクション項目）へ変換する。日本語キーは
// 「説明:」「参照テーブル:」の正規表現抽出（parseFormDesignYaml）が前提と
// しているため、変換せず英語キーのまま使うと他機能が壊れる。
const _FORM_DESIGN_EN_TO_JP_KEYS = [
    ["description", "説明"],
    ["layout", "フォームレイアウト"],
    ["columns", "カラム数"],
    ["label_position", "ラベル位置"],
    ["button_position", "ボタン位置"],
    ["fields", "入力項目"],
    ["tables", "参照テーブル"],
    ["actions", "アクション項目"],
];
const _FORM_DESIGN_EN_TO_JP_VALUES = [
    ["bottom_right", "右下"],
    ["top_right", "右"],
    ["bottom_center", "下部中央"],
    ["left", "左"],
    ["top", "上"],
];
function convertFormDesignEngKeysToJp(yamlText) {
    let result = yamlText;
    _FORM_DESIGN_EN_TO_JP_KEYS.forEach(([en, jp]) => {
        // 行頭の空白の後に「- 」（リスト形式のハイフン）が付く場合も、キー名として一致させる.
        result = result.replace(new RegExp("^([ \\t]*(?:- )?)" + en + "[ \\t]*:", "gm"), "$1" + jp + ":");
    });
    _FORM_DESIGN_EN_TO_JP_VALUES.forEach(([en, jp]) => {
        result = result.replace(new RegExp(":([ \\t]*)" + en + "([ \\t]*(?:#.*)?)$", "gm"), ":$1" + jp + "$2");
    });
    return result;
}

// 画面デザインYAMLドラフト生成（Text to YAML）のロジック本体（DOM非依存）。
// 自動テスト用（bridge.tsのtestFormDesignTextToYamlGenerateハンドラ）に、
// DOM読み書きと分離してあるほか、ウィザード版wizardGenerateFormYaml()
// （vja-wizard.js）ともロジックを共通化している（元々ほぼ同一の実装が
// 2箇所に重複していたため、2026-09-21にこちらへ統合した）。
// 戻り値: { yaml, layoutPatternId }（失敗時はnull）。
async function generateFormDesignYaml(inputText, allTables) {
    // プロジェクトのDBテーブル情報からコンテキスト生成
    // （イベントJS生成時と同様、依頼文中に名前・カラム名が出現するテーブルのみに
    //   絞り込む。意味の重複した無関係テーブルまで渡すのを避けるための予防措置。
    //   ※2026-08-10の実測では、fields空/不足の主因はテーブル数ではなく別要因
    //   （既存ウィジェットとの重複回避ルール、下記参照）と判明したが、
    //   無関係テーブルを渡さない方が安全なので絞り込み自体は残す）
    const targetTablesForCtx = narrowTablesByRequest(inputText, allTables || []);
    const tablesCtx = buildTablesCtxText(targetTablesForCtx);

    const sysPrompt = _PROMPT_DEF.FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT({ tablesCtx: tablesCtx });
    const userPrompt = _PROMPT_DEF.FORM_DESIGN_TEXT_TO_YAML_USER_PROMPT(inputText);

    let result = null;
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        loadingMsg: "画面YAMLドラフト作成中…",
        onSuccess: async (cleanYaml) => {
            const stripped0 = cleanYaml.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
            const stripped1 = convertFormDesignEngKeysToJp(stripped0);

            // "layout_pattern: <番号>" 行は、YAML本文には残さず抽出のみ行い、
            // "🖼 レイアウト"タブの選択状態（getProjectData().formLayoutPattern）に反映する。
            // ID文字列(camelCase)をそのまま選ばせるとローカルLLMが複数のIDを
            // 混ぜ合わせた実在しない文字列を生成することがあったため、番号(1始まり、
            // 該当なしは0)で選ばせ、ここでgetFormLayoutPatterns()の並び順に対応させる。
            // ここで初めて出現するキーであり、convertFormDesignEngKeysToJp()の対象キー
            // （description/layout/columns等）には含まれないため、別途正規表現で処理する。
            const layoutNumMatch = stripped1.match(/^\s*layout_pattern\s*:\s*"?(\d+)"?\s*$/m);
            const layoutNum = layoutNumMatch ? parseInt(layoutNumMatch[1], 10) : 0;
            const layoutPatternList = getFormLayoutPatterns();
            const matchedPattern = layoutNum >= 1 && layoutNum <= layoutPatternList.length ? layoutPatternList[layoutNum - 1] : null;
            let yaml = stripped1.replace(/^\s*layout_pattern\s*:.*\n?/m, "").trim();

            // 「参照テーブル:」欠落の機械的補完（詳細はderiveMissingFormDesignTables()のAIメモ参照）
            const derivedTables = deriveMissingFormDesignTables(yaml, allTables || []);
            if (derivedTables.length > 0) {
                yaml += "\n参照テーブル:\n" + derivedTables.map((n) => "  - " + n).join("\n");
            }

            result = { yaml, layoutPatternId: matchedPattern ? matchedPattern.id : "" };
        },
        onCancel: async () => { },
        onError: async () => { },
    });
    return result;
}

async function formDesignTextToYamlGenerate() {
    if (!getProjectData().aiConfig.enabled) {
        if (await vja.app.showConfirm("AI接続設定が有効になっていません。設定画面を開きますか？")) {
            closeModal();
            openAiConfig();
        }
        return;
    }

    const docEl = $("ta-fd-doc");
    const promptInEl = $("fd-prompt-in");
    const inputText = docEl?.value?.trim() || promptInEl?.value?.trim() || "";
    if (!inputText) {
        showToast("「✨ YAMLドラフト」タブまたはAI指示欄にやりたい画面の概要を入力してください");
        if (docEl) docEl.focus();
        else if (promptInEl) promptInEl.focus();
        return;
    }

    // AI実行前に現在のドラフト（YAML・依頼）を保存
    getProjectData().formDesignDraft = $("ta-fd")?.value || "";
    getProjectData().formDesignDocDraft = docEl?.value || "";

    const curYaml = $("ta-fd")?.value || "";
    if (curYaml.trim().length > 0) {
        const ok = await vja.app.showConfirm(
            "画面デザインYAMLエディタに既存の記述があります。\n" +
            "AIが作成するYAMLで上書きしますか？"
        );
        if (!ok) return;
    }

    showLoadingModal("画面YAMLドラフト作成中…");

    const genResult = await generateFormDesignYaml(inputText, getProjectData().tables || []);
    if (!genResult) return;
    const { yaml: stripped } = genResult;

    getProjectData().formLayoutPattern = genResult.layoutPatternId || "";
    getProjectData().formDesignDraft = stripped;
    getProjectData().formDesignDocDraft = inputText;

    openFormDesignAi();

    requestAnimationFrame(() => requestAnimationFrame(() => {
        const taFd = $("ta-fd");
        if (taFd) {
            taFd.value = stripped;
            hlUpdate("ta-fd", "hl-fd", yamlTokenize);
            editorUpdateGutter("ta-fd", "gutter-fd");
        }
        const taDoc = $("ta-fd-doc");
        if (taDoc) {
            taDoc.value = inputText;
            editorUpdateGutter("ta-fd-doc", "gutter-fd-doc");
        }
        yamlTabSwitch("fd");
        showToast("✨ 画面デザインYAMLを作成しました（📋 YAMLタブを確認）");
    }));
}

// 依頼テキストの下書きを保存して閉じる（既存の拡張ランタイム設定と同じ「保存」の考え方）
function saveFormDesignDraft() {
    if ($("ta-fd")) getProjectData().formDesignDraft = $("ta-fd").value;
    if ($("ta-fd-doc")) getProjectData().formDesignDocDraft = $("ta-fd-doc").value;
    closeModal();
}

// 「説明:」「入力項目:」「参照テーブル:」の3セクションを正規表現で抽出する
// （このプロジェクトはYAMLを厳密パースせず、既存の「利用テーブル:」抽出と同じ
//  軽量な正規表現方式に統一している）
function parseFormDesignYaml(text) {
    const descM = text.match(/説明\s*:\s*(.*)$/m);
    let desc = descM ? descM[1].trim().replace(/^["']|["']$/g, "") : "";
    const tblM = text.match(/参照テーブル\s*:\s*\n([\s\S]*?)(?:\n\S|\n\n|$)/);
    const tables = [];
    if (tblM) {
        tblM[1].split("\n").forEach((l) => {
            const name = l.replace(/^\s*-\s*/, "").replace(/#.*$/, "").trim();
            if (name) tables.push(name);
        });
    }
    return { desc, tables };
}

// 「入力項目:」の各フィールド名がテーブルの列名(name/labelJa)と一致する場合、
// 「参照テーブル:」が完全に欠落していても機械的に補完する。
// Why: ENG_FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPTには「fieldsがテーブル由来なら
// tablesに含めるのは必須」という明記とFew-Shot例が既にあるが、依頼文がボタン動作の
// 説明中心（例:「〜を入力する。『戻る』ボタンで一覧に戻り、『保存』ボタンで保存する」）
// だと、temperature=0（サンプリングの揺らぎを排除した状態）でも100%再現する形で
// 「参照テーブル:」セクション自体が丸ごと欠落する不具合が2026-09-20の実LLM検証
// (qwen2.5-coder-7b)で確認された。プロンプト文言の強化だけに頼ると際限ない
// もぐら叩きになるため（CLAUDE.md「プロンプト文言だけでは再発する」参照）、
// _fixArithmeticInFormDesignJson()と同じ方針でコード側の機械的な安全網を追加する。
// 戻り値: 補完すべきテーブル名の配列（既に「参照テーブル:」が1件でもあれば空配列＝何もしない）。
// 他ファイル（vja-wizard.js）からも呼び出すため、CLAUDE.mdの規約に従い`_`無しの名前で
// グローバル展開する（`_`始まりはファイル内限定の意味のため）。
function deriveMissingFormDesignTables(yamlText, allTables) {
    const { tables: existingTables } = parseFormDesignYaml(yamlText);
    if (existingTables.length > 0) return [];
    const fieldsM = yamlText.match(/入力項目\s*:\s*\n([\s\S]*?)(?:\n\S|\n\n|$)/);
    if (!fieldsM) return [];
    const fieldLabels = [];
    fieldsM[1].split("\n").forEach((l) => {
        const m = l.match(/^\s*-\s*([^:]+):/);
        if (m) fieldLabels.push(m[1].trim());
    });
    if (fieldLabels.length === 0) return [];
    // 単純な「1列でも一致したら候補」だと、sales_data/sales_historyのように
    // 列名が重なる複数テーブルが同時にヒットしてしまう（実際に2026-09-20の
    // 検証で確認）。fields全件を包含し、かつ余分な列が最も少ない（＝形が
    // 最も近い）テーブルを優先することで、この誤爆を減らす。
    const scored = (allTables || []).map((t) => {
        const cols = t.columns || [];
        const matchedCount = fieldLabels.filter((label) => cols.some((c) => c.name === label || c.labelJa === label)).length;
        return { name: t.name, matchedCount, extraCount: cols.length - matchedCount };
    }).filter((s) => s.matchedCount === fieldLabels.length); // fields全件をカバーするテーブルのみ候補にする
    if (scored.length === 0) return [];
    const minExtra = Math.min(...scored.map((s) => s.extraCount));
    return scored.filter((s) => s.extraCount === minExtra).map((s) => s.name);
}

// AI（フォームデザイン）出力のx/y/w/hに、計算式（例: "x": 768 - 20 - 85）が
// そのまま出力されてしまうケースを機械的に是正する。ENG_FORM_DESIGN_SYS_PROMPT側で
// 「計算結果の整数のみ出力せよ、式を書くな」と複数箇所で明記しているにもかかわらず、
// ローカルLLMが右寄せボタン等のx計算で式をそのままJSONに書いてしまう事例が
// 2026-09-08に一度確認・修正済み（Few-Shot強化）だったが、2026-09-13に別の
// ローカルLLM（deepseek-coder-v2）で同種の再発が確認された。プロンプト文言の
// 強化だけに頼ると際限なく「もぐら叩き」になるため、ここでコード側の機械的な
// 安全網を追加する: x/y/w/hの値部分が単純な数値でない場合、数字・空白・
// 四則演算子・丸カッコのみで構成されているか検証した上で（英字や記号が
// 混ざる文字列値等を誤って評価しないための安全策）計算し、結果の整数に
// 置き換えてからJSON.parseする。
function _fixArithmeticInFormDesignJson(text) {
    return String(text || "").replace(/("(?:x|y|w|h)"\s*:\s*)([^,}\]]+)/g, (whole, prefix, valuePart) => {
        const trimmed = valuePart.trim();
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) return whole; // 既にプレーンな数値ならそのまま
        if (!/^[\d\s+\-*/().]+$/.test(trimmed)) return whole; // 数式以外の文字が混ざる値（文字列等）はそのまま
        try {
            const computed = Function("\"use strict\"; return (" + trimmed + ")")();
            if (typeof computed === "number" && Number.isFinite(computed)) {
                return prefix + Math.round(computed);
            }
        } catch (e) { /* 評価失敗時は元の文字列のまま返し、後続のJSON.parseで通常通り失敗させる */ }
        return whole;
    });
}

// AI（フォームデザイン）出力テキストを配列としてパースする。
// 1. まずそのままJSON.parseを試みる
// 2. 失敗した場合、AIが前後に説明文を付けてしまうケースを救うため、
//    最初の "[" ～ 最後の "]" を抜き出して再度パースを試みる
// どちらの試行でも、_fixArithmeticInFormDesignJson()で計算式を先に整数へ
// 是正してからパースする。成功時はウィジェット配列を、失敗時
// （配列でない場合含む）はnullを返す。
function parseFormDesignJson(text) {
    const tryParse = (s) => {
        try {
            const v = JSON.parse(_fixArithmeticInFormDesignJson(s));
            return Array.isArray(v) ? v : null;
        } catch (e) {
            return null;
        }
    };
    const direct = tryParse(text);
    if (direct) return direct;
    const s = text.indexOf("[");
    const e = text.lastIndexOf("]");
    if (s !== -1 && e !== -1 && e > s) {
        const extracted = tryParse(text.slice(s, e + 1));
        if (extracted) return extracted;
    }
    return null;
}

// AI出力の解析に失敗した際、生データを確認できるモーダルを表示する。
// テキストエリアに生データを表示し、コピーして原因調査できるようにする。
function openAiRawOutputModal(rawText) {
    showModal(
        mhdrHTML("⚠ AI出力の解析に失敗しました") +
        render("ye-tpl-ai-raw-output", { rawText }) +
        mfootHTML([{ label: "閉じる", action: "closeModal()" }])
    );
}

// 画面レイアウト生成（YAML→ウィジェット配置JSON）のAI呼び出し部分のみを
// 切り出した共有ロジック（DOM非依存）。formDesignAiGenerate()（UI手動操作版）
// とwizardGenerateFormLayout()（ウィザード版、vja-wizard.js）で共通利用する
// （元々ほぼ同一の実装が2箇所に重複していたため、2026-09-21にこちらへ統合した）。
// 戻り値: AI生成結果の生テキスト（失敗/キャンセル時はnull）。パース
// （parseFormDesignJson）は呼び出し側の責務とする（呼び出し元ごとに
// パース失敗時の扱い＝UI表示の有無が異なるため）。
async function generateFormLayoutRaw(designText, extraPrompt, allTables) {
    const { tables } = parseFormDesignYaml(designText);
    const targetTables = (allTables || []).filter((t) => tables.includes(t.name));
    const tablesCtx = buildTablesCtxText(targetTables);
    const sysPrompt = _PROMPT_DEF.FORM_DESIGN_SYS_PROMPT({
        formW: getProjectData().formCfg.w,
        formH: getProjectData().formCfg.h,
        tablesCtx,
    });
    const userPrompt = _PROMPT_DEF.FORM_DESIGN_USER_PROMPT(designText, extraPrompt);

    let result = null;
    await runAiGenerate({
        systemPrompt: sysPrompt,
        userPrompt: userPrompt,
        loadingMsg: "画面デザインを生成中…",
        onSuccess: async (generated) => { result = generated; },
        onCancel: async () => { },
        onError: async () => { },
    });
    return result;
}

// formDesignAiGenerate()（画面デザインAI生成、既存ウィジェットの全削除＋反映）の
// ロジック本体（DOM非依存）。自動テスト用（bridge.tsのtestFormDesignAiGenerateハンドラ）に、
// DOM読み書き（確認ダイアログ・テキストエリア読取・ボタン活性制御・モーダル閉じる）と
// 分離してある。既存ウィジェットの全削除＋pushUndo()＋fullRedraw()という破壊的操作を
// 含むため、呼び出し前に対象フォームの状態が意図通りか十分注意すること。
// 戻り値: { ok: true, widgets } | { ok: false, reason: "parse_failed", raw } | { ok: false, reason: "cancelled_or_error" }
async function generateFormDesignAiLayout(rawText, addPromptExtra) {
    const { desc } = parseFormDesignYaml(rawText);
    const curForm = getProjectData().forms[getProjectData().curFormIdx];

    // 「説明:」が空の場合のみ、その行をフォームの説明で置き換える。
    // それ以外の内容は選別・再構築せず、書かれたテキストをそのままAIへ渡す。
    let designText = rawText;
    if (!desc) {
        const fallbackDesc = curForm?.cfg?.description || "";
        if (fallbackDesc) {
            designText = /説明\s*:.*$/m.test(rawText)
                ? rawText.replace(/説明\s*:.*$/m, "説明: " + fallbackDesc)
                : "説明: " + fallbackDesc + "\n" + rawText;
        }
    }

    // 選択中のレイアウトイメージがあれば、YAMLテキストには含めず、
    // AIへの補足指示としてのみ追加する（"🖼 レイアウト"タブでの選択）。
    // 2026-09-14: 従来は「配置構造を言葉で説明した1文」を渡すだけで、実際の
    // 反映精度がAIの解釈に左右され「設定しても微妙」という指摘があったため、
    // buildLayoutRegionsPromptText()でpx座標の厳格な配置エリアへ変換して渡すよう変更した。
    const layoutHint = buildLayoutRegionsPromptText(
        getProjectData().formLayoutPattern,
        getProjectData().formCfg.w,
        getProjectData().formCfg.h
    );
    const extraPrompt = (addPromptExtra || "") + layoutHint;

    // AI生成前に依頼テキストを下書き保存
    getProjectData().formDesignDraft = rawText;

    const generated = await generateFormLayoutRaw(designText, extraPrompt, getProjectData().tables || []);
    if (generated === null) return { ok: false, reason: "cancelled_or_error" };

    const items = parseFormDesignJson(generated);
    if (!items) {
        window.vja?.log?.warn?.("[FormDesignAi] JSON parse failed. raw=" + generated.slice(0, 300));
        return { ok: false, reason: "parse_failed", raw: generated };
    }

    // 既存ウィジェットを全削除してからAI結果を配置する
    // （削除前の状態をpushUndo()で退避＝Ctrl+Zで復元可能）
    if (getProjectData().widgets.length > 0) {
        pushUndo();
        getProjectData().widgets = [];
        getProjectData().forms[getProjectData().curFormIdx].widgets = getProjectData().widgets;
        getDesignerState().selIds = [];
        const po = $("prop-obj");
        if (po) po.textContent = getProjectData().formCfg.title;
        fullRedraw();
    }
    applyAiFormDesign(items);
    return { ok: true, widgets: getProjectData().widgets };
}

async function formDesignAiGenerate() {
    if (getProjectData().widgets.length > 0) {
        const ok = await vja.app.showConfirm(
            "AI生成を実行すると、現在のフォームの\n" +
            "全ウィジェットが削除されます。\n" +
            "設定済みのイベント処理（コード）も\n" +
            "全て失われます。\n" +
            "（Ctrl+Zで元に戻すことは可能です）\n\n" +
            "続行しますか？"
        );
        if (!ok) return;
    }
    const ta = $("ta-fd");
    const rawText = ta?.value || "";
    const addPrompt = $("fd-prompt-in")?.value || "";
    const btn = $("fd-gen-btn");
    if (btn) btn.disabled = true;

    const result = await generateFormDesignAiLayout(rawText, addPrompt);

    if (result.ok) {
        closeModal();
    } else if (result.reason === "parse_failed") {
        showToast("AI出力の解析に失敗しました（JSON形式ではありません）", 5000);
        openAiRawOutputModal(result.raw);
    }
    if (btn) btn.disabled = false;
}

Object.assign(window, {
    insertFormDesignTemplate, openFormDesignTemplateModal, confirmApplyFormDesignTemplate,
    buildFormLayoutPickerHtml, selectFormLayoutPattern, openFormDesignAi,
    convertFormDesignEngKeysToJp, generateFormDesignYaml, formDesignTextToYamlGenerate,
    saveFormDesignDraft, parseFormDesignYaml, deriveMissingFormDesignTables, parseFormDesignJson,
    openAiRawOutputModal, generateFormLayoutRaw, generateFormDesignAiLayout, formDesignAiGenerate,
});
