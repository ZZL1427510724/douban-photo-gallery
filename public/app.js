// app.js — dark gallery frontend.
//
// API_BASE: same origin by default (Worker + Static Assets in one deploy).
// GitHub Pages mode: set window.DOUBAN_WORKER_URL to your Worker address,
// e.g. window.DOUBAN_WORKER_URL = "https://douban-photo-gallery.<you>.workers.dev"
// (or add ?api=https://... to the page URL once; it is remembered).
const params = new URLSearchParams(location.search);
const savedApi = localStorage.getItem("douban-worker-url") || "";
if (params.get("api")) localStorage.setItem("douban-worker-url", params.get("api"));
const API_BASE = (window.DOUBAN_WORKER_URL || localStorage.getItem("douban-worker-url") || "").replace(/\/$/, "");

const BATCH = 30; // ZIP batch size — matches the server's 30-per-ZIP limit
const DEFAULT_PERSON = { name: "李妍锡", celebrityId: "1427992", personageId: "34914546" };

const $ = (id) => document.getElementById(id);
const state = {
  person: null,
  photos: [],
  total: 0,
  lightboxIndex: 0,
  downloading: false,
  doneBatches: new Set(),
};

function api(path) {
  return API_BASE + path;
}

async function apiJson(path) {
  const res = await fetch(api(path));
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `请求失败 ${res.status}`);
  return data;
}

function setStatus(text, isError = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("error", isError);
}

function imageUrl(photo, size = "thumb") {
  // Thumbs go through the image proxy (sets the Douban Referer). API_BASE
  // is empty for a same-origin backend (Vercel / Workers) — that still
  // means "use the proxy", NOT "load the Douban URL directly": direct
  // /view/photo/ URLs are blocked by Douban's hotlink protection (403/418)
  // in browsers, which is exactly why most tiles were broken.
  const direct = size === "large" ? photo.large : photo.thumb;
  return api("/api/image?url=" + encodeURIComponent(direct));
}

function renderPerson() {
  const p = state.person;
  if (!p) return;
  $("person-card").classList.remove("hidden");
  $("person-avatar").src = p.avatar || "";
  $("person-avatar").alt = p.name;
  $("person-name").textContent = p.name;
  $("person-meta").textContent = `共 ${state.total || p.photoTotal || "?"} 张 · 已显示 ${state.photos.length} 张`;
  $("person-link").href = p.doubanUrl || "#";
  $("download-all").disabled = state.downloading || state.photos.length === 0;
}

function renderGallery() {
  const g = $("gallery");
  g.innerHTML = "";
  state.photos.forEach((photo, i) => {
    const fig = document.createElement("figure");
    fig.innerHTML = `<img loading="lazy" src="${imageUrl(photo)}" alt="照片 ${i + 1}" data-retry="0" onerror="retryImage(this)">
      <figcaption>${escapeHtml(photo.author || "")} · ♥ ${photo.likes} · 💬 ${photo.comments}<br>${escapeHtml(photo.created || "")}</figcaption>`;
    fig.onclick = () => openLightbox(i);
    g.appendChild(fig);
  });
  $("more-wrap").classList.toggle("hidden", state.photos.length >= state.total);
  renderPerson();
}

