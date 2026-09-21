vja.form.navigate: { args: [formName:string, options?:object], return: "void", desc: "Navigates to form. options.save defaults to true." }
vja.form.back: { args: [], return: "void" }
vja.form.setParam: { args: [key:string, value:any], return: "void", desc: "Sets data parameter to pass to the next screen." }
vja.form.getParam: { args: [key:string, default?:any], return: "any", desc: "Retrieves parameter passed from previous screen." }
