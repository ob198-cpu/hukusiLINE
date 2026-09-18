const LINE_API = "https://api.line.me/v2/bot/message";
const LINE_PROFILE_API = "https://api.line.me/v2/bot/profile";

async function send(path, body, config) {
  if (config.demoMode) return { demo: true };
  if (!config.lineChannelAccessToken) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured");
  const response = await fetch(`${LINE_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.lineChannelAccessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`LINE API error: ${response.status} ${await response.text()}`);
  return response.status === 204 ? {} : response.json();
}

export function replyText(replyToken, text, config) {
  return send("/reply", { replyToken, messages: [{ type: "text", text: text.slice(0, 5000) }] }, config);
}

export function pushText(to, text, config) {
  return send("/push", { to, messages: [{ type: "text", text: text.slice(0, 5000) }] }, config);
}

export async function notifyStaff(text, config) {
  const results = [];
  for (const userId of config.staffLineUserIds) {
    try { results.push(await pushText(userId, text, config)); } catch (error) { results.push({ error: error.message }); }
  }
  return results;
}

export async function getLineProfile(userId, config) {
  if (config.demoMode || !config.lineChannelAccessToken || !userId) return null;
  const response = await fetch(`${LINE_PROFILE_API}/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${config.lineChannelAccessToken}` }
  });
  if (!response.ok) return null;
  return response.json();
}

export async function testLineConnection(config) {
  if (!config.lineChannelAccessToken) throw new Error("LINE Access Tokenが未設定です");
  const response = await fetch("https://api.line.me/v2/bot/info", {
    headers: { Authorization: `Bearer ${config.lineChannelAccessToken}` }
  });
  if (!response.ok) throw new Error(`LINE API接続エラー: ${response.status}`);
  const bot = await response.json();
  return { ok: true, displayName: bot.displayName || "LINE公式アカウント" };
}
