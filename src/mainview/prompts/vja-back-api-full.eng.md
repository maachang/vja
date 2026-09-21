vja.db.query: { scope: DB_BACK_SELECT, args: [sql:string, params?:any[]], return: "Record<string,any>[]", desc: "SQL SELECT statement. Returns empty array [] on error. Use ? placeholder. NEVER use await." }
vja.db.execute: { scope: DB_BACK_WRITE, args: [sql:string, params?:any[]], return: "{changes:number, lastInsertRowid:number}|null", desc: "SQL INSERT/UPDATE/DELETE. Returns null on error. NEVER use await." }
vja.db.clearTable: { scope: DB_BACK_CLEAR, args: [tableName:string], return: "void" }
await vja.db.importCsv: { scope: DB_BACK_IMPORT, args: [tableName:string, filePath:string], return: "void", desc: "Bulk import CSV file using first row as header. Throws error on failure. MUST use await." }
await vja.db.importJson: { scope: DB_BACK_IMPORT, args: [tableName:string, filePath:string], return: "void", desc: "Bulk import JSON array file. Throws error on failure. MUST use await." }

vja.session.get: { scope: SESSION_BACK_STORAGE, args: [key:string], return: "string|null" }
vja.session.set: { scope: SESSION_BACK_STORAGE, args: [key:string, value:string], return: "boolean" }
vja.session.delete: { scope: SESSION_BACK_STORAGE, args: [key:string], return: "boolean" }
vja.session.clear: { scope: SESSION_BACK_STORAGE, args: [], return: "boolean" }

vja.log.info: { scope: LOG_BACK_SYSTEM, args: [message:string], return: "void" }
vja.log.warn: { scope: LOG_BACK_SYSTEM, args: [message:string], return: "void" }
vja.log.error: { scope: LOG_BACK_SYSTEM, args: [message:string], return: "void" }
