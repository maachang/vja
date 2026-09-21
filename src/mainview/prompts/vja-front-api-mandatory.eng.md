vja.widget.get: { args: [name:string], return: "string|number|boolean|null", desc: "Gets current value from UI Widget. CRITICAL: The returned value is READ-ONLY. Modifying the returned object/array WILL NOT update the UI. To update, you MUST explicitly use vja.widget.set()." }
vja.widget.set: { args: [name:string, value:any, options?:object], return: "void", desc: "Sets value to UI Widget (text:str, checkbox:bool, select:array, datagrid:object[]). MANDATORY: This is the ONLY way to update UI data. Never mutate objects retrieved from get()." }
vja.widget.getAllInputs: { args: [], return: "Record<string,any>", desc: "Gets all active UI inputs in a form as {name: value}." }
vja.widget.setVisible: { args: [name:string, visible:boolean], return: "void", desc: "Toggles UI display (true=show, false=hide)." }
vja.widget.show: { args: [name:string], return: "void", desc: "Shows the widget. Same argument pattern for vja.widget.hide(name), vja.widget.enable(name), vja.widget.disable(name)." }
vja.widget.setSuggestions: { args: [name:string, list:(string|{label:string,value:string})[]], return: "void", desc: "Shows suggestion dropdown candidates below an inputtype widget whose SuggestEnabled property is true. MUST be called only from that widget's own Suggest event (fires on every keystroke, same timing as TextChanged). List is capped to the widget's SuggestMaxCount property (default 3)." }

vja.trigger.click: { args: [name:string], return: "void", desc: "Triggers click on widget. name is the widget's NAME STRING (e.g. 'btnSearch'). For other events use same pattern: vja.trigger.focus(name), vja.trigger.blur(name), vja.trigger.change(name), vja.trigger.mouseDown(name), vja.trigger.mouseUp(name), vja.trigger.mouseEnter(name), vja.trigger.mouseLeave(name), vja.trigger.scroll(name)" }

vja.ui.loading: { args: [show:boolean, message?:string], return: "void", desc: "Toggle loading overlay screen. MUST wrap the actual code in try{} finally{ vja.ui.loading(false); } structure to ensure turn off on errors." }

await vja.app.showDialog: { args: [message:string], return: "void", desc: "Shows a message dialog. MUST use await, including inside catch blocks (e.g., catch (e) { console.error(e.message, e); await vja.app.showDialog('...'); }). Forgetting await is a common mistake — do not omit it, even in error handling." }
await vja.app.showConfirm: { args: [message:string], return: "boolean", desc: "Confirm dialog. OK=true, Cancel=false." }
vja.app.closeWindow: { args: [], return: "void", desc: "Closes the running app window. Same effect as clicking the titlebar's close (✕) button." }

await vja.crypto.encrypt: { args: [text:string, key:string], return: "string", desc: "Encrypts text, returns a Base64 string. Counterpart: await vja.crypto.decrypt(b64:string, key:string) -> string (throws if key is wrong)." }
await vja.crypto.sha1: { args: [text:string], return: "string", desc: "One-way hash, NOT reversible. Same argument/return pattern for vja.crypto.sha256(text) and vja.crypto.sha512(text). ARG MUST BE A PLAIN STRING — do NOT pass a TextEncoder-encoded Uint8Array/ArrayBuffer, this API takes and encodes the string internally. RETURN IS ALREADY a lowercase hex string (sha1=40 chars, sha256=64 chars, sha512=128 chars) — do NOT convert the return value with Array.from(new Uint8Array(...)) or similar, that produces wrong output. Not recommended alone for password storage (no salt/stretching); use for tamper detection, dedup keys, simple fingerprints." }

vja.notify.toast: { args: [message:string, duration?:number], return: "void", desc: "Displays a bottom toast notification. Use this for lightweight success/status messages (NOT vja.app.showDialog) when the YAML explicitly says "トースト" (toast)." }

console.info: { args: [message:any], return: "void" }
console.warn: { args: [message:any], return: "void" }
console.error: { args: [message:any], return: "void" }
