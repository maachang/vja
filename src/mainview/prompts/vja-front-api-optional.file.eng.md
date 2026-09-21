await vja.file.read: { args: [path:string], return: "string|null", desc: "Reads a text file. Returns null if not found. MUST use await." }
await vja.file.write: { args: [path:string, content:string], return: "boolean", desc: "Writes text to a file. MUST use await." }
await vja.file.readBytes: { args: [path:string], return: "Uint8Array|null", desc: "Reads a binary file. Returns null if not found. MUST use await." }
await vja.file.writeBytes: { args: [path:string, data:Uint8Array], return: "boolean", desc: "Writes binary data to a file. MUST use await." }
await vja.file.exists: { args: [path:string], return: "boolean", desc: "Checks whether a file exists. Same argument pattern for vja.file.delete(path) [deletes file]. MUST use await." }
await vja.file.copy: { args: [src:string, dest:string], return: "boolean", desc: "Copies a file. MUST use await." }
