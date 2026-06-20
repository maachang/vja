/**
 * vja-runtime.js
 * VJA共通ランタイムライブラリ
 * デザイナー・コンパイル済みアプリ両方で利用可能
 *
 * 前提: project-bridge.js が読み込まれ window.vja.* API が定義済み
 * console.log 等のRPC転送は project-bridge.js 側で行う
 */

(function (global) {
    "use strict";

    const vja = global.vja || (global.vja = {});

    // ════════════════════════════════════════════════
    // 内部ユーティリティ
    // ════════════════════════════════════════════════

    // ウィジェット名→DOM要素を取得
    const _getEl = (name) => {
        // vja のウィジェットは id="w{n}" だが、name属性で検索
        const el = document.querySelector(`[data-name="${name}"]`)
            || document.querySelector(`#${name}`)
            || document.querySelector(`[name="${name}"]`);
        return el || null;
    };

    // ウィジェットのルートdiv（.widget-wrap）を取得
    const _getWidget = (name) => {
        return document.querySelector(`.widget-inner[data-name="${name}"]`)
            || _getEl(name);
    };

    // ════════════════════════════════════════════════
    // vja.widget.* — ウィジェットI/O
    // ════════════════════════════════════════════════
    vja.widget = {

        // 値の取得
        getValue(name) {
            const el = _getEl(name);
            if (!el) return null;
            const tag = el.tagName.toLowerCase();
            if (tag === "input") {
                if (el.type === "checkbox" || el.type === "radio") return el.checked;
                return el.value;
            }
            if (tag === "select") return el.value;
            if (tag === "textarea") return el.value;
            if (tag === "span" || tag === "label") return el.textContent;
            if (tag === "div") {
                // progressbar: data-val 属性から値を返す
                if (el.dataset.val !== undefined) return Number(el.dataset.val);
                return el.textContent;
            }
            return el.value ?? el.textContent ?? null;
        },

        // 値のセット
        setValue(name, value) {
            const el = _getEl(name);
            if (!el) return;
            const tag = el.tagName.toLowerCase();
            if (tag === "input") {
                if (el.type === "checkbox" || el.type === "radio") {
                    el.checked = !!value;
                } else {
                    el.value = value ?? "";
                }
            } else if (tag === "select" || tag === "textarea") {
                el.value = value ?? "";
            } else if (tag === "span" || tag === "label") {
                el.textContent = value ?? "";
            } else if (tag === "div") {
                // progressbar: data-val/data-min/data-max から幅を計算
                if (el.dataset.val !== undefined) {
                    const min = Number(el.dataset.min ?? 0);
                    const max = Number(el.dataset.max ?? 100);
                    const val = Math.min(max, Math.max(min, Number(value ?? 0)));
                    el.dataset.val = val;
                    const bar = el.firstElementChild;
                    if (bar) bar.style.width = ((val - min) / (max - min) * 100) + "%";
                } else {
                    el.textContent = value ?? "";
                }
            }
            el.dispatchEvent(new Event("change", { bubbles: true }));
        },

        // テキスト取得（label/text向け）
        getText(name) { return this.getValue(name); },
        setText(name, text) { this.setValue(name, text); },

        // 表示・非表示
        show(name) {
            const el = _getEl(name);
            if (el) el.style.visibility = "visible";
        },
        hide(name) {
            const el = _getEl(name);
            if (el) el.style.visibility = "hidden";
        },
        setVisible(name, visible) {
            visible ? this.show(name) : this.hide(name);
        },
        isVisible(name) {
            const el = _getEl(name);
            return el ? el.style.visibility !== "hidden" : false;
        },

        // 有効・無効
        enable(name) {
            const el = _getEl(name);
            if (el) el.disabled = false;
        },
        disable(name) {
            const el = _getEl(name);
            if (el) el.disabled = true;
        },

        // listBox / selectBox のアイテム設定
        setItems(name, items) {
            const el = _getEl(name);
            if (!el || el.tagName.toLowerCase() !== "select") return;
            const cur = el.value;
            el.innerHTML = "";
            (items || []).forEach(item => {
                const opt = document.createElement("option");
                if (typeof item === "object") {
                    opt.value = item.value ?? item.label ?? item;
                    opt.textContent = item.label ?? item.value ?? item;
                } else {
                    opt.value = opt.textContent = String(item);
                }
                el.appendChild(opt);
            });
            el.value = cur;
        },

        // 選択インデックス
        getSelectedIndex(name) {
            const el = _getEl(name);
            return el ? el.selectedIndex : -1;
        },
        setSelectedIndex(name, idx) {
            const el = _getEl(name);
            if (el) el.selectedIndex = idx;
        },

        // image の src
        setSrc(name, src) {
            const el = _getEl(name);
            if (el && el.tagName.toLowerCase() === "img") el.src = src;
        },
        getSrc(name) {
            const el = _getEl(name);
            return (el && el.tagName.toLowerCase() === "img") ? el.src : null;
        },

        // テーブル（datagrid）にデータをセット
        setTableData(name, rows, options = {}) {
            const fn = global[`${name}_setData`];
            if (typeof fn === "function") fn(rows, options);
            else console.warn(`[vja.widget.setTableData] ${name}_setData が見つかりません`);
        },

        // フォーム内の全入力値を取得 { name: value, ... }
        getAllInputs() {
            const result = {};
            document.querySelectorAll("[data-name]").forEach(el => {
                const name = el.dataset.name;
                if (!name) return;
                const tag = el.tagName.toLowerCase();
                if (tag === "input") {
                    result[name] = (el.type === "checkbox" || el.type === "radio")
                        ? el.checked : el.value;
                } else if (tag === "select" || tag === "textarea") {
                    result[name] = el.value;
                }
            });
            return result;
        },

        // フォーム内の全入力値をセット
        setAllInputs(data) {
            Object.entries(data || {}).forEach(([name, value]) => {
                this.setValue(name, value);
            });
        },

        // treeView ノード操作
        getSelectedNode(name) {
            const el = _getEl(name);
            return el ? el.dataset.lastSelected ?? null : null;
        },
        expandAll(name) {
            const el = _getEl(name);
            if (!el) return;
            el.querySelectorAll("[data-children]").forEach(c => { c.style.display = "block"; });
            el.querySelectorAll(".tv-arrow").forEach(a => { a.textContent = "▼"; });
        },
        collapseAll(name) {
            const el = _getEl(name);
            if (!el) return;
            el.querySelectorAll("[data-children]").forEach(c => { c.style.display = "none"; });
            el.querySelectorAll(".tv-arrow").forEach(a => { a.textContent = "▶"; });
        },

        // progressBar 操作
        setProgress(name, value) { this.setValue(name, value); },
        getProgress(name) { return this.getValue(name); },
    };

    // ════════════════════════════════════════════════
    // vja.const.* — 定数管理
    // ════════════════════════════════════════════════
    vja.const = {
        _global: {},
        _form: {},

        // 初期化（デザイナーまたはコンパイル済みから呼ぶ）
        init(globalConsts, formConsts) {
            this._global = {};
            this._form = {};
            (globalConsts || []).forEach(c => { this._global[c.name] = c.value; });
            (formConsts || []).forEach(c => { this._form[c.name] = c.value; });
        },

        // 取得（フォーム定数優先、なければグローバル）
        get(key, defaultVal = null) {
            if (key in this._form) return this._form[key];
            if (key in this._global) return this._global[key];
            return defaultVal;
        },

        // グローバル定数のみ取得
        getGlobal(key, defaultVal = null) {
            return key in this._global ? this._global[key] : defaultVal;
        },

        // フォーム定数のみ取得
        getForm(key, defaultVal = null) {
            return key in this._form ? this._form[key] : defaultVal;
        },

        // 全定数を取得 { key: value }
        getAll() {
            return { ...this._global, ...this._form };
        },
    };

    // ════════════════════════════════════════════════
    // vja.form.* — 画面遷移・状態管理
    // ════════════════════════════════════════════════

    // 画面履歴スタック
    const _formHistory = [];   // { formName, inputs }
    const _formParams = {};   // 画面間パラメータ

    vja.form = {

        // 画面遷移（現在の入力を保存してから遷移）
        navigate(formName, options = {}) {
            const save = options.save !== false; // デフォルトtrue
            if (save) {
                const inputs = vja.widget.getAllInputs();
                _formHistory.push({ formName: document.title || "", inputs });
            }
            // RPC経由でBun側にフォーム切り替えを依頼
            if (vja.project?.navigate) {
                vja.project.navigate(formName);
            } else {
                console.warn("[vja.form.navigate] vja.project.navigate が未定義です");
            }
        },

        // 前の画面に戻る（入力内容を復元）
        async back() {
            const prev = _formHistory.pop();
            if (!prev) { console.warn("[vja.form.back] 履歴がありません"); return; }
            if (vja.project?.navigate) {
                await vja.project.navigate(prev.formName);
                // 少し待ってから復元（DOM更新後）
                setTimeout(() => vja.widget.setAllInputs(prev.inputs), 50);
            } else {
                console.warn("[vja.form.back] vja.project.navigate が未定義です");
            }
        },

        // 履歴をクリア
        clearHistory() { _formHistory.length = 0; },

        // 画面間パラメータ
        setParam(key, value) { _formParams[key] = value; },
        getParam(key, defaultVal = null) {
            return key in _formParams ? _formParams[key] : defaultVal;
        },
        clearParams() { Object.keys(_formParams).forEach(k => delete _formParams[k]); },
        getAllParams() { return { ..._formParams }; },

        // 現在の入力内容を保存
        saveInputs() { return vja.widget.getAllInputs(); },

        // 入力内容を復元
        restoreInputs(data) { vja.widget.setAllInputs(data); },
    };

    // ════════════════════════════════════════════════
    // vja.session.* — セッション永続化（RPC経由）
    // ════════════════════════════════════════════════
    const _SESSION_PATH = ".vja-session.json";

    vja.session = {
        _cache: null,

        async _load() {
            if (this._cache) return this._cache;
            try {
                const r = await vja.file.read(_SESSION_PATH);
                this._cache = r.ok && r.content ? JSON.parse(r.content) : {};
            } catch (e) { console.debug("[vja] session cache parse failed:", e); this._cache = {}; }
            return this._cache;
        },

        async _save() {
            await vja.file.write(_SESSION_PATH, JSON.stringify(this._cache || {}));
        },

        async set(key, value) {
            const data = await this._load();
            data[key] = value;
            await this._save();
        },

        async get(key, defaultVal = null) {
            const data = await this._load();
            return key in data ? data[key] : defaultVal;
        },

        async clear() {
            this._cache = {};
            await this._save();
        },
    };

    // ════════════════════════════════════════════════
    // vja.validate.* — バリデーション
    // ════════════════════════════════════════════════
    vja.validate = {

        required(value) {
            if (value === null || value === undefined) return false;
            return String(value).trim().length > 0;
        },

        isNumber(value) {
            return !isNaN(parseFloat(value)) && isFinite(value);
        },

        isInteger(value) {
            return Number.isInteger(Number(value));
        },

        minLength(value, min) {
            return String(value || "").length >= min;
        },

        maxLength(value, max) {
            return String(value || "").length <= max;
        },

        isEmail(value) {
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
        },

        isDate(value) {
            return !isNaN(Date.parse(String(value || "")));
        },

        matches(value, pattern) {
            return new RegExp(pattern).test(String(value || ""));
        },

        // まとめてバリデーション
        // rules: { widgetName: { required, maxLength, ... } }
        // 戻り値: { valid: bool, errors: { widgetName: message } }
        check(rules) {
            const errors = {};
            Object.entries(rules || {}).forEach(([name, rule]) => {
                const val = vja.widget.getValue(name);
                if (rule.required && !this.required(val)) {
                    errors[name] = rule.requiredMsg || `${name}は必須です`;
                } else if (rule.maxLength && !this.maxLength(val, rule.maxLength)) {
                    errors[name] = rule.maxLengthMsg || `${name}は${rule.maxLength}文字以内で入力してください`;
                } else if (rule.minLength && !this.minLength(val, rule.minLength)) {
                    errors[name] = rule.minLengthMsg || `${name}は${rule.minLength}文字以上で入力してください`;
                } else if (rule.isNumber && !this.isNumber(val)) {
                    errors[name] = rule.isNumberMsg || `${name}は数値で入力してください`;
                } else if (rule.isEmail && !this.isEmail(val)) {
                    errors[name] = rule.isEmailMsg || `${name}はメールアドレス形式で入力してください`;
                }
            });
            return { valid: Object.keys(errors).length === 0, errors };
        },
    };

    // ════════════════════════════════════════════════
    // vja.util.* — ユーティリティ
    // ════════════════════════════════════════════════
    vja.util = {

        // 現在日時
        now() { return new Date(); },
        nowIso() { return new Date().toISOString(); },
        today() { return new Date().toISOString().slice(0, 10); },

        // 日付フォーマット
        formatDate(date, format = "YYYY-MM-DD") {
            const d = date instanceof Date ? date : new Date(date);
            return format
                .replace("YYYY", d.getFullYear())
                .replace("MM", String(d.getMonth() + 1).padStart(2, "0"))
                .replace("DD", String(d.getDate()).padStart(2, "0"))
                .replace("HH", String(d.getHours()).padStart(2, "0"))
                .replace("mm", String(d.getMinutes()).padStart(2, "0"))
                .replace("ss", String(d.getSeconds()).padStart(2, "0"));
        },

        // UUID生成
        uuid() {
            return crypto.randomUUID
                ? crypto.randomUUID()
                : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
                    const r = Math.random() * 16 | 0;
                    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
                });
        },

        // クリップボード
        async copyToClipboard(text) {
            try {
                await navigator.clipboard.writeText(String(text));
                return true;
            } catch (e) { console.debug("[vja] validation error:", e); return false; }
        },
        async readClipboard() {
            try { return await navigator.clipboard.readText(); }
            catch (e) { console.debug("[vja] error:", e); return null; }
        },

        // 数値フォーマット
        formatNumber(n, decimals = 0) {
            return Number(n).toLocaleString("ja-JP", {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
            });
        },

        // sleep
        sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
    };

    // ════════════════════════════════════════════════
    // vja.io.* — ファイル選択・CSV/JSON入出力
    // ════════════════════════════════════════════════
    // ファイル選択のデフォルト実装（global.bunOpenFile経由）
    // project-bridge.ts で差し替えることでRPC経由になる
    vja._openFile = function (filter) {
        if (!global.bunOpenFile) return Promise.reject(new Error("bunOpenFile未定義"));
        return global.bunOpenFile({ filter, lastPath: null });
    };

    vja.io = {

        // ファイル選択ダイアログ（差し替え可能な内部関数に委譲）
        // project-bridge.ts側で vja._openFile を上書きすることでRPC経由に切り替わる
        openFile(filter = "vjaproj") {
            return vja._openFile(filter);
        },

        // CSVファイルを選択して読み込み → 行列の配列を返す
        async openCsv() {
            const result = await this.openFile("*");
            if (!result?.content) return null;
            return this._parseCsv(result.content);
        },

        // JSONファイルを選択して読み込み
        async openJson() {
            const result = await this.openFile("*");
            if (!result?.content) return null;
            try { return JSON.parse(result.content); }
            catch (e) { throw new Error("JSONの解析に失敗しました: " + e.message); }
        },

        // CSV文字列をパース → [{ col1: val, col2: val }, ...]
        _parseCsv(text, hasHeader = true) {
            const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
                .filter(l => l.trim());
            if (lines.length === 0) return [];
            const parse = line => {
                const result = []; let cur = ""; let inQ = false;
                for (let i = 0; i < line.length; i++) {
                    const c = line[i];
                    if (c === '"') { inQ = !inQ; }
                    else if (c === "," && !inQ) { result.push(cur); cur = ""; }
                    else { cur += c; }
                }
                result.push(cur);
                return result.map(v => v.trim().replace(/^"|"$/g, ""));
            };
            if (!hasHeader) return lines.map(parse);
            const headers = parse(lines[0]);
            return lines.slice(1).map(line => {
                const vals = parse(line);
                const row = {};
                headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
                return row;
            });
        },

        // CSV保存（ダウンロード）
        // rows: [{ key: value }, ...] または [[val, val, ...], ...]
        saveCsv(rows, filename = "export.csv", headers = null) {
            const toLine = arr => arr.map(v => {
                const s = String(v ?? "");
                return s.includes(",") || s.includes('"') || s.includes("\n")
                    ? `"${s.replace(/"/g, '""')}"` : s;
            }).join(",");

            let csv = "";
            if (rows.length === 0) { csv = ""; }
            else if (Array.isArray(rows[0])) {
                if (headers) csv = toLine(headers) + "\n";
                csv += rows.map(toLine).join("\n");
            } else {
                const keys = headers || Object.keys(rows[0]);
                csv = toLine(keys) + "\n";
                csv += rows.map(r => toLine(keys.map(k => r[k] ?? ""))).join("\n");
            }
            this._download(csv, filename, "text/csv;charset=utf-8;");
        },

        // JSON保存（ダウンロード）
        saveJson(data, filename = "export.json") {
            const json = JSON.stringify(data, null, 2);
            this._download(json, filename, "application/json");
        },

        // テキスト保存（ダウンロード）
        saveText(text, filename = "export.txt") {
            this._download(text, filename, "text/plain;charset=utf-8;");
        },

        // ダウンロード共通処理
        _download(content, filename, mimeType) {
            const bom = mimeType.includes("csv") ? "\uFEFF" : "";
            const blob = new Blob([bom + content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
        },

        // 印刷
        print() { global.print(); },
        printElement(name) {
            const el = document.querySelector(`[data-name="${name}"]`);
            if (!el) return;
            const w = global.open("", "_blank");
            w.document.write(`<html><body>${el.outerHTML}</body></html>`);
            w.document.close();
            w.print();
            w.close();
        },
    };

    // ════════════════════════════════════════════════
    // vja.notify.* — 通知
    // ════════════════════════════════════════════════
    vja.notify = {

        // トースト通知
        toast(message, duration = 2500) {
            if (typeof global.showToast === "function") {
                global.showToast(message, duration);
                return;
            }
            // フォールバック: 自前実装
            let el = document.getElementById("_vja_toast");
            if (!el) {
                el = document.createElement("div");
                el.id = "_vja_toast";
                el.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);"
                    + "background:#333;color:#fff;padding:8px 20px;border-radius:20px;"
                    + "font-size:13px;z-index:99999;opacity:0;transition:opacity .3s;pointer-events:none";
                document.body.appendChild(el);
            }
            el.textContent = message;
            el.style.opacity = "1";
            clearTimeout(el._t);
            el._t = setTimeout(() => { el.style.opacity = "0"; }, duration);
        },
    };

    // ════════════════════════════════════════════════
    // vja.http.* — 外部API通信
    // ════════════════════════════════════════════════
    vja.http = {

        async get(url, headers = {}) {
            const res = await vja.fetch(url, { method: "GET", headers });
            if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
            const ct = res.headers["content-type"] || "";
            return ct.includes("application/json") ? res.json() : res.text();
        },

        async post(url, body, headers = {}) {
            const isJson = typeof body === "object" && !(body instanceof FormData);
            const res = await vja.fetch(url, {
                method: "POST",
                headers: {
                    ...(isJson ? { "Content-Type": "application/json" } : {}),
                    ...headers,
                },
                body: isJson ? JSON.stringify(body) : body,
            });
            if (!res.ok) throw new Error(`POST ${url} → HTTP ${res.status}`);
            const ct = res.headers["content-type"] || "";
            return ct.includes("application/json") ? res.json() : res.text();
        },

        async put(url, body, headers = {}) {
            const isJson = typeof body === "object";
            const res = await vja.fetch(url, {
                method: "PUT",
                headers: { ...(isJson ? { "Content-Type": "application/json" } : {}), ...headers },
                body: isJson ? JSON.stringify(body) : body,
            });
            if (!res.ok) throw new Error(`PUT ${url} → HTTP ${res.status}`);
            const ct = res.headers["content-type"] || "";
            return ct.includes("application/json") ? res.json() : res.text();
        },

        async delete(url, headers = {}) {
            const res = await vja.fetch(url, { method: "DELETE", headers });
            if (!res.ok) throw new Error(`DELETE ${url} → HTTP ${res.status}`);
            return res.ok;
        },
    };

    // ════════════════════════════════════════════════
    // vja.ui.* — UI操作
    // ════════════════════════════════════════════════
    vja.ui = {

        // ローディング表示
        loading(show, message = "処理中…") {
            let el = document.getElementById("_vja_loading");
            if (show) {
                if (!el) {
                    el = document.createElement("div");
                    el.id = "_vja_loading";
                    el.style.cssText = "position:fixed;inset:0;background:#0006;z-index:99998;"
                        + "display:flex;align-items:center;justify-content:center";
                    el.innerHTML = `<div style="background:#252535;color:#e0e0f0;padding:20px 32px;`
                        + `border-radius:8px;font-size:14px;border:1px solid #4a4a6a">`
                        + `⏳ ${message}</div>`;
                    document.body.appendChild(el);
                } else {
                    el.querySelector("div").textContent = "⏳ " + message;
                    el.style.display = "flex";
                }
            } else {
                if (el) el.style.display = "none";
            }
        },
    };

    // ════════════════════════════════════════════════
    // vja.crypto.* — 暗号化（Web Crypto API）
    // ════════════════════════════════════════════════
    vja.crypto = {

        // AES-GCM 暗号化 → Base64文字列
        async encrypt(text, key) {
            const k = await this._importKey(key);
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const enc = new TextEncoder();
            const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, enc.encode(text));
            const buf = new Uint8Array(iv.length + data.byteLength);
            buf.set(iv); buf.set(new Uint8Array(data), iv.length);
            return btoa(String.fromCharCode(...buf));
        },

        // AES-GCM 復号化
        async decrypt(b64, key) {
            const k = await this._importKey(key);
            const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const iv = buf.slice(0, 12);
            const data = buf.slice(12);
            const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k, data);
            return new TextDecoder().decode(dec);
        },

        // キーをインポート（文字列→CryptoKey）
        async _importKey(keyStr) {
            const raw = new TextEncoder().encode(keyStr.padEnd(32, "0").slice(0, 32));
            return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
        },
    };

    // ════════════════════════════════════════════════
    // vja.cloud.* — クラウドインフラ連携
    // ════════════════════════════════════════════════
    vja.cloud = {

        // 有効なインフラのSDKを読み込む（onStartで呼ぶ）
        async loadAll() {
            const infras = await this.list();
            for (const inf of infras.filter(i => i.enabled && i.sdkUrl)) {
                await vja.app.loadScript(inf.sdkUrl).catch(e =>
                    console.warn("[vja.cloud] SDK load failed:", inf.name, e)
                );
            }
        },

        // 登録済みインフラ一覧を取得（クレデンシャルはマスク済み）
        async list() {
            return new Promise(resolve => {
                const handler = ({ infras }) => { resolve(infras); };
                vja._rpc?.on?.("getCloudInfrasResult", handler);
                vja._rpc?.send?.getCloudInfrasRequest?.({});
                setTimeout(() => resolve([]), 3000);
            });
        },

        // 指定インフラのクレデンシャル値を取得（Bun側で復号）
        async getCredential(infraId, key) {
            return new Promise((resolve, reject) => {
                const handler = ({ ok, value }) => {
                    ok ? resolve(value) : reject(new Error("credential not found"));
                };
                vja._rpc?.on?.("getDecryptedCredentialResult", handler);
                vja._rpc?.send?.getDecryptedCredentialRequest?.({ infraId, key });
                setTimeout(() => reject(new Error("timeout")), 5000);
            });
        },
    };

    // ════════════════════════════════════════════════
    // getCloudInfraCredential(infra, service?)
    // vja側クレデンシャル（最優先）+ アプリ側入力を統合して返す
    // 戻り値: { KEY: "value", ... } または null
    // ════════════════════════════════════════════════
    vja.getCloudInfraCredential = async function (infra, service) {
        // Bun側から復号済みインフラ一覧を取得
        const infras = await vja.cloud.list().catch(() => []);

        // infra名でフィルタ（大文字小文字無視）
        const matched = infras.filter(i =>
            i.enabled && i.infra?.toLowerCase() === infra?.toLowerCase()
        );
        if (matched.length === 0) return null;

        // service指定がある場合はそのサービスを優先
        let target = matched[0];
        if (service) {
            const svc = matched.find(i =>
                i.service?.toLowerCase() === service?.toLowerCase()
            );
            if (svc) target = svc;
        }

        // vja側クレデンシャルを構築
        // appInput=OFF かつ 値が空でないものを使用
        const result = {};
        const creds = target.credentials || {};
        const appInput = target.appInput || {};

        for (const [k, v] of Object.entries(creds)) {
            if (!appInput[k]) {
                // vja側定義が優先
                if (v) result[k] = v;
            }
        }

        // appInput=ON のキーはアプリ側入力ファイルから取得
        const appInputKeys = Object.entries(appInput)
            .filter(([k, v]) => v)
            .map(([k]) => k);

        if (appInputKeys.length > 0) {
            const appCreds = await _loadAppCredentials(infra);
            for (const k of appInputKeys) {
                if (appCreds && appCreds[k]) result[k] = appCreds[k];
            }
        }

        return Object.keys(result).length > 0 ? result : null;
    };

    // アプリ側入力ファイル（~/vja/credential.json or .yml/.yaml）を読み込む
    const _loadAppCredentials = async function (infra) {
        const home = await _getHomeDir();
        if (!home) return null;

        // json → yml → yaml の順で試みる
        const paths = [
            home + "/vja/credential.json",
            home + "/vja/credential.yml",
            home + "/vja/credential.yaml",
        ];

        let raw = null;
        for (const p of paths) {
            const exists = await vja.file.exists(p).catch(() => false);
            if (exists) {
                raw = await vja.file.read(p).catch(() => null);
                if (raw) { raw = { path: p, content: raw }; break; }
            }
        }
        if (!raw) return null;

        try {
            let data;
            if (raw.path.endsWith(".json")) {
                data = JSON.parse(raw.content);
            } else {
                // YAML: シンプルなパーサ（インデントベース）
                data = _parseSimpleYaml(raw.content);
            }
            // プロジェクト名のセクションを探す
            const projName = vja._projectName || "";
            const section = data[projName] || data["*"] || data;
            // infra名（小文字）のセクションを取得
            const infraSection = section[infra.toLowerCase()] || section[infra] || null;
            if (!infraSection) return null;
            // [{KEY: val}, ...] または {KEY: val} 形式に対応
            const result = {};
            if (Array.isArray(infraSection)) {
                for (const item of infraSection) {
                    Object.assign(result, item);
                }
            } else {
                Object.assign(result, infraSection);
            }
            return result;
        } catch (e) {
            console.error("[vja.cloud] credential file parse error:", e);
            return null;
        }
    };

    // ホームディレクトリを取得
    const _getHomeDir = async function () {
        try {
            const isWin = navigator.platform?.toLowerCase().includes("win");
            if (isWin) return await vja.session.get("__home__") || null;
            const r = await vja.file.read("/proc/self/environ").catch(() => null);
            if (r) {
                const match = r.split(" ").find(e => e.startsWith("HOME="));
                if (match) return match.slice(5);
            }
            return null;
        } catch { return null; }
    };

    // シンプルYAMLパーサ（ネスト・リスト対応）
    const _parseSimpleYaml = function (text) {
        const lines = text.split("\n");
        const root = {};
        const stack = [{ obj: root, indent: -1 }];
        let lastKey = null;
        let lastObj = root;

        for (const line of lines) {
            if (!line.trim() || line.trim().startsWith("#")) continue;
            const indent = line.search(/\S/);
            const trimmed = line.trim();

            // スタックを現在のインデントに合わせる
            while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
                stack.pop();
            }
            const parent = stack[stack.length - 1].obj;

            if (trimmed.startsWith("- ")) {
                // リスト要素
                const val = trimmed.slice(2).trim();
                const colonIdx = val.indexOf(":");
                if (colonIdx > 0) {
                    const k = val.slice(0, colonIdx).trim();
                    const v = val.slice(colonIdx + 1).trim();
                    if (!Array.isArray(parent[lastKey])) parent[lastKey] = [];
                    const item = {}; item[k] = v;
                    parent[lastKey].push(item);
                }
            } else {
                const colonIdx = trimmed.indexOf(":");
                if (colonIdx > 0) {
                    const k = trimmed.slice(0, colonIdx).trim();
                    const v = trimmed.slice(colonIdx + 1).trim();
                    if (v) {
                        parent[k] = v;
                    } else {
                        parent[k] = {};
                        stack.push({ obj: parent[k], indent });
                        lastKey = k;
                    }
                }
            }
        }
        return root;
    };

    // ════════════════════════════════════════════════
    // vja.app.loadScript — CDNスクリプト動的読み込み
    // ════════════════════════════════════════════════
    if (!vja.app) vja.app = {};
    const _origApp = vja.app;
    vja.app = {
        ..._origApp,
        loadScript(url) {
            return new Promise((resolve, reject) => {
                if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
                const s = document.createElement("script");
                s.src = url;
                s.onload = () => resolve();
                s.onerror = () => reject(new Error("Script load failed: " + url));
                document.head.appendChild(s);
            });
        },
    };

    // ════════════════════════════════════════════════
    // グローバルエラーハンドラ（AIコード向け）
    // ════════════════════════════════════════════════
    global._vjaRun = async function (fn) {
        try {
            await fn();
        } catch (e) {
            const msg = e?.message || String(e);
            console.error("[vja] イベントエラー:", msg, e);
            await vja.log?.error?.("イベントエラー: " + msg).catch(() => { });
            await vja.app?.showDialog?.("エラーが発生しました:\n" + msg).catch(
                () => alert("エラー: " + msg)
            );
        }
    };

    // ════════════════════════════════════════════════
    // アプリライフサイクルフック
    // ════════════════════════════════════════════════

    // 起動時イベント実行（vja-runtime ロード完了後に呼ばれる）
    global._vjaOnStart = async function (code) {
        if (!code || !code.trim()) return;
        try {
            const fn = new Function("vja", "return (async()=>{" + code + "})()");
            await fn(vja);
        } catch (e) {
            console.error("[vja] OnStartエラー:", e?.message || e);
        }
    };

    // 終了時イベント実行（beforeunload で呼ばれる）
    global._vjaOnExit = async function (code) {
        if (!code || !code.trim()) return;
        try {
            const fn = new Function("vja", "return (async()=>{" + code + "})()");
            await fn(vja);
        } catch (e) {
            console.error("[vja] OnExitエラー:", e?.message || e);
        }
    };

    // beforeunload フック登録
    window.addEventListener("beforeunload", (e) => {
        if (global._vjaOnExitCode) {
            _vjaOnExit(global._vjaOnExitCode);
        }
    });


    // ════════════════════════════════════════════════
    // vja.navigate — フォーム切り替え（RPC経由）
    // ════════════════════════════════════════════════
    vja.navigate = async function (formName) {
        try {
            const result = await vja.project.navigate(formName);
            if (!result.ok) {
                console.error("[vja] navigate error:", result.error);
            }
        } catch (e) {
            console.error("[vja] navigate failed:", e?.message || e);
        }
    };

    // ════════════════════════════════════════════════
    // vja ダイアログ共通実装
    // window.innerWidth/Height でビューポート中央に表示する
    // ════════════════════════════════════════════════

    let _dialogOkCallback = null;

    const _escHtml = (s) => String(s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const _showDialogRoot = (html) => {
        let root = document.getElementById("dialog-root");
        if (!root) return;
        root.style.left = "0";
        root.style.top = "0";
        root.style.width = window.innerWidth + "px";
        root.style.height = window.innerHeight + "px";
        root.innerHTML = html;
        root.classList.add("show");
    };

    const _hideDialogRoot = () => {
        const root = document.getElementById("dialog-root");
        if (root) { root.classList.remove("show"); root.innerHTML = ""; }
    };

    global.showVjaDialog = (msg, onOk) => {
        _dialogOkCallback = onOk || null;
        _showDialogRoot(
            "<div class='box'>" +
            "<div class='icon'>❓</div>" +
            "<p>" + _escHtml(msg) + "</p>" +
            "<div class='btns'>" +
            "<button class='btn-ok' onmousedown='window._onVjaDialogOk()'>OK</button>" +
            "<button onmousedown='window._onVjaDialogCancel()'>キャンセル</button>" +
            "</div></div>"
        );
    };

    global.showVjaAlert = (msg, onOk) => {
        _dialogOkCallback = onOk || null;
        _showDialogRoot(
            "<div class='box'>" +
            "<div class='icon'>ℹ️</div>" +
            "<p>" + _escHtml(msg) + "</p>" +
            "<div class='btns'>" +
            "<button class='btn-ok' onmousedown='window._onVjaDialogOk()'>OK</button>" +
            "</div></div>"
        );
    };

    global.showVjaPrompt = (msg, defaultVal, onDone) => {
        _dialogOkCallback = onDone || null;
        _showDialogRoot(
            "<div class='box'>" +
            "<div class='icon'>✏️</div>" +
            "<p>" + _escHtml(msg) + "</p>" +
            "<input id='vja-prompt-input' style='width:100%;box-sizing:border-box;background:#3a3a5a;border:1px solid #444466;border-radius:4px;color:#e0e0f0;padding:6px 10px;font-size:13px;outline:none' value='" + _escHtml(defaultVal || "") + "'>" +
            "<div class='btns'>" +
            "<button class='btn-ok' onmousedown='window._onVjaPromptOk()'>OK</button>" +
            "<button onmousedown='window._onVjaDialogCancel()'>キャンセル</button>" +
            "</div></div>"
        );
        requestAnimationFrame(() => {
            const inp = document.getElementById("vja-prompt-input");
            if (inp) { inp.focus(); inp.select(); }
        });
    };

    global._onVjaDialogOk = () => {
        _hideDialogRoot();
        const cb = _dialogOkCallback; _dialogOkCallback = null;
        if (cb) cb(true);
    };
    global._onVjaDialogCancel = () => {
        _hideDialogRoot();
        const cb = _dialogOkCallback; _dialogOkCallback = null;
        if (cb) cb(false);
    };
    global._onVjaPromptOk = () => {
        const val = document.getElementById("vja-prompt-input")?.value ?? null;
        _hideDialogRoot();
        const cb = _dialogOkCallback; _dialogOkCallback = null;
        if (cb) cb(val);
    };

    // プロジェクト名をグローバルに保持（credential.jsonのセクション特定に使用）
    vja._projectName = window._INIT_PARAMS?.PROJECT_NAME || "";

    console.log("[vja-runtime] loaded ✓");

    //{{ext_runtime}}

})(window);
