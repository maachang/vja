import { describe, expect, it, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("Form Design Templates Tests", () => {
    beforeAll(() => {
        // global window object
        (globalThis as any).window = globalThis;
        const code = readFileSync(join(import.meta.dir, "form-design-templates.js"), "utf-8");
        eval(code);
    });

    it("テンプレートオプション一覧を取得できること", () => {
        const getFormDesignTemplateOptions = (globalThis as any).getFormDesignTemplateOptions;
        expect(typeof getFormDesignTemplateOptions).toBe("function");
        const options = getFormDesignTemplateOptions();
        expect(Array.isArray(options)).toBe(true);
        expect(options.length).toBeGreaterThanOrEqual(6);
        expect(options[0]).toHaveProperty("value");
        expect(options[0]).toHaveProperty("label");
    });

    it("指定したIDのテンプレートYAMLを取得できること", () => {
        const getFormDesignTemplateYaml = (globalThis as any).getFormDesignTemplateYaml;
        expect(typeof getFormDesignTemplateYaml).toBe("function");
        const searchYaml = getFormDesignTemplateYaml("search");
        expect(searchYaml).toContain("検索一覧画面定義");
        expect(searchYaml).toContain("パターン: 検索一覧画面");

        const masterYaml = getFormDesignTemplateYaml("master");
        expect(masterYaml).toContain("マスタ保守画面定義");
        expect(masterYaml).toContain("新規作成ボタン");

        const unknownYaml = getFormDesignTemplateYaml("non_existent_id");
        expect(unknownYaml).toBe("");
    });
});
