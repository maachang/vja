# アイコン作成

## windows版:

### image magickで実施(linux)
```sh
cd icon
convert vja.png -define icon:auto-resize=256,128,64,48,40,36,32,30,24,20,16 vja.ico
```

### image magick(linux)のインストール方法.
```sh
sudo apt update
sudo apt install imagemagick
```
