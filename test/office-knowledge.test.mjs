import test from 'node:test';
import assert from 'node:assert/strict';
import {officeAnswer} from '../src/office-knowledge.mjs';
const settings={offices:[
 {id:'t',enabled:true,name:'トライズ 大通',aliases:['トライズ','大通'],service:'就労移行支援',address:'南1条東2丁目',access:'駅1分',phone:'111',hours:'10～17'},
 {id:'b',enabled:true,name:'ベストジョイ 大通',aliases:['ベストジョイ','大通'],service:'就労継続支援B型',address:'南1条西7丁目',access:'駅5分',phone:'222',hours:'9～17'},
 {id:'k',enabled:true,name:'ベストジョイ 菊水',aliases:['ベストジョイ','菊水'],service:'就労継続支援B型',address:'菊水1条',access:'駅5分',phone:'333',hours:'9～17'}]};
test('B型一覧に就労移行の住所を混ぜない',()=>{const r=officeAnswer('Ｂ型はある？',settings);assert.match(r.reply,/ベストジョイ/);assert.doesNotMatch(r.reply,/南1条東2/);});
test('ブランドとエリアの両方で絞る',()=>{const r=officeAnswer('ベストジョイ大通はどこ？',settings);assert.match(r.reply,/南1条西7/);assert.doesNotMatch(r.reply,/南1条東2|菊水1条/);});
test('大通だけなら複数候補を提示',()=>{const r=officeAnswer('大通はどこ？',settings);assert.match(r.reply,/トライズ/);assert.match(r.reply,/ベストジョイ/);});
test('トライズをB型と誤案内しない',()=>{assert.match(officeAnswer('トライズはB型？',settings).reply,/こちらは就労移行支援/);});
test('工賃は住所案内にしない',()=>{assert.equal(officeAnswer('B型の工賃は？',settings),null);});
test('無効な事業所を案内しない',()=>{assert.equal(officeAnswer('どこ？',{offices:[{...settings.offices[0],enabled:false}]}),null);});
