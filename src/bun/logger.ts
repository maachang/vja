// src/bun/logger.ts
// VJA ローカルログ出力ライブラリ
//
// 使い方:
//   import { initLogger, writeLog } from "./logger";
//   initLogger({ dir: process.cwd() + "/logs", level: "info" });
//   console.log("hello");  // ターミナル + ファイル両方に出力される

import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";

// ── ログレベル定義 ────────────────────────────────────
const LOG_LEVELS: Record<string, number> = {
    trace: 1,
    debug: 2,
    info: 3,
    warn: 4,
    error: 5,
    log: 99,
};

// ── 内部状態 ─────────────────────────────────────────
let _logDir: string = join(process.cwd(), "logs");
let _logLevel: number = LOG_LEVELS.info;
let _initialized: boolean = false;

// ── 初期化オプション ──────────────────────────────────
interface LoggerOptions {
    // ログ出力ディレクトリ（デフォルト: process.cwd()/logs）
    dir?: string;
    // ログレベル: "trace"|"debug"|"info"|"warn"|"error"（デフォルト: "info"）
    level?: string;
}

// ── 初期化 ────────────────────────────────────────────
// アプリ起動時に1回呼ぶ。console を上書きして全ログをファイルに流す。
export const initLogger = (options: LoggerOptions = {}): void => {
    if (_initialized) return;
    _initialized = true;

    // 出力ディレクトリ
    if (options.dir) _logDir = options.dir;

    // ログレベル
    if (options.level) {
        const lv = LOG_LEVELS[options.level.toLowerCase().trim()];
        if (lv !== undefined) _logLevel = lv;
    }

    // ディレクトリ作成
    if (!existsSync(_logDir)) mkdirSync(_logDir, { recursive: true });

    // console を上書き（全レベルを _output に集約）
    (console as any).log = (...a: any[]) => _output("log", _fmtArgs(...a));
    (console as any).info = (...a: any[]) => _output("info", _fmtArgs(...a));
    (console as any).warn = (...a: any[]) => _output("warn", _fmtArgs(...a));
    (console as any).error = (...a: any[]) => _output("error", _fmtArgs(...a));
    (console as any).debug = (...a: any[]) => _output("debug", _fmtArgs(...a));
    (console as any).trace = (...a: any[]) => _output("trace", _fmtArgs(...a));
};

// ── 公開API: writeLog ─────────────────────────────────
// logRequest など外部から直接呼ぶ場合に使う
export const writeLog = (level: string, message: string): void =>
    _output(level, message);

// ── 内部: 日付文字列生成 ──────────────────────────────
const _logDate = (): { ymd: string; ymdhms: string } => {
    const now = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    const p3 = (n: number) => String(n).padStart(3, "0");
    const ymd = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
    const ymdhms = `${ymd} ${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}.${p3(now.getMilliseconds())}`;
    return { ymd, ymdhms };
};

// ── 内部: 引数を文字列化 ──────────────────────────────
const _fmtArgs = (...args: any[]): string =>
    args.map(a => {
        if (a === null) return "null";
        if (a === undefined) return "undefined";
        if (typeof a === "object") {
            try { return JSON.stringify(a); } catch { return String(a); }
        }
        return String(a);
    }).join(" ");

// ── 内部: ファイルとターミナルを1箇所で処理 ──────────
// 見本コードの output() 相当。ここだけ触れば出力先を変更できる。
const _output = (level: string, message: string): void => {
    try {
        const lvNum = LOG_LEVELS[level.toLowerCase()] ?? LOG_LEVELS.log;
        const { ymd, ymdhms } = _logDate();
        const prefix = level.toLowerCase() === "log" ? "" : `[${level.toUpperCase()}] `;
        const line = `[${ymdhms}] ${prefix}${message}\n`;

        // ① ファイル出力（ログレベルを満たした場合のみ）
        if (lvNum >= _logLevel) {
            if (!existsSync(_logDir)) mkdirSync(_logDir, { recursive: true });
            appendFileSync(join(_logDir, `app.${ymd}.log`), line);
        }

        // ② ターミナル出力（常に・warn/error は stderr）
        if (level.toLowerCase() === "error" || level.toLowerCase() === "warn") {
            process.stderr.write(line);
        } else {
            process.stdout.write(line);
        }
    } catch (e) {
        process.stderr.write(`[logger ERROR] ${e}\n`);
    }
};