// A tile that fails to load (e.g. Douban throttled the burst of parallel
// image requests) reloads itself a few times with a growing delay instead
// of staying a broken tile.
window.retryImage = function (img) {
  const n = parseInt(img.dataset.retry || "0", 10);
  if (n >= 3) { img.onerror = null; return; }
  img.dataset.retry = String(n + 1);
  const base = img.getAttribute("src").split("&r=")[0];
  setTimeout(() => { img.src = base + "&r=" + Date.now(); }, 400 * (n + 1));
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadPerson(input, { refresh = false } = {}) {
  setStatus("正在解析人物…");
  let person;
  try {
    const data = await apiJson(`/api/resolve?input=${encodeURIComponent(input)}`);
    person = data.person;
  } catch (e) {
    // Live fetch unavailable (e.g. seed-only GitHub Pages): fall back to
    // the bundled seed data for the default person.
    if (String(input).includes("34914546") || String(input).includes("1427992")) {
      person = await loadSeedPerson();
    } else {
      throw e;
    }
  }
  state.person = person;
  state.photos = [];
  state.total = person.photoTotal || 0;
  state.doneBatches = new Set();
  saveHistory(person);
  renderHistory();
  await loadMore(true);
  return person;
}

async function loadSeedPerson() {
  const res = await fetch("data/photos-1427992.json");
  if (!res.ok) throw new Error("种子数据也加载失败");
  const seed = await res.json();
  state.total = seed.total;
  state.photos = seed.photos.map((p, i) => ({ ...p, seq: i }));
  state.person = seed.person;
  setStatus(`已用内置种子数据加载 ${seed.person.name}（${seed.total} 张），实时接口不可用时可先看这些照片。`);
  renderGallery();
  return seed.person;
}

async function loadMore(first = false) {
  const p = state.person;
  if (!p) return;
  setStatus(first ? "正在取照片…" : "正在加载更多…");
  try {
    const data = await apiJson(
      `/api/photos?celebrityId=${p.celebrityId}&start=${state.photos.length}&count=50`,
    );
    state.total = data.total;
    const base = state.photos.length;
    data.photos.forEach((ph, i) => state.photos.push({ ...ph, seq: base + i }));
    setStatus("");
    renderGallery();
  } catch (e) {
    if (first && p.celebrityId === DEFAULT_PERSON.celebrityId) {
      await loadSeedPerson();
    } else {
      setStatus(`加载照片失败：${e.message}`, true);
    }
  }
}

// ---------- lightbox ----------
function openLightbox(i) {
  state.lightboxIndex = i;
  updateLightbox();
  $("lightbox").classList.remove("hidden");
}
function updateLightbox() {
  const photo = state.photos[state.lightboxIndex];
  if (!photo) return;
  const img = $("lightbox-img");
  img.dataset.retry = "0";
  img.onerror = () => retryImage(img);
  img.src = imageUrl(photo, "large");
  img.alt = `照片 ${state.lightboxIndex + 1}`;
  $("lightbox-caption").textContent = `${state.lightboxIndex + 1} / ${state.total} · ${photo.author || ""}`;
  $("lightbox-meta").textContent = `♥ ${photo.likes} · 💬 ${photo.comments} · ${photo.created || ""}${photo.description ? " · " + photo.description : ""}`;
}
function closeLightbox() { $("lightbox").classList.add("hidden"); }
function stepLightbox(d) {
  state.lightboxIndex = (state.lightboxIndex + d + state.photos.length) % state.photos.length;
  updateLightbox();
}

// ---------- downloads ----------
function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}

async function downloadOriginal(photo) {
  const url = photo.original || photo.large;
  const filename = `${String(photo.seq + 1).padStart(3, "0")}-${photo.id}.jpg`;
  const res = await fetch(api("/api/image?url=" + encodeURIComponent(url)));
  if (!res.ok) throw new Error(`原图下载失败 ${res.status}`);
  downloadBlob(await res.blob(), filename);
}

