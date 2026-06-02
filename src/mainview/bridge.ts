// src/mainview/bridge.ts
// Electrobun RPC ブリッジ（message ベース = タイムアウトなし）

import { Electroview } from "electrobun/view";

// ── コールバック待機マップ ──────────────────────────────
// message は fire-and-forget なので、結果は Bun→Webview の message で返ってくる
// それを Promise に変換して window.bunXxx として提供する
type Resolver<T> = (value: T) => void;
let _openResolve:  Resolver<{ content: string | null; path: string | null }> | null = null;
let _saveResolve:  Resolver<{ ok: boolean; path: string | null; cancelled: boolean }> | null = null;

const rpc = Electroview.defineRPC({
    handlers: {
        requests: {},
        messages: {
            // Bun から結果が送られてきたら待機中の Promise を resolve する
            openFileResult: ({ content, path }: { content: string | null; path: string | null }) => {
                _openResolve?.({ content, path });
                _openResolve = null;
            },
            saveFileResult: ({ ok, path, cancelled }: { ok: boolean; path: string | null; cancelled: boolean }) => {
                _saveResolve?.({ ok, path, cancelled });
                _saveResolve = null;
            },
        },
    },
});

const _ev = new Electroview({ rpc });

// ── window.bunXxx ブリッジ ────────────────────────────
const w = window as any;

// ファイルを開く
w.bunOpenFile = (args: { filter: string; lastPath?: string | null }): Promise<{ content: string | null; path: string | null }> => {
    return new Promise((resolve) => {
        _openResolve = resolve;
        _ev.rpc.send.openFileRequest({
            filter  : args.filter ?? "vjaproj",
            lastPath: args.lastPath ?? null,
        });
    });
};

// 保存（ダイアログ→書き込みまで Bun 側で完結、結果を message で受け取る）
w.bunSaveProject = (args: {
    content: string;
    defaultName: string;
    lastPath: string | null;
}): Promise<{ ok: boolean; path: string | null; cancelled: boolean }> => {
    return new Promise((resolve) => {
        _saveResolve = resolve;
        _ev.rpc.send.saveFileRequest({
            content    : args.content,
            defaultName: args.defaultName ?? "project.vjaproj",
            lastPath   : args.lastPath ?? null,
        });
    });
};

// アプリ終了
w.bunCloseApp = () => {
    _ev.rpc.send.closeAppRequest({});
};
