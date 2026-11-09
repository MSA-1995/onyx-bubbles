import { DiscordSDK } from "@discord/embedded-app-sdk";

// صفحة الأفلام (Activity): بحث في archive.org (ملكية عامة) ثم تشغيل MP4 عبر وسيط ديسكورد (/.proxy/archive)
const CLIENT_ID = "1480289106008346784";
const PARAMS = new URLSearchParams(location.search);
// داخل ديسكورد: الصفحة تُخدَّم من <client_id>.discordsays.com
const IN_DISCORD = location.hostname.endsWith("discordsays.com") || !!PARAMS.get("frame_id");
const base = IN_DISCORD ? "/.proxy/archive" : "https://archive.org";

const $ = (id) => document.getElementById(id);
const video = $("player");
const titleEl = $("title");
const results = $("results");
const form = $("form");
const input = $("q");
const statusEl = $("status");
const wrap = $("wrap");
$("toggle").addEventListener("click", () => wrap.classList.toggle("search"));

function setStatus(text, cls) {
  statusEl.textContent = text || "";
  statusEl.className = cls || "";
}

function cleanTerm(text) {
  // نشيل رموز بحث Lucene حتى ما ينكسر الاستعلام
  return (text || "").replace(/[+\-&|!(){}\[\]^"~*?:\\\/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

async function searchArchive(term, rows) {
  const q = `title:(${term}) AND mediatype:movies AND (collection:feature_films OR collection:opensource_movies)`;
  const params = new URLSearchParams({ q, rows: String(rows), output: "json" });
  for (const f of ["identifier", "title", "year"]) params.append("fl[]", f);
  params.append("sort[]", "downloads desc");
  const r = await fetch(`${base}/advancedsearch.php?${params}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return (data.response && data.response.docs) || [];
}

// البحث العربي معطّل عمداً: يحتاج مفتاح TMDB، والصفحة عامة فلا نضع المفتاح فيها.
// يُفعَّل لاحقاً عبر وسيط على البوت يحمل المفتاح (لا يُكتب هنا أبداً).
const TMDB_KEY = "";
const tmdbBase = IN_DISCORD ? "/.proxy/tmdb" : "https://api.themoviedb.org";
const ARABIC = /[؀-ۿ]/;

async function englishTitles(arabicTerm) {
  const params = new URLSearchParams({ api_key: TMDB_KEY, query: arabicTerm, language: "en-US", include_adult: "false" });
  const r = await fetch(`${tmdbBase}/3/search/movie?${params}`);
  if (!r.ok) throw new Error(`TMDB HTTP ${r.status}`);
  const data = await r.json();
  const titles = [];
  for (const m of data.results || []) {
    for (const t of [m.title, m.original_title]) {
      const clean = cleanTerm(t || "");
      if (clean && /[A-Za-z]/.test(clean) && !titles.includes(clean)) titles.push(clean);
    }
    if (titles.length >= 6) break;
  }
  return titles.slice(0, 6);
}

async function search(term) {
  if (!ARABIC.test(term)) return searchArchive(term, 20);
  if (!TMDB_KEY) throw new Error("البحث بالعربي غير متاح حالياً، اكتب الاسم بالإنجليزية");
  setStatus("أترجم الاسم...");
  const titles = await englishTitles(term);
  if (!titles.length) return [];
  setStatus(`أبحث عن: ${titles.slice(0, 3).join(" • ")}`);
  const batches = await Promise.all(titles.map((t) => searchArchive(`"${t}"`, 6).catch(() => [])));
  const seen = new Set();
  const merged = [];
  for (const docs of batches) {
    for (const d of docs) {
      if (!seen.has(d.identifier)) { seen.add(d.identifier); merged.push(d); }
    }
  }
  return merged.slice(0, 20);
}

// ملفات MP4 مرتبة من الأعلى دقة (حتى 1080) إلى الأقل؛ ديسكورد لا يفكّ صورة OGV فنستبعده
function pickFiles(files) {
  const mp4 = (files || []).filter((f) => /\.mp4$/i.test(f.name || "") && Number(f.size) > 0);
  const heightOf = (f) => Math.min(Number(f.height) || 0, 1080);
  mp4.sort((a, b) => heightOf(b) - heightOf(a) || Number(a.size) - Number(b.size));
  return mp4;
}

let candidates = [];
let candidateIndex = 0;
let currentItem = null;

function loadCandidate() {
  const file = candidates[candidateIndex];
  const res = Number(file.height) ? ` • ${file.height}p` : "";
  titleEl.textContent = currentItem.title + (currentItem.year ? ` (${currentItem.year})` : "") + res;
  video.src = `${base}/download/${encodeURIComponent(currentItem.identifier)}/${file.name.split("/").map(encodeURIComponent).join("/")}`;
  video.load();
  video.play().catch(() => {});
}

async function play(item) {
  setStatus("جاري تجهيز الفيلم...");
  try {
    const r = await fetch(`${base}/metadata/${encodeURIComponent(item.identifier)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const meta = await r.json();
    candidates = pickFiles(meta.files);
    if (!candidates.length) {
      setStatus("لا توجد نسخة MP4 قابلة للتشغيل لهذا الفيلم. جرّب غيره.", "bad");
      return;
    }
    currentItem = item;
    candidateIndex = 0;
    loadCandidate();
    setStatus("");
    wrap.classList.add("playing");          // الفيديو يأخذ أكبر مساحة: نخفي البحث
    wrap.classList.remove("search");
  } catch (e) {
    setStatus(`تعذّر التشغيل: ${e && e.message ? e.message : e}`, "bad");
  }
}

function showResults(docs) {
  results.textContent = "";
  if (!docs.length) {
    setStatus("لا توجد نتائج. جرّب الاسم بالإنجليزية.", "bad");
    return;
  }
  setStatus(`${docs.length} نتيجة. اختر فيلماً:`);
  for (const d of docs) {
    const b = document.createElement("button");
    b.textContent = `${d.title || d.identifier}${d.year ? " (" + d.year + ")" : ""}`;
    b.onclick = () => play(d);
    results.appendChild(b);
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const term = cleanTerm(input.value);
  if (!term) return;
  setStatus("جاري البحث...");
  results.textContent = "";
  try {
    showResults(await search(term));
  } catch (err) {
    setStatus(`تعذّر البحث: ${err && err.message ? err.message : err}`, "bad");
  }
});

video.addEventListener("error", () => {
  // الملف الحالي ما اشتغل (صيغة أو حجم): نجرّب التالي الأقل دقة
  if (candidates.length && candidateIndex + 1 < candidates.length) {
    candidateIndex += 1;
    setStatus("هذه الدقة لم تشتغل، أجرّب أقل منها...");
    loadCandidate();
    return;
  }
  setStatus(`خطأ في المشغّل (code ${video.error ? video.error.code : "?"})`, "bad");
});

(async function main() {
  if (IN_DISCORD && PARAMS.get("frame_id")) {
    try {
      const sdk = new DiscordSDK(CLIENT_ID);
      await sdk.ready();
    } catch (e) { /* الـ SDK اختياري هنا */ }
  }
  setStatus("اكتب اسم الفيلم بالإنجليزية ثم اضغط بحث.");
})();
