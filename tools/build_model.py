#!/usr/bin/env python3
"""Convert a complete word2vec KeyedVectors model into GitHub Pages browser assets.

All vocabulary rows are retained. Vectors are L2-normalized and stored as exact
float32 shards; cosine rankings therefore use the original vector direction.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import numpy as np

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def write_assets(words, vectors, out_dir: Path, name: str, chunk_mb: int) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    dim = int(vectors.shape[1])
    vocab_size = len(words)
    words_file = out_dir / "words.txt"
    with words_file.open("w", encoding="utf-8", newline="\n") as f:
        for word in words:
            f.write(str(word).replace("\n", " ") + "\n")

    max_bytes = chunk_mb * 1024 * 1024
    rows_per_shard = max(1, max_bytes // (dim * 4))
    shards = []
    total_vector_bytes = 0

    for part, start in enumerate(range(0, vocab_size, rows_per_shard)):
        end = min(start + rows_per_shard, vocab_size)
        block = np.asarray(vectors[start:end], dtype=np.float32).copy()
        norms = np.linalg.norm(block, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        block /= norms
        path = out_dir / f"vectors-{part:05d}.f32"
        block.tofile(path)
        size = path.stat().st_size
        total_vector_bytes += size
        shards.append({
            "file": path.name,
            "start": start,
            "count": end - start,
            "bytes": size,
            "sha256": sha256(path),
        })
        print(f"wrote {path.name}: rows {start:,}..{end - 1:,} ({size / 1024 / 1024:.1f} MiB)")

    manifest = {
        "formatVersion": 1,
        "name": name,
        "vocabSize": vocab_size,
        "dim": dim,
        "dtype": "float32",
        "storage": "全語彙 / 正規化 float32 / ブラウザ内検索",
        "wordsFile": words_file.name,
        "wordsBytes": words_file.stat().st_size,
        "vectorBytes": total_vector_bytes,
        "shards": shards,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"done: {vocab_size:,} words, {dim} dims, "
          f"{(total_vector_bytes + words_file.stat().st_size) / 1024 / 1024:.1f} MiB")

def demo(out_dir: Path) -> None:
    words = ["王", "女", "男", "女王", "王妃", "父", "母", "東京", "日本", "フランス", "パリ", "皇帝", "皇后", "兄", "姉"]
    base = {
        "男": [0, 1, 0, 0, 0, 0],
        "女": [0, -1, 0, 0, 0, 0],
        "王": [1, 0, 1, 0, 0, 0],
        "父": [0, 1, 0, 1, 0, 0],
        "母": [0, -1, 0, 1, 0, 0],
        "東京": [0, 0, 0, 0, 1, 1],
        "日本": [0, 0, 0, 0, 1, 0],
        "フランス": [0, 0, 0, 0, -1, 0],
        "パリ": [0, 0, 0, 0, -1, 1],
        "皇帝": [1, 0.2, 1, 0, 0, 0],
        "兄": [0, 1, 0, .8, 0, 0],
        "姉": [0, -1, 0, .8, 0, 0],
    }
    def norm(v):
        a = np.array(v, dtype=np.float32)
        return a / np.linalg.norm(a)
    king = norm(base["王"])
    man, woman = norm(base["男"]), norm(base["女"])
    base["女王"] = norm(king + woman - man)
    base["王妃"] = norm(king + .8 * woman - .6 * man)
    base["皇后"] = norm(norm(base["皇帝"]) + woman - man)
    vectors = np.stack([norm(base[w]) for w in words])
    write_assets(words, vectors, out_dir, "同梱デモモデル（本番は変換後の日本語モデルに差し替え）", 45)

def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--model", help="word2vec-format model file")
    p.add_argument("--output", default="data", help="output data directory")
    p.add_argument("--name", default="日本語 Word2Vec（全語彙）")
    p.add_argument("--chunk-mb", type=int, default=45, help="max vector shard size")
    p.add_argument("--text", action="store_true", help="input is text word2vec format instead of binary")
    p.add_argument("--demo", action="store_true", help="write small bundled demo assets")
    args = p.parse_args()
    out = Path(args.output)

    if args.demo:
        demo(out)
        return
    if not args.model:
        p.error("--model または --demo が必要です")
    try:
        from gensim.models import KeyedVectors
    except ImportError:
        sys.exit("gensim が必要です: python -m pip install gensim numpy scipy")
    model = KeyedVectors.load_word2vec_format(
        args.model, binary=not args.text, unicode_errors="ignore"
    )
    write_assets(model.index_to_key, model.vectors, out, args.name, args.chunk_mb)

if __name__ == "__main__":
    main()
