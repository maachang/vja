// src/bun/project-runner.test.ts
// アプリイベント（OnStart/OnExit）の実行環境（_runAppEventCode経由のvja.*）のユニットテスト。
// 【AIメモ】project-runner.tsは`electrobun/bun`をトップレベルでimportしており、そのままだとハングするため、
//   importの前に`mock.module`で空のスタブへ差し替える（import順を変えないこと。staticなimportにするとモックが間に合わない）。
//   ウィンドウ（実機の表示）に関わる部分は対象外。DBは実際のSQLiteを一時ディレクトリに作る。
import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

mock.module("electrobun/bun", () => ({
    BrowserWindow: class {},
    BrowserView: { defineRPC: () => ({}) },
    Utils: {},
}));
const runner = await import("./project-runner");
const { closeProjectDb, getProjectDb } = await import("./db-manager");

let _dir: string;
const tables = [{
    name: "items",
    columns: [
        { name: "id", type: "INTEGER", notNull: false, pk: true, index: false },
        { name: "name", type: "TEXT", notNull: false, pk: false, index: false },
    ],
}];
const setup = (onStartCode: string) => {
    runner.setProjectData({
        forms: [], tables: tables as any, name: "t", dbDir: join(_dir, "db"), extRuntime: "",
        cloudInfras: [], onStartCode, onExitCode: "", vjaPass: "",
    });
};
const rows = () => getProjectDb(join(_dir, "db")).query("SELECT id, name FROM items ORDER BY id").all() as any[];

beforeEach(() => {
    _dir = mkdtempSync(join(tmpdir(), "vja-project-runner-test-"));
    runner._session.clear();
});
afterEach(() => {
    closeProjectDb();
    rmSync(_dir, { recursive: true, force: true });
});

describe("アプリイベントのvja.db.importCsv / importJson", () => {
    test("importCsvでCSVファイルの内容がテーブルに入る", async () => {
        const csv = join(_dir, "items.csv");
        writeFileSync(csv, "id,name\r\n1,りんご\r\n2,みかん\r\n");
        setup(`await vja.db.importCsv('items', ${JSON.stringify(csv)});`);
        await runner.runOnStart();
        expect(rows()).toEqual([{ id: 1, name: "りんご" }, { id: 2, name: "みかん" }]);
    });

    test("importJsonでJSONファイルの内容がテーブルに入る", async () => {
        const json = join(_dir, "items.json");
        writeFileSync(json, JSON.stringify([{ id: 1, name: "りんご" }, { id: 2, name: "みかん" }]));
        setup(`await vja.db.importJson('items', ${JSON.stringify(json)});`);
        await runner.runOnStart();
        expect(rows()).toEqual([{ id: 1, name: "りんご" }, { id: 2, name: "みかん" }]);
    });

    test("存在しないファイルなら実行エラーとして記録され、runOnStart自体は落ちない", async () => {
        const err = spyOn(console, "error").mockImplementation(() => { });
        setup(`await vja.db.importCsv('items', ${JSON.stringify(join(_dir, "none.csv"))});`);
        await runner.runOnStart();
        expect(rows()).toEqual([]);
        expect(err.mock.calls.some((c) => String(c[0]).includes("onStart 実行エラー"))).toBe(true);
        err.mockRestore();
    });
});

describe("アプリイベントのvja.session.clear", () => {
    test("ユーザーのキーは消え、内部キー(__始まり)は残る", async () => {
        setup(`vja.session.set('a', '1'); vja.session.set('__mine', 'x'); vja.session.clear(); vja.session.set('after', vja.session.get('a') === null ? 'cleared' : 'kept');`);
        await runner.runOnStart();
        expect(runner._session.get("a")).toBeUndefined();
        expect(runner._session.get("after")).toBe("cleared");
        expect(runner._session.get("__mine")).toBe("x");
        expect(runner._session.get("__onStart_done__")).toBe("1");
    });

    test("OnStart内でsession.clearを呼んでも、runOnStartの二重実行防止が外れない", async () => {
        setup(`vja.db.execute("INSERT INTO items (name) VALUES ('x')"); vja.session.clear();`);
        await runner.runOnStart();
        await runner.runOnStart();
        expect(rows().length).toBe(1);
    });
});
