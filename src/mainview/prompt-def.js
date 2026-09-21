// AIプロンプト定義.
//  AIに条件を渡して「プログラムなど」を生成するための定義.
// index.htmlから切り離す事で「手動で修正対応」が行える.
//
(function () {
    "use strict";

    // YAMLをMarkdown風フェンス(~~~yaml ... ~~~)でプロンプトに埋め込む際、
    // 埋め込む内容自体に「~~~」という並びが含まれていると、そこでフェンスが
    // 終わったとAIに誤認され、以降の内容が別の指示として解釈される恐れがある
    // （開発者自身が書くYAMLが対象なので発生頻度は低いが、起こり得る）。
    // Markdownのコードフェンスのエスケープ手法にならい、埋め込む内容に含まれる
    // 最長の連続~より1文字長いフェンスを動的に使うことで回避する。
    const _safeYamlFence = function (content) {
        const matches = String(content || "").match(/~{3,}/g) || [];
        const maxLen = matches.reduce((m, s) => Math.max(m, s.length), 3);
        return "~".repeat(maxLen + 1);
    };

    // 2026-09-21: プロンプト本文（英語の長文テキスト）を prompt-def.js から
    // src/mainview/prompts/*.md へ切り出した。目的は「AIプロンプト定義」という
    // 巨大な文字列リテラルとロジック（条件分岐・コンテキスト組み立て）を分離し、
    // 人間・AIどちらにとってもプロンプト本文の見通しを良くすること。
    // vja-templates-loader.js（HTMLテンプレート）と全く同じ設計方針で、
    // 呼び出し元が同期呼び出し前提のため fetch ではなく同期XHRで読み込む。
    // electrobun.config.ts の build.copy に src/mainview/prompts を登録済み
    // （templates/ と同じ理由。webviewは views://mainview/prompts/... 経由で配信）。
    const _promptTplCache = {};
    function _loadPromptTpl(name) {
        if (_promptTplCache[name] !== undefined) return _promptTplCache[name];
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "prompts/" + name, false);
        xhr.send(null);
        const text = (xhr.status === 0 || xhr.status === 200) ? (xhr.responseText || "") : "";
        if (!text) console.error("[prompt-def] プロンプトテンプレート読み込み失敗:", name, xhr.status);
        _promptTplCache[name] = text;
        return text;
    }
    // {{変数名}} プレースホルダーを置換する。条件分岐・計算等のロジックは
    // 持たせない（呼び出し元のJSで計算・整形してから渡すこと）。
    function _fillTpl(tpl, vars) {
        return tpl.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
    }

    // ### [AIP説明で利用]
    // [フロントエンド]利用可能なjavascript関数の説明.
    // 「vja ランタイムの追加・変更・削除がある場合は、反映が必要」
    // AI以外に、js利用者向けのvjaランタイム説明等に利用を想定.
    const VJA_USE_FRONT_JS_INFO =
        _loadPromptTpl("vja-front-api-full.ja.md").trim() + "\n\n\n\n\n\n\n\n\n\n\n";


    // ### [systemPromptで利用]
    // [英語版][フロントエンド]利用可能なjavascript関数の説明.
    // ※使わなそうなものは削除.
    // 「vja ランタイムの追加・変更・削除がある場合は、反映が必要」
    // ※必須条件: 英語版は使用例、使用例説明は不要.
    // ### [systemPromptで利用]
    // [フロントエンド] 必須API（常時システムプロンプトに含む: widget/trigger/ui.loading/app/console）
    // vja.event.*は任意カテゴリ（event）に分離。ただしKeyDown/KeyUp/RowClick/HeaderClickの
    // 4イベントでは、UI・検証ロジック側でOFFにできない「常時有効」扱いにする
    // （vja-yaml-editor.js の _EVENT_LOCKED_ON_EVENTS を参照）。
    const VJA_FRONT_API_MANDATORY_ENG = _loadPromptTpl("vja-front-api-mandatory.eng.md").trim();

    // ### [systemPromptで利用]
    // [フロントエンド] 特殊API（vja.db: YAMLの「利用テーブル:」に記載がある場合のみユーザプロンプト側に付与）
    const VJA_FRONT_API_DB_ENG = _loadPromptTpl("vja-front-api-db.eng.md").trim();

    // ### [systemPromptで利用]
    // [フロントエンド] 任意API（イベントエディタのチェックボックスでON時のみユーザプロンプト側に付与）
    // キー名は、チェックボックスUI・検証ロジック（無効化カテゴリのAPI使用検出）と共通で使用する識別子.
    const VJA_FRONT_API_OPTIONAL_ENG = {
        event: _loadPromptTpl("vja-front-api-optional.event.eng.md").trim(),
        form: _loadPromptTpl("vja-front-api-optional.form.eng.md").trim(),
        session: _loadPromptTpl("vja-front-api-optional.session.eng.md").trim(),
        const: _loadPromptTpl("vja-front-api-optional.const.eng.md").trim(),
        util: _loadPromptTpl("vja-front-api-optional.util.eng.md").trim(),
        file: _loadPromptTpl("vja-front-api-optional.file.eng.md").trim(),
        io: _loadPromptTpl("vja-front-api-optional.io.eng.md").trim(),
        dir: _loadPromptTpl("vja-front-api-optional.dir.eng.md").trim(),
        http: _loadPromptTpl("vja-front-api-optional.http.eng.md").trim(),
    };

    // 任意カテゴリの表示名（チェックボックスUI用）
    const VJA_FRONT_API_OPTIONAL_LABELS = {
        event: "イベント情報 (vja.event.*)",
        form: "画面遷移 (vja.form.*)",
        session: "セッション (vja.session.*)",
        const: "定数 (vja.const.*)",
        util: "ユーティリティ (vja.util.*)",
        file: "ファイル操作 (vja.file.*)",
        io: "ファイルI/O ダイアログ (vja.io.*)",
        dir: "ディレクトリ操作 (vja.dir.*)",
        http: "外部API (vja.http.*)",
    };

    // 互換用: 上記3つを結合した全量（ドキュメント自動生成・ホワイトリスト系の用途では未使用。
    // AIP説明用の日本語詳細版VJA_USE_FRONT_JS_INFOとは別物）
    // vja.notify.toastはVJA_FRONT_API_MANDATORY_ENGに含まれるためここでの個別追記は不要。
    const VJA_USE_FRONT_JS_INFO_ENG = (
        VJA_FRONT_API_DB_ENG + "\n\n" +
        VJA_FRONT_API_MANDATORY_ENG + "\n\n" +
        Object.values(VJA_FRONT_API_OPTIONAL_ENG).join("\n\n")
    ).trim();

    // ### [AIP説明で利用]
    // [バックエンド]利用可能なjavascript関数の説明.
    // AI以外に、js利用者向けのvjaランタイム説明等に利用を想定.
    // 「vja ランタイムの追加・変更・削除がある場合は、反映が必要」
    const VJA_USE_BACK_JS_INFO =
        _loadPromptTpl("vja-back-api-full.ja.md").trim() + "\n\n\n\n\n\n\n\n\n\n\n";

    // ### [systemPromptで利用]
    // [英語版][バックエンド]利用可能なjavascript関数の説明.
    // ※必須条件: 英語版は使用例、使用例説明は不要.
    // 「vja ランタイムの追加・変更・削除がある場合は、反映が必要」
    const VJA_USE_BACK_JS_INFO_ENG = _loadPromptTpl("vja-back-api-full.eng.md").trim();

    // 英語promptの最後に日本語で表記としてつける文字
    const ENG_TO_LAST_PHRASE_JP = "\nRespond in Japanese.\n";

    // 英語promptの最後に英語で表記としてつける文字
    const ENG_TO_LAST_PHRASE_ENG = "\nRespond in English.\n";

    // プログラムタイプを取得.
    const _program_type = function (isAppEvent) {
        return isAppEvent
            ? "TypeScript"
            : "JavaScript";
    }

    // プログラム出力ルールを出力.
    const _program_rule = function (eng, isAppEvent) {
        const programType = _program_type(isAppEvent);
        const langLower = programType.toLowerCase();

        if (eng === true) {
            // 英語.
            return [
                `- The AI's output must strictly consist solely of the raw, executable code for ${programType}.`,
                `- Explanatory text, introductory remarks, and concluding statements are all strictly prohibited.`,
                `- NEVER wrap the output in markdown code blocks (e.g., do not use \`\`\` or \`\`\`${langLower}). Your response MUST start directly with the very first character of the actual code.`,
                `- Before rendering the final code, perform a comprehensive internal check for potential bugs, edge cases, strict type compliance, and appropriate exception handling, then output flawless, production-ready code on the first attempt.`
            ].join('\n');
        }

        // 日本語.
        return [
            `- AIの出力結果は「${programType} の生コードのみ」を厳守してください。`,
            `- 説明文、解説、前置き、結びの言葉はすべて出力禁止です。`,
            `- コードブロック（\`\`\`${langLower} や \`\`\`）などのマークダウン装飾は完全に排除してください。応答は、コードの最初の1文字目から直接開始する必要があります。`,
            `- コードを出力する直前に、頭の中で「潜在的なバグ」「エッジケース」「型定義の整合性」「例外処理」を網羅的に検証し、バグのない完成された実用コードを一発で出力してください。`
        ].join('\n');
    };

    // [英語]YAMLからjsに変換する場合のシステムプロンプトを生成.
    // - isAppEvent: [必須]定義されている場合はアプリイベント(bunネイティブ実行)で、存在しない場合はイベント系(js)で実行.
    // - formName: [任意]form名を設定します.
    // - eventName: [任意]イベント名を設定します.
    // - wname: [任意]ウィジット名を設定します.
    // - wtag: [任意]ウィジットタグ名を設定します.
    // - wdescription: [任意]ウィジット詳細を設定します.
    // - inputParamsCtx: [任意]フォーム内の入力パラメータ情報を設定します.
    // - allWidgetsCtx: [任意]フォーム内の全ウィジェット情報を設定します.
    // - formsCtx: [任意]画面(Form)一覧を設定します.
    // - globalConstCtx: [任意]グローバル定数を設定します.
    // - formConstCtx: [任意]対処ウィジットを設置してるフォーム定数を設定します.
    // - tablesCtx: [任意]テーブル定義内容を設定します.
    // - extRuntimeDoc: [任意]拡張ランタイムのyaml定義を設定します.
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // isAppEvent=true(バックエンド/アプリイベント)とfalse(フロントエンド/イベントJS)で
    // ルール文言が分岐する。それぞれのルール内容（英語部分）の要約は以下の通り:
    // ## Structure: インラインで書く／if・try等のブロック内で変数宣言しない／
    //   バックエンドはconst禁止(letのみ)、フロントエンドはconst/let禁止(varのみ)／
    //   フロントエンドはヘルパー関数(handleXxx等)の定義自体を禁止
    // ## vja API: vja.*APIがあれば必ず使う→なければ拡張ランタイム→最後に標準JS、の優先順位。
    //   crypto.subtle等の独自実装禁止。vja.*呼び出しはawait必須(例外あり)。
    //   画面遷移はvja.form.navigate()のみ、window.location禁止。
    //   (フロントエンドのみ)window.confirm/alert禁止、ウィジェット値は.valueで包まれない
    // ## SQL: プレースホルダ(?)必須、LIKE検索は'%'をJS側で結合、値の直接埋め込み禁止
    //   （識別子＝カラム名/テーブル名なら埋め込み可、値は必ず?経由）
    // ## YAML Definition Structure: 「イベント」「説明」は参考情報で実装根拠にしない、
    //   「アクション」だけが実装の根拠。「〇〇の場合/それ以外」→if/else、
    //   「〇〇に対して繰り返し」→for/forEachに変換
    // ## Fidelity to YAML: YAMLに書かれていない処理(navigate/show/hide等)を勝手に追加禁止、
    //   イベント名から典型的な実装を推測して追加することも禁止。
    //   (バックエンドのみ)エラーログはconsole.error(e.message, e)の形式で第2引数にErrorを渡す
    // ## Other: コメントは日本語で書く
    const ENG_YAML_TO_JS_SYS_PROMPT = function (
        isAppEvent,
        {
            formName,
            eventName,
            wname,
            wtag,
            wdescription,
            inputParamsCtx,
            allWidgetsCtx,
            formsCtx,
            globalConstCtx,
            formConstCtx,
            tablesCtx,
            extRuntimeDoc,
        },
    ) {
        const vjaUseJsInfo = isAppEvent
            ? VJA_USE_BACK_JS_INFO_ENG
            : VJA_FRONT_API_MANDATORY_ENG;

        const codeType = isAppEvent ? "TypeScript" : "JavaScript";

        const rule = (isAppEvent
            ? _loadPromptTpl("yaml-to-js.rule.back.eng.md")
            : _loadPromptTpl("yaml-to-js.rule.front.eng.md")
        ).trim();

        return _fillTpl(_loadPromptTpl("yaml-to-js.sys.eng.md"), {
            codeType,
            programRule: _program_rule(true, isAppEvent),
            rule,
            fence: _safeYamlFence(vjaUseJsInfo),
            vjaUseJsInfo,
        }).trim() + "\n";
    };

    // yamlのコメントを削除(AIによっては、コメントが逆に影響を及ぼす事になるため)
    const _removeYamlShComments = function (sourceCode) {
        // 行頭コメント行のみ削除する方針:
        // - インラインコメントは残す（URLの#等の誤削除を防ぐ）
        // - ブロックスカラー（|, >）内の#を誤って消さない
        // - 空行の連続を圧縮してトークン削減
        return sourceCode
            .split("\n")
            .filter((line) => !/^\s*#/.test(line)) // 行頭コメント行のみ削除
            .join("\n")
            .replace(/\n{3,}/g, "\n\n") // 空行の連続を最大2行に圧縮
            .trim();
    };

    // [英語]YAMLからjsに変換する場合のユーザプロンプトを生成.
    // - isAppEvent: [必須]定義されている場合はアプリイベント(bunネイティブ実行)で、存在しない場合はイベント系(js)で実行.
    // - yamlDef: [必須]プログラム変換対象のyaml情報が設定されます.
    // - addPrompt: [必須]ユーザ設定で追加プロンプトが存在する場合、設定します.
    // - formName: [任意]form名を設定します.
    // - eventName: [任意]イベント名を設定します.
    // - wname: [任意]ウィジット名を設定します.
    // - wtag: [任意]ウィジットタグ名を設定します.
    // - wdescription: [任意]ウィジット詳細を設定します.
    // - inputParamsCtx: [任意]フォーム内の入力パラメータ情報を設定します.
    // - allWidgetsCtx: [任意]フォーム内の全ウィジェット情報を設定します.
    // - formsCtx: [任意]画面(Form)一覧を設定します.
    // - globalConstCtx: [任意]グローバル定数を設定します.
    // - formConstCtx: [任意]対処ウィジットを設置してるフォーム定数を設定します.
    // - tablesCtx: [任意]テーブル定義内容を設定します.
    // - extRuntimeDoc: [任意]拡張ランタイムのyaml定義を設定します.
    // 戻り値: ユーザプロンプトが返却されます.
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // 「YAMLに従って実装せよ」という指示文＋各種コンテキスト（ウィジェット一覧・
    // フォーム定数・入力パラメータ・画面一覧・グローバル定数・テーブル定義・
    // 拡張ランタイム・任意API・学習履歴）を英語の見出しで列挙するだけの構成。
    // 特殊なのはeventTypeHint（下記）で、RowClick/HeaderClick/KeyDown/KeyUp等の
    // イベントでは「vja.event.get().type に入る正しい値」をAIが誤って別名を
    // 創作しないよう、その場で具体的に念押しする一文を追加している。
    const ENG_YAML_TO_JS_USER_PROMPT = function (
        isAppEvent,
        yamlDef,
        addPrompt,
        {
            formName,
            eventName,
            wname,
            wtag,
            wdescription,
            inputParamsCtx,
            allWidgetsCtx,
            formsCtx,
            globalConstCtx,
            formConstCtx,
            tablesCtx,
            extRuntimeDoc,
            optionalApiDocCtx,
            learnedFixesCtx,
        },
    ) {
        const programType = isAppEvent ? "TypeScript" : "JavaScript";
        const widgetLineEn = wname ? `- Current widget: ${wname}\n` : "";

        // このコード生成が対象とする具体的なイベント名に基づき、
        // vja.event.get().type に入り得る「唯一の正しい値」をその場で計算し、
        // プロンプトに動的に埋め込む。ドキュメント上の一般ルールだけでは、
        // AIが「近い別のイベント名」を創作してしまう事例が実際にあったため
        // （例: KeyUpイベント用のコードなのに ev.type === 'keyDown' と誤記する）、
        // 抽象的なルールに加えて「今回はこの値だけが正しい」と具体的に
        //念押しする形にしている。
        const eventTypeHintEn = (() => {
            if (isAppEvent || !eventName) return "";
            if (eventName === "RowClick") {
                return "\n- IMPORTANT: This code is for the \"RowClick\" event. If you call vja.event.get(), ev.type will ALWAYS be exactly 'rowClick'. Never use any other value.\n";
            }
            if (eventName === "HeaderClick") {
                return "\n- IMPORTANT: This code is for the \"HeaderClick\" event. If you call vja.event.get(), ev.type will ALWAYS be exactly 'headerClick'. Never use any other value.\n";
            }
            if (eventName === "Click" && wtag === "datagrid") {
                return "\n- IMPORTANT: This code is for the \"Click\" event on a datagrid. If you call vja.event.get(), ev.type will be either 'rowClick' or 'headerClick' — no other value is possible.\n";
            }
            if (eventName === "KeyDown" || eventName === "KeyUp") {
                const correct = eventName.charAt(0).toLowerCase() + eventName.slice(1);
                const wrongSibling = eventName === "KeyDown" ? "keyUp" : "keyDown";
                return `\n- IMPORTANT: This code is specifically for the "${eventName}" event (NOT ${eventName === "KeyDown" ? "KeyUp" : "KeyDown"}). If you call vja.event.get(), ev.type will ALWAYS be exactly '${correct}' — NEVER '${wrongSibling}' or any other value. Do not confuse this with the other Key event. To check which key was pressed, use vja.event.getKey()/isEnter()/isEscape() etc. instead of comparing ev.type.\n`;
            }
            return "";
        })();

        // Context information for Frontend/Widget events
        const frontInfo = isAppEvent
            ? ""
            : _fillTpl(_loadPromptTpl("yaml-to-js.front-info.eng.md"), {
                formName, widgetLineEn, eventName, eventTypeHintEn,
                allWidgetsCtx, formConstCtx, inputParamsCtx, formsCtx, globalConstCtx, tablesCtx,
                optionalApiSection: optionalApiDocCtx ? "\n### Additional Available APIs (enabled for this event)\n---\n" + optionalApiDocCtx + "\n---\n" : "",
                learnedFixesSection: learnedFixesCtx ? "\n### Project-Specific Notes\n---\n" + learnedFixesCtx + "\n---\n" : "",
                extFence: _safeYamlFence(extRuntimeDoc), extRuntimeDoc,
            }).trim();

        let instructions = "";
        if (isAppEvent) {
            instructions = `Please generate execution code for the app event as ${programType} using Bun.js.\nAPIs such as vja.db.query() / vja.session.get() are available.`;
        } else {
            instructions = `${frontInfo}\n\nGenerate ${programType} code for inline implementation of event handling.`;
        }

        // If YAML specification is provided
        if (yamlDef && yamlDef.trim()) {
            instructions += `\n\nFollow the specifications provided in [The Following YAML] to implement the logic.

[The Following YAML]
---
${_safeYamlFence(yamlDef)}yaml
${_removeYamlShComments(yamlDef)}
${_safeYamlFence(yamlDef)}
---`;
        }

        // If additional user prompts exist
        if (addPrompt && addPrompt.trim()) {
            instructions += `\n\n[Additional Instructions]\n${addPrompt.trim()}\n*Strictly apply these instructions along with the system rules.`;
        }

        // Final formatting enforcement directly before LLM starts generation
        const finalEnforcement = `
[CRITICAL REQUIREMENT]
- Output MUST consist entirely of the raw ${programType} code.
- Absolutely NO introductory text, NO explanations, and NO concluding remarks.
- Do NOT wrap the code in markdown blocks (e.g., do not use \`\`\` or \`\`\`${programType.toLowerCase()}). Start your response directly with the very first character of the actual code.`;

        return `${instructions.trim()}\n${finalEnforcement.trim()}\n\n${ENG_TO_LAST_PHRASE_JP}`;
    };


    // 拡張ランタイム用システムプロンプト.
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // JavaScriptコードを解析してAPIドキュメントをYAMLで生成させるプロンプト。
    // キー名（function/description/arguments/returns/exception/example/
    // example_description）は英語固定、値（説明文）は日本語で書かせる。
    // 出力は生YAMLのみ、コードブロックや前置き・説明文は禁止。
    const ENG_EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT = function () {
        return _loadPromptTpl("ext-runtime-js-to-yaml.sys.eng.md").trim() + "\n";
    };

    // [英語]拡張ランタイム用ユーザプロンプト.
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // 「以下のJavaScriptコードを解析してシステム指示のYAML形式でドキュメント化せよ」
    // という指示＋対象コード本文＋「生YAMLのみ出力、コードブロック禁止」の念押し。
    const ENG_EXT_RUNTIME_JS_TO_YAML_USER_PROMPT = function (js) {
        return _fillTpl(_loadPromptTpl("ext-runtime-js-to-yaml.user.eng.md"), { jsCode: js.trim() });
    };

    // プログラム生成におけるYAMLが存在しない場合にセット
    const DEFAULT_YAML_VALUE = function (eventName, wname) {
        return (
            _fillTpl(_loadPromptTpl("default-event-yaml.ja.md"), { eventName, wname }).trim() + "\n\n\n\n\n"
        );
    };

    // [英語:プロンプト]画面デザイン自動生成（YAML風の依頼文からウィジェット構成JSONを生成）
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // ユーザーが日本語で書いた「画面デザインYAML」（説明/フォームレイアウト/参照テーブル/
    // 入力項目/アクション項目）を読み取り、重ならない座標(x,y,w,h)付きのウィジェット
    // 配置JSON配列を出力させるプロンプト（＝「🤖 画面反映」ボタンで使用）。
    // 1. フォームレイアウト最優先: カラム数/ラベル位置/ボタン位置/密度の指示に従う。
    //    ボタンが複数ある場合は右端起点で逆算しgap10pxで並べる計算式を明記（重なり防止）。
    // 2. 画面パターン別の配置方針: 検索一覧画面（上部に検索条件＋下部にdatagrid）、
    //    登録・詳細画面（1〜2列＋右下/中央にボタン）。
    // 3. 座標・サイズの基準: フォーム幅高さ内に収める、各ウィジェットの標準高さ、
    //    ウィジェット間は最低6pxの隙間を空け重なり禁止。
    // [出力フォーマット]生JSON配列のみ、コードブロック・説明文禁止。
    // [JSONスキーマ]tag/name/text/inputType/placeholder/group/options/columns/x/y/w/h。
    // ボタンのcaptionは「〇〇ボタン」の「ボタン」を除去して短くする。
    // 参照テーブルにないカラム名を勝手に作らない。ボタン数は依頼のアクション項目数と一致させる。
    // 以降はFew-Shot例（検索一覧画面1個、複数ボタン1個）。
    const ENG_FORM_DESIGN_SYS_PROMPT = function ({ formW, formH, tablesCtx }) {
        return _fillTpl(_loadPromptTpl("form-design.sys.eng.md"), {
            formW, formH,
            col2X: Math.floor(formW / 2) + 10,
            bottomBtnY: formH - 45,
            dataGridW: formW - 40,
            dataGridH: Math.max(180, formH - 90),
            btn1x: formW - 20 - 85,
            btn2x: formW - 20 - 85 - 10 - 85,
            btn3x: formW - 20 - 85 - 10 - 85 - 10 - 85,
            tablesCtx: tablesCtx || "(No reference table specified)",
        }).trim() + "\n";
    };

    // [英語:プロンプト]画面デザイン自動生成 ユーザープロンプト.
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // 「以下のYAML画面デザイン依頼に基づき配置JSON配列を生成せよ」という指示＋
    // 依頼YAML本文＋（あれば）追加指示＋「生JSON配列のみ出力」の念押し。
    const ENG_FORM_DESIGN_USER_PROMPT = function (designText, addPrompt) {
        const addPromptSection = addPrompt
            ? "\n[Additional Instructions]\n" + addPrompt.trim() + "\n*In addition to the request above and the system rules, satisfy these instructions when calculating coordinates.\n"
            : "";
        return _fillTpl(_loadPromptTpl("form-design.user.eng.md"), { designText: designText.trim(), addPromptSection });
    };

    // フォームデザインにおけるYAMLが存在しない場合にセット
    const DEFAULT_FORM_DESIGN_YAML = _loadPromptTpl("default-form-design.ja.yaml").trim() + "\n\n";

    //////////////////
    // グローバル展開.
    //////////////////
    const o = {};
    window._PROMPT_DEF = o;

    // [日本語]利用可能関数一覧: js利用者向けのvjaランタイム説明等.
    o.VJA_USE_BACK_JS_INFO = VJA_USE_BACK_JS_INFO; // バックエンド.
    o.VJA_USE_FRONT_JS_INFO = VJA_USE_FRONT_JS_INFO; // フロントエンド.

    // [フロントエンド] API定義（カテゴリ分割版・必須/DB専用/任意）.
    // 「任意API有効化（イベントエディタのチェックボックス）」機能で使用.
    o.VJA_FRONT_API_MANDATORY_ENG = VJA_FRONT_API_MANDATORY_ENG;
    o.VJA_FRONT_API_DB_ENG = VJA_FRONT_API_DB_ENG;
    o.VJA_FRONT_API_OPTIONAL_ENG = VJA_FRONT_API_OPTIONAL_ENG;
    o.VJA_FRONT_API_OPTIONAL_LABELS = VJA_FRONT_API_OPTIONAL_LABELS;

    // [プロンプト]yamlから js AI生成依頼.
    // (日本語版は使用実績がなく陳腐化していたため削除済み。英語版のみ使用)
    o.YAML_TO_JS_SYS_PROMPT = ENG_YAML_TO_JS_SYS_PROMPT;
    o.YAML_TO_JS_USER_PROMPT = ENG_YAML_TO_JS_USER_PROMPT;

    // [プロンプト]画面デザイン自動生成（ウィジェット配置JSON生成）.
    o.FORM_DESIGN_SYS_PROMPT = ENG_FORM_DESIGN_SYS_PROMPT;
    o.FORM_DESIGN_USER_PROMPT = ENG_FORM_DESIGN_USER_PROMPT;

    // [プロンプト]拡張ランタイムyamlから js AI生成依頼.
    // (日本語版は使用実績がなく陳腐化していたため削除済み。英語版のみ使用)
    o.EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT = ENG_EXT_RUNTIME_JS_TO_YAML_SYS_PROMPT;
    o.EXT_RUNTIME_JS_TO_YAML_USER_PROMPT =
        ENG_EXT_RUNTIME_JS_TO_YAML_USER_PROMPT;

    // イベント用yamlエディタ初期値.
    o.DEFAULT_YAML_VALUE = DEFAULT_YAML_VALUE;

    // フォームデザイン用yamlエディタ初期値.
    o.DEFAULT_FORM_DESIGN_YAML = DEFAULT_FORM_DESIGN_YAML;

    // [プロンプト]自然言語要求からVJAイベントYAMLを生成
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // 「イベント処理でやりたいこと」の日本語一言依頼文を、イベントYAML定義
    // （description/tables(該当時のみ)/validation/actions(手順の自然文列挙)/
    // on_success/on_error）に変換させるプロンプト（＝イベントYAMLエディタの
    // 「✨ YAMLドラフト」タブ）。actionsは「手順をそのまま列挙する」だけで、
    // 画面デザイン側のfields/actionsのような分類判断が不要な単純な構造。
    // 出力は生YAMLのみ、コードブロック・説明文禁止。
    const ENG_TEXT_TO_YAML_SYS_PROMPT = function ({ widgetsCtx, tablesCtx }) {
        return _fillTpl(_loadPromptTpl("text-to-yaml.sys.eng.md"), {
            widgetsCtx: widgetsCtx || "(No widgets)",
            tablesCtx: tablesCtx || "(No DB tables)",
        }).trim() + "\n";
    };

    // [日本語対訳メモ]（AIには送られない）「以下の依頼文からイベントYAMLを生成せよ」＋依頼文＋出力形式の念押し。
    const ENG_TEXT_TO_YAML_USER_PROMPT = function (userReq) {
        return _fillTpl(_loadPromptTpl("text-to-yaml.user.eng.md"), { userReq: userReq.trim() });
    };

    o.TEXT_TO_YAML_SYS_PROMPT = ENG_TEXT_TO_YAML_SYS_PROMPT;
    o.TEXT_TO_YAML_USER_PROMPT = ENG_TEXT_TO_YAML_USER_PROMPT;

    // [プロンプト]自然言語要求からフォームデザインYAMLを生成
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // 「画面デザインYAMLドラフト生成」（✨ YAMLドラフト生成ボタン）用プロンプト。
    // 依頼文をdescription/layout/fields/tables/actionsのYAMLに変換させる。
    // ※このプロンプトは「fields/actionsのどちらに何を入れるか」という分類判断を
    // AIに要求する点が、イベントYAML側（単純な手順列挙）と大きく異なり、
    // OpenAI(gpt-5.6-luna)で fields:[]/actions:[] のように該当項目が丸ごと
    // 空で返ってくる不具合の主因となった箇所（2026-08-10調査）。
    // 当初は個別の失敗例に対する例外ルールを都度追記していたが、ルールが密に
    // 絡み合い矛盾含みになったことで逆にAIの判断を混乱させていたと判断し、
    // 2026-08-10に以下のようシンプルな構成へ整理し直した:
    // [Strict Output Rules]基本ルール2点（生YAMLのみ/発明禁止）
    // [Core Principle]大原則「不要だと決めつけるな。空にする前に依頼文を読み返せ。
    //   迷ったらfields/actionsのどちらかに含める側に倒せ、削除ではなく」
    // [What Goes In "fields"]画面上で見る/選ぶ/編集する対象は全部fields。
    //   絞り込み条件が文中の一部として書かれているだけでも対象。項目名が
    //   明示されなくても参照テーブルのカラムから推測してよい。
    // [What Goes In "actions"]ボタンの短い名前だけ。挙動説明文が付いていても
    //   ボタン名部分は残し、挙動の記述だけを削る（丸ごと削除しない）。
    // 以降、上記に対応するFew-Shot例（ボタン+挙動説明文のケース）。
    //
    // 実測検証（2026-08-10、実際にOpenAI gpt-5.6-lunaへ複数回リクエストして確認）:
    // 当初は「参照テーブルが複数あると混同して空になる」と推測したが、テーブル数を
    // 絞ってもfieldsの空・不足は改善しなかった。一方で「[Existing Widgets On This
    // Form]に既存ウィジェットを渡すと、AIは『既にfields相当のウィジェットが置かれて
    // いるので重複させない』というルールに従って正しくfieldsを省略していた」ことが
    // 判明した（何度もテストを繰り返し、既にウィジェットが配置済みの画面に対して
    // 再度ドラフト生成をかけていたための現象）。「YAMLドラフト生成」はウィジェット
    // 配置前の仕様書作成ステップであり、重複回避は後工程の「🤖 画面反映」側の
    // 責務にすべきと判断し、既存ウィジェットのコンテキスト自体をこのプロンプトから
    // 削除した（widgetsCtx削除、以前のwidgetsCtx=空文字での実測は0/18で完全に安定）。
    const ENG_FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT = function ({ tablesCtx }) {
        // 画面レイアウトイメージ（入力/表示/ボタンエリアの配置構造）の選択肢一覧。
        // ここでAIに選ばせた結果はYAML本文には出力させず、専用の
        // "layout_pattern:" 1行だけに出させる。呼び出し元
        // (formDesignTextToYamlGenerate)がその行を抽出・除去した上で、
        // getProjectData().formLayoutPattern（"🖼 レイアウト"タブの選択状態）
        // に反映し、YAML本文（description/fields/tables/actions）には
        // 一切混在させない。
        // ID文字列（camelCase）をそのままAIに選ばせると、ローカルLLMが複数のIDを
        // 混ぜ合わせた実在しない文字列を生成することがあるため、番号選択方式にする
        // （数字は単語のように混ぜ合わせようがなく、ローカルLLMでも取り違えにくい）。
        const layoutPatternList = typeof getFormLayoutPatterns === "function" ? getFormLayoutPatterns() : [];
        const layoutPatternOptions = layoutPatternList
            .map((p, i) => `  ${i + 1}. ${p.desc}`)
            .join("\n");
        return _fillTpl(_loadPromptTpl("form-design-text-to-yaml.sys.eng.md"), {
            layoutPatternOptions,
            tablesCtx: tablesCtx || "(No DB tables)",
        }).trim() + "\n";
    };

    // [日本語対訳メモ]（AIには送られない）「以下の依頼文から画面デザインYAMLを生成せよ」＋依頼文＋出力形式の念押し。
    const ENG_FORM_DESIGN_TEXT_TO_YAML_USER_PROMPT = function (userReq) {
        return _fillTpl(_loadPromptTpl("form-design-text-to-yaml.user.eng.md"), { userReq: userReq.trim() });
    };

    o.FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT = ENG_FORM_DESIGN_TEXT_TO_YAML_SYS_PROMPT;
    o.FORM_DESIGN_TEXT_TO_YAML_USER_PROMPT = ENG_FORM_DESIGN_TEXT_TO_YAML_USER_PROMPT;

    // 2026-09-13（続報3）: 以前ここには「Q&A履歴から次の1問を動的に生成するプロンプト」
    // (ENG_WIZARD_NEXT_QUESTION_SYS_PROMPT/USER_PROMPT) があったが、実機で「4段階完了後は
    // 新規話題を発明するな」「業務ロジック・処理手順は聞くな」という禁止文言があるにも
    // かかわらず、AIが業務ロジックの質問（例:「締め処理にはどのような手順が含まれて
    // いますか？」）を発明してしまう事例が確認された。また、動的Q&Aの流れに乗らない
    // データ種別（例: 「商品マスター」）が抜け落ちる問題も起きた。「質問をAIに作らせる」
    // こと自体をやめ、ウィザードステップ2を「アプリ概要（自由記述、AIは使わない）」に
    // 置き換えた（vja-wizard.jsのwizardStartOverviewStep()参照）。このプロンプトは
    // 丸ごと廃止した。

    // 2026-09-13: システムモデル骨格の選択を、AIによる番号自動選択から
    // ウィザード内の専用ステップでのユーザー直接選択（vja-wizard.jsの
    // _wizardRenderSystemModelModal()）に変更したため、ここにあった
    // ENG_WIZARD_SYSTEM_MODEL_SYS_PROMPT/USER_PROMPT（Q&A履歴から番号を
    // 選ばせるプロンプト）は削除した。理由: 温度0の弱いローカルLLMに
    // 「向いていないケース」を踏まえた除外判断をさせるには荷が重く、実際に
    // 「1件ごとの伝票としての完結性が重要」という明確な除外条件に合致する
    // ケースで、キーワード表面一致に引きずられて誤った骨格（在庫・数量推移
    // 管理系）を選んでしまう事例が確認された。ユーザー自身は自分の作りたい
    // アプリの性質を把握しているため、AIに推測させるより直接選ばせる方が
    // 確実（詳細は CLAUDE.md「ウィザードの既知バグ修正」節を参照）。

    // 2026-09-13（続報3）: 以前ここには「Q&A履歴からDBテーブル候補をAIに提案させる
    // プロンプト」(ENG_WIZARD_TABLE_CANDIDATES_SYS_PROMPT/USER_PROMPT) があったが、
    // 動的Q&A自体を廃止した（アプリ概要ステップに置き換えた）のに伴い不要になった。
    // テーブル・カラムの作成は、vjaに既にある「テーブル管理」モーダル（カラムの
    // 「✨ AI生成」ボタンも既存のまま使える）をウィザードから直接開いてユーザー自身に
    // 作ってもらう方式に変更した（vja-wizard.jsのwizardShowTablesStep()参照）。
    // このプロンプトは丸ごと廃止した。

    // [プロンプト]プロジェクト新規作成ウィザード: 確定済みDBテーブル(カラム込み)から
    // 「1テーブル=一覧画面+入力画面」の画面スロットをコード側（_wizardBuildScreenSkeleton、
    // vja-wizard.js）で機械的に確定し、AIにはそのスロットの内容（formTitle/description/
    // docDraft）を日本語で埋めさせるだけの狭いタスクに限定する。
    //
    // 2026-09-13設計変更（重要・場当たり的な継ぎ足しの経緯があるため詳しく残す）:
    // 従来（〜2026-09-13）は「画面がいくつ必要か」「どのテーブルを使うか」という構造判断
    // 自体をAI1回の呼び出しに丸投げしていた（Floor/Avoid Over-Splittingという長大な
    // ルール文＋systemModelHintの全文差し込みで誘導する方式）。この設計は、vja本来の
    // 「狭い範囲でローカルLLMを使う」方針（CLAUDE.md「LLM利用方針」参照）から外れており、
    // ローカルLLMのモデル差で挙動が大きく揺れる根本原因になっていた。実例: project2
    // （daily_sales/itemsの2テーブル確定）で、ユーザーが手動選択した「在庫・数量推移管理系」
    // ヒントの画面骨格例（品目一覧/入出庫登録）をAIがそのまま採用し、確定テーブルを
    // 一切参照しない無関係な2画面で打ち切られた。
    // 対応: 「テーブルごとに一覧画面+入力画面を1組作る」という構造決定はAIの裁量から
    // 完全に外し、コード側で機械的に確定する（_wizardBuildScreenSkeleton）。AIの仕事は
    // 各スロットのformTitle/description/docDraftを日本語で埋めることだけに縮小した。
    // これにより：
    //   - システムモデル選択（ステップ3）はもう画面「数」を左右しない。ユーザーが選択制で
    //     確定した骨格は、画面の言い回し・用語（例:「入出庫」という言葉遣い）の参考程度に
    //     留め、テーブル選択・画面数を上書きする権限は持たせない。
    //   - Q&Aで暗示されるログイン等「テーブルに紐づかない」画面のみ、AIが確定スロットの
    //     後に追加してよい（勝手な機能追加ではなく、Q&Aに明記された場合のみ）。
    // 生成後、_wizardBuildScreenSkeleton()が確定した全スロットのformNameが結果に
    // 含まれているかをコード側（wizardDecomposeForms）で機械的に検証し、欠けていれば
    // 失敗として再生成を促す。
    //
    // docDraftは、関連テーブルのカラムが分かっている場合、カラム名を日本語ラベルに
    // 変換した上で具体的に書き込むよう指示する（曖昧な「詳細情報を表示」ではなく
    // 「タイトル・優先度・期限・ステータスを表示」のように）。これは実際にAI
    // (OpenAI gpt-5.6-luna)での実測検証で、項目名が明示されない依頼文だと画面デザイン
    // YAMLドラフト生成でfieldsが空になりやすいことが確認されたための対策（この検証結果
    // 自体は現行方式でも変わらず有効なため維持）。
    const ENG_WIZARD_DECOMPOSE_FORMS_SYS_PROMPT = function ({ tablesCtx, screenSkeletonText, systemModelHint }) {
        const systemModelHintSection = systemModelHint
            ? "\n[Terminology Reference — wording only, does NOT change slot count/table assignment above]\nThis application was judged closest to the following structural pattern. Use ONLY its wording/terminology conventions (e.g. how it phrases a status field) when writing docDraft for the fixed slots above. It must NOT be used to add, remove, merge, or rename any screen slot, and its example table/column names must NOT appear in your output — only the actual [Confirmed Database Tables] below may be used. Do NOT mention any field, value, or attribute from this skeleton's example (e.g. a \"current stock quantity\") in a slot's docDraft unless that exact column actually exists in [Confirmed Database Tables] for that slot's table.\n\n" + systemModelHint + "\n"
            : "";
        return _fillTpl(_loadPromptTpl("wizard-decompose-forms.sys.eng.md"), {
            screenSkeletonText,
            systemModelHintSection,
            tablesCtx: tablesCtx || "(No DB tables)",
        }).trim() + "\n";
    };

    // [日本語対訳メモ]（AIには送られない）アプリ概要（自由記述）＋「システム指示通りにフォーム一覧のJSON配列を生成せよ」の指示。
    // 2026-09-13（続報3）: 動的Q&A履歴の代わりに、ウィザードのアプリ概要ステップ
    // （自由記述、AI不使用）で記入されたテキストをそのまま渡す。
    const ENG_WIZARD_DECOMPOSE_FORMS_USER_PROMPT = function (overviewText) {
        return _fillTpl(_loadPromptTpl("wizard-decompose-forms.user.eng.md"), { overviewText: overviewText || "(未入力)" });
    };

    o.WIZARD_DECOMPOSE_FORMS_SYS_PROMPT = ENG_WIZARD_DECOMPOSE_FORMS_SYS_PROMPT;
    o.WIZARD_DECOMPOSE_FORMS_USER_PROMPT = ENG_WIZARD_DECOMPOSE_FORMS_USER_PROMPT;

    // [プロンプト]テーブル管理: 「説明（任意）」欄の自由記述から、SQLiteテーブル名（英語snake_case）を1つ提案する
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // テーブル編集モーダルの「✨ テーブル名生成」ボタン用（2026-09-13追加）。カラム構成生成
    // （ENG_TABLE_SCHEMA_GEN_SYS_PROMPT）とは別の、テーブル名1つだけを出力させる狭いタスク。
    // 出力は英語snake_case（例: daily_sales）1個のみ、説明文以外の情報は使わない。
    const ENG_TABLE_NAME_GEN_SYS_PROMPT = function () {
        return _loadPromptTpl("table-name-gen.sys.eng.md").trim() + "\n";
    };

    // [日本語対訳メモ]（AIには送られない）「説明（任意）」欄の内容＋「テーブル名を1つだけ出力せよ」の指示。
    const ENG_TABLE_NAME_GEN_USER_PROMPT = function (description) {
        return _fillTpl(_loadPromptTpl("table-name-gen.user.eng.md"), { description: description || "(not specified)" });
    };

    o.TABLE_NAME_GEN_SYS_PROMPT = ENG_TABLE_NAME_GEN_SYS_PROMPT;
    o.TABLE_NAME_GEN_USER_PROMPT = ENG_TABLE_NAME_GEN_USER_PROMPT;

    // [プロンプト]テーブル管理: 自然言語の依頼文からSQLiteテーブルのカラム構成（雛形）を生成
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // テーブル編集モーダルの「✨ AI生成」用。日本語の依頼文＋テーブル名/説明から
    // カラム定義JSON配列（name/labelJa/type(TEXT|INTEGER|REAL|BLOB|NULL)/notNull/pk/index/default）
    // を生成させる。labelJaはnameの日本語名（表示用、DDLには影響しない）。
    // PK列（通常id, INTEGER, pk=true, notNull=true）を先頭に入れる、
    // テーブル名・説明・依頼内容から妥当なカラムを推測、関係ないカラムを発明しない。
    const ENG_TABLE_SCHEMA_GEN_SYS_PROMPT = function ({ tableName, description }) {
        return _fillTpl(_loadPromptTpl("table-schema-gen.sys.eng.md"), {
            tableName: tableName || "(not specified)",
            description: description || "(not specified)",
        }).trim() + "\n";
    };

    // [日本語対訳メモ]（AIには送られない）依頼文（未入力なら「テーブル名/説明のみから推測せよ」）＋「生JSON配列のみ出力」の念押し。
    const ENG_TABLE_SCHEMA_GEN_USER_PROMPT = function (userReq) {
        return _fillTpl(_loadPromptTpl("table-schema-gen.user.eng.md"), {
            userReq: userReq ? userReq.trim() : "(not specified — infer from the table name/description only)",
        });
    };

    o.TABLE_SCHEMA_GEN_SYS_PROMPT = ENG_TABLE_SCHEMA_GEN_SYS_PROMPT;
    o.TABLE_SCHEMA_GEN_USER_PROMPT = ENG_TABLE_SCHEMA_GEN_USER_PROMPT;

    // [プロンプト]バリデーション管理: 自然言語の依頼文からバリデーションルール一覧（雛形）を生成
    //
    // [日本語対訳メモ]（AIには送られない。内容確認用の要約）
    // バリデーション編集モーダルの「✨ AI生成」用。日本語の依頼文＋定義名/説明＋
    // フォーム内の入力系ウィジェット名一覧から、ルール定義JSON配列
    // （name(対象ウィジェット名、一覧にある名前のみ・発明禁止)/type(required等の種別)/
    // not/arg1-3(typeにより意味が変わる引数)/message(日本語エラー文)）を生成させる。
    // 一覧に無いウィジェット名は使わない・該当ウィジェットが無ければ空配列。
    // 依頼・定義と無関係なルールを発明しない。
    const ENG_VALIDATION_SCHEMA_GEN_SYS_PROMPT = function ({ name, description, widgetsCtx }) {
        return _fillTpl(_loadPromptTpl("validation-schema-gen.sys.eng.md"), {
            name: name || "(not specified)",
            description: description || "(not specified)",
            widgetsCtx: widgetsCtx || "(none)",
        }).trim() + "\n";
    };

    // [日本語対訳メモ]（AIには送られない）依頼文（未入力なら「定義名/説明のみから推測せよ」）＋「生JSON配列のみ出力」の念押し。
    const ENG_VALIDATION_SCHEMA_GEN_USER_PROMPT = function (userReq) {
        return _fillTpl(_loadPromptTpl("validation-schema-gen.user.eng.md"), {
            userReq: userReq ? userReq.trim() : "(not specified — infer from the definition name/description only)",
        });
    };

    o.VALIDATION_SCHEMA_GEN_SYS_PROMPT = ENG_VALIDATION_SCHEMA_GEN_SYS_PROMPT;
    o.VALIDATION_SCHEMA_GEN_USER_PROMPT = ENG_VALIDATION_SCHEMA_GEN_USER_PROMPT;
})();
