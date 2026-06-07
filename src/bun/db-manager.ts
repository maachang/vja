// src/bun/db-manager.ts
// VJA プロジェクト用 SQLite DB管理ライブラリ
//
// 使い方:
//   import { initProjectDb, clearProjectDb } from "./db-manager";
//   await initProjectDb(dbDir, tables);

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, copyFileSync, rmSync } from "fs";
import { join } from "path";

// ── 型定義 ────────────────────────────────────────────
export interface TableColumn {
    name: string;
    type: string;
    notNull: boolean;
    pk: boolean;
    index: boolean;
    useDefault?: boolean;
    default?: string;
}

export interface TableDef {
    name: string;
    columns: TableColumn[];
    updatedAt?: string; // ISO文字列 テーブルの最終更新時刻
}

// schema.json の型
type SchemaRecord = Record<string, string>; // tableName → updatedAt

// ── DB インスタンスキャッシュ ─────────────────────────
let _db: Database | null = null;
let _dbPath = "";

const getDb = (dbPath: string): Database => {
    if (_db && _dbPath === dbPath) return _db;
    _db = new Database(dbPath);
    _db.run("PRAGMA journal_mode = WAL");
    _db.run("PRAGMA foreign_keys = ON");
    _dbPath = dbPath;
    return _db;
};

// ── DBクローズ ────────────────────────────────────────
export const closeProjectDb = (): void => {
    if (_db) {
        try { _db.close(); } catch {}
        _db = null;
        _dbPath = "";
    }
};

