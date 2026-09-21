## Structure
- All generated code must be written "inline." The use of helper functions is strictly prohibited (e.g., defining functions such as "handleXxx", "doXxx", "addEventListener", etc., is absolutely forbidden). Good example: var result = await vja.app.showConfirm("...");
- Declare variables (var) BEFORE if/else/try/catch/any block, not inside it. Example: var params = []; if (cond) { params = [...]; } await vja.db.query(sql, params);
- As a general rule, the use of "const" and "let" is prohibited; use only "var".

## vja API
- API selection priority (always follow this order, do NOT skip a tier): 1) If a vja.* API exists for the operation (see [vja Runtime(yaml)] below), you MUST use it. 2) If no vja.* API covers it, but a function is defined under the "### 拡張ランタイム(yaml)" section in the user message, use that. 3) Only if neither covers it, fall back to a standard/available JavaScript API. Never reimplement something a vja.* API already provides (e.g. do NOT use crypto.subtle directly — use vja.crypto.sha256/sha1/sha512 or vja.crypto.encrypt/decrypt instead).
- All vja.* calls must use "await", except for the following synchronous calls: vja.event.*, vja.trigger.*, vja.widget.get, vja.widget.set, vja.widget.show, vja.widget.hide, vja.widget.enable, and vja.widget.disable.
- Never use Promise, .then(), or .catch() directly. Use await instead.
- Screen navigation must use vja.form.navigate('screen name') only (window.location is prohibited), and only for switching screens — never for refreshing/updating the current screen.
- window.confirm/alert are prohibited. Use vja.app.showDialog/showConfirm instead.
- Widgets are NOT accessible via direct DOM-style property access (e.g., searchText.value, document.getElementById('x').value are ALL INVALID). vja.widget.get()'s return value is already the raw unwrapped value (string/number/boolean/array) — it is never wrapped in a `.value` property. Accessing `.value` on it will NOT throw — it silently becomes undefined and causes subtly wrong behavior. The ONLY way to read a widget's current value is vja.widget.get('widgetName'), and you must use the returned value directly.

## SQL
- Placeholders (?) are mandatory for all variable inputs to prevent SQL injection, using sqlite3-executable SQL.
- For LIKE searches, concatenate '%' wildcards on the JS variable side — NEVER put '?' inside quotes (e.g. LIKE '%?%' is STRICTLY PROHIBITED). Example: var searchText = vja.widget.get('txtSearch'); var pattern = '%' + searchText + '%'; var sql = 'SELECT * FROM t WHERE name LIKE ?'; await vja.db.query(sql, [pattern]);
- NEVER embed a data VALUE into the SQL string via a template literal (`${...}`) — any value (search text, numbers, IDs, JSON.stringify() results, etc.) must always go through the `?` placeholder and params array. Example: var sql = 'SELECT * FROM users WHERE name = ?'; await vja.db.query(sql, [name]); (i.e. NEVER `WHERE name = ${name}`)
  - Exception: embedding a column/table NAME (an identifier, not a data value) via template literal is acceptable when it comes from a controlled source (e.g. a dropdown of known column names) — e.g. `SELECT * FROM t WHERE ${columnName} = ?` — as long as the actual searched value still goes through `?`.

## YAML Definition Structure
- The YAML specification uses the following keys. Make sure you understand the meaning of each correctly.
  - イベント (Event): Reference information only. NEVER use it as a basis for implementation.
  - 説明 (Description): A summary of the processing. It is not a direct implementation instruction.
  - 利用テーブル (Tables Used): The names of the DB tables referenced.
  - アクション (Action): The actual processing to implement. This is the ONLY basis for implementation.
  - 正常終了 (Normal Completion): The state when the processing has completed successfully.
- When the following heading expressions appear inside "アクション:" (Action), implement them as the corresponding program structure:
  - Headings of the form "〇〇の場合:" (When 〇〇) / "それ以外の場合:" (Otherwise) must be implemented as an if/else conditional branch.
  - Headings of the form "〇〇に対して繰り返し:" (Repeat for each 〇〇) must be implemented as a for/forEach loop.
  - If such headings are further nested beneath one another, implement the corresponding blocks as nested structures accordingly.

## Fidelity to YAML
- Adding operations not specified in the YAML (such as navigate, setVisible, show/hide, etc.) is strictly prohibited.
- When implementing logic to output an error log upon "error termination" (or similar events) using the "message" property of an "Error" object from a "try { } catch (e)" block, you must always set the "Error" object itself as the second argument—specifically, "console.error(e.message, e)".
- The event name (e.g., KeyUp, SelectedIndexChanged) is merely reference information indicating what triggers the code — it is NOT an instruction. NEVER infer or add a "typical" implementation commonly associated with that event name (e.g., assuming SelectedIndexChanged implies "retrieve the selected value and display it"). The implementation must be based solely on what is explicitly specified under "アクション:" (Action).

## Other
- All comments must be written in Japanese.
