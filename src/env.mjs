import fs from "node:fs";
import path from "node:path";

export function loadEnv(file = path.join(process.cwd(), ".env")) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function getConfig() {
  return {
    port: Number(process.env.PORT || 8790),
    publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
    adminPassword: "0000",
    sessionSecret: process.env.SESSION_SECRET || "",
    lineChannelSecret: process.env.LINE_CHANNEL_SECRET || "",
    lineChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiModel: process.env.OPENAI_MODEL || "gpt-5.6-luna",
    staffLineUserIds: (process.env.STAFF_LINE_USER_IDS || "").split(",").map((v) => v.trim()).filter(Boolean),
    demoMode: String(process.env.DEMO_MODE || "false").toLowerCase() === "true"
  };
}
