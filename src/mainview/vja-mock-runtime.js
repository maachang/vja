/* ═══════════════════════════════════════════════════════════════
   vja-mock-runtime.js
   ─────────────────────────────────────────────────────────────
   【役割】
   AI生成コード（yamlAiGenerate()の生成結果）を実際に1回実行してみる
   「モック実行スモークテスト」用の、vja.* 全関数のダミー実装。
   実際のDB・ファイル・UIには一切触れない、完全に独立したモック。

   【目的（重要・スコープの限定）】
   - 目的は「構文チェック・APIホワイトリスト検証では拾えない、
     実行時例外（TypeError等）で即座に落ちないか」を確認することだけ。
   - 分岐（if/else）の全パターンを網羅することはできない
     （1回の実行では、モックが返す1パターンの値による分岐しか通らない）。
   - 「ロジックが正しいか」を検証するものではない。あくまで「明らかに
     壊れていないか」の浅いスモークテスト。

   【モック値の設計原則（誤検知＝偽陽性を減らすため）】
   - 配列を返すAPIは、空配列 [] ではなく [{}]（ダミー1件）を返す。
     　理由: `rows[0]` のようなアクセスで undefined にならないようにするため。
   - オブジェクトを返すAPIは、null ではなく {} を返す。
   - vja.event.get() のように戻り値の形がイベント種別で変わる「多相API」は、
     呼び出し元から渡された evName/wtag を見て、そのイベントで実際に
     起こりうる形の代表値を返す（当てずっぽうの固定値にしない）。
     ※vja.event.get()は仕様変更により全イベントで必ずオブジェクトを返す
     （nullは返さない）。rowClick/headerClick以外は
     {type: イベント名の先頭を小文字にしたもの} を返す
     （_vjaRun()側の実装＝src/bun/index.tsと合わせること）。
   - vja.widget.get()/getValue() は、指定されたウィジェット名の実際のタグ
     （現在のプロジェクトに配置済みのもの）を見て型を出し分ける
     （datagrid→配列、checkbox/radio→真偽値、progressbar/slider等→数値、
     inputtype(number)→数値、それ以外→文字列）。一律で文字列を返すと、
     datagridの `rows[idx][col]` のようなアクセスで偽陽性クラッシュが
     発生するため。
   - console.* はモック化しない（実際のconsoleをそのまま使う。副作用が
     ログ出力のみで、実行を阻害しないため）。

   【依存関係】
   - このファイルはどこからも呼ばれない限り何もしない（副作用なし）。
   - window.VJA_MOCK_RUNTIME.build(isAppEvent, evName, wtag, overrides, widgets)
     という形自体は、メインスレッド上で直接呼ぶ用途のために残している。
   - 【重要・要同期】実際のモック実行スモークテスト（vja-yaml-editor.js の
     _runMockSmokeTest()）は、無限ループ対策のためWeb Worker内で実行される。
     electrobunのカスタムスキームがWorker内からのimportScripts（ネットワーク
     読み込み）に対応しておらず「NetworkError: Load failed」になるため、
     WorkerではこのファイルをimportScriptsせず、_buildFrontMock()/
     _buildBackMock()と同じ内容を vja-yaml-editor.js 側の
     _MOCK_WORKER_RUNTIME_SRC 文字列に複製して埋め込んでいる。
     このファイルを変更した場合は、必ず _MOCK_WORKER_RUNTIME_SRC も
     同じ内容に追従させること（自動抽出できないため手動同期が必要）。

   【メンテナンス上の注意】
   - vja.* のAPI追加・変更・削除があった場合、prompt-def.js の
     VJA_USE_FRONT_JS_INFO / VJA_USE_BACK_JS_INFO（ホワイトリストの
     情報源）と合わせて、このファイルのモックも手動で追従させること
     （ホワイトリストと違い、このファイルは自動抽出できない。
     戻り値のダミー値は人間が意味を判断して決める必要があるため）。
═══════════════════════════════════════════════════════════════ */
(function () {
    "use strict";

    // フロントエンド（ウィジェット/フォームイベント）用モック。
    // evName: 生成対象のイベント名（例: "Click", "RowClick", "KeyDown"）
    // wtag  : 生成対象ウィジェットのタグ（例: "datagrid"）。フォーム/アプリ
    //         イベントの場合は undefined。
    // overrides: ユーザーが「⚙ モック値を編集」で明示的に指定した上書き値。
    //   { widgets: {名前: 値}, event: 値|undefined, consts: {名前: 値},
    //     session: {キー: 値}, util: {関数名: 値} }
    //   未指定の項目は、従来通りのデフォルトのダミー値にフォールバックする。
    function _buildFrontMock(evName, wtag, overrides, widgets) {
        const ov = overrides || {};
        // vja.event.get() 等のコンテキスト判定。
        // ・RowClick / HeaderClick イベントなら、そのままの形を返す。
        // ・datagridの「Click」イベントは rowClick/headerClick どちらもあり得るため、
        //   より情報量の多い rowClick 形状を代表値として使う。
        // ・それ以外のウィジェットの「Click」や、その他のイベントでは常に null
        //   （ドキュメント通り「その他はnull」）。
        const isRowClickCtx = evName === "RowClick" || (evName === "Click" && wtag === "datagrid");
        const isHeaderClickCtx = evName === "HeaderClick";
        const isKeyCtx = evName === "KeyDown" || evName === "KeyUp";

        // vja.widget.get('名前') の戻り値は、指定された名前のウィジェットの
        // 実際のタグ（現在のプロジェクトに配置済みのもの）によって型が変わる。
        // ドキュメント上は string|number|boolean|null だが、実運用上は
        // datagrid(配列)・checkbox/radio(真偽値)・数値系(数値)も現に存在するため、
        // 「一律で文字列を返す」だけでは datagrid の rows[idx][col] アクセス等が
        // 偽陽性でクラッシュしてしまう。実際のウィジェット一覧と突き合わせて
        // 型ごとに妥当なダミー値を返す。
        // ユーザーが明示的にウィジェット単位の上書き値を指定していれば、それを最優先する。
        // widgets: 呼び出し元(_runMockSmokeTest)がgetProjectData().widgetsを渡す
        // （Worker内にはgetProjectData()が存在しないため、直接データとして受け取る）。
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
            // ウィジェット名が特定できない場合（変数名で渡された、未配置等）は
            // 従来通り安全側の文字列を返す。
            return "";
        }
        // vja.const.get('名前') も同様にユーザー上書きを最優先する。
        function _constGetValue(name) {
            if (ov.consts && Object.prototype.hasOwnProperty.call(ov.consts, name)) {
                return ov.consts[name];
            }
            return "";
        }
        // vja.session.get('キー') も同様。
        function _sessionGetValue(key) {
            if (ov.session && Object.prototype.hasOwnProperty.call(ov.session, key)) {
                return ov.session[key];
            }
            return "";
        }
        // vja.util.* はユーザーが関数名をキーにして上書きできる。
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
                getValue: (name) => _widgetGetValue(name), // 旧エイリアス（ランタイムには残存）
                setValue: () => {},
                setItems: () => {},
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
                    // ユーザーが「⚙ モック値を編集」で明示的に指定した場合は最優先する。
                    if (ov.event !== undefined) return ov.event;
                    if (isRowClickCtx) return { type: "rowClick", row: 0, column: "" };
                    if (isHeaderClickCtx) return { type: "headerClick", column: "" };
                    // 新仕様: 全イベントで必ずオブジェクトを返す（nullにはならない）。
                    // evNameが不明（フォーム/アプリイベント等）な場合のみ空文字typeにフォールバック。
                    const t = evName ? evName.charAt(0).toLowerCase() + evName.slice(1) : "";
                    return { type: t };
                },
                getKey: () => (isKeyCtx ? "Enter" : null),
                getKeyCode: () => (isKeyCtx ? 13 : null),
                // KeyDown/KeyUpイベント時は、どのキー判定APIが使われても
                // 「押された」側の分岐（本来のロジック）が実行されるよう、
                // 全て true 相当を返す（実際の押下状態の整合性は問わない。
                // スモークテストの目的は「その分岐の中身が動くか」の確認のため）。
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
            },
            crypto: {
                encrypt: async () => "",
                decrypt: async () => "",
            },
            getCloudInfraCredential: async () => ({}),
            validate: {
                run: async () => true,
            },
            db: {
                query: async () => [{}],
                execute: async () => ({ changes: 0, lastInsertRowid: 0 }),
                transaction: async () => true,
            },
            log: {
                info: () => {},
                warn: () => {},
                error: () => {},
            },
        };
    }

    // バックエンド（アプリイベント: onStart/onExit等）用モック。
    // バックエンドは vja.event.* / vja.widget.* / vja.form.* 等が
    // 存在しない（ホワイトリストにも含まれない）ため、ここには含めない。
    // また vja.db.* / vja.session.* / vja.log.* はバックエンドでは
    // NEVER await（同期呼び出し）というルールのため、同期関数として実装する。
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

    const _global = (typeof window !== "undefined") ? window : self;
    _global.VJA_MOCK_RUNTIME = {
        // isAppEvent: true=バックエンド(アプリイベント) / false=フロントエンド
        // evName: 生成対象のイベント名（フロント/フォームイベント時のみ意味を持つ）
        // wtag: 生成対象ウィジェットのタグ（ウィジェットイベント時のみ意味を持つ）
        // overrides: ユーザーが「⚙ モック値を編集」で指定した上書き値（フロントのみ有効）
        // widgets: getProjectData().widgets相当の配列（フロントのvja.widget.get()判定用）
        build(isAppEvent, evName, wtag, overrides, widgets) {
            return isAppEvent ? _buildBackMock() : _buildFrontMock(evName, wtag, overrides, widgets);
        },
    };
})();
