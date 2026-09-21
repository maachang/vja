await vja.http.get: { args: [url:string, headers?:object], return: "any", desc: "HTTP GET. (vja.http.delete(url, headers) uses same args)" }
await vja.http.post: { args: [url:string, body:any, headers?:object], return: "any", desc: "HTTP POST with JSON body. (vja.http.put(url, body, headers) uses same args)" }
await vja.fetch: { args: [url:string, options?:object], return: "any", desc: "Low-level fetch alternative for custom options." }
