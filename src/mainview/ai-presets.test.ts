import { describe, test, expect, beforeEach } from "bun:test";

function setupMockEnv() {
    const projectData: any = {
        aiConfig: {
            endpoint: "http://localhost:8080",
            apiKey: "",
            model: "",
            models: [],
            enabled: false,
            routerMode: false,
            thinking: true,
            mockCheckEnabled: true,
        },
        aiPresets: [],
        currentAiPresetId: "",
    };
    (globalThis as any).getProjectData = () => projectData;
}

function _initAiPresets() {
    const p = (globalThis as any).getProjectData();
    if (!Array.isArray(p.aiPresets) || p.aiPresets.length === 0) {
        p.aiPresets = [
            {
                id: "preset-default-local",
                name: "ローカル (localhost:8080)",
                config: { endpoint: "http://localhost:8080", apiKey: "", routerMode: false, model: "" }
            },
            {
                id: "preset-default-openai",
                name: "OpenAI (gpt-4o-mini)",
                config: { endpoint: "https://api.openai.com", apiKey: "sk-test", routerMode: true, model: "gpt-4o-mini" }
            }
        ];
    }
    if (!p.currentAiPresetId) {
        p.currentAiPresetId = p.aiPresets[0]?.id || "preset-default-local";
    }
}

function aiCfgSelectPreset(presetId: string) {
    _initAiPresets();
    const p = (globalThis as any).getProjectData();
    const target = p.aiPresets.find((item: any) => item.id === presetId);
    if (!target) return;
    p.currentAiPresetId = target.id;
    p.aiConfig = { ...p.aiConfig, ...target.config };
}

function aiCfgSaveAsPreset(name: string, newConfig: any) {
    _initAiPresets();
    const p = (globalThis as any).getProjectData();
    const id = "preset_" + Date.now();
    p.aiPresets.push({ id, name, config: { ...newConfig } });
    p.currentAiPresetId = id;
    p.aiConfig = { ...p.aiConfig, ...newConfig };
}

function aiCfgDeletePreset() {
    _initAiPresets();
    const p = (globalThis as any).getProjectData();
    if (p.aiPresets.length <= 1) return false;
    const curId = p.currentAiPresetId;
    const idx = p.aiPresets.findIndex((item: any) => item.id === curId);
    if (idx < 0) return false;
    p.aiPresets.splice(idx, 1);
    p.currentAiPresetId = p.aiPresets[0].id;
    p.aiConfig = { ...p.aiConfig, ...p.aiPresets[0].config };
    return true;
}

describe("AI Config Presets Logic Tests", () => {
    beforeEach(() => {
        setupMockEnv();
    });

    test("初期化時にデフォルトプリセットが2件登録される", () => {
        _initAiPresets();
        const p = (globalThis as any).getProjectData();
        expect(p.aiPresets.length).toBe(2);
        expect(p.currentAiPresetId).toBe("preset-default-local");
    });

    test("プリセット選択切替で aiConfig が更新される", () => {
        _initAiPresets();
        aiCfgSelectPreset("preset-default-openai");
        const p = (globalThis as any).getProjectData();
        expect(p.currentAiPresetId).toBe("preset-default-openai");
        expect(p.aiConfig.endpoint).toBe("https://api.openai.com");
        expect(p.aiConfig.model).toBe("gpt-4o-mini");
    });

    test("新しい設定を名前付きでプリセット保存できる", () => {
        _initAiPresets();
        aiCfgSaveAsPreset("カスタム vLLM", { endpoint: "http://192.168.1.10:8000", apiKey: "", routerMode: true, model: "deepseek" });
        const p = (globalThis as any).getProjectData();
        expect(p.aiPresets.length).toBe(3);
        expect(p.aiConfig.endpoint).toBe("http://192.168.1.10:8000");
        expect(p.aiConfig.model).toBe("deepseek");
    });

    test("プリセット削除で別のプリセットへフォールバックする", () => {
        _initAiPresets();
        aiCfgSelectPreset("preset-default-openai");
        const res = aiCfgDeletePreset();
        expect(res).toBe(true);
        const p = (globalThis as any).getProjectData();
        expect(p.aiPresets.length).toBe(1);
        expect(p.currentAiPresetId).toBe("preset-default-local");
    });
});
