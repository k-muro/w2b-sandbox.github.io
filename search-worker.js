let manifest;
let manifestUrl;
let words = [];
let wordToId = new Map();
const memoryShards = new Map();
const CACHE_NAME = "word-vector-assets-v1";

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "INIT") await init(data.manifestUrl);
    if (data.type === "CACHE_MODEL") await cacheModel();
    if (data.type === "SEARCH") await search(data.positive, data.negative, data.topN);
  } catch (error) {
    self.postMessage({ type: "ERROR", message: error.message || String(error) });
  }
};

async function init(url) {
  manifestUrl = new URL(url, self.location.href);
  manifest = await fetchJSON(manifestUrl);
  const text = await fetchText(assetUrl(manifest.wordsFile));
  words = text.trimEnd().split("\n");
  if (words.length !== manifest.vocabSize) throw new Error("語彙ファイルの件数が manifest と一致しません。");
  words.forEach((word, i) => wordToId.set(word, i));
  const preferred = ["王", "女", "男", "女王", "父", "母", "東京", "日本", "フランス"];
  const hints = preferred.filter((w) => wordToId.has(w));
  self.postMessage({ type: "READY", manifest, hints });
}

async function cacheModel() {
  const assets = [manifest.wordsFile, ...manifest.shards.map((s) => s.file)];
  for (let i = 0; i < assets.length; i++) {
    await fetchBuffer(assetUrl(assets[i]), true);
    const percent = Math.round(((i + 1) / assets.length) * 100);
    self.postMessage({ type: "CACHE_PROGRESS", loaded: i + 1, total: assets.length, percent });
  }
  self.postMessage({ type: "CACHE_DONE" });
}

async function search(positive, negative, topN) {
  const started = performance.now();
  const tokens = [...positive, ...negative];
  const missing = tokens.filter((word) => !wordToId.has(word));
  if (missing.length) throw new Error(`モデルにない単語です: ${missing.join("、")}`);
  const ids = tokens.map((word) => wordToId.get(word));
  const excluded = new Set(ids);
  const query = new Float32Array(manifest.dim);

  for (const word of positive) addInto(query, await vectorAt(wordToId.get(word)), 1);
  for (const word of negative) addInto(query, await vectorAt(wordToId.get(word)), -1);
  normalizeInPlace(query);

  const top = [];
  for (let shardIndex = 0; shardIndex < manifest.shards.length; shardIndex++) {
    const shard = manifest.shards[shardIndex];
    const data = await loadShard(shard);
    for (let local = 0; local < shard.count; local++) {
      const id = shard.start + local;
      if (excluded.has(id)) continue;
      const offset = local * manifest.dim;
      let score = 0;
      for (let d = 0; d < manifest.dim; d++) score += query[d] * data[offset + d];
      offer(top, { id, score }, topN);
    }
    self.postMessage({
      type: "SEARCH_PROGRESS",
      percent: Math.round(((shardIndex + 1) / manifest.shards.length) * 100)
    });
  }
  top.sort((a, b) => b.score - a.score);
  self.postMessage({
    type: "RESULTS",
    results: top.map((x) => ({ word: words[x.id], score: x.score })),
    elapsedMs: performance.now() - started
  });
}

async function vectorAt(id) {
  const shard = manifest.shards.find((item) => id >= item.start && id < item.start + item.count);
  if (!shard) throw new Error("ベクトルが見つかりません。");
  const data = await loadShard(shard);
  const offset = (id - shard.start) * manifest.dim;
  return data.subarray(offset, offset + manifest.dim);
}

async function loadShard(shard) {
  if (memoryShards.has(shard.file)) return memoryShards.get(shard.file);
  const buffer = await fetchBuffer(assetUrl(shard.file), false);
  const array = new Float32Array(buffer);
  if (array.length !== shard.count * manifest.dim) throw new Error(`${shard.file} のサイズが不正です。`);
  // 入力語が入ったシャードだけをメモリ保持。全探索中の巨大メモリ化を避ける。
  return array;
}

function addInto(target, source, sign) {
  for (let i = 0; i < target.length; i++) target[i] += sign * source[i];
}
function normalizeInPlace(v) {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (!norm) throw new Error("計算結果がゼロベクトルです。");
  for (let i = 0; i < v.length; i++) v[i] /= norm;
}
function offer(top, candidate, n) {
  if (top.length < n) {
    top.push(candidate);
    top.sort((a, b) => a.score - b.score);
  } else if (candidate.score > top[0].score) {
    top[0] = candidate;
    top.sort((a, b) => a.score - b.score);
  }
}
function assetUrl(relative) {
  return new URL(relative, manifestUrl).href;
}
async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`読み込み失敗: ${url}`);
  return response.json();
}
async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`読み込み失敗: ${url}`);
  return response.text();
}
async function fetchBuffer(url, forceCache) {
  const cache = "caches" in self ? await caches.open(CACHE_NAME) : null;
  if (cache) {
    const cached = await cache.match(url);
    if (cached) return cached.arrayBuffer();
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ベクトル取得失敗: ${url}`);
  if (cache && forceCache) await cache.put(url, response.clone());
  return response.arrayBuffer();
}
