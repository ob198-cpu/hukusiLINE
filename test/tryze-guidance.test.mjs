import test from 'node:test';
import assert from 'node:assert/strict';
import { TRYZE_FAQS } from '../src/tryze-faq.mjs';
import { DEFAULT_SETTINGS } from '../src/defaults.mjs';
import { evaluateDeterministicRules, applyAnswerConditions } from '../src/rules.mjs';
const settings = {...structuredClone(DEFAULT_SETTINGS),defaultOfficeId:'tryze-odori',faqs:TRYZE_FAQS};
const answer = q => applyAnswerConditions(evaluateDeterministicRules(q, settings),settings,99);
test('全32項目が回数上限後も具体的な案内を保持する',()=>{
 for(const f of TRYZE_FAQS){ const r=answer(f.question); assert.equal(r.reply,f.answer,f.id); assert.equal(r.action,f.action,f.id); }
});
test('個人の医療判断・緊急・利用中の連絡はFAQで上書きしない',()=>{
 assert.equal(answer('死にたい。見学できますか').action,'urgent');
 assert.equal(answer('薬をやめて在宅で働いてもよいですか').action,'handoff');
 assert.equal(answer('利用中です。受給者証を変更したい').action,'handoff');
});
test('言い換えと事業所の混同防止',()=>{
 assert.match(answer('昼食っていくら？').reply,/100円/);
 assert.match(answer('手帳なしで相談していい？').reply,/条件/);
 assert.match(answer('B型の工賃はいくら？').reply,/B型ではなく/);
 assert.equal(evaluateDeterministicRules('ベストジョイの昼食代は？',settings),null);
});
