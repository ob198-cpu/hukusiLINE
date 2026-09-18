import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyLineSignature, createSessionToken, verifySessionToken, redactPersonalInformation } from "../src/security.mjs";

test("LINE署名は生の本文とChannel Secretで検証する", () => {
  const body = Buffer.from('{"events":[]}');
  const secret = "channel-secret-for-test";
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64");
  assert.equal(verifyLineSignature(body, signature, secret), true);
  assert.equal(verifyLineSignature(Buffer.from('{"events":[1]}'), signature, secret), false);
});

test("管理セッションは改ざんを拒否する", () => {
  const token = createSessionToken("a-long-test-session-secret");
  assert.equal(verifySessionToken(token, "a-long-test-session-secret"), true);
  assert.equal(verifySessionToken(`${token}x`, "a-long-test-session-secret"), false);
});

test("OpenAI送信前に主な個人情報をマスキングする", () => {
  const result = redactPersonalInformation("電話090-1234-5678 メール foo@example.com 郵便100-0001");
  assert.equal(result.includes("090-1234-5678"), false);
  assert.equal(result.includes("foo@example.com"), false);
  assert.equal(result.includes("100-0001"), false);
});
