import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DEFAULT_SETTINGS} from '../src/defaults.mjs';
import {officeGroups} from '../public/office-schema.js';

const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));

async function uiRuntime(pagesMode=true){
  const elements=new Map(),calls=[],notices=[];
  const classList=()=>({values:new Set(),add(value){this.values.add(value);},remove(value){this.values.delete(value);},
    toggle(value,enabled){if(enabled)this.values.add(value);else this.values.delete(value);}});
  const element=selector=>{
    if(!elements.has(selector))elements.set(selector,{
      value:'',checked:false,disabled:false,hidden:selector==='#testResult',innerHTML:'',textContent:'',
      dataset:{},style:{},classList:classList(),listeners:new Map(),
      addEventListener(type,listener){this.listeners.set(type,listener);},
      querySelector(child){return element(selector+' '+child);},querySelectorAll(){return [];},
      checkValidity(){return true;},reportValidity(){return true;},
      after(notice){notices.push(notice);}
    });
    return elements.get(selector);
  };
  const settings={...structuredClone(DEFAULT_SETTINGS),businessName:'テスト事業所',
    faqs:[{id:'fixture-faq',enabled:true,question:'質問',keywords:['質問'],answer:'保存前の回答',scope:[],source:'',checkedAt:''}],
    offices:[{id:'fixture-office',name:'テスト事業所',enabled:true,aliases:['テスト'],service:'就労移行支援',
      address:'テスト住所',access:'テスト駅',phone:'fixture-phone',source:'https://example.com/',checkedAt:'2026-10-14',
      facts:{'受付曜日':'平日','受付開始':'10:00','受付終了':'17:00','昼食代':100},foundation:{備考:'保存済み補足'},programs:'訓練',notes:'注意'}]};
  const tabs=['inquiries','conditions','faqs','offices','test','setup'].map(name=>Object.assign(element('tab-'+name),{dataset:{tab:name}}));
  const panels=tabs.map(tab=>Object.assign(element('panel-'+tab.dataset.tab),{id:'tab-'+tab.dataset.tab}));
  element('#statusFilter').value='all';
  element('input[name="responseMode"]:checked').value=settings.responseMode;
  const faq=element('faq-item');
  for(const [selector,value]of Object.entries({
    '.faq-question':'質問','.faq-keywords':'質問','.faq-answer':'保存前の回答',
    '.faq-scope':'','.faq-source':'','.faq-checked':''
  }))faq.querySelector(selector).value=value;
  faq.querySelector('.faq-enabled').checked=true;
  const office=element('office-item'),o=settings.offices[0];
  office.querySelector('input[type="checkbox"]').checked=true;
  for(const key of ['name','service','address','access','phone','source','checkedAt'])office.querySelector('[data-field="'+key+'"]').value=o[key]||'';
  for(const key of ['aliases','programs','notes'])office.querySelector('[data-extra="'+key+'"]').value=Array.isArray(o[key])?o[key].join('、'):o[key]||'';
  for(const group of officeGroups)for(const [key]of group.fields)office.querySelector('[data-fact="'+key+'"]').value=String(o.facts[key]??'');
  const response={action:'<b>判定</b>',category:'<img src=x onerror=alert(1)>',confidence:0.98,
    reason:'<script>理由</script>',reply:'<svg onload=alert(1)>回答 & 内容</svg>'};
  const handle=async(path,options={},transport='pages')=>{
    calls.push({path,options,transport});
    if(path==='/api/health')return {demoMode:true,counts:{},responseMode:settings.responseMode};
    if(path==='/api/settings'){
      if(options.method==='PUT')Object.assign(settings,plain(JSON.parse(options.body)));
      return structuredClone(settings);
    }
    if(path.startsWith('/api/conversations'))return [];
    if(path==='/api/simulate')return structuredClone(response);
    throw Error('Unexpected fixture API route: '+path);
  };
  const context=vm.createContext({
    URL,structuredClone,officeGroups,pagesMode,
    document:{querySelector:element,querySelectorAll:selector=>selector==='.tab'?tabs:
      selector==='.tab-panel'?panels:selector==='.faq-item'?[faq]:selector==='.office-item'?[office]:[],
      getElementById:id=>element('#'+id),createElement:()=>({textContent:'',style:{}})},
    pagesApi:(path,options)=>handle(path,options,'pages'),
    fetch:async(path,options)=>({ok:true,json:()=>handle(path,options,'fetch')}),
    clearTimeout(){},setTimeout(){return 1;},crypto:{randomUUID:()=> 'fixture-uuid'}
  });
  await vm.runInContext(app.replace(/^import [^\n]+;\r?\n/gm,''),context);
  return {context,elements,element,calls,notices,settings,faq,office,tabs,panels,
    async click(selector){await element(selector).listeners.get('click')();}};
}

