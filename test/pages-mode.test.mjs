import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {evaluateDeterministicRules,applyAnswerConditions,createRulesOnlyFallback} from '../src/rules.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ruleFiles=['rules.mjs','office-knowledge.mjs','tryze-faq.mjs'];
const temporaryParent=fs.realpathSync(os.tmpdir());
const fixture=fs.mkdtempSync(path.join(temporaryParent,'hukusiline-pages-test-'));
fs.cpSync(path.join(project,'public'),path.join(fixture,'public'),{recursive:true});
fs.copyFileSync(path.join(project,'package.json'),path.join(fixture,'package.json'));
fs.mkdirSync(path.join(fixture,'src'));
for(const filename of ['initial-settings.json',...ruleFiles])fs.copyFileSync(path.join(project,'src',filename),path.join(fixture,'src',filename));
execFileSync(process.execPath,[path.join(project,'tools/build-pages.mjs')],{cwd:fixture});
const artifact=path.join(fixture,'dist');
const initial=JSON.parse(fs.readFileSync(path.join(artifact,'initial-settings.json'),'utf8'));
let sequence=0;

after(()=>{
  const resolved=fs.realpathSync(fixture),relative=path.relative(temporaryParent,resolved);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(resolved).startsWith('hukusiline-pages-test-'),'一時テストディレクトリだけを削除します');
  fs.rmSync(resolved,{recursive:true,force:true});
});

function treeSnapshot() {
  return fs.readdirSync(fixture,{recursive:true}).filter(name=>fs.statSync(path.join(fixture,name)).isFile()).sort()
    .map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(fixture,name))).digest('hex')]);
}

