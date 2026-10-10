# vja（Visual JavaScript for AI）プロジェクト固有の情報

このファイルはClaude Codeがセッション開始時に自動的に読み込みます。 ここにはプロジェクト固有の事実を書く。 汎用的な開発知識（言語仕様・設計原則の教科書的説明など）は書かない。

# プロジェクト概要
vja（Visual JavaScript for AI） と言う 昔の VB6のようにフォームにウィジェット配置でアプリが作れる開発環境を作成する。ここでは「ローカルLLM」を使って「イベント等のコード生成」や「フォームデザイン」を「YAML定義」で実現する。

# 詳細ノート（.claude/notes/）

CLAUDE.mdは毎セッション全文が読み込まれるため、規約・全体構成・索引だけを置き、機能ごとの詳細仕様・経緯・既知の制約は`.claude/notes/`に分離している（2026-09-29）。**該当する作業に着手する前に、下表の対応ノートを必ず読むこと**（自動では読み込まれない）。

| ファイル | 内容 | 読むタイミング |
|---|---|---|
| `.claude/notes/mcp-test.md` | vjaデザイナーのMCPテスト自動化（`mcp/vja-mcp-server.ts`）、AI生成フローのモックテスト、DOM読み取りタイミング事故の教訓とテスト基盤 | MCP/テスト用RPC/AI生成のテストに触れる前、AI生成関数のDOM依存部分をリファクタする前 |
| `.claude/notes/ai-generation.md` | 学習履歴・画面デザインAI生成・イベントYAMLドラフト・ロールバック・機械的な後処理・DBテーブル/検証のAI生成・総覧 | AI生成まわり（プロンプト、後処理、各AI生成機能）を変更する前 |
| `.claude/notes/prompts.md` | プロンプトのトークン圧縮方針と、prompt-def.js→prompts/*.mdへの外部ファイル化 | prompt-def.js・prompts/*.mdを変更する前、プロンプト文言を書く前 |
| `.claude/notes/wizard.md` | システムモデル定義（用語の参考ヒント）と、ウィザードの現行設計・経緯・教訓 | vja-wizard.js・src/wizard-system-models/・ウィザード関連のプロンプトを変更する前 |
| `.claude/notes/known-constraints.md` | 同梱bun 1.4.2とElectrobunパッチ、Windows/Mac/Linuxのアイコン対応、macOS/Linux/Windows固有の制約 | Electrobun・bun・ビルド/コンパイル・アイコン・プラットフォーム固有の問題に触れる前 |
| `.claude/notes/refactoring.md` | 大きなファイルを切り出す際の検証手順と過去の事故 | ファイル分割・大規模リファクタをする前 |
| `.claude/notes/local-llm-setup.md` | setup-mac-llm.sh（mlx-lm/Qwen2.5-Coder-7B）の設計 | setup-mac-llm.sh・ローカルLLMのセットアップ手順に触れる前 |
| `.claude/notes/cloud-aws.md` | クラウド（AWS）対応: AWSのみ正式対応、webviewのCDN版SDK＋AWS宛てfetchのvja.fetch差し替え、`vja.aws.*`ランタイム、拡張API、クレデンシャルの暗号化保存 | クラウド設定・`vja.aws.*`・`vja.fetch`・クレデンシャル・拡張APIに触れる前 |
| `.claude/notes/designer-ui.md` | デザイナーの画面構成（2段のメニュー/ツールバー・画面一覧パネル・リサイズ）、定数エディタの統合、定数と起動フォーム(★)の実行時連携の不具合と教訓 | メニュー・ツールバー・画面一覧・定数・起動フォームに触れる前 |
| `.claude/notes/positioning.md` | vjaの位置づけ・対象・強みと難点・守る前提（7B成立、ローカルの売りは「外に出ない」、誇張しない） | README・ドキュメントの文言を書く前、機能の優先度を相談されたとき |
| `.claude/notes/remaining-issues.md` | 将来対応検討の項目（日本語解説機能、ランタイムAPI拡充候補等）と、プロンプト用語の書き分けルール | 機能追加・改善の相談を受けたとき、プロンプトを書く前 |

- 新しく書き足す際の基準: CLAUDE.mdには「規約」と「全体構成」だけを書く。機能ごとの詳細・不具合の経緯・検証の手順は、対応するノートへ書く（該当するノートが無ければ新規作成し、この表へ1行足す）。経緯の全文ではなく、現行仕様と、繰り返してはいけない教訓の要約を書く。作業ログはコミットメッセージや`.claudeWork/`に残す

# 作業領域（.claudeWork）

- プロジェクト直下の `.claudeWork/` はClaude Code専用の作業領域（Gitには一切コミットしない、.gitignore済み）
- セッションが落ちて再起動すると直前の会話内容は失われるため、途中の提案・調査結果・未確定の方針などで残しておきたいものは、このフォルダにファイルとして書いておくこと
- セッション開始時、作業に関連しそうであれば `.claudeWork/` の中身を確認すること
- プロジェクト固有の永続的な事実はここではなく本ファイル（CLAUDE.md）または`.claude/notes/`（下記「詳細ノート」）に書く。`.claudeWork`はあくまで一時的な作業メモ置き場

# ユニットテスト（bun test）

- `bun test`（追加設定不要、`package.json`に`test`スクリプトあり）でユニットテストが実行できる
- 対象は「Electrobunのウィンドウ/DOMに依存しない純粋なロジック」のみ（`src/mainview/bridge-common.ts`、`src/mainview/aws-runtime.ts`、`src/bun/bun-utils.ts`、`src/bun/fs-rpc-handlers.ts`、`src/bun/db-manager.ts`が対象。各ファイルと同じディレクトリに`*.test.ts`を置く）
- `src/bun/project-runner.ts`は`electrobun/bun`をトップレベルでimportしており、単体でimportするとハングするため、現状テスト対象外（モック化すればテスト可能だが未対応）
- `src/mainview/*.js`（vja-yaml-editor.js等）はモジュールシステムを使わない素の`<script>`読み込みのため、現状テスト対象外（`export`追加等の小さなリファクタが必要）
- ロジック以外（ウィジェット配置・描画・ダイアログ操作等、DOM/ネイティブウィンドウに依存する部分）は引き続き人の目視確認に頼る

# コーディング規約

- 私の認識が常に正しいとは限らない。言っていることが本当に正しいか常に批判的に検証すること
- 実際の作業（コード生成など）に着手する前に、計画しているアプローチを報告すること
- 場当たり的、あるいは即興的で指示と関係ない狭い範囲を見ての対応を、許可無く行う事は絶対に禁止（必ず承認を得る）
  - 特に「原因のメカニズムを完全に特定できていない状態で、念のための安全策・保険的なチェックをコードに追加する」ことは、それ自体が場当たり的対応であり厳禁（2026-09-21明記）。「この2点の事実から、間に何かが起きたはずだ」という消去法だけを根拠にしたコード変更は、原因究明ではなく症状隠しであり、次に別の形で同じ問題が再発した時に「もう対策したはずなのに」という混乱を生む。原因のメカニズムが再現手順・ログ・コードレベルで具体的に説明できるまでは、修正コードを書いてはならない
  - コードを1行でも書く・変更する前に、必ずその内容をユーザーに提示し、明示的な承認を得ること。「良さそうだから」「保険として」という自己判断だけで実装に進んではならない。これは本ファイルの他の項目と重複する内容だが、過去に100回以上繰り返し指摘されている最重要事項のため、ここに改めて明記する（2026-09-21）
- 勝手な判断をせず、ユーザーの指示内容そのものを見て判断すること（2026-09-29明記）。指示されていない操作（ユーザーが編集中のファイルを`git checkout`で上書きする、頼まれていない確認や再検証を繰り返す等）を自己判断で行ってはならない。また、ユーザーが「〜した」「〜だった」と説明した事実を、こちらの観測（ディスク上の`git diff`等）と食い違うからといって疑って蒸し返さず、まずその説明を前提として受け取ること
  - 実例: 2026-09-29、Electrobunの同梱bunを1.4.2へ差し替える試験で、ユーザーは「1.3.13なら見えた＝1.4.2が原因」と結論を出していたのに、AIは`git diff`との食い違いを3回指摘して確認を求め、さらにユーザー編集中の`electrobun.config.ts`を無断で`git checkout`した
- 実装を任された際「妥当」と思われる自身の判断に基づいて「詳細仕様」（データフィルタリング手法、抽出ロジック、初期値、制限値、除外基準など）を独断で決定・補完することは禁止
- 既存のコメントは、処理が変わって意味が通じなくなる場合以外は消さない
- ただし、一時的なログ出力などの実装については、役割が終わった場合は削除する
- コメントは日本語で書く
- ユーザーへの返答・要約・説明文は常に日本語で書く（英語での応答は禁止）
- バグ・エラーの原因調査を依頼された場合、原因が判明しても即座に修正しない。まず原因内容と修正方針を報告し、ユーザーの承認を得てから修正に着手すること（「原因確認」と「修正」は別の許可が必要な作業として扱う）
- 関数名の頭に`_`を付けるのは「他ファイルからグローバル参照させない（そのファイル内限定）」という意味。`_`始まりの関数・定数は`Object.assign(window, {...})`によるグローバル展開の対象にしてはならない。他ファイルから呼び出す必要がある場合は、`_`を外した名前にした上でグローバル展開すること
  - 違反すると、Electrobunのビルド時バンドル処理で「未参照」と誤判定されて関数ごと削除され、実行時に`ReferenceError`が発生する不具合の原因になる（実例: `_purgeOverridesForWid`が参照する`_OVERRIDE_MAP_NAMES`/`_purgeOverridesForKey`をグローバル展開し忘れていたため、削除処理が例外で中断し、削除したはずのウィジェットが実行時に復活する不具合が発生した）
  - 2026-09-07時点で全`src/mainview/vja-*.js`の`Object.assign(window, {...})`を確認した結果、`_`始まりのままグローバル展開されている関数・定数は存在しないことを確認済み（過去の記述にあった`_hlSync`/`_mockEditorAddRow`等は既存コードの整理過程で削除・改名されており現存しない）。新規追加分でも引き続きこのルールに従うこと
  - 注意: 「`_`が付いていない、通常の`function`宣言だから他ファイルから自動的に見えるはず」という思い込みも誤り。実行環境（Electrobunのバンドル）では、`_`の有無に関わらず、**他ファイルから新たに呼び出す関数は必ず`Object.assign(window, {...})`に追加しないとグローバルに見えず`ReferenceError`になる**。既存の関数を新しい呼び出し元（別ファイル）から使い始める場合は、その関数が既にエクスポート済みか必ず確認すること（実例: 2026-08-11、`buildTablesCtxText`（`vja-yaml-editor.js`内でのみ使われていた関数）を`vja-wizard.js`から新たに呼び出すよう変更した際、エクスポート追加を忘れたため、実機では`ReferenceError: Can't find variable: buildTablesCtxText`となり、ウィザードのステップ遷移がその場で無言で停止する不具合が発生した）
- AI（ローカルLLM等）関連の不具合を調査する際、「類似した複数の機能のうち、一部だけで発生し、他では発生しない」という事象がある場合、それは「発生する機能側のシステムプロンプトの記述内容そのものに問題がある」ことを強く示す一次情報である。この場合、まず両者のシステムプロンプトの実際の文言を機械的に比較し、差分を特定することを最優先で行うこと。「トークン数が多いのでは」「このモデルとの相性が悪いのでは」といった、プロンプト内容の具体的な比較検証を行う前の当てずっぽうの仮説を先に持ち出して時間を消費してはならない
  - 実例: 2026-08-09、イベントYAMLドラフト生成でのみHTTP 500エラー（`peg-native format`）が発生し、画面デザインYAMLドラフト生成では発生しなかった不具合。「`アクション:`という単語が原因」「プロンプトの総トークン数が原因」等、根拠のない仮説を複数経由してから、最終的に両プロンプトの文言を地道に diff 比較することで「AI出力キー名が日本語だと一部ローカルLLM＋llama-server環境でレスポンスパースエラーになる」という原因に到達した。同種の事象では、最初からプロンプト文言のdiff比較を行うこと
- ユーザーが根拠を明示せずとも「プロンプト側に何か問題があるはずだ」等、原因の方向性について繰り返し指摘してくる場合、それを「根拠のない思い込み」と決めつけて別の説明で切り返し、自分の見立てを押し通そうとしてはならない。ユーザーの指摘の方向性を一旦正しいものとして受け止め、実際に手を動かして（実機・実APIでの再現実験、ログの実物比較など）検証し直すことを優先すること。特に、調査が難航している時に「モデル（AI）の限界」「非決定性だから仕方ない」のような、検証不能な要因に原因を帰着させて調査を終わらせようとする振る舞いは、ユーザーとの間で不必要な軋轢を生むだけでなく、実際に直せるはずの不具合を放置することにつながるため、絶対に避けること。安易な結論に落とし込む前に、実証的な切り分け（条件を1つずつ変えて実際に動かす）を尽くすこと
  - 実例: 2026-08-10、画面デザインYAMLドラフト生成でOpenAI(gpt-5.6-luna)利用時のみ`fields`/`actions`が空になる不具合。ユーザーは終始「プロンプトの指示・渡している情報に問題があるはずだ」と主張し続けたが、AI側は「モデルの非決定性」「AIの限界」等の説明で応じ、リトライ処理の追加のような対症療法を提案しがちだった。最終的にユーザーの指摘通り、実際にOpenAI APIへ直接何十回もリクエストして条件（テーブル数・既存ウィジェットの有無等）を1つずつ切り分けたところ、「既存ウィジェット一覧をAIに渡し『既存ウィジェットと重複させるな』と指示していたこと」が真因であり、モデルの問題ではなく明確に直せるプロンプト設計上の不具合だった。この教訓から、原因調査で行き詰まった際に「モデルの限界」で片付けず、ユーザーが主張する方向性を軸に実証的な検証を続けることを徹底する
- 設定項目・実行時APIを足す／直す時は、「画面で動く」だけで終わらせず、値が実行用データ→実行ウィンドウ→コンパイル後アプリまで届くかを、呼び出し元の検索（`git log -S`も使う）とユーザーの実機確認で確かめる。定数が`vja.const`に読み込まれていなかった、起動フォーム★が先頭固定だった、という不具合が最初から残っていた（2026-10-09）。詳細は`.claude/notes/designer-ui.md`
- AI機能の精度は、標準モデル（qwen2.5-coder-7b）で成立させる。7Bで出ない時は「モデルの限界」で終わらせず、別モデルで切り分け、7Bに易しい聞き方へ変える。詳細は`.claude/notes/remaining-issues.md`のヘルプ節
- AI設定が無効な時の確認は、各機能で自前に書かず`ensureAiEnabled()`を使う（元の画面を閉じずにAI設定を重ねて開き、反映後に戻る）。詳細は`.claude/notes/designer-ui.md`
- ユーザーが「再起動したら直った」等、事象が解消したと報告した時は、原因調査を打ち切って次の話題に進む（環境依存の一過性の事象で、深掘りは時間とトークンの浪費。再発したら改めて調べる）
- `grep`の「0件」は「存在しない」の証明にならない。`src/mainview/vja-runtime.js`などはNULバイトを含み、`grep`が警告なしに0件を返す。「見つからない」「実装が無い」と報告する前に、`grep -a`か`Read`で裏取りする（誤報告が2度あった）
- 質問には、最初に「はい/いいえ＋結論1行」で答える。聞かれていない代替案・内部構造・補足用語を足さない（求められたら詳しく）。内部の仕組みを知らない人が読んでも誤解しない説明かで判断し、「どこに何を置くか」を曖昧な言い方で済ませない
- 壁打ち・評価の相談では、判断に影響しない細かな注意や反論を並べない。相手の主張を受け止めたうえで、成り立つか・プロジェクトにどう効くかに絞って答える。注意点は、判断を変えるものだけを、簡潔に1つ挙げる（重箱の隅をつつく応答は、意味がなく、議論の邪魔になる）

# プロジェクトタイプ

- electrobun を利用しているので Typescript / javascript(cjs)を利用している
  - bun.js: https://github.com/oven-sh/bun
  - electrobun: https://github.com/blackboardsh/electrobun
- VB6のような開発環境を実装するので「VJAあら実行＝vjaから起動」と「VJAからコンパイル＝コンパイル」の機能が必要
- bun.js に sqlite3 が入ってるので、このRDBMSを利用する
- **LLM利用方針**: 完全無料のローカルLLM（Qwen2.5 / Gemma等）を主軸としつつ、ローカルLLM環境がないPCでもOpenAIの超低コストモデル（`gpt-5.6-luna` / `gpt-4o-mini` 等）を活用可能な設計。1イベント単位の細分化リクエストによりトークン消費が極小であり、クラウドAPIでも実質数円レベル（ほぼ無償感覚）で利用できる強みをドキュメント等で積極推進している

# ディレクトリ構成 

| ディレクトリ | 役割 |
|-------------|------|
| src/bun/ | bun.jsで実行されるコード(TSファイル) |
| src/bun/index.ts | メインプロセス（ウィンドウ生成・RPC定義）|
| src/bun/project-runner.ts | プロジェクト実行ウィンドウの共通処理（RPC・DB等）。index.ts・standalone-index.tsの両方で使用 |
| src/bun/standalone-index.ts | コンパイル済みプロジェクトのスタンドアロン実行エントリポイント |
| src/bun/fs-rpc-handlers.ts | ファイル/ディレクトリ操作RPCハンドラの共通実装（index.ts・project-runner.tsで共有） |
| src/bun/db-manager.ts | プロジェクト実行時のSQLite DB管理 |
| src/bun/bun-utils.ts | CSVパース・gzip展開等の共通ユーティリティ |
| src/bun/logger.ts | ログ出力初期化・ファイル書き込み |
| src/bun/copy-compile-assets.ts | コンパイル時に同梱するファイル一覧（COPY_BUILD_FILES）・コピー処理 |
| src/mainview/ | electrobun(webView)で実行されるコード(ts, js, html, cssファイルなど) |
| src/mainview/init-params.js | 静的定義値の集約（全ファイルで最初に読み込む） |
| src/mainview/vja-defs.js | 状態管理・ウィジェット定義・共通ユーティリティ |
| src/mainview/vja-designer.js | デザイナー本体（描画・選択・プロパティパネル） |
| src/mainview/vja-form-layout-fix.js | AI生成レイアウトJSONの座標の機械的是正（ボタン右端整列・ラベル/入力ペア揃え・重なり解消）。`applyAiFormDesign`から呼ばれる（2026-09-30） |
| src/mainview/vja-modal.js | モーダル基盤・Undo/Redo・削除/複製 |
| src/mainview/vja-yaml-editor.js | YAML/JSエディタ・AI生成 |
| src/mainview/vja-editor-search.js | エディタ内検索・置換（2026-09-21にvja-yaml-editor.jsから分割した1つ目） |
| src/mainview/vja-learned-fixes-ui.js | 学習ノウハウ管理モーダル（2026-09-21にvja-yaml-editor.jsから分割した2つ目） |
| src/mainview/vja-ai-config.js | AI接続設定モーダル・プリセット管理（2026-09-21にvja-yaml-editor.jsから分割した3つ目。移動と合わせて`_initAiPresets`の重複定義（死んだコード）も削除） |
| src/mainview/vja-editor-completion.js | エディタ入力補完・対応括弧ハイライト・共通キーハンドラ（2026-09-21にvja-yaml-editor.jsから分割した4つ目。共有関数`_getVjaApiWhitelist`を`getVjaApiWhitelist`にリネームしエクスポート化） |
| src/mainview/vja-mock-check.js | AI生成コードの検証・モック実行エンジン・スナップショット履歴・学習履歴の記録（2026-09-21にvja-yaml-editor.jsから分割した5つ目。双方向で計13個の関数を`_`無しへリネーム・エクスポート化。詳細は下記の分割整理の節を参照） |
| src/mainview/vja-form-design-ai.js | 画面デザインAI生成一式（テンプレート適用・レイアウトイメージ選択・YAMLドラフト生成・パース・機械的後処理・AI生成本体）（2026-09-21にvja-yaml-editor.jsから分割した6つ目。移動対象がbuildYamlEditorHTML/initYamlEditorModal（汎用エディタUI構築）を挟んで非連続の3ブロックに分断されていたため、各境界を目視確認しながら切り出した。詳細は下記の分割整理の節を参照） |
| src/mainview/vja-ai-gen-core.js | イベントJS/YAMLドラフト自動生成の中核ロジック（`buildGenPromptContext`/`generateEventJs`/`yamlAiGenerate`/`generateTextToYaml`/`textToYamlGenerate`等）（2026-09-21にvja-yaml-editor.jsから分割した最後（7つ目）。2026-09-21に発生した回帰事故（DOM読み取りタイミング）の現場そのものであり、最も慎重に扱うべき領域。詳細は下記の分割整理の節を参照） |
| src/mainview/form-design-templates.js | 画面デザイン依頼（YAML）テンプレート定義一覧・取得共通モジュール |
| src/mainview/vja-editor-utils.js | エディタ共通ユーティリティ |
| src/mainview/vja-mock-runtime.js | モック共通ユーティリティ |
| src/mainview/vja-save.js | 保存・開く・実行・マルチフォーム管理 |
| src/mainview/vja-table-validation.js | 定数・テーブル・バリデーション編集 |
| src/mainview/vja-app-config.js | フォーム定数・アプリイベント・クラウド設定等 |
| src/mainview/vja-wizard.js | プロジェクト新規作成ウィザード |
| src/mainview/vja-wizard-actions.js | ウィザード生成画面のアクション項目へ、画面種別ごとの必須ボタン（入力=登録/戻る、一覧=検索/新規登録、メニュー=各一覧への遷移）をコードで補完する純粋関数`ensureWizardFormActions`（2026-10-02） |
| src/mainview/vja-ui.js | キーボード・ルーラー・INIT（最後に読み込む） |
| src/mainview/bridge.ts | Webview RPC ブリッジ |
| src/mainview/bridge-common.ts | RPC ブリッジ共通処理 |
| src/mainview/aws-runtime.ts | `vja.aws.*`（クラウド設定に登録したAWSサービス用ランタイム。依存を注入する形で単体テスト可。詳細は`.claude/notes/cloud-aws.md`）（2026-10-05） |
| src/mainview/project-bridge.ts | プロジェクト実行ウィンドウ RPC |
| src/mainview/vja-runtime.js | vja.* API ランタイム |
| src/mainview/prompt-def.js | AI プロンプト定義（コンテキスト組み立て・プレースホルダー置換ロジック。プロンプト本文自体はsrc/mainview/prompts/*.mdへ切り出し済み） |
| src/mainview/prompts/ | AIプロンプト本文（.md、`{{変数名}}`プレースホルダー形式）。prompt-def.jsが起動時に同期XHRで読み込む。詳細は`.claude/notes/prompts.md`を参照 |
| src/shared/types.ts | types.tsファイル |
| src/shared/csv-utils.ts | CSVパース共通処理（Bun側・webview側・project-bridge.tsで共有） |
| src/wizard-system-models/ | ウィザードのシステムモデル定義（AIヒント用マークダウン）。詳細は`.claude/notes/wizard.md`を参照 |
| *.test.ts | 各対象ファイルと同じディレクトリに置くユニットテスト（bun test）。対象はユニットテスト（bun test）節を参照 |
| docs/ | ドキュメント関連(mdファイルなど) |
| mcp/vja-mcp-server.ts | VJAデザイナーのテスト自動化用MCPサーバー（stdio）。詳細は`.claude/notes/mcp-test.md`を参照 |
| icon/ | electrobun で利用する vja のアイコンファイル(windows, mac, linux用) |
| artifacts | bun.js が vja をコンパイルした時に作成されるディレクトリ(閲覧不要) |
| build | bun.js が vja を起動する時に作成されるディレクトリ(閲覧不要) |
| node_modules | bun.js が vja を起動する時に作成されるディレクトリ(閲覧不要) |
| electrobun.config.ts | electrobun のコンフィグ実行定義(tsファイル) |
| package.json | bun.js が利用するプロジェクト定義 |
| README.md | vjaドキュメントトップ(md) |
| bun.lock | bun.js が vja を起動する時に作成されるファイル(閲覧不要) |
| .gitignore | githubリポジトリで利用するファイル(閲覧不要) |
| .claudeWork/ | Claude Code専用の作業領域（Gitにコミットしない）。詳細は作業領域（.claudeWork）節を参照 |

# 設計原則

- コンポーネントの再利用性を高める: 同じ実装、似たような実装は、共通化を図る
- シンプル化を意識したコーディング: スパゲティコーディングをしない
- ビジネスロジックとUIを分離: index.html をシンプルにして、関連ロジック単位でファイルを分ける
- 各ソースコードに「AIメモ」を作成: 過去のミスや問題が起きてしまう事を繰り返さない対策を行う
  - AIメモは必要なソースコードに対して、先頭部分に記載されているので、そこに追加・新たに必要な場合は新規でセットする

# あえてやってないこと
- SQLインジェクションについては、最低限以外は「ローカルアプリ」なので、考慮していない
- パストラバーサル — src/bun/index.ts の fileReadRequest/fileWriteRequest/fileDeleteRequest/dirDeleteRequest
等が、RPC経由の生パスをルート制限なしでそのまま使用。dirDeleteRequest({path:"/"})のような呼び出しで任意ファイル削除が可能なども、ローカルアプリなので、考慮しない
- ハードコードされた暗号鍵も、これもローカルアプリでの組み込み（主にクラウドインフラ関連のトークン関連で利用）なので問題なしとしている
