import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, getConfig } from "./src/env.mjs";
import { Store } from "./src/store.mjs";
import { verifyLineSignature } from "./src/security.mjs";
import { evaluateDeterministicRules, applyAnswerConditions, createRulesOnlyFallback } from "./src/rules.mjs";
import { classifyAndDraft, testOpenAiConnection } from "./src/openai.mjs";
import { replyText, pushText, notifyStaff, getLineProfile, testLineConnection } from "./src/line.mjs";

loadEnv();
const config = getConfig();
const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const store = new Store(path.join(root, "data", "line-inquiries.db"));

const mimeTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error("Request body too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeSettings(input) {
  const current = store.getSettings();
  const next = { ...current, ...input };
  next.officeHours = { ...current.officeHours, ...(input.officeHours || {}) };
  next.categories = { ...current.categories, ...(input.categories || {}) };
  for (const key of ["emergencyKeywords", "registeredKeywords", "welfareOfficeKeywords", "handoffKeywords", "faqs"]) {
    if (!Array.isArray(next[key])) throw new Error(`${key} must be an array`);
  }
  next.confidenceThreshold = Math.max(0, Math.min(1, Number(next.confidenceThreshold)));
  next.maxAutoRepliesPerConversation = Math.max(0, Math.min(20, Number(next.maxAutoRepliesPerConversation)));
  if (!["rules_only", "openai"].includes(next.responseMode)) throw new Error("responseMode is invalid");
  return next;
}

async function processIncoming(conversation, text, lineMessageId, targetId, { simulate = false, sourceType = "user" } = {}) {
  if (!simulate && sourceType === "user") {
    try {
      const profile = await getLineProfile(targetId, config);
      if (profile?.displayName) conversation = store.upsertConversation(targetId, profile.displayName);
    } catch (error) {
      store.audit("line_profile_error", error.message);
    }
  }
  const settings = store.getSettings();
  let decision = evaluateDeterministicRules(text, settings);
  if (!decision && settings.responseMode === "rules_only") decision = createRulesOnlyFallback(settings);
  try {
    if (!decision) decision = await classifyAndDraft(text, settings, config);
  } catch (error) {
    store.audit("ai_error", error.message);
    decision = { action: "handoff", category: "unknown", confidence: 0, reply: settings.handoffText, reason: "AI処理失敗" };
  }
  decision = applyAnswerConditions(decision, settings, conversation.auto_reply_count);
  const status = decision.action === "urgent" ? "urgent" : decision.action === "handoff" ? "unhandled" : "ai_replied";
  store.updateConversation(conversation.id, {
    status,
    category: decision.category,
    auto_reply_count: decision.action === "auto_reply" ? conversation.auto_reply_count + 1 : conversation.auto_reply_count
  });

  if (!simulate) {
    try {
      await pushText(targetId, decision.reply, config);
      store.addMessage(conversation.id, { direction: "out", sender: "AI受付", body: decision.reply, classification: decision.category, action: decision.action, deliveryStatus: "sent" });
    } catch (error) {
      store.addMessage(conversation.id, { direction: "out", sender: "AI受付", body: decision.reply, classification: decision.category, action: decision.action, deliveryStatus: "failed" });
      store.audit("line_send_error", `${lineMessageId || "unknown"}: ${error.message}`);
      store.updateConversation(conversation.id, { status: "unhandled" });
    }
    const alertLabel = decision.action === "urgent" ? "至急確認"
      : decision.action === "handoff" ? "職員確認"
        : "AI一次回答済み・要確認";
    await notifyStaff(`【LINE問い合わせ】${alertLabel}\n分類: ${decision.category}\n理由: ${decision.reason}\n管理画面で内容を確認してください。`, config);
  }
  return decision;
}

async function handleWebhook(req, res, raw) {
  if (!config.demoMode && !verifyLineSignature(raw, req.headers["x-line-signature"], config.lineChannelSecret)) {
    return json(res, 401, { error: "invalid signature" });
  }
  let body;
  try { body = JSON.parse(raw.toString("utf8")); } catch { return json(res, 400, { error: "invalid json" }); }
  const tasks = [];
  for (const event of body.events || []) {
    if (!store.claimWebhook(event.webhookEventId)) continue;
    if (event.type === "unsend") { store.markUnsent(event.unsend?.messageId); continue; }
    if (event.type !== "message" || event.message?.type !== "text") continue;
    const targetId = event.source?.userId || event.source?.groupId || event.source?.roomId;
    if (!targetId) continue;
    const conversation = store.upsertConversation(targetId);
    const messageId = store.addMessage(conversation.id, { lineMessageId: event.message.id, direction: "in", sender: "LINE利用者", body: event.message.text });
    if (!messageId) continue;
    const settings = store.getSettings();
    if (settings.acknowledgementEnabled && event.replyToken) {
      try {
        await replyText(event.replyToken, settings.acknowledgementText, config);
        store.addMessage(conversation.id, { direction: "out", sender: "受付", body: settings.acknowledgementText, action: "ack", deliveryStatus: "sent" });
      } catch (error) { store.audit("line_ack_error", error.message); }
    }
    tasks.push({ conversation, text: event.message.text, lineMessageId: event.message.id, targetId, sourceType: event.source?.type || "user" });
  }
  json(res, 200, { ok: true });
  for (const task of tasks) setImmediate(() => processIncoming(task.conversation, task.text, task.lineMessageId, task.targetId, { sourceType: task.sourceType }));
}

