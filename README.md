# ことばのベクトル計算機 — 完全ブラウザ版

日本語 Word2Vec の `A + B - C` 類似語検索を、API やサーバー計算なしで実行する GitHub Pages 用サイトです。

## 完成形の方式

- **全語彙を保持**：`build_model.py` は語彙削減をしません。
- **演算の精度を保持**：ベクトルを L2 正規化した `float32` として保存します。コサイン類似度では方向が同じなので、元モデルと同じ意味の順位計算になります。
- **巨大な一枚ファイルにしない**：ベクトルを既定 45 MiB 以下の shard に分割します。
- **計算は完全にブラウザ内**：Web Worker が全 shard を順番に走査します。
- **端末保存**：「モデルを端末に保存」で Cache Storage に全 shard を保存し、以後の検索は保存済みアセットを使えます。
- **メモリを使い切らない**：全モデルを RAM に展開せず、一つずつ shard を読みながら全語彙検索します。

同梱の `data/` は UI を直ちに確認するための極小デモモデルです。本番公開では、下記の手順で生成した日本語モデルの `data/` に差し替えます。

## 1. ローカルで起動

ファイルを直接開くのではなく HTTP サーバーを起動します。

```bash
python -m http.server 8000
```

ブラウザで `http://localhost:8000` を開きます。デモでは `王 + 女 - 男` の検索を試せます。

## 2. 日本語モデルを全語彙のまま変換

例：word2vec binary 形式の `entity_vector.model.bin` を用意した場合。

```bash
python -m pip install gensim numpy scipy
python tools/build_model.py   --model /path/to/entity_vector.model.bin   --output data   --name "日本語 Wikipedia エンティティベクトル（全語彙）"   --chunk-mb 45
```

変換後の `data/manifest.json`、`data/words.txt`、`data/vectors-*.f32` をそのまま公開対象へ含めます。

テキスト形式なら `--text` を追加します。

## 3. GitHub Pages へ公開

1. 新しい GitHub repository に本フォルダの内容を push。
2. Repository の **Settings → Pages** で、`Deploy from a branch`、`main` / `/ (root)` を選択。
3. 表示された Pages URL にアクセス。

巨大モデルでは `data/vectors-*.f32` が多数になります。各 shard を 45 MiB 以下にしているため、通常の Git push でも単一ファイルの巨大化を避けられます。

## 実データ容量の確認

`manifest.json` の `vectorBytes + wordsBytes` が公開モデル本体のサイズです。例えば 200 次元ではベクトル本体はおおよそ次の式です。

```text
語彙数 × 200 × 4 byte
```

50万語なら約 381 MiB、100万語なら約 763 MiB（語彙ファイル分は別）です。GitHub Pages の公開サイト全体 1 GB 制限に収まるモデルのみ、そのまま Pages で公開できます。

## 本番上の判断

- **1 GB 以下**：この完成形のまま GitHub Pages で公開。
- **1 GB 超**：語彙を削らない要件のままでは GitHub Pages に置けません。静的サイト部分は Pages のまま、モデル shard の配信先だけ Cloudflare R2 / S3 などへ移し、`manifest.json` の URL を絶対 URL に変更する構成にします。計算は引き続きブラウザ内です。
- **アクセスが多い**：モデル全体を各ユーザーが一度ダウンロードするため、配信帯域に注意してください。

## ファイル構成

```text
index.html
styles.css
app.js
search-worker.js
.nojekyll
data/
  manifest.json
  words.txt
  vectors-00000.f32 ...
tools/
  build_model.py
```

## モデルについて

学習済みモデルの再配布可否は、採用するモデルの配布条件を確認してください。この ZIP はモデル本体を同梱せず、デモデータと変換コードのみを含みます。
