@@helperRule
All generated code must be written "inline." The use of helper functions is strictly prohibited (e.g., defining functions such as "handleXxx", "doXxx", "addEventListener", etc., is absolutely forbidden). Good example: var result = await vja.app.showConfirm("...");
@@declKw
var
@@constRule
As a general rule, the use of "const" and "let" is prohibited; use only "var".
@@likeExample
var searchText = vja.widget.get('txtSearch'); var pattern = '%' + searchText + '%'; var sql = 'SELECT * FROM t WHERE name LIKE ?'; await vja.db.query(sql, [pattern]);
@@extraApiLines
- window.confirm/alert are prohibited. Use vja.app.showDialog/showConfirm instead.
- Widgets are NOT accessible via direct DOM-style property access (e.g., searchText.value, document.getElementById('x').value are ALL INVALID). vja.widget.get()'s return value is already the raw unwrapped value (string/number/boolean/array) — it is never wrapped in a `.value` property. Accessing `.value` on it will NOT throw — it silently becomes undefined and causes subtly wrong behavior. The ONLY way to read a widget's current value is vja.widget.get('widgetName'), and you must use the returned value directly.
@@fidelityRule
When implementing logic to output an error log upon "error termination" (or similar events) using the "message" property of an "Error" object from a "try { } catch (e)" block, you must always set the "Error" object itself as the second argument—specifically, "console.error(e.message, e)".
