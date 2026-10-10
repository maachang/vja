<!-- CLAUDE.md から分離したノート（2026-09-29）。内容は分離前の記述をそのまま移したもの。 -->

# 既知の制約

- **同梱bunを1.4.2へ上げており、Electrobun 1.18.1へのパッチ（`patches/electrobun@1.18.1.patch`）が必須**（2026-09-29）
  - **経緯**: Electrobun 1.18.1が同梱するbunは1.3.13（`node_modules/electrobun/dist/api/shared/bun-version.ts`、`build.bunVersion`で上書き可能）。この1.3.13で、約88分稼働後に`Segmentation fault at address 0x10`（bunのクラッシュ）が1回発生したため、新しいbun（システムのbunは1.4.2）を試した。**このsegfaultが1.4.2で直るかは未検証**（再現手順も不明）。Electrobunの最新2.0.1は、Linuxの`bun run dev`が起動時に`SyntaxError`で落ちたため使えず、1.18.1に固定している（`package.json`は`"electrobun": "1.18.1"`の完全固定）
  - **`bunVersion`を1.4.2にするだけでは壊れる**: bun 1.4系では`JSCallback`の`FFIType.cstring`引数が、1.3.x（ポインタ数値）と違い変換済みのJS文字列で渡される。Electrobunの`dist/api/bun/proc/native.ts`は`new CString(引数)`でポインタ前提のため`TypeError: ptr must be a number`になる。webview→bunのRPCは通常WebSocket経由（正常）だが、WebSocketが開く前の起動直後のメッセージは`postMessage`（`bunBridgePostmessageHandler`）へフォールバックするため、そこで失敗して捨てられる。実際に、起動時に呼ぶ`loadUiConfigRequest`（UI設定）と`loadAiGlobalPresetsRequest`（AI接続設定の「プロジェクト共通」プリセット）が読み込まれず、プリセット一覧が空になる不具合が出た（ユーザーが1.3.13に戻すと表示されることで確認）。ログには`Error converting strings`/`error sending message to bun`/`error in eventBridgeHandler`が出る
  - **対応**: `native.ts`に`_cstr()`（文字列ならそのまま、ポインタなら`CString`で読む）を追加し、`JSCallback`内の`new CString(引数)`10箇所を置き換えた（1.3.13/1.4.2の両方で動く後方互換）。これを`bun patch`で`patches/electrobun@1.18.1.patch`へ永続化し、`package.json`の`patchedDependencies`に登録している
  - **`compileProject`（vjaで作ったプロジェクトのコンパイル）にも同じ対応**: 生成する`package.json`でElectrobunを1.18.1に固定（以前は`latest`）、`patchedDependencies`とパッチファイル（`patches/`）を同梱、生成する`electrobun.config.ts`に`bunVersion`を指定する。バージョン・パッチ名は`src/bun/copy-compile-assets.ts`の`ELECTROBUN_PIN_VERSION`/`ELECTROBUN_BUN_VERSION`/`ELECTROBUN_PATCH_FILE`に集約し、vja本体の`electrobun.config.ts`と共有している。ビルド後のvjaが参照できるよう、パッチは`build.copy`で`Resources/app/patches/`へ同梱する
  - **バージョン表示**: vja起動ログ・コンパイル済みアプリの起動ログ・「ファイル→バージョン情報」に、実行中のbun（`Bun.version`）と実際にインストールされたElectrobun（`electrobun/package.json`のimport）のバージョンを出す。想定外のbunで動いていないかの確認に使う
  - **注意（運用）**:
    - Electrobunのバージョンを上げるとパッチは当たらなくなる（ファイル名も`@1.18.1`固定）。新しいElectrobunがbun 1.4系に対応済みならパッチ不要、未対応なら作り直す。`bunVersion`を上げる場合も同様にJSCallbackの型変更に対応済みか確認すること
    - `node_modules/electrobun`のファイルをその場で直接編集してはならない。bunのキャッシュ（`~/.bun/install/cache/electrobun@1.18.1@@@1`）とハードリンクされており、同じバージョンを使う他プロジェクト（コンパイル先プロジェクトの`node_modules`等）のファイルまで書き換わる（実際に発生し、原本に戻して復旧した）。修正は`bun patch electrobun`→編集→`bun patch --commit 'node_modules/electrobun'`の手順で行う
    - `bun.lock`はgit管理外
  - 検証状況: vja本体（dev）は1.4.2で起動しエラー無し・`bun test`全件通過。1.3.13でも同様に動作。コンパイル先プロジェクトの同梱bunが1.4.2になることはユーザー実機で確認済み

