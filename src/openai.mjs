import { redactPersonalInformation } from "./security.mjs";

function outputText(response) {
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) if (content.type === "output_text") return content.text;
  }
  return "";
}

export async function testOpenAiConnection(config) {
  if (!config.openaiApiKey) throw new Error("OpenAI APIキーが未設定です");
  const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(config.openaiModel)}`, {
    headers: { Authorization: `Bearer ${config.openaiApiKey}` }
  });
  if (!response.ok) throw new Error(`OpenAI API接続エラー: ${response.status}`);
  const model = await response.json();
  return { ok: true, model: model.id || config.openaiModel };
}

export async function classifyAndDraft(text, settings, config) {
  if (!config.openaiApiKey) {
    return { action: "handoff", category: "unknown", confidence: 0, reply: settings.handoffText, reason: "OpenAI API未設定" };
  }
  const faqText = settings.faqs.filter((faq) => faq.enabled).map((faq) => `対象: ${faq.scope?.join('、') || '共通'}\nQ: ${faq.question}\nA: ${faq.answer}`).join("\n\n");
  const officeText = JSON.stringify((settings.offices || []).filter(o => o.enabled));
  const safeText = redactPersonalInformation(text);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.openaiModel,
      store: false,
      instructions: `${settings.systemPrompt}\n\n回答に使えるFAQ:\n${faqText || "なし"}\n\n公式サイトで確認した事業所情報:\n${officeText}\n事業所情報にある住所・サービス種別・電話・受付時間は具体的に答える。対象事業所を混同しない。空きや予約・個人の利用可否は確約しない。`,
      input: `問い合わせ内容:\n${safeText}`,
      text: {
        format: {
          type: "json_schema",
          name: "line_inquiry_decision",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              action: { type: "string", enum: ["auto_reply", "handoff", "urgent"] },
              category: { type: "string", enum: ["new_consultation", "registered_user", "welfare_office", "general", "emergency", "unknown"] },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              reply: { type: "string" },
              reason: { type: "string" }
            },
            required: ["action", "category", "confidence", "reply", "reason"]
          }
        }
      }
    })
  });
  if (!response.ok) throw new Error(`OpenAI API error: ${response.status} ${await response.text()}`);
  const json = await response.json();
  return JSON.parse(outputText(json));
}
