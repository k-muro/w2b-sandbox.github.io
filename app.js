const $ = (id) => document.getElementById(id);
const worker = new Worker(new URL("./search-worker.js", import.meta.url), { type: "module" });
let ready = false;

const modelName = $("modelName");
const modelMeta = $("modelMeta");
const cacheButton = $("cacheButton");
const cacheStatus = $("cacheStatus");
const downloadWrap = $("downloadWrap");
const downloadProgress = $("downloadProgress");
const downloadText = $("downloadText");
const searchButton = $("searchButton");
const searchWrap = $("searchWrap");
const searchProgress = $("searchProgress");
const searchText = $("searchText");
const resultTitle = $("resultTitle");
const elapsed = $("elapsed");
const message = $("message");
const results = $("results");

worker.postMessage({ type: "INIT", manifestUrl: "./data/manifest.json" });

worker.onmessage = ({ data }) => {
  switch (data.type) {
    case "READY": {
      ready = true;
      modelName.textContent = data.manifest.name;
      const bytes = formatBytes(data.manifest.vectorBytes + data.manifest.wordsBytes);
      modelMeta.textContent = `${data.manifest.vocabSize.toLocaleString()}語 / ${data.manifest.dim}次元 / ${bytes} / ${data.manifest.storage}`;
      searchButton.disabled = false;
      cacheButton.disabled = false;
      const hints = $("wordHints");
      hints.replaceChildren(...data.hints.map((word) => {
        const opt = document.createElement("option");
        opt.value = word;
        return opt;
      }));
      break;
    }
    case "CACHE_PROGRESS":
      downloadWrap.classList.remove("hidden");
      downloadProgress.value = data.percent;
      downloadText.textContent = `${data.loaded}/${data.total} ファイル (${data.percent}%)`;
      break;
    case "CACHE_DONE":
      downloadProgress.value = 100;
      downloadText.textContent = "保存完了";
      cacheStatus.textContent = "この端末に保存済み";
      cacheButton.textContent = "保存済み";
      cacheButton.disabled = true;
      break;
    case "SEARCH_PROGRESS":
      searchProgress.value = data.percent;
      searchText.textContent = `全語彙を探索中… ${data.percent}%`;
      break;
    case "RESULTS":
      renderResults(data);
      break;
    case "ERROR":
      showError(data.message);
      break;
  }
};

cacheButton.addEventListener("click", async () => {
  cacheButton.disabled = true;
  cacheStatus.textContent = "保存中…";
  if (navigator.storage?.persist) {
    await navigator.storage.persist().catch(() => false);
  }
  worker.postMessage({ type: "CACHE_MODEL" });
});

$("formulaForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!ready) return;
  message.classList.add("hidden");
  results.classList.add("hidden");
  elapsed.textContent = "";
  resultTitle.textContent = `${$("wordA").value} ＋ ${$("wordB").value} − ${$("wordC").value}`;
  searchWrap.classList.remove("hidden");
  searchProgress.value = 0;
  searchButton.disabled = true;
  worker.postMessage({
    type: "SEARCH",
    positive: [$("wordA").value.trim(), $("wordB").value.trim()],
    negative: [$("wordC").value.trim()],
    topN: Number($("topN").value)
  });
});

document.querySelectorAll("[data-formula]").forEach((button) => {
  button.addEventListener("click", () => {
    const [a, b, c] = button.dataset.formula.split("|");
    $("wordA").value = a;
    $("wordB").value = b;
    $("wordC").value = c;
    $("formulaForm").requestSubmit();
  });
});

function renderResults(data) {
  searchWrap.classList.add("hidden");
  searchButton.disabled = false;
  elapsed.textContent = `${(data.elapsedMs / 1000).toFixed(2)} 秒`;
  results.replaceChildren(...data.results.map(({ word, score }) => {
    const li = document.createElement("li");
    const center = document.createElement("div");
    center.innerHTML = `<div class="word"></div><div class="scorebar"><i></i></div>`;
    center.querySelector(".word").textContent = word;
    center.querySelector("i").style.width = `${Math.max(0, score) * 100}%`;
    const s = document.createElement("div");
    s.className = "score";
    s.textContent = score.toFixed(4);
    li.append(center, s);
    return li;
  }));
  results.classList.remove("hidden");
  if (data.results.length === 0) showError("結果がありません。");
}

function showError(text) {
  searchWrap.classList.add("hidden");
  searchButton.disabled = false;
  message.textContent = text;
  message.classList.remove("hidden");
  results.classList.add("hidden");
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / (1024 ** i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}
