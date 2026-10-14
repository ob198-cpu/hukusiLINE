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
  if(path==='/api/simulate'){
    if(options.method!=='POST')throw Error('回答テストはPOSTで実行してください');
    const body=JSON.parse(options.body||'{}');
    if(!body||typeof body!=='object'||body.previewOnly!==true)throw Error('この公開画面では保存しない回答テストのみ実行できます');
    const text=String(body.text||'').trim();
    if(!text)throw Error('問い合わせ文を入力してください');
    const {evaluateDeterministicRules,applyAnswerConditions,createRulesOnlyFallback}=await import('./rules/rules.mjs');
    const decision=evaluateDeterministicRules(text,settings)
      || (settings.responseMode==='rules_only'?createRulesOnlyFallback(settings)
        :{action:'handoff',category:'unknown',confidence:0,reply:settings.handoffText,reason:'OpenAI API未設定'});
    return applyAnswerConditions(decision,settings,0);
  }
  if(path.startsWith('/api/conversations'))return [];
  throw Error('この公開画面は設定確認用です。AI回答テスト・LINE送受信にはサーバー接続が必要です。');
}
