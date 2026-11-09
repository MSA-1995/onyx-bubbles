import { DiscordSDK } from "@discord/embedded-app-sdk";

const CLIENT_ID = "1480289106008346784";
const MOVIES_CHANNELS = ["1569383146049245344"];     // روم الأفلام في سيرفر Onyx (يُضاف غيره هنا)
const box = document.getElementById("status");
const mySeed = Math.random().toString(36).slice(2, 8);   // فريد لكل نسخة صفحة: لو ظهر نفس الرقم عند اثنين فالواجهة مشتركة

function show(lines) {
  box.innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
}

async function main() {
  const base = [`رقم نسختي: <b>${mySeed}</b>`];
  if (!new URLSearchParams(location.search).get("frame_id")) {
    show([...base, "خارج ديسكورد (نموذج فقط)"]);
    return;
  }
  const sdk = new DiscordSDK(CLIENT_ID);
  await sdk.ready();
  // الـ Activity أُطلقت من روم الأفلام: نفتح صفحة الأفلام بدل الفقاعات
  const urlParams = new URLSearchParams(location.search);
  const channelIds = [sdk.channelId, urlParams.get("channel_id"), urlParams.get("location_id")].map(String);
  // custom_id=movies من رابط الأفلام (يعمل في أي سيرفر)، أو روم الأفلام المعروف (احتياط)
  if (sdk.customId === "movies" || urlParams.get("custom_id") === "movies" || channelIds.some((id) => MOVIES_CHANNELS.includes(id))) {
    location.replace("movies.html" + location.search);
    return;
  }
  document.documentElement.classList.remove("pending");      // ليست روم الأفلام: نُظهر الفقاعات
  const render = (participants) => show([
    ...base,
    `الجلسة (instance): <b>${sdk.instanceId.slice(0, 8)}</b>`,
    `الروم: <b>${sdk.channelId}</b>`,
    `اللاعبون بالجلسة: <b>${participants.length}</b>`,
  ]);
  const first = await sdk.commands.getInstanceConnectedParticipants();
  render(first.participants);
  sdk.subscribe("ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE", (e) => render(e.participants));
}

main().catch((e) => {
  document.documentElement.classList.remove("pending");
  show([`خطأ: ${e && e.message ? e.message : e}`]);
});
