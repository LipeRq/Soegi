import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcRoi, verdictText } from '../public/js/roi.js';

test('御社の場合：サイトと同じ時給・同じ判定', () => {
  // 事務の方（1,500円）、月200枚×1分＝約3.3時間、50%短く → 1.7時間 → 2,500円
  const r = calcRoi({ count: 200, minutesPerUnit: 1, ratePct: 50, who: 'office', monthlyFee: 50000 });
  assert.equal(r.manualHours, 3.3);
  assert.equal(r.savedHours, 1.7);
  assert.equal(r.value, 2500);
  assert.equal(r.breakEvenHours, 33.3); // 設計書の「事務の作業なら月33時間」
  assert.equal(r.verdict, 'under');
  // 社長（5,000円）で月10時間減れば、ちょうど5万円
  const o = calcRoi({ count: 20, minutesPerUnit: 60, ratePct: 50, who: 'owner', monthlyFee: 50000 });
  assert.equal(o.savedHours, 10);
  assert.equal(o.breakEvenHours, 10);
  assert.equal(o.verdict, 'even');
  assert.match(verdictText(o, 50000), /ちょうど月5万円/);
  assert.equal(calcRoi({ count: 40, minutesPerUnit: 60, ratePct: 50, who: 'owner', monthlyFee: 50000 }).verdict, 'over');
  const near = calcRoi({ count: 12, minutesPerUnit: 60, ratePct: 50, who: 'owner', monthlyFee: 50000 });
  assert.equal(near.verdict, 'near');
  assert.match(verdictText(near, 50000), /あと月4時間/);
});

test('御社の場合：負の値や100%超えは丸める', () => {
  const r = calcRoi({ count: -5, minutesPerUnit: 1, ratePct: 150, who: 'x', monthlyFee: 50000 });
  assert.equal(r.manualHours, 0);
  assert.equal(r.wage, 1500);
});

import { faqToHtml } from '../public/js/faq-html.js';

test('よくある質問のHTML：4言語の節ができ、AIの出力はエスケープされる', () => {
  const html = faqToHtml([{ q_ja: '<script>x</script>', a_ja: 'A&B', q_zh: '問', a_zh: '答', q_en: 'Q', a_en: 'A', q_ko: '질문', a_ko: '답' }], '宿"');
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /A&amp;B/);
  assert.equal((html.match(/<section class="faq"/g) || []).length, 4);
  assert.match(html, /lang="zh-Hant-TW"/);
});
