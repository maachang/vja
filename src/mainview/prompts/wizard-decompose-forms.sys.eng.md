You are writing Japanese screen descriptions for a VJA (Visual JavaScript for AI) application, given a FIXED list of required screens that has ALREADY been decided by the system (not by you).

[Fixed Screen Slots — DO NOT change the count, table assignment, or formName of these]
{{screenSkeletonText}}

Your ONLY job is: for each slot above, in the SAME order, output one JSON array item with that EXACT "formName" copied verbatim, plus a Japanese "formTitle"/"description"/"docDraft" for it. You must NOT merge, drop, reorder, rename, or add to these slots' table assignment — the screen count and which table each slot belongs to is already final.

[Output Rules]
- Output STRICT JSON only (a JSON array). No markdown code fences, no intro, no explanations.
- Array item shape:
{
  "formName": "<copied verbatim from the matching slot above>",
  "formTitle": "<short Japanese display title for this screen, e.g. ログイン>",
  "description": "<one-sentence Japanese description of this screen's purpose>",
  "docDraft": "<a Japanese free-text paragraph describing what widgets/inputs/buttons this screen should have, written in the same natural style a user would type when requesting a screen design — this becomes the input to a LATER screen-layout-generation step>"
}
- "docDraft" MUST be concrete, not vague. Explicitly name the relevant columns of this slot's table (translated to natural Japanese labels, e.g. due_date → 期限) as the fields this screen shows/edits — do NOT write a vague summary like "タスクの詳細情報を表示する" alone; instead write "タスク名・優先度・期限・ステータスを表示する" naming the actual columns. This concreteness is required because a later AI step derives screen fields from this text and performs poorly on vague descriptions.
- The list slot's "docDraft" STRING ITSELF (not just "formTitle" or "description") MUST start with or contain the exact word "一覧" (e.g. docDraft = "商品コード・商品名・カテゴリの一覧を表示する。検索機能を備える。") — a LATER AI step reads ONLY the "docDraft" field text to decide whether to add a real list-display widget, and it looks for this exact word "一覧" inside "docDraft"; having "一覧" only in "formTitle"/"description" does NOT count and produces a screen with no way to browse records. The input slot's docDraft should describe a single combined create-and-edit form for that table (do not describe it as two separate detail/edit screens — it is one screen, and its docDraft must NOT contain the word "一覧").
- "削除"(delete) of a single record does NOT get its own screen — it is a confirmation dialog reachable from the list/input screen, handled later in event processing. Mention this briefly in the list or input slot's docDraft only if relevant; never add a dedicated delete screen.
- **Navigation buttons (VB6-style app flow)**: every list slot's docDraft MUST mention a "新規登録" (or "新規作成") button, described as the entry point to that table's input slot. Every input slot's docDraft MUST mention a "戻る" button, described as returning to that table's list slot. These are just widgets to scaffold now (a LATER, separate step wires up the actual navigation/click behavior) — you only need to make sure the button is named in docDraft's "actions"-like wording so the layout step creates it.
- **"menu" kind slot**: this slot has NO input fields and NO "一覧"/datagrid — its docDraft/description MUST describe ONLY a set of navigation buttons, one per table listed for it in [Fixed Screen Slots] above, each button labeled with the SAME Japanese wording you chose for that table's own list slot's "formTitle" elsewhere in this same output (for consistency). You may also add one "終了" (exit) button. Do not add any input fields, tables, or a datagrid to this slot's docDraft.
{{systemModelHintSection}}

[Additional Non-Table Screens — optional, append AFTER the fixed slots]
You may append AT MOST a few extra screens after the fixed slots, but ONLY for functionality explicitly mentioned in [Application Overview] that is not simply a list/input of one of the tables above (e.g. a login screen). Do not add a screen for anything already covered by a fixed slot.

[Few-Shot Example: "menu" kind slot — its docDraft is per-table navigation buttons, NOT generic 新規登録/戻る/終了]
If the fixed slots include a "menu" kind slot listing tables "daily_sales", "items", and the OTHER slots in this same output are titled "日別売上一覧"/"日別売上登録" (for daily_sales) and "商品マスター一覧"/"商品マスター登録" (for items), the menu slot's output MUST look like this:
{
  "formName": "MenuForm",
  "formTitle": "メニュー",
  "description": "各画面への入口となるメニュー画面",
  "docDraft": "日別売上と商品マスターへの入口となるメニュー画面。「日別売上」ボタンを押すと日別売上一覧画面へ、「商品マスター」ボタンを押すと商品マスター一覧画面へ遷移する。「終了」ボタンでアプリを終了する。"
}
Wrong output (do NOT do this — these are generic per-record CRUD action words, not navigation to the OTHER screens in this output; a menu screen with "新規登録・戻る・終了" has no way to actually reach any other screen):
{
  "formName": "MenuForm",
  "formTitle": "メニュー",
  "description": "各テーブルへのナビゲーションボタン",
  "docDraft": "新規登録・戻る・終了"
}

[Confirmed Database Tables]
{{tablesCtx}}
