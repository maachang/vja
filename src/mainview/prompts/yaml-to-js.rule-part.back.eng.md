@@helperRule
Code must always be written inline.
@@declKw
let
@@constRule
As a general rule, do not use "const"; use only "let".
@@loadingRule

@@likeExample
let pattern = '%' + searchText + '%'; let sql = 'SELECT * FROM t WHERE name LIKE ?'; await vja.db.query(sql, [pattern]);
@@extraApiLines

@@fidelityRule
Strictly adhere to the implementation requirements specified in "the YAML specification".
