import { officeGroups } from './office-schema.js';
const state = { settings: null, selectedId: null, conversations: [] };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function statusLabel(status) {
  return ({ unhandled: "未対応", urgent: "至急確認", in_progress: "対応中", ai_replied: "自動回答済み", closed: "完了" })[status] || status;
}

function categoryLabel(category) {
  return state.settings?.categories?.[category]?.label || ({ emergency: "緊急", unknown: "要確認" })[category] || category;
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function loadHealth() {
  const health = await api("/api/health");
  const ready = health.lineConfigured && health.openaiConfigured && !health.demoMode;
  const rulesReady = health.lineConfigured && health.responseMode === "rules_only" && !health.demoMode;
  const badge = $("#connectionBadge");
  badge.textContent = health.demoMode ? "テストモード" : rulesReady ? "APIなし運用" : ready ? "本番接続済み" : "設定未完了";
  badge.className = `status-badge ${ready || rulesReady ? "ok" : "warn"}`;
  $("#countUnhandled").textContent = health.counts.unhandled || 0;
  $("#countUrgent").textContent = health.counts.urgent || 0;
  $("#countProgress").textContent = health.counts.in_progress || 0;
  $("#countAi").textContent = health.counts.ai_replied || 0;
  const setupStates = {
    setupOpenAi: health.openaiConfigured,
    setupLineSecret: health.lineSecretConfigured,
    setupLineToken: health.lineTokenConfigured,
    setupPublicUrl: health.publicBaseUrlConfigured
  };
  for (const [id, configured] of Object.entries(setupStates)) {
    const item = $(`#${id}`);
    item.textContent = configured ? "設定済み" : "未設定";
    item.classList.toggle("configured", configured);
  }
  $("#setupRunMode").textContent = health.demoMode ? "テスト" : "本番";
}

async function loadSettings() {
  state.settings = await api("/api/settings");
  const s = state.settings;
  $('#businessHeading').textContent = `${s.businessName}｜LINE問い合わせ管理`;
  const mode = document.querySelector(`input[name="responseMode"][value="${s.responseMode || "rules_only"}"]`);
  if (mode) mode.checked = true;
  $("#autoReplyEnabled").checked = s.autoReplyEnabled;
  $("#acknowledgementEnabled").checked = s.acknowledgementEnabled;
  $("#allowAfterHoursAi").checked = s.allowAfterHoursAi;
  $("#confidenceThreshold").value = s.confidenceThreshold;
  $("#maxAutoReplies").value = s.maxAutoRepliesPerConversation;
  $("#officeStart").value = s.officeHours.start;
  $("#officeEnd").value = s.officeHours.end;
  $("#categoryNew").checked = s.categories.new_consultation.autoReply;
  $("#categoryRegistered").checked = s.categories.registered_user.autoReply;
  $("#categoryOffice").checked = s.categories.welfare_office.autoReply;
  $("#categoryGeneral").checked = s.categories.general.autoReply;
  $("#ackText").value = s.acknowledgementText;
  $("#handoffText").value = s.handoffText;
  $("#emergencyText").value = s.emergencyText;
  $("#emergencyKeywords").value = s.emergencyKeywords.join("、");
  $("#registeredKeywords").value = s.registeredKeywords.join("、");
  $("#welfareOfficeKeywords").value = s.welfareOfficeKeywords.join("、");
  $("#handoffKeywords").value = s.handoffKeywords.join("、");
  $("#systemPrompt").value = s.systemPrompt;
  renderFaqs();
  renderOffices();
}

function readKeywords(selector) {
  return $(selector).value.split(/[、,\n]/).map((item) => item.trim()).filter(Boolean);
}

function readConditions() {
  return {
    ...state.settings,
    responseMode: document.querySelector('input[name="responseMode"]:checked')?.value || "rules_only",
    autoReplyEnabled: $("#autoReplyEnabled").checked,
    acknowledgementEnabled: $("#acknowledgementEnabled").checked,
    allowAfterHoursAi: $("#allowAfterHoursAi").checked,
    confidenceThreshold: Number($("#confidenceThreshold").value),
    maxAutoRepliesPerConversation: Number($("#maxAutoReplies").value),
    officeHours: { ...state.settings.officeHours, start: $("#officeStart").value, end: $("#officeEnd").value },
    categories: {
      ...state.settings.categories,
      new_consultation: { ...state.settings.categories.new_consultation, autoReply: $("#categoryNew").checked },
      registered_user: { ...state.settings.categories.registered_user, autoReply: $("#categoryRegistered").checked },
      welfare_office: { ...state.settings.categories.welfare_office, autoReply: $("#categoryOffice").checked },
      general: { ...state.settings.categories.general, autoReply: $("#categoryGeneral").checked }
    },
    acknowledgementText: $("#ackText").value.trim(),
    handoffText: $("#handoffText").value.trim(),
    emergencyText: $("#emergencyText").value.trim(),
    emergencyKeywords: readKeywords("#emergencyKeywords"),
    registeredKeywords: readKeywords("#registeredKeywords"),
    welfareOfficeKeywords: readKeywords("#welfareOfficeKeywords"),
    handoffKeywords: readKeywords("#handoffKeywords"),
    systemPrompt: $("#systemPrompt").value.trim()
  };
}

async function saveSettings(next) {
  state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(next) });
  toast("保存しました");
}

