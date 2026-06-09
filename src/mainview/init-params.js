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
                { "s3": { "url": "https://cdn.jsdelivr.net/npm/@aws-sdk/client-s3/dist-es/index.js", "input": false } },
                { "dynamodb": { "url": "https://cdn.jsdelivr.net/npm/@aws-sdk/client-dynamodb/dist-es/index.js", "input": false } },
                { "cognito": { "url": "https://cdn.jsdelivr.net/npm/@aws-sdk/client-cognito-identity/dist-es/index.js", "input": false } },
                { "カスタム": { "url": "https://cdn.jsdelivr.net/npm/@aws-sdk/", "input": true } }
            ],
            "credential": [
                { "accessKeyId": { "key": "AWS_ACCESS_KEY", "secret": false } },
                { "secretKey": { "key": "AWS_SECRET_ACCESS_KEY", "secret": true } },
                { "region": { "key": "REGION", "secret": false } }
            ]
        },
        {
            "infra": "GCP",
            "service": [
                { "firebase": { "url": "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js", "input": false } },
                { "firestore": { "url": "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js", "input": false } },
                { "storage": { "url": "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js", "input": false } },
                { "カスタム": { "url": "https://www.gstatic.com/firebasejs/", "input": true } }
            ],
            "credential": [
                { "apiKey": { "key": "GCP_API_KEY", "secret": true } },
                { "projectId": { "key": "GCP_PROJECT_ID", "secret": false } },
                { "storageBucket": { "key": "GCP_STORAGE_BUCKET", "secret": false } }
            ]
        },
        {
            "infra": "Azure",
            "service": [
                { "blob-storage": { "url": "https://cdn.jsdelivr.net/npm/@azure/storage-blob/dist/index.browser.js", "input": false } },
                { "cosmos-db": { "url": "https://cdn.jsdelivr.net/npm/@azure/cosmos/dist/index.js", "input": false } },
                { "カスタム": { "url": "https://cdn.jsdelivr.net/npm/@azure/", "input": true } }
            ],
            "credential": [
                { "accountName": { "key": "AZURE_ACCOUNT_NAME", "secret": false } },
                { "sasToken": { "key": "AZURE_SAS_TOKEN", "secret": true } }
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
