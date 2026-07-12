// src/bun/db-manager.test.ts
// backupProjectDb / restoreProjectDb のユニットテスト。
// 実際にSQLiteファイルを一時ディレクトリに作成して検証する。
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Database } from "bun:sqlite";
import {
    initProjectDb, closeProjectDb, getProjectDb,
    backupProjectDb, restoreProjectDb,
} from "./db-manager";

let _dir: string;

beforeEach(() => {
    _dir = mkdtempSync(join(tmpdir(), "vja-db-manager-test-"));
});

afterEach(() => {
    closeProjectDb();
    rmSync(_dir, { recursive: true, force: true });
});

describe("backupProjectDb / restoreProjectDb", () => {
    test("バックアップ後にデータを変更しても、復元すればバックアップ時点の内容に戻る", async () => {
        await initProjectDb(_dir, [{
            name: "users",
            columns: [{ name: "id", type: "INTEGER", notNull: false, pk: true, index: false }],
        }]);
        const db1 = getProjectDb(_dir);
        db1.run("INSERT INTO users (id) VALUES (1)");

        const backupPath = join(_dir, "backup.db");
        backupProjectDb(_dir, backupPath);
        expect(existsSync(backupPath)).toBe(true);

        // バックアップ後にさらにデータを追加
        const db2 = getProjectDb(_dir);
        db2.run("INSERT INTO users (id) VALUES (2)");
        expect((getProjectDb(_dir).query("SELECT * FROM users").all() as any[]).length).toBe(2);

        restoreProjectDb(_dir, backupPath);

        const rows = getProjectDb(_dir).query("SELECT * FROM users ORDER BY id").all() as any[];
        expect(rows).toEqual([{ id: 1 }]);
    });

    test("backupProjectDb: DBが存在しない場合は例外を投げる", () => {
        expect(() => backupProjectDb(_dir, join(_dir, "backup.db"))).toThrow();
    });

    test("restoreProjectDb: 復元元ファイルが存在しない場合は例外を投げる", () => {
        expect(() => restoreProjectDb(_dir, join(_dir, "no-such-backup.db"))).toThrow();
    });

    test("restoreProjectDb: dbDirが存在しなくても復元先ディレクトリを作成する", async () => {
        // 別の場所でバックアップファイルを用意する
        const srcDir = mkdtempSync(join(tmpdir(), "vja-db-manager-src-"));
        const srcDb = new Database(join(srcDir, "src.db"));
        srcDb.run("CREATE TABLE t (id INTEGER)");
        srcDb.run("INSERT INTO t (id) VALUES (42)");
        srcDb.close();

        const newDir = join(_dir, "not-yet-created");
        restoreProjectDb(newDir, join(srcDir, "src.db"));

        expect(existsSync(join(newDir, "app.db"))).toBe(true);
        const rows = getProjectDb(newDir).query("SELECT * FROM t").all() as any[];
        expect(rows).toEqual([{ id: 42 }]);

        rmSync(srcDir, { recursive: true, force: true });
    });
});