function renderFaqs() {
  $("#faqList").innerHTML = state.settings.faqs.map((faq, index) => `
    <div class="faq-item" data-index="${index}">
      <label class="enabled"><span>有効</span><input class="faq-enabled" type="checkbox" ${faq.enabled ? "checked" : ""}></label>
      <label><span>質問</span><input class="faq-question" value="${escapeHtml(faq.question)}"></label>
      <label><span>反応する言葉（読点区切り）</span><input class="faq-keywords" value="${escapeHtml(faq.keywords.join("、"))}"></label>
      <label><span>回答</span><textarea class="faq-answer" rows="3">${escapeHtml(faq.answer)}</textarea></label>
      <label><span>対象事業所（空欄は共通）</span><input class="faq-scope" value="${escapeHtml((faq.scope || []).join('、'))}"></label>
      <label><span>出典URL</span><input class="faq-source" type="url" value="${escapeHtml(faq.source || '')}"></label>
      <label><span>情報確認日</span><input class="faq-checked" type="date" value="${escapeHtml(faq.checkedAt || '')}"></label>
      <button class="button delete-faq" type="button">削除</button>
    </div>`).join("") || '<p class="empty">FAQはまだありません。</p>';
  $$(".delete-faq").forEach((button) => button.addEventListener("click", () => {
    state.settings.faqs = readFaqs(false);
    state.settings.faqs.splice(Number(button.closest(".faq-item").dataset.index), 1);
    renderFaqs();
  }));
}

function readFaqs(removeEmpty = true) {
  const faqs = $$(".faq-item").map((item, index) => ({
    ...state.settings.faqs[index],
    id: state.settings.faqs[index]?.id || `faq-${Date.now()}-${index}`,
    enabled: item.querySelector(".faq-enabled").checked,
    question: item.querySelector(".faq-question").value.trim(),
    keywords: item.querySelector(".faq-keywords").value.split(/[、,\n]/).map((v) => v.trim()).filter(Boolean),
    answer: item.querySelector(".faq-answer").value.trim(),
    scope: item.querySelector('.faq-scope').value.split(/[、,\n]/).map(v=>v.trim()).filter(Boolean),
    source: item.querySelector('.faq-source').value.trim(),
    checkedAt: item.querySelector('.faq-checked').value
  }));
  return removeEmpty ? faqs.filter(f=>f.question && f.answer) : faqs;
}

