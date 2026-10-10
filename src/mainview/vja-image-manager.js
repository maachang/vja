/* ═══════════════════════════════════════════
   vja-image-manager.js
   画像管理（プロジェクトに画像を登録し、名前で参照する）。
   【読み込み順序】vja-table-validation.js の後。
   【データ】getProjectData().images = [{ name, data: "data:image/...;base64,..." }]
     - image(picture)ウィジェットの src には画像名を保存する（resolveImageSrc、vja-defs.js）
     - 実行時は vja.image.get(名前) が data URI を返す（vja-runtime.js、Bun側が各フォームHTMLへ埋め込む）
   【依存】vja-defs.js, vja-modal.js（showModal/mhdrHTML/mfootHTML/pushUndo）

   AIメモ:
   - 画像は「見やすさ・装飾」用途のため、1枚あたり上限300KB・png/jpg/gif/webpのみ。
     大きな画像は外部URL（https）で扱う方針（vja.widget.set に URL を渡す）。
   - 保存・復元は snapshot()/applyProjectData()（vja-modal.js）、実行用データは
     _getProjectData()（vja-save.js）に images を含めている。新しい保存項目を足す時は
     この3か所を揃えること（定数と同じ経路）。
   ═══════════════════════════════════════════ */

const IMAGE_MAX_BYTES = 300 * 1024;
const IMAGE_MIME_OK = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// モーダルの作業用データ。保存で一度に反映する（キャンセルなら破棄）。
// rows: [{ name, data, orig }]  orig: 開いた時点の名前（新規追加は null）
const IMAGE_MODAL = { rows: [] };

// data URI のおおよそのバイト数（base64の本体から計算）
function _imageDataBytes(data) {
    const i = data.indexOf(",");
    const b64 = i >= 0 ? data.slice(i + 1) : data;
    return Math.floor(b64.length * 3 / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
}
function imageSizeLabel(data) {
    return (_imageDataBytes(data) / 1024).toFixed(1) + "KB";
}

// 全フォームのimage(picture)ウィジェットを返す
function _allPictureWidgets() {
    const list = [];
    (getProjectData().forms || []).forEach(f => {
        (f.widgets || []).forEach(w => { if (w.tag === "picture") list.push(w); });
    });
    return list;
}

// 重複しない画像名を作る（base, base2, base3...）
function _uniqueImageName(base, used) {
    if (!used.has(base)) return base;
    let n = 2;
    while (used.has(base + n)) n++;
    return base + n;
}

// 旧形式（imageウィジェットのsrcに直接data URIが入っている）を、画像管理への登録＋名前参照へ移す。
// 同じ画像データは1つにまとめる。何度呼んでも結果は変わらない（applyProjectDataから毎回呼ばれる）。
function migrateLegacyPictureSrc() {
    const images = getProjectData().images;
    const used = new Set(images.map(i => i.name));
    let seq = 0;
    _allPictureWidgets().forEach(w => {
        const src = w.props?.src;
        if (typeof src !== "string" || !src.startsWith("data:")) return;
        let im = images.find(i => i.data === src);
        if (!im) {
            do { seq++; } while (used.has("image" + seq));
            im = { name: "image" + seq, data: src };
            used.add(im.name);
            images.push(im);
        }
        w.props.src = im.name;
    });
}

function openImageManager() {
    IMAGE_MODAL.rows = (getProjectData().images || []).map(i => ({ name: i.name, data: i.data, orig: i.name }));
    renderImageModal();
}

function renderImageModal() {
    const tbody = IMAGE_MODAL.rows.length
        ? IMAGE_MODAL.rows.map((r, i) => render("im-tpl-row", {
            data: r.data,
            name: r.name,
            attrName: evtAttr("oninput", "imageMgrRename(" + i + ",this.value)"),
            size: imageSizeLabel(r.data),
            attrDel: evtAttr("onmousedown", "imageMgrDel(" + i + ")"),
        })).join("")
        : render("im-tpl-empty", {});
    showModal(render("im-tpl-modal", {
        header: mhdrHTML("🖼️ 画像管理"),
        infoText: "image（画像）ウィジェットや vja.image.get('名前') で使う画像を登録します。プロジェクトファイルに保存されます。"
            + "1枚あたり300KBまで（png / jpg / gif / webp）。大きな画像は、外部のURL（https）を vja.widget.set に渡してください。",
        tbody,
        attrAdd: evtAttr("onmousedown", "imageMgrAdd()"),
        footBtns: mfootHTML([{ label: "キャンセル", action: "closeModal()" }]),
        attrSave: evtAttr("onmousedown", "imageMgrSave()"),
    }));
}

function imageMgrRename(i, v) {
    if (IMAGE_MODAL.rows[i]) IMAGE_MODAL.rows[i].name = v;
}

function imageMgrDel(i) {
    IMAGE_MODAL.rows.splice(i, 1);
    renderImageModal();
}

// ファイルを選んで追加する（複数選択可）。上限・形式に合わないものは追加せず、まとめて知らせる
function imageMgrAdd() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.multiple = true;
    inp.accept = "image/png,image/jpeg,image/gif,image/webp";
    inp.onchange = async () => {
        const files = Array.from(inp.files || []);
        const rejected = [];
        for (const file of files) {
            if (!IMAGE_MIME_OK.includes(file.type)) { rejected.push(file.name + "（png / jpg / gif / webp 以外）"); continue; }
            if (file.size > IMAGE_MAX_BYTES) {
                rejected.push(file.name + "（" + (file.size / 1024).toFixed(1) + "KB。上限300KB）");
                continue;
            }
            const data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            }).catch(() => null);
            if (!data) { rejected.push(file.name + "（読み込みに失敗）"); continue; }
            const used = new Set(IMAGE_MODAL.rows.map(r => r.name));
            const base = file.name.replace(/\.[^.]+$/, "") || "image";
            IMAGE_MODAL.rows.push({ name: _uniqueImageName(base, used), data, orig: null });
        }
        renderImageModal();
        if (rejected.length) showVjaAlert("次の画像は追加できませんでした。\n" + rejected.join("\n"));
    };
    inp.click();
}

