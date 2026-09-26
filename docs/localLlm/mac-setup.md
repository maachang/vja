# Apple Silicon Mac で vja をセットアップする

Apple Silicon Mac（M1以降）でvjaを起動する際、npm配布のElectrobun CLIバイナリのコード署名が壊れているため、そのままでは起動できない場合があります。本ドキュメントでは、この問題への対処方法と、専用セットアップスクリプト `setup-mac.sh` の使い方を説明します。

## 背景

npm配布のElectrobun（v1.18.1時点）のCLIバイナリ（`node_modules/electrobun/bin/electrobun`）は、GitHubリリース物（`electrobun-cli-darwin-arm64.tar.gz`）自体のコード署名が壊れています（`codesign --verify`で`invalid signature`）。

- macOS 27.0では、この署名破損のあるバイナリを実行すると起動直後にOSからSIGKILL（exit 137）されます
- `bun run dev`はこのkillを拾えず`exit 0`で終了するため、何もエラーが出ないまま起動に失敗し、原因が分かりにくくなっています

対処法は、CLIバイナリをad-hoc署名（`codesign --force --sign -`）で再署名することです。これによって起動できるようになることを確認済みです。

## `setup-mac.sh` の使い方

プロジェクト直下に、上記の再署名処理を含めて自動化したセットアップスクリプトを用意しています。Macでは `bun install` の代わりにこちらを実行してください。

```bash
bash setup-mac.sh
```

このスクリプトは以下を順に行います。

1. `bun install` で依存パッケージをインストール
2. Electrobun CLIバイナリが未ダウンロードの場合、一度実行してダウンロードさせる（署名が壊れているためこの実行自体はkillされるが、ダウンロード自体は完了する）
3. CLIバイナリ（`node_modules/electrobun/bin/electrobun` と `.cache/` 配下のコピー）をad-hoc再署名
4. 再署名後に起動確認を行い、成功すれば完了メッセージを表示

セットアップが完了したら、通常どおり以下で開発モード起動できます。

```bash
bun run dev
```

## 再実行が必要になるケース

CLIバイナリはnpmパッケージには含まれておらず、`electrobun`コマンドの初回実行時に `bin/` と `.cache/` へダウンロードされます。そのため、以下のように `node_modules/electrobun` が入れ直された場合は再署名が消えるため、`setup-mac.sh` を再実行してください。

- `bun install` によるパッケージの再インストール
- Electrobunのバージョン変更
- `node_modules` の削除・再構築

なお、`bun run dev`時に自動ダウンロードされるcoreバイナリ（`dist-macos-arm64/`のbun・launcher等）は署名が正常であり、再署名は不要です。

## ローカルLLM環境のセットアップ

上記はvja本体（Electrobun）の起動に関する対処です。Apple Silicon Mac上でローカルLLM（mlx-lm）を動かしたい場合は、別ドキュメントの [Mac向けローカルLLMセットアップ](mac-mlx-lm-setup.md) を参照してください。