// ── メイン: DB初期化・マイグレーション ───────────────
// dbDir: プロジェクトの db/ ディレクトリパス
// tables: vjaのテーブル定義配列
export const initProjectDb = async (dbDir: string, tables: TableDef[]): Promise<void> => {
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

    const dbPath     = join(dbDir, "app.db");
    const schemaPath = join(dbDir, "schema.json");

    // schema.json を読み込む（なければ空）
    let schema: SchemaRecord = {};
    if (existsSync(schemaPath)) {
        try { schema = JSON.parse(await Bun.file(schemaPath).text()); } catch {}
    }

    for (const tbl of tables) {
        if (!tbl.name?.trim() || !tbl.columns?.length) continue;

        const tblUpdatedAt = tbl.updatedAt || "";
        const schemaUpdatedAt = schema[tbl.name] || "";

        // スキーマが変わっていない場合はスキップ
        if (tblUpdatedAt && schemaUpdatedAt && tblUpdatedAt <= schemaUpdatedAt) {
            // テーブルが存在しない場合のみ作成
            const db = getDb(dbPath);
            const exists = db.query(
                `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
            ).get(tbl.name);
            if (!exists) {
                _createTable(db, tbl);
                schema[tbl.name] = tblUpdatedAt || new Date().toISOString();
            }
            continue;
        }

        // スキーマが新しい → マイグレーション
        await _migrateTable(dbPath, dbDir, tbl);
        schema[tbl.name] = tblUpdatedAt || new Date().toISOString();
    }

    // schema.json を更新
    await Bun.write(schemaPath, JSON.stringify(schema, null, 2));
    console.log(`[db] 初期化完了: ${dbPath}`);
};

// ── テーブル作成 ──────────────────────────────────────
const _createTable = (db: Database, tbl: TableDef): void => {
    const ddl = _generateDDL(tbl);
    db.run(ddl);
    console.log(`[db] テーブル作成: ${tbl.name}`);
};

// ── マイグレーション ──────────────────────────────────
const _migrateTable = async (dbPath: string, dbDir: string, tbl: TableDef): Promise<void> => {
    const bakPath = join(dbDir, `app.db.${Date.now()}.bak`);

    // バックアップ作成（DBが存在する場合のみ）
    if (existsSync(dbPath)) {
        closeProjectDb(); // 一旦クローズ
        copyFileSync(dbPath, bakPath);
        console.log(`[db] バックアップ作成: ${bakPath}`);
    }

    try {
        const db = getDb(dbPath);
        const exists = db.query(
            `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        ).get(tbl.name);

        if (!exists) {
            // テーブルが存在しない → 新規作成
            _createTable(db, tbl);
        } else {
            // テーブルが存在する → マイグレーション
            await _alterTable(db, tbl);
        }

        // 成功時：バックアップを削除
        if (existsSync(bakPath)) {
            rmSync(bakPath);
            console.log(`[db] バックアップ削除: ${bakPath}`);
        }
    } catch (e: any) {
        console.error(`[db] マイグレーション失敗 (${tbl.name}):`, e.message);
        // 失敗時：DBを閉じてバックアップで復元
        closeProjectDb();
        if (existsSync(bakPath)) {
            try {
                copyFileSync(bakPath, dbPath);
                rmSync(bakPath);
                console.log(`[db] バックアップから復元: ${dbPath}`);
            } catch (re: any) {
                console.error(`[db] 復元失敗:`, re.message);
            }
        }
        throw e;
    }
};

// ── テーブル変更（共通カラムのみコピー） ─────────────
const _alterTable = async (db: Database, tbl: TableDef): Promise<void> => {
    const tmpName = `__vja_tmp_${tbl.name}_${Date.now()}`;

    // 1. 新スキーマで一時テーブルを作成
    const newDDL = _generateDDL(tbl, tmpName);
    db.run(newDDL);

    // 2. 既存テーブルのカラム一覧を取得
    const existingCols = (db.query(`PRAGMA table_info(${tbl.name})`).all() as any[])
        .map(r => r.name as string);

    // 3. 新テーブルのカラム一覧
    const newCols = tbl.columns.filter(c => c.name.trim()).map(c => c.name);

    // 4. 共通カラムのみ INSERT
    const commonCols = newCols.filter(c => existingCols.includes(c));
    if (commonCols.length > 0) {
        const colList = commonCols.join(", ");
        db.run(`INSERT INTO ${tmpName} (${colList}) SELECT ${colList} FROM ${tbl.name}`);
    }

    // 5. 旧テーブルを DROP → 一時テーブルをリネーム
    db.run(`DROP TABLE ${tbl.name}`);
    db.run(`ALTER TABLE ${tmpName} RENAME TO ${tbl.name}`);

    // 6. インデックス再作成
    const idxCols = tbl.columns.filter(c => c.index && !c.pk);
    for (const c of idxCols) {
        db.run(`CREATE INDEX IF NOT EXISTS idx_${tbl.name}_${c.name} ON ${tbl.name} (${c.name})`);
    }

    console.log(`[db] マイグレーション完了: ${tbl.name} (共通カラム: ${commonCols.join(", ") || "なし"})`);
};

// ── DDL生成 ──────────────────────────────────────────
// 型別デフォルト値
const _defaultValueForType = (type: string): string => {
    switch ((type || "TEXT").toUpperCase()) {
        case "INTEGER": return "0";
        case "REAL":    return "0.0";
        case "NUMERIC": return "0";
        case "BLOB":    return "''";
        default:        return "''";
    }
};

const _generateDDL = (tbl: TableDef, overrideName?: string): string => {
    const name = overrideName || tbl.name;
    const cols = tbl.columns.filter(c => c.name.trim());
    const pkCols = cols.filter(c => c.pk);

    const colDefs = cols.map(c => {
        let def = `  ${c.name} ${c.type}`;
        if (c.pk && pkCols.length === 1) def += " PRIMARY KEY";
        if (c.notNull && !c.pk)          def += " NOT NULL";
        if (c.useDefault) {
            const dv = (c.default !== undefined && c.default !== "")
                ? c.default
                : _defaultValueForType(c.type);
            def += ` DEFAULT ${dv}`;
        }
        return def;
    });

    if (pkCols.length > 1) {
        colDefs.push(`  PRIMARY KEY (${pkCols.map(c => c.name).join(", ")})`);
    }

    return `CREATE TABLE IF NOT EXISTS ${name} (\n${colDefs.join(",\n")}\n)`;
};

// ── DBクリア（app.db 削除） ───────────────────────────
export const clearProjectDb = (dbDir: string): void => {
    closeProjectDb();
    const dbPath     = join(dbDir, "app.db");
    const schemaPath = join(dbDir, "schema.json");
    try {
        if (existsSync(dbPath))     rmSync(dbPath);
        if (existsSync(schemaPath)) rmSync(schemaPath);
        console.log(`[db] DBクリア完了: ${dbDir}`);
    } catch (e: any) {
        console.error(`[db] DBクリア失敗:`, e.message);
        throw e;
    }
};

// ── プロジェクト用DB取得（外部から使用） ─────────────
export const getProjectDb = (dbDir: string): Database => {
    const dbPath = join(dbDir, "app.db");
    return getDb(dbPath);
};
