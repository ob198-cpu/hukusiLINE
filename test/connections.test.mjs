import test from "node:test";
import assert from "node:assert/strict";
import { testOpenAiConnection } from "../src/openai.mjs";
import { testLineConnection } from "../src/line.mjs";

test("認証情報がない接続テストは外部通信せず失敗する", async () => {
  await assert.rejects(() => testOpenAiConnection({ openaiApiKey: "", openaiModel: "gpt-5.6-luna" }), /未設定/);
  await assert.rejects(() => testLineConnection({ lineChannelAccessToken: "" }), /未設定/);
});
