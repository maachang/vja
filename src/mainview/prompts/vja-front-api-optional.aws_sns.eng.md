await vja.aws.sns.publish: { args: [topicArn:string, message:string, options?:{subject?:string}], return: "string", desc: "Publish a message to an SNS topic. Returns the message id." }