function imageMgrSave() {
    const rows = IMAGE_MODAL.rows.map(r => ({ ...r, name: r.name.trim() }));
    if (rows.some(r => !r.name)) { showVjaAlert("画像名が空の行があります"); return; }
    const dup = rows.map(r => r.name).find((n, i, a) => a.indexOf(n) !== i);
    if (dup) { showVjaAlert("画像名「" + dup + "」が重複しています"); return; }

    // 削除された画像（開いた時点の名前が、保存後の名前のどれとも一致しない）
    const keptOrig = new Set(rows.map(r => r.orig).filter(Boolean));
    const deleted = (getProjectData().images || []).map(i => i.name).filter(n => !keptOrig.has(n));
    const usedDeleted = deleted.filter(n => _allPictureWidgets().some(w => w.props?.src === n));
    const apply = () => {
        // 名前変更: imageウィジェットのsrcを新しい名前へ追従させる
        const renames = new Map(rows.filter(r => r.orig && r.orig !== r.name).map(r => [r.orig, r.name]));
        _allPictureWidgets().forEach(w => {
            const cur = w.props?.src;
            if (renames.has(cur)) w.props.src = renames.get(cur);
            else if (deleted.includes(cur)) w.props.src = "";
        });
        getProjectData().images = rows.map(r => ({ name: r.name, data: r.data }));
        showToast("画像を保存しました（" + rows.length + "件）");
        closeModal();
        refreshAll();
        pushUndo();
    };
    const hasRename = rows.some(r => r.orig && r.orig !== r.name);
    if (usedDeleted.length) {
        showVjaDialog("画像「" + usedDeleted.join("」「") + "」はimageウィジェットで使われています。削除すると、そのウィジェットの画像は空になります。保存しますか？", apply);
    } else if (hasRename) {
        showVjaDialog("画像名を変更しました。imageウィジェットの参照は自動で更新しますが、イベントのコードに書いた vja.image.get('旧名') は更新されません。保存しますか？", apply);
    } else {
        apply();
    }
}

Object.assign(window, {
    openImageManager, renderImageModal, imageSizeLabel, imageMgrRename, imageMgrDel, imageMgrAdd, imageMgrSave,
    migrateLegacyPictureSrc,
});
