# アイコン作成

## windows版:

### image magickで実施(linux)
```sh
cd icon

convert vja_src.png \
  \( -clone 0 -filter Lanczos -resize 256x256 \) \
  \( -clone 0 -filter Lanczos -resize 128x128 \) \
  \( -clone 0 -filter Lanczos -resize 64x64 \) \
  \( -clone 0 -filter Lanczos -resize 48x48 \) \
  \( -clone 0 -filter Lanczos -resize 32x32 \) \
  \( -clone 0 -filter Lanczos -resize 24x24 \) \
  \( -clone 0 -filter Lanczos -resize 16x16 \) \
  -delete 0 \
  vja.ico
```

### image magick(linux)のインストール方法.
```sh
sudo apt update
sudo apt install imagemagick
```