async function downloadAll() {
  const p = state.person;
  if (!p || state.downloading) return;
  state.downloading = true;
  $("download-all").disabled = true;
  $("download-panel").classList.remove("hidden");
  $("download-links").innerHTML = "";
  $("download-resume").classList.add("hidden");

  // Make sure we know the total first.
  if (!state.total) {
    try {
      const data = await apiJson(`/api/photos?celebrityId=${p.celebrityId}&start=0&count=1`);
      state.total = data.total;
    } catch (e) {
      failDownload(`取照片总数失败：${e.message}`);
      return;
    }
  }

  const batches = Math.ceil(state.total / BATCH);
  let failedBatch = -1;
  for (let b = 0; b < batches; b++) {
    if (state.doneBatches.has(b)) continue;
    const start = b * BATCH;
    $("download-label").textContent = `正在打包第 ${b + 1} / ${batches} 包（${start + 1}–${Math.min(start + BATCH, state.total)} 张）…`;
    $("download-count").textContent = `${state.doneBatches.size} / ${batches} 包完成`;
    $("download-bar").style.width = `${(state.doneBatches.size / batches) * 100}%`;
    try {
      const res = await fetch(
        api(`/api/zip?celebrityId=${p.celebrityId}&start=${start}&count=${BATCH}&name=${encodeURIComponent(p.name)}`),
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `打包失败 ${res.status}`);
      }
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      // Verify it really is a ZIP before saving it as one.
      if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
        throw new Error("服务器返回的不是有效 ZIP 文件");
      }
      const contentType = res.headers.get("Content-Type") || "";
      if (!contentType.includes("application/zip")) {
        throw new Error(`服务器返回类型不对：${contentType}`);
      }
      const filename = `${p.name}-照片-第${b + 1}包.zip`;
      const blob = new Blob([buf], { type: "application/zip" });
      downloadBlob(blob, filename);
      state.doneBatches.add(b);
      const link = document.createElement("a");
      link.textContent = filename;
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      $("download-links").appendChild(link);
      $("download-bar").style.width = `${(state.doneBatches.size / batches) * 100}%`;
      $("download-count").textContent = `${state.doneBatches.size} / ${batches} 包完成`;
    } catch (e) {
      failedBatch = b;
      break;
    }
  }

  state.downloading = false;
  $("download-all").disabled = false;
  if (failedBatch >= 0) {
    failDownload(`第 ${failedBatch + 1} 包失败：${state.doneBatches.size}/${batches} 包已完成。`);
    $("download-resume").classList.remove("hidden");
    $("download-resume").onclick = () => downloadAll();
  } else {
    $("download-label").textContent = `全部完成：${state.total} 张，分 ${batches} 包。`;
    $("download-note").textContent = "如果某包没弹出下载，可点下面对应的链接重新下载。";
  }
}

function failDownload(msg) {
  $("download-label").textContent = "下载中断";
  $("download-note").textContent = msg + " 请稍后重试，或从断点继续。";
  state.downloading = false;
  $("download-all").disabled = false;
}

// ---------- history ----------
function saveHistory(person) {
  try {
    const list = JSON.parse(localStorage.getItem("douban-gallery-history") || "[]");
    const next = [person, ...list.filter((x) => x.celebrityId !== person.celebrityId)].slice(0, 20);
    localStorage.setItem("douban-gallery-history", JSON.stringify(next));
  } catch { /* ignore */ }
}
function renderHistory() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem("douban-gallery-history") || "[]"); } catch { /* ignore */ }
  const el = $("history-list");
  el.innerHTML = "";
  list.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `${p.name}（${p.photoTotal || "?"} 张）`;
    b.onclick = () => loadPerson(p.personageId || p.celebrityId);
    el.appendChild(b);
  });
  if (!list.length) el.innerHTML = '<span class="note">还没有爬过的人物。</span>';
}

// ---------- wiring ----------
$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("search-input").value.trim();
  if (!input) return;
  try { await loadPerson(input); } catch (err) { setStatus(`没认出这是豆瓣人物链接：${err.message}`, true); }
});
$("load-more").addEventListener("click", () => loadMore(false));
$("download-all").addEventListener("click", downloadAll);
$("refresh-person").addEventListener("click", async () => {
  if (!state.person) return;
  try { await loadPerson(state.person.personageId || state.person.celebrityId, { refresh: true }); } catch (e) { setStatus(`刷新失败：${e.message}`, true); }
});
$("lightbox-close").addEventListener("click", closeLightbox);
$("lightbox-prev").addEventListener("click", () => stepLightbox(-1));
$("lightbox-next").addEventListener("click", () => stepLightbox(1));
$("lightbox-download").addEventListener("click", async () => {
  try { await downloadOriginal(state.photos[state.lightboxIndex]); }
  catch (e) { setStatus(`保存原图失败：${e.message}`, true); }
});
$("lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
document.addEventListener("keydown", (e) => {
  if ($("lightbox").classList.contains("hidden")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") stepLightbox(-1);
  if (e.key === "ArrowRight") stepLightbox(1);
});

// Default person on load: 李妍锡 (106 photos).
renderHistory();
loadPerson("https://www.douban.com/personage/34914546/photos/").catch(() => loadSeedPerson());
