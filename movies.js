import { DiscordSDK } from "@discord/embedded-app-sdk";

// تجربة: هل يشغّل ديسكورد فيلماً من archive.org داخل الـ Activity؟
// يعمل كذلك خارج ديسكورد (للمعاينة المحلية) لكن بدون وسيط ديسكورد.
const CLIENT_ID = "1480289106008346784";
const VERSION = "v4";
const PARAMS = new URLSearchParams(location.search);
// داخل ديسكورد: الصفحة تُخدَّم من <client_id>.discordsays.com (لا نعتمد على frame_id لأنه يضيع عند التنقل بين الصفحات)
const IN_DISCORD = location.hostname.endsWith("discordsays.com") || !!PARAMS.get("frame_id");

// مصادر التجربة (كلها أفلام ملكية عامة على archive.org)
const SOURCES = [
  { label: "His Girl Friday (MP4)", title: "His Girl Friday (1940)", id: "his_girl_friday", file: "his_girl_friday.mp4" },
  { label: "Night of the Living Dead (OGV)", title: "Night of the Living Dead (1968)", id: "nightofthelivingdead_201910", file: "Night Of The Living Dead.ogv" },
];

const logBox = document.getElementById("log");
const video = document.getElementById("player");
const titleEl = document.getElementById("title");
const srcBox = document.getElementById("sources");

function log(line, ok) {
  const div = document.createElement("div");
  div.textContent = line;
  if (ok === true) div.className = "ok";
  if (ok === false) div.className = "bad";
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

const base = IN_DISCORD ? "/.proxy/archive" : "https://archive.org";
const urlOf = (s) => `${base}/download/${s.id}/${encodeURIComponent(s.file)}`;

async function probe(url) {
  log(`الرابط: ${url.replace(/^https?:\/\/[^/]+/, "")}`);
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-1023" } });
    log(`جلب أول 1KB: HTTP ${r.status} • النوع ${r.headers.get("content-type") || "?"}`, r.ok);
    log(`تحويل (redirect): ${r.redirected ? "نعم إلى " + new URL(r.url).host : "لا"}`);
  } catch (e) {
    log(`فشل الجلب: ${e && e.message ? e.message : e}`, false);
  }
}

function play(s) {
  logBox.textContent = "";
  titleEl.textContent = s.title;
  log(`إصدار الصفحة: ${VERSION} • ${IN_DISCORD ? "داخل ديسكورد" : "خارج ديسكورد (معاينة)"}`);
  log(`يدعم المتصفح: mp4/h264=${video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') || "لا"} • ogg/theora=${video.canPlayType('video/ogg; codecs="theora, vorbis"') || "لا"} • webm/vp9=${video.canPlayType('video/webm; codecs="vp9"') || "لا"}`);
  const url = urlOf(s);
  probe(url);
  video.src = url;
  video.load();
}

video.addEventListener("error", () => log(`خطأ المشغّل (video error code ${video.error ? video.error.code : "?"})`, false));
video.addEventListener("loadedmetadata", () => log(`بيانات الفيديو: ${Math.round(video.duration)} ثانية • حجم الصورة ${video.videoWidth}x${video.videoHeight}`, video.videoWidth > 0));
video.addEventListener("playing", () => log(`يشتغل • حجم الصورة ${video.videoWidth}x${video.videoHeight}`, video.videoWidth > 0));

for (const s of SOURCES) {
  const b = document.createElement("button");
  b.textContent = s.label;
  b.onclick = () => play(s);
  srcBox.appendChild(b);
}

async function main() {
  if (IN_DISCORD && PARAMS.get("frame_id")) {     // الـ SDK اختياري هنا: التشغيل عبر /.proxy لا يحتاجه
    try {
      const sdk = new DiscordSDK(CLIENT_ID);
      await sdk.ready();
    } catch (e) {
      log(`SDK: ${e && e.message ? e.message : e}`, false);
    }
  }
  play(SOURCES[0]);
}

main().catch((e) => log(`خطأ: ${e && e.message ? e.message : e}`, false));