test('公開Pagesでは回答テストだけを有効にしOpenAIとLINE接続テストは無効のまま',async()=>{
  const runtime=await uiRuntime();
  assert.equal(runtime.element('#runTest').disabled,false);
  assert.equal(runtime.element('#testOpenAiConnection').disabled,true);
  assert.equal(runtime.element('#testLineConnection').disabled,true);
  assert.deepEqual([...html.matchAll(/<button class="tab(?: active)?" data-tab="([^"]+)"/g)].map(match=>match[1]),
    ['inquiries','conditions','faqs','offices','test','setup']);
  for(const id of ['testText','runTest','testResult'])assert.ok(html.includes('id="'+id+'"'));
});

test('公開用noticeは保存した設定で回答テスト可能と説明しOpenAI生成とLINE送受信の未接続を明記する',async()=>{
  const runtime=await uiRuntime();
  assert.equal(runtime.notices.length,1);
  const text=runtime.notices[0].textContent;
  assert.match(text,/このブラウザに保存した設定・FAQ・事業所情報/);
  assert.match(text,/回答テストができます/);
  assert.match(text,/LINE送受信・OpenAI生成は未接続/);
  assert.doesNotMatch(text,/本番接続済み|LINE接続成功|OpenAI接続成功|AI回答は未接続/);
});

test('既存の判定操作はpreviewOnlyで質問を渡し結果5項目をエスケープして同じ場所に表示する',async()=>{
  const runtime=await uiRuntime();
  runtime.element('#testText').value='テスト問い合わせ';
  await runtime.click('#runTest');
  const calls=runtime.calls.filter(call=>call.path==='/api/simulate');
  assert.equal(calls.length,1);assert.equal(calls[0].transport,'pages');
  assert.equal(calls[0].options.method,'POST');
  assert.deepEqual(plain(JSON.parse(calls[0].options.body)),{text:'テスト問い合わせ',previewOnly:true});
  const result=runtime.element('#testResult');
  assert.equal(result.hidden,false);
  for(const label of ['処理','分類','確信度','理由','返信'])assert.ok(result.innerHTML.includes('<dt>'+label+'</dt>'));
  assert.match(result.innerHTML,/98%/);
  for(const escaped of ['&lt;b&gt;判定&lt;\/b&gt;','&lt;img src=x onerror=alert(1)&gt;',
    '&lt;script&gt;理由&lt;\/script&gt;','&lt;svg onload=alert(1)&gt;回答 &amp; 内容&lt;\/svg&gt;'])assert.ok(result.innerHTML.includes(escaped));
  assert.doesNotMatch(result.innerHTML,/<script|<img|<svg|<b>/);
  assert.ok(runtime.calls.every(call=>!call.path.endsWith('/send')&&!call.path.startsWith('/api/setup/')));
});

test('既存のタブ切替と回答条件FAQ事業所情報の保存操作を変えない',async()=>{
  const runtime=await uiRuntime();
  runtime.tabs.find(tab=>tab.dataset.tab==='test').listeners.get('click')();
  assert.ok(runtime.panels.find(panel=>panel.id==='tab-test').classList.values.has('active'));
  assert.ok(runtime.panels.filter(panel=>panel.id!=='tab-test').every(panel=>!panel.classList.values.has('active')));
  runtime.element('#confidenceThreshold').value='0.87';
  await runtime.click('#saveConditions');
  assert.equal(runtime.settings.confidenceThreshold,0.87);
  assert.equal(runtime.settings.faqs[0].answer,'保存前の回答');
  runtime.faq.querySelector('.faq-answer').value='編集して保存した回答';
  await runtime.click('#saveFaqs');
  assert.equal(runtime.settings.faqs[0].answer,'編集して保存した回答');
  assert.equal(runtime.settings.faqs[0].id,'fixture-faq');
  runtime.office.querySelector('[data-field="name"]').value='編集した事業所';
  runtime.office.querySelector('[data-fact="昼食代"]').value='0';
  await runtime.click('#saveOffices');
  assert.equal(runtime.settings.offices[0].name,'編集した事業所');
  assert.equal(runtime.settings.offices[0].facts['昼食代'],0);
  assert.equal(runtime.settings.offices[0].facts['体験日数'],null);
  assert.equal(runtime.settings.offices[0].foundation.備考,'保存済み補足');
  const saves=runtime.calls.filter(call=>call.path==='/api/settings'&&call.options.method==='PUT');
  assert.equal(saves.length,3);assert.ok(saves.every(call=>call.transport==='pages'));
});

test('Pages以外は既存のサーバーAPI経路と接続テストの操作状態を維持する',async()=>{
  const runtime=await uiRuntime(false);
  assert.equal(runtime.notices.length,0);
  for(const id of ['runTest','testOpenAiConnection','testLineConnection'])assert.equal(runtime.element('#'+id).disabled,false);
  runtime.element('#testText').value='サーバー版のテスト';
  await runtime.click('#runTest');
  assert.ok(runtime.calls.every(call=>call.transport==='fetch'));
  const call=runtime.calls.find(call=>call.path==='/api/simulate');
  assert.equal(call.options.headers['Content-Type'],'application/json');
  assert.equal(JSON.parse(call.options.body).previewOnly,true);
});
