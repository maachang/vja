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
    backupProjectDb, restoreProjectDb, importCsvText, importJsonData,
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

describe("importCsvText / importJsonData", () => {
    const itemsTable = [{
        name: "items",
        columns: [
            { name: "id", type: "INTEGER", notNull: false, pk: true, index: false },
            { name: "name", type: "TEXT", notNull: false, pk: false, index: false },
        ],
    }];
    const rows = () => getProjectDb(_dir).query("SELECT id, name FROM items ORDER BY id").all() as any[];

    test("CSV: 1行目を列名として全件登録される（引用符・カンマ入りの値も扱える）", async () => {
        await initProjectDb(_dir, itemsTable);
        importCsvText(_dir, "items", 'id,name\n1,りんご\n2,"みかん,甘い"\n');
        expect(rows()).toEqual([{ id: 1, name: "りんご" }, { id: 2, name: "みかん,甘い" }]);
    });

    test("CSV: CRLFでも最終列に\\rが残らない", async () => {
        await initProjectDb(_dir, itemsTable);
        importCsvText(_dir, "items", "id,name\r\n1,りんご\r\n2,みかん\r\n");
        expect(rows()).toEqual([{ id: 1, name: "りんご" }, { id: 2, name: "みかん" }]);
    });

    test("CSV: ヘッダーのみ・空なら何も登録しない", async () => {
        await initProjectDb(_dir, itemsTable);
        importCsvText(_dir, "items", "id,name\n");
        importCsvText(_dir, "items", "");
        expect(rows()).toEqual([]);
    });

    test("JSON: オブジェクト配列が登録され、無いキーはNULLになる", async () => {
        await initProjectDb(_dir, itemsTable);
        importJsonData(_dir, "items", [{ id: 1, name: "りんご" }, { id: 2 }]);
        expect(rows()).toEqual([{ id: 1, name: "りんご" }, { id: 2, name: null }]);
    });

    test("JSON: 配列でない・空配列なら何も登録しない", async () => {
        await initProjectDb(_dir, itemsTable);
        importJsonData(_dir, "items", { id: 1 });
        importJsonData(_dir, "items", []);
        expect(rows()).toEqual([]);
    });

    test("途中で失敗したら全件がロールバックされる（主キー重複）", async () => {
        await initProjectDb(_dir, itemsTable);
        expect(() => importCsvText(_dir, "items", "id,name\n1,a\n1,b\n")).toThrow();
        expect(rows()).toEqual([]);
    });
});
