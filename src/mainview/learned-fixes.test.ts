import { describe, test, expect, beforeEach } from "bun:test";

// モック環境のセットアップ
function setupMockEnv() {
    const projectData: any = {
        learnedFixes: {},
        widgets: [{ id: "btn1", tag: "button" }, { id: "dg1", tag: "datagrid" }]
    };
    (globalThis as any).getProjectData = () => projectData;
    (globalThis as any).getWidget = (id: string) => projectData.widgets.find((w: any) => w.id === id);
    (globalThis as any).window = { vja: { log: { debug: () => {} } } };
}

// vja-yaml-editor.jsの学習履歴ロジックと同等のロジック検証
function _learnedFixesKey(wid: string, evName: string) {
    if (wid === "global") return "global";
    if (wid === "tag") return "tag_" + evName;
    return wid + "_" + evName;
}

function _getLearnedFixes(wid: string, evName: string) {
    return ((globalThis as any).getProjectData().learnedFixes || {})[_learnedFixesKey(wid, evName)] || [];
}

function _setLearnedFixes(wid: string, evName: string, arr: any[]) {
    if (!(globalThis as any).getProjectData().learnedFixes) (globalThis as any).getProjectData().learnedFixes = {};
    (globalThis as any).getProjectData().learnedFixes[_learnedFixesKey(wid, evName)] = arr;
}

function _recordLearnedFix(wid: string, evName: string, mistakeSummary: string) {
    if (!mistakeSummary || mistakeSummary === "(詳細なし)") return;
    let list = _getLearnedFixes(wid, evName);
    if (!list.some((e: any) => e.mistakeSummary === mistakeSummary)) {
        list = [...list, {
            id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
            createdAt: Date.now(), mistakeSummary, pinned: false, recurCount: 0, scope: "event",
        }];
        _setLearnedFixes(wid, evName, list);
    }

    const w = typeof (globalThis as any).getWidget === "function" ? (globalThis as any).getWidget(wid) : null;
    if (w && w.tag) {
        let tagList = _getLearnedFixes("tag", w.tag);
        const allFixes = (globalThis as any).getProjectData().learnedFixes || {};
        let tagOccurrences = 0;
        for (const [k, arr] of Object.entries(allFixes) as [string, any[]][]) {
            if (k.startsWith("tag_")) continue;
            if (arr.some((e: any) => e.mistakeSummary === mistakeSummary)) {
                tagOccurrences++;
            }
        }
        if (tagOccurrences >= 2 && !tagList.some((e: any) => e.mistakeSummary === mistakeSummary)) {
            tagList = [...tagList, {
                id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
                createdAt: Date.now(), mistakeSummary: `[${w.tag}共通] ${mistakeSummary}`, pinned: true, recurCount: 0, scope: "tag",
            }];
            _setLearnedFixes("tag", w.tag, tagList);
        }
    }
}

function _buildLearnedFixesCtx(wid: string, evName: string) {
    const w = typeof (globalThis as any).getWidget === "function" ? (globalThis as any).getWidget(wid) : null;
    const tag = w?.tag;

    const eventList = _getLearnedFixes(wid, evName);
    const tagList = tag ? _getLearnedFixes("tag", tag) : [];
    const globalList = _getLearnedFixes("global", "all");

    const sections: string[] = [];
    if (globalList.length > 0) {
        sections.push("【プロジェクト全体ルール】\n" + globalList.map((e: any) => "- " + e.mistakeSummary).join("\n"));
    }
    if (tagList.length > 0) {
        sections.push(`【${tag} ウィジェット共通の注意点】\n` + tagList.map((e: any) => "- " + e.mistakeSummary).join("\n"));
    }
    if (eventList.length > 0) {
        sections.push(`【${wid}.${evName} の過去の修正箇所】\n` + eventList.map((e: any) => "- " + e.mistakeSummary).join("\n"));
    }

    if (sections.length === 0) return "";
    return "## 過去に学習したプロジェクト固有の注意点（以下を固く遵守し、同じ間違いを繰り返さないこと）\n"
        + sections.join("\n\n");
}

describe("learnedFixes Multi-scope & Auto-promotion Tests", () => {
    beforeEach(() => {
        setupMockEnv();
    });

    test("_learnedFixesKey キー生成の検証", () => {
        expect(_learnedFixesKey("global", "all")).toBe("global");
        expect(_learnedFixesKey("tag", "datagrid")).toBe("tag_datagrid");
        expect(_learnedFixesKey("btnSave", "Click")).toBe("btnSave_Click");
    });

    test("イベント固有の学習履歴記録と重複除外", () => {
        _recordLearnedFix("btn1", "Click", "TypeError: vja.db is undefined");
        _recordLearnedFix("btn1", "Click", "TypeError: vja.db is undefined");
        const list = _getLearnedFixes("btn1", "Click");
        expect(list.length).toBe(1);
        expect(list[0].mistakeSummary).toBe("TypeError: vja.db is undefined");
    });

    test("同一タグで複数回発生した場合のタグ共通ルールへの自動昇格", () => {
        _setLearnedFixes("btn1", "Click", [{ mistakeSummary: "共通型エラー", pinned: false }]);
        _setLearnedFixes("btn2", "Click", [{ mistakeSummary: "共通型エラー", pinned: false }]);

        // モックに btn2 を追加
        (globalThis as any).getProjectData().widgets.push({ id: "btn2", tag: "button" });

        _recordLearnedFix("btn2", "Click", "共通型エラー");

        const tagList = _getLearnedFixes("tag", "button");
        expect(tagList.length).toBe(1);
        expect(tagList[0].mistakeSummary).toContain("button共通");
    });

    test("_buildLearnedFixesCtx での複数スコープの統合コンテキスト構築", () => {
        _setLearnedFixes("global", "all", [{ mistakeSummary: "日付はYYYY-MM-DD" }]);
        _setLearnedFixes("tag", "datagrid", [{ mistakeSummary: "setDataには配列を渡す" }]);
        _setLearnedFixes("dg1", "Click", [{ mistakeSummary: "Clickイベントの選択行取得" }]);

        const ctx = _buildLearnedFixesCtx("dg1", "Click");
        expect(ctx).toContain("【プロジェクト全体ルール】");
        expect(ctx).toContain("日付はYYYY-MM-DD");
        expect(ctx).toContain("【datagrid ウィジェット共通の注意点】");
        expect(ctx).toContain("setDataには配列を渡す");
        expect(ctx).toContain("【dg1.Click の過去の修正箇所】");
    });
});