const officeFields = [['name','事業所名'],['service','サービス種別'],['address','所在地'],['access','最寄り駅・行き方'],['phone','電話番号'],['source','公式サイト'],['checkedAt','情報確認日']];
function renderOffices() {
  $('#officeList').innerHTML=(state.settings.offices || []).map((o,index)=>{
    const basic=officeFields.map(([key,label])=>`<label><span>${label}</span><input data-field="${key}" type="${key==='checkedAt'?'date':key==='source'?'url':'text'}" value="${escapeHtml(o[key] || '')}"></label>`).join('');
    const groups=officeGroups.map(group=>`<section class="fact-group"><h3>${group.title}</h3><div class="fact-grid">${group.fields.map(([key,type,extra])=>{
      const value=o.facts?.[key];
      const control=type==='select'?`<select data-fact="${key}">${extra.map(option=>`<option ${value===option?'selected':''}>${option}</option>`).join('')}</select>`:`<div class="fact-value"><input data-fact="${key}" type="${type}" ${type==='number'?'min="0" step="1" placeholder="未確認"':''} value="${escapeHtml(value ?? '')}">${type==='number'?`<span>${extra}</span>`:''}</div>`;
      return `<label><span>${key}</span>${control}</label>`;
    }).join('')}</div></section>`).join('');
    const details=Object.entries(o.foundation || {}).map(([key,value])=>`<details class="source-detail"><summary>${escapeHtml(key)}</summary><label><span>補足条件・出典</span><textarea data-foundation="${escapeHtml(key)}" rows="5">${escapeHtml(value)}</textarea></label></details>`).join('');
    return `<fieldset class="office-item" data-index="${index}"><legend>${escapeHtml(o.name || '事業所')}</legend><label class="office-enabled"><input type="checkbox" ${o.enabled?'checked':''}>回答に使用</label><section class="fact-group"><h3>基本情報</h3><div class="office-fields">${basic}</div></section>${groups}<section class="fact-group"><h3>補足条件・出典</h3><p class="field-help">必要な項目を開いて確認・編集できます。数値欄の空欄は「未確認」です。</p>${details}<details class="source-detail"><summary>その他の設定</summary>${[['aliases','反応する名称'],['programs','訓練の概要'],['notes','その他の注意事項']].map(([key,label])=>`<label><span>${label}</span><textarea data-extra="${key}" rows="2">${escapeHtml(Array.isArray(o[key])?o[key].join('、'):o[key] || '')}</textarea></label>`).join('')}</details></section></fieldset>`;
  }).join('');
}
function readOffices() {
 return $$('.office-item').map((el,i)=>{
  const o={...state.settings.offices[i],enabled:el.querySelector('input[type="checkbox"]').checked};
  for(const [key] of officeFields)o[key]=el.querySelector(`[data-field="${key}"]`).value.trim();
  for(const key of ['aliases','programs','notes'])o[key]=el.querySelector(`[data-extra="${key}"]`).value.trim();
  o.aliases=o.aliases.split(/[、,\n]/).map(v=>v.trim()).filter(Boolean);
  o.facts={...(o.facts || {})};
  for(const group of officeGroups)for(const [key,type] of group.fields){
   const input=el.querySelector(`[data-fact="${key}"]`);
   if(!input.checkValidity()){input.reportValidity();throw new Error(key+'を確認してください');}
   o.facts[key]=type==='number'?(input.value===''?null:Number(input.value)):input.value;
  }
  o.hours=`${o.facts['受付曜日']} ${o.facts['受付開始']}〜${o.facts['受付終了']}`;
  o.foundation={...(o.foundation || {})};
  el.querySelectorAll('[data-foundation]').forEach(input=>o.foundation[input.dataset.foundation]=input.value.trim());
  return o;
 });
}
$('#addOffice').addEventListener('click',()=>{state.settings.offices=readOffices(); state.settings.offices.push({id:crypto.randomUUID(),name:'',enabled:false,aliases:[]}); renderOffices();});
$('#saveOffices').addEventListener('click',async()=>{try {await saveSettings({...state.settings,offices:readOffices()}); renderOffices();}catch(e){toast(e.message);}});

async function loadConversations() {
  const status = encodeURIComponent($("#statusFilter").value);
  const search = encodeURIComponent($("#searchInput").value.trim());
  state.conversations = await api(`/api/conversations?status=${status}&search=${search}`);
  const rows = $("#conversationRows");
  rows.innerHTML = state.conversations.length ? state.conversations.map((item) => `
    <tr data-id="${item.id}" class="${item.id === state.selectedId ? "selected" : ""}">
      <td><span class="pill ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></td>
      <td><span class="clip" title="${escapeHtml(item.line_user_id)}">${escapeHtml(item.display_name || `LINE ${item.line_user_id.slice(-8)}`)}</span></td>
      <td>${escapeHtml(categoryLabel(item.category))}</td>
      <td><span class="clip" title="${escapeHtml(item.latest_body || "")}">${escapeHtml(item.latest_body || "送信取消または本文なし")}</span></td>
      <td>${escapeHtml(formatDate(item.last_message_at))}</td>
      <td>${item.message_count}</td>
    </tr>`).join("") : '<tr><td colspan="6" class="empty">該当する問い合わせはありません。</td></tr>';
  $$('tr[data-id]').forEach((row) => row.addEventListener("click", () => openConversation(Number(row.dataset.id))));
  await loadHealth();
}

