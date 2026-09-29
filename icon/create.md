# アイコン作成

## windows版:

### image magickで実施(linux)
```sh
cd icon

convert vja_src.png -filter Lanczos \
  \( -clone 0 -resize 256x256 \) \
  \( -clone 0 -resize 128x128 \) \
  \( -clone 0 -resize 64x64 \) \
  \( -clone 0 -resize 48x48 \) \
  \( -clone 0 -resize 32x32 \) \
  \( -clone 0 -resize 16x16 \) \
  -delete 0 \
  -unsharp 0x0.75+0.75+0.00 \
  vja.ico
```

### image magick(linux)のインストール方法.
```sh
sudo apt update
sudo apt install imagemagick
```
