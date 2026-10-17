import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcEstimate, defaultValues, annualCost, buildTakeaway, normalize, DEMOS, DISCLAIMER, verdictText } from '../public/js/estimate.js';
import { MENUS, pricingText } from '../public/js/pricing.js';

const at = (key, over = {}, hour) => calcEstimate(key, { ...defaultValues(key), ...over }, hour);

test('既定値の試算：経理3.3時間／労務4時間／ナレッジ5時間／外国人10時間／宿5時間', () => {
  assert.equal(at('receipt').hours, 3.3); // 100×(3−1)÷60
  assert.equal(at('attendance').hours, 4); // (20×15−60)÷60
  const k = at('knowledge');
  assert.equal(k.asked, 10); // 6×5×20÷60
  assert.equal(k.hours, 5); // ×50%
  assert.equal(at('foreign').hours, 10); // 6×10×20÷60×50%
  assert.equal(at('inn').hours, 5); // 30×(15−5)÷60
  assert.equal(at('chatbot').hours, null);
});

test('金額は、画面に出す時間（小数1桁）×1時間の値段', () => {
  assert.equal(at('receipt').monthlyValue, 16500); // 3.3×5,000
  assert.equal(at('receipt', {}, 1500).monthlyValue, 4950);
  assert.equal(at('foreign').monthlyValue, 50000);
  assert.equal(at('foreign').verdict, 'even'); // ちょうど月5万円
});

test('年間費用は pricing.js から：初期＋月額×12', () => {
  assert.equal(annualCost('inn'), 150000 + 30000 * 12);
  assert.equal(annualCost('chatbot'), 100000 + 20000 * 12);
  assert.equal(annualCost('manual'), 50000 * 12);
  assert.equal(at('receipt').monthlyFee, MENUS.manual.monthly);
});

test('元が取れる件数：宿は年7組、チャットボットは年2件（切り上げ）', () => {
  assert.equal(at('inn').payback.count, 7); // 51万÷8万＝6.375
  assert.equal(at('chatbot').payback.count, 2); // 34万÷20万＝1.7
  assert.equal(at('chatbot', { profit: 0 }).payback, null);
});

test('元が取れる時間と判定：月額÷1時間の値段', () => {
  assert.equal(at('receipt').breakEvenHours, 10); // 5万÷5,000円
  assert.equal(at('receipt', {}, 1500).breakEvenHours, 33.3);
  assert.equal(at('receipt').verdict, 'under');
  assert.equal(at('knowledge', { asks: 20 }).verdict, 'over'); // 16.7時間×5,000円
  assert.equal(at('knowledge', { asks: 8 }).verdict, 'near'); // 6.7時間 → 33,500円
  assert.match(verdictText('knowledge', at('knowledge', { asks: 8 })), /あと月3.3時間/);
});

test('導入後のほうが長いときは0時間として、注意を出す', () => {
  const r = at('receipt', { before: 1, after: 3 });
  assert.equal(r.hours, 0);
  assert.equal(r.negative, true);
  const t = buildTakeaway({ key: 'receipt', values: { before: 1, after: 3 }, hourValue: 5000, industry: 'accounting', use: '', date: '2026-10-17' });
  assert.match(t.negativeNote, /0として計算/);
});

test('入力をそろえる：空や文字は既定値、範囲の外は端に寄せる', () => {
  assert.deepEqual(normalize('receipt', { count: '', before: 'あ', after: '-5' }), { count: 100, before: 3, after: 0 });
  assert.equal(normalize('receipt', { count: '1,200' }).count, 1200);
  assert.equal(normalize('knowledge', { rate: 150 }).rate, 100);
});

test('持ち帰り1枚：必ず載せる文・前提・実測する項目・料金が pricing.js と一致', () => {
  for (const key of Object.keys(DEMOS)) {
    const t = buildTakeaway({ key, values: defaultValues(key), hourValue: 5000, industry: DEMOS[key].industry, use: '  見積の提出を早める  ', date: '2026-10-17' });
    assert.equal(t.disclaimer, DISCLAIMER);
    assert.match(t.disclaimer, /試算です。約束ではありません。お試しの1ヶ月で、御社の数字を測ります/);
    assert.equal(t.pricing, pricingText(DEMOS[key].menu));
    assert.ok(t.assumptions.length >= DEMOS[key].inputs.length, key);
    assert.deepEqual(t.measures, DEMOS[key].measures);
    assert.equal(t.use, '見積の提出を早める');
    assert.equal(t.contact.tel, '080-9018-2777');
  }
  const r = buildTakeaway({ key: 'receipt', values: defaultValues('receipt'), hourValue: 5000, industry: 'accounting', use: '', date: '2026-10-17' });
  assert.deepEqual(r.results.find(([l]) => l.startsWith('月に浮く')), ['月に浮く時間（試算）', '3.3時間']);
  assert.ok(r.assumptions.some(([l, v]) => l === 'その作業をする方の1時間の値段' && v === '5,000円'));
  assert.equal(buildTakeaway({ key: 'receipt', values: {}, hourValue: 5000, industry: 'x', use: 'あ'.repeat(150), date: '' }).use.length, 100);
});
