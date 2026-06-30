/* ═══════════════════════════════════════════════════════════════
   vja-ui.js — キーボードショートカット・座標ルーラー・フォームリサイズ・INIT
   ─────────────────────────────────────────────────────────────
   【読み込み順序】9番目・最後（vja-app-config.js の直後）。
   【依存】これまでの全ファイル（vja-defs.js 〜 vja-app-config.js）
   【提供するもの】
     - グローバルキーボードショートカット（Ctrl+Z/Y/S/F/D等）
     - startPanelResize()（左右パネルのリサイズ）
     - 座標ルーラー（initRuler / drawRulers）
     - initFormResize()（フォーム枠のドラッグリサイズ）
     - 【重要】ファイル末尾の INIT 実行コード
       （buildTools() 等、画面起動時に1度だけ実行される）
   このファイルは全ての関数定義が完了した後に実行される必要があるため、
   必ず最後に読み込むこと。このファイルより後に他の <script> を
   追加してはならない。
═══════════════════════════════════════════════════════════════ */

        /* ═══════════════════════════════════════════
          KEYBOARD
        ═══════════════════════════════════════════ */
        // ── グローバルキーボードショートカット（統合） ──────
        document.addEventListener("keydown", (e) => {
            const tag = e.target.tagName;
            const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";



            // Ctrl+A: フォームボディにフォーカスがある時のみ選択を抑制
            if ((e.ctrlKey || e.metaKey) && e.key === "a") {
                if (!document.activeElement || document.activeElement === document.body ||
                    document.activeElement === fb()) {
                    e.preventDefault();
                }
                return;
            }

            // Ctrl+F: 入力フィールド内でも有効（エディタ検索）
            if (e.ctrlKey && e.key === "f") {
                const searchIn = $("editor-search-in");
                if (searchIn) {e.preventDefault(); searchIn.focus(); searchIn.select();}
            }

            // 以下は入力フィールド内では無効
            if (inInput) return;

            if (e.ctrlKey && e.key === "z") {e.preventDefault(); actUndo();}
            if (e.ctrlKey && e.key === "y") {e.preventDefault(); actRedo();}
            if (e.ctrlKey && e.key === "s") {e.preventDefault(); actSave();}
            if (navigator.platform.startsWith("Mac") && e.metaKey && e.key === "s") {e.preventDefault(); actSave();} // Mac: Cmd+S
            if (e.ctrlKey && e.key === "w") {e.preventDefault(); showCloseConfirm();}
            if (e.ctrlKey && e.key === "d") {e.preventDefault(); actDuplicate();}
            if (e.key === "F4" && e.altKey) {e.preventDefault(); showCloseConfirm();}
            if ((e.key === "Delete" || e.key === "Backspace") && getDesignerState().selId) {e.preventDefault(); actDelete();}
            if (e.key === "Escape") {
                if (document.getElementById("close-confirm").classList.contains("show")) {
                    hideCloseConfirm(); return;
                }
                getDesignerState().selId ? deselect() : setTool("pointer");
            }
            if (getDesignerState().selId && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
                e.preventDefault();
                const w = getWidget(getDesignerState().selId);
                if (!w) return;
                const d = e.shiftKey ? SNAP : 1;
                if (e.key === "ArrowLeft") w.x = Math.max(0, w.x - d);
                if (e.key === "ArrowRight") w.x = Math.min(getProjectData().formCfg.w - w.w, w.x + d);
                if (e.key === "ArrowUp") w.y = Math.max(0, w.y - d);
                if (e.key === "ArrowDown") w.y = Math.min(getProjectData().formCfg.h - w.h, w.y + d);
                const el = $("w" + w.id);
                if (el) {el.style.left = w.x + "px"; el.style.top = w.y + "px";}
                updateStatusSel(w);
                syncPropXY(w);
            }
        });

        // ── ↑↓キーで入力要素間を移動（モーダル・プロパティパネル共通） ──
        document.addEventListener("keydown", function _moveInputFocus(e) {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            const tag = e.target.tagName;
            if (tag !== "INPUT") return;
            const scope = e.target.closest("#modal-root, #modal-layer-1, #modal-layer-2, #props-panel");
            if (!scope) return;
            const inputs = [...scope.querySelectorAll("input[type='text'],input[type='number']")];
            const idx = inputs.indexOf(e.target);
            if (idx < 0) return;
            e.preventDefault();
            const next = e.key === "ArrowDown" ? inputs[idx + 1] : inputs[idx - 1];
            if (next) next.focus();
        });

        document.addEventListener("mousedown", (e) => {
            if (!e.target.closest(".menu-item")) closeAllMenus();
            if (!e.target.closest("#ctx") && !e.target.closest(".widget"))
                hideCtx();
            if (!e.target.closest("#fdd-wrap")) closeFdd();
            if (!e.target.closest(".pv-sel") && !e.target.closest(".pv-sel-list")) document.querySelectorAll(".pv-sel-list.open").forEach(el => el.classList.remove("open"));
            if (!e.target.closest(".col-type-btn") && !e.target.closest("#col-type-float")) {
                const f = $("col-type-float");
                if (f) f.classList.remove("open");
            }
        });

        /* ═══════════════════════════════════════════
          RULER（座標ルーラー）
        ═══════════════════════════════════════════ */

        /* ── パネルリサイズ ── */
        function startPanelResize(e, side) {
            e.preventDefault();
            const startX = e.clientX;
            const tb = $("toolbox"), pp = $("props-panel");
            const startW = side === "left" ? tb.offsetWidth : pp.offsetWidth;
            const MIN_W = 80, MAX_W = 400;
            const onMove = (me) => {
                let newW;
                if (side === "left") {
                    newW = Math.min(MAX_W, Math.max(MIN_W, startW + (me.clientX - startX)));
                    tb.style.width = newW + "px";
                    document.documentElement.style.setProperty("--panel", newW + "px");
                    getUiConfig().leftPanelW = newW;
                } else {
                    newW = Math.min(MAX_W, Math.max(MIN_W, startW - (me.clientX - startX)));
                    pp.style.width = newW + "px";
                    document.documentElement.style.setProperty("--prop", newW + "px");
                    getUiConfig().rightPanelW = newW;
                }
                requestAnimationFrame(drawRulers);
            };
            const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                // パネル幅をui-config.jsonに保存
                window.bunSaveUiConfig?.(
                    getUiConfig().uiFontSize, getUiConfig().uiFontFamily,
                    getUiConfig().editorFontSize, getUiConfig().editorFontFamily,
                    getUiConfig().leftPanelW, getUiConfig().rightPanelW
                );
                pushUndo();
            };
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        }

        function initRuler() {
            drawRulers();
        }

        function drawRulers() {
            const wrap = $("canvas-wrap");
            const wrapRect = wrap.getBoundingClientRect();
            const formRect = fb().getBoundingClientRect();

            // ── 水平ルーラー ──
            const rh = $("ruler-h");
            const hCanvas = $("ruler-h-canvas");
            const hW = wrapRect.width;
            rh.style.width = hW + "px";
            hCanvas.width = hW;
            hCanvas.height = 16;
            const hCtx = hCanvas.getContext("2d");
            hCtx.clearRect(0, 0, hW, 16);

            // フォーム左端のラッパー内相対座標
            const fLeft = formRect.left - wrapRect.left + 16; // ruler-v幅分オフセット
            drawRulerH(hCtx, hW, fLeft);

            // ── 垂直ルーラー ──
            const rv = $("ruler-v");
            const vCanvas = $("ruler-v-canvas");
            const vH = wrapRect.height - 16;
            rv.style.height = vH + "px";
            vCanvas.width = 16;
            vCanvas.height = vH;
            const vCtx = vCanvas.getContext("2d");
            vCtx.clearRect(0, 0, 16, vH);

            const fTop = formRect.top - wrapRect.top; // ruler-h高さ分は既に top:16px で吸収
            drawRulerV(vCtx, vH, fTop);
        }

        // _RULER（ルーラー描画共通定数）は init-params.js で window._RULER として定義済み

        function drawRulerH(ctx, totalW, fLeft) {
            const {STEP, TICK_LG, TICK_SM, TICK_COL, LABEL_COL, FORM_HL, FORM_BD} = _RULER;
            ctx.font = "8px monospace"; ctx.textAlign = "left";
            for (let px = (fLeft % STEP) - STEP; px < totalW; px += STEP) {
                const coord = Math.round(px - fLeft);
                ctx.strokeStyle = TICK_COL; ctx.fillStyle = LABEL_COL;
                ctx.beginPath(); ctx.moveTo(px, 16 - TICK_LG); ctx.lineTo(px, 16); ctx.stroke();
                if (px >= 0 && px < totalW && coord >= 0) ctx.fillText(coord, px + 2, 9);
                const px2 = px + STEP / 2;
                if (px2 >= 0 && px2 < totalW) {
                    ctx.beginPath(); ctx.moveTo(px2, 16 - TICK_SM); ctx.lineTo(px2, 16); ctx.stroke();
                }
            }
            const fw = getProjectData().formCfg.w;
            ctx.fillStyle = FORM_HL; ctx.fillRect(fLeft, 0, fw, 16);
            ctx.strokeStyle = FORM_BD;
            ctx.beginPath(); ctx.moveTo(fLeft, 0); ctx.lineTo(fLeft, 16); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(fLeft + fw, 0); ctx.lineTo(fLeft + fw, 16); ctx.stroke();
        }

        function drawRulerV(ctx, totalH, fTop) {
            const {STEP, TICK_LG, TICK_SM, TICK_COL, LABEL_COL, FORM_HL, FORM_BD} = _RULER;
            ctx.font = "8px monospace";
            ctx.save(); ctx.translate(14, 0); ctx.rotate(Math.PI / 2);
            for (let py = (fTop % STEP) - STEP; py < totalH; py += STEP) {
                const coord = Math.round(py - fTop);
                ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.strokeStyle = TICK_COL;
                ctx.beginPath(); ctx.moveTo(16 - TICK_LG, py); ctx.lineTo(16, py); ctx.stroke();
                if (py >= 0 && py < totalH && coord >= 0) {
                    ctx.fillStyle = LABEL_COL; ctx.font = "8px monospace";
                    ctx.save(); ctx.translate(12, py - 2); ctx.rotate(-Math.PI / 2);
                    ctx.fillText(coord, -28, 0); ctx.restore();
                }
                const py2 = py + STEP / 2;
                if (py2 >= 0 && py2 < totalH) {
                    ctx.strokeStyle = TICK_COL;
                    ctx.beginPath(); ctx.moveTo(16 - TICK_SM, py2); ctx.lineTo(16, py2); ctx.stroke();
                }
                ctx.restore();
            }
            ctx.restore();
            const fh = getProjectData().formCfg.h;
            ctx.fillStyle = FORM_HL; ctx.fillRect(0, fTop, 16, fh);
            ctx.strokeStyle = FORM_BD;
            ctx.beginPath(); ctx.moveTo(0, fTop); ctx.lineTo(16, fTop); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, fTop + fh); ctx.lineTo(16, fTop + fh); ctx.stroke();
        }

        /* ═══════════════════════════════════════════
          FORM RESIZE（フォーム枠のD&D）
        ═══════════════════════════════════════════ */
        function initFormResize() {
            function makeResizer(elId, doX, doY) {
                const el = $(elId);
                if (!el) return;
                el.addEventListener("mousedown", (e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const sx = e.clientX,
                        sy = e.clientY;
                    const ow = getProjectData().formCfg.w,
                        oh = getProjectData().formCfg.h;
                    function onMove(ev) {
                        if (doX) {
                            const nw = Math.max(
                                200,
                                sn(ow + (ev.clientX - sx)),
                            );
                            getProjectData().formCfg.w = nw;
                        }
                        if (doY) {
                            const nh = Math.max(
                                100,
                                sn(oh + (ev.clientY - sy)),
                            );
                            getProjectData().formCfg.h = nh;
                        }
                        applyForm();
                        syncFormPropWH();
                    }
                    function onUp() {
                        document.removeEventListener("mousemove", onMove);
                        document.removeEventListener("mouseup", onUp);
                        pushUndo();
                    }
                    document.addEventListener("mousemove", onMove);
                    document.addEventListener("mouseup", onUp);
                });
            }
            makeResizer("form-resize-br", true, true);
            makeResizer("form-resize-r", true, false);
            makeResizer("form-resize-b", false, true);
        }
        function syncFormPropWH() {
            if (getDesignerState().selId) return; // フォームのプロパティ表示中のみ
            const rows = [...$("plist").querySelectorAll(".prow")];
            rows.forEach((r) => {
                const inp = r.querySelector("input[type=number]");
                const lbl = r.querySelector(".pk")?.textContent;
                if (!inp || !lbl) return;
                if (lbl === "Width") inp.value = getProjectData().formCfg.w;
                if (lbl === "Height") inp.value = getProjectData().formCfg.h;
            });
        }

        /* ═══════════════════════════════════════════
           window へのエクスポート（他ファイルから参照される関数のみ）
        ═══════════════════════════════════════════ */
        window.startPanelResize = startPanelResize;
        window.initRuler = initRuler;
        window.drawRulers = drawRulers;
        window.drawRulerH = drawRulerH;
        window.drawRulerV = drawRulerV;
        window.initFormResize = initFormResize;
        window.syncFormPropWH = syncFormPropWH;

        /* ═══════════════════════════════════════════
          INIT
        ═══════════════════════════════════════════ */
        buildTools();
        buildFormSelect();
        applyForm();
        applyViewSettings();
        initFormBodyEvents();
        initFormResize();
        initRuler();
        $("canvas-wrap").addEventListener("scroll", () =>
            requestAnimationFrame(drawRulers),
        );
        window.addEventListener("resize", () =>
            requestAnimationFrame(drawRulers),
        );
        pushUndo();
        getEditHistory().savedSnapshot = JSON.stringify(snapshot());
        renderProps();