async function handleApi(req, res, url, raw) {
  if (url.pathname === "/api/health" && req.method === "GET") {
    return json(res, 200, {
      ok: true,
      demoMode: config.demoMode,
      lineConfigured: Boolean(config.lineChannelSecret && config.lineChannelAccessToken),
      lineSecretConfigured: Boolean(config.lineChannelSecret),
      lineTokenConfigured: Boolean(config.lineChannelAccessToken),
      openaiConfigured: Boolean(config.openaiApiKey),
      responseMode: store.getSettings().responseMode,
      publicBaseUrlConfigured: Boolean(config.publicBaseUrl),
      counts: store.dashboardCounts()
    });
  }
  if (url.pathname === "/api/settings" && req.method === "GET") return json(res, 200, store.getSettings());
  if (url.pathname === "/api/settings" && req.method === "PUT") {
    try { const next = safeSettings(JSON.parse(raw || "{}")); store.saveSettings(next); return json(res, 200, next); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (url.pathname === "/api/setup/test-openai" && req.method === "POST") {
    try { return json(res, 200, await testOpenAiConnection(config)); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (url.pathname === "/api/setup/test-line" && req.method === "POST") {
    try { return json(res, 200, await testLineConnection(config)); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (url.pathname === "/api/conversations" && req.method === "GET") {
    return json(res, 200, store.listConversations(url.searchParams.get("status") || "all", url.searchParams.get("search") || ""));
  }
  const match = url.pathname.match(/^\/api\/conversations\/(\d+)(?:\/(send|status))?$/);
  if (match && req.method === "GET" && !match[2]) {
    const item = store.getConversation(Number(match[1]));
    return item ? json(res, 200, item) : json(res, 404, { error: "not found" });
  }
  if (match && req.method === "POST" && match[2] === "status") {
    const body = JSON.parse(raw || "{}");
    const allowed = ["unhandled", "ai_replied", "in_progress", "closed", "urgent"];
    if (!allowed.includes(body.status)) return json(res, 400, { error: "invalid status" });
    store.updateConversation(Number(match[1]), { status: body.status, assigned_to: String(body.assignedTo || "") });
    store.audit("status_updated", `conversation=${match[1]} status=${body.status}`);
    return json(res, 200, { ok: true });
  }
  if (match && req.method === "POST" && match[2] === "send") {
    const item = store.getConversation(Number(match[1]));
    if (!item) return json(res, 404, { error: "not found" });
    const body = JSON.parse(raw || "{}");
    const text = String(body.text || "").trim();
    if (!text) return json(res, 400, { error: "返信本文が必要です" });
    try {
      await pushText(item.line_user_id, text, config);
      store.addMessage(item.id, { direction: "out", sender: String(body.sender || "職員"), body: text, action: "manual", deliveryStatus: "sent" });
      store.updateConversation(item.id, { status: "in_progress", assigned_to: String(body.sender || "職員") });
      return json(res, 200, { ok: true });
    } catch (error) { return json(res, 502, { error: error.message }); }
  }
  if (url.pathname === "/api/simulate" && req.method === "POST") {
    const body = JSON.parse(raw || "{}");
    const text = String(body.text || "").trim();
    if (!text) return json(res, 400, { error: "問い合わせ文を入力してください" });
    if (body.previewOnly === true) {
      const settings = store.getSettings();
      const decision = evaluateDeterministicRules(text, settings)
        || (settings.responseMode === 'rules_only' ? createRulesOnlyFallback(settings) : await classifyAndDraft(text, settings, config));
      return json(res, 200, applyAnswerConditions(decision, settings, 0));
    }
    const conversation = store.upsertConversation(`demo-${Date.now()}`, "テスト利用者");
    store.addMessage(conversation.id, { direction: "in", sender: "テスト", body: text });
    const decision = await processIncoming(conversation, text, null, conversation.line_user_id, { simulate: true });
    return json(res, 200, decision);
  }
  return json(res, 404, { error: "not found" });
}

function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = path.resolve(publicDir, requested);
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  res.writeHead(200, { "Content-Type": mimeTypes[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/webhook" && req.method === "POST") return handleWebhook(req, res, await readBody(req));
    // The password-free console is available only through a direct local connection.
    const localHosts = [`127.0.0.1:${config.port}`, `localhost:${config.port}`];
    const localPeer = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
    const forwarded = Object.keys(req.headers).some(key => key === "forwarded" || key.startsWith("x-forwarded-") || key.startsWith("cf-"));
    const validOrigin = !req.headers.origin || localHosts.some(host => req.headers.origin === `http://${host}`);
    if (!localPeer || !localHosts.includes(req.headers.host) || forwarded || !validOrigin || req.headers["sec-fetch-site"] === "cross-site") {
      return json(res, 403, { error: "管理画面はこのPCから直接開いてください" });
    }
    if (url.pathname.startsWith("/api/")) {
      const raw = ["POST", "PUT", "PATCH"].includes(req.method) ? (await readBody(req)).toString("utf8") : "";
      return handleApi(req, res, url, raw);
    }
    if (!serveStatic(res, url.pathname)) json(res, 404, { error: "not found" });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: "サーバー処理に失敗しました" });
  }
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`LINE inquiry bot admin: http://127.0.0.1:${config.port}`);
  if (config.demoMode) console.log("DEMO_MODE=true: LINEへの実送信は行いません");
});
