import { officeAnswer } from './office-knowledge.mjs';
import { matchOfficeFaq } from './tryze-faq.mjs';

function includesAny(text, words = []) {
  const normalized = String(text || "").toLowerCase();
  return words.some((word) => normalized.includes(String(word).toLowerCase()));
}

export function isWithinOfficeHours(settings, now = new Date()) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(now);
  const weekdayText = parts.find((p) => p.type === "weekday")?.value || "";
  const dayMap = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };
  const hour = parts.find((p) => p.type === "hour")?.value || "00";
  const minute = parts.find((p) => p.type === "minute")?.value || "00";
  const current = `${hour}:${minute}`;
  return settings.officeHours.weekdays.includes(dayMap[weekdayText]) && current >= settings.officeHours.start && current <= settings.officeHours.end;
}

export function evaluateDeterministicRules(text, settings) {
  if (includesAny(text, settings.emergencyKeywords)) {
    return { action: "urgent", category: "emergency", confidence: 1, reply: settings.emergencyText, reason: "緊急キーワード" };
  }
  const guidance = matchOfficeFaq(text, settings);
  const sensitive = /苦情|解約|請求|事故|薬|服薬|治療|診断して|診断してください|住所変更|個人情報/.test(text);
  const existing = includesAny(text, settings.registeredKeywords.filter(k => k !== '受給者証'));
  if (guidance && !sensitive && !existing) return guidance;
  if (includesAny(text, settings.welfareOfficeKeywords)) {
    return { action: "handoff", category: "welfare_office", confidence: 1, reply: settings.handoffText, reason: "福祉事業所・関係機関" };
  }
  if (includesAny(text, settings.registeredKeywords)) {
    return { action: "handoff", category: "registered_user", confidence: 1, reply: settings.handoffText, reason: "登録・利用中の可能性" };
  }
  if (includesAny(text, settings.handoffKeywords)) {
    return { action: "handoff", category: "unknown", confidence: 1, reply: settings.handoffText, reason: "職員判断が必要な語句" };
  }
  const office = officeAnswer(text, settings);
  if (office) return office;
  const faq = settings.faqs.find((item) => item.enabled && (!item.scope?.length || includesAny(text, item.scope)) && includesAny(text, item.keywords));
  if (faq) {
    return { action: "auto_reply", category: "general", confidence: 1, reply: faq.answer, reason: `FAQ: ${faq.question}` };
  }
  return null;
}

export function createRulesOnlyFallback(settings) {
  return {
    action: "handoff",
    category: "unknown",
    confidence: 1,
    reply: settings.handoffText,
    reason: "FAQに未登録のため職員確認"
  };
}

export function applyAnswerConditions(result, settings, autoReplyCount = 0, now = new Date()) {
  if (result.action === 'urgent') return {...result, reply:settings.emergencyText};
  if (!settings.autoReplyEnabled) return { ...result, action: "handoff", reply: settings.handoffText, reason: "自動回答停止中" };
  if (!isWithinOfficeHours(settings, now) && !settings.allowAfterHoursAi) {
    return { ...result, action: "handoff", reply: settings.afterHoursText, reason: "営業時間外" };
  }
  if (!result.verifiedGuidance && autoReplyCount >= settings.maxAutoRepliesPerConversation) {
    return { ...result, action: "handoff", reply: settings.handoffText, reason: "自動回答回数の上限" };
  }
  if ((result.confidence ?? 0) < settings.confidenceThreshold) {
    return { ...result, action: "handoff", reply: settings.handoffText, reason: "AI判定の確信度不足" };
  }
  const category = settings.categories[result.category] || settings.categories.unknown;
  if (!category.autoReply || result.action !== "auto_reply") {
    return { ...result, action: result.action === "urgent" ? "urgent" : "handoff", reply: result.action === "urgent" ? settings.emergencyText : result.verifiedGuidance && result.action === 'handoff' ? result.reply : settings.handoffText };
  }
  return result;
}