async function harness(t,{settings=initial,stored=true,hostname='ob198-cpu.github.io',modulePath=path.join(artifact,'pages-mode.js')}={}) {
  const descriptors=Object.fromEntries(['location','localStorage','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const state={saved:stored?JSON.stringify(settings):null,reads:[],writes:[],fetches:[]};
  Object.defineProperty(globalThis,'location',{configurable:true,writable:true,value:{hostname}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,writable:true,value:{
    getItem(key){state.reads.push(key);return state.saved;},
    setItem(key,value){state.writes.push({key,value});state.saved=value;}
  }});
  Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(resource,options)=>{
    const url=String(resource);state.fetches.push({url,options});
    assert.equal(url,pathToFileURL(path.join(artifact,'initial-settings.json')).href,'静的な初期設定以外へ通信しません');
    assert.equal(options,undefined,'問い合わせを送信しません');
    return {ok:true,json:async()=>structuredClone(initial)};
  }});
  t.after(()=>{
    for(const [key,descriptor] of Object.entries(descriptors)) {
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  });
  const module=await import(pathToFileURL(modulePath).href+'?test='+sequence++);
  return {...module,state};
}

const preview=(api,text)=>api('/api/simulate',{method:'POST',body:JSON.stringify({text,previewOnly:true})});

test('Pagesの配布物は既存の純粋ルール3本をそのまま含め、サーバー・DB・秘密情報のmoduleを含めない',()=>{
  for(const filename of ruleFiles) {
    const published=path.join(artifact,'rules',filename);
    assert.ok(fs.existsSync(published),filename+' を公開用に配布します');
    assert.ok(fs.readFileSync(published,'utf8')===fs.readFileSync(path.join(project,'src',filename),'utf8'),filename+' のルールを変更しません');
  }
  const files=fs.readdirSync(artifact,{recursive:true}).filter(name=>fs.statSync(path.join(artifact,name)).isFile()).map(name=>name.replaceAll('\\','/')).sort();
  const publicFiles=fs.readdirSync(path.join(fixture,'public'),{recursive:true}).filter(name=>fs.statSync(path.join(fixture,'public',name)).isFile()).map(name=>name.replaceAll('\\','/'));
  assert.deepEqual(files,[...publicFiles,'initial-settings.json','.nojekyll',...ruleFiles.map(name=>'rules/'+name)].sort());
  assert.ok(!files.some(name=>/(?:^|\/)(?:\.env(?:\.|$)|server\.mjs|openai\.mjs|env\.mjs|line\.mjs|store\.mjs|security\.mjs|data(?:\/|$))/.test(name)));
});

test('Pages回答テストは既存のFAQ・事業所案内・緊急・利用中の条件判定と同じ結果を返す',async t=>{
  const {pagesApi,state}=await harness(t);
  assert.equal(initial.faqs.length,0,'編集用FAQが空でも既存の内蔵案内を維持します');
  for(const text of ['見学したいのですが、直近で空いている日はありますか？','受付時間と訓練時間を教えてください',
    '現在利用中です。職員に確認したいです','今すぐ助けて。死にたいです']) {
    const decision=evaluateDeterministicRules(text,initial);
    assert.ok(decision);
    assert.deepEqual(await preview(pagesApi,text),applyAnswerConditions(decision,initial,0));
  }
  assert.deepEqual(state.fetches,[]);
  assert.deepEqual(state.writes,[]);
});

test('Pages回答テストはこのブラウザで保存したFAQと事業所情報を使い、設定自体を変更しない',async t=>{
  const settings=structuredClone(initial);
  settings.faqs=[{id:'test-faq',enabled:true,keywords:['テスト専用の案内'],question:'テスト専用の案内',answer:'保存したFAQの回答です'}];
  settings.offices[0].facts['直近の見学空き日']='2026-10-20';
  const {pagesApi,state}=await harness(t,{settings}),before=state.saved;
  const faq=await preview(pagesApi,'テスト専用の案内を教えてください');
  assert.equal(faq.reply,'保存したFAQの回答です');
  const visit=await preview(pagesApi,'見学したいのですが、直近で空いている日はありますか？');
  assert.match(visit.reply,/2026年10月20日/);
  assert.equal(state.saved,before);
  assert.deepEqual(state.fetches,[]);
  assert.deepEqual(state.writes,[]);
});

test('Pages回答テストでも自動回答停止と営業時間の既存条件を適用する',async t=>{
  const stopped={...structuredClone(initial),autoReplyEnabled:false};
  const first=await harness(t,{settings:stopped});
  const text='受付時間と訓練時間を教えてください';
  const result=await preview(first.pagesApi,text);
  assert.equal(result.action,'handoff');
  assert.equal(result.reason,'自動回答停止中');
  assert.equal(result.reply,stopped.handoffText);
});

test('Pages回答テストの営業時間外判定は既存ルール通りに回答を差し替える',async t=>{
  const settings={...structuredClone(initial),allowAfterHoursAi:false};
  settings.officeHours.weekdays=[];
  const {pagesApi}=await harness(t,{settings});
  const result=await preview(pagesApi,'受付時間と訓練時間を教えてください');
  assert.equal(result.action,'handoff');
  assert.equal(result.reason,'営業時間外');
  assert.equal(result.reply,settings.afterHoursText);
});

test('PagesのAPIなしモードは未登録の内容を既存fallbackへ回し、OpenAIへ送信しない',async t=>{
  const settings={...structuredClone(initial),responseMode:'rules_only'},text='架空の判定内容XYZを検討してください';
  assert.equal(evaluateDeterministicRules(text,settings),null);
  const {pagesApi,state}=await harness(t,{settings});
  const result=await preview(pagesApi,text);
  assert.deepEqual(result,applyAnswerConditions(createRulesOnlyFallback(settings),settings,0));
  assert.equal(result.action,'handoff');
  assert.match(result.reason,/FAQに未登録/);
  assert.deepEqual(state.fetches,[]);
  assert.deepEqual(state.writes,[]);
});

test('PagesのOpenAI未接続fallbackは旧サーバーと同じconfidence0で、生成した回答や実AI接続を装わない',async t=>{
  const settings={...structuredClone(initial),responseMode:'openai'};
  const text='架空の判定内容XYZ。test-person@example.test 090-1234-5678について独自判断してください';
  assert.equal(evaluateDeterministicRules(text,settings),null);
  const {pagesApi,state}=await harness(t,{settings}),before=state.saved,filesBefore=treeSnapshot();
  const expected=applyAnswerConditions({action:'handoff',category:'unknown',confidence:0,reply:settings.handoffText,reason:'OpenAI API未設定'},settings,0);
  const result=await preview(pagesApi,text);
  assert.deepEqual(result,expected);
  assert.equal(result.action,'handoff');
  assert.equal(result.confidence,0);
  assert.equal(result.reply,settings.handoffText);
  assert.doesNotMatch(JSON.stringify(result),/test-person@example\.test|090-1234-5678/);
  assert.equal(state.saved,before);
  assert.deepEqual(state.writes,[]);
  assert.deepEqual(state.fetches,[]);
  assert.deepEqual(treeSnapshot(),filesBefore,'テスト入力をDB・ファイルへ保存しません');
  const health=await pagesApi('/api/health');
  assert.equal(health.openaiConfigured,false);
  assert.equal(health.lineConfigured,false);
  assert.equal(health.demoMode,true);
  assert.equal(health.responseMode,'openai');
});

test('Pages回答テストは空入力を拒否し、POST previewOnly:true以外の保存付きsimulateを受け付けない',async t=>{
  const {pagesApi,state}=await harness(t);
  for(const text of ['', '   ','\n'])await assert.rejects(()=>preview(pagesApi,text),/問い合わせ文を入力してください/);
  for(const body of [{text:'見学したい'}, {text:'見学したい',previewOnly:false}])
    await assert.rejects(()=>pagesApi('/api/simulate',{method:'POST',body:JSON.stringify(body)}));
  for(const method of [undefined,'GET','PUT'])await assert.rejects(()=>pagesApi('/api/simulate',{method,body:JSON.stringify({text:'見学したい',previewOnly:true})}));
  assert.deepEqual(state.writes,[]);
  assert.deepEqual(state.fetches,[]);
});

test('Pages回答テストは静的初期設定以外へ通信せず、既存の設定保存・接続未対応を維持する',async t=>{
  const {pagesApi,state}=await harness(t,{stored:false});
  const text='受付時間と訓練時間を教えてください';
  assert.deepEqual(await preview(pagesApi,text),applyAnswerConditions(evaluateDeterministicRules(text,initial),initial,0));
  assert.equal(state.fetches.length,1);
  assert.deepEqual(state.writes,[]);
  const changed={...structuredClone(initial),autoReplyEnabled:false};
  assert.deepEqual(await pagesApi('/api/settings',{method:'PUT',body:JSON.stringify(changed)}),changed);
  assert.equal(state.writes.length,1);
  assert.deepEqual(JSON.parse(state.saved),changed);
  assert.deepEqual(await pagesApi('/api/conversations'),[]);
  await assert.rejects(()=>pagesApi('/api/setup/test-openai',{method:'POST'}),/サーバー接続/);
  await assert.rejects(()=>pagesApi('/api/setup/test-line',{method:'POST'}),/サーバー接続/);
  assert.equal(state.writes.length,1);
  assert.ok(state.fetches.every(item=>item.url.endsWith('/initial-settings.json')));
});

test('ローカルモードは公開ルールがない場所でもpages-modeを読み込め、トップレベルimportを増やさない',async t=>{
  const lazy=path.join(fixture,'lazy-local-mode');
  fs.mkdirSync(lazy);
  fs.copyFileSync(path.join(artifact,'pages-mode.js'),path.join(lazy,'pages-mode.js'));
  const {pagesMode,state}=await harness(t,{hostname:'127.0.0.1',modulePath:path.join(lazy,'pages-mode.js')});
  assert.equal(pagesMode,false);
  assert.deepEqual(state.fetches,[]);
  assert.deepEqual(state.reads,[]);
  assert.deepEqual(state.writes,[]);
});