- **Electrobun 2.0.1は起動不能のため使わない（1.18.1に固定）**（2026-08-27確認、2026-09-29にも再確認）: `electrobun@2.0.1`は、ビルドツールが`Hutch`（内部JSランタイム`Cottontail`）に刷新されており、`electrobun.config.ts`から**別のローカル`.ts`ファイルを1つでもimportすると、内容を問わず`error: SyntaxError`（詳細メッセージなし）で起動できない**。`export const A = 1;`だけの空に近いファイルのimportでも再現し、`~/.hutch`を削除してクリーン再インストールしても再現する（キャッシュ破損ではない）。vjaの`electrobun.config.ts`は`./src/bun/copy-compile-assets`をimportしており該当する。config内へ全設定を直書きしてimportを使わなければ動く。Linuxだけでなく、Windows x64でも同様に起動しなかった（2026-08-28報告）。2026-08-27に`bun update`で1.18.1から2.0.1へ意図せず上がって発覚したため、`package.json`の`electrobun`は`"latest"`ではなく`"1.18.1"`へ明示固定している
  - **運用**: バージョンを上げる場合は、事前に動作確認してから明示的に切り替える（latest追従はしない）。Electrobun関連のエラー調査では、まず`node_modules/electrobun/package.json`のバージョンを確認し、既知の不具合パターンと照合する
  - **旧`build/`の残骸**: 一度Electrobun 2で実行してから1.18.1へ戻し`bun install`しても、`bun x electrobun dev`が`error: SyntaxError`のままになる事象があった（`node_modules`側は1.18.1に戻っていた）。Electrobun 2の実行時に生成された`build/`配下（`build/dev-linux-x64`等、gitignore対象の生成物）が残り、1.18.1のdevがそれを読んで失敗したと推定される（原因は未確定）。`build/`を削除して再実行すると解消した

- **Linuxで起動しない時は、Electrobunを疑う前に環境側の破損も切り分ける**（2026-09-24）: vjaがLinuxで起動しなくなった事象の原因は、Electrobunのバグではなく**フォントファイルの破損**だった。再構築（再インストール等）で起動を確認できた。同様の事象では、Electrobunのバージョン起因を疑う前に、フォントファイル等の環境側の破損も切り分けの候補に含めること

- **M2 Mac Air（macOS 27系）で`bun x electrobun dev`がログも出さず即終了する（未解決・原因未特定）**（2026-09-24時点）: メッセージが出た直後にアプリが終了し、エラーログも出ない。動作確認済みはWindows 11とM1 Mac（macOS Sonoma）で、問題が出るのはM2 Mac Air（macOS 27系）のみ。他機との違いとして、bunを`brew install bun`（Homebrew経由）で入れている点も挙がっている（他機の導入方法は未確認）。Electrobunは1.18.1固定。**上の「macOSで`bun run dev`が何も出力せず即終了する（CLIバイナリの署名破損）」と同一の事象かは未確認**。M1 Macで問題がないことから、Apple Siliconの世代差よりOSバージョンの違いが疑わしいが、決め打ちせず、実際のログ・再現手順を確認してから原因を特定すること

- **Foundry Localは0.8.119.102に固定する**（2026-09-26）: Windows/Snapdragon X向けローカルLLMのセットアップ手順`docs/localLlm/win-foundry-setup.md`は、Foundry Local 0.8.119.102を対象バージョンとして固定している（`winget install Microsoft.FoundryLocal --version 0.8.119.102`で明示指定）。0.10.3では、NPUで動作しない・ドキュメント記載のコマンド体系（`foundry model`/`foundry service`等）が変更されている、という問題を確認済み。そのため、検証結果が出るまでは最新版への更新を案内せず、手順書・案内は0.8.119.102のままにする

