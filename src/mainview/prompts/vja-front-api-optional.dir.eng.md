await vja.dir.create: { args: [path:string], return: "boolean", desc: "Creates a directory (including parents). Same argument pattern for vja.dir.delete(path) [deletes directory], vja.dir.exists(path) [checks existence]. MUST use await." }
await vja.dir.list: { args: [path:string], return: "string[]", desc: "Lists entries in a directory. MUST use await." }
