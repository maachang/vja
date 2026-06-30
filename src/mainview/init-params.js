// 初期処理系の定義条件.
//
(function () {
    "use strict";

    //////////////////
    // グローバル展開.
    // ── 定義値関連（AIへのメモ）──────────────────────
    // このファイルは「機能」ではなく「他のどのファイルからも参照されうる
    // 静的な定義値（マスターデータ）」だけを集約する。
    // 全ファイルの中で最初に読み込まれるため、ここに置いた値は
    // 以降のどのファイルからも window.XXXX の形でそのまま参照できる。
    // 新しい定義値を追加する場合も、機能別ファイルに書かず必ずここに置く。
    //////////////////

    // ウィジェットのリサイズハンドル（8方向）のHTML（旧 vja-designer.js）.
    window.RHS = ["tl", "tm", "tr", "ml", "mr", "bl", "bm", "br"]
        .map((p) => `<div class="rh rh-${p}" data-h="${p}"></div>`)
        .join("");

    // エディタUndo履歴のスナップショット保存トリガーとなる区切り文字（旧 vja-editor-utils.js）.
    window.UNDO_DELIMITERS = new Set([
        " ", "Enter", "Tab",
        ".", ",", ":", ";", "`", "'", '"',
        "(", ")", "{", "}", "[", "]",
        "=", "+", "-", "*", "/", "\\", "|", "!", "?", "@", "#",
        "Backspace",
    ]);

    // SQLiteのカラム型一覧（旧 vja-table-validation.js）.
    window.SQLITE_TYPES = ["TEXT", "INTEGER", "REAL", "BLOB", "NULL"];

    // バリデーションルールの種類一覧（旧 vja-table-validation.js）.
    window.VALIDATION_TYPES = [
        { value: "required", label: "必須" },
        { value: "maxLength", label: "最大文字数" },
        { value: "minLength", label: "最小文字数" },
        { value: "range", label: "数値範囲" },
        { value: "numeric", label: "数値のみ" },
        { value: "integer", label: "整数のみ" },
        { value: "email", label: "メール形式" },
        { value: "tel", label: "電話番号" },
        { value: "zipcode", label: "郵便番号" },
        { value: "url", label: "URL形式" },
        { value: "date", label: "日付形式" },
        { value: "alphanumeric", label: "英数字のみ" },
        { value: "alpha", label: "英字のみ" },
        { value: "hiragana", label: "ひらがなのみ" },
        { value: "katakana", label: "カタカナのみ" },
        { value: "pattern", label: "正規表現" },
    ];

    // アプリイベント（OnStart/OnExit）の種類一覧（旧 vja-app-config.js）.
    window.APP_EV_TYPES = [
        { key: "onStart", label: "🚀 起動時（OnStart）" },
        { key: "onExit", label: "🔚 終了時（OnExit）" },
    ];

    // フォント設定で選択可能なフォント一覧（旧 vja-app-config.js）.
    window.FONT_LIST = [
        { label: "Courier New", value: "'Courier New', Courier, monospace" },
        { label: "Consolas", value: "'Consolas', 'Courier New', monospace" },
        { label: "Fira Code", value: "'Fira Code', 'Courier New', monospace" },
        { label: "Source Code Pro", value: "'Source Code Pro', monospace" },
        { label: "Menlo", value: "'Menlo', 'DejaVu Sans Mono', monospace" },
        { label: "monospace", value: "monospace" },
        { label: "sans-serif", value: "sans-serif" },
        { label: "serif", value: "serif" },
    ];
    // ウィジェット用（先頭に「デフォルト」を追加）.
    window.WIDGET_FONTS = [
        { label: "（デフォルト）", value: "" },
        ...window.FONT_LIST,
    ];
    // エディタ用（FONT_LISTをそのまま使用）.
    window.EDITOR_FONTS = window.FONT_LIST;

    // 座標ルーラーの描画定数（旧 vja-ui.js）.
    window._RULER = {
        STEP: 50, TICK_LG: 8, TICK_SM: 4,
        TICK_COL: "rgba(160,160,192,0.35)", LABEL_COL: "rgba(160,160,192,0.55)",
        FORM_HL: "rgba(122,158,248,0.10)", FORM_BD: "rgba(122,158,248,0.4)"
    };

    // クラウドインフラ定義.
    window.CLOUD_INFRA_RAW = [
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
                        "key": "AWS_REGION",
                        "secret": false,
                        "select": [
                            // 日本で利用想定で、利用対象リージョンを対象とする.
                            { "name": "", "value": "", "selected": false },
                            { "name": "東京", "value": "ap-northeast-1", "selected": true },
                            { "name": "大阪", "value": "ap-northeast-3", "selected": false },
                            { "name": "ソウル", "value": "ap-northeast-2", "selected": false },
                            { "name": "シンガポール", "value": "ap-southeast-1", "selected": false },
                            { "name": "バージニア北部", "value": "us-east-1", "selected": false },
                            { "name": "オレゴン", "value": "us-west-2", "selected": false }
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
})();