async function openConversation(id) {
  state.selectedId = id;
  const item = await api(`/api/conversations/${id}`);
  $$("tr[data-id]").forEach((row) => row.classList.toggle("selected", Number(row.dataset.id) === id));
  $("#conversationDetail").innerHTML = `
    <div class="detail-header"><div><h2>${escapeHtml(item.display_name || `LINE ${item.line_user_id.slice(-8)}`)}</h2><p class="detail-meta">${escapeHtml(categoryLabel(item.category))} / ${item.messages.length}件</p></div><span class="pill ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></div>
    <div class="messages">${item.messages.map((message) => `
      <div class="message ${message.direction}"><strong>${escapeHtml(message.sender)}</strong><div>${message.body === null ? "送信取消済み" : escapeHtml(message.body).replace(/\n/g, "<br>")}</div><small>${escapeHtml(formatDate(message.created_at))}${message.delivery_status === "failed" ? " / 送信失敗" : ""}</small></div>`).join("")}</div>
    <div class="reply-box">
      <textarea id="manualReply" rows="4" placeholder="職員から返信"></textarea>
      <input id="staffName" type="text" placeholder="対応者名">
      <div class="status-controls"><select id="detailStatus"><option value="unhandled">未対応</option><option value="urgent">至急確認</option><option value="in_progress">対応中</option><option value="closed">完了</option></select><button id="saveStatus" class="button secondary" type="button">状態を更新</button></div>
      <button id="sendReply" class="button primary" type="button">LINEへ返信</button>
    </div>`;
  $("#detailStatus").value = item.status;
  $("#staffName").value = item.assigned_to || "";
  $("#saveStatus").addEventListener("click", () => updateStatus(id));
  $("#sendReply").addEventListener("click", () => sendReply(id));
}

async function updateStatus(id) {
  await api(`/api/conversations/${id}/status`, { method: "POST", body: JSON.stringify({ status: $("#detailStatus").value, assignedTo: $("#staffName").value.trim() }) });
  toast("状態を更新しました");
  await loadConversations();
  await openConversation(id);
}

async function sendReply(id) {
  const text = $("#manualReply").value.trim();
  if (!text) return toast("返信本文を入力してください");
  await api(`/api/conversations/${id}/send`, { method: "POST", body: JSON.stringify({ text, sender: $("#staffName").value.trim() || "職員" }) });
  toast("LINEへ送信しました");
  await loadConversations();
  await openConversation(id);
}

function switchTab(name) {
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  $$(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${name}`));
}

async function initialize() {
  await loadHealth();
  try {
    await loadSettings();
    await loadConversations();
  } catch (error) {
    toast(error.message);
  }
}

$$('.tab').forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
$("#statusFilter").addEventListener("change", loadConversations);
$("#searchInput").addEventListener("keydown", (event) => { if (event.key === "Enter") loadConversations(); });
$("#reloadButton").addEventListener("click", loadConversations);
$("#saveConditions").addEventListener("click", async () => {
  try { await saveSettings(readConditions()); } catch (error) { toast(error.message); }
});
$("#addFaq").addEventListener("click", () => {
  state.settings.faqs = readFaqs(false);
  state.settings.faqs.push({ id: `faq-${Date.now()}`, enabled: true, keywords: [], question: "", answer: "" });
  renderFaqs();
});
$("#saveFaqs").addEventListener("click", async () => {
  try { await saveSettings({ ...state.settings, faqs: readFaqs() }); renderFaqs(); } catch (error) { toast(error.message); }
});
$("#runTest").addEventListener("click", async () => {
  const result = $("#testResult");
  try {
    const data = await api("/api/simulate", { method: "POST", body: JSON.stringify({ text: $("#testText").value, previewOnly: true }) });
    result.hidden = false;
    result.innerHTML = `<dl><dt>処理</dt><dd>${escapeHtml(data.action)}</dd><dt>分類</dt><dd>${escapeHtml(categoryLabel(data.category))}</dd><dt>確信度</dt><dd>${Math.round(data.confidence * 100)}%</dd><dt>理由</dt><dd>${escapeHtml(data.reason)}</dd><dt>返信</dt><dd>${escapeHtml(data.reply)}</dd></dl>`;
    await loadConversations();
  } catch (error) { toast(error.message); }
});
$("#testOpenAiConnection").addEventListener("click", async () => {
  const result = $("#connectionTestResult");
  try {
    const data = await api("/api/setup/test-openai", { method: "POST" });
    result.textContent = `OpenAI接続成功: ${data.model}`;
    result.className = "connection-test-result ok";
    await loadHealth();
  } catch (error) {
    result.textContent = error.message;
    result.className = "connection-test-result error";
  }
});
$("#testLineConnection").addEventListener("click", async () => {
  const result = $("#connectionTestResult");
  try {
    const data = await api("/api/setup/test-line", { method: "POST" });
    result.textContent = `LINE接続成功: ${data.displayName}`;
    result.className = "connection-test-result ok";
    await loadHealth();
  } catch (error) {
    result.textContent = error.message;
    result.className = "connection-test-result error";
  }
});
initialize();
