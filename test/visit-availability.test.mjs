import test from 'node:test';
import assert from 'node:assert/strict';
import {matchOfficeFaq} from '../src/tryze-faq.mjs';

const faq = {id:'tryze-odori-visit',enabled:true,verifiedGuidance:true,officeId:'tryze-odori',question:'見学したいのですが、直近で空いている日はありますか？',keywords:['見学','空いている日'],answer:'未設定時の回答',action:'auto_reply',category:'general'};

test('設定した直近の見学空き日を回答する', () => {
  const settings={defaultOfficeId:'tryze-odori',offices:[{id:'tryze-odori',enabled:true,facts:{'直近の見学空き日':'2026-09-25'}}],faqs:[faq]};
  const result=matchOfficeFaq('直近で空いている日はありますか？',settings);
  assert.match(result.reply,/2026年9月25日/);
  assert.match(result.reply,/予約確定/);
});

test('編集用FAQが空でも組み込み案内を使う', () => {
  const settings={defaultOfficeId:'tryze-odori',offices:[{id:'tryze-odori',enabled:true,facts:{}}],faqs:[]};
  const result=matchOfficeFaq('見学したいです',settings);
  assert.match(result.reply,/見学のお申込みは可能/);
});