- **Foundry Local 0.11.0は、日本語の返答が文字化けする**（2026-10-10確認）: UTF-8の0x80以上のバイトが「U+FF00＋バイト値」の文字（例: ロ=E3 83 AD → `￣ﾃﾭ`）で返る。ASCIIは正常で、送信側（vja→Foundry）は問題ない。vjaは`fixByteMojibake()`（`vja-ai-gen-core.js`）で、`runAiGenerate`/`aiChatOnce`の返答を自動で検出して戻す（U+FF80〜FFEFの連続のうちUTF-8として戻せるものだけ。化けていなければ何もしない。復元時はデバッグログに1行出る）。0.8.119.102に戻せば発生しないため、この固定も有効。0.11.0の根本の修正はFoundry Local側の問題。

- **Snapdragon X（Win11 ARM64）では動作する**（2026-10-07再確認）: 以前はElectrobunのBunがx64版（エミュレーション）で動くことに起因する不安定さがあったが、最近のWin11 ARM64では解消しており、何度起動・操作しても再現しない（2026-09-25報告、2026-10-07再確認）。x86版Bunの導入手順も不要。**ドキュメントや説明に、不安定さ・未対応・エミュレーション問題を欠点として書かない**（過去の経緯も含む。AIがドキュメントを読んで過去の不安定さを欠点として拾うのを避けるため）。README.mdの「動作環境」は「Snapdragon X（ARM64）でも動作します」の1行のみ

- **macOSで`bun run dev`が何も出力せず即終了する（Electrobun CLIバイナリの署名破損）**（2026-09-24、macOS 27.0で確認）: npm配布のElectrobun(v1.18.1)のCLIバイナリ（`node_modules/electrobun/bin/electrobun`）は、GitHubリリース物（`electrobun-cli-darwin-arm64.tar.gz`）自体のコード署名が壊れており（`codesign --verify`で`invalid signature`）、起動直後にOSからSIGKILL(exit 137)される。`bun run dev`側はこれを拾えずexit 0で終了するため原因が見えにくい。ad-hoc再署名（`codesign --force --sign -`）で起動できることを確認済み。Macでは`bun install`の代わりにプロジェクト直下の`setup-mac.sh`でセットアップする（bun install→CLIバイナリ未ダウンロードなら取得→`bin/`と`.cache/`の両方を再署名→起動確認）
  - CLIバイナリはnpmパッケージに含まれず、`electrobun`コマンド初回実行時に`electrobun.cjs`が`bin/`・`.cache/`へダウンロードする（`bin/electrobun`が存在すれば再ダウンロードしない）。そのため`node_modules/electrobun`が入れ直された場合（再インストール・electrobunのバージョン変更等）は再署名が消えるので、`setup-mac.sh`を再実行すること
  - `bun run dev`時に自動ダウンロードされるcoreバイナリ（`dist-macos-arm64/`のbun・launcher等）は署名が正常で、再署名不要であることを確認済み

- **Linuxのアイコン対応は行わない方針**（2026-09-29決定）: Linuxはディストリビューション（デスクトップ環境）ごとにアイコンの設定方法が異なり（例: Linux Mintでは`.desktop`ファイルの`Icon=`指定）、vjaの主な利用者はWindows/Macと想定されるため、vja側では対応しない。Linuxでアイコンを付けたい利用者が自分で`.desktop`を標準位置（`~/.local/share/applications/`等）へ配置し、`Icon=`に絶対パスを指定すれば対応できる。以下は、その判断の根拠となった調査内容
- **Linux開発実行時のタスクバーアイコンが反映されない**: `electrobun.config.ts`の`build.linux.icon`設定・アイコンファイルのコピー自体は正しく行われている（`Resources/appIcon.png`等に反映済み）ことを確認済み。しかしElectrobunが生成する`.desktop`ファイルの`Icon=`指定がファイル名のみ（絶対パスでない）であり、Linuxデスクトップ環境は`.desktop`ファイルが`~/.local/share/applications/`等の標準位置にインストールされ、アイコンもXDGアイコンテーマの検索パス上に見つかる場合のみタスクバー表示に反映する仕様。`bun run dev`（未インストールの開発実行）の`build/dev-linux-x64/`配下に生成される`.desktop`ではこの条件を満たさないため、タスクバーアイコンが変わらないのはVJA側の設定不備ではなくElectrobunのdev実行時の制約と推定される（未確認）。`bun run build`でパッケージング・インストールした状態、または別のLinuxデスクトップ環境で実際に変わるか要確認。

