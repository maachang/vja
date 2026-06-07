// src/mainview/project-bridge.ts
// プロジェクト実行ウィンドウ用 RPC ブリッジ
// vja-runtime.js の後に読み込まれ、vja.* API を提供する

import { Electroview } from "electrobun/view";
import type { VjaRPCType } from "../shared/types";

type Resolver<T> = (v: T) => void;
type Rejecter = (e: Error) => void;
interface Pending<T> { resolve: Resolver<T>; reject: Rejecter; }

const pending = {
    log:          null as Pending<{ ok: boolean }> | null,
    appDialog:    null as Pending<{ ok: boolean; confirmed?: boolean }> | null,
    navigateForm: null as Pending<{ ok: boolean; error?: string }> | null,
    sessionGet:   null as Pending<{ ok: boolean; value: string | null }> | null,
    sessionSet:   null as Pending<{ ok: boolean }> | null,
};

const resolve = <K extends keyof typeof pending>(
    key: K,
    val: NonNullable<typeof pending[K]> extends Pending<infer T> ? T : never,
) => {
    const p = pending[key] as Pending<any> | null;
    if (p) { pending[key] = null; p.resolve(val); }
};

const mkPromise = <K extends keyof typeof pending, T>(
    key: K, send: () => void,
): Promise<T> => new Promise<T>((res, rej) => {
    pending[key] = { resolve: res as any, reject: rej } as any;
    send();
});

// ── RPC 定義 ──────────────────────────────────────────
const rpc = Electroview.defineRPC<VjaRPCType>({
    handlers: {
        requests: {},
        messages: {
            logResult:          (v: any) => resolve("log",          v),
            appDialogResult:    (v: any) => resolve("appDialog",    v),
            navigateFormResult: (v: any) => resolve("navigateForm", v),
            sessionGetResult:   (v: any) => resolve("sessionGet",   v),
            sessionSetResult:   (v: any) => resolve("sessionSet",   v),
        },
    },
});

const _ev = new Electroview({ rpc });
const s = _ev.rpc.send;
const w = window as any;

// ── vja.* API をプロジェクトウィンドウ用に上書き ─────
w.vja = w.vja || {};

// ログ
w.vja.log = {
    trace: (msg: string) => mkPromise("log", () => s.logRequest({ level: "trace", message: msg })),
    debug: (msg: string) => mkPromise("log", () => s.logRequest({ level: "debug", message: msg })),
    info:  (msg: string) => mkPromise("log", () => s.logRequest({ level: "info",  message: msg })),
    warn:  (msg: string) => mkPromise("log", () => s.logRequest({ level: "warn",  message: msg })),
    error: (msg: string) => mkPromise("log", () => s.logRequest({ level: "error", message: msg })),
    log:   (msg: string) => mkPromise("log", () => s.logRequest({ level: "log",   message: msg })),
};

// ダイアログ
w.vja.app = {
    showDialog:  (message: string) =>
        mkPromise("appDialog", () => s.appDialogRequest({ type: "alert",   message })),
    showConfirm: (message: string) =>
        mkPromise("appDialog", () => s.appDialogRequest({ type: "confirm", message })),
};

// フォーム切り替え（vja.navigate 経由）
w.vja.project = {
    navigate: (formName: string) =>
        mkPromise("navigateForm", () => s.navigateFormRequest({ formName })),
};

// セッション（RPC経由でBun側のメモリSessionを使用）
w.vja.session = {
    get: (key: string) =>
        mkPromise("sessionGet", () => s.sessionGetRequest({ key }))
            .then((r: any) => r.value),
    set: (key: string, value: string | null) =>
        mkPromise("sessionSet", () => s.sessionSetRequest({ key, value })),
    delete: (key: string) =>
        mkPromise("sessionSet", () => s.sessionSetRequest({ key, value: null })),
};

// bridge 読み込み完了後にキューを flush
if (typeof w._flushLogQueue === "function") {
    w._flushLogQueue();
}
