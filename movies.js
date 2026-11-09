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
const shareBtn = $("share");
let sdk = null;
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

// البحث العربي: خدمة صغيرة على كويب (مجلد server) تترجم الاسم عبر TMDB والمفتاح عندها فقط (متغير بيئة).
// داخل ديسكورد تصلها عبر Mapping باسم /api؛ وللمعاينة المحلية نمرّر ?api= في الرابط.
const API_BASE = IN_DISCORD ? "/.proxy/api" : (PARAMS.get("api") || "");
const ARABIC = /[؀-ۿ]/;

async function englishTitles(arabicTerm) {
  const r = await fetch(`${API_BASE}/translate?q=${encodeURIComponent(arabicTerm)}`);
  if (!r.ok) throw new Error(r.status === 429 ? "طلبات كثيرة، انتظر قليلاً" : `خدمة الترجمة غير متاحة (${r.status})`);
  const data = await r.json();
  return (data.titles || []).map(cleanTerm).filter(Boolean);
}

async function search(term) {
  if (!ARABIC.test(term)) return searchArchive(term, 20);
  if (!API_BASE) throw new Error("البحث بالعربي غير متاح حالياً، اكتب الاسم بالإنجليزية");
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

// ملفات MP4 وWebM مرتبة من الأعلى دقة (حتى 1080) إلى الأقل؛ عند التساوي MP4 أولاً ثم الأصغر حجماً.
// ديسكورد لا يفكّ صورة OGV ولا MKV فنستبعدهما
function pickFiles(files) {
  const ok = (files || []).filter((f) => /\.(mp4|webm)$/i.test(f.name || "") && Number(f.size) > 0);
  const heightOf = (f) => Math.min(Number(f.height) || 0, 1080);
  const rank = (f) => (/\.mp4$/i.test(f.name) ? 0 : 1);
  ok.sort((a, b) => heightOf(b) - heightOf(a) || rank(a) - rank(b) || Number(a.size) - Number(b.size));
  return ok;
}

// دقة ومدة أفضل نسخة قابلة للتشغيل، لعرضها بجانب النتيجة
function describe(files) {
  const best = pickFiles(files)[0];
  if (!best) return null;
  const secs = parseFloat(best.length);
  return { height: Number(best.height) || 0, minutes: Number.isFinite(secs) ? Math.round(secs / 60) : 0 };
}

async function enrich(doc, btn, label) {
  try {
    const r = await fetch(`${base}/metadata/${encodeURIComponent(doc.identifier)}`);
    if (!r.ok) return;
    const meta = await r.json();
    const info = describe(meta.files);
    if (!info) {
      btn.textContent = `${label} • لا يُشغَّل`;
      btn.classList.add("dim");
      return;
    }
    const parts = [];
    if (info.height) parts.push(`${Math.min(info.height, 1080)}p`);
    if (info.minutes) parts.push(`${info.minutes} د`);
    if (parts.length) btn.textContent = `${label} • ${parts.join(" • ")}`;
  } catch (e) { /* نترك الاسم بدون تفاصيل */ }
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
    if (!item.title) item = { ...item, title: (meta.metadata && meta.metadata.title) || item.identifier };   // فتح من رابط مشاركة: لا يوجد عنوان بعد
    currentItem = item;
    candidateIndex = 0;
    loadCandidate();
    setStatus("");
    wrap.classList.add("playing");          // الفيديو يأخذ أكبر مساحة: نخفي البحث
    wrap.classList.remove("search");
    if (sdk) shareBtn.hidden = false;
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
    const label = `${d.title || d.identifier}${d.year ? " (" + d.year + ")" : ""}`;
    b.textContent = label;
    b.onclick = () => play(d);
    results.appendChild(b);
    enrich(d, b, label);          // الدقة والمدة تظهر بعد لحظات بجانب الاسم
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

// مشاركة الفيلم الحالي: ديسكورد يفتح نافذة اختيار الروم ويرسل رابطاً باسمك؛ من يضغطه يفتح نفس الفيلم داخل ديسكورد
shareBtn.addEventListener("click", async () => {
  if (!sdk || !currentItem) return;
  try {
    await sdk.commands.shareLink({
      message: `شاهد معي: ${currentItem.title}`,
      custom_id: `movie:${currentItem.identifier}`,
    });
  } catch (e) {
    setStatus(`تعذّرت المشاركة: ${e && e.message ? e.message : e}`, "bad");
    wrap.classList.add("search");
  }
});

(async function main() {
  if (IN_DISCORD && PARAMS.get("frame_id")) {
    try {
      sdk = new DiscordSDK(CLIENT_ID);
      await sdk.ready();
    } catch (e) { sdk = null; /* الـ SDK اختياري: بدونه لا يظهر زر المشاركة */ }
  }
  // فُتحت من رابط مشاركة: custom_id=movie:<معرّف archive.org> فنشغّل الفيلم مباشرة
  const customId = PARAMS.get("custom_id") || (sdk && sdk.customId) || "";
  const shared = /^movie:([A-Za-z0-9._-]{1,200})$/.exec(customId);
  if (shared) {
    play({ identifier: shared[1] });
    return;
  }
  setStatus("اكتب اسم الفيلم بالعربي أو الإنجليزي ثم اضغط بحث.");
})();
