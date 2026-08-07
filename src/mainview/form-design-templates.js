// ═══════════════════════════════════════════
// FORM DESIGN TEMPLATES
// 画面デザイン依頼（YAML）のテンプレート定義ファイル
// ═══════════════════════════════════════════
(function () {
    const FORM_DESIGN_TEMPLATES = [
        {
            id: "search",
            label: "🔍 検索一覧画面",
            yaml: `# 検索一覧画面定義
説明: 一覧データを検索・閲覧する画面
フォームレイアウト:
  パターン: 検索一覧画面
  カラム数: 2
  ラベル位置: 左
  ボタン位置: 右

入力項目:
  - 検索キーワード: inputtype で text
  - ステータス: selectBox
    - 未処理
    - 処理中
    - 完了
  - 検索結果: datagrid

アクション項目:
  - 検索ボタン
  - クリアボタン
`
        },
        {
            id: "form",
            label: "📝 登録・詳細フォーム画面",
            yaml: `# 登録フォーム画面定義
説明: 情報を登録・編集する入力画面
フォームレイアウト:
  パターン: 登録フォーム画面
  カラム数: 2
  ラベル位置: 左
  ボタン位置: 右下

入力項目:
  - 氏名: inputtype で text
  - メールアドレス: inputtype で email
  - 電話番号: inputtype で tel
  - 備考: textarea

アクション項目:
  - 保存ボタン
  - キャンセルボタン
`
        },
        {
            id: "dialog",
            label: "💬 ダイアログ画面",
            yaml: `# ダイアログ画面定義
説明: 確認・設定用のコンパクトダイアログ
フォームレイアウト:
  パターン: ダイアログ
  カラム数: 1
  ラベル位置: 左
  ボタン位置: 下部中央

入力項目:
  - 対象名: inputtype で text
  - 通知を有効にする: checkbox

アクション項目:
  - OK
  - キャンセル
`
        },
        {
            id: "master",
            label: "🗂️ マスタ保守画面",
            yaml: `# マスタ保守画面定義
説明: 一覧の選択と下部フォームでのデータ登録・変更・削除を行う管理画面
フォームレイアウト:
  パターン: 登録フォーム画面
  カラム数: 2
  ラベル位置: 左
  ボタン位置: 右下

入力項目:
  - コード: inputtype で text
  - 名称: inputtype で text
  - カテゴリ: selectBox
    - カテゴリA: cat_a
    - カテゴリB: cat_b
  - 有効フラグ: checkbox
  - 一覧表示: datagrid

アクション項目:
  - 新規作成ボタン
  - 更新ボタン
  - 削除ボタン
  - クリアボタン
`
        },
        {
            id: "masterDetail",
            label: "📄 伝票・明細入力画面",
            yaml: `# 伝票明細入力画面定義
説明: ヘッダー（伝票情報）と明細行（商品一覧）を同時入力する画面
フォームレイアウト:
  パターン: 登録フォーム画面
  カラム数: 2
  ラベル位置: 左
  ボタン位置: 右下

入力項目:
  - 伝票番号: inputtype で text
  - 取引先: selectBox
  - 伝票日付: inputtype で date
  - 担当者: inputtype で text
  - 明細一覧: datagrid
  - 合計金額: inputtype で number

アクション項目:
  - 行追加ボタン
  - 行削除ボタン
  - 伝票登録ボタン
  - キャンセルボタン
`
        },
        {
            id: "dashboard",
            label: "📊 ダッシュボード・集計画面",
            yaml: `# ダッシュボード集計画面定義
説明: 期間を指定して各種集計指標や最新履歴を確認する画面
フォームレイアウト:
  パターン: 検索一覧画面
  カラム数: 2
  ラベル位置: 左
  ボタン位置: 右

入力項目:
  - 集計開始日: inputtype で date
  - 集計終了日: inputtype で date
  - 表示対象: selectBox
    - 全体概要: all
    - 部署別: dept
  - 集計結果データ: datagrid

アクション項目:
  - 集計実行ボタン
  - CSV出力ボタン
`
        }
    ];

    // PV SelectBox用オプション配列の取得
    function getFormDesignTemplateOptions() {
        return FORM_DESIGN_TEMPLATES.map(t => ({
            value: t.id,
            label: t.label
        }));
    }

    // ID指定でのテンプレートYAML文字列取得
    function getFormDesignTemplateYaml(id) {
        const found = FORM_DESIGN_TEMPLATES.find(t => t.id === id);
        return found ? found.yaml.trim() + "\n\n" : "";
    }

    // グローバル展開
    Object.assign(window, {
        FORM_DESIGN_TEMPLATES,
        getFormDesignTemplateOptions,
        getFormDesignTemplateYaml,
    });
})();
