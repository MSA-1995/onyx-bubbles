// خدمة صغيرة (بلا مكتبات): تترجم اسم الفيلم العربي إلى أسماء إنجليزية عبر TMDB.
// المفتاح يُقرأ فقط من متغير البيئة TMDB_API_KEY في كويب ولا يُكتب في أي ملف ولا يُرسل للمتصفح.
const http = require("http");

const PORT = Number(process.env.PORT) || 8000;
const KEY = (process.env.TMDB_API_KEY || "").trim();
const TMDB = "https://api.themoviedb.org/3/search/movie";
const MAX_QUERY = 80;
const RATE_LIMIT = 20;            // طلبات لكل IP في الدقيقة
const RATE_WINDOW_MS = 60 * 1000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;

const hits = new Map();           // ip -> [timestamps]
const cache = new Map();          // query -> {at, titles}

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket.remoteAddress || "?";
}

function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) {         // تنظيف حتى لا تكبر الذاكرة
    for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
  }
  return list.length > RATE_LIMIT;
}

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",       // الرد أسماء أفلام فقط، لا شيء حساس
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function translate(query) {
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.titles;
  const url = `${TMDB}?${new URLSearchParams({ api_key: KEY, query, language: "en-US", include_adult: "false" })}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  const data = await r.json();
  const titles = [];
  for (const m of data.results || []) {
    for (const t of [m.title, m.original_title]) {
      const clean = String(t || "").trim();
      if (clean && /[A-Za-z]/.test(clean) && !titles.includes(clean)) titles.push(clean);
    }
    if (titles.length >= 6) break;
  }
  const out = titles.slice(0, 6);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(query, { at: Date.now(), titles: out });
  return out;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") return send(res, 200, { ok: true });
  if (req.method !== "GET" || url.pathname !== "/translate") return send(res, 404, { error: "not found" });
  if (!KEY) return send(res, 503, { error: "service not configured" });
  if (limited(clientIp(req))) return send(res, 429, { error: "too many requests" });
  const query = (url.searchParams.get("q") || "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
  if (!query) return send(res, 400, { error: "missing q" });
  try {
    send(res, 200, { titles: await translate(query) });
  } catch (e) {
    console.error("translate failed:", e && e.message ? e.message : e);     // الرسالة بدون المفتاح
    send(res, 502, { error: "upstream failed" });
  }
});

server.listen(PORT, () => console.log(`onyx-movies-api listening on ${PORT} (key ${KEY ? "set" : "MISSING"})`));
