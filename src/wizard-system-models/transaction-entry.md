# 伝票・トランザクション登録系

## 概要
「売上登録」「受発注」「見積書」のように、ヘッダ（取引全体の情報）と明細（品目ごとの行）の親子構造を持つ、伝票入力業務の骨格。

## テーブル構成の型
ヘッダテーブルと明細テーブルの2テーブル構成が基本形。

```
例: 売上登録
- sales (ヘッダ)
  - id            INTEGER PRIMARY KEY
  - slipNo        TEXT NOT NULL   -- 伝票番号
  - slipDate      TEXT NOT NULL   -- 伝票日付
  - customerName  TEXT            -- 取引先名（顧客マスタがあれば customerId で参照）
  - totalAmount   REAL            -- 合計金額（明細から集計）
  - note          TEXT

- sales_items (明細)
  - id            INTEGER PRIMARY KEY
  - salesId       INTEGER NOT NULL  -- salesへの参照
  - itemName      TEXT NOT NULL     -- 品目名（商品マスタがあれば productId で参照）
  - quantity      INTEGER NOT NULL
  - unitPrice     REAL NOT NULL
  - amount        REAL              -- quantity × unitPrice
```

顧客・商品が既にマスタ管理系として存在する場合は、直接テキスト入力ではなく、selectBoxや検索付き入力で参照する形にする。

## 画面構成の骨格（重要）
- **一覧画面（1つ）**: 伝票番号・日付範囲・取引先等での検索＋一覧（datagrid）
- **登録・編集画面（1つ）**: ヘッダ入力欄＋明細行の追加/削除が可能な明細テーブル（datagrid、またはUI上の行追加）を、**同一画面内**にまとめる。新規登録・既存編集を同じ画面で兼用する
- 保存時、明細の合計を集計しヘッダのtotalAmountへ反映する処理を含める
- 削除・詳細確認も、専用の別画面を作らず、登録・編集画面の流用や一覧からの直接操作で完結させる

## AIが陥りやすい失敗（回避したい点）
- ヘッダと明細を1つのテーブルに無理に詰め込む、または逆に必要以上に細かくテーブルを分割する
- 明細行の増減UIを作らず、固定行数のフォームにしてしまう
- 一覧・登録・編集・削除・詳細を別々のFormとして量産してしまう