- **Windowsで`.exe`へのアイコン埋め込みが失敗する（Electrobun本体のバグ）→ postBuildフックで回避済み**（2026-09-29、Windows実機でアイコン表示を確認済み）: Electrobun本体のCLI（`electrobun build`の実体は`node_modules/electrobun/.cache/electrobun`という**コンパイル済みバイナリ**）が`rcedit`モジュールを、ビルド元CIマシン上の絶対パス（`D:\a\electrobun\electrobun\package\node_modules\rcedit`）でrequireするようハードコードしているため、`build.win.icon`を指定しても`Failed to embed icon into launcher.exe: ResolveMessage: Cannot find module ...`となり埋め込まれない。CLIはコンパイル済みバイナリのため`bun patch`では直せない
  - **回避策**: Electrobunの`scripts.postBuild`フック（アプリ本体の生成後・圧縮/パッケージング前に実行される）で`scripts/win-embed-icon.ts`を実行し、プロジェクトの`node_modules/rcedit`を直接呼んで`<ビルド先>/<アプリ名>/bin/`の`launcher.exe`/`bun.exe`へ`icon/vja.ico`を埋め込む。Windows以外では何もしない。失敗してもビルドは止めない（警告のみ）
  - 適用先: vja本体（`electrobun.config.ts`の`scripts.postBuild`）と、`compileProject`が生成するプロジェクト（スクリプトと`icon/vja.ico`を生成先へ配置し、生成する`electrobun.config.ts`にも`scripts.postBuild`を記述）の両方。ビルド後のvjaから`compileProject`が参照できるよう、`electrobun.config.ts`の`build.copy`で`scripts/win-embed-icon.ts`と`icon/vja.ico`を`Resources/app/`へ同梱している
  - `build.win.icon`（Electrobun本体のアイコン設定）は、壊れている処理を通らないよう引き続きコメントアウトのままにする（`electrobun.config.ts`・`compileProject`の生成config）。これらのコメントにある「Electrobun側修正後に復活させること」は、Electrobun本体が修正された場合に、フックを廃止して`build.win.icon`へ戻すという意味
  - **Macは`build.mac.icons`（`icon/icon.iconset`）を有効化するだけで対応済み**（2026-09-29、Mac実機でアイコン表示を確認済み）: Electrobun本体がmacOS上のビルド時に`iconutil`で`.iconset`を`AppIcon.icns`へ変換して埋め込む（`rcedit`は使わないためWindowsのバグの影響を受けない）。vja本体（`electrobun.config.ts`）と`compileProject`の生成config（`icon/icon.iconset`も生成先へコピー）の両方で有効。`build.copy`で`icon/icon.iconset`を`Resources/app/`へ同梱している。Linuxからのクロスビルドでは`iconutil`が無く警告のみでアイコン無しになる
  - Linuxのアイコンは対応しない方針（下記の「Linuxのアイコン対応は行わない方針」を参照）

- **デザイナーでは`window.marked`/`window.QRCode`が未定義になる（Bunバンドラがライブラリをモジュール化するため）**（2026-10-09）: `index.html`の`<script src="marked.umd.js">`・`qrcode.js`は、Electrobunのビルド/devでBunのバンドラがモジュール化し、グローバルに公開されない。その結果markdownウィジェットは生のmdのまま、QRウィジェットは🔲プレースホルダのままだった。
  - **対策**: `vja-defs.js`の`ensureWebviewLib(src, globalName)`が素の`<script>`を動的に追加して読み込む（失敗しても解決する）。`vja-ui.js`のINIT末尾で`marked`/`qrcode`を読み込み、終わったらmarkdown/QRウィジェットを`renderWidget`で再描画。`vja-help.js`の`openHelp`も同関数を使う。`electrobun.config.ts`の`build.copy`に`marked.umd.js`と`qrcode.js`の両方を登録する。
  - 新しい外部ライブラリをwebviewのグローバルとして使う時も同様に`ensureWebviewLib`経由にすること。`ensureWebviewLib`は`Object.assign(window,{...})`への追加が必要（コメント中の同名文字列を置換して公開漏れを起こした実例あり。`openHelp`が無言でハングした）。
  - 確認: `testGetWidgetHtml`が`libs:{marked,QRCode}`を返す
