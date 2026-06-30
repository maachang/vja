/* ═══════════════════════════════════════════════════════════════
   vja-editor-utils.js — エディタ共通ユーティリティ（行番号・タブ・Undo/Redo）
   ─────────────────────────────────────────────────────────────
   【読み込み順序】5番目（vja-yaml-editor.js の直後）。
   【依存】vja-defs.js, vja-yaml-editor.js
   【提供するもの】
     - editorUpdateGutter() / editorSyncGutter()（行番号表示）
     - yamlTabSwitch()（YAML/JSタブ切替）
     - editorUndoPush() / editorUndo() / editorRedo()（エディタ内Undo/Redo）
     - editorSearch()（Ctrl+F検索）
     - jsTokenize() / yamlTokenize() 等のシンタックスハイライト
   このファイルは vja-defs.js / vja-yaml-editor.js に依存する。
═══════════════════════════════════════════════════════════════ */

        /* ═══════════════════════════════════════════
           エディタ共通ユーティリティ（行番号・タブ）
        ═══════════════════════════════════════════ */

        // 行番号を更新
        function editorUpdateGutter(taId, gutId) {
            const ta = $(taId);
            const gut = $(gutId);
            if (!ta || !gut) return;
            const lines = ta.value.split("\n").length;
            let html = "";
            for (let i = 1; i <= lines; i++) html += i + "\n";
            gut.textContent = html;
            editorSyncGutter(taId, gutId);
        }

        // gutterのスクロールをtextareaに同期
        function editorSyncGutter(taId, gutId) {
            const ta = $(taId);
            const gut = $(gutId);
            if (!ta || !gut) return;
            gut.scrollTop = ta.scrollTop;
        }

        // Tab / Shift+Tab 処理

        /* ── YAMLエディタ タブ切り替え ── */
        function yamlTabSwitch(tab) {
            const yamlTab = $("tab-yaml");
            const jsTab = $("tab-js");
            const yamlPane = $("pane-yaml");
            const jsPane = $("pane-js");
            if (!yamlTab || !jsTab || !yamlPane || !jsPane) return;
            if (tab === "yaml") {
                yamlTab.classList.add("active");
                jsTab.classList.remove("active");
                yamlPane.classList.add("active");
                jsPane.classList.remove("active");
            } else {
                jsTab.classList.add("active");
                yamlTab.classList.remove("active");
                jsPane.classList.add("active");
                yamlPane.classList.remove("active");
            }
        }

        /* ── JavaScript エディタ Undo（ネイティブに委譲） ── */
        /* ── エディタ Undo/Redo（YAML・JS共通カスタム実装） ── */

        // UNDO_DELIMITERS（区切り文字）は init-params.js で window.UNDO_DELIMITERS として定義済み

        // エディタの Undo 履歴にテキスト値を積む。最大100件保持。
        function editorUndoPush(state, val) {
            state.stack = state.stack.slice(0, state.idx + 1);
            if (state.stack[state.idx] === val) return;
            state.stack.push(val);
            if (state.stack.length > 1000) state.stack.shift();
            else state.idx++;
        }

        // エディタの Undo 状態を初期化する。モーダルオープン時に呼ぶ。
        function editorUndoInit(taId, state, initVal) {
            state.stack = [initVal];
            state.idx = 0;
            state.busy = false;
            state.lastKey = "";
            const ta = $(taId);
            if (!ta) return;
            // キーを記録
            ta.addEventListener("keydown", function (e) {
                if (!state.busy) state.lastKey = e.key;
            });
            // input時に区切り文字なら保存
            ta.addEventListener("input", function () {
                if (state.busy) return;
                if (UNDO_DELIMITERS.has(state.lastKey)) {
                    editorUndoPush(state, ta.value);
                }
            });
        }

        // エディタの Undo を実行し、ハイライトを更新する。
        function editorUndo(taId, state) {
            const ta = $(taId);
            if (!ta) return;
            if (state.stack[state.idx] !== ta.value) editorUndoPush(state, ta.value);
            if (state.idx <= 0) return;
            state.busy = true;
            state.idx--;
            ta.value = state.stack[state.idx];
            editorHlUpdate(taId);
            setTimeout(() => {state.busy = false;}, 50);
        }

        // エディタの Redo を実行し、ハイライトを更新する。
        function editorRedo(taId, state) {
            if (state.idx >= state.stack.length - 1) return;
            const ta = $(taId);
            if (!ta) return;
            state.busy = true;
            state.idx++;
            ta.value = state.stack[state.idx];
            editorHlUpdate(taId);
            setTimeout(() => {state.busy = false;}, 50);
        }


        // ── ハイライト共通処理 ───────────────────────────
        // textarea の上に重ねた hl（ハイライトレイヤー）を
        // スクロール位置・サイズ同期して疑似シンタックスハイライトを実現する。

        // カーソル位置が表示範囲に収まるよう textarea をスクロールする。
        function _ensureCursorVisible(ta) {
            const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
            const cursorLine = ta.value.slice(0, ta.selectionStart).split("\n").length;
            const cursorTop = (cursorLine - 1) * lineHeight;
            const cursorBottom = cursorTop + lineHeight;
            if (cursorBottom > ta.scrollTop + ta.clientHeight) {
                ta.scrollTop = cursorBottom - ta.clientHeight + 8;
            } else if (cursorTop < ta.scrollTop) {
                ta.scrollTop = cursorTop;
            }
        }

        // textarea と hl のスクロール位置を transform で同期する。
        // nowrap前提: hl は scrollWidth/scrollHeight サイズで固定し
        // transform で textarea のスクロール量だけずらす。
        function _hlSync(taId, hlId) {
            const ta = $(taId), hl = $(hlId);
            if (!ta || !hl) return;
            hl.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
        }
        // hl の innerHTML をトークナイズ結果で更新し、サイズを同期する。
        // tokenizeFn には yamlTokenize / jsTokenize を渡す。
        function _hlUpdate(taId, hlId, tokenizeFn) {
            const ta = $(taId), hl = $(hlId);
            if (!ta || !hl) return;
            hl.innerHTML = tokenizeFn(ta.value);
            // nowrap前提: 横幅のみscrollWidthに合わせる（縦はflexで固定）
            hl.style.width = ta.scrollWidth + "px";
            _hlSync(taId, hlId);
        }
        function yamlHlUpdate() {_hlUpdate("yaml-ta", "yaml-hl", yamlTokenize);}
        function yamlHlSync() {_hlSync("yaml-ta", "yaml-hl");}
        function yamlTokenize(text) {
            return text.split("\n").map(line => {
                // コメント行
                if (/^\s*#/.test(line)) {
                    return '<span class="yc">' + escHl(line) + '</span>';
                }
                // キー: 値 の行
                const kvMatch = line.match(/^(\s*-?\s*)([^:\s][^:]*)(:)(\s*)(.*)?$/);
                if (kvMatch) {
                    const indent = escHl(kvMatch[1]);
                    const key = '<span class="yk">' + escHl(kvMatch[2]) + '</span>';
                    const colon = '<span class="yk">:</span>';
                    const space = escHl(kvMatch[4]);
                    const val = kvMatch[5] !== undefined ? colorVal(kvMatch[5]) : '';
                    return indent + key + colon + space + val;
                }
                // リスト項目 (- value)
                const listMatch = line.match(/^(\s*-\s+)(.*)?$/);
                if (listMatch) {
                    return '<span class="ys">' + escHl(listMatch[1]) + '</span>' + colorVal(listMatch[2] || '');
                }
                // ブロックスカラー継続行（インデントのみ）
                return '<span class="yv">' + escHl(line) + '</span>';
            }).join("\n");
        }
        function colorVal(v) {
            if (!v) return '';
            if (/^#/.test(v)) return '<span class="yc">' + escHl(v) + '</span>';
            if (/^[|>]/.test(v)) return '<span class="yp">' + escHl(v) + '</span>';
            if (/^(true|false|yes|no|on|off)$/i.test(v.trim())) return '<span class="yd">' + escHl(v) + '</span>';
            if (/^null$/i.test(v.trim())) return '<span class="yd">' + escHl(v) + '</span>';
            if (/^-?[0-9]+(\.?[0-9]*)$/.test(v.trim())) return '<span class="yn">' + escHl(v) + '</span>';
            if (/^["']/.test(v.trim())) return '<span class="yv">' + escHl(v) + '</span>';
            return '<span class="yv">' + escHl(v) + '</span>';
        }
        function escHl(s) {
            return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        // YAMLデータをウィジェットに保存する（モーダルは閉じない）
        function _saveYamlData(wid, evName) {
            const w = getWidget(wid);
            if (!w) return;
            if (!w.events) w.events = {};
            if (!w.jsCode) w.jsCode = {};
            w.events[evName] = $("yaml-ta")?.value || "";
            w.jsCode[evName] = $("js-ta")?.value || "";
            renderEventsAndPush();
        }
        function saveYaml(wid, evName) {
            _saveYamlData(wid, evName);
            closeModal();
        }

        /* ── フォームイベント編集 ── */
        function openFormYaml(evName) {
            const f = getProjectData().forms[getProjectData().curFormIdx];
            if (!f.events) f.events = {};
            const cur = f.events[evName] ||
                // 空の場合はデフォルトのYAMLセット.
                _PROMPT_DEF.DEFAULT_YAML_VALUE(evName, "form");
            const curJs = f.events["_js_" + evName] || "";
            pvRegister("yamlSave", () => saveFormYaml(evName));
            pvRegister("yamlAiGen", () => yamlAiGenerate("form", evName));
            showModal(buildYamlEditorHTML(cur, curJs, false, mhdrHTML("📋 フォーム — " + esc(evName))));
            initYamlEditorModal(cur, curJs);
        }

        function saveFormYaml(evName) {
            const f = getProjectData().forms[getProjectData().curFormIdx];
            if (!f.events) f.events = {};
            f.events[evName] = $("yaml-ta")?.value || "";
            f.events["_js_" + evName] = $("js-ta")?.value || "";
            closeModal();
            renderEventsAndPush();
            showToast("フォームイベントを保存しました");
        }

        async function deleteFormYaml(evName) {
            const f = getProjectData().forms[getProjectData().curFormIdx];
            const hasY = f.events?.[evName]?.trim().length > 0;
            if (!hasY) return;
            const dlg = await vja.app.showConfirm("「" + evName + "」のイベント定義を削除してよろしいですか？");
            if (!dlg) return;
            if (f.events) {delete f.events[evName]; delete f.events["_js_" + evName];}
            renderEventsAndPush();
        }

        /* ═══════════════════════════════════════════
           window へのエクスポート（他ファイルから参照される関数のみ）
        ═══════════════════════════════════════════ */
        window.editorUpdateGutter = editorUpdateGutter;
        window.editorSyncGutter = editorSyncGutter;
        window.yamlTabSwitch = yamlTabSwitch;
        window.editorUndoPush = editorUndoPush;
        window.editorUndoInit = editorUndoInit;
        window.editorUndo = editorUndo;
        window.editorRedo = editorRedo;
        window._hlSync = _hlSync;
        window._hlUpdate = _hlUpdate;
        window.yamlHlUpdate = yamlHlUpdate;
        window.yamlHlSync = yamlHlSync;
        window.yamlTokenize = yamlTokenize;
        window.colorVal = colorVal;
        window.escHl = escHl;
        window._saveYamlData = _saveYamlData;
        window.saveYaml = saveYaml;
        window.openFormYaml = openFormYaml;
        window.saveFormYaml = saveFormYaml;
        window.deleteFormYaml = deleteFormYaml;

