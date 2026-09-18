export const DEFAULT_SETTINGS = {
  businessName: "相談支援事業所",
  responseMode: "rules_only",
  autoReplyEnabled: true,
  acknowledgementEnabled: true,
  acknowledgementText: "お問い合わせありがとうございます。内容を確認しています。担当者への引継ぎが必要な場合も、このままお待ちください。",
  afterHoursText: "お問い合わせありがとうございます。営業時間外のため、担当者からの確認は次の営業時間になります。緊急の場合は、地域の緊急窓口または119・110をご利用ください。",
  handoffText: "お問い合わせありがとうございます。確認が必要な内容のため、担当者へ引き継ぎました。個人情報は追加で送らず、そのままお待ちください。",
  emergencyText: "緊急性のある内容の可能性があります。生命や身体に差し迫った危険がある場合は、AIの返信を待たず119または110へ連絡してください。担当者にも至急確認を依頼します。",
  officeHours: { start: "09:00", end: "18:00", weekdays: [1, 2, 3, 4, 5] },
  allowAfterHoursAi: true,
  confidenceThreshold: 0.78,
  maxAutoRepliesPerConversation: 3,
  categories: {
    new_consultation: { label: "新規相談", autoReply: true },
    registered_user: { label: "登録・利用中", autoReply: false },
    welfare_office: { label: "福祉事業所から", autoReply: false },
    general: { label: "一般案内", autoReply: true },
    emergency: { label: "緊急", autoReply: false },
    unknown: { label: "要確認", autoReply: false }
  },
  emergencyKeywords: ["死にたい", "自殺", "自傷", "虐待", "暴力", "今すぐ助けて", "救急", "倒れた", "行方不明"],
  registeredKeywords: ["利用中", "契約中", "登録しています", "受給者証", "モニタリング", "担当相談員", "利用者です"],
  welfareOfficeKeywords: ["事業所です", "相談支援事業所", "サービス管理責任者", "サビ管", "支援員です", "関係機関"],
  handoffKeywords: ["苦情", "契約", "解約", "請求", "個人情報", "住所変更", "支給決定", "診断", "薬", "医療", "事故"],
  systemPrompt: "あなたは相談支援事業所の一次受付担当です。登録済み利用者、関係事業所、契約・医療・緊急・個別判断が必要な相談には断定回答せず職員へ引き継いでください。提供されたFAQの範囲だけで短く丁寧に回答し、分からない内容を推測しないでください。個人情報の追加送信を促さないでください。",
  faqs: [
    { id: "faq-hours", enabled: true, keywords: ["営業時間", "何時", "営業日"], question: "営業時間を知りたい", answer: "営業時間は平日9時から18時です。担当者の状況により返信までお時間をいただく場合があります。" },
    { id: "faq-consult", enabled: true, keywords: ["相談したい", "見学", "利用したい", "問い合わせ"], question: "初めて相談したい", answer: "初めてのご相談を受け付けています。ご希望の連絡方法と、ご相談の概要を個人が特定されない範囲でお知らせください。担当者へ引き継ぎます。" }
  ]
};
