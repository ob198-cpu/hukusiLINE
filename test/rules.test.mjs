import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../src/defaults.mjs";
import { evaluateDeterministicRules, applyAnswerConditions, createRulesOnlyFallback } from "../src/rules.mjs";

const settings = structuredClone(DEFAULT_SETTINGS);
const weekdayNoon = new Date("2026-09-08T03:00:00.000Z");

test("緊急相談は自動回答せず至急確認へ回す", () => {
  const result = evaluateDeterministicRules("今すぐ助けて。死にたいです", settings);
  assert.equal(result.action, "urgent");
  assert.equal(result.category, "emergency");
});

test("既存利用者の連絡は職員へ回す", () => {
  const result = evaluateDeterministicRules("現在利用中です。担当相談員に確認したいです", settings);
  assert.equal(result.action, "handoff");
  assert.equal(result.category, "registered_user");
});

test("福祉事業所・関係機関からの連絡は職員へ回す", () => {
  const result = evaluateDeterministicRules("相談支援事業所です。利用者について連携したいです", settings);
  assert.equal(result.action, "handoff");
  assert.equal(result.category, "welfare_office");
});

test("FAQに一致する一般案内だけを自動回答できる", () => {
  const result = evaluateDeterministicRules("営業時間は何時ですか", settings);
  const guarded = applyAnswerConditions(result, settings, 0, weekdayNoon);
  assert.equal(guarded.action, "auto_reply");
  assert.match(guarded.reply, /平日9時/);
});

test("APIなしモードではFAQ外の質問を職員へ回す", () => {
  assert.equal(evaluateDeterministicRules("詳しい状況を判断して回答してください", settings), null);
  const result = createRulesOnlyFallback(settings);
  assert.equal(result.action, "handoff");
  assert.match(result.reason, /FAQに未登録/);
});

test("確信度不足と回答回数上限は職員へ回す", () => {
  const lowConfidence = applyAnswerConditions({ action: "auto_reply", category: "general", confidence: 0.5, reply: "仮回答", reason: "test" }, settings, 0, weekdayNoon);
  const overLimit = applyAnswerConditions({ action: "auto_reply", category: "general", confidence: 1, reply: "仮回答", reason: "test" }, settings, settings.maxAutoRepliesPerConversation, weekdayNoon);
  assert.equal(lowConfidence.action, "handoff");
  assert.equal(overLimit.action, "handoff");
});
