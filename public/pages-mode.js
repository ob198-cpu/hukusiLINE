export const pagesMode = location.hostname === 'ob198-cpu.github.io';
const key='hukusiLINE.test-settings.v1';
export async function pagesApi(path,options={}) {
  let settings=JSON.parse(localStorage.getItem(key)||'null');
  if(!settings){const r=await fetch(new URL('./initial-settings.json',import.meta.url));if(!r.ok)throw Error('初期設定を取得できません');settings=await r.json();}
  if(path==='/api/settings'){
    if(options.method==='PUT'){settings=JSON.parse(options.body);localStorage.setItem(key,JSON.stringify(settings));}
    return structuredClone(settings);
  }
  if(path==='/api/health')return {demoMode:true,counts:{},responseMode:settings.responseMode,lineConfigured:false,openaiConfigured:false,publicBaseUrlConfigured:true};
  if(path.startsWith('/api/conversations'))return [];
  throw Error('この公開画面は設定確認用です。AI回答テスト・LINE送受信にはサーバー接続が必要です。');
}
