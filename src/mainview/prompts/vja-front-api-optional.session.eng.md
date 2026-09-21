await vja.session.get: { args: [key:string, default?:any], return: "any", desc: "Retrieves persistent session data. MUST use await." }
await vja.session.set: { args: [key:string, value:any], return: "boolean", desc: "Saves persistent session data (JSON)." }
await vja.session.delete: { args: [key:string], return: "boolean", desc: "Deletes a session data entry. MUST use await." }
await vja.session.clear: { args: [], return: "boolean", desc: "Clears all session data. MUST use await." }
