// src/bun/fs-rpc-handlers.test.ts
// ファイル/ディレクトリ操作RPCハンドラの純粋ロジックに対するユニットテスト。
// 実ファイルシステムへの読み書きが伴うため、テスト用の一時ディレクトリを
// 使い、テスト終了後に必ず削除する。
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
    fileReadHandler, fileWriteHandler, fileReadBytesHandler, fileWriteBytesHandler,
    fileExistsHandler, fileDeleteHandler, fileCopyHandler,
    dirCreateHandler, dirDeleteHandler, dirListHandler, dirExistsHandler,
} from "./fs-rpc-handlers";

let _dir: string;

beforeEach(() => {
    _dir = mkdtempSync(join(tmpdir(), "vja-fs-rpc-test-"));
});

afterEach(() => {
    rmSync(_dir, { recursive: true, force: true });
});

describe("file*Handler", () => {
    test("fileWriteHandler → fileReadHandler で書いた内容を読める", async () => {
        const path = join(_dir, "a.txt");
        const w = await fileWriteHandler({ path, content: "hello" });
        expect(w.ok).toBe(true);
        const r = await fileReadHandler({ path });
        expect(r).toEqual({ ok: true, content: "hello" });
    });

    test("fileReadHandler: 存在しないファイルはok:falseでerrorを含む", async () => {
        const res = await fileReadHandler({ path: join(_dir, "no-such-file.txt") });
        expect(res.ok).toBe(false);
        expect(res.content).toBeNull();
        expect(typeof res.error).toBe("string");
    });

    test("fileWriteBytesHandler → fileReadBytesHandler でバイト列を往復できる", async () => {
        const path = join(_dir, "b.bin");
        await fileWriteBytesHandler({ path, data: [1, 2, 3, 255] });
        const res = await fileReadBytesHandler({ path });
        expect(res.ok).toBe(true);
        expect(res.data).toEqual([1, 2, 3, 255]);
    });

    test("fileExistsHandler: 存在有無を正しく返す", async () => {
        const path = join(_dir, "c.txt");
        expect((await fileExistsHandler({ path })).value).toBe(false);
        writeFileSync(path, "x");
        expect((await fileExistsHandler({ path })).value).toBe(true);
    });

    test("fileDeleteHandler: 削除後はfileExistsHandlerがfalseを返す", async () => {
        const path = join(_dir, "d.txt");
        writeFileSync(path, "x");
        const res = await fileDeleteHandler({ path });
        expect(res.ok).toBe(true);
        expect(existsSync(path)).toBe(false);
    });

    test("fileCopyHandler: コピー先に同じ内容が作成される", async () => {
        const src = join(_dir, "src.txt");
        const dest = join(_dir, "dest.txt");
        writeFileSync(src, "copy-me");
        const res = await fileCopyHandler({ src, dest });
        expect(res.ok).toBe(true);
        expect(await fileReadHandler({ path: dest })).toEqual({ ok: true, content: "copy-me" });
    });
});

describe("dir*Handler", () => {
    test("dirCreateHandler → dirExistsHandler で作成を確認できる", async () => {
        const path = join(_dir, "sub", "nested");
        expect((await dirExistsHandler({ path })).value).toBe(false);
        const res = await dirCreateHandler({ path });
        expect(res.ok).toBe(true);
        expect((await dirExistsHandler({ path })).value).toBe(true);
    });

    test("dirListHandler: 作成したファイルの一覧が取得できる", async () => {
        writeFileSync(join(_dir, "x.txt"), "1");
        writeFileSync(join(_dir, "y.txt"), "2");
        const res = await dirListHandler({ path: _dir });
        expect(res.ok).toBe(true);
        expect(res.entries.sort()).toEqual(["x.txt", "y.txt"]);
    });

    test("dirDeleteHandler: 再帰的に削除できる（force指定なので存在しなくてもok:true）", async () => {
        const path = join(_dir, "to-delete");
        await dirCreateHandler({ path });
        writeFileSync(join(path, "f.txt"), "1");
        const res = await dirDeleteHandler({ path });
        expect(res.ok).toBe(true);
        expect(existsSync(path)).toBe(false);
    });
});
