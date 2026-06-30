/* ═══════════════════════════════════════════════════════════════
   vja-designer.js — デザイナー本体（描画・選択・ドラッグ・プロパティパネル）
   ─────────────────────────────────────────────────────────────
   【読み込み順序】2番目（vja-defs.js の直後）。
   【依存】vja-defs.js（_CTX, WIDGET_DEFS, esc, $, evtAttr 等）
   【提供するもの】
     - buildTools() / setTool()（ツールボックス）
     - applyForm() 系（フォーム設定の反映）
     - makeInner()（ウィジェットプレビューHTML生成）
     - renderWidget() / select() / deselect()（描画・選択）
     - フォームボディの mousedown ハンドラ（VBスタイル描画）
     - addWidget()（ウィジェット追加）
     - ウィジェットの選択・移動・リサイズ
     - renderProps() / pinput()（プロパティパネル）
   このファイルは vja-defs.js にのみ依存する。
═══════════════════════════════════════════════════════════════ */

        /* ═══════════════════════════════════════════
          TOOL GRID
        ═══════════════════════════════════════════ */
        function buildTools() {
            const g = $("tool-grid");
            g.innerHTML = "";
            const toolList = [
                POINTER_TOOL,
                ...Object.entries(WIDGET_DEFS)
                    .filter(([, d]) => d.icon)
                    .map(([tag, d]) => ({id: tag, label: d.label, icon: d.icon})),
            ];
            toolList.forEach((t) => {
                const d = document.createElement("div");
                d.className =
                    "tool-item" +
                    (t.id === "pointer" ? " active-tool" : "");
                d.dataset.tid = t.id;
                d.innerHTML = `<span class="ti">${t.icon}</span><span>${t.label}</span>`;
                d.addEventListener("click", () => setTool(t.id));
                g.appendChild(d);
            });
        }

        function setTool(id) {
            getDesignerState().activeTool = id;
            document
                .querySelectorAll(".tool-item")
                .forEach((el) =>
                    el.classList.toggle(
                        "active-tool",
                        el.dataset.tid === id,
                    ),
                );
            const tool = getToolById(id);
            $("st-tool").innerHTML = `<b>${tool?.label ?? id}</b>`;
            // フォームボディのカーソル
            fb().style.cursor = id === "pointer" ? "default" : "crosshair";
        }

        /* ═══════════════════════════════════════════
          APPLY FORM CONFIG
        ═══════════════════════════════════════════ */
        function applyForm() {
            const fw = getProjectData().formCfg.w,
                fh = getProjectData().formCfg.h;
            $("form-win").style.width = fw + 4 + "px";
            fb().style.width = fw + "px";
            fb().style.height = fh + "px";
            fb().style.backgroundColor = getProjectData().formCfg.bg;
            $("ftitle").textContent = getProjectData().formCfg.title;
            // ルーラーを再描画（フォームサイズ変更・スクロール後）
            requestAnimationFrame(drawRulers);
        }

        /* ═══════════════════════════════════════════
          WIDGET HTML
        ═══════════════════════════════════════════ */
        function makeInner(w) {
            const p = w.props;
            const vis = p.visible === false ? "visibility:hidden" : "";
            const base = `width:100%;height:100%;box-sizing:border-box;font-family:'Yu Gothic UI','Meiryo UI','Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased;`;
            return WIDGET_DEFS[w.tag]?.preview?.(p, base, vis) || "";
        }

        // RHS（ウィジェットのリサイズハンドルHTML）は init-params.js で window.RHS として定義済み

        /* ═══════════════════════════════════════════
          RENDER
        ═══════════════════════════════════════════ */
        function renderWidget(w, isNew) {
            if (isNew) {
                const el = document.createElement("div");
                el.id = "w" + w.id;
                el.className = "widget";
                el.innerHTML = makeInner(w) + RHS;
                applyWPos(el, w);
                fb().appendChild(el);
                bindWidget(el, w.id);
                return;
            }
            // update existing
            const el = $("w" + w.id);
            if (!el) return;
            applyWPos(el, w);
            // replace inner (first child = content, rest = rh handles)
            el.firstChild && el.firstChild.remove();
            el.insertAdjacentHTML("afterbegin", makeInner(w));
        }

        function applyWPos(el, w) {
            el.style.cssText = `left:${w.x}px;top:${w.y}px;width:${w.w}px;height:${w.h}px;z-index:${w.z || 0}`;
            el.className = "widget" + (w.id === getDesignerState().selId ? " sel" : "");
        }

        function fullRedraw() {
            // clear getProjectData().widgets from form-body (keep #rubber)
            [...fb().children].forEach((c) => {
                if (c.id !== "rubber") c.remove();
            });
            getProjectData().widgets.forEach((w) => renderWidget(w, true));
            updateSelVisual();
        }

        function updateSelVisual() {
            document.querySelectorAll(".widget").forEach((el) => {
                el.classList.toggle(
                    "sel",
                    parseInt(el.id.slice(1)) === getDesignerState().selId,
                );
            });
        }

        /* ═══════════════════════════════════════════
          SELECT / DESELECT
        ═══════════════════════════════════════════ */
        function select(id) {
            getDesignerState().selId = id;
            updateSelVisual();
            const w = getWidget(id);
            $("prop-obj").textContent = w ? (WIDGET_DEFS[w.tag]?.label ?? w.tag) : getProjectData().formCfg.title;
            updateStatusSel(w);
            renderProps();
        }

        function deselect() {
            getDesignerState().selId = null;
            updateSelVisual();
            $("prop-obj").textContent = getProjectData().formCfg.title;
            $("st-size").innerHTML = `W:<b>-</b> H:<b>-</b>`;
            renderProps();
        }

        function updateStatusSel(w) {
            if (!w) return;
            $("st-pos").innerHTML = `X:<b>${w.x}</b> Y:<b>${w.y}</b>`;
            $("st-size").innerHTML = `W:<b>${w.w}</b> H:<b>${w.h}</b>`;
        }

        /* ═══════════════════════════════════════════
        ★ FORM-BODY MOUSEDOWN  （VBスタイル描画）
        ・pointer → ウィジェット外クリックで deselect
        ・tool    → ドラッグでラバーバンド → mouseup で確定
        ═══════════════════════════════════════════ */
        function initFormBodyEvents() {
            const body = fb();

            // Ctrl+A でフォーム内テキスト選択を無効化
            // Ctrl+A は統合keydownハンドラで処理

            body.addEventListener("mousedown", (e) => {
                // ウィジェット・ハンドルは対象外
                if (e.target !== body && e.target.id !== "rubber") return;

                if (getDesignerState().activeTool === "pointer") {
                    deselect();
                    return;
                }

                // ── ドラッグ描画開始 ──
                e.preventDefault();
                const rect = body.getBoundingClientRect();
                const x0 = sn(e.clientX - rect.left);
                const y0 = sn(e.clientY - rect.top);

                const rb = $("rubber");
                rb.style.cssText = `display:block;left:${x0}px;top:${y0}px;width:0;height:0`;

                let cx = x0,
                    cy = y0,
                    cw = 0,
                    ch = 0;

                function onMove(ev) {
                    const nx = sn(ev.clientX - rect.left);
                    const ny = sn(ev.clientY - rect.top);
                    cx = Math.min(x0, nx);
                    cy = Math.min(y0, ny);
                    cw = Math.abs(nx - x0);
                    ch = Math.abs(ny - y0);
                    rb.style.left = cx + "px";
                    rb.style.top = cy + "px";
                    rb.style.width = cw + "px";
                    rb.style.height = ch + "px";
                    $("st-pos").innerHTML = `X:<b>${cx}</b> Y:<b>${cy}</b>`;
                    $("st-size").innerHTML =
                        `W:<b>${cw}</b> H:<b>${ch}</b>`;
                }

                function onUp() {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    rb.style.display = "none";

                    const tool = getToolById(getDesignerState().activeTool);
                    if (!tool || !tool.tag) {
                        setTool("pointer");
                        return;
                    }

                    // 最小サイズ保証
                    const fw = Math.max(cw, tool.def.w);
                    const fh = Math.max(ch, tool.def.h);

                    addWidget(tool, cx, cy, fw, fh);
                    setTool("pointer");
                }

                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
            });

            // マウス位置ステータス
            body.addEventListener("mousemove", (e) => {
                if (getDesignerState().selId) return;
                const r = body.getBoundingClientRect();
                const x = sn(e.clientX - r.left),
                    y = sn(e.clientY - r.top);
                $("st-pos").innerHTML = `X:<b>${x}</b> Y:<b>${y}</b>`;
            });
        }

        /* ═══════════════════════════════════════════
          ADD WIDGET
        ═══════════════════════════════════════════ */
        function addWidget(tool, x, y, w, h) {
            const sameTag = getProjectData().widgets.filter(
                (ww) => ww.tag === tool.tag,
            ).length;
            const label = tool.id[0].toUpperCase() + tool.id.slice(1);
            const name = label + (sameTag > 0 ? sameTag + 1 : "");
            const props = {...tool.def};
            // w,h は def から除いて別管理
            delete props.w;
            delete props.h;

            const widget = {
                id: getProjectData().idCnt++,
                name,
                tag: tool.tag,
                x: Math.max(0, x),
                y: Math.max(0, y),
                w: Math.max(w, 16),
                h: Math.max(h, 10),
                z: getProjectData().widgets.length,
                props,
                events: {},
            };
            getProjectData().widgets.push(widget);
            commitIdCnt();
            renderWidget(widget, true);
            pushUndo();
            select(widget.id);
            updateCount();
        }

        /* ═══════════════════════════════════════════
          WIDGET EVENTS（選択・移動・リサイズ）
        ═══════════════════════════════════════════ */
        function bindWidget(el, wid) {
            el.addEventListener("mousedown", (e) => {
                if (e.button !== 0) return;

                const h = e.target.dataset.h;
                if (h) {
                    // リサイズハンドル
                    e.stopPropagation();
                    e.preventDefault();
                    startResize(e, wid, h);
                    return;
                }

                // ウィジェット本体 → ポインタなら移動、ツールなら無視
                if (getDesignerState().activeTool !== "pointer") return;
                e.stopPropagation();
                e.preventDefault();
                select(wid);
                startMove(e, wid);
            });

            el.addEventListener("dblclick", (e) => {
                if (getDesignerState().activeTool !== "pointer") return;
                e.stopPropagation();
                e.preventDefault();
                const w = getWidget(wid);
                if (!w) return;
                const evList = WIDGET_DEFS[w.tag]?.events || [];
                if (evList.length === 0) return;
                select(wid);
                openYaml(w.id, evList[0]);
            });

            el.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                e.stopPropagation();
                getDesignerState().ctxId = wid;
                select(wid);
                showCtx(e.clientX, e.clientY);
            });
        }

        /* ─ MOVE ─ */
        function startMove(e, wid) {
            const w = getWidget(wid);
            if (!w) return;
            const ox = w.x,
                oy = w.y;
            const sx = e.clientX,
                sy = e.clientY;

            function onMove(ev) {
                const dx = ev.clientX - sx,
                    dy = ev.clientY - sy;
                w.x = sn(Math.max(0, Math.min(ox + dx, getProjectData().formCfg.w - w.w)));
                w.y = sn(Math.max(0, Math.min(oy + dy, getProjectData().formCfg.h - w.h)));
                const el = $("w" + wid);
                if (el) {
                    el.style.left = w.x + "px";
                    el.style.top = w.y + "px";
                }
                updateStatusSel(w);
                syncPropXY(w);
            }
            function onUp() {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                if (w.x !== ox || w.y !== oy) pushUndo();
            }
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        }

        /* ─ RESIZE ─ */
        function startResize(e, wid, handle) {
            const w = getWidget(wid);
            if (!w) return;
            const {x: ox, y: oy, w: ow, h: oh} = w;
            const sx = e.clientX,
                sy = e.clientY;

            function onMove(ev) {
                const dx = ev.clientX - sx,
                    dy = ev.clientY - sy;
                let nx = ox,
                    ny = oy,
                    nw = ow,
                    nh = oh;
                if (handle.includes("l")) {
                    nx = sn(ox + dx);
                    nw = sn(ow - dx);
                }
                if (handle.includes("r")) {
                    nw = sn(ow + dx);
                }
                if (handle.includes("t")) {
                    ny = sn(oy + dy);
                    nh = sn(oh - dy);
                }
                if (handle.includes("b")) {
                    nh = sn(oh + dy);
                }
                if (nw < 16) nw = 16;
                if (nh < 10) nh = 10;
                w.x = nx;
                w.y = ny;
                w.w = nw;
                w.h = nh;
                const el = $("w" + wid);
                if (el) {
                    el.style.cssText = `left:${nx}px;top:${ny}px;width:${nw}px;height:${nh}px;z-index:${w.z || 0}`;
                    el.classList.add("sel");
                }
                updateStatusSel(w);
                syncPropXY(w);
                syncPropWH(w);
            }
            function onUp() {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                pushUndo();
                renderProps();
            }
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        }

        /* ═══════════════════════════════════════════
          PROPERTIES PANEL
        ═══════════════════════════════════════════ */

        function renderProps() {
            const pl = $("plist"),
                el = $("elist");
            pl.innerHTML = "";
            el.innerHTML = "";
            if (getDesignerState().curTab === "e") {
                renderEvents();
                return;
            }

            if (!getDesignerState().selId) {
                // フォームプロパティをWIDGET_DEFS.form.pdefsで共通描画
                const defs = WIDGET_DEFS.form?.pdefs || [];
                defs.forEach((d) => {
                    if (d.sep) {pl.appendChild(makeSec(d.sep)); return;}
                    let val;
                    if (d.sp === "formName") val = getProjectData().formCfg.name;
                    else if (d.sp === "formTitle") val = getProjectData().formCfg.title;
                    else if (d.sp === "formW") val = getProjectData().formCfg.w;
                    else if (d.sp === "formH") val = getProjectData().formCfg.h;
                    else if (d.sp === "formBg") val = getProjectData().formCfg.bg;
                    else if (d.sp === "formDesc") val = getProjectData().formCfg.description;
                    pl.appendChild(makeProw(d, val, null));
                });
                return;
            }
            const w = getWidget(getDesignerState().selId);
            if (!w) return;
            const defs = WIDGET_DEFS[w.tag]?.pdefs || [];
            defs.forEach((d) => {
                if (d.sep) {
                    pl.appendChild(makeSec(d.sep));
                    return;
                }
                let val;
                if (d.sp === "name") val = w.name;
                else if (d.sp === "x") val = w.x;
                else if (d.sp === "y") val = w.y;
                else if (d.sp === "w") val = w.w;
                else if (d.sp === "h") val = w.h;
                else val = w.props[d.k];
                pl.appendChild(makeProw(d, val, w.id));
            });
        }

        function makeSec(txt) {
            const d = document.createElement("div");
            d.className = "psec";
            d.textContent = txt;
            return d;
        }

        function makeProw(d, val, wid) {
            const row = document.createElement("div");
            row.className = "prow";
            row.innerHTML = `<div class="pk">${d.lb}</div><div class="pv">${pinput(d, val, wid)}</div>`;
            return row;
        }

        function pinput(d, val, wid) {
            const w2 = wid;
            switch (d.t) {
                case "text":
                    return `<input type="text" class="pv-input" value="${esc(val ?? "")}"${evtAttr("onchange", "setProp('" + d.k + "','" + (d.sp || "") + "',this.value," + w2 + ")")}>`;
                case "num": {
                    const nid = "pn_" + w2 + "_" + d.k.replace(/[^a-z0-9]/gi, "_");
                    const nMin = d.min ?? -9999;
                    const nMax = d.max ?? 9999;
                    return `<div style="display:flex;align-items:center;gap:2px;width:100%">` +
                        `<input type="number" id="${nid}" class="pv-input" value="${val ?? 0}" min="${nMin}" max="${nMax}" ` +
                        `style="flex:1;height:22px;-webkit-appearance:none;appearance:none;text-align:right"` +
                        evtAttr("onchange", "setProp('" + d.k + "','" + (d.sp || "") + "',+this.value," + w2 + ")") + ">" +
                        `<button` + evtAttr("onmousedown", "pvNumStep('" + nid + "',1,'" + d.k + "','" + (d.sp || "") + "'," + w2 + "," + nMin + "," + nMax + ")") +
                        ` style="width:18px;height:22px;background:var(--bg3);border:1px solid var(--border);border-radius:2px;color:var(--text);font-size:10px;cursor:pointer;padding:0;flex-shrink:0">▲</button>` +
                        `<button` + evtAttr("onmousedown", "pvNumStep('" + nid + "',-1,'" + d.k + "','" + (d.sp || "") + "'," + w2 + "," + nMin + "," + nMax + ")") +
                        ` style="width:18px;height:22px;background:var(--bg3);border:1px solid var(--border);border-radius:2px;color:var(--text);font-size:10px;cursor:pointer;padding:0;flex-shrink:0">▼</button>` +
                        `</div>`;
                }
                case "bool": {
                    const bid = "pvs_" + w2 + "_" + d.k.replace(/[^a-z0-9]/gi, "_");
                    return makePvSel(bid,
                        [{value: "true", label: "True"}, {value: "false", label: "False"}],
                        val ? "true" : "false",
                        "setProp('" + d.k + "','" + (d.sp || "") + "',{value}==='true'," + w2 + ")");
                }
                case "color":
                    return `<input type="color" value="${val || "#000000"}" style="width:100%;height:22px;padding:1px 2px;cursor:pointer;border:1px solid var(--border);border-radius:2px;background:var(--bg3)"` +
                        evtAttr("oninput", "setProp('" + d.k + "','" + (d.sp || "") + "',this.value," + w2 + ")") +
                        evtAttr("onchange", "setProp('" + d.k + "','" + (d.sp || "") + "',this.value," + w2 + ")") + ">";
                case "sel":
                case "select": {
                    const sid = "pvs_" + w2 + "_" + d.k.replace(/[^a-z0-9]/gi, "_");
                    const opts = d.opts || [];
                    return makePvSel(sid, opts, val ?? (opts[0] || ""),
                        "setProp('" + d.k + "','" + (d.sp || "") + "',{value}," + w2 + ")");
                }
                case "itemsdef":
                    return `<button${evtAttr("onmousedown", "openItemsDefEditor(" + w2 + ")")} class="pv-input" style="color:var(--accent);cursor:pointer;text-align:left">✏ 項目編集…</button>`;
                case "area":
                    return `<textarea class="pv-textarea" style="height:56px"${evtAttr("onchange", "setProp('" + d.k + "','" + (d.sp || "") + "',this.value," + w2 + ")")}>${esc(val || "")}</textarea>`;
                case "img": {
                    const hasImg = val && val.startsWith("data:");
                    const iid = "pvimg_" + w2;
                    return `<div style="display:flex;flex-direction:column;gap:4px;width:100%">` +
                        `<div id="${iid}_preview" style="width:100%;height:60px;background:var(--bg3);border:1px solid var(--border);border-radius:2px;display:flex;align-items:center;justify-content:center;overflow:hidden">` +
                        (hasImg
                            ? `<img src="${val}" style="max-width:100%;max-height:100%;object-fit:contain">`
                            : `<span style="color:var(--text3);font-size:11px">画像なし</span>`) +
                        `</div>` +
                        `<div style="display:flex;gap:4px">` +
                        `<button class="pv-input" style="flex:1;cursor:pointer;color:var(--accent)"` + evtAttr("onmousedown", "openImgUpload(" + w2 + ")") + `>📁 選択…</button>` +
                        (hasImg ? `<button class="pv-input" style="cursor:pointer;color:#ff6b6b"` + evtAttr("onmousedown", "clearImg(" + w2 + ")") + `>✕</button>` : "") +
                        `</div>` +
                        `</div>`;
                }
                case "coldef":
                    return `<button${evtAttr("onmousedown", "openColDefEditor(" + w2 + ")")} class="pv-input" style="color:var(--accent);cursor:pointer;text-align:left">✏ カラム編集…</button>`;
                case "fontsel": {
                    const curFF = val || "";
                    const curFFL = WIDGET_FONTS.find(f => f.value === curFF)?.label || "（デフォルト）";
                    const fid = "pv-ff-" + w2;
                    const fopts = WIDGET_FONTS.map((f, i) =>
                        `<div class="pv-sel-opt ${f.value === curFF ? "active" : ""}"` +
                        evtAttr("onmousedown", "pvSelPick('" + fid + "','" + esc(f.label) + "',event);setFontFamilyProp(" + i + "," + w2 + ")") + `>${esc(f.label)}</div>`
                    ).join("");
                    return `<div class="pv-sel" id="${fid}">` +
                        `<div class="pv-sel-btn"` + evtAttr("onmousedown", "pvSelOpen('" + fid + "',event)") + `>` +
                        `<span>${esc(curFFL)}</span><span class="arr">▼</span></div>` +
                        `<div class="pv-sel-list">${fopts}</div></div>`;
                }
            }
            return "";
        }

        function setProp(k, sp, val, wid) {
            // フォームプロパティの処理
            if (sp === "formName") {setFormCfg("name", val); return;}
            if (sp === "formTitle") {setFormCfg("title", val); return;}
            if (sp === "formW") {setFormCfg("w", +val); return;}
            if (sp === "formH") {setFormCfg("h", +val); return;}
            if (sp === "formBg") {setFormCfg("bg", val); return;}
            if (sp === "formDesc") {setFormCfg("description", val); return;}
            // ウィジェットプロパティの処理
            const w = getWidget(wid);
            if (!w) return;
            if (sp === "name") w.name = val;
            else if (sp === "x") w.x = +val;
            else if (sp === "y") w.y = +val;
            else if (sp === "w") w.w = +val;
            else if (sp === "h") w.h = +val;
            else w.props[k] = val;
            commitWidget(w, {name: sp === "name", props: true});
        }

        // モーダルヘッダー生成ヘルパー
        function mhdrHTML(title, layer = "modal-root") {
            return "<div class='mhdr'><h4>" + title + "</h4>" +
                "<button class='mclose'" + evtAttr("onmousedown", "closeModal(\"" + layer + "\")") + ">✕</button></div>";
        }
        // モーダルフッター生成ヘルパー
        function mfootHTML(btns) {
            // btns: [{label, cls, action}]
            return "<div class='mfoot'>" +
                btns.map(b => `<button class='${b.cls || ""}'${evtAttr("onmousedown", b.action)}>${b.label}</button>`).join("") +
                "</div>";
        }

        // ── 画像アップロード ─────────────────────────────
        function openImgUpload(wid) {
            const inp = document.createElement("input");
            inp.type = "file";
            inp.accept = "image/jpeg,image/png,image/gif";
            inp.onchange = () => {
                const file = inp.files?.[0];
                if (!file) return;
                const MAX = 300 * 1024; // 300KB
                if (file.size > MAX) {
                    showVjaAlert(`画像サイズが上限(300KB)を超えています。\n現在: ${(file.size / 1024).toFixed(1)}KB`);
                    return;
                }
                const reader = new FileReader();
                reader.onload = (e) => {
                    const b64 = e.target.result;
                    const w = getWidget(wid);
                    if (!w) return;
                    editorUndoPush(getEditorContext().yu, JSON.stringify(w));
                    setProp("src", "", b64, wid);
                    renderProps();
                    fullRedraw();
                    pushUndo();
                };
                reader.readAsDataURL(file);
            };
            inp.click();
        }

        function clearImg(wid) {
            const w = getWidget(wid);
            if (!w) return;
            setProp("src", "", "", wid);
            renderProps();
            fullRedraw();
            pushUndo();
        }

        function commitWidget(w, opts = {}) {
            renderWidget(w, false);
            applyWPos($("w" + w.id), w);
            if (opts.name) $("prop-obj").textContent = WIDGET_DEFS[w.tag]?.label ?? w.tag;
            if (opts.props !== false) renderProps();
            pushUndo();
        }

        // ⑤ ウィジェット取得ヘルパー
        function getWidget(wid) {
            return getProjectData().widgets.find((x) => x.id == wid) || null;
        }

        // 数値入力の▲▼ボタン処理
        function pvNumStep(nid, dir, k, sp, wid, min, max) {
            const inp = $(nid);
            if (!inp) return;
            const cur = parseFloat(inp.value) || 0;
            const step = parseFloat(inp.step) || 1;
            const next = Math.min(max, Math.max(min, cur + dir * step));
            inp.value = next;
            setProp(k, sp, next, wid);
        }

        function setFontFamilyProp(idx, wid) {
            const w = getWidget(wid);
            if (!w) return;
            w.props.fontFamily = (WIDGET_FONTS[idx] || WIDGET_FONTS[0]).value;
            commitWidget(w, {props: false});
        }

        // ── プロパティパネルの数値を直接更新（ドラッグ中のlive update） ──
        function _syncPropValues(map) {
            [...$("plist").querySelectorAll(".prow")].forEach((r) => {
                const inp = r.querySelector("input[type=number]");
                const lbl = r.querySelector(".pk")?.textContent;
                if (!inp || !lbl || !(lbl in map)) return;
                inp.value = map[lbl];
            });
        }
        function syncPropXY(w) {_syncPropValues({"Left": w.x, "Top": w.y});}
        function syncPropWH(w) {_syncPropValues({"Width": w.w, "Height": w.h});}

        function setFormCfg(k, v) {
            if (k === "name") {
                if (!v || !/^[a-zA-Z0-9_\-\.]+$/.test(v)) {
                    showToast("名前は英数字・アンダースコア・ハイフン・ドットのみ使用できます", 5000);
                    const nameInput = document.querySelectorAll("#plist .pv-input")[0];
                    if (nameInput) nameInput.value = getProjectData().formCfg.name || getProjectData().formCfg.title;
                    return;
                }
            }
            getProjectData().formCfg[k] = v;
            getProjectData().forms[getProjectData().curFormIdx].cfg[k] = v;
            buildFormSelect();
            applyForm();
        }

        /* ── イベントタブ ── */
        async function deleteYaml(wid, evName) {
            const w = getWidget(wid);
            if (!w) return;
            const hasY = w.events?.[evName]?.trim().length > 0;
            if (!hasY) return;
            const _dlg1 = await vja.app.showConfirm("「" + evName + "」のイベント定義を削除してよろしいですか？");
            if (!_dlg1) return;
            if (w.events) delete w.events[evName];
            renderEventsAndPush();
        }

        function renderEvents() {
            const el = $("elist");
            el.innerHTML = "";
            if (!getDesignerState().selId) {
                // ウィジェット未選択時はフォームイベントを表示
                const formEvs = WIDGET_DEFS.form?.events || [];
                const fev = getProjectData().forms[getProjectData().curFormIdx]?.events || {};
                const hdr = document.createElement("div");
                hdr.style.cssText = "padding:6px 10px;font-size:11px;color:var(--text3);border-bottom:1px solid var(--border)";
                hdr.textContent = "📋 フォームイベント";
                el.appendChild(hdr);
                formEvs.forEach(ev => {
                    const hasY = fev[ev]?.trim().length > 0;
                    const row = document.createElement("div");
                    row.className = "erow";
                    row.innerHTML = `<div class="ek ${hasY ? "has-yaml" : ""}">${ev}${hasY ? " ✓" : ""}</div>
      <button class="ebtn"${evtAttr("onmousedown", "openFormYaml('" + ev + "')")}>
        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="edelbtn ${hasY ? "has-yaml" : ""}"${evtAttr("onmousedown", "deleteFormYaml('" + ev + "')")} title="イベントを削除">✕</button>`;
                    el.appendChild(row);
                });
                return;
            }
            const w = getWidget(getDesignerState().selId);
            if (!w) return;
            (WIDGET_DEFS[w.tag]?.events || []).forEach((ev) => {
                const hasY = w.events?.[ev]?.trim().length > 0;
                const row = document.createElement("div");
                row.className = "erow";
                row.innerHTML = `<div class="ek ${hasY ? "has-yaml" : ""}">${ev}${hasY ? " ✓" : ""}</div>
      <button class="ebtn"${evtAttr("onmousedown", "openYaml(" + w.id + ",'" + ev + "')")}>
        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="edelbtn ${hasY ? "has-yaml" : ""}"${evtAttr("onmousedown", "deleteYaml(" + w.id + ",'" + ev + "')")} title="イベントを削除">✕</button>`;
                el.appendChild(row);
            });
        }

        /* ═══════════════════════════════════════════
           window へのエクスポート（他ファイルから参照される関数のみ）
        ═══════════════════════════════════════════ */
        window.buildTools = buildTools;
        window.setTool = setTool;
        window.applyForm = applyForm;
        window.makeInner = makeInner;
        window.renderWidget = renderWidget;
        window.applyWPos = applyWPos;
        window.fullRedraw = fullRedraw;
        window.updateSelVisual = updateSelVisual;
        window.select = select;
        window.deselect = deselect;
        window.updateStatusSel = updateStatusSel;
        window.initFormBodyEvents = initFormBodyEvents;
        window.addWidget = addWidget;
        window.bindWidget = bindWidget;
        window.startMove = startMove;
        window.startResize = startResize;
        window.renderProps = renderProps;
        window.makeSec = makeSec;
        window.makeProw = makeProw;
        window.pinput = pinput;
        window.setProp = setProp;
        window.mhdrHTML = mhdrHTML;
        window.mfootHTML = mfootHTML;
        window.openImgUpload = openImgUpload;
        window.clearImg = clearImg;
        window.commitWidget = commitWidget;
        window.getWidget = getWidget;
        window.pvNumStep = pvNumStep;
        window.setFontFamilyProp = setFontFamilyProp;
        window.syncPropXY = syncPropXY;
        window.syncPropWH = syncPropWH;
        window.setFormCfg = setFormCfg;
        window.deleteYaml = deleteYaml;
        window.renderEvents = renderEvents;
        window.switchTab = switchTab;

        function switchTab(t) {
            getDesignerState().curTab = t;
            document
                .querySelectorAll(".ptab")
                .forEach((el, i) =>
                    el.classList.toggle(
                        "on",
                        (i === 0 && t === "p") || (i === 1 && t === "e"),
                    ),
                );
            $("plist").style.display = t === "p" ? "block" : "none";
            $("elist").style.display = t === "e" ? "block" : "none";
            renderProps();
        }

