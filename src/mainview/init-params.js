// 初期処理系の定義条件.
//
(function () {
    "use strict";

    ///////////////////////////////
    // クラウドインフラの設定内容.
    ///////////////////////////////
    const CLOUD_INFRA_RAW = [
        {
            "infra": "AWS",
            "service": [
                { "s3": { "url": "https://cdn.jsdelivr.net/npm/@aws-sdk/client-s3/+esm", "input": false } },
                { "dynamodb": { "url": "https://cdn.jsdelivr.net/npm/@aws-sdk/client-dynamodb/+esm", "input": false } },
                { "cognito": { "url": "https://cdn.jsdelivr.net/npm/@aws-sdk/client-cognito-identity-provider/+esm", "input": false } },
                { "sqs": { "url": "https://cdn.jsdelivr.net/npm/@aws-sdk/client-sqs/+esm", "input": false } },
                { "sns": { "url": "https://cdn.jsdelivr.net/npm/@aws-sdk/client-sns/+esm", "input": false } },
                { "lambda": { "url": "https://cdn.jsdelivr.net/npm/@aws-sdk/client-lambda/+esm", "input": false } },
                { "ses": { "url": "https://cdn.jsdelivr.net/npm/@aws-sdk/client-sesv2/+esm", "input": false } },
                { "sts": { "url": "https://cdn.jsdelivr.net/npm/@aws-sdk/client-sts/+esm", "input": false } },
                { "secretsmanager": { "url": "https://cdn.jsdelivr.net/npm/@aws-sdk/client-secrets-manager/+esm", "input": false } },
                { "cloudwatch": { "url": "https://cdn.jsdelivr.net/npm/@aws-sdk/client-cloudwatch-logs/+esm", "input": false } },
                { "カスタム": { "url": "https://cdn.jsdelivr.net/npm/@aws-sdk/", "input": true } }
            ],
            "credential": [
                { "accessKeyId": { "key": "AWS_ACCESS_KEY_ID", "secret": false } },
                { "secretAccessKey": { "key": "AWS_SECRET_ACCESS_KEY", "secret": true } },
                {
                    "region": {
                        "key": "AWS_REGION", "secret": false, "select": [
                            { "name": "", "selected": false },
                            { "name": "us-east-1", "selected": false },
                            { "name": "us-east-2", "selected": false },
                            { "name": "us-west-1", "selected": false },
                            { "name": "us-west-2", "selected": false },
                            { "name": "ca-central-1", "selected": false },
                            { "name": "ca-west-1", "selected": false },
                            { "name": "eu-west-1", "selected": false },
                            { "name": "eu-west-2", "selected": false },
                            { "name": "eu-west-3", "selected": false },
                            { "name": "eu-central-1", "selected": false },
                            { "name": "eu-central-2", "selected": false },
                            { "name": "eu-north-1", "selected": false },
                            { "name": "eu-south-1", "selected": false },
                            { "name": "eu-south-2", "selected": false },
                            { "name": "ap-northeast-1", "selected": true },
                            { "name": "ap-northeast-2", "selected": false },
                            { "name": "ap-northeast-3", "selected": false },
                            { "name": "ap-southeast-1", "selected": false },
                            { "name": "ap-southeast-2", "selected": false },
                            { "name": "ap-southeast-3", "selected": false },
                            { "name": "ap-southeast-4", "selected": false },
                            { "name": "ap-southeast-5", "selected": false },
                            { "name": "ap-south-1", "selected": false },
                            { "name": "ap-south-2", "selected": false },
                            { "name": "ap-east-1", "selected": false },
                            { "name": "sa-east-1", "selected": false },
                            { "name": "me-south-1", "selected": false },
                            { "name": "me-central-1", "selected": false },
                            { "name": "af-south-1", "selected": false },
                            { "name": "il-central-1", "selected": false },
                            { "name": "mx-central-1", "selected": false }
                        ]
                    }
                }
            ]
        },
        {
            "infra": "GCP (Firebase)",
            "service": [
                { "firebase": { "url": "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js", "input": false } },
                { "auth": { "url": "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js", "input": false } },
                { "firestore": { "url": "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js", "input": false } },
                { "storage": { "url": "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js", "input": false } },
                { "functions": { "url": "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js", "input": false } },
                { "database": { "url": "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js", "input": false } },
                { "messaging": { "url": "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js", "input": false } },
                { "ai": { "url": "https://www.gstatic.com/firebasejs/10.7.1/firebase-ai.js", "input": false } },
                { "カスタム": { "url": "https://www.gstatic.com/firebasejs/", "input": true } }
            ],
            "credential": [
                { "apiKey": { "key": "FIREBASE_API_KEY", "secret": true } },
                { "authDomain": { "key": "FIREBASE_AUTH_DOMAIN", "secret": false } },
                { "projectId": { "key": "FIREBASE_PROJECT_ID", "secret": false } },
                { "storageBucket": { "key": "FIREBASE_STORAGE_BUCKET", "secret": false } },
                { "messagingSenderId": { "key": "FIREBASE_MESSAGING_SENDER_ID", "secret": false } },
                { "appId": { "key": "FIREBASE_APP_ID", "secret": false } }
            ]
        },
        {
            "infra": "GCP (Enterprise)",
            "service": [
                { "カスタム": { "url": "", "input": true } }
            ],
            "credential": [
                { "serviceAccountKey": { "key": "GCP_SERVICE_ACCOUNT_KEY_JSON", "secret": true } }
            ]
        },
        {
            "infra": "Azure (Standard)",
            "service": [
                { "blob-storage": { "url": "https://cdn.jsdelivr.net/npm/@azure/storage-blob/+esm", "input": false } },
                { "cosmos-db": { "url": "https://cdn.jsdelivr.net/npm/@azure/cosmos/+esm", "input": false } },
                { "keyvault-secrets": { "url": "https://cdn.jsdelivr.net/npm/@azure/keyvault-secrets/+esm", "input": false } },
                { "openai": { "url": "https://cdn.jsdelivr.net/npm/@azure/openai/+esm", "input": false } },
                { "service-bus": { "url": "https://cdn.jsdelivr.net/npm/@azure/service-bus/+esm", "input": false } },
                { "email": { "url": "https://cdn.jsdelivr.net/npm/@azure/communication-email/+esm", "input": false } },
                { "カスタム": { "url": "https://cdn.jsdelivr.net/npm/@azure/", "input": true } }
            ],
            "credential": [
                { "connectionString": { "key": "AZURE_CONNECTION_STRING", "secret": true } },
                { "endpoint": { "key": "AZURE_ENDPOINT", "secret": false } },
                { "apiKey": { "key": "AZURE_API_KEY", "secret": true } }
            ]
        },
        {
            "infra": "Azure (Enterprise)",
            "service": [
                { "blob-storage": { "url": "https://cdn.jsdelivr.net/npm/@azure/storage-blob/+esm", "input": false } },
                { "cosmos-db": { "url": "https://cdn.jsdelivr.net/npm/@azure/cosmos/+esm", "input": false } },
                { "identity": { "url": "https://cdn.jsdelivr.net/npm/@azure/identity/+esm", "input": false } },
                { "keyvault-secrets": { "url": "https://cdn.jsdelivr.net/npm/@azure/keyvault-secrets/+esm", "input": false } },
                { "openai": { "url": "https://cdn.jsdelivr.net/npm/@azure/openai/+esm", "input": false } },
                { "service-bus": { "url": "https://cdn.jsdelivr.net/npm/@azure/service-bus/+esm", "input": false } },
                { "email": { "url": "https://cdn.jsdelivr.net/npm/@azure/communication-email/+esm", "input": false } },
                { "カスタム": { "url": "https://cdn.jsdelivr.net/npm/@azure/", "input": true } }
            ],
            "credential": [
                { "tenantId": { "key": "AZURE_TENANT_ID", "secret": false } },
                { "clientId": { "key": "AZURE_CLIENT_ID", "secret": false } },
                { "clientSecret": { "key": "AZURE_CLIENT_SECRET", "secret": true } }
            ]
        },
        {
            "infra": "Supabase",
            "service": [
                { "supabase": { "url": "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm", "input": false } },
                { "カスタム": { "url": "https://cdn.jsdelivr.net/npm/@supabase/", "input": true } }
            ],
            "credential": [
                { "supabaseUrl": { "key": "SUPABASE_URL", "secret": false } },
                { "supabaseKey": { "key": "SUPABASE_KEY", "secret": true } }
            ]
        },
        {
            "infra": "Cloudflare",
            "service": [
                { "cloudflare": { "url": "https://cdn.jsdelivr.net/npm/cloudflare/+esm", "input": false } },
                { "カスタム": { "url": "https://cdn.jsdelivr.net/npm/", "input": true } }
            ],
            "credential": [
                { "accountId": { "key": "CLOUDFLARE_ACCOUNT_ID", "secret": false } },
                { "apiToken": { "key": "CLOUDFLARE_API_TOKEN", "secret": true } }
            ]
        },
        {
            "infra": "カスタム",
            "service": [
                { "カスタム": { "url": "", "input": true } }
            ],
            "credential": []
        }
    ];

    //////////////////
    // グローバル展開.
    //////////////////
    const o = {};
    window._INIT_PARAMS = o;

    // クラウドインフラ定義.
    o.CLOUD_INFRA_RAW = CLOUD_INFRA_RAW;
})();
