import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.mjs";

test("WebhookとLINEメッセージを重複保存しない", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "line-bot-store-"));
  const dbPath = path.join(dir, "test.db");
  const store = new Store(dbPath);
  try {
    assert.equal(store.claimWebhook("event-1"), true);
    assert.equal(store.claimWebhook("event-1"), false);
    const conversation = store.upsertConversation("U-test", "テスト利用者");
    assert.notEqual(store.addMessage(conversation.id, { lineMessageId: "message-1", direction: "in", sender: "LINE利用者", body: "初回" }), 0);
    assert.equal(store.addMessage(conversation.id, { lineMessageId: "message-1", direction: "in", sender: "LINE利用者", body: "重複" }), 0);
    assert.equal(store.getConversation(conversation.id).messages.length, 1);
  } finally {
    store.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
