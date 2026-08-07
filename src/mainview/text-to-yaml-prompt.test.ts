import { describe, expect, it, beforeEach } from "bun:test";

describe("Text to YAML Prompt Generator Tests", () => {
    beforeEach(() => {
        // window._PROMPT_DEF の仮想セットアップ
        const globalAny = globalThis as any;
        if (!globalAny.window) globalAny.window = {};

        const widgetsCtx = "- txtUser (inputtype)\n- btnSearch (button)";
        const tablesCtx = "- users (id, name, email)";

        const ENG_TEXT_TO_YAML_SYS_PROMPT = function ({ widgetsCtx, tablesCtx }: { widgetsCtx: string; tablesCtx: string }) {
            return (`
You are an expert AI assistant for VJA (Visual JavaScript for AI).
Your task is to convert a user's natural language request (written in Japanese) describing what a form event should do into a clean, structured VJA Event Design YAML specification.

[Available Widgets Context]
${widgetsCtx || "(No widgets)"}

[Available Database Tables Context]
${tablesCtx || "(No DB tables)"}
`.trim() + "\n");
        };

        const ENG_TEXT_TO_YAML_USER_PROMPT = function (userReq: string) {
            return (
                "Based on the following natural language request, generate a structured VJA Event Design YAML specification:\n\n" +
                "[User Request]\n" + userReq.trim() + "\n\n" +
                "[CRITICAL] Output raw YAML only. Do NOT wrap in markdown code blocks (```yaml). No conversational text."
            );
        };

        globalAny.window._PROMPT_DEF = {
            TEXT_TO_YAML_SYS_PROMPT: ENG_TEXT_TO_YAML_SYS_PROMPT,
            TEXT_TO_YAML_USER_PROMPT: ENG_TEXT_TO_YAML_USER_PROMPT,
        };
    });

    it("自然言語からYAML生成用のシステムプロンプトが正しいコンテキストを含んで生成されること", () => {
        const globalAny = globalThis as any;
        const sysPromptFn = globalAny.window._PROMPT_DEF.TEXT_TO_YAML_SYS_PROMPT;
        const result = sysPromptFn({
            widgetsCtx: "- txtUser (inputtype)\n- btnSearch (button)",
            tablesCtx: "- users (id, name, email)"
        });

        expect(result).toContain("You are an expert AI assistant for VJA");
        expect(result).toContain("- txtUser (inputtype)");
        expect(result).toContain("- users (id, name, email)");
    });

    it("ユーザー要求プロンプトが正しくフォーマットされること", () => {
        const globalAny = globalThis as any;
        const userPromptFn = globalAny.window._PROMPT_DEF.TEXT_TO_YAML_USER_PROMPT;
        const result = userPromptFn("ユーザー名で検索したい");

        expect(result).toContain("[User Request]\nユーザー名で検索したい");
        expect(result).toContain("[CRITICAL] Output raw YAML only.");
    });
});
