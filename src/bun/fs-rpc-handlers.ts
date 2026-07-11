// src/bun/fs-rpc-handlers.ts
// ファイル/ディレクトリ操作RPCハンドラの共通実装。
//
// 【重要】ここに置くのは「デザイナー実行中でもプロジェクト実行中でも
// 処理内容が変わらない、純粋な処理」だけに限定すること。dbQuery等、
// 呼び出し元のモード（デザイナー本体 or 実行中プロジェクト）によって
// 対象が変わる処理（例: どのSQLiteインスタンスを見るか）はここに含めない
// （含めると条件分岐が増えて可読性・安全性が下がるため、そちらは
// src/bun/index.ts と src/bun/project-runner.ts にあえて別々に実装している）。
//
// 【依存関係】
// - src/bun/index.ts（デザイナー本体のRPC）と
//   src/bun/project-runner.ts（プロジェクト実行時のRPC。デザイナーからの
//   実行時・コンパイル後のスタンドアロン実行の両方で使われる）の双方から
//   requestsハンドラとしてそのまま登録される。
// - このファイル自体もcopy-compile-assets.tsのCOPY_BUILD_FILESで
//   コンパイル済みプロジェクトにコピーされるため、追加・変更した場合は
//   COPY_BUILD_FILESへの追記漏れがないか確認すること。
import { existsSync, readdirSync, rmSync, copyFileSync, mkdirSync } from "fs";

export const fileReadHandler = async ({ path }: { path: string }) => {
    try {
        const content = await Bun.file(path).text();
        return { ok: true, content };
    } catch (e: any) {
        return { ok: false, content: null, error: e.message };
    }
};

export const fileWriteHandler = async ({ path, content }: { path: string; content: string }) => {
    try {
        await Bun.write(path, content);
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};

export const fileReadBytesHandler = async ({ path }: { path: string }) => {
    try {
        const buf = await Bun.file(path).arrayBuffer();
        const data = Array.from(new Uint8Array(buf));
        return { ok: true, data };
    } catch (e: any) {
        return { ok: false, data: null, error: e.message };
    }
};

export const fileWriteBytesHandler = async ({ path, data }: { path: string; data: number[] }) => {
    try {
        await Bun.write(path, new Uint8Array(data));
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};

export const fileExistsHandler = async ({ path }: { path: string }) => {
    return { ok: true, value: existsSync(path) };
};

export const fileDeleteHandler = async ({ path }: { path: string }) => {
    try {
        rmSync(path);
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};

export const fileCopyHandler = async ({ src, dest }: { src: string; dest: string }) => {
    try {
        copyFileSync(src, dest);
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};

export const dirCreateHandler = async ({ path }: { path: string }) => {
    try {
        mkdirSync(path, { recursive: true });
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};

export const dirDeleteHandler = async ({ path }: { path: string }) => {
    try {
        rmSync(path, { recursive: true, force: true });
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};

export const dirListHandler = async ({ path }: { path: string }) => {
    try {
        const entries = readdirSync(path).map(String);
        return { ok: true, entries };
    } catch (e: any) {
        return { ok: false, entries: [], error: e.message };
    }
};

export const dirExistsHandler = async ({ path }: { path: string }) => {
    return { ok: true, value: existsSync(path) };
};
