export function officeAnswer(text, settings) {
  const q = String(text).normalize('NFKC').toLowerCase();
  const offices = (settings.offices || []).filter(o => o.enabled);
  if (!offices.length) return null;
  const matches = offices.map(o => ({o, score:[o.name, ...(o.aliases || [])].filter(a => a && q.includes(a.normalize('NFKC').toLowerCase())).length}));
  const highest = Math.max(...matches.map(m=>m.score));
  const named = matches.filter(m=>m.score > 0 && m.score === highest).map(m=>m.o);
  const btype = /b型|ビー型|びー型/.test(q);
  const location = /どこ|何処|場所|所在地|住所|アクセス|行き方|最寄/.test(q);
  const phone = /電話|連絡先|連絡する/.test(q);
  const hours = /何時|受付時間|営業時間|営業日/.test(q);
  const service = /何型|サービス|どんな事業|事業内容|移行支援/.test(q);
  if (/工賃|費用|料金|昼食|パソコン|資格|見学|予約|求人|給与|送迎|在宅/.test(q) && !location && !phone && !hours) return null;
  if (!btype && !location && !phone && !hours && !service) return null;
  let selected = named.length ? named : !btype && settings.defaultOfficeId ? offices.filter(o => o.id === settings.defaultOfficeId) : offices;
  if (btype && !named.length) selected = selected.filter(o => o.service.includes('B型'));
  if (!selected.length) return null;
  const lines = selected.map(o => {
    const detail = location ? `${o.address}。${o.access}` : phone ? `電話 ${o.phone}` : hours ? `受付 ${o.hours}` : `${o.service}。${o.address}`;
    return `${o.name}：${detail}`;
  });
  let intro = btype && !named.length ? 'はい。掲載されているB型事業所はこちらです。\n' : '';
  if (btype && named.length) intro = selected.every(o => o.service.includes('B型')) ? 'はい、就労継続支援B型です。\n' : selected.every(o => !o.service.includes('B型')) ? 'こちらは就労移行支援です。B型ではありません。\n' : '';
  return { action:'auto_reply', category:'general', confidence:1, reply:intro+lines.join('\n')+(selected.length > 1 ? '\nご希望の事業所はありますか？' : ''), reason:'事業所情報: '+selected.map(o=>o.id).join(',') };
}
