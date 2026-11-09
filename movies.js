import { DiscordSDK } from "@discord/embedded-app-sdk";

// تجربة: هل يشغّل ديسكورد فيلماً من archive.org داخل الـ Activity؟
// يعمل كذلك خارج ديسكورد (للمعاينة المحلية) لكن بدون وسيط ديسكورد.
const CLIENT_ID = "1480289106008346784";
const PARAMS = new URLSearchParams(location.search);
const ITEM = PARAMS.get("id") || "nightofthelivingdead_201910";
const FILE = PARAMS.get("file") || "Night Of The Living Dead.ogv";
const TITLE = PARAMS.get("title") || "Night of the Living Dead (1968)";
const VERSION = "v3";
// داخل ديسكورد: الصفحة تُخدَّم من <client_id>.discordsays.com (لا نعتمد على frame_id لأنه يضيع عند التنقل بين الصفحات)
const IN_DISCORD = location.hostname.endsWith("discordsays.com") || !!PARAMS.get("frame_id");

const logBox = document.getElementById("log");
const video = document.getElementById("player");
const titleEl = document.getElementById("title");
titleEl.textContent = TITLE;

function log(line, ok) {
  const div = document.createElement("div");
  div.textContent = line;
  if (ok === true) div.className = "ok";
  if (ok === false) div.className = "bad";
  logBox.appendChild(div);
}

// داخل ديسكورد: كل الطلبات الخارجية تمر عبر /.proxy/<prefix> المعرّف في Developer Portal (URL Mappings)
const base = IN_DISCORD ? "/.proxy/archive" : "https://archive.org";
const videoUrl = `${base}/download/${ITEM}/${encodeURIComponent(FILE)}`;

async function probe() {
  log(`البيئة: ${IN_DISCORD ? "داخل ديسكورد" : "خارج ديسكورد (معاينة)"}`);
  log(`الرابط: ${videoUrl.replace(/^https?:\/\/[^/]+/, "")}`);
  try {
    const r = await fetch(videoUrl, { headers: { Range: "bytes=0-1023" } });
    log(`جلب أول 1KB: HTTP ${r.status} • النوع ${r.headers.get("content-type") || "?"}`, r.ok);
    log(`تحويل (redirect): ${r.redirected ? "نعم إلى " + new URL(r.url).host : "لا"}`);
  } catch (e) {
    log(`فشل الجلب: ${e && e.message ? e.message : e}`, false);
  }
}

async function main() {
  log(`إصدار الصفحة: ${VERSION} • الموقع: ${location.hostname} • معاملات: ${[...PARAMS.keys()].join(",") || "لا شيء"}`);
  if (IN_DISCORD && PARAMS.get("frame_id")) {     // الـ SDK اختياري هنا: التشغيل عبر /.proxy لا يحتاجه
    try {
      const sdk = new DiscordSDK(CLIENT_ID);
      await sdk.ready();
      log(`الروم: ${sdk.channelId}`);
    } catch (e) {
      log(`SDK: ${e && e.message ? e.message : e}`, false);
    }
  }
  await probe();
  video.addEventListener("error", () => {
    const code = video.error ? video.error.code : "?";
    log(`خطأ المشغّل (video error code ${code})`, false);
  });
  video.addEventListener("loadedmetadata", () => log(`تم تحميل بيانات الفيديو (${Math.round(video.duration)} ثانية)`, true));
  video.addEventListener("playing", () => log("الفيديو يشتغل", true));
  video.src = videoUrl;
  video.load();
}

main().catch((e) => log(`خطأ: ${e && e.message ? e.message : e}`, false));
