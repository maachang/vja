await vja.db.query: { args: [sql:string, params?:any[]], return: "Record<string,any>[]", desc: "SQL SELECT. Use ? placeholder." }
await vja.db.execute: { args: [sql:string, params?:any[]], return: "{changes:number, lastInsertRowid:number}|null", desc: "SQL INSERT/UPDATE/DELETE." }
await vja.db.transaction: { args: [statements:object[]], return: "boolean", desc: "Multiple SQLs. Rollback and returns false on failure." }